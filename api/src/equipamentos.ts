/*
 * Ficha de cada equipamento (frota) e histórico de peças e serviços.
 * A locação atual (cliente, valor, início, término) continua no cadastro do cliente;
 * a situação "locada" e "na oficina" é calculada a partir dele e da oficina.
 */
import type { Banco } from './db.js';

export const PERIFERICOS = ['motorPartida', 'filtroAr', 'correia', 'oleoTransmissao', 'oleoHidraulico'] as const;
export type Periferico = (typeof PERIFERICOS)[number];
function periferico<P extends string>(p: P) {
  return { [`${p}Data`]: 'data', [`${p}Horimetro`]: 'numero', [`${p}ProximaData`]: 'data', [`${p}ProximaHoras`]: 'numero' } as Record<`${P}Data` | `${P}ProximaData`, 'data'> &
    Record<`${P}Horimetro` | `${P}ProximaHoras`, 'numero'>;
}

/** Campos da ficha. Texto, número ou data (AAAA-MM-DD). Valores em centavos. */
export const CAMPOS_EQUIPAMENTO = {
  // identificação
  descricao: 'texto',
  marca: 'texto',
  modelo: 'texto',
  serie: 'texto',
  ano: 'inteiro',
  // características
  combustivel: 'texto', // eletrica | glp | diesel | ''
  capacidade: 'inteiro', // kg
  torre: 'texto', // altura de elevação / mastro
  acessorios: 'texto',
  // situação guardada (locada e oficina são calculadas)
  situacao: 'texto', // '' (normal) | reservada | baixada
  situacaoMotivo: 'texto',
  // etiqueta "Helbert": o dono divide a máquina com o irmão (só registro, não muda nada no resto)
  helbert: 'texto', // '' | 'sim'
  // uso
  horimetro: 'numero',
  horimetroEm: 'data',
  mediaDia: 'numero', // horas por dia
  regiao: 'texto',
  tecnico: 'texto', // manutentor responsável
  // manutenção (base para o painel da fase 3)
  tipoVisita: 'texto', // CF | CR | B | C | D
  ultimaVisita: 'data',
  proximaPreventiva: 'numero', // horímetro da próxima preventiva
  intervaloVisitaDias: 'inteiro',
  // compra (só quem vê valores)
  compraValor: 'centavos',
  compraNf: 'texto',
  compraData: 'data',
  fornecedor: 'texto',
  // venda (a máquina sai da frota; situação vira "baixada")
  vendaData: 'data',
  vendaValor: 'centavos',
  vendaComprador: 'texto',
  vendaNf: 'texto',
  // contrato da locação atual
  contratoNumero: 'texto',
  /** início do contrato (base do reajuste anual) */
  contratoInicio: 'data',
  contratoVencimento: 'data',
  contratoValor: 'centavos',
  contratoReajuste: 'centavos',
  contratoObs: 'texto',
  observacoes: 'texto',
  // periféricos: última troca (data e horímetro) e a próxima (por data ou por horímetro)
  ...periferico('motorPartida'),
  ...periferico('filtroAr'),
  ...periferico('correia'),
  ...periferico('oleoTransmissao'),
  ...periferico('oleoHidraulico'),
  /** periféricos que não existem nesta máquina, separados por vírgula (ex.: "correia,oleoHidraulico") */
  perifericosNaoAplica: 'texto',
} as const;
export type CampoEquipamento = keyof typeof CAMPOS_EQUIPAMENTO;
export type DadosEquipamento = Partial<Record<CampoEquipamento, string | number | null>>;
export type Equipamento = DadosEquipamento & { frota: string; atualizadoEm: string; atualizadoPor: string };

/** Campos com dinheiro: só vão para quem vê valores. */
export const CAMPOS_VALOR: CampoEquipamento[] = ['compraValor', 'compraNf', 'fornecedor', 'contratoValor', 'contratoReajuste', 'vendaValor', 'vendaNf'];

export class DadoInvalido extends Error {}

