// Tipos compartilhados. Quando a API existir, estes formatos são o contrato entre front e back.

/** Equipamento (frota) alugado. valor em centavos. */
/** Equipamento (frota) alugado. valor em centavos. Os campos de locação vêm das movimentações. */
export type Frota = {
  numero: string;
  valor: number;
  descricao: string;
  inicio?: string | null;
  fim?: string | null;
  contrato?: string;
  gas?: number;
  frete?: '' | 'lucminas' | 'cliente';
  /** frete por conta do cliente: quanto (centavos) */
  freteValor?: number | null;
  /** locação por contrato ou esporádica */
  modalidade?: '' | 'contrato' | 'esporadico';
};

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
  /** paga por outro meio (PIX, depósito…): a fatura vai sem boleto */
  semBoleto?: boolean;
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
  /** paga por outro meio (PIX, depósito…): a fatura vai sem boleto */
  semBoleto?: boolean;
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

export type StatusItem = 'pronto' | 'sem_boleto' | 'sem_cadastro' | 'sem_email' | 'boleto_sem_fatura' | 'numero_duplicado' | 'enviado';

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
  /** marcado na conferência: esta fatura vai sem boleto (pagamento por outro meio) */
  semBoleto?: boolean;
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
/** id do perfil (admin, financeiro, operacoes, tecnico, diretoria ou criado pelo administrador) */
export type Perfil = string;
/** 0 = não vê · 1 = vê · 2 = edita */
export type Nivel = 0 | 1 | 2;
export type Permissoes = Record<string, Nivel>;
export type Usuario = { id?: number; nome: string; email: string; chamar?: string; perfil?: Perfil; perfilNome?: string; permissoes?: Permissoes; veValores?: boolean };
/** Perfil com as permissões por aba (tela Usuários e permissões). */
export type PerfilAcesso = { id: string; nome: string; descricao: string; permissoes: Permissoes; veValores: boolean; padrao: boolean };
/** Usuário na tela de administração. */
export type UsuarioAdmin = { id: number; email: string; nome: string; chamar: string; perfil: Perfil; ativo: boolean };

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

export type NovaSolicitacao = {
  paraUsuario: number;
  data: string;
  clienteId: string | null;
  /** quando não é um cliente cadastrado */ clienteNome?: string;
  titulo: string;
  texto: string;
};

export type TipoMov = 'locacao' | 'devolucao' | 'troca' | 'reajuste' | 'venda' | 'compra';
export type ItemReajuste = { frota: string; antes: number; novo: number };
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
  /** reajuste: frotas com valor antes → novo */
  itens?: ItemReajuste[];
  percentual?: number | null;
  /** reajuste: contrato renovado até */
  renovaAte?: string | null;
  /** devolução/troca/venda: valor de locação que a frota tinha antes */
  valorAnterior?: number | null;
  /** locação: por contrato ou esporádica */
  modalidade?: '' | 'contrato' | 'esporadico';
  /** frete por conta do cliente: quanto (centavos) */
  freteValor?: number | null;
  /** observação marcada como urgente */
  obsUrgente?: boolean;
  /** venda e compra: nota fiscal */
  nf?: string;
  /** observações acrescentadas depois de lançada (cada uma pode ser urgente) */
  notas?: NotaMov[];
  /** venda e compra: arquivo da NF-e anexado (PDF/DANFE ou XML) */
  nfArquivo?: NfArquivo | null;
  /** compra: identificação da máquina que entra */
  maquina?: { marca: string; modelo: string; serie: string; ano: number | null; capacidade: number | null; combustivel: string };
};
export type NotaMov = { id: string; texto: string; urgente: boolean; em: string; porNome: string };
export type NfArquivo = { ext: 'pdf' | 'xml'; nome: string; tamanho: number; em: string; porNome: string };
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
  /** este usuário já viu (as "novas movimentações") */
  vista: boolean;
};
/** "ok" dado numa pendência: some das notificações, o registro fica */
export type AvisoOk = { chave: string; feitoEm: string; feitoPor: string; obs: string };
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
export type ConfigEmail = Record<'email.remetente' | 'email.assunto' | 'email.corpo' | 'email.corpoSemBoleto', string> &
  /** regras da manutenção (JSON), editadas em Configurações */
  Partial<Record<'manutencao.tipos' | 'manutencao.perifericos' | 'os.relatorioCliente' | 'conferencia.abreDia' | 'conferencia.fechaDia', string>>;

