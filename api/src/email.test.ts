import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error sem tipos
import { SMTPServer } from 'smtp-server';
import { enviarSmtp, montar, pdfDeTeste, type ContaEmail } from './email.js';

// servidor SMTP falso, local, só para o teste
let recebido = '';
let envelopeDestinos: string[] = [];
let usuarioLogado = '';
const servidor = new SMTPServer({
  secure: false,
  authOptional: false,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth(auth: { username: string; password: string }, _s: unknown, cb: (e: Error | null, r?: { user: string }) => void) {
    if (auth.password !== 'certa') return cb(new Error('senha errada'));
    usuarioLogado = auth.username;
    cb(null, { user: auth.username });
  },
  onRcptTo(addr: { address: string }, _s: unknown, cb: (e?: Error) => void) {
    if (addr.address.startsWith('naoexiste@')) return cb(new Error('Mailbox unavailable'));
    envelopeDestinos.push(addr.address);
    cb();
  },
  onData(stream: NodeJS.ReadableStream, _s: unknown, cb: () => void) {
    let d = '';
    stream.on('data', (c: Buffer) => (d += c.toString()));
    stream.on('end', () => {
      recebido = d;
      cb();
    });
  },
});

let porta = 0;
beforeAll(async () => {
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  porta = servidor.server.address().port;
});
afterAll(() => new Promise<void>((ok) => servidor.close(ok)));

const conta = (senha = 'certa'): ContaEmail => ({
  usuario: 'financeiro@lucminas.com.br',
  senha,
  nomeRemetente: 'Financeiro · Lucminas',
  smtpHost: '127.0.0.1',
  smtpPorta: porta,
  imapHost: '',
  imapPorta: 0,
});

describe('envio SMTP', () => {
  it('monta com anexos, pedido de leitura e cabeçalho próprio, e envia os mesmos bytes', async () => {
    envelopeDestinos = [];
    const { bruto, messageId } = await montar(conta(), {
      para: ['a@cliente.com'],
      cc: ['b@cliente.com'],
      assunto: 'Fatura de locação nº 1234',
      texto: 'Segue a fatura.',
      anexos: [
        { nome: '1234 EMPRESA.PDF', conteudo: pdfDeTeste('Fatura') },
        { nome: 'BOLETO 1234.PDF', conteudo: pdfDeTeste('Boleto') },
      ],
      pedirLeitura: true,
      cabecalhos: { 'X-Lucminas-Fatura': '1234' },
    });
    expect(messageId).toMatch(/^<.+@lucminas\.com\.br>$/);
    const txt = bruto.toString();
    expect(txt).toContain('Disposition-Notification-To: financeiro@lucminas.com.br');
    expect(txt).toContain('X-Lucminas-Fatura: 1234');
    expect(txt).toContain('filename="BOLETO 1234.PDF"');

    const r = await enviarSmtp(conta(), bruto, ['a@cliente.com', 'b@cliente.com']);
    expect(r.aceitos).toEqual(['a@cliente.com', 'b@cliente.com']);
    expect(usuarioLogado).toBe('financeiro@lucminas.com.br');
    expect(envelopeDestinos).toEqual(['a@cliente.com', 'b@cliente.com']);
    expect(recebido).toContain(`Message-ID: ${messageId}`);
  });

  it('separa destinatário recusado', async () => {
    const { bruto } = await montar(conta(), { para: ['ok@x.com', 'naoexiste@x.com'], cc: [], assunto: 't', texto: 't', anexos: [], pedirLeitura: false });
    const r = await enviarSmtp(conta(), bruto, ['ok@x.com', 'naoexiste@x.com']);
    expect(r.aceitos).toEqual(['ok@x.com']);
    expect(r.recusados).toEqual(['naoexiste@x.com']);
  });

  it('falha com senha errada', async () => {
    const { bruto } = await montar(conta(), { para: ['ok@x.com'], cc: [], assunto: 't', texto: 't', anexos: [], pedirLeitura: false });
    await expect(enviarSmtp(conta('errada'), bruto, ['ok@x.com'])).rejects.toThrow();
  });
});
