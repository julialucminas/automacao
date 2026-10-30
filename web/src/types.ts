// Tipos compartilhados. Quando a API existir, estes formatos são o contrato entre front e back.

/** Equipamento (frota) alugado. valor em centavos. */
/** Equipamento (frota) alugado. valor em centavos. Os campos de locação vêm das movimentações. */
export type Frota = { numero: string; valor: number; descricao: string; inicio?: string | null; fim?: string | null; contrato?: string; gas?: number; frete?: '' | 'lucminas' | 'cliente' };

export type Cliente = {
  id: string;
  /** 'dia' = todo mês no diaEmissao; 'periodo' = a cada periodoDias a partir de inicioLocacao */
  regra: 'dia' | 'periodo';
  /** Dia do mês em que a fatura é emitida (1 a 31). */
  diaEmissao: number | null;
  inicioLocacao: string | null; // AAAA-MM-DD
  periodoDias: number | null;
  frotas: Frota[];
  contato?: string;
  telefone?: string;
  prazoPagamento?: string;
  /** Nome como aparece no arquivo da fatura (MAIÚSCULO). */
  nome: string;
  /** Outros nomes que podem aparecer nos arquivos. */
  apelidos: string[];
  cnpj: string;
  para: string[];
  cc: string[];
  observacoes: string;
  ativo: boolean;
  /** quando entrou no sistema; o calendário só considera faturas a partir daí */
  criadoEm?: string; // ISO
  atualizadoEm: string; // ISO
};

/** diaEmissao/frotas ausentes = manter como está. */
export type ClienteInput = Omit<Cliente, 'id' | 'atualizadoEm' | 'ativo' | 'diaEmissao' | 'frotas' | 'regra' | 'inicioLocacao' | 'periodoDias'> & {
  id?: string;
  diaEmissao?: number | null;
  frotas?: Frota[];
  regra?: 'dia' | 'periodo';
  inicioLocacao?: string | null;
  periodoDias?: number | null;
  contato?: string;
  telefone?: string;
  prazoPagamento?: string;
};

/** Faturamento marcado no calendário (cliente + data prevista). */
export type Faturamento = { clienteId: string; data: string; marcadoEm: string; marcadoPor: string; origem: 'manual' | 'envio' };

/** Um arquivo lido da pasta ou do zip. */
export type ArquivoLido = {
  /** Nome do arquivo, sem pastas. */
  nome: string;
  /** Caminho dentro da pasta/zip, só para exibição. */
  caminho: string;
  blob: Blob;
};

export type StatusItem =
  | 'pronto'
  | 'sem_boleto'
  | 'sem_cadastro'
  | 'sem_email'
  | 'boleto_sem_fatura'
  | 'numero_duplicado'
  | 'enviado';

export type ItemLote = {
  numero: string;
  /** Nome da empresa como veio no arquivo da fatura. */
  empresaNoArquivo: string;
  fatura: ArquivoLido | null;
  boleto: ArquivoLido | null;
  clienteId: string | null;
  /** Como o cliente foi encontrado: pelo nome, por apelido, ou vinculado à mão. */
  vinculo: 'nome' | 'apelido' | 'manual' | null;
  duplicado: boolean;
  marcado: boolean;
  enviado: boolean;
  observacao: string;
};

export type Lote = {
  id: string;
  /** Mês de referência, formato AAAA-MM. */
  referencia: string;
  origem: string;
  criadoEm: string;
  itens: ItemLote[];
  /** Arquivos que não seguem nenhum padrão de nome conhecido. */
  naoReconhecidos: ArquivoLido[];
};

/**
 * enviado:   o UOL aceitou a mensagem e a cópia foi salva em Enviados (é o máximo que o SMTP garante)
 * lido:      chegou confirmação de leitura do cliente
 * devolvido: chegou aviso de devolução (endereço inexistente, caixa cheia…)
 * falhou:    o UOL recusou o envio; nada saiu
 */
export type StatusEnvio = 'enviado' | 'lido' | 'devolvido' | 'falhou';

