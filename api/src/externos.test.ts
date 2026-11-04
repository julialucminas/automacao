import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const como = (quem: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

beforeEach(async () => {
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  ids.angelise = repo.criarUsuario('financeiro@lucminas.com.br', 'Angelise', h, '', 'financeiro').id;
  ids.junior = repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes').id;
  ids.fabricio = repo.criarUsuario('fabricio@lucminas.com.br', 'Fabrício', h, '', 'tecnico').id;
  ids.dono = repo.criarUsuario('arnaldo@lucminas.com.br', 'Arnaldo', h, '', 'diretoria').id;
  app = criarApp(db, { cookieSeguro: false });
  for (const [k, e] of [
    ['angelise', 'financeiro@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
    ['fabricio', 'fabricio@lucminas.com.br'],
    ['dono', 'arnaldo@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('serviços externos', () => {
  it('Júnior cadastra, Angelise orça e cobra; valor só para quem vê valores; dono só vê; técnico não vê', async () => {
    expect((await como('junior')('POST', '/api/externos', { descricao: 'x' })).statusCode).toBe(400);
    let s = (
      await como('junior')('POST', '/api/externos', { clienteNome: 'Cerâmica Pará', contato: 'Sr. José (37) 9999-0000', equipamento: 'Empilhadeira Hyster 2,5 t', descricao: 'Vazamento no cilindro', responsavelId: ids.angelise, valor: 999 })
    ).json();
    expect(s).toMatchObject({ etapa: 'pedido', responsavelNome: 'Angelise', criadoPor: 'Júnior', valor: null });
    expect(s.historico).toHaveLength(1);

    s = (await como('angelise')('PATCH', `/api/externos/${s.id}`, { valor: 185000, previsao: '2026-11-20' })).json();
    expect(s.valor).toBe(185000);
    for (const etapa of ['orcamento', 'enviado', 'aprovado', 'execucao', 'concluido', 'cobrado'])
      s = (await como('angelise')('POST', `/api/externos/${s.id}/etapa`, { etapa, obs: etapa === 'enviado' ? 'mandado por WhatsApp' : '' })).json();
    expect(s.etapa).toBe('cobrado');
    expect(s.historico.map((h: { etapa: string }) => h.etapa)).toEqual(['pedido', 'orcamento', 'enviado', 'aprovado', 'execucao', 'concluido', 'cobrado']);
    expect(s.historico[2]).toMatchObject({ por: 'Angelise', obs: 'mandado por WhatsApp' });
    expect((await como('angelise')('POST', `/api/externos/${s.id}/etapa`, { etapa: 'sumiu' })).statusCode).toBe(400);

    // Júnior (sem valores) não vê nem muda o valor
    const doJunior = (await como('junior')('GET', '/api/externos')).json();
    expect(doJunior.servicos[0].valor).toBeNull();
    await como('junior')('PATCH', `/api/externos/${s.id}`, { valor: 1, obs: 'ok' });
    expect((await como('angelise')('GET', '/api/externos')).json().servicos[0]).toMatchObject({ valor: 185000, obs: 'ok' });

    // dono vê com valor, não muda; técnico não vê
    expect((await como('dono')('GET', '/api/externos')).json().servicos[0].valor).toBe(185000);
    expect((await como('dono')('PATCH', `/api/externos/${s.id}`, { obs: 'x' })).statusCode).toBe(403);
    expect((await como('fabricio')('GET', '/api/externos')).statusCode).toBe(403);
  });
});
