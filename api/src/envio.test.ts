import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';
import { lerConta, salvarConta, type Carteiro } from './envio.js';
import { pdfDeTeste } from './email.js';

let app: ReturnType<typeof criarApp>;
let cookie = '';
let pasta = '';
let enviados: { para: string[]; bruto: string }[] = [];
let guardados = 0;
let falharSmtp: Error | null = null;
let travarImap = false;
let falharImap = 0;

const carteiro: Carteiro = {
  async enviar(_c, bruto, dest) {
    if (falharSmtp) throw falharSmtp;
    enviados.push({ para: dest, bruto: bruto.toString('utf8') });
    return { aceitos: dest, recusados: [], resposta: '250 OK' };
  },
  async salvarEnviados() {
    if (travarImap) await new Promise(() => undefined); // UOL não responde nunca
    if (falharImap > 0) {
      falharImap--;
      throw new Error('Connection not available');
    }
    guardados++;
    return 'Itens Enviados';
  },
};

const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie } });
const pdf = (t: string) => pdfDeTeste(t).toString('base64');

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'faturas-'));
  enviados = [];
  guardados = 0;
  falharSmtp = null;
  travarImap = false;
  falharImap = 0;
  const db = abrirBanco(':memory:');
  repositorio(db).criarUsuario('lucminas@lucminas.com.br', 'Angelise', await gerarHash('senha-angeli'), 'Angeli');
  app = criarApp(db, { cookieSeguro: false, pastaDados: pasta, carteiro, esperaCopiaMs: 300 });
  const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'lucminas@lucminas.com.br', senha: 'senha-angeli' } });
  cookie = String(r.headers['set-cookie']).split(';')[0];
});

const pedido = (clienteId: string, extra: object = {}) => ({
  referencia: '2026-10',
  numero: '1234',
  clienteId,
  assunto: 'Fatura de locação nº 1234',
  corpo: 'Prezados,\nSegue a fatura.',
  anexos: [
    { nome: '1234 MINASBEV.PDF', base64: pdf('FATURA') },
    { nome: 'BOLETO 1234.PDF', base64: pdf('BOLETO') },
  ],
  pediuLeitura: true,
  observacao: '',
  dataFaturamento: '2026-10-05',
  ...extra,
});

