import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { DadosExterno, EtapaExterno, Pessoa, ServicoExterno } from '../types';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { dataBr } from '../lib/calendario';
import { semAcento } from '../lib/normalizar';
import { Chip, Gaveta, Modal } from '../components/ui';
import { IcBusca, IcMais } from '../components/Icones';

export const ETAPAS: Record<EtapaExterno, { rotulo: string; quem: string; tom: 'neutro' | 'info' | 'warn' | 'ok' | 'bad' }> = {
  pedido: { rotulo: 'Pedido recebido', quem: 'falta orçar', tom: 'warn' },
  orcamento: { rotulo: 'Orçamento em preparo', quem: 'Angelise orçando', tom: 'warn' },
  enviado: { rotulo: 'Orçamento enviado', quem: 'esperando o cliente', tom: 'info' },
  aprovado: { rotulo: 'Aprovado', quem: 'falta executar', tom: 'info' },
  execucao: { rotulo: 'Em execução', quem: 'técnico no serviço', tom: 'info' },
  concluido: { rotulo: 'Concluído · a cobrar', quem: 'falta cobrar', tom: 'warn' },
  cobrado: { rotulo: 'Cobrado', quem: 'finalizado', tom: 'ok' },
  recusado: { rotulo: 'Recusado', quem: 'cliente não aprovou', tom: 'neutro' },
};
const ATIVAS: EtapaExterno[] = ['pedido', 'orcamento', 'enviado', 'aprovado', 'execucao', 'concluido'];
const PROXIMA: Partial<Record<EtapaExterno, EtapaExterno>> = { pedido: 'orcamento', orcamento: 'enviado', enviado: 'aprovado', aprovado: 'execucao', execucao: 'concluido', concluido: 'cobrado' };
const BOTAO_PROXIMA: Partial<Record<EtapaExterno, string>> = {
  pedido: 'Começar orçamento',
  orcamento: 'Orçamento enviado ao cliente',
  enviado: 'Cliente aprovou',
  aprovado: 'Começou a execução',
  execucao: 'Serviço concluído',
  concluido: 'Cobrança feita',
};

