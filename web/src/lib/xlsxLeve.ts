/*
 * Leitor de .xlsx enxuto, só com o que a importação precisa.
 * Existe porque a aba "HISTORICO auvo" da planilha do Júnior declara 16 mil colunas
 * (quase todas vazias) e o leitor comum tenta montar a grade inteira e trava o navegador.
 * Aqui só as primeiras colunas de cada linha são lidas.
 */
import JSZip from 'jszip';

export type Valor = string | number | boolean | null;

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const desescapar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? m;
  });

/** "A" → 0, "B" → 1, "AA" → 26 */
export const indiceColuna = (letras: string) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Número de série do Excel → AAAA-MM-DD */
export const serialParaIso = (v: number) => new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);

const textoDe = (xml: string) => desescapar([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

export type Pasta = { abas: string[]; ler(nome: string, maxColunas?: number): Promise<Valor[][]> };

export async function abrirXlsx(arquivo: Blob | ArrayBuffer | Uint8Array): Promise<Pasta> {
  const zip = await JSZip.loadAsync(arquivo);
  const ler = async (caminho: string) => {
    const f = zip.file(caminho);
    if (!f) throw new Error(`O arquivo não parece ser uma planilha do Excel (faltou ${caminho}).`);
    return f.async('string');
  };
  const wb = await ler('xl/workbook.xml');
  const rels = await ler('xl/_rels/workbook.xml.rels');
  const alvo = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const abas = new Map(
    [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const nome = desescapar(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
      const t = alvo.get(rid) ?? '';
      return [nome, t.startsWith('/') ? t.slice(1) : `xl/${t}`];
    }),
  );
  let compartilhados: string[] | null = null;
  const textos = async () => {
    if (compartilhados) return compartilhados;
    const f = zip.file('xl/sharedStrings.xml');
    compartilhados = f ? [...(await f.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1])) : [];
    return compartilhados;
  };

  return {
    abas: [...abas.keys()],
    async ler(nome, maxColunas = 40) {
      const caminho = abas.get(nome);
      if (!caminho) throw new Error(`A planilha não tem a aba "${nome}".`);
      const [xml, ss] = await Promise.all([ler(caminho), textos()]);
      const linhas: Valor[][] = [];
      const reLinha = /<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
      const reCel = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      for (let m = reLinha.exec(xml); m; m = reLinha.exec(xml)) {
        const n = Number(m[1]) - 1;
        const linha: Valor[] = [];
        if (m[2]) {
          reCel.lastIndex = 0;
          for (let c = reCel.exec(m[2]); c; c = reCel.exec(m[2])) {
            const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
            if (!ref) continue;
            const col = indiceColuna(ref);
            if (col >= maxColunas) break; // células vêm em ordem: o resto da linha não interessa
            const tipo = /\bt="(\w+)"/.exec(c[1])?.[1];
            const corpo = c[2] ?? '';
            const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
            let valor: Valor = null;
            if (tipo === 's') valor = v === undefined ? null : (ss[Number(v)] ?? null);
            else if (tipo === 'inlineStr') valor = textoDe(corpo);
            else if (tipo === 'str') valor = v === undefined ? null : desescapar(v);
            else if (tipo === 'b') valor = v === '1';
            else if (tipo === 'e') valor = null;
            else if (v !== undefined && v !== '') valor = Number(v);
            linha[col] = valor;
          }
        }
        for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = null;
        linhas[n] = linha;
      }
      for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
      return linhas;
    },
  };
}
