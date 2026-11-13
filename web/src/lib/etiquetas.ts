import type { Equipamento } from '../types';

/** Sugestões de etiquetas (a pessoa pode criar outras; as já usadas também aparecem como sugestão). */
export const ETIQUETAS_SUGERIDAS = ['Negociando', 'Vai renovar', 'Pagamento atrasado', 'Manutenção pendente', 'Prioridade', 'Cliente difícil'];

export const lerEtiquetas = (t: string | null | undefined): string[] =>
  [...new Set((t ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
export const juntarEtiquetas = (l: string[]) => [...new Set(l.map((x) => x.trim()).filter(Boolean))].join(', ');

/** Todas as etiquetas em uso na frota (para sugerir e filtrar). */
export const etiquetasEmUso = (fichas: Equipamento[]) => [...new Set(fichas.flatMap((f) => lerEtiquetas(f.etiquetas)))].sort((a, b) => a.localeCompare(b));

export type AvisoDevolucao = { avisadaEm: string | null; prevista: string | null; obs: string };
/** O cliente avisou que vai devolver esta máquina? (sai sozinho quando a devolução é registrada) */
export function avisoDevolucao(f: Equipamento | null | undefined): AvisoDevolucao | null {
  if (!f || f.devolucaoAvisada !== 'sim') return null;
  return { avisadaEm: f.devolucaoAvisadaEm ?? null, prevista: f.devolucaoPrevista ?? null, obs: f.devolucaoObs ?? '' };
}
