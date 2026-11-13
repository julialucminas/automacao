import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { FotoEquipamento } from '../types';
import { reduzirFoto } from '../lib/filaOffline';
import { Modal } from './ui';

const url = (f: FotoEquipamento) => `/api/equipamentos/fotos/${f.id}`;

/** Fotos da empilhadeira na ficha: tirar/escolher várias de uma vez (já reduzidas), ver em tela cheia e apagar. */
export function FotosEquipamento({ frota, edita }: { frota: string; edita: boolean }) {
  const { avisar } = useEstado();
  const [fotos, setFotos] = useState<FotoEquipamento[] | null>(null);
  const [enviando, setEnviando] = useState(0);
  const [aberta, setAberta] = useState<FotoEquipamento | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setFotos(null);
    api.listarFotosEquip(frota).then(setFotos, () => setFotos([]));
  }, [frota]);

  const enviar = async (lista: File[]) => {
    const imagens = lista.filter((a) => a.type.startsWith('image/'));
    if (imagens.length < lista.length) avisar('Só fotos (JPG, PNG, HEIC do iPhone…).', 'bad');
    setEnviando(imagens.length);
    for (const a of imagens) {
      try {
        const nova = await api.enviarFotoEquip(frota, await reduzirFoto(a), '');
        setFotos((v) => [nova, ...(v ?? [])]);
      } catch (e) {
        avisar(e instanceof Error ? e.message : 'Não foi possível enviar a foto.', 'bad');
      }
      setEnviando((n) => n - 1);
    }
  };
  const apagar = async (f: FotoEquipamento) => {
    try {
      await api.apagarFotoEquip(f.id);
      setFotos((v) => (v ?? []).filter((x) => x.id !== f.id));
      setAberta(null);
      avisar('Foto apagada.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível apagar.', 'bad');
    }
  };

  return (
    <section aria-label="Fotos" className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Fotos{fotos?.length ? ` · ${fotos.length}` : ''}</h3>
        {edita && (
          <>
            <input
              ref={ref}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label="Escolher fotos"
              onChange={(e) => {
                const l = [...(e.target.files ?? [])];
                e.target.value = '';
                if (l.length) void enviar(l);
              }}
            />
            <button type="button" className="btn-secondary btn-sm" disabled={enviando > 0} onClick={() => ref.current?.click()}>
              {enviando > 0 ? `Enviando ${enviando}…` : '+ Pôr fotos'}
            </button>
          </>
        )}
      </div>
      {fotos === null ? (
        <p className="text-[13px] text-ink-3">Carregando…</p>
      ) : fotos.length === 0 ? (
        <p className="text-[13px] text-ink-3">{edita ? 'Nenhuma foto ainda. Pelo celular, dá para tirar a foto na hora.' : 'Nenhuma foto.'}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setAberta(f)} className="block aspect-square w-full overflow-hidden rounded-lg border border-line bg-line-soft">
                <img src={url(f)} alt={f.legenda || `Foto da FT${frota}`} loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberta && (
        <Modal aberto fechar={() => setAberta(null)} titulo={`FT${frota} · foto`}>
          <img src={url(aberta)} alt={aberta.legenda || `Foto da FT${frota}`} className="max-h-[70vh] w-full rounded-lg object-contain" />
          <p className="text-[12.5px] text-ink-3">
            {new Date(aberta.enviadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            {aberta.por ? ` · ${aberta.por}` : ''}
          </p>
          <div className="flex justify-end gap-2">
            <a className="btn-secondary" href={url(aberta)} target="_blank" rel="noopener">
              Abrir em outra aba
            </a>
            {edita && (
              <button type="button" className="btn-secondary text-bad" onClick={() => void apagar(aberta)}>
                Apagar foto
              </button>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
