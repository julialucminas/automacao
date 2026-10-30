/*
 * Ponto único de acesso a dados.
 *   VITE_API=http  → servidor real (faturas.lucminas.com.br)
 *   sem a variável → demonstração com dados no navegador (prévia do GitHub Pages)
 */
import { mockApi } from './mock';
import { httpApi } from './http';
import type { Cliente, ClienteInput, ConfigEmail, Conferencia, Envio, Faturamento, ItemLog, Movimentacao, NovaMovimentacao, NovaSolicitacao, Pessoa, Proposta, Solicitacao, Usuario } from '../types';

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
export type SituacaoEnvio = { configurado: boolean; conta: string | null };

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
  listarConferencia(referencia: string): Promise<Conferencia[]>;
  marcarConferencia(referencia: string, c: { clienteId: string; frota: string; status: 'ok' | 'alterado'; observacao?: string }): Promise<Conferencia>;
  desmarcarConferencia(referencia: string, clienteId: string, frota: string): Promise<void>;

  listarEnvios(): Promise<Envio[]>;
  /** Envia um e-mail (SMTP) e salva a cópia em Enviados (IMAP). */
  enviar(pedido: EnvioPedido): Promise<Envio>;
  reenviar(envioId: string): Promise<Envio>;
  /** manda a fatura só para quem está logado, para conferir como chega */
  testarEnvio(pedido: EnvioPedido): Promise<ResultadoTeste>;
  situacaoEnvio(): Promise<SituacaoEnvio>;
}

export const MODO_DEMO = import.meta.env.VITE_API !== 'http';

export const api: Api = MODO_DEMO ? mockApi : httpApi;
