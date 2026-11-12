import type { Cliente, Movimentacao, NovaMovimentacao, TipoMov } from '../types';
import { formatarReais, lerReais } from './dinheiro';
import { dataBr } from './calendario';
import { encontrarCliente } from './pareamento';
import { semAcento } from './normalizar';

export const NOMES_TIPO: Record<TipoMov, string> = { locacao: 'Nova locação', devolucao: 'Devolução', troca: 'Troca de frota', reajuste: 'Reajuste' };

/** Quanto a movimentação muda na receita mensal (centavos; null = não dá para saber). */
export function efeitoNaReceita(m: Pick<Movimentacao, 'tipo' | 'dados'>): number | null {
  const d = m.dados;
  if (m.tipo === 'reajuste') return (d.itens ?? []).reduce((t, i) => t + i.novo - i.antes, 0);
  if (m.tipo === 'locacao') return d.valor ?? null;
  if (m.tipo === 'devolucao') return d.valorAnterior != null ? -d.valorAnterior : null;
  if (m.tipo === 'troca') return d.valor != null && d.valorAnterior != null ? d.valor - d.valorAnterior : 0;
  return null;
}

/** Primeiro dia do mês seguinte (reajuste costuma valer a partir do próximo faturamento). */
export const proximoMes = (hoje: string) => {
  const [a, mm] = hoje.split('-').map(Number);
  return mm === 12 ? `${a + 1}-01-01` : `${a}-${String(mm + 1).padStart(2, '0')}-01`;
};
export const somarMeses = (iso: string, n: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1 + n, d));
  return t.toISOString().slice(0, 10);
};

export const movVazia = (data: string): NovaMovimentacao => ({
  tipo: 'locacao',
  frota: '',
  frotaNova: '',
  clienteId: null,
  clienteNome: '',
  data,
  fim: null,
  valor: null,
  frete: '',
  gas: 0,
  contrato: '',
  prazoPagamento: '',
  emails: [],
  contatoNome: '',
  contatoTelefone: '',
  descricao: '',
  observacoes: '',
});

const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RE_TELEFONE = /\(?\d{2}\)?\s*9?\s*\d{4}[\s-]?\d{4}/;

/**
 * Lê uma mensagem no formato que operações já usa no WhatsApp/e-mail, por exemplo:
 *   NOVA LOCAÇÃO FT35
 *   20/10/2026
 *   FENIX NOVUS
 *   - Valor da Locação: R$3.350,00
 *   - Frete: Por conta da Lucminas
 *   - 1 vasilhame de gás
 *   - Tempo de contrato: 12 meses
 *   - Prazo de pagamento: 30 dias após emissão da fatura
 *   - E-mails: compras@x.com.br comercial@x.com.br
 *   - Contato: João Pedro (31) 98808-9842
 * Devolve só o que conseguiu reconhecer; o resto fica para a pessoa preencher.
 */
export function lerTextoMovimentacao(texto: string, clientes: Cliente[]): Partial<NovaMovimentacao> {
  const r: Partial<NovaMovimentacao> = {};
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plano = semAcento(texto).toUpperCase();

  if (/DEVOLU/.test(plano)) r.tipo = 'devolucao';
  else if (/TROCA|SUBSTITUI/.test(plano)) r.tipo = 'troca';
  else if (/LOCACAO|LOCADA|ALUGUEL/.test(plano)) r.tipo = 'locacao';

  const frotas = [...plano.matchAll(/\b(?:FT|FROTA)[\s.:#-]*([A-Z]?\d+[A-Z]?)\b/g)].map((m) => m[1]);
  if (frotas[0]) r.frota = frotas[0];
  if (frotas[1]) r.frotaNova = frotas[1];

  const d = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(texto);
  if (d) r.data = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;

  const campo = (re: RegExp) => {
    for (const l of linhas) {
      const m = re.exec(l.replace(/^[-•*]\s*/, ''));
      if (m) return m[1].trim();
    }
    return '';
  };

  const valor = campo(/^valor[^:]*:\s*(.+)$/i);
  if (valor) {
    const v = lerReais(valor.replace(/[^\d.,]/g, ''));
    if (v !== null) r.valor = v;
  }
  const frete = semAcento(campo(/^frete\s*:?\s*(.+)$/i)).toLowerCase();
  if (frete) r.frete = /lucminas|nosso|nossa/.test(frete) ? 'lucminas' : /cliente/.test(frete) ? 'cliente' : '';
  const gas = /(\d+)\s*(?:vasilhames?|cilindros?|botij)/i.exec(texto);
  if (gas) r.gas = Number(gas[1]);
  else if (/sem\s+(?:gas|g[aá]s)/i.test(texto)) r.gas = 0;
  const contrato = campo(/^tempo de contrato\s*:\s*(.+)$/i) || campo(/^contrato\s*:\s*(.+)$/i);
  if (contrato) r.contrato = contrato;
  const fimTxt = campo(/^(?:t[ée]rmino|fim|final|at[ée])(?: (?:do contrato|da loca[çc][ãa]o|previsto))?\s*:\s*(.+)$/i);
  const fimD = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(fimTxt);
  if (fimD) r.fim = `${fimD[3]}-${fimD[2].padStart(2, '0')}-${fimD[1].padStart(2, '0')}`;
  const prazo = campo(/^prazo(?: de pagamento)?\s*:\s*(.+)$/i);
  if (prazo) r.prazoPagamento = prazo;

  const emails = [...new Set((texto.match(RE_EMAIL) ?? []).map((e) => e.toLowerCase()))];
  if (emails.length) r.emails = emails;

  const contato = campo(/^contato\s*:\s*(.+)$/i);
  if (contato) {
    const tel = RE_TELEFONE.exec(contato);
    r.contatoTelefone = tel ? tel[0].trim() : '';
    r.contatoNome = (tel ? contato.replace(tel[0], '') : contato).replace(/[-–,]+\s*$/, '').trim();
  }

  // cliente: a primeira linha "solta" (sem "-", sem ":", que não é o título nem a data)
  const candidata = linhas.find((l, i) => {
    if (/^[-•*]/.test(l) || l.includes(':') || RE_EMAIL.test(l)) {
      RE_EMAIL.lastIndex = 0;
      return false;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l)) return false;
    const p = semAcento(l).toUpperCase();
    if (i === 0 && /LOCA|DEVOLU|TROCA|\bFT\s*\d/.test(p)) return false;
    return true;
  });
  if (candidata) {
    const nome = candidata.replace(/\s*\d{1,2}\/\d{1,2}\/\d{4}\s*/, ' ').trim().toUpperCase();
    const achado = encontrarCliente(nome, clientes);
    if (achado) {
      r.clienteId = achado.clienteId;
      r.clienteNome = clientes.find((c) => c.id === achado.clienteId)?.nome ?? nome;
    } else {
      r.clienteId = null;
      r.clienteNome = nome;
    }
  }
  return r;
}

/**
 * Sugere o término a partir do início e do tempo de contrato ("12 meses", "30 dias", "1 ano").
 * Ex.: início 20/10/2026 + 12 meses → 19/10/2027. Devolve null se não der para entender.
 */
export function fimSugerido(inicio: string, contrato: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return null;
  const m = /(\d+)\s*(dias?|mes(?:es)?|m[eê]s|anos?)/i.exec(semAcento(contrato).toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  const d = new Date(inicio + 'T00:00:00Z');
  if (/^dia/.test(m[2])) d.setUTCDate(d.getUTCDate() + n);
  else {
    const meses = /^ano/.test(m[2]) ? n * 12 : n;
    const dia = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + meses);
    const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dia, ultimo));
  }
  d.setUTCDate(d.getUTCDate() - 1); // o último dia é o anterior ao "aniversário"
  return d.toISOString().slice(0, 10);
}

