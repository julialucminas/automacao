import { useRef, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Movimentacao } from '../types';

/** Endereço para abrir o arquivo da NF-e de uma movimentação (o login vai no cookie). */
export const urlNfe = (m: Pick<Movimentacao, 'id'>) => `/api/movimentacoes/${m.id}/nfe`;

const MAX = 6 * 1024 * 1024;

/** Lê o arquivo escolhido em base64 (sem o prefixo data:). */
export function lerBase64(arq: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(arq);
  });
}

/** Confere tipo e tamanho antes de mandar. Devolve a mensagem de erro, ou '' se estiver tudo certo. */
export function problemaNfe(arq: File): string {
  if (!/\.(pdf|xml)$/i.test(arq.name)) return 'A NF-e precisa ser o PDF (DANFE) ou o XML da nota.';
  if (arq.size > MAX) return 'Arquivo grande demais (máximo 6 MB).';
  return '';
}

/** Do XML da NF-e: número da nota, valor total (em reais, texto) e data de emissão. */
export async function lerXmlNfe(arq: File): Promise<{ numero: string; valor: string; data: string } | null> {
  if (!/\.xml$/i.test(arq.name)) return null;
  try {
    const doc = new DOMParser().parseFromString(await arq.text(), 'application/xml');
    const tag = (n: string) => doc.getElementsByTagNameNS('*', n)[0]?.textContent?.trim() ?? '';
    const numero = tag('nNF');
    if (!numero) return null;
    return { numero, valor: tag('vNF'), data: (tag('dhEmi') || tag('dEmi')).slice(0, 10) };
  } catch {
    return null;
  }
}

/** Botão de escolher arquivo (PDF ou XML). */
export function EscolherNfe({ rotulo, escolher, className = 'btn-secondary' }: { rotulo: string; escolher: (a: File) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.xml,application/pdf,text/xml,application/xml"
        className="hidden"
        aria-label={rotulo}
        onChange={(e) => {
          const a = e.target.files?.[0];
          e.target.value = '';
          if (a) escolher(a);
        }}
      />
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {rotulo}
      </button>
    </>
  );
}

/** No cartão da movimentação (venda/compra): ver, anexar, trocar ou tirar a NF-e. */
export function NfeAnexo({ m }: { m: Movimentacao }) {
  const { pode, recarregarOperacoes } = useEstado();
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (m.tipo !== 'venda' && m.tipo !== 'compra') return null;
  const arq = m.dados.nfArquivo;
  const edita = pode('movimentacoes', 2) && m.status !== 'rejeitada';
  if (!arq && !edita) return null;

  const enviar = async (a: File) => {
    const p = problemaNfe(a);
    if (p) return setErro(p);
    setErro('');
    setEnviando(true);
    try {
      await api.anexarNfe(m.id, await lerBase64(a), a.name);
      await recarregarOperacoes();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível anexar.');
    } finally {
      setEnviando(false);
    }
  };
  const tirar = async () => {
    setEnviando(true);
    try {
      await api.tirarNfe(m.id);
      await recarregarOperacoes();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível tirar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#F8F7F3] px-3 py-2 text-[13px]">
        <span className="font-semibold text-ink-2">NF-e</span>
        {arq ? (
          <a href={urlNfe(m)} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-semibold text-info underline">
            {arq.nome} <span className="font-normal text-ink-3">({arq.ext.toUpperCase()})</span>
          </a>
        ) : (
          <span className="flex-1 text-ink-3">nenhum arquivo anexado</span>
        )}
        {edita &&
          (enviando ? (
            <span className="text-ink-3">Enviando…</span>
          ) : (
            <span className="flex gap-1.5">
              <EscolherNfe rotulo={arq ? 'Trocar' : 'Anexar NF-e'} escolher={(a) => void enviar(a)} className="btn-secondary h-9 px-3 text-[13px]" />
              {arq && (
                <button type="button" className="btn-secondary h-9 px-3 text-[13px]" onClick={() => void tirar()}>
                  Tirar
                </button>
              )}
            </span>
          ))}
      </div>
      {erro && (
        <p role="alert" className="text-[13px] text-bad-strong">
          {erro}
        </p>
      )}
    </div>
  );
}
