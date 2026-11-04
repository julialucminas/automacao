/*
 * Painel de manutenção (a aba "Programação" do Quadro Geral, dentro do sistema).
 * Tudo aqui é cálculo: horas que faltam, data prevista, em dia / atrasado e periféricos vencidos.
 */
import type { ConfigEmail, Equipamento, Pendencia, PerifericoId, RegraPeriferico, TipoVisita } from '../types';
import { hojeIso, paraData, paraIso } from './calendario';
import type { LinhaEquipamento } from './equipamentos';

export const TIPOS_PADRAO: TipoVisita[] = [
  { sigla: 'CF', nome: 'Conferência', dias: 30 },
  { sigla: 'CR', nome: 'Corretiva (cliente chama)' },
  { sigla: 'B', nome: 'Preventiva B', horas: 350 },
  { sigla: 'C', nome: 'Preventiva C', horas: 500 },
  { sigla: 'D', nome: 'Preventiva D', horas: 1000 },
];
export const PERIFERICOS_PADRAO: RegraPeriferico[] = [
  { id: 'motorPartida', nome: 'Motor de partida', dias: 120 },
  { id: 'filtroAr', nome: 'Filtro de ar', dias: 90 },
  { id: 'correia', nome: 'Correia dentada', horas: 2000 },
  { id: 'oleoTransmissao', nome: 'Óleo de transmissão', horas: 3000 },
  { id: 'oleoHidraulico', nome: 'Óleo hidráulico', horas: 2000 },
];

export type Regras = { tipos: TipoVisita[]; perifericos: RegraPeriferico[] };
export function regrasDe(config: Partial<ConfigEmail> | null): Regras {
  const ler = <T>(t: string | undefined, padrao: T): T => {
    try {
      return t ? (JSON.parse(t) as T) : padrao;
    } catch {
      return padrao;
    }
  };
  return { tipos: ler(config?.['manutencao.tipos'], TIPOS_PADRAO), perifericos: ler(config?.['manutencao.perifericos'], PERIFERICOS_PADRAO) };
}

export const somarDias = (iso: string, n: number) => paraIso(new Date(paraData(iso).getTime() + Math.round(n) * 86_400_000));
const diasEntre = (de: string, ate: string) => Math.round((paraData(ate).getTime() - paraData(de).getTime()) / 86_400_000);

export type Status = 'atrasado' | 'atencao' | 'em-dia' | 'sem-dados';
export const STATUS: Record<Status, { rotulo: string; tom: 'bad' | 'warn' | 'ok' | 'neutro'; ordem: number }> = {
  atrasado: { rotulo: 'Atrasado', tom: 'bad', ordem: 0 },
  atencao: { rotulo: 'Esta semana', tom: 'warn', ordem: 1 },
  'em-dia': { rotulo: 'Em dia', tom: 'ok', ordem: 2 },
  'sem-dados': { rotulo: 'Sem dados', tom: 'neutro', ordem: 3 },
};

export type SituacaoPeriferico = { id: PerifericoId; nome: string; ultima: string | null; proxima: string; vencido: boolean; atencao: boolean };

export type LinhaPainel = {
  frota: string;
  linha: LinhaEquipamento;
  ficha: Equipamento | null;
  tipo: TipoVisita | null;
  /** dias desde a última visita e o intervalo combinado */
  diasDesdeVisita: number | null;
  intervaloDias: number;
  proximaVisita: string | null;
  horasFaltam: number | null;
  /** data em que a preventiva deve chegar, pela média de uso */
  previsaoPreventiva: string | null;
  perifericos: SituacaoPeriferico[];
  pendencias: Pendencia[];
  status: Status;
  motivos: string[];
};

/**
 * Status da linha (como na planilha): visita e preventiva. Atrasado = passou; "esta semana" = vence em até 7 dias.
 * Dias de antecedência para "esta semana": */
const AVISO_DIAS = 7;

