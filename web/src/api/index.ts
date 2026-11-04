/*
 * Ponto único de acesso a dados.
 *   VITE_API=http  → servidor real (faturas.lucminas.com.br)
 *   sem a variável → demonstração com dados no navegador (prévia do GitHub Pages)
 */
import { mockApi } from './mock';
import { httpApi } from './http';
import type {
  Cliente,
  ClienteInput,
  ConfigEmail,
  Conferencia,
  FrotaOficina,
  Envio,
  Faturamento,
  ItemLog,
  Movimentacao,
  NovaMovimentacao,
  NovaSolicitacao,
  PerfilAcesso,
  Pessoa,
  Proposta,
  Solicitacao,
  Usuario,
  UsuarioAdmin,
  DadosEquipamento,
  Equipamento,
  NovaPeca,
  NovaPendencia,
  PecaHistorico,
  Pendencia,
  Visita,
} from '../types';

export type EnvioPedido = {
  referencia: string;
  numero: string;
  clienteId: string;
  assunto: string;
  corpo: string;
  anexos: { nome: string; blob: Blob }[];
  pediuLeitura: boolean;
  observacao: string;
  /** dia do Calendário a marcar como faturado quando o envio der certo */
  dataFaturamento?: string | null;
};

export type ResultadoTeste = { ok: boolean; para: string; copiaEmEnviados: boolean; detalhe: string };
export type SituacaoEnvio = { configurado: boolean; conta: string | null; ultimaVerificacao?: string | null };

export interface Api {
  login(email: string, senha: string): Promise<Usuario>;
  logout(): Promise<void>;
  usuarioAtual(): Promise<Usuario | null>;
  trocarSenha(atual: string, nova: string): Promise<void>;

  listarClientes(): Promise<Cliente[]>;
  salvarCliente(input: ClienteInput): Promise<Cliente>;
  definirAtivo(id: string, ativo: boolean): Promise<void>;
  adicionarApelido(id: string, apelido: string): Promise<Cliente>;

  listarFaturamentos(de: string, ate: string): Promise<Faturamento[]>;
  marcarFaturado(clienteId: string, data: string): Promise<void>;
  desmarcarFaturado(clienteId: string, data: string): Promise<void>;

  listarUsuarios(): Promise<Pessoa[]>;
  listarSolicitacoes(): Promise<Solicitacao[]>;
  abrirSolicitacao(id: string): Promise<Solicitacao>;
  criarSolicitacao(s: NovaSolicitacao): Promise<Solicitacao>;
  responderSolicitacao(id: string, texto: string): Promise<Solicitacao>;
  alterarSolicitacao(id: string, mudanca: { status?: 'aberta' | 'concluida'; data?: string }): Promise<Solicitacao>;

  listarMovimentacoes(): Promise<Movimentacao[]>;
  registrarMovimentacao(m: NovaMovimentacao): Promise<Movimentacao>;
  decidirMovimentacao(id: string, aprovar: boolean, motivo?: string): Promise<Movimentacao>;
  listarPropostas(): Promise<Proposta[]>;
  proporAlteracao(input: ClienteInput): Promise<void>;
  decidirProposta(id: string, aprovar: boolean, motivo?: string): Promise<void>;
  lerConfig(): Promise<ConfigEmail>;
  salvarConfig(c: Partial<ConfigEmail>): Promise<ConfigEmail>;
  listarRegistro(): Promise<ItemLog[]>;
  listarOficina(): Promise<FrotaOficina[]>;
  colocarNaOficina(frota: string, observacao: string): Promise<FrotaOficina[]>;
  tirarDaOficina(frota: string): Promise<FrotaOficina[]>;
  listarConferencia(referencia: string): Promise<Conferencia[]>;
  marcarConferencia(referencia: string, c: { clienteId: string; frota: string; status: 'ok' | 'alterado'; observacao?: string }): Promise<Conferencia>;
  desmarcarConferencia(referencia: string, clienteId: string, frota: string): Promise<void>;

  // equipamentos e histórico de peças
  listarEquipamentos(): Promise<Equipamento[]>;
  salvarEquipamento(frota: string, dados: DadosEquipamento): Promise<Equipamento>;
  importarEquipamentos(lista: { frota: string; dados: DadosEquipamento }[]): Promise<{ novos: number; atualizados: number; iguais: number }>;
  historicoDaFrota(frota: string): Promise<PecaHistorico[]>;
  buscarHistorico(q: string, frota?: string): Promise<PecaHistorico[]>;
  resumoHistorico(): Promise<{ origem: string; linhas: number; de: string; ate: string }[]>;
  importarHistorico(linhas: NovaPeca[]): Promise<{ linhas: number }>;

  // painel de manutenção
  listarPendencias(todas?: boolean): Promise<Pendencia[]>;
  criarPendencia(p: NovaPendencia): Promise<Pendencia>;
  resolverPendencia(id: number, resolver: boolean, resolucao?: string): Promise<Pendencia>;
  importarPendencias(lista: NovaPendencia[]): Promise<{ abertas: number; jaResolvidas: number }>;
  registrarVisita(frota: string, v: Visita): Promise<Equipamento>;

  // usuários e permissões (administração)
  listarPerfis(): Promise<PerfilAcesso[]>;
  criarPerfil(p: Omit<PerfilAcesso, 'id' | 'padrao'>): Promise<PerfilAcesso>;
  salvarPerfil(p: PerfilAcesso): Promise<PerfilAcesso>;
  apagarPerfil(id: string): Promise<void>;
  listarUsuariosAdmin(): Promise<UsuarioAdmin[]>;
  criarUsuario(u: { email: string; nome: string; chamar: string; perfil: string; senha: string }): Promise<UsuarioAdmin>;
  alterarUsuario(id: number, mudanca: { nome?: string; chamar?: string; perfil?: string; ativo?: boolean; senha?: string }): Promise<UsuarioAdmin>;

  listarEnvios(): Promise<Envio[]>;
  /** Envia um e-mail (SMTP) e salva a cópia em Enviados (IMAP). */
  enviar(pedido: EnvioPedido): Promise<Envio>;
  reenviar(envioId: string): Promise<Envio>;
  /** tenta de novo gravar a cópia de um envio na pasta Enviados */
  copiarEnviados(envioId: string): Promise<Envio>;
  /** manda a fatura só para quem está logado, para conferir como chega */
  testarEnvio(pedido: EnvioPedido): Promise<ResultadoTeste>;
  situacaoEnvio(): Promise<SituacaoEnvio>;
  /** olha a caixa de entrada agora (devoluções e confirmações de leitura) */
  verificarCaixa(): Promise<{ lidas: number; atualizados: number; ultimaVerificacao: string | null }>;
}

export const MODO_DEMO = import.meta.env.VITE_API !== 'http';

export const api: Api = MODO_DEMO ? mockApi : httpApi;