export type TipoVisita = { sigla: string; nome: string; dias?: number; horas?: number };
export type PerifericoId = 'motorPartida' | 'filtroAr' | 'correia' | 'oleoTransmissao' | 'oleoHidraulico';
export type RegraPeriferico = { id: PerifericoId; nome: string; dias?: number; horas?: number };
export type Pendencia = {
  id: number;
  frota: string;
  cliente: string;
  abertaEm: string;
  tecnico: string;
  descricao: string;
  status: 'aberta' | 'resolvida';
  resolvidaEm: string | null;
  resolvidaPor: string;
  resolucao: string;
  origem: string;
};
export type NovaPendencia = { frota: string; cliente: string; abertaEm: string; tecnico: string; descricao: string };
export type Visita = {
  data: string;
  horimetro: number | null;
  tipo: string;
  tecnico: string;
  cliente: string;
  proximaPreventiva: number | null;
  perifericos: PerifericoId[];
  observacao: string;
};

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
/** Máquina na oficina. Ela sai do cliente ao entrar; clienteAnterior é com quem estava (para oferecer a volta). */
export type FrotaOficina = { frota: string; desde: string; observacao: string; usuario: string; clienteAnteriorId?: string | null; clienteAnterior?: string };

/** Ficha de um equipamento (frota). Valores em centavos; datas AAAA-MM-DD. Campos de compra e contrato só chegam para quem vê valores. */
export type DadosEquipamento = {
  descricao?: string | null;
  marca?: string | null;
  modelo?: string | null;
  serie?: string | null;
  ano?: number | null;
  combustivel?: string | null;
  capacidade?: number | null;
  torre?: string | null;
  acessorios?: string | null;
  situacao?: string | null;
  situacaoMotivo?: string | null;
  horimetro?: number | null;
  horimetroEm?: string | null;
  mediaDia?: number | null;
  regiao?: string | null;
  tecnico?: string | null;
  tipoVisita?: string | null;
  ultimaVisita?: string | null;
  proximaPreventiva?: number | null;
  intervaloVisitaDias?: number | null;
  compraValor?: number | null;
  vendaData?: string | null;
  vendaValor?: number | null;
  vendaComprador?: string | null;
  vendaNf?: string | null;
  compraNf?: string | null;
  compraData?: string | null;
  fornecedor?: string | null;
  contratoNumero?: string | null;
  /** início do contrato (base do reajuste anual) */
  contratoInicio?: string | null;
  contratoVencimento?: string | null;
  contratoValor?: number | null;
  contratoReajuste?: number | null;
  contratoObs?: string | null;
  /** etiqueta Helbert: o dono divide a máquina com o irmão (só registro) */
  helbert?: string | null;
  observacoes?: string | null;
  perifericosNaoAplica?: string | null;
} & Partial<Record<`${PerifericoId}Data` | `${PerifericoId}ProximaData`, string | null>> &
  Partial<Record<`${PerifericoId}Horimetro` | `${PerifericoId}ProximaHoras`, number | null>>;
export type Equipamento = DadosEquipamento & { frota: string; atualizadoEm: string; atualizadoPor: string };

/** Peça ou serviço lançado numa máquina (vindo do Auvo e, depois, das ordens de serviço). Valores em centavos. */
export type PecaHistorico = {
  id: number;
  data: string;
  frota: string | null;
  ativo: string;
  cliente: string;
  tecnico: string;
  pendencia: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  horimetro: number | null;
  origem: string;
};
export type NovaPeca = Omit<PecaHistorico, 'id'>;

