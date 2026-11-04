/*
 * Modelos de OS: cada tipo de OS tem um formulário montado pela empresa (como no Produttivo e no Auvo).
 * A OS guarda uma cópia do formulário quando é aberta: mudar o modelo depois não mexe nas OS antigas.
 */
import { randomUUID } from 'node:crypto';
import type { Banco } from './db.js';
import { DadoInvalido } from './equipamentos.js';

export const TIPOS_CAMPO = {
  secao: 'Título de seção',
  checklist: 'Item de checklist (OK / Problema / Não tem)',
  simnao: 'Sim ou não',
  texto: 'Texto curto',
  textoLongo: 'Texto longo',
  numero: 'Número',
  opcoes: 'Escolha uma opção',
  multipla: 'Escolha várias opções',
  data: 'Data',
  foto: 'Foto',
} as const;
export type TipoCampo = keyof typeof TIPOS_CAMPO;

export type Campo = { id: string; rotulo: string; tipo: TipoCampo; obrigatorio: boolean; opcoes?: string[]; unidade?: string; ajuda?: string };
export const TIPOS_BASE = ['preventiva', 'corretiva', 'entrega', 'devolucao', 'vistoria', 'externo'] as const;
export type TipoBase = (typeof TIPOS_BASE)[number];

export type Modelo = {
  id: string;
  nome: string;
  descricao: string;
  /** o que a OS faz no sistema ao encerrar (ficha, preventiva…) */
  tipoBase: TipoBase;
  campos: Campo[];
  exigeHorimetro: boolean;
  exigeAssinatura: boolean;
  fotosMinimas: number;
  ativo: boolean;
  atualizadoEm: string;
  atualizadoPor: string;
};

/** O formulário como a OS guarda (cópia do modelo no dia em que foi aberta). */
export type Formulario = Pick<Modelo, 'nome' | 'campos' | 'exigeHorimetro' | 'exigeAssinatura' | 'fotosMinimas'> & { modeloId: string };
export type Resposta = string | number | boolean | string[] | { resposta: 'ok' | 'problema' | 'na'; obs: string } | null;

const SEGURANCA = ['Garfos e correntes', 'Freio de serviço', 'Freio de estacionamento', 'Buzina', 'Luzes e giroflex', 'Alarme de ré', 'Cinto de segurança', 'Extintor'];
const ESTADO = ['Pneus', 'Vazamentos (óleo, água, gás)', 'Mastro / torre', 'Painel e horímetro', 'Bateria ou cilindro de gás', 'Avarias na lataria', 'Limpeza'];
const chk = (itens: string[]): Campo[] => itens.map((rotulo, i) => ({ id: `c${i + 1}`, rotulo, tipo: 'checklist', obrigatorio: true }));
const sec = (id: string, rotulo: string): Campo => ({ id, rotulo, tipo: 'secao', obrigatorio: false });

