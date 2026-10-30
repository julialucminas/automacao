// Tipos compartilhados. Quando a API existir, estes formatos são o contrato entre front e back.

/** Equipamento (frota) alugado. valor em centavos. */
export type Frota = { numero: string; valor: number; descricao: string };

export type Cliente = {
  id: string;
  /** 'dia' = todo mês no diaEmissao; 'periodo' = a cada periodoDias a partir de inicioLocacao */
  regra: 'dia' | 'periodo';
  /** Dia do mês em que a fatura é emitida (1 a 31). */
  diaEmissao: number | null;
  inicioLocacao: string | null; // AAAA-MM-DD
  periodoDias: number | null;
  frotas: Frota[];
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
};

/** chamar: como a pessoa é chamada na saudação do topo (ex.: "Angeli"). */
export type Usuario = { nome: string; email: string; chamar?: string };
