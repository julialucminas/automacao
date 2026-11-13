import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { EtapaReajuste, EtapaRenovacao, RegistroContrato, StatusContrato } from '../types';
import type { Contrato } from '../lib/contratos';
import { dataBr, hojeIso } from '../lib/calendario';
import { dataHora } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { Gaveta } from './ui';

export const ETAPAS_RENOVACAO: { id: EtapaRenovacao; rotulo: string; tom: string }[] = [
  { id: '', rotulo: 'Sem etapa', tom: 'text-ink-3' },
  { id: 'a_contatar', rotulo: 'A contatar', tom: 'text-bad' },
  { id: 'em_conversa', rotulo: 'Em conversa', tom: 'text-info' },
  { id: 'minuta_enviada', rotulo: 'Minuta enviada', tom: 'text-info' },
  { id: 'aguardando_assinatura', rotulo: 'Aguardando assinatura', tom: 'text-warn-strong' },
  { id: 'renovado', rotulo: 'Renovado', tom: 'text-ok' },
  { id: 'nao_renova', rotulo: 'Não vai renovar', tom: 'text-ink-2' },
];
export const ETAPAS_REAJUSTE: { id: EtapaReajuste; rotulo: string; tom: string }[] = [
  { id: '', rotulo: 'Sem etapa', tom: 'text-ink-3' },
  { id: 'a_negociar', rotulo: 'A negociar', tom: 'text-bad' },
  { id: 'em_conversa', rotulo: 'Em conversa', tom: 'text-info' },
  { id: 'proposta_enviada', rotulo: 'Proposta enviada', tom: 'text-info' },
  { id: 'aceito', rotulo: 'Aceito (falta aplicar)', tom: 'text-warn-strong' },
  { id: 'recusado', rotulo: 'Recusado', tom: 'text-bad' },
  { id: 'aplicado', rotulo: 'Aplicado', tom: 'text-ok' },
];
const CANAIS = ['Telefone', 'WhatsApp', 'E-mail', 'Visita', 'Outro'];
const ASSUNTO: Record<RegistroContrato['assunto'], string> = { renovacao: 'Renovação', reajuste: 'Reajuste', geral: 'Geral' };

export type Acompanhamento = { registros: RegistroContrato[]; status: StatusContrato[] };

/** ajuda: registros, último contato, retorno e pendências de um contrato */
export function doContrato(a: Acompanhamento, chave: string, assunto?: RegistroContrato['assunto']) {
  const regs = a.registros.filter((r) => r.chave === chave);
  const contatos = regs.filter((r) => r.tipo === 'contato' && (!assunto || r.assunto === assunto));
  const ultimo = contatos[0] ?? null; // registros já vêm do mais novo para o mais antigo
  return {
    regs,
    ultimo,
    retorno: ultimo?.proximaData ?? null,
    pendencias: regs.filter((r) => r.tipo === 'pendencia' && !r.resolvidaEm),
    status: a.status.find((s) => s.chave === chave) ?? null,
  };
}

function Etapa<T extends string>({ valor, opcoes, mudar, edita }: { valor: T; opcoes: { id: T; rotulo: string; tom: string }[]; mudar: (v: T) => void; edita: boolean }) {
  const o = opcoes.find((x) => x.id === valor) ?? opcoes[0];
  if (!edita) return <span className={`font-semibold ${o.tom}`}>{o.rotulo}</span>;
  return (
    <select aria-label="Etapa" className={`input h-9 py-0 text-[13px] font-semibold ${o.tom}`} value={valor} onChange={(e) => mudar(e.target.value as T)} onClick={(e) => e.stopPropagation()}>
      {opcoes.map((x) => (
        <option key={x.id} value={x.id}>
          {x.rotulo}
        </option>
      ))}
    </select>
  );
}

function UltimoContato({ r, retorno }: { r: RegistroContrato | null; retorno: string | null }) {
  const hoje = hojeIso();
  if (!r) return <span className="text-ink-3">nenhum contato registrado</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-ink-2" title={r.texto}>
        {dataBr(r.criadoEm.slice(0, 10))}
        {r.canal && ` · ${r.canal}`}
        {r.contato && ` · ${r.contato}`}: {r.texto}
      </span>
      {retorno && <span className={`block text-[12px] font-semibold ${retorno <= hoje ? 'text-bad' : 'text-ink-3'}`}>{retorno <= hoje ? `⚠ retornar (era ${dataBr(retorno)})` : `retornar em ${dataBr(retorno)}`}</span>}
    </span>
  );
}

