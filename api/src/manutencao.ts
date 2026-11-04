/*
 * Painel de manutenção: regras (tipos de visita e periféricos), pendências e registro de visita.
 * As regras ficam na configuração ('manutencao.tipos' e 'manutencao.perifericos') e são editadas em Configurações.
 */
import type { Banco } from './db.js';
import { DadoInvalido, PERIFERICOS, equipamentos, type DadosEquipamento, type Periferico } from './equipamentos.js';

export type TipoVisita = { sigla: string; nome: string; dias?: number; horas?: number };
export type RegraPeriferico = { id: Periferico; nome: string; dias?: number; horas?: number };

const intervalo = (v: unknown, max: number) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > max) throw new DadoInvalido('Intervalo inválido nas regras de manutenção.');
  return n;
};

/** Confere as regras que chegam da tela antes de guardar (texto JSON). */
export function validarTipos(texto: string): string {
  let l: unknown;
  try {
    l = JSON.parse(texto);
  } catch {
    throw new DadoInvalido('Regras de manutenção inválidas.');
  }
  if (!Array.isArray(l) || !l.length || l.length > 20) throw new DadoInvalido('Informe os tipos de visita.');
  const vistos = new Set<string>();
  const r: TipoVisita[] = l.map((x: Record<string, unknown>) => {
    const sigla = String(x?.sigla ?? '')
      .trim()
      .toUpperCase();
    const nome = String(x?.nome ?? '').trim();
    if (!sigla || sigla.length > 10 || !nome || nome.length > 60) throw new DadoInvalido('Cada tipo de visita precisa de sigla e nome.');
    if (vistos.has(sigla)) throw new DadoInvalido(`A sigla ${sigla} aparece duas vezes.`);
    vistos.add(sigla);
    const t: TipoVisita = { sigla, nome };
    const dias = intervalo(x.dias, 3650);
    const horas = intervalo(x.horas, 100000);
    if (dias) t.dias = dias;
    if (horas) t.horas = horas;
    return t;
  });
  return JSON.stringify(r);
}

export function validarPerifericos(texto: string): string {
  let l: unknown;
  try {
    l = JSON.parse(texto);
  } catch {
    throw new DadoInvalido('Regras dos periféricos inválidas.');
  }
  if (!Array.isArray(l)) throw new DadoInvalido('Regras dos periféricos inválidas.');
  const r: RegraPeriferico[] = l.map((x: Record<string, unknown>) => {
    const id = x?.id as Periferico;
    if (!PERIFERICOS.includes(id)) throw new DadoInvalido('Periférico desconhecido.');
    const nome = String(x.nome ?? '').trim();
    if (!nome || nome.length > 60) throw new DadoInvalido('Dê um nome a cada periférico.');
    const p: RegraPeriferico = { id, nome };
    const dias = intervalo(x.dias, 3650);
    const horas = intervalo(x.horas, 100000);
    if (dias) p.dias = dias;
    if (horas) p.horas = horas;
    if (!dias && !horas) throw new DadoInvalido(`Informe de quantos em quantos dias ou horas troca o ${nome.toLowerCase()}.`);
    return p;
  });
  return JSON.stringify(r);
}

export type Pendencia = {
  id: number;
  frota: string;
  cliente: string;
  abertaEm: string;
  tecnico: string;
  descricao: string;
  status: 'aberta' | 'resolvida';
  resolvidaEm: string | null;
  resolvidaPor: string;
  resolucao: string;
  origem: string;
};
export type NovaPendencia = { frota: string; cliente: string; abertaEm: string; tecnico: string; descricao: string };

