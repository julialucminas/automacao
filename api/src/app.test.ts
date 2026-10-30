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
  repositorio(db).criarUsuario('angelise@lucminas.com.br', 'Angelise', await gerarHash('senha-angeli'), 'Angeli');
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
    expect((await req('GET', '/api/sessao')).json()).toEqual({ id: 1, email: 'julia@lucminas.com.br', nome: 'Júlia', chamar: '' });
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
    expect((await req('POST', '/api/clientes', { ...base, nome: 'Sem Email', para: [] })).statusCode).toBe(201);
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

describe('faturamento do cliente', () => {
  const base = { nome: 'Fitlog', para: ['fin@fitlog.com.br'] };
  it('salva dia de emissão e frotas; edição sem esses campos mantém o que havia', async () => {
    const c = (await req('POST', '/api/clientes', { ...base, diaEmissao: 5, frotas: [{ numero: 'f-101', valor: 150000, descricao: 'Empilhadeira 2,5t' }, { numero: 'F-102', valor: 98050 }] })).json();
    expect(c.diaEmissao).toBe(5);
    expect(c.frotas).toEqual([{ numero: 'F-101', valor: 150000, descricao: 'Empilhadeira 2,5t' }, { numero: 'F-102', valor: 98050, descricao: '' }]);
    const e = (await req('PUT', `/api/clientes/${c.id}`, { ...base, observacoes: 'x' })).json();
    expect(e.frotas).toHaveLength(2);
    expect(e.diaEmissao).toBe(5);
    const limpo = (await req('PUT', `/api/clientes/${c.id}`, { ...base, diaEmissao: null, frotas: [] })).json();
    expect(limpo).toMatchObject({ diaEmissao: null, frotas: [] });
  });
  it('valida dia e valores', async () => {
    expect((await req('POST', '/api/clientes', { ...base, diaEmissao: 32 })).statusCode).toBe(400);
    expect((await req('POST', '/api/clientes', { ...base, frotas: [{ numero: '', valor: 1 }] })).statusCode).toBe(400);
    expect((await req('POST', '/api/clientes', { ...base, frotas: [{ numero: 'F1', valor: 10.5 }] })).statusCode).toBe(400);
  });
});

describe('regra por período e calendário', () => {
  const base = { nome: 'Tumi', para: ['adm@tumi.com.br'] };
  it('salva regra por período e valida', async () => {
    const c = (await req('POST', '/api/clientes', { ...base, regra: 'periodo', inicioLocacao: '2026-10-10', periodoDias: 30 })).json();
    expect(c).toMatchObject({ regra: 'periodo', inicioLocacao: '2026-10-10', periodoDias: 30 });
    expect((await req('PUT', `/api/clientes/${c.id}`, { ...base, inicioLocacao: '2026-02-30' })).statusCode).toBe(400);
    expect((await req('PUT', `/api/clientes/${c.id}`, { ...base, periodoDias: 0 })).statusCode).toBe(400);
    expect((await req('PUT', `/api/clientes/${c.id}`, { ...base, regra: 'outra' })).statusCode).toBe(400);
    // edição sem os campos mantém
    expect((await req('PUT', `/api/clientes/${c.id}`, base)).json()).toMatchObject({ regra: 'periodo', periodoDias: 30 });
  });

  it('marca, lista por período e desmarca faturado', async () => {
    const c = (await req('POST', '/api/clientes', base)).json();
    expect((await req('POST', '/api/faturamentos', { clienteId: c.id, data: '2026-11-09' })).statusCode).toBe(201);
    await req('POST', '/api/faturamentos', { clienteId: c.id, data: '2026-11-09' }); // repetido não duplica
    const l = (await req('GET', '/api/faturamentos?de=2026-11-01&ate=2026-11-30')).json();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ clienteId: c.id, data: '2026-11-09', marcadoPor: 'Júlia', origem: 'manual' });
    expect((await req('GET', '/api/faturamentos?de=2026-12-01&ate=2026-12-31')).json()).toHaveLength(0);
    await req('DELETE', `/api/faturamentos/${c.id}/2026-11-09`);
    expect((await req('GET', '/api/faturamentos?de=2026-11-01&ate=2026-11-30')).json()).toHaveLength(0);
    expect((await req('POST', '/api/faturamentos', { clienteId: 'nao-existe', data: '2026-11-09' })).statusCode).toBe(404);
  });
});

describe('solicitações', () => {
  it('Júlia pede, Angeli vê como não lida, responde e conclui', async () => {
    const angeli = (await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'angelise@lucminas.com.br', senha: 'senha-angeli' } }));
    const cookieAngeli = String(angeli.headers['set-cookie']).split(';')[0];
    const comAngeli = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
      app.inject({ method, url, payload: payload as object, headers: { cookie: cookieAngeli } });

    const usuarios = (await req('GET', '/api/usuarios')).json();
    expect(usuarios.map((u: { nome: string }) => u.nome)).toEqual(['Angelise', 'Júlia']);
    const idAngeli = usuarios.find((u: { nome: string }) => u.nome === 'Angelise').id;
    const cli = (await req('POST', '/api/clientes', { nome: 'Minasbev', para: ['g@minasbev.com'] })).json();

    expect((await req('POST', '/api/solicitacoes', { paraUsuario: idAngeli, data: '2026-11-03', titulo: '' })).statusCode).toBe(400);
    const s = (await req('POST', '/api/solicitacoes', { paraUsuario: idAngeli, data: '2026-11-03', clienteId: cli.id, titulo: 'Nova fatura', texto: 'Faturar a frota 12 extra' })).json();
    expect(s).toMatchObject({ titulo: 'Nova fatura', clienteNome: 'MINASBEV', paraNome: 'Angelise', criadaPorNome: 'Júlia', status: 'aberta', naoLidas: 0 });

    // para a Angeli aparece 1 não lida
    expect((await comAngeli('GET', '/api/solicitacoes')).json()[0].naoLidas).toBe(1);
    const aberta = (await comAngeli('GET', `/api/solicitacoes/${s.id}`)).json();
    expect(aberta.mensagens.map((m: { texto: string }) => m.texto)).toEqual(['Faturar a frota 12 extra']);
    expect((await comAngeli('GET', '/api/solicitacoes')).json()[0].naoLidas).toBe(0);

    await new Promise((r) => setTimeout(r, 5));
    await comAngeli('POST', `/api/solicitacoes/${s.id}/mensagens`, { texto: 'Ok, faço amanhã' });
    expect((await req('GET', '/api/solicitacoes')).json()[0].naoLidas).toBe(1); // Júlia vê a resposta como nova

    const concl = (await comAngeli('PATCH', `/api/solicitacoes/${s.id}`, { status: 'concluida', data: '2026-11-04' })).json();
    expect(concl).toMatchObject({ status: 'concluida', concluidaPorNome: 'Angelise', data: '2026-11-04' });
    expect(concl.mensagens.length).toBe(4);
    expect((await req('GET', '/api/solicitacoes/inexistente')).statusCode).toBe(404);
  });
});