const SeloPendencias = ({ n }: { n: number }) =>
  n ? <span className="inline-flex items-center gap-1 rounded-full bg-bad px-2 py-0.5 text-[11.5px] font-bold text-white">⚠ {n} pendência{n > 1 ? 's' : ''}</span> : null;

// ------------------------------------------------------------------ Renovações

export function PainelRenovacoes({ contratos, a, abrir, mudou }: { contratos: Contrato[]; a: Acompanhamento; abrir: (c: Contrato) => void; mudou: () => void }) {
  const { pode, avisar } = useEstado();
  const edita = pode('contratos', 2);
  const [filtro, setFiltro] = useState<'proximos' | 'andamento' | 'todos'>('proximos');
  const emAndamento = (c: Contrato) => {
    const e = doContrato(a, c.chave).status?.renovacao ?? '';
    return !!e && e !== 'renovado' && e !== 'nao_renova';
  };
  const lista = contratos
    .filter((c) => (filtro === 'todos' ? true : filtro === 'andamento' ? emAndamento(c) : c.diasParaVencer <= 120 || emAndamento(c)))
    .sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  const mudar = async (c: Contrato, renovacao: EtapaRenovacao) => {
    try {
      await api.mudarStatusContrato({ clienteId: c.cliente.id, chave: c.chave, renovacao });
      mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível mudar a etapa.', 'bad');
    }
  };
  return (
    <section aria-label="Renovações" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Contratos vencendo em até 120 dias (e os que já estão em conversa). Mude a etapa e registre cada contato.</p>
        <Filtros valor={filtro} mudar={setFiltro} opcoes={[['proximos', 'Vencem em 120 dias'], ['andamento', 'Em andamento'], ['todos', 'Todos']]} />
      </div>
      <Tabela
        cabecalho={['Cliente · contrato', 'Vence', 'Etapa da renovação', 'Último contato', '']}
        colunas="lg:grid-cols-[minmax(170px,1.2fr)_110px_190px_minmax(200px,2fr)_120px]"
        vazio="Nenhum contrato nesse filtro."
        linhas={lista.map((c) => {
          const d = doContrato(a, c.chave, 'renovacao');
          return {
            chave: c.chave,
            celulas: [
              <span key="c" className="min-w-0">
                <b className="block truncate">{c.cliente.nome}</b>
                <span className="flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-ink-3">
                  {c.numero || 'sem número'} <SeloPendencias n={d.pendencias.length} />
                </span>
              </span>,
              <span key="v">
                <span className={c.status === 'vencido' ? 'font-semibold text-bad' : c.status === 'vencendo' ? 'font-semibold text-warn-strong' : ''}>{dataBr(c.vencimento)}</span>
                <span className="block text-[11.5px] text-ink-3">{c.diasParaVencer < 0 ? `venceu há ${-c.diasParaVencer} d` : `faltam ${c.diasParaVencer} d`}</span>
              </span>,
              <Etapa key="e" valor={(d.status?.renovacao ?? '') as EtapaRenovacao} opcoes={ETAPAS_RENOVACAO} mudar={(v) => void mudar(c, v)} edita={edita} />,
              <UltimoContato key="u" r={d.ultimo} retorno={d.retorno} />,
              <button key="b" type="button" className="btn-secondary btn-sm" onClick={() => abrir(c)}>
                Tratativas
              </button>,
            ],
          };
        })}
      />
    </section>
  );
}

// ------------------------------------------------------------------ Reajustes

