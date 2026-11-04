import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { ItemChecklist, Ordem, PecaOS, PerifericoId } from '../types';
import { STATUS_OS, TIPOS_OS, faltaParaConcluir, progressoChecklist, urlArquivo } from '../lib/ordens';
import { aplicarLocal, enfileirar, guardar, lerGuardado, listarFila, pegarLocal, reduzirFoto, sincronizar, type Operacao } from '../lib/filaOffline';
import { regrasDe } from '../lib/manutencao';
import { dataBr, hojeIso } from '../lib/calendario';
import { Chip } from '../components/ui';
import { IcCheck, IcMais, IcSair } from '../components/Icones';

const CHAVE_CACHE = 'ordens';

/** App do técnico: as OS dele no celular, funcionando mesmo sem sinal. */
export function Campo() {
  const { usuario, sair, clientes, avisar, pode } = useEstado();
  const [params, setParams] = useSearchParams();
  const [ordens, setOrdens] = useState<Ordem[] | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendentes, setPendentes] = useState(0);
  const [baixadoEm, setBaixadoEm] = useState<string | null>(null);
  const aberta = params.get('os');

  const persistir = useCallback((l: Ordem[]) => void guardar(CHAVE_CACHE, { ordens: l, em: new Date().toISOString() }), []);

  const baixar = useCallback(async () => {
    try {
      const l = await api.listarOrdens();
      setOrdens(l);
      setBaixadoEm(new Date().toISOString());
      persistir(l);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [persistir]);

  /** Envia a fila; se ficou vazia, baixa a lista atualizada do servidor. */
  const sincronizarAgora = useCallback(async () => {
    const r = await sincronizar();
    setPendentes(r.restam);
    for (const e of r.erros) avisar(e, 'bad');
    if (r.restam === 0) await baixar();
    else setOnline(false);
  }, [avisar, baixar]);

  useEffect(() => {
    // primeiro o que está guardado no celular (abre sem sinal), depois o servidor
    void lerGuardado<{ ordens: Ordem[]; em: string }>(CHAVE_CACHE).then((c) => {
      if (c) {
        setOrdens((atual) => atual ?? c.ordens);
        setBaixadoEm((atual) => atual ?? c.em);
      }
    });
    void listarFila().then((f) => setPendentes(f.length));
    void sincronizarAgora();
    const on = () => void sincronizarAgora();
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(() => void sincronizarAgora(), 30_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, [sincronizarAgora]);

  /** Toda ação do técnico: muda na tela na hora, guarda na fila e tenta enviar. */
  const agir = useCallback(
    async (op: Operacao) => {
      setOrdens((l) => {
        const novo = (l ?? []).map((o) => (o.id === op.id ? aplicarLocal(o, op) : o));
        persistir(novo);
        return novo;
      });
      await enfileirar(op);
      setPendentes((await listarFila()).length);
      if (op.tipo !== 'salvar') void sincronizarAgora();
    },
    [persistir, sincronizarAgora],
  );

  // texto digitado: envia 1,5 s depois que a pessoa para de digitar
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agirDigitando = useCallback(
    (op: Operacao) => {
      void agir(op);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void sincronizarAgora(), 1500);
    },
    [agir, sincronizarAgora],
  );

  const ordem = ordens?.find((o) => o.id === aberta) ?? null;
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';

  return (
    <div className="min-h-screen bg-canvas pb-10">
      <header className="sticky top-0 z-20 bg-noite px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
          {ordem ? (
            <button type="button" onClick={() => setParams({})} className="flex min-h-[44px] items-center gap-2 text-[15px] font-semibold">
              ← Minhas OS
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <img src="./logo-icone.png" alt="" width={32} height={32} className="h-8 w-8" />
              <div className="leading-tight">
                <div className="text-[15px] font-bold">Minhas OS</div>
                <div className="text-xs text-white/65">{nome}</div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-1">
            {pode('manutencao', 2) && (
              <Link to="/ordens" className="btn btn-sm text-white/75 hover:bg-white/10">
                Escritório
              </Link>
            )}
            <button type="button" onClick={sair} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Sair">
              <IcSair tamanho={18} />
            </button>
          </div>
        </div>
      </header>

      <div
        role="status"
        className={`px-4 py-2 text-center text-[13px] font-semibold ${!online ? 'bg-warn-soft text-warn-strong' : pendentes ? 'bg-brand-soft text-brand-text' : 'bg-ok-soft text-ok'}`}
      >
        {!online
          ? `Sem internet · ${pendentes ? `${pendentes} alteração${pendentes > 1 ? 'ões' : ''} guardada${pendentes > 1 ? 's' : ''} no celular, sobe quando o sinal voltar` : 'pode continuar trabalhando'}`
          : pendentes
            ? `Enviando ${pendentes} alteração${pendentes > 1 ? 'ões' : ''}…`
            : 'Tudo enviado'}
      </div>

      <main className="mx-auto flex max-w-[640px] flex-col gap-3 px-4 py-4">
        {ordem ? (
          <Execucao o={ordem} agir={agir} agirDigitando={agirDigitando} telefone={clientes.find((c) => c.id === ordem.clienteId)?.telefone} />
        ) : (
          <Lista ordens={ordens} abrir={(id) => setParams({ os: id })} baixadoEm={baixadoEm} online={online} />
        )}
      </main>
    </div>
  );
}

function Lista({ ordens, abrir, baixadoEm, online }: { ordens: Ordem[] | null; abrir: (id: string) => void; baixadoEm: string | null; online: boolean }) {
  const hoje = hojeIso();
  if (!ordens) return <p className="text-ink-3">Carregando…</p>;
  const ativas = ordens.filter((o) => ['aberta', 'agendada', 'execucao', 'aguardando_peca'].includes(o.status));
  const grupos: [string, Ordem[]][] = [
    ['Em andamento', ativas.filter((o) => o.status === 'execucao' || o.status === 'aguardando_peca')],
    ['Atrasadas', ativas.filter((o) => ['aberta', 'agendada'].includes(o.status) && o.agendadaPara && o.agendadaPara < hoje)],
    ['Hoje', ativas.filter((o) => ['aberta', 'agendada'].includes(o.status) && (o.agendadaPara === hoje || !o.agendadaPara))],
    [
      'Próximas',
      ativas.filter((o) => ['aberta', 'agendada'].includes(o.status) && o.agendadaPara && o.agendadaPara > hoje).sort((a, b) => a.agendadaPara!.localeCompare(b.agendadaPara!)),
    ],
    [
      'Concluídas nos últimos 7 dias',
      ordens.filter((o) => ['concluida', 'encerrada'].includes(o.status) && (o.concluidaEm ?? '') >= new Date(Date.now() - 7 * 86_400_000).toISOString()),
    ],
  ];
  return (
    <>
      {!online && baixadoEm && (
        <p className="text-[13px] text-ink-3">
          Lista baixada em {new Date(baixadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}
      {ativas.length === 0 && <p className="rounded-2xl border border-line bg-white p-5 text-[15px]">Nenhuma OS para você agora.</p>}
      {grupos.map(([titulo, l]) =>
        l.length ? (
          <section key={titulo} className="flex flex-col gap-2">
            <h2 className={`px-1 text-[13px] font-bold uppercase tracking-wide ${titulo === 'Atrasadas' ? 'text-bad' : 'text-ink-3'}`}>{titulo}</h2>
            {l.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => abrir(o.id)}
                className="flex flex-col gap-1 rounded-2xl border border-line bg-white px-4 py-3 text-left active:bg-brand-tint"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-bold">
                    FT{o.frota} <span className="text-[14px] font-semibold text-ink-3">· OS {o.numero}</span>
                  </span>
                  <Chip tom={STATUS_OS[o.status].tom}>{STATUS_OS[o.status].rotulo.split(' ·')[0]}</Chip>
                </span>
                <span className="text-[14px] font-semibold">{o.clienteNome || 'sem cliente'}</span>
                <span className="text-[13px] text-ink-3">
                  {TIPOS_OS[o.tipo].split(' (')[0]}
                  {o.tipoVisita ? ` ${o.tipoVisita}` : ''}
                  {o.agendadaPara ? ` · ${dataBr(o.agendadaPara)}` : ''}
                </span>
                {o.descricao && <span className="line-clamp-2 text-[13.5px] text-ink-2">{o.descricao}</span>}
              </button>
            ))}
          </section>
        ) : null,
      )}
    </>
  );
}

function Etapa({ n, titulo, feito, children }: { n: number; titulo: string; feito: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <h2 className="flex items-center gap-2.5 text-[16px] font-bold">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${feito ? 'bg-ok text-white' : 'bg-line-soft text-ink-2'}`}>
          {feito ? <IcCheck tamanho={14} /> : n}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Execucao({ o, agir, agirDigitando, telefone }: { o: Ordem; agir: (op: Operacao) => Promise<void>; agirDigitando: (op: Operacao) => void; telefone?: string }) {
  const { config, avisar } = useEstado();
  const ex = o.execucao;
  const editavel = ['aberta', 'agendada', 'execucao', 'aguardando_peca'].includes(o.status);
  const regras = regrasDe(config);
  const [horimetro, setHorimetro] = useState(ex.horimetro != null ? String(ex.horimetro) : '');
  const [servico, setServico] = useState(ex.servico ?? '');
  const [pecas, setPecas] = useState<PecaOS[]>(ex.pecas ?? []);
  const [semAssinatura, setSemAssinatura] = useState(ex.semAssinatura ?? '');
  const [buscandoLocal, setBuscandoLocal] = useState(false);
  const p = progressoChecklist(o);
  const falta = faltaParaConcluir(o);
  const salvar = (dados: Parameters<typeof agir>[0] extends infer T ? (T extends { tipo: 'salvar'; dados: infer D } ? D : never) : never) =>
    agirDigitando({ tipo: 'salvar', id: o.id, dados });

  const checkin = async () => {
    setBuscandoLocal(true);
    const local = await pegarLocal();
    setBuscandoLocal(false);
    await agir({ tipo: 'checkin', id: o.id, local });
  };
  const responder = (i: number, d: Partial<ItemChecklist>) => {
    const l = (ex.checklist ?? []).map((c, j) => (j === i ? { ...c, ...d } : c));
    salvar({ checklist: l });
  };
  const fotos = async (arquivos: FileList | null) => {
    for (const f of Array.from(arquivos ?? [])) {
      try {
        await agir({ tipo: 'foto', id: o.id, imagem: await reduzirFoto(f) });
      } catch {
        avisar('Não consegui ler essa foto.', 'bad');
      }
    }
  };
  const concluir = async () => {
    if (falta.length) return avisar(`Falta: ${falta.join(', ')}.`, 'bad');
    await agir({ tipo: 'concluir', id: o.id, local: await pegarLocal() });
    avisar(`OS ${o.numero} concluída. O escritório vai revisar e mandar o relatório ao cliente.`);
  };

  return (
    <>
      <section className="flex flex-col gap-1 rounded-2xl border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-[22px] font-bold leading-tight">
            FT{o.frota} <span className="text-[15px] font-semibold text-ink-3">OS {o.numero}</span>
          </h1>
          <Chip tom={STATUS_OS[o.status].tom}>{STATUS_OS[o.status].rotulo.split(' ·')[0]}</Chip>
        </div>
        <p className="text-[15px] font-semibold">{o.clienteNome || 'sem cliente'}</p>
        <p className="text-[13.5px] text-ink-3">
          {TIPOS_OS[o.tipo]}
          {o.tipoVisita ? ` · ${o.tipoVisita}` : ''}
          {o.agendadaPara ? ` · ${dataBr(o.agendadaPara)}` : ''}
        </p>
        {o.descricao && <p className="mt-1 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-[14.5px]">{o.descricao}</p>}
        {telefone && (
          <a href={`tel:${telefone.replace(/[^\d+]/g, '')}`} className="btn-secondary mt-2 self-start">
            Ligar para o cliente · {telefone}
          </a>
        )}
      </section>

      {!editavel && (
        <p className="rounded-2xl bg-ok-soft p-4 text-[15px] text-ok">
          {o.status === 'concluida'
            ? 'Concluída. O escritório vai revisar.'
            : o.status === 'encerrada'
              ? 'Encerrada pelo escritório.'
              : `OS ${STATUS_OS[o.status].rotulo.toLowerCase()}.`}
        </p>
      )}

      <Etapa n={1} titulo="Chegada" feito={!!ex.checkin}>
        {ex.checkin ? (
          <p className="text-[14px] text-ink-2">
            Check-in às {new Date(ex.checkin.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} {ex.checkin.lat == null && '(sem localização)'}
          </p>
        ) : (
          <button type="button" className="btn-primary h-14 text-[16px]" disabled={!editavel || buscandoLocal} onClick={() => void checkin()}>
            {buscandoLocal ? 'Pegando a localização…' : 'Cheguei no cliente'}
          </button>
        )}
      </Etapa>

      {ex.checkin && (
        <>
          {o.tipo !== 'externo' && (
            <Etapa n={2} titulo="Horímetro" feito={ex.horimetro != null}>
              <input
                className="input h-14 text-[22px] font-bold"
                inputMode="decimal"
                disabled={!editavel}
                value={horimetro}
                placeholder="Ex.: 25910"
                onChange={(e) => {
                  setHorimetro(e.target.value);
                  const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
                  salvar({ horimetro: e.target.value.trim() && Number.isFinite(n) ? n : null });
                }}
              />
            </Etapa>
          )}

          <Etapa n={3} titulo={`Checklist · ${p.feitos} de ${p.total}`} feito={p.total > 0 && p.feitos === p.total}>
            <ul className="flex flex-col gap-3">
              {(ex.checklist ?? []).map((c, i) => (
                <li key={c.item} className="flex flex-col gap-1.5 border-b border-line-soft pb-3 last:border-0 last:pb-0">
                  <span className="text-[15px] font-semibold">{c.item}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ['ok', 'OK', 'bg-ok text-white'],
                        ['problema', 'Problema', 'bg-bad text-white'],
                        ['na', 'Não tem', 'bg-ink-3 text-white'],
                      ] as const
                    ).map(([v, r, cor]) => (
                      <button
                        key={v}
                        type="button"
                        disabled={!editavel}
                        aria-pressed={c.resposta === v}
                        onClick={() => responder(i, { resposta: c.resposta === v ? '' : v })}
                        className={`min-h-[44px] rounded-xl border text-[14px] font-semibold ${c.resposta === v ? `${cor} border-transparent` : 'border-line-strong bg-white text-ink-2'}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {c.resposta === 'problema' && (
                    <input
                      className="input"
                      disabled={!editavel}
                      defaultValue={c.obs}
                      placeholder="Qual o problema?"
                      onBlur={(e) => e.target.value !== c.obs && responder(i, { obs: e.target.value })}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Etapa>

          <Etapa n={4} titulo="O que foi feito" feito={!!ex.servico?.trim()}>
            <textarea
              rows={4}
              className="input py-2.5 text-[15px]"
              disabled={!editavel}
              value={servico}
              placeholder="Descreva o serviço"
              onChange={(e) => {
                setServico(e.target.value);
                salvar({ servico: e.target.value });
              }}
            />
            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold">Peças usadas</span>
              {pecas.map((pc, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_auto] gap-2">
                  <input
                    className="input"
                    disabled={!editavel}
                    value={pc.descricao}
                    placeholder="Peça"
                    onChange={(e) => {
                      const l = pecas.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x));
                      setPecas(l);
                      salvar({ pecas: l });
                    }}
                  />
                  <input
                    className="input text-right"
                    inputMode="decimal"
                    disabled={!editavel}
                    value={String(pc.quantidade)}
                    aria-label="Quantidade"
                    onChange={(e) => {
                      const q = Number(e.target.value.replace(',', '.')) || 1;
                      const l = pecas.map((x, j) => (j === i ? { ...x, quantidade: q } : x));
                      setPecas(l);
                      salvar({ pecas: l });
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm text-ink-3"
                    disabled={!editavel}
                    aria-label="Tirar peça"
                    onClick={() => {
                      const l = pecas.filter((_, j) => j !== i);
                      setPecas(l);
                      salvar({ pecas: l });
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {editavel && (
                <button type="button" className="btn-secondary self-start" onClick={() => setPecas([...pecas, { codigo: '', descricao: '', quantidade: 1 }])}>
                  <IcMais tamanho={16} /> Peça
                </button>
              )}
            </div>
            {o.tipo !== 'externo' && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[14px] font-semibold">Periféricos trocados</legend>
                {regras.perifericos.map((pr) => {
                  const marcado = (ex.perifericos ?? []).includes(pr.id);
                  return (
                    <label key={pr.id} className="flex min-h-[40px] items-center gap-3 text-[15px]">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        disabled={!editavel}
                        checked={marcado}
                        onChange={() => salvar({ perifericos: marcado ? (ex.perifericos ?? []).filter((x) => x !== pr.id) : [...(ex.perifericos ?? []), pr.id as PerifericoId] })}
                      />
                      {pr.nome}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {editavel && (
              <label className="flex min-h-[44px] items-center gap-3 rounded-xl bg-warn-soft px-3 text-[15px] font-semibold text-warn-strong">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={o.status === 'aguardando_peca'}
                  onChange={(e) => void agir({ tipo: 'salvar', id: o.id, dados: { aguardandoPeca: e.target.checked } })}
                />
                Parado esperando peça
              </label>
            )}
          </Etapa>

          <Etapa n={5} titulo={`Fotos · ${(ex.fotos ?? []).length}`} feito={(ex.fotos ?? []).length > 0}>
            <div className="flex flex-wrap gap-2">
              {(ex.fotos ?? []).map((f) =>
                f.startsWith('pendente:') ? (
                  <span key={f} className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-line-strong text-center text-xs text-ink-3">
                    aguardando sinal
                  </span>
                ) : (
                  <span key={f} className="relative">
                    <img src={urlArquivo(o, f)} alt="Foto" className="h-24 w-24 rounded-xl border border-line object-cover" />
                    {editavel && (
                      <button
                        type="button"
                        aria-label="Tirar foto"
                        onClick={() => void agir({ tipo: 'tirarFoto', id: o.id, nome: f })}
                        className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-noite text-white"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ),
              )}
            </div>
            {editavel && (
              <label className="btn-secondary h-12 cursor-pointer self-start text-[15px]">
                Tirar ou escolher foto
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => void fotos(e.target.files).then(() => (e.target.value = ''))}
                />
              </label>
            )}
          </Etapa>

          <Etapa n={6} titulo="Assinatura do cliente" feito={!!ex.assinatura || !!ex.semAssinatura?.trim()}>
            {ex.assinatura ? (
              <div className="flex flex-col gap-2">
                {ex.assinatura === 'pendente' ? (
                  <p className="text-[14px] text-ink-3">Assinatura guardada; sobe quando o sinal voltar.</p>
                ) : (
                  <img src={urlArquivo(o, ex.assinatura)} alt="Assinatura" className="h-28 self-start rounded-xl border border-line bg-white" />
                )}
                <p className="text-[14px]">Assinado por {ex.assinadoPor}</p>
              </div>
            ) : editavel ? (
              <>
                <Assinatura assinar={(img, nome) => void agir({ tipo: 'assinatura', id: o.id, imagem: img, nome })} />
                <details className="text-[14px]">
                  <summary className="cursor-pointer py-2 text-ink-2">O cliente não pôde assinar</summary>
                  <input
                    className="input mt-1"
                    value={semAssinatura}
                    placeholder="Por quê? Ex.: ninguém no local"
                    onChange={(e) => {
                      setSemAssinatura(e.target.value);
                      salvar({ semAssinatura: e.target.value });
                    }}
                  />
                </details>
              </>
            ) : (
              <p className="text-[14px] text-warn">Sem assinatura: {ex.semAssinatura}</p>
            )}
          </Etapa>

          {editavel && (
            <section className="sticky bottom-3 flex flex-col gap-2 rounded-2xl border border-line bg-white p-3 shadow-lg">
              {falta.length > 0 && <p className="text-[13px] text-ink-3">Falta: {falta.join(', ')}</p>}
              <button type="button" className="btn-primary h-14 text-[16px]" disabled={falta.length > 0 || o.status === 'aguardando_peca'} onClick={() => void concluir()}>
                {o.status === 'aguardando_peca' ? 'Esperando peça' : 'Concluir OS'}
              </button>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Campo para o cliente assinar com o dedo. */
function Assinatura({ assinar }: { assinar: (pngBase64: string, nome: string) => void }) {
  const tela = useRef<HTMLCanvasElement>(null);
  const [nome, setNome] = useState('');
  const [riscou, setRiscou] = useState(false);
  const desenhando = useRef(false);
  useEffect(() => {
    const c = tela.current!;
    const escala = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * escala;
    c.height = c.offsetHeight * escala;
    const ctx = c.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#141414';
  }, []);
  const ponto = (e: React.PointerEvent) => {
    const r = tela.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const limpar = () => {
    const c = tela.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setRiscou(false);
  };
  const pronto = useMemo(() => riscou && nome.trim().length > 1, [riscou, nome]);
  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={tela}
        aria-label="Assine aqui"
        className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line-strong bg-white"
        onPointerDown={(e) => {
          desenhando.current = true;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const ctx = tela.current!.getContext('2d')!;
          const [x, y] = ponto(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current) return;
          const ctx = tela.current!.getContext('2d')!;
          const [x, y] = ponto(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          setRiscou(true);
        }}
        onPointerUp={() => (desenhando.current = false)}
      />
      <div className="flex items-center justify-between text-[13px] text-ink-3">
        <span>Assine com o dedo</span>
        <button type="button" className="btn btn-sm underline" onClick={limpar}>
          Limpar
        </button>
      </div>
      <input className="input h-12 text-[15px]" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome de quem assinou" />
      <button type="button" className="btn-primary h-12" disabled={!pronto} onClick={() => assinar(tela.current!.toDataURL('image/png').split(',')[1], nome.trim())}>
        Guardar assinatura
      </button>
    </div>
  );
}
