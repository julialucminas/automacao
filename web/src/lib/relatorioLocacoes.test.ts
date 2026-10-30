import { describe, expect, it } from 'vitest';
import type { Cliente } from '../types';
import { montarRelatorio } from './relatorioLocacoes';

const cli = (nome: string, frotas: Cliente['frotas'], extra: Partial<Cliente> = {}): Cliente =>
  ({ id: nome, nome, apelidos: [], cnpj: '', para: [], cc: [], observacoes: '', regra: 'dia', diaEmissao: null, inicioLocacao: null, periodoDias: null, ativo: true, atualizadoEm: '', frotas, ...extra }) as Cliente;

describe('relatório de locações ativas', () => {
  it('pega só o que está ativo no mês, marca término e oficina', () => {
    const clientes = [
      cli('FENIX', [{ numero: '35', valor: 335000, descricao: '', inicio: '2026-10-20', fim: '2027-10-19' }]),
      cli('MINASBEV', [
        { numero: '10', valor: 250000, descricao: '' }, // sem datas: ativa
        { numero: '12', valor: 180000, descricao: '', inicio: '2025-11-03', fim: '2026-10-15' }, // termina no mês
        { numero: '13', valor: 100000, descricao: '', fim: '2026-09-30' }, // já tinha terminado
        { numero: '14', valor: 100000, descricao: '', inicio: '2026-11-05' }, // ainda não começou
      ]),
      cli('INATIVO', [{ numero: '99', valor: 1, descricao: '' }], { ativo: false }),
    ];
    const r = montarRelatorio(clientes, [{ frota: '10', desde: '2026-10-28T10:00:00Z', observacao: 'motor', usuario: '' }, { frota: '59', desde: '2026-10-01T10:00:00Z', observacao: '', usuario: '' }], '2026-10');
    expect(r.grupos.map((g) => [g.cliente.nome, g.linhas.map((l) => l.frota.numero), g.total])).toEqual([
      ['FENIX', ['35'], 335000],
      ['MINASBEV', ['10', '12'], 430000],
    ]);
    expect(r.terminando.map((l) => l.frota.numero)).toEqual(['12']);
    expect(r.grupos[1].linhas[0].oficina?.observacao).toBe('motor');
    expect(r.oficina.map((x) => [x.o.frota, x.cliente?.nome ?? null])).toEqual([
      ['10', 'MINASBEV'],
      ['59', null],
    ]);
    expect(r.resumo).toEqual({ frotas: 3, clientes: 2, valorTotal: 765000, terminando: 1, naOficina: 2 });
  });
});
