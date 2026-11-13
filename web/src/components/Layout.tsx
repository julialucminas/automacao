import { useEffect, useState, type ReactNode } from 'react';
import { AvisosWidget } from './AvisosWidget';
import { ProtecaoErro } from './ProtecaoErro';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { janelaConferencia } from '../lib/calendario';
import { useEstado } from '../state';
import { emailsComProblema } from '../lib/avisos';
import { temAviso } from '../lib/pareamento';
import { EMPRESA, REMETENTE } from '../lib/email';
import { ABAS, GRUPOS, type Aba, type Grupo } from '../lib/acesso';
import { IcCasa, IcDinheiro, IcEmpilhadeira, IcEscudo, IcFechar, IcMenu, IcPrancheta, IcPredio, IcSair, IcSeta } from './Icones';
import { MODO_DEMO } from '../api';
import { TrocarSenha } from './TrocarSenha';
import { BuscaGeral } from './BuscaGeral';
import { useVersaoNova } from '../lib/versao';

const ICONE: Record<Grupo, (p: { tamanho?: number }) => ReactNode> = {
  inicio: IcCasa,
  operacao: IcPrancheta,
  frota: IcEmpilhadeira,
  financeiro: IcDinheiro,
  clientes: IcPredio,
  administracao: IcEscudo,
};

const CHAVE_FECHADOS = 'lucminas:menu-fechados';
const lerFechados = (padrao: Grupo[]): Grupo[] => {
  try {
    const s = localStorage.getItem(CHAVE_FECHADOS);
    return s ? JSON.parse(s) : padrao;
  } catch {
    return padrao;
  }
};

/** Quem usa a Central do financeiro: o financeiro (e quem mais aprova e envia faturas). */
export const usaCentralFinanceiro = (pode: (a: Aba, n?: 1 | 2) => boolean, aprova: boolean) => aprova && pode('envio', 2);
/** O financeiro vê o menu na ordem do trabalho dele: financeiro e clientes primeiro; operação e frota começam fechadas. */
const ORDEM_FINANCEIRO: Grupo[] = ['financeiro', 'clientes', 'inicio', 'operacao', 'frota', 'administracao'];

export type ItemMenu = { aba: Aba; rotulo: string; rota: string; grupo: Grupo; badge: number; alerta: boolean; /** aba desativada agora (ex.: conferência fora do fim do mês) */ fechado?: string };

/** Monta o menu do usuário: só as abas que o perfil dele vê, nos 6 grupos. */
export function useMenu(): ItemMenu[] {
  const { emailsNovos, lote, clientes, envios, aguardandoAprovacao, propostas, movimentacoes, pode, aprova, usuario, config, novasMov, avisosOk, veValores, alertasContratos } = useEstado();
  const avisosLote = lote ? lote.itens.filter((i) => temAviso(i, clientes)).length : 0;
  // e-mails com problema que ninguém deu ok
  const devolvidos = emailsComProblema(envios, avisosOk).length;
  // financeiro (e quem vê valores): movimentações que ainda não viu
  const novas = aprova || veValores ? novasMov.length : 0;
  const meusPendentes = propostas.filter((p) => p.status === 'pendente').length + movimentacoes.filter((m) => m.status === 'pendente').length;
  // quem não aprova acompanha as próprias alterações em "Minhas alterações"
  const propoe = pode('movimentacoes', 2) || pode('conferencia', 2) || pode('frotas', 2);

  const itens: ItemMenu[] = [];
  if (usaCentralFinanceiro(pode, aprova))
    itens.push({ aba: 'envio', rotulo: 'Central do financeiro', rota: '/financeiro', grupo: 'financeiro', badge: aguardandoAprovacao + devolvidos + novas + emailsNovos.length, alerta: true });
  for (const a of ABAS) {
    if (a.id === 'aprovacoes' && !aprova) {
      if (propoe) itens.push({ aba: a.id, rotulo: 'Minhas alterações', rota: a.rota, grupo: 'inicio', badge: meusPendentes, alerta: false });
      continue;
    }
    // "Envio do mês" é uma tela de ação: quem só vê acompanha as faturas pelo Calendário e pelo Histórico
    if (!pode(a.id, a.id === 'envio' ? 2 : 1)) continue;
    const badge: Partial<Record<Aba, [number, boolean]>> = {
      envio: [avisosLote, true],
      aprovacoes: [aguardandoAprovacao, true],
      historico: [devolvidos, true],
      movimentacoes: [novas, true],
      // pendências abertas + contatos com retorno marcado para hoje ou antes
      contratos: [alertasContratos.pendencias + alertasContratos.retornos, true],
      clientes: [clientes.filter((c) => c.ativo).length, false],
    };
    const [n, alerta] = badge[a.id] ?? [0, false];
    // a ficha de cada máquina usa a mesma permissão da relação de frotas
    if (a.id === 'frotas') itens.push({ aba: 'frotas', rotulo: 'Equipamentos', rota: '/equipamentos', grupo: 'frota', badge: 0, alerta: false });
    itens.push({ aba: a.id, rotulo: a.id === 'calendario' && !pode('envio') ? 'Calendário de locações' : a.rotulo, rota: a.rota, grupo: a.grupo, badge: n, alerta });
    // os formulários das OS: quem abre e encerra OS monta os modelos
    if (a.id === 'ordens' && pode('ordens', 2) && pode('manutencao', 2)) itens.push({ aba: 'ordens', rotulo: 'Modelos de OS', rota: '/modelos-os', grupo: a.grupo, badge: 0, alerta: false });
  }
  // "Histórico de avisos" fica logo depois do Histórico de envios (para quem vê os dois)
  const iHist = itens.findIndex((i) => i.rota === '/historico');
  const iAv = itens.findIndex((i) => i.rota === '/solicitacoes');
  if (iHist >= 0 && iAv >= 0) {
    const [av] = itens.splice(iAv, 1);
    av.grupo = itens[itens.findIndex((i) => i.rota === '/historico')].grupo;
    itens.splice(itens.findIndex((i) => i.rota === '/historico') + 1, 0, av);
  }
  // conferência: só abre no fim do mês (o administrador entra sempre)
  const janela = janelaConferencia(config);
  if (!janela.aberta && usuario?.perfil !== 'admin')
    for (const i of itens) if (i.rota === '/conferencia') i.fechado = `abre dia ${janela.abre}`;

  // financeiro: o que é do dia a dia dela fica junto, no grupo Financeiro
  if (usuario?.perfil === 'financeiro') {
    const ordem = ['/financeiro', '/aprovacoes', '/envio', '/calendario', '/historico', '/solicitacoes', '/movimentacoes', '/conferencia', '/externos', '/configuracoes'];
    for (const i of itens) if (ordem.includes(i.rota)) i.grupo = 'financeiro';
    const pos = (i: ItemMenu) => (i.grupo === 'financeiro' ? ordem.indexOf(i.rota) + 1 || 99 : 0);
    itens.sort((x, y) => pos(x) - pos(y));
  }
  return itens;
}

