import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { ArquivoContrato, Cliente, Equipamento } from '../types';
import { lerBase64 } from '../components/NfeAnexo';
import { dataBr, hojeIso } from '../lib/calendario';
import { formatarReais } from '../lib/dinheiro';
import { chaveEmpresa } from '../lib/normalizar';
import { DIAS_AVISO, montarContratos, sugestaoRenovacao, type Contrato, type StatusContrato } from '../lib/contratos';
import { Chip, Modal, type Tom } from '../components/ui';
import { IcBusca } from '../components/Icones';

type Filtro = 'todos' | StatusContrato | 'reajuste' | 'sem' | 'assinar';
const STATUS: Record<StatusContrato, { rotulo: string; tom: Tom }> = {
  vencido: { rotulo: 'Vencido', tom: 'bad' },
  vencendo: { rotulo: `Vence em até ${DIAS_AVISO} dias`, tom: 'warn' },
  vigente: { rotulo: 'Vigente', tom: 'ok' },
};

/** Rascunho do editor: contrato existente (editar/renovar) ou novo para um cliente. */
type Edicao = { cliente: Cliente; frotas: string[]; antes: string[]; numero: string; inicio: string; vencimento: string; obs: string; renovacao: boolean; assinado: boolean; assinadoEm: string };

export function Contratos() {
  const { clientes, movimentacoes, pode, veValores } = useEstado();
  const edita = pode('contratos', 2);
  // valor da locação: quem vê valores ou confere frotas (o servidor manda 0 para os outros)
  const veValor = veValores || pode('conferencia');
  const [fichas, setFichas] = useState<Equipamento[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoContrato[]>([]);
  const recarregar = () => Promise.all([api.listarEquipamentos().then(setFichas, () => undefined), api.listarArquivosContrato().then(setArquivos, () => undefined)]);
  useEffect(() => {
    void recarregar();
  }, []);
  const hoje = hojeIso();
  const { contratos, semContrato, esporadicas } = useMemo(() => montarContratos(clientes, fichas, movimentacoes, hoje), [clientes, fichas, movimentacoes, hoje]);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [edicao, setEdicao] = useState<Edicao | null>(null);

  const q = chaveEmpresa(busca);
  const achou = (c: Cliente, maquinas: { numero: string }[], numero = '') =>
    !q || chaveEmpresa(c.nome).includes(q) || chaveEmpresa(numero).includes(q) || maquinas.some((m) => chaveEmpresa(m.numero).includes(q));
  const conta = (f: Filtro) =>
    f === 'todos' ? contratos.length : f === 'assinar' ? contratos.filter((c) => !c.assinado).length : f === 'reajuste' ? contratos.filter((c) => c.reajusteAtrasado).length : f === 'sem' ? semContrato.reduce((s, x) => s + x.maquinas.length, 0) : contratos.filter((c) => c.status === f).length;
  const lista = contratos.filter(
    (c) => (filtro === 'todos' || filtro === c.status || (filtro === 'reajuste' && c.reajusteAtrasado) || (filtro === 'assinar' && !c.assinado)) && achou(c.cliente, c.maquinas, c.numero),
  );
  const soma = (l: Contrato[]) => l.reduce((s, c) => s + c.valor, 0);
  const porStatus = (s: StatusContrato) => contratos.filter((c) => c.status === s);

  const editar = (c: Contrato, renovacao: boolean) =>
    setEdicao({
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
      className={`flex flex-col rounded-xl border bg-white px-4 py-3 text-left hover:border-ink ${filtro === f ? 'border-ink ring-1 ring-ink' : 'border-line'}`}
    >
      <span className="text-[12.5px] font-semibold text-ink-3">{rot}</span>
      <span className={`text-[26px] font-bold leading-tight ${cor}`}>{n}</span>
      {valor !== null && veValor && <span className="text-[12.5px] text-ink-3">{formatarReais(valor)}/mês</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Locação</div>
          <h1 className="mt-1 text-[26px] font-bold">Contratos</h1>
          <p className="text-[13px] text-ink-3">Um contrato por cliente, com as máquinas dele: vencimento, renovação e reajuste. Os dados ficam também na ficha de cada máquina.</p>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
          <IcBusca />
          <span className="sr-only">Buscar cliente, contrato ou frota</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, contrato ou frota" className="w-[220px] bg-transparent text-ink outline-none" />
        </label>
      </div>

      <section aria-label="Resumo dos contratos" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cartao('Vencidos', porStatus('vencido').length, soma(porStatus('vencido')), 'vencido', porStatus('vencido').length ? 'text-bad' : 'text-ink-3')}
        {cartao(`Vencem em ${DIAS_AVISO} dias`, porStatus('vencendo').length, soma(porStatus('vencendo')), 'vencendo', porStatus('vencendo').length ? 'text-warn-strong' : 'text-ink-3')}
        {cartao('Vigentes', porStatus('vigente').length, soma(porStatus('vigente')), 'vigente', 'text-ok')}
        {cartao('Reajuste atrasado', conta('reajuste'), soma(contratos.filter((c) => c.reajusteAtrasado)), 'reajuste', conta('reajuste') ? 'text-warn-strong' : 'text-ink-3')}
        {cartao('Falta assinatura', conta('assinar'), soma(contratos.filter((c) => !c.assinado)), 'assinar', conta('assinar') ? 'text-bad' : 'text-ink-3')}
        {cartao('Máquinas sem contrato', conta('sem'), semContrato.reduce((s, x) => s + x.valor, 0), 'sem', conta('sem') ? 'text-warn-strong' : 'text-ink-3')}
      </section>

      {filtro !== 'sem' && (
        <section aria-label="Contratos" className="flex flex-col gap-2.5">
          {lista.map((c) => (
            <article key={c.chave} className={`rounded-xl border bg-white p-4 ${c.status === 'vencido' ? 'border-bad/30' : c.status === 'vencendo' ? 'border-warn-line' : 'border-line'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[16px]">{c.cliente.nome}</b>
                    {c.numero ? <span className="rounded-md bg-line-soft px-2 py-0.5 font-mono text-[12.5px]">Contrato {c.numero}</span> : <span className="text-[12.5px] text-ink-3">sem número</span>}
                    <Chip tom={STATUS[c.status].tom}>{STATUS[c.status].rotulo}</Chip>
                    {c.reajusteAtrasado && <Chip tom="warn">Reajuste atrasado</Chip>}
                    {c.assinado ? (
                      <Chip tom="ok">✓ Assinado{c.assinadoEm ? ` em ${dataBr(c.assinadoEm)}` : ''}</Chip>
                    ) : (
                      <Chip tom="bad">{c.assinaturaParcial ? 'Assinatura incompleta' : 'Falta assinar'}</Chip>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
                    <span>Início: {c.inicio ? dataBr(c.inicio) : <span className="text-ink-3">—</span>}</span>
                    <span>
                      Vencimento: <b className={c.status === 'vencido' ? 'text-bad' : c.status === 'vencendo' ? 'text-warn-strong' : ''}>{dataBr(c.vencimento)}</b>{' '}
                      <span className="text-ink-3">({c.diasParaVencer < 0 ? `venceu há ${-c.diasParaVencer} dias` : c.diasParaVencer === 0 ? 'vence hoje' : `faltam ${c.diasParaVencer} dias`})</span>
                    </span>
                    <span>
                      Próximo reajuste: {c.proximoReajuste ? <b className={c.reajusteAtrasado ? 'text-warn-strong' : ''}>{dataBr(c.proximoReajuste)}</b> : <span className="text-ink-3">sem data de início</span>}
                      {c.ultimoReajuste && <span className="text-ink-3"> · último em {dataBr(c.ultimoReajuste)}</span>}
                    </span>
                  </div>
                </div>
                {veValor && (
                  <div className="text-right">
                    <b className="text-[18px]">{formatarReais(c.valor)}</b>
                    <div className="text-xs text-ink-3">por mês</div>
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {c.maquinas.map((m) => (
                  <span key={m.numero} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[#F8F7F3] px-2.5 py-1 text-[13px]" title={m.descricao}>
                    <b className="font-mono">FT{m.numero}</b>
                    {veValor && <span className="text-ink-2">{m.valor ? formatarReais(m.valor) : 'sem valor'}</span>}
                  </span>
                ))}
              </div>
              {c.datasDiferentes && <p className="mt-2 text-[12.5px] text-warn-strong">As máquinas deste contrato estão com vencimentos diferentes nas fichas. Use Editar para acertar.</p>}
              {c.obs && <p className="mt-2 text-[13px] text-ink-2">{c.obs}</p>}
              <ArquivosDoContrato c={c} arquivos={arquivos} edita={edita} anexado={() => void recarregar()} />
              {edita && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary btn-sm" onClick={() => editar(c, true)}>
                    Renovar
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editar(c, false)}>
                    Editar
                  </button>
                  {pode('movimentacoes', 2) && (
                    <Link className="btn-secondary btn-sm" to={`/movimentacoes?nova=reajuste&cliente=${c.cliente.id}`}>
                      Registrar reajuste
                    </Link>
                  )}
                </div>
              )}
            </article>
          ))}
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
                <div key={s.cliente.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
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

      {edicao && <EditorContrato e={edicao} fechar={() => setEdicao(null)} salvo={() => void recarregar()} veValor={veValor} />}
    </div>
  );
}

function EditorContrato({ e, fechar, salvo, veValor }: { e: Edicao; fechar: () => void; salvo: () => void; veValor: boolean }) {
  const { avisar } = useEstado();
  const [d, setD] = useState(e);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const marcar = (n: string, sim: boolean) => setD({ ...d, frotas: sim ? [...d.frotas, n] : d.frotas.filter((x) => x !== n) });

  const salvar = async () => {
    setErro('');
    if (!d.frotas.length) return setErro('Marque pelo menos uma máquina.');
    if (!d.vencimento) return setErro('Informe o vencimento do contrato.');
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
        ...(d.renovacao ? {} : { assinado: d.assinado, assinadoEm: d.assinado ? d.assinadoEm || null : null }),
      });
      avisar(d.renovacao ? `Contrato de ${d.cliente.nome} renovado até ${dataBr(d.vencimento)}.` : `Contrato de ${d.cliente.nome} salvo.`);
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
        <legend className="label mb-1">Máquinas do contrato</legend>
        <div className="flex flex-wrap gap-2">
          {d.cliente.frotas.map((f) => (
            <label key={f.numero} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${d.frotas.includes(f.numero) ? 'border-ink bg-brand-tint' : 'border-line'}`}>
              <input type="checkbox" className="h-4 w-4 accent-ink" checked={d.frotas.includes(f.numero)} onChange={(ev) => marcar(f.numero, ev.target.checked)} />
              <b className="font-mono">FT{f.numero}</b>
              {veValor && f.valor > 0 && <span className="text-ink-3">{formatarReais(f.valor)}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Nº do contrato <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={d.numero} onChange={(ev) => setD({ ...d, numero: ev.target.value })} />
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
        {antigos.length > 0 && (
          <button type="button" className="text-[12.5px] font-semibold text-ink-3 underline" onClick={() => setVerAntigos(!verAntigos)}>
            {verAntigos ? 'esconder anteriores' : `anteriores (${antigos.length})`}
          </button>
        )}
      </div>
      {verAntigos && (
        <ul className="flex flex-col gap-1 pl-1">
          {antigos.map((a) => (
            <li key={a.id}>
              {link(a)}
              <span className="text-ink-3">
                {' '}
                · {a.numero ? `contrato ${a.numero} · ` : ''}
                {a.vencimento ? `vencimento ${dataBr(a.vencimento)} · ` : ''}anexado em {dataBr(a.enviadoEm.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
