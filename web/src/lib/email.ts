import type { Cliente, ConfigEmail, ItemLote } from '../types';

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

export const MODELO_PADRAO: ConfigEmail = {
  'email.remetente': `Financeiro · ${EMPRESA}`,
  'email.assunto': `Fatura de locação nº {numero} · ${EMPRESA}`,
  'email.corpo':
    'Prezados,\n\n' +
    'Segue em anexo a fatura de locação nº {numero}, referente a {mes}, e o boleto para pagamento.\n\n' +
    'Em caso de dúvida, é só responder este e-mail.\n\n' +
    `Atenciosamente,\nFinanceiro · ${EMPRESA}`,
};

export const VARIAVEIS = [
  { nome: '{numero}', descricao: 'número da fatura' },
  { nome: '{cliente}', descricao: 'nome do cliente' },
  { nome: '{mes}', descricao: 'mês de referência (ex.: outubro/2026)' },
  { nome: '{frotas}', descricao: 'números das frotas do cliente' },
];

/** Troca {numero}, {cliente}, {mes} e {frotas}; o que não for variável conhecida fica como está. */
export function preencher(modelo: string, v: { numero: string; cliente: string; mes: string; frotas: string }): string {
  return modelo.replace(/\{(numero|cliente|mes|frotas)\}/gi, (_, k: string) => v[k.toLowerCase() as keyof typeof v]);
}

export function montarEmail(item: ItemLote, cliente: Cliente, referencia: string, modelo: ConfigEmail | null = null) {
  const m = modelo ?? MODELO_PADRAO;
  const v = { numero: item.numero, cliente: cliente.nome, mes: referenciaPorExtenso(referencia), frotas: cliente.frotas.map((f) => f.numero).join(', ') };
  return { assunto: preencher(m['email.assunto'], v), corpo: preencher(m['email.corpo'], v), remetente: m['email.remetente'] };
}

export function dataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}
