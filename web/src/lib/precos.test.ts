import { describe, expect, it } from 'vitest';
import type { Movimentacao } from '../types';
import { historicoPrecos } from './precos';

const m = (tipo: Movimentacao['tipo'], frota: string, d: Partial<Movimentacao['dados']>, extra: Partial<Movimentacao> = {}) =>
  ({ id: Math.random().toString(), tipo, frota, frotaNova: null, clienteNome: 'X', status: 'aprovada', ...extra, dados: { valor: null, ...d } }) as unknown as Movimentacao;

describe('histórico de preços', () => {
  it('locação, reajustes com percentual, troca e devolução; ignora pendente', () => {
    const movs = [
      m('locacao', '10', { data: '2025-01-10', valor: 300000 }),
      m('reajuste', '10, 11', { data: '2026-01-10', itens: [{ frota: '10', antes: 300000, novo: 315000 }, { frota: '11', antes: 1, novo: 2 }] }),
      m('reajuste', '10', { data: '2026-06-01', itens: [{ frota: '10', antes: 315000, novo: 999 }] }, { status: 'pendente' }),
      m('troca', '10', { data: '2026-08-01', valor: 330000, valorAnterior: 315000 }, { frotaNova: '12' }),
    ];
    expect(historicoPrecos(movs, '10').map((p) => [p.data, p.tipo, p.de, p.para, p.percentual])).toEqual([
      ['2026-08-01', 'troca_sai', 315000, null, null],
      ['2026-01-10', 'reajuste', 300000, 315000, 5],
      ['2025-01-10', 'locacao', null, 300000, null],
    ]);
    expect(historicoPrecos(movs, '12')).toMatchObject([{ tipo: 'troca_entra', para: 330000 }]);
  });
});