/** Modelos que vêm prontos (os checklists da primeira versão). A empresa edita à vontade. */
export const MODELOS_INICIAIS: Omit<Modelo, 'id' | 'atualizadoEm' | 'atualizadoPor' | 'ativo'>[] = [
  {
    nome: 'Preventiva',
    descricao: 'Revisão programada pelo horímetro ou pela data.',
    tipoBase: 'preventiva',
    campos: [
      sec('s1', 'Segurança'),
      ...chk(SEGURANCA),
      sec('s2', 'Motor e fluidos'),
      ...chk(['Nível de óleo do motor', 'Óleo hidráulico', 'Óleo de transmissão', 'Filtro de ar', 'Sistema de arrefecimento']).map((c, i) => ({ ...c, id: `m${i + 1}` })),
      sec('s3', 'Estado geral'),
      ...chk(ESTADO.slice(0, 4)).map((c, i) => ({ ...c, id: `e${i + 1}` })),
    ],
    exigeHorimetro: true,
    exigeAssinatura: true,
    fotosMinimas: 0,
  },
  {
    nome: 'Corretiva',
    descricao: 'Defeito: o cliente chamou ou a operação viu.',
    tipoBase: 'corretiva',
    campos: [
      { id: 'defeito', rotulo: 'Defeito encontrado', tipo: 'textoLongo', obrigatorio: true },
      { id: 'causa', rotulo: 'Causa provável', tipo: 'opcoes', obrigatorio: false, opcoes: ['Desgaste natural', 'Mau uso / operação', 'Falta de manutenção', 'Acidente', 'Outra'] },
      ...chk(['Máquina testada depois do reparo', ...SEGURANCA.slice(0, 4)]),
    ],
    exigeHorimetro: true,
    exigeAssinatura: true,
    fotosMinimas: 0,
  },
  {
    nome: 'Entrega (check-list de saída)',
    descricao: 'Estado da máquina quando sai para o cliente.',
    tipoBase: 'entrega',
    campos: [sec('s1', 'Segurança'), ...chk(SEGURANCA), sec('s2', 'Estado'), ...chk(ESTADO).map((c, i) => ({ ...c, id: `e${i + 1}` })), { id: 'foto', rotulo: 'Foto da máquina entregue', tipo: 'foto', obrigatorio: true }],
    exigeHorimetro: true,
    exigeAssinatura: true,
    fotosMinimas: 0,
  },
  {
    nome: 'Devolução (check-list de retorno)',
    descricao: 'Estado da máquina quando volta do cliente, para comparar com a entrega.',
    tipoBase: 'devolucao',
    campos: [
      sec('s1', 'Segurança'),
      ...chk(SEGURANCA),
      sec('s2', 'Estado'),
      ...chk(ESTADO).map((c, i) => ({ ...c, id: `e${i + 1}` })),
      { id: 'avarias', rotulo: 'Avarias para cobrar do cliente', tipo: 'textoLongo', obrigatorio: false },
      { id: 'foto', rotulo: 'Foto da máquina devolvida', tipo: 'foto', obrigatorio: true },
    ],
    exigeHorimetro: true,
    exigeAssinatura: true,
    fotosMinimas: 0,
  },
  {
    nome: 'Vistoria',
    descricao: 'Inspeção de segurança.',
    tipoBase: 'vistoria',
    campos: [...chk(SEGURANCA), ...chk(ESTADO).map((c, i) => ({ ...c, id: `e${i + 1}` }))],
    exigeHorimetro: true,
    exigeAssinatura: false,
    fotosMinimas: 0,
  },
  {
    nome: 'Serviço externo',
    descricao: 'Manutenção em máquina do cliente (não é da frota).',
    tipoBase: 'externo',
    campos: [
      { id: 'maquina', rotulo: 'Marca e modelo da máquina', tipo: 'texto', obrigatorio: true },
      { id: 'serie', rotulo: 'Nº de série', tipo: 'texto', obrigatorio: false },
      { id: 'horas', rotulo: 'Horímetro da máquina', tipo: 'numero', obrigatorio: false, unidade: 'h' },
      { id: 'defeito', rotulo: 'Defeito encontrado', tipo: 'textoLongo', obrigatorio: true },
      ...chk(['Máquina testada depois do reparo']),
    ],
    exigeHorimetro: false,
    exigeAssinatura: true,
    fotosMinimas: 0,
  },
];

const ID_CAMPO = /^[a-z0-9_-]{1,40}$/i;

/** Confere um modelo que veio da tela. */
export function lerModelo(b: Record<string, unknown>): Omit<Modelo, 'id' | 'atualizadoEm' | 'atualizadoPor'> {
  const nome = String(b.nome ?? '').trim();
  if (!nome || nome.length > 80) throw new DadoInvalido('Dê um nome ao modelo.');
  const tipoBase = TIPOS_BASE.includes(b.tipoBase as TipoBase) ? (b.tipoBase as TipoBase) : null;
  if (!tipoBase) throw new DadoInvalido('Escolha o tipo de serviço do modelo.');
  if (!Array.isArray(b.campos) || b.campos.length > 120) throw new DadoInvalido('Campos inválidos.');
  const ids = new Set<string>();
  const campos: Campo[] = b.campos.map((x: Record<string, unknown>, i: number) => {
    const tipo = (Object.keys(TIPOS_CAMPO).includes(x?.tipo as string) ? x.tipo : null) as TipoCampo | null;
    if (!tipo) throw new DadoInvalido(`Tipo inválido no campo ${i + 1}.`);
    const rotulo = String(x.rotulo ?? '').trim();
    if (!rotulo || rotulo.length > 200) throw new DadoInvalido(`Escreva a pergunta do campo ${i + 1}.`);
    let id = String(x.id ?? '').trim();
    if (!ID_CAMPO.test(id) || ids.has(id)) id = `f${randomUUID().slice(0, 8)}`;
    ids.add(id);
    const c: Campo = { id, rotulo, tipo, obrigatorio: tipo === 'secao' ? false : x.obrigatorio === true };
    if (tipo === 'opcoes' || tipo === 'multipla') {
      const op = Array.isArray(x.opcoes) ? [...new Set(x.opcoes.map((o) => String(o).trim()).filter(Boolean))].slice(0, 40) : [];
      if (op.length < 2) throw new DadoInvalido(`"${rotulo}" precisa de pelo menos duas opções.`);
      c.opcoes = op;
    }
    if (tipo === 'numero' && x.unidade) c.unidade = String(x.unidade).trim().slice(0, 15);
    if (x.ajuda) c.ajuda = String(x.ajuda).trim().slice(0, 300);
    return c;
  });
  const fotos = Number(b.fotosMinimas ?? 0);
  return {
    nome,
    descricao: String(b.descricao ?? '')
      .trim()
      .slice(0, 300),
    tipoBase,
    campos,
    exigeHorimetro: b.exigeHorimetro !== false,
    exigeAssinatura: b.exigeAssinatura !== false,
    fotosMinimas: Number.isInteger(fotos) && fotos >= 0 && fotos <= 12 ? fotos : 0,
    ativo: b.ativo !== false,
  };
}

