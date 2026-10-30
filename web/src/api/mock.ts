import type { Api } from './index';
import type { Cliente, Conferencia, Envio, Faturamento, Solicitacao, Usuario } from '../types';
import { REMETENTE } from '../lib/email';

/*
 * Implementação SIMULADA da API, só para desenvolvimento da interface.
 * Guarda clientes e histórico no navegador. Nenhum e-mail sai daqui.
 */

const CHAVE = 'lucminas-faturas:v1';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const id = () => Math.random().toString(36).slice(2, 10);

type Banco = { clientes: Cliente[]; envios: Envio[]; usuario: Usuario | null; faturamentos?: Faturamento[]; solicitacoes?: Solicitacao[] };

function dias(n: number, h = 9, m = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function semente(): Banco {
  const c = (
    nome: string,
    para: string[],
    cc: string[],
    observacoes = '',
    apelidos: string[] = [],
    atualizado = 30,
  ): Cliente => ({ id: id(), nome, apelidos, cnpj: '', para, cc, observacoes, regra: 'dia', diaEmissao: null, inicioLocacao: null, periodoDias: null, frotas: [], ativo: true, atualizadoEm: dias(atualizado) });

  const clientes = [
    c('METALURGICA SERRA AZUL', ['financeiro@serraazul.exemplo.br'], ['compras@serraazul.exemplo.br', 'contabil@moura.exemplo.br'], 'Sempre com cópia para o contador.', ['SERRA AZUL'], 40),
    c('TRANSPORTADORA PARAOPEBA', ['contasapagar@paraopeba.exemplo.br'], [], '', [], 80),
    c('CONSTRUTORA ALTO VALE', ['adm@altovale.exemplo.br', 'obra.betim@altovale.exemplo.br'], ['diretoria@altovale.exemplo.br'], 'Duas obras ativas: a fatura vai para os dois endereços.', [], 25),
    c('DISTRIBUIDORA MINAS FORTE', ['financeiro@minasforte.exemplo.br'], [], 'Costuma dizer que não recebeu. Conferir o histórico antes de cobrar.', [], 100),
    c('LATICÍNIOS BOA ESPERANÇA', ['nf@boaesperanca.exemplo.br'], ['gerencia@boaesperanca.exemplo.br'], '', [], 140),
    c('CERÂMICA SANTA LUZIA', ['financeiro@santaluzia.exemplo.br'], [], 'Às vezes paga por depósito: confirmar a baixa.', [], 60),
  ];
  const [serra, paraopeba, altovale, minasforte, , santaluzia] = clientes;

  const e = (
    cli: Cliente,
    numero: string,
    quando: string,
    status: Envio['status'],
    detalhe: string,
  ): Envio => ({
    id: id(),
    enviadoEm: quando,
    referencia: '2026-09',
    numero,
    clienteId: cli.id,
    clienteNome: cli.nome,
    para: cli.para,
    cc: cli.cc,
    assunto: `Fatura de locação nº ${numero} · Lucminas Empilhadeiras`,
    anexos: [`${numero} ${cli.nome}.PDF`, `BOLETO ${numero}.PDF`],
    messageId: `<${id()}.${numero}@lucminas.com.br>`,
    copiaEmEnviados: true,
    pediuLeitura: true,
    status,
    detalhe,
    observacao: '',
  });

  const envios = [
    e(paraopeba, '1223', dias(26, 9, 14), 'enviado', 'Aceito pelo UOL · sem devolução'),
    e(santaluzia, '1222', dias(26, 9, 14), 'enviado', 'Aceito pelo UOL · sem devolução'),
    e(altovale, '1221', dias(26, 9, 13), 'devolvido', 'obra.betim@altovale.exemplo.br não existe (aviso recebido 3 min depois)'),
    e(minasforte, '1220', dias(26, 9, 13), 'lido', `Confirmação de leitura recebida em ${new Date(dias(25, 15, 42)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`),
    e(serra, '1219', dias(26, 9, 12), 'enviado', 'Aceito pelo UOL · sem devolução'),
  ];

  return { clientes, envios, usuario: null };
}

let memoria: Banco | null = null;

function carregar(): Banco {
  if (memoria) return memoria;
  try {
    const raw = localStorage.getItem(CHAVE);
    if (raw) memoria = JSON.parse(raw) as Banco;
  } catch {
    /* navegador sem storage: segue só em memória */
  }
  if (!memoria) memoria = semente();
  return memoria;
}

function salvar(b: Banco) {
  memoria = b;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(b));
  } catch {
    /* idem */
  }
}

