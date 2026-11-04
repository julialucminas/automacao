/*
 * Serviços externos: máquina do cliente (ou serviço fora da locação) que a Lucminas orça, executa e cobra.
 * Sem automação: só as etapas, para todo mundo saber em que pé está. A Angelise faz o orçamento e a cobrança.
 */
import type { Banco } from './db.js';
import { DadoInvalido } from './equipamentos.js';

export const ETAPAS = {
  pedido: 'Pedido recebido',
  orcamento: 'Orçamento em preparo',
  enviado: 'Orçamento enviado',
  aprovado: 'Aprovado',
  execucao: 'Em execução',
  concluido: 'Concluído · a cobrar',
  cobrado: 'Cobrado',
  recusado: 'Recusado',
} as const;
export type Etapa = keyof typeof ETAPAS;

export type PassoExterno = { etapa: Etapa; em: string; por: string; obs: string };
export type ServicoExterno = {
  id: number;
  clienteId: string | null;
  clienteNome: string;
  contato: string;
  equipamento: string;
  descricao: string;
  etapa: Etapa;
  /** centavos; só quem vê valores recebe */
  valor: number | null;
  responsavelId: number | null;
  responsavelNome: string;
  osNumero: number | null;
  previsao: string | null;
  obs: string;
  historico: PassoExterno[];
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string;
};
export type DadosExterno = Pick<ServicoExterno, 'clienteId' | 'clienteNome' | 'contato' | 'equipamento' | 'descricao' | 'valor' | 'responsavelId' | 'osNumero' | 'previsao' | 'obs'>;

type Linha = {
  id: number;
  cliente_id: string | null;
  cliente_nome: string;
  contato: string;
  equipamento: string;
  descricao: string;
  etapa: Etapa;
  valor: number | null;
  responsavel_id: number | null;
  responsavel_nome: string | null;
  os_numero: number | null;
  previsao: string | null;
  obs: string;
  historico: string;
  criado_por_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};
const deLinha = (r: Linha): ServicoExterno => ({
  id: r.id,
  clienteId: r.cliente_id,
  clienteNome: r.cliente_nome,
  contato: r.contato,
  equipamento: r.equipamento,
  descricao: r.descricao,
  etapa: r.etapa,
  valor: r.valor,
  responsavelId: r.responsavel_id,
  responsavelNome: r.responsavel_nome ?? '',
  osNumero: r.os_numero,
  previsao: r.previsao,
  obs: r.obs,
  historico: JSON.parse(r.historico) as PassoExterno[],
  criadoPor: r.criado_por_nome ?? '',
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

const SEL = `SELECT e.*, r.nome AS responsavel_nome, c.nome AS criado_por_nome
  FROM servicos_externos e LEFT JOIN usuarios r ON r.id = e.responsavel_id LEFT JOIN usuarios c ON c.id = e.criado_por`;

export function externos(db: Banco) {
  const agora = () => new Date().toISOString();
  const nomeDe = (id: number) => (db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(id) as { nome: string } | undefined)?.nome ?? '';
  const buscar = (id: number) => {
    const r = db.prepare(`${SEL} WHERE e.id = ?`).get(id) as Linha | undefined;
    if (!r) throw new DadoInvalido('Serviço não encontrado.');
    return deLinha(r);
  };
  return {
    buscar,
    listar: (): ServicoExterno[] => (db.prepare(`${SEL} ORDER BY e.atualizado_em DESC`).all() as Linha[]).map(deLinha),
    criar(d: DadosExterno, usuarioId: number) {
      const historico: PassoExterno[] = [{ etapa: 'pedido', em: agora(), por: nomeDe(usuarioId), obs: '' }];
      const r = db
        .prepare(
          `INSERT INTO servicos_externos (cliente_id, cliente_nome, contato, equipamento, descricao, etapa, valor, responsavel_id, os_numero, previsao, obs, historico, criado_por, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, 'pedido', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(d.clienteId, d.clienteNome, d.contato, d.equipamento, d.descricao, d.valor, d.responsavelId, d.osNumero, d.previsao, d.obs, JSON.stringify(historico), usuarioId, agora(), agora());
      return buscar(Number(r.lastInsertRowid));
    },
    /** só os campos que vieram (undefined = não mexe) */
    alterar(id: number, d: Partial<DadosExterno>) {
      const atual = buscar(id);
      const n = { ...atual, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) } as ServicoExterno;
      db.prepare(
        `UPDATE servicos_externos SET cliente_id = ?, cliente_nome = ?, contato = ?, equipamento = ?, descricao = ?, valor = ?, responsavel_id = ?, os_numero = ?, previsao = ?, obs = ?, atualizado_em = ? WHERE id = ?`,
      ).run(n.clienteId, n.clienteNome, n.contato, n.equipamento, n.descricao, n.valor, n.responsavelId, n.osNumero, n.previsao, n.obs, agora(), id);
      return { antes: atual, depois: buscar(id) };
    },
    mudarEtapa(id: number, etapa: Etapa, obs: string, usuarioId: number) {
      const atual = buscar(id);
      if (atual.etapa === etapa && !obs) return atual;
      const historico = [...atual.historico, { etapa, em: agora(), por: nomeDe(usuarioId), obs }];
      db.prepare('UPDATE servicos_externos SET etapa = ?, historico = ?, atualizado_em = ? WHERE id = ?').run(etapa, JSON.stringify(historico), agora(), id);
      return buscar(id);
    },
  };
}