export const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere e limpa os campos que chegam (ignora o que não conhece). null apaga o campo. */
export function lerDados(v: unknown): DadosEquipamento {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const d: DadosEquipamento = {};
  for (const [campo, tipo] of Object.entries(CAMPOS_EQUIPAMENTO) as [CampoEquipamento, string][]) {
    if (!(campo in o)) continue;
    const x = o[campo];
    if (x === null || x === '' || x === undefined) {
      d[campo] = null;
      continue;
    }
    if (tipo === 'texto') {
      if (typeof x !== 'string' && typeof x !== 'number') throw new DadoInvalido(`Campo ${campo} inválido.`);
      const s = String(x).trim();
      if (s.length > 2000) throw new DadoInvalido(`Campo ${campo} muito longo.`);
      d[campo] = s || null;
    } else if (tipo === 'data') {
      if (typeof x !== 'string' || !DATA.test(x)) throw new DadoInvalido(`Data inválida em ${campo}.`);
      d[campo] = x;
    } else {
      const n = Number(x);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new DadoInvalido(`Número inválido em ${campo}.`);
      d[campo] = tipo === 'numero' ? Math.round(n * 100) / 100 : Math.round(n);
    }
  }
  return d;
}

export const normalizarFrota = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/^(FROTA|FT)[\s-]*/, '');

export type PecaHistorico = {
  id: number;
  data: string;
  frota: string | null;
  ativo: string;
  cliente: string;
  tecnico: string;
  pendencia: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  horimetro: number | null;
  origem: string;
};
export type NovaPeca = Omit<PecaHistorico, 'id'>;

