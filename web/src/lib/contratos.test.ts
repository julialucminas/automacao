import { describe, expect, it } from 'vitest';
import type { Cliente, Equipamento, Movimentacao } from '../types';
import { montarContratos, sugestaoRenovacao } from './contratos';

const cli = (id: string, frotas: Cliente['frotas']) => ({ id, nome: id.toUpperCase(), ativo: true, frotas }) as unknown as Cliente;
const fi = (frota: string, d: Partial<Equipamento>) => ({ frota, ...d }) as Equipamento;

describe('contratos', () => {
  it('agrupa por cliente e número, calcula situação e reajuste; separa sem contrato e esporádicas', () => {
    const clientes = [
      cli('a', [
        { numero: '1', valor: 100, descricao: '', inicio: '2025-03-01' },
        { numero: '2', valor: 200, descricao: '' },
        { numero: '3', valor: 50, descricao: '', modalidade: 'esporadico' },
        { numero: '4', valor: 70, descricao: '', modalidade: 'contrato' },
      ]),
      cli('b', [{ numero: '5', valor: 300, descricao: '' }]),
    ];
    const fichas = [
      fi('1', { contratoNumero: 'C1', contratoInicio: '2025-03-01', contratoVencimento: '2026-12-20' }),
      fi('2', { contratoNumero: 'c1', contratoVencimento: '2026-12-31' }),
      fi('5', { contratoVencimento: '2026-10-01' }),
    ];
    const movs = [{ tipo: 'reajuste', status: 'aprovada', dados: { data: '2026-03-01', itens: [{ frota: '1', antes: 90, novo: 100 }] } }] as unknown as Movimentacao[];
    const r = montarContratos(clientes, fichas, movs, '2026-11-12');
    expect(r.contratos.map((c) => [c.cliente.id, c.numero, c.maquinas.map((m) => m.numero), c.valor, c.status, c.vencimento, c.datasDiferentes])).toEqual([
      ['b', '', ['5'], 300, 'vencido', '2026-10-01', false],
      ['a', 'C1', ['1', '2'], 300, 'vencendo', '2026-12-20', true],
    ]);
    expect(r.contratos[1]).toMatchObject({ ultimoReajuste: '2026-03-01', proximoReajuste: '2027-03-01', reajusteAtrasado: false });
    expect(r.semContrato.map((s) => s.maquinas.map((m) => m.numero))).toEqual([['4']]);
    expect(r.esporadicas.map((s) => s.maquinas.map((m) => m.numero))).toEqual([['3']]);
    expect(sugestaoRenovacao('2026-12-20', '2026-11-12')).toBe('2027-12-20');
    expect(sugestaoRenovacao('2025-01-10', '2026-11-12')).toBe('2027-11-12');
  });
});
