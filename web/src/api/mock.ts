import type { Api } from './index';
import type { Cliente, Conferencia, Envio, FrotaOficina, Faturamento, Solicitacao, Usuario } from '../types';
import { REMETENTE } from '../lib/email';
import { PERFIS_PADRAO } from '../lib/acesso';
import type { AvisoOk, Equipamento, ModeloOS, ServicoExterno, Ordem, PecaHistorico, Pendencia, PerfilAcesso, UsuarioAdmin } from '../types';

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
  const c = (nome: string, para: string[], cc: string[], observacoes = '', apelidos: string[] = [], atualizado = 30): Cliente => ({
    id: id(),
    nome,
    apelidos,
    cnpj: '',
    para,
    cc,
    observacoes,
    regra: 'dia',
    diaEmissao: null,
    inicioLocacao: null,
    periodoDias: null,
    frotas: [],
    ativo: true,
    atualizadoEm: dias(atualizado),
  });

  const clientes = [
    c(
      'METALURGICA SERRA AZUL',
      ['financeiro@serraazul.exemplo.br'],
      ['compras@serraazul.exemplo.br', 'contabil@moura.exemplo.br'],
      'Sempre com cópia para o contador.',
      ['SERRA AZUL'],
      40,
    ),
    c('TRANSPORTADORA PARAOPEBA', ['contasapagar@paraopeba.exemplo.br'], [], '', [], 80),
    c(
      'CONSTRUTORA ALTO VALE',
      ['adm@altovale.exemplo.br', 'obra.betim@altovale.exemplo.br'],
      ['diretoria@altovale.exemplo.br'],
      'Duas obras ativas: a fatura vai para os dois endereços.',
      [],
      25,
    ),
    c('DISTRIBUIDORA MINAS FORTE', ['financeiro@minasforte.exemplo.br'], [], 'Costuma dizer que não recebeu. Conferir o histórico antes de cobrar.', [], 100),
    c('LATICÍNIOS BOA ESPERANÇA', ['nf@boaesperanca.exemplo.br'], ['gerencia@boaesperanca.exemplo.br'], '', [], 140),
    c('CERÂMICA SANTA LUZIA', ['financeiro@santaluzia.exemplo.br'], [], 'Às vezes paga por depósito: confirmar a baixa.', [], 60),
  ];
  const [serra, paraopeba, altovale, minasforte, , santaluzia] = clientes;

  const e = (cli: Cliente, numero: string, quando: string, status: Envio['status'], detalhe: string): Envio => ({
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
    e(
      minasforte,
      '1220',
      dias(26, 9, 13),
      'lido',
      `Confirmação de leitura recebida em ${new Date(dias(25, 15, 42)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
    ),
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

const EQUIP_DEMO = new Map<string, Equipamento>();
let HIST_DEMO: PecaHistorico[] = [];
let PEND_DEMO: Pendencia[] = [];
let EXTERNOS_DEMO: ServicoExterno[] = [];
let AVISOS_DEMO: AvisoOk[] = [];
let OS_VISTAS: string[] = [];
let MODELOS_DEMO: ModeloOS[] = [
  {
    id: 'padrao-corretiva',
    nome: 'Corretiva',
    descricao: 'Quando o cliente chama',
    tipoBase: 'corretiva',
    campos: [
      { id: 'defeito', rotulo: 'Defeito encontrado', tipo: 'textoLongo', obrigatorio: true },
      { id: 'parada', rotulo: 'Máquina estava parada?', tipo: 'simnao', obrigatorio: true },
      { id: 'foto', rotulo: 'Foto do defeito', tipo: 'foto', obrigatorio: false },
    ],
    exigeHorimetro: true,
    exigeAssinatura: true,
    fotosMinimas: 0,
    ativo: true,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: '',
  },
];
let OS_DEMO: Ordem[] = [];
const CHECK_DEMO = ['Garfos e correntes', 'Freio de serviço', 'Freio de estacionamento', 'Buzina', 'Luzes e giroflex', 'Alarme de ré', 'Vazamentos (óleo, água, gás)', 'Pneus'];
const mudarOS = (oid: string, m: (o: Ordem) => Ordem) => {
  OS_DEMO = OS_DEMO.map((o) => (o.id === oid ? { ...m(o), atualizadaEm: new Date().toISOString() } : o));
  return OS_DEMO.find((o) => o.id === oid)!;
};

// demonstração: perfis e usuários ficam só na memória desta aba
let PERFIS_DEMO: PerfilAcesso[] = PERFIS_PADRAO.map((p) => ({ ...p, permissoes: { ...p.permissoes } }));
let USUARIOS_DEMO: UsuarioAdmin[] = [
  { id: 2, email: 'financeiro@exemplo.com', nome: 'Pessoa do financeiro', chamar: '', perfil: 'financeiro', ativo: true },
  { id: 3, email: 'operacoes@exemplo.com', nome: 'Pessoa da operação', chamar: '', perfil: 'operacoes', ativo: true },
];
/** perfil e permissões do usuário da demonstração (administrador) */
function comAcesso(u: Usuario): Usuario {
  const p = PERFIS_DEMO.find((x) => x.id === (u.perfil === 'financeiro' || !u.perfil ? 'admin' : u.perfil)) ?? PERFIS_DEMO[0];
  return { ...u, perfil: p.id, perfilNome: p.nome, permissoes: p.permissoes, veValores: p.veValores };
}

export const mockApi: Api = {
  async login(email, senha) {
    await espera(400);
    if (!email.trim() || !senha) throw new Error('Informe e-mail e senha.');
    const usuario = comAcesso({ id: 1, nome: email.split('@')[0], email: email.trim().toLowerCase(), perfil: 'admin' });
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
    const u = carregar().usuario;
    return u ? comAcesso(u) : null;
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
  // demonstração: fichas e histórico só na memória desta aba
  async listarEquipamentos() {
    return [...EQUIP_DEMO.values()];
  },
  async salvarEquipamento(frota, dados) {
    const atual = EQUIP_DEMO.get(frota) ?? { frota, atualizadoEm: '', atualizadoPor: '' };
    const novo = { ...atual, ...dados, atualizadoEm: new Date().toISOString(), atualizadoPor: 'Demonstração' };
    EQUIP_DEMO.set(frota, novo);
    return novo;
  },
  async importarEquipamentos(lista) {
    let novos = 0;
    for (const { frota, dados } of lista) {
      if (!EQUIP_DEMO.has(frota)) novos++;
      const limpos = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null));
      EQUIP_DEMO.set(frota, {
        ...(EQUIP_DEMO.get(frota) ?? { frota, atualizadoEm: '', atualizadoPor: '' }),
        ...limpos,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: 'Demonstração',
      });
    }
    return { novos, atualizados: lista.length - novos, iguais: 0 };
  },
  async historicoDaFrota(frota) {
    return HIST_DEMO.filter((p) => p.frota === frota);
  },
  async buscarHistorico(q, frota) {
    const ps = q
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    return HIST_DEMO.filter(
      (p) =>
        (!frota || p.frota === frota) &&
        ps.every((x) =>
          `${p.descricao} ${p.codigo} ${p.pendencia} ${p.cliente} ${p.tecnico}`
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .includes(x),
        ),
    );
  },
  async gastosPorFrota(desde) {
    const m = new Map<string, { frota: string; total: number; lancamentos: number; dias: Set<string>; ultima: string }>();
    for (const p of HIST_DEMO)
      if (p.frota && p.data >= desde) {
        const x = m.get(p.frota) ?? { frota: p.frota, total: 0, lancamentos: 0, ultima: '', dias: new Set<string>() };
        x.total += p.valorTotal;
        x.lancamentos++;
        x.dias.add(p.data);
        x.ultima = p.data > x.ultima ? p.data : x.ultima;
        m.set(p.frota, x);
      }
    return [...m.values()].map((x) => ({ frota: x.frota, total: x.total, lancamentos: x.lancamentos, ultima: x.ultima, visitas: x.dias.size })).sort((a, b) => b.total - a.total);
  },
  async resumoHistorico() {
    return HIST_DEMO.length ? [{ origem: 'auvo', linhas: HIST_DEMO.length, de: HIST_DEMO[HIST_DEMO.length - 1].data, ate: HIST_DEMO[0].data }] : [];
  },
  async importarHistorico(linhas) {
    HIST_DEMO = linhas.map((l, i) => ({ ...l, id: i + 1 })).sort((a, b) => b.data.localeCompare(a.data));
    return { linhas: linhas.length };
  },
  async listarPendencias(todas) {
    return PEND_DEMO.filter((p) => todas || p.status === 'aberta');
  },
  async criarPendencia(p) {
    const n: Pendencia = { ...p, id: Date.now(), status: 'aberta', resolvidaEm: null, resolvidaPor: '', resolucao: '', origem: 'sistema' };
    PEND_DEMO = [n, ...PEND_DEMO];
    return n;
  },
  async resolverPendencia(pid, resolver, resolucao) {
    PEND_DEMO = PEND_DEMO.map((p) =>
      p.id === pid
        ? {
            ...p,
            status: resolver ? 'resolvida' : 'aberta',
            resolucao: resolucao ?? '',
            resolvidaEm: resolver ? new Date().toISOString() : null,
            resolvidaPor: resolver ? 'Demonstração' : '',
          }
        : p,
    );
    return PEND_DEMO.find((p) => p.id === pid)!;
  },
  async importarPendencias(lista) {
    PEND_DEMO = [
      ...PEND_DEMO.filter((p) => p.origem !== 'planilha'),
      ...lista.map((p, i) => ({ ...p, id: i + 1, status: 'aberta' as const, resolvidaEm: null, resolvidaPor: '', resolucao: '', origem: 'planilha' })),
    ];
    return { abertas: lista.length, jaResolvidas: 0 };
  },
  async registrarVisita(frota, v) {
    return mockApi.salvarEquipamento(frota, {
      ultimaVisita: v.data,
      ...(v.horimetro !== null ? { horimetro: v.horimetro, horimetroEm: v.data } : {}),
      ...(v.proximaPreventiva !== null ? { proximaPreventiva: v.proximaPreventiva } : {}),
    });
  },
  // demonstração: ordens de serviço só na memória desta aba
  async listarOrdens(abertas) {
    return OS_DEMO.filter((o) => !abertas || !['encerrada', 'cancelada'].includes(o.status));
  },
  async buscarOrdem(oid) {
    const o = OS_DEMO.find((x) => x.id === oid);
    if (!o) throw new Error('Ordem de serviço não encontrada.');
    return o;
  },
  async tecnicosOS() {
    return [{ id: 1, nome: carregar().usuario?.nome ?? 'Você', chamar: '', escritorio: true }];
  },
  async criarOrdem(n) {
    const agora = new Date().toISOString();
    const o: Ordem = {
      id: id(),
      numero: OS_DEMO.length + 1,
      frota: n.frota.replace(/^FT\s*/i, ''),
      clienteId: n.clienteId ?? null,
      clienteNome: n.clienteNome ?? '',
      tipo: MODELOS_DEMO.find((x) => x.id === n.modeloId)?.tipoBase ?? n.tipo ?? 'corretiva',
      tipoVisita: n.tipoVisita ?? '',
      status: n.tecnicoId && n.agendadaPara ? 'agendada' : 'aberta',
      tecnicoId: n.tecnicoId ?? null,
      tecnicoNome: n.tecnicoId ? (carregar().usuario?.nome ?? '') : '',
      agendadaPara: n.agendadaPara ?? null,
      descricao: n.descricao ?? '',
      pendenciaId: n.pendenciaId ?? null,
      execucao: (() => {
        const m = MODELOS_DEMO.find((x) => x.id === n.modeloId);
        return m
          ? { formulario: { modeloId: m.id, nome: m.nome, campos: m.campos, exigeHorimetro: m.exigeHorimetro, exigeAssinatura: m.exigeAssinatura, fotosMinimas: m.fotosMinimas }, respostas: {} }
          : { checklist: CHECK_DEMO.map((item) => ({ item, resposta: '', obs: '' })) };
      })(),
      criadaPor: 'Demonstração',
      criadaEm: agora,
      atualizadaEm: agora,
      concluidaEm: null,
      encerradaEm: null,
      encerradaPor: '',
      relatorioPara: '',
      relatorioEm: null,
      cancelamento: '',
    };
    OS_DEMO = [o, ...OS_DEMO];
    return o;
  },
  async alterarOrdem(oid, m) {
    return mudarOS(oid, (o) => {
      const n = { ...o, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) } as Ordem;
      if (n.tecnicoId) n.tecnicoNome = carregar().usuario?.nome ?? '';
      if (n.status === 'aberta' && n.tecnicoId && n.agendadaPara) n.status = 'agendada';
      return n;
    });
  },
  async checkinOrdem(oid, l) {
    return mudarOS(oid, (o) => ({
      ...o,
      status: 'execucao',
      execucao: { ...o.execucao, checkin: o.execucao.checkin ?? { em: new Date().toISOString(), lat: l.lat ?? null, lng: l.lng ?? null, precisao: l.precisao ?? null } },
    }));
  },
  async salvarExecucao(oid, d) {
    const { aguardandoPeca, ...resto } = d;
    return mudarOS(oid, (o) => ({
      ...o,
      status: aguardandoPeca === true ? 'aguardando_peca' : aguardandoPeca === false && o.status === 'aguardando_peca' ? 'execucao' : o.status,
      execucao: {
        ...o.execucao,
        ...Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)),
        ...(resto.respostas ? { respostas: { ...(o.execucao.respostas ?? {}), ...resto.respostas } } : {}),
      },
    }));
  },
  async fotoOrdem(oid, _img, campoId) {
    const nome = `foto-${Date.now()}.jpg`;
    return mudarOS(oid, (o) =>
      campoId
        ? { ...o, execucao: { ...o.execucao, respostas: { ...(o.execucao.respostas ?? {}), [campoId]: [...((o.execucao.respostas?.[campoId] as string[] | undefined) ?? []), nome] } } }
        : { ...o, execucao: { ...o.execucao, fotos: [...(o.execucao.fotos ?? []), nome] } },
    );
  },
  async marcarMovVistas(ids) {
    OS_VISTAS = ids ? [...OS_VISTAS, ...ids] : ['*'];
  },
  async listarAvisosOk() {
    return AVISOS_DEMO;
  },
  async darOk(chave, obs) {
    AVISOS_DEMO = [...AVISOS_DEMO.filter((a) => a.chave !== chave), { chave, obs: obs ?? '', feitoEm: new Date().toISOString(), feitoPor: 'Demonstração' }];
  },
  async desfazerOk(chave) {
    AVISOS_DEMO = AVISOS_DEMO.filter((a) => a.chave !== chave);
  },
  async listarExternos() {
    return EXTERNOS_DEMO;
  },
  async criarExterno(d) {
    const agora = new Date().toISOString();
    const s: ServicoExterno = {
      id: EXTERNOS_DEMO.length + 1,
      clienteId: null,
      clienteNome: '',
      contato: '',
      equipamento: '',
      descricao: '',
      valor: null,
      responsavelId: null,
      osNumero: null,
      previsao: null,
      obs: '',
      ...d,
      etapa: 'pedido',
      responsavelNome: '',
      historico: [{ etapa: 'pedido', em: agora, por: 'Demonstração', obs: '' }],
      criadoPor: 'Demonstração',
      criadoEm: agora,
      atualizadoEm: agora,
    };
    EXTERNOS_DEMO = [s, ...EXTERNOS_DEMO];
    return s;
  },
  async alterarExterno(eid, d) {
    EXTERNOS_DEMO = EXTERNOS_DEMO.map((s) => (s.id === eid ? { ...s, ...d, atualizadoEm: new Date().toISOString() } : s));
    return EXTERNOS_DEMO.find((s) => s.id === eid)!;
  },
  async etapaExterno(eid, etapa, obs) {
    const em = new Date().toISOString();
    EXTERNOS_DEMO = EXTERNOS_DEMO.map((s) => (s.id === eid ? { ...s, etapa, atualizadoEm: em, historico: [...s.historico, { etapa, em, por: 'Demonstração', obs }] } : s));
    return EXTERNOS_DEMO.find((s) => s.id === eid)!;
  },
  async listarModelosOS() {
    return MODELOS_DEMO;
  },
  async criarModeloOS(m) {
    const n = { ...MODELOS_DEMO[0], ...m, id: id(), atualizadoEm: new Date().toISOString(), atualizadoPor: 'Demonstração' } as ModeloOS;
    MODELOS_DEMO = [...MODELOS_DEMO, n];
    return n;
  },
  async salvarModeloOS(mid, m) {
    MODELOS_DEMO = MODELOS_DEMO.map((x) => (x.id === mid ? ({ ...x, ...m, id: mid, atualizadoEm: new Date().toISOString() } as ModeloOS) : x));
    return MODELOS_DEMO.find((x) => x.id === mid)!;
  },
  async tirarFotoOrdem(oid, nome) {
    return mudarOS(oid, (o) => ({ ...o, execucao: { ...o.execucao, fotos: (o.execucao.fotos ?? []).filter((f) => f !== nome) } }));
  },
  async assinarOrdem(oid, _img, nome) {
    return mudarOS(oid, (o) => ({ ...o, execucao: { ...o.execucao, assinatura: `assinatura-${Date.now()}.png`, assinadoPor: nome } }));
  },
  async concluirOrdem(oid) {
    return mudarOS(oid, (o) => ({ ...o, status: 'concluida', concluidaEm: new Date().toISOString() }));
  },
  async devolverOrdem(oid) {
    return mudarOS(oid, (o) => ({ ...o, status: 'execucao', concluidaEm: null }));
  },
  async cancelarOrdem(oid, motivo) {
    return mudarOS(oid, (o) => ({ ...o, status: 'cancelada', cancelamento: motivo }));
  },
  async encerrarOrdem(oid, d) {
    const o = mudarOS(oid, (x) => ({ ...x, status: 'encerrada', encerradaEm: new Date().toISOString(), encerradaPor: 'Demonstração' }));
    return { ordem: o, relatorio: d.enviar ? { enviado: false, detalhe: 'Demonstração: nenhum e-mail sai daqui.' } : null };
  },
  async enviarRelatorioOrdem(oid) {
    return { ordem: OS_DEMO.find((o) => o.id === oid)!, relatorio: { enviado: false, detalhe: 'Demonstração: nenhum e-mail sai daqui.' } };
  },
  async listarPerfis() {
    return PERFIS_DEMO;
  },
  async criarPerfil(d) {
    const p: PerfilAcesso = {
      ...d,
      id: d.nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z0-9]+/g, '-'),
      padrao: false,
    };
    PERFIS_DEMO = [...PERFIS_DEMO, p];
    return p;
  },
  async salvarPerfil(p) {
    PERFIS_DEMO = PERFIS_DEMO.map((x) => (x.id === p.id ? p : x));
    return p;
  },
  async apagarPerfil(pid) {
    PERFIS_DEMO = PERFIS_DEMO.filter((x) => x.id !== pid);
  },
  async listarCopias() {
    return [];
  },
  async listarUsuariosAdmin() {
    const u = carregar().usuario;
    return [...(u ? [{ id: 1, email: u.email, nome: u.nome, chamar: u.chamar ?? '', perfil: 'admin', ativo: true }] : []), ...USUARIOS_DEMO];
  },
  async criarUsuario(d) {
    const novo: UsuarioAdmin = { id: Date.now(), email: d.email.toLowerCase(), nome: d.nome, chamar: d.chamar, perfil: d.perfil, ativo: true };
    USUARIOS_DEMO = [...USUARIOS_DEMO, novo];
    return novo;
  },
  async alterarUsuario(uid, m) {
    const resto = { ...m };
    delete resto.senha;
    USUARIOS_DEMO = USUARIOS_DEMO.map((u) => (u.id === uid ? { ...u, ...resto } : u));
    return USUARIOS_DEMO.find((u) => u.id === uid) ?? { id: uid, email: '', nome: '', chamar: '', perfil: 'admin', ativo: true };
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
      id: id(),
      criadaEm: agora,
      criadaPor: 1,
      criadaPorNome: nome,
      paraUsuario: n.paraUsuario,
      paraNome: nome,
      data: n.data,
      clienteId: n.clienteId,
      clienteNome: cli?.nome ?? (n.clienteNome?.trim() || null),
      titulo: n.titulo,
      status: 'aberta',
      concluidaEm: null,
      concluidaPorNome: null,
      totalMensagens: n.texto ? 1 : 0,
      naoLidas: 0,
      ultimaMensagemEm: agora,
      mensagens: n.texto ? [{ id: 1, usuarioId: 1, autor: nome, texto: n.texto, criadaEm: agora }] : [],
    };
    salvar({ ...b, solicitacoes: [...(b.solicitacoes ?? []), s] });
    return s;
  },
  async responderSolicitacao(sid, texto) {
    const b = carregar();
    const agora = new Date().toISOString();
    const l = (b.solicitacoes ?? []).map((s) =>
      s.id === sid
        ? {
            ...s,
            totalMensagens: s.totalMensagens + 1,
            ultimaMensagemEm: agora,
            mensagens: [...(s.mensagens ?? []), { id: Date.now(), usuarioId: 1, autor: b.usuario?.nome ?? '', texto, criadaEm: agora }],
          }
        : s,
    );
    salvar({ ...b, solicitacoes: l });
    return l.find((s) => s.id === sid)!;
  },
  async alterarSolicitacao(sid, m) {
    const b = carregar();
    const l = (b.solicitacoes ?? []).map((s) =>
      s.id === sid
        ? {
            ...s,
            ...(m.data ? { data: m.data } : {}),
            ...(m.status
              ? {
                  status: m.status,
                  concluidaEm: m.status === 'concluida' ? new Date().toISOString() : null,
                  concluidaPorNome: m.status === 'concluida' ? (b.usuario?.nome ?? '') : null,
                }
              : {}),
          }
        : s,
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
  async anexarNfe() {
    throw new Error('Indisponível na demonstração.');
  },
  async listarEntregas() {
    return [];
  },
  async salvarChecklistEntrega() {
    throw new Error('Indisponível na demonstração.');
  },
  async enviarVideoEntrega() {
    throw new Error('Indisponível na demonstração.');
  },
  async listarFotosEquip() {
    return [];
  },
  async enviarFotoEquip() {
    throw new Error('Indisponível na demonstração.');
  },
  async apagarFotoEquip() {
    throw new Error('Indisponível na demonstração.');
  },
  async lerAutentique() {
    return { configurado: false, final: '', teste: true, conta: '', lucminasNome: '', lucminasEmail: '', testemunhaNome: '', testemunhaEmail: '' };
  },
  async salvarAutentique() {
    throw new Error('Indisponível na demonstração.');
  },
  async testarAutentique() {
    throw new Error('Indisponível na demonstração.');
  },
  async mandarParaAssinar() {
    throw new Error('Indisponível na demonstração.');
  },
  async listarEnviosContrato() {
    return [];
  },
  async atualizarEnviosContrato() {
    return [];
  },
  async linkAssinatura() {
    throw new Error('Indisponível na demonstração.');
  },
  async reenviarAssinatura() {
    throw new Error('Indisponível na demonstração.');
  },
  async cancelarAssinatura() {
    throw new Error('Indisponível na demonstração.');
  },
  async listarArquivosContrato() {
    return [];
  },
  async pastaCliente(id: string) {
    return { clienteId: id, contratos: [], documentos: [], nfe: [], entregas: [], faturas: null };
  },
  async enviarDocumentoCliente() {
    throw new Error('Indisponível na demonstração.');
  },
  async apagarDocumentoCliente() {
    throw new Error('Indisponível na demonstração.');
  },
  async anexarContrato() {
    throw new Error('Indisponível na demonstração.');
  },
  async salvarContrato() {
    throw new Error('Indisponível na demonstração.');
  },
  async lancarFaturaManual() {
    throw new Error('Indisponível na demonstração.');
  },
  async adicionarNotaMov() {
    throw new Error('Indisponível na demonstração.');
  },
  async fotosMensais() {
    return [];
  },
  async tirarNfe() {
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
  async listarOficina() {
    return [...OFICINA_DEMO];
  },
  async colocarNaOficina(frota, observacao) {
    const n = frota
      .trim()
      .toUpperCase()
      .replace(/^FT[\s-]*/, '');
    if (!OFICINA_DEMO.some((o) => o.frota === n)) OFICINA_DEMO.push({ frota: n, desde: new Date().toISOString(), observacao, usuario: 'Demonstração' });
    return [...OFICINA_DEMO];
  },
  async tirarDaOficina(frota) {
    const i = OFICINA_DEMO.findIndex((o) => o.frota === frota);
    if (i >= 0) OFICINA_DEMO.splice(i, 1);
    return [...OFICINA_DEMO];
  },
  async listarConferencia(ref) {
    return CONFERENCIAS_DEMO.filter((c) => c.referencia === ref);
  },
  async marcarConferencia(ref, c) {
    const i = CONFERENCIAS_DEMO.findIndex((x) => x.referencia === ref && x.clienteId === c.clienteId && x.frota === c.frota);
    if (i >= 0) CONFERENCIAS_DEMO.splice(i, 1);
    const f = carregar()
      .clientes.find((x) => x.id === c.clienteId)
      ?.frotas.find((x) => x.numero === c.frota);
    const nova = {
      referencia: ref,
      clienteId: c.clienteId,
      frota: c.frota,
      status: c.status,
      valor: f?.valor ?? 0,
      descricao: f?.descricao ?? '',
      observacao: c.observacao ?? '',
      quando: new Date().toISOString(),
      usuario: 'Demonstração',
    };
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
  async verificarCaixa() {
    await espera(500);
    return { lidas: 0, atualizados: 0, ultimaVerificacao: new Date().toISOString() };
  },
  async copiarEnviados(envioId) {
    const e = carregar().envios.find((x) => x.id === envioId);
    if (!e) throw new Error('Envio não encontrado.');
    return { ...e, copiaEmEnviados: true };
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
const OFICINA_DEMO: FrotaOficina[] = [];

const CONFIG_DEMO = {
  'email.remetente': 'Financeiro · Lucminas Empilhadeiras',
  'email.assunto': 'Fatura de locação nº {numero} · Lucminas Empilhadeiras',
  'email.corpoSemBoleto': 'Prezados,\n\nSegue em anexo a fatura de locação nº {numero}, referente a {mes}.\n\nAtenciosamente,\nFinanceiro · Lucminas Empilhadeiras',
  'email.corpo':
    'Prezados,\n\nSegue em anexo a fatura de locação nº {numero}, referente a {mes}, e o boleto para pagamento.\n\nEm caso de dúvida, é só responder este e-mail.\n\nAtenciosamente,\nFinanceiro · Lucminas Empilhadeiras',
};

/** Volta os dados de demonstração ao estado inicial. */
export function resetarDemo() {
  memoria = semente();
  salvar(memoria);
}
