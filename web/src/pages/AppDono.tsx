import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Equipamento, FotoMensal, Ordem, PecaHistorico, Pendencia, ServicoExterno } from '../types';
import { montarEquipamentos, nomeEquipamento, SITUACOES, type LinhaEquipamento } from '../lib/equipamentos';
import { montarPainel, regrasDe, somarDias } from '../lib/manutencao';
import { interpretar, resumir } from '../lib/buscaDono';
import { dataBr, hojeIso } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { somarMeses } from '../lib/movimentacao';
import {
  alertas as montarAlertas,
  candidatasVenda,
  contratos as montarContratos,
  dias,
  LIMITE_CONCENTRACAO,
  LIMITE_GASTO,
  mesCurto,
  mudancasDaSemana,
  operacao as montarOperacao,
  paradas as montarParadas,
  ponteDoMes,
  receitaAtual,
  receitaPorCliente,
  rentabilidade as montarRentabilidade,
  serieReceita,
  type Alerta,
  type Gasto,
  type PontoReceita,
} from '../lib/dono';
import { Chip } from '../components/ui';
import { chaveEnvio } from '../lib/avisos';
import { IcAlerta, IcBusca, IcCasa, IcDinheiro, IcEmpilhadeira, IcPrancheta, IcSair } from '../components/Icones';

type Aba = 'hoje' | 'receita' | 'frota' | 'operacao' | 'buscar';
type Ir = (a: Aba, extra?: Record<string, string>) => void;

const reais = (c: number) => formatarReais(Math.round(c / 100) * 100).replace(/,00$/, '');
/** R$ 12,3 mil — para números grandes caberem no celular */
const curto = (c: number) => {
  const r = Math.abs(c) / 100;
  const s = c < 0 ? '−' : '';
  if (r >= 1_000_000) return `${s}R$ ${(r / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (r >= 10_000) return `${s}R$ ${Math.round(r / 1000)} mil`;
  if (r >= 1000) return `${s}R$ ${(r / 1000).toFixed(1).replace('.', ',')} mil`;
  return `${s}R$ ${Math.round(r)}`;
};
const sinal = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${reais(Math.abs(c))}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** App do dono: o essencial do negócio no celular. Só leitura. */
export function AppDono() {
  const { usuario, sair, clientes, oficina, envios, config, veValores, pode, movimentacoes, avisosOk } = useEstado();
  const [params, setParams] = useSearchParams();
  const pedida = (params.get('aba') as Aba) || 'hoje';
  const aba: Aba = pedida === 'receita' && !veValores ? 'hoje' : pedida;
  const irPara: Ir = (a, extra = {}) => {
    setParams({ aba: a, ...extra });
    window.scrollTo(0, 0);
  };
  const [fichas, setFichas] = useState<Equipamento[]>([]);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [fotos, setFotos] = useState<FotoMensal[]>([]);
  const [ordens, setOrdens] = useState<Ordem[]>([]);
  const [externos, setExternos] = useState<ServicoExterno[]>([]);
  const hoje = hojeIso();

  useEffect(() => {
    api.listarEquipamentos().then(setFichas, () => undefined);
    if (pode('manutencao')) api.listarPendencias().then(setPendencias, () => undefined);
    api.gastosPorFrota(somarDias(hoje, -365)).then(setGastos, () => undefined);
    api.fotosMensais().then(setFotos, () => undefined);
    if (pode('ordens')) api.listarOrdens().then(setOrdens, () => undefined);
    if (pode('externos')) api.listarExternos().then(setExternos, () => undefined);
  }, [pode, hoje]);

  const linhas = useMemo(() => montarEquipamentos(fichas, clientes, oficina), [fichas, clientes, oficina]);
  const painel = useMemo(() => montarPainel(linhas, regrasDe(config), pendencias), [linhas, config, pendencias]);
  const semVisita = useMemo(
    () =>
      painel
        .filter((p) => p.diasDesdeVisita !== null && p.diasDesdeVisita > p.intervaloDias + 30)
        .map((p) => ({ frota: p.frota, dias: p.diasDesdeVisita!, cliente: p.linha.cliente?.nome ?? 'sem cliente', intervalo: p.intervaloDias })),
    [painel],
  );
  const lista = useMemo(
    // e-mail devolvido que alguém já resolveu (deu "ok") não pede mais atenção
    () => montarAlertas({ linhas, movs: movimentacoes, gastos, pendencias, envios: envios.filter((e) => !avisosOk.has(chaveEnvio(e))), ordens, externos, semVisita, hoje, reais, veValores }),
    [linhas, movimentacoes, gastos, pendencias, envios, avisosOk, ordens, externos, semVisita, hoje, veValores],
  );
  const serie = useMemo(() => serieReceita(fotos, movimentacoes, receitaAtual(linhas), hoje), [fotos, movimentacoes, linhas, hoje]);
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';
  const carregando = !fichas.length && !clientes.length;

  const abas: { id: Aba; rotulo: string; icone: ReactNode }[] = [
    { id: 'hoje', rotulo: 'Hoje', icone: <IcCasa tamanho={20} /> },
    ...(veValores ? [{ id: 'receita' as const, rotulo: 'Receita', icone: <IcDinheiro tamanho={20} /> }] : []),
    { id: 'frota', rotulo: 'Frota', icone: <IcEmpilhadeira tamanho={20} /> },
    { id: 'operacao', rotulo: 'Operação', icone: <IcPrancheta tamanho={20} /> },
    { id: 'buscar', rotulo: 'Buscar', icone: <IcBusca tamanho={20} /> },
  ];

  return (
    <div className="min-h-screen bg-canvas pb-[84px]">
      <header className="sticky top-0 z-20 bg-noite px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img src="./logo-icone.png" alt="" width={32} height={32} className="h-8 w-8" />
            <div className="leading-tight">
              <div className="text-[15px] font-bold">Lucminas</div>
              <div className="text-xs text-white/65">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {pode('inicio') && pode('frotas') && (
              <Link to="/inicio" className="btn btn-sm text-white/75 hover:bg-white/10">
                Sistema
              </Link>
            )}
            <button type="button" onClick={sair} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Sair">
              <IcSair tamanho={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-4">
        {carregando && aba !== 'buscar' ? (
          <p className="py-10 text-center text-ink-3">Carregando…</p>
        ) : (
          <>
            {aba === 'hoje' && <Hoje nome={nome} linhas={linhas} serie={serie} alertas={lista} veValores={veValores} hoje={hoje} ir={irPara} />}
            {aba === 'receita' && veValores && <Receita linhas={linhas} serie={serie} hoje={hoje} ir={irPara} />}
            {aba === 'frota' && <Frota linhas={linhas} gastos={gastos} veValores={veValores} hoje={hoje} ir={irPara} />}
            {aba === 'operacao' && (
              <Operacao ordens={ordens} externos={externos} painel={painel} pendencias={pendencias} semVisita={semVisita.length} veValores={veValores} hoje={hoje} ir={irPara} vePendencias={pode('manutencao')} />
            )}
            {aba === 'buscar' && <Buscar inicial={params.get('q') ?? ''} linhas={linhas} veValores={veValores} />}
          </>
        )}
      </main>

      <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[640px]">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => irPara(a.id)}
              aria-current={aba === a.id ? 'page' : undefined}
              className={`flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold ${aba === a.id ? 'text-ink' : 'text-ink-3'}`}
            >
              <span className={`flex h-8 w-12 items-center justify-center rounded-full ${aba === a.id ? 'bg-brand' : ''}`}>{a.icone}</span>
              {a.rotulo}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ peças de tela

function Cartao({ titulo, children, onClick, acao }: { titulo?: string; children: ReactNode; onClick?: () => void; acao?: ReactNode }) {
  const C = onClick ? 'button' : 'section';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} className="flex w-full flex-col gap-3 rounded-2xl border border-line bg-white p-4 text-left">
      {(titulo || acao) && (
        <div className="flex items-center justify-between gap-2">
          {titulo && <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">{titulo}</h2>}
          {acao}
        </div>
      )}
      {children}
    </C>
  );
}

function Grande({ n, rotulo, tom = 'text-ink' }: { n: ReactNode; rotulo: ReactNode; tom?: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-[26px] font-bold leading-none ${tom}`}>{n}</div>
      <div className="mt-1 text-[12.5px] leading-snug text-ink-3">{rotulo}</div>
    </div>
  );
}

