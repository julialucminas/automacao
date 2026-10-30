import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Banco, Cliente, Envio, Repositorio } from './db.js';
import { CONTA_PADRAO, enviarSmtp, montar, salvarEmEnviados, type ContaEmail, type ResultadoSmtp } from './email.js';

/*
 * Envio real das faturas pelo e-mail da empresa.
 * A senha do e-mail fica só no servidor, num arquivo legível apenas pelo sistema
 * (gravado pelo comando configurar-email). Nunca passa pelo navegador.
 */

const ARQ_CONTA = 'email-conta.json';

export function lerConta(pastaDados: string): ContaEmail | null {
  const arq = join(pastaDados, ARQ_CONTA);
  if (!existsSync(arq)) return null;
  try {
    const j = JSON.parse(readFileSync(arq, 'utf8')) as { usuario?: string; senha?: string };
    if (!j.usuario || !j.senha) return null;
    return { ...CONTA_PADRAO, usuario: j.usuario, senha: j.senha };
  } catch {
    return null;
  }
}

export function salvarConta(pastaDados: string, usuario: string, senha: string) {
  mkdirSync(pastaDados, { recursive: true });
  const arq = join(pastaDados, ARQ_CONTA);
  writeFileSync(arq, JSON.stringify({ usuario, senha }), { mode: 0o600 });
  chmodSync(arq, 0o600);
}

/** Quem efetivamente manda e guarda o e-mail (trocado por um falso nos testes). */
export type Carteiro = {
  enviar(conta: ContaEmail, bruto: Buffer, destinatarios: string[]): Promise<ResultadoSmtp>;
  salvarEnviados(conta: ContaEmail, bruto: Buffer): Promise<string>;
};
export const carteiroReal: Carteiro = { enviar: enviarSmtp, salvarEnviados: salvarEmEnviados };

export type Anexo = { nome: string; conteudo: Buffer };

export type PedidoEnvio = {
  referencia: string;
  numero: string;
  cliente: Cliente;
  assunto: string;
  corpo: string;
  anexos: Anexo[];
  pediuLeitura: boolean;
  observacao: string;
  /** data do Calendário a marcar como faturada (AAAA-MM-DD), se houver */
  dataFaturamento: string | null;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tradução dos erros mais comuns do SMTP para algo que a pessoa entenda. */
export function explicarErro(e: unknown): string {
  const m = msg(e);
  if (/auth|535|credentials|password|senha/i.test(m)) return 'O UOL recusou a senha do e-mail da empresa. A senha pode ter sido trocada: é preciso configurar de novo no servidor.';
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|timeout/i.test(m)) return 'Não conseguiu falar com o servidor de e-mail do UOL agora. Tente de novo em alguns minutos.';
  if (/55[0-4]|recipient|mailbox/i.test(m)) return `O servidor de e-mail recusou um destinatário: ${m}`;
  return `Falha no envio: ${m}`;
}

