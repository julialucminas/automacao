/*
 * Ordens de serviço.
 * Fluxo: aberta → agendada (técnico e data) → em execução (check-in no local) ⇄ aguardando peça
 *        → concluída (técnico: checklist, fotos, assinatura) → encerrada (escritório revisa; relatório vai ao cliente).
 * Cancelada: só pelo escritório, antes de encerrar.
 * Ao encerrar, a ficha da máquina, o histórico de peças e a pendência ligada são atualizados.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from './db.js';
import { DadoInvalido, PERIFERICOS, equipamentos, type DadosEquipamento, type Periferico } from './equipamentos.js';
import { camposPerifericos, type RegraPeriferico } from './manutencao.js';
import { faltamNoFormulario, type Formulario, type Resposta } from './modelos.js';

export const TIPOS_OS = {
  preventiva: 'Preventiva',
  corretiva: 'Corretiva',
  entrega: 'Entrega (saída para o cliente)',
  devolucao: 'Devolução (volta do cliente)',
  vistoria: 'Vistoria',
  externo: 'Serviço externo (máquina do cliente)',
} as const;
export type TipoOS = keyof typeof TIPOS_OS;

export type StatusOS = 'aberta' | 'agendada' | 'execucao' | 'aguardando_peca' | 'concluida' | 'encerrada' | 'cancelada';
export const STATUS_OS: Record<StatusOS, string> = {
  aberta: 'Aberta',
  agendada: 'Agendada',
  execucao: 'Em execução',
  aguardando_peca: 'Aguardando peça',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
};

const SEGURANCA = ['Garfos e correntes', 'Freio de serviço', 'Freio de estacionamento', 'Buzina', 'Luzes e giroflex', 'Alarme de ré', 'Cinto de segurança', 'Extintor'];
const ESTADO = ['Pneus', 'Vazamentos (óleo, água, gás)', 'Mastro / torre', 'Painel e horímetro', 'Bateria ou cilindro de gás', 'Avarias na lataria', 'Limpeza'];
/** Itens do checklist por tipo de OS. */
export const CHECKLISTS: Record<TipoOS, string[]> = {
  preventiva: [...SEGURANCA, 'Nível de óleo do motor', 'Óleo hidráulico', 'Óleo de transmissão', 'Filtro de ar', 'Sistema de arrefecimento', ...ESTADO.slice(0, 4)],
  corretiva: ['Defeito confirmado no local', 'Máquina testada depois do reparo', ...SEGURANCA.slice(0, 4)],
  entrega: [...SEGURANCA, ...ESTADO],
  devolucao: [...SEGURANCA, ...ESTADO],
  vistoria: [...SEGURANCA, ...ESTADO],
  externo: ['Defeito confirmado no local', 'Máquina testada depois do reparo', ...SEGURANCA.slice(0, 4)],
};

export type ItemChecklist = { item: string; resposta: 'ok' | 'problema' | 'na' | ''; obs: string };
export type Local = { em: string; lat: number | null; lng: number | null; precisao: number | null };
export type Execucao = {
  checkin?: Local;
  checkout?: Local;
  horimetro?: number | null;
  checklist?: ItemChecklist[];
  servico?: string;
  pecas?: { codigo: string; descricao: string; quantidade: number }[];
  perifericos?: Periferico[];
  fotos?: string[];
  assinatura?: string;
  assinadoPor?: string;
  semAssinatura?: string;
  /** cópia do formulário do modelo (quando a OS foi aberta com um modelo) */
  formulario?: Formulario;
  /** respostas por campo; campo de foto guarda a lista de arquivos */
  respostas?: Record<string, Resposta>;
};

export type Ordem = {
  id: string;
  numero: number;
  frota: string;
  clienteId: string | null;
  clienteNome: string;
  tipo: TipoOS;
  tipoVisita: string;
  status: StatusOS;
  tecnicoId: number | null;
  tecnicoNome: string;
  agendadaPara: string | null;
  descricao: string;
  pendenciaId: number | null;
  execucao: Execucao;
  criadaPor: string;
  criadaEm: string;
  atualizadaEm: string;
  concluidaEm: string | null;
  encerradaEm: string | null;
  encerradaPor: string;
  relatorioPara: string;
  relatorioEm: string | null;
  cancelamento: string;
};

