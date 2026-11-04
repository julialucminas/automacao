import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

beforeEach(async () => {
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('juliamaria@lucminas.com.br', 'Júlia', h, '', 'admin');
  repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes');
  repo.criarUsuario('fabricio@lucminas.com.br', 'Fabrício', h, '', 'tecnico');
  app = criarApp(db, { cookieSeguro: false });
  for (const [k, e] of [
    ['julia', 'juliamaria@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
    ['tec', 'fabricio@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('equipamentos', () => {
  it('importa a planilha sem apagar o que a planilha não tem e sem duplicar', async () => {
    const lista = [
      { frota: 'FT 40', dados: { marca: 'YALE', modelo: 'GLP050VX', serie: 'A975Y01913D', ano: 2012, capacidade: 2500, horimetro: 2030, horimetroEm: '2026-10-26', compraValor: 3000000 } },
      { frota: '35', dados: { marca: 'HYSTER', modelo: 'H50FT' } },
    ];
    expect((await como('julia')('POST', '/api/equipamentos/importar', { equipamentos: lista })).json()).toEqual({ novos: 2, atualizados: 0, iguais: 0 });
    await como('julia')('PUT', '/api/equipamentos/40', { dados: { observacoes: 'bateria nova' } });
    // de novo, com um campo vazio: não apaga o que existe
    const r = (await como('julia')('POST', '/api/equipamentos/importar', { equipamentos: [{ frota: '40', dados: { marca: 'YALE', serie: null, horimetro: 2100 } }] })).json();
    expect(r).toEqual({ novos: 0, atualizados: 1, iguais: 0 });
    const ft40 = (await como('julia')('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === '40');
    expect(ft40).toMatchObject({ serie: 'A975Y01913D', horimetro: 2100, observacoes: 'bateria nova', compraValor: 3000000, atualizadoPor: 'Júlia' });
  });

  it('valor de compra só para quem vê valores; técnico não edita', async () => {
    await como('julia')('PUT', '/api/equipamentos/40', { dados: { marca: 'YALE', compraValor: 3000000, contratoValor: 380000 } });
    const j = (await como('junior')('GET', '/api/equipamentos')).json()[0];
    expect(j.marca).toBe('YALE');
    expect(j.compraValor).toBeUndefined();
    expect(j.contratoValor).toBeUndefined();
    // Júnior edita a ficha, mas não consegue mexer no valor
    await como('junior')('PUT', '/api/equipamentos/40', { dados: { horimetro: 2200, compraValor: 1 } });
    expect((await como('julia')('GET', '/api/equipamentos')).json()[0]).toMatchObject({ horimetro: 2200, compraValor: 3000000 });
    expect((await como('tec')('PUT', '/api/equipamentos/40', { dados: { horimetro: 1 } })).statusCode).toBe(403);
    expect((await como('tec')('GET', '/api/equipamentos')).statusCode).toBe(200);
    expect((await como('julia')('PUT', '/api/equipamentos/40', { dados: { horimetroEm: '04/11/2026' } })).statusCode).toBe(400);
  });

  it('histórico do Auvo: importar de novo substitui; busca sem acento; valores escondidos', async () => {
    const linhas = [
      { data: '2025-11-28', frota: 'FT 40', ativo: 'FT 40', cliente: 'Capivari', tecnico: 'Eduardo DLuca', codigo: '13514', descricao: 'REVISÃO MOTOR DE PARTIDA', quantidade: 1, valorUnitario: 12000, valorTotal: 12000 },
      { data: '2025-07-10', frota: '40', cliente: 'Capivari', tecnico: 'Fabrício', codigo: '1368860', descricao: 'SUPORTE DE ESCOVAS MOTOR DE PARTIDA', quantidade: 1, valorUnitario: 7506, valorTotal: 7506 },
      { data: '2024-01-18', frota: '49', cliente: 'UltraLog', tecnico: 'Júnior Morais', codigo: '1361847D', descricao: 'CORREIA DO ALTERNADOR', quantidade: 1, valorUnitario: 3418, valorTotal: 3418 },
      { data: '2024-02-01', frota: null, ativo: 'PWW6D56', cliente: 'Lucminas', tecnico: 'Gestor', descricao: 'TROCA DE ÓLEO', quantidade: 1, valorUnitario: 0, valorTotal: 0 },
    ];
    expect((await como('julia')('POST', '/api/historico-pecas/importar', { linhas })).json()).toEqual({ linhas: 4 });
    expect((await como('julia')('POST', '/api/historico-pecas/importar', { linhas })).json()).toEqual({ linhas: 4 });
    expect((await como('julia')('GET', '/api/historico-pecas/resumo')).json()).toEqual([{ origem: 'auvo', linhas: 4, de: '2024-01-18', ate: '2025-11-28' }]);

    const ft40 = (await como('julia')('GET', '/api/equipamentos/FT40/historico')).json();
    expect(ft40.map((p: { data: string }) => p.data)).toEqual(['2025-11-28', '2025-07-10']);
    const busca = (await como('julia')('GET', `/api/historico-pecas?q=${encodeURIComponent('motor partida')}&frota=40`)).json();
    expect(busca).toHaveLength(2);
    expect((await como('julia')('GET', `/api/historico-pecas?q=${encodeURIComponent('revisao')}`)).json()).toHaveLength(1);
    expect((await como('junior')('GET', '/api/equipamentos/40/historico')).json()[0]).toMatchObject({ descricao: 'REVISÃO MOTOR DE PARTIDA', valorTotal: 0 });
    expect((await como('junior')('POST', '/api/historico-pecas/importar', { linhas })).statusCode).toBe(200);
    expect((await como('tec')('POST', '/api/historico-pecas/importar', { linhas })).statusCode).toBe(403);
    expect((await como('julia')('POST', '/api/historico-pecas/importar', { linhas: [{ data: '28/11/2025' }] })).statusCode).toBe(400);
  });
});
