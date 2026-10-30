import { useEffect, useState } from 'react';

/** Nome do arquivo principal (index-HASH.js) de um HTML. Muda a cada versão publicada. */
export function scriptPrincipal(html: string): string | null {
  return /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;
}

/**
 * Confere de tempos em tempos se o servidor tem uma versão nova do sistema.
 * Quando tem: recarrega sozinho se a pessoa não está digitando nada; senão avisa.
 */
export function useVersaoNova(intervaloMs = 120_000): boolean {
  const [nova, setNova] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const atual = scriptPrincipal(document.documentElement.innerHTML);
    if (!atual) return;
    const conferir = async () => {
      try {
        const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
        const servidor = scriptPrincipal(html);
        if (!servidor || servidor === atual) return;
        const digitando = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        const formularioAberto = document.querySelector('[role=dialog]');
        if (!digitando && !formularioAberto) window.location.reload();
        else setNova(true);
      } catch {
        /* sem conexão: tenta depois */
      }
    };
    const t = setInterval(conferir, intervaloMs);
    const foco = () => document.visibilityState === 'visible' && conferir();
    document.addEventListener('visibilitychange', foco);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', foco);
    };
  }, [intervaloMs]);
  return nova;
}
