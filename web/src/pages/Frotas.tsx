import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import type { Cliente, Frota } from '../types';
import { formatarReais } from '../lib/dinheiro';
import { dataCurta, descreverRegra, hojeIso, proximasDatas, regraDoCliente } from '../lib/calendario';
import { chaveEmpresa } from '../lib/normalizar';
import { ClienteForm, rascunhoDe, resumoLocacao, type Rascunho } from '../components/ClienteForm';
import { Cartao, Chip, Modal } from '../components/ui';
import { api } from '../api';
import { dataHora } from '../lib/email';
import type { FrotaOficina } from '../types';
import { IcAlerta, IcBusca, IcUpload } from '../components/Icones';
import { gerarExcelOperacoes } from '../lib/exportarExcel';

type Linha = { frota: Frota; cliente: Cliente; proxima: string | null; duplicada: boolean };
type Ordem = 'frota' | 'cliente' | 'valor' | 'proxima';
type Visao = 'frotas' | 'clientes';

/** Ordena "F-2" antes de "F-10" (números dentro do texto comparados como números). */
const comparaNumero = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

const COLUNAS = 'grid grid-cols-[120px_minmax(200px,1.4fr)_minmax(160px,1fr)_120px_minmax(170px,1fr)_90px] items-center gap-3';

