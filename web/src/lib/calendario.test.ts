import { describe, expect, it } from 'vitest';
import { datasNoIntervalo, gradeDoMes, lerData, proximasDatas } from './calendario';

describe('dia fixo', () => {
  it('um por mês, ajustando para o último dia quando o mês é curto', () => {
    expect(datasNoIntervalo({ tipo: 'dia', dia: 5 }, '2026-10-01', '2026-12-31')).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
    expect(datasNoIntervalo({ tipo: 'dia', dia: 31 }, '2027-02-01', '2027-04-30')).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    expect(datasNoIntervalo({ tipo: 'dia', dia: 31 }, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });
  it('vira o ano', () => {
    expect(datasNoIntervalo({ tipo: 'dia', dia: 10 }, '2026-12-01', '2027-01-31')).toEqual(['2026-12-10', '2027-01-10']);
  });
});

describe('período', () => {
  it('primeira fatura em início + N dias, depois a cada N', () => {
    const r = { tipo: 'periodo', inicio: '2026-10-10', dias: 30 } as const;
    expect(datasNoIntervalo(r, '2026-10-01', '2027-01-31')).toEqual(['2026-11-09', '2026-12-09', '2027-01-08']);
    expect(datasNoIntervalo(r, '2026-12-01', '2026-12-31')).toEqual(['2026-12-09']);
  });
  it('período curto pode cair mais de uma vez no mês; nada antes do início', () => {
    const r = { tipo: 'periodo', inicio: '2026-11-01', dias: 15 } as const;
    expect(datasNoIntervalo(r, '2026-10-01', '2026-10-31')).toEqual([]);
    expect(datasNoIntervalo(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-16']);
    expect(datasNoIntervalo(r, '2026-12-01', '2026-12-31')).toEqual(['2026-12-01', '2026-12-16', '2026-12-31']);
  });
  it('não muda com horário de verão (contas em UTC)', () => {
    expect(datasNoIntervalo({ tipo: 'periodo', inicio: '2026-10-01', dias: 1 }, '2026-10-30', '2026-11-03')).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03',
    ]);
  });
  it('regra incompleta não gera datas', () => {
    expect(datasNoIntervalo({ tipo: 'periodo', inicio: 'x', dias: 30 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(datasNoIntervalo({ tipo: 'periodo', inicio: '2026-01-01', dias: 0 }, '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('ajudantes', () => {
  it('próximas datas', () => {
    expect(proximasDatas({ tipo: 'dia', dia: 5 }, 3, '2026-10-30')).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
  });
  it('grade de domingo a sábado', () => {
    const g = gradeDoMes(2026, 11); // 01/11/2026 é domingo
    expect(g[0][0]).toBe('2026-11-01');
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.every((s) => s.length === 7)).toBe(true);
  });
  it('lê datas da planilha', () => {
    expect(lerData('10/10/2026')).toBe('2026-10-10');
    expect(lerData('5/1/27')).toBe('2027-01-05');
    expect(lerData('2026-10-10')).toBe('2026-10-10');
    expect(lerData(new Date(Date.UTC(2026, 9, 10)))).toBe('2026-10-10');
    expect(lerData('31/02/2026')).toBeNull();
    expect(lerData('')).toBeNull();
  });
});
