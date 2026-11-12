/*
 * Permissões por perfil. Cada perfil tem, para cada aba, um nível:
 *   0 = não vê · 1 = vê · 2 = edita
 * e a permissão à parte "vê valores" (somas, totais e valores nos relatórios em PDF).
 * O administrador muda isso na tela Usuários e permissões; o servidor confere em toda ação.
 */
import type { Banco } from './db.js';

export const ABAS = [
  'inicio',
  'appDono',
  'solicitacoes',
  'manutencao',
  'ordens',
  'externos',
  'movimentacoes',
  'conferencia',
  'calendario',
  'frotas',
  'envio',
  'historico',
  'configuracoes',
  'clientes',
  'aprovacoes',
  'registro',
  'usuarios',
] as const;
export type Aba = (typeof ABAS)[number];
export type Nivel = 0 | 1 | 2;
export type Permissoes = Record<Aba, Nivel>;
export type Perfil = { id: string; nome: string; descricao: string; permissoes: Permissoes; veValores: boolean; padrao: boolean };

const tudo = (n: Nivel): Permissoes => Object.fromEntries(ABAS.map((a) => [a, n])) as Permissoes;
const com = (base: Nivel, extra: Partial<Permissoes>): Permissoes => ({ ...tudo(base), ...extra });

/** Perfis que vêm prontos. O administrador pode ajustar depois; o que ele mudar não é sobrescrito. */
export const PERFIS_PADRAO: Omit<Perfil, 'padrao'>[] = [
  { id: 'admin', nome: 'Administrador', descricao: 'Tudo, inclusive usuários e permissões.', permissoes: tudo(2), veValores: true },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    descricao: 'Todas as abas, menos usuários e senhas. Abre na Central do financeiro.',
    permissoes: com(2, { usuarios: 0 }),
    veValores: true,
  },
  {
    id: 'operacoes',
    nome: 'Operações',
    descricao: 'Movimentações, conferência e frotas. O que registra entra direto no cadastro.',
    permissoes: com(0, { inicio: 2, solicitacoes: 2, manutencao: 2, ordens: 2, externos: 2, movimentacoes: 2, conferencia: 2, calendario: 1, frotas: 2, aprovacoes: 2 }),
    veValores: false,
  },
  {
    id: 'tecnico',
    nome: 'Técnico',
    descricao: 'Técnico de campo: vê as frotas e os clientes, sem valores.',
    permissoes: com(0, { inicio: 2, solicitacoes: 2, manutencao: 1, ordens: 2, frotas: 1, clientes: 1 }),
    veValores: false,
  },
  {
    id: 'diretoria',
    nome: 'Diretoria',
    descricao: 'Vê tudo, inclusive valores, e não altera nada.',
    permissoes: com(1, { usuarios: 0, solicitacoes: 2 }),
    veValores: true,
  },
];

const nivel = (v: unknown): Nivel => (v === 2 ? 2 : v === 1 ? 1 : 0);
export const normalizarPermissoes = (v: unknown): Permissoes => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(ABAS.map((a) => [a, nivel(o[a])])) as Permissoes;
};

type Linha = { id: string; nome: string; descricao: string; permissoes: string; ve_valores: number };
const deLinha = (r: Linha): Perfil => ({
  id: r.id,
  nome: r.nome,
  descricao: r.descricao,
  permissoes: normalizarPermissoes(JSON.parse(r.permissoes)),
  veValores: !!r.ve_valores,
  padrao: PERFIS_PADRAO.some((p) => p.id === r.id),
});

/** Acesso efetivo de um usuário: o que a tela e o servidor usam. */
export type Acesso = { perfil: string; perfilNome: string; permissoes: Permissoes; veValores: boolean };

export function perfis(db: Banco) {
  // perfis padrão que ainda não existem entram sozinhos (instalação nova ou perfil novo numa versão nova)
  const inserir = db.prepare('INSERT OR IGNORE INTO perfis (id, nome, descricao, permissoes, ve_valores) VALUES (?, ?, ?, ?, ?)');
  for (const p of PERFIS_PADRAO) inserir.run(p.id, p.nome, p.descricao, JSON.stringify(p.permissoes), p.veValores ? 1 : 0);

  // aba nova numa versão nova: perfis que já existiam ganham o nível padrão dela (o resto do que o administrador mudou fica)
  for (const r of db.prepare('SELECT id, permissoes FROM perfis').all() as { id: string; permissoes: string }[]) {
    const atual = JSON.parse(r.permissoes) as Record<string, unknown>;
    const faltam = ABAS.filter((a) => !(a in atual));
    if (!faltam.length) continue;
    const padrao = PERFIS_PADRAO.find((p) => p.id === r.id)?.permissoes;
    for (const a of faltam) atual[a] = padrao?.[a] ?? 0;
    db.prepare('UPDATE perfis SET permissoes = ? WHERE id = ?').run(JSON.stringify(atual), r.id);
  }

  const buscar = (id: string) => {
    const r = db.prepare('SELECT * FROM perfis WHERE id = ?').get(id) as Linha | undefined;
    return r ? deLinha(r) : undefined;
  };

  return {
    listar(): Perfil[] {
      const ordem = PERFIS_PADRAO.map((p) => p.id);
      return (db.prepare('SELECT * FROM perfis').all() as Linha[])
        .map(deLinha)
        .sort((a, b) => (ordem.indexOf(a.id) + 1 || 99) - (ordem.indexOf(b.id) + 1 || 99) || a.nome.localeCompare(b.nome));
    },
    buscar,
    acessoDe(perfilId: string): Acesso {
      const p = buscar(perfilId);
      if (!p) return { perfil: perfilId, perfilNome: perfilId, permissoes: tudo(0), veValores: false };
      return { perfil: p.id, perfilNome: p.nome, permissoes: p.permissoes, veValores: p.veValores };
    },
    salvar(id: string, d: { nome: string; descricao: string; permissoes: Permissoes; veValores: boolean }) {
      db.prepare('UPDATE perfis SET nome = ?, descricao = ?, permissoes = ?, ve_valores = ? WHERE id = ?').run(d.nome, d.descricao, JSON.stringify(d.permissoes), d.veValores ? 1 : 0, id);
      return buscar(id)!;
    },
    criar(id: string, d: { nome: string; descricao: string; permissoes: Permissoes; veValores: boolean }) {
      db.prepare('INSERT INTO perfis (id, nome, descricao, permissoes, ve_valores) VALUES (?, ?, ?, ?, ?)').run(id, d.nome, d.descricao, JSON.stringify(d.permissoes), d.veValores ? 1 : 0);
      return buscar(id)!;
    },
    apagar(id: string) {
      db.prepare('DELETE FROM perfis WHERE id = ?').run(id);
    },
  };
}
