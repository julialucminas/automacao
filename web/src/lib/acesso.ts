/*
 * Abas do sistema, agrupadas no menu lateral, e as permissões de cada perfil.
 * O servidor tem a mesma lista (api/src/permissoes.ts) e confere tudo de novo em cada ação.
 */
import type { Nivel, PerfilAcesso, Permissoes, Usuario } from '../types';

export type Grupo = 'inicio' | 'operacao' | 'frota' | 'financeiro' | 'clientes' | 'administracao';

export const GRUPOS: { id: Grupo; rotulo: string }[] = [
  { id: 'inicio', rotulo: 'Início' },
  { id: 'operacao', rotulo: 'Operação' },
  { id: 'frota', rotulo: 'Frota' },
  { id: 'financeiro', rotulo: 'Financeiro' },
  { id: 'clientes', rotulo: 'Clientes' },
  { id: 'administracao', rotulo: 'Administração' },
];

export type Aba =
  | 'inicio'
  | 'appDono'
  | 'solicitacoes'
  | 'manutencao'
  | 'ordens'
  | 'externos'
  | 'movimentacoes'
  | 'conferencia'
  | 'calendario'
  | 'frotas'
  | 'contratos'
  | 'envio'
  | 'historico'
  | 'configuracoes'
  | 'clientes'
  | 'aprovacoes'
  | 'registro'
  | 'usuarios';

export type DefAba = { id: Aba; rotulo: string; grupo: Grupo; rota: string; ve: string; edita: string };

/** Ordem = ordem no menu. "ve"/"edita" explicam o nível na tela de permissões. */
export const ABAS: DefAba[] = [
  { id: 'inicio', rotulo: 'Painel do dia', grupo: 'inicio', rota: '/inicio', ve: 'vê o resumo', edita: 'vê o resumo' },
  { id: 'appDono', rotulo: 'App do dono', grupo: 'inicio', rota: '/app', ve: 'resumo e busca no celular', edita: 'resumo e busca no celular' },
  { id: 'manutencao', rotulo: 'Painel de manutenção', grupo: 'operacao', rota: '/manutencao', ve: 'vê o painel e as pendências', edita: 'registra visita e pendências' },
  { id: 'ordens', rotulo: 'Ordens de serviço', grupo: 'operacao', rota: '/ordens', ve: 'vê as OS e os relatórios', edita: 'abre e executa OS (técnico: só as dele)' },
  { id: 'externos', rotulo: 'Serviços externos', grupo: 'operacao', rota: '/externos', ve: 'acompanha as etapas', edita: 'cadastra e muda a etapa' },
  { id: 'movimentacoes', rotulo: 'Movimentações', grupo: 'operacao', rota: '/movimentacoes', ve: 'vê o que foi registrado', edita: 'registra locação, troca e devolução' },
  { id: 'conferencia', rotulo: 'Conferência de frotas', grupo: 'operacao', rota: '/conferencia', ve: 'vê a conferência do mês', edita: 'marca ✓ e envia correções' },
  { id: 'calendario', rotulo: 'Calendário', grupo: 'operacao', rota: '/calendario', ve: 'vê o calendário', edita: 'vê o calendário' },
  { id: 'frotas', rotulo: 'Relação das locações', grupo: 'frota', rota: '/frotas', ve: 'vê a relação e o relatório', edita: 'também marca frota na oficina' },
  { id: 'contratos', rotulo: 'Contratos', grupo: 'frota', rota: '/contratos', ve: 'vê contratos, vencimentos e reajustes', edita: 'cadastra e renova contratos' },
  { id: 'envio', rotulo: 'Envio do mês', grupo: 'financeiro', rota: '/envio', ve: 'vê as faturas no Calendário (sem a tela de envio)', edita: 'envia faturas e marca faturado' },
  { id: 'historico', rotulo: 'Histórico de envios', grupo: 'financeiro', rota: '/historico', ve: 'vê o que foi enviado', edita: 'reenvia e confere a caixa de entrada' },
  { id: 'solicitacoes', rotulo: 'Histórico de avisos', grupo: 'inicio', rota: '/solicitacoes', ve: 'vê os avisos', edita: 'manda, responde e conclui avisos (🔔 no canto da tela)' },
  { id: 'configuracoes', rotulo: 'Configurações', grupo: 'financeiro', rota: '/configuracoes', ve: 'vê o texto do e-mail', edita: 'muda o texto do e-mail' },
  { id: 'clientes', rotulo: 'Cadastro de clientes', grupo: 'clientes', rota: '/clientes', ve: 'só consulta o cadastro', edita: 'altera o cadastro direto' },
  { id: 'aprovacoes', rotulo: 'Aprovações', grupo: 'administracao', rota: '/aprovacoes', ve: 'vê o que está pendente', edita: 'aprova e recusa' },
  { id: 'registro', rotulo: 'Registro de alterações', grupo: 'administracao', rota: '/registro', ve: 'vê o registro', edita: 'vê o registro' },
  { id: 'usuarios', rotulo: 'Usuários e permissões', grupo: 'administracao', rota: '/usuarios', ve: 'vê quem tem acesso', edita: 'cria usuários e muda permissões' },
];

/** Abas em que "edita" não muda nada além de "vê": a tela mostra só Não vê / Vê. */
export const SO_VER: Aba[] = ['inicio', 'appDono', 'calendario', 'registro'];

export const NIVEIS: { n: Nivel; rotulo: string }[] = [
  { n: 0, rotulo: 'Não vê' },
  { n: 1, rotulo: 'Vê' },
  { n: 2, rotulo: 'Edita' },
];

export const nivel = (u: Pick<Usuario, 'permissoes'> | null | undefined, aba: Aba): Nivel => (u?.permissoes?.[aba] ?? 0) as Nivel;

const tudo = (n: Nivel): Permissoes => Object.fromEntries(ABAS.map((a) => [a.id, n]));
const com = (base: Nivel, extra: Partial<Record<Aba, Nivel>>): Permissoes => ({ ...tudo(base), ...extra }) as Permissoes;

/** Os mesmos perfis padrão do servidor (usados na demonstração, sem servidor). */
export const PERFIS_PADRAO: PerfilAcesso[] = [
  { id: 'admin', nome: 'Administrador', descricao: 'Tudo, inclusive usuários e permissões.', permissoes: tudo(2), veValores: true, padrao: true },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    descricao: 'Acesso a tudo, menos usuários e senhas. Abre na Central do financeiro.',
    permissoes: com(2, { usuarios: 0, registro: 1, appDono: 1, inicio: 1 }),
    veValores: true,
    padrao: true,
  },
  {
    id: 'operacoes',
    nome: 'Operações',
    descricao: 'Movimentações, conferência e frotas. Alterações de cadastro vão para aprovação.',
    permissoes: com(0, { inicio: 2, solicitacoes: 2, manutencao: 2, ordens: 2, externos: 2, movimentacoes: 2, conferencia: 2, calendario: 1, frotas: 2 }),
    veValores: false,
    padrao: true,
  },
  {
    id: 'tecnico',
    nome: 'Técnico',
    descricao: 'Técnico de campo: vê as frotas e os clientes, sem valores.',
    permissoes: com(0, { inicio: 2, solicitacoes: 2, manutencao: 1, ordens: 2, frotas: 1, clientes: 1 }),
    veValores: false,
    padrao: true,
  },
  {
    id: 'diretoria',
    nome: 'Diretoria',
    descricao: 'Vê tudo, inclusive valores, e não altera nada.',
    permissoes: com(1, { usuarios: 0, solicitacoes: 2 }),
    veValores: true,
    padrao: true,
  },
];
