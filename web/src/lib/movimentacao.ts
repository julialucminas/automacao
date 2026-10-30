import type { Cliente, NovaMovimentacao, TipoMov } from '../types';
import { lerReais } from './dinheiro';
import { encontrarCliente } from './pareamento';
import { semAcento } from './normalizar';

export const NOMES_TIPO: Record<TipoMov, string> = { locacao: 'Nova locação', devolucao: 'Devolução', troca: 'Troca de frota' };

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
