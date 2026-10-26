import JSZip from 'jszip';
import type { ArquivoLido } from '../types';

/*
 * Lê os arquivos que o financeiro selecionou ou arrastou: PDFs soltos, pastas (com subpastas) e .zip.
 * Devolve só os PDFs; o resto vai para "ignorados" (para mostrar, não para travar).
 */

export type ResultadoLeitura = { arquivos: ArquivoLido[]; ignorados: string[] };

function nomeBase(caminho: string): string {
  const partes = caminho.split(/[\\/]/);
  return partes[partes.length - 1];
}

function ehLixoDeSistema(caminho: string): boolean {
  const base = nomeBase(caminho);
  return (
    caminho.includes('__MACOSX') ||
    base.startsWith('.') ||
    base.startsWith('~$') ||
    /^thumbs\.db$/i.test(base) ||
    /^desktop\.ini$/i.test(base)
  );
}

// Zips criados no Windows em português costumam gravar nomes em CP850 (sem a marca de UTF-8).
// Tentamos UTF-8 primeiro; se não for UTF-8 válido, decodificamos como CP850.
const CP850_ALTO =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

export function decodificarNomeZip(bytes: Uint8Array | string[] | string): string {
  if (typeof bytes === 'string') return bytes;
  const arr = Array.isArray(bytes) ? Uint8Array.from(bytes.map((b) => b.charCodeAt(0))) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(arr);
  } catch {
    let s = '';
    for (const b of arr) s += b < 0x80 ? String.fromCharCode(b) : CP850_ALTO[b - 0x80];
    return s;
  }
}

async function lerZip(arquivo: Blob, nomeZip: string, saida: ResultadoLeitura): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arquivo, { decodeFileName: decodificarNomeZip });
  } catch {
    saida.ignorados.push(`${nomeZip} (não foi possível abrir o .zip)`);
    return;
  }
  const entradas = Object.values(zip.files).filter((e) => !e.dir);
  for (const e of entradas) {
    const caminho = `${nomeZip}/${e.name}`;
    if (ehLixoDeSistema(e.name)) continue;
    const base = nomeBase(e.name);
    if (/\.pdf$/i.test(base)) {
      const blob = await e.async('blob');
      saida.arquivos.push({ nome: base, caminho, blob: new Blob([blob], { type: 'application/pdf' }) });
    } else if (/\.zip$/i.test(base)) {
      await lerZip(await e.async('blob'), caminho, saida);
    } else {
      saida.ignorados.push(caminho);
    }
  }
}

async function adicionar(file: File, caminho: string, saida: ResultadoLeitura): Promise<void> {
  if (ehLixoDeSistema(caminho)) return;
  if (/\.pdf$/i.test(file.name)) saida.arquivos.push({ nome: file.name, caminho, blob: file });
  else if (/\.zip$/i.test(file.name)) await lerZip(file, caminho, saida);
  else saida.ignorados.push(caminho);
}

/** Arquivos vindos de <input type="file"> (com ou sem webkitdirectory). */
export async function lerArquivos(files: FileList | File[]): Promise<ResultadoLeitura> {
  const saida: ResultadoLeitura = { arquivos: [], ignorados: [] };
  for (const f of Array.from(files)) {
    const caminho = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    await adicionar(f, caminho, saida);
  }
  return saida;
}

// --- arrastar e soltar (inclui pastas inteiras) ---

function lerEntradasDeDiretorio(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const leitor = dir.createReader();
  const todas: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const lote = () =>
      leitor.readEntries((ents) => {
        if (ents.length === 0) resolve(todas);
        else {
          todas.push(...ents);
          lote(); // readEntries devolve no máximo ~100 por vez
        }
      }, reject);
    lote();
  });
}

async function percorrer(entry: FileSystemEntry, saida: ResultadoLeitura): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    await adicionar(file, entry.fullPath.replace(/^\//, ''), saida);
  } else if (entry.isDirectory) {
    for (const filho of await lerEntradasDeDiretorio(entry as FileSystemDirectoryEntry)) {
      await percorrer(filho, saida);
    }
  }
}

export async function lerSoltura(dt: DataTransfer): Promise<ResultadoLeitura> {
  const saida: ResultadoLeitura = { arquivos: [], ignorados: [] };
  const entradas = Array.from(dt.items)
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entradas.length === 0) return lerArquivos(dt.files);
  for (const e of entradas) await percorrer(e, saida);
  return saida;
}

/** Nome sugerido para o lote: a pasta ou o zip de onde vieram os arquivos. */
export function origemDosArquivos(r: ResultadoLeitura): string {
  const primeiro = r.arquivos[0]?.caminho ?? '';
  const raiz = primeiro.split(/[\\/]/)[0];
  return raiz && raiz !== r.arquivos[0]?.nome ? raiz : `${r.arquivos.length} arquivos`;
}