const somarDias = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function manutencao(db: Banco, lerConfig: () => Record<string, string>) {
  const equip = equipamentos(db);
  const regras = () => ({
    tipos: JSON.parse(lerConfig()['manutencao.tipos']) as TipoVisita[],
    perifericos: JSON.parse(lerConfig()['manutencao.perifericos']) as RegraPeriferico[],
  });
  const deLinha = (r: Record<string, unknown>): Pendencia => ({
    id: r.id as number,
    frota: r.frota as string,
    cliente: r.cliente as string,
    abertaEm: r.aberta_em as string,
    tecnico: r.tecnico as string,
    descricao: r.descricao as string,
    status: r.status as 'aberta' | 'resolvida',
    resolvidaEm: (r.resolvida_em as string | null) ?? null,
    resolvidaPor: (r.resolvida_por_nome as string | null) ?? '',
    resolucao: r.resolucao as string,
    origem: r.origem as string,
  });
  const sel = 'SELECT p.*, u.nome AS resolvida_por_nome FROM pendencias p LEFT JOIN usuarios u ON u.id = p.resolvida_por';

  return {
    regras,
    listarPendencias(todas = false): Pendencia[] {
      return (db.prepare(`${sel} ${todas ? '' : "WHERE p.status = 'aberta'"} ORDER BY p.aberta_em DESC, p.id DESC`).all() as Record<string, unknown>[]).map(deLinha);
    },
    buscarPendencia(id: number) {
      const r = db.prepare(`${sel} WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined;
      return r ? deLinha(r) : null;
    },
    criarPendencia(p: NovaPendencia, usuarioId: number) {
      const r = db
        .prepare("INSERT INTO pendencias (frota, cliente, aberta_em, tecnico, descricao, origem, criada_por) VALUES (?, ?, ?, ?, ?, 'sistema', ?)")
        .run(p.frota, p.cliente, p.abertaEm, p.tecnico, p.descricao, usuarioId);
      return this.buscarPendencia(Number(r.lastInsertRowid))!;
    },
    resolverPendencia(id: number, resolvida: boolean, resolucao: string, usuarioId: number) {
      const r = resolvida
        ? db.prepare("UPDATE pendencias SET status = 'resolvida', resolvida_em = ?, resolvida_por = ?, resolucao = ? WHERE id = ?").run(new Date().toISOString(), usuarioId, resolucao, id)
        : db.prepare("UPDATE pendencias SET status = 'aberta', resolvida_em = NULL, resolvida_por = NULL, resolucao = '' WHERE id = ?").run(id);
      if (!r.changes) return null;
      return this.buscarPendencia(id);
    },
    /** Importar da planilha troca as pendências que vieram da planilha e ainda estão abertas; as resolvidas e as abertas no sistema ficam. */
    importarPendencias(lista: NovaPendencia[]) {
      const ins = db.prepare("INSERT INTO pendencias (frota, cliente, aberta_em, tecnico, descricao, origem) VALUES (?, ?, ?, ?, ?, 'planilha')");
      let novas = 0;
      db.transaction(() => {
        // a mesma pendência já resolvida no sistema não volta a abrir
        const resolvidas = new Set(
          (db.prepare("SELECT frota, descricao FROM pendencias WHERE origem = 'planilha' AND status = 'resolvida'").all() as { frota: string; descricao: string }[]).map((x) => `${x.frota}|${x.descricao}`),
        );
        db.prepare("DELETE FROM pendencias WHERE origem = 'planilha' AND status = 'aberta'").run();
        for (const p of lista) {
          if (resolvidas.has(`${p.frota}|${p.descricao}`)) continue;
          ins.run(p.frota, p.cliente, p.abertaEm, p.tecnico, p.descricao);
          novas++;
        }
      })();
      return { abertas: novas, jaResolvidas: lista.length - novas };
    },

    /**
     * Registra uma visita na máquina: atualiza horímetro, última visita, próxima preventiva e periféricos trocados,
     * e lança no histórico (origem 'sistema', que a importação do Auvo não apaga).
     */
    registrarVisita(
      frota: string,
      v: { data: string; horimetro: number | null; tipo: string; tecnico: string; cliente: string; proximaPreventiva: number | null; perifericos: Periferico[]; observacao: string },
      usuarioId: number,
    ) {
      const r = regras();
      const tipo = r.tipos.find((t) => t.sigla === v.tipo);
      if (!tipo) throw new DadoInvalido('Escolha o tipo de visita.');
      const atual = equip.buscar(frota);
      if (v.horimetro !== null && atual?.horimetro != null && v.horimetro < Number(atual.horimetro) && (atual.horimetroEm ?? '') <= v.data)
        throw new DadoInvalido(`O horímetro informado (${v.horimetro}) é menor que o último registrado (${atual.horimetro}). Confira o número.`);
      const d: DadosEquipamento = { ultimaVisita: v.data };
      if (v.tecnico) d.tecnico = v.tecnico;
      if (v.horimetro !== null) {
        d.horimetro = v.horimetro;
        d.horimetroEm = v.data;
      }
      if (v.proximaPreventiva !== null) d.proximaPreventiva = v.proximaPreventiva;
      for (const p of v.perifericos) {
        const regra = r.perifericos.find((x) => x.id === p);
        (d as Record<string, unknown>)[`${p}Data`] = v.data;
        (d as Record<string, unknown>)[`${p}Horimetro`] = v.horimetro;
        (d as Record<string, unknown>)[`${p}ProximaData`] = regra?.dias ? somarDias(v.data, regra.dias) : null;
        (d as Record<string, unknown>)[`${p}ProximaHoras`] = regra?.horas && v.horimetro !== null ? v.horimetro + regra.horas : null;
      }
      const res = equip.salvar(frota, d, usuarioId);
      const linhas = [
        `VISITA ${tipo.sigla} · ${tipo.nome.toUpperCase()}`,
        ...v.perifericos.map((p) => `TROCA: ${(r.perifericos.find((x) => x.id === p)?.nome ?? p).toUpperCase()}`),
      ];
      const ins = db.prepare(
        `INSERT INTO historico_pecas (data, frota, ativo, cliente, tecnico, pendencia, codigo, descricao, quantidade, valor_unitario, valor_total, horimetro, origem)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 0, 0, ?, 'sistema')`,
      );
      for (const l of linhas) ins.run(v.data, frota, `FT ${frota}`, v.cliente, v.tecnico, v.observacao, l, v.horimetro);
      return { equipamento: res.equipamento, lancamentos: linhas.length, tipo };
    },
  };
}
