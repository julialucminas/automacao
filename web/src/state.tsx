import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { EmailRecebido, Cliente, ClienteInput, ConfigEmail, Envio, FrotaOficina, ItemLote, Lote, Movimentacao, Proposta, Solicitacao, Usuario, AvisoOk } from './types';
import { hojeIso } from './lib/calendario';
import { encontrarCliente, statusDoItem } from './lib/pareamento';
import { nivel, type Aba } from './lib/acesso';
import type { Nivel } from './types';

type Aviso = { id: number; texto: string; tom: 'ok' | 'bad' };

type Estado = {
  usuario: Usuario | null;
  carregando: boolean;
  erroInicial: string;
  entrar(email: string, senha: string): Promise<void>;
  sair(): Promise<void>;

  /** o perfil do usuário tem pelo menos esse nível na aba (1 = vê, 2 = edita) */
  pode(aba: Aba, n?: Nivel): boolean;
  /** somas, totais e valores nos relatórios em PDF */
  veValores: boolean;
  /** aprova as alterações dos outros: o que ele registra entra direto no cadastro */
  aprova: boolean;

  clientes: Cliente[];
  recarregarClientes(): Promise<void>;
  /** operações: envia a alteração para aprovação em vez de salvar */
  proporCliente(input: ClienteInput): Promise<void>;

  movimentacoes: Movimentacao[];
  /** movimentações que este usuário ainda não viu (financeiro: "novas movimentações") */
  novasMov: Movimentacao[];
  marcarMovVistas(ids?: string[]): Promise<void>;
  /** pendências com "ok" (e-mail devolvido, contrato vencendo…) */
  avisosOk: Map<string, AvisoOk>;
  /** contratos: pendências abertas e retornos de contato que já chegaram (contador do menu) */
  alertasContratos: { pendencias: number; retornos: number };
  recarregarAlertasContratos(): Promise<void>;
  darOk(chave: string, obs?: string): Promise<void>;
  desfazerOk(chave: string): Promise<void>;
  propostas: Proposta[];
  oficina: FrotaOficina[];
  definirOficina(l: FrotaOficina[]): void;
  recarregarOperacoes(): Promise<void>;
  /** itens aguardando aprovação do financeiro */
  aguardandoAprovacao: number;

  config: ConfigEmail | null;
  /** o servidor tem a senha do e-mail da empresa configurada */
  envioAtivo: boolean;
  salvarConfig(c: Partial<ConfigEmail>): Promise<void>;

  salvarCliente(input: ClienteInput): Promise<Cliente>;
  importarClientes(inputs: ClienteInput[], progresso?: (feitos: number) => void): Promise<{ ok: number; falhas: string[] }>;
  definirAtivo(id: string, ativo: boolean): Promise<void>;

  envios: Envio[];
  recarregarEnvios(): Promise<void>;

  /** e-mails que chegaram na caixa das faturas (para o financeiro) e os que ainda ninguém deu ok */
  emailsCaixa: EmailRecebido[];
  emailsNovos: EmailRecebido[];
  recarregarCaixa(): Promise<void>;
  okEmails(ids: string[], desfazer?: boolean): Promise<void>;
  solicitacoes: Solicitacao[];
  recarregarSolicitacoes(): Promise<void>;
  /** conclui/reabre/muda a data: atualiza na hora (lista, avisos e contadores) e confirma com o servidor */
  alterarSolicitacao(id: string, mudanca: { status?: 'aberta' | 'concluida'; data?: string; nota?: string }): Promise<Solicitacao>;
  /** abertas, para o usuário logado, com data até hoje */
  pendentesParaMim: Solicitacao[];
  naoLidas: number;

  lote: Lote | null;
  definirLote(l: Lote | null): void;
  atualizarItem(chave: string, mudar: (i: ItemLote) => ItemLote): void;
  vincularCliente(chave: string, clienteId: string): Promise<void>;

  aviso: Aviso | null;
  avisar(texto: string, tom?: Aviso['tom']): void;
  fecharAviso(): void;
};

const Ctx = createContext<Estado | null>(null);