/** Confere as respostas que o técnico mandou, campo a campo, pelo formulário da OS. */
export function lerRespostas(f: Formulario, v: unknown): Record<string, Resposta> {
  if (!v || typeof v !== 'object') throw new DadoInvalido('Respostas inválidas.');
  const r: Record<string, Resposta> = {};
  for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
    const c = f.campos.find((k) => k.id === id);
    if (!c || c.tipo === 'secao' || c.tipo === 'foto') continue; // fotos entram pelo envio de foto
    if (x === null || x === '' || x === undefined) {
      r[id] = null;
      continue;
    }
    const erro = () => {
      throw new DadoInvalido(`Resposta inválida em "${c.rotulo}".`);
    };
    switch (c.tipo) {
      case 'checklist': {
        const o = x as Record<string, unknown>;
        if (!['ok', 'problema', 'na'].includes(o?.resposta as string)) erro();
        r[id] = { resposta: o.resposta as 'ok' | 'problema' | 'na', obs: String(o.obs ?? '').slice(0, 500) };
        break;
      }
      case 'simnao':
        if (typeof x !== 'boolean') erro();
        r[id] = x as boolean;
        break;
      case 'numero': {
        const n = Number(x);
        if (!Number.isFinite(n) || Math.abs(n) > 1e9) erro();
        r[id] = n;
        break;
      }
      case 'data':
        if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) erro();
        r[id] = x as string;
        break;
      case 'opcoes':
        if (!c.opcoes?.includes(String(x))) erro();
        r[id] = String(x);
        break;
      case 'multipla':
        if (!Array.isArray(x) || x.some((o) => !c.opcoes?.includes(String(o)))) erro();
        r[id] = (x as unknown[]).map(String);
        break;
      default:
        r[id] = String(x).slice(0, c.tipo === 'texto' ? 300 : 4000);
    }
  }
  return r;
}

/** Campos obrigatórios ainda sem resposta. */
export function faltamNoFormulario(f: Formulario, respostas: Record<string, Resposta>): string[] {
  return f.campos.filter((c) => c.obrigatorio && c.tipo !== 'secao').filter((c) => {
    const x = respostas[c.id];
    return x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0);
  }).map((c) => c.rotulo);
}

export function modelos(db: Banco) {
  type Linha = { id: string; dados: string; ativo: number; atualizado_em: string; nome_usuario: string | null };
  const deLinha = (r: Linha): Modelo => ({ ...(JSON.parse(r.dados) as Omit<Modelo, 'id' | 'ativo' | 'atualizadoEm' | 'atualizadoPor'>), id: r.id, ativo: !!r.ativo, atualizadoEm: r.atualizado_em, atualizadoPor: r.nome_usuario ?? '' });
  const sel = 'SELECT m.*, u.nome AS nome_usuario FROM modelos_os m LEFT JOIN usuarios u ON u.id = m.atualizado_por';
  const gravar = (id: string, m: Omit<Modelo, 'id' | 'atualizadoEm' | 'atualizadoPor'>, usuarioId: number | null, ordem?: number) => {
    const { ativo, ...dados } = m;
    db.prepare(
      `INSERT INTO modelos_os (id, dados, ativo, ordem, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, ativo = excluded.ativo, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
    ).run(id, JSON.stringify(dados), ativo ? 1 : 0, ordem ?? Date.now(), new Date().toISOString(), usuarioId);
  };
  // instalação nova: os modelos que vêm prontos
  if (!(db.prepare('SELECT COUNT(*) AS n FROM modelos_os').get() as { n: number }).n)
    db.transaction(() => MODELOS_INICIAIS.forEach((m, i) => gravar(`padrao-${m.tipoBase}`, { ...m, ativo: true }, null, i)))();

  const buscar = (id: string) => {
    const r = db.prepare(`${sel} WHERE m.id = ?`).get(id) as Linha | undefined;
    if (!r) throw new DadoInvalido('Modelo não encontrado.');
    return deLinha(r);
  };
  return {
    listar: (): Modelo[] => (db.prepare(`${sel} ORDER BY m.ordem, m.atualizado_em`).all() as Linha[]).map(deLinha),
    buscar,
    criar(m: ReturnType<typeof lerModelo>, usuarioId: number) {
      const id = randomUUID();
      gravar(id, m, usuarioId);
      return buscar(id);
    },
    salvar(id: string, m: ReturnType<typeof lerModelo>, usuarioId: number) {
      buscar(id);
      gravar(id, m, usuarioId);
      return buscar(id);
    },
    formularioDe(m: Modelo): Formulario {
      return { modeloId: m.id, nome: m.nome, campos: m.campos, exigeHorimetro: m.exigeHorimetro, exigeAssinatura: m.exigeAssinatura, fotosMinimas: m.fotosMinimas };
    },
  };
}
