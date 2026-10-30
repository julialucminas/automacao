import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import readXlsxFile from 'read-excel-file/node';
import type { Cliente } from '../types';
import { montarPlanilhaOperacoes } from './exportarExcel';

const cli = (nome: string, extra: Partial<Cliente> = {}): Cliente => ({
  id: nome,
  nome,
  apelidos: [],
  cnpj: '',
  para: [`fin@${nome.toLowerCase()}.com`],
  cc: [],
  observacoes: '',
  regra: 'dia',
  diaEmissao: 5,
  inicioLocacao: null,
  periodoDias: null,
  frotas: [],
  ativo: true,
  atualizadoEm: '',
  ...extra,
});

describe('planilha para Operações', () => {
  const clientes = [
    cli('MINASBEV', { frotas: [{ numero: '10', valor: 250000, descricao: 'Empilhadeira 2,5t' }, { numero: '2', valor: 180000, descricao: '' }] }),
    cli('PANEX', { frotas: [{ numero: '10', valor: 0, descricao: '' }], para: [] }),
    cli('TUMI', { regra: 'periodo', diaEmissao: null, inicioLocacao: '2026-10-10', periodoDias: 15 }),
    cli('INATIVO', { ativo: false, frotas: [{ numero: '99', valor: 1, descricao: '' }] }),
  ];

  it('monta as três abas com valores numéricos e pendências', async () => {
    const p = montarPlanilhaOperacoes(clientes, '2026-10-30');
    expect(p.sheets).toEqual(['Resumo', 'Frotas', 'Clientes']);

    // grava de verdade e lê de volta, como o Excel faria
    const buf = await writeXlsxFile(p.dados as never, { sheets: p.sheets, columns: p.columns, buffer: true } as never);
    const frotas = await readXlsxFile(buf as never, { sheet: 'Frotas' });
    expect(frotas[0]).toEqual(['Frota', 'Cliente', 'Descrição', 'Valor', 'Regra de faturamento', 'Próxima fatura', 'E-mails (Para)', 'Observação']);
    expect(frotas.slice(1).map((r) => [r[0], r[1], r[3]])).toEqual([
      [2, 'MINASBEV', 1800],
      [10, 'MINASBEV', 2500],
      [10, 'PANEX', null],
    ]);
    expect(frotas[3][7]).toBe('FROTA EM MAIS DE UM CLIENTE; sem valor');
    expect((frotas[1][5] as unknown as Date).toISOString().slice(0, 10)).toBe('2026-11-05');

    const cl = await readXlsxFile(buf as never, { sheet: 'Clientes' });
    expect(cl.slice(1).map((r) => [r[0], r[1], r[3], r[8]])).toEqual([
      ['MINASBEV', 2, 4300, null],
      ['PANEX', 1, 0, 'sem e-mail, frota sem valor'],
      ['TUMI', 0, null, 'sem frota'],
    ]);

    const resumo = await readXlsxFile(buf as never, { sheet: 'Resumo' });
    const r = Object.fromEntries(resumo.slice(4).map((l) => [l[0], l[1]]));
    expect(r).toMatchObject({ 'Clientes ativos': 3, 'Frotas locadas (números diferentes)': 2, 'Valor total das frotas': 4300, 'Frotas em mais de um cliente': 1, 'Frotas sem valor': 1 });
  });
});
