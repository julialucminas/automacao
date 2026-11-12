import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEstado } from '../state';
import type { Cliente, Equipamento, Movimentacao, NovaMovimentacao, TipoMov } from '../types';
import { api } from '../api';
import { dataBr, hojeIso } from '../lib/calendario';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { emailValido, semAcento } from '../lib/normalizar';
import { copiarTexto, efeitoNaReceita, fimSugerido, movVazia, NOMES_TIPO, proximoMes, somarMeses, textoMensagem } from '../lib/movimentacao';
import { dataHora } from '../lib/email';
import { Chip, Gaveta, type Tom } from '../components/ui';
import { IcBusca, IcMais } from '../components/Icones';

export const STATUS_MOV: Record<Movimentacao['status'], { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: 'Aguardando aprovação', tom: 'warn' },
  aprovada: { rotulo: 'Aprovada', tom: 'ok' },
  rejeitada: { rotulo: 'Recusada', tom: 'bad' },
};
export const TOM_TIPO: Record<TipoMov, Tom> = { locacao: 'ok', troca: 'info', devolucao: 'neutro', reajuste: 'warn', venda: 'bad', compra: 'info' };
const PLURAL: Record<TipoMov, string> = { locacao: 'Locações', troca: 'Trocas', devolucao: 'Devoluções', reajuste: 'Reajustes', venda: 'Vendas', compra: 'Compras' };
const SINGULAR: Record<TipoMov, string> = { locacao: 'locação', troca: 'troca', devolucao: 'devolução', reajuste: 'reajuste', venda: 'venda', compra: 'compra' };
const TODOS_TIPOS: TipoMov[] = ['locacao', 'troca', 'devolucao', 'reajuste', 'venda', 'compra'];
const COMB: Record<string, string> = { eletrica: 'Elétrica', glp: 'GLP (gás)', diesel: 'Diesel', gasolina: 'Gasolina' };

const pct = (antes: number, novo: number) => (antes ? `${novo >= antes ? '+' : ''}${(((novo - antes) / antes) * 100).toFixed(1).replace('.', ',')}%` : '');
const sinal = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatarReais(Math.abs(c))}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (am: string) => `${MESES[Number(am.slice(5, 7)) - 1]} de ${am.slice(0, 4)}`;
const mesSeguinte = (am: string, n: number) => somarMeses(`${am}-01`, n).slice(0, 7);

/** Linhas de detalhe de uma movimentação (usadas aqui e em Aprovações). */
export function detalhesMov(m: { tipo: TipoMov; frota: string; frotaNova?: string | null; dados: Movimentacao['dados'] }): [string, string][] {
  const d = m.dados;
  const l: [string, string][] = [];
  if (m.tipo === 'reajuste') {
    for (const i of d.itens ?? []) l.push([`FT${i.frota}`, `${formatarReais(i.antes)} → ${formatarReais(i.novo)} (${pct(i.antes, i.novo)})`]);
    if ((d.itens ?? []).length > 1) {
      const a = (d.itens ?? []).reduce((t, i) => t + i.antes, 0);
      const n = (d.itens ?? []).reduce((t, i) => t + i.novo, 0);
      l.push(['Total por mês', `${formatarReais(a)} → ${formatarReais(n)} (${sinal(n - a)})`]);
    }
    l.push(['A partir de', dataBr(d.data)]);
    if (d.percentual != null) l.push(['Percentual', `${String(d.percentual).replace('.', ',')}%`]);
    if (d.renovaAte) l.push(['Contrato renovado até', dataBr(d.renovaAte)]);
    if (d.observacoes) l.push(['Motivo', d.observacoes]);
    return l;
  }
  if (m.tipo === 'venda' || m.tipo === 'compra') {
    const q = d.maquina;
    if (d.descricao) l.push(['Equipamento', d.descricao]);
    if (q) {
      const ident = [q.marca, q.modelo, q.serie && `série ${q.serie}`, q.ano && `ano ${q.ano}`, q.capacidade && `${q.capacidade} kg`, q.combustivel && COMB[q.combustivel]].filter(Boolean).join(' · ');
      if (ident) l.push(['Identificação', ident]);
    }
    if (d.valor != null) l.push([m.tipo === 'venda' ? 'Valor da venda' : 'Valor da compra', formatarReais(d.valor)]);
    if (d.nf) l.push(['Nota fiscal', d.nf]);
    if (m.tipo === 'venda' && d.valorAnterior) l.push(['Locação que deixa de entrar', `${formatarReais(d.valorAnterior)} por mês`]);
    if (d.observacoes) l.push(['Observações', d.observacoes]);
    return l;
  }
  if (m.tipo === 'troca') l.push(['Troca', `FT${m.frota} → FT${m.frotaNova ?? ''}`]);
  if (m.tipo === 'devolucao' && d.valorAnterior) l.push(['Valor que deixa de entrar', formatarReais(d.valorAnterior)]);
  if (m.tipo === 'troca' && d.valorAnterior != null && d.valor != null && d.valor !== d.valorAnterior)
    l.push(['Valor', `${formatarReais(d.valorAnterior)} → ${formatarReais(d.valor)}`]);
  else if (d.valor !== null) l.push(['Valor da locação', formatarReais(d.valor)]);
  if (d.frete) l.push(['Frete', d.frete === 'lucminas' ? 'Por conta da Lucminas' : 'Por conta do cliente']);
  if (d.gas) l.push(['Gás', `${d.gas} vasilhame${d.gas > 1 ? 's' : ''}`]);
  if (d.contrato) l.push(['Tempo de contrato', d.contrato]);
  if (d.fim) l.push(['Término previsto', dataBr(d.fim)]);
  if (d.prazoPagamento) l.push(['Prazo de pagamento', d.prazoPagamento]);
  if (d.emails.length) l.push(['E-mails', d.emails.join(', ')]);
  if (d.contatoNome || d.contatoTelefone) l.push(['Contato', [d.contatoNome, d.contatoTelefone].filter(Boolean).join(' · ')]);
  if (d.descricao) l.push(['Equipamento', d.descricao]);
  if (d.observacoes) l.push(['Observações', d.observacoes]);
  return l;
}