export function equipamentos(db: Banco) {
  type Linha = { frota: string; dados: string; atualizado_em: string; atualizado_por_nome: string | null };
  const deLinha = (r: Linha): Equipamento => ({ ...(JSON.parse(r.dados) as DadosEquipamento), frota: r.frota, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por_nome ?? '' });
  const sel = `SELECT e.frota, e.dados, e.atualizado_em, u.nome AS atualizado_por_nome FROM equipamentos e LEFT JOIN usuarios u ON u.id = e.atualizado_por`;
  const buscar = (frota: string) => {
    const r = db.prepare(`${sel} WHERE e.frota = ?`).get(frota) as Linha | undefined;
    return r ? deLinha(r) : null;
  };

  /** Junta os campos novos aos que já existem; null apaga. Devolve o que mudou (para o Registro). */
  const gravar = (frota: string, novos: DadosEquipamento, usuarioId: number | null) => {
    const r = db.prepare('SELECT dados FROM equipamentos WHERE frota = ?').get(frota) as { dados: string } | undefined;
    const antes = r ? (JSON.parse(r.dados) as DadosEquipamento) : {};
    const depois: DadosEquipamento = { ...antes };
    const mudou: string[] = [];
    for (const [k, v] of Object.entries(novos) as [CampoEquipamento, string | number | null][]) {
      if ((antes[k] ?? null) === v) continue;
      mudou.push(k);
      if (v === null) delete depois[k];
      else depois[k] = v;
    }
    if (r && !mudou.length) return { novo: false, mudou };
    const agora = new Date().toISOString();
    db.prepare(
      `INSERT INTO equipamentos (frota, dados, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
       ON CONFLICT(frota) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
    ).run(frota, JSON.stringify(depois), agora, usuarioId);
    return { novo: !r, mudou };
  };

  const pecaDeLinha = (r: Record<string, unknown>): PecaHistorico => ({
    id: r.id as number,
    data: r.data as string,
    frota: (r.frota as string | null) ?? null,
    ativo: r.ativo as string,
    cliente: r.cliente as string,
    tecnico: r.tecnico as string,
    pendencia: r.pendencia as string,
    codigo: r.codigo as string,
    descricao: r.descricao as string,
    quantidade: r.quantidade as number,
    valorUnitario: r.valor_unitario as number,
    valorTotal: r.valor_total as number,
    horimetro: (r.horimetro as number | null) ?? null,
    origem: r.origem as string,
  });

  return {
    listar(): Equipamento[] {
      return (db.prepare(`${sel} ORDER BY e.frota`).all() as Linha[]).map(deLinha);
    },
    buscar,
    salvar(frota: string, d: DadosEquipamento, usuarioId: number) {
      const r = gravar(frota, d, usuarioId);
      return { ...r, equipamento: buscar(frota)! };
    },
    /** Importação da planilha: tudo numa transação. */
    importar(lista: { frota: string; dados: DadosEquipamento }[], usuarioId: number) {
      let novos = 0;
      let atualizados = 0;
      db.transaction(() => {
        for (const { frota, dados } of lista) {
          // na importação, campo vazio na planilha não apaga o que já está no sistema
          const sem = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null)) as DadosEquipamento;
          const r = gravar(frota, sem, usuarioId);
          if (r.novo) novos++;
          else if (r.mudou.length) atualizados++;
        }
      })();
      return { novos, atualizados, iguais: lista.length - novos - atualizados };
    },

    // ---------- histórico de peças e serviços ----------
    /** Troca todo o histórico de uma origem (ex.: 'auvo') pelo que veio agora. Importar de novo não duplica. */
    substituirHistorico(origem: string, linhas: NovaPeca[]) {
      const ins = db.prepare(
        `INSERT INTO historico_pecas (data, frota, ativo, cliente, tecnico, pendencia, codigo, descricao, quantidade, valor_unitario, valor_total, horimetro, origem)
         VALUES (@data, @frota, @ativo, @cliente, @tecnico, @pendencia, @codigo, @descricao, @quantidade, @valorUnitario, @valorTotal, @horimetro, @origem)`,
      );
      db.transaction(() => {
        db.prepare('DELETE FROM historico_pecas WHERE origem = ?').run(origem);
        for (const l of linhas) ins.run({ ...l, origem });
      })();
      return { linhas: linhas.length };
    },
    historicoDaFrota(frota: string): PecaHistorico[] {
      return (db.prepare('SELECT * FROM historico_pecas WHERE frota = ? ORDER BY data DESC, id ASC').all(frota) as Record<string, unknown>[]).map(pecaDeLinha);
    },
    /** Busca por palavras, sem ligar para acento ou maiúscula: todas precisam aparecer em peça, código, pendência, cliente ou técnico. */
    buscarHistorico(texto: string, frota: string | null, limite = 500): PecaHistorico[] {
      const palavras = semAcento(texto).split(/\s+/).filter(Boolean);
      const linhas = (
        frota
          ? db.prepare('SELECT * FROM historico_pecas WHERE frota = ? ORDER BY data DESC, id ASC').all(frota)
          : db.prepare('SELECT * FROM historico_pecas ORDER BY data DESC, id ASC').all()
      ) as Record<string, unknown>[];
      const r: PecaHistorico[] = [];
      for (const l of linhas) {
        const alvo = semAcento(`${l.descricao} ${l.codigo} ${l.pendencia} ${l.cliente} ${l.tecnico}`);
        if (palavras.every((p) => alvo.includes(p))) r.push(pecaDeLinha(l));
        if (r.length >= limite) break;
      }
      return r;
    },
    /** Gasto com peças e serviços por frota desde uma data (para "máquinas que mais dão gasto"). */
    gastosPorFrota(desde: string) {
      return db
        .prepare(
          `SELECT frota, SUM(valor_total) AS total, COUNT(*) AS lancamentos, COUNT(DISTINCT data) AS visitas, MAX(data) AS ultima
           FROM historico_pecas WHERE frota IS NOT NULL AND data >= ? GROUP BY frota ORDER BY total DESC`,
        )
        .all(desde) as { frota: string; total: number; lancamentos: number; visitas: number; ultima: string }[];
    },
    resumoHistorico() {
      return db.prepare('SELECT origem, COUNT(*) AS linhas, MIN(data) AS de, MAX(data) AS ate FROM historico_pecas GROUP BY origem').all() as {
        origem: string;
        linhas: number;
        de: string;
        ate: string;
      }[];
    },
  };
}
