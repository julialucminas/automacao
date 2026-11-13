import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import { emailsComProblema } from '../lib/avisos';
import { api } from '../api';
import { dataCurta, hojeIso, paraData, paraIso, proximasDatas, regraDoCliente } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { montarEquipamentos } from '../lib/equipamentos';
import { montarPainel, regrasDe, type LinhaPainel } from '../lib/manutencao';
import type { Ordem, Pendencia, ServicoExterno } from '../types';
import { efeitoNaReceita, NOMES_TIPO } from '../lib/movimentacao';
import { STATUS_MOV, TOM_TIPO } from './Movimentacoes';
import { Chip } from '../components/ui';

const somarDias = (iso: string, n: number) => paraIso(new Date(paraData(iso).getTime() + n * 86_400_000));

function Cartao({ titulo, link, rotuloLink, children, destaque }: { titulo: string; link?: string; rotuloLink?: string; children: ReactNode; destaque?: boolean }) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-white p-5 ${destaque ? 'border-brand shadow-[inset_0_3px_0_#FFC400]' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">{titulo}</h2>
        {link && (
          <Link to={link} className="text-[13px] font-semibold text-info hover:underline">
            {rotuloLink ?? 'Abrir'} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Numero({ n, rotulo, tom = 'ink' }: { n: number | string; rotulo: string; tom?: 'ink' | 'warn' | 'bad' | 'ok' }) {
  const cor = { ink: 'text-ink', warn: 'text-warn', bad: 'text-bad', ok: 'text-ok' }[tom];
  return (
    <div>
      <div className={`text-[26px] font-bold leading-none ${cor}`}>{n}</div>
      <div className="mt-1 text-xs text-ink-3">{rotulo}</div>
    </div>
  );
}

/** Primeira tela de todo mundo: cada um vê só o que é dele. */
export function Inicio() {
  const { usuario, clientes, envios, oficina, movimentacoes, propostas, aprova, pode, veValores, config, avisosOk } = useEstado();
  const hoje = hojeIso();
  const ref = referenciaAtual();
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const ativos = clientes.filter((c) => c.ativo);

  // faturas de hoje e dos próximos 7 dias, pela regra de cada cliente
  const faturas = useMemo(() => {
    if (!pode('envio')) return [];
    const ate = somarDias(hoje, 7);
    return ativos
      .flatMap((c) => {
        const r = regraDoCliente(c);
        const d = r ? proximasDatas(r, 1, hoje)[0] : undefined;
        return d && d <= ate ? [{ cliente: c, data: d }] : [];
      })
      .sort((a, b) => a.data.localeCompare(b.data) || a.cliente.nome.localeCompare(b.cliente.nome));
  }, [ativos, hoje, pode]);
  const faturasHoje = faturas.filter((f) => f.data === hoje);
  const enviadasNoMes = envios.filter((e) => e.referencia === ref && e.status !== 'falhou').length;
  const devolvidos = emailsComProblema(envios, avisosOk).length;

  // locações
  const frotas = ativos.flatMap((c) => c.frotas.map((f) => ({ c, f })));
  const terminando = frotas.filter(({ f }) => f.fim && f.fim >= hoje && f.fim <= somarDias(hoje, 30)).sort((a, b) => a.f.fim!.localeCompare(b.f.fim!));
  const valorMensal = frotas.reduce((s, { f }) => s + f.valor, 0);

  // aprovações
  const pendentes = movimentacoes.filter((m) => m.status === 'pendente').length + propostas.filter((p) => p.status === 'pendente').length;

  // mudanças nas máquinas (locação, troca, devolução, reajuste) dos últimos 7 dias — para o financeiro
  const veMudancas = aprova || veValores;
  const seteDias = somarDias(hoje, -7);
  const mudancas = movimentacoes
    .filter((m) => m.status !== 'rejeitada' && (m.criadaEm.slice(0, 10) >= seteDias || m.dados.data >= seteDias))
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  const saldoSemana = mudancas.filter((m) => m.status === 'aprovada').reduce((t, m) => t + (efeitoNaReceita(m) ?? 0), 0);

  // conferência do mês
  // painel de manutenção (quem vê a manutenção)
  const veManutencao = pode('manutencao');
  const [painel, setPainel] = useState<{ linhas: LinhaPainel[]; pendencias: Pendencia[] } | null>(null);
  useEffect(() => {
    if (!veManutencao) return;
    Promise.all([api.listarEquipamentos(), api.listarPendencias()]).then(
      ([f, p]) => setPainel({ linhas: montarPainel(montarEquipamentos(f, clientes, oficina), regrasDe(config), p), pendencias: p }),
      () => setPainel(null),
    );
  }, [veManutencao, clientes, oficina, config]);
  const atrasadas = painel?.linhas.filter((l) => l.status === 'atrasado') ?? [];
  const semana = painel?.linhas.filter((l) => l.status === 'atencao') ?? [];

  // ordens de serviço em aberto
  const veOrdens = pode('ordens');
  const [ordens, setOrdens] = useState<Ordem[] | null>(null);
  useEffect(() => {
    if (veOrdens) api.listarOrdens(true).then(setOrdens, () => setOrdens(null));
  }, [veOrdens]);
  const osRevisar = ordens?.filter((o) => o.status === 'concluida').length ?? 0;
  const osAndamento = ordens?.filter((o) => o.status === 'execucao' || o.status === 'aguardando_peca').length ?? 0;
  const osAtrasadas = ordens?.filter((o) => ['aberta', 'agendada'].includes(o.status) && o.agendadaPara && o.agendadaPara < hoje).length ?? 0;

  // serviços externos: o que está parado esperando alguém da casa
  const veExternos = pode('externos');
  const [externos, setExternos] = useState<ServicoExterno[] | null>(null);
  useEffect(() => {
    if (veExternos) api.listarExternos().then(setExternos, () => setExternos(null));
  }, [veExternos]);
  const extOrcar = externos?.filter((s) => s.etapa === 'pedido' || s.etapa === 'orcamento').length ?? 0;
  const extCobrar = externos?.filter((s) => s.etapa === 'concluido').length ?? 0;
  const extAndamento = externos?.filter((s) => ['enviado', 'aprovado', 'execucao'].includes(s.etapa)).length ?? 0;

  const [conferidas, setConferidas] = useState<number | null>(null);
  const confere = pode('conferencia', 2);
  useEffect(() => {
    if (!confere) return;
    api.listarConferencia(ref).then(
      (l) => setConferidas(l.length),
      () => setConferidas(null),
    );
  }, [confere, ref]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold">
          {saudacao}
          {nome ? `, ${nome}` : ''}!
        </h1>
        <p className="text-[13px] text-ink-3">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · {usuario?.perfilNome}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {aprova ? (
          <Cartao titulo="Aprovações" link="/aprovacoes" destaque={pendentes > 0}>
            <Numero n={pendentes} rotulo={pendentes === 1 ? 'alteração esperando você aprovar' : 'alterações esperando você aprovar'} tom={pendentes ? 'warn' : 'ok'} />
          </Cartao>
        ) : (
          pendentes > 0 && (
            <Cartao titulo="Minhas alterações" link="/aprovacoes">
              <Numero n={pendentes} rotulo="aguardando aprovação do financeiro" />
            </Cartao>
          )
        )}

        {veMudancas && mudancas.length > 0 && (
          <Cartao titulo="Máquinas: últimos 7 dias" link="/movimentacoes" rotuloLink="Ver tudo">
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {mudancas.slice(0, 6).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Chip tom={TOM_TIPO[m.tipo]}>{NOMES_TIPO[m.tipo].replace(' de frota', '')}</Chip>
                  <b>FT{m.tipo === 'reajuste' ? m.frota.split(', ').join(', FT') : m.frota}</b>
                  {m.tipo === 'troca' && m.frotaNova && <span>→ FT{m.frotaNova}</span>}
                  <span className="text-ink-2">{m.clienteNome}</span>
                  {veValores && (efeitoNaReceita(m) ?? 0) !== 0 && (
                    <span className={`text-xs font-semibold ${(efeitoNaReceita(m) ?? 0) > 0 ? 'text-ok' : 'text-bad'}`}>
                      {(efeitoNaReceita(m) ?? 0) > 0 ? '+' : '−'}
                      {formatarReais(Math.abs(efeitoNaReceita(m) ?? 0))}
                    </span>
                  )}
                  {m.status === 'pendente' && <Chip tom={STATUS_MOV.pendente.tom}>aguardando aprovação</Chip>}
                </li>
              ))}
            </ul>
            {mudancas.length > 6 && <p className="mt-1 text-xs text-ink-3">e mais {mudancas.length - 6}</p>}
            {veValores && saldoSemana !== 0 && (
              <p className="mt-2 text-[13px] text-ink-2">
                Na receita mensal: <b className={saldoSemana > 0 ? 'text-ok' : 'text-bad'}>{saldoSemana > 0 ? '+' : '−'}{formatarReais(Math.abs(saldoSemana))}</b>
              </p>
            )}
          </Cartao>
        )}

        {pode('envio') && (
          <Cartao titulo="Faturas" link="/calendario" rotuloLink="Calendário" destaque={faturasHoje.length > 0}>
            <div className="flex gap-6">
              <Numero n={faturasHoje.length} rotulo="para emitir hoje" tom={faturasHoje.length ? 'warn' : 'ink'} />
              <Numero n={enviadasNoMes} rotulo={`enviadas em ${referenciaPorExtenso(ref).split(' ')[0]}`} />
              {devolvidos > 0 && pode('historico') && <Numero n={devolvidos} rotulo="e-mails devolvidos" tom="bad" />}
            </div>
            {faturas.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[13px]">
                {faturas.slice(0, 6).map((f) => (
                  <li key={f.cliente.id} className="flex justify-between gap-2">
                    <span className="truncate">{f.cliente.nome}</span>
                    <span className={`shrink-0 ${f.data === hoje ? 'font-bold' : 'text-ink-3'}`}>{f.data === hoje ? 'hoje' : dataCurta(f.data)}</span>
                  </li>
                ))}
                {faturas.length > 6 && <li className="text-xs text-ink-3">e mais {faturas.length - 6} nos próximos 7 dias</li>}
              </ul>
            )}
          </Cartao>
        )}

        {pode('frotas') && (
          <Cartao titulo="Locações" link="/frotas" rotuloLink="Frotas">
            <div className="flex flex-wrap gap-6">
              <Numero n={frotas.length} rotulo="frotas locadas" />
              <Numero n={oficina.length} rotulo="na oficina" tom={oficina.length ? 'warn' : 'ink'} />
              <Numero n={terminando.length} rotulo="terminam em 30 dias" />
              {veValores && <Numero n={formatarReais(valorMensal)} rotulo="de locação por mês" />}
            </div>
            {terminando.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[13px]">
                {terminando.slice(0, 5).map(({ c, f }) => (
                  <li key={`${c.id}-${f.numero}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      <b className="font-mono">FT{f.numero}</b> · {c.nome}
                    </span>
                    <span className="shrink-0 text-ink-3">termina {dataCurta(f.fim!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )}

        {veManutencao && painel && painel.linhas.length > 0 && (
          <Cartao titulo="Manutenção" link="/manutencao" rotuloLink="Painel" destaque={atrasadas.length > 0}>
            <div className="flex flex-wrap gap-6">
              <Numero n={atrasadas.length} rotulo="atrasadas" tom={atrasadas.length ? 'bad' : 'ok'} />
              <Numero n={semana.length} rotulo="vencem esta semana" tom={semana.length ? 'warn' : 'ink'} />
              <Numero n={painel.pendencias.length} rotulo="pendências abertas" />
            </div>
            {atrasadas.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[13px]">
                {atrasadas.slice(0, 5).map((l) => (
                  <li key={l.frota} className="flex justify-between gap-2">
                    <span className="truncate">
                      <b className="font-mono">FT{l.frota}</b> · {l.linha.cliente?.nome ?? 'sem cliente'}
                    </span>
                    <span className="shrink-0 text-bad">{l.motivos[0]}</span>
                  </li>
                ))}
                {atrasadas.length > 5 && <li className="text-xs text-ink-3">e mais {atrasadas.length - 5}</li>}
              </ul>
            )}
          </Cartao>
        )}

        {veOrdens && ordens && ordens.length > 0 && (
          <Cartao titulo="Ordens de serviço" link="/ordens" destaque={osRevisar > 0}>
            <div className="flex flex-wrap gap-6">
              <Numero n={osRevisar} rotulo="para revisar e encerrar" tom={osRevisar ? 'warn' : 'ink'} />
              <Numero n={osAndamento} rotulo="em execução" />
              <Numero n={osAtrasadas} rotulo="agendadas atrasadas" tom={osAtrasadas ? 'bad' : 'ink'} />
            </div>
          </Cartao>
        )}

        {veExternos && externos && externos.some((s) => s.etapa !== 'cobrado' && s.etapa !== 'recusado') && (
          <Cartao titulo="Serviços externos" link="/externos" destaque={extOrcar + extCobrar > 0}>
            <div className="flex flex-wrap gap-6">
              <Numero n={extOrcar} rotulo="para orçar" tom={extOrcar ? 'warn' : 'ink'} />
              <Numero n={extAndamento} rotulo="em andamento" />
              <Numero n={extCobrar} rotulo="concluídos a cobrar" tom={extCobrar ? 'warn' : 'ink'} />
            </div>
          </Cartao>
        )}

        {confere && (
          <Cartao titulo="Conferência do mês" link="/conferencia">
            <Numero
              n={conferidas === null ? '—' : `${Math.min(conferidas, frotas.length)} de ${frotas.length}`}
              rotulo={`frotas conferidas em ${referenciaPorExtenso(ref)}`}
              tom={conferidas !== null && conferidas >= frotas.length ? 'ok' : 'ink'}
            />
          </Cartao>
        )}
      </div>
    </div>
  );
}
