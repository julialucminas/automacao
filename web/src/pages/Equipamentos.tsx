import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import { SeloHelbert } from '../components/Balao';
import type { DadosEquipamento, Equipamento, Movimentacao, PecaHistorico, RegraPeriferico } from '../types';
import { urlNfe } from '../components/NfeAnexo';
import { regrasDe, situacaoPerifericos } from '../lib/manutencao';
import { COMBUSTIVEIS, SITUACOES, TIPOS_VISITA, horasParaPreventiva, montarEquipamentos, nomeEquipamento, type LinhaEquipamento, type Situacao } from '../lib/equipamentos';
import { chaveEmpresa, semAcento } from '../lib/normalizar';
import { dataBr, hojeIso } from '../lib/calendario';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { useBuscaDaUrl } from '../lib/buscaDaUrl';
import { Chip, Gaveta } from '../components/ui';
import { IcBusca, IcUpload } from '../components/Icones';
import { ImportarQuadro } from '../components/ImportarQuadro';

const num = (n: number | null | undefined, casas = 0) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas }));

export function Equipamentos() {
  const { clientes, oficina, pode, veValores } = useEstado();
  const edita = pode('frotas', 2);
  const [fichas, setFichas] = useState<Equipamento[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  useBuscaDaUrl(setBusca);
  const [filtro, setFiltro] = useState<Situacao | 'todas'>('todas');
  const [aberta, setAberta] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      setFichas(await api.listarEquipamentos());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const linhas = useMemo(() => montarEquipamentos(fichas ?? [], clientes, oficina), [fichas, clientes, oficina]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of linhas) c[l.situacao] = (c[l.situacao] ?? 0) + 1;
    return c;
  }, [linhas]);
  const q = semAcento(busca).toUpperCase().trim();
  const qFrota = q.replace(/^(FROTA|FT)[\s-]*/, '');
  const lista = linhas.filter((l) => {
    if (filtro !== 'todas' && l.situacao !== filtro) return false;
    if (!q) return true;
    if (l.frota === qFrota) return true;
    const alvo = semAcento(
      `FT${l.frota} ${nomeEquipamento(l)} ${l.ficha?.descricao ?? ''} ${l.ficha?.serie ?? ''} ${l.ficha?.tecnico ?? ''} ${l.cliente?.nome ?? ''}`,
    ).toUpperCase();
    return q.split(/\s+/).every((p) => alvo.includes(p)) || (!!l.cliente && chaveEmpresa(l.cliente.nome).includes(chaveEmpresa(busca)));
  });
  // quem digitou o número exato da frota quer ela primeiro
  if (qFrota) lista.sort((a, b) => Number(b.frota === qFrota) - Number(a.frota === qFrota));
  const linhaAberta = linhas.find((l) => l.frota === aberta) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Frota</div>
          <h1 className="mt-1 text-[26px] font-bold">Equipamentos</h1>
          <p className="text-[13px] text-ink-3">A ficha de cada máquina: dados, uso, contrato e o histórico de peças e serviços.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <span className="sr-only">Buscar equipamento</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <IcBusca tamanho={15} />
            </span>
            <input type="search" className="input w-[260px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota, marca, série, cliente…" />
          </label>
          {edita && (
            <button type="button" className="btn-secondary" onClick={() => setImportando(true)}>
              <IcUpload tamanho={16} /> Importar planilha
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
        {(['todas', 'locada', 'oficina', 'disponivel', 'reservada', 'baixada'] as const).map((s) => {
          const n = s === 'todas' ? linhas.length : (contagem[s] ?? 0);
          if (s !== 'todas' && !n) return null;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={filtro === s}
              onClick={() => setFiltro(s)}
              className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-semibold ${filtro === s ? 'border-noite bg-noite text-white' : 'border-line-strong bg-white text-ink-2 hover:bg-line-soft'}`}
            >
              {s === 'todas' ? 'Todas' : SITUACOES[s].rotulo} · {n}
            </button>
          );
        })}
      </div>

      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {fichas && fichas.length === 0 && edita && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-brand bg-brand-soft px-4 py-3 text-[14px]">
          <span>
            <b>As fichas ainda estão vazias.</b> Importe a planilha Quadro Geral Manutenção para preencher marca, modelo, série, horímetro, contratos e o histórico do Auvo de uma
            vez.
          </span>
          <button type="button" className="btn-primary btn-sm" onClick={() => setImportando(true)}>
            Importar agora
          </button>
        </div>
      )}

      {!fichas && !erro ? (
        <p className="text-ink-3">Carregando…</p>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[860px] text-[14px]">
            <thead>
              <tr className="border-b border-line bg-[#F8F7F3] text-left text-xs text-ink-3">
                <th className="px-4 py-2 font-semibold">Frota</th>
                <th className="px-4 py-2 font-semibold">Equipamento</th>
                <th className="px-4 py-2 font-semibold">Situação</th>
                <th className="px-4 py-2 font-semibold">Cliente</th>
                <th className="px-4 py-2 text-right font-semibold">Horímetro</th>
                <th className="px-4 py-2 font-semibold">Técnico</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.frota} className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-brand-tint" onClick={() => setAberta(l.frota)}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="font-mono text-[15px] font-bold hover:underline" onClick={() => setAberta(l.frota)}>
                      FT{l.frota}
                    </button>{' '}
                    <SeloHelbert ativo={l.ficha?.helbert} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{nomeEquipamento(l) || <span className="text-ink-3">sem ficha</span>}</span>
                    {l.ficha?.serie && <span className="block text-xs text-ink-3">série {l.ficha.serie}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      <Chip tom={SITUACOES[l.situacao].tom}>{SITUACOES[l.situacao].rotulo}</Chip>
                      {l.contratoVencido && <Chip tom="bad">contrato vencido</Chip>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{l.cliente?.nome ?? <span className="text-ink-3">—</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    {num(l.ficha?.horimetro)}
                    {l.ficha?.horimetroEm && <span className="block text-xs text-ink-3">{dataBr(l.ficha.horimetroEm)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{l.ficha?.tecnico ?? '—'}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-ink-3">
                    Nada encontrado{busca ? ` para “${busca}”` : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <Ficha
        linha={linhaAberta}
        fechar={() => setAberta(null)}
        edita={edita}
        veValores={veValores}
        salvo={(e) => setFichas((l) => (l ? [...l.filter((x) => x.frota !== e.frota), e] : [e]))}
      />
      <ImportarQuadro aberto={importando} fechar={() => setImportando(false)} terminou={() => void recarregar()} />
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">{titulo}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line p-3.5 sm:grid-cols-3">{children}</dl>
    </section>
  );
}
function LinkNfe({ m }: { m: Movimentacao }) {
  return (
    <a href={urlNfe(m)} target="_blank" rel="noopener" className="font-semibold text-info underline">
      Abrir {m.dados.nfArquivo?.ext.toUpperCase()}
    </a>
  );
}

function Item({ rotulo, children, largo }: { rotulo: string; children: ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? 'col-span-2 sm:col-span-3' : ''}>
      <dt className="text-xs text-ink-3">{rotulo}</dt>
      <dd className="text-[14px] font-medium">{children === null || children === undefined || children === '' ? <span className="text-ink-3">—</span> : children}</dd>
    </div>
  );
}

export function Ficha({
  linha,
  fechar,
  edita,
  veValores,
  salvo,
  acoes,
  extra,
}: {
  /** botões a mais no topo (ex.: Registrar visita, no painel) */
  acoes?: ReactNode;
  /** blocos a mais antes do histórico (ex.: pendências, no painel) */
  extra?: ReactNode;
  linha: LinhaEquipamento | null;
  fechar: () => void;
  edita: boolean;
  veValores: boolean;
  salvo: (e: Equipamento) => void;
}) {
  const [editando, setEditando] = useState(false);
  const { config, movimentacoes } = useEstado();
  useEffect(() => setEditando(false), [linha?.frota]);
  // NF-e anexada na movimentação de compra/venda desta frota (a mais recente aprovada)
  const nfeDe = (tipo: 'compra' | 'venda') => movimentacoes.find((m) => m.tipo === tipo && m.status === 'aprovada' && m.frota === linha?.frota && m.dados.nfArquivo);
  if (!linha) return <Gaveta aberto={false} fechar={fechar} titulo="" largo children={null} />;
  const f = linha.ficha ?? ({} as Partial<Equipamento>);
  const faltam = horasParaPreventiva(linha.ficha);
  const titulo = `FT${linha.frota}${nomeEquipamento(linha) ? ` · ${nomeEquipamento(linha)}` : ''}`;

  return (
    <Gaveta aberto fechar={fechar} titulo={titulo} largo>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1.5">
          <Chip tom={SITUACOES[linha.situacao].tom}>{SITUACOES[linha.situacao].rotulo}</Chip>
          <SeloHelbert ativo={f.helbert} />
          {linha.cliente && <Chip tom="neutro">{linha.cliente.nome}</Chip>}
          {linha.oficina?.observacao && <Chip tom="warn">{linha.oficina.observacao}</Chip>}
          {linha.contratoVencido && <Chip tom="bad">contrato vencido</Chip>}
        </span>
        <span className="flex flex-wrap gap-2">
          {!editando && acoes}
          {edita && !editando && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(true)}>
              Editar ficha
            </button>
          )}
        </span>
      </div>

      {editando ? (
        <FormFicha
          frota={linha.frota}
          inicial={f}
          veValores={veValores}
          cancelar={() => setEditando(false)}
          salvo={(e) => {
            salvo(e);
            setEditando(false);
          }}
        />
      ) : (
        <>
          <Bloco titulo="Identificação">
            <Item rotulo="Marca">{f.marca}</Item>
            <Item rotulo="Modelo">{f.modelo}</Item>
            <Item rotulo="Nº de série">{f.serie && <span className="font-mono">{f.serie}</span>}</Item>
            <Item rotulo="Ano de fabricação">{f.ano}</Item>
            <Item rotulo="Descrição" largo>
              {f.descricao}
            </Item>
          </Bloco>
          <Bloco titulo="Características">
            <Item rotulo="Tipo">{f.combustivel ? (COMBUSTIVEIS[f.combustivel] ?? f.combustivel) : null}</Item>
            <Item rotulo="Capacidade">{f.capacidade ? `${num(f.capacidade)} kg` : null}</Item>
            <Item rotulo="Torre / elevação">{f.torre}</Item>
            <Item rotulo="Acessórios" largo>
              {f.acessorios}
            </Item>
          </Bloco>
          <Bloco titulo="Uso e manutenção">
            <Item rotulo="Horímetro">{f.horimetro != null ? `${num(f.horimetro)} h${f.horimetroEm ? ` em ${dataBr(f.horimetroEm)}` : ''}` : null}</Item>
            <Item rotulo="Média de uso">{f.mediaDia != null ? `${num(f.mediaDia, 1)} h por dia` : null}</Item>
            <Item rotulo="Técnico responsável">{f.tecnico}</Item>
            <Item rotulo="Tipo de visita">{f.tipoVisita ? `${TIPOS_VISITA[f.tipoVisita] ?? f.tipoVisita} (${f.tipoVisita})` : null}</Item>
            <Item rotulo="Última visita">{f.ultimaVisita ? `${dataBr(f.ultimaVisita)}${f.intervaloVisitaDias ? ` · a cada ${f.intervaloVisitaDias} dias` : ''}` : null}</Item>
            <Item rotulo="Próxima preventiva">
              {f.proximaPreventiva != null ? (
                <>
                  {num(f.proximaPreventiva)} h
                  {faltam !== null && (
                    <span className={faltam < 0 ? 'font-bold text-bad' : 'text-ink-3'}> · {faltam < 0 ? `passou ${num(-faltam)} h` : `faltam ${num(faltam)} h`}</span>
                  )}
                </>
              ) : null}
            </Item>
            <Item rotulo="Região">{f.regiao}</Item>
          </Bloco>
          <Bloco titulo="Locação atual">
            <Item rotulo="Cliente">{linha.cliente?.nome}</Item>
            <Item rotulo="Início">{linha.locacao?.inicio ? dataBr(linha.locacao.inicio) : null}</Item>
            <Item rotulo="Término">{linha.locacao?.fim ? dataBr(linha.locacao.fim) : null}</Item>
            {linha.locacao && linha.locacao.valor > 0 && <Item rotulo="Valor mensal">{formatarReais(linha.locacao.valor)}</Item>}
            <Item rotulo="Nº do contrato">{f.contratoNumero}</Item>
            <Item rotulo="Vencimento do contrato">
              {f.contratoVencimento ? <span className={linha.contratoVencido ? 'font-bold text-bad' : ''}>{dataBr(f.contratoVencimento)}</span> : null}
            </Item>
            {veValores && <Item rotulo="Valor no contrato">{f.contratoValor ? formatarReais(f.contratoValor) : null}</Item>}
            {veValores && f.contratoReajuste ? <Item rotulo="Reajuste pedido">{formatarReais(f.contratoReajuste)}</Item> : null}
            <Item rotulo="Observação do contrato" largo>
              {f.contratoObs}
            </Item>
          </Bloco>
          {veValores && (
            <Bloco titulo="Compra">
              <Item rotulo="Valor de compra">{f.compraValor ? formatarReais(f.compraValor) : null}</Item>
              <Item rotulo="Data">{f.compraData ? dataBr(f.compraData) : null}</Item>
              <Item rotulo="Nota fiscal">{f.compraNf}</Item>
              {nfeDe('compra') && <Item rotulo="NF-e"><LinkNfe m={nfeDe('compra')!} /></Item>}
              <Item rotulo="Fornecedor" largo>
                {f.fornecedor}
              </Item>
            </Bloco>
          )}
          {f.vendaData && (
            <Bloco titulo="Venda">
              <Item rotulo="Data">{dataBr(f.vendaData)}</Item>
              <Item rotulo="Comprador">{f.vendaComprador}</Item>
              {veValores && <Item rotulo="Valor da venda">{f.vendaValor ? formatarReais(f.vendaValor) : null}</Item>}
              {veValores && <Item rotulo="Nota fiscal">{f.vendaNf}</Item>}
              {veValores && nfeDe('venda') && <Item rotulo="NF-e"><LinkNfe m={nfeDe('venda')!} /></Item>}
            </Bloco>
          )}
          {(f.observacoes || f.situacaoMotivo) && (
            <Bloco titulo="Observações">
              <Item rotulo={f.situacao ? `Motivo (${SITUACOES[f.situacao as Situacao]?.rotulo ?? f.situacao})` : 'Observações'} largo>
                {f.situacaoMotivo || f.observacoes}
              </Item>
              {f.situacaoMotivo && f.observacoes && (
                <Item rotulo="Observações" largo>
                  {f.observacoes}
                </Item>
              )}
            </Bloco>
          )}
          <Perifericos ficha={linha.ficha} regras={regrasDe(config).perifericos} />
          {extra}
          <HistoricoPecas frota={linha.frota} veValores={veValores} />
          {linha.ficha?.atualizadoEm && (
            <p className="text-xs text-ink-3">
              Ficha atualizada em {new Date(linha.ficha.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              {linha.ficha.atualizadoPor && ` por ${linha.ficha.atualizadoPor}`}
            </p>
          )}
        </>
      )}
    </Gaveta>
  );
}

function Perifericos({ ficha, regras }: { ficha: Equipamento | null; regras: RegraPeriferico[] }) {
  const lista = situacaoPerifericos(ficha, regras, hojeIso());
  const naoAplica = (ficha?.perifericosNaoAplica ?? '')
    .split(',')
    .map((x) => regras.find((r) => r.id === x.trim())?.nome)
    .filter(Boolean);
  if (!lista.length && !naoAplica.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Periféricos</h3>
      <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line">
        {lista.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[13px]">
            <span>
              <b>{p.nome}</b>
              <span className="text-ink-3">
                {' '}
                · trocado em {p.ultima ? dataBr(p.ultima) : '—'}
                {ficha?.[`${p.id}Horimetro`] != null && ` com ${num(ficha[`${p.id}Horimetro`])} h`}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-ink-2">próxima {p.proxima}</span>
              {p.vencido ? <Chip tom="bad">vencido</Chip> : p.atencao ? <Chip tom="warn">vence logo</Chip> : <Chip tom="ok">ok</Chip>}
            </span>
          </li>
        ))}
      </ul>
      {naoAplica.length > 0 && <p className="text-xs text-ink-3">Não se aplica nesta máquina: {naoAplica.join(', ')}.</p>}
    </section>
  );
}

function HistoricoPecas({ frota, veValores }: { frota: string; veValores: boolean }) {
  const [itens, setItens] = useState<PecaHistorico[] | null>(null);
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState(100);
  useEffect(() => {
    setMostrar(100);
    setItens(null);
    api.historicoDaFrota(frota).then(setItens, () => setItens([]));
  }, [frota]);
  const ps = semAcento(busca).toUpperCase().split(/\s+/).filter(Boolean);
  const lista = (itens ?? []).filter((p) => {
    const alvo = semAcento(`${p.descricao} ${p.codigo} ${p.pendencia} ${p.tecnico} ${p.cliente}`).toUpperCase();
    return ps.every((x) => alvo.includes(x));
  });
  const total = lista.reduce((s, p) => s + p.valorTotal, 0);
  const visitas = new Set(lista.map((p) => p.data)).size;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Histórico de peças e serviços</h3>
        <label className="relative">
          <span className="sr-only">Buscar no histórico</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={14} />
          </span>
          <input type="search" className="input h-9 w-[240px] pl-8 text-[13px]" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: motor de partida" />
        </label>
      </div>
      {itens === null ? (
        <p className="text-[13px] text-ink-3">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="rounded-xl border border-line p-3.5 text-[13px] text-ink-3">Nenhum lançamento para esta frota ainda.</p>
      ) : (
        <>
          <p className="text-[13px] text-ink-2">
            {lista.length} lançamento{lista.length === 1 ? '' : 's'} em {visitas} dia{visitas === 1 ? '' : 's'}
            {veValores && total > 0 && (
              <>
                {' · '}
                <b>{formatarReais(total)}</b>
              </>
            )}
            {busca && ` · com “${busca}”`}
          </p>
          <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line">
            {lista.slice(0, mostrar).map((p) => (
              <li key={p.id} className="grid grid-cols-[84px_1fr_auto] gap-x-3 px-3.5 py-2 text-[13px]">
                <span className="text-ink-3">{dataBr(p.data)}</span>
                <span>
                  <span className="font-semibold">{p.descricao || p.codigo || '—'}</span>
                  {p.quantidade !== 1 && <span className="text-ink-3"> × {num(p.quantidade, 2)}</span>}
                  <span className="block text-xs text-ink-3">
                    {[p.tecnico, p.cliente, p.horimetro ? `${num(p.horimetro)} h` : null].filter(Boolean).join(' · ')}
                    {p.pendencia && <span className="text-warn"> · pendência: {p.pendencia}</span>}
                  </span>
                </span>
                {veValores && <span className="text-right font-semibold">{p.valorTotal ? formatarReais(p.valorTotal) : ''}</span>}
              </li>
            ))}
          </ul>
          {lista.length > mostrar && (
            <button type="button" className="btn-secondary btn-sm self-center" onClick={() => setMostrar(mostrar + 200)}>
              Mostrar mais ({lista.length - mostrar} restantes)
            </button>
          )}
        </>
      )}
    </section>
  );
}

type Campo = { k: keyof DadosEquipamento; rotulo: string; tipo?: 'numero' | 'data' | 'dinheiro' | 'texto-longo'; opcoes?: Record<string, string>; valor?: boolean };
const GRUPOS_FORM: { titulo: string; campos: Campo[] }[] = [
  {
    titulo: 'Identificação',
    campos: [
      { k: 'marca', rotulo: 'Marca' },
      { k: 'modelo', rotulo: 'Modelo' },
      { k: 'serie', rotulo: 'Nº de série' },
      { k: 'ano', rotulo: 'Ano de fabricação', tipo: 'numero' },
      { k: 'descricao', rotulo: 'Descrição' },
    ],
  },
  {
    titulo: 'Características',
    campos: [
      { k: 'combustivel', rotulo: 'Tipo', opcoes: COMBUSTIVEIS },
      { k: 'capacidade', rotulo: 'Capacidade (kg)', tipo: 'numero' },
      { k: 'torre', rotulo: 'Torre / elevação' },
      { k: 'acessorios', rotulo: 'Acessórios' },
    ],
  },
  {
    titulo: 'Situação',
    campos: [
      { k: 'situacao', rotulo: 'Situação guardada', opcoes: { reservada: 'Reservada', baixada: 'Vendida / baixada' } },
      { k: 'situacaoMotivo', rotulo: 'Motivo' },
      { k: 'helbert', rotulo: 'Etiqueta Helbert (dividida com o irmão)', opcoes: { sim: 'Sim, é Helbert' } },
    ],
  },
  {
    titulo: 'Uso e manutenção',
    campos: [
      { k: 'horimetro', rotulo: 'Horímetro (h)', tipo: 'numero' },
      { k: 'horimetroEm', rotulo: 'Lido em', tipo: 'data' },
      { k: 'mediaDia', rotulo: 'Média de horas por dia', tipo: 'numero' },
      { k: 'tecnico', rotulo: 'Técnico responsável' },
      { k: 'tipoVisita', rotulo: 'Tipo de visita', opcoes: { CF: 'CF · Conferência', CR: 'CR · Corretiva', B: 'B · Preventiva', C: 'C · Preventiva', D: 'D · Preventiva' } },
      { k: 'ultimaVisita', rotulo: 'Última visita', tipo: 'data' },
      { k: 'intervaloVisitaDias', rotulo: 'Visita a cada (dias)', tipo: 'numero' },
      { k: 'proximaPreventiva', rotulo: 'Próxima preventiva (h)', tipo: 'numero' },
      { k: 'regiao', rotulo: 'Região' },
    ],
  },
  {
    titulo: 'Contrato da locação',
    campos: [
      { k: 'contratoNumero', rotulo: 'Nº do contrato' },
      { k: 'contratoVencimento', rotulo: 'Vencimento', tipo: 'data' },
      { k: 'contratoValor', rotulo: 'Valor no contrato', tipo: 'dinheiro', valor: true },
      { k: 'contratoReajuste', rotulo: 'Reajuste pedido', tipo: 'dinheiro', valor: true },
      { k: 'contratoObs', rotulo: 'Observação' },
    ],
  },
  {
    titulo: 'Compra',
    campos: [
      { k: 'compraValor', rotulo: 'Valor de compra', tipo: 'dinheiro', valor: true },
      { k: 'compraData', rotulo: 'Data', tipo: 'data', valor: true },
      { k: 'compraNf', rotulo: 'Nota fiscal', valor: true },
      { k: 'fornecedor', rotulo: 'Fornecedor', valor: true },
    ],
  },
  {
    titulo: 'Venda',
    campos: [
      { k: 'vendaData', rotulo: 'Data', tipo: 'data' },
      { k: 'vendaComprador', rotulo: 'Comprador' },
      { k: 'vendaValor', rotulo: 'Valor da venda', tipo: 'dinheiro', valor: true },
      { k: 'vendaNf', rotulo: 'Nota fiscal', valor: true },
    ],
  },
  { titulo: 'Observações', campos: [{ k: 'observacoes', rotulo: 'Observações', tipo: 'texto-longo' }] },
];

function FormFicha({
  frota,
  inicial,
  veValores,
  cancelar,
  salvo,
}: {
  frota: string;
  inicial: Partial<Equipamento>;
  veValores: boolean;
  cancelar: () => void;
  salvo: (e: Equipamento) => void;
}) {
  const { avisar } = useEstado();
  // tudo vira texto no formulário; na hora de salvar volta para número, data ou centavos
  const [v, setV] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const g of GRUPOS_FORM)
      for (const c of g.campos) {
        const x = inicial[c.k];
        r[c.k] = x == null ? '' : c.tipo === 'dinheiro' ? reaisParaCampo(Number(x)) : String(x).replace('.', c.tipo === 'numero' ? ',' : '.');
      }
    return r;
  });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setErro('');
    const dados: DadosEquipamento = {};
    for (const g of GRUPOS_FORM)
      for (const c of g.campos) {
        if (c.valor && !veValores) continue;
        const s = (v[c.k] ?? '').trim();
        let x: string | number | null = s || null;
        if (s && c.tipo === 'numero') {
          const n = Number(s.replace(/\./g, '').replace(',', '.'));
          if (!Number.isFinite(n) || n < 0) return setErro(`${c.rotulo}: número inválido.`);
          x = n;
        }
        if (s && c.tipo === 'dinheiro') {
          const n = lerReais(s);
          if (n === null) return setErro(`${c.rotulo}: valor inválido.`);
          x = n;
        }
        (dados as Record<string, unknown>)[c.k] = x;
      }
    setSalvando(true);
    try {
      const e = await api.salvarEquipamento(frota, dados);
      avisar(`Ficha da FT${frota} salva.`);
      salvo(e);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {GRUPOS_FORM.map((g) => {
        const campos = g.campos.filter((c) => !c.valor || veValores);
        if (!campos.length) return null;
        return (
          <fieldset key={g.titulo} className="flex flex-col gap-2">
            <legend className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">{g.titulo}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {campos.map((c) => (
                <label key={c.k} className={`flex flex-col gap-1 text-xs font-semibold ${c.tipo === 'texto-longo' ? 'sm:col-span-3' : ''}`}>
                  {c.rotulo}
                  {c.opcoes ? (
                    <select className="input" value={v[c.k]} onChange={(e) => setV({ ...v, [c.k]: e.target.value })}>
                      <option value="">{c.k === 'situacao' ? 'Normal (locada / disponível / oficina)' : '—'}</option>
                      {Object.entries(c.opcoes).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : c.tipo === 'texto-longo' ? (
                    <textarea rows={3} className="input py-2 text-[14px] font-normal" value={v[c.k]} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />
                  ) : (
                    <input
                      className="input font-normal"
                      type={c.tipo === 'data' ? 'date' : 'text'}
                      inputMode={c.tipo === 'numero' || c.tipo === 'dinheiro' ? 'decimal' : undefined}
                      value={v[c.k]}
                      onChange={(e) => setV({ ...v, [c.k]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="sticky -mx-6 -mb-[max(2rem,env(safe-area-inset-bottom))] bottom-[calc(-1*max(2rem,env(safe-area-inset-bottom)))] flex justify-end gap-2.5 border-t border-line bg-white px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button type="button" className="btn-secondary" onClick={cancelar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : 'Salvar ficha'}
        </button>
      </div>
    </div>
  );
}