export function PainelReajustes({ contratos, a, abrir, mudou, veValor }: { contratos: Contrato[]; a: Acompanhamento; abrir: (c: Contrato) => void; mudou: () => void; veValor: boolean }) {
  const { pode, avisar } = useEstado();
  const edita = pode('contratos', 2);
  const hoje = hojeIso();
  const [filtro, setFiltro] = useState<'proximos' | 'andamento' | 'todos'>('proximos');
  const [pcts, setPcts] = useState<Record<string, string>>({});
  const daqui60 = new Date(Date.parse(hoje) + 60 * 86_400_000).toISOString().slice(0, 10);
  const emAndamento = (c: Contrato) => {
    const e = doContrato(a, c.chave).status?.reajuste ?? '';
    return !!e && e !== 'aplicado' && e !== 'recusado';
  };
  const lista = contratos
    .filter((c) => (filtro === 'todos' ? true : filtro === 'andamento' ? emAndamento(c) : (!!c.proximoReajuste && c.proximoReajuste <= daqui60) || emAndamento(c)))
    .sort((x, y) => (x.proximoReajuste ?? '9999').localeCompare(y.proximoReajuste ?? '9999'));
  const salvar = async (c: Contrato, d: { reajuste?: EtapaReajuste; reajustePercentual?: number | null }) => {
    try {
      await api.mudarStatusContrato({ clienteId: c.cliente.id, chave: c.chave, ...d });
      mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    }
  };
  const somaReajuste = lista.reduce((s, c) => {
    const p = doContrato(a, c.chave).status?.reajustePercentual;
    return p ? s + Math.round((c.valor * p) / 100) : s;
  }, 0);
  return (
    <section aria-label="Reajustes" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">
          Reajustes que vencem em até 60 dias, os atrasados e os que estão em negociação.
          {veValor && somaReajuste > 0 && (
            <>
              {' '}
              Com os percentuais propostos, a receita sobe <b className="text-ok">{formatarReais(somaReajuste)}/mês</b>.
            </>
          )}
        </p>
        <Filtros valor={filtro} mudar={setFiltro} opcoes={[['proximos', 'Próximos 60 dias'], ['andamento', 'Em negociação'], ['todos', 'Todos']]} />
      </div>
      <Tabela
        cabecalho={['Cliente · contrato', 'Reajuste em', veValor ? 'Valor atual → proposto' : '% proposto', 'Etapa', 'Último contato', '']}
        colunas="lg:grid-cols-[minmax(160px,1.1fr)_105px_210px_175px_minmax(180px,1.6fr)_120px]"
        vazio="Nenhum reajuste nesse filtro."
        linhas={lista.map((c) => {
          const d = doContrato(a, c.chave, 'reajuste');
          const pct = d.status?.reajustePercentual ?? null;
          const txt = pcts[c.chave] ?? (pct !== null ? String(pct).replace('.', ',') : '');
          const atrasado = !!c.proximoReajuste && c.proximoReajuste < hoje;
          return {
            chave: c.chave,
            celulas: [
              <span key="c" className="min-w-0">
                <b className="block truncate">{c.cliente.nome}</b>
                <span className="flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-ink-3">
                  {c.numero || 'sem número'} <SeloPendencias n={d.pendencias.length} />
                </span>
              </span>,
              <span key="d" className={atrasado ? 'font-semibold text-bad' : ''}>
                {c.proximoReajuste ? dataBr(c.proximoReajuste) : '—'}
                {atrasado && <span className="block text-[11.5px]">atrasado</span>}
              </span>,
              <span key="p" className="flex flex-wrap items-center gap-1.5">
                {veValor && <span className="text-ink-2">{formatarReais(c.valor)}</span>}
                <span className="flex items-center gap-1">
                  {edita ? (
                    <input
                      aria-label={`Percentual proposto para ${c.cliente.nome}`}
                      className="input h-8 w-[58px] px-2 text-right text-[13px]"
                      inputMode="decimal"
                      placeholder="%"
                      value={txt}
                      onChange={(e) => setPcts({ ...pcts, [c.chave]: e.target.value })}
                      onBlur={() => {
                        const v = txt.trim() ? Number(txt.replace(',', '.')) : null;
                        if (v !== pct && (v === null || Number.isFinite(v))) void salvar(c, { reajustePercentual: v });
                      }}
                    />
                  ) : (
                    <b>{pct !== null ? `${String(pct).replace('.', ',')}` : '—'}</b>
                  )}
                  %
                </span>
                {veValor && pct !== null && <b className="text-ok">→ {formatarReais(Math.round(c.valor * (1 + pct / 100)))}</b>}
              </span>,
              <Etapa key="e" valor={(d.status?.reajuste ?? '') as EtapaReajuste} opcoes={ETAPAS_REAJUSTE} mudar={(v) => void salvar(c, { reajuste: v })} edita={edita} />,
              <UltimoContato key="u" r={d.ultimo} retorno={d.retorno} />,
              <span key="b" className="flex flex-col gap-1">
                <button type="button" className="btn-secondary btn-sm" onClick={() => abrir(c)}>
                  Tratativas
                </button>
                {pode('movimentacoes', 2) && d.status?.reajuste === 'aceito' && (
                  <Link className="btn-primary btn-sm" to={`/movimentacoes?nova=reajuste&cliente=${c.cliente.id}`}>
                    Aplicar
                  </Link>
                )}
              </span>,
            ],
          };
        })}
      />
    </section>
  );
}

