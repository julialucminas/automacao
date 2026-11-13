import { useState } from 'react';
import { useEstado } from '../state';

/**
 * "✓ Concluir" de uma solicitação, de qualquer lugar (lista, Central, Início).
 * Abre um campo opcional para dizer o que foi feito ("fatura nº 123 enviada"), que vai para a conversa.
 */
export function ConcluirSolicitacao({ id, grande, aoConcluir }: { id: string; grande?: boolean; aoConcluir?: () => void }) {
  const { alterarSolicitacao, avisar } = useEstado();
  const [abrindo, setAbrindo] = useState(false);
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const concluir = async () => {
    setOcupado(true);
    try {
      await alterarSolicitacao(id, { status: 'concluida', nota: nota.trim() || undefined });
      setAbrindo(false);
      setNota('');
      avisar('Solicitação concluída. Quem pediu é avisado.');
      aoConcluir?.();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível concluir.', 'bad');
    } finally {
      setOcupado(false);
    }
  };

  if (!abrindo)
    return (
      <button type="button" className={`${grande ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} shrink-0`} onClick={() => setAbrindo(true)}>
        ✓ {grande ? 'Marcar como concluída' : 'Concluir'}
      </button>
    );
  return (
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 rounded-[10px] border border-line bg-white p-2 sm:w-auto sm:flex-1">
      <label className="text-[12px] font-semibold text-ink-3">
        O que foi feito? <span className="font-normal">(opcional, vai para a conversa)</span>
        <input
          autoFocus
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void concluir();
            if (e.key === 'Escape') setAbrindo(false);
          }}
          placeholder="Ex.: fatura nº 123 enviada"
          className="input mt-1 min-h-[36px] py-1 text-[13px] font-normal text-ink"
        />
      </label>
      <div className="flex justify-end gap-1.5">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setAbrindo(false)}>
          Cancelar
        </button>
        <button type="button" className="btn-primary btn-sm" disabled={ocupado} onClick={() => void concluir()}>
          {ocupado ? 'Salvando…' : '✓ Concluir'}
        </button>
      </div>
    </div>
  );
}
