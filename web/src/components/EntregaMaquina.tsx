import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Entrega, ItemEntrega, Movimentacao } from '../types';
import { dataBr } from '../lib/calendario';
import { dataHora } from '../lib/email';
import { Modal } from './ui';

export const ITENS_PADRAO = [
  'Garfos e correntes do mastro',
  'Pneus',
  'Mangueiras sem vazamento',
  'Freio e freio de mão',
  'Direção',
  'Buzina, luzes e sinal de ré',
  'Cinto de segurança',
  'Extintor',
  'Gás / bateria carregada',
  'Painel e horímetro funcionando',
  'Lataria e pintura',
  'Limpeza',
];
const ESTADOS: { id: ItemEntrega['estado']; rotulo: string; cor: string }[] = [
  { id: 'ok', rotulo: 'OK', cor: 'border-ok bg-ok text-white' },
  { id: 'problema', rotulo: 'Problema', cor: 'border-bad bg-bad text-white' },
  { id: 'nao_tem', rotulo: 'Não tem', cor: 'border-ink-2 bg-ink-2 text-white' },
];
const urlVideo = (movId: string) => `/api/entregas/${movId}/video`;
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(b > 10 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB`);
export const frotaDaEntrega = (m: Movimentacao) => (m.tipo === 'troca' ? (m.frotaNova ?? m.frota) : m.frota);
export const temEntrega = (m: Movimentacao) => (m.tipo === 'locacao' || m.tipo === 'troca') && m.status !== 'rejeitada';

function resumo(e: Entrega) {
  const ck = e.checklist;
  if (!ck) return null;
  const problemas = ck.itens.filter((i) => i.estado === 'problema');
  return { problemas, ok: ck.itens.filter((i) => i.estado === 'ok').length, total: ck.itens.length };
}

/** Entrega no cartão da movimentação (locação/troca): checklist da saída e vídeo do transportador. */
export function EntregaDaMov({ m }: { m: Movimentacao }) {
  const { pode, avisar } = useEstado();
  const [e, setE] = useState<Entrega | null | undefined>(undefined);
  const [checklist, setChecklist] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [verVideo, setVerVideo] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const edita = pode('movimentacoes', 2);
  const frota = frotaDaEntrega(m);
  useEffect(() => {
    api.listarEntregas(frota).then((l) => setE(l.find((x) => x.movId === m.id) ?? null), () => setE(null));
  }, [m.id, frota]);
  if (!temEntrega(m) || e === undefined) return null;
  const r = e ? resumo(e) : null;

  const enviarVideo = async (arq: File) => {
    if (!/^video\//.test(arq.type) && !/\.(mp4|mov|3gp|webm|m4v)$/i.test(arq.name)) return avisar('Escolha o arquivo de vídeo (MP4 ou MOV).', 'bad');
    if (arq.size > 300 * 1024 * 1024) return avisar('Vídeo grande demais (máximo 300 MB).', 'bad');
    setProgresso(0);
    try {
      setE(await api.enviarVideoEntrega(m.id, arq, setProgresso));
      avisar('Vídeo da entrega anexado.');
    } catch (x) {
      avisar(x instanceof Error ? x.message : 'Não foi possível enviar o vídeo.', 'bad');
    } finally {
      setProgresso(null);
    }
  };

  return (
    <section aria-label="Entrega" className="mt-3 flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2.5 text-[13px]">
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Entrega da FT{frota}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <span className={r ? (r.problemas.length ? 'font-semibold text-warn-strong' : 'font-semibold text-ok') : 'font-semibold text-bad'}>
          {r ? (r.problemas.length ? `⚠ Checklist com ${r.problemas.length} problema${r.problemas.length > 1 ? 's' : ''}` : '✓ Checklist ok') : '○ Falta o checklist'}
        </span>
        {e?.checklist && (
          <span className="text-ink-3">
            {e.checklist.por} · {dataHora(e.checklist.em)}
            {e.checklist.horimetro !== null && ` · ${e.checklist.horimetro.toLocaleString('pt-BR')} h`}
          </span>
        )}
        {(edita || e?.checklist) && (
          <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={() => setChecklist(true)}>
            {e?.checklist ? (edita ? 'Ver / refazer' : 'Ver checklist') : 'Fazer checklist'}
          </button>
        )}
      </div>
      {r && r.problemas.length > 0 && (
        <ul className="list-disc pl-5 text-warn-strong">
          {r.problemas.map((p) => (
            <li key={p.item}>
              <b>{p.item}:</b> {p.obs}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={e?.video ? 'font-semibold text-ok' : 'font-semibold text-bad'}>{e?.video ? '✓ Vídeo da entrega' : '○ Falta o vídeo'}</span>
        {e?.video && (
          <span className="text-ink-3">
            {mb(e.video.tamanho)} · anexado por {e.video.por} em {dataHora(e.video.em)}
          </span>
        )}
        {e?.video && (
          <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={() => setVerVideo(!verVideo)}>
            {verVideo ? 'Esconder vídeo' : 'Assistir'}
          </button>
        )}
        {edita && (
          <>
            <input
              ref={ref}
              type="file"
              accept="video/*,.mp4,.mov"
              className="hidden"
              aria-label="Vídeo da entrega"
              onChange={(ev) => {
                const a = ev.target.files?.[0];
                ev.target.value = '';
                if (a) void enviarVideo(a);
              }}
            />
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" disabled={progresso !== null} onClick={() => ref.current?.click()}>
              {progresso !== null ? `Enviando ${Math.round(progresso * 100)}%…` : e?.video ? 'Trocar vídeo' : 'Anexar vídeo'}
            </button>
          </>
        )}
      </div>
      {progresso !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden>
          <div className="h-full bg-ok transition-all" style={{ width: `${Math.round(progresso * 100)}%` }} />
        </div>
      )}
      {verVideo && e?.video && <video controls playsInline preload="metadata" src={urlVideo(e.movId)} className="max-h-[420px] w-full rounded-lg bg-black" />}
      {edita && !e?.video && <p className="text-xs text-ink-3">O transportador manda o vídeo pelo WhatsApp: salve o vídeo no celular ou computador e anexe aqui.</p>}
      {checklist && <ChecklistEntrega m={m} frota={frota} atual={e ?? null} edita={edita} fechar={() => setChecklist(false)} salvo={setE} />}
    </section>
  );
}

/** Formulário do checklist da saída: cada item OK / Problema / Não tem, horímetro e observações. */
function ChecklistEntrega({ m, frota, atual, edita, fechar, salvo }: { m: Movimentacao; frota: string; atual: Entrega | null; edita: boolean; fechar: () => void; salvo: (e: Entrega) => void }) {
  const { config, avisar } = useEstado();
  const lista = (config?.['entrega.checklist'] ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const [itens, setItens] = useState<ItemEntrega[]>(() => atual?.checklist?.itens ?? (lista.length ? lista : ITENS_PADRAO).map((item) => ({ item, estado: '', obs: '' })));
  const [horimetro, setHorimetro] = useState(atual?.checklist?.horimetro != null ? String(atual.checklist.horimetro) : '');
  const [obs, setObs] = useState(atual?.checklist?.observacoes ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (i: number, d: Partial<ItemEntrega>) => setItens(itens.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const faltam = itens.filter((i) => !i.estado).length;

  const salvar = async () => {
    setErro('');
    if (faltam) return setErro(`Falta marcar ${faltam} ${faltam > 1 ? 'itens' : 'item'}.`);
    const sem = itens.find((i) => i.estado === 'problema' && !i.obs.trim());
    if (sem) return setErro(`Diga qual é o problema em “${sem.item}”.`);
    const h = horimetro.trim() ? Number(horimetro.replace(/\./g, '').replace(',', '.')) : null;
    if (h !== null && !Number.isFinite(h)) return setErro('Horímetro inválido.');
    setSalvando(true);
    try {
      salvo(await api.salvarChecklistEntrega(m.id, { itens, horimetro: h, observacoes: obs.trim() }));
      avisar('Checklist da entrega salvo.');
      fechar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={fechar} titulo={`Checklist de entrega · FT${frota}`}>
      <p className="text-[13px] text-ink-3">
        {m.clienteNome} · saída em {dataBr(m.dados.data)}
        {atual?.checklist && ` · feito por ${atual.checklist.por} em ${dataHora(atual.checklist.em)}`}
      </p>
      {edita && (
        <button type="button" className="btn-secondary btn-sm self-start" onClick={() => setItens(itens.map((x) => (x.estado ? x : { ...x, estado: 'ok' })))}>
          Marcar o que falta como OK
        </button>
      )}
      <ul className="flex flex-col divide-y divide-line-soft">
        {itens.map((it, i) => (
          <li key={it.item} className="flex flex-col gap-1.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-semibold">{it.item}</span>
              <span className="flex gap-1" role="group" aria-label={it.item}>
                {ESTADOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!edita}
                    aria-pressed={it.estado === s.id}
                    onClick={() => mudar(i, { estado: s.id })}
                    className={`h-9 rounded-lg border px-3 text-[13px] font-semibold ${it.estado === s.id ? s.cor : 'border-line-strong bg-white text-ink-2'}`}
                  >
                    {s.rotulo}
                  </button>
                ))}
              </span>
            </div>
            {it.estado === 'problema' && (
              <input className="input" aria-label={`Problema em ${it.item}`} disabled={!edita} value={it.obs} onChange={(e) => mudar(i, { obs: e.target.value })} placeholder="Qual é o problema?" autoFocus />
            )}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="label">Horímetro na saída</span>
          <input className="input" inputMode="decimal" disabled={!edita} value={horimetro} onChange={(e) => setHorimetro(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">
            Observações <span className="font-normal text-ink-3">(opcional)</span>
          </span>
          <input className="input" disabled={!edita} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
      </div>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          {edita ? 'Cancelar' : 'Fechar'}
        </button>
        {edita && (
          <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar checklist'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Na ficha da máquina: as entregas dela (checklist e vídeo de cada vez que saiu). */
export function EntregasDaMaquina({ frota }: { frota: string }) {
  const { movimentacoes } = useEstado();
  const [lista, setLista] = useState<Entrega[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => {
    api.listarEntregas(frota).then(setLista, () => setLista([]));
  }, [frota]);
  if (!lista.length) return null;
  return (
    <section aria-label="Entregas" className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Entregas · {lista.length}</h3>
      <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
        {lista.map((e) => {
          const m = movimentacoes.find((x) => x.id === e.movId);
          const r = resumo(e);
          return (
            <li key={e.movId} className="flex flex-col gap-1.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{m ? dataBr(m.dados.data) : dataBr(e.atualizadoEm.slice(0, 10))}</b>
                  {m?.clienteNome && <span className="text-ink-3"> · {m.clienteNome}</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <span className={r ? (r.problemas.length ? 'text-warn-strong' : 'text-ok') : 'text-bad'}>
                    {r ? (r.problemas.length ? `⚠ ${r.problemas.length} problema(s)` : '✓ checklist ok') : '○ sem checklist'}
                  </span>
                  <span className={e.video ? 'text-ok' : 'text-bad'}>{e.video ? '✓ vídeo' : '○ sem vídeo'}</span>
                  <button type="button" className="font-semibold underline" onClick={() => setAberto(aberto === e.movId ? null : e.movId)}>
                    {aberto === e.movId ? 'fechar' : 'ver'}
                  </button>
                </span>
              </div>
              {aberto === e.movId && (
                <div className="flex flex-col gap-2 rounded-lg bg-[#F8F7F3] p-2.5">
                  {e.checklist && (
                    <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                      {e.checklist.itens.map((i) => (
                        <li key={i.item} className={i.estado === 'problema' ? 'text-warn-strong' : ''}>
                          {i.estado === 'ok' ? '✓' : i.estado === 'problema' ? '⚠' : '–'} {i.item}
                          {i.obs && `: ${i.obs}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.checklist && (
                    <p className="text-xs text-ink-3">
                      {e.checklist.por} · {dataHora(e.checklist.em)}
                      {e.checklist.horimetro !== null && ` · horímetro ${e.checklist.horimetro.toLocaleString('pt-BR')} h`}
                      {e.checklist.observacoes && ` · ${e.checklist.observacoes}`}
                    </p>
                  )}
                  {e.video && <video controls playsInline preload="metadata" src={urlVideo(e.movId)} className="max-h-[360px] w-full rounded-lg bg-black" />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
