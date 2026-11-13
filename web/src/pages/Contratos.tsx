import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { ArquivoContrato, Cliente, EnvioContrato, Equipamento, IntegracaoAutentique, RegistroContrato, TipoDocContrato } from '../types';
import { ROTULO_DOC } from '../components/PastaCliente';
import { HistoricoPrecos } from '../components/HistoricoPrecos';
import { doContrato, ItemPendencia, PainelPendencias, PainelReajustes, PainelRenovacoes, TratativasContrato, type Acompanhamento } from '../components/AcompanhamentoContratos';
import { AcompanharAssinatura, EnviarParaAssinar } from '../components/AssinaturaContrato';
import { lerBase64 } from '../components/NfeAnexo';
import { dataBr, hojeIso } from '../lib/calendario';
import { formatarReais } from '../lib/dinheiro';
import { chaveEmpresa } from '../lib/normalizar';
import { DIAS_AVISO, montarContratos, sugestaoRenovacao, type Contrato, type StatusContrato } from '../lib/contratos';
import { Chip, Modal, type Tom } from '../components/ui';
import { IcBusca } from '../components/Icones';

/** colunas da lista no computador */
const COLS = 'lg:grid-cols-[minmax(180px,1.4fr)_minmax(120px,1fr)_110px_120px_130px_110px]';

type Filtro = 'todos' | StatusContrato | 'reajuste' | 'sem' | 'assinar' | 'semArquivo';
const STATUS: Record<StatusContrato, { rotulo: string; tom: Tom }> = {
  vencido: { rotulo: 'Vencido', tom: 'bad' },
  vencendo: { rotulo: `Vence em até ${DIAS_AVISO} dias`, tom: 'warn' },
  vigente: { rotulo: 'Vigente', tom: 'ok' },
};

/** Rascunho do editor: contrato existente (editar/renovar) ou novo para um cliente. */
type Edicao = { chave?: string; cliente: Cliente; frotas: string[]; antes: string[]; numero: string; inicio: string; vencimento: string; obs: string; renovacao: boolean; assinado: boolean; assinadoEm: string };

