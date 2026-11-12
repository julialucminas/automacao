import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { equipamentos } from './equipamentos.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
let db: ReturnType<typeof abrirBanco>;
let clienteId = '';
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('financeiro@lucminas.com.br', 'Angelise', h, '', 'financeiro');
  repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes');
  const u = repo.criarUsuario('admin@lucminas.com.br', 'Admin', h, '', 'admin');
  clienteId = repo.salvarCliente(
    {
      nome: 'METALFISA',
      apelidos: [],
      cnpj: '',
      para: ['a@metalfisa.com.br'],
      cc: [],
      observacoes: '',
      frotas: [
        { numero: '53', valor: 385000, descricao: '' },
        { numero: '63', valor: 385000, descricao: '' },
      ],
    },
    u.id,
    'teste',
  ).id;
  equipamentos(db).salvar('53', { contratoValor: 385000, contratoReajuste: 400000, contratoVencimento: '2026-11-20' }, u.id);
  app = criarApp(db, { cookieSeguro: false });
  for (const [k, e] of [
    ['angelise', 'financeiro@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('reajuste de valor', () => {
  it('operações registra, financeiro aprova: valor muda no cliente e na ficha, com o antes guardado', async () => {
    expect((await como('junior')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [{ frota: '99', novo: 1 }] })).statusCode).toBe(400);
    expect((await como('junior')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [] })).statusCode).toBe(400);
    const r = await como('junior')('POST', '/api/movimentacoes', {
      tipo: 'reajuste',
      clienteId,
      data: '2026-12-01',
      percentual: 3.9,
      renovaAte: '2027-11-20',
      observacoes: 'IPCA anual',
      itens: [
        { frota: 'FT53', novo: 400000 },
        { frota: '63', novo: 400000 },
      ],
    });
    expect(r.statusCode).toBe(201);
    const m = r.json();
    expect(m).toMatchObject({ tipo: 'reajuste', status: 'pendente', frota: '53, 63', clienteNome: 'METALFISA' });
    expect(m.dados.itens).toEqual([
      { frota: '53', antes: 385000, novo: 400000 },
      { frota: '63', antes: 385000, novo: 400000 },
    ]);
    // ainda não aplicou
    const antes = (await como('angelise')('GET', '/api/clientes')).json();
    expect((antes.clientes ?? antes).find((c: { id: string }) => c.id === clienteId).frotas[0].valor).toBe(385000);

    const ap = await como('angelise')('POST', `/api/movimentacoes/${m.id}/aprovar`);
    expect(ap.statusCode).toBe(200);
    expect(ap.json().status).toBe('aprovada');
    const depois = (await como('angelise')('GET', '/api/clientes')).json();
    const c = (depois.clientes ?? depois).find((x: { id: string }) => x.id === clienteId);
    expect(c.frotas.map((f: { valor: number; fim?: string }) => [f.valor, f.fim])).toEqual([
      [400000, '2027-11-20'],
      [400000, '2027-11-20'],
    ]);
    const ficha = equipamentos(db).buscar('53')!;
    expect(ficha).toMatchObject({ contratoValor: 400000, contratoVencimento: '2027-11-20' });
    expect(ficha.contratoReajuste).toBeUndefined();
  });

  it('financeiro registra e já aplica; devolução guarda o valor que a frota tinha', async () => {
    const m = (await como('angelise')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [{ frota: '63', novo: 410000 }] })).json();
    expect(m.status).toBe('aprovada');
    const d = (await como('angelise')('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '63', data: '2026-12-10' })).json();
    expect(d.dados.valorAnterior).toBe(410000);
  });
});
