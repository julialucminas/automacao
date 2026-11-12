import { describe, expect, it } from 'vitest';
import type { Cliente, Equipamento, Movimentacao } from '../types';
import { montarEquipamentos } from './equipamentos';
import { candidatasVenda, contratos, paradas, ponteDoMes, receitaPorCliente, rentabilidade, serieReceita } from './dono';

const HOJE = '2026-11-12';
const mov = (p: Partial<Movimentacao> & { tipo: Movimentacao['tipo']; frota: string }, d: Partial<Movimentacao['dados']>): Movimentacao =>
  ({
    id: Math.random().toString(),
    frotaNova: null,
    clienteId: null,
    clienteNome: 'X',
    status: 'aprovada',
    criadaEm: `${d.data}T12:00:00Z`,
    criadaPorNome: '',
    decididaEm: null,
    decididaPorNome: null,
    motivo: '',
    vista: true,
    ...p,
    dados: { valor: null, frete: '', gas: 0, contrato: '', prazoPagamento: '', emails: [], contatoNome: '', contatoTelefone: '', descricao: '', observacoes: '', data: HOJE, ...d },
  }) as Movimentacao;
const cli = (id: string, frotas: Cliente['frotas']) => ({ id, nome: id.toUpperCase(), ativo: true, frotas }) as unknown as Cliente;
const ficha = (frota: string, d: Partial<Equipamento>) => ({ frota, ...d }) as Equipamento;

const clientes = [
  cli('a', [
    { numero: '1', valor: 400000, descricao: '', inicio: '2025-01-10', modalidade: 'contrato' },
    { numero: '2', valor: 300000, descricao: '', inicio: '2026-06-01' },
  ]),
  cli('b', [{ numero: '3', valor: 100000, descricao: '', modalidade: 'esporadico' }]),
];
const fichas = [ficha('1', { contratoVencimento: '2026-11-01', ano: 2010 }), ficha('3', { contratoVencimento: '2026-12-01' }), ficha('4', {}), ficha('5', { situacao: 'baixada' })];
const linhas = montarEquipamentos(fichas, clientes, [], HOJE);
const movs = [
  mov({ tipo: 'locacao', frota: '2' }, { data: '2026-10-05', valor: 300000 }),
  mov({ tipo: 'devolucao', frota: '4' }, { data: '2026-09-20', valorAnterior: 150000 }),
  mov({ tipo: 'reajuste', frota: '1' }, { data: '2026-11-01', itens: [{ frota: '1', antes: 380000, novo: 400000 }] }),
  mov({ tipo: 'venda', frota: '9' }, { data: '2026-11-03', valor: 6500000, valorAnterior: 0 }),
  mov({ tipo: 'locacao', frota: '7', status: 'pendente' }, { data: '2026-11-04', valor: 999 }),
];

describe('indicadores do dono', () => {
  it('reconstrói a receita para trás pelas movimentações, até um mês antes da primeira', () => {
    const s = serieReceita([{ mes: '2026-10', receita: 777, receitaContrato: 0, locadas: 0, frota: 0, clientes: 0, atualizadaEm: '' }], movs, 800000, HOJE, 4);
    expect(s).toEqual([
      { mes: '2026-08', receita: 800000 - 20000 - 300000 + 150000, estimado: true },
      { mes: '2026-09', receita: 800000 - 20000 - 300000, estimado: true },
      { mes: '2026-10', receita: 777, estimado: false },
      { mes: '2026-11', receita: 800000, estimado: false },
    ]);
    expect(serieReceita([], movs, 800000, HOJE, 5)[0]).toEqual({ mes: '2026-07', receita: null, estimado: false });
  });

  it('ponte do mês: entradas, saídas, reajustes e venda à parte; pendente não conta', () => {
    const p = ponteDoMes(movs, '2026-11');
    expect(p).toMatchObject({ entrou: 0, saiu: 0, reajustes: 20000, liquido: 20000, vendas: { n: 1, valor: 6500000 } });
    expect(ponteDoMes(movs, '2026-10')).toMatchObject({ entrou: 300000, liquido: 300000, locacoes: 1 });
  });

  it('concentração, contratos, sem reajuste e modalidade', () => {
    const r = receitaPorCliente(linhas);
    expect(r.maior).toMatchObject({ nome: 'A', parte: 0.875 });
    const c = contratos(linhas, movs, HOJE);
    expect(c.faixas.map((f) => f.maquinas.map((l) => l.frota))).toEqual([['1'], ['3'], [], []]);
    expect(c.semReajuste).toEqual([]); // FT1 reajustada em nov
    const c2 = contratos(linhas, [], HOJE);
    expect(c2.semReajuste.map((x) => x.l.frota)).toEqual(['1']);
    expect(c2.semData).toBe(1);
    expect(c2.modalidade).toMatchObject({ contrato: 400000, esporadico: 100000, sem: 300000 });
  });

  it('paradas e candidatas a vender', () => {
    expect(paradas(linhas, movs, HOJE).map((p) => [p.l.frota, p.dias])).toEqual([['4', 53]]);
    const r = rentabilidade(linhas, [{ frota: '1', total: 1500000, lancamentos: 1, visitas: 1, ultima: '' }, { frota: '4', total: 10000, lancamentos: 1, visitas: 1, ultima: '' }], HOJE);
    expect(candidatasVenda(r).map((x) => [x.l.frota, x.motivos])).toEqual([
      ['1', ['gasto = 31% do que fatura', '16 anos de uso']],
      ['4', ['gastou sem estar faturando']],
    ]);
  });
});
