import { CAMPOS_CADASTRO, type CadastroCliente, type Cliente } from '../types';
import type { ItemCompletarCadastro } from '../api';
import { chaveEmpresa } from './normalizar';

/**
 * Planilha "Clientes - CNPJ e cadastro (sistema de locação)": uma linha por cliente do nosso sistema,
 * com os dados do cadastro no sistema de locação. Aqui só se lê e se compara; e-mails nunca entram.
 */

type Celula = string | number | boolean | Date | null;

/** coluna da planilha → campo do cadastro */
const COLUNAS: Record<string, keyof CadastroCliente | 'nomeSistema' | 'situacao' | 'cnpj' | 'contato' | 'telefone'> = {
  'nome no sistema': 'nomeSistema',
  situacao: 'situacao',
  'o que conferir': 'conferir',
  'codigo locacao': 'codigoLocacao',
  'razao social': 'razaoSocial',
  'nome fantasia': 'nomeFantasia',
  'cnpj/cpf': 'cnpj',
  cnpj: 'cnpj',
  'inscricao estadual': 'inscricaoEstadual',
  endereco: 'endereco',
  numero: 'numero',
  complemento: 'complemento',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'uf',
  cep: 'cep',
  'endereco de cobranca': 'enderecoCobranca',
  contato: 'contato',
  funcao: 'funcao',
  telefone: 'telefone',
  celular: 'celular',
  atividade: 'atividade',
  'cond. pagamento': 'condPagamento',
};

export const chaveNome = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const txt = (v: Celula | undefined) => (v === null || v === undefined ? '' : v instanceof Date ? '' : String(v).trim());

export type LinhaLocacao = {
  linha: number;
  nomeSistema: string;
  situacao: string;
  cnpj: string;
  contato: string;
  telefone: string;
  cadastro: CadastroCliente;
};

/** Lê as linhas da planilha. Erro se não for a planilha certa (sem "Nome no sistema"). */
export function lerPlanilhaLocacao(linhas: Celula[][]): LinhaLocacao[] {
  const cab = (linhas[0] ?? []).map((c) => chaveNome(txt(c)).toLowerCase());
  const idx = new Map<string, number>();
  cab.forEach((h, i) => {
    const original = Object.keys(COLUNAS).find((k) => chaveNome(k).toLowerCase() === h);
    if (original && !idx.has(COLUNAS[original])) idx.set(COLUNAS[original], i);
  });
  if (!idx.has('nomeSistema')) throw new Error('Esta não é a planilha do cadastro: falta a coluna "Nome no sistema".');
  const out: LinhaLocacao[] = [];
  linhas.slice(1).forEach((l, n) => {
    const v = (k: string) => (idx.has(k) ? txt(l[idx.get(k)!]) : '');
    const nomeSistema = v('nomeSistema');
    if (!nomeSistema) return;
    const cadastro: CadastroCliente = {};
    for (const k of CAMPOS_CADASTRO) {
      const x = v(k);
      if (x) cadastro[k] = x.slice(0, k === 'conferir' ? 600 : 250);
    }
    out.push({ linha: n + 2, nomeSistema, situacao: v('situacao'), cnpj: v('cnpj'), contato: v('contato'), telefone: v('telefone') || v('celular'), cadastro });
  });
  return out;
}

export type PropostaCadastro = {
  lido: LinhaLocacao;
  cliente: Cliente | null;
  /** o que vai mudar (só campos hoje vazios) */
  novos: { rotulo: string; valor: string }[];
  cnpjDiferente: boolean;
  acao: 'completar' | 'igual' | 'sem_dados' | 'sem_cliente';
  item: ItemCompletarCadastro | null;
};

export const ROTULO_CADASTRO: Record<keyof CadastroCliente, string> = {
  razaoSocial: 'Razão social',
  nomeFantasia: 'Nome fantasia',
  inscricaoEstadual: 'Inscrição estadual',
  endereco: 'Endereço',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  cep: 'CEP',
  enderecoCobranca: 'Endereço de cobrança',
  celular: 'Celular',
  funcao: 'Função do contato',
  atividade: 'Atividade',
  condPagamento: 'Cond. de pagamento (locação)',
  codigoLocacao: 'Código no sistema de locação',
  conferir: 'Conferir',
};