export const tituloMov = (m: Pick<Movimentacao, 'tipo' | 'frota' | 'frotaNova'>) =>
  m.tipo === 'reajuste'
    ? `Reajuste · FT${m.frota.split(', ').join(', FT')}`
    : `${NOMES_TIPO[m.tipo]} FT${m.frota}${m.tipo === 'troca' && m.frotaNova ? ` → FT${m.frotaNova}` : ''}`;

/** Contratos que vencem nos próximos 30 dias (ou venceram há pouco) — hora de reajustar/renovar. */
export type Vencendo = { frota: string; vence: string; cliente: Cliente | null; valor: number | null };
export function contratosVencendo(eqs: Equipamento[], clientes: Cliente[], hoje: string): Vencendo[] {
  const ate = somarMeses(hoje, 1);
  const desde = somarMeses(hoje, -3);
  return eqs
    .filter((e) => e.contratoVencimento && e.contratoVencimento >= desde && e.contratoVencimento <= ate)
    .map((e) => {
      const cliente = clientes.find((c) => c.ativo && c.frotas.some((f) => f.numero === e.frota)) ?? null;
      return { frota: e.frota, vence: e.contratoVencimento!, cliente, valor: cliente?.frotas.find((f) => f.numero === e.frota)?.valor ?? null };
    })
    .filter((v) => v.cliente)
    .sort((a, b) => a.vence.localeCompare(b.vence));
}

