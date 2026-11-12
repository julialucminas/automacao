import { useMemo, useState } from 'react';
import { useBuscaDaUrl } from '../lib/buscaDaUrl';
import { Link, useNavigate } from 'react-router-dom';
import { useEstado } from '../state';
import type { Cliente, Frota } from '../types';
import { formatarReais } from '../lib/dinheiro';
import { dataBr, dataCurta, descreverRegra, hojeIso, proximasDatas, regraDoCliente } from '../lib/calendario';
import { chaveEmpresa } from '../lib/normalizar';
import { ClienteForm, rascunhoDe, type Rascunho } from '../components/ClienteForm';
import { Chip, Gaveta, Modal } from '../components/ui';
import { api } from '../api';
import { dataHora, referenciaAtual } from '../lib/email';
import type { FrotaOficina } from '../types';
import { IcAlerta, IcBusca, IcUpload } from '../components/Icones';
import { gerarExcelOperacoes } from '../lib/exportarExcel';
import { gerarPdfLocacoes, montarRelatorio, type ModeloRelatorio } from '../lib/relatorioLocacoes';

type Linha = { frota: Frota; cliente: Cliente; proxima: string | null; duplicada: boolean };
type Ordem = 'frota' | 'cliente' | 'valor' | 'proxima' | 'fim';
type Visao = 'frotas' | 'clientes';
type Filtro = 'todas' | 'contrato' | 'esporadico' | 'semEtiqueta' | 'oficina' | 'terminando';

