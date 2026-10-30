import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
let cookie = '';

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, comCookie = true) =>
  app.inject({ method, url, payload: payload as object, headers: comCookie && cookie ? { cookie } : {} });

beforeEach(async () => {
  const db = abrirBanco(':memory:');
  repositorio(db).criarUsuario('julia@lucminas.com.br', 'Júlia', await gerarHash('senha-certa'));
  app = criarApp(db, { cookieSeguro: false });
  const r = await req('POST', '/api/sessao', { email: 'JULIA@lucminas.com.br', senha: 'senha-certa' }, false);
  expect(r.statusCode).toBe(200);
  cookie = String(r.headers['set-cookie']).split(';')[0];
});

describe('login', () => {
  it('recusa senha errada e quem não está logado', async () => {
    expect((await req('POST', '/api/sessao', { email: 'julia@lucminas.com.br', senha: 'x' }, false)).statusCode).toBe(401);
    expect((await req('POST', '/api/sessao', { email: 'ninguem@x.com', senha: 'x' }, false)).statusCode).toBe(401);
    expect((await req('GET', '/api/clientes', undefined, false)).statusCode).toBe(401);
  });

  it('cookie é httpOnly e SameSite=Strict', async () => {
    const r = await req('POST', '/api/sessao', { email: 'julia@lucminas.com.br', senha: 'senha-certa' }, false);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(r.headers['set-cookie'])).toMatch(/SameSite=Strict/);
  });

  it('logout derruba a sessão', async () => {
    expect((await req('GET', '/api/sessao')).json()).toEqual({ email: 'julia@lucminas.com.br', nome: 'Júlia', chamar: '' });
    await req('DELETE', '/api/sessao');
    expect((await req('GET', '/api/sessao')).statusCode).toBe(401);
  });

  it('limita tentativas de login', async () => {
    let ultimo = 0;
    for (let i = 0; i < 12; i++) ultimo = (await req('POST', '/api/sessao', { email: 'julia@lucminas.com.br', senha: 'x' }, false)).statusCode;
    expect(ultimo).toBe(429);
  });
});

describe('clientes', () => {
  const base = { nome: 'Minasbev ', apelidos: ['minasbev industria'], para: ['Guilherme@Minasbev.com', 'guilherme@minasbev.com'], cc: ['guilherme@minasbev.com', 'cont@x.com'] };

  it('cria, normaliza, edita e lista', async () => {
    const r = await req('POST', '/api/clientes', base);
    expect(r.statusCode).toBe(201);
    const c = r.json();
    expect(c).toMatchObject({ nome: 'MINASBEV', apelidos: ['MINASBEV INDUSTRIA'], para: ['guilherme@minasbev.com'], cc: ['cont@x.com'], ativo: true });

    const e = await req('PUT', `/api/clientes/${c.id}`, { ...base, observacoes: 'Ligar antes' });
    expect(e.json().observacoes).toBe('Ligar antes');
    expect((await req('GET', '/api/clientes')).json()).toHaveLength(1);
  });

  it('valida e-mail, nome e duplicidade', async () => {
    expect((await req('POST', '/api/clientes', { ...base, para: ['nao-e-email'] })).statusCode).toBe(400);
    expect((await req('POST', '/api/clientes', { ...base, nome: '' })).statusCode).toBe(400);
    expect((await req('POST', '/api/clientes', { ...base, para: [] })).statusCode).toBe(400);
    await req('POST', '/api/clientes', base);
    const dup = await req('POST', '/api/clientes', base);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toMatch(/Já existe/);
  });

  it('desativa e aprende apelido', async () => {
    const c = (await req('POST', '/api/clientes', base)).json();
    expect((await req('PATCH', `/api/clientes/${c.id}`, { ativo: false })).json().ativo).toBe(false);
    expect((await req('POST', `/api/clientes/${c.id}/apelidos`, { apelido: 'minasbev ltda' })).json().apelidos).toContain('MINASBEV LTDA');
    expect((await req('PATCH', `/api/clientes/inexistente`, { ativo: false })).statusCode).toBe(404);
  });
});

describe('envios', () => {
  it('lista vazio e recusa envio enquanto o e-mail não estiver ativado', async () => {
    expect((await req('GET', '/api/envios')).json()).toEqual([]);
    const r = await req('POST', '/api/envios', {});
    expect(r.statusCode).toBe(503);
    expect(r.json().erro).toMatch(/Nenhum e-mail foi enviado/);
  });
});

describe('trocar senha', () => {
  it('confere a atual, valida a nova e mantém a sessão atual', async () => {
    expect((await req('PUT', '/api/sessao/senha', { atual: 'errada', nova: 'nova-senha-1' })).statusCode).toBe(400);
    expect((await req('PUT', '/api/sessao/senha', { atual: 'senha-certa', nova: 'curta' })).json().erro).toMatch(/8 caracteres/);
    expect((await req('PUT', '/api/sessao/senha', { atual: 'senha-certa', nova: 'nova-senha-1' })).statusCode).toBe(200);
    expect((await req('GET', '/api/sessao')).statusCode).toBe(200);
    expect((await req('POST', '/api/sessao', { email: 'julia@lucminas.com.br', senha: 'senha-certa' }, false)).statusCode).toBe(401);
    expect((await req('POST', '/api/sessao', { email: 'julia@lucminas.com.br', senha: 'nova-senha-1' }, false)).statusCode).toBe(200);
  });

  it('a sessão devolve como chamar a pessoa', async () => {
    expect((await req('GET', '/api/sessao')).json()).toHaveProperty('chamar', '');
  });
});
