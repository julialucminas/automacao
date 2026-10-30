import type { Api } from './index';

/** Implementação real: conversa com o servidor em /api. */

class ErroApi extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function chamar<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    // sessão expirou no meio do uso: volta para a tela de login
    if (r.status === 401 && url !== '/api/sessao') window.location.reload();
    throw new ErroApi(r.status, dados?.erro ?? `Erro ${r.status}`);
  }
  return dados as T;
}

export const httpApi: Api = {
  login: (email, senha) => chamar('POST', '/api/sessao', { email, senha }),
  logout: async () => {
    await chamar('DELETE', '/api/sessao');
  },
  async usuarioAtual() {
    try {
      return await chamar('GET', '/api/sessao');
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) return null;
      throw e;
    }
  },

  trocarSenha: async (atual, nova) => {
    await chamar('PUT', '/api/sessao/senha', { atual, nova });
  },

  listarClientes: () => chamar('GET', '/api/clientes'),
  salvarCliente: (input) => (input.id ? chamar('PUT', `/api/clientes/${input.id}`, input) : chamar('POST', '/api/clientes', input)),
  definirAtivo: async (id, ativo) => {
    await chamar('PATCH', `/api/clientes/${id}`, { ativo });
  },
  adicionarApelido: (id, apelido) => chamar('POST', `/api/clientes/${id}/apelidos`, { apelido }),

  listarFaturamentos: (de, ate) => chamar('GET', `/api/faturamentos?de=${de}&ate=${ate}`),
  marcarFaturado: async (clienteId, data) => {
    await chamar('POST', '/api/faturamentos', { clienteId, data });
  },
  desmarcarFaturado: async (clienteId, data) => {
    await chamar('DELETE', `/api/faturamentos/${encodeURIComponent(clienteId)}/${data}`);
  },

  listarEnvios: () => chamar('GET', '/api/envios'),
  // o envio real (SMTP + cópia em Enviados) entra na próxima etapa; o servidor responde com a explicação
  enviar: (pedido) => chamar('POST', '/api/envios', { referencia: pedido.referencia, numero: pedido.numero, clienteId: pedido.clienteId }),
  reenviar: (id) => chamar('POST', `/api/envios/${id}/reenviar`),
};
