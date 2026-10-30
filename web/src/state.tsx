import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Cliente, ClienteInput, ConfigEmail, Envio, FrotaOficina, ItemLote, Lote, Movimentacao, Proposta, Solicitacao, Usuario } from './types';
import { hojeIso } from './lib/calendario';
import { encontrarCliente, statusDoItem } from './lib/pareamento';

type Aviso = { id: number; texto: string; tom: 'ok' | 'bad' };

type Estado = {
  usuario: Usuario | null;
  carregando: boolean;
  erroInicial: string;
  entrar(email: string, senha: string): Promise<void>;
  sair(): Promise<void>;

  /** financeiro (Angelise/Júlia) pode tudo; operações (Júnior) propõe e o financeiro aprova */
  ehFinanceiro: boolean;

  clientes: Cliente[];
  recarregarClientes(): Promise<void>;
  /** operações: envia a alteração para aprovação em vez de salvar */
  proporCliente(input: ClienteInput): Promise<void>;

  movimentacoes: Movimentacao[];
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

  solicitacoes: Solicitacao[];
  recarregarSolicitacoes(): Promise<void>;
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
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [oficina, setOficina] = useState<FrotaOficina[]>([]);
  const [config, setConfig] = useState<ConfigEmail | null>(null);
  const [envioAtivo, setEnvioAtivo] = useState(false);

  const recarregarClientes = useCallback(async () => setClientes(await api.listarClientes()), []);
  const recarregarEnvios = useCallback(async () => setEnvios(await api.listarEnvios()), []);
  const recarregarSolicitacoes = useCallback(async () => {
    try {
      setSolicitacoes(await api.listarSolicitacoes());
    } catch {
      /* sem conexão: tenta de novo no próximo ciclo */
    }
  }, []);

  const recarregarOperacoes = useCallback(async () => {
    try {
      const [m, p, o] = await Promise.all([api.listarMovimentacoes(), api.listarPropostas(), api.listarOficina()]);
      setMovimentacoes(m);
      setPropostas(p);
      setOficina(o);
    } catch {
      /* tenta de novo no próximo ciclo */
    }
  }, []);

  // novidades a cada minuto (e quando a janela volta ao foco)
  useEffect(() => {
    if (!usuario) return;
    const tudo = () => {
      recarregarSolicitacoes();
      recarregarOperacoes();
    };
    tudo();
    api.lerConfig().then(setConfig, () => undefined);
    api.situacaoEnvio().then((s) => setEnvioAtivo(s.configurado), () => undefined);
    const t = setInterval(tudo, 60_000);
    const foco = () => document.visibilityState === 'visible' && tudo();
    document.addEventListener('visibilitychange', foco);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', foco);
    };
  }, [usuario, recarregarSolicitacoes, recarregarOperacoes]);

  useEffect(() => {
    api
      .usuarioAtual()
      .then(async (u) => {
        setUsuario(u);
        if (u) await Promise.all([recarregarClientes(), recarregarEnvios()]);
      })
      .catch((e) => setErroInicial(e instanceof Error ? e.message : 'Erro ao conectar com o servidor.'))
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
  const pendentesParaMim = useMemo(
    () => solicitacoes.filter((x) => x.status === 'aberta' && x.paraUsuario === usuario?.id && x.data <= hoje),
    [solicitacoes, usuario, hoje],
  );
  const ehFinanceiro = (usuario?.perfil ?? 'financeiro') === 'financeiro';
  const aguardandoAprovacao = movimentacoes.filter((m) => m.status === 'pendente').length + propostas.filter((p) => p.status === 'pendente').length;
  const naoLidas = solicitacoes.reduce((n, x) => n + (x.naoLidas > 0 ? 1 : 0), 0);

  const valor = useMemo<Estado>(
    () => ({
      usuario,
      carregando,
      erroInicial,
      async entrar(email, senha) {
        const u = await api.login(email, senha);
        setUsuario(u);
        await Promise.all([recarregarClientes(), recarregarEnvios()]);
      },
      async sair() {
        await api.logout();
        setUsuario(null);
        setLote(null);
      },

      ehFinanceiro,
      clientes,
      recarregarClientes,
      async proporCliente(input) {
        await api.proporAlteracao(input);
        await recarregarOperacoes();
      },
      movimentacoes,
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

      solicitacoes,
      recarregarSolicitacoes,
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
    [usuario, carregando, erroInicial, ehFinanceiro, movimentacoes, propostas, oficina, aguardandoAprovacao, config, envioAtivo, recarregarOperacoes, clientes, envios, solicitacoes, recarregarSolicitacoes, pendentesParaMim, naoLidas, lote, aviso, avisar, recarregarClientes, recarregarEnvios, reconciliarLote],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstado(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEstado fora do EstadoProvider');
  return v;
}