const soDigitos = (x: string) => x.replace(/\D/g, '');

/** Aplica o item no cliente do jeito que o servidor faz: só preenche vazios, nunca mexe em e-mails. */
export function completarCliente(c: Cliente, it: ItemCompletarCadastro): { cliente: Cliente; mudou: boolean; cnpjDiferente: boolean } {
  const cad: CadastroCliente = { ...(c.cadastro ?? {}) };
  for (const k of CAMPOS_CADASTRO) {
    const v = (it.cadastro[k] ?? '').trim();
    if (v && !cad[k]) cad[k] = v;
  }
  const cnpjNovo = (it.cnpj ?? '').trim();
  const cnpj = !c.cnpj.trim() && cnpjNovo ? cnpjNovo : c.cnpj;
  const cnpjDiferente = !!cnpjNovo && !!c.cnpj.trim() && soDigitos(c.cnpj) !== soDigitos(cnpjNovo);
  const contato = (c.contato ?? '').trim() ? c.contato ?? '' : (it.contato ?? '').trim();
  const telefone = (c.telefone ?? '').trim() ? c.telefone ?? '' : (it.telefone ?? '').trim();
  const mudou = JSON.stringify(cad) !== JSON.stringify(c.cadastro ?? {}) || cnpj !== c.cnpj || contato !== (c.contato ?? '') || telefone !== (c.telefone ?? '');
  return { cliente: { ...c, cadastro: cad, cnpj, contato, telefone }, mudou, cnpjDiferente };
}

/** Casa cada linha com o cliente pelo nome (ou apelido) e mostra o que entraria. */
export function proporCadastros(linhas: LinhaLocacao[], clientes: Cliente[]): PropostaCadastro[] {
  const porNome = new Map<string, Cliente>();
  // nome exato primeiro; depois apelidos (acentos, pontuação e LTDA/SA ignorados, como no resto do sistema)
  for (const c of clientes) porNome.set(chaveEmpresa(c.nome), c);
  for (const c of clientes) for (const n of c.apelidos) if (!porNome.has(chaveEmpresa(n))) porNome.set(chaveEmpresa(n), c);
  return linhas.map((lido) => {
    const cliente = porNome.get(chaveEmpresa(lido.nomeSistema)) ?? null;
    const temDados = !!(lido.cnpj || lido.cadastro.razaoSocial);
    if (!cliente) return { lido, cliente, novos: [], cnpjDiferente: false, acao: 'sem_cliente', item: null };
    if (!temDados) return { lido, cliente, novos: [], cnpjDiferente: false, acao: 'sem_dados', item: null };
    const item: ItemCompletarCadastro = { id: cliente.id, cadastro: lido.cadastro, cnpj: lido.cnpj, contato: lido.contato, telefone: lido.telefone };
    const r = completarCliente(cliente, item);
    const novos: { rotulo: string; valor: string }[] = [];
    if (r.cliente.cnpj !== cliente.cnpj) novos.push({ rotulo: 'CNPJ', valor: r.cliente.cnpj });
    if (r.cliente.contato !== (cliente.contato ?? '')) novos.push({ rotulo: 'Contato', valor: r.cliente.contato ?? '' });
    if (r.cliente.telefone !== (cliente.telefone ?? '')) novos.push({ rotulo: 'Telefone', valor: r.cliente.telefone ?? '' });
    for (const k of CAMPOS_CADASTRO) if (r.cliente.cadastro?.[k] !== cliente.cadastro?.[k]) novos.push({ rotulo: ROTULO_CADASTRO[k], valor: r.cliente.cadastro?.[k] ?? '' });
    return { lido, cliente, novos, cnpjDiferente: r.cnpjDiferente, acao: r.mudou ? 'completar' : 'igual', item: r.mudou ? item : null };
  });
}

/** Endereço numa linha só, para a pasta do cliente. */
export function enderecoDe(c: CadastroCliente | undefined): string {
  if (!c) return '';
  const rua = [c.endereco, c.numero].filter(Boolean).join(', ');
  const cidade = [c.cidade, c.uf].filter(Boolean).join('/');
  return [rua, c.complemento, c.bairro, cidade, c.cep ? `CEP ${c.cep}` : ''].filter(Boolean).join(' · ');
}