function Titulo({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[24px] font-bold leading-tight">{children}</h1>
      {sub && <p className="mt-1 text-[13px] text-ink-3">{sub}</p>}
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-ink-3">{children}</p>;
}

/** Barra de participação (0–1). */
function Barra({ parte, cor = 'bg-ink-2' }: { parte: number; cor?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line-soft">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.max(2, Math.min(100, parte * 100))}%` }} />
    </div>
  );
}

function VerMais({ total, mostrando, mais }: { total: number; mostrando: number; mais: () => void }) {
  if (total <= mostrando) return null;
  return (
    <button type="button" className="btn-secondary w-full" onClick={mais}>
      Ver mais ({total - mostrando})
    </button>
  );
}

function Linha({ esq, sub, dir, tom, onClick }: { esq: ReactNode; sub?: ReactNode; dir?: ReactNode; tom?: string; onClick?: () => void }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[14px]">
      <span className="min-w-0">
        <span className="block truncate font-semibold">{esq}</span>
        {sub && <span className="block text-[12.5px] text-ink-3">{sub}</span>}
      </span>
      {dir !== undefined && <b className={`shrink-0 ${tom ?? ''}`}>{dir}</b>}
    </C>
  );
}

function ListaAlertas({ itens, ir, limite }: { itens: Alerta[]; ir: Ir; limite?: number }) {
  const [n, setN] = useState(limite ?? itens.length);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {itens.slice(0, n).map((a) => (
          <li key={a.chave}>
            <button
              type="button"
              onClick={() => (a.frota ? ir('buscar', { q: `frota ${a.frota}` }) : a.ir && ir(a.ir))}
              className={`flex w-full gap-2.5 rounded-2xl border bg-white px-4 py-3 text-left ${a.tom === 'bad' ? 'border-bad/30' : 'border-warn-line'}`}
            >
              <span className={`mt-0.5 shrink-0 ${a.tom === 'bad' ? 'text-bad' : 'text-warn'}`}>
                <IcAlerta tamanho={16} />
              </span>
              <span className="min-w-0">
                <span className={`block text-[15px] font-bold leading-snug ${a.tom === 'bad' ? 'text-bad' : 'text-warn'}`}>{a.titulo}</span>
                <span className="block text-[13px] text-ink-2">{a.detalhe}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <VerMais total={itens.length} mostrando={n} mais={() => setN(itens.length)} />
    </>
  );
}

/** Barras da receita mês a mês. Um toque numa barra mostra o valor dela. */
function GraficoReceita({ serie }: { serie: PontoReceita[] }) {
  const validos = serie.filter((p) => p.receita !== null);
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...validos.map((p) => p.receita!));
  const escolhido = serie.find((p) => p.mes === sel) ?? serie[serie.length - 1];
  const temEstimado = serie.some((p) => p.estimado);
  const ultimo = serie[serie.length - 1].mes;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-ink-3">
          {mesCurto(escolhido.mes)}
          {escolhido.mes === ultimo ? ' (agora)' : ''}
          {escolhido.estimado ? ' · estimado' : ''}
        </span>
        <b className="text-[16px]">{escolhido.receita === null ? 'sem dado' : reais(escolhido.receita)}</b>
      </div>
      <svg viewBox={`0 0 ${serie.length * 30} 120`} className="h-[150px] w-full" role="img" aria-label="Receita de locação nos últimos meses">
        <defs>
          <pattern id="estimado" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#E5E3DC" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#5E5E5E" strokeWidth="2" />
          </pattern>
        </defs>
        <line x1="0" y1="100" x2={serie.length * 30} y2="100" stroke="#CCC9BF" strokeWidth="1" />
        {serie.map((p, i) => {
          const h = p.receita === null ? 0 : Math.max(2, (p.receita / max) * 92);
          const x = i * 30 + 5;
          const atual = p.mes === ultimo;
          const marcado = p.mes === escolhido.mes;
          return (
            <g key={p.mes} onClick={() => setSel(p.mes)} className="cursor-pointer">
              <title>{`${mesCurto(p.mes)}: ${p.receita === null ? 'sem dado' : reais(p.receita)}${p.estimado ? ' (estimado)' : ''}`}</title>
              <rect x={i * 30} y="0" width="30" height="120" fill="transparent" />
              {p.receita !== null && (
                <path
                  d={`M${x},100 V${100 - h + 3} q0,-3 3,-3 h14 q3,0 3,3 V100 Z`}
                  fill={p.estimado ? 'url(#estimado)' : atual ? '#E6AE00' : '#3D3D3D'}
                  opacity={marcado || !sel ? 1 : 0.55}
                />
              )}
              {p.receita === null && <line x1={x + 4} y1="98" x2={x + 16} y2="98" stroke="#CCC9BF" strokeWidth="2" strokeLinecap="round" />}
              <text x={x + 10} y="114" textAnchor="middle" fontSize="8" fill={marcado ? '#141414' : '#5E5E5E'} fontWeight={marcado ? 700 : 400}>
                {mesCurto(p.mes).slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink-2" /> fechado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-dark" /> mês atual
        </span>
        {temEstimado && (
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <rect width="10" height="10" rx="2" fill="url(#estimado)" />
            </svg>
            estimado pelas movimentações
          </span>
        )}
        {serie.some((p) => p.receita === null) && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-2.5 rounded bg-line-strong" /> sem registro
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Hoje

function Hoje({ nome, linhas, serie, alertas, veValores, hoje, ir }: { nome: string; linhas: LinhaEquipamento[]; serie: PontoReceita[]; alertas: Alerta[]; veValores: boolean; hoje: string; ir: Ir }) {
  const { movimentacoes } = useEstado();
  const frota = linhas.filter((l) => l.situacao !== 'baixada');
  const locadas = frota.filter((l) => l.situacao === 'locada').length;
  const naOficina = frota.filter((l) => l.situacao === 'oficina').length;
  const paradas = frota.filter((l) => l.situacao === 'disponivel' || l.situacao === 'reservada').length;
  const ocupacao = frota.length ? locadas / frota.length : 0;
  const atual = serie[serie.length - 1].receita ?? 0;
  const anterior = serie[serie.length - 2];
  const delta = anterior?.receita != null ? atual - anterior.receita : null;
  const comCliente = linhas.filter((l) => l.locacao).length;
  const media = comCliente ? atual / comCliente : 0;
  const semana = mudancasDaSemana(movimentacoes, hoje);
  const hora = new Date().getHours();
  const graves = alertas.filter((a) => a.tom === 'bad').length;

  return (
    <>
      <Titulo>
        {hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}
        {nome ? `, ${nome}` : ''}!
      </Titulo>

      {veValores && (
        <Cartao titulo="Receita de locação por mês" onClick={() => ir('receita')}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="text-[34px] font-bold leading-none">{reais(atual)}</div>
            {delta !== null && (
              <span className={`text-[14px] font-semibold ${delta > 0 ? 'text-ok' : delta < 0 ? 'text-bad' : 'text-ink-3'}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {sinal(delta)}
                {anterior.receita ? ` (${delta >= 0 ? '+' : '−'}${pct(Math.abs(delta) / anterior.receita)})` : ''} desde {mesCurto(anterior.mes)}
              </span>
            )}
          </div>
          <p className="text-[13px] text-ink-3">Soma do que os clientes pagam hoje de locação. Toque para ver a evolução e os contratos.</p>
        </Cartao>
      )}

      <Cartao titulo="Frota" onClick={() => ir('frota')}>
        <div className="grid grid-cols-3 gap-3">
          <Grande n={locadas} rotulo="locadas" tom="text-ok" />
          <Grande n={naOficina} rotulo="na oficina" tom={naOficina ? 'text-warn' : 'text-ink'} />
          <Grande n={paradas} rotulo="sem cliente" tom={paradas ? 'text-warn' : 'text-ink'} />
        </div>
        <div>
          <Barra parte={ocupacao} cor="bg-ok" />
          <p className="mt-1.5 text-[13px] text-ink-2">
            <b>{pct(ocupacao)}</b> da frota alugada ({locadas} de {frota.length} máquinas)
          </p>
        </div>
        {veValores && paradas > 0 && media > 0 && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn-strong">
            {plural(paradas, 'máquina parada deixa', 'máquinas paradas deixam')} de faturar cerca de <b>{reais(paradas * media)}/mês</b> (pelo valor médio de locação).
          </p>
        )}
      </Cartao>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Pede sua atenção</h2>
          {alertas.length > 0 && <span className="text-[12.5px] text-ink-3">{graves ? `${graves} urgente${graves > 1 ? 's' : ''} · ` : ''}{alertas.length} no total</span>}
        </div>
        {alertas.length === 0 ? (
          <Cartao>
            <p className="text-[15px]">Nada pedindo atenção agora.</p>
          </Cartao>
        ) : (
          <ListaAlertas itens={alertas} ir={ir} limite={5} />
        )}
      </section>

      <Cartao titulo="O que mudou nos últimos 7 dias">
        {semana.length === 0 ? (
          <Vazio>Nenhuma movimentação registrada na semana.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {semana.slice(0, 8).map(({ m, efeito, titulo }) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{titulo}</span>
                  <span className="block text-[12.5px] text-ink-3">
                    {dataBr(m.dados.data)}
                    {m.status === 'pendente' && ' · aguardando aprovação'}
                    {m.tipo === 'venda' && ' · valor da venda'}
                    {m.tipo === 'compra' && ' · valor da compra'}
                  </span>
                </span>
                {veValores && efeito !== null && efeito !== 0 && (
                  <b className={`shrink-0 ${m.tipo === 'compra' || m.tipo === 'venda' ? 'text-ink-2' : efeito > 0 ? 'text-ok' : 'text-bad'}`}>
                    {m.tipo === 'compra' || m.tipo === 'venda' ? reais(Math.abs(efeito)) : `${sinal(efeito)}/mês`}
                  </b>
                )}
              </li>
            ))}
          </ul>
        )}
        {semana.length > 8 && <p className="text-[12.5px] text-ink-3">e mais {semana.length - 8}</p>}
      </Cartao>

      <Cartao titulo="Pergunte ao sistema" onClick={() => ir('buscar')}>
        <div className="flex items-center gap-2 rounded-xl border border-line-strong px-3 py-3 text-ink-3">
          <IcBusca tamanho={18} /> Ex.: motor de partida frota 40
        </div>
      </Cartao>
    </>
  );
}

// ------------------------------------------------------------------ Receita

function Receita({ linhas, serie, hoje, ir }: { linhas: LinhaEquipamento[]; serie: PontoReceita[]; hoje: string; ir: Ir }) {
  const { movimentacoes } = useEstado();
  const [mesPonte, setMesPonte] = useState(hoje.slice(0, 7));
  const [abertaFaixa, setAbertaFaixa] = useState<number | null>(null);
  const [nCli, setNCli] = useState(8);
  const [nReaj, setNReaj] = useState(5);
  const ponte = ponteDoMes(movimentacoes, mesPonte);
  const cli = receitaPorCliente(linhas);
  const ct = montarContratos(linhas, movimentacoes, hoje);
  const ano = hoje.slice(0, 4);
  const doAno = movimentacoes.filter((m) => m.status === 'aprovada' && m.dados.data.startsWith(ano) && (m.tipo === 'compra' || m.tipo === 'venda'));
  const compras = doAno.filter((m) => m.tipo === 'compra');
  const vendas = doAno.filter((m) => m.tipo === 'venda');
  const valores = serie.filter((p) => p.receita !== null);
  const primeiro = valores[0];
  const atual = serie[serie.length - 1].receita ?? 0;
  const mesAnterior = somarMeses(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);
  const totalModalidade = ct.modalidade.contrato + ct.modalidade.esporadico + ct.modalidade.sem;

  return (
    <>
      <Titulo sub="Locação: o que os clientes pagam por mês, como mudou e o que está em risco.">Receita</Titulo>

      <Cartao titulo="Mês a mês">
        <GraficoReceita serie={serie} />
        {primeiro && primeiro.mes !== serie[serie.length - 1].mes && primeiro.receita ? (
          <p className="border-t border-line-soft pt-3 text-[13px] text-ink-2">
            Desde {mesCurto(primeiro.mes)}: <b className={atual >= primeiro.receita ? 'text-ok' : 'text-bad'}>{sinal(atual - primeiro.receita)}/mês</b> (
            {atual >= primeiro.receita ? '+' : '−'}
            {pct(Math.abs(atual - primeiro.receita) / primeiro.receita)}).
          </p>
        ) : null}
        <p className="text-[12px] text-ink-3">O sistema guarda uma foto da receita todo mês a partir de agora. Os meses antes disso são estimados pelas movimentações registradas.</p>
      </Cartao>

      <Cartao
        titulo="O que mudou no mês"
        acao={
          <span className="flex gap-1">
            {[mesAnterior, hoje.slice(0, 7)].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMesPonte(m)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${mesPonte === m ? 'bg-ink text-white' : 'bg-line-soft text-ink-2'}`}
              >
                {mesCurto(m)}
              </button>
            ))}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Grande n={ponte.entrou ? `+${curto(ponte.entrou)}` : 'R$ 0'} rotulo={`entrou · ${plural(ponte.locacoes, 'locação nova', 'locações novas')}`} tom={ponte.entrou ? 'text-ok' : 'text-ink'} />
          <Grande n={ponte.saiu ? `−${curto(ponte.saiu)}` : 'R$ 0'} rotulo={`saiu · ${plural(ponte.devolucoes, 'devolução', 'devoluções')}${ponte.vendas.n ? ` e vendas` : ''}`} tom={ponte.saiu ? 'text-bad' : 'text-ink'} />
          <Grande n={ponte.reajustes ? sinal(ponte.reajustes).replace(/,\d\d$/, '') : 'R$ 0'} rotulo="reajustes" tom={ponte.reajustes > 0 ? 'text-ok' : 'text-ink'} />
          <Grande n={sinal(ponte.liquido).replace(/,\d\d$/, '') || 'R$ 0'} rotulo="resultado na receita mensal" tom={ponte.liquido > 0 ? 'text-ok' : ponte.liquido < 0 ? 'text-bad' : 'text-ink'} />
        </div>
        {ponte.itens.length === 0 && <Vazio>Nenhuma movimentação aprovada em {mesCurto(mesPonte)}.</Vazio>}
        <p className="text-[12px] text-ink-3">Pelas movimentações aprovadas (data da movimentação). Alterações feitas direto no cadastro do cliente não entram aqui.</p>
      </Cartao>

      <Cartao titulo={`Clientes · ${cli.lista.length}`}>
        <div className="grid grid-cols-2 gap-3">
          <Grande n={pct(cli.top5)} rotulo="da receita nos 5 maiores" tom={cli.top5 > 0.6 ? 'text-warn' : 'text-ink'} />
          <Grande n={cli.lista.length ? curto(cli.total / cli.lista.length) : '—'} rotulo="média por cliente/mês" />
        </div>
        {cli.maior && cli.maior.parte > LIMITE_CONCENTRACAO && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn-strong">
            <b>{cli.maior.nome}</b> sozinho é {pct(cli.maior.parte)} da receita. Vale cuidar de perto dessa conta e buscar diluir esse risco.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-line-soft">
          {cli.lista.slice(0, nCli).map((c) => (
            <li key={c.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-baseline justify-between gap-2 text-[14px]">
                <span className="min-w-0 truncate font-semibold">{c.nome}</span>
                <b className="shrink-0">{reais(c.total)}</b>
              </div>
              <Barra parte={c.parte / (cli.lista[0]?.parte || 1)} />
              <span className="text-[12px] text-ink-3">
                {plural(c.frotas, 'máquina', 'máquinas')} · {pct(c.parte)} da receita
              </span>
            </li>
          ))}
        </ul>
        <VerMais total={cli.lista.length} mostrando={nCli} mais={() => setNCli(cli.lista.length)} />
      </Cartao>

      <Cartao titulo="Contratos: receita em risco">
        <div className="grid grid-cols-2 gap-2">
          {ct.faixas.map((f, i) => (
            <button
              key={f.rotulo}
              type="button"
              onClick={() => setAbertaFaixa(abertaFaixa === i ? null : i)}
              aria-expanded={abertaFaixa === i}
              className={`rounded-xl border px-3 py-2.5 text-left ${abertaFaixa === i ? 'border-ink' : 'border-line'} ${i === 0 && f.maquinas.length ? 'bg-bad-soft' : ''}`}
            >
              <div className={`text-[12px] font-semibold ${i === 0 && f.maquinas.length ? 'text-bad' : 'text-ink-3'}`}>{f.rotulo}</div>
              <div className="text-[18px] font-bold">{f.maquinas.length ? curto(f.receita) : '—'}</div>
              <div className="text-[12px] text-ink-3">{plural(f.maquinas.length, 'máquina', 'máquinas')}</div>
            </button>
          ))}
        </div>
        {abertaFaixa !== null && (
          <ul className="flex flex-col divide-y divide-line-soft">
            {ct.faixas[abertaFaixa].maquinas.map((l) => (
              <li key={l.frota}>
                <Linha
                  esq={`FT${l.frota} · ${l.cliente?.nome ?? ''}`}
                  sub={`vence ${dataBr(l.ficha!.contratoVencimento!)}${l.locacao?.modalidade === 'esporadico' ? ' · esporádico' : ''}`}
                  dir={reais(l.locacao?.valor ?? 0)}
                  onClick={() => ir('buscar', { q: `frota ${l.frota}` })}
                />
              </li>
            ))}
            {!ct.faixas[abertaFaixa].maquinas.length && <Vazio>Nenhum contrato nessa faixa.</Vazio>}
          </ul>
        )}
        {ct.semVencimento > 0 && (
          <p className="text-[12.5px] text-ink-3">
            {plural(ct.semVencimento, 'máquina locada está', 'máquinas locadas estão')} sem data de vencimento do contrato na ficha, então não entram nessa conta.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Oportunidade: sem reajuste há mais de 1 ano">
        {ct.semReajuste.length === 0 ? (
          <Vazio>Nenhuma locação com mais de 12 meses sem reajuste{ct.semData ? ' (entre as que têm data de início)' : ''}.</Vazio>
        ) : (
          <>
            <Grande
              n={reais(ct.semReajuste.reduce((s, x) => s + (x.l.locacao?.valor ?? 0), 0))}
              rotulo={`por mês em ${plural(ct.semReajuste.length, 'locação', 'locações')} sem reajuste há mais de 12 meses`}
              tom="text-warn"
            />
            <ul className="flex flex-col divide-y divide-line-soft">
              {ct.semReajuste.slice(0, nReaj).map((x) => (
                <li key={x.l.frota}>
                  <Linha esq={`FT${x.l.frota} · ${x.l.cliente?.nome ?? ''}`} sub={`${x.meses} meses sem reajuste · desde ${dataBr(x.desde)}`} dir={reais(x.l.locacao?.valor ?? 0)} onClick={() => ir('buscar', { q: `frota ${x.l.frota}` })} />
                </li>
              ))}
            </ul>
            <VerMais total={ct.semReajuste.length} mostrando={nReaj} mais={() => setNReaj(ct.semReajuste.length)} />
          </>
        )}
        {ct.semData > 0 && <p className="text-[12.5px] text-ink-3">{plural(ct.semData, 'locação não tem', 'locações não têm')} data de início nem reajuste registrado; preencha na Relação das locações para entrar aqui.</p>}
      </Cartao>

      <Cartao titulo="Contrato × esporádico">
        {totalModalidade > 0 && (
          <div className="flex h-3 overflow-hidden rounded-full bg-line-soft" aria-hidden>
            <div className="h-full bg-ok" style={{ width: `${(ct.modalidade.contrato / totalModalidade) * 100}%` }} />
            <div className="h-full border-l-2 border-white bg-info" style={{ width: `${(ct.modalidade.esporadico / totalModalidade) * 100}%` }} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <div className="flex items-center gap-1.5 text-ink-3">
              <span className="h-2.5 w-2.5 rounded-sm bg-ok" /> Contrato
            </div>
            <b className="text-[16px]">{curto(ct.modalidade.contrato)}</b>
            <div className="text-ink-3">{plural(ct.modalidade.nContrato, 'máquina', 'máquinas')}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-ink-3">
              <span className="h-2.5 w-2.5 rounded-sm bg-info" /> Esporádico
            </div>
            <b className="text-[16px]">{curto(ct.modalidade.esporadico)}</b>
            <div className="text-ink-3">{plural(ct.modalidade.nEsporadico, 'máquina', 'máquinas')}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-ink-3">
              <span className="h-2.5 w-2.5 rounded-sm bg-line-strong" /> Não informado
            </div>
            <b className="text-[16px]">{curto(ct.modalidade.sem)}</b>
            <div className="text-ink-3">{plural(ct.modalidade.nSem, 'máquina', 'máquinas')}</div>
          </div>
        </div>
        <p className="text-[12px] text-ink-3">Receita de contrato é a mais previsível; esporádico pode sair a qualquer hora.</p>
      </Cartao>

      <Cartao titulo={`Compra e venda de máquinas em ${ano}`}>
        <div className="grid grid-cols-2 gap-3">
          <Grande n={compras.length ? curto(compras.reduce((s, m) => s + (m.dados.valor ?? 0), 0)) : '—'} rotulo={`investido · ${plural(compras.length, 'compra', 'compras')}`} />
          <Grande n={vendas.length ? curto(vendas.reduce((s, m) => s + (m.dados.valor ?? 0), 0)) : '—'} rotulo={`recebido · ${plural(vendas.length, 'venda', 'vendas')}`} />
        </div>
        {doAno.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-soft">
            {doAno.map((m) => (
              <li key={m.id}>
                <Linha esq={`${m.tipo === 'compra' ? 'Compra' : 'Venda'} · FT${m.frota}`} sub={`${dataBr(m.dados.data)}${m.clienteNome ? ` · ${m.clienteNome}` : ''}`} dir={m.dados.valor ? reais(m.dados.valor) : '—'} />
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </>
  );
}

// ------------------------------------------------------------------ Frota

function Frota({ linhas, gastos, veValores, hoje, ir }: { linhas: LinhaEquipamento[]; gastos: Gasto[]; veValores: boolean; hoje: string; ir: Ir }) {
  const { movimentacoes } = useEstado();
  const [nParadas, setNParadas] = useState(6);
  const [nRank, setNRank] = useState(8);
  const frota = linhas.filter((l) => l.situacao !== 'baixada');
  const conta = (s: string) => frota.filter((l) => l.situacao === s).length;
  const paradas = montarParadas(linhas, movimentacoes, hoje);
  const comCliente = linhas.filter((l) => l.locacao);
  const media = comCliente.length ? receitaAtual(linhas) / comCliente.length : 0;
  const oficina = linhas.filter((l) => l.oficina).sort((a, b) => a.oficina!.desde.localeCompare(b.oficina!.desde));
  const mediaOficina = oficina.length ? Math.round(oficina.reduce((s, l) => s + dias(l.oficina!.desde, hoje), 0) / oficina.length) : 0;
  const rent = montarRentabilidade(linhas, gastos, hoje);
  const candidatas = candidatasVenda(rent);
  const ranking = rent.filter((r) => r.receitaAno > 0).sort((a, b) => (a.peso ?? 0) - (b.peso ?? 0));
  const gastoTotal = gastos.reduce((s, g) => s + g.total, 0);
  const receitaAno = rent.reduce((s, r) => s + r.receitaAno, 0);

  return (
    <>
      <Titulo sub="Onde o dinheiro está parado e quais máquinas dão retorno.">Frota</Titulo>

      <Cartao titulo={`${frota.length} máquinas`}>
        <div className="grid grid-cols-4 gap-2">
          <Grande n={conta('locada')} rotulo="locadas" tom="text-ok" />
          <Grande n={conta('oficina')} rotulo="oficina" tom={conta('oficina') ? 'text-warn' : 'text-ink'} />
          <Grande n={conta('disponivel')} rotulo="disponíveis" />
          <Grande n={conta('reservada')} rotulo="reservadas" />
        </div>
        <Barra parte={frota.length ? conta('locada') / frota.length : 0} cor="bg-ok" />
      </Cartao>

      <Cartao titulo={`Sem cliente · ${paradas.length}`}>
        {veValores && paradas.length > 0 && media > 0 && (
          <Grande n={`${reais(paradas.length * media)}/mês`} rotulo="que deixa de entrar (pelo valor médio de locação)" tom="text-warn" />
        )}
        {paradas.length === 0 ? (
          <Vazio>Todas as máquinas estão com cliente ou na oficina.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {paradas.slice(0, nParadas).map((p) => (
              <li key={p.l.frota}>
                <Linha
                  esq={`FT${p.l.frota} ${nomeEquipamento(p.l)}`}
                  sub={p.desde ? `parada desde ${dataBr(p.desde)}` : 'sem registro de quando saiu do último cliente'}
                  dir={p.dias !== null ? `${p.dias} dias` : '—'}
                  tom={p.dias !== null && p.dias > 90 ? 'text-bad' : p.dias !== null && p.dias > 30 ? 'text-warn' : ''}
                  onClick={() => ir('buscar', { q: `frota ${p.l.frota}` })}
                />
              </li>
            ))}
          </ul>
        )}
        <VerMais total={paradas.length} mostrando={nParadas} mais={() => setNParadas(paradas.length)} />
      </Cartao>

      <Cartao titulo={`Na oficina · ${oficina.length}`}>
        {oficina.length === 0 ? (
          <Vazio>Nenhuma máquina na oficina.</Vazio>
        ) : (
          <>
            <p className="text-[13px] text-ink-2">
              Em média há <b>{mediaOficina} dias</b> na oficina.
            </p>
            <ul className="flex flex-col divide-y divide-line-soft">
              {oficina.map((l) => {
                const d = dias(l.oficina!.desde, hoje);
                return (
                  <li key={l.frota}>
                    <Linha
                      esq={`FT${l.frota} ${nomeEquipamento(l)}`}
                      sub={[l.oficina!.observacao, l.cliente ? `cliente ${l.cliente.nome}` : null].filter(Boolean).join(' · ') || 'sem observação'}
                      dir={`${d} dias`}
                      tom={d > 30 ? 'text-bad' : d > 15 ? 'text-warn' : ''}
                      onClick={() => ir('buscar', { q: `frota ${l.frota}` })}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Cartao>

      <Cartao titulo={`Vale pensar em vender · ${candidatas.length}`}>
        <p className="text-[13px] text-ink-3">
          Máquinas em que o gasto com peças e serviços dos últimos 12 meses passou de {pct(LIMITE_GASTO)} do que ela fatura no ano, ou que deram gasto sem estar faturando. Idade e horímetro aparecem como reforço.
        </p>
        {candidatas.length === 0 ? (
          <Vazio>Nenhuma máquina nessa situação.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {candidatas.map((r) => (
              <li key={r.l.frota}>
                <Linha
                  esq={`FT${r.l.frota} ${nomeEquipamento(r.l)}`}
                  sub={`${r.motivos.join(' · ')}${r.l.cliente ? ` · ${r.l.cliente.nome}` : ''}`}
                  dir={veValores ? `${reais(r.gasto)}` : undefined}
                  tom="text-bad"
                  onClick={() => ir('buscar', { q: `frota ${r.l.frota}` })}
                />
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="Retorno por máquina (12 meses)">
        {veValores && receitaAno > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Grande n={curto(receitaAno)} rotulo="locação no ano (valor de hoje × 12)" />
            <Grande n={curto(gastoTotal)} rotulo={`gasto com peças e serviços (${pct(gastoTotal / receitaAno)})`} tom={gastoTotal / receitaAno > 0.2 ? 'text-warn' : 'text-ink'} />
          </div>
        )}
        <p className="text-[13px] text-ink-3">Das locadas, da que menos gasta para a que mais gasta em relação ao que fatura.</p>
        <ul className="flex flex-col divide-y divide-line-soft">
          {ranking.slice(0, nRank).map((r) => (
            <li key={r.l.frota}>
              <Linha
                esq={`FT${r.l.frota} ${nomeEquipamento(r.l)}`}
                sub={veValores ? `fatura ${curto(r.receitaAno)}/ano · gastou ${curto(r.gasto)}` : (r.l.cliente?.nome ?? '')}
                dir={`${pct(r.peso ?? 0)} de gasto`}
                tom={(r.peso ?? 0) > LIMITE_GASTO ? 'text-bad' : (r.peso ?? 0) > 0.15 ? 'text-warn' : 'text-ok'}
                onClick={() => ir('buscar', { q: `frota ${r.l.frota}` })}
              />
            </li>
          ))}
        </ul>
        <VerMais total={ranking.length} mostrando={nRank} mais={() => setNRank(ranking.length)} />
      </Cartao>
    </>
  );
}

// ------------------------------------------------------------------ Operação

function Operacao({
  ordens,
  externos,
  painel,
  pendencias,
  semVisita,
  veValores,
  hoje,
  ir,
  vePendencias,
}: {
  ordens: Ordem[];
  externos: ServicoExterno[];
  painel: ReturnType<typeof montarPainel>;
  pendencias: Pendencia[];
  semVisita: number;
  veValores: boolean;
  hoje: string;
  ir: Ir;
  vePendencias: boolean;
}) {
  const { solicitacoes, envios, pode } = useEstado();
  const op = montarOperacao(ordens, solicitacoes, externos, hoje);
  const ref = referenciaAtual();
  const doMes = envios.filter((e) => e.referencia === ref && e.status !== 'falhou');
  const devolvidos = doMes.filter((e) => e.status === 'devolvido').length;
  const lidos = doMes.filter((e) => e.lidoEm).length;
  const atrasadas = painel.filter((l) => l.status === 'atrasado').length;
  const semana = painel.filter((l) => l.status === 'atencao').length;

  return (
    <>
      <Titulo sub="Manutenção, ordens de serviço, pedidos da equipe, serviços externos e faturas.">Operação</Titulo>

      <Cartao titulo="Manutenção preventiva">
        <div className="grid grid-cols-3 gap-3">
          <Grande n={atrasadas} rotulo="atrasadas" tom={atrasadas ? 'text-bad' : 'text-ok'} />
          <Grande n={semana} rotulo="vencem esta semana" tom={semana ? 'text-warn' : 'text-ink'} />
          {vePendencias ? <Grande n={pendencias.length} rotulo="pendências abertas" /> : <Grande n={semVisita} rotulo="sem visita há muito" tom={semVisita ? 'text-bad' : 'text-ink'} />}
        </div>
      </Cartao>

      {pode('ordens') && (
        <Cartao titulo="Ordens de serviço">
          <div className="grid grid-cols-2 gap-3">
            <Grande n={op.osAbertas} rotulo="abertas" />
            <Grande n={op.osAtrasadas.length} rotulo="passaram da data" tom={op.osAtrasadas.length ? 'text-bad' : 'text-ok'} />
            <Grande n={op.osAguardandoPeca} rotulo="esperando peça" tom={op.osAguardandoPeca ? 'text-warn' : 'text-ink'} />
            <Grande n={op.osNoMes} rotulo="concluídas no mês" tom="text-ok" />
          </div>
          {op.porTecnico.length > 0 && (
            <>
              <h3 className="border-t border-line-soft pt-3 text-[12.5px] font-semibold text-ink-3">Por técnico (concluídas no mês · em aberto)</h3>
              <ul className="flex flex-col divide-y divide-line-soft">
                {op.porTecnico.map((t) => (
                  <li key={t.nome}>
                    <Linha esq={t.nome} dir={`${t.concluidas} · ${t.abertas}`} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {op.osAtrasadas.length > 0 && (
            <>
              <h3 className="border-t border-line-soft pt-3 text-[12.5px] font-semibold text-ink-3">Atrasadas</h3>
              <ul className="flex flex-col divide-y divide-line-soft">
                {op.osAtrasadas.slice(0, 6).map((o) => (
                  <li key={o.id}>
                    <Linha esq={`OS ${o.numero} · FT${o.frota}`} sub={`marcada para ${dataBr(o.agendadaPara!.slice(0, 10))} · ${o.tecnicoNome || 'sem técnico'}`} dir={`${dias(o.agendadaPara!, hoje)} dias`} tom="text-bad" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Cartao>
      )}

      <Cartao titulo={`Solicitações em aberto · ${op.solicitacoesAbertas.length}`}>
        {op.solicitacoesAbertas.length === 0 ? (
          <Vazio>Nenhuma solicitação em aberto.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {op.solicitacoesAbertas.slice(0, 6).map((s) => {
              const d = dias(s.criadaEm, hoje);
              return (
                <li key={s.id}>
                  <Linha esq={s.titulo} sub={`${s.criadaPorNome} → ${s.paraNome}${s.clienteNome ? ` · ${s.clienteNome}` : ''}`} dir={d ? `${d} dias` : 'hoje'} tom={d > 7 ? 'text-bad' : d > 2 ? 'text-warn' : ''} />
                </li>
              );
            })}
          </ul>
        )}
        {op.solicitacoesAbertas.length > 6 && <p className="text-[12.5px] text-ink-3">e mais {op.solicitacoesAbertas.length - 6}, das mais antigas para as mais novas</p>}
      </Cartao>

      {pode('externos') && (
        <Cartao titulo={`Serviços externos · ${op.externos.ativos} em andamento`}>
          <div className="grid grid-cols-3 gap-3">
            <Grande n={veValores ? curto(op.externos.aCobrar) : op.externos.aCobrarN} rotulo={`pronto e sem cobrar${veValores ? ` · ${op.externos.aCobrarN}` : ''}`} tom={op.externos.aCobrarN ? 'text-warn' : 'text-ink'} />
            <Grande n={veValores ? curto(op.externos.emAndamento) : op.externos.emAndamentoN} rotulo={`aprovado / em execução${veValores ? ` · ${op.externos.emAndamentoN}` : ''}`} />
            <Grande n={veValores ? curto(op.externos.orcamentosValor) : op.externos.orcamentosEsperando} rotulo={`orçamento esperando o cliente${veValores ? ` · ${op.externos.orcamentosEsperando}` : ''}`} />
          </div>
        </Cartao>
      )}

      <Cartao titulo={`Faturas de ${referenciaPorExtenso(ref)}`}>
        <div className="grid grid-cols-3 gap-3">
          <Grande n={doMes.length} rotulo="enviadas" />
          <Grande n={lidos} rotulo="confirmaram leitura" />
          <Grande n={devolvidos} rotulo="e-mails voltaram" tom={devolvidos ? 'text-bad' : 'text-ink'} />
        </div>
        {devolvidos > 0 && (
          <button type="button" className="text-left text-[13px] font-semibold text-info underline" onClick={() => ir('hoje')}>
            Ver os avisos
          </button>
        )}
      </Cartao>
    </>
  );
}

// ------------------------------------------------------------------ Buscar

const EXEMPLOS = ['motor de partida frota 40', 'bateria', 'frota 12', 'óleo hidráulico'];

function Buscar({ inicial, linhas, veValores }: { inicial: string; linhas: LinhaEquipamento[]; veValores: boolean }) {
  const [texto, setTexto] = useState(inicial);
  const [feita, setFeita] = useState(inicial);
  const [itens, setItens] = useState<PecaHistorico[] | null>(null);
  const [erro, setErro] = useState('');
  const [mostrar, setMostrar] = useState(30);
  const p = interpretar(feita);
  const maquina = p.frota ? (linhas.find((l) => l.frota === p.frota) ?? null) : null;

  useEffect(() => {
    if (!feita.trim()) return setItens(null);
    const q = interpretar(feita);
    if (!q.frota && !q.termos.length) return setItens(null);
    setErro('');
    setItens(null);
    setMostrar(30);
    api.buscarHistorico(q.termos.join(' '), q.frota ?? undefined).then(setItens, (e) => setErro(e instanceof Error ? e.message : 'Não foi possível buscar.'));
  }, [feita]);
  const r = itens ? resumir(itens) : null;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFeita(texto);
        }}
        className="sticky top-[64px] z-10 -mx-4 bg-canvas px-4 pb-2 pt-1"
      >
        <label className="relative block">
          <span className="sr-only">O que procurar</span>
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={18} />
          </span>
          <input
            type="search"
            enterKeyHint="search"
            autoFocus={!inicial}
            className="input h-12 w-full rounded-2xl pl-11 text-[16px]"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Peça, frota ou os dois"
          />
        </label>
      </form>

      {!feita.trim() && (
        <Cartao titulo="Experimente">
          <div className="flex flex-wrap gap-2">
            {EXEMPLOS.map((x) => (
              <button
                key={x}
                type="button"
                className="rounded-full border border-line-strong bg-white px-3.5 py-2 text-[14px]"
                onClick={() => {
                  setTexto(x);
                  setFeita(x);
                }}
              >
                {x}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-ink-3">Busca no histórico de peças e serviços (Auvo e visitas registradas no sistema).</p>
        </Cartao>
      )}

      {maquina && (
        <Cartao>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[20px] font-bold">
                FT{maquina.frota} <span className="font-semibold text-ink-2">{nomeEquipamento(maquina)}</span>
              </div>
              <div className="text-[13px] text-ink-3">
                {maquina.cliente?.nome ?? 'sem cliente'}
                {maquina.ficha?.horimetro != null && ` · ${maquina.ficha.horimetro.toLocaleString('pt-BR')} h`}
                {maquina.ficha?.tecnico && ` · ${maquina.ficha.tecnico}`}
              </div>
            </div>
            <Chip tom={SITUACOES[maquina.situacao].tom}>{SITUACOES[maquina.situacao].rotulo}</Chip>
          </div>
          {veValores && maquina.locacao?.valor ? <p className="text-[14px]">Locação: {reais(maquina.locacao.valor)} por mês</p> : null}
        </Cartao>
      )}
      {p.frota && !maquina && feita && <p className="text-[14px] text-ink-3">Não achei a frota {p.frota} no cadastro; mostrando o que houver no histórico.</p>}

      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {feita.trim() && !itens && !erro && (p.frota || p.termos.length > 0) && <p className="text-ink-3">Procurando…</p>}

      {r && itens && (
        <>
          {itens.length === 0 ? (
            <Cartao>
              <p className="text-[15px]">
                Nada encontrado para <b>{p.termos.join(' ').toLowerCase() || 'essa busca'}</b>
                {p.frota && ` na FT${p.frota}`}.
              </p>
            </Cartao>
          ) : (
            <Cartao titulo={p.termos.length ? `“${p.termos.join(' ').toLowerCase()}”${p.frota ? ` na FT${p.frota}` : ''}` : `Tudo o que foi feito na FT${p.frota}`}>
              <div className="grid grid-cols-2 gap-3">
                <Grande n={r.dias} rotulo={r.dias === 1 ? 'vez (dia de serviço)' : 'vezes (dias de serviço)'} />
                {veValores && <Grande n={reais(r.total)} rotulo="gasto no total" />}
                <Grande n={r.ultima ? dataBr(r.ultima) : '—'} rotulo="última vez" />
                {r.mediaEntre !== null && <Grande n={`${r.mediaEntre} dias`} rotulo="em média entre uma e outra" />}
              </div>
            </Cartao>
          )}
          {!p.frota && r.porFrota.length > 1 && (
            <Cartao titulo="Em quais máquinas">
              <ul className="flex flex-col divide-y divide-line-soft">
                {r.porFrota.slice(0, 8).map((f) => (
                  <li key={f.frota}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-[14px]"
                      onClick={() => {
                        const t = `${feita} frota ${f.frota}`;
                        setTexto(t);
                        setFeita(t);
                      }}
                    >
                      <span>
                        <b className="font-mono">FT{f.frota}</b>{' '}
                        <span className="text-ink-3">
                          · {f.lancamentos}x · última {dataBr(f.ultima)}
                        </span>
                      </span>
                      {veValores && <b>{reais(f.total)}</b>}
                    </button>
                  </li>
                ))}
              </ul>
              {r.porFrota.length > 8 && <p className="text-xs text-ink-3">e mais {r.porFrota.length - 8} máquinas</p>}
            </Cartao>
          )}
          {itens.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-3">Linha do tempo</h2>
              <ol className="flex flex-col gap-2">
                {itens.slice(0, mostrar).map((i) => (
                  <li key={i.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink-3">
                        {dataBr(i.data)}
                        {!p.frota && i.frota && <span className="ml-1.5 font-mono text-ink">FT{i.frota}</span>}
                      </span>
                      {veValores && i.valorTotal > 0 && <b className="text-[14px]">{reais(i.valorTotal)}</b>}
                    </div>
                    <div className="mt-0.5 text-[15px] font-semibold leading-snug">{i.descricao || i.codigo}</div>
                    <div className="mt-0.5 text-[13px] text-ink-3">
                      {[i.tecnico, i.cliente, i.horimetro ? `${i.horimetro.toLocaleString('pt-BR')} h` : null].filter(Boolean).join(' · ')}
                    </div>
                    {i.pendencia && <div className="mt-1 text-[13px] text-warn">Pendência: {i.pendencia}</div>}
                  </li>
                ))}
              </ol>
              {itens.length > mostrar && (
                <button type="button" className="btn-secondary" onClick={() => setMostrar(mostrar + 50)}>
                  Ver mais ({itens.length - mostrar})
                </button>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