describe('envio de verdade', () => {
  it('sem senha configurada não envia nada', async () => {
    const r = await req('POST', '/api/envios', pedido('x'));
    expect(r.statusCode).toBe(503);
    expect((await req('GET', '/api/envio/situacao')).json()).toEqual({ configurado: false, conta: null, ultimaVerificacao: null });
    expect(enviados).toHaveLength(0);
  });

  it('senha guardada só para o sistema ler', () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    expect(statSync(join(pasta, 'email-conta.json')).mode & 0o777).toBe(0o600);
    expect(lerConta(pasta)).toMatchObject({ usuario: 'financeiro@lucminas.com.br', senha: 'segredo', smtpHost: 'smtps.uhserver.com' });
  });

  it('envia para os e-mails do cadastro, guarda em Enviados, registra, marca faturado e guarda os PDFs', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    await req('PUT', '/api/config', { 'email.remetente': 'Financeiro Lucminas' });
    const c = (await req('POST', '/api/clientes', { nome: 'MINASBEV', para: ['fin@minasbev.com'], cc: ['contador@x.com'], diaEmissao: 5 })).json();
    const r = await req('POST', '/api/envios', pedido(c.id));
    expect(r.statusCode).toBe(200);
    const e = r.json();
    expect(e).toMatchObject({ status: 'enviado', para: ['fin@minasbev.com'], cc: ['contador@x.com'], copiaEmEnviados: true, anexos: ['1234 MINASBEV.PDF', 'BOLETO 1234.PDF'] });
    expect(enviados[0].para).toEqual(['fin@minasbev.com', 'contador@x.com']);
    expect(enviados[0].bruto).toMatch(/From: Financeiro Lucminas <financeiro@lucminas\.com\.br>/);
    expect(enviados[0].bruto).toMatch(/Disposition-Notification-To/);
    expect(guardados).toBe(1);
    expect((await req('GET', '/api/envios')).json()).toHaveLength(1);
    expect((await req('GET', '/api/faturamentos?de=2026-10-01&ate=2026-10-31')).json()).toEqual([expect.objectContaining({ clienteId: c.id, data: '2026-10-05', origem: 'envio' })]);
    expect(readdirSync(join(pasta, 'envios', e.id)).sort()).toEqual(['1234 MINASBEV.PDF', 'BOLETO 1234.PDF', 'mensagem.eml']);

    // não manda a mesma fatura duas vezes sem querer
    const dup = await req('POST', '/api/envios', pedido(c.id));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toMatch(/já foi enviada/);

    // reenviar usa os e-mails atuais do cadastro e os mesmos PDFs
    await req('PUT', `/api/clientes/${c.id}`, { ...c, para: ['novo@minasbev.com'], cc: [] });
    const re = await req('POST', `/api/envios/${e.id}/reenviar`);
    expect(re.json()).toMatchObject({ status: 'enviado', para: ['novo@minasbev.com'] });
    expect(enviados[1].para).toEqual(['novo@minasbev.com']);
    expect(enviados[1].bruto).toMatch(/BOLETO 1234\.PDF/);
  });

  it('falha no SMTP fica registrada como falhou, sem marcar faturado', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'errada');
    falharSmtp = new Error('Invalid login: 535 authentication failed');
    const c = (await req('POST', '/api/clientes', { nome: 'MINASBEV', para: ['fin@minasbev.com'] })).json();
    const e = (await req('POST', '/api/envios', pedido(c.id))).json();
    expect(e.status).toBe('falhou');
    expect(e.detalhe).toMatch(/recusou a senha/);
    expect((await req('GET', '/api/faturamentos?de=2026-10-01&ate=2026-10-31')).json()).toEqual([]);
  });

  it('teste vai só para quem está logado e não registra nada', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    const c = (await req('POST', '/api/clientes', { nome: 'MINASBEV', para: ['fin@minasbev.com'] })).json();
    const r = (await req('POST', '/api/envios/teste', pedido(c.id, { assunto: 'Fatura 1234' }))).json();
    expect(r).toMatchObject({ ok: true, para: 'lucminas@lucminas.com.br', copiaEmEnviados: true });
    expect(enviados[0].para).toEqual(['lucminas@lucminas.com.br']);
    expect(enviados[0].bruto).toMatch(/Subject: \[TESTE\]/);
    expect((await req('GET', '/api/envios')).json()).toEqual([]);
    expect(existsSync(join(pasta, 'envios'))).toBe(false);
  });

  it('recusa anexo que não é PDF e cliente sem e-mail', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    const c = (await req('POST', '/api/clientes', { nome: 'PANEX', para: [] })).json();
    expect((await req('POST', '/api/envios', pedido(c.id))).json().erro).toMatch(/não tem e-mail/);
    const r = await req('POST', '/api/envios/teste', pedido(c.id, { anexos: [{ nome: 'x.pdf', base64: Buffer.from('oi').toString('base64') }] }));
    expect(r.json().erro).toMatch(/não parece ser um PDF/);
    expect(enviados).toHaveLength(0);
  });

  it('se o UOL não responder na cópia em Enviados, o envio responde e fica registrado mesmo assim', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    travarImap = true;
    const c = (await req('POST', '/api/clientes', { nome: 'MINASBEV', para: ['fin@minasbev.com'] })).json();
    const e = (await req('POST', '/api/envios', pedido(c.id))).json();
    expect(e).toMatchObject({ status: 'enviado', copiaEmEnviados: false, detalhe: expect.stringMatching(/guardando a cópia/) });
    expect((await req('GET', '/api/envios')).json()).toHaveLength(1);
    expect((await req('POST', '/api/envios/teste', pedido(c.id))).json()).toMatchObject({ ok: true, copiaEmEnviados: false });
  });

  it('se a cópia falhar, dá para gravar depois (mensagem guardada; envio antigo é remontado)', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    const c = (await req('POST', '/api/clientes', { nome: 'MINASBEV', para: ['fin@minasbev.com'] })).json();
    falharImap = 1;
    const e = (await req('POST', '/api/envios', pedido(c.id))).json();
    expect(e.copiaEmEnviados).toBe(false);
    expect(readdirSync(join(pasta, 'envios', e.id))).toContain('mensagem.eml');
    const d = (await req('POST', `/api/envios/${e.id}/copiar`)).json();
    expect(d).toMatchObject({ copiaEmEnviados: true, detalhe: expect.stringMatching(/guardado em "Itens Enviados"/) });

    // envio feito antes de guardar a mensagem: remonta com os PDFs e o mesmo identificador
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(pasta, 'envios', e.id, 'mensagem.eml'));
    const antes = guardados;
    expect((await req('POST', `/api/envios/${e.id}/copiar`)).json().copiaEmEnviados).toBe(true);
    expect(guardados).toBe(antes + 1);
  });
});