export function Frotas() {
  const { clientes, avisar, oficina, definirOficina, ehFinanceiro } = useEstado();
  const [verOficina, setVerOficina] = useState(false);
  const naOficina = useMemo(() => new Map(oficina.map((o) => [o.frota, o])), [oficina]);
  const [exportando, setExportando] = useState(false);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('frota');
  const [visao, setVisao] = useState<Visao>('frotas');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [editando, setEditando] = useState<Rascunho | null>(null);

  const considerados = clientes.filter((c) => mostrarInativos || c.ativo);

  const linhas: Linha[] = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const c of considerados) for (const f of c.frotas) contagem.set(f.numero, (contagem.get(f.numero) ?? 0) + 1);
    return considerados.flatMap((c) => {
      const r = regraDoCliente(c);
      const proxima = r ? (proximasDatas(r, 1)[0] ?? null) : null;
      return c.frotas.map((frota) => ({ frota, cliente: c, proxima, duplicada: (contagem.get(frota.numero) ?? 0) > 1 }));
    });
  }, [considerados]);

  const q = chaveEmpresa(busca);
  const filtradas = linhas
    .filter((l) => !q || chaveEmpresa(l.frota.numero).includes(q) || chaveEmpresa(l.cliente.nome).includes(q) || chaveEmpresa(l.frota.descricao).includes(q))
    .sort((a, b) => {
      if (ordem === 'cliente') return a.cliente.nome.localeCompare(b.cliente.nome) || comparaNumero(a.frota.numero, b.frota.numero);
      if (ordem === 'valor') return b.frota.valor - a.frota.valor;
      if (ordem === 'proxima') return (a.proxima ?? '9999').localeCompare(b.proxima ?? '9999') || comparaNumero(a.frota.numero, b.frota.numero);
      return comparaNumero(a.frota.numero, b.frota.numero);
    });

  // frotas na oficina que não estão com nenhum cliente também entram na relação
  const comCliente = new Set(linhas.map((l) => l.frota.numero));
  const soOficina = oficina
    .filter((o) => !comCliente.has(o.frota))
    .filter((o) => !q || chaveEmpresa(o.frota).includes(q) || chaveEmpresa(`oficina ${o.observacao}`).includes(q))
    .sort((a, b) => comparaNumero(a.frota, b.frota));
  type Entrada = { tipo: 'cliente'; l: Linha } | { tipo: 'oficina'; o: FrotaOficina };
  const entradas: Entrada[] = [...filtradas.map((l) => ({ tipo: 'cliente' as const, l })), ...soOficina.map((o) => ({ tipo: 'oficina' as const, o }))];
  if (ordem === 'frota') entradas.sort((a, b) => comparaNumero(a.tipo === 'cliente' ? a.l.frota.numero : a.o.frota, b.tipo === 'cliente' ? b.l.frota.numero : b.o.frota));

  const duplicadas = [...new Set(linhas.filter((l) => l.duplicada).map((l) => l.frota.numero))];
  const valorTotal = linhas.reduce((s, l) => s + l.frota.valor, 0);
  const clientesComFrota = new Set(linhas.map((l) => l.cliente.id)).size;
  const semFrota = considerados.filter((c) => c.ativo && !c.frotas.length).length;
  const semValor = linhas.filter((l) => !l.frota.valor).length;

  // visão por cliente
  const porCliente = useMemo(() => {
    const m = new Map<string, { cliente: Cliente; frotas: Linha[] }>();
    for (const l of filtradas) {
      const g = m.get(l.cliente.id) ?? { cliente: l.cliente, frotas: [] };
      g.frotas.push(l);
      m.set(l.cliente.id, g);
    }
    return [...m.values()].sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));
  }, [filtradas]);

  const editar = (c: Cliente) => setEditando(rascunhoDe(c));

  const cabecalho = (id: Ordem, rotulo: string, alinhar = '') => (
    <button
      type="button"
      onClick={() => setOrdem(id)}
      className={`min-h-[32px] text-left font-semibold hover:text-ink ${alinhar} ${ordem === id ? 'text-ink underline underline-offset-4' : ''}`}
      aria-pressed={ordem === id}
    >
      {rotulo}
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Locação</div>
          <h1 className="mt-1 text-[26px] font-bold">Frotas e clientes</h1>
          <p className="text-[13px] text-ink-3">Cada frota e o cliente com quem está. Para mudar, edite o cliente (as frotas ficam no cadastro dele).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn-primary"
            disabled={exportando}
            onClick={async () => {
              setExportando(true);
              try {
                await gerarExcelOperacoes(clientes, hojeIso());
              } catch {
                avisar('Não foi possível gerar o Excel.', 'bad');
              } finally {
                setExportando(false);
              }
            }}
          >
            <IcUpload className="rotate-180" /> {exportando ? 'Gerando…' : 'Exportar Excel'}
          </button>
          <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
            <IcBusca />
            <span className="sr-only">Buscar frota ou cliente</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº da frota, cliente ou descrição"
              className="w-[240px] bg-transparent text-ink outline-none"
            />
          </label>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Cartao rotulo="Frotas locadas" valor={new Set(linhas.map((l) => l.frota.numero)).size} />
        <Cartao rotulo="Clientes com frota" valor={clientesComFrota} />
        {ehFinanceiro && <Cartao rotulo="Valor total das frotas" valor={formatarReais(valorTotal)} />}
        <button type="button" onClick={() => setVerOficina(true)} className="text-left" aria-label="Ver frotas na oficina">
          <Cartao rotulo="Na oficina (clique para ver)" valor={oficina.length} cor={oficina.length ? 'text-[#B45309]' : ''} />
        </button>
        <Cartao rotulo="Clientes ativos sem frota" valor={semFrota} cor={semFrota ? 'text-warn' : ''} />
      </div>

      {duplicadas.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-bad/20 bg-bad-soft px-4 py-3 text-[13px] text-bad-strong">
          <IcAlerta className="mt-0.5 shrink-0" />
          <div>
            <b>Frota em mais de um cliente:</b> {duplicadas.join(', ')}. Confira se ela mudou de cliente e esqueceram de tirar do anterior.
            <button type="button" className="ml-2 font-semibold underline underline-offset-2" onClick={() => setBusca(duplicadas[0])}>
              Ver {duplicadas[0]}
            </button>
          </div>
        </div>
      )}
      {semValor > 0 && (
        <p className="mb-4 text-[13px] text-warn-strong">
          {semValor} frota{semValor > 1 ? 's' : ''} sem valor cadastrado.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-[10px] border border-line-strong bg-white p-0.5" role="group" aria-label="Agrupar">
          {(['frotas', 'clientes'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visao === v}
              onClick={() => setVisao(v)}
              className={`min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ${visao === v ? 'bg-ink text-white' : 'text-ink-2'}`}
            >
              {v === 'frotas' ? 'Por frota' : 'Por cliente'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="h-[18px] w-[18px] accent-ink" />
          Incluir clientes desativados
        </label>
      </div>

      {linhas.length === 0 ? (
        <div className="card px-5 py-8 text-center text-ink-3">
          Nenhuma frota cadastrada ainda. Cadastre as frotas no{' '}
          <Link to="/clientes" className="font-semibold text-ink underline underline-offset-2">
            cadastro de cada cliente
          </Link>{' '}
          (Editar → Faturamento → Adicionar frota).
        </div>
      ) : visao === 'frotas' ? (
        <section aria-label="Frotas" className="card overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className={`${COLUNAS} border-b border-line bg-[#F8F7F3] px-4 py-1.5 text-xs text-ink-3`}>
                {cabecalho('frota', 'Frota')}
                {cabecalho('cliente', 'Cliente')}
                <span className="font-semibold">Descrição</span>
                {cabecalho('valor', 'Valor', 'text-right')}
                {cabecalho('proxima', 'Próxima fatura')}
                <span className="sr-only">Ações</span>
              </div>
              {entradas.map((e) => {
                if (e.tipo === 'oficina') {
                  const o = e.o;
                  return (
                    <div key={`oficina|${o.frota}`} className={`${COLUNAS} border-b border-line-soft bg-[#FFF4E5] px-4 py-2.5 text-[13px] last:border-b-0`}>
                      <span className="flex items-center gap-1.5 font-mono font-semibold">
                        {o.frota} <SeloOficina />
                      </span>
                      <span className="font-semibold text-[#B45309]">Oficina</span>
                      <span className="text-ink-2">{o.observacao || '—'}</span>
                      <span className="text-right text-ink-3">—</span>
                      <span className="text-xs text-ink-3">desde {dataHora(o.desde).slice(0, 10)}</span>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setVerOficina(true)}>
                        Oficina
                      </button>
                    </div>
                  );
                }
                const l = e.l;
                const ofi = naOficina.get(l.frota.numero);
                return (
                  <div
                    key={`${l.cliente.id}|${l.frota.numero}`}
                    className={`${COLUNAS} border-b border-line-soft px-4 py-2.5 text-[13px] last:border-b-0 ${ofi ? 'bg-[#FFF4E5]' : ''}`}
                  >
                    <span className="flex items-center gap-1.5 font-mono font-semibold">
                      {l.frota.numero}
                      {ofi && <SeloOficina />}
                      {l.duplicada && <Chip tom="bad">2 clientes</Chip>}
                    </span>
                    <span>
                      <span className="font-semibold">{l.cliente.nome}</span>
                      {!l.cliente.ativo && <span className="ml-2 text-xs text-ink-3">(desativado)</span>}
                    </span>
                    <span className="text-ink-2">
                      {l.frota.descricao || (resumoLocacao(l.frota) ? '' : '—')}
                      {resumoLocacao(l.frota) && <span className="block text-xs text-ink-3">{resumoLocacao(l.frota)}</span>}
                    </span>
                    <span className={`text-right font-semibold ${l.frota.valor ? '' : 'text-warn'}`}>{l.frota.valor ? formatarReais(l.frota.valor) : 'sem valor'}</span>
                    <span className="text-ink-2">
                      {l.proxima ? <b className="text-ink">{dataCurta(l.proxima)}</b> : '—'}
                      <span className="block text-xs text-ink-3">{descreverRegra(regraDoCliente(l.cliente))}</span>
                    </span>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => editar(l.cliente)} aria-label={`Editar ${l.cliente.nome}`}>
                      Editar
                    </button>
                  </div>
                );
              })}
              {entradas.length === 0 && <div className="px-4 py-6 text-ink-3">Nada encontrado para “{busca}”.</div>}
            </div>
          </div>
        </section>
      ) : (
        <section aria-label="Frotas por cliente" className="flex flex-col gap-3">
          {porCliente.map((g) => (
            <div key={g.cliente.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{g.cliente.nome}</div>
                  <div className="text-xs text-ink-3">
                    {descreverRegra(regraDoCliente(g.cliente))}
                    {g.frotas[0]?.proxima && ` · próxima: ${dataCurta(g.frotas[0].proxima)}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px]">
                    {g.frotas.length} frota{g.frotas.length > 1 ? 's' : ''}
                    {ehFinanceiro && (
                      <>
                        {' '}
                        · <b>{formatarReais(g.frotas.reduce((s, l) => s + l.frota.valor, 0))}</b>
                      </>
                    )}
                  </span>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editar(g.cliente)}>
                    Editar
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.frotas
                  .sort((a, b) => comparaNumero(a.frota.numero, b.frota.numero))
                  .map((l) => (
                    <span
                      key={l.frota.numero}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${l.duplicada ? 'border-bad/30 bg-bad-soft' : naOficina.has(l.frota.numero) ? 'border-[#F59E0B]/40 bg-[#FFF4E5]' : 'border-line bg-[#F8F7F3]'}`}
                      title={l.frota.descricao}
                    >
                      <b className="font-mono">{l.frota.numero}</b>
                      {naOficina.has(l.frota.numero) && <SeloOficina />}
                      <span className="text-ink-2">{l.frota.valor ? formatarReais(l.frota.valor) : 'sem valor'}</span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
          {porCliente.length === 0 && <div className="card px-4 py-6 text-ink-3">Nada encontrado para “{busca}”.</div>}
        </section>
      )}

      <ClienteForm inicial={editando} fechar={() => setEditando(null)} />
      <Oficina aberto={verOficina} fechar={() => setVerOficina(false)} lista={oficina} definir={definirOficina} clientes={clientes} avisar={avisar} />
    </div>
  );
}

function SeloOficina() {
  return <span className="rounded-full bg-[#F59E0B] px-2 py-px font-sans text-[10.5px] font-bold uppercase tracking-wide text-white">Oficina</span>;
}

function Oficina({
  aberto,
  fechar,
  lista,
  definir,
  clientes,
  avisar,
}: {
  aberto: boolean;
  fechar: () => void;
  lista: FrotaOficina[];
  definir: (l: FrotaOficina[]) => void;
  clientes: Cliente[];
  avisar: (t: string, tom?: 'ok' | 'bad') => void;
}) {
  const [frota, setFrota] = useState('');
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const dono = (n: string) => clientes.find((c) => c.ativo && c.frotas.some((f) => f.numero === n))?.nome;
  const rodar = async (f: () => Promise<FrotaOficina[]>, msg: string) => {
    setOcupado(true);
    try {
      definir(await f());
      avisar(msg);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setOcupado(false);
    }
  };
  const numero = frota
    .trim()
    .toUpperCase()
    .replace(/^FT[\s-]*/, '');
  return (
    <Modal aberto={aberto} fechar={fechar} titulo="Frotas na oficina">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!numero) return;
          void rodar(() => api.colocarNaOficina(numero, obs.trim()), `FT${numero} marcada como na oficina.`).then(() => {
            setFrota('');
            setObs('');
          });
        }}
      >
        <label className="flex w-[110px] flex-col gap-1 text-xs font-semibold">
          Frota
          <input className="input" value={frota} onChange={(e) => setFrota(e.target.value)} placeholder="FT59" />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs font-semibold">
          O que foi fazer <span className="font-normal text-ink-3">(opcional)</span>
          <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: troca de motor" />
        </label>
        <button type="submit" className="btn-primary" disabled={!numero || ocupado}>
          Colocar na oficina
        </button>
      </form>
      {numero && dono(numero) && (
        <p className="-mt-1 text-xs text-ink-3">
          A FT{numero} está com {dono(numero)}: ela continua no cadastro do cliente, só ganha a marca de oficina.
        </p>
      )}
      {lista.length === 0 ? (
        <p className="text-ink-3">Nenhuma frota na oficina.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line">
          {lista.map((o) => (
            <li key={o.frota} className="flex flex-wrap items-center justify-between gap-2 bg-[#FFF4E5]/60 px-3 py-2.5 text-[13px]">
              <div>
                <b className="font-mono">FT{o.frota}</b> <SeloOficina />
                <span className="ml-2 text-ink-2">{o.observacao}</span>
                <div className="text-xs text-ink-3">
                  desde {dataHora(o.desde)}
                  {o.usuario && ` · ${o.usuario}`}
                  {dono(o.frota) ? ` · com ${dono(o.frota)}` : ' · sem cliente'}
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={ocupado}
                onClick={() => void rodar(() => api.tirarDaOficina(o.frota), `FT${o.frota} saiu da oficina.`)}
              >
                Saiu da oficina
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