/** Para a demonstração: alguns endereços "não existem" e geram devolução. */
const ENDERECO_QUE_DEVOLVE = /obra\.betim@|naoexiste@/i;

export const mockApi: Api = {
  async login(email, senha) {
    await espera(400);
    if (!email.trim() || !senha) throw new Error('Informe e-mail e senha.');
    const usuario = { id: 1, nome: email.split('@')[0], email: email.trim().toLowerCase(), perfil: 'financeiro' as const };
    salvar({ ...carregar(), usuario });
    return usuario;
  },
  async logout() {
    salvar({ ...carregar(), usuario: null });
  },
  async trocarSenha(_atual, nova) {
    await espera(300);
    if (nova.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  },
  async usuarioAtual() {
    return carregar().usuario;
  },

  async listarClientes() {
    await espera(120);
    return [...carregar().clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  async salvarCliente(input) {
    await espera(40);
    const b = carregar();
    const agora = new Date().toISOString();
    let salvo: Cliente;
    if (input.id) {
      const atual = b.clientes.find((c) => c.id === input.id);
      if (!atual) throw new Error('Cliente não encontrado.');
      salvo = {
        ...atual,
        ...input,
        diaEmissao: input.diaEmissao === undefined ? atual.diaEmissao : input.diaEmissao,
        frotas: input.frotas ?? atual.frotas,
        regra: input.regra ?? atual.regra,
        inicioLocacao: input.inicioLocacao === undefined ? atual.inicioLocacao : input.inicioLocacao,
        periodoDias: input.periodoDias === undefined ? atual.periodoDias : input.periodoDias,
        id: atual.id,
        atualizadoEm: agora,
      };
      salvar({ ...b, clientes: b.clientes.map((c) => (c.id === salvo.id ? salvo : c)) });
    } else {
      salvo = {
        ...input,
        diaEmissao: input.diaEmissao ?? null,
        frotas: input.frotas ?? [],
        regra: input.regra ?? 'dia',
        inicioLocacao: input.inicioLocacao ?? null,
        periodoDias: input.periodoDias ?? null,
        id: id(),
        ativo: true,
        criadoEm: agora,
        atualizadoEm: agora,
      };
      salvar({ ...b, clientes: [...b.clientes, salvo] });
    }
    return salvo;
  },
  async definirAtivo(cid, ativo) {
    const b = carregar();
    salvar({ ...b, clientes: b.clientes.map((c) => (c.id === cid ? { ...c, ativo } : c)) });
  },
  async adicionarApelido(cid, apelido) {
    const b = carregar();
    const c = b.clientes.find((x) => x.id === cid);
    if (!c) throw new Error('Cliente não encontrado.');
    const novo = { ...c, apelidos: c.apelidos.includes(apelido) ? c.apelidos : [...c.apelidos, apelido] };
    salvar({ ...b, clientes: b.clientes.map((x) => (x.id === cid ? novo : x)) });
    return novo;
  },

  async listarFaturamentos(de, ate) {
    await espera(80);
    return (carregar().faturamentos ?? []).filter((f) => f.data >= de && f.data <= ate);
  },
  async marcarFaturado(clienteId, data) {
    const b = carregar();
    const l = b.faturamentos ?? [];
    if (!l.some((f) => f.clienteId === clienteId && f.data === data))
      l.push({ clienteId, data, marcadoEm: new Date().toISOString(), marcadoPor: b.usuario?.nome ?? '', origem: 'manual' });
    salvar({ ...b, faturamentos: l });
  },
  async desmarcarFaturado(clienteId, data) {
    const b = carregar();
    salvar({ ...b, faturamentos: (b.faturamentos ?? []).filter((f) => !(f.clienteId === clienteId && f.data === data)) });
  },
  // demonstração: um único usuário "conversa" consigo mesmo
  async listarUsuarios() {
    const u = carregar().usuario;
    return u ? [{ id: 1, nome: u.nome, chamar: u.chamar ?? '', email: u.email }] : [];
  },
  async listarSolicitacoes() {
    return (carregar().solicitacoes ?? []).map((s) => ({ ...s, mensagens: undefined }));
  },
  async abrirSolicitacao(sid) {
    const s = (carregar().solicitacoes ?? []).find((x) => x.id === sid);
    if (!s) throw new Error('Solicitação não encontrada.');
    return s;
  },
  async criarSolicitacao(n) {
    const b = carregar();
    const agora = new Date().toISOString();
    const nome = b.usuario?.nome ?? '';
    const cli = b.clientes.find((c) => c.id === n.clienteId);
    const s: Solicitacao = {
      id: id(), criadaEm: agora, criadaPor: 1, criadaPorNome: nome, paraUsuario: n.paraUsuario, paraNome: nome, data: n.data,
      clienteId: n.clienteId, clienteNome: cli?.nome ?? (n.clienteNome?.trim() || null), titulo: n.titulo, status: 'aberta', concluidaEm: null, concluidaPorNome: null,
      totalMensagens: n.texto ? 1 : 0, naoLidas: 0, ultimaMensagemEm: agora,
      mensagens: n.texto ? [{ id: 1, usuarioId: 1, autor: nome, texto: n.texto, criadaEm: agora }] : [],
    };
    salvar({ ...b, solicitacoes: [...(b.solicitacoes ?? []), s] });
    return s;
  },
  async responderSolicitacao(sid, texto) {
    const b = carregar();
    const agora = new Date().toISOString();
    const l = (b.solicitacoes ?? []).map((s) =>
      s.id === sid ? { ...s, totalMensagens: s.totalMensagens + 1, ultimaMensagemEm: agora, mensagens: [...(s.mensagens ?? []), { id: Date.now(), usuarioId: 1, autor: b.usuario?.nome ?? '', texto, criadaEm: agora }] } : s,
    );
    salvar({ ...b, solicitacoes: l });
    return l.find((s) => s.id === sid)!;
  },
  async alterarSolicitacao(sid, m) {
    const b = carregar();
    const l = (b.solicitacoes ?? []).map((s) =>
      s.id === sid ? { ...s, ...(m.data ? { data: m.data } : {}), ...(m.status ? { status: m.status, concluidaEm: m.status === 'concluida' ? new Date().toISOString() : null, concluidaPorNome: m.status === 'concluida' ? b.usuario?.nome ?? '' : null } : {}) } : s,
    );
    salvar({ ...b, solicitacoes: l });
    return l.find((s) => s.id === sid)!;
  },
  // demonstração: movimentações/propostas/registro simplificados (o real fica no servidor)
  async listarMovimentacoes() {
    return [];
  },
  async registrarMovimentacao() {
    throw new Error('Movimentações só funcionam no sistema (faturas.lucminas.com.br).');
  },
  async decidirMovimentacao() {
    throw new Error('Indisponível na demonstração.');
  },
  async listarPropostas() {
    return [];
  },
  async proporAlteracao() {},
  async decidirProposta() {},
  async lerConfig() {
    return { ...CONFIG_DEMO };
  },
  async salvarConfig(c) {
    Object.assign(CONFIG_DEMO, c);
    return { ...CONFIG_DEMO };
  },
  async listarRegistro() {
    return [];
  },
  async listarConferencia(ref) {
    return CONFERENCIAS_DEMO.filter((c) => c.referencia === ref);
  },
  async marcarConferencia(ref, c) {
    const i = CONFERENCIAS_DEMO.findIndex((x) => x.referencia === ref && x.clienteId === c.clienteId && x.frota === c.frota);
    if (i >= 0) CONFERENCIAS_DEMO.splice(i, 1);
    const f = carregar().clientes.find((x) => x.id === c.clienteId)?.frotas.find((x) => x.numero === c.frota);
    const nova = { referencia: ref, clienteId: c.clienteId, frota: c.frota, status: c.status, valor: f?.valor ?? 0, descricao: f?.descricao ?? '', observacao: c.observacao ?? '', quando: new Date().toISOString(), usuario: 'Demonstração' };
    CONFERENCIAS_DEMO.push(nova);
    return nova;
  },
  async desmarcarConferencia(ref, clienteId, frota) {
    const i = CONFERENCIAS_DEMO.findIndex((x) => x.referencia === ref && x.clienteId === clienteId && x.frota === frota);
    if (i >= 0) CONFERENCIAS_DEMO.splice(i, 1);
  },
  async listarEnvios() {
    await espera(120);
    return [...carregar().envios].sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm));
  },
  async enviar(p) {
    await espera(350 + Math.random() * 300);
    const b = carregar();
    const cli = b.clientes.find((c) => c.id === p.clienteId);
    if (!cli) throw new Error('Cliente não encontrado.');
    const devolve = [...cli.para, ...cli.cc].find((e) => ENDERECO_QUE_DEVOLVE.test(e));
    const envio: Envio = {
      id: id(),
      enviadoEm: new Date().toISOString(),
      referencia: p.referencia,
      numero: p.numero,
      clienteId: cli.id,
      clienteNome: cli.nome,
      para: [...cli.para],
      cc: [...cli.cc],
      assunto: p.assunto,
      anexos: p.anexos.map((a) => a.nome),
      messageId: `<${id()}.${p.numero}@lucminas.com.br>`,
      copiaEmEnviados: true,
      pediuLeitura: p.pediuLeitura,
      status: devolve ? 'devolvido' : 'enviado',
      detalhe: devolve ? `${devolve} não existe (simulação de devolução)` : `Aceito pelo UOL · cópia salva em Enviados de ${REMETENTE}`,
      observacao: p.observacao,
    };
    salvar({ ...b, envios: [envio, ...b.envios] });
    return envio;
  },
  async testarEnvio(p) {
    await espera(600);
    const u = carregar().usuario;
    return { ok: true, para: u?.email ?? 'voce@exemplo.com', copiaEmEnviados: true, detalhe: `Demonstração: nada foi enviado de verdade (${p.anexos.length} anexos).` };
  },
  async situacaoEnvio() {
    return { configurado: false, conta: null };
  },
  async reenviar(envioId) {
    await espera(500);
    const b = carregar();
    const orig = b.envios.find((e) => e.id === envioId);
    if (!orig) throw new Error('Envio não encontrado.');
    // reenvio usa os e-mails ATUAIS do cadastro (que a pessoa provavelmente acabou de corrigir)
    const cli = b.clientes.find((c) => c.id === orig.clienteId);
    const para = cli?.para ?? orig.para;
    const cc = cli?.cc ?? orig.cc;
    const devolve = [...para, ...cc].find((e) => ENDERECO_QUE_DEVOLVE.test(e));
    const novo: Envio = {
      ...orig,
      id: id(),
      enviadoEm: new Date().toISOString(),
      para,
      cc,
      messageId: `<${id()}.${orig.numero}@lucminas.com.br>`,
      status: devolve ? 'devolvido' : 'enviado',
      detalhe: devolve ? `${devolve} não existe (simulação de devolução)` : `Reenvio aceito pelo UOL · cópia salva em Enviados`,
    };
    salvar({ ...b, envios: [novo, ...b.envios] });
    return novo;
  },
};

/** Apaga os clientes e envios fictícios (e-mails @*.exemplo.br), mantendo o que foi importado. */
export function apagarExemplos() {
  const b = carregar();
  const ficticio = (e: string) => /\.exemplo\.br$/.test(e);
  const clientes = b.clientes.filter((c) => ![...c.para, ...c.cc].every(ficticio));
  const ids = new Set(clientes.map((c) => c.id));
  salvar({ ...b, clientes, envios: b.envios.filter((e) => e.clienteId && ids.has(e.clienteId)) });
}

export function temExemplos(): boolean {
  return carregar().clientes.some((c) => [...c.para, ...c.cc].every((e) => /\.exemplo\.br$/.test(e)));
}

const CONFERENCIAS_DEMO: Conferencia[] = [];

const CONFIG_DEMO = {
  'email.remetente': 'Financeiro · Lucminas Empilhadeiras',
  'email.assunto': 'Fatura de locação nº {numero} · Lucminas Empilhadeiras',
  'email.corpo':
    'Prezados,\n\nSegue em anexo a fatura de locação nº {numero}, referente a {mes}, e o boleto para pagamento.\n\nEm caso de dúvida, é só responder este e-mail.\n\nAtenciosamente,\nFinanceiro · Lucminas Empilhadeiras',
};

/** Volta os dados de demonstração ao estado inicial. */
export function resetarDemo() {
  memoria = semente();
  salvar(memoria);
}
