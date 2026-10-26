import { useEffect, useRef, type ReactNode } from 'react';
import { IcFechar } from './Icones';

export type Tom = 'ok' | 'warn' | 'bad' | 'info' | 'neutro';

const TONS: Record<Tom, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-brand-soft text-brand-dark',
  neutro: 'bg-line-soft text-ink-2',
};

export function Chip({ tom, children }: { tom: Tom; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold ${TONS[tom]}`}>
      {children}
    </span>
  );
}

/** Mantém o foco dentro do diálogo e fecha com Esc. */
function useDialogo(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input, textarea, button:not([data-fechar])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
      if (e.key === 'Tab' && el) {
        const foc = el.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]');
        if (!foc.length) return;
        const primeiro = foc[0];
        const ultimo = foc[foc.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          ultimo.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          primeiro.focus();
          e.preventDefault();
        }
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      anterior?.focus?.();
    };
  }, [aberto, fechar]);
  return ref;
}

export function Modal({
  aberto,
  fechar,
  titulo,
  children,
}: {
  aberto: boolean;
  fechar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  const ref = useDialogo(aberto, fechar);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className="flex w-full max-w-[480px] flex-col gap-3.5 rounded-2xl bg-white p-6">
        <h2 className="text-xl font-bold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export function Gaveta({
  aberto,
  fechar,
  titulo,
  children,
}: {
  aberto: boolean;
  fechar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  const ref = useDialogo(aberto, fechar);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-ink/45" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className="flex h-full w-full max-w-[500px] flex-col gap-4 overflow-y-auto bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{titulo}</h2>
          <button type="button" data-fechar aria-label="Fechar" onClick={fechar} className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas">
            <IcFechar tamanho={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Cartao({ rotulo, valor, cor }: { rotulo: string; valor: number | string; cor?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs text-ink-3">{rotulo}</div>
      <div className={`text-[26px] font-bold leading-tight ${cor ?? ''}`}>{valor}</div>
    </div>
  );
}