export function Contratos() {
  const { clientes, movimentacoes, pode, veValores, recarregarAlertasContratos } = useEstado();
  const [params, setParams] = useSearchParams();
  const aba = (['contratos', 'renovacoes', 'reajustes', 'pendencias'].includes(params.get('aba') ?? '') ? params.get('aba') : 'contratos') as 'contratos' | 'renovacoes' | 'reajustes' | 'pendencias';
  const [acomp, setAcomp] = useState<Acompanhamento>({ registros: [], status: [] });
  const [tratativas, setTratativas] = useState<{ c: Contrato; assunto: RegistroContrato['assunto'] } | null>(null);
  const edita = pode('contratos', 2);
  // valor da locação: quem vê valores ou confere frotas (o servidor manda 0 para os outros)
  const veValor = veValores || pode('conferencia');
  const [fichas, setFichas] = useState<Equipamento[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoContrato[]>([]);
  const [envios, setEnvios] = useState<EnvioContrato[]>([]);
  const [autentique, setAutentique] = useState<IntegracaoAutentique | null>(null);
  const [assinar, setAssinar] = useState<Contrato | null>(null);
  const recarregar = () =>
    Promise.all([
      api.listarEquipamentos().then(setFichas, () => undefined),
      api.listarArquivosContrato().then(setArquivos, () => undefined),
      api.listarEnviosContrato().then(setEnvios, () => undefined),
      api.lerAutentique().then(setAutentique, () => undefined),
      api.acompanhamentoContratos().then(setAcomp, () => undefined),
    ]);
  const mudouAcomp = () => {
    void api.acompanhamentoContratos().then(setAcomp, () => undefined);
    void recarregarAlertasContratos();
  };
  // envio na Autentique de um contrato: o em aberto (ou o último recusado) com o mesmo cliente e alguma das máquinas
  const envioDe = (c: Contrato) => {
    const meus = envios.filter((e) => e.clienteId === c.cliente.id && e.frotas.some((f) => c.maquinas.some((m) => m.numero === f)));
    return meus.find((e) => e.status === 'aguardando') ?? (c.assinado ? undefined : meus.find((e) => e.status === 'recusado'));
  };
  useEffect(() => {
    void recarregar();
  }, []);
  const hoje = hojeIso();
  const { contratos, semContrato, esporadicas } = useMemo(() => montarContratos(clientes, fichas, movimentacoes, hoje), [clientes, fichas, movimentacoes, hoje]);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  // linhas abertas (o resto fica numa linha só)
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbertos((a) => {
    const n = new Set(a);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const q = chaveEmpresa(busca);
  const achou = (c: Cliente, maquinas: { numero: string }[], numero = '') =>
    !q || chaveEmpresa(c.nome).includes(q) || chaveEmpresa(numero).includes(q) || maquinas.some((m) => chaveEmpresa(m.numero).includes(q));
  // marcado como assinado, mas sem nenhum arquivo deste período (contrato, assinado ou renovação com o vencimento atual).
  // Quem ainda falta assinar já aparece como "Falta assinar": não repete o aviso.
  const semArquivo = (c: Contrato) =>
    c.assinado &&
    !c.arquivoId &&
    !arquivos.some(
      (a) => a.clienteId === c.cliente.id && ['contrato', 'assinado', 'renovacao'].includes(a.tipo) && a.vencimento === c.vencimento && a.frotas.some((f) => c.maquinas.some((m) => m.numero === f)),
    );
  const conta = (f: Filtro) =>
    f === 'semArquivo' ? contratos.filter(semArquivo).length : f === 'todos' ? contratos.length : f === 'assinar' ? contratos.filter((c) => !c.assinado).length : f === 'reajuste' ? contratos.filter((c) => c.reajusteAtrasado).length : f === 'sem' ? semContrato.reduce((s, x) => s + x.maquinas.length, 0) : contratos.filter((c) => c.status === f).length;
  const lista = contratos.filter(
    (c) => (filtro === 'todos' || filtro === c.status || (filtro === 'reajuste' && c.reajusteAtrasado) || (filtro === 'assinar' && !c.assinado) || (filtro === 'semArquivo' && semArquivo(c))) && achou(c.cliente, c.maquinas, c.numero),
  );
  const soma = (l: Contrato[]) => l.reduce((s, c) => s + c.valor, 0);
  const porStatus = (s: StatusContrato) => contratos.filter((c) => c.status === s);

  const editar = (c: Contrato, renovacao: boolean) =>
    setEdicao({
      chave: c.chave,
      cliente: c.cliente,
      frotas: c.maquinas.map((m) => m.numero),
      antes: c.maquinas.map((m) => m.numero),
      numero: c.numero,
      inicio: renovacao ? c.vencimento : (c.inicio ?? ''),
      vencimento: renovacao ? sugestaoRenovacao(c.vencimento, hoje) : c.vencimento,
      obs: c.obs,
      renovacao,
      assinado: renovacao ? false : c.assinado,
      assinadoEm: renovacao ? '' : (c.assinadoEm ?? ''),
    });
  const novo = (cliente: Cliente, frotas: string[]) =>
    setEdicao({ cliente, frotas, antes: [], numero: '', inicio: '', vencimento: '', obs: '', renovacao: false, assinado: false, assinadoEm: '' });

  const cartao = (rot: string, n: number, valor: number | null, f: Filtro, cor = 'text-ink') => (
    <button
      type="button"
      onClick={() => setFiltro(filtro === f ? 'todos' : f)}
      aria-pressed={filtro === f}
      className={`flex flex-col rounded-xl border bg-white px-3.5 py-2 text-left hover:border-ink ${filtro === f ? 'border-ink ring-1 ring-ink' : 'border-line'}`}
    >
      <span className="text-[11.5px] font-semibold leading-tight text-ink-3 sm:text-[12px]">{rot}</span>
      <span className={`text-[20px] font-bold leading-tight ${cor}`}>{n}</span>
      {valor !== null && veValor && <span className="hidden text-[12px] text-ink-3 sm:block">{formatarReais(valor)}/mês</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Locação</div>
          <h1 className="mt-1 text-[26px] font-bold">Contratos</h1>
          <p className="hidden text-[13px] text-ink-3 sm:block">Um contrato por cliente, com as máquinas dele: vencimento, renovação e reajuste. Clique num contrato para ver os detalhes.</p>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
          <IcBusca />
          <span className="sr-only">Buscar cliente, contrato ou frota</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, contrato ou frota" className="w-[220px] bg-transparent text-ink outline-none" />
        </label>
      </div>

      <nav aria-label="Áreas dos contratos" className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['contratos', 'Contratos', contratos.length, false],
            ['renovacoes', 'Renovações', contratos.filter((c) => c.diasParaVencer <= 120).length, false],
            ['reajustes', 'Reajustes', contratos.filter((c) => c.reajusteAtrasado).length, false],
            ['pendencias', 'Pendências', acomp.registros.filter((r) => r.tipo === 'pendencia' && !r.resolvidaEm).length, true],
          ] as const
        ).map(([id, rot, n, alerta]) => (
          <button
            key={id}
            type="button"
            aria-current={aba === id ? 'page' : undefined}
            onClick={() => setParams(id === 'contratos' ? {} : { aba: id })}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-[14px] font-semibold ${aba === id ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {rot}
            {n > 0 && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${alerta ? 'bg-bad text-white' : 'bg-line-soft text-ink-2'}`}>{n}</span>}
          </button>
        ))}
      </nav>

      {aba === 'renovacoes' && <PainelRenovacoes contratos={contratos.filter((c) => achou(c.cliente, c.maquinas, c.numero))} a={acomp} abrir={(c) => setTratativas({ c, assunto: 'renovacao' })} mudou={mudouAcomp} />}
      {aba === 'reajustes' && <PainelReajustes contratos={contratos.filter((c) => achou(c.cliente, c.maquinas, c.numero))} a={acomp} abrir={(c) => setTratativas({ c, assunto: 'reajuste' })} mudou={mudouAcomp} veValor={veValor} />}
      {aba === 'pendencias' && <PainelPendencias contratos={contratos} a={acomp} abrir={(c) => setTratativas({ c, assunto: 'geral' })} mudou={mudouAcomp} />}

      {aba === 'contratos' && (
      <>
      <section aria-label="Resumo dos contratos" className="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {cartao('Vencidos', porStatus('vencido').length, soma(porStatus('vencido')), 'vencido', porStatus('vencido').length ? 'text-bad' : 'text-ink-3')}
        {cartao(`Vencem em ${DIAS_AVISO} dias`, porStatus('vencendo').length, soma(porStatus('vencendo')), 'vencendo', porStatus('vencendo').length ? 'text-warn-strong' : 'text-ink-3')}
        {cartao('Vigentes', porStatus('vigente').length, soma(porStatus('vigente')), 'vigente', 'text-ok')}
        {cartao('Reajuste atrasado', conta('reajuste'), soma(contratos.filter((c) => c.reajusteAtrasado)), 'reajuste', conta('reajuste') ? 'text-warn-strong' : 'text-ink-3')}
        {cartao('Assinado sem arquivo', conta('semArquivo'), soma(contratos.filter(semArquivo)), 'semArquivo', conta('semArquivo') ? 'text-warn-strong' : 'text-ink-3')}
        {cartao('Falta assinatura', conta('assinar'), soma(contratos.filter((c) => !c.assinado)), 'assinar', conta('assinar') ? 'text-bad' : 'text-ink-3')}
        {cartao('Máquinas sem contrato', conta('sem'), semContrato.reduce((s, x) => s + x.valor, 0), 'sem', conta('sem') ? 'text-warn-strong' : 'text-ink-3')}
      </section>

      {filtro !== 'sem' && (
        <section aria-label="Contratos" className="flex flex-col gap-2">
          {lista.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              <div className={`hidden gap-3 border-b border-line bg-[#F8F7F3] px-4 py-2 text-[12px] font-semibold text-ink-3 lg:grid ${COLS}`}>
                <span>Cliente · contrato</span>
                <span>Máquinas</span>
                <span className="text-right">{veValor ? 'Valor/mês' : ''}</span>
                <span>Vencimento</span>
                <span>Assinatura</span>
                <span>Próx. reajuste</span>
              </div>
              <ul className="divide-y divide-line-soft">
                {lista.map((c) => {
                  const aberto = abertos.has(c.chave);
                  const env = envioDe(c);
                  return (
                    <li key={c.chave}>
                      <button
                        type="button"
                        aria-expanded={aberto}
                        onClick={() => alternar(c.chave)}
                        className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-[13.5px] hover:bg-[#FAFAF7] ${COLS} ${aberto ? 'bg-[#FAFAF7]' : ''}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className={`text-ink-3 transition-transform ${aberto ? 'rotate-90' : ''}`}>›</span>
                          <span className="min-w-0">
                            <b className="flex items-center gap-1.5 truncate">
                              {c.cliente.nome}
                              {doContrato(acomp, c.chave).pendencias.length > 0 && (
                                <span className="rounded-full bg-bad px-1.5 py-0.5 text-[11px] font-bold text-white" title="Pendências abertas">
                                  ⚠ {doContrato(acomp, c.chave).pendencias.length}
                                </span>
                              )}
                            </b>
                            <span className="block truncate font-mono text-[12px] text-ink-3">{c.numero || 'sem número'}</span>
                          </span>
                        </span>
                        <span className="truncate font-mono text-[12.5px] text-ink-2 max-lg:col-span-2 max-lg:pl-5">FT{c.maquinas.map((m) => m.numero).join(', FT')}</span>
                        <span className="text-right font-semibold max-lg:col-start-2 max-lg:row-start-1">{veValor ? (c.valor ? formatarReais(c.valor) : <span className="font-normal text-ink-3">sem valor</span>) : ''}</span>
                        <span className="max-lg:pl-5">
                          <span className="text-ink-3 lg:hidden">Vence </span>
                          <span className={c.status === 'vencido' ? 'font-semibold text-bad' : c.status === 'vencendo' ? 'font-semibold text-warn-strong' : ''}>{dataBr(c.vencimento)}</span>
                          <span className="block text-[11.5px] text-ink-3">{c.diasParaVencer < 0 ? `venceu há ${-c.diasParaVencer} d` : c.diasParaVencer === 0 ? 'vence hoje' : `faltam ${c.diasParaVencer} d`}</span>
                        </span>
                        <span className="max-lg:pl-5">
                          {env?.status === 'aguardando' ? (
                            <span className="font-semibold text-info">⏳ na Autentique</span>
                          ) : c.assinado ? (
                            <span className="font-semibold text-ok">✓ Assinado</span>
                          ) : (
                            <span className="font-semibold text-bad">○ {c.assinaturaParcial ? 'Incompleta' : 'Falta assinar'}</span>
                          )}
                          {semArquivo(c) && <span className="block text-[11.5px] font-semibold text-warn-strong">📎 arquivo não anexado</span>}
                        </span>
                        <span className={`max-lg:pl-5 ${c.reajusteAtrasado ? 'font-semibold text-warn-strong' : 'text-ink-2'}`}>
                          <span className="text-ink-3 lg:hidden">Reajuste </span>
                          {c.proximoReajuste ? dataBr(c.proximoReajuste) : <span className="text-ink-3">—</span>}
                          {c.reajusteAtrasado && <span className="block text-[11.5px]">atrasado</span>}
                        </span>
                      </button>
                      {aberto && (
                        <div className="border-t border-line-soft bg-[#FAFAF7] px-4 pb-3.5 pt-2.5 lg:pl-9">
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
                            <span>Início: {c.inicio ? dataBr(c.inicio) : <span className="text-ink-3">—</span>}</span>
                            <span>
                              Situação: <Chip tom={STATUS[c.status].tom}>{STATUS[c.status].rotulo}</Chip>
                            </span>
                            {c.assinado && c.assinadoEm && <span>Assinado em {dataBr(c.assinadoEm)}</span>}
                            {c.ultimoReajuste && <span>Último reajuste em {dataBr(c.ultimoReajuste)}</span>}
                          </div>
                          {veValor && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {c.maquinas.map((m) => (
                                <span key={m.numero} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-0.5 text-[12.5px]" title={m.descricao}>
                                  <b className="font-mono">FT{m.numero}</b>
                                  <span className="text-ink-2">{m.valor ? formatarReais(m.valor) : 'sem valor'}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {c.datasDiferentes && <p className="mt-2 text-[12.5px] text-warn-strong">As máquinas deste contrato estão com vencimentos diferentes nas fichas. Use Editar para acertar.</p>}
                          {c.obs && <p className="mt-2 text-[13px] text-ink-2">{c.obs}</p>}
                          {doContrato(acomp, c.chave).pendencias.length > 0 && (
                            <div className="mt-2.5 flex flex-col gap-1.5">
                              {doContrato(acomp, c.chave).pendencias.map((r) => (
                                <ItemPendencia key={r.id} r={r} mudou={mudouAcomp} />
                              ))}
                            </div>
                          )}
                          {semArquivo(c) && (
                            <p className="mt-2.5 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn-strong">
                              📎 Está marcado como assinado, mas o arquivo do contrato não foi anexado. Anexe aqui embaixo ou, em “Editar”, junto com os dados.
                            </p>
                          )}
                          <ArquivosDoContrato c={c} arquivos={arquivos} edita={edita} anexado={() => void recarregar()} />
                          {veValor && (
                            <details className="mt-2.5 rounded-[10px] border border-line bg-white px-3 py-2">
                              <summary className="cursor-pointer text-[13px] font-semibold text-ink-2">Histórico de preços das máquinas</summary>
                              <div className="mt-2 flex flex-col gap-2.5">
                                {c.maquinas.map((m) => (
                                  <HistoricoPrecos key={m.numero} frota={m.numero} compacto />
                                ))}
                              </div>
                            </details>
                          )}
                          {env && <AcompanharAssinatura e={env} edita={edita} mudou={() => void recarregar()} />}
                          {edita && (
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <button type="button" className="btn-primary btn-sm" onClick={() => editar(c, true)}>
                                Renovar
                              </button>
                              {!c.assinado && env?.status !== 'aguardando' && (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  title={autentique?.configurado ? 'Manda o PDF para assinar na Autentique' : 'Ligue a Autentique em Configurações → Integrações'}
                                  disabled={!autentique?.configurado}
                                  onClick={() => setAssinar(c)}
                                >
                                  Enviar para assinatura
                                </button>
                              )}
                              <button type="button" className="btn-secondary btn-sm" onClick={() => editar(c, false)}>
                                Editar
                              </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => setTratativas({ c, assunto: 'geral' })}>
                                Tratativas e pendências
                              </button>
                              {pode('movimentacoes', 2) && (
                                <Link className="btn-secondary btn-sm" to={`/movimentacoes?nova=reajuste&cliente=${c.cliente.id}`}>
                                  Registrar reajuste
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {lista.length === 0 && <div className="card px-4 py-6 text-ink-3">Nenhum contrato{busca ? ` para “${busca}”` : filtro !== 'todos' ? ' com esse filtro' : ' cadastrado ainda'}.</div>}
        </section>
      )}

      {(filtro === 'todos' || filtro === 'sem') && semContrato.some((s) => achou(s.cliente, s.maquinas)) && (
        <section aria-label="Máquinas sem contrato" className="flex flex-col gap-2">
          <h2 className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-3">Locadas sem contrato cadastrado</h2>
          <div className="flex flex-col divide-y divide-line-soft rounded-xl border border-warn-line bg-white">
            {semContrato
              .filter((s) => achou(s.cliente, s.maquinas))
              .map((s) => (
                <div key={s.cliente.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13.5px]">
                  <div className="min-w-0">
                    <b>{s.cliente.nome}</b>
                    <span className="ml-2 text-[13px] text-ink-3">
                      FT{s.maquinas.map((m) => m.numero).join(', FT')}
                      {veValor && ` · ${formatarReais(s.valor)}/mês`}
                    </span>
                  </div>
                  {edita && (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => novo(s.cliente, s.maquinas.map((m) => m.numero))}>
                      Cadastrar contrato
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      {filtro === 'todos' && esporadicas.length > 0 && (
        <p className="px-1 text-[12.5px] text-ink-3">
          Esporádicas (sem contrato, por escolha): {esporadicas.map((e) => `${e.cliente.nome} (FT${e.maquinas.map((m) => m.numero).join(', FT')})`).join(' · ')}
        </p>
      )}

      </>
      )}

      {tratativas && <TratativasContrato c={tratativas.c} a={acomp} inicial={tratativas.assunto} fechar={() => setTratativas(null)} mudou={mudouAcomp} />}
      {assinar && autentique && (
        <EnviarParaAssinar cliente={assinar.cliente} frotas={assinar.maquinas.map((m) => m.numero)} cfg={autentique} fechar={() => setAssinar(null)} enviado={() => void recarregar()} />
      )}
      {edicao && <EditorContrato e={edicao} contratos={contratos} fechar={() => setEdicao(null)} salvo={() => void recarregar()} veValor={veValor} />}
    </div>
  );
}

function EditorContrato({ e, contratos, fechar, salvo, veValor }: { e: Edicao; contratos: Contrato[]; fechar: () => void; salvo: () => void; veValor: boolean }) {
  const { avisar } = useEstado();
  const [d, setD] = useState(e);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arquivoAssinado, setArquivoAssinado] = useState(true);
  const marcar = (n: string, sim: boolean) => setD({ ...d, frotas: sim ? [...d.frotas, n] : d.frotas.filter((x) => x !== n) });
  // outros contratos do mesmo cliente (máquinas contratadas em outra data ficam em contrato separado)
  const outros = contratos.filter((c) => c.cliente.id === d.cliente.id && c.chave !== e.chave);
  const outroDe = (frota: string) => outros.find((c) => c.maquinas.some((m) => m.numero === frota));
  const mudamDeContrato = d.frotas.filter((f) => outroDe(f));
  const mesmoNumero = d.numero.trim() ? outros.find((c) => c.numero.trim().toUpperCase() === d.numero.trim().toUpperCase()) : undefined;

  const salvar = async () => {
    setErro('');
    if (!d.frotas.length) return setErro('Marque pelo menos uma máquina.');
    if (!d.vencimento) return setErro('Informe o vencimento do contrato.');
    if (!d.numero.trim() && outros.length) return setErro('Informe o nº do contrato: esse cliente tem mais de um contrato, e é o número que separa um do outro.');
    setSalvando(true);
    try {
      await api.salvarContrato({
        clienteId: d.cliente.id,
        frotas: d.frotas,
        tirar: d.antes.filter((f) => !d.frotas.includes(f)),
        numero: d.numero.trim(),
        inicio: d.inicio || null,
        vencimento: d.vencimento,
        obs: d.obs.trim(),
        renovacao: d.renovacao,
        // arquivo marcado como assinado já conta como assinado
        ...(d.renovacao ? {} : { assinado: d.assinado || (!!arquivo && arquivoAssinado), assinadoEm: d.assinado ? d.assinadoEm || null : null }),
      });
      // o arquivo sobe depois dos dados, para ficar com o número e o vencimento novos
      let falhou = '';
      if (arquivo) {
        try {
          await api.anexarContrato({
            clienteId: d.cliente.id,
            frotas: d.frotas,
            arquivo: await lerBase64(arquivo),
            nome: arquivo.name,
            tipo: arquivoAssinado ? 'assinado' : d.renovacao ? 'renovacao' : 'contrato',
            descricao: d.renovacao ? `Renovação até ${dataBr(d.vencimento)}` : '',
          });
        } catch (x) {
          falhou = x instanceof Error ? x.message : 'erro';
        }
      }
      if (falhou) avisar(`Contrato salvo, mas o arquivo não subiu (${falhou}). Anexe de novo no contrato.`, 'bad');
      else avisar(d.renovacao ? `Contrato de ${d.cliente.nome} renovado até ${dataBr(d.vencimento)}.` : `Contrato de ${d.cliente.nome} salvo${arquivo ? ' com o arquivo' : ''}.`);
      salvo();
      fechar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={fechar} titulo={d.renovacao ? 'Renovar contrato' : e.antes.length ? 'Editar contrato' : 'Cadastrar contrato'}>
      <p className="text-[14px]">
        <b>{d.cliente.nome}</b>
        {d.renovacao && <span className="text-ink-3"> · confira as datas do novo período</span>}
      </p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="label mb-1">Máquinas deste contrato</legend>
        <p className="mb-1 text-[12.5px] text-ink-3">Marque só as que entraram neste contrato. Máquinas contratadas em outra data ficam no contrato delas, com número e vencimento próprios.</p>
        <div className="flex flex-wrap gap-2">
          {d.cliente.frotas.map((f) => {
            const outro = outroDe(f.numero);
            return (
              <label key={f.numero} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${d.frotas.includes(f.numero) ? 'border-ink bg-brand-tint' : 'border-line'}`}>
                <input type="checkbox" className="h-4 w-4 accent-ink" checked={d.frotas.includes(f.numero)} onChange={(ev) => marcar(f.numero, ev.target.checked)} />
                <b className="font-mono">FT{f.numero}</b>
                {veValor && f.valor > 0 && <span className="text-ink-3">{formatarReais(f.valor)}</span>}
                {outro && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11.5px] text-warn-strong">no contrato {outro.numero || 'sem número'} · vence {dataBr(outro.vencimento)}</span>}
              </label>
            );
          })}
        </div>
        {mudamDeContrato.length > 0 && (
          <p className="text-[12.5px] text-warn-strong">
            FT{mudamDeContrato.join(', FT')} {mudamDeContrato.length > 1 ? 'vão sair' : 'vai sair'} do contrato onde {mudamDeContrato.length > 1 ? 'estão' : 'está'} e entrar neste.
          </p>
        )}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Nº do contrato {outros.length ? '' : <span className="font-normal text-ink-3">(opcional)</span>}
        </span>
        <input className="input" value={d.numero} onChange={(ev) => setD({ ...d, numero: ev.target.value })} />
        {mesmoNumero && <span className="text-[12.5px] text-warn-strong">Já existe o contrato {mesmoNumero.numero} deste cliente: com o mesmo número, as máquinas vão ficar juntas nele.</span>}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">Início</span>
          <input type="date" className="input" value={d.inicio} onChange={(ev) => setD({ ...d, inicio: ev.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Vencimento</span>
          <input type="date" className="input" value={d.vencimento} onChange={(ev) => setD({ ...d, vencimento: ev.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Observação <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={d.obs} onChange={(ev) => setD({ ...d, obs: ev.target.value })} placeholder="Ex.: reajuste pelo IPCA em janeiro" />
      </label>
      {d.renovacao ? (
        <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-[12.5px] text-warn-strong">O contrato renovado volta para “falta assinar”. Quando assinarem, anexe o arquivo ou marque como assinado.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={d.assinado} onChange={(ev) => setD({ ...d, assinado: ev.target.checked })} />
            Contrato assinado
          </label>
          {d.assinado && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              em
              <input type="date" className="input h-9 w-auto" value={d.assinadoEm} onChange={(ev) => setD({ ...d, assinadoEm: ev.target.value })} />
            </label>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5">
        <span className="label">
          📎 Arquivo do contrato <span className="font-normal text-ink-3">(PDF ou foto{e.antes.length && !d.renovacao ? ', se ainda não anexou' : ''})</span>
        </span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="Arquivo do contrato" className="text-[13px]" onChange={(ev) => setArquivo(ev.target.files?.[0] ?? null)} />
        {arquivo && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={arquivoAssinado} onChange={(ev) => setArquivoAssinado(ev.target.checked)} />
            Este arquivo já é o contrato assinado
          </label>
        )}
        {!arquivo && <span className="text-[12px] text-ink-3">Sem arquivo, o contrato fica com o aviso “contrato não anexado”.</span>}
      </div>
      <p className="text-[12.5px] text-ink-3">O início é a base do reajuste anual. Valores mudam pelo reajuste, em Movimentações.</p>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : d.renovacao ? 'Renovar contrato' : 'Salvar contrato'}
        </button>
      </div>
    </Modal>
  );
}

/** Contrato assinado: abrir o atual, anexar/trocar e ver os anteriores (renovações). */
function ArquivosDoContrato({ c, arquivos, edita, anexado }: { c: Contrato; arquivos: ArquivoContrato[]; edita: boolean; anexado: () => void }) {
  const { avisar } = useEstado();
  const ref = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [verAntigos, setVerAntigos] = useState(false);
  const [outro, setOutro] = useState(false);
  const frotas = c.maquinas.map((m) => m.numero);
  const atual = arquivos.find((a) => a.id === c.arquivoId) ?? null;
  const antigos = arquivos.filter((a) => a.clienteId === c.cliente.id && a.id !== c.arquivoId && a.frotas.some((f) => frotas.includes(f)));
  const enviar = async (arq: File) => {
    if (!/\.(pdf|jpe?g|png)$/i.test(arq.name)) return avisar('O contrato precisa ser PDF, JPG ou PNG.', 'bad');
    if (arq.size > 10 * 1024 * 1024) return avisar('Arquivo grande demais (máximo 10 MB).', 'bad');
    setEnviando(true);
    try {
      await api.anexarContrato({ clienteId: c.cliente.id, frotas, arquivo: await lerBase64(arq), nome: arq.name });
      avisar(`Contrato assinado de ${c.cliente.nome} anexado.`);
      anexado();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível anexar.', 'bad');
    } finally {
      setEnviando(false);
    }
  };
  const link = (a: ArquivoContrato) => (
    <a href={`/api/contratos/arquivos/${a.id}`} target="_blank" rel="noopener" className="font-semibold text-info underline underline-offset-2">
      {a.nome}
    </a>
  );
  if (!atual && !antigos.length && !edita) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 rounded-[10px] bg-[#F8F7F3] px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-2">Contrato assinado:</span>
        {atual ? (
          <span className="min-w-0 truncate">
            {link(atual)}
            <span className="text-ink-3">
              {' '}
              · anexado em {dataBr(atual.enviadoEm.slice(0, 10))}
              {atual.por ? ` por ${atual.por}` : ''}
            </span>
          </span>
        ) : (
          <span className="text-ink-3">nenhum arquivo</span>
        )}
        {edita && (
          <>
            <input
              ref={ref}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="hidden"
              aria-label="Arquivo do contrato assinado"
              onChange={(e) => {
                const a = e.target.files?.[0];
                e.target.value = '';
                if (a) void enviar(a);
              }}
            />
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" disabled={enviando} onClick={() => ref.current?.click()}>
              {enviando ? 'Enviando…' : atual ? 'Trocar arquivo' : 'Anexar contrato assinado'}
            </button>
          </>
        )}
        {edita && (
          <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={() => setOutro(true)}>
            + Outro documento
          </button>
        )}
        {antigos.length > 0 && (
          <button type="button" className="text-[12.5px] font-semibold text-ink-3 underline" onClick={() => setVerAntigos(!verAntigos)}>
            {verAntigos ? 'esconder histórico' : `histórico de documentos (${antigos.length})`}
          </button>
        )}
      </div>
      {verAntigos && (
        <ul className="flex flex-col gap-1 pl-1">
          {antigos.map((a) => (
            <li key={a.id}>
              <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2">{ROTULO_DOC[a.tipo] ?? 'Documento'}</span>
              {link(a)}
              <span className="text-ink-3">
                {' '}
                · {a.descricao ? `${a.descricao} · ` : ''}
                {a.numero ? `contrato ${a.numero} · ` : ''}
                {a.vencimento ? `vencimento ${dataBr(a.vencimento)} · ` : ''}anexado em {dataBr(a.enviadoEm.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {outro && <AnexarDocumento c={c} fechar={() => setOutro(false)} anexado={anexado} />}
    </div>
  );
}

/** Aditivo de reajuste, renovação, minuta… entra no histórico do contrato (não muda a assinatura). */
function AnexarDocumento({ c, fechar, anexado }: { c: Contrato; fechar: () => void; anexado: () => void }) {
  const { avisar } = useEstado();
  const [tipo, setTipo] = useState<TipoDocContrato>('aditivo');
  const [descricao, setDescricao] = useState('');
  const [arq, setArq] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const salvar = async () => {
    setErro('');
    if (!arq) return setErro('Escolha o arquivo.');
    if (!/\.(pdf|jpe?g|png)$/i.test(arq.name)) return setErro('O documento precisa ser PDF, JPG ou PNG.');
    if (arq.size > 10 * 1024 * 1024) return setErro('Arquivo grande demais (máximo 10 MB).');
    setSalvando(true);
    try {
      await api.anexarContrato({ clienteId: c.cliente.id, frotas: c.maquinas.map((m) => m.numero), arquivo: await lerBase64(arq), nome: arq.name, tipo, descricao: descricao.trim() });
      avisar(`${ROTULO_DOC[tipo]} guardado no histórico do contrato.`);
      anexado();
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível anexar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto fechar={fechar} titulo="Anexar documento ao contrato">
      <p className="text-[14px]">
        <b>{c.cliente.nome}</b>
        <span className="text-ink-3"> · {c.numero ? `contrato ${c.numero}` : 'sem número'} · FT{c.maquinas.map((m) => m.numero).join(', FT')}</span>
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="label">Tipo</span>
        <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocContrato)}>
          {(['aditivo', 'renovacao', 'contrato', 'outro'] as const).map((t) => (
            <option key={t} value={t}>
              {ROTULO_DOC[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Descrição <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: reajuste IPCA 2027" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Arquivo</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-[13px]" onChange={(e) => setArq(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-[12.5px] text-ink-3">Fica guardado no histórico do contrato e na pasta do cliente. O contrato assinado atual continua o mesmo.</p>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Enviando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
