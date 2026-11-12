/** Balãozinho de observação urgente (passe o mouse ou toque para ler). */
export function BalaoUrgente({ texto, apagado }: { texto: string; apagado?: boolean }) {
  return (
    <span
      role="img"
      aria-label={`Observação${apagado ? '' : ' urgente'}: ${texto}`}
      title={`${apagado ? 'Observação (já resolvida)' : 'URGENTE'}: ${texto}`}
      className={`inline-flex h-[22px] items-center gap-1 rounded-full px-1.5 text-[11px] font-bold ${apagado ? 'bg-line-soft text-ink-3' : 'bg-bad text-white'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5Z" />
        {!apagado && <path d="M12 8v4M12 15.5h.01" />}
      </svg>
      {!apagado && 'urgente'}
    </span>
  );
}

/** Etiqueta "Helbert": o dono divide a máquina com o irmão (só registro). */
export function SeloHelbert({ ativo }: { ativo?: string | null }) {
  if (ativo !== 'sim') return null;
  return (
    <span
      title="Helbert: máquina dividida entre o dono e o irmão (só registro)"
      className="rounded-full bg-[#DCFCE7] px-1.5 py-px font-sans text-[10.5px] font-bold uppercase tracking-wide text-[#166534]"
    >
      Helbert
    </span>
  );
}
