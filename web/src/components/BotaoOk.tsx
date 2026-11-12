import { useState } from 'react';
import { useEstado } from '../state';

/**
 * "Ok" numa pendência (e-mail devolvido, contrato vencendo…): ela some das notificações, mas o registro continua
 * no histórico, com quem deu ok e quando. Clicando de novo, desfaz.
 */
export function BotaoOk({ chave, rotulo = 'Ok, resolvido', pequeno = true, aoFazer }: { chave: string; rotulo?: string; pequeno?: boolean; aoFazer?: () => void }) {
  const { avisosOk, darOk, desfazerOk, avisar } = useEstado();
  const [abrindo, setAbrindo] = useState(false);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const feito = avisosOk.get(chave);
  const tam = pequeno ? 'btn-sm' : '';

  const agir = async (fazer: boolean) => {
    setOcupado(true);
    try {
      if (fazer) await darOk(chave, obs.trim());
      else await desfazerOk(chave);
      setAbrindo(false);
      setObs('');
      avisar(fazer ? 'Pronto: saiu das notificações. O registro continua no histórico.' : 'Voltou para as notificações.');
      if (fazer) aoFazer?.();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setOcupado(false);
    }
  };

  if (feito)
    return (
      <button type="button" className={`btn-secondary ${tam}`} disabled={ocupado} onClick={() => void agir(false)} title="Volta a aparecer nas notificações">
        Desfazer ok
      </button>
    );
  if (abrindo)
    return (
      <span className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.preventDefault()}>
        <input
          autoFocus
          aria-label="O que foi feito (opcional)"
          className="input h-8 min-h-0 w-[200px] py-0 text-[13px]"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void agir(true)}
          placeholder="O que foi feito (opcional)"
        />
        <button type="button" className={`btn-primary ${tam}`} disabled={ocupado} onClick={() => void agir(true)}>
          Ok
        </button>
        <button type="button" className={`btn ${tam} text-ink-3`} onClick={() => setAbrindo(false)}>
          Cancelar
        </button>
      </span>
    );
  return (
    <button
      type="button"
      className={`btn-secondary ${tam}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setAbrindo(true);
      }}
    >
      ✓ {rotulo}
    </button>
  );
}
