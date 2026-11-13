/*
 * Histórico de preços de cada máquina, montado sozinho pelas movimentações aprovadas:
 * locação (entra com o valor), reajuste (de → para), troca (sai uma, entra outra) e devolução (sai).
 */
import type { Movimentacao } from '../types';

export type MudancaPreco = {
  movId: string;
  data: string;
  tipo: 'locacao' | 'reajuste' | 'troca_entra' | 'troca_sai' | 'devolucao';
  cliente: string;
  de: number | null;
  para: number | null;
  percentual: number | null;
};

export const ROTULO_PRECO: Record<MudancaPreco['tipo'], string> = {
  locacao: 'Locação',
  reajuste: 'Reajuste',
  troca_entra: 'Entrou na troca',
  troca_sai: 'Saiu na troca',
  devolucao: 'Devolução',
};

/** Do mais recente para o mais antigo. */
export function historicoPrecos(movs: Movimentacao[], frota: string): MudancaPreco[] {
  const r: MudancaPreco[] = [];
  const pct = (de: number | null, para: number | null) => (de && para ? Math.round(((para - de) / de) * 1000) / 10 : null);
  for (const m of movs) {
    if (m.status !== 'aprovada') continue;
    const base = { movId: m.id, data: m.dados.data, cliente: m.clienteNome };
    if (m.tipo === 'locacao' && m.frota === frota) r.push({ ...base, tipo: 'locacao', de: null, para: m.dados.valor ?? null, percentual: null });
    if (m.tipo === 'reajuste')
      for (const i of m.dados.itens ?? []) if (i.frota === frota) r.push({ ...base, tipo: 'reajuste', de: i.antes, para: i.novo, percentual: pct(i.antes, i.novo) });
    if (m.tipo === 'troca' && m.frotaNova === frota) r.push({ ...base, tipo: 'troca_entra', de: null, para: m.dados.valor ?? null, percentual: null });
    if (m.tipo === 'troca' && m.frota === frota) r.push({ ...base, tipo: 'troca_sai', de: m.dados.valorAnterior ?? null, para: null, percentual: null });
    if (m.tipo === 'devolucao' && m.frota === frota) r.push({ ...base, tipo: 'devolucao', de: m.dados.valorAnterior ?? null, para: null, percentual: null });
  }
  return r.sort((a, b) => b.data.localeCompare(a.data));
}
