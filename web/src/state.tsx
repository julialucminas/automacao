import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Cliente, ClienteInput, Envio, ItemLote, Lote, Usuario } from './types';
import { encontrarCliente, statusDoItem } from './lib/pareamento';

type Aviso = { id: number; texto: string; tom: 'ok' | 'bad' };

type Estado = {
  usuario: Usuario | null;
  carregando: boolean;
  entrar(email: string, senha: string): Promise<void>;
  sair(): Promise<void>;

  clientes: Cliente[];
  salvarCliente(input: ClienteInput): Promise<Cliente>;
  definirAtivo(id: string, ativo: boolean): Promise<void>;

  envios: Envio[];
  recarregarEnvios(): Promise<void>;

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
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [lote, setLote] = useState<Lote | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const recarregarClientes = useCallback(async () => setClientes(await api.listarClientes()), []);
  const recarregarEnvios = useCallback(async () => setEnvios(await api.listarEnvios()), []);

  useEffect(() => {
    api.usuarioAtual().then(async (u) => {
      setUsuario(u);
      if (u) await Promise.all([recarregarClientes(), recarregarEnvios()]);
      setCarregando(false);
    });
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
          if (!i.clienteId && novo.clienteId) novo.marcado = statusDoItem(novo) === 'pronto';
          if (!novo.clienteId) novo.marcado = false;
          return novo;
        }),
      };
    });
  }, []);

  const valor = useMemo<Estado>(
    () => ({
      usuario,
      carregando,
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

      clientes,
      async salvarCliente(input) {
        const salvo = await api.salvarCliente(input);
        const lista = await api.listarClientes();
        setClientes(lista);
        reconciliarLote(lista);
        return salvo;
      },
      async definirAtivo(cid, ativo) {
        await api.definirAtivo(cid, ativo);
        const lista = await api.listarClientes();
        setClientes(lista);
        reconciliarLote(lista);
      },

      envios,
      recarregarEnvios,

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
        setClientes(await api.listarClientes());
        setLote((l) =>
          l
            ? {
                ...l,
                itens: l.itens.map((i) => {
                  if (chaveItem(i) !== chave) return i;
                  const novo: ItemLote = { ...i, clienteId, vinculo: 'manual' };
                  return { ...novo, marcado: statusDoItem(novo) === 'pronto' };
                }),
              }
            : l,
        );
      },

      aviso,
      avisar,
      fecharAviso: () => setAviso(null),
    }),
    [usuario, carregando, clientes, envios, lote, aviso, avisar, recarregarClientes, recarregarEnvios, reconciliarLote],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEstado(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEstado fora do EstadoProvider');
  return v;
}