export function servicoEnvio(db: Banco, repo: Repositorio, pastaDados: string, carteiro: Carteiro) {
  const pastaEnvio = (id: string) => join(pastaDados, 'envios', id);

  function gravar(e: Envio, corpo: string, usuarioId: number) {
    db.prepare(
      `INSERT INTO envios (id, enviado_em, referencia, numero, cliente_id, cliente_nome, para, cc, assunto, anexos, message_id,
         copia_em_enviados, pediu_leitura, status, detalhe, observacao, enviado_por, corpo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      e.id,
      e.enviadoEm,
      e.referencia,
      e.numero,
      e.clienteId,
      e.clienteNome,
      JSON.stringify(e.para),
      JSON.stringify(e.cc),
      e.assunto,
      JSON.stringify(e.anexos),
      e.messageId,
      e.copiaEmEnviados ? 1 : 0,
      e.pediuLeitura ? 1 : 0,
      e.status,
      e.detalhe,
      e.observacao,
      usuarioId,
      corpo,
    );
  }

  /** Monta, envia pelo SMTP e grava a cópia em Enviados. Não lança erro de envio: devolve o resultado. */
  async function despachar(conta: ContaEmail, nomeRemetente: string, para: string[], cc: string[], assunto: string, corpo: string, anexos: Anexo[], pediuLeitura: boolean, numero: string) {
    const c = { ...conta, nomeRemetente: nomeRemetente || conta.nomeRemetente };
    const { bruto, messageId } = await montar(c, { para, cc, assunto, texto: corpo, anexos, pedirLeitura: pediuLeitura, cabecalhos: { 'X-Lucminas-Fatura': numero } });
    try {
      const r = await carteiro.enviar(c, bruto, [...para, ...cc]);
      if (!r.aceitos.length) return { ok: false as const, messageId, copia: false, detalhe: `O servidor de e-mail não aceitou nenhum destinatário (${r.recusados.join(', ')}).` };
      let copia = false;
      let detalhe = r.recusados.length ? `Recusados pelo servidor: ${r.recusados.join(', ')}. ` : '';
      try {
        const pasta = await carteiro.salvarEnviados(c, bruto);
        copia = true;
        detalhe += `Enviado e guardado em "${pasta}".`;
      } catch (e) {
        detalhe += `Enviado, mas não conseguiu guardar a cópia em Enviados (${msg(e)}).`;
      }
      return { ok: true as const, messageId, copia, detalhe };
    } catch (e) {
      return { ok: false as const, messageId, copia: false, detalhe: explicarErro(e) };
    }
  }

  return {
    configurado: () => lerConta(pastaDados) !== null,
    contaUsuario: () => lerConta(pastaDados)?.usuario ?? null,

    /** Envio de verdade para o cliente: registra no Histórico, guarda os PDFs e marca faturado. */
    async enviar(p: PedidoEnvio, nomeRemetente: string, usuarioId: number): Promise<Envio> {
      const conta = lerConta(pastaDados);
      if (!conta) throw new Error('SEM_CONTA');
      const r = await despachar(conta, nomeRemetente, p.cliente.para, p.cliente.cc, p.assunto, p.corpo, p.anexos, p.pediuLeitura, p.numero);
      const e: Envio = {
        id: randomUUID(),
        enviadoEm: new Date().toISOString(),
        referencia: p.referencia,
        numero: p.numero,
        clienteId: p.cliente.id,
        clienteNome: p.cliente.nome,
        para: p.cliente.para,
        cc: p.cliente.cc,
        assunto: p.assunto,
        anexos: p.anexos.map((a) => a.nome),
        messageId: r.messageId,
        copiaEmEnviados: r.copia,
        pediuLeitura: p.pediuLeitura,
        status: r.ok ? 'enviado' : 'falhou',
        detalhe: r.detalhe,
        observacao: p.observacao,
      };
      db.transaction(() => {
        gravar(e, p.corpo, usuarioId);
        repo.registrarLog(p.cliente.id, usuarioId, r.ok ? `enviou a fatura ${p.numero} para ${[...e.para, ...e.cc].join(', ')}` : `tentou enviar a fatura ${p.numero} (falhou)`, null, null, 'cliente');
        if (r.ok && p.dataFaturamento) repo.marcarFaturado(p.cliente.id, p.dataFaturamento, usuarioId, 'envio');
      })();
      // os PDFs ficam guardados no servidor (prova do que foi enviado e permite reenviar)
      try {
        const pasta = pastaEnvio(e.id);
        mkdirSync(pasta, { recursive: true });
        for (const a of p.anexos) writeFileSync(join(pasta, a.nome.replace(/[/\\]/g, '_')), a.conteudo);
      } catch {
        /* sem espaço/permissão: o envio já foi feito e registrado */
      }
      return e;
    },

    /** Reenvia um envio antigo com os e-mails ATUAIS do cadastro e os mesmos PDFs. */
    async reenviar(envioId: string, nomeRemetente: string, usuarioId: number): Promise<Envio> {
      const conta = lerConta(pastaDados);
      if (!conta) throw new Error('SEM_CONTA');
      const r0 = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown> | undefined;
      if (!r0) throw new Error('NAO_ACHOU');
      const pasta = pastaEnvio(envioId);
      if (!existsSync(pasta)) throw new Error('SEM_ARQUIVOS');
      const anexos = readdirSync(pasta).sort((a, b) => (a.startsWith('BOLETO') ? 1 : 0) - (b.startsWith('BOLETO') ? 1 : 0)).map((nome) => ({ nome, conteudo: readFileSync(join(pasta, nome)) }));
      const cliente = repo.buscarCliente(r0.cliente_id as string);
      if (!cliente.para.length) throw new Error('SEM_EMAIL');
      return this.enviar(
        {
          referencia: r0.referencia as string,
          numero: r0.numero as string,
          cliente,
          assunto: r0.assunto as string,
          corpo: (r0.corpo as string) || '',
          anexos,
          pediuLeitura: !!r0.pediu_leitura,
          observacao: r0.observacao as string,
          dataFaturamento: null,
        },
        nomeRemetente,
        usuarioId,
      );
    },

    /** Teste: manda a fatura só para quem está logado. Não registra nem marca faturado. */
    async testar(para: string, assunto: string, corpo: string, anexos: Anexo[], nomeRemetente: string, numero: string) {
      const conta = lerConta(pastaDados);
      if (!conta) throw new Error('SEM_CONTA');
      const aviso =
        '[TESTE — este e-mail foi enviado só para você. No envio de verdade, vai para os e-mails do cadastro do cliente.]\n\n';
      const r = await despachar(conta, nomeRemetente, [para], [], `[TESTE] ${assunto}`, aviso + corpo, anexos, false, numero);
      return { ok: r.ok, para, copiaEmEnviados: r.copia, detalhe: r.detalhe };
    },

    jaEnviada(referencia: string, numero: string): Envio | null {
      return repo.listarEnvios().find((e) => e.referencia === referencia && e.numero === numero && e.status === 'enviado') ?? null;
    },
  };
}
