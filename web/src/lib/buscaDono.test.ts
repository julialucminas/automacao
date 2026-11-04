import { describe, expect, it } from 'vitest';
import { interpretar, resumir } from './buscaDono';
import type { PecaHistorico } from '../types';

describe('busca do app do dono', () => {
  it('entende o jeito de falar', () => {
    expect(interpretar('motor de partida frota 40')).toEqual({ frota: '40', termos: ['MOTOR', 'PARTIDA'] });
    expect(interpretar('Quando trocou a bateria da FT-12?')).toEqual({ frota: '12', termos: ['BATERIA'] });
    expect(interpretar('bateria da 40')).toEqual({ frota: '40', termos: ['BATERIA'] });
    expect(interpretar('frota 12')).toEqual({ frota: '12', termos: [] });
    expect(interpretar('óleo hidráulico')).toEqual({ frota: null, termos: ['OLEO', 'HIDRAULICO'] });
    expect(interpretar('peça 1368860')).toEqual({ frota: null, termos: ['PECA', '1368860'] });
  });

  it('resume: vezes, total, média de dias entre as trocas e por frota', () => {
    const p = (data: string, frota: string, v: number) => ({ id: 0, data, frota, valorTotal: v }) as PecaHistorico;
    expect(resumir([p('2025-11-28', '40', 12000), p('2025-07-10', '40', 7506), p('2025-07-10', '40', 10000), p('2024-02-23', '12', 10000)])).toEqual({
      lancamentos: 4,
      dias: 3,
      total: 39506,
      ultima: '2025-11-28',
      mediaEntre: 322,
      porFrota: [
        { frota: '40', lancamentos: 3, total: 29506, ultima: '2025-11-28' },
        { frota: '12', lancamentos: 1, total: 10000, ultima: '2024-02-23' },
      ],
    });
  });
});
