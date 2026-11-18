import { describe, expect, it } from 'vitest';
import { dias30, montarFaturamento } from './relacaoFaturamento';
import type { Cliente, Envio, Faturamento, Movimentacao, TipoMov, DadosMov } from '../types';

const cli = (id: string, frotas: Cliente['frotas'] = []) =>
  ({ id, nome: id.toUpperCase(), apelidos: [], cnpj: '', para: [], cc: [], observacoes: '', regra: 'dia', diaEmissao: 5, inicioLocacao: null, periodoDias: null, frotas, ativo: true, atualizadoEm: '' }) as Cliente;
let n = 0;
const mov = (tipo: TipoMov, frota: string, clienteId: string, data: string, d: Partial<DadosMov> = {}, frotaNova: string | null = null): Movimentacao =>
  ({ id: String(++n), tipo, frota, frotaNova, clienteId, clienteNome: clienteId.toUpperCase(), status: 'aprovada', criadaEm: `${data}T12:00:00Z`, criadaPorNome: '', decididaEm: null, decididaPorNome: null, motivo: '', vista: true,
    dados: { data, valor: null, frete: '', gas: 0, contrato: '', prazoPagamento: '', emails: [], contatoNome: '', contatoTelefone: '', descricao: '', observacoes: '', ...d } }) as Movimentacao;
const envio = (clienteId: string, dia: string, status: Envio['status'] = 'enviado') => ({ id: dia + clienteId, enviadoEm: `${dia}T13:00:00Z`, referencia: dia.slice(0, 7), numero: '1', clienteId, clienteNome: '', status }) as unknown as Envio;

describe('dias sobre 30', () => {
  it('mês inteiro é 30, último dia conta como 30', () => {
    expect(dias30('2026-11-01', '2026-11-30')).toBe(30);
    expect(dias30('2026-12-01', '2026-12-31')).toBe(30);
    expect(dias30('2027-02-01', '2027-02-28')).toBe(30);
    expect(dias30('2026-11-01', '2026-11-12')).toBe(12);
    expect(dias30('2026-11-17', '2026-11-30')).toBe(14);
    expect(dias30('2026-12-17', '2026-12-31')).toBe(14);
  });
});

describe('relação de faturamento', () => {
  it('devolvida no mês: cobra até o dia da devolução e fica a faturar até sair fatura depois dela', () => {
    const movs = [mov('locacao', '30', 'cimbra', '2026-03-10', { valor: 300000 }), mov('devolucao', '30', 'cimbra', '2026-11-12', { valorAnterior: 300000 })];
    const envios = [envio('cimbra', '2026-11-05')];
    const l = montarFaturamento('2026-11', [cli('cimbra')], movs, envios, []);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ tipo: 'devolvida', frota: '30', de: '2026-11-01', ate: '2026-11-12', dias: 12, sugerido: 120000, estado: 'pendente' });
    // fatura saiu no dia 20: cobrada
    const l2 = montarFaturamento('2026-11', [cli('cimbra')], movs, [...envios, envio('cimbra', '2026-11-20')], []);
    expect(l2[0]).toMatchObject({ estado: 'faturado', faturadoEm: '2026-11-20' });
    // ou lançada à mão no mês seguinte
    const fat: Faturamento[] = [{ clienteId: 'cimbra', data: '2026-12-05', marcadoEm: '', marcadoPor: '', origem: 'manual' }];
    expect(montarFaturamento('2026-11', [cli('cimbra')], movs, envios, fat)[0].estado).toBe('faturado');
  });

  it('entrou no mês e mês inteiro; locada e devolvida no mesmo mês', () => {
    const c = cli('esquipa', [
      { numero: '40', valor: 300000, descricao: '', inicio: '2026-02-01' },
      { numero: '50', valor: 350000, descricao: '', inicio: '2026-11-17', modalidade: 'contrato' },
    ]);
    const movs = [
      mov('locacao', '50', 'esquipa', '2026-11-17', { valor: 350000 }),
      mov('locacao', '77', 'esquipa', '2026-11-03', { valor: 90000, modalidade: 'esporadico' }),
      mov('devolucao', '77', 'esquipa', '2026-11-09', { valorAnterior: 90000 }),
    ];
    const l = montarFaturamento('2026-11', [c], movs, [envio('esquipa', '2026-11-05')], []);
    const por = Object.fromEntries(l.map((x) => [x.frota, x]));
    expect(por['40']).toMatchObject({ tipo: 'mes', sugerido: 300000, estado: 'faturado' });
    expect(por['50']).toMatchObject({ tipo: 'entrou', dias: 14, sugerido: Math.round((350000 * 14) / 30), estado: 'pendente' });
    expect(por['77']).toMatchObject({ tipo: 'devolvida', modalidade: 'esporadico', de: '2026-11-03', ate: '2026-11-09', dias: 7, sugerido: 21000 });
  });

  it('troca com valor novo e reajuste no meio do mês viram trechos', () => {
    const c = cli('ortho', [{ numero: '33', valor: 400000, descricao: '', inicio: '2025-05-01' }]);
    const movs = [
      mov('locacao', '12', 'ortho', '2025-05-01', { valor: 300000 }),
      mov('troca', '12', 'ortho', '2026-11-11', { valor: 360000, valorAnterior: 300000 }, '33'),
      mov('reajuste', '33', 'ortho', '2026-11-21', { itens: [{ frota: '33', antes: 360000, novo: 400000 }] }),
    ];
    const [l] = montarFaturamento('2026-11', [c], movs, [], []);
    expect(l.frotas).toEqual(['12', '33']);
    expect(l.trechos.map((t) => [t.de, t.ate, t.dias, t.valor])).toEqual([
      ['2026-11-01', '2026-11-10', 10, 300000],
      ['2026-11-11', '2026-11-20', 10, 360000],
      ['2026-11-21', '2026-11-30', 10, 400000],
    ]);
    expect(l.sugerido).toBe(100000 + 120000 + Math.round(400000 / 3));
    expect(l.eventos.map((e) => e.tipo)).toEqual(['troca', 'reajuste']);
  });

  it('venda de máquina locada: cobra do cliente que estava com ela', () => {
    const movs = [mov('locacao', '9', 'acme', '2026-01-01', { valor: 300000 }), { ...mov('venda', '9', 'comprador', '2026-11-15', { valorAnterior: 300000 }) }];
    const l = montarFaturamento('2026-11', [cli('acme')], movs, [], []);
    expect(l[0]).toMatchObject({ clienteId: 'acme', tipo: 'vendida', dias: 15, sugerido: 150000 });
  });

  it('não junta locação antiga já devolvida com a nova da mesma máquina', () => {
    const movs = [
      mov('locacao', '5', 'a', '2026-01-01', { valor: 100000 }),
      mov('devolucao', '5', 'a', '2026-11-04', { valorAnterior: 100000 }),
      mov('locacao', '5', 'a', '2026-11-20', { valor: 120000 }),
    ];
    const c = cli('a', [{ numero: '5', valor: 120000, descricao: '', inicio: '2026-11-20' }]);
    const l = montarFaturamento('2026-11', [c], movs, [], []);
    expect(l.map((x) => [x.tipo, x.de, x.ate, x.sugerido])).toEqual([
      ['devolvida', '2026-11-01', '2026-11-04', Math.round((100000 * 4) / 30)],
      ['entrou', '2026-11-20', '2026-11-30', Math.round((120000 * 11) / 30)],
    ]);
  });
});
