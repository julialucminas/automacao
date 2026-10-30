/** Valores em centavos (inteiros) para não ter erro de arredondamento. */

const FORMATO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatarReais = (centavos: number) => FORMATO.format(centavos / 100);

/** "1.234,56" / "1234,5" / "R$ 1.234" / "1234.56" → centavos. Devolve null se não for um valor. */
export function lerReais(texto: string): number | null {
  let s = texto.replace(/R\$|\s/gi, '').trim();
  if (!s) return null;
  const temVirgula = s.includes(',');
  if (temVirgula) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234.567 sem decimais
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Centavos → texto para editar no campo ("1234,56"). */
export const reaisParaCampo = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');