export type NovaOrdem = { formulario?: Formulario | null; frota: string; clienteId: string | null; clienteNome: string; tipo: TipoOS; tipoVisita: string; tecnicoId: number | null; agendadaPara: string | null; descricao: string; pendenciaId: number | null };

export class ProibidoOS extends Error {}

const agora = () => new Date().toISOString();
/** fotos gerais + fotos dos campos do formulário */
const todasAsFotos = (ex: Execucao) => [...(ex.fotos ?? []), ...Object.values(ex.respostas ?? {}).flatMap((v) => (Array.isArray(v) ? v : []))];
const MAX_FOTOS = 12;

export function ordens(db: Banco, pastaDados: string, regrasPerifericos: () => RegraPeriferico[]) {
  const equip = equipamentos(db);
  const sel = `SELECT o.*, t.nome AS tecnico_nome, c.nome AS criada_por_nome, e.nome AS encerrada_por_nome FROM ordens o
     LEFT JOIN usuarios t ON t.id = o.tecnico_id LEFT JOIN usuarios c ON c.id = o.criada_por LEFT JOIN usuarios e ON e.id = o.encerrada_por`;
  const deLinha = (r: Record<string, unknown>): Ordem => ({
    id: r.id as string,
    numero: r.numero as number,
    frota: r.frota as string,
    clienteId: (r.cliente_id as string | null) ?? null,
    clienteNome: r.cliente_nome as string,
    tipo: r.tipo as TipoOS,
    tipoVisita: r.tipo_visita as string,
    status: r.status as StatusOS,
    tecnicoId: (r.tecnico_id as number | null) ?? null,
    tecnicoNome: (r.tecnico_nome as string | null) ?? '',
    agendadaPara: (r.agendada_para as string | null) ?? null,
    descricao: r.descricao as string,
    pendenciaId: (r.pendencia_id as number | null) ?? null,
    execucao: JSON.parse(r.execucao as string) as Execucao,
    criadaPor: (r.criada_por_nome as string | null) ?? '',
    criadaEm: r.criada_em as string,
    atualizadaEm: r.atualizada_em as string,
    concluidaEm: (r.concluida_em as string | null) ?? null,
    encerradaEm: (r.encerrada_em as string | null) ?? null,
    encerradaPor: (r.encerrada_por_nome as string | null) ?? '',
    relatorioPara: r.relatorio_para as string,
    relatorioEm: (r.relatorio_em as string | null) ?? null,
    cancelamento: r.cancelamento as string,
  });
  const buscar = (id: string) => {
    const r = db.prepare(`${sel} WHERE o.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new DadoInvalido('Ordem de serviço não encontrada.');
    return deLinha(r);
  };
  const pasta = (id: string) => join(pastaDados, 'ordens', id);
  const salvarExecucao = (id: string, ex: Execucao, status?: StatusOS) => {
    if (status) db.prepare('UPDATE ordens SET execucao = ?, status = ?, atualizada_em = ? WHERE id = ?').run(JSON.stringify(ex), status, agora(), id);
    else db.prepare('UPDATE ordens SET execucao = ?, atualizada_em = ? WHERE id = ?').run(JSON.stringify(ex), agora(), id);
  };
  const exigirStatus = (o: Ordem, ok: StatusOS[], acao: string) => {
    if (!ok.includes(o.status)) throw new DadoInvalido(`Não dá para ${acao}: a OS ${o.numero} está "${STATUS_OS[o.status]}".`);
  };

  return {
    buscar,
    listar(f: { tecnicoId?: number; abertas?: boolean } = {}): Ordem[] {
      const cond: string[] = [];
      const args: unknown[] = [];
      if (f.tecnicoId !== undefined) {
        cond.push('o.tecnico_id = ?');
        args.push(f.tecnicoId);
      }
      if (f.abertas) cond.push("o.status NOT IN ('encerrada', 'cancelada')");
      return (db.prepare(`${sel} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY o.numero DESC LIMIT 1000`).all(...args) as Record<string, unknown>[]).map(deLinha);
    },
    criar(n: NovaOrdem, usuarioId: number): Ordem {
      const id = randomUUID();
      const numero = ((db.prepare('SELECT MAX(numero) AS m FROM ordens').get() as { m: number | null }).m ?? 0) + 1;
      const status: StatusOS = n.tecnicoId && n.agendadaPara ? 'agendada' : 'aberta';
      const execucao: Execucao = n.formulario ? { formulario: n.formulario, respostas: {} } : { checklist: CHECKLISTS[n.tipo].map((item): ItemChecklist => ({ item, resposta: '', obs: '' })) };
      db.prepare(
        `INSERT INTO ordens (id, numero, frota, cliente_id, cliente_nome, tipo, tipo_visita, status, tecnico_id, agendada_para, descricao, pendencia_id, execucao, criada_por, criada_em, atualizada_em, modelo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        numero,
        n.frota,
        n.clienteId,
        n.clienteNome,
        n.tipo,
        n.tipoVisita,
        status,
        n.tecnicoId,
        n.agendadaPara,
        n.descricao,
        n.pendenciaId,
        JSON.stringify(execucao),
        usuarioId,
        agora(),
        agora(),
        n.formulario?.modeloId ?? null,
      );
      return buscar(id);
    },
    /** Escritório muda técnico, data, descrição. Com técnico e data, a OS aberta vira agendada. */
    alterar(id: string, d: { tecnicoId?: number | null; agendadaPara?: string | null; descricao?: string; tipoVisita?: string }) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca'], 'alterar');
      const tecnico = d.tecnicoId === undefined ? o.tecnicoId : d.tecnicoId;
      const data = d.agendadaPara === undefined ? o.agendadaPara : d.agendadaPara;
      let status = o.status;
      if (status === 'aberta' && tecnico && data) status = 'agendada';
      if (status === 'agendada' && (!tecnico || !data)) status = 'aberta';
      db.prepare('UPDATE ordens SET tecnico_id = ?, agendada_para = ?, descricao = ?, tipo_visita = ?, status = ?, atualizada_em = ? WHERE id = ?').run(
        tecnico,
        data,
        d.descricao ?? o.descricao,
        d.tipoVisita ?? o.tipoVisita,
        status,
        agora(),
        id,
      );
      return buscar(id);
    },
    checkin(id: string, local: Local) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca'], 'fazer o check-in');
      const ex = { ...o.execucao, checkin: o.execucao.checkin ?? local };
      salvarExecucao(id, ex, o.status === 'aguardando_peca' ? 'aguardando_peca' : 'execucao');
      return buscar(id);
    },
    /** Rascunho do técnico (salva a cada mudança). aguardandoPeca alterna a espera. */
    salvar(id: string, d: Partial<Pick<Execucao, 'horimetro' | 'checklist' | 'servico' | 'pecas' | 'perifericos' | 'assinadoPor' | 'semAssinatura' | 'respostas'>>, aguardandoPeca?: boolean) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca'], 'salvar');
      // respostas se juntam às que já existem (fotos dos campos ficam)
      if (d.respostas) d = { ...d, respostas: { ...(o.execucao.respostas ?? {}), ...d.respostas } };
      // campo que não veio continua como estava
      const ex = { ...o.execucao, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
      const status: StatusOS | undefined = aguardandoPeca === true ? 'aguardando_peca' : aguardandoPeca === false && o.status === 'aguardando_peca' ? 'execucao' : undefined;
      salvarExecucao(id, ex, status);
      return buscar(id);
    },
    /** campoId: foto de uma pergunta do formulário; sem campo: fotos gerais da OS. */
    adicionarFoto(id: string, conteudo: Buffer, ext: 'jpg' | 'png', campoId?: string) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca', 'concluida'], 'pôr foto');
      const ex = o.execucao;
      if (todasAsFotos(ex).length >= MAX_FOTOS * 2) throw new DadoInvalido(`No máximo ${MAX_FOTOS * 2} fotos por OS.`);
      const campo = campoId ? ex.formulario?.campos.find((c) => c.id === campoId && c.tipo === 'foto') : undefined;
      if (campoId && !campo) throw new DadoInvalido('Campo de foto não encontrado.');
      if (!campo && (ex.fotos ?? []).length >= MAX_FOTOS) throw new DadoInvalido(`No máximo ${MAX_FOTOS} fotos gerais por OS.`);
      mkdirSync(pasta(id), { recursive: true });
      const nome = `foto-${Date.now()}.${ext}`;
      writeFileSync(join(pasta(id), nome), conteudo);
      if (campo) {
        const atuais = Array.isArray(ex.respostas?.[campo.id]) ? (ex.respostas![campo.id] as string[]) : [];
        salvarExecucao(id, { ...ex, respostas: { ...(ex.respostas ?? {}), [campo.id]: [...atuais, nome] } });
      } else salvarExecucao(id, { ...ex, fotos: [...(ex.fotos ?? []), nome] });
      return buscar(id);
    },
    tirarFoto(id: string, nome: string) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca', 'concluida'], 'tirar foto');
      const respostas = Object.fromEntries(Object.entries(o.execucao.respostas ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.filter((f) => f !== nome) : v]));
      salvarExecucao(id, { ...o.execucao, fotos: (o.execucao.fotos ?? []).filter((f) => f !== nome), ...(o.execucao.respostas ? { respostas } : {}) });
      return buscar(id);
    },
    assinar(id: string, png: Buffer, nome: string) {
      const o = buscar(id);
      exigirStatus(o, ['execucao', 'aguardando_peca'], 'assinar');
      mkdirSync(pasta(id), { recursive: true });
      const arq = `assinatura-${Date.now()}.png`;
      writeFileSync(join(pasta(id), arq), png);
      salvarExecucao(id, { ...o.execucao, assinatura: arq, assinadoPor: nome, semAssinatura: '' });
      return buscar(id);
    },
    caminhoArquivo(id: string, nome: string) {
      if (!/^(foto|assinatura)-\d+\.(jpg|png)$/.test(nome)) throw new DadoInvalido('Arquivo inválido.');
      const o = buscar(id);
      if (!todasAsFotos(o.execucao).includes(nome) && o.execucao.assinatura !== nome) throw new DadoInvalido('Arquivo não encontrado.');
      return join(pasta(id), nome);
    },
    /** Técnico termina: tudo respondido, horímetro e assinatura (ou o motivo de não ter). */
    concluir(id: string, checkout: Local) {
      const o = buscar(id);
      exigirStatus(o, ['execucao'], 'concluir');
      const ex = o.execucao;
      const faltam: string[] = [];
      if (!ex.checkin) faltam.push('o check-in');
      const f = ex.formulario;
      const exigeHorimetro = f ? f.exigeHorimetro : o.tipo !== 'externo';
      if (exigeHorimetro && (ex.horimetro === undefined || ex.horimetro === null)) faltam.push('o horímetro');
      if (f) {
        const sem = faltamNoFormulario(f, ex.respostas ?? {});
        if (sem.length) faltam.push(sem.length > 3 ? `${sem.length} perguntas do formulário (${sem.slice(0, 3).join(', ')}…)` : sem.join(', '));
        if (todasAsFotos(ex).length < f.fotosMinimas) faltam.push(`pelo menos ${f.fotosMinimas} foto${f.fotosMinimas > 1 ? 's' : ''}`);
      } else {
        const semResposta = (ex.checklist ?? []).filter((c) => !c.resposta).length;
        if (semResposta) faltam.push(`${semResposta} ite${semResposta > 1 ? 'ns' : 'm'} do checklist`);
      }
      if (!ex.servico?.trim()) faltam.push('o que foi feito');
      const exigeAssinatura = f ? f.exigeAssinatura : true;
      if (exigeAssinatura && !ex.assinatura && !ex.semAssinatura?.trim()) faltam.push('a assinatura do cliente (ou o motivo de não ter)');
      if (faltam.length) throw new DadoInvalido(`Falta preencher: ${faltam.join(', ')}.`);
      salvarExecucao(id, { ...ex, checkout }, 'concluida');
      db.prepare('UPDATE ordens SET concluida_em = ? WHERE id = ?').run(agora(), id);
      return buscar(id);
    },
    /** Volta uma OS concluída para o técnico corrigir. */
    devolver(id: string) {
      const o = buscar(id);
      exigirStatus(o, ['concluida'], 'devolver ao técnico');
      db.prepare("UPDATE ordens SET status = 'execucao', concluida_em = NULL, atualizada_em = ? WHERE id = ?").run(agora(), id);
      return buscar(id);
    },
    cancelar(id: string, motivo: string) {
      const o = buscar(id);
      exigirStatus(o, ['aberta', 'agendada', 'execucao', 'aguardando_peca', 'concluida'], 'cancelar');
      db.prepare("UPDATE ordens SET status = 'cancelada', cancelamento = ?, atualizada_em = ? WHERE id = ?").run(motivo, agora(), id);
      return buscar(id);
    },
    /**
     * Escritório revisa e encerra: atualiza a ficha (horímetro, visita, periféricos, próxima preventiva),
     * lança no histórico (origem 'os') e resolve a pendência ligada.
     */
    encerrar(id: string, usuarioId: number, d: { proximaPreventiva: number | null }) {
      const o = buscar(id);
      exigirStatus(o, ['concluida'], 'encerrar');
      const ex = o.execucao;
      const data = (o.concluidaEm ?? agora()).slice(0, 10);
      const horimetro = ex.horimetro ?? null;
      db.transaction(() => {
        if (o.tipo !== 'externo') {
          const dados: DadosEquipamento = { ultimaVisita: data, tecnico: o.tecnicoNome || null };
          if (horimetro !== null) {
            dados.horimetro = horimetro;
            dados.horimetroEm = data;
          }
          if (d.proximaPreventiva !== null) dados.proximaPreventiva = d.proximaPreventiva;
          Object.assign(dados, camposPerifericos(regrasPerifericos(), (ex.perifericos ?? []).filter((p) => PERIFERICOS.includes(p)), data, horimetro));
          equip.salvar(o.frota, dados, usuarioId);
        }
        const ins = db.prepare(
          `INSERT INTO historico_pecas (data, frota, ativo, cliente, tecnico, pendencia, codigo, descricao, quantidade, valor_unitario, valor_total, horimetro, origem)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'os')`,
        );
        const frota = o.tipo === 'externo' ? null : o.frota;
        const resumo = `OS ${o.numero}: ${(ex.servico ?? '').slice(0, 500)}`;
        ins.run(data, frota, `FT ${o.frota}`, o.clienteNome, o.tecnicoNome, resumo, '', `OS ${o.numero} · ${TIPOS_OS[o.tipo].toUpperCase()}`, 1, horimetro);
        for (const p of ex.pecas ?? []) ins.run(data, frota, `FT ${o.frota}`, o.clienteNome, o.tecnicoNome, resumo, p.codigo, p.descricao, p.quantidade, horimetro);
        if (o.pendenciaId)
          db.prepare("UPDATE pendencias SET status = 'resolvida', resolvida_em = ?, resolvida_por = ?, resolucao = ? WHERE id = ? AND status = 'aberta'").run(
            agora(),
            usuarioId,
            `OS ${o.numero}`,
            o.pendenciaId,
          );
        db.prepare("UPDATE ordens SET status = 'encerrada', encerrada_em = ?, encerrada_por = ?, atualizada_em = ? WHERE id = ?").run(agora(), usuarioId, agora(), id);
      })();
      return buscar(id);
    },
    registrarRelatorio(id: string, para: string[]) {
      db.prepare('UPDATE ordens SET relatorio_para = ?, relatorio_em = ? WHERE id = ?').run(para.join(', '), agora(), id);
      return buscar(id);
    },
    /** Fotos que existem no disco (para conferir). */
    arquivosNoDisco(id: string) {
      try {
        return readdirSync(pasta(id));
      } catch {
        return [];
      }
    },
  };
}
