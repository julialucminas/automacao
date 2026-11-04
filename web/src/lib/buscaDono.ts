/*
 * Busca do app do dono: o que ele digita do jeito que fala.
 * "motor de partida frota 40" → peça "motor partida" na FT40
 * "ft40 bateria", "40 bateria", "bateria da 40" → bateria na FT40
 * "frota 12" → a ficha da FT12 e tudo o que foi feito nela
 */
import type { PecaHistorico } from '../types';

const PALAVRAS_VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'NA', 'NO', 'EM', 'A', 'O', 'E', 'QUANDO', 'TROCOU', 'TROCA', 'TROCADO', 'QUEM', 'QUE', 'COM', 'PARA']);

export type Pergunta = { frota: string | null; termos: string[] };

export function interpretar(texto: string): Pergunta {
  let s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[?.,;!]/g, ' ');
  let frota: string | null = null;
  const comPalavra = /\b(?:FROTA|FT|MAQUINA|EMPILHADEIRA)\s*-?\s*(\d{1,4}[A-Z]?)\b/.exec(s);
  if (comPalavra) {
    frota = comPalavra[1];
    s = s.replace(comPalavra[0], ' ');
  } else {
    // número solto de 1 a 3 dígitos é a frota ("bateria da 40"); códigos de peça costumam ser maiores
    const solto = /(?:^|\s)(\d{1,3})(?=\s|$)/.exec(s);
    if (solto) {
      frota = solto[1];
      s = s.replace(solto[0], ' ');
    }
  }
  const termos = s.split(/\s+/).filter((p) => p && !PALAVRAS_VAZIAS.has(p));
  return { frota, termos };
}

export type ResumoBusca = {
  lancamentos: number;
  dias: number;
  total: number;
  ultima: string | null;
  /** média de dias entre uma visita e outra (quando há pelo menos duas) */
  mediaEntre: number | null;
  porFrota: { frota: string; lancamentos: number; total: number; ultima: string }[];
};

export function resumir(itens: PecaHistorico[]): ResumoBusca {
  const dias = [...new Set(itens.map((i) => i.data))].sort();
  let mediaEntre: number | null = null;
  if (dias.length >= 2) {
    const span = (Date.parse(dias[dias.length - 1]) - Date.parse(dias[0])) / 86_400_000;
    mediaEntre = Math.round(span / (dias.length - 1));
  }
  const m = new Map<string, { frota: string; lancamentos: number; total: number; ultima: string }>();
  for (const i of itens) {
    if (!i.frota) continue;
    const x = m.get(i.frota) ?? { frota: i.frota, lancamentos: 0, total: 0, ultima: '' };
    x.lancamentos++;
    x.total += i.valorTotal;
    if (i.data > x.ultima) x.ultima = i.data;
    m.set(i.frota, x);
  }
  return {
    lancamentos: itens.length,
    dias: dias.length,
    total: itens.reduce((s, i) => s + i.valorTotal, 0),
    ultima: dias[dias.length - 1] ?? null,
    mediaEntre,
    porFrota: [...m.values()].sort((a, b) => b.total - a.total || b.lancamentos - a.lancamentos),
  };
}
