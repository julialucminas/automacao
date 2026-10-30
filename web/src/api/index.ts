/*
 * Ponto único de acesso a dados.
 *   VITE_API=http  → servidor real (faturas.lucminas.com.br)
 *   sem a variável → demonstração com dados no navegador (prévia do GitHub Pages)
 */
import { mockApi } from './mock';
import { httpApi } from './http';
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
  trocarSenha(atual: string, nova: string): Promise<void>;

  listarClientes(): Promise<Cliente[]>;
  salvarCliente(input: ClienteInput): Promise<Cliente>;
  definirAtivo(id: string, ativo: boolean): Promise<void>;
  adicionarApelido(id: string, apelido: string): Promise<Cliente>;

  listarEnvios(): Promise<Envio[]>;
  /** Envia um e-mail (SMTP) e salva a cópia em Enviados (IMAP). */
  enviar(pedido: EnvioPedido): Promise<Envio>;
  reenviar(envioId: string): Promise<Envio>;
}

export const MODO_DEMO = import.meta.env.VITE_API !== 'http';

export const api: Api = MODO_DEMO ? mockApi : httpApi;