export function situacaoPerifericos(f: Equipamento | null, regras: RegraPeriferico[], hoje: string): SituacaoPeriferico[] {
  if (!f) return [];
  const naoAplica = new Set((f.perifericosNaoAplica ?? '').split(',').map((s) => s.trim()));
  const media = f.mediaDia ?? 0;
  const r: SituacaoPeriferico[] = [];
  for (const p of regras) {
    if (naoAplica.has(p.id)) continue;
    const ultima = f[`${p.id}Data`] ?? null;
    const proxData = f[`${p.id}ProximaData`] ?? null;
    const proxHoras = f[`${p.id}ProximaHoras`] ?? null;
    if (!ultima && proxData === null && proxHoras === null) continue;
    if (proxData) {
      const faltam = diasEntre(hoje, proxData);
      r.push({
        id: p.id,
        nome: p.nome,
        ultima,
        proxima: `até ${proxData.slice(8, 10)}/${proxData.slice(5, 7)}/${proxData.slice(0, 4)}`,
        vencido: faltam < 0,
        atencao: faltam >= 0 && faltam <= AVISO_DIAS * 2,
      });
    } else if (proxHoras !== null && f.horimetro != null) {
      const faltam = proxHoras - f.horimetro;
      r.push({
        id: p.id,
        nome: p.nome,
        ultima,
        proxima: `aos ${proxHoras.toLocaleString('pt-BR')} h`,
        vencido: faltam < 0,
        atencao: faltam >= 0 && media > 0 && faltam <= media * AVISO_DIAS * 2,
      });
    }
  }
  return r;
}

/**
 * Uma linha por máquina que está na manutenção: tem ficha com visita/horímetro ou está locada.
 * Máquinas vendidas ou baixadas ficam de fora.
 */
export function montarPainel(linhas: LinhaEquipamento[], regras: Regras, pendencias: Pendencia[], hoje = hojeIso()): LinhaPainel[] {
  const pend = new Map<string, Pendencia[]>();
  for (const p of pendencias) if (p.status === 'aberta') pend.set(p.frota, [...(pend.get(p.frota) ?? []), p]);
  const cf = regras.tipos.find((t) => t.dias)?.dias ?? 30;

  return linhas
    .filter((l) => l.situacao !== 'baixada' && (l.situacao === 'locada' || l.ficha?.ultimaVisita || l.ficha?.horimetro != null || pend.has(l.frota)))
    .map((l) => {
      const f = l.ficha;
      const tipo = regras.tipos.find((t) => t.sigla === f?.tipoVisita) ?? null;
      const intervaloDias = f?.intervaloVisitaDias ?? tipo?.dias ?? cf;
      const diasDesdeVisita = f?.ultimaVisita ? diasEntre(f.ultimaVisita, hoje) : null;
      const proximaVisita = f?.ultimaVisita ? somarDias(f.ultimaVisita, intervaloDias) : null;
      const horasFaltam = f?.proximaPreventiva != null && f.horimetro != null ? Math.round(f.proximaPreventiva - f.horimetro) : null;
      const base = f?.horimetroEm ?? f?.ultimaVisita ?? null;
      const previsaoPreventiva = horasFaltam !== null && f?.mediaDia && base ? somarDias(base, Math.max(horasFaltam, 0) / f.mediaDia) : null;
      const perifericos = situacaoPerifericos(f, regras.perifericos, hoje);

      const motivos: string[] = [];
      let status: Status = 'em-dia';
      const marcar = (s: Status, m: string) => {
        motivos.push(m);
        if (STATUS[s].ordem < STATUS[status].ordem) status = s;
      };
      if (diasDesdeVisita === null && horasFaltam === null) status = 'sem-dados';
      if (diasDesdeVisita !== null) {
        if (diasDesdeVisita > intervaloDias) marcar('atrasado', `visita atrasada ${diasDesdeVisita - intervaloDias} dia${diasDesdeVisita - intervaloDias === 1 ? '' : 's'}`);
        else if (intervaloDias - diasDesdeVisita <= AVISO_DIAS)
          marcar('atencao', `visita vence em ${intervaloDias - diasDesdeVisita} dia${intervaloDias - diasDesdeVisita === 1 ? '' : 's'}`);
      }
      if (horasFaltam !== null) {
        if (horasFaltam < 0) marcar('atrasado', `preventiva passou ${-horasFaltam} h`);
        else if (previsaoPreventiva && diasEntre(hoje, previsaoPreventiva) <= AVISO_DIAS) marcar('atencao', `preventiva em ${horasFaltam} h`);
      }
      // periféricos vencidos aparecem à parte e não mudam a cor da linha (senão quase tudo fica vermelho)
      const pendencias = pend.get(l.frota) ?? [];
      return { frota: l.frota, linha: l, ficha: f, tipo, diasDesdeVisita, intervaloDias, proximaVisita, horasFaltam, previsaoPreventiva, perifericos, pendencias, status, motivos };
    });
}

/** Ordem padrão: mais urgente primeiro; dentro do mesmo status, a visita mais antiga primeiro. */
export const ordenarPorUrgencia = (a: LinhaPainel, b: LinhaPainel) =>
  STATUS[a.status].ordem - STATUS[b.status].ordem || (b.diasDesdeVisita ?? -1) - (a.diasDesdeVisita ?? -1) || a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true });
