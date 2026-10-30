import type { Api, EnvioPedido } from './index';

/** Implementação real: conversa com o servidor em /api. */

class ErroApi extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function chamar<T>(metodo: string, url: string, corpo?: unknown, prazoMs = 60_000): Promise<T> {
  let r: Response;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), prazoMs);
  try {
    r = await fetch(url, {
      signal: ctrl.signal,
      method: metodo,
      credentials: 'same-origin',
      headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    clearTimeout(t);
    if (ctrl.signal.aborted) throw new ErroApi(0, 'O servidor demorou demais para responder. Confira no Histórico se o e-mail saiu antes de tentar de novo.');
    throw new ErroApi(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  clearTimeout(t);
  const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    // sessão expirou no meio do uso: volta para a tela de login
    if (r.status === 401 && url !== '/api/sessao') window.location.reload();
    throw new ErroApi(r.status, dados?.erro ?? `Erro ${r.status}`);
  }
  return dados as T;
}

/** Blob → base64 (sem o prefixo data:). */
async function paraBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function corpoEnvio(p: EnvioPedido) {
  return {
    referencia: p.referencia,
    numero: p.numero,
    clienteId: p.clienteId,
    assunto: p.assunto,
    corpo: p.corpo,
    pediuLeitura: p.pediuLeitura,
    observacao: p.observacao,
    dataFaturamento: p.dataFaturamento ?? null,
    anexos: await Promise.all(p.anexos.map(async (a) => ({ nome: a.nome, base64: await paraBase64(a.blob) }))),
  };
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

  listarUsuarios: () => chamar('GET', '/api/usuarios'),
  listarSolicitacoes: () => chamar('GET', '/api/solicitacoes'),
  abrirSolicitacao: (id) => chamar('GET', `/api/solicitacoes/${id}`),
  criarSolicitacao: (s) => chamar('POST', '/api/solicitacoes', s),
  responderSolicitacao: (id, texto) => chamar('POST', `/api/solicitacoes/${id}/mensagens`, { texto }),
  alterarSolicitacao: (id, mudanca) => chamar('PATCH', `/api/solicitacoes/${id}`, mudanca),

  listarMovimentacoes: () => chamar('GET', '/api/movimentacoes'),
  registrarMovimentacao: (m) => chamar('POST', '/api/movimentacoes', m),
  decidirMovimentacao: (id, aprovar, motivo) => chamar('POST', `/api/movimentacoes/${id}/${aprovar ? 'aprovar' : 'recusar'}`, { motivo: motivo ?? '' }),
  listarPropostas: () => chamar('GET', '/api/propostas'),
  proporAlteracao: async (input) => {
    await chamar('POST', '/api/propostas', input);
  },
  decidirProposta: async (id, aprovar, motivo) => {
    await chamar('POST', `/api/propostas/${id}/${aprovar ? 'aprovar' : 'recusar'}`, { motivo: motivo ?? '' });
  },
  lerConfig: () => chamar('GET', '/api/config'),
  salvarConfig: (c) => chamar('PUT', '/api/config', c),
  listarRegistro: () => chamar('GET', '/api/registro'),
  listarConferencia: (ref) => chamar('GET', `/api/conferencia/${ref}`),
  marcarConferencia: (ref, c) => chamar('POST', `/api/conferencia/${ref}`, c),
  desmarcarConferencia: async (ref, clienteId, frota) => {
    await chamar('POST', `/api/conferencia/${ref}/desmarcar`, { clienteId, frota });
  },

  listarEnvios: () => chamar('GET', '/api/envios'),
  // o envio real (SMTP + cópia em Enviados) entra na próxima etapa; o servidor responde com a explicação
  enviar: async (pedido) => chamar('POST', '/api/envios', await corpoEnvio(pedido), 180_000),
  testarEnvio: async (pedido) => chamar('POST', '/api/envios/teste', await corpoEnvio(pedido), 180_000),
  situacaoEnvio: () => chamar('GET', '/api/envio/situacao'),
  verificarCaixa: () => chamar('POST', '/api/envios/verificar', undefined, 240_000),
  reenviar: (id) => chamar('POST', `/api/envios/${id}/reenviar`, undefined, 180_000),
  copiarEnviados: (id) => chamar('POST', `/api/envios/${id}/copiar`, undefined, 180_000),
};
