import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Equipamento, PecaHistorico, Pendencia } from '../types';
import { montarEquipamentos, nomeEquipamento, SITUACOES, type LinhaEquipamento } from '../lib/equipamentos';
import { montarPainel, regrasDe, somarDias } from '../lib/manutencao';
import { interpretar, resumir } from '../lib/buscaDono';
import { dataBr, hojeIso } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { Chip } from '../components/ui';
import { IcAlerta, IcBusca, IcCasa, IcDinheiro, IcEmpilhadeira, IcSair } from '../components/Icones';

type Aba = 'hoje' | 'buscar' | 'dinheiro' | 'gastos' | 'avisos';
type Gasto = { frota: string; total: number; lancamentos: number; visitas: number; ultima: string };

const reais = (c: number) => formatarReais(c).replace(/,00$/, '');
const diasDesde = (iso: string, hoje: string) => Math.round((Date.parse(hoje) - Date.parse(iso.slice(0, 10))) / 86_400_000);

/** App do dono: o essencial no celular, com uma busca forte. Só leitura. */
export function AppDono() {
  const { usuario, sair, clientes, oficina, envios, config, veValores, pode } = useEstado();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'hoje';
  const irPara = (a: Aba, extra: Record<string, string> = {}) => setParams({ aba: a, ...extra });
  const [fichas, setFichas] = useState<Equipamento[]>([]);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const hoje = hojeIso();

  useEffect(() => {
    api.listarEquipamentos().then(setFichas, () => undefined);
    if (pode('manutencao')) api.listarPendencias().then(setPendencias, () => undefined);
    api.gastosPorFrota(somarDias(hoje, -365)).then(setGastos, () => undefined);
  }, [pode, hoje]);

  const linhas = useMemo(() => montarEquipamentos(fichas, clientes, oficina), [fichas, clientes, oficina]);
  const painel = useMemo(() => montarPainel(linhas, regrasDe(config), pendencias), [linhas, config, pendencias]);
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';

  const abas: { id: Aba; rotulo: string; icone: ReactNode }[] = [
    { id: 'hoje', rotulo: 'Hoje', icone: <IcCasa tamanho={20} /> },
    { id: 'buscar', rotulo: 'Buscar', icone: <IcBusca tamanho={20} /> },
    ...(veValores ? [{ id: 'dinheiro' as const, rotulo: 'Dinheiro', icone: <IcDinheiro tamanho={20} /> }] : []),
    { id: 'gastos', rotulo: 'Gastos', icone: <IcEmpilhadeira tamanho={20} /> },
    { id: 'avisos', rotulo: 'Avisos', icone: <IcAlerta tamanho={20} /> },
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
        {aba === 'hoje' && <Hoje nome={nome} linhas={linhas} painel={painel} pendencias={pendencias} veValores={veValores} ir={irPara} />}
        {aba === 'buscar' && <Buscar inicial={params.get('q') ?? ''} linhas={linhas} veValores={veValores} />}
        {aba === 'dinheiro' && veValores && <Dinheiro linhas={linhas} envios={envios} hoje={hoje} />}
        {aba === 'gastos' && <Gastos gastos={gastos} linhas={linhas} veValores={veValores} ir={irPara} />}
        {aba === 'avisos' && <Avisos linhas={linhas} painel={painel} pendencias={pendencias} envios={envios} hoje={hoje} ir={irPara} />}
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

function Cartao({ titulo, children, onClick }: { titulo?: string; children: ReactNode; onClick?: () => void }) {
  const C = onClick ? 'button' : 'section';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} className="flex w-full flex-col gap-3 rounded-2xl border border-line bg-white p-4 text-left">
      {titulo && <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">{titulo}</h2>}
      {children}
    </C>
  );
}

function Grande({ n, rotulo, tom = 'text-ink' }: { n: ReactNode; rotulo: string; tom?: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-[28px] font-bold leading-none ${tom}`}>{n}</div>
      <div className="mt-1 text-[12.5px] text-ink-3">{rotulo}</div>
    </div>
  );
}

function Hoje({
  nome,
  linhas,
  painel,
  pendencias,
  veValores,
  ir,
}: {
  nome: string;
  linhas: LinhaEquipamento[];
  painel: ReturnType<typeof montarPainel>;
  pendencias: Pendencia[];
  veValores: boolean;
  ir: (a: Aba, extra?: Record<string, string>) => void;
}) {
  const frota = linhas.filter((l) => l.situacao !== 'baixada');
  const locadas = frota.filter((l) => l.situacao === 'locada').length;
  const oficina = frota.filter((l) => l.situacao === 'oficina').length;
  const disponiveis = frota.filter((l) => l.situacao === 'disponivel' || l.situacao === 'reservada').length;
  const ocupacao = frota.length ? Math.round((locadas / frota.length) * 100) : 0;
  const mensal = linhas.reduce((s, l) => s + (l.locacao?.valor ?? 0), 0);
  const atrasadas = painel.filter((l) => l.status === 'atrasado').length;
  const semana = painel.filter((l) => l.status === 'atencao').length;
  const hora = new Date().getHours();
  return (
    <>
      <h1 className="text-[24px] font-bold">
        {hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}
        {nome ? `, ${nome}` : ''}!
      </h1>
      <Cartao titulo="Frota">
        <div className="grid grid-cols-3 gap-3">
          <Grande n={locadas} rotulo="locadas" tom="text-ok" />
          <Grande n={oficina} rotulo="na oficina" tom={oficina ? 'text-warn' : 'text-ink'} />
          <Grande n={disponiveis} rotulo="paradas" />
        </div>
        <div>
          <div className="h-2.5 overflow-hidden rounded-full bg-line-soft">
            <div className="h-full rounded-full bg-ok" style={{ width: `${ocupacao}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] text-ink-2">
            <b>{ocupacao}%</b> da frota alugada ({locadas} de {frota.length} máquinas)
          </p>
        </div>
        {veValores && mensal > 0 && (
          <p className="border-t border-line-soft pt-3 text-[14px]">
            Locação por mês: <b className="text-[18px]">{reais(mensal)}</b>
          </p>
        )}
      </Cartao>
      <Cartao titulo="Manutenção" onClick={() => ir('avisos')}>
        <div className="grid grid-cols-3 gap-3">
          <Grande n={atrasadas} rotulo="atrasadas" tom={atrasadas ? 'text-bad' : 'text-ok'} />
          <Grande n={semana} rotulo="esta semana" tom={semana ? 'text-warn' : 'text-ink'} />
          <Grande n={pendencias.length} rotulo="pendências" />
        </div>
      </Cartao>
      <Cartao titulo="Pergunte ao sistema" onClick={() => ir('buscar')}>
        <div className="flex items-center gap-2 rounded-xl border border-line-strong px-3 py-3 text-ink-3">
          <IcBusca tamanho={18} /> Ex.: motor de partida frota 40
        </div>
      </Cartao>
    </>
  );
}

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

