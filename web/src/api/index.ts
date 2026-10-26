/*
 * Ponto único de acesso a dados. Hoje usa a implementação simulada (dados no navegador).
 * Quando o backend existir, criamos api/http.ts com as mesmas funções chamando /api/...
 * e trocamos a linha abaixo. As telas não mudam.
 */
import { mockApi } from './mock';
import type { Cliente, ClienteInput, Envio, Usuario } from '../types';

export type EnvioPedido = {
  referencia: string;
  numero: string;
  clienteId: string;
  assunto: string;
  corpo: string;
  anexos: { nome: string; blob: Blob }[];
  pediuLeitura: boolean;
  observacao: string;
};

export interface Api {
  login(email: string, senha: string): Promise<Usuario>;
  logout(): Promise<void>;
  usuarioAtual(): Promise<Usuario | null>;

  listarClientes(): Promise<Cliente[]>;
  salvarCliente(input: ClienteInput): Promise<Cliente>;
  definirAtivo(id: string, ativo: boolean): Promise<void>;
  adicionarApelido(id: string, apelido: string): Promise<Cliente>;

  listarEnvios(): Promise<Envio[]>;
  /** Envia um e-mail (SMTP) e salva a cópia em Enviados (IMAP). */
  enviar(pedido: EnvioPedido): Promise<Envio>;
  reenviar(envioId: string): Promise<Envio>;
}

export const api: Api = mockApi;