/** Texto da movimentação no formato que vai para o grupo (WhatsApp). */
export function textoMensagem(m: Pick<Movimentacao, 'tipo' | 'frota' | 'clienteNome' | 'dados'> & { frotaNova?: string | null }): string {
  const d = m.dados;
  const ft = (f: string) => `FT${f.trim().toUpperCase().replace(/^FT[\s-]*/, '')}`;
  const l: string[] = [];
  if (m.tipo === 'reajuste') {
    l.push(`REAJUSTE ${(m.clienteNome || '').toUpperCase()}`.trim());
    l.push(`A partir de ${dataBr(d.data)}`);
    for (const i of d.itens ?? []) {
      const p = i.antes ? ` (${i.novo >= i.antes ? '+' : ''}${(((i.novo - i.antes) / i.antes) * 100).toFixed(1).replace('.', ',')}%)` : '';
      l.push(`- ${ft(i.frota)}: ${formatarReais(i.antes)} → ${formatarReais(i.novo)}${p}`);
    }
    if (d.renovaAte) l.push(`- Contrato renovado até: ${dataBr(d.renovaAte)}`);
    if (d.observacoes) l.push(`- Motivo: ${d.observacoes}`);
    return l.join('\n').replace(/\u00a0/g, ' ');
  }
  const titulo = { locacao: 'NOVA LOCAÇÃO', devolucao: 'DEVOLUÇÃO', troca: 'TROCA DE FROTA' }[m.tipo];
  l.push(`${titulo} ${ft(m.frota)}${m.tipo === 'troca' && m.frotaNova ? ` → ${ft(m.frotaNova)}` : ''}`);
  if (d.data) l.push(dataBr(d.data));
  if (m.clienteNome) l.push(m.clienteNome.toUpperCase());
  if (d.valor != null) l.push(`- Valor da Locação: ${formatarReais(d.valor)}`);
  if (d.frete) l.push(`- Frete: ${d.frete === 'lucminas' ? 'Por conta da Lucminas' : 'Por conta do cliente'}`);
  if (d.gas) l.push(`- Gás: ${d.gas} vasilhame${d.gas > 1 ? 's' : ''}`);
  if (d.contrato) l.push(`- Tempo de contrato: ${d.contrato}`);
  if (d.fim) l.push(`- Término previsto: ${dataBr(d.fim)}`);
  if (d.prazoPagamento) l.push(`- Prazo de pagamento: ${d.prazoPagamento}`);
  if (d.emails?.length) l.push(`- E-mails para a fatura: ${d.emails.join(', ')}`);
  if (d.contatoNome || d.contatoTelefone) l.push(`- Contato: ${[d.contatoNome, d.contatoTelefone].filter(Boolean).join(' - ')}`);
  if (d.descricao) l.push(`- Equipamento: ${d.descricao}`);
  if (d.observacoes) l.push(`- Obs.: ${d.observacoes}`);
  return l.join('\n').replace(/\u00a0/g, ' ');
}

/** Copia texto (com saída para navegador sem permissão de área de transferência). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = texto;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
