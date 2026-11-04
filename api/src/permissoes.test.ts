import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
const cookies: Record<string, string> = {};

const como = (quem: string) => (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

async function entrar(email: string, senha: string) {
  const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email, senha } });
  expect(r.statusCode).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0];
}

beforeEach(async () => {
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  repo.criarUsuario('juliamaria@lucminas.com.br', 'Júlia', await gerarHash('senha-julia'), '', 'admin');
  repo.criarUsuario('lucminas@lucminas.com.br', 'Angelise', await gerarHash('senha-angeli'), 'Angeli', 'financeiro');
  repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', await gerarHash('senha-junior'), '', 'operacoes');
  repo.criarUsuario('dono@lucminas.com.br', 'Dono', await gerarHash('senha-dono'), '', 'diretoria');
  app = criarApp(db, { cookieSeguro: false });
  cookies.julia = await entrar('juliamaria@lucminas.com.br', 'senha-julia');
  cookies.angeli = await entrar('lucminas@lucminas.com.br', 'senha-angeli');
  cookies.junior = await entrar('locacao@lucminas.com.br', 'senha-junior');
  cookies.dono = await entrar('dono@lucminas.com.br', 'senha-dono');
});

describe('permissões por perfil', () => {
  it('a sessão traz o que cada um pode ver e fazer', async () => {
    const j = (await como('junior')('GET', '/api/sessao')).json();
    expect(j).toMatchObject({ perfil: 'operacoes', perfilNome: 'Operações', veValores: false });
    expect(j.permissoes).toMatchObject({ movimentacoes: 2, frotas: 2, envio: 0, clientes: 0, usuarios: 0 });
    expect((await como('dono')('GET', '/api/sessao')).json().permissoes).toMatchObject({ envio: 1, clientes: 1, usuarios: 0 });
  });

  it('o servidor recusa o que o perfil não permite, mesmo sem o botão', async () => {
    const c = (await como('angeli')('POST', '/api/clientes', { nome: 'MINASBEV', frotas: [{ numero: '35', valor: 300000 }] })).json();
    // diretoria vê e não altera
    expect((await como('dono')('GET', '/api/clientes')).json()[0].frotas[0].valor).toBe(300000);
    expect((await como('dono')('PUT', `/api/clientes/${c.id}`, { nome: 'X' })).statusCode).toBe(403);
    expect((await como('dono')('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '35', data: '2026-11-04' })).statusCode).toBe(403);
    // operações: envio, histórico, registro e usuários fechados
    for (const url of ['/api/envios', '/api/registro', '/api/admin/usuarios', '/api/perfis']) expect((await como('junior')('GET', url)).statusCode, url).toBe(403);
    // movimentação do Júnior vai para aprovação; a da Angelise entra direto
    expect((await como('junior')('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '35', data: '2026-11-04' })).json().status).toBe('pendente');
    expect((await como('angeli')('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '35', data: '2026-11-04' })).json().status).toBe('aprovada');
  });

  it('técnico não recebe o valor das frotas; operações recebe (confere no fim do mês)', async () => {
    await como('angeli')('POST', '/api/clientes', { nome: 'MINASBEV', frotas: [{ numero: '35', valor: 300000 }] });
    await como('julia')('POST', '/api/admin/usuarios', { email: 'fabricio@lucminas.com.br', nome: 'Fabrício', perfil: 'tecnico', senha: 'senha-fabricio-1' });
    cookies.tec = await entrar('fabricio@lucminas.com.br', 'senha-fabricio-1');
    expect((await como('tec')('GET', '/api/clientes')).json()[0].frotas[0]).toMatchObject({ numero: '35', valor: 0 });
    expect((await como('junior')('GET', '/api/clientes')).json()[0].frotas[0].valor).toBe(300000);
  });

  it('administrador cria usuário, troca perfil, desativa e tudo vai para o Registro', async () => {
    const adm = como('julia');
    expect((await como('angeli')('POST', '/api/admin/usuarios', { email: 'x@x.com', nome: 'X', perfil: 'tecnico', senha: 'senha-boa-123' })).statusCode).toBe(403);
    const r = await adm('POST', '/api/admin/usuarios', { email: 'Eneiton@Lucminas.com.br', nome: 'Eneiton', perfil: 'tecnico', senha: 'senha-eneiton-1' });
    expect(r.statusCode).toBe(201);
    const u = r.json();
    expect(u).toMatchObject({ email: 'eneiton@lucminas.com.br', perfil: 'tecnico', ativo: true });
    expect((await adm('POST', '/api/admin/usuarios', { email: 'eneiton@lucminas.com.br', nome: 'E', perfil: 'tecnico', senha: 'senha-eneiton-1' })).statusCode).toBe(409);
    expect((await adm('POST', '/api/admin/usuarios', { email: 'a@b.com', nome: 'E', perfil: 'nao-existe', senha: 'senha-eneiton-1' })).statusCode).toBe(400);

    cookies.ene = await entrar('eneiton@lucminas.com.br', 'senha-eneiton-1');
    await adm('PATCH', `/api/admin/usuarios/${u.id}`, { perfil: 'operacoes' });
    expect((await como('ene')('GET', '/api/sessao')).json().perfil).toBe('operacoes'); // vale na hora, sem novo login
    await adm('PATCH', `/api/admin/usuarios/${u.id}`, { ativo: false });
    expect((await como('ene')('GET', '/api/sessao')).statusCode).toBe(401);

    // senha nova definida pelo administrador
    await adm('PATCH', `/api/admin/usuarios/${u.id}`, { ativo: true, senha: 'outra-senha-boa-2' });
    await entrar('eneiton@lucminas.com.br', 'outra-senha-boa-2');

    const log = (await adm('GET', '/api/registro')).json().filter((i: { area: string }) => i.area === 'usuarios').map((i: { acao: string }) => i.acao);
    expect(log).toEqual(
      expect.arrayContaining([
        'criou o usuário Eneiton (eneiton@lucminas.com.br) com perfil Técnico',
        'usuário Eneiton: perfil Técnico → Operações',
        'usuário Eneiton: desativou',
        'usuário Eneiton: reativou, definiu uma senha nova',
      ]),
    );
  });

  it('administrador ajusta permissões e cria perfil; nunca fica sem administrador', async () => {
    const adm = como('julia');
    const { perfis } = (await adm('GET', '/api/perfis')).json();
    expect(perfis.map((p: { id: string }) => p.id)).toEqual(['admin', 'financeiro', 'operacoes', 'tecnico', 'diretoria']);

    // Júnior passa a ver o Histórico
    const op = perfis.find((p: { id: string }) => p.id === 'operacoes');
    await adm('PUT', '/api/perfis/operacoes', { ...op, permissoes: { ...op.permissoes, historico: 1 } });
    expect((await como('junior')('GET', '/api/envios')).statusCode).toBe(200);

    // tirar "usuários" do único perfil de administrador é recusado
    const a = perfis.find((p: { id: string }) => p.id === 'admin');
    const r = await adm('PUT', '/api/perfis/admin', { ...a, permissoes: { ...a.permissoes, usuarios: 1 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/sem ninguém para administrar/);
    expect((await adm('GET', '/api/perfis')).json().perfis[0].permissoes.usuarios).toBe(2);
    // e se desativar ou rebaixar a si mesma
    expect((await adm('PATCH', '/api/admin/usuarios/1', { ativo: false })).statusCode).toBe(400);
    expect((await adm('PATCH', '/api/admin/usuarios/1', { perfil: 'financeiro' })).statusCode).toBe(400);

    // perfil novo, que não pode ser apagado enquanto alguém usa
    const novo = (await adm('POST', '/api/perfis', { nome: 'Oficina', permissoes: { inicio: 2, frotas: 2, xyz: 2 }, veValores: false })).json();
    expect(novo).toMatchObject({ id: 'oficina', nome: 'Oficina', padrao: false });
    expect(novo.permissoes).toMatchObject({ frotas: 2, envio: 0 });
    expect(novo.permissoes.xyz).toBeUndefined();
    await adm('PATCH', '/api/admin/usuarios/3', { perfil: 'oficina' });
    expect((await adm('DELETE', '/api/perfis/oficina')).json().erro).toMatch(/Júnior/);
    expect((await adm('DELETE', '/api/perfis/financeiro')).statusCode).toBe(400);
  });
});

describe('cópias de segurança', () => {
  it('cópia do dia, sem repetir, apaga as de mais de 30 dias; download só para o administrador', async () => {
    const { mkdtempSync, readdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { copiaDoDia, listarCopias } = await import('./backup.js');
    const pasta = mkdtempSync(join(tmpdir(), 'copias-'));
    const db = abrirBanco(':memory:');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(pasta, 'copias'));
    writeFileSync(join(pasta, 'copias', 'faturas-2026-09-01.db'), 'velha');
    expect((await copiaDoDia(db, pasta, new Date('2026-11-04T12:00:00Z'))).feita).toBe(true);
    expect((await copiaDoDia(db, pasta, new Date('2026-11-04T18:00:00Z'))).feita).toBe(false);
    expect(readdirSync(join(pasta, 'copias'))).toEqual(['faturas-2026-11-04.db']);
    expect(listarCopias(pasta).map((c) => c.arquivo)).toEqual(['faturas-2026-11-04.db']);

    const r = await como('julia')('GET', '/api/admin/copia-agora');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/lucminas-banco-/);
    expect(r.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await como('angeli')('GET', '/api/admin/copia-agora')).statusCode).toBe(403);
  });
});
