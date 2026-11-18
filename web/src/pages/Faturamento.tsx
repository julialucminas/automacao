import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEstado } from '../state';
import { api } from '../api';
import type { AjusteFaturamento, Equipamento, Faturamento as FaturamentoTipo } from '../types';
import { montarFaturamento, ROTULO_TIPO, type LinhaFaturamento } from '../lib/relacaoFaturamento';
import { situacaoFaturas, ROTULO_FATURA, type EstadoFatura } from '../lib/faturado';
import { dataCurta, diasNoMes } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { somarMeses } from '../lib/movimentacao';
import { liberacaoFaturar } from '../lib/etiquetas';
import { LancarFatura } from '../components/LancarFatura';
import { SeloPodeFaturar } from '../components/AvisoDevolucao';
import { Chip, type Tom } from '../components/ui';

type Filtro = 'todas' | EstadoFatura | 'movimento' | 'podeFaturar' | 'esporadico';

const TOM_ESTADO: Record<EstadoFatura, Tom> = { faturado: 'ok', devolvido: 'warn', pendente: 'neutro' };
const TOM_TIPO: Record<LinhaFaturamento['tipo'], string> = {
  mes: 'text-ink-3',
  entrou: 'text-info font-semibold',
  devolvida: 'text-warn-strong font-semibold',
  vendida: 'text-warn-strong font-semibold',
};
const ICONE_TIPO: Record<LinhaFaturamento['tipo'], string> = { mes: '', entrou: '➜ ', devolvida: '↩ ', vendida: '$ ' };
const mesSeguinte = (am: string, n: number) => somarMeses(`${am}-01`, n).slice(0, 7);
const fimDoMes = (am: string) => `${am}-${String(diasNoMes(Number(am.slice(0, 4)), Number(am.slice(5, 7)))).padStart(2, '0')}`;

/**
 * Faturamento do mês (financeiro): o que cobrar de cada cliente, locação por locação,
 * incluindo as máquinas que já voltaram (a Relação das locações mostra só onde cada máquina está agora).
 */
