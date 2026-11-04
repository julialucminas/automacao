import { describe, expect, it } from 'vitest';
import type { Ordem } from '../types';
import { faltaParaConcluir } from './ordens';
import { aplicarLocal } from './filaOffline';

const os = (ex: Ordem['execucao'], d: Partial<Ordem> = {}): Ordem => ({ id: 'a', numero: 1, frota: '40', tipo: 'corretiva', status: 'agendada', execucao: ex, ...d }) as Ordem;

describe('OS no celular', () => {
  it('mostra o que falta para concluir', () => {
    const o = os({ checklist: [{ item: 'Buzina', resposta: '', obs: '' }] });
    expect(faltaParaConcluir(o)).toEqual(['check-in', 'horímetro', 'checklist (1)', 'o que foi feito', 'assinatura']);
    const pronto = os({ checkin: { em: '', lat: null, lng: null, precisao: null }, horimetro: 10, checklist: [{ item: 'Buzina', resposta: 'ok', obs: '' }], servico: 'x', semAssinatura: 'ninguém' });
    expect(faltaParaConcluir(pronto)).toEqual([]);
    expect(faltaParaConcluir({ ...pronto, tipo: 'externo', execucao: { ...pronto.execucao, horimetro: null } })).toEqual([]);
  });

  it('sem sinal, a tela já mostra o que o técnico fez', () => {
    let o = os({ checklist: [] });
    o = aplicarLocal(o, { tipo: 'checkin', id: 'a', local: { lat: -19.9 } });
    expect(o.status).toBe('execucao');
    o = aplicarLocal(o, { tipo: 'salvar', id: 'a', dados: { horimetro: 25950, servico: undefined, aguardandoPeca: true } });
    expect([o.status, o.execucao.horimetro, 'servico' in o.execucao]).toEqual(['aguardando_peca', 25950, false]);
    o = aplicarLocal(o, { tipo: 'foto', id: 'a', imagem: 'AAAABBBBCCCCDDDD' });
    expect(o.execucao.fotos).toEqual(['pendente:BBBBCCCCDDDD']);
    o = aplicarLocal(o, { tipo: 'assinatura', id: 'a', imagem: 'x', nome: 'Carlos' });
    expect([o.execucao.assinatura, o.execucao.assinadoPor]).toEqual(['pendente', 'Carlos']);
  });
});
