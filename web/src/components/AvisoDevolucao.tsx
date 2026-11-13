import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Equipamento } from '../types';
import { dataBr, hojeIso } from '../lib/calendario';
import { avisoDevolucao, ETIQUETAS_SUGERIDAS, juntarEtiquetas, lerEtiquetas } from '../lib/etiquetas';

/** Selo "devolução avisada" (lista de locações, equipamentos). */
export function SeloDevolucao({ ficha }: { ficha: Equipamento | null | undefined }) {
  const a = avisoDevolucao(ficha);
  if (!a) return null;
  const atrasada = !!a.prevista && a.prevista < hojeIso();
  return (
    <span
      title={`Cliente avisou${a.avisadaEm ? ` em ${dataBr(a.avisadaEm)}` : ''} que vai devolver${a.prevista ? ` (previsto ${dataBr(a.prevista)})` : ''}${a.obs ? ` · ${a.obs}` : ''}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-sans text-[11px] font-bold ${atrasada ? 'bg-bad-soft text-bad-strong' : 'bg-warn-soft text-warn-strong'}`}
    >
      ↩ devolve{a.prevista ? ` ${dataBr(a.prevista).slice(0, 5)}` : ''}
    </span>
  );
}

/** Etiquetas da máquina, como chips. */
export function ChipsEtiquetas({ ficha }: { ficha: Equipamento | null | undefined }) {
  const l = lerEtiquetas(ficha?.etiquetas);
  if (!l.length) return null;
  return (
    <>
      {l.map((e) => (
        <span key={e} className="inline-flex whitespace-nowrap rounded-full border border-line-strong bg-white px-2 py-0.5 font-sans text-[11px] font-semibold text-ink-2">
          🏷 {e}
        </span>
      ))}
    </>
  );
}

/**
 * Aviso de devolução + etiquetas, para a ficha e para a gaveta da locação.
 * Fica na ficha da máquina; o aviso sai sozinho quando a devolução é registrada.
 */