// ------------------------------------------------------------------ Pendências

export function PainelPendencias({ contratos, a, abrir, mudou }: { contratos: Contrato[]; a: Acompanhamento; abrir: (c: Contrato) => void; mudou: () => void }) {
  const [verResolvidas, setVerResolvidas] = useState(false);
  const pend = a.registros.filter((r) => r.tipo === 'pendencia' && (verResolvidas || !r.resolvidaEm));
  const contrato = (k: string) => contratos.find((c) => c.chave === k);
  return (
    <section aria-label="Pendências" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Tudo o que ficou pendente nos contratos. Para anotar uma nova, abra as tratativas do contrato.</p>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={verResolvidas} onChange={(e) => setVerResolvidas(e.target.checked)} />
          mostrar as resolvidas
        </label>
      </div>
      {pend.length === 0 ? (
        <div className="card px-4 py-6 text-ink-3">{verResolvidas ? 'Nenhuma pendência anotada.' : 'Nenhuma pendência aberta. 🎉'}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {pend.map((r) => {
            const c = contrato(r.chave);
            return (
              <li key={r.id}>
                <ItemPendencia r={r} titulo={c ? `${c.cliente.nome} · ${c.numero || 'sem número'}` : 'Contrato não encontrado (mudou o número?)'} abrir={c ? () => abrir(c) : undefined} mudou={mudou} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Pendência em vermelho até alguém resolver (com o que foi feito). */
export function ItemPendencia({ r, titulo, abrir, mudou }: { r: RegistroContrato; titulo?: string; abrir?: () => void; mudou: () => void }) {
  const { pode, avisar } = useEstado();
  const [resolvendo, setResolvendo] = useState(false);
  const [como, setComo] = useState('');
  const resolvida = !!r.resolvidaEm;
  const agir = async (desfazer: boolean) => {
    try {
      await api.resolverPendenciaContrato(r.id, como.trim(), desfazer);
      setResolvendo(false);
      setComo('');
      avisar(desfazer ? 'Pendência reaberta.' : 'Pendência resolvida.');
      mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível.', 'bad');
    }
  };
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5 text-[13.5px] ${resolvida ? 'border-line bg-white' : 'border-bad/40 bg-bad-soft'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0">
          {titulo && <b className="block text-[13px]">{titulo}</b>}
          <span className={resolvida ? 'text-ink-3 line-through' : 'font-semibold text-bad-strong'}>
            {!resolvida && '⚠ '}
            {r.texto}
          </span>
          <span className="block text-xs text-ink-3">
            anotada por {r.por || '—'} em {dataHora(r.criadoEm)}
            {resolvida && ` · resolvida por ${r.resolvidaPor ?? '—'} em ${dataHora(r.resolvidaEm!)}${r.resolucao ? `: ${r.resolucao}` : ''}`}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {abrir && (
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={abrir}>
              Abrir contrato
            </button>
          )}
          {pode('contratos', 2) &&
            (resolvida ? (
              <button type="button" className="h-8 px-2 text-[12.5px] text-ink-3 underline" onClick={() => void agir(true)}>
                reabrir
              </button>
            ) : (
              !resolvendo && (
                <button type="button" className="btn-primary h-8 px-3 text-[12.5px]" onClick={() => setResolvendo(true)}>
                  Resolver
                </button>
              )
            ))}
        </span>
      </div>
      {resolvendo && (
        <div className="flex flex-wrap gap-2">
          <input className="input h-9 min-w-[220px] flex-1" autoFocus value={como} onChange={(e) => setComo(e.target.value)} placeholder="Como foi resolvida (opcional)" />
          <button type="button" className="btn-primary btn-sm" onClick={() => void agir(false)}>
            Confirmar
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setResolvendo(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ gaveta do contrato

/** Tratativas do contrato: registrar contato (com retorno), anotar pendência e ver a linha do tempo inteira. */
export function TratativasContrato({ c, a, inicial, fechar, mudou }: { c: Contrato; a: Acompanhamento; inicial: RegistroContrato['assunto']; fechar: () => void; mudou: () => void }) {
  const { pode, avisar } = useEstado();
  const edita = pode('contratos', 2);
  const d = doContrato(a, c.chave);
  const [modo, setModo] = useState<'contato' | 'pendencia'>('contato');
  const [assunto, setAssunto] = useState<RegistroContrato['assunto']>(inicial);
  const [canal, setCanal] = useState('Telefone');
  const [contato, setContato] = useState('');
  const [texto, setTexto] = useState('');
  const [proxima, setProxima] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | RegistroContrato['assunto']>('todos');

  const salvar = async () => {
    if (!texto.trim()) return avisar(modo === 'pendencia' ? 'Escreva a pendência.' : 'Escreva o que foi conversado.', 'bad');
    setSalvando(true);
    try {
      await api.registrarNoContrato({
        clienteId: c.cliente.id,
        chave: c.chave,
        assunto,
        tipo: modo,
        texto: texto.trim(),
        ...(modo === 'contato' ? { canal, contato: contato.trim(), proximaData: proxima || null } : {}),
      });
      setTexto('');
      setProxima('');
      avisar(modo === 'pendencia' ? 'Pendência anotada.' : 'Contato registrado.');
      mudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };
  const linha = d.regs.filter((r) => filtro === 'todos' || r.assunto === filtro);

  return (
    <Gaveta aberto fechar={fechar} titulo={`${c.cliente.nome} · ${c.numero || 'contrato sem número'}`} largo>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
        <span>FT{c.maquinas.map((m) => m.numero).join(', FT')}</span>
        <span>Vence {dataBr(c.vencimento)}</span>
        <span>Reajuste {c.proximoReajuste ? dataBr(c.proximoReajuste) : '—'}</span>
        <span>
          Renovação: <b>{ETAPAS_RENOVACAO.find((e) => e.id === (d.status?.renovacao ?? ''))?.rotulo}</b>
        </span>
        <span>
          Reajuste: <b>{ETAPAS_REAJUSTE.find((e) => e.id === (d.status?.reajuste ?? ''))?.rotulo}</b>
          {d.status?.reajustePercentual != null && ` (${String(d.status.reajustePercentual).replace('.', ',')}%)`}
        </span>
      </div>

      {d.pendencias.length > 0 && (
        <div className="flex flex-col gap-2">
          {d.pendencias.map((r) => (
            <ItemPendencia key={r.id} r={r} mudou={mudou} />
          ))}
        </div>
      )}

      {edita && (
        <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="O que anotar">
            {(
              [
                ['contato', 'Registrar contato'],
                ['pendencia', 'Anotar pendência'],
              ] as const
            ).map(([id, rot]) => (
              <button key={id} type="button" aria-pressed={modo === id} onClick={() => setModo(id)} className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${modo === id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}>
                {rot}
              </button>
            ))}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">Assunto</span>
              <select className="input" value={assunto} onChange={(e) => setAssunto(e.target.value as RegistroContrato['assunto'])}>
                <option value="renovacao">Renovação</option>
                <option value="reajuste">Reajuste</option>
                <option value="geral">Geral</option>
              </select>
            </label>
            {modo === 'contato' && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="label">Como</span>
                  <select className="input" value={canal} onChange={(e) => setCanal(e.target.value)}>
                    {CANAIS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label">Com quem</span>
                  <input className="input" value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Nome do contato" />
                </label>
              </>
            )}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">{modo === 'pendencia' ? 'Pendência' : 'O que foi conversado'}</span>
            <textarea
              rows={3}
              className="input resize-y py-2"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={modo === 'pendencia' ? 'Ex.: falta a via assinada do aditivo' : 'Ex.: cliente pediu proposta de 4%, vai responder até sexta'}
            />
          </label>
          <div className="flex flex-wrap items-end justify-between gap-2">
            {modo === 'contato' ? (
              <label className="flex flex-col gap-1.5">
                <span className="label">
                  Retornar em <span className="font-normal text-ink-3">(opcional)</span>
                </span>
                <input type="date" className="input w-auto" value={proxima} onChange={(e) => setProxima(e.target.value)} />
              </label>
            ) : (
              <span className="text-[12.5px] text-ink-3">Fica em vermelho no contrato até alguém resolver.</span>
            )}
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? 'Salvando…' : modo === 'pendencia' ? 'Anotar pendência' : 'Registrar contato'}
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Linha do tempo · {d.regs.length}</h3>
          <Filtros valor={filtro} mudar={setFiltro} opcoes={[['todos', 'Tudo'], ['renovacao', 'Renovação'], ['reajuste', 'Reajuste'], ['geral', 'Geral']]} />
        </div>
        {linha.length === 0 ? (
          <p className="text-[13px] text-ink-3">Nada registrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {linha.map((r) => (
              <li key={r.id} className={`rounded-lg px-3 py-2 text-[13px] ${r.tipo === 'pendencia' ? (r.resolvidaEm ? 'bg-[#F8F7F3]' : 'bg-bad-soft') : r.tipo === 'etapa' ? 'bg-[#EEF4FF]' : 'bg-[#F8F7F3]'}`}>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                  <b className="text-ink-2">{dataHora(r.criadoEm)}</b>
                  <span>· {r.por || '—'}</span>
                  <span className="rounded bg-white px-1.5 font-semibold">{ASSUNTO[r.assunto]}</span>
                  <span>{r.tipo === 'contato' ? `${r.canal || 'contato'}${r.contato ? ` com ${r.contato}` : ''}` : r.tipo === 'pendencia' ? (r.resolvidaEm ? 'pendência resolvida' : 'pendência') : 'mudou a etapa'}</span>
                </div>
                <p className={`mt-0.5 whitespace-pre-wrap ${r.tipo === 'pendencia' && r.resolvidaEm ? 'text-ink-3 line-through' : ''}`}>{r.texto}</p>
                {r.proximaData && <p className="text-xs font-semibold text-ink-2">Retornar em {dataBr(r.proximaData)}</p>}
                {r.resolucao && <p className="text-xs text-ok">✓ {r.resolucao}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Gaveta>
  );
}

// ------------------------------------------------------------------ peças

function Filtros<T extends string>({ valor, mudar, opcoes }: { valor: T; mudar: (v: T) => void; opcoes: [T, string][] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {opcoes.map(([id, rot]) => (
        <button key={id} type="button" aria-pressed={valor === id} onClick={() => mudar(id)} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${valor === id ? 'bg-ink text-white' : 'bg-line-soft text-ink-2'}`}>
          {rot}
        </button>
      ))}
    </span>
  );
}

function Tabela({ cabecalho, colunas, linhas, vazio }: { cabecalho: string[]; colunas: string; linhas: { chave: string; celulas: React.ReactNode[] }[]; vazio: string }) {
  if (!linhas.length) return <div className="card px-4 py-6 text-ink-3">{vazio}</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className={`hidden gap-3 border-b border-line bg-[#F8F7F3] px-4 py-2 text-[12px] font-semibold text-ink-3 lg:grid ${colunas}`}>
        {cabecalho.map((h, i) => (
          <span key={i}>{h}</span>
        ))}
      </div>
      <ul className="divide-y divide-line-soft">
        {linhas.map((l) => (
          <li key={l.chave} className={`grid grid-cols-1 items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13.5px] ${colunas}`}>
            {l.celulas}
          </li>
        ))}
      </ul>
    </div>
  );
}