// ---------- ordens de serviço ----------
export type TipoOS = 'preventiva' | 'corretiva' | 'entrega' | 'devolucao' | 'vistoria' | 'externo';
export type StatusOS = 'aberta' | 'agendada' | 'execucao' | 'aguardando_peca' | 'concluida' | 'encerrada' | 'cancelada';
export type ItemChecklist = { item: string; resposta: 'ok' | 'problema' | 'na' | ''; obs: string };
export type LocalOS = { em: string; lat: number | null; lng: number | null; precisao: number | null };
export type PecaOS = { codigo: string; descricao: string; quantidade: number };
export type TipoCampo = 'secao' | 'checklist' | 'simnao' | 'texto' | 'textoLongo' | 'numero' | 'opcoes' | 'multipla' | 'data' | 'foto';
export type CampoModelo = { id: string; rotulo: string; tipo: TipoCampo; obrigatorio: boolean; opcoes?: string[]; unidade?: string; ajuda?: string };
export type ModeloOS = {
  id: string;
  nome: string;
  descricao: string;
  tipoBase: TipoOS;
  campos: CampoModelo[];
  exigeHorimetro: boolean;
  exigeAssinatura: boolean;
  fotosMinimas: number;
  ativo: boolean;
  atualizadoEm: string;
  atualizadoPor: string;
};
export type FormularioOS = Pick<ModeloOS, 'nome' | 'campos' | 'exigeHorimetro' | 'exigeAssinatura' | 'fotosMinimas'> & { modeloId: string };
export type RespostaCampo = string | number | boolean | string[] | { resposta: 'ok' | 'problema' | 'na'; obs: string } | null;
export type ExecucaoOS = {
  formulario?: FormularioOS;
  respostas?: Record<string, RespostaCampo>;
  checkin?: LocalOS;
  checkout?: LocalOS;
  horimetro?: number | null;
  checklist?: ItemChecklist[];
  servico?: string;
  pecas?: PecaOS[];
  perifericos?: PerifericoId[];
  fotos?: string[];
  assinatura?: string;
  assinadoPor?: string;
  semAssinatura?: string;
};
export type Ordem = {
  id: string;
  numero: number;
  frota: string;
  clienteId: string | null;
  clienteNome: string;
  tipo: TipoOS;
  tipoVisita: string;
  status: StatusOS;
  tecnicoId: number | null;
  tecnicoNome: string;
  agendadaPara: string | null;
  descricao: string;
  pendenciaId: number | null;
  execucao: ExecucaoOS;
  criadaPor: string;
  criadaEm: string;
  atualizadaEm: string;
  concluidaEm: string | null;
  encerradaEm: string | null;
  encerradaPor: string;
  relatorioPara: string;
  relatorioEm: string | null;
  cancelamento: string;
};
export type NovaOrdem = {
  frota: string;
  clienteId?: string | null;
  clienteNome?: string;
  tipo?: TipoOS;
  modeloId?: string;
  tipoVisita?: string;
  tecnicoId?: number | null;
  agendadaPara?: string | null;
  descricao?: string;
  pendenciaId?: number | null;
};
export type TecnicoOS = { id: number; nome: string; chamar: string; escritorio: boolean };
export type ResultadoRelatorio = { ordem: Ordem; relatorio: { enviado: boolean; detalhe: string } | null };

export type EtapaExterno = 'pedido' | 'orcamento' | 'enviado' | 'aprovado' | 'execucao' | 'concluido' | 'cobrado' | 'recusado';
export type PassoExterno = { etapa: EtapaExterno; em: string; por: string; obs: string };
export type ServicoExterno = {
  id: number;
  clienteId: string | null;
  clienteNome: string;
  contato: string;
  equipamento: string;
  descricao: string;
  etapa: EtapaExterno;
  /** centavos; null para quem não vê valores */
  valor: number | null;
  responsavelId: number | null;
  responsavelNome: string;
  osNumero: number | null;
  previsao: string | null;
  obs: string;
  historico: PassoExterno[];
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string;
};
export type DadosExterno = Partial<Pick<ServicoExterno, 'clienteId' | 'clienteNome' | 'contato' | 'equipamento' | 'descricao' | 'valor' | 'responsavelId' | 'osNumero' | 'previsao' | 'obs'>>;

/** Foto do negócio no fim de cada mês (o mês corrente é regravado até virar). Valores em centavos. */
export type FotoMensal = { mes: string; receita: number; receitaContrato: number; locadas: number; frota: number; clientes: number; atualizadaEm: string };
