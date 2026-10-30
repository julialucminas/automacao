import { ImapFlow } from 'imapflow';
import type { Banco, Repositorio } from './db.js';
import { comPrazo, naFilaImap, semQuedas, type ContaEmail } from './email.js';

/*
 * Acompanha a caixa de entrada do e-mail da empresa (só leitura) e reconhece:
 *  - devoluções ("não entregue"): o e-mail não chegou ao cliente
 *  - confirmações de leitura: o cliente abriu e confirmou
 * Cada envio leva um Message-ID nosso; as respostas automáticas citam esse ID.
 * Não marca nada como lido, não move e não apaga mensagens.
 */

export type Evento =
  | { tipo: 'lido'; messageIds: string[]; quando: string; quem: string }
  | { tipo: 'devolvido'; messageIds: string[]; quando: string; enderecos: string[]; motivo: string };

const RE_ID_NOSSO = /<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@[a-z0-9.-]+>/gi;

/** Junta linhas de cabeçalho quebradas ("folding"). */
const desdobrar = (s: string) => s.replace(/\r?\n[ \t]+/g, ' ');

function campo(texto: string, nome: string): string {
  const m = new RegExp(`^${nome}:\\s*(.+)$`, 'im').exec(texto);
  return m ? m[1].trim() : '';
}

/** Tenta decodificar partes em base64 / quoted-printable para achar IDs e motivos escondidos. */
function textoDecodificado(bruto: string): string {
  let extra = '';
  for (const m of bruto.matchAll(/Content-Transfer-Encoding:\s*base64\s*\r?\n(?:[^\r\n]+\r?\n)*?\r?\n([A-Za-z0-9+/=\r\n]{20,})/gi)) {
    try {
      extra += '\n' + Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      /* ignora */
    }
  }
  const qp = bruto.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return qp + extra;
}

const RE_ASSUNTO_DEVOLUCAO = /undeliver|delivery status|delivery failure|failure notice|returned mail|mail delivery|n[ãa]o (foi )?entregue|falha na entrega|mensagem n[ãa]o entregue|devolvida|non remis|unzustellbar/i;
const RE_REMETENTE_SISTEMA = /mailer-daemon|postmaster|mail delivery/i;
const RE_ASSUNTO_LEITURA = /^(lid[ao]|read|lu|gelesen|confirma[cç][aã]o de leitura|read receipt|return receipt|disposition notification)/i;

/** Lê uma mensagem da caixa de entrada e diz se é devolução ou confirmação de leitura de algo que enviamos. */
export function interpretar(bruto: string, recebidoEm = new Date()): Evento | null {
  const texto = desdobrar(textoDecodificado(bruto));
  const fimCab = bruto.search(/\r?\n\r?\n/);
  const cabecalho = desdobrar(fimCab > 0 ? bruto.slice(0, fimCab) : bruto);
  const assunto = campo(cabecalho, 'Subject');
  const de = campo(cabecalho, 'From');
  const tipoConteudo = campo(cabecalho, 'Content-Type');
  const quando = (() => {
    const d = new Date(campo(cabecalho, 'Date'));
    return isNaN(d.getTime()) ? recebidoEm.toISOString() : d.toISOString();
  })();
  const proprioId = campo(cabecalho, 'Message-ID').toLowerCase();
  const ids = [...new Set((texto.match(RE_ID_NOSSO) ?? []).map((x) => x.toLowerCase()))].filter((x) => x !== proprioId);

  // confirmação de leitura (RFC 8098)
  const ehMdn = /disposition-notification/i.test(tipoConteudo) || /^Disposition:\s*.*displayed/im.test(texto);
  if (ehMdn || (RE_ASSUNTO_LEITURA.test(assunto) && /Original-Message-ID/i.test(texto))) {
    const disp = campo(texto, 'Disposition');
    if (disp && !/displayed/i.test(disp)) return null; // "deleted"/"denied": não conta como lido
    const original = campo(texto, 'Original-Message-ID').toLowerCase();
    const alvo = original ? [original] : ids;
    if (!alvo.length) return null;
    const quem = campo(texto, 'Final-Recipient').replace(/^rfc822;\s*/i, '') || de;
    return { tipo: 'lido', messageIds: alvo, quando, quem };
  }

  // devolução (RFC 3464 ou mensagem de sistema em texto)
  const ehDsn = /report-type="?delivery-status/i.test(tipoConteudo);
  const pareceDevolucao = ehDsn || (RE_REMETENTE_SISTEMA.test(de) && RE_ASSUNTO_DEVOLUCAO.test(assunto)) || RE_ASSUNTO_DEVOLUCAO.test(assunto);
  if (!pareceDevolucao) return null;
  const acoes = [...texto.matchAll(/^Action:\s*(\w+)/gim)].map((m) => m[1].toLowerCase());
  if (acoes.length && !acoes.includes('failed')) return null; // só atraso ("delayed") ou entregue
  if (!acoes.length && /delay|atrasad|will (retry|continue)|ainda tentando/i.test(assunto)) return null;

  const enderecos = [
    ...new Set(
      [...texto.matchAll(/^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/gim)].map((m) => m[1].toLowerCase()),
    ),
  ];
  const diag = campo(texto, 'Diagnostic-Code').replace(/^smtp;\s*/i, '');
  const status = campo(texto, 'Status');
  let motivo = diag || (status ? `código ${status}` : '');
  if (!motivo) {
    // primeira linha "explicativa" do corpo de mensagens de sistema
    const corpo = texto.slice(fimCab > 0 ? fimCab : 0);
    motivo =
      corpo
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /user unknown|does not exist|n[ãa]o existe|mailbox (is )?(full|unavailable)|caixa (postal )?cheia|rejected|recusad|not found|invalid|inv[áa]lid|quota/i.test(l)) ?? 'O servidor do cliente não entregou a mensagem.';
  }
  if (!enderecos.length) {
    for (const m of texto.matchAll(/<([^\s<>@]+@[^\s<>]+)>:/g)) enderecos.push(m[1].toLowerCase());
  }
  return { tipo: 'devolvido', messageIds: ids, quando, enderecos, motivo: traduzirMotivo(motivo) };
}