export type Envio = {
  id: string;
  enviadoEm: string; // ISO
  referencia: string;
  numero: string;
  clienteId: string | null;
  /** Foto do cliente e dos e-mails no momento do envio: não muda se o cadastro mudar depois. */
  clienteNome: string;
  para: string[];
  cc: string[];
  assunto: string;
  anexos: string[];
  messageId: string;
  copiaEmEnviados: boolean;
  pediuLeitura: boolean;
  status: StatusEnvio;
  detalhe: string;
  observacao: string;
  /** confirmação de leitura que chegou na caixa de entrada */
  lidoEm?: string | null;
  lidoPor?: string;
  /** devolução ("não entregue") que chegou na caixa de entrada */
  devolvidoEm?: string | null;
  devolucao?: string;
};

/** chamar: como a pessoa é chamada na saudação do topo (ex.: "Angeli"). */
export type Perfil = 'financeiro' | 'operacoes';
export type Usuario = { id?: number; nome: string; email: string; chamar?: string; perfil?: Perfil };

export type Pessoa = { id: number; nome: string; chamar: string; email: string };

export type Mensagem = { id: number; usuarioId: number; autor: string; texto: string; criadaEm: string };

/** Pedido de um usuário para outro (ex.: "Nova fatura"), com data e conversa. */
export type Solicitacao = {
  id: string;
  criadaEm: string;
  criadaPor: number;
  criadaPorNome: string;
  paraUsuario: number;
  paraNome: string;
  data: string;
  clienteId: string | null;
  clienteNome: string | null;
  titulo: string;
  status: 'aberta' | 'concluida';
  concluidaEm: string | null;
  concluidaPorNome: string | null;
  totalMensagens: number;
  naoLidas: number;
  ultimaMensagemEm: string;
  mensagens?: Mensagem[];
};

export type NovaSolicitacao = { paraUsuario: number; data: string; clienteId: string | null; /** quando não é um cliente cadastrado */ clienteNome?: string; titulo: string; texto: string };

export type TipoMov = 'locacao' | 'devolucao' | 'troca';
export type DadosMov = {
  data: string;
  valor: number | null;
  frete: '' | 'lucminas' | 'cliente';
  gas: number;
  contrato: string;
  /** término previsto da locação (AAAA-MM-DD) */
  fim?: string | null;
  prazoPagamento: string;
  emails: string[];
  contatoNome: string;
  contatoTelefone: string;
  descricao: string;
  observacoes: string;
};
export type NovaMovimentacao = { tipo: TipoMov; frota: string; frotaNova?: string; clienteId?: string | null; clienteNome?: string } & DadosMov;
export type Movimentacao = {
  id: string;
  tipo: TipoMov;
  frota: string;
  frotaNova: string | null;
  clienteId: string | null;
  clienteNome: string;
  dados: DadosMov;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  criadaEm: string;
  criadaPorNome: string;
  decididaEm: string | null;
  decididaPorNome: string | null;
  motivo: string;
};
export type Proposta = {
  id: string;
  clienteId: string | null;
  dados: ClienteInput;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  criadaEm: string;
  criadaPor: number;
  criadaPorNome: string;
  decididaEm: string | null;
  decididaPorNome: string | null;
  motivo: string;
  atual: Cliente | null;
  /** como o cadastro fica se aprovar agora: só o que a pessoa mudou é aplicado sobre o cadastro atual */
  resultado: ClienteInput;
};
export type ItemLog = { id: number; quando: string; usuario: string; area: string; acao: string; clienteId: string; clienteNome: string; antes: unknown; depois: unknown };
export type ConfigEmail = Record<'email.remetente' | 'email.assunto' | 'email.corpo', string>;

export type Conferencia = {
  referencia: string;
  clienteId: string;
  frota: string;
  status: 'ok' | 'alterado';
  valor: number;
  descricao: string;
  observacao: string;
  quando: string;
  usuario: string;
};

/** Frota parada na oficina (pode estar ou não com um cliente). */
export type FrotaOficina = { frota: string; desde: string; observacao: string; usuario: string };
