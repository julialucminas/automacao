import { describe, expect, it } from 'vitest';
import type { Envio, Faturamento } from '../types';
import { resumirFaturas, situacaoFaturas } from './faturado';

const env = (clienteId: string, referencia: string, status: Envio['status'], numero = '1', enviadoEm = `${referencia}-05T12:00:00Z`) => ({ id: numero + clienteId, clienteId, referencia, status, numero, enviadoEm }) as Envio;

describe('faturado no mês', () => {
  it('envio entregue, e-mail que voltou, falha, marcação no calendário e outro mês', () => {
    const clientes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const envios = [env('a', '2026-11', 'lido', '10'), env('b', '2026-11', 'devolvido', '11'), env('c', '2026-11', 'falhou', '12'), env('e', '2026-10', 'enviado', '9')];
    const marc: Faturamento[] = [{ clienteId: 'd', data: '2026-11-03', marcadoEm: '', marcadoPor: '', origem: 'manual' }];
    const s = situacaoFaturas(clientes, envios, marc, '2026-11');
    expect([...s.entries()].map(([k, v]) => [k, v.estado])).toEqual([
      ['a', 'faturado'],
      ['b', 'devolvido'],
      ['c', 'pendente'],
      ['d', 'faturado'],
      ['e', 'pendente'],
    ]);
    expect(s.get('a')).toMatchObject({ numeros: ['10'], quando: '2026-11-05' });
    expect(s.get('d')).toMatchObject({ manual: true, quando: '2026-11-03' });
    // um reenvio que chegou depois do que voltou: faturado
    expect(situacaoFaturas([{ id: 'b' }], [...envios, env('b', '2026-11', 'enviado', '11', '2026-11-07T10:00:00Z')], [], '2026-11').get('b')?.estado).toBe('faturado');
    const r = resumirFaturas(
      [
        { clienteId: 'a', valor: 100 },
        { clienteId: 'a', valor: 50 },
        { clienteId: 'b', valor: 30 },
        { clienteId: 'c', valor: 20 },
      ],
      s,
    );
    expect(r).toMatchObject({ locacoes: 4, faturadas: 2, devolvidas: 1, pendentes: 1, valorFaturado: 150, valorDevolvido: 30, valorPendente: 20, clientesPendentes: 1 });
  });
});
