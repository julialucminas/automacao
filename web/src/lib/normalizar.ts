/** Remove acentos: "CERÂMICA" → "CERAMICA". */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const SUFIXOS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S A', 'MEI']);

/**
 * Chave usada para comparar nomes de empresa.
 * Ignora acentos, maiúsculas/minúsculas, pontuação, espaços extras e sufixos societários.
 * "Cerâmica Santa Luzia Ltda." e "CERAMICA  SANTA LUZIA" geram a mesma chave.
 */
export function chaveEmpresa(nome: string): string {
  let s = semAcento(nome).toUpperCase();
  s = s.replace(/S\/A\b/g, 'SA');
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim();
  const partes = s.split(' ');
  // remove sufixos só do fim ("ME" no meio do nome é mantido)
  while (partes.length > 1) {
    const ult = partes[partes.length - 1];
    const ult2 = partes.slice(-2).join(' ');
    if (SUFIXOS.has(ult2) && partes.length > 2) partes.splice(-2, 2);
    else if (SUFIXOS.has(ult)) partes.pop();
    else break;
  }
  return partes.join(' ');
}

/** Número da fatura sem zeros à esquerda: "001234" → "1234". */
export function normalizarNumero(n: string): string {
  const s = n.replace(/^0+/, '');
  return s === '' ? '0' : s;
}

export function emailValido(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