function Selo({ n, alerta }: { n: number; alerta: boolean }) {
  if (!n) return null;
  return (
    <span className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold ${alerta ? 'bg-brand text-ink' : 'bg-line-soft text-ink-2'}`}>
      {n}
    </span>
  );
}

function Menu({ itens }: { itens: ItemMenu[] }) {
  const { usuario } = useEstado();
  const ehFinanceiro = usuario?.perfil === 'financeiro';
  const [fechados, setFechados] = useState<Grupo[]>(() => lerFechados(ehFinanceiro ? ['operacao', 'frota'] : []));
  const grupos = ehFinanceiro ? ORDEM_FINANCEIRO.map((id) => GRUPOS.find((g) => g.id === id)!) : GRUPOS;
  const local = useLocation();
  const alternar = (g: Grupo) => {
    const novo = fechados.includes(g) ? fechados.filter((x) => x !== g) : [...fechados, g];
    setFechados(novo);
    try {
      localStorage.setItem(CHAVE_FECHADOS, JSON.stringify(novo));
    } catch {
      /* navegador sem armazenamento: só não lembra */
    }
  };
  return (
    <nav aria-label="Menu" className="flex flex-col gap-1 p-3">
      {grupos.map((g) => {
        const doGrupo = itens.filter((i) => i.grupo === g.id);
        if (!doGrupo.length) return null;
        const aberto = !fechados.includes(g.id) || doGrupo.some((i) => local.pathname.startsWith(i.rota));
        const alertas = doGrupo.filter((i) => i.alerta).reduce((s, i) => s + i.badge, 0);
        const Icone = ICONE[g.id];
        return (
          <div key={g.id}>
            <button
              type="button"
              onClick={() => alternar(g.id)}
              aria-expanded={aberto}
              className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-bold uppercase tracking-wide text-ink-3 hover:bg-line-soft"
            >
              <Icone tamanho={16} />
              <span className="flex-1 text-left">{g.rotulo}</span>
              {!aberto && <Selo n={alertas} alerta />}
              <span className={`transition-transform ${aberto ? 'rotate-90' : ''}`}>
                <IcSeta tamanho={14} />
              </span>
            </button>
            {aberto && (
              <ul className="mb-2 flex flex-col gap-0.5">
                {doGrupo.map((i) => (
                  <li key={i.rota}>
                    {i.fechado ? (
                      <span
                        aria-disabled="true"
                        title="A conferência só abre no fim do mês"
                        className="flex min-h-[40px] cursor-not-allowed items-center gap-2 rounded-lg py-1.5 pl-9 pr-2.5 text-[14px] font-medium text-ink-3/70"
                      >
                        <span className="flex-1">{i.rotulo}</span>
                        <span className="text-[11px]">{i.fechado}</span>
                      </span>
                    ) : (
                    <NavLink
                      to={i.rota}
                      className={({ isActive }) =>
                        `flex min-h-[40px] items-center gap-2 rounded-lg py-1.5 pl-9 pr-2.5 text-[14px] font-medium ${
                          isActive ? 'bg-brand-soft font-semibold text-ink shadow-[inset_3px_0_0_#FFC400]' : 'text-ink-2 hover:bg-line-soft hover:text-ink'
                        }`
                      }
                    >
                      <span className="flex-1">{i.rotulo}</span>
                      <Selo n={i.badge} alerta={i.alerta} />
                    </NavLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Layout() {
  const { usuario, sair, aviso, fecharAviso, envioAtivo, pode } = useEstado();
  const local = useLocation();
  const itens = useMenu();
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const versaoNova = useVersaoNova();
  const comoChamar = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(fecharAviso, 6000);
    return () => clearTimeout(t);
  }, [aviso, fecharAviso]);

  // no celular, o menu fecha ao escolher uma tela
  useEffect(() => setMenuAberto(false), [local.pathname]);
  const alertasTotal = itens.filter((i) => i.alerta).reduce((s, i) => s + i.badge, 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-noite text-white">
        <div className="flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <button
            type="button"
            className="relative flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10 lg:hidden"
            aria-label="Abrir menu"
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto(true)}
          >
            <IcMenu tamanho={22} />
            {alertasTotal > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />}
          </button>
          <Link to="/inicio" className="flex items-center gap-3">
            <img src="./logo-icone.png" alt="Lucminas" width={36} height={36} className="h-9 w-9" />
            <div className="leading-tight">
              <div className="text-[15px] font-bold">Sistema Lucminas</div>
              <div className="text-xs text-white/65">
                {EMPRESA} · {usuario?.perfilNome ?? ''}
              </div>
            </div>
          </Link>
          <div className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1 sm:px-4">
            <BuscaGeral />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pode('envio') && (
              <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 xl:flex">
                <span className={`h-2 w-2 rounded-full ${envioAtivo ? 'bg-[#3DDC84]' : 'bg-brand'}`} aria-hidden="true" />
                {REMETENTE} · {MODO_DEMO ? 'demonstração (nenhum e-mail sai)' : envioAtivo ? 'envio ativo' : 'envio não configurado'}
              </span>
            )}
            {comoChamar && <span className="hidden px-1 text-[15px] font-bold text-brand sm:inline">Oi {comoChamar}! :)</span>}
            <button type="button" onClick={() => setTrocandoSenha(true)} className="btn btn-sm hidden text-white/75 hover:bg-white/10 hover:text-white md:inline-flex">
              Trocar senha
            </button>
            <button type="button" onClick={sair} className="btn btn-sm border border-white/25 text-white hover:bg-white/10" title={usuario?.email}>
              <IcSair tamanho={14} /> Sair
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-[64px] hidden h-[calc(100vh-64px)] w-[244px] shrink-0 overflow-y-auto border-r border-line bg-white lg:block">
          <Menu itens={itens} />
        </aside>

        {menuAberto && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMenuAberto(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="font-bold">{comoChamar ? `Oi ${comoChamar}!` : 'Menu'}</span>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-line-soft"
                  aria-label="Fechar menu"
                  onClick={() => setMenuAberto(false)}
                >
                  <IcFechar />
                </button>
              </div>
              <Menu itens={itens} />
              <button type="button" onClick={() => setTrocandoSenha(true)} className="mx-3 mb-4 mt-auto rounded-lg px-2.5 py-2 text-left text-[14px] text-ink-2 hover:bg-line-soft">
                Trocar senha
              </button>
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-[1280px]">
            {versaoNova && (
              <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-brand bg-brand-soft px-4 py-3 text-[14px]">
                <b>O sistema foi atualizado.</b>
                <button type="button" className="btn-primary btn-sm" onClick={() => window.location.reload()}>
                  Carregar a versão nova
                </button>
              </div>
            )}
            {aviso && (
              <div
                role="status"
                className={`mb-5 flex items-center justify-between gap-3 rounded-[10px] px-4 py-2 font-medium ${aviso.tom === 'ok' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-strong'}`}
              >
                <span>{aviso.texto}</span>
                <button type="button" aria-label="Fechar aviso" onClick={fecharAviso} className="flex h-11 w-11 shrink-0 items-center justify-center">
                  <IcFechar />
                </button>
              </div>
            )}
            <ProtecaoErro chave={local.pathname}>
              <Outlet />
            </ProtecaoErro>
          </div>
        </main>
      </div>
      <ProtecaoErro compacto>
        <AvisosWidget />
      </ProtecaoErro>
      <TrocarSenha aberto={trocandoSenha} fechar={() => setTrocandoSenha(false)} />
    </div>
  );
}
