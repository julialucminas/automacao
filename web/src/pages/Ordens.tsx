import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Equipamento, ModeloOS, Ordem, Pendencia, StatusOS, TecnicoOS } from '../types';
import { RESPOSTAS, STATUS_OS, gerarPdfOS, nomeTipoOS, progressoChecklist, textoResposta, urlArquivo } from '../lib/ordens';
import { regrasDe } from '../lib/manutencao';
import { dataBr, hojeIso } from '../lib/calendario';
import { semAcento } from '../lib/normalizar';
import { Chip, Gaveta, Modal } from '../components/ui';
import { IcBusca, IcMais } from '../components/Icones';

type Filtro = 'andamento' | 'revisar' | 'encerradas' | 'canceladas' | 'todas';
const FILTROS: { id: Filtro; rotulo: string; status: StatusOS[] }[] = [
  { id: 'andamento', rotulo: 'Em aberto', status: ['aberta', 'agendada', 'execucao', 'aguardando_peca', 'concluida'] },
  { id: 'revisar', rotulo: 'Para revisar', status: ['concluida'] },
  { id: 'encerradas', rotulo: 'Encerradas', status: ['encerrada'] },
  { id: 'canceladas', rotulo: 'Canceladas', status: ['cancelada'] },
  { id: 'todas', rotulo: 'Todas', status: ['aberta', 'agendada', 'execucao', 'aguardando_peca', 'concluida', 'encerrada', 'cancelada'] },
];
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Escritório: abre, agenda, acompanha e encerra as OS. */
export function Ordens() {
  const { pode } = useEstado();
  const gerencia = pode('ordens', 2) && pode('manutencao', 2);
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<Ordem[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('andamento');
  const [busca, setBusca] = useState('');
  const [nova, setNova] = useState(false);
  const aberta = params.get('os');
  // "Abrir OS" no Painel de manutenção chega aqui com ?nova=1&frota=40 ou &pendencia=12
  useEffect(() => {
    if (params.get('nova')) setNova(true);
  }, [params]);

  const recarregar = useCallback(async () => {
    try {
      setLista(await api.listarOrdens());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);
  useEffect(() => {
    void recarregar();
    const t = setInterval(recarregar, 60_000);
    return () => clearInterval(t);
  }, [recarregar]);

  const q = semAcento(busca).toUpperCase().trim();
  const st = FILTROS.find((f) => f.id === filtro)!.status;
  const visiveis = (lista ?? [])
    .filter((o) => st.includes(o.status))
    .filter(
      (o) =>
        !q ||
        semAcento(`${o.numero} FT${o.frota} ${o.clienteNome} ${o.tecnicoNome} ${o.descricao}`)
          .toUpperCase()
          .includes(q.replace(/^OS\s*/, '')),
    )
    .sort((a, b) => STATUS_OS[a.status].ordem - STATUS_OS[b.status].ordem || (a.agendadaPara ?? '9').localeCompare(b.agendadaPara ?? '9') || b.numero - a.numero);
  const revisar = (lista ?? []).filter((o) => o.status === 'concluida').length;
  const ordem = (lista ?? []).find((o) => o.id === aberta) ?? null;

  const atualizar = (o: Ordem) => setLista((l) => (l ? l.map((x) => (x.id === o.id ? o : x)) : [o]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Operação</div>
          <h1 className="mt-1 text-[26px] font-bold">Ordens de serviço</h1>
          <p className="text-[13px] text-ink-3">O escritório abre e agenda; o técnico preenche o formulário no celular; o escritório revisa e encerra.</p>
        </div>
        {gerencia && (
          <span className="flex gap-2">
            <Link to="/modelos-os" className="btn-secondary">
              Modelos de OS
            </Link>
            <button type="button" className="btn-primary" onClick={() => setNova(true)}>
              <IcMais tamanho={16} /> Nova OS
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-semibold ${filtro === f.id ? 'border-noite bg-noite text-white' : 'border-line-strong bg-white text-ink-2 hover:bg-line-soft'}`}
          >
            {f.rotulo}
            {f.id === 'revisar' && revisar > 0 && <span className="ml-1.5 rounded-full bg-brand px-1.5 text-ink">{revisar}</span>}
          </button>
        ))}
        <label className="relative ml-auto">
          <span className="sr-only">Buscar OS</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={15} />
          </span>
          <input type="search" className="input w-[240px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº, frota, cliente, técnico…" />
        </label>
      </div>

      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {!lista && !erro ? (
        <p className="text-ink-3">Carregando…</p>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[860px] text-[14px]">
            <thead>
              <tr className="border-b border-line bg-[#F8F7F3] text-left text-xs text-ink-3">
                <th className="px-4 py-2 font-semibold">Nº</th>
                <th className="px-4 py-2 font-semibold">Frota</th>
                <th className="px-4 py-2 font-semibold">Cliente</th>
                <th className="px-4 py-2 font-semibold">Tipo</th>
                <th className="px-4 py-2 font-semibold">Técnico</th>
                <th className="px-4 py-2 font-semibold">Dia</th>
                <th className="px-4 py-2 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((o) => {
                const p = progressoChecklist(o);
                const atrasada = o.agendadaPara && o.agendadaPara < hojeIso() && ['aberta', 'agendada'].includes(o.status);
                return (
                  <tr key={o.id} className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-brand-tint" onClick={() => setParams({ os: o.id })}>
                    <td className="px-4 py-2.5 font-bold">{o.numero}</td>
                    <td className="px-4 py-2.5 font-mono font-bold">FT{o.frota}</td>
                    <td className="px-4 py-2.5">{o.clienteNome || '—'}</td>
                    <td className="px-4 py-2.5">
                      {nomeTipoOS(o)}
                      {o.tipoVisita && <span className="text-ink-3"> · {o.tipoVisita}</span>}
                    </td>
                    <td className="px-4 py-2.5">{o.tecnicoNome || <span className="text-warn">sem técnico</span>}</td>
                    <td className={`px-4 py-2.5 ${atrasada ? 'font-bold text-bad' : ''}`}>{o.agendadaPara ? dataBr(o.agendadaPara) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip tom={STATUS_OS[o.status].tom}>{STATUS_OS[o.status].rotulo}</Chip>
                        {['execucao', 'aguardando_peca'].includes(o.status) && (
                          <span className="text-xs text-ink-3">
                            {o.execucao.formulario ? 'respostas' : 'checklist'} {p.feitos}/{p.total}
                          </span>
                        )}
                        {p.problemas > 0 && (
                          <Chip tom="bad">
                            {p.problemas} problema{p.problemas > 1 ? 's' : ''}
                          </Chip>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-ink-3">
                    Nenhuma OS {busca ? 'com essa busca' : 'aqui'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <DetalheOS ordem={ordem} gerencia={gerencia} fechar={() => setParams({})} mudou={atualizar} />
      <NovaOS
        aberto={nova}
        frotaInicial={params.get('frota') ?? undefined}
        pendenciaId={params.get('pendencia') ? Number(params.get('pendencia')) : null}
        fechar={() => {
          setNova(false);
          if (params.get('nova')) setParams({});
        }}
        criada={(o) => {
          setNova(false);
          setLista((l) => [o, ...(l ?? [])]);
          setParams({ os: o.id });
        }}
      />
    </div>
  );
}

/** Formulário de OS nova. Usado aqui e no Painel de manutenção (com a frota já escolhida). */
export function NovaOS({
  aberto,
  fechar,
  criada,
  frotaInicial,
  pendenciaId,
}: {
  aberto: boolean;
  fechar: () => void;
  criada: (o: Ordem) => void;
  frotaInicial?: string;
  pendenciaId?: number | null;
}) {
  if (!aberto) return null;
  return <FormNovaOS fechar={fechar} criada={criada} frotaInicial={frotaInicial} pendenciaId={pendenciaId ?? null} />;
}

function FormNovaOS({ fechar, criada, frotaInicial, pendenciaId }: { fechar: () => void; criada: (o: Ordem) => void; frotaInicial?: string; pendenciaId: number | null }) {
  const { clientes, avisar, config } = useEstado();
  const regras = regrasDe(config);
  const [frota, setFrota] = useState(frotaInicial ?? '');
  const [modelos, setModelos] = useState<ModeloOS[]>([]);
  const [modeloId, setModeloId] = useState('');
  const modelo = modelos.find((m) => m.id === modeloId) ?? null;
  const tipo = modelo?.tipoBase ?? 'corretiva';
  /** escolhe o primeiro modelo ativo do tipo (ex.: pendência → corretiva) */
  const escolherTipo = (t: string, l = modelos) => {
    const m = l.find((x) => x.ativo && x.tipoBase === t) ?? l.find((x) => x.ativo);
    if (m) setModeloId(m.id);
  };
  const [tipoVisita, setTipoVisita] = useState('');
  const [tecnicos, setTecnicos] = useState<TecnicoOS[]>([]);
  const [tecnico, setTecnico] = useState('');
  const [data, setData] = useState(hojeIso());
  const [descricao, setDescricao] = useState('');
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [pendId, setPendId] = useState(pendenciaId ? String(pendenciaId) : '');
  const [tecnicoPorNome, setTecnicoPorNome] = useState('');
  const [clienteExterno, setClienteExterno] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api.tecnicosOS().then(setTecnicos, () => undefined);
    api.listarModelosOS().then(
      (l) => {
        setModelos(l);
        escolherTipo(pendenciaId ? 'corretiva' : 'preventiva', l);
      },
      () => undefined,
    );
    api.listarPendencias().then(
      (l) => {
        setPendencias(l);
        // veio do Painel ("Abrir OS" numa pendência): já preenche frota e o que fazer
        const p = pendenciaId ? l.find((x) => x.id === pendenciaId) : null;
        if (p) {
          setFrota(p.frota);
          setDescricao(p.descricao);
          setTecnicoPorNome(p.tecnico);
        }
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escolhe o modelo inicial só ao abrir
  }, [pendenciaId]);
  useEffect(() => {
    const t = tecnicos.find((x) => x.nome === tecnicoPorNome);
    if (t) setTecnico(String(t.id));
  }, [tecnicos, tecnicoPorNome]);
  const num = frota
    .trim()
    .toUpperCase()
    .replace(/^(FROTA|FT)[\s-]*/, '');
  const dono = clientes.find((c) => c.ativo && c.frotas.some((f) => f.numero === num)) ?? null;
  const pendDaFrota = pendencias.filter((p) => p.frota === num);
  const frotas = useMemo(
    () => [...new Set(clientes.filter((c) => c.ativo).flatMap((c) => c.frotas.map((f) => f.numero)))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [clientes],
  );

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!num) return setErro('Informe a frota.');
    if (!modelo) return setErro('Escolha o modelo de OS.');
    setSalvando(true);
    try {
      const o = await api.criarOrdem({
        frota: num,
        clienteId: tipo === 'externo' ? null : (dono?.id ?? null),
        clienteNome: tipo === 'externo' ? clienteExterno.trim() : (dono?.nome ?? ''),
        modeloId: modelo.id,
        tipoVisita: tipo === 'preventiva' ? tipoVisita : '',
        tecnicoId: tecnico ? Number(tecnico) : null,
        agendadaPara: data || null,
        descricao: descricao.trim(),
        pendenciaId: pendId ? Number(pendId) : null,
      });
      avisar(`OS ${o.numero} aberta${o.tecnicoNome ? ` para ${o.tecnicoNome}` : ''}.`);
      criada(o);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível abrir a OS.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={fechar} titulo="Nova ordem de serviço">
      <form onSubmit={enviar} className="flex max-h-[78vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Frota
            <input className="input font-normal" list="frotas-os" required value={frota} onChange={(e) => setFrota(e.target.value)} placeholder="Ex.: 40" />
            <datalist id="frotas-os">
              {frotas.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Modelo de OS
            <select className="input font-normal" value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
              {!modelos.length && <option value="">Carregando…</option>}
              {modelos
                .filter((m) => m.ativo)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
            </select>
            {modelo && (
              <span className="font-normal text-ink-3">
                {modelo.campos.filter((c) => c.tipo !== 'secao').length} perguntas
                {modelo.descricao ? ` · ${modelo.descricao}` : ''}
              </span>
            )}
          </label>
        </div>
        {tipo === 'externo' ? (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Cliente (dono da máquina)
            <input className="input font-normal" value={clienteExterno} onChange={(e) => setClienteExterno(e.target.value)} />
          </label>
        ) : (
          num && <p className="text-[13px] text-ink-2">{dono ? `Cliente: ${dono.nome}` : 'Esta frota não está com nenhum cliente agora.'}</p>
        )}
        {tipo === 'preventiva' && (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Tipo de preventiva
            <select className="input font-normal" value={tipoVisita} onChange={(e) => setTipoVisita(e.target.value)}>
              <option value="">—</option>
              {regras.tipos.map((t) => (
                <option key={t.sigla} value={t.sigla}>
                  {t.sigla} · {t.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Técnico
            <select className="input font-normal" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
              <option value="">Escolher depois</option>
              {tecnicos
                .filter((t) => !t.escritorio)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              {tecnicos.some((t) => t.escritorio) && (
                <optgroup label="Escritório">
                  {tecnicos
                    .filter((t) => t.escritorio)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Dia
            <input type="date" className="input font-normal" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        {pendDaFrota.length > 0 && (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Resolve a pendência
            <select
              className="input font-normal"
              value={pendId}
              onChange={(e) => {
                setPendId(e.target.value);
                const p = pendDaFrota.find((x) => String(x.id) === e.target.value);
                if (p && !descricao.trim()) setDescricao(p.descricao);
                if (p && tipo !== 'corretiva') escolherTipo('corretiva');
              }}
            >
              <option value="">Nenhuma</option>
              {pendDaFrota.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.descricao.slice(0, 80)}
                </option>
              ))}
            </select>
            <span className="font-normal text-ink-3">Quando a OS for encerrada, a pendência fecha sozinha.</span>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold">
          O que fazer
          <textarea rows={3} className="input py-2 font-normal" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: máquina não dá partida" />
        </label>
        {tecnico && data && <p className="text-xs text-ink-3">A OS já aparece no celular do técnico, no dia escolhido.</p>}
        {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={salvando}>
            {salvando ? 'Abrindo…' : 'Abrir OS'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">{titulo}</h3>
      {children}
    </section>
  );
}

function DetalheOS({ ordem, gerencia, fechar, mudou }: { ordem: Ordem | null; gerencia: boolean; fechar: () => void; mudou: (o: Ordem) => void }) {
  const { avisar, clientes, config } = useEstado();
  const [tecnicos, setTecnicos] = useState<TecnicoOS[]>([]);
  const [ficha, setFicha] = useState<Equipamento | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviarRel, setEnviarRel] = useState(true);
  // envio ao cliente só quando ligado em Configurações → Manutenção
  const relatorioLigado = config?.['os.relatorioCliente'] === 'sim';
  const [proxima, setProxima] = useState('');
  const [ocupado, setOcupado] = useState('');
  useEffect(() => {
    if (!ordem) return;
    setCancelando(false);
    setMotivo('');
    api.tecnicosOS().then(setTecnicos, () => undefined);
    api.listarEquipamentos().then(
      (l) => setFicha(l.find((e) => e.frota === ordem.frota) ?? null),
      () => undefined,
    );
  }, [ordem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const regras = regrasDe(config);
  useEffect(() => {
    if (!ordem) return;
    const t = regras.tipos.find((x) => x.sigla === ordem.tipoVisita);
    const h = ordem.execucao.horimetro;
    setProxima(t?.horas && h != null ? String(h + t.horas) : ficha?.proximaPreventiva != null ? String(ficha.proximaPreventiva) : '');
  }, [ordem?.id, ordem?.execucao.horimetro, ficha]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ordem) return null;
  const o = ordem;
  const ex = o.execucao;
  const cliente = o.clienteId ? clientes.find((c) => c.id === o.clienteId) : null;
  const emails = cliente ? [...cliente.para, ...cliente.cc] : [];
  const nomeEquip = [ficha?.marca, ficha?.modelo].filter(Boolean).join(' ') || ficha?.descricao || '';
  const final = o.status === 'encerrada' || o.status === 'cancelada';

  const rodar = async (rotulo: string, f: () => Promise<Ordem | void>, msg?: string) => {
    setOcupado(rotulo);
    try {
      const r = await f();
      if (r) mudou(r);
      if (msg) avisar(msg);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível.', 'bad');
    } finally {
      setOcupado('');
    }
  };
  const pdf = () => gerarPdfOS(o, { equipamento: nomeEquip, serie: ficha?.serie });
  const baixar = () =>
    rodar('pdf', async () => {
      const r = await pdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob);
      a.download = r.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  const encerrar = () =>
    rodar('encerrar', async () => {
      const p = proxima.trim() ? Number(proxima.replace(/\./g, '').replace(',', '.')) : null;
      const r = await api.encerrarOrdem(o.id, {
        proximaPreventiva: p,
        enviar: relatorioLigado && enviarRel && emails.length > 0,
        ...(relatorioLigado && enviarRel && emails.length ? { pdf: (await pdf()).base64 } : {}),
      });
      avisar(
        r.relatorio
          ? r.relatorio.enviado
            ? `OS ${o.numero} encerrada e relatório enviado para ${emails.join(', ')}.`
            : `OS ${o.numero} encerrada, mas o relatório não foi: ${r.relatorio.detalhe}`
          : `OS ${o.numero} encerrada. Ficha e histórico da FT${o.frota} atualizados.`,
        r.relatorio && !r.relatorio.enviado ? 'bad' : 'ok',
      );
      return r.ordem;
    });
  const reenviar = () =>
    rodar('reenviar', async () => {
      const r = await api.enviarRelatorioOrdem(o.id, (await pdf()).base64);
      avisar(r.relatorio?.enviado ? 'Relatório enviado.' : `Não foi: ${r.relatorio?.detalhe}`, r.relatorio?.enviado ? 'ok' : 'bad');
      return r.ordem;
    });

  return (
    <Gaveta aberto fechar={fechar} titulo={`OS ${o.numero} · FT${o.frota}${nomeEquip ? ` · ${nomeEquip}` : ''}`} largo>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tom={STATUS_OS[o.status].tom}>{STATUS_OS[o.status].rotulo}</Chip>
        <Chip tom="neutro">{nomeTipoOS(o)}</Chip>
        {o.tipoVisita && <Chip tom="neutro">{o.tipoVisita}</Chip>}
        {o.clienteNome && <Chip tom="neutro">{o.clienteNome}</Chip>}
      </div>

      {o.status === 'cancelada' && <p className="rounded-xl bg-line-soft p-3 text-[14px]">Cancelada: {o.cancelamento}</p>}

      <Bloco titulo="Pedido">
        <p className="whitespace-pre-wrap text-[14px]">{o.descricao || '—'}</p>
        <p className="text-xs text-ink-3">
          Aberta por {o.criadaPor || '—'} em {hora(o.criadaEm)}
          {o.pendenciaId ? ' · ligada a uma pendência' : ''}
        </p>
      </Bloco>

      <Bloco titulo="Técnico e dia">
        {gerencia && !final ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <select
              aria-label="Técnico"
              className="input"
              value={o.tecnicoId ?? ''}
              onChange={(e) => void rodar('tecnico', () => api.alterarOrdem(o.id, { tecnicoId: e.target.value ? Number(e.target.value) : null }), 'Técnico alterado.')}
            >
              <option value="">Sem técnico</option>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.escritorio ? ' (escritório)' : ''}
                </option>
              ))}
            </select>
            <input
              aria-label="Dia"
              type="date"
              className="input"
              value={o.agendadaPara ?? ''}
              onChange={(e) => void rodar('dia', () => api.alterarOrdem(o.id, { agendadaPara: e.target.value || null }), 'Dia alterado.')}
            />
          </div>
        ) : (
          <p className="text-[14px]">
            {o.tecnicoNome || 'sem técnico'} · {o.agendadaPara ? dataBr(o.agendadaPara) : 'sem dia'}
          </p>
        )}
      </Bloco>

      {(ex.checkin || ex.horimetro != null || ex.servico) && (
        <Bloco titulo="Execução">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line p-3.5 text-[14px] sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-3">Chegada</dt>
              <dd>
                {ex.checkin ? hora(ex.checkin.em) : '—'}
                {ex.checkin?.lat != null && (
                  <a className="ml-1.5 text-xs text-info underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${ex.checkin.lat},${ex.checkin.lng}`}>
                    mapa
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Saída</dt>
              <dd>{ex.checkout ? hora(ex.checkout.em) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Horímetro</dt>
              <dd>{ex.horimetro != null ? `${ex.horimetro.toLocaleString('pt-BR')} h` : '—'}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-ink-3">O que foi feito</dt>
              <dd className="whitespace-pre-wrap">{ex.servico || '—'}</dd>
            </div>
          </dl>
        </Bloco>
      )}

      {(ex.pecas ?? []).length > 0 && (
        <Bloco titulo="Peças">
          <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line text-[14px]">
            {ex.pecas!.map((p, i) => (
              <li key={i} className="flex justify-between gap-2 px-3.5 py-2">
                <span>
                  {p.descricao} {p.codigo && <span className="text-xs text-ink-3">· {p.codigo}</span>}
                </span>
                <span>× {String(p.quantidade).replace('.', ',')}</span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}
      {(ex.perifericos ?? []).length > 0 && (
        <p className="text-[13px] text-ink-2">Periféricos trocados: {ex.perifericos!.map((p) => regras.perifericos.find((r) => r.id === p)?.nome ?? p).join(', ')}</p>
      )}

      {ex.formulario && Object.keys(ex.respostas ?? {}).length > 0 && (
        <Bloco titulo={`${ex.formulario.nome} · ${progressoChecklist(o).feitos} de ${progressoChecklist(o).total}`}>
          <dl className="flex flex-col rounded-xl border border-line p-3 text-[13.5px]">
            {ex.formulario.campos.map((c) =>
              c.tipo === 'secao' ? (
                <dt key={c.id} className="mt-2 border-b border-line pb-1 text-[12px] font-bold uppercase tracking-wide text-ink-3 first:mt-0">
                  {c.rotulo}
                </dt>
              ) : (
                <div key={c.id} className="flex justify-between gap-3 border-b border-line-soft py-1.5 last:border-0">
                  <dt>{c.rotulo}</dt>
                  <dd className={`text-right ${textoResposta(c, ex.respostas?.[c.id]).startsWith('Problema') ? 'font-bold text-bad' : 'text-ink-2'}`}>
                    {c.tipo === 'foto' && Array.isArray(ex.respostas?.[c.id]) ? (
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {(ex.respostas![c.id] as string[]).map((f) => (
                          <a key={f} href={urlArquivo(o, f)} target="_blank" rel="noreferrer">
                            <img src={urlArquivo(o, f)} alt={c.rotulo} className="h-16 w-16 rounded-lg border border-line object-cover" />
                          </a>
                        ))}
                      </span>
                    ) : (
                      textoResposta(c, ex.respostas?.[c.id])
                    )}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </Bloco>
      )}

      {(ex.checklist ?? []).some((c) => c.resposta) && (
        <Bloco titulo={`Checklist · ${progressoChecklist(o).feitos} de ${progressoChecklist(o).total}`}>
          <ul className="grid gap-x-4 rounded-xl border border-line p-3 text-[13.5px] sm:grid-cols-2">
            {ex.checklist!.map((c) => (
              <li key={c.item} className="flex justify-between gap-2 py-1">
                <span>{c.item}</span>
                <span className={c.resposta === 'problema' ? 'font-bold text-bad' : c.resposta ? 'text-ink-2' : 'text-ink-3'}>
                  {c.resposta ? RESPOSTAS[c.resposta] : '—'}
                  {c.obs && <span className="block text-xs font-normal text-ink-3">{c.obs}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {((ex.fotos ?? []).length > 0 || ex.assinatura || ex.semAssinatura) && (
        <Bloco titulo="Fotos e assinatura">
          <div className="flex flex-wrap gap-2">
            {(ex.fotos ?? []).map((f) => (
              <a key={f} href={urlArquivo(o, f)} target="_blank" rel="noreferrer">
                <img src={urlArquivo(o, f)} alt="Foto da OS" className="h-24 w-24 rounded-lg border border-line object-cover" />
              </a>
            ))}
          </div>
          {ex.assinatura ? (
            <div className="flex items-end gap-3">
              <img src={urlArquivo(o, ex.assinatura)} alt="Assinatura do cliente" className="h-20 rounded-lg border border-line bg-white" />
              <span className="text-[13px] text-ink-2">{ex.assinadoPor}</span>
            </div>
          ) : (
            ex.semAssinatura && <p className="text-[13px] text-warn">Sem assinatura: {ex.semAssinatura}</p>
          )}
        </Bloco>
      )}

      {o.relatorioEm && (
        <p className="text-[13px] text-ok">
          Relatório enviado em {hora(o.relatorioEm)} para {o.relatorioPara}.
        </p>
      )}

      {gerencia && o.status === 'concluida' && (
        <section className="flex flex-col gap-3 rounded-xl border-2 border-brand bg-brand-tint p-4">
          <h3 className="text-[15px] font-bold">Revisar e encerrar</h3>
          <p className="text-[13px] text-ink-2">
            Ao encerrar, a ficha da FT{o.frota} (horímetro, visita, periféricos) e o histórico de peças são atualizados, e a pendência ligada é fechada.
          </p>
          {o.tipo !== 'externo' && (
            <label className="flex max-w-[260px] flex-col gap-1 text-xs font-semibold">
              Próxima preventiva (horímetro)
              <input className="input font-normal" inputMode="decimal" value={proxima} onChange={(e) => setProxima(e.target.value)} />
            </label>
          )}
          {relatorioLigado && (
            <label className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1" checked={enviarRel && emails.length > 0} disabled={!emails.length} onChange={(e) => setEnviarRel(e.target.checked)} />
              <span>
                Mandar o relatório em PDF para o cliente
                <span className="block text-xs text-ink-3">{emails.length ? emails.join(', ') : 'O cliente não tem e-mail no cadastro.'}</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={!!ocupado} onClick={() => void encerrar()}>
              {ocupado === 'encerrar' ? 'Encerrando…' : 'Encerrar OS'}
            </button>
            <button type="button" className="btn-secondary" disabled={!!ocupado} onClick={() => void rodar('devolver', () => api.devolverOrdem(o.id), 'OS devolvida ao técnico.')}>
              Devolver ao técnico
            </button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {['concluida', 'encerrada'].includes(o.status) && (
          <button type="button" className="btn-secondary" disabled={!!ocupado} onClick={() => void baixar()}>
            {ocupado === 'pdf' ? 'Gerando…' : 'Baixar relatório (PDF)'}
          </button>
        )}
        {relatorioLigado && gerencia && o.status === 'encerrada' && emails.length > 0 && (
          <button type="button" className="btn-secondary" disabled={!!ocupado} onClick={() => void reenviar()}>
            {ocupado === 'reenviar' ? 'Enviando…' : o.relatorioEm ? 'Reenviar relatório' : 'Enviar relatório ao cliente'}
          </button>
        )}
        {gerencia && ['aberta', 'agendada', 'execucao', 'aguardando_peca'].includes(o.status) && (
          <Link to={`/campo?os=${o.id}`} className="btn-secondary">
            Preencher (como técnico)
          </Link>
        )}
        {gerencia && !final && !cancelando && (
          <button type="button" className="btn btn-sm ml-auto text-bad underline" onClick={() => setCancelando(true)}>
            Cancelar OS
          </button>
        )}
      </div>
      {cancelando && (
        <div className="flex gap-2">
          <input className="input" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que cancelar?" />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={!motivo.trim() || !!ocupado}
            onClick={() => void rodar('cancelar', () => api.cancelarOrdem(o.id, motivo.trim()), `OS ${o.numero} cancelada.`)}
          >
            Cancelar OS
          </button>
        </div>
      )}
    </Gaveta>
  );
}
