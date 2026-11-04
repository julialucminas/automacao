import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Equipamento, Pendencia, PerifericoId } from '../types';
import { montarEquipamentos, nomeEquipamento } from '../lib/equipamentos';
import { STATUS, montarPainel, ordenarPorUrgencia, regrasDe, type LinhaPainel, type Regras, type Status } from '../lib/manutencao';
import { dataBr, dataCurta, hojeIso } from '../lib/calendario';
import { semAcento } from '../lib/normalizar';
import { useBuscaDaUrl } from '../lib/buscaDaUrl';
import { Chip, Modal } from '../components/ui';
import { IcBusca, IcMais } from '../components/Icones';
import { Ficha } from './Equipamentos';

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

type Visao = 'maquinas' | 'pendencias';

/** A aba "Programação" do Quadro Geral, dentro do sistema. */
export function Manutencao() {
  const { clientes, oficina, config, pode, veValores } = useEstado();
  const edita = pode('manutencao', 2);
  const regras = useMemo(() => regrasDe(config), [config]);
  const [fichas, setFichas] = useState<Equipamento[] | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [erro, setErro] = useState('');
  const [visao, setVisao] = useState<Visao>('maquinas');
  const [busca, setBusca] = useState('');
  useBuscaDaUrl(setBusca);
  const [status, setStatus] = useState<Status | 'todos'>('todos');
  const [tecnico, setTecnico] = useState('');
  const [regiao, setRegiao] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [visitando, setVisitando] = useState<LinhaPainel | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api.listarEquipamentos(), api.listarPendencias()]);
      setFichas(f);
      setPendencias(p);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const linhasEquip = useMemo(() => montarEquipamentos(fichas ?? [], clientes, oficina), [fichas, clientes, oficina]);
  const painel = useMemo(() => montarPainel(linhasEquip, regras, pendencias).sort(ordenarPorUrgencia), [linhasEquip, regras, pendencias]);
  const tecnicos = useMemo(() => [...new Set(painel.map((l) => l.ficha?.tecnico).filter((x): x is string => !!x))].sort(), [painel]);
  const regioes = useMemo(
    () => [...new Set(painel.map((l) => l.ficha?.regiao).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [painel],
  );
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of painel) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [painel]);
  const perifVencidos = painel.filter((l) => l.perifericos.some((p) => p.vencido)).length;

  const q = semAcento(busca).toUpperCase().trim();
  const qFrota = q.replace(/^(FROTA|FT)[\s-]*/, '');
  const lista = painel.filter((l) => {
    if (status !== 'todos' && l.status !== status) return false;
    if (tecnico && l.ficha?.tecnico !== tecnico) return false;
    if (regiao && l.ficha?.regiao !== regiao) return false;
    if (!q) return true;
    if (l.frota === qFrota) return true;
    const alvo = semAcento(`FT${l.frota} ${l.linha.cliente?.nome ?? ''} ${nomeEquipamento(l.linha)} ${l.ficha?.tecnico ?? ''}`).toUpperCase();
    return q.split(/\s+/).every((p) => alvo.includes(p));
  });
  // quem digitou o número exato da frota quer ela primeiro
  if (qFrota) lista.sort((a, b) => Number(b.frota === qFrota) - Number(a.frota === qFrota));
  const aberto = painel.find((l) => l.frota === aberta) ?? null;
  const linhaFicha = aberto?.linha ?? linhasEquip.find((l) => l.frota === aberta) ?? null;

  const atualizarFicha = (e: Equipamento) => setFichas((l) => (l ? [...l.filter((x) => x.frota !== e.frota), e] : [e]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Operação</div>
          <h1 className="mt-1 text-[26px] font-bold">Painel de manutenção</h1>
          <p className="text-[13px] text-ink-3">Visitas, preventivas, periféricos e pendências de cada máquina. Calculado sozinho a partir das fichas.</p>
        </div>
        <div className="flex rounded-[10px] border border-line-strong bg-white p-0.5" role="tablist">
          {(
            [
              ['maquinas', `Máquinas · ${painel.length}`],
              ['pendencias', `Pendências · ${pendencias.length}`],
            ] as const
          ).map(([k, r]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={visao === k}
              onClick={() => setVisao(k)}
              className={`min-h-[40px] rounded-lg px-4 text-[14px] font-semibold ${visao === k ? 'bg-noite text-white' : 'text-ink-2 hover:bg-line-soft'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {fichas && fichas.length === 0 && (
        <p className="rounded-xl border-2 border-brand bg-brand-soft px-4 py-3 text-[14px]">
          O painel aparece depois que a planilha Quadro Geral Manutenção for importada em <b>Frota → Equipamentos</b>.
        </p>
      )}

      {visao === 'maquinas' ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(['atrasado', 'atencao', 'em-dia'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(status === s ? 'todos' : s)}
                className={`rounded-xl border bg-white px-4 py-3 text-left ${status === s ? 'border-noite ring-2 ring-noite' : 'border-line hover:bg-canvas'}`}
              >
                <div className={`text-[26px] font-bold leading-none ${s === 'atrasado' ? 'text-bad' : s === 'atencao' ? 'text-warn' : 'text-ok'}`}>{contagem[s] ?? 0}</div>
                <div className="mt-1 text-xs text-ink-3">{s === 'atrasado' ? 'atrasadas' : s === 'atencao' ? 'vencem esta semana' : 'em dia'}</div>
              </button>
            ))}
            <div className="rounded-xl border border-line bg-white px-4 py-3">
              <div className="text-[26px] font-bold leading-none text-warn">{perifVencidos}</div>
              <div className="mt-1 text-xs text-ink-3">com periférico vencido</div>
            </div>
            <button type="button" onClick={() => setVisao('pendencias')} className="rounded-xl border border-line bg-white px-4 py-3 text-left hover:bg-canvas">
              <div className="text-[26px] font-bold leading-none">{pendencias.length}</div>
              <div className="mt-1 text-xs text-ink-3">pendências abertas</div>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Buscar</span>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                <IcBusca tamanho={15} />
              </span>
              <input type="search" className="input w-[240px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota, cliente, modelo…" />
            </label>
            <select aria-label="Técnico" className="input w-auto" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
              <option value="">Todos os técnicos</option>
              {tecnicos.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select aria-label="Região" className="input w-auto" value={regiao} onChange={(e) => setRegiao(e.target.value)}>
              <option value="">Todas as regiões</option>
              {regioes.map((r) => (
                <option key={r} value={r}>
                  Região {r}
                </option>
              ))}
            </select>
            {(status !== 'todos' || tecnico || regiao || busca) && (
              <button
                type="button"
                className="btn btn-sm text-ink-3 underline"
                onClick={() => {
                  setStatus('todos');
                  setTecnico('');
                  setRegiao('');
                  setBusca('');
                }}
              >
                Limpar filtros
              </button>
            )}
            <span className="ml-auto text-[13px] text-ink-3">{lista.length} máquinas</span>
          </div>

          {!fichas && !erro ? (
            <p className="text-ink-3">Carregando…</p>
          ) : (
            <section className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full min-w-[1080px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-[#F8F7F3] text-left text-xs text-ink-3">
                    <th className="px-3 py-2 font-semibold">Frota</th>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Última visita</th>
                    <th className="px-3 py-2 text-right font-semibold">Horímetro</th>
                    <th className="px-3 py-2 text-right font-semibold">Próx. preventiva</th>
                    <th className="px-3 py-2 text-right font-semibold">Faltam</th>
                    <th className="px-3 py-2 font-semibold">Técnico</th>
                    <th className="px-3 py-2 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => {
                    const vencidos = l.perifericos.filter((p) => p.vencido);
                    return (
                      <tr
                        key={l.frota}
                        className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-brand-tint ${l.status === 'atrasado' ? 'bg-bad-soft/40' : ''}`}
                        onClick={() => setAberta(l.frota)}
                      >
                        <td className="px-3 py-2">
                          <button type="button" className="font-mono text-[15px] font-bold hover:underline" onClick={() => setAberta(l.frota)}>
                            FT{l.frota}
                          </button>
                          <span className="block max-w-[150px] truncate text-xs text-ink-3">{nomeEquipamento(l.linha)}</span>
                        </td>
                        <td className="px-3 py-2">
                          {l.linha.cliente?.nome ?? (l.linha.situacao === 'oficina' ? <span className="text-warn">oficina</span> : <span className="text-ink-3">—</span>)}
                        </td>
                        <td className="px-3 py-2" title={l.tipo?.nome}>
                          {l.ficha?.tipoVisita ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          {l.ficha?.ultimaVisita ? (
                            <>
                              {dataBr(l.ficha.ultimaVisita)}
                              <span className={`block text-xs ${l.diasDesdeVisita! > l.intervaloDias ? 'font-bold text-bad' : 'text-ink-3'}`}>
                                há {l.diasDesdeVisita} dias · a cada {l.intervaloDias}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{num(l.ficha?.horimetro)}</td>
                        <td className="px-3 py-2 text-right">{num(l.ficha?.proximaPreventiva)}</td>
                        <td className="px-3 py-2 text-right">
                          {l.horasFaltam === null ? (
                            '—'
                          ) : (
                            <>
                              <span className={l.horasFaltam < 0 ? 'font-bold text-bad' : ''}>{num(l.horasFaltam)} h</span>
                              {l.previsaoPreventiva && <span className="block text-xs text-ink-3">~{dataCurta(l.previsaoPreventiva)}</span>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-2">{l.ficha?.tecnico ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            <Chip tom={STATUS[l.status].tom}>{STATUS[l.status].rotulo}</Chip>
                            {vencidos.length > 0 && (
                              <span title={vencidos.map((p) => p.nome).join(', ')}>
                                <Chip tom="warn">
                                  {vencidos.length} periférico{vencidos.length > 1 ? 's' : ''}
                                </Chip>
                              </span>
                            )}
                            {l.pendencias.length > 0 && (
                              <span title={l.pendencias.map((p) => p.descricao).join(' / ')}>
                                <Chip tom="info">
                                  {l.pendencias.length} pendência{l.pendencias.length > 1 ? 's' : ''}
                                </Chip>
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-ink-3">
                        Nenhuma máquina com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : (
        <ListaPendencias pendencias={pendencias} edita={edita} abrir={(f) => setAberta(f)} mudou={recarregar} />
      )}

      <Ficha
        linha={linhaFicha}
        fechar={() => setAberta(null)}
        edita={pode('frotas', 2)}
        veValores={veValores}
        salvo={atualizarFicha}
        acoes={
          edita && aberto ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setVisitando(aberto)}>
              Registrar visita
            </button>
          ) : null
        }
        extra={
          aberta ? (
            <PendenciasDaFrota
              frota={aberta}
              cliente={linhaFicha?.cliente?.nome ?? ''}
              tecnico={linhaFicha?.ficha?.tecnico ?? ''}
              pendencias={pendencias}
              edita={edita}
              mudou={recarregar}
            />
          ) : null
        }
      />
      <RegistrarVisita
        linha={visitando}
        regras={regras}
        tecnicos={tecnicos}
        fechar={() => setVisitando(null)}
        salvo={(e) => {
          atualizarFicha(e);
          setVisitando(null);
        }}
      />
    </div>
  );
}

function RegistrarVisita({
  linha,
  regras,
  tecnicos,
  fechar,
  salvo,
}: {
  linha: LinhaPainel | null;
  regras: Regras;
  tecnicos: string[];
  fechar: () => void;
  salvo: (e: Equipamento) => void;
}) {
  return linha ? <FormVisita key={linha.frota} linha={linha} regras={regras} tecnicos={tecnicos} fechar={fechar} salvo={salvo} /> : null;
}

function FormVisita({ linha, regras, tecnicos, fechar, salvo }: { linha: LinhaPainel; regras: Regras; tecnicos: string[]; fechar: () => void; salvo: (e: Equipamento) => void }) {
  const { avisar } = useEstado();
  const f = linha.ficha;
  const [data, setData] = useState(hojeIso());
  const [horimetro, setHorimetro] = useState('');
  const [tipo, setTipo] = useState(f?.tipoVisita && regras.tipos.some((t) => t.sigla === f.tipoVisita) ? f.tipoVisita : (regras.tipos[0]?.sigla ?? ''));
  const [tecnico, setTecnico] = useState(f?.tecnico ?? '');
  const [proxima, setProxima] = useState<string | null>(null); // null = calcula sozinho
  const [perifericos, setPerifericos] = useState<PerifericoId[]>([]);
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const h = horimetro.trim() ? Number(horimetro.replace(/\./g, '').replace(',', '.')) : null;
  const t = regras.tipos.find((x) => x.sigla === tipo);
  // preventiva por horas: a próxima é o horímetro de agora + o intervalo do tipo; nos outros tipos fica como está
  const sugerida = t?.horas && h !== null && Number.isFinite(h) ? h + t.horas : (f?.proximaPreventiva ?? null);
  const proximaFinal = proxima === null ? sugerida : proxima.trim() ? Number(proxima.replace(/\./g, '').replace(',', '.')) : null;
  const naoAplica = new Set((f?.perifericosNaoAplica ?? '').split(','));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (h !== null && (!Number.isFinite(h) || h < 0)) return setErro('Horímetro inválido.');
    if (proximaFinal !== null && !Number.isFinite(proximaFinal)) return setErro('Próxima preventiva inválida.');
    setSalvando(true);
    try {
      const eq = await api.registrarVisita(linha.frota, {
        data,
        horimetro: h,
        tipo,
        tecnico: tecnico.trim(),
        cliente: linha.linha.cliente?.nome ?? '',
        proximaPreventiva: proximaFinal,
        perifericos,
        observacao: obs.trim(),
      });
      avisar(`Visita na FT${linha.frota} registrada. O painel já foi atualizado.`);
      salvo(eq);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={fechar} titulo={`Registrar visita · FT${linha.frota}`}>
      <form onSubmit={enviar} className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Data
            <input type="date" className="input font-normal" required value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Horímetro agora
            <input
              className="input font-normal"
              inputMode="decimal"
              value={horimetro}
              onChange={(e) => setHorimetro(e.target.value)}
              placeholder={f?.horimetro != null ? `último: ${num(f.horimetro)}` : ''}
            />
            {h !== null && f?.horimetro != null && Math.abs(h - f.horimetro) > 2000 && <span className="font-normal text-warn">Confira: o último era {num(f.horimetro)} h.</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            O que foi feito
            <select className="input font-normal" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {regras.tipos.map((x) => (
                <option key={x.sigla} value={x.sigla}>
                  {x.sigla} · {x.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Técnico
            <input className="input font-normal" list="tecnicos-visita" value={tecnico} onChange={(e) => setTecnico(e.target.value)} />
            <datalist id="tecnicos-visita">
              {tecnicos.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Próxima preventiva (horímetro)
          <input className="input font-normal" inputMode="decimal" value={proxima ?? (sugerida != null ? String(sugerida) : '')} onChange={(e) => setProxima(e.target.value)} />
          <span className="font-normal text-ink-3">
            {t?.horas ? `Calculada: horímetro + ${t.horas} h (${t.nome}). Dá para mudar.` : 'Este tipo de visita não muda a próxima preventiva.'}
          </span>
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-semibold">Periféricos trocados nesta visita</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {regras.perifericos
              .filter((p) => !naoAplica.has(p.id))
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={perifericos.includes(p.id)}
                    onChange={(e) => setPerifericos(e.target.checked ? [...perifericos, p.id] : perifericos.filter((x) => x !== p.id))}
                  />
                  {p.nome}
                </label>
              ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Observação <span className="font-normal text-ink-3">(opcional)</span>
          <textarea rows={2} className="input py-2 font-normal" value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={salvando || !tipo}>
            {salvando ? 'Salvando…' : 'Registrar visita'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PendenciasDaFrota({
  frota,
  cliente,
  tecnico,
  pendencias,
  edita,
  mudou,
}: {
  frota: string;
  cliente: string;
  tecnico: string;
  pendencias: Pendencia[];
  edita: boolean;
  mudou: () => Promise<void>;
}) {
  const { avisar } = useEstado();
  const minhas = pendencias.filter((p) => p.frota === frota);
  const [nova, setNova] = useState('');
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    if (!nova.trim()) return;
    setSalvando(true);
    try {
      await api.criarPendencia({ frota, cliente, abertaEm: hojeIso(), tecnico, descricao: nova.trim() });
      setNova('');
      avisar(`Pendência aberta na FT${frota}.`);
      await mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Pendências abertas</h3>
      {minhas.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nenhuma.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {minhas.map((p) => (
            <ItemPendencia key={p.id} p={p} edita={edita} mudou={mudou} />
          ))}
        </ul>
      )}
      {edita && (
        <div className="flex gap-2">
          <input
            className="input"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Nova pendência (ex.: trocar a bomba hidráulica)"
            onKeyDown={(e) => e.key === 'Enter' && void criar()}
          />
          <button type="button" className="btn-secondary shrink-0" disabled={!nova.trim() || salvando} onClick={() => void criar()}>
            <IcMais tamanho={16} /> Abrir
          </button>
        </div>
      )}
    </section>
  );
}

function ItemPendencia({
  p,
  edita,
  mudou,
  mostrarFrota,
  abrir,
}: {
  p: Pendencia;
  edita: boolean;
  mudou: () => Promise<void>;
  mostrarFrota?: boolean;
  abrir?: (f: string) => void;
}) {
  const { avisar } = useEstado();
  const [resolvendo, setResolvendo] = useState(false);
  const [como, setComo] = useState('');
  const dias = Math.round((Date.parse(hojeIso()) - Date.parse(p.abertaEm)) / 86_400_000);
  const resolver = async () => {
    try {
      await api.resolverPendencia(p.id, true, como.trim());
      avisar(`Pendência da FT${p.frota} resolvida.`);
      await mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    }
  };
  return (
    <li className="rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {mostrarFrota && (
            <button type="button" className="mr-2 font-mono font-bold hover:underline" onClick={() => abrir?.(p.frota)}>
              FT{p.frota}
            </button>
          )}
          <span className="font-semibold">{p.descricao}</span>
          <span className="block text-xs text-ink-3">
            {[p.cliente, p.tecnico, `aberta em ${dataBr(p.abertaEm)}`].filter(Boolean).join(' · ')}
            {dias > 30 && <b className="text-bad"> · há {dias} dias</b>}
          </span>
        </div>
        {edita && !resolvendo && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setResolvendo(true)}>
            Resolver
          </button>
        )}
      </div>
      {resolvendo && (
        <div className="mt-2 flex gap-2">
          <input
            className="input h-9 text-[13px]"
            autoFocus
            value={como}
            onChange={(e) => setComo(e.target.value)}
            placeholder="O que foi feito (opcional)"
            onKeyDown={(e) => e.key === 'Enter' && void resolver()}
          />
          <button type="button" className="btn-primary btn-sm shrink-0" onClick={() => void resolver()}>
            Resolvida
          </button>
          <button type="button" className="btn btn-sm shrink-0 text-ink-3" onClick={() => setResolvendo(false)}>
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

function ListaPendencias({ pendencias, edita, abrir, mudou }: { pendencias: Pendencia[]; edita: boolean; abrir: (f: string) => void; mudou: () => Promise<void> }) {
  const [busca, setBusca] = useState('');
  const q = semAcento(busca).toUpperCase().trim();
  const lista = pendencias
    .filter((p) => !q || semAcento(`FT${p.frota} ${p.descricao} ${p.cliente} ${p.tecnico}`).toUpperCase().includes(q))
    .sort((a, b) => a.abertaEm.localeCompare(b.abertaEm));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Mais antigas primeiro. Para abrir uma pendência nova, clique na máquina no painel.</p>
        <label className="relative">
          <span className="sr-only">Buscar pendência</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={15} />
          </span>
          <input type="search" className="input w-[260px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota, cliente, técnico, peça…" />
        </label>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">Nenhuma pendência aberta{busca ? ' com essa busca' : ''}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((p) => (
            <ItemPendencia key={p.id} p={p} edita={edita} mudou={mudou} mostrarFrota abrir={abrir} />
          ))}
        </ul>
      )}
    </section>
  );
}