export function AvisoEEtiquetas({ frota, ficha, emUso = [], locada = true, salvo }: { frota: string; ficha: Equipamento | null | undefined; emUso?: string[]; locada?: boolean; salvo: (e: Equipamento) => void }) {
  const { pode, avisar } = useEstado();
  const edita = pode('frotas', 2);
  const registra = pode('movimentacoes', 2);
  const aviso = avisoDevolucao(ficha);
  const [editando, setEditando] = useState(false);
  const [d, setD] = useState({ em: '', prevista: '', obs: '' });
  const [nova, setNova] = useState('');
  const [salvando, setSalvando] = useState(false);
  const etiquetas = lerEtiquetas(ficha?.etiquetas);
  const sugestoes = [...new Set([...ETIQUETAS_SUGERIDAS, ...emUso])].filter((s) => !etiquetas.some((e) => e.toLowerCase() === s.toLowerCase()));

  const salvar = async (dados: Partial<Equipamento>, msg: string) => {
    setSalvando(true);
    try {
      salvo(await api.salvarEquipamento(frota, dados));
      avisar(msg);
      return true;
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
      return false;
    } finally {
      setSalvando(false);
    }
  };
  const abrir = () => {
    setD({ em: aviso?.avisadaEm ?? hojeIso(), prevista: aviso?.prevista ?? '', obs: aviso?.obs ?? '' });
    setEditando(true);
  };
  const gravarAviso = async () => {
    if (!d.em) return avisar('Informe quando o cliente avisou.', 'bad');
    if (d.prevista && d.prevista < d.em) return avisar('A previsão de saída é antes do aviso.', 'bad');
    if (await salvar({ devolucaoAvisada: 'sim', devolucaoAvisadaEm: d.em, devolucaoPrevista: d.prevista || null, devolucaoObs: d.obs.trim() || null }, `FT${frota}: devolução avisada.`)) setEditando(false);
  };
  const mudarEtiquetas = (l: string[]) => void salvar({ etiquetas: juntarEtiquetas(l) || null }, 'Etiquetas salvas.');

  return (
    <section aria-label="Aviso de devolução e etiquetas" className="flex flex-col gap-2.5">
      {aviso && !editando && (
        <div className="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[13.5px]">
          <div className="font-bold text-warn-strong">↩ O cliente avisou que vai devolver</div>
          <div className="text-ink-2">
            {aviso.avisadaEm && <>Avisou em {dataBr(aviso.avisadaEm)}</>}
            {aviso.prevista && <> · previsão de saída <b>{dataBr(aviso.prevista)}</b></>}
            {aviso.prevista && aviso.prevista < hojeIso() && <b className="text-bad"> (já passou)</b>}
            {aviso.obs && <span className="block whitespace-pre-wrap">{aviso.obs}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {registra && (
              <Link to={`/movimentacoes?nova=devolucao&frota=${encodeURIComponent(frota)}`} className="btn-primary btn-sm">
                Registrar a devolução
              </Link>
            )}
            {edita && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={abrir}>
                  Editar aviso
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={salvando}
                  onClick={() => void salvar({ devolucaoAvisada: null, devolucaoAvisadaEm: null, devolucaoPrevista: null, devolucaoObs: null }, 'Aviso retirado: a máquina continua no cliente.')}
                >
                  Cliente desistiu
                </button>
              </>
            )}
          </div>
          <p className="text-[11.5px] text-ink-3">Some sozinho quando a devolução for registrada em Movimentações.</p>
        </div>
      )}
      {!aviso && !editando && edita && locada && (
        <button type="button" className="btn-secondary btn-sm self-start" onClick={abrir}>
          ↩ Cliente avisou que vai devolver
        </button>
      )}
      {editando && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-[#F8F7F3] p-3.5">
          <div className="text-[13.5px] font-bold">O cliente avisou que vai devolver a FT{frota}</div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
              Avisou em
              <input type="date" className="input" value={d.em} onChange={(e) => setD({ ...d, em: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
              Previsão de saída <span className="font-normal text-ink-3">(se combinou)</span>
              <input type="date" className="input" value={d.prevista} onChange={(e) => setD({ ...d, prevista: e.target.value })} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
            O que foi combinado <span className="font-normal text-ink-3">(quem avisou, motivo, retirada…)</span>
            <textarea rows={2} className="input resize-y py-2 text-[13px] font-normal" value={d.obs} onChange={(e) => setD({ ...d, obs: e.target.value })} placeholder="Ex.: João avisou por WhatsApp, a obra acaba no fim do mês; buscar com o caminhão" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={salvando} onClick={() => void gravarAviso()}>
              {salvando ? 'Salvando…' : 'Salvar aviso'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Etiquetas</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {etiquetas.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full border border-ink bg-white px-2.5 py-1 text-[12px] font-semibold">
              🏷 {e}
              {edita && (
                <button type="button" aria-label={`Tirar a etiqueta ${e}`} className="ml-0.5 text-ink-3 hover:text-bad" disabled={salvando} onClick={() => mudarEtiquetas(etiquetas.filter((x) => x !== e))}>
                  ×
                </button>
              )}
            </span>
          ))}
          {!etiquetas.length && <span className="text-[12.5px] text-ink-3">Nenhuma.</span>}
        </div>
        {edita && (
          <>
            <form
              className="flex gap-1.5"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!nova.trim()) return;
                mudarEtiquetas([...etiquetas, nova.trim()]);
                setNova('');
              }}
            >
              <input aria-label="Nova etiqueta" className="input min-h-[34px] flex-1 py-1 text-[13px]" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova etiqueta" maxLength={40} />
              <button type="submit" className="btn-secondary btn-sm" disabled={!nova.trim() || salvando}>
                + Pôr
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {sugestoes.slice(0, 10).map((s) => (
                <button key={s} type="button" disabled={salvando} className="rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-[12px] text-ink-2 hover:border-ink" onClick={() => mudarEtiquetas([...etiquetas, s])}>
                  + {s}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Chip "+ adicionais" na lista (passa o mouse para ver quais). */
export function ChipAdicionais({ ficha }: { ficha: Equipamento | null | undefined }) {
  if (!ficha?.adicionais) return null;
  return (
    <span title={`Adicionais: ${ficha.adicionais}`} className="inline-flex max-w-[220px] truncate whitespace-nowrap rounded-full bg-info-soft px-2 py-0.5 font-sans text-[11px] font-semibold text-info">
      + {ficha.adicionais}
    </span>
  );
}

/** Adicionais da locação (prolongador, bateria, carregador…), vistos e editados na gaveta da locação. */
export function AdicionaisDaLocacao({ frota, ficha, salvo }: { frota: string; ficha: Equipamento | null | undefined; salvo: (e: Equipamento) => void }) {
  const { pode, avisar } = useEstado();
  const edita = pode('frotas', 2);
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState('');
  const [salvando, setSalvando] = useState(false);
  const atual = ficha?.adicionais ?? '';
  const SUG = ['Prolongador de garfo', 'Bateria', 'Carregador', 'Bateria reserva', 'Posicionador de garfo'];
  const lista = v.split(/\s*,\s*/).filter(Boolean);
  const tem = (x: string) => lista.some((y) => y.toLowerCase() === x.toLowerCase());
  const salvar = async () => {
    setSalvando(true);
    try {
      salvo(await api.salvarEquipamento(frota, { adicionais: v.trim() || null }));
      avisar('Adicionais salvos.');
      setEditando(false);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <section aria-label="Adicionais" className="flex flex-col gap-1.5 rounded-xl border border-line bg-white px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Adicionais</div>
        {edita && !editando && (
          <button type="button" className="text-[12.5px] font-semibold text-info underline" onClick={() => {
              setV(atual);
              setEditando(true);
            }}>
            {atual ? 'Editar' : '+ Pôr adicionais'}
          </button>
        )}
      </div>
      {!editando ? (
        <div className="text-[13.5px]">{atual ? <b>{atual}</b> : <span className="text-ink-3">Nenhum (prolongador de garfo, bateria, carregador…)</span>}</div>
      ) : (
        <>
          <input aria-label="Adicionais" autoFocus className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="Ex.: prolongador de garfo 1,80 m, carregador" />
          <div className="flex flex-wrap gap-1.5">
            {SUG.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={tem(x)}
                onClick={() => setV((tem(x) ? lista.filter((y) => y.toLowerCase() !== x.toLowerCase()) : [...lista, x]).join(', '))}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${tem(x) ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}
              >
                {tem(x) ? '✓ ' : '+ '}
                {x}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
