/*
 * Trabalho do técnico sem internet.
 * Tudo o que ele faz numa OS entra numa fila guardada no próprio celular (IndexedDB) e é enviado,
 * na ordem, assim que a conexão volta. As OS baixadas ficam guardadas para abrir sem sinal.
 */
import { api } from '../api';
import type { ExecucaoOS, LocalOS, Ordem } from '../types';

export type Operacao =
  | { tipo: 'checkin'; id: string; local: Partial<LocalOS> }
  | { tipo: 'salvar'; id: string; dados: Partial<ExecucaoOS> & { aguardandoPeca?: boolean } }
  | { tipo: 'foto'; id: string; imagem: string }
  | { tipo: 'tirarFoto'; id: string; nome: string }
  | { tipo: 'assinatura'; id: string; imagem: string; nome: string }
  | { tipo: 'concluir'; id: string; local: Partial<LocalOS> };
export type ItemFila = Operacao & { chave: number; criadaEm: string };

const BANCO = 'lucminas-campo';
const FILA = 'fila';
const CACHE = 'cache';

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(FILA, { keyPath: 'chave', autoIncrement: true });
      r.result.createObjectStore(CACHE);
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function tx<T>(loja: string, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction(loja, modo);
    const req = f(t.objectStore(loja));
    t.oncomplete = () => ok(req.result);
    t.onerror = () => erro(t.error);
  });
}

export const guardar = (chave: string, valor: unknown) => tx(CACHE, 'readwrite', (s) => s.put(valor, chave)).catch(() => undefined);
export const lerGuardado = <T>(chave: string) => tx<T | undefined>(CACHE, 'readonly', (s) => s.get(chave) as IDBRequest<T | undefined>).catch(() => undefined);

export async function enfileirar(op: Operacao) {
  // vários "salvar" seguidos da mesma OS viram um só (o último dado de cada campo vale)
  if (op.tipo === 'salvar') {
    const fila = await listarFila();
    const ultimo = fila[fila.length - 1];
    // não junta com o que está sendo enviado agora (senão a mudança some quando o envio termina)
    if (ultimo && ultimo.tipo === 'salvar' && ultimo.id === op.id && ultimo.chave !== emEnvio) {
      await tx(FILA, 'readwrite', (s) => s.put({ ...ultimo, dados: { ...ultimo.dados, ...op.dados } }));
      return;
    }
  }
  await tx(FILA, 'readwrite', (s) => s.add({ ...op, criadaEm: new Date().toISOString() }));
}
export const listarFila = () => tx<ItemFila[]>(FILA, 'readonly', (s) => s.getAll() as IDBRequest<ItemFila[]>).catch(() => [] as ItemFila[]);
const tirar = (chave: number) => tx(FILA, 'readwrite', (s) => s.delete(chave));

/** Erro de rede (sem sinal) x erro do servidor (a operação não vai dar certo nunca). */
const semConexao = (e: unknown) => e instanceof Error && /Sem conexão|demorou demais/.test(e.message);

/** Aplica a operação na cópia local da OS, para a tela mostrar na hora mesmo sem sinal. */
export function aplicarLocal(o: Ordem, op: Operacao): Ordem {
  const ex = { ...o.execucao };
  switch (op.tipo) {
    case 'checkin':
      return {
        ...o,
        status: o.status === 'aguardando_peca' ? o.status : 'execucao',
        execucao: { ...ex, checkin: ex.checkin ?? { em: new Date().toISOString(), lat: op.local.lat ?? null, lng: op.local.lng ?? null, precisao: op.local.precisao ?? null } },
      };
    case 'salvar': {
      const { aguardandoPeca, ...d } = op.dados;
      return {
        ...o,
        status: aguardandoPeca === true ? 'aguardando_peca' : aguardandoPeca === false && o.status === 'aguardando_peca' ? 'execucao' : o.status,
        execucao: { ...ex, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) },
      };
    }
    case 'foto':
      return { ...o, execucao: { ...ex, fotos: [...(ex.fotos ?? []), `pendente:${op.imagem.slice(-12)}`] } };
    case 'tirarFoto':
      return { ...o, execucao: { ...ex, fotos: (ex.fotos ?? []).filter((f) => f !== op.nome) } };
    case 'assinatura':
      return { ...o, execucao: { ...ex, assinatura: 'pendente', assinadoPor: op.nome } };
    case 'concluir':
      return { ...o, status: 'concluida', concluidaEm: new Date().toISOString() };
  }
}

async function executar(op: Operacao): Promise<Ordem> {
  switch (op.tipo) {
    case 'checkin':
      return api.checkinOrdem(op.id, op.local);
    case 'salvar':
      return api.salvarExecucao(op.id, op.dados);
    case 'foto':
      return api.fotoOrdem(op.id, op.imagem);
    case 'tirarFoto':
      return api.tirarFotoOrdem(op.id, op.nome);
    case 'assinatura':
      return api.assinarOrdem(op.id, op.imagem, op.nome);
    case 'concluir':
      return api.concluirOrdem(op.id, op.local);
  }
}

let rodando = false;
let emEnvio: number | null = null;
/**
 * Envia a fila, em ordem. Para no primeiro erro de rede (tenta de novo depois).
 * Erro do servidor (ex.: "falta preencher o horímetro") tira a operação da fila e é devolvido para a tela mostrar.
 */
export async function sincronizar(): Promise<{ enviadas: number; restam: number; erros: string[]; atualizadas: Ordem[] }> {
  if (rodando) return { enviadas: 0, restam: (await listarFila()).length, erros: [], atualizadas: [] };
  rodando = true;
  const erros: string[] = [];
  const atualizadas: Ordem[] = [];
  let enviadas = 0;
  try {
    for (const item of await listarFila()) {
      try {
        emEnvio = item.chave;
        atualizadas.push(await executar(item));
        await tirar(item.chave);
        enviadas++;
      } catch (e) {
        if (semConexao(e)) break;
        await tirar(item.chave);
        erros.push(e instanceof Error ? e.message : 'Erro ao enviar.');
      }
    }
  } finally {
    rodando = false;
    emEnvio = null;
  }
  return { enviadas, restam: (await listarFila()).length, erros, atualizadas };
}

/** Foto do celular → JPEG de no máximo 1600 px (fica entre 150 e 400 KB). */
export async function reduzirFoto(arquivo: File, max = 1600, qualidade = 0.72): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = erro;
      img.src = url;
    });
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', qualidade).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Localização do celular (para o check-in). Sem permissão ou sem GPS, segue sem localização. */
export function pegarLocal(): Promise<Partial<LocalOS>> {
  return new Promise((ok) => {
    if (!('geolocation' in navigator)) return ok({});
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, precisao: Math.round(p.coords.accuracy) }),
      () => ok({}),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
