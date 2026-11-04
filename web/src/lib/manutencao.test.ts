import { describe, expect, it } from 'vitest';
import type { Equipamento, Pendencia } from '../types';
import { montarEquipamentos } from './equipamentos';
import { montarPainel, ordenarPorUrgencia, regrasDe } from './manutencao';
import { lerPendencias, lerPerifericos } from './quadroGeral';

const ficha = (frota: string, d: Partial<Equipamento>): Equipamento => ({ frota, atualizadoEm: '', atualizadoPor: '', ...d });
const pend = (frota: string): Pendencia => ({ id: 1, frota, cliente: '', abertaEm: '2026-10-01', tecnico: '', descricao: 'x', status: 'aberta', resolvidaEm: null, resolvidaPor: '', resolucao: '', origem: 'planilha' });

describe('painel de manutenção', () => {
  it('em dia, esta semana e atrasado pela visita e pela preventiva; periférico vencido à parte', () => {
    const fichas = [
      ficha('4', { ultimaVisita: '2026-09-09', intervaloVisitaDias: 30, horimetro: 9034, proximaPreventiva: 9287, mediaDia: 1 }), // visita há 56 dias
      ficha('40', { ultimaVisita: '2026-10-21', intervaloVisitaDias: 15, horimetro: 25786, horimetroEm: '2026-10-21', proximaPreventiva: 25961, mediaDia: 2 }), // vence em 1 dia
      ficha('18', { ultimaVisita: '2026-10-30', horimetro: 19283, proximaPreventiva: 19263, tipoVisita: 'CF' }), // preventiva passou 20 h
      ficha('9', { ultimaVisita: '2026-10-25', intervaloVisitaDias: 30, horimetro: 21727, proximaPreventiva: 21890, motorPartidaData: '2026-01-22', motorPartidaProximaData: '2026-05-22' }),
      ficha('99', { situacao: 'baixada', ultimaVisita: '2020-01-01' }),
      ficha('50', {}),
    ];
    const p = montarPainel(montarEquipamentos(fichas, [], []), regrasDe(null), [pend('50')], '2026-11-04').sort(ordenarPorUrgencia);
    expect(p.map((l) => [l.frota, l.status, l.motivos.join('; ')])).toEqual([
      ['4', 'atrasado', 'visita atrasada 26 dias'],
      ['18', 'atrasado', 'preventiva passou 20 h'],
      ['40', 'atencao', 'visita vence em 1 dia'],
      ['9', 'em-dia', ''],
      ['50', 'sem-dados', ''],
    ]);
    const ft9 = p.find((l) => l.frota === '9')!;
    expect(ft9.perifericos).toEqual([expect.objectContaining({ id: 'motorPartida', vencido: true, proxima: 'até 22/05/2026' })]);
    const ft40 = p.find((l) => l.frota === '40')!;
    expect([ft40.horasFaltam, ft40.previsaoPreventiva, ft40.proximaVisita]).toEqual([175, '2027-01-17', '2026-11-05']);
    expect(p.find((l) => l.frota === '50')!.pendencias).toHaveLength(1);
  });

  it('regras: lidas da configuração, com padrão se faltar ou estiver quebrada', () => {
    expect(regrasDe(null).tipos.map((t) => `${t.sigla}:${t.dias ?? t.horas ?? '-'}`)).toEqual(['CF:30', 'CR:-', 'B:350', 'C:500', 'D:1000']);
    expect(regrasDe({ 'manutencao.tipos': '{quebrado' } as never).tipos).toHaveLength(5);
    expect(regrasDe({ 'manutencao.tipos': '[{"sigla":"CF","nome":"x","dias":15}]' } as never).tipos).toEqual([{ sigla: 'CF', nome: 'x', dias: 15 }]);
  });
});

describe('planilha: periféricos e pendências', () => {
  it('lê os 5 blocos, "Ñ APLICA" e próxima por data ou horímetro', () => {
    const m = new Map();
    lerPerifericos(
      [
        [null, null, null, null, null, null, 'MOTOR DE PARTIDA', null, null, null, 'FILTRO DE AR', null, null, null, 'CORREIA DENTADA', null, null, null, 'OLEO DE TRANSMISSÃO', null, null, null, 'OLEO HIDRAULICO'],
        ['FROTA', 'CLIENTE', 'FROTA', 'HORÍMETRO', 'TIPO', 'DATA', 'DATA', 'HORIMETRO', 'RODADO', 'PROXIMA  TROCA', 'DATA', 'HORIMETRO', 'RODADO', 'PROXIMA  TROCA', 'DATA', 'HORIMETRO', 'RODADO', 'PROXIMA  TROCA', 'DATA', 'HORIMETRO', 'RODADO', 'PROXIMA  TROCA', 'DATA', 'HORIMETRO', 'RODADO', 'PROXIMA  TROCA'],
        [12, 'COGRAN', 12, 3541, 'CF', 46323, 46063, 2924, 617, 46243, 46147, 3193, 348, 46267, 'Ñ APLICA', null, 'Ñ APLICA', 'Ñ APLICA', 45464, 1572, 1969, 2572, 44792, 129, 3412, null],
      ],
      m,
    );
    expect(m.get('12').dados).toEqual({
      motorPartidaData: '2026-02-10',
      motorPartidaHorimetro: 2924,
      motorPartidaProximaData: '2026-08-09',
      filtroArData: '2026-05-05',
      filtroArHorimetro: 3193,
      filtroArProximaData: '2026-09-02',
      oleoTransmissaoData: '2024-06-21',
      oleoTransmissaoHorimetro: 1572,
      oleoTransmissaoProximaHoras: 2572,
      oleoHidraulicoData: '2022-08-19',
      oleoHidraulicoHorimetro: 129,
      perifericosNaoAplica: 'correia',
    });
  });

  it('pendências: só linhas com descrição', () => {
    expect(
      lerPendencias([
        [null, null, 'CLIENTE', 'FROTA', 'DATA\n ABERTURA', 'TÉCNICO', 'DESCRIÇÃO'],
        [null, null, 'FORMARE', 4, 46297, 'ENEITON', 'TROCAR AS LANTERNAS'],
        [null, null, 'HIGRA', 9, null, null, null],
      ]),
    ).toEqual([{ frota: '4', cliente: 'FORMARE', abertaEm: '2026-10-02', tecnico: 'Eneiton', descricao: 'TROCAR AS LANTERNAS' }]);
  });
});