function Dinheiro({ linhas, envios, hoje }: { linhas: LinhaEquipamento[]; envios: ReturnType<typeof useEstado>['envios']; hoje: string }) {
  const ref = referenciaAtual();
  const porCliente = new Map<string, { nome: string; total: number; frotas: number }>();
  for (const l of linhas)
    if (l.cliente && l.locacao) {
      const x = porCliente.get(l.cliente.id) ?? { nome: l.cliente.nome, total: 0, frotas: 0 };
      x.total += l.locacao.valor;
      x.frotas++;
      porCliente.set(l.cliente.id, x);
    }
  const clientes = [...porCliente.values()].sort((a, b) => b.total - a.total);
  const mensal = clientes.reduce((s, c) => s + c.total, 0);
  const doMes = envios.filter((e) => e.referencia === ref && e.status !== 'falhou');
  const devolvidos = doMes.filter((e) => e.status === 'devolvido').length;
  const lidos = doMes.filter((e) => e.lidoEm).length;
  void hoje;
  return (
    <>
      <h1 className="text-[24px] font-bold">Dinheiro</h1>
      <Cartao titulo="Locação por mês">
        <Grande n={reais(mensal)} rotulo={`${clientes.length} clientes · ${clientes.reduce((s, c) => s + c.frotas, 0)} máquinas locadas`} />
      </Cartao>
      <Cartao titulo={`Faturas de ${referenciaPorExtenso(ref)}`}>
        <div className="grid grid-cols-3 gap-3">
          <Grande n={doMes.length} rotulo="enviadas" />
          <Grande n={lidos} rotulo="confirmaram leitura" />
          <Grande n={devolvidos} rotulo="e-mails voltaram" tom={devolvidos ? 'text-bad' : 'text-ink'} />
        </div>
      </Cartao>
      <Cartao titulo="Maiores clientes">
        <ul className="flex flex-col divide-y divide-line-soft">
          {clientes.slice(0, 12).map((c) => (
            <li key={c.nome} className="flex items-center justify-between gap-2 py-2.5 text-[14px]">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.nome}</span>
                <span className="text-xs text-ink-3">
                  {c.frotas} máquina{c.frotas > 1 ? 's' : ''} · {mensal ? Math.round((c.total / mensal) * 100) : 0}% da receita
                </span>
              </span>
              <b className="shrink-0">{reais(c.total)}</b>
            </li>
          ))}
        </ul>
      </Cartao>
    </>
  );
}