export function Faturamento() {
  const { clientes, movimentacoes, envios, avisar } = useEstado();
  const [params, setParams] = useSearchParams();
  const atual = referenciaAtual();
  const [mes, setMes] = useState(atual);
  const [filtro, setFiltro] = useState<Filtro>(() => (params.get('f') === 'podeFaturar' ? 'podeFaturar' : 'todas'));
  useEffect(() => {
    if (params.has('f')) setParams({}, { replace: true });
  }, [params, setParams]);
  const [busca, setBusca] = useState('');
  const [faturamentos, setFaturamentos] = useState<FaturamentoTipo[]>([]);
  const [ajustes, setAjustes] = useState<Map<string, AjusteFaturamento>>(new Map());
  const [fichas, setFichas] = useState<Map<string, Equipamento>>(new Map());
  const [editando, setEditando] = useState<string | null>(null);
  const [lancando, setLancando] = useState<{ clienteId?: string } | null>(null);

  // faturas lançadas do mês e dos dois seguintes (a devolução deste mês pode ser cobrada na fatura do próximo)
  useEffect(() => {
    api.listarFaturamentos(`${mes}-01`, fimDoMes(mesSeguinte(mes, 2))).then(setFaturamentos, () => setFaturamentos([]));
  }, [mes, envios.length, lancando]);
  useEffect(() => {
    api.listarAjustesFaturamento(mes).then((l) => setAjustes(new Map(l.map((a) => [a.chave, a]))), () => setAjustes(new Map()));
  }, [mes]);
  useEffect(() => {
    api.listarEquipamentos().then((l) => setFichas(new Map(l.map((e) => [e.frota, e]))), () => undefined);
  }, []);

  const linhas = useMemo(() => montarFaturamento(mes, clientes, movimentacoes, envios, faturamentos), [mes, clientes, movimentacoes, envios, faturamentos]);
  const sit = useMemo(() => situacaoFaturas(clientes, envios, faturamentos, mes), [clientes, envios, faturamentos, mes]);
  const cobrar = (l: LinhaFaturamento) => ajustes.get(l.chave)?.valor ?? l.sugerido;

  const passa = (l: LinhaFaturamento, f: Filtro) =>
    f === 'todas' ||
    l.estado === f ||
    (f === 'movimento' && l.tipo !== 'mes') ||
    (f === 'podeFaturar' && !!liberacaoFaturar(fichas.get(l.frota)) && l.estado !== 'faturado') ||
    (f === 'esporadico' && l.modalidade === 'esporadico');
  const q = busca.trim().toUpperCase();
  const visiveis = linhas.filter((l) => passa(l, filtro) && (!q || l.clienteNome.toUpperCase().includes(q) || l.frotas.some((n) => `FT${n}`.includes(q.replace(/\s/g, '')) || n === q)));
  const grupos = useMemo(() => {
    const m = new Map<string, LinhaFaturamento[]>();
    for (const l of visiveis) m.set(l.clienteId, [...(m.get(l.clienteId) ?? []), l]);
    return [...m.entries()];
  }, [visiveis]);

  const soma = (f: (l: LinhaFaturamento) => boolean) => {
    const l = linhas.filter(f);
    return { n: l.length, valor: l.reduce((s, x) => s + cobrar(x), 0) };
  };
  const aFaturar = soma((l) => l.estado === 'pendente');
  const faturado = soma((l) => l.estado === 'faturado');
  const voltou = soma((l) => l.estado === 'devolvido');
  const movimento = soma((l) => l.tipo !== 'mes');
  const liberadas = linhas.filter((l) => passa(l, 'podeFaturar')).length;
  const esporadicas = linhas.filter((l) => l.modalidade === 'esporadico').length;

  const salvarAjuste = async (l: LinhaFaturamento, valor: number | null, obs: string) => {
    try {
      const { ajuste } = await api.salvarAjusteFaturamento(mes, l.chave, valor, obs);
      setAjustes((m) => {
        const n = new Map(m);
        if (ajuste) n.set(l.chave, ajuste);
        else n.delete(l.chave);
        return n;
      });
      setEditando(null);
      avisar(ajuste ? `${l.clienteNome} FT${l.frota}: valor a cobrar salvo.` : `${l.clienteNome} FT${l.frota}: voltou para o valor sugerido.`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    }
  };

  const card = (f: Filtro, rotulo: string, n: number, valor: number | null, cor: string) => (
    <button
      type="button"
      aria-pressed={filtro === f}
      onClick={() => setFiltro(filtro === f ? 'todas' : f)}
      className={`flex min-w-[150px] flex-1 flex-col items-start rounded-xl border bg-white px-3.5 py-2.5 text-left hover:border-ink ${filtro === f ? 'border-ink ring-1 ring-ink' : 'border-line'}`}
    >
      <span className="text-[12.5px] font-semibold text-ink-3">{rotulo}</span>
      <span className={`text-[24px] font-bold leading-tight ${cor}`}>{n}</span>
      <span className="text-[12.5px] text-ink-3">
        {n === 1 ? 'locação' : 'locações'}
        {valor !== null ? ` · ${formatarReais(valor)}` : ''}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Financeiro</div>
          <h1 className="mt-1 text-2xl font-bold">Faturamento do mês</h1>
          <p className="max-w-[760px] text-[13.5px] text-ink-3">
            Tudo o que esteve em algum cliente em {referenciaPorExtenso(mes).toLowerCase()}, inclusive o que já voltou. O valor é uma sugestão proporcional sobre 30 dias: confira e corrija quando precisar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="btn-secondary btn-sm mr-2" onClick={() => setLancando({})}>
            + Lançar fatura emitida
          </button>
          <button type="button" className="btn-secondary btn-sm" aria-label="Mês anterior" onClick={() => setMes(mesSeguinte(mes, -1))}>
            ‹
          </button>
          <span className="min-w-[120px] text-center text-[13.5px] font-semibold">{referenciaPorExtenso(mes)}</span>
          <button type="button" className="btn-secondary btn-sm" aria-label="Mês seguinte" disabled={mes >= atual} onClick={() => setMes(mesSeguinte(mes, 1))}>
            ›
          </button>
        </div>
      </div>

      <section aria-label="Resumo" className="flex flex-wrap gap-3">
        {card('pendente', 'A faturar', aFaturar.n, aFaturar.valor, aFaturar.n ? 'text-ink' : 'text-ink-3')}
        {card('faturado', 'Faturado', faturado.n, faturado.valor, 'text-[#15803D]')}
        {voltou.n > 0 && card('devolvido', 'E-mail voltou', voltou.n, voltou.valor, 'text-warn-strong')}
        {card('movimento', 'Entradas e devoluções no mês', movimento.n, null, movimento.n ? 'text-info' : 'text-ink-3')}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['todas', `Todas ${linhas.length}`],
            ['podeFaturar', `✓ Pode faturar ${liberadas}`],
            ['esporadico', `Esporádicas ${esporadicas}`],
          ] as [Filtro, string][]
        ).map(([f, r]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${filtro === f ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}
          >
            {r}
          </button>
        ))}
        <input type="search" className="input ml-auto h-9 w-full max-w-[260px]" placeholder="Buscar cliente ou FT" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente ou frota" />
      </div>

      {grupos.length === 0 ? (
        <p className="card px-5 py-4 text-[13.5px] text-ink-3">Nada aqui com esse filtro.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map(([cid, ls]) => {
            const s = sit.get(cid);
            const pend = ls.filter((l) => l.estado === 'pendente');
            const totalPend = pend.reduce((t, l) => t + cobrar(l), 0);
            return (
              <section key={cid} aria-label={ls[0].clienteNome} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#F8F7F3] px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h2 className="text-[15px] font-bold">{ls[0].clienteNome}</h2>
                    <span className="text-xs text-ink-3">
                      {s && s.estado !== 'pendente' ? `fatura de ${referenciaPorExtenso(mes).split(' ')[0].toLowerCase()} em ${dataCurta(s.ultima ?? s.quando ?? '')}${s.estado === 'devolvido' ? ' (e-mail voltou)' : ''}` : 'sem fatura no mês ainda'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {pend.length > 0 && (
                      <span className="text-[13px]">
                        A faturar: <b>{formatarReais(totalPend)}</b>
                      </span>
                    )}
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setLancando({ clienteId: cid })}>
                      Lançar fatura
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[860px]">
                    <div className="grid grid-cols-[150px_minmax(200px,1.6fr)_150px_110px_150px_120px] gap-3 border-b border-line-soft px-4 py-2 text-xs font-semibold text-ink-3">
                      <span>Máquina</span>
                      <span>Situação no mês</span>
                      <span>Período</span>
                      <span className="text-right">Mensal</span>
                      <span className="text-right">A cobrar</span>
                      <span>Fatura</span>
                    </div>
                    {ls.map((l) => (
                      <Linha
                        key={l.chave}
                        l={l}
                        ficha={fichas.get(l.frota)}
                        ajuste={ajustes.get(l.chave)}
                        editando={editando === l.chave}
                        editar={() => setEditando(editando === l.chave ? null : l.chave)}
                        salvar={(v, o) => void salvarAjuste(l, v, o)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[12px] text-ink-3">
        Como conta: mês comercial de 30 dias (o último dia do mês é o dia 30; mês inteiro = valor cheio). Devolução cobra até o dia informado na movimentação. Troca com valor novo e reajuste no meio do mês viram trechos. Devolvida fica “A faturar” até sair uma fatura do cliente com data na devolução ou depois.
      </p>

      {lancando && <LancarFatura clienteId={lancando.clienteId} mes={mes} fechar={() => setLancando(null)} />}
    </div>
  );
}

function Linha({
  l,
  ficha,
  ajuste,
  editando,
  editar,
  salvar,
}: {
  l: LinhaFaturamento;
  ficha: Equipamento | undefined;
  ajuste: AjusteFaturamento | undefined;
  editando: boolean;
  editar: () => void;
  salvar: (valor: number | null, obs: string) => void;
}) {
  const valor = ajuste?.valor ?? l.sugerido;
  const proporcional = l.trechos.length > 1 || l.dias < 30;
  return (
    <div className="border-b border-line-soft last:border-0">
      <div className="grid grid-cols-[150px_minmax(200px,1.6fr)_150px_110px_150px_120px] items-start gap-3 px-4 py-2.5 text-[13.5px]">
        <div className="flex flex-col items-start gap-1">
          <span className="font-mono font-semibold">{l.frotas.map((n) => `FT${n}`).join(' → ')}</span>
          <span className="flex flex-wrap gap-1">
            {l.modalidade === 'esporadico' && <Chip tom="neutro">Esporádico</Chip>}
            {l.estado !== 'faturado' && <SeloPodeFaturar ficha={ficha} />}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={TOM_TIPO[l.tipo]}>
            {ICONE_TIPO[l.tipo]}
            {ROTULO_TIPO[l.tipo]}
            {l.tipo === 'entrou' && ` em ${dataCurta(l.de)}`}
            {(l.tipo === 'devolvida' || l.tipo === 'vendida') && ` em ${dataCurta(l.ate)}`}
          </span>
          {l.eventos.map((e) => (
            <span key={e.data + e.tipo} className="text-xs text-ink-2">
              {e.tipo === 'troca' ? '⇄ ' : '↑ '}
              {e.texto}
            </span>
          ))}
        </div>
        <div className="text-[13px]">
          {dataCurta(l.de)} → {dataCurta(l.ate)}
          <span className="block text-xs text-ink-3">{l.dias >= 30 ? 'mês inteiro' : `${l.dias} de 30 dias`}</span>
        </div>
        <div className="text-right tabular-nums">{formatarReais(l.valorMensal)}</div>
        <div className="flex flex-col items-end gap-0.5">
          <button type="button" onClick={editar} className="group flex items-center gap-1.5 font-bold tabular-nums hover:underline" aria-label={`Conferir valor a cobrar da FT${l.frota}`}>
            {formatarReais(valor)} <span className="text-xs font-normal text-ink-3 group-hover:text-ink">✎</span>
          </button>
          {ajuste?.valor != null ? (
            <span className="text-[11.5px] text-info">corrigido (sugestão {formatarReais(l.sugerido)})</span>
          ) : (
            proporcional && <span className="text-[11.5px] text-ink-3">sugestão proporcional</span>
          )}
          {ajuste?.obs && <span className="max-w-[150px] truncate text-right text-[11.5px] text-ink-2" title={ajuste.obs}>{ajuste.obs}</span>}
        </div>
        <div className="flex flex-col items-start gap-0.5">
          <Chip tom={TOM_ESTADO[l.estado]}>{ROTULO_FATURA[l.estado]}</Chip>
          {l.faturadoEm && <span className="text-[11.5px] text-ink-3">em {dataCurta(l.faturadoEm)}</span>}
        </div>
      </div>
      {editando && <EditarValor l={l} ajuste={ajuste} salvar={salvar} cancelar={editar} />}
    </div>
  );
}

function EditarValor({ l, ajuste, salvar, cancelar }: { l: LinhaFaturamento; ajuste: AjusteFaturamento | undefined; salvar: (valor: number | null, obs: string) => void; cancelar: () => void }) {
  const [texto, setTexto] = useState(reaisParaCampo(ajuste?.valor ?? l.sugerido));
  const [obs, setObs] = useState(ajuste?.obs ?? '');
  const [salvando, setSalvando] = useState(false);
  const valor = lerReais(texto);
  const ok = async (v: number | null, o: string) => {
    setSalvando(true);
    salvar(v, o);
  };
  return (
    <div className="mx-4 mb-3 flex flex-col gap-3 rounded-xl border border-line bg-[#F8F7F3] p-3.5 text-[13px]">
      <div>
        <div className="font-semibold">Como a sugestão foi calculada</div>
        <ul className="mt-1 text-ink-2">
          {l.trechos.map((t) => (
            <li key={t.de}>
              {dataCurta(t.de)} a {dataCurta(t.ate)}: {t.dias >= 30 ? 'mês inteiro' : `${t.dias}/30`} de {formatarReais(t.valor)} = <b>{formatarReais(t.cobrar)}</b>
            </li>
          ))}
        </ul>
        {ajuste && (
          <div className="mt-1 text-xs text-ink-3">
            Corrigido por {ajuste.atualizadoPor || '—'} em {dataCurta(ajuste.atualizadoEm.slice(0, 10))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Valor a cobrar (R$)
          <input className="input w-[160px] font-normal tabular-nums" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 font-semibold text-ink-2">
          Observação <span className="font-normal text-ink-3">(opcional)</span>
          <input className="input font-normal" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: combinado cobrar 15 dias" />
        </label>
      </div>
      {valor === null && <span className="text-xs text-bad">Valor inválido.</span>}
      <div className="flex flex-wrap justify-end gap-2">
        {ajuste && (
          <button type="button" className="btn-secondary btn-sm mr-auto" disabled={salvando} onClick={() => void ok(null, '')}>
            Voltar para a sugestão
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" onClick={cancelar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary btn-sm" disabled={valor === null || salvando} onClick={() => void ok(valor === l.sugerido && !obs.trim() ? null : valor, obs.trim())}>
          Salvar
        </button>
      </div>
    </div>
  );
}