export function Movimentacoes() {
  const { clientes, movimentacoes, pode, veValores, aprova } = useEstado();
  const registra = pode('movimentacoes', 2);
  const [params, setParams] = useSearchParams();
  const hoje = hojeIso();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [tipo, setTipo] = useState<'todos' | TipoMov>('todos');
  const [filtro, setFiltro] = useState<'todas' | Movimentacao['status']>('todas');
  const [busca, setBusca] = useState('');
  const [nova, setNova] = useState<null | { tipo: TipoMov; clienteId?: string; frota?: string }>(null);
  const [eqs, setEqs] = useState<Equipamento[]>([]);
  const [verVencendo, setVerVencendo] = useState(false);
  const aberta = movimentacoes.find((m) => m.id === params.get('id')) ?? null;
  // atalho da Central do financeiro: /movimentacoes?nova=reajuste abre o painel já no reajuste
  useEffect(() => {
    const t = params.get('nova');
    if (registra && t && (TODOS_TIPOS as string[]).includes(t)) {
      setNova({ tipo: t as TipoMov });
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o endereço muda
  }, [params]);

  useEffect(() => {
    if (registra || veValores) api.listarEquipamentos().then(setEqs, () => undefined);
  }, [registra, veValores]);

  // resumo do mês: o que foi aprovado com data dentro do mês
  const doMes = movimentacoes.filter((m) => m.status === 'aprovada' && m.dados.data.slice(0, 7) === mes);
  const conta = (t: TipoMov) => doMes.filter((m) => m.tipo === t).length;
  const efeitos = doMes.map(efeitoNaReceita);
  const saldo = efeitos.reduce<number>((t, e) => t + (e ?? 0), 0);
  const semValor = efeitos.filter((e) => e === null).length;
  const vendido = doMes.filter((m) => m.tipo === 'venda').reduce((t, m) => t + (m.dados.valor ?? 0), 0);
  const comprado = doMes.filter((m) => m.tipo === 'compra').reduce((t, m) => t + (m.dados.valor ?? 0), 0);
  const pendentes = movimentacoes.filter((m) => m.status === 'pendente');
  const vencendo = useMemo(() => contratosVencendo(eqs, clientes, hoje), [eqs, clientes, hoje]);

  const q = semAcento(busca.trim().toUpperCase()).replace(/^FT\s*/, '');
  const lista = movimentacoes
    .filter((x) => tipo === 'todos' || x.tipo === tipo)
    .filter((x) => filtro === 'todas' || x.status === filtro)
    .filter((x) => !q || x.frota.split(', ').some((f) => f.includes(q)) || (x.frotaNova ?? '').includes(q) || semAcento(x.clienteNome).includes(q) || semAcento(x.criadaPorNome.toUpperCase()).includes(q))
    .sort((a, b) => b.dados.data.localeCompare(a.dados.data) || b.criadaEm.localeCompare(a.criadaEm));
  const porMes = lista.reduce<[string, Movimentacao[]][]>((g, m) => {
    const k = m.dados.data.slice(0, 7);
    const ult = g[g.length - 1];
    if (ult && ult[0] === k) ult[1].push(m);
    else g.push([k, [m]]);
    return g;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Locação</div>
          <h1 className="mt-1 text-[26px] font-bold">Movimentações</h1>
          <p className="max-w-[640px] text-[13px] text-ink-3">
            Locações, trocas, devoluções, reajustes, vendas e compras de máquinas. {aprova ? 'O que você registra entra no cadastro na hora.' : 'O que você registra vai para o financeiro aprovar.'}
          </p>
        </div>
        {registra && (
          <button type="button" className="btn-primary" onClick={() => setNova({ tipo: 'locacao' })}>
            <IcMais tamanho={16} /> Nova movimentação
          </button>
        )}
      </div>

      {pendentes.length > 0 && (
        <Link to="/aprovacoes" className="flex items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[14px] hover:brightness-[0.98]">
          <span>
            <b>{pendentes.length}</b> movimentaç{pendentes.length > 1 ? 'ões aguardando' : 'ão aguardando'} aprovação{aprova ? '' : ' do financeiro'}
          </span>
          <span className="text-[13px] font-semibold underline">{aprova ? 'Aprovar' : 'Ver'}</span>
        </Link>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:p-5" aria-label="Resumo do mês">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm px-2 text-ink-2" aria-label="Mês anterior" onClick={() => setMes(mesSeguinte(mes, -1))}>
            ‹
          </button>
          <h2 className="min-w-[170px] text-center text-[15px] font-bold first-letter:uppercase">{nomeMes(mes)}</h2>
          <button type="button" className="btn btn-sm px-2 text-ink-2" aria-label="Próximo mês" disabled={mes >= hoje.slice(0, 7)} onClick={() => setMes(mesSeguinte(mes, 1))}>
            ›
          </button>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {TODOS_TIPOS.map((t) => (
            <button key={t} type="button" onClick={() => setTipo(tipo === t ? 'todos' : t)} className={`flex items-baseline gap-1.5 rounded-lg px-1 text-left ${tipo === t ? 'bg-brand-tint' : ''}`}>
              <b className="text-[24px] leading-none">{conta(t)}</b>
              <span className="text-[13px] text-ink-3">{conta(t) === 1 ? SINGULAR[t] : PLURAL[t].toLowerCase()}</span>
            </button>
          ))}
          {veValores && (
            <span className="ml-auto flex flex-col items-end">
              <b className={`text-[22px] leading-none ${saldo > 0 ? 'text-ok' : saldo < 0 ? 'text-bad' : 'text-ink'}`}>{sinal(saldo)}</b>
              <span className="text-xs text-ink-3">
                na receita mensal{semValor ? ` (${semValor} sem valor informado)` : ''}
              </span>
              {(vendido > 0 || comprado > 0) && (
                <span className="mt-1 text-xs text-ink-2">
                  {vendido > 0 && <>vendas {formatarReais(vendido)}</>}
                  {vendido > 0 && comprado > 0 && ' · '}
                  {comprado > 0 && <>compras {formatarReais(comprado)}</>}
                </span>
              )}
            </span>
          )}
        </div>
      </section>

      {(registra || veValores) && vencendo.length > 0 && (
        <section className="rounded-xl border border-line bg-white" aria-label="Contratos vencendo">
          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setVerVencendo(!verVencendo)} aria-expanded={verVencendo}>
            <span className="text-[14px]">
              <b>{vencendo.length}</b> contrato{vencendo.length > 1 ? 's' : ''} vencendo ou vencido{vencendo.length > 1 ? 's' : ''} há pouco: hora de reajustar ou renovar
            </span>
            <span className="text-[13px] font-semibold text-ink-2 underline">{verVencendo ? 'Esconder' : 'Ver'}</span>
          </button>
          {verVencendo && (
            <ul className="border-t border-line">
              {vencendo.map((v) => (
                <li key={v.frota} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-2 text-[13.5px] last:border-0">
                  <b className="w-12">FT{v.frota}</b>
                  <span className="min-w-[160px] flex-1">{v.cliente?.nome}</span>
                  {veValores && v.valor != null && <span className="text-ink-2">{formatarReais(v.valor)}</span>}
                  <Chip tom={v.vence < hoje ? 'bad' : 'warn'}>{v.vence < hoje ? `venceu ${dataBr(v.vence)}` : `vence ${dataBr(v.vence)}`}</Chip>
                  {registra && (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setNova({ tipo: 'reajuste', clienteId: v.cliente!.id, frota: v.frota })}>
                      Registrar reajuste
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
          {(['todos', ...TODOS_TIPOS] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${tipo === t ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}
            >
              {t === 'todos' ? 'Todas' : PLURAL[t]}
            </button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          <label className="relative">
            <span className="sr-only">Buscar</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <IcBusca tamanho={15} />
            </span>
            <input className="input h-9 w-[200px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota, cliente ou pessoa" />
          </label>
          <select aria-label="Filtrar por situação" className="input h-9 w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="todas">Todas as situações</option>
            <option value="pendente">Aguardando aprovação</option>
            <option value="aprovada">Aprovadas</option>
            <option value="rejeitada">Recusadas</option>
          </select>
        </span>
      </div>

      {lista.length === 0 && (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">Nenhuma movimentação {movimentacoes.length ? 'com esse filtro' : 'registrada ainda'}.</p>
      )}
      {porMes.map(([am, l]) => (
        <section key={am} className="flex flex-col gap-1.5">
          <h3 className="px-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">{nomeMes(am)}</h3>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <tbody>
                {l.map((m) => {
                  const ef = efeitoNaReceita(m);
                  return (
                    <tr
                      key={m.id}
                      className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-brand-tint ${m.status === 'rejeitada' ? 'text-ink-3 line-through decoration-ink-3/40' : ''}`}
                      onClick={() => setParams({ id: m.id })}
                    >
                      <td className="w-[64px] whitespace-nowrap py-2.5 pl-4 pr-2 text-ink-2">{dataBr(m.dados.data).slice(0, 5)}</td>
                      <td className="w-[120px] px-2 py-2.5">
                        <Chip tom={TOM_TIPO[m.tipo]}>{NOMES_TIPO[m.tipo].replace(' de frota', '')}</Chip>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 font-bold">
                        {m.tipo === 'reajuste' ? `FT${m.frota.split(', ').join(', FT')}` : `FT${m.frota}`}
                        {m.tipo === 'troca' && m.frotaNova && <span className="font-normal text-ink-2"> → FT{m.frotaNova}</span>}
                      </td>
                      <td className="px-2 py-2.5">{m.clienteNome || '—'}</td>
                      {veValores && (
                        <td className="whitespace-nowrap px-2 py-2.5 text-right">
                          {m.tipo === 'reajuste' && (m.dados.itens ?? []).length === 1 ? (
                            <span className="text-ink-2">
                              {formatarReais(m.dados.itens![0].antes)} → <b className="text-ink">{formatarReais(m.dados.itens![0].novo)}</b>
                            </span>
                          ) : (m.tipo === 'locacao' || m.tipo === 'venda' || m.tipo === 'compra') && m.dados.valor != null ? (
                            formatarReais(m.dados.valor)
                          ) : null}
                          {ef != null && ef !== 0 && m.tipo !== 'locacao' && (
                            <span className={`ml-2 text-xs font-semibold ${ef > 0 ? 'text-ok' : 'text-bad'}`}>{sinal(ef)}</span>
                          )}
                        </td>
                      )}
                      <td className="w-[150px] px-2 py-2.5">{m.status !== 'aprovada' && <Chip tom={STATUS_MOV[m.status].tom}>{STATUS_MOV[m.status].rotulo}</Chip>}</td>
                      <td className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right text-xs text-ink-3">{m.criadaPorNome}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {aberta && (
        <Gaveta aberto fechar={() => setParams({})} titulo={tituloMov(aberta)}>
          <CartaoMov m={aberta} semBorda>
            <div className="mt-4 flex justify-end">
              <BotaoCopiar texto={() => textoMensagem(aberta)} />
            </div>
          </CartaoMov>
        </Gaveta>
      )}
      {nova && (
        <Gaveta aberto largo={nova.tipo === 'reajuste'} fechar={() => setNova(null)} titulo="Nova movimentação">
          <NovaMov inicial={nova} fechar={() => setNova(null)} />
        </Gaveta>
      )}
    </div>
  );
}

/** Painel de registro: escolhe o tipo e mostra só os campos daquele tipo. */
function NovaMov({ inicial, fechar }: { inicial: { tipo: TipoMov; clienteId?: string; frota?: string }; fechar: () => void }) {
  const { aprova } = useEstado();
  const [tipo, setTipo] = useState<TipoMov>(inicial.tipo);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de movimentação">
        {TODOS_TIPOS.map((t) => (
          <label
            key={t}
            className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px] ${tipo === t ? 'border-ink bg-white font-semibold' : 'border-line-strong bg-white/60'}`}
          >
            <input type="radio" name="tipo" checked={tipo === t} onChange={() => setTipo(t)} className="h-[18px] w-[18px] accent-ink" />
            {NOMES_TIPO[t].replace(' de frota', '')}
          </label>
        ))}
      </div>
      <p className="-mt-2 text-[13px] text-ink-3">{aprova ? 'Entra no cadastro na hora.' : 'Vai para o financeiro aprovar antes de entrar no cadastro.'}</p>
      {tipo === 'reajuste' ? (
        <FormReajuste clienteInicial={inicial.clienteId} frotaInicial={inicial.frota} fechar={fechar} />
      ) : tipo === 'venda' || tipo === 'compra' ? (
        <FormVendaCompra key={tipo} tipo={tipo} fechar={fechar} />
      ) : (
        <FormMov tipo={tipo} fechar={fechar} />
      )}
    </div>
  );
}

function FormMov({ tipo, fechar }: { tipo: TipoMov; fechar: () => void }) {
  const { clientes, recarregarOperacoes, aprova: ehFinanceiro } = useEstado();
  const [m, setM] = useState<NovaMovimentacao>(() => ({ ...movVazia(hojeIso()), tipo }));
  const [valorTxt, setValorTxt] = useState('');
  const [emailsTxt, setEmailsTxt] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feita, setFeita] = useState<Movimentacao | null>(null);
  useEffect(() => setM((x) => ({ ...x, tipo })), [tipo]);

  const ativos = useMemo(() => clientes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes]);
  const clienteAtual = m.clienteId ? clientes.find((c) => c.id === m.clienteId) : null;
  const numFrota = m.frota.trim().toUpperCase().replace(/^FT[\s-]*/, '');
  const ondeEsta = numFrota ? clientes.filter((c) => c.ativo && c.frotas.some((f) => f.numero === numFrota)) : [];

  const mudar = (p: Partial<NovaMovimentacao>) => setM((x) => ({ ...x, ...p }));
  const escolherCliente = (nome: string) => {
    const c = ativos.find((x) => x.nome === nome.trim().toUpperCase());
    mudar({ clienteNome: nome, clienteId: c?.id ?? null });
  };

  const registrar = async () => {
    setErro('');
    if (!m.frota.trim()) return setErro('Informe o número da frota.');
    if (m.tipo === 'troca' && !m.frotaNova?.trim()) return setErro('Informe a frota nova.');
    if (!m.data) return setErro('Informe a data.');
    if (m.tipo !== 'devolucao' && !m.clienteId && !m.clienteNome?.trim()) return setErro('Informe o cliente.');
    if (m.tipo === 'locacao' && !m.modalidade) return setErro('Diga se a locação é por contrato ou esporádica.');
    const valor = valorTxt.trim() ? lerReais(valorTxt) : null;
    if (valorTxt.trim() && valor === null) return setErro(`Não entendi o valor "${valorTxt}". Use, por exemplo, 3.350,00`);
    const emails = [
      ...new Set(
        emailsTxt
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const inval = emails.find((e) => !emailValido(e));
    if (inval) return setErro(`O e-mail "${inval}" não parece válido.`);
    setSalvando(true);
    try {
      const salva = await api.registrarMovimentacao({ ...m, valor, emails, clienteNome: m.clienteNome?.trim().toUpperCase() });
      await recarregarOperacoes();
      setFeita(salva);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setSalvando(false);
    }
  };

  /** mensagem com o que está preenchido agora */
  const mensagemAtual = () => {
    const valor = valorTxt.trim() ? lerReais(valorTxt) : null;
    const emails = emailsTxt.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const cliente = clienteAtual?.nome ?? m.clienteNome?.trim() ?? (ondeEsta[0]?.nome || '');
    return textoMensagem({ tipo: m.tipo, frota: m.frota, frotaNova: m.frotaNova ?? null, clienteNome: cliente || (m.tipo === 'devolucao' ? ondeEsta[0]?.nome ?? '' : ''), dados: { ...m, valor, emails } });
  };

  if (feita) return <Registrada m={feita} fechar={fechar} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-frota" className="label">
            {m.tipo === 'troca' ? 'Frota que sai' : 'Frota'}
          </label>
          <input id="mov-frota" className="input uppercase" value={m.frota} onChange={(e) => mudar({ frota: e.target.value })} placeholder="FT35" />
        </div>
        {m.tipo === 'troca' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-frota-nova" className="label">
              Frota que entra
            </label>
            <input id="mov-frota-nova" className="input uppercase" value={m.frotaNova ?? ''} onChange={(e) => mudar({ frotaNova: e.target.value })} placeholder="FT40" />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-data" className="label">
              Data
            </label>
            <input id="mov-data" type="date" className="input" value={m.data} onChange={(e) => mudar({ data: e.target.value })} />
          </div>
        )}
        {m.tipo === 'troca' && (
          <div className="col-span-2 flex flex-col gap-1.5">
            <label htmlFor="mov-data" className="label">
              Data
            </label>
            <input id="mov-data" type="date" className="input" value={m.data} onChange={(e) => mudar({ data: e.target.value })} />
          </div>
        )}
      </div>
      {ondeEsta.length > 0 && (
        <p className="-mt-2 text-xs text-ink-3">
          FT
          {m.frota
            .trim()
            .toUpperCase()
            .replace(/^FT[\s-]*/, '')}{' '}
          hoje está em: <b className="text-ink-2">{ondeEsta.map((c) => c.nome).join(', ')}</b>
          {m.tipo === 'locacao' && ' (sai de lá quando a locação for aprovada)'}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mov-cliente" className="label">
          Cliente {m.tipo === 'devolucao' && <span className="font-normal text-ink-3">(opcional: o sistema acha pela frota)</span>}
        </label>
        <input
          id="mov-cliente"
          list="mov-clientes"
          className="input uppercase"
          value={m.clienteNome ?? ''}
          onChange={(e) => escolherCliente(e.target.value)}
          placeholder="Comece a digitar o nome"
        />
        <datalist id="mov-clientes">
          {ativos.map((c) => (
            <option key={c.id} value={c.nome} />
          ))}
        </datalist>
        {m.clienteNome?.trim() && <p className="text-xs">{clienteAtual ? <Chip tom="ok">Cliente cadastrado</Chip> : <Chip tom="info">Cliente novo: será cadastrado</Chip>}</p>}
      </div>

      {m.tipo !== 'devolucao' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-valor" className="label">
                Valor da locação (R$)
              </label>
              <input
                id="mov-valor"
                inputMode="decimal"
                className="input text-right"
                value={valorTxt}
                onChange={(e) => setValorTxt(e.target.value)}
                onBlur={() => {
                  const v = lerReais(valorTxt);
                  if (v !== null) setValorTxt(reaisParaCampo(v));
                }}
                placeholder="3.350,00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-gas" className="label">
                Vasilhames de gás
              </label>
              <input
                id="mov-gas"
                type="number"
                min={0}
                max={50}
                className="input text-center"
                value={m.gas}
                onChange={(e) => mudar({ gas: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-frete" className="label">
                Frete
              </label>
              <select id="mov-frete" className="input" value={m.frete} onChange={(e) => mudar({ frete: e.target.value as NovaMovimentacao['frete'] })}>
                <option value="">—</option>
                <option value="lucminas">Por conta da Lucminas</option>
                <option value="cliente">Por conta do cliente</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-contrato" className="label">
                Tempo de contrato
              </label>
              <input id="mov-contrato" className="input" value={m.contrato} onChange={(e) => mudar({ contrato: e.target.value })} placeholder="12 meses" />
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label mb-1.5">Locação por</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['contrato', 'Contrato'],
                  ['esporadico', 'Esporádica'],
                ] as const
              ).map(([v, r]) => (
                <label key={v} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[14px] ${m.modalidade === v ? 'border-ink bg-white font-semibold' : 'border-line-strong bg-white/60'}`}>
                  <input type="radio" name="modalidade" checked={m.modalidade === v} onChange={() => mudar({ modalidade: v })} className="h-[18px] w-[18px] accent-ink" />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-fim" className="label">
              Término previsto <span className="font-normal text-ink-3">(aparece no Calendário)</span>
            </label>
            <input id="mov-fim" type="date" className="input" value={m.fim ?? ''} onChange={(e) => mudar({ fim: e.target.value || null })} />
            {(() => {
              const sug = fimSugerido(m.data, m.contrato);
              return sug && sug !== m.fim ? (
                <button type="button" className="self-start text-xs font-semibold text-ink-2 underline underline-offset-2" onClick={() => mudar({ fim: sug })}>
                  Usar {dataBr(sug)} ({m.contrato} a partir de {dataBr(m.data)})
                </button>
              ) : null;
            })()}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-prazo" className="label">
              Prazo de pagamento
            </label>
            <input
              id="mov-prazo"
              className="input"
              value={m.prazoPagamento}
              onChange={(e) => mudar({ prazoPagamento: e.target.value })}
              placeholder="30 dias após emissão da fatura"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-emails" className="label">
              E-mails para a fatura <span className="font-normal text-ink-3">(separe por vírgula)</span>
            </label>
            <input
              id="mov-emails"
              className="input"
              inputMode="email"
              value={emailsTxt}
              onChange={(e) => setEmailsTxt(e.target.value)}
              placeholder="compras@cliente.com.br, comercial@cliente.com.br"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-contato" className="label">
                Contato
              </label>
              <input id="mov-contato" className="input" value={m.contatoNome} onChange={(e) => mudar({ contatoNome: e.target.value })} placeholder="João Pedro" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-tel" className="label">
                Telefone
              </label>
              <input
                id="mov-tel"
                className="input"
                inputMode="tel"
                value={m.contatoTelefone}
                onChange={(e) => mudar({ contatoTelefone: e.target.value })}
                placeholder="(31) 98808-9842"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-desc" className="label">
              Equipamento <span className="font-normal text-ink-3">(opcional)</span>
            </label>
            <input id="mov-desc" className="input" value={m.descricao} onChange={(e) => mudar({ descricao: e.target.value })} placeholder="Empilhadeira 2,5t a gás" />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mov-obs" className="label">
          Observações
        </label>
        <textarea id="mov-obs" rows={2} className="input resize-y py-2 text-[13px]" value={m.observacoes} onChange={(e) => mudar({ observacoes: e.target.value })} />
      </div>      <p className="text-xs text-ink-3">A data de faturamento do cliente não é alterada: ela continua sendo definida no cadastro.</p>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-white pt-3">
        <button type="button" className="btn-secondary mr-auto" onClick={fechar}>
          Cancelar
        </button>
        {m.frota.trim() && <BotaoCopiar texto={mensagemAtual} />}
        <button type="button" className="btn-primary" onClick={registrar} disabled={salvando}>
          {salvando ? 'Registrando…' : ehFinanceiro ? 'Registrar movimentação' : 'Enviar para aprovação'}
        </button>
      </div>
    </div>
  );
}

/** Venda (máquina sai da frota) e compra (máquina nova entra, com a ficha montada). */
function FormVendaCompra({ tipo, fechar }: { tipo: 'venda' | 'compra'; fechar: () => void }) {
  const { clientes, recarregarOperacoes, aprova: ehFinanceiro } = useEstado();
  const venda = tipo === 'venda';
  const [d, setD] = useState({ frota: '', data: hojeIso(), parte: '', valor: '', nf: '', descricao: '', marca: '', modelo: '', serie: '', ano: '', capacidade: '', combustivel: '', obs: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feita, setFeita] = useState<Movimentacao | null>(null);
  const campo = (k: keyof typeof d) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }) });
  const num = d.frota.trim().toUpperCase().replace(/^FT[\s-]*/, '');
  const ondeEsta = num ? clientes.find((c) => c.ativo && c.frotas.some((f) => f.numero === num)) : undefined;
  const ativos = useMemo(() => clientes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes]);

  const montar = () => {
    const valor = d.valor.trim() ? lerReais(d.valor) : null;
    const cli = venda ? ativos.find((c) => c.nome === d.parte.trim().toUpperCase()) : undefined;
    return {
      ...movVazia(d.data),
      tipo,
      frota: num,
      data: d.data,
      valor,
      clienteId: cli?.id ?? null,
      clienteNome: cli ? cli.nome : d.parte.trim(),
      nf: d.nf.trim(),
      descricao: d.descricao.trim(),
      observacoes: d.obs.trim(),
      ...(venda
        ? {}
        : {
            maquina: {
              marca: d.marca.trim(),
              modelo: d.modelo.trim(),
              serie: d.serie.trim(),
              ano: d.ano.trim() ? Number(d.ano) : null,
              capacidade: d.capacidade.trim() ? Number(d.capacidade.replace(/\D/g, '')) : null,
              combustivel: d.combustivel,
            },
          }),
    } as NovaMovimentacao;
  };

  const registrar = async () => {
    setErro('');
    if (!num) return setErro('Informe o número da frota.');
    if (!d.data) return setErro('Informe a data.');
    if (d.valor.trim() && lerReais(d.valor) === null) return setErro(`Não entendi o valor "${d.valor}". Use, por exemplo, 65.000,00`);
    if (!venda && !d.descricao.trim()) return setErro('Descreva a máquina (ex.: YALE GLP050VX).');
    setSalvando(true);
    try {
      const salva = await api.registrarMovimentacao(montar());
      await recarregarOperacoes();
      setFeita(salva);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setSalvando(false);
    }
  };

  if (feita) return <Registrada m={feita} fechar={fechar} />;
  const rot = 'flex flex-col gap-1.5';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className={rot}>
          <span className="label">{venda ? 'Frota vendida' : 'Número de frota novo'}</span>
          <input className="input uppercase" {...campo('frota')} placeholder={venda ? 'FT48' : 'FT121'} />
        </label>
        <label className={rot}>
          <span className="label">Data</span>
          <input type="date" className="input" {...campo('data')} />
        </label>
      </div>
      {venda && ondeEsta && (
        <p className="-mt-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-warn-strong">
          A FT{num} está locada para <b>{ondeEsta.nome}</b>. Com a venda, ela sai desse cliente e deixa de ser faturada.
        </p>
      )}
      <label className={rot}>
        <span className="label">{venda ? 'Comprador' : 'Fornecedor'}</span>
        <input className="input" list={venda ? 'venda-clientes' : undefined} {...campo('parte')} placeholder={venda ? 'Cliente ou empresa que comprou' : 'De quem a Lucminas comprou'} />
        {venda && (
          <datalist id="venda-clientes">
            {ativos.map((c) => (
              <option key={c.id} value={c.nome} />
            ))}
          </datalist>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={rot}>
          <span className="label">{venda ? 'Valor da venda (R$)' : 'Valor da compra (R$)'}</span>
          <input
            className="input text-right"
            inputMode="decimal"
            {...campo('valor')}
            onBlur={() => {
              const v = lerReais(d.valor);
              if (v !== null) setD((x) => ({ ...x, valor: reaisParaCampo(v) }));
            }}
            placeholder="65.000,00"
          />
        </label>
        <label className={rot}>
          <span className="label">Nota fiscal</span>
          <input className="input" {...campo('nf')} />
        </label>
      </div>
      <label className={rot}>
        <span className="label">Equipamento {venda && <span className="font-normal text-ink-3">(opcional)</span>}</span>
        <input className="input" {...campo('descricao')} placeholder="YALE GLP050VX" />
      </label>
      {!venda && (
        <fieldset className="grid grid-cols-2 gap-3 rounded-[10px] bg-[#F8F7F3] p-3 sm:grid-cols-3">
          <legend className="px-1 text-xs font-semibold text-ink-3">Vai para a ficha da máquina (dá para completar depois)</legend>
          <label className={rot}>
            <span className="label">Marca</span>
            <input className="input" {...campo('marca')} />
          </label>
          <label className={rot}>
            <span className="label">Modelo</span>
            <input className="input" {...campo('modelo')} />
          </label>
          <label className={rot}>
            <span className="label">Nº de série</span>
            <input className="input" {...campo('serie')} />
          </label>
          <label className={rot}>
            <span className="label">Ano</span>
            <input className="input" inputMode="numeric" {...campo('ano')} />
          </label>
          <label className={rot}>
            <span className="label">Capacidade (kg)</span>
            <input className="input" inputMode="numeric" {...campo('capacidade')} />
          </label>
          <label className={rot}>
            <span className="label">Combustível</span>
            <select className="input" {...campo('combustivel')}>
              <option value="">—</option>
              {Object.entries(COMB).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}
      <label className={rot}>
        <span className="label">Observações</span>
        <textarea rows={2} className="input resize-y py-2 text-[13px]" {...campo('obs')} />
      </label>
      <p className="text-xs text-ink-3">
        {venda
          ? 'Depois de ' + (ehFinanceiro ? 'registrada' : 'aprovada') + ', a máquina sai do cliente (se estiver locada) e da oficina, e a ficha fica como "Vendida / baixada" com os dados da venda.'
          : 'Depois de ' + (ehFinanceiro ? 'registrada' : 'aprovada') + ', a máquina entra na frota como disponível, com a ficha montada com estes dados.'}
      </p>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-white pt-3">
        <button type="button" className="btn-secondary mr-auto" onClick={fechar}>
          Cancelar
        </button>
        {num && <BotaoCopiar texto={() => textoMensagem({ ...montar(), clienteNome: montar().clienteNome ?? '', dados: montar() })} />}
        <button type="button" className="btn-primary" onClick={registrar} disabled={salvando}>
          {salvando ? 'Registrando…' : ehFinanceiro ? `Registrar ${tipo}` : 'Enviar para aprovação'}
        </button>
      </div>
    </div>
  );
}

/** Reajuste: escolhe o cliente, marca as frotas, põe o valor novo (ou um % para todas). */
function FormReajuste({ clienteInicial, frotaInicial, fechar }: { clienteInicial?: string; frotaInicial?: string; fechar: () => void }) {
  const { clientes, recarregarOperacoes, aprova: ehFinanceiro } = useEstado();
  const comFrotas = useMemo(() => clientes.filter((c) => c.ativo && c.frotas.length).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes]);
  const [clienteId, setClienteId] = useState(clienteInicial ?? '');
  const cliente = comFrotas.find((c) => c.id === clienteId) ?? null;
  const [marcadas, setMarcadas] = useState<Record<string, string>>({});
  const [pctTxt, setPctTxt] = useState('');
  const [data, setData] = useState(proximoMes(hojeIso()));
  const [renova, setRenova] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feita, setFeita] = useState<Movimentacao | null>(null);

  // ao trocar de cliente: marca a frota que veio do aviso (ou todas, se só tem uma)
  useEffect(() => {
    if (!cliente) return setMarcadas({});
    const ini = cliente.frotas.filter((f) => (frotaInicial ? f.numero === frotaInicial : cliente.frotas.length === 1));
    setMarcadas(Object.fromEntries(ini.map((f) => [f.numero, ''])));
    const fim = cliente.frotas.find((f) => f.numero === frotaInicial)?.fim ?? null;
    setRenova(fim ? somarMeses(fim, 12) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o cliente muda
  }, [clienteId]);

  const aplicarPct = () => {
    const p = Number(pctTxt.replace(',', '.'));
    if (!cliente || !Number.isFinite(p)) return setErro('Informe o percentual, por exemplo 4,8');
    setErro('');
    setMarcadas((x) =>
      Object.fromEntries(
        Object.keys(x).map((n) => {
          const f = cliente.frotas.find((y) => y.numero === n)!;
          return [n, reaisParaCampo(Math.round((f.valor * (1 + p / 100)) / 100) * 100)];
        }),
      ),
    );
  };

  const itens = cliente
    ? Object.entries(marcadas).map(([frota, txt]) => ({ frota, antes: cliente.frotas.find((f) => f.numero === frota)?.valor ?? 0, novo: txt.trim() ? lerReais(txt) : null }))
    : [];
  const prontos = itens.filter((i): i is { frota: string; antes: number; novo: number } => i.novo !== null && i.novo > 0);
  const totalAntes = prontos.reduce((t, i) => t + i.antes, 0);
  const totalNovo = prontos.reduce((t, i) => t + i.novo, 0);

  const registrar = async () => {
    setErro('');
    if (!cliente) return setErro('Escolha o cliente.');
    if (!itens.length) return setErro('Marque pelo menos uma frota.');
    const falta = itens.find((i) => i.novo === null || i.novo <= 0);
    if (falta) return setErro(`Informe o valor novo da FT${falta.frota}.`);
    if (!data) return setErro('Informe a partir de quando vale.');
    setSalvando(true);
    try {
      const p = pctTxt.trim() ? Number(pctTxt.replace(',', '.')) : null;
      const salva = await api.registrarMovimentacao({
        ...movVazia(data),
        tipo: 'reajuste',
        frota: prontos.map((i) => i.frota).join(', '),
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        data,
        itens: prontos,
        percentual: p !== null && Number.isFinite(p) ? p : null,
        renovaAte: renova || null,
        observacoes: motivo,
      });
      await recarregarOperacoes();
      setFeita(salva);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setSalvando(false);
    }
  };

  if (feita) return <Registrada m={feita} fechar={fechar} />;
  const mensagemAtual = () =>
    textoMensagem({ tipo: 'reajuste', frota: prontos.map((i) => i.frota).join(', '), clienteNome: cliente?.nome ?? '', dados: { ...movVazia(data), itens: prontos, renovaAte: renova || null, observacoes: motivo } });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Cliente</span>
        <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Escolher…</option>
          {comFrotas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} ({c.frotas.length} frota{c.frotas.length > 1 ? 's' : ''})
            </option>
          ))}
        </select>
      </label>

      {cliente && (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-[10px] bg-[#F8F7F3] p-3">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Mesmo % para as marcadas
              <span className="flex items-center gap-1.5">
                <input className="input h-9 w-[90px] text-right font-normal" inputMode="decimal" value={pctTxt} onChange={(e) => setPctTxt(e.target.value)} placeholder="4,8" />
                <span className="text-[14px] font-normal">%</span>
              </span>
            </label>
            <button type="button" className="btn-secondary btn-sm h-9" onClick={aplicarPct} disabled={!pctTxt.trim() || !Object.keys(marcadas).length}>
              Calcular valores
            </button>
            <span className="text-xs text-ink-3">Arredonda para o real. Dá para ajustar cada valor depois.</span>
          </div>

          <table className="w-full text-[13.5px]">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-line">
                <th className="w-8 py-1.5" />
                <th className="py-1.5 text-left font-semibold">Frota</th>
                <th className="py-1.5 text-right font-semibold">Valor atual</th>
                <th className="py-1.5 pl-3 text-left font-semibold">Valor novo</th>
                <th className="py-1.5 text-right font-semibold">Variação</th>
              </tr>
            </thead>
            <tbody>
              {cliente.frotas.map((f) => {
                const on = f.numero in marcadas;
                const novo = on && marcadas[f.numero].trim() ? lerReais(marcadas[f.numero]) : null;
                return (
                  <tr key={f.numero} className="border-b border-line-soft">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Reajustar FT${f.numero}`}
                        className="h-[18px] w-[18px] accent-ink"
                        checked={on}
                        onChange={() =>
                          setMarcadas((x) => {
                            const y = { ...x };
                            if (on) delete y[f.numero];
                            else y[f.numero] = '';
                            return y;
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 font-semibold">
                      FT{f.numero}
                      {f.fim && <span className="ml-1.5 text-xs font-normal text-ink-3">até {dataBr(f.fim)}</span>}
                    </td>
                    <td className="py-1.5 text-right">{formatarReais(f.valor)}</td>
                    <td className="py-1.5 pl-3">
                      <input
                        aria-label={`Valor novo FT${f.numero}`}
                        className="input h-9 w-[130px] text-right"
                        inputMode="decimal"
                        disabled={!on}
                        value={on ? marcadas[f.numero] : ''}
                        onChange={(e) => setMarcadas((x) => ({ ...x, [f.numero]: e.target.value }))}
                        onBlur={(e) => {
                          const v = lerReais(e.target.value);
                          if (v !== null) setMarcadas((x) => ({ ...x, [f.numero]: reaisParaCampo(v) }));
                        }}
                        placeholder={on ? reaisParaCampo(f.valor) : ''}
                      />
                    </td>
                    <td className={`py-1.5 text-right text-xs font-semibold ${novo !== null && novo > f.valor ? 'text-ok' : novo !== null && novo < f.valor ? 'text-bad' : 'text-ink-3'}`}>
                      {novo !== null ? pct(f.valor, novo) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {prontos.length > 0 && (
            <p className="text-[13.5px]">
              Total por mês: {formatarReais(totalAntes)} → <b>{formatarReais(totalNovo)}</b>{' '}
              <span className={totalNovo >= totalAntes ? 'text-ok' : 'text-bad'}>
                ({sinal(totalNovo - totalAntes)}, {pct(totalAntes, totalNovo)})
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">Vale a partir de</span>
              <input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">
                Renovar contrato até <span className="font-normal text-ink-3">(opcional)</span>
              </span>
              <input type="date" className="input" value={renova} onChange={(e) => setRenova(e.target.value)} />
              {renova && Object.keys(marcadas).length > 1 && <span className="text-xs text-ink-3">Vale para todas as frotas marcadas.</span>}
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">Motivo</span>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: reajuste anual pelo IPCA (4,8%)" />
          </label>
          <p className="text-xs text-ink-3">Depois de {ehFinanceiro ? 'registrado' : 'aprovado'}, o valor novo vale no cadastro do cliente e na ficha de cada máquina. O valor antigo fica guardado no histórico.</p>
        </>
      )}
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-white pt-3">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        {prontos.length > 0 && <BotaoCopiar texto={mensagemAtual} />}
        <button type="button" className="btn-primary" onClick={registrar} disabled={salvando || !cliente}>
          {salvando ? 'Registrando…' : ehFinanceiro ? 'Registrar reajuste' : 'Enviar para aprovação'}
        </button>
      </div>
    </div>
  );
}

/** Copia a movimentação no formato de mensagem para o grupo. */
export function BotaoCopiar({ texto, rotulo = 'Copiar mensagem', className = 'btn-secondary' }: { texto: () => string; rotulo?: string; className?: string }) {
  const { avisar } = useEstado();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const ok = await copiarTexto(texto());
        if (!ok) return avisar('Não consegui copiar. Tente de novo.', 'bad');
        setCopiado(true);
        avisar('Mensagem copiada. É só colar no grupo.');
        setTimeout(() => setCopiado(false), 2500);
      }}
    >
      {copiado ? 'Copiada ✓' : rotulo}
    </button>
  );
}

/** Depois de registrar: mostra a mensagem pronta para o grupo. */
function Registrada({ m, fechar }: { m: Movimentacao; fechar: () => void }) {
  const texto = textoMensagem(m);
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-[10px] bg-ok-soft px-3 py-2.5 text-[14px] text-ok">
        {m.status === 'aprovada' ? 'Registrada e aplicada no cadastro.' : 'Registrada. Entra no cadastro quando o financeiro aprovar.'}
      </p>
      <span className="label">Mensagem para o grupo</span>
      <pre className="whitespace-pre-wrap rounded-xl border border-line bg-[#F8F7F3] p-3 font-sans text-[13.5px]">{texto}</pre>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Fechar
        </button>
        <BotaoCopiar texto={() => texto} className="btn-primary" />
      </div>
    </div>
  );
}

export function CartaoMov({ m, children, semBorda }: { m: Movimentacao; children?: React.ReactNode; semBorda?: boolean }) {
  const st = STATUS_MOV[m.status];
  return (
    <article className={semBorda ? '' : 'rounded-xl border border-line bg-white p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold">{tituloMov(m).toUpperCase()}</div>
          <div className="text-[13px] text-ink-2">
            {dataBr(m.dados.data)}
            {m.clienteNome && ` · ${m.clienteNome}`}
          </div>
        </div>
        <Chip tom={st.tom}>{st.rotulo}</Chip>
      </div>
      {detalhesMov(m).length > 0 && (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {detalhesMov(m).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2.5 text-xs text-ink-3">
        Registrada por {m.criadaPorNome || '—'} em {dataHora(m.criadaEm)}
        {m.decididaEm && ` · ${m.status === 'aprovada' ? 'aprovada' : 'recusada'} por ${m.decididaPorNome ?? '—'} em ${dataHora(m.decididaEm)}`}
        {m.motivo && ` · motivo: ${m.motivo}`}
      </p>
      {children}
    </article>
  );
}