function Gastos({ gastos, linhas, veValores, ir }: { gastos: Gasto[]; linhas: LinhaEquipamento[]; veValores: boolean; ir: (a: Aba, extra?: Record<string, string>) => void }) {
  const porFrota = new Map(linhas.map((l) => [l.frota, l]));
  const lista = gastos.map((g) => {
    const l = porFrota.get(g.frota);
    const receitaAno = (l?.locacao?.valor ?? 0) * 12;
    return { ...g, l, receitaAno, peso: receitaAno ? g.total / receitaAno : null };
  });
  const total = gastos.reduce((s, g) => s + g.total, 0);
  return (
    <>
      <h1 className="text-[24px] font-bold">Máquinas que mais dão gasto</h1>
      <p className="-mt-2 text-[13px] text-ink-3">Peças e serviços dos últimos 12 meses{veValores ? ', comparados com o que a máquina fatura de locação no ano' : ''}.</p>
      {veValores && (
        <Cartao>
          <Grande n={reais(total)} rotulo={`gastos em ${gastos.length} máquinas em 12 meses`} />
        </Cartao>
      )}
      <ol className="flex flex-col gap-2">
        {lista.slice(0, 30).map((g, i) => (
          <li key={g.frota}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-left"
              onClick={() => ir('buscar', { q: `frota ${g.frota}` })}
            >
              <span className="w-6 shrink-0 text-[13px] font-bold text-ink-3">{i + 1}º</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">
                  FT{g.frota} <span className="font-normal text-ink-2">{g.l ? nomeEquipamento(g.l) : ''}</span>
                </span>
                <span className="block text-[12.5px] text-ink-3">
                  {g.l?.cliente?.nome ?? 'sem cliente'} · {g.visitas} visita{g.visitas > 1 ? 's' : ''} · {g.lancamentos} itens
                </span>
                {veValores && g.peso !== null && (
                  <span className={`mt-1 block text-[12.5px] font-semibold ${g.peso > 0.3 ? 'text-bad' : g.peso > 0.15 ? 'text-warn' : 'text-ok'}`}>
                    gastou {Math.round(g.peso * 100)}% do que faturou no ano
                  </span>
                )}
              </span>
              {veValores && <b className="shrink-0 text-[15px]">{reais(g.total)}</b>}
            </button>
          </li>
        ))}
        {lista.length === 0 && <p className="text-ink-3">Sem lançamentos nos últimos 12 meses.</p>}
      </ol>
    </>
  );
}

