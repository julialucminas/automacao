import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Cliente, Faturamento } from '../types';
import { dataBr, datasNoIntervalo, descreverRegra, gradeDoMes, hojeIso, intervaloDoMes, regraDoCliente } from '../lib/calendario';
import { formatarReais } from '../lib/dinheiro';
import { chaveEmpresa } from '../lib/normalizar';
import { Cartao, Chip, Modal, type Tom } from '../components/ui';
import { IcBusca, IcCheck } from '../components/Icones';

type Status = 'faturado' | 'atrasado' | 'hoje' | 'a_faturar';
type Item = { cliente: Cliente; data: string; status: Status; marca?: Faturamento };
type Filtro = 'todos' | 'a_faturar' | 'faturado' | 'atrasado';

const STATUS: Record<Status, { rotulo: string; tom: Tom; chip: string }> = {
  faturado: { rotulo: 'Faturado', tom: 'ok', chip: 'bg-ok-soft text-ok border-ok/20' },
  atrasado: { rotulo: 'Atrasado', tom: 'bad', chip: 'bg-bad-soft text-bad-strong border-bad/20' },
  hoje: { rotulo: 'Faturar hoje', tom: 'warn', chip: 'bg-brand-soft text-ink border-brand' },
  a_faturar: { rotulo: 'A faturar', tom: 'neutro', chip: 'bg-white text-ink-2 border-line-strong' },
};

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const totalFrotas = (c: Cliente) => c.frotas.reduce((s, f) => s + f.valor, 0);

