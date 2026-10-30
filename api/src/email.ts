import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ImapFlow } from 'imapflow';

/*
 * Envio pelo e-mail da empresa (UOL Mail Pro):
 *  1. monta a mensagem completa UMA vez (com Message-ID nosso)
 *  2. envia esses mesmos bytes pelo SMTP
 *  3. grava esses mesmos bytes na pasta Enviados pelo IMAP
 * Assim a cópia em Enviados é idêntica ao que o cliente recebeu.
 */

export type ContaEmail = {
  usuario: string;
  senha: string;
  nomeRemetente: string;
  smtpHost: string;
  smtpPorta: number;
  imapHost: string;
  imapPorta: number;
};

export const CONTA_PADRAO = {
  smtpHost: process.env.SMTP_HOST ?? 'smtps.uhserver.com',
  smtpPorta: Number(process.env.SMTP_PORTA ?? 465),
  imapHost: process.env.IMAP_HOST ?? 'imap.uhserver.com',
  imapPorta: Number(process.env.IMAP_PORTA ?? 993),
  nomeRemetente: process.env.REMETENTE_NOME ?? 'Financeiro · Lucminas Empilhadeiras',
};

export type Mensagem = {
  para: string[];
  cc: string[];
  assunto: string;
  texto: string;
  anexos: { nome: string; conteudo: Buffer }[];
  pedirLeitura: boolean;
  /** Cabeçalhos extras (ex.: X-Lucminas-Fatura) para reconhecer devoluções depois. */
  cabecalhos?: Record<string, string>;
  /** para remontar uma mensagem já enviada (mesmo identificador e data) */
  messageId?: string;
  data?: Date;
};

export async function montar(conta: ContaEmail, m: Mensagem): Promise<{ bruto: Buffer; messageId: string }> {
  const dominio = conta.usuario.split('@')[1] ?? 'localhost';
  const messageId = m.messageId ?? `<${randomUUID()}@${dominio}>`;
  const cabecalhos: Record<string, string> = { ...(m.cabecalhos ?? {}) };
  if (m.pedirLeitura) {
    cabecalhos['Disposition-Notification-To'] = conta.usuario;
    cabecalhos['Return-Receipt-To'] = conta.usuario;
  }
  const composer = new MailComposer({
    from: { name: conta.nomeRemetente, address: conta.usuario },
    to: m.para,
    cc: m.cc.length ? m.cc : undefined,
    subject: m.assunto,
    text: m.texto,
    messageId,
    date: m.data ?? new Date(),
    headers: cabecalhos,
    attachments: m.anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: 'application/pdf' })),
  });
  const bruto = await new Promise<Buffer>((ok, erro) => composer.compile().build((e, b) => (e ? erro(e) : ok(b))));
  return { bruto, messageId };
}

export type ResultadoSmtp = { aceitos: string[]; recusados: string[]; resposta: string };