function Avisos({
  linhas,
  painel,
  pendencias,
  envios,
  hoje,
  ir,
}: {
  linhas: LinhaEquipamento[];
  painel: ReturnType<typeof montarPainel>;
  pendencias: Pendencia[];
  envios: ReturnType<typeof useEstado>['envios'];
  hoje: string;
  ir: (a: Aba, extra?: Record<string, string>) => void;
}) {
  type Aviso = { chave: string; tom: 'bad' | 'warn'; titulo: string; detalhe: string; frota?: string };
  const avisos: Aviso[] = [];
  for (const l of linhas) {
    const v = l.ficha?.contratoVencimento;
    if (l.situacao === 'locada' && v) {
      if (v < hoje)
        avisos.push({ chave: `cv${l.frota}`, tom: 'bad', titulo: `Contrato vencido · FT${l.frota}`, detalhe: `${l.cliente?.nome ?? ''} · venceu em ${dataBr(v)}`, frota: l.frota });
      else if (v <= somarDias(hoje, 30))
        avisos.push({ chave: `cv${l.frota}`, tom: 'warn', titulo: `Contrato vence logo · FT${l.frota}`, detalhe: `${l.cliente?.nome ?? ''} · ${dataBr(v)}`, frota: l.frota });
    }
    if (l.oficina && diasDesde(l.oficina.desde, hoje) > 15)
      avisos.push({
        chave: `of${l.frota}`,
        tom: 'warn',
        titulo: `Na oficina há ${diasDesde(l.oficina.desde, hoje)} dias · FT${l.frota}`,
        detalhe: l.oficina.observacao || 'sem observação',
        frota: l.frota,
      });
  }
  for (const p of painel)
    if (p.diasDesdeVisita !== null && p.diasDesdeVisita > p.intervaloDias + 30)
      avisos.push({
        chave: `vi${p.frota}`,
        tom: 'bad',
        titulo: `Sem visita há ${p.diasDesdeVisita} dias · FT${p.frota}`,
        detalhe: `${p.linha.cliente?.nome ?? 'sem cliente'} · deveria ser a cada ${p.intervaloDias}`,
        frota: p.frota,
      });
  for (const p of pendencias)
    if (diasDesde(p.abertaEm, hoje) > 30)
      avisos.push({ chave: `pe${p.id}`, tom: 'warn', titulo: `Pendência há ${diasDesde(p.abertaEm, hoje)} dias · FT${p.frota}`, detalhe: p.descricao, frota: p.frota });
  const devolvidos = envios.filter((e) => e.status === 'devolvido' && diasDesde(e.enviadoEm, hoje) <= 30);
  for (const e of devolvidos)
    avisos.push({ chave: `ev${e.id}`, tom: 'bad', titulo: `E-mail de fatura voltou · ${e.clienteNome}`, detalhe: `fatura ${e.numero} · ${e.devolucao ?? ''}` });
  avisos.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === 'bad' ? -1 : 1));

  return (
    <>
      <h1 className="text-[24px] font-bold">Avisos</h1>
      {avisos.length === 0 ? (
        <Cartao>
          <p className="text-[15px]">Nada pedindo atenção agora.</p>
        </Cartao>
      ) : (
        <ul className="flex flex-col gap-2">
          {avisos.map((a) => (
            <li key={a.chave}>
              <button
                type="button"
                disabled={!a.frota}
                onClick={() => a.frota && ir('buscar', { q: `frota ${a.frota}` })}
                className={`flex w-full flex-col rounded-2xl border bg-white px-4 py-3 text-left ${a.tom === 'bad' ? 'border-bad/30' : 'border-warn-line'}`}
              >
                <span className={`text-[15px] font-bold ${a.tom === 'bad' ? 'text-bad' : 'text-warn'}`}>{a.titulo}</span>
                <span className="text-[13px] text-ink-2">{a.detalhe}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