/** Explica os motivos mais comuns em português, mantendo o original. */
export function traduzirMotivo(m: string): string {
  const t = m.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/user unknown|does not exist|no such user|unknown user|recipient.*(not found|rejected)|address rejected|5\.1\.1|n[ãa]o existe/i.test(t)) return `E-mail não existe (${t})`;
  if (/mailbox (is )?full|quota|5\.2\.2|caixa (postal )?cheia|over quota/i.test(t)) return `Caixa do cliente cheia (${t})`;
  if (/spam|blocked|blacklist|policy|5\.7\./i.test(t)) return `Bloqueado pelo servidor do cliente (${t})`;
  if (/domain|host not found|5\.1\.2|nxdomain/i.test(t)) return `Domínio do e-mail não existe (${t})`;
  return t;
}

const ESTADO_UID = 'monitor.uid';
const ESTADO_VALIDADE = 'monitor.uidvalidity';
const ESTADO_ULTIMA = 'monitor.ultimaVerificacao';

export function monitorCaixa(db: Banco, repo: Repositorio, lerConta: () => ContaEmail | null, log: (m: string) => void = () => undefined) {
  const ler = (k: string) => (db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(k) as { valor: string } | undefined)?.valor ?? '';
  const gravar = (k: string, v: string) =>
    db
      .prepare('INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em')
      .run(k, v, new Date().toISOString());

  /** Aplica um evento aos envios correspondentes. Devolve quantos envios mudaram. */
  function aplicar(ev: Evento): number {
    type L = { id: string; numero: string; cliente_id: string | null; cliente_nome: string; para: string; cc: string; message_id: string; lido_em: string | null; devolvido_em: string | null; enviado_em: string };
    let alvos: L[] = [];
    if (ev.messageIds.length) {
      const q = db.prepare('SELECT * FROM envios WHERE lower(message_id) = ?');
      alvos = ev.messageIds.flatMap((id) => q.all(id) as L[]);
    }
    if (!alvos.length && ev.tipo === 'devolvido' && ev.enderecos.length) {
      // sem o ID original: o envio mais recente para esse endereço, até 10 dias antes da devolução
      const limite = new Date(new Date(ev.quando).getTime() - 10 * 86400_000).toISOString();
      const recentes = db.prepare("SELECT * FROM envios WHERE status != 'falhou' AND enviado_em >= ? AND enviado_em <= ? ORDER BY enviado_em DESC").all(limite, ev.quando) as L[];
      const achado = recentes.find((r) => [...JSON.parse(r.para), ...JSON.parse(r.cc)].some((e: string) => ev.enderecos.includes(e.toLowerCase())));
      if (achado) alvos = [achado];
    }
    let mudou = 0;
    for (const e of alvos) {
      if (ev.tipo === 'lido') {
        if (e.lido_em) continue;
        db.prepare("UPDATE envios SET lido_em = ?, lido_por = ?, status = 'lido' WHERE id = ?").run(ev.quando, ev.quem, e.id);
        repo.registrarLog(e.cliente_id ?? '', null, `${ev.quem || 'o cliente'} confirmou a leitura da fatura ${e.numero}`, null, null, 'cliente');
      } else {
        if (e.devolvido_em) continue;
        const quem = ev.enderecos.length ? ev.enderecos.join(', ') : 'um dos destinatários';
        const detalhe = `Voltou de ${quem}: ${ev.motivo}`;
        // se alguém já confirmou a leitura, a fatura chegou: continua "lido", mas guarda a devolução
        db.prepare("UPDATE envios SET devolvido_em = ?, devolucao = ?, status = CASE WHEN lido_em IS NULL THEN 'devolvido' ELSE status END WHERE id = ?").run(ev.quando, detalhe, e.id);
        repo.registrarLog(e.cliente_id ?? '', null, `a fatura ${e.numero} voltou (não entregue) de ${quem}`, null, null, 'cliente');
      }
      mudou++;
    }
    return mudou;
  }

  let rodando = false;

  /** Lê as mensagens novas da caixa de entrada. */
  async function verificar(): Promise<{ lidas: number; atualizados: number; erro?: string }> {
    const conta = lerConta();
    if (!conta) return { lidas: 0, atualizados: 0, erro: 'O e-mail da empresa ainda não foi configurado no servidor.' };
    if (rodando) return { lidas: 0, atualizados: 0 };
    rodando = true;
    let lidas = 0;
    let atualizados = 0;
    let erro: string | undefined;
    try {
      // mesma fila da gravação em Enviados: nunca duas conexões ao mesmo tempo
      await naFilaImap(async () => {
        const c = new ImapFlow({
          host: conta.imapHost,
          port: conta.imapPorta,
          secure: true,
          auth: { user: conta.usuario, pass: conta.senha },
          logger: false,
          socketTimeout: 60_000,
          connectionTimeout: 20_000,
          greetingTimeout: 20_000,
        });
        semQuedas(c);
        try {
          await comPrazo(
            (async () => {
              await c.connect();
              const trava = await c.getMailboxLock('INBOX', { readOnly: true });
              try {
                const caixa = c.mailbox && typeof c.mailbox === 'object' ? c.mailbox : null;
                const validade = String(caixa?.uidValidity ?? '');
                let desde = Number(ler(ESTADO_UID) || 0);
                if (ler(ESTADO_VALIDADE) !== validade) desde = 0;
                // primeira vez: só as mensagens dos últimos 3 dias
                const busca = desde ? { uid: `${desde + 1}:*` } : { since: new Date(Date.now() - 3 * 86400_000) };
                const uids = ((await c.search(busca, { uid: true })) || []).filter((u) => u > desde);
                // 1) cabeçalhos de todas de uma vez; 2) baixa só as que podem ser resposta automática
                const candidatos: number[] = [];
                if (uids.length) {
                  for await (const m of c.fetch(uids.join(','), { envelope: true, size: true, uid: true }, { uid: true })) {
                    const assunto = m.envelope?.subject ?? '';
                    const de = (m.envelope?.from ?? []).map((f) => `${f.name ?? ''} ${f.address ?? ''}`).join(' ');
                    const candidato = RE_REMETENTE_SISTEMA.test(de) || RE_ASSUNTO_DEVOLUCAO.test(assunto) || RE_ASSUNTO_LEITURA.test(assunto) || /lid[ao]:|read:|notifica/i.test(assunto);
                    if (candidato && (m.size ?? 0) <= 3_000_000) candidatos.push(m.uid);
                  }
                }
                gravar(ESTADO_VALIDADE, validade);
                for (const uid of candidatos.sort((x, y) => x - y)) {
                  const completo = await c.fetchOne(String(uid), { source: true }, { uid: true });
                  if (completo && completo.source) {
                    lidas++;
                    const ev = interpretar(completo.source.toString('utf8'));
                    if (ev) atualizados += aplicar(ev);
                  }
                  gravar(ESTADO_UID, String(uid)); // guarda o progresso a cada mensagem
                }
                if (uids.length) gravar(ESTADO_UID, String(Math.max(desde, ...uids)));
              } finally {
                trava.release();
              }
            })(),
            150_000,
            'Ler a caixa de entrada',
            () => c.close(),
          );
          gravar(ESTADO_ULTIMA, new Date().toISOString());
        } finally {
          void comPrazo(c.logout(), 5_000, 'logout', () => c.close()).catch(() => c.close());
        }
      });
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      log('monitor da caixa: ' + erro);
    } finally {
      rodando = false;
    }
    return { lidas, atualizados, erro };
  }

  return {
    aplicar,
    verificar,
    ultimaVerificacao: () => ler(ESTADO_ULTIMA) || null,
    /** Verifica agora e depois a cada `minutos`. */
    iniciar(minutos = 5) {
      setTimeout(() => void verificar(), 20_000);
      const t = setInterval(() => void verificar(), minutos * 60_000);
      t.unref();
      return () => clearInterval(t);
    },
  };
}