const ha = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`;
};
const desdeEtapa = (s: ServicoExterno) => [...s.historico].reverse().find((h) => h.etapa === s.etapa)?.em ?? s.criadoEm;
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Operação → Serviços externos: em que etapa está cada serviço fora da locação (sem automação). */
export function Externos() {
  const { pode, veValores } = useEstado();
  const edita = pode('externos', 2);
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<ServicoExterno[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [finalizados, setFinalizados] = useState(false);
  const [novo, setNovo] = useState(false);
  const aberto = lista?.find((s) => String(s.id) === params.get('id')) ?? null;

  useEffect(() => {
    api.listarExternos().then(setLista, (e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar.'));
  }, []);
  const mudou = (s: ServicoExterno) => setLista((l) => (l?.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [s, ...(l ?? [])]));

  const q = semAcento(busca.trim().toLowerCase());
  const filtrados = useMemo(
    () => (lista ?? []).filter((s) => !q || semAcento(`${s.id} ${s.clienteNome} ${s.equipamento} ${s.descricao} ${s.responsavelNome} ${s.contato}`.toLowerCase()).includes(q)),
    [lista, q],
  );
  const conta = (e: EtapaExterno[]) => (lista ?? []).filter((s) => e.includes(s.etapa)).length;
  const aCobrar = (lista ?? []).filter((s) => s.etapa === 'concluido');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Operação</div>
          <h1 className="mt-1 text-[26px] font-bold">Serviços externos</h1>
          <p className="max-w-[680px] text-[13px] text-ink-3">
            Serviços fora da locação (máquina do cliente). Cada um passa pelas etapas: pedido, orçamento, aprovação, execução e cobrança. Aqui não sai e-mail nem boleto; é só para todos saberem
            em que etapa está.
          </p>
        </div>
        {edita && (
          <button type="button" className="btn-primary" onClick={() => setNovo(true)}>
            <IcMais tamanho={16} /> Novo serviço
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-white px-5 py-3">
        <Resumo n={conta(['pedido', 'orcamento'])} rotulo="para orçar" alerta />
        <Resumo n={conta(['enviado'])} rotulo="esperando o cliente" />
        <Resumo n={conta(['aprovado', 'execucao'])} rotulo="aprovados / em execução" />
        <Resumo n={aCobrar.length} rotulo={`para cobrar${veValores && aCobrar.some((s) => s.valor) ? ` · ${formatarReais(aCobrar.reduce((t, s) => t + (s.valor ?? 0), 0))}` : ''}`} alerta />
        <label className="relative ml-auto">
          <span className="sr-only">Buscar serviço</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={15} />
          </span>
          <input className="input h-9 w-[240px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, máquina, nº…" />
        </label>
      </div>

      {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
      {!lista && !erro && <p className="text-ink-3">Carregando…</p>}
      {lista && lista.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-strong bg-white p-6 text-center text-[14px] text-ink-3">
          Nenhum serviço externo ainda.{edita ? ' Clique em "Novo serviço" quando um cliente pedir.' : ''}
        </p>
      )}

      {lista && lista.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="grid min-w-[1100px] grid-cols-6 gap-3">
            {ATIVAS.map((e) => {
              const l = filtrados.filter((s) => s.etapa === e).sort((a, b) => desdeEtapa(a).localeCompare(desdeEtapa(b)));
              return (
                <section key={e} aria-label={ETAPAS[e].rotulo} className="flex flex-col gap-2 rounded-xl bg-line-soft/60 p-2">
                  <h2 className="flex items-center justify-between px-1.5 pt-1 text-[12px] font-bold uppercase tracking-wide text-ink-2">
                    {ETAPAS[e].rotulo}
                    <span className="rounded-full bg-white px-2 text-ink-3">{l.length}</span>
                  </h2>
                  {l.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setParams({ id: String(s.id) })}
                      className="flex flex-col gap-1 rounded-lg border border-line bg-white p-2.5 text-left text-[13px] hover:border-brand"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-bold leading-tight">{s.clienteNome}</span>
                        <span className="text-xs text-ink-3">nº {s.id}</span>
                      </span>
                      {s.equipamento && <span className="text-ink-2">{s.equipamento}</span>}
                      {s.descricao && <span className="line-clamp-2 text-ink-3">{s.descricao}</span>}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                        {veValores && s.valor != null && <b className="text-ink">{formatarReais(s.valor)}</b>}
                        {s.responsavelNome && <span>{s.responsavelNome}</span>}
                        <span>{ha(desdeEtapa(s))}</span>
                      </span>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {lista && conta(['cobrado', 'recusado']) > 0 && (
        <section className="flex flex-col gap-2">
          <button type="button" className="btn btn-sm self-start text-ink-2 underline" onClick={() => setFinalizados(!finalizados)}>
            {finalizados ? 'Esconder finalizados' : `Ver finalizados (${conta(['cobrado', 'recusado'])})`}
          </button>
          {finalizados && (
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full text-left text-[13.5px]">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Nº</th>
                    <th className="px-4 py-2 font-semibold">Cliente</th>
                    <th className="px-4 py-2 font-semibold">Máquina</th>
                    {veValores && <th className="px-4 py-2 text-right font-semibold">Valor</th>}
                    <th className="px-4 py-2 font-semibold">Situação</th>
                    <th className="px-4 py-2 font-semibold">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados
                    .filter((s) => s.etapa === 'cobrado' || s.etapa === 'recusado')
                    .map((s) => (
                      <tr key={s.id} className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-brand-tint" onClick={() => setParams({ id: String(s.id) })}>
                        <td className="px-4 py-2">{s.id}</td>
                        <td className="px-4 py-2 font-semibold">{s.clienteNome}</td>
                        <td className="px-4 py-2">{s.equipamento || '—'}</td>
                        {veValores && <td className="px-4 py-2 text-right">{s.valor != null ? formatarReais(s.valor) : '—'}</td>}
                        <td className="px-4 py-2">
                          <Chip tom={ETAPAS[s.etapa].tom}>{ETAPAS[s.etapa].rotulo}</Chip>
                        </td>
                        <td className="px-4 py-2 text-ink-3">{dataBr(desdeEtapa(s).slice(0, 10))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {novo && (
        <Modal aberto fechar={() => setNovo(false)} titulo="Novo serviço externo">
          <Formulario
            fechar={() => setNovo(false)}
            salvo={(s) => {
              mudou(s);
              setNovo(false);
            }}
          />
        </Modal>
      )}
      {aberto && <Detalhe s={aberto} edita={edita} fechar={() => setParams({})} mudou={mudou} />}
    </div>
  );
}

function Resumo({ n, rotulo, alerta }: { n: number; rotulo: string; alerta?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b className={`text-[22px] leading-none ${alerta && n ? 'text-warn' : 'text-ink'}`}>{n}</b>
      <span className="text-[13px] text-ink-3">{rotulo}</span>
    </span>
  );
}

/** Cadastro e edição dos dados do serviço. */
function Formulario({ s, fechar, salvo }: { s?: ServicoExterno; fechar: () => void; salvo: (s: ServicoExterno) => void }) {
  const { clientes, veValores, avisar } = useEstado();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [d, setD] = useState({
    cliente: s?.clienteNome ?? '',
    contato: s?.contato ?? '',
    equipamento: s?.equipamento ?? '',
    descricao: s?.descricao ?? '',
    responsavelId: s?.responsavelId ? String(s.responsavelId) : '',
    previsao: s?.previsao ?? '',
    osNumero: s?.osNumero ? String(s.osNumero) : '',
    valor: s?.valor != null ? reaisParaCampo(s.valor) : '',
    obs: s?.obs ?? '',
  });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api.listarUsuarios().then(setPessoas, () => undefined);
  }, []);
  const campo = (k: keyof typeof d) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }) });

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    const cadastrado = clientes.find((c) => semAcento(c.nome.toLowerCase()) === semAcento(d.cliente.trim().toLowerCase()));
    const valor = d.valor.trim() ? lerReais(d.valor) : null;
    if (d.valor.trim() && valor === null) return setErro('Valor inválido.');
    const dados: DadosExterno = {
      clienteId: cadastrado?.id ?? null,
      clienteNome: d.cliente.trim(),
      contato: d.contato,
      equipamento: d.equipamento,
      descricao: d.descricao,
      responsavelId: d.responsavelId ? Number(d.responsavelId) : null,
      previsao: d.previsao || null,
      osNumero: d.osNumero.trim() ? Number(d.osNumero) : null,
      obs: d.obs,
      ...(veValores ? { valor } : {}),
    };
    setSalvando(true);
    try {
      const r = s ? await api.alterarExterno(s.id, dados) : await api.criarExterno(dados);
      avisar(s ? 'Serviço atualizado.' : `Serviço nº ${r.id} cadastrado.`);
      salvo(r);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const rotulo = 'flex flex-col gap-1 text-xs font-semibold';
  return (
    <form onSubmit={enviar} className="flex max-h-[78vh] flex-col gap-3 overflow-y-auto pr-1">
      <label className={rotulo}>
        Cliente
        <input className="input font-normal" list="clientes-externos" required {...campo('cliente')} placeholder="Nome da empresa" />
        <datalist id="clientes-externos">
          {clientes.map((c) => (
            <option key={c.id} value={c.nome} />
          ))}
        </datalist>
      </label>
      <label className={rotulo}>
        Contato
        <input className="input font-normal" {...campo('contato')} placeholder="Quem pediu, telefone" />
      </label>
      <label className={rotulo}>
        Máquina
        <input className="input font-normal" {...campo('equipamento')} placeholder="Ex.: Empilhadeira Hyster 2,5 t, série…" />
      </label>
      <label className={rotulo}>
        O que o cliente pediu
        <textarea rows={3} className="input py-2 font-normal" {...campo('descricao')} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={rotulo}>
          Responsável agora
          <select className="input font-normal" {...campo('responsavelId')}>
            <option value="">—</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className={rotulo}>
          Previsão
          <input type="date" className="input font-normal" {...campo('previsao')} />
        </label>
        {veValores && (
          <label className={rotulo}>
            Valor do orçamento
            <input className="input font-normal" inputMode="decimal" {...campo('valor')} placeholder="R$" />
          </label>
        )}
        <label className={rotulo}>
          Nº da OS (se tiver)
          <input className="input font-normal" inputMode="numeric" {...campo('osNumero')} />
        </label>
      </div>
      <label className={rotulo}>
        Observações
        <textarea rows={2} className="input py-2 font-normal" {...campo('obs')} placeholder="Ex.: nº do orçamento, forma de pagamento" />
      </label>
      {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
      <div className="flex justify-end gap-2.5">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={salvando}>
          {salvando ? 'Salvando…' : s ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}

function Detalhe({ s, edita, fechar, mudou }: { s: ServicoExterno; edita: boolean; fechar: () => void; mudou: (s: ServicoExterno) => void }) {
  const { veValores, avisar } = useEstado();
  const [editando, setEditando] = useState(false);
  const [obs, setObs] = useState('');
  const [outra, setOutra] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const proxima = PROXIMA[s.etapa];

  const mover = async (etapa: EtapaExterno) => {
    setOcupado(true);
    try {
      const r = await api.etapaExterno(s.id, etapa, obs.trim());
      mudou(r);
      setObs('');
      setOutra('');
      avisar(`Serviço nº ${s.id}: ${ETAPAS[etapa].rotulo}.`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível mudar a etapa.', 'bad');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Gaveta aberto fechar={fechar} titulo={`Serviço externo nº ${s.id}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tom={ETAPAS[s.etapa].tom}>{ETAPAS[s.etapa].rotulo}</Chip>
          <span className="text-[13px] text-ink-3">
            {ETAPAS[s.etapa].quem} · {ha(desdeEtapa(s))}
          </span>
        </div>

        {editando ? (
          <Formulario
            s={s}
            fechar={() => setEditando(false)}
            salvo={(r) => {
              mudou(r);
              setEditando(false);
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line p-4 text-[14px]">
            <Dado rotulo="Cliente">
              {s.clienteId ? (
                <Link to={`/clientes?busca=${encodeURIComponent(s.clienteNome)}`} className="text-info hover:underline">
                  {s.clienteNome}
                </Link>
              ) : (
                s.clienteNome
              )}
            </Dado>
            <Dado rotulo="Contato">{s.contato || '—'}</Dado>
            <Dado rotulo="Máquina" largo>
              {s.equipamento || '—'}
            </Dado>
            <Dado rotulo="O que o cliente pediu" largo>
              <span className="whitespace-pre-wrap">{s.descricao || '—'}</span>
            </Dado>
            <Dado rotulo="Responsável agora">{s.responsavelNome || '—'}</Dado>
            <Dado rotulo="Previsão">{s.previsao ? dataBr(s.previsao) : '—'}</Dado>
            {veValores && <Dado rotulo="Valor do orçamento">{s.valor != null ? formatarReais(s.valor) : '—'}</Dado>}
            <Dado rotulo="OS">
              {s.osNumero ? (
                <Link to={`/ordens?busca=${s.osNumero}`} className="text-info hover:underline">
                  OS {s.osNumero}
                </Link>
              ) : (
                '—'
              )}
            </Dado>
            {s.obs && (
              <Dado rotulo="Observações" largo>
                <span className="whitespace-pre-wrap">{s.obs}</span>
              </Dado>
            )}
            {edita && (
              <div className="col-span-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(true)}>
                  Editar dados
                </button>
              </div>
            )}
          </dl>
        )}

        {edita && !editando && (
          <section className="flex flex-col gap-2.5 rounded-xl border-2 border-brand bg-brand-tint p-4">
            <h3 className="text-[15px] font-bold">Mudar a etapa</h3>
            <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional): ex.: orçamento 123 mandado por WhatsApp" />
            <div className="flex flex-wrap gap-2">
              {proxima && (
                <button type="button" className="btn-primary" disabled={ocupado} onClick={() => void mover(proxima)}>
                  {BOTAO_PROXIMA[s.etapa]} →
                </button>
              )}
              {s.etapa === 'enviado' && (
                <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => void mover('recusado')}>
                  Cliente recusou
                </button>
              )}
              {obs.trim() && (
                <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => void mover(s.etapa)}>
                  Só anotar
                </button>
              )}
            </div>
            <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              Ou voltar/pular para
              <select aria-label="Outra etapa" className="input h-9 w-auto" value={outra} onChange={(e) => setOutra(e.target.value)}>
                <option value="">escolher…</option>
                {(Object.keys(ETAPAS) as EtapaExterno[])
                  .filter((e) => e !== s.etapa && e !== proxima)
                  .map((e) => (
                    <option key={e} value={e}>
                      {ETAPAS[e].rotulo}
                    </option>
                  ))}
              </select>
              {outra && (
                <button type="button" className="btn-secondary btn-sm" disabled={ocupado} onClick={() => void mover(outra as EtapaExterno)}>
                  Mudar
                </button>
              )}
            </label>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Histórico</h3>
          <ol className="flex flex-col gap-2 border-l-2 border-line pl-4">
            {[...s.historico].reverse().map((h, i) => (
              <li key={i} className="relative text-[13.5px]">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                <b>{ETAPAS[h.etapa].rotulo}</b>
                <span className="text-ink-3">
                  {' '}
                  · {h.por} · {hora(h.em)}
                </span>
                {h.obs && <span className="block text-ink-2">{h.obs}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Gaveta>
  );
}

function Dado({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <div className={largo ? 'col-span-2' : ''}>
      <dt className="text-xs text-ink-3">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}
