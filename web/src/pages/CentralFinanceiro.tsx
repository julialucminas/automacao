import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import { api } from '../api';
import type { Equipamento, ServicoExterno } from '../types';
import { dataBr, hojeIso, janelaConferencia, paraData, paraIso, proximasDatas, regraDoCliente } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { efeitoNaReceita, NOMES_TIPO } from '../lib/movimentacao';
import { contratosVencendo, STATUS_MOV, TOM_TIPO } from './Movimentacoes';
import { Chip, type Tom } from '../components/ui';
import { BotaoOk } from '../components/BotaoOk';
import { chaveContrato, chaveEnvio, emailsComProblema } from '../lib/avisos';
import { IcAlerta, IcCheck, IcDinheiro, IcEmail, IcEmpilhadeira, IcEnviar, IcNota, IcPredio, IcPrancheta } from '../components/Icones';

const somarDias = (iso: string, n: number) => paraIso(new Date(paraData(iso).getTime() + n * 86_400_000));
const sinal = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatarReais(Math.abs(c))}`;

/** ok: chave do "ok" (a pendência some das notificações, o registro fica) */
type Pendencia = { chave: string; tom: Tom; rotulo: string; texto: ReactNode; link: string; acao: string; ok?: string };

/**
 * Central do financeiro: a primeira tela da Angelise.
 * Em cima o que está esperando por ela (faturas, e-mails com problema, solicitações, aprovações, reajustes, cobranças);
 * depois os números do mês, o acesso rápido e o que mudou nas máquinas.
 */
export function CentralFinanceiro() {
  const { config, usuario, clientes, envios, movimentacoes, propostas, pendentesParaMim, solicitacoes, pode, veValores, avisosOk, novasMov, marcarMovVistas } = useEstado();
  const hoje = hojeIso();
  const ref = referenciaAtual();
  const janela = janelaConferencia(config);
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const ativos = useMemo(() => clientes.filter((c) => c.ativo), [clientes]);

  const [eqs, setEqs] = useState<Equipamento[]>([]);
  const [externos, setExternos] = useState<ServicoExterno[]>([]);
  const [conferidas, setConferidas] = useState<number | null>(null);
  useEffect(() => {
    if (pode('frotas')) api.listarEquipamentos().then(setEqs, () => undefined);
    if (pode('externos')) api.listarExternos().then(setExternos, () => undefined);
    if (pode('conferencia')) api.listarConferencia(janela.referencia).then((l) => setConferidas(l.length), () => undefined);
  }, [pode, janela.referencia]);

  // faturas: hoje e próximos 7 dias, pela regra de cada cliente
  const faturas = useMemo(() => {
    const ate = somarDias(hoje, 7);
    return ativos
      .flatMap((c) => {
        const r = regraDoCliente(c);
        const d = r ? proximasDatas(r, 1, hoje)[0] : undefined;
        return d && d <= ate ? [{ cliente: c, data: d }] : [];
      })
      .sort((a, b) => a.data.localeCompare(b.data));
  }, [ativos, hoje]);
  const faturasHoje = faturas.filter((f) => f.data === hoje);
  const doMes = envios.filter((e) => e.referencia === ref);
  const enviadas = doMes.filter((e) => e.status !== 'falhou').length;
  const lidas = doMes.filter((e) => e.status === 'lido').length;
  // e-mails com problema que ninguém deu ok (o ok tira daqui, mas o registro fica no Histórico)
  const comProblema = emailsComProblema(envios, avisosOk);

  // locação e movimentações
  const frotas = ativos.flatMap((c) => c.frotas);
  const receita = frotas.reduce((t, f) => t + f.valor, 0);
  const mes = hoje.slice(0, 7);
  const variacaoMes = movimentacoes.filter((m) => m.status === 'aprovada' && m.dados.data.slice(0, 7) === mes).reduce((t, m) => t + (efeitoNaReceita(m) ?? 0), 0);
  const movPend = movimentacoes.filter((m) => m.status === 'pendente');
  const reajPend = movPend.filter((m) => m.tipo === 'reajuste');
  const propPend = propostas.filter((p) => p.status === 'pendente');
  const vencendo = useMemo(() => contratosVencendo(eqs, clientes, hoje).filter((v) => !avisosOk.has(chaveContrato(v.frota, v.vence))), [eqs, clientes, hoje, avisosOk]);
  const seteDias = somarDias(hoje, -7);
  const recentes = movimentacoes
    .filter((m) => m.status !== 'rejeitada' && (m.criadaEm.slice(0, 10) >= seteDias || m.dados.data >= seteDias))
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));

  // serviços externos
  const aCobrar = externos.filter((s) => s.etapa === 'concluido');
  const aOrcar = externos.filter((s) => s.etapa === 'pedido' || s.etapa === 'orcamento');
  const naoLidas = solicitacoes.filter((s) => s.naoLidas > 0 && !pendentesParaMim.some((p) => p.id === s.id));

  // tudo o que está esperando por ela, na ordem do que pesa mais
  const pend: Pendencia[] = [];
  if (movPend.length + propPend.length)
    pend.push({
      chave: 'aprov',
      tom: 'warn',
      rotulo: 'Aprovar',
      texto: (
        <>
          <b>{movPend.length + propPend.length}</b> alteraç{movPend.length + propPend.length > 1 ? 'ões' : 'ão'} esperando você
          {reajPend.length > 0 && <> ({reajPend.length} reajuste{reajPend.length > 1 ? 's' : ''})</>}
          {propPend.length > 0 && <> · {propPend.length} de cadastro</>}
        </>
      ),
      link: '/aprovacoes',
      acao: 'Aprovar',
    });
  if (faturasHoje.length)
    pend.push({
      chave: 'fat',
      tom: 'warn',
      rotulo: 'Faturas',
      texto: (
        <>
          <b>{faturasHoje.length}</b> fatura{faturasHoje.length > 1 ? 's' : ''} para emitir hoje: {faturasHoje.slice(0, 4).map((f) => f.cliente.nome).join(', ')}
          {faturasHoje.length > 4 ? '…' : ''}
        </>
      ),
      link: '/envio',
      acao: 'Enviar',
    });
  for (const e of comProblema.slice(0, 5))
    pend.push({
      chave: `mail-${e.id}`,
      tom: 'bad',
      rotulo: e.status === 'devolvido' ? 'Devolvido' : 'Não saiu',
      texto: (
        <>
          Fatura {e.numero} · <b>{e.clienteNome}</b>
          <span className="text-ink-3"> · {e.status === 'devolvido' ? e.devolucao || 'e-mail devolvido' : 'o e-mail não saiu'}</span>
        </>
      ),
      link: `/historico?busca=${encodeURIComponent(e.numero)}`,
      acao: 'Ver',
      ok: chaveEnvio(e),
    });
  if (comProblema.length > 5)
    pend.push({ chave: 'mail-mais', tom: 'bad', rotulo: 'E-mails', texto: <>e mais {comProblema.length - 5} e-mails com problema</>, link: '/historico', acao: 'Ver' });
  for (const s of pendentesParaMim.slice(0, 5))
    pend.push({
      chave: `sol-${s.id}`,
      tom: 'info',
      rotulo: 'Solicitação',
      texto: (
        <>
          {s.titulo}
          {s.clienteNome && <span className="text-ink-3"> · {s.clienteNome}</span>}
          <span className="text-ink-3"> · de {s.criadaPorNome}</span>
        </>
      ),
      link: `/solicitacoes?id=${s.id}`,
      acao: 'Abrir',
    });
  if (pendentesParaMim.length > 5)
    pend.push({ chave: 'sol-mais', tom: 'info', rotulo: 'Solicitação', texto: <>e mais {pendentesParaMim.length - 5} solicitações para você</>, link: '/solicitacoes', acao: 'Ver' });
  if (naoLidas.length)
    pend.push({
      chave: 'msg',
      tom: 'info',
      rotulo: 'Mensagens',
      texto: (
        <>
          Mensagem nova em <b>{naoLidas.length}</b> solicitaç{naoLidas.length > 1 ? 'ões' : 'ão'}: {naoLidas.slice(0, 3).map((s) => s.titulo).join(', ')}
        </>
      ),
      link: '/solicitacoes',
      acao: 'Ler',
    });
  for (const v of vencendo.slice(0, 5))
    pend.push({
      chave: `reaj-${v.frota}`,
      tom: 'warn',
      rotulo: 'Reajuste',
      texto: (
        <>
          Contrato da <b>FT{v.frota}</b> ({v.cliente?.nome}) {v.vence < hoje ? 'venceu' : 'vence'} em {dataBr(v.vence)}
        </>
      ),
      link: `/movimentacoes?nova=reajuste&cliente=${v.cliente?.id ?? ''}&frota=${v.frota}`,
      acao: 'Reajustar',
      ok: chaveContrato(v.frota, v.vence),
    });
  if (vencendo.length > 5)
    pend.push({ chave: 'reaj-mais', tom: 'warn', rotulo: 'Reajuste', texto: <>e mais {vencendo.length - 5} contratos vencendo</>, link: '/movimentacoes', acao: 'Ver' });
  if (aCobrar.length)
    pend.push({
      chave: 'cobrar',
      tom: 'warn',
      rotulo: 'Cobrar',
      texto: (
        <>
          <b>{aCobrar.length}</b> serviço{aCobrar.length > 1 ? 's' : ''} externo{aCobrar.length > 1 ? 's' : ''} concluído{aCobrar.length > 1 ? 's' : ''} para cobrar
          {veValores && aCobrar.some((s) => s.valor) && <> · {formatarReais(aCobrar.reduce((t, s) => t + (s.valor ?? 0), 0))}</>}
        </>
      ),
      link: '/externos',
      acao: 'Ver',
    });
  if (aOrcar.length)
    pend.push({
      chave: 'orcar',
      tom: 'info',
      rotulo: 'Orçar',
      texto: (
        <>
          <b>{aOrcar.length}</b> serviço{aOrcar.length > 1 ? 's' : ''} externo{aOrcar.length > 1 ? 's' : ''} esperando orçamento
        </>
      ),
      link: '/externos',
      acao: 'Ver',
    });
  if (conferidas !== null && frotas.length && conferidas < frotas.length && janela.aberta)
    pend.push({
      chave: 'conf',
      tom: 'info',
      rotulo: 'Conferência',
      texto: (
        <>
          Conferência de {referenciaPorExtenso(janela.referencia)}: faltam <b>{frotas.length - conferidas}</b> de {frotas.length} frotas
        </>
      ),
      link: '/conferencia',
      acao: 'Conferir',
    });

  const atalhos: { rota: string; rotulo: string; dica: string; icone: ReactNode; ok: boolean }[] = [
    { rota: '/envio', rotulo: 'Envio do mês', dica: 'Mandar faturas e boletos', icone: <IcEnviar tamanho={20} />, ok: pode('envio', 2) },
    { rota: '/calendario', rotulo: 'Calendário', dica: 'Faturas e locações por dia', icone: <IcNota tamanho={20} />, ok: pode('calendario') },
    { rota: '/historico', rotulo: 'Histórico de envios', dica: 'O que saiu, foi lido ou voltou', icone: <IcEmail tamanho={20} />, ok: pode('historico') },
    { rota: '/aprovacoes', rotulo: 'Aprovações', dica: 'Movimentações e cadastro', icone: <IcCheck tamanho={20} />, ok: true },
    { rota: '/movimentacoes', rotulo: 'Movimentações', dica: 'Locação, troca, devolução', icone: <IcEmpilhadeira tamanho={20} />, ok: pode('movimentacoes') },
    { rota: '/movimentacoes?nova=reajuste', rotulo: 'Registrar reajuste', dica: 'Valor novo por frota ou %', icone: <IcDinheiro tamanho={20} />, ok: pode('movimentacoes', 2) },
    { rota: '/clientes', rotulo: 'Clientes', dica: 'Cadastro, e-mails, frotas', icone: <IcPredio tamanho={20} />, ok: pode('clientes') },
    { rota: '/conferencia', rotulo: 'Conferência do mês', dica: 'Frotas x faturamento', icone: <IcPrancheta tamanho={20} />, ok: pode('conferencia') },
    { rota: '/externos', rotulo: 'Serviços externos', dica: 'Orçamento e cobrança', icone: <IcAlerta tamanho={20} />, ok: pode('externos') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold">
          {saudacao}
          {nome ? `, ${nome}` : ''}!
        </h1>
        <p className="text-[13px] text-ink-3">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · Central do financeiro
        </p>
      </div>

      {/* indicadores */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores">
        {veValores && <Indicador valor={formatarReais(receita)} rotulo="de locação por mês" sub={`${frotas.length} frotas locadas`} link="/frotas" />}
        {veValores && (
          <Indicador
            valor={sinal(variacaoMes)}
            tom={variacaoMes > 0 ? 'ok' : variacaoMes < 0 ? 'bad' : 'ink'}
            rotulo={`na receita em ${referenciaPorExtenso(ref).split(' ')[0]}`}
            sub="locações, devoluções e reajustes"
            link="/movimentacoes"
          />
        )}
        <Indicador valor={String(enviadas)} rotulo={`faturas enviadas em ${referenciaPorExtenso(ref).split(' ')[0]}`} sub={`${lidas} lidas · ${faturas.length} nos próximos 7 dias`} link="/historico" />
        <Indicador
          valor={String(vencendo.length)}
          tom={vencendo.length ? 'warn' : 'ink'}
          rotulo="contratos para reajustar"
          sub="vencendo em 30 dias ou vencidos"
          link="/movimentacoes"
        />
      </section>

      {novasMov.length > 0 && (
        <section className="rounded-xl border-2 border-brand bg-white" aria-label="Novas movimentações">
          <h2 className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-tint px-5 py-3 text-[15px] font-bold">
            <span>
              Novas movimentações <span className="ml-1 rounded-full bg-brand px-2.5 text-[13px]">{novasMov.length}</span>
              <span className="ml-2 text-[13px] font-normal text-ink-3">o que mudou nas máquinas desde a última vez que você viu</span>
            </span>
            {novasMov.length > 1 && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => void marcarMovVistas(novasMov.map((m) => m.id))}>
                ✓ Ciente de todas
              </button>
            )}
          </h2>
          <ul>
            {novasMov.slice(0, 10).map((m) => {
              const ef = efeitoNaReceita(m);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft px-5 py-2.5 text-[13.5px] last:border-0">
                  <Link to={`/movimentacoes?id=${m.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 hover:underline">
                    <span className="w-[42px] text-xs text-ink-3">{dataBr(m.dados.data).slice(0, 5)}</span>
                    <Chip tom={TOM_TIPO[m.tipo]}>{NOMES_TIPO[m.tipo].replace(' de frota', '')}</Chip>
                    <b>FT{m.tipo === 'reajuste' ? m.frota.split(', ').join(', FT') : m.frota}</b>
                    {m.tipo === 'troca' && m.frotaNova && <span>→ FT{m.frotaNova}</span>}
                    <span className="text-ink-2">{m.clienteNome}</span>
                    {veValores && ef != null && ef !== 0 && <span className={`text-xs font-semibold ${ef > 0 ? 'text-ok' : 'text-bad'}`}>{sinal(ef)}</span>}
                    <span className="text-xs text-ink-3">· por {m.criadaPorNome}</span>
                    {m.status === 'pendente' && <Chip tom={STATUS_MOV.pendente.tom}>aprovar</Chip>}
                  </Link>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void marcarMovVistas([m.id])}>
                    ✓ Ciente
                  </button>
                </li>
              );
            })}
          </ul>
          {novasMov.length > 10 && (
            <Link to="/movimentacoes" className="block px-5 py-2 text-[13px] font-semibold text-info">
              e mais {novasMov.length - 10} →
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* pendências */}
        <section className="flex flex-col rounded-xl border border-line bg-white" aria-label="Pendências">
          <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-[15px] font-bold">
            O que está esperando você
            <span className={`rounded-full px-2.5 text-[13px] ${pend.length ? 'bg-brand text-ink' : 'bg-ok-soft text-ok'}`}>{pend.length || 'nada'}</span>
          </h2>
          {pend.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-[14px] text-ok">
              <IcCheck tamanho={18} /> Tudo em dia.
            </p>
          ) : (
            <ul>
              {pend.map((p) => (
                <li key={p.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-brand-tint">
                  <Link to={p.link} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-[92px] shrink-0">
                      <Chip tom={p.tom}>{p.rotulo}</Chip>
                    </span>
                    <span className="min-w-0 flex-1 text-[14px]">{p.texto}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-info">{p.acao} →</span>
                  </Link>
                  {p.ok && <BotaoOk chave={p.ok} rotulo="Ok" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* máquinas: movimentações e reajustes da semana */}
        <section className="flex flex-col rounded-xl border border-line bg-white" aria-label="Movimentações da semana">
          <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-[15px] font-bold">
            Máquinas: últimos 7 dias
            <Link to="/movimentacoes" className="text-[13px] font-semibold text-info hover:underline">
              Ver tudo →
            </Link>
          </h2>
          {recentes.length === 0 ? (
            <p className="px-5 py-6 text-[14px] text-ink-3">Nenhuma locação, troca, devolução ou reajuste nesta semana.</p>
          ) : (
            <ul>
              {recentes.slice(0, 8).map((m) => {
                const ef = efeitoNaReceita(m);
                return (
                  <li key={m.id} className="border-b border-line-soft last:border-0">
                    <Link to={`/movimentacoes?id=${m.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-5 py-2.5 text-[13.5px] hover:bg-brand-tint">
                      <span className="w-[42px] text-xs text-ink-3">{dataBr(m.dados.data).slice(0, 5)}</span>
                      <Chip tom={TOM_TIPO[m.tipo]}>{NOMES_TIPO[m.tipo].replace(' de frota', '')}</Chip>
                      <b>FT{m.tipo === 'reajuste' ? m.frota.split(', ').join(', FT') : m.frota}</b>
                      {m.tipo === 'troca' && m.frotaNova && <span>→ FT{m.frotaNova}</span>}
                      <span className="min-w-0 truncate text-ink-2">{m.clienteNome}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {veValores && ef != null && ef !== 0 && <span className={`text-xs font-semibold ${ef > 0 ? 'text-ok' : 'text-bad'}`}>{sinal(ef)}</span>}
                        {m.status === 'pendente' && <Chip tom={STATUS_MOV.pendente.tom}>aprovar</Chip>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* acesso rápido */}
      <section aria-label="Acesso rápido" className="flex flex-col gap-2">
        <h2 className="px-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">Acesso rápido</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {atalhos
            .filter((a) => a.ok)
            .map((a) => (
              <Link key={a.rota} to={a.rota} className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5 hover:border-brand hover:bg-brand-tint">
                <span className="mt-0.5 text-ink-2">{a.icone}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold leading-tight">{a.rotulo}</span>
                  <span className="block text-xs text-ink-3">{a.dica}</span>
                </span>
              </Link>
            ))}
        </div>
      </section>

      {faturas.length > faturasHoje.length && (
        <section className="rounded-xl border border-line bg-white" aria-label="Próximas faturas">
          <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-[15px] font-bold">
            Próximas faturas (7 dias)
            <Link to="/calendario" className="text-[13px] font-semibold text-info hover:underline">
              Calendário →
            </Link>
          </h2>
          <ul className="grid gap-x-6 px-5 py-2 sm:grid-cols-2 lg:grid-cols-3">
            {faturas
              .filter((f) => f.data !== hoje)
              .map((f) => (
                <li key={f.cliente.id} className="flex justify-between gap-2 border-b border-line-soft py-1.5 text-[13.5px]">
                  <span className="truncate">{f.cliente.nome}</span>
                  <span className="text-ink-3">{dataBr(f.data).slice(0, 5)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Indicador({ valor, rotulo, sub, link, tom = 'ink' }: { valor: string; rotulo: string; sub?: string; link: string; tom?: 'ink' | 'ok' | 'bad' | 'warn' }) {
  const cor = { ink: 'text-ink', ok: 'text-ok', bad: 'text-bad', warn: 'text-warn' }[tom];
  return (
    <Link to={link} className="flex flex-col gap-0.5 rounded-xl border border-line bg-white p-4 hover:border-brand">
      <b className={`text-[24px] leading-tight ${cor}`}>{valor}</b>
      <span className="text-[13px] text-ink-2">{rotulo}</span>
      {sub && <span className="text-xs text-ink-3">{sub}</span>}
    </Link>
  );
}
