import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
let pasta = '';
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });
const b64 = (s: string) => Buffer.from(s).toString('base64');
const PDF = b64('%PDF-1.4\n% danfe de teste\n');
const XML = b64('<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><ide><nNF>4521</nNF></ide></infNFe></NFe></nfeProc>');

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'nfe-'));
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('financeiro@lucminas.com.br', 'Angelise', h, '', 'financeiro');
  repo.criarUsuario('tecnico@lucminas.com.br', 'Fabrício', h, '', 'tecnico');
  app = criarApp(db, { cookieSeguro: false, pastaDados: pasta });
  for (const [k, e] of [
    ['angelise', 'financeiro@lucminas.com.br'],
    ['tecnico', 'tecnico@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

describe('NF-e na compra e venda', () => {
  it('anexa PDF, troca por XML, abre e tira; recusa outros tipos e outras movimentações', async () => {
    const a = como('angelise');
    const compra = (await a('POST', '/api/movimentacoes', { tipo: 'compra', frota: '121', data: '2026-11-10', descricao: 'YALE GLP050VX', clienteNome: 'TRADIMAQ' })).json();
    expect((await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: b64('olá'), nome: 'x.txt' })).statusCode).toBe(400);

    let r = await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: PDF, nome: 'DANFE 4521.pdf' });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.nfArquivo).toMatchObject({ ext: 'pdf', nome: 'DANFE 4521.pdf', porNome: 'Angelise' });
    r = await a('GET', `/api/movimentacoes/${compra.id}/nfe`);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.startsWith('%PDF-')).toBe(true);

    // técnico não vê movimentações
    expect((await como('tecnico')('GET', `/api/movimentacoes/${compra.id}/nfe`)).statusCode).toBe(403);

    // troca pelo XML: o PDF antigo some
    r = await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: XML, nome: 'nfe.xml' });
    expect(r.json().dados.nfArquivo.ext).toBe('xml');
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.pdf`))).toBe(false);
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.xml`))).toBe(true);
    // a ficha/compra continua igual
    expect((await a('GET', '/api/movimentacoes')).json()[0].dados.nfArquivo.nome).toBe('nfe.xml');

    r = await a('DELETE', `/api/movimentacoes/${compra.id}/nfe`);
    expect(r.json().dados.nfArquivo).toBeNull();
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.xml`))).toBe(false);
    expect((await a('GET', `/api/movimentacoes/${compra.id}/nfe`)).statusCode).toBe(404);

    // só compra e venda
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '121', data: '2026-11-12', clienteNome: 'TESTE' })).json();
    r = await a('POST', `/api/movimentacoes/${loc.id}/nfe`, { arquivo: PDF, nome: 'a.pdf' });
    expect(r.statusCode).toBe(409);
    expect(existsSync(join(pasta, 'nfe', `${loc.id}.pdf`))).toBe(false);
    expect((await a('POST', '/api/movimentacoes/../../x/nfe', { arquivo: PDF })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('observações depois de lançada', () => {
  it('acrescenta observação (normal ou urgente), guarda quem e quando; técnico não pode', async () => {
    const a = como('angelise');
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '50', data: '2026-11-12', clienteNome: 'TESTE', observacoes: 'original' })).json();
    expect((await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: '  ' })).statusCode).toBe(400);
    let r = await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'cliente pediu nota fiscal separada' });
    r = await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'faltou o gás', urgente: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.observacoes).toBe('original');
    expect(r.json().dados.notas).toMatchObject([
      { texto: 'cliente pediu nota fiscal separada', urgente: false, porNome: 'Angelise' },
      { texto: 'faltou o gás', urgente: true, porNome: 'Angelise' },
    ]);
    // ok na nota urgente
    const nota = r.json().dados.notas[1];
    expect((await a('POST', '/api/avisos-ok', { chave: `obs:${loc.id}:${nota.id}` })).statusCode).toBeLessThan(300);
    expect((await como('tecnico')('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'x' })).statusCode).toBe(403);
    expect((await a('POST', '/api/movimentacoes/nao-existe/notas', { texto: 'x' })).statusCode).toBe(404);
  });
});