export function Calendario() {
  const { clientes, avisar } = useEstado();
  const hoje = hojeIso();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [marcas, setMarcas] = useState<Faturamento[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [visao, setVisao] = useState<'calendario' | 'lista'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'lista' : 'calendario'));
  const [aberto, setAberto] = useState<Item | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { de, ate } = intervaloDoMes(ano, mes);

  const carregar = useCallback(async () => {
    try {
      setMarcas(await api.listarFaturamentos(de, ate));
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível carregar o calendário.', 'bad');
    }
  }, [de, ate, avisar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const ativos = clientes.filter((c) => c.ativo);
  const semRegra = ativos.filter((c) => !regraDoCliente(c));

  const itens: Item[] = useMemo(() => {
    const porChave = new Map(marcas.map((m) => [`${m.clienteId}|${m.data}`, m]));
    const l: Item[] = [];
    for (const c of ativos) {
      const r = regraDoCliente(c);
      if (!r) continue;
      // só a partir do cadastro: o que veio antes foi faturado fora do sistema
      const desde = c.criadoEm ? hojeIso(new Date(c.criadoEm)) : '';
      for (const data of datasNoIntervalo(r, de, ate)) {
        if (data < desde) continue;
        const marca = porChave.get(`${c.id}|${data}`);
        const status: Status = marca ? 'faturado' : data < hoje ? 'atrasado' : data === hoje ? 'hoje' : 'a_faturar';
        l.push({ cliente: c, data, status, marca });
      }
    }
    return l.sort((a, b) => a.data.localeCompare(b.data) || a.cliente.nome.localeCompare(b.cliente.nome));
  }, [ativos, marcas, de, ate, hoje]);

  const q = chaveEmpresa(busca);
  const visiveis = itens.filter((i) => {
    if (filtro === 'faturado' && i.status !== 'faturado') return false;
    if (filtro === 'atrasado' && i.status !== 'atrasado') return false;
    if (filtro === 'a_faturar' && i.status === 'faturado') return false;
    if (q && !chaveEmpresa(i.cliente.nome).includes(q) && !i.cliente.frotas.some((f) => chaveEmpresa(f.numero).includes(q))) return false;
    return true;
  });

  const conta = (s: Status | 'pendente') => itens.filter((i) => (s === 'pendente' ? i.status !== 'faturado' : i.status === s)).length;
  const valorFaturado = itens.filter((i) => i.status === 'faturado').reduce((s, i) => s + totalFrotas(i.cliente), 0);
  const valorPrevisto = itens.reduce((s, i) => s + totalFrotas(i.cliente), 0);

  const mudarMes = (delta: number) => {
    let m = mes + delta;
    let a = ano;
    if (m < 1) {
      m = 12;
      a--;
    } else if (m > 12) {
      m = 1;
      a++;
    }
    setMes(m);
    setAno(a);
  };

  const alternar = async (i: Item) => {
    setSalvando(true);
    try {
      if (i.marca) await api.desmarcarFaturado(i.cliente.id, i.data);
      else await api.marcarFaturado(i.cliente.id, i.data);
      await carregar();
      avisar(i.marca ? `${i.cliente.nome}: marcação de faturado removida (${dataBr(i.data)}).` : `${i.cliente.nome} marcado como faturado (${dataBr(i.data)}).`);
      setAberto(null);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  const filtros: { id: Filtro; rotulo: string; n: number }[] = [
    { id: 'todos', rotulo: 'Todos', n: itens.length },
    { id: 'a_faturar', rotulo: 'A faturar', n: conta('pendente') },
    { id: 'faturado', rotulo: 'Faturados', n: conta('faturado') },
    { id: 'atrasado', rotulo: 'Atrasados', n: conta('atrasado') },
  ];

  const porDia = new Map<string, Item[]>();
  for (const i of visiveis) porDia.set(i.data, [...(porDia.get(i.data) ?? []), i]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Faturamento</div>
          <h1 className="mt-1 text-[26px] font-bold">Calendário de faturas</h1>
          <p className="text-[13px] text-ink-3">Cada cliente aparece no dia em que deve ser faturado, pela regra cadastrada (dia fixo ou período), a partir da data em que foi cadastrado no sistema.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary h-11 w-11 px-0" aria-label="Mês anterior" onClick={() => mudarMes(-1)}>
            ‹
          </button>
          <div className="min-w-[150px] text-center text-lg font-bold" aria-live="polite">
            {MESES[mes - 1]} {ano}
          </div>
          <button type="button" className="btn-secondary h-11 w-11 px-0" aria-label="Próximo mês" onClick={() => mudarMes(1)}>
            ›
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setAno(Number(hoje.slice(0, 4)));
              setMes(Number(hoje.slice(5, 7)));
            }}
          >
            Hoje
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Cartao rotulo="Faturas previstas no mês" valor={itens.length} />
        <Cartao rotulo="Já faturadas" valor={`${conta('faturado')} de ${itens.length}`} cor="text-ok" />
        <Cartao rotulo="Atrasadas" valor={conta('atrasado')} cor={conta('atrasado') ? 'text-bad' : ''} />
        <Cartao rotulo="Valor já faturado" valor={formatarReais(valorFaturado)} />
      </div>
      {valorPrevisto > 0 && <p className="-mt-3 mb-4 text-right text-xs text-ink-3">Previsto no mês: {formatarReais(valorPrevisto)} (soma das frotas de cada fatura)</p>}

      {semRegra.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] text-warn-strong">
          <span>
            {semRegra.length} cliente{semRegra.length > 1 ? 's' : ''} sem data de faturamento cadastrada não aparece{semRegra.length > 1 ? 'm' : ''} aqui.
          </span>
          <Link to="/clientes" className="font-semibold underline underline-offset-2">
            Completar cadastro
          </Link>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
          {filtros.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={`min-h-[40px] rounded-full border px-3.5 text-[13px] font-semibold ${
                filtro === f.id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2 hover:bg-canvas'
              }`}
            >
              {f.rotulo} ({f.n})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-[40px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
            <IcBusca />
            <span className="sr-only">Buscar cliente ou frota</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente ou frota" className="w-[160px] bg-transparent text-ink outline-none" />
          </label>
          <div className="flex rounded-[10px] border border-line-strong bg-white p-0.5" role="group" aria-label="Visualização">
            {(['calendario', 'lista'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visao === v}
                onClick={() => setVisao(v)}
                className={`min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ${visao === v ? 'bg-ink text-white' : 'text-ink-2'}`}
              >
                {v === 'calendario' ? 'Calendário' : 'Lista'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visao === 'calendario' ? (
        <section aria-label={`Calendário de ${MESES[mes - 1]}`} className="card overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-line bg-[#F8F7F3] text-xs font-semibold text-ink-3">
              {SEMANA.map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            {gradeDoMes(ano, mes).map((semana, k) => (
              <div key={k} className="grid grid-cols-7 border-b border-line-soft last:border-b-0">
                {semana.map((dia, j) => {
                  const lista = dia ? porDia.get(dia) ?? [] : [];
                  return (
                    <div key={j} className={`min-h-[112px] border-r border-line-soft p-1.5 last:border-r-0 ${dia ? '' : 'bg-[#FAFAF7]'} ${dia === hoje ? 'bg-brand-tint' : ''}`}>
                      {dia && (
                        <>
                          <div className={`mb-1 text-xs font-semibold ${dia === hoje ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-ink' : 'text-ink-3'}`}>
                            {Number(dia.slice(8))}
                          </div>
                          <div className="flex flex-col gap-1">
                            {lista.map((i) => (
                              <button
                                key={i.cliente.id}
                                type="button"
                                onClick={() => setAberto(i)}
                                title={`${i.cliente.nome} · ${STATUS[i.status].rotulo}`}
                                className={`flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-1 text-left text-[11.5px] font-medium ${STATUS[i.status].chip}`}
                              >
                                {i.status === 'faturado' && <IcCheck tamanho={11} className="shrink-0" />}
                                <span className="truncate">{i.cliente.nome}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section aria-label="Lista de faturas do mês" className="card overflow-hidden">
          {visiveis.length === 0 && <div className="px-4 py-6 text-ink-3">Nenhuma fatura neste filtro.</div>}
          {visiveis.map((i) => (
            <div key={`${i.cliente.id}|${i.data}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3 text-[13px] last:border-b-0">
              <div className="w-[64px] font-mono font-semibold">{i.data.slice(8, 10)}/{i.data.slice(5, 7)}</div>
              <div className="min-w-[180px] flex-1">
                <div className="font-semibold">{i.cliente.nome}</div>
                <div className="text-xs text-ink-3">
                  {descreverRegra(regraDoCliente(i.cliente))}
                  {i.cliente.frotas.length > 0 && ` · ${i.cliente.frotas.map((f) => f.numero).join(', ')}`}
                </div>
              </div>
              <div className="w-[110px] text-right font-semibold">{i.cliente.frotas.length ? formatarReais(totalFrotas(i.cliente)) : '—'}</div>
              <div className="w-[120px]">
                <Chip tom={STATUS[i.status].tom}>{STATUS[i.status].rotulo}</Chip>
              </div>
              <button type="button" disabled={salvando} onClick={() => alternar(i)} className={i.marca ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>
                {i.marca ? 'Desmarcar' : 'Marcar faturado'}
              </button>
            </div>
          ))}
        </section>
      )}

      <Modal aberto={!!aberto} fechar={() => setAberto(null)} titulo={aberto?.cliente.nome ?? ''}>
        {aberto && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tom={STATUS[aberto.status].tom}>{STATUS[aberto.status].rotulo}</Chip>
              <span className="text-ink-2">Fatura prevista para {dataBr(aberto.data)}</span>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-ink-3">Regra</dt>
              <dd>{descreverRegra(regraDoCliente(aberto.cliente))}</dd>
              <dt className="text-ink-3">Frotas</dt>
              <dd>
                {aberto.cliente.frotas.length
                  ? aberto.cliente.frotas.map((f) => (
                      <div key={f.numero}>
                        {f.numero} · {formatarReais(f.valor)}
                        {f.descricao && <span className="text-ink-3"> · {f.descricao}</span>}
                      </div>
                    ))
                  : '—'}
              </dd>
              {aberto.cliente.frotas.length > 1 && (
                <>
                  <dt className="text-ink-3">Total</dt>
                  <dd className="font-semibold">{formatarReais(totalFrotas(aberto.cliente))}</dd>
                </>
              )}
              <dt className="text-ink-3">Para</dt>
              <dd className="[overflow-wrap:anywhere]">{aberto.cliente.para.join(', ')}</dd>
              {aberto.marca && (
                <>
                  <dt className="text-ink-3">Marcado</dt>
                  <dd>
                    {new Date(aberto.marca.marcadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    {aberto.marca.marcadoPor && ` por ${aberto.marca.marcadoPor}`}
                    {aberto.marca.origem === 'envio' && ' (pelo envio do sistema)'}
                  </dd>
                </>
              )}
            </dl>
            {aberto.cliente.observacoes && <p className="rounded-[10px] bg-canvas px-3 py-2 text-[13px]">{aberto.cliente.observacoes}</p>}
            <div className="flex flex-wrap justify-end gap-2.5">
              <button type="button" className="btn-secondary" onClick={() => setAberto(null)}>
                Fechar
              </button>
              <button type="button" className={aberto.marca ? 'btn-secondary' : 'btn-primary'} disabled={salvando} onClick={() => alternar(aberto)}>
                {aberto.marca ? 'Desmarcar faturado' : 'Marcar como faturado'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