export async function enviarSmtp(conta: ContaEmail, bruto: Buffer, destinatarios: string[]): Promise<ResultadoSmtp> {
  const t = nodemailer.createTransport({
    host: conta.smtpHost,
    port: conta.smtpPorta,
    secure: conta.smtpPorta === 465,
    auth: { user: conta.usuario, pass: conta.senha },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  try {
    const info = await comPrazo(t.sendMail({ envelope: { from: conta.usuario, to: destinatarios }, raw: bruto }), 120_000, 'Envio (SMTP)', () => t.close());
    return {
      aceitos: (info.accepted as (string | { address: string })[]).map((x) => (typeof x === 'string' ? x : x.address)),
      recusados: (info.rejected as (string | { address: string })[]).map((x) => (typeof x === 'string' ? x : x.address)),
      resposta: info.response,
    };
  } finally {
    t.close();
  }
}

/** Rejeita se a operação passar do prazo (e chama `aoEstourar` para fechar a conexão). */
export function comPrazo<T>(p: Promise<T>, ms: number, oQue: string, aoEstourar?: () => void): Promise<T> {
  let t: NodeJS.Timeout;
  const prazo = new Promise<never>((_, erro) => {
    t = setTimeout(() => {
      aoEstourar?.();
      erro(new Error(`${oQue}: o servidor de e-mail não respondeu em ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(t));
}

/**
 * Uma conexão IMAP por vez para a conta (o UOL pode limitar conexões simultâneas):
 * gravar em Enviados e ler a caixa de entrada esperam um ao outro.
 */
let filaImap: Promise<unknown> = Promise.resolve();
export function naFilaImap<T>(f: () => Promise<T>): Promise<T> {
  const r = filaImap.then(f, f);
  filaImap = r.catch(() => undefined);
  return r;
}

const NOMES_ENVIADOS = /^(sent|sent items|sent messages|sent mail|enviados|enviadas|itens enviados|mensagens enviadas)$/i;

function conectarImap(conta: ContaEmail) {
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
  return c;
}

/**
 * A biblioteca de IMAP avisa queda/tempo esgotado como evento 'error'. Sem quem escute,
 * o Node derruba o servidor inteiro. Aqui o erro só fecha aquela conexão.
 */
export function semQuedas(c: ImapFlow) {
  // só registra: quando o erro é grave, a própria biblioteca fecha a conexão
  c.on('error', (e: Error) => {
    (c as unknown as { ultimoErro?: string }).ultimoErro = e?.message ?? String(e);
  });
  return c;
}

/** Mensagem de erro do IMAP com o que o servidor respondeu (ajuda a entender falhas). */
export function erroImap(e: unknown, c?: ImapFlow): string {
  const x = e as { message?: string; responseText?: string; responseStatus?: string; code?: string };
  const partes = [x?.message ?? String(e)];
  if (x?.responseStatus || x?.responseText) partes.push(`resposta do servidor: ${[x.responseStatus, x.responseText].filter(Boolean).join(' ')}`);
  if (x?.code) partes.push(`código ${x.code}`);
  const anterior = c ? (c as unknown as { ultimoErro?: string }).ultimoErro : undefined;
  if (anterior && anterior !== x?.message) partes.push(`antes: ${anterior}`);
  return partes.join('; ');
}

/** Fecha sem esperar resposta (logout pode ficar pendurado se o servidor não responder). */
function fechar(c: ImapFlow) {
  void comPrazo(c.logout(), 5_000, 'logout', () => c.close()).catch(() => c.close());
}

export async function listarPastas(conta: ContaEmail): Promise<{ caminho: string; especial: string }[]> {
  return naFilaImap(async () => {
    const c = conectarImap(conta);
    try {
      return await comPrazo(
        (async () => {
          await c.connect();
          return (await c.list()).map((b) => ({ caminho: b.path, especial: b.specialUse ?? '' }));
        })(),
        45_000,
        'Listar pastas',
        () => c.close(),
      );
    } finally {
      fechar(c);
    }
  });
}

/** Grava a mensagem na pasta Enviados (descoberta pelo marcador \Sent ou pelo nome). Devolve o nome da pasta. */
/** Grava em Enviados, tentando até 3 vezes (conexão nova a cada tentativa). */
export async function salvarEmEnviados(conta: ContaEmail, bruto: Buffer): Promise<string> {
  const erros: string[] = [];
  for (const espera of [0, 3_000, 10_000]) {
    if (espera) await new Promise((ok) => setTimeout(ok, espera));
    try {
      return await gravarUmaVez(conta, bruto);
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`3 tentativas: ${[...new Set(erros)].join(' | ')}`);
}

function gravarUmaVez(conta: ContaEmail, bruto: Buffer): Promise<string> {
  return naFilaImap(async () => {
    const c = conectarImap(conta);
    try {
      return await comPrazo(
        (async () => {
          await c.connect();
          const caixas = await c.list();
          const pasta =
            process.env.IMAP_PASTA_ENVIADOS ??
            (caixas.find((b) => b.specialUse === '\\Sent') ?? caixas.find((b) => NOMES_ENVIADOS.test(b.name)))?.path;
          if (!pasta) throw new Error('Pasta Enviados não encontrada. Pastas existentes: ' + caixas.map((b) => b.path).join(', '));
          await c.append(pasta, bruto, ['\\Seen'], new Date());
          return pasta;
        })(),
        90_000,
        'Gravar em Enviados',
        () => c.close(),
      ).catch((e) => {
        throw new Error(erroImap(e, c));
      });
    } finally {
      fechar(c);
    }
  });
}

/** PDF mínimo de uma página, para testes. */
export function pdfDeTeste(titulo: string): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const conteudo = `BT /F1 18 Tf 60 770 Td (${esc(titulo)}) Tj /F1 11 Tf 0 -24 Td (Arquivo de teste do sistema de envio de faturas.) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let s = '%PDF-1.4\n';
  const pos: number[] = [];
  objs.forEach((o, i) => {
    pos.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