/** Ordena "F-2" antes de "F-10" (números dentro do texto comparados como números). */
const comparaNumero = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
const somarDias = (iso: string, n: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const freteTexto = (f: Frota) => (f.frete === 'lucminas' ? 'Lucminas' : f.frete === 'cliente' ? `Cliente${f.freteValor ? ` · ${formatarReais(f.freteValor)}` : ''}` : '');

export function Frotas() {
  const { clientes, avisar, oficina, definirOficina, veValores: ehFinanceiro, pode } = useEstado();
  const editaFrotas = pode('frotas', 2);
  /** valor de cada frota: quem vê valores ou quem confere frotas e valores no fim do mês (o servidor manda 0 para os outros) */
  const veValorFrota = ehFinanceiro || pode('conferencia');
  const [verOficina, setVerOficina] = useState(false);
  const [relatorio, setRelatorio] = useState(false);
  const naOficina = useMemo(() => new Map(oficina.map((o) => [o.frota, o])), [oficina]);
  const [exportando, setExportando] = useState(false);
  const [busca, setBusca] = useState('');
  useBuscaDaUrl(setBusca);
  const [ordem, setOrdem] = useState<Ordem>('frota');
  const [visao, setVisao] = useState<Visao>('frotas');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  /** detalhe aberto: frota (com ou sem cliente) */
  const [aberta, setAberta] = useState<string | null>(null);
  /** acabou de sair da oficina: perguntar o que fazer com a máquina */
  const [saiu, setSaiu] = useState<string | null>(null);
  const hoje = hojeIso();
  const daqui30 = somarDias(hoje, 30);

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

  const terminando = (f: Frota) => !!f.fim && f.fim <= daqui30;
  const q = chaveEmpresa(busca);
  const combina = (f: Filtro, l: Linha) =>
    f === 'todas' ||
    (f === 'contrato' && l.frota.modalidade === 'contrato') ||
    (f === 'esporadico' && l.frota.modalidade === 'esporadico') ||
    (f === 'semEtiqueta' && !l.frota.modalidade) ||
    (f === 'oficina' && naOficina.has(l.frota.numero)) ||
    (f === 'terminando' && terminando(l.frota));
  const passaFiltro = (l: Linha) => combina(filtro, l);
  const filtradas = linhas
    .filter((l) => !q || chaveEmpresa(l.frota.numero).includes(q) || chaveEmpresa(l.cliente.nome).includes(q) || chaveEmpresa(l.frota.descricao).includes(q))
    .filter(passaFiltro)
    .sort((a, b) => {
      if (ordem === 'cliente') return a.cliente.nome.localeCompare(b.cliente.nome) || comparaNumero(a.frota.numero, b.frota.numero);
      if (ordem === 'valor') return b.frota.valor - a.frota.valor;
      if (ordem === 'proxima') return (a.proxima ?? '9999').localeCompare(b.proxima ?? '9999') || comparaNumero(a.frota.numero, b.frota.numero);
      if (ordem === 'fim') return (a.frota.fim ?? '9999').localeCompare(b.frota.fim ?? '9999') || comparaNumero(a.frota.numero, b.frota.numero);
      return comparaNumero(a.frota.numero, b.frota.numero);
    });

  // frotas na oficina que não estão com nenhum cliente também entram na relação
  const comCliente = new Set(linhas.map((l) => l.frota.numero));
  const soOficina = oficina
    .filter((o) => !comCliente.has(o.frota))
    .filter(() => filtro === 'todas' || filtro === 'oficina')
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
  const conta = (f: Filtro) => (f === 'oficina' ? oficina.length : linhas.filter((l) => combina(f, l)).length);

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
  const tirarDaOficina = async (frota: string) => {
    try {
      definirOficina(await api.tirarDaOficina(frota));
      setAberta(null);
      setSaiu(frota);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível tirar da oficina.', 'bad');
    }
  };

  const cabecalho = (id: Ordem, rotulo: string, alinhar = '') => (
    <th className={`px-3 py-2 font-semibold ${alinhar}`}>
      <button type="button" onClick={() => setOrdem(id)} className={`hover:text-ink ${ordem === id ? 'text-ink underline underline-offset-4' : ''}`} aria-pressed={ordem === id}>
        {rotulo}
      </button>
    </th>
  );
  const linhaAberta = aberta ? linhas.find((l) => l.frota.numero === aberta) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Locação</div>
          <h1 className="mt-1 text-[26px] font-bold">Relação das locações</h1>
          <p className="text-[13px] text-ink-3">Cada máquina, com quem está e os dados da locação. Clique numa linha para ver tudo e mexer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
            <IcBusca />
            <span className="sr-only">Buscar frota ou cliente</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota, cliente ou máquina" className="w-[200px] bg-transparent text-ink outline-none" />
          </label>
          <button type="button" className="btn-secondary h-10" onClick={() => setVerOficina(true)}>
            Oficina{oficina.length ? ` (${oficina.length})` : ''}
          </button>
          <details className="relative">
            <summary className="btn-secondary h-10 cursor-pointer list-none">
              <IcUpload className="rotate-180" /> Exportar ▾
            </summary>
            <div className="absolute right-0 z-20 mt-1 flex w-[200px] flex-col rounded-xl border border-line bg-white p-1 shadow-lg">
              <button type="button" className="rounded-lg px-3 py-2 text-left text-[14px] hover:bg-line-soft" onClick={() => setRelatorio(true)}>
                Relatório em PDF
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-left text-[14px] hover:bg-line-soft"
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
                {exportando ? 'Gerando…' : 'Planilha Excel'}
              </button>
            </div>
          </details>
        </div>
      </div>

      {/* resumo numa linha */}
      <p className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-line bg-white px-4 py-3 text-[14px] text-ink-2">
        <span>
          <b className="text-ink">{new Set(linhas.map((l) => l.frota.numero)).size}</b> máquinas locadas
        </span>
        <span>
          <b className="text-ink">{clientesComFrota}</b> clientes
        </span>
        {ehFinanceiro && (
          <span>
            <b className="text-ink">{formatarReais(valorTotal)}</b> por mês
          </span>
        )}
        <span>
          <b className="text-ink">{oficina.length}</b> na oficina
        </span>
        {semFrota > 0 && <span className="text-warn-strong">{semFrota} cliente{semFrota > 1 ? 's' : ''} ativo{semFrota > 1 ? 's' : ''} sem máquina</span>}
        {veValorFrota && semValor > 0 && <span className="text-warn-strong">{semValor} sem valor</span>}
      </p>

      {duplicadas.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-bad/20 bg-bad-soft px-4 py-3 text-[13px] text-bad-strong">
          <IcAlerta className="mt-0.5 shrink-0" />
          <div>
            <b>Frota em mais de um cliente:</b> {duplicadas.join(', ')}. Confira se ela mudou de cliente e esqueceram de tirar do anterior.
            <button type="button" className="ml-2 font-semibold underline underline-offset-2" onClick={() => setBusca(duplicadas[0])}>
              Ver {duplicadas[0]}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
          {(
            [
              ['todas', 'Todas'],
              ['contrato', 'Contrato'],
              ['esporadico', 'Esporádico'],
              ['terminando', 'Terminando (30 dias)'],
              ['oficina', 'Na oficina'],
              ['semEtiqueta', 'Sem etiqueta'],
            ] as const
          ).map(([id, rot]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filtro === id}
              onClick={() => setFiltro(id)}
              className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${filtro === id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}
            >
              {rot} <span className="font-normal opacity-70">{conta(id)}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="h-[18px] w-[18px] accent-ink" />
            Clientes desativados
          </label>
          <div className="flex rounded-[10px] border border-line-strong bg-white p-0.5" role="group" aria-label="Agrupar">
            {(['frotas', 'clientes'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visao === v}
                onClick={() => setVisao(v)}
                className={`min-h-[32px] rounded-lg px-3 text-[13px] font-semibold ${visao === v ? 'bg-ink text-white' : 'text-ink-2'}`}
              >
                {v === 'frotas' ? 'Por máquina' : 'Por cliente'}
              </button>
            ))}
          </div>
        </span>
      </div>

      {linhas.length === 0 && oficina.length === 0 ? (
        <div className="card px-5 py-8 text-center text-ink-3">
          Nenhuma locação cadastrada ainda. Registre em{' '}
          <Link to="/movimentacoes" className="font-semibold text-ink underline underline-offset-2">
            Movimentações
          </Link>
          .
        </div>
      ) : visao === 'frotas' ? (
        <section aria-label="Locações" className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[980px] text-left text-[13.5px]">
            <thead className="border-b border-line bg-[#F8F7F3] text-xs text-ink-3">
              <tr>
                {cabecalho('frota', 'Frota')}
                {cabecalho('cliente', 'Cliente')}
                <th className="px-3 py-2 font-semibold">Máquina</th>
                {cabecalho('fim', 'Período')}
                <th className="px-3 py-2 font-semibold">Frete</th>
                {veValorFrota && cabecalho('valor', 'Valor', 'text-right')}
                {cabecalho('proxima', 'Próx. fatura')}
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => {
                if (e.tipo === 'oficina') {
                  const o = e.o;
                  return (
                    <tr key={`oficina|${o.frota}`} className="cursor-pointer border-b border-line-soft bg-[#FFF8EC] last:border-0 hover:bg-[#FFF1D6]" onClick={() => setAberta(o.frota)}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold">
                        {o.frota} <SeloOficina />
                      </td>
                      <td className="px-3 py-2.5 text-[#B45309]">sem cliente</td>
                      <td className="px-3 py-2.5 text-ink-2" colSpan={veValorFrota ? 4 : 3}>
                        {o.observacao || 'Na oficina'} <span className="text-xs text-ink-3">· desde {dataHora(o.desde).slice(0, 10)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {editaFrotas && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void tirarDaOficina(o.frota);
                            }}
                          >
                            Tirar da oficina
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }
                const l = e.l;
                const f = l.frota;
                const ofi = naOficina.get(f.numero);
                return (
                  <tr
                    key={`${l.cliente.id}|${f.numero}`}
                    className={`cursor-pointer border-b border-line-soft last:border-0 ${ofi ? 'bg-[#FFF8EC] hover:bg-[#FFF1D6]' : 'hover:bg-brand-tint'}`}
                    onClick={() => setAberta(f.numero)}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="flex items-center gap-1.5 font-mono font-semibold">
                        {f.numero}
                        <SeloModalidade m={f.modalidade} />
                        {ofi && <SeloOficina />}
                        {l.duplicada && <Chip tom="bad">2 clientes</Chip>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold">{l.cliente.nome}</span>
                      {!l.cliente.ativo && <span className="ml-1.5 text-xs text-ink-3">(desativado)</span>}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-ink-2" title={f.descricao}>
                      {f.descricao || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">
                      {f.inicio ? dataBr(f.inicio) : '—'} → {f.fim ? <span className={terminando(f) ? 'font-semibold text-warn-strong' : ''}>{dataBr(f.fim)}</span> : <span className="text-ink-3">sem término</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{freteTexto(f) || <span className="text-ink-3">—</span>}</td>
                    {veValorFrota && <td className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold ${f.valor ? '' : 'text-warn'}`}>{f.valor ? formatarReais(f.valor) : 'sem valor'}</td>}
                    <td className="whitespace-nowrap px-3 py-2.5" title={descreverRegra(regraDoCliente(l.cliente))}>
                      {l.proxima ? dataCurta(l.proxima) : '—'}
                    </td>
                  </tr>
                );
              })}
              {entradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-ink-3">
                    Nada encontrado{busca ? ` para “${busca}”` : ' com esse filtro'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section aria-label="Locações por cliente" className="flex flex-col gap-3">
          {porCliente.map((g) => (
            <div key={g.cliente.id} className="card p-4">
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <b>{g.cliente.nome}</b>
                  <span className="ml-2 text-[13px] text-ink-3">
                    {g.frotas.length} máquina{g.frotas.length > 1 ? 's' : ''}
                    {veValorFrota && ` · ${formatarReais(g.frotas.reduce((s, l) => s + l.frota.valor, 0))} por mês`}
                    {` · ${descreverRegra(regraDoCliente(g.cliente))}`}
                  </span>
                </div>
                {editaFrotas && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editar(g.cliente)}>
                    Editar cliente
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.frotas
                  .sort((a, b) => comparaNumero(a.frota.numero, b.frota.numero))
                  .map((l) => (
                    <button
                      type="button"
                      key={l.frota.numero}
                      onClick={() => setAberta(l.frota.numero)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] hover:border-brand ${l.duplicada ? 'border-bad/30 bg-bad-soft' : naOficina.has(l.frota.numero) ? 'border-[#F59E0B]/40 bg-[#FFF4E5]' : 'border-line bg-[#F8F7F3]'}`}
                      title={l.frota.descricao}
                    >
                      <b className="font-mono">{l.frota.numero}</b>
                      <SeloModalidade m={l.frota.modalidade} />
                      {naOficina.has(l.frota.numero) && <SeloOficina />}
                      {veValorFrota && <span className="text-ink-2">{l.frota.valor ? formatarReais(l.frota.valor) : 'sem valor'}</span>}
                      {l.frota.fim && <span className={`text-xs ${terminando(l.frota) ? 'font-semibold text-warn-strong' : 'text-ink-3'}`}>até {dataCurta(l.frota.fim)}</span>}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {porCliente.length === 0 && <div className="card px-4 py-6 text-ink-3">Nada encontrado{busca ? ` para “${busca}”` : ' com esse filtro'}.</div>}
        </section>
      )}

      {aberta && (
        <DetalheLocacao
          frota={aberta}
          linha={linhaAberta}
          oficina={naOficina.get(aberta) ?? null}
          veValor={veValorFrota}
          edita={editaFrotas}
          fechar={() => setAberta(null)}
          editarCliente={(c) => {
            setAberta(null);
            editar(c);
          }}
          tirarDaOficina={() => void tirarDaOficina(aberta)}
          colocarNaOficina={async (obs) => {
            try {
              definirOficina(await api.colocarNaOficina(aberta, obs));
              avisar(`FT${aberta} marcada como na oficina.`);
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
            }
          }}
        />
      )}
      {saiu && <DepoisDaOficina frota={saiu} cliente={linhas.find((l) => l.frota.numero === saiu)?.cliente ?? null} fechar={() => setSaiu(null)} />}

      <ClienteForm inicial={editando} fechar={() => setEditando(null)} />
      <RelatorioPdf aberto={relatorio} fechar={() => setRelatorio(false)} />
      <Oficina
        aberto={verOficina}
        fechar={() => setVerOficina(false)}
        lista={oficina}
        definir={definirOficina}
        clientes={clientes}
        avisar={avisar}
        podeEditar={editaFrotas}
        saiu={(f) => {
          setVerOficina(false);
          setSaiu(f);
        }}
      />
    </div>
  );
}

/** Tudo da locação de uma máquina, com as ações (oficina, movimentação, editar cliente). */
function DetalheLocacao({
  frota,
  linha,
  oficina,
  veValor,
  edita,
  fechar,
  editarCliente,
  tirarDaOficina,
  colocarNaOficina,
}: {
  frota: string;
  linha: Linha | null;
  oficina: FrotaOficina | null;
  veValor: boolean;
  edita: boolean;
  fechar: () => void;
  editarCliente: (c: Cliente) => void;
  tirarDaOficina: () => void;
  colocarNaOficina: (obs: string) => Promise<void>;
}) {
  const { pode } = useEstado();
  const registra = pode('movimentacoes', 2);
  const [obs, setObs] = useState('');
  const [marcando, setMarcando] = useState(false);
  const f = linha?.frota;
  const c = linha?.cliente;
  const item = (rot: string, v: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{rot}</dt>
      <dd className="text-[14px]">{v || <span className="text-ink-3">—</span>}</dd>
    </div>
  );
  const mov = (tipo: string) => `/movimentacoes?nova=${tipo}&frota=${encodeURIComponent(frota)}${c ? `&cliente=${c.id}` : ''}`;
  return (
    <Gaveta aberto fechar={fechar} titulo={`FT${frota}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {c ? <b className="text-[16px]">{c.nome}</b> : <span className="text-ink-3">Sem cliente</span>}
          <SeloModalidade m={f?.modalidade} />
          {oficina && <SeloOficina />}
        </div>
        {oficina && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#FFF4E5] px-3 py-2.5 text-[13.5px]">
            <span>
              Na oficina desde {dataHora(oficina.desde).slice(0, 10)}
              {oficina.observacao && ` · ${oficina.observacao}`}
              {oficina.usuario && <span className="text-ink-3"> · {oficina.usuario}</span>}
            </span>
            {edita && (
              <button type="button" className="btn-primary btn-sm" onClick={tirarDaOficina}>
                Tirar da oficina
              </button>
            )}
          </div>
        )}
        {f && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line p-4">
            {item('Máquina', f.descricao)}
            {item('Locação', f.modalidade === 'contrato' ? 'Contrato' : f.modalidade === 'esporadico' ? 'Esporádica' : '')}
            {item('Início', f.inicio ? dataBr(f.inicio) : '')}
            {item('Término', f.fim ? dataBr(f.fim) : 'sem término')}
            {item('Tempo de contrato', f.contrato)}
            {veValor && item('Valor por mês', f.valor ? formatarReais(f.valor) : 'sem valor')}
            {item('Frete', f.frete === 'lucminas' ? 'Por conta da Lucminas' : f.frete === 'cliente' ? `Por conta do cliente${f.freteValor ? ` · ${formatarReais(f.freteValor)}` : ''}` : '')}
            {item('Gás', f.gas ? `${f.gas} vasilhame${f.gas > 1 ? 's' : ''}` : '')}
            {c && item('Faturamento', `${descreverRegra(regraDoCliente(c))}${linha?.proxima ? ` · próxima ${dataCurta(linha.proxima)}` : ''}`)}
          </dl>
        )}
        {(registra || edita) && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">O que fazer com esta máquina</h3>
            <div className="flex flex-wrap gap-2">
              {registra && c && (
                <>
                  <Link className="btn-secondary btn-sm" to={mov('troca')}>
                    Troca
                  </Link>
                  <Link className="btn-secondary btn-sm" to={mov('devolucao')}>
                    Devolução
                  </Link>
                  <Link className="btn-secondary btn-sm" to={mov('reajuste')}>
                    Reajuste
                  </Link>
                </>
              )}
              {registra && !c && (
                <Link className="btn-secondary btn-sm" to={mov('locacao')}>
                  Nova locação
                </Link>
              )}
              {registra && (
                <Link className="btn-secondary btn-sm" to={mov('venda')}>
                  Venda
                </Link>
              )}
              <Link className="btn-secondary btn-sm" to={`/equipamentos?busca=${encodeURIComponent(frota)}`}>
                Ficha da máquina
              </Link>
              {edita && c && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => editarCliente(c)}>
                  Editar cliente
                </button>
              )}
            </div>
            {edita && !oficina && (
              marcando ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input className="input h-9 min-w-[200px] flex-1" autoFocus value={obs} onChange={(e) => setObs(e.target.value)} placeholder="O que foi fazer (opcional)" />
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={async () => {
                      await colocarNaOficina(obs.trim());
                      setMarcando(false);
                      setObs('');
                    }}
                  >
                    Colocar na oficina
                  </button>
                  <button type="button" className="btn btn-sm text-ink-3" onClick={() => setMarcando(false)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-secondary btn-sm self-start border-[#F59E0B]/50 bg-[#FFF4E5] text-[#B45309]" onClick={() => setMarcando(true)}>
                  Colocar na oficina
                </button>
              )
            )}
          </section>
        )}
      </div>
    </Gaveta>
  );
}

/** Saiu da oficina: já pergunta o que vai acontecer com a máquina e leva para a movimentação. */
function DepoisDaOficina({ frota, cliente, fechar }: { frota: string; cliente: Cliente | null; fechar: () => void }) {
  const { pode } = useEstado();
  const navegar = useNavigate();
  const registra = pode('movimentacoes', 2);
  const ir = (tipo: string) => {
    fechar();
    navegar(`/movimentacoes?nova=${tipo}&frota=${encodeURIComponent(frota)}${cliente ? `&cliente=${cliente.id}` : ''}`);
  };
  const opcao = (rot: string, dica: string, fazer: () => void, principal = false) => (
    <button type="button" onClick={fazer} className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left hover:border-brand hover:bg-brand-tint ${principal ? 'border-ink' : 'border-line-strong'}`}>
      <b className="text-[14.5px]">{rot}</b>
      <span className="text-[13px] text-ink-3">{dica}</span>
    </button>
  );
  return (
    <Modal aberto fechar={fechar} titulo={`FT${frota} saiu da oficina`}>
      <p className="text-[14px] text-ink-2">E agora, para onde vai a máquina?</p>
      <div className="grid gap-2">
        {cliente ? (
          <>
            {opcao(`Volta para ${cliente.nome}`, 'Continua com o mesmo cliente. Não precisa registrar nada.', fechar, true)}
            {registra && opcao('Troca', `Vai para ${cliente.nome} no lugar de outra máquina, ou outra vai no lugar dela`, () => ir('troca'))}
            {registra && opcao('Devolução', `Não volta para ${cliente.nome}: fica disponível`, () => ir('devolucao'))}
          </>
        ) : (
          <>
            {registra && opcao('Nova locação', 'Já vai para um cliente', () => ir('locacao'), true)}
            {opcao('Fica disponível', 'Sem cliente por enquanto. Não precisa registrar nada.', fechar)}
          </>
        )}
        {registra && opcao('Venda', 'A máquina vai ser vendida', () => ir('venda'))}
      </div>
    </Modal>
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
  podeEditar,
  saiu,
}: {
  podeEditar: boolean;
  /** depois de tirar da oficina: pergunta o que fazer com a máquina */
  saiu: (frota: string) => void;
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
      {podeEditar && (
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
      )}
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
              {podeEditar && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={ocupado}
                  onClick={() => void rodar(() => api.tirarDaOficina(o.frota), `FT${o.frota} saiu da oficina.`).then(() => saiu(o.frota))}
                >
                  Tirar da oficina
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RelatorioPdf({ aberto, fechar }: { aberto: boolean; fechar: () => void }) {
  const { clientes, oficina, veValores: ehFinanceiro, usuario, avisar } = useEstado();
  const [ref, setRef] = useState(referenciaAtual());
  const [gerando, setGerando] = useState(false);
  const [modelo, setModelo] = useState<ModeloRelatorio>('completo');
  const r = useMemo(() => (/^\d{4}-\d{2}$/.test(ref) ? montarRelatorio(clientes, oficina, ref) : null), [clientes, oficina, ref]);
  return (
    <Modal aberto={aberto} fechar={fechar} titulo="Relatório de locações ativas">
      <p className="text-[13px] text-ink-2">PDF com a logo da Lucminas e as locações ativas no mês escolhido.</p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold">Modelo</legend>
        {(
          [
            ['completo', 'Completo', 'por cliente, com equipamento, início, término, contrato, gás e frete; locações que terminam e oficina'],
            ['por_frota', 'Simplificado por frota', ehFinanceiro ? 'frota, cliente e valor da locação, em ordem de frota' : 'frota e cliente, em ordem de frota'],
            ['por_cliente', 'Simplificado por cliente', ehFinanceiro ? 'cliente, frotas e valor total da locação do cliente' : 'cliente e frotas'],
          ] as const
        ).map(([id, rotulo, dica]) => (
          <label
            key={id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13px] ${modelo === id ? 'border-ink bg-white' : 'border-line-strong bg-white/60'}`}
          >
            <input type="radio" name="modelo-relatorio" checked={modelo === id} onChange={() => setModelo(id)} className="mt-0.5 h-[18px] w-[18px] accent-ink" />
            <span>
              <b>{rotulo}</b>
              <span className="block text-xs text-ink-3">{dica}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex w-fit flex-col gap-1.5 text-[13px] font-semibold">
        Mês
        <input type="month" className="input w-auto" value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>
      {r && (
        <p className="text-[13px] text-ink-3">
          {r.resumo.frotas} frota{r.resumo.frotas === 1 ? '' : 's'} em {r.resumo.clientes} cliente{r.resumo.clientes === 1 ? '' : 's'}
          {r.resumo.terminando ? ` · ${r.resumo.terminando} terminando no mês` : ''}
          {r.resumo.naOficina ? ` · ${r.resumo.naOficina} na oficina` : ''}
          {ehFinanceiro ? ` · ${formatarReais(r.resumo.valorTotal)} por mês` : ''}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!r || gerando}
          onClick={async () => {
            if (!r) return;
            setGerando(true);
            try {
              await gerarPdfLocacoes(r, { comValores: ehFinanceiro, geradoPor: usuario?.chamar || usuario?.nome || '', modelo });
              fechar();
            } catch {
              avisar('Não foi possível gerar o PDF.', 'bad');
            } finally {
              setGerando(false);
            }
          }}
        >
          {gerando ? 'Gerando…' : 'Baixar PDF'}
        </button>
      </div>
    </Modal>
  );
}

/** Etiqueta da locação: contrato ou esporádica. */
export function SeloModalidade({ m }: { m?: Frota['modalidade'] }) {
  if (!m) return null;
  return m === 'contrato' ? (
    <span className="rounded-full bg-info-soft px-1.5 py-px font-sans text-[10.5px] font-bold uppercase tracking-wide text-info">Contrato</span>
  ) : (
    <span className="rounded-full bg-[#EDE9FE] px-1.5 py-px font-sans text-[10.5px] font-bold uppercase tracking-wide text-[#6D28D9]">Esporádico</span>
  );
}
