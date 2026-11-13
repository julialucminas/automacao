import type { Api, EnvioPedido } from './index';
import type { ModeloOS, ServicoExterno } from '../types';

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
  marcarMovVistas: (ids) => chamar('POST', '/api/movimentacoes/vistas', ids ? { ids } : {}).then(() => undefined),
  listarAvisosOk: () => chamar('GET', '/api/avisos-ok'),
  darOk: (chave, obs) => chamar('POST', '/api/avisos-ok', { chave, obs: obs ?? '' }).then(() => undefined),
  desfazerOk: (chave) => chamar('POST', '/api/avisos-ok/desfazer', { chave }).then(() => undefined),
  registrarMovimentacao: (m) => chamar('POST', '/api/movimentacoes', m),
  anexarNfe: (id, arquivo, nome) => chamar('POST', `/api/movimentacoes/${id}/nfe`, { arquivo, nome }),
  listarEntregas: (f) => chamar('GET', `/api/entregas${f ? `?frota=${encodeURIComponent(f)}` : ''}`),
  salvarChecklistEntrega: (id, d) => chamar('PUT', `/api/entregas/${id}/checklist`, d),
  enviarVideoEntrega: (id, arquivo, progresso) =>
    new Promise((ok, falha) => {
      // XMLHttpRequest para mostrar o andamento (vídeo pode demorar no 4G)
      const x = new XMLHttpRequest();
      x.open('POST', `/api/entregas/${id}/video`);
      const tipo = arquivo.type || (/\.mov$/i.test(arquivo.name) ? 'video/quicktime' : 'video/mp4');
      x.setRequestHeader('Content-Type', tipo);
      x.setRequestHeader('X-Nome-Arquivo', encodeURIComponent(arquivo.name));
      x.upload.onprogress = (e) => e.lengthComputable && progresso?.(e.loaded / e.total);
      x.onload = () => {
        let d: { erro?: string } | null = null;
        try {
          d = JSON.parse(x.responseText);
        } catch {
          /* sem corpo */
        }
        if (x.status >= 200 && x.status < 300) ok(d as never);
        else falha(new ErroApi(x.status, d?.erro ?? `Erro ${x.status}`));
      };
      x.onerror = () => falha(new ErroApi(0, 'A conexão caiu durante o envio do vídeo. Tente de novo.'));
      x.send(arquivo);
    }),
  listarFotosEquip: (f) => chamar('GET', `/api/equipamentos/${encodeURIComponent(f)}/fotos`),
  enviarFotoEquip: (f, arquivo, legenda) => chamar('POST', `/api/equipamentos/${encodeURIComponent(f)}/fotos`, { arquivo, legenda }),
  apagarFotoEquip: (id) => chamar('DELETE', `/api/equipamentos/fotos/${id}`),
  lerAutentique: () => chamar('GET', '/api/integracoes/autentique'),
  salvarAutentique: (d) => chamar('PUT', '/api/integracoes/autentique', d),
  testarAutentique: () => chamar('POST', '/api/integracoes/autentique/testar'),
  mandarParaAssinar: (d) => chamar('POST', '/api/contratos/assinatura', d),
  listarEnviosContrato: () => chamar('GET', '/api/contratos/envios'),
  atualizarEnviosContrato: () => chamar('POST', '/api/contratos/envios/atualizar'),
  linkAssinatura: (id, p) => chamar('POST', `/api/contratos/envios/${id}/link/${p}`),
  reenviarAssinatura: (id) => chamar('POST', `/api/contratos/envios/${id}/reenviar`),
  cancelarAssinatura: (id) => chamar('POST', `/api/contratos/envios/${id}/cancelar`),
  listarArquivosContrato: () => chamar('GET', '/api/contratos/arquivos'),
  acompanhamentoContratos: () => chamar('GET', '/api/contratos/acompanhamento'),
  alertasContratos: () => chamar('GET', '/api/contratos/alertas'),
  registrarNoContrato: (d) => chamar('POST', '/api/contratos/registros', d),
  resolverPendenciaContrato: (id, resolucao, desfazer) => chamar('POST', `/api/contratos/registros/${id}/resolver`, { resolucao, desfazer: !!desfazer }),
  mudarStatusContrato: (d) => chamar('PUT', '/api/contratos/status', d),
  pastaCliente: (id) => chamar('GET', `/api/clientes/${id}/pasta`),
  enviarDocumentoCliente: (id, arquivo, nome, descricao) => chamar('POST', `/api/clientes/${id}/documentos`, { arquivo, nome, descricao }, 180_000),
  apagarDocumentoCliente: (id) => chamar('DELETE', `/api/clientes/documentos/${id}`),
  anexarContrato: (d) => chamar('POST', '/api/contratos/arquivos', d),
  salvarContrato: (d) => chamar('POST', '/api/contratos', d),
  lancarFaturaManual: (d) => chamar('POST', '/api/envios/manual', d),
  adicionarNotaMov: (id, texto, urgente) => chamar('POST', `/api/movimentacoes/${id}/notas`, { texto, urgente }),
  fotosMensais: () => chamar('GET', '/api/fotos-mensais'),
  tirarNfe: (id) => chamar('DELETE', `/api/movimentacoes/${id}/nfe`),
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
  listarOficina: () => chamar('GET', '/api/oficina'),
  colocarNaOficina: (frota, observacao) => chamar('POST', '/api/oficina', { frota, observacao }),
  tirarDaOficina: (frota) => chamar('DELETE', `/api/oficina/${encodeURIComponent(frota)}`),
  listarConferencia: (ref) => chamar('GET', `/api/conferencia/${ref}`),
  marcarConferencia: (ref, c) => chamar('POST', `/api/conferencia/${ref}`, c),
  desmarcarConferencia: async (ref, clienteId, frota) => {
    await chamar('POST', `/api/conferencia/${ref}/desmarcar`, { clienteId, frota });
  },

  listarEquipamentos: () => chamar('GET', '/api/equipamentos'),
  salvarEquipamento: (frota, dados) => chamar('PUT', `/api/equipamentos/${encodeURIComponent(frota)}`, { dados }),
  importarEquipamentos: (equipamentos) => chamar('POST', '/api/equipamentos/importar', { equipamentos }, 180_000),
  historicoDaFrota: (frota) => chamar('GET', `/api/equipamentos/${encodeURIComponent(frota)}/historico`),
  buscarHistorico: (q, frota) => chamar('GET', `/api/historico-pecas?q=${encodeURIComponent(q)}${frota ? `&frota=${encodeURIComponent(frota)}` : ''}`),
  gastosPorFrota: (desde) => chamar('GET', `/api/historico-pecas/por-frota?desde=${desde}`),
  resumoHistorico: () => chamar('GET', '/api/historico-pecas/resumo'),
  importarHistorico: (linhas) => chamar('POST', '/api/historico-pecas/importar', { linhas }, 300_000),
  listarPendencias: (todas) => chamar('GET', `/api/pendencias${todas ? '?todas=1' : ''}`),
  criarPendencia: (p) => chamar('POST', '/api/pendencias', p),
  resolverPendencia: (id, resolver, resolucao) => chamar('POST', `/api/pendencias/${id}/${resolver ? 'resolver' : 'reabrir'}`, { resolucao: resolucao ?? '' }),
  importarPendencias: (pendencias) => chamar('POST', '/api/pendencias/importar', { pendencias }),
  registrarVisita: (frota, v) => chamar('POST', `/api/equipamentos/${encodeURIComponent(frota)}/visita`, v),
  listarOrdens: (abertas) => chamar('GET', `/api/ordens${abertas ? '?abertas=1' : ''}`),
  buscarOrdem: (id) => chamar('GET', `/api/ordens/${id}`),
  tecnicosOS: () => chamar('GET', '/api/ordens/tecnicos'),
  criarOrdem: (o) => chamar('POST', '/api/ordens', o),
  alterarOrdem: (id, m) => chamar('PATCH', `/api/ordens/${id}`, m),
  checkinOrdem: (id, l) => chamar('POST', `/api/ordens/${id}/checkin`, l),
  salvarExecucao: (id, d) => chamar('PUT', `/api/ordens/${id}/execucao`, d),
  fotoOrdem: (id, imagem, campoId) => chamar('POST', `/api/ordens/${id}/fotos`, { imagem, ...(campoId ? { campoId } : {}) }, 120_000),
  listarModelosOS: () => chamar<{ modelos: ModeloOS[] }>('GET', '/api/modelos-os').then((r) => r.modelos),
  listarExternos: () => chamar<{ servicos: ServicoExterno[] }>('GET', '/api/externos').then((r) => r.servicos),
  criarExterno: (d) => chamar('POST', '/api/externos', d),
  alterarExterno: (id, d) => chamar('PATCH', `/api/externos/${id}`, d),
  etapaExterno: (id, etapa, obs) => chamar('POST', `/api/externos/${id}/etapa`, { etapa, obs }),
  criarModeloOS: (m) => chamar('POST', '/api/modelos-os', m),
  salvarModeloOS: (id, m) => chamar('PUT', `/api/modelos-os/${encodeURIComponent(id)}`, m),
  tirarFotoOrdem: (id, nome) => chamar('DELETE', `/api/ordens/${id}/fotos/${encodeURIComponent(nome)}`),
  assinarOrdem: (id, imagem, nome) => chamar('POST', `/api/ordens/${id}/assinatura`, { imagem, nome }),
  concluirOrdem: (id, l) => chamar('POST', `/api/ordens/${id}/concluir`, l),
  devolverOrdem: (id) => chamar('POST', `/api/ordens/${id}/devolver`),
  cancelarOrdem: (id, motivo) => chamar('POST', `/api/ordens/${id}/cancelar`, { motivo }),
  encerrarOrdem: (id, d) => chamar('POST', `/api/ordens/${id}/encerrar`, d, 180_000),
  enviarRelatorioOrdem: (id, pdf, para) => chamar('POST', `/api/ordens/${id}/relatorio`, { pdf, ...(para ? { para } : {}) }, 180_000),
  listarPerfis: async () => (await chamar<{ perfis: import('../types').PerfilAcesso[] }>('GET', '/api/perfis')).perfis,
  criarPerfil: (p) => chamar('POST', '/api/perfis', p),
  salvarPerfil: (p) => chamar('PUT', `/api/perfis/${encodeURIComponent(p.id)}`, p),
  apagarPerfil: async (id) => {
    await chamar('DELETE', `/api/perfis/${encodeURIComponent(id)}`);
  },
  listarUsuariosAdmin: () => chamar('GET', '/api/admin/usuarios'),
  listarCopias: () => chamar('GET', '/api/admin/copias'),
  criarUsuario: (u) => chamar('POST', '/api/admin/usuarios', u),
  alterarUsuario: (id, m) => chamar('PATCH', `/api/admin/usuarios/${id}`, m),

  listarEnvios: () => chamar('GET', '/api/envios'),
  // o envio real (SMTP + cópia em Enviados) entra na próxima etapa; o servidor responde com a explicação
  enviar: async (pedido) => chamar('POST', '/api/envios', await corpoEnvio(pedido), 180_000),
  testarEnvio: async (pedido) => chamar('POST', '/api/envios/teste', await corpoEnvio(pedido), 180_000),
  situacaoEnvio: () => chamar('GET', '/api/envio/situacao'),
  verificarCaixa: () => chamar('POST', '/api/envios/verificar', undefined, 240_000),
  reenviar: (id) => chamar('POST', `/api/envios/${id}/reenviar`, undefined, 180_000),
  copiarEnviados: (id) => chamar('POST', `/api/envios/${id}/copiar`, undefined, 180_000),
};
