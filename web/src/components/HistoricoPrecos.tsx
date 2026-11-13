import { useEstado } from '../state';
import { dataBr } from '../lib/calendario';
import { formatarReais } from '../lib/dinheiro';
import { historicoPrecos, ROTULO_PRECO } from '../lib/precos';

/** Histórico de preços da máquina (automático, pelas movimentações). `compacto` = sem moldura, para dentro do contrato. */
export function HistoricoPrecos({ frota, compacto, limite }: { frota: string; compacto?: boolean; limite?: number }) {
  const { movimentacoes } = useEstado();
  const lista = historicoPrecos(movimentacoes, frota);
  if (!lista.length) return compacto ? <p className="text-[12.5px] text-ink-3">FT{frota}: sem movimentações registradas no sistema ainda.</p> : null;
  const mostrar = limite ? lista.slice(0, limite) : lista;
  const linhas = (
    <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
      {mostrar.map((p) => (
        <li key={`${p.movId}-${p.tipo}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
          <span className="min-w-0">
            <b>{dataBr(p.data)}</b> <span className="text-ink-2">{ROTULO_PRECO[p.tipo]}</span>
            {p.cliente && <span className="text-ink-3"> · {p.cliente}</span>}
          </span>
          <span className="whitespace-nowrap">
            {p.de !== null && <span className={p.para !== null ? 'text-ink-3 line-through' : ''}>{formatarReais(p.de)}</span>}
            {p.de !== null && p.para !== null && ' → '}
            {p.para !== null && <b>{formatarReais(p.para)}</b>}
            {p.para === null && p.de !== null && <span className="text-ink-3"> (saiu)</span>}
            {p.percentual !== null && <span className={`ml-1.5 text-[12px] font-semibold ${p.percentual >= 0 ? 'text-ok' : 'text-bad'}`}>{`${p.percentual >= 0 ? '+' : ''}${String(p.percentual).replace('.', ',')}%`}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
  if (compacto)
    return (
      <div>
        <div className="text-[12px] font-semibold text-ink-3">FT{frota}</div>
        {linhas}
      </div>
    );
  return (
    <section aria-label="Histórico de preços" className="flex flex-col gap-1 rounded-xl border border-line bg-white p-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Histórico de preços</h3>
      <p className="text-[12px] text-ink-3">Automático, pelas movimentações (locação, reajuste, troca, devolução).</p>
      {linhas}
    </section>
  );
}