const CHAVE_USUARIO = 'lucminas:ultimo-usuario';
function lembrarUsuario(u: Usuario | null) {
  try {
    if (u) localStorage.setItem(CHAVE_USUARIO, JSON.stringify(u));
    else localStorage.removeItem(CHAVE_USUARIO);
  } catch {
    /* navegador sem armazenamento */
  }
}
function usuarioGuardado(): Usuario | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_USUARIO) ?? 'null');
  } catch {
    return null;
  }
}

/** Chave única de um item do lote (o número pode se repetir quando há duplicidade). */
export const chaveItem = (i: ItemLote) => `${i.numero}|${i.fatura?.caminho ?? i.boleto?.caminho ?? ''}`;

export function EstadoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroInicial, setErroInicial] = useState('');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [lote, setLote] = useState<Lote | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [avisos, setAvisos] = useState<AvisoOk[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [oficina, setOficina] = useState<FrotaOficina[]>([]);
  const [config, setConfig] = useState<ConfigEmail | null>(null);
  const [envioAtivo, setEnvioAtivo] = useState(false);

  const recarregarClientes = useCallback(async () => setClientes(await api.listarClientes()), []);
  // só quem vê o envio ou o histórico recebe a lista de envios
  const usuarioRef = useRef<Usuario | null>(null);
  usuarioRef.current = usuario;
  const recarregarEnvios = useCallback(async () => {
    const u = usuarioRef.current;
    if (u && (nivel(u, 'envio') || nivel(u, 'historico'))) setEnvios(await api.listarEnvios());
  }, []);
  const recarregarSolicitacoes = useCallback(async () => {
    try {
      setSolicitacoes(await api.listarSolicitacoes());
    } catch {
      /* sem conexão: tenta de novo no próximo ciclo */
    }
  }, []);
  const alterarSolicitacao = useCallback(
    async (id: string, mudanca: { status?: 'aberta' | 'concluida'; data?: string; nota?: string }) => {
      const s = await api.alterarSolicitacao(id, mudanca);
      // troca na lista já com a resposta do servidor (não espera o próximo ciclo)
      setSolicitacoes((l) => l.map((x) => (x.id === id ? { ...x, ...s, mensagens: undefined, naoLidas: 0 } : x)));
      void recarregarSolicitacoes();
      return s;
    },
    [recarregarSolicitacoes],
  );

  const [emailsCaixa, setEmailsCaixa] = useState<EmailRecebido[]>([]);
  const recarregarCaixa = useCallback(async () => {
    const u = usuarioRef.current;
    if (!u || !(nivel(u, 'envio') || nivel(u, 'historico'))) return;
    try {
      setEmailsCaixa((await api.caixaEntrada()).emails);
    } catch {
      /* tenta de novo no próximo ciclo */
    }
  }, []);
  const okEmails = useCallback(
    async (ids: string[], desfazer?: boolean) => {
      const t = new Date().toISOString();
      setEmailsCaixa((l) => l.map((e) => (ids.includes(e.id) ? { ...e, vistoEm: desfazer ? null : t, vistoPorNome: desfazer ? null : (usuarioRef.current?.nome ?? '') } : e)));
      await api.okEmails(ids, desfazer);
      void recarregarCaixa();
    },
    [recarregarCaixa],
  );
  const emailsNovos = useMemo(() => emailsCaixa.filter((e) => !e.vistoEm), [emailsCaixa]);

  const [alertasContratos, setAlertasContratos] = useState({ pendencias: 0, retornos: 0 });
  const recarregarAlertasContratos = useCallback(async () => {
    try {
      setAlertasContratos(await api.alertasContratos());
    } catch {
      /* sem acesso à aba Contratos ou sem conexão */
    }
  }, []);

  const recarregarOperacoes = useCallback(async () => {
    try {
      const [m, p, o, a] = await Promise.all([api.listarMovimentacoes(), api.listarPropostas(), api.listarOficina(), api.listarAvisosOk().catch(() => null)]);
      void recarregarAlertasContratos();
      setMovimentacoes(m);
      if (a) setAvisos(a);
      setPropostas(p);
      setOficina(o);
    } catch {
      /* tenta de novo no próximo ciclo */
    }
  }, [recarregarAlertasContratos]);

  // novidades a cada minuto (e quando a janela volta ao foco)
  useEffect(() => {
    if (!usuario) return;
    const tudo = () => {
      recarregarSolicitacoes();
      recarregarOperacoes();
      void recarregarCaixa();
    };
    tudo();
    api.lerConfig().then(setConfig, () => undefined);
    api.situacaoEnvio().then(
      (s) => setEnvioAtivo(s.configurado),
      () => undefined,
    );
    const t = setInterval(tudo, 60_000);
    // as solicitações são conversa entre vocês: confere mais vezes (só com a janela aberta)
    const ts = setInterval(() => document.visibilityState === 'visible' && recarregarSolicitacoes(), 15_000);
    const foco = () => document.visibilityState === 'visible' && tudo();
    document.addEventListener('visibilitychange', foco);
    return () => {
      clearInterval(t);
      clearInterval(ts);
      document.removeEventListener('visibilitychange', foco);
    };
  }, [usuario, recarregarSolicitacoes, recarregarOperacoes, recarregarCaixa]);

  useEffect(() => {
    api
      .usuarioAtual()
      .then(async (u) => {
        usuarioRef.current = u;
        setUsuario(u);
        lembrarUsuario(u);
        if (u) await Promise.all([recarregarClientes(), recarregarEnvios()]);
      })
      .catch((e) => {
        // sem sinal (técnico no campo): abre com o último usuário que entrou neste aparelho
        const guardado = usuarioGuardado();
        if (guardado && e instanceof Error && /Sem conexão|demorou demais/.test(e.message)) {
          usuarioRef.current = guardado;
          setUsuario(guardado);
          return;
        }
        setErroInicial(e instanceof Error ? e.message : 'Erro ao conectar com o servidor.');
      })
      .finally(() => setCarregando(false));
  }, [recarregarClientes, recarregarEnvios]);

  const avisar = useCallback((texto: string, tom: Aviso['tom'] = 'ok') => setAviso({ id: Date.now(), texto, tom }), []);

  // Quando o cadastro muda, itens do lote que estavam "sem cadastro" podem passar a ser encontrados.
  const reconciliarLote = useCallback((lista: Cliente[]) => {
    setLote((l) => {
      if (!l) return l;
      return {
        ...l,
        itens: l.itens.map((i) => {
          if (i.enviado || i.vinculo === 'manual' || !i.fatura) return i;
          const achado = encontrarCliente(i.empresaNoArquivo, lista);
          const novo: ItemLote = { ...i, clienteId: achado?.clienteId ?? null, vinculo: achado?.vinculo ?? null };
          if (!i.clienteId && novo.clienteId) novo.marcado = statusDoItem(novo, lista) === 'pronto';
          if (statusDoItem(novo, lista) !== 'pronto') novo.marcado = false;
          if (!novo.clienteId) novo.marcado = false;
          return novo;
        }),
      };
    });
  }, []);

  const hoje = hojeIso();
  const pendentesParaMim = useMemo(() => solicitacoes.filter((x) => x.status === 'aberta' && x.paraUsuario === usuario?.id && x.data <= hoje), [solicitacoes, usuario, hoje]);
  const pode = useCallback((aba: Aba, n: Nivel = 1) => nivel(usuario, aba) >= n, [usuario]);
  const veValores = !!usuario?.veValores;
  const aprova = pode('aprovacoes', 2);
  const aguardandoAprovacao = movimentacoes.filter((m) => m.status === 'pendente').length + propostas.filter((p) => p.status === 'pendente').length;
  // só conversa aberta em que eu estou (a de outras pessoas, que o admin vê em "Todas", não conta; concluída também não)
  const naoLidas = solicitacoes.reduce((n, x) => n + (x.naoLidas > 0 && x.status === 'aberta' ? 1 : 0), 0);

  const valor = useMemo<Estado>(
    () => ({
      usuario,
      carregando,
      erroInicial,
      async entrar(email, senha) {
        const u = await api.login(email, senha);
        usuarioRef.current = u;
        setUsuario(u);
        lembrarUsuario(u);
        await Promise.all([recarregarClientes(), recarregarEnvios()]);
      },
      async sair() {
        await api.logout().catch(() => undefined);
        lembrarUsuario(null);
        setUsuario(null);
        setLote(null);
      },

      pode,
      veValores,
      aprova,
      clientes,
      recarregarClientes,
      async proporCliente(input) {
        await api.proporAlteracao(input);
        await recarregarOperacoes();
      },
      movimentacoes,
      novasMov: movimentacoes.filter((m) => !m.vista),
      async marcarMovVistas(ids) {
        setMovimentacoes((l) => l.map((m) => (!ids || ids.includes(m.id) ? { ...m, vista: true } : m)));
        await api.marcarMovVistas(ids);
      },
      avisosOk: new Map(avisos.map((a) => [a.chave, a])),
      alertasContratos,
      recarregarAlertasContratos,
      async darOk(chave, obs) {
        await api.darOk(chave, obs);
        setAvisos(await api.listarAvisosOk());
      },
      async desfazerOk(chave) {
        await api.desfazerOk(chave);
        setAvisos(await api.listarAvisosOk());
      },
      propostas,
      oficina,
      definirOficina: setOficina,
      async recarregarOperacoes() {
        await Promise.all([recarregarOperacoes(), recarregarClientes()]);
      },
      aguardandoAprovacao,
      config,
      envioAtivo,
      async salvarConfig(c) {
        setConfig(await api.salvarConfig(c));
      },
      async salvarCliente(input) {
        const salvo = await api.salvarCliente(input);
        const lista = await api.listarClientes();
        setClientes(lista);
        reconciliarLote(lista);
        return salvo;
      },
      async importarClientes(inputs, progresso) {
        let feitos = 0;
        let ok = 0;
        const falhas: string[] = [];
        for (const input of inputs) {
          try {
            await api.salvarCliente(input);
            ok++;
          } catch (e) {
            falhas.push(`${input.nome}: ${e instanceof Error ? e.message : 'erro'}`);
          }
          progresso?.(++feitos);
        }
        const lista = await api.listarClientes();
        setClientes(lista);
        reconciliarLote(lista);
        return { ok, falhas };
      },
      async definirAtivo(cid, ativo) {
        await api.definirAtivo(cid, ativo);
        const lista = await api.listarClientes();
        setClientes(lista);
        reconciliarLote(lista);
      },

      envios,
      recarregarEnvios,

      emailsCaixa,
      emailsNovos,
      recarregarCaixa,
      okEmails,
      solicitacoes,
      recarregarSolicitacoes,
      alterarSolicitacao,
      pendentesParaMim,
      naoLidas,

      lote,
      definirLote: setLote,
      atualizarItem(chave, mudar) {
        setLote((l) => (l ? { ...l, itens: l.itens.map((i) => (chaveItem(i) === chave ? mudar(i) : i)) } : l));
      },
      async vincularCliente(chave, clienteId) {
        const item = lote?.itens.find((i) => chaveItem(i) === chave);
        if (!item) return;
        // o sistema aprende: esse nome de arquivo passa a ser apelido do cliente
        await api.adicionarApelido(clienteId, item.empresaNoArquivo);
        const lista = await api.listarClientes();
        setClientes(lista);
        setLote((l) =>
          l
            ? {
                ...l,
                itens: l.itens.map((i) => {
                  if (chaveItem(i) !== chave) return i;
                  const novo: ItemLote = { ...i, clienteId, vinculo: 'manual' };
                  return { ...novo, marcado: statusDoItem(novo, lista) === 'pronto' };
                }),
              }
            : l,
        );
      },

      aviso,
      avisar,
      fecharAviso: () => setAviso(null),
    }),
    [
      alertasContratos,
      recarregarAlertasContratos,
      usuario,
      carregando,
      erroInicial,
      pode,
      veValores,
      aprova,
      movimentacoes,
      avisos,
      propostas,
      oficina,
      aguardandoAprovacao,
      config,
      envioAtivo,
      recarregarOperacoes,
      clientes,
      envios,
      emailsCaixa,
      emailsNovos,
      recarregarCaixa,
      okEmails,
      solicitacoes,
      recarregarSolicitacoes,
      alterarSolicitacao,
      pendentesParaMim,
      naoLidas,
      lote,
      aviso,
      avisar,
      recarregarClientes,
      recarregarEnvios,
      reconciliarLote,
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstado(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEstado fora do EstadoProvider');
  return v;
}
