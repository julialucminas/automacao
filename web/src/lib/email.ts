import type { Cliente, ItemLote } from '../types';

export const EMPRESA = 'Lucminas Empilhadeiras';
export const REMETENTE = 'financeiro@lucminas.com.br';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2026-10" → "outubro/2026" */
export function referenciaPorExtenso(ref: string): string {
  const [a, m] = ref.split('-').map(Number);
  return `${MESES[m - 1]}/${a}`;
}

export function referenciaTitulo(ref: string): string {
  const s = referenciaPorExtenso(ref);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function referenciaAtual(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Texto provisório: substituir pelo modelo que o financeiro usa hoje.
export function montarEmail(item: ItemLote, _cliente: Cliente, referencia: string) {
  const assunto = `Fatura de locação nº ${item.numero} · ${EMPRESA}`;
  const corpo =
    `Prezados,\n\n` +
    `Segue em anexo a fatura de locação nº ${item.numero}, referente a ${referenciaPorExtenso(referencia)}, ` +
    `e o boleto para pagamento.\n\n` +
    `Em caso de dúvida, é só responder este e-mail.\n\n` +
    `Atenciosamente,\nFinanceiro · ${EMPRESA}`;
  return { assunto, corpo };
}

export function dataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}
