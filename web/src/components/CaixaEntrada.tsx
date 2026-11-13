import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import type { EmailRecebido } from '../types';
import { dataHora } from '../lib/email';

/**
 * E-mails de gente (resposta de cliente, pedido de 2ª via…) que chegaram na caixa das faturas.
 * O sistema olha a caixa a cada 5 minutos e guarda só remetente e assunto: para ler, abre no e-mail.
 * "Ok" tira da lista de novos (o registro fica, com quem deu ok).
 */
export function CaixaEntrada() {
  const { emailsCaixa, emailsNovos, okEmails, pode, avisar } = useEstado();
  const [verTodos, setVerTodos] = useState(false);
  const age = pode('envio', 2) || pode('historico', 2);
  const lista = verTodos ? emailsCaixa : emailsNovos;
  const mostrar = lista.slice(0, verTodos ? 60 : 8);

  const ok = async (ids: string[], desfazer?: boolean) => {
    try {
      await okEmails(ids, desfazer);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    }
  };

  return (
    <section aria-label="E-mails na caixa das faturas" className={`rounded-xl border bg-white ${emailsNovos.length ? 'border-2 border-info' : 'border-line'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <span aria-hidden>✉️</span> E-mails na caixa das faturas
          {emailsNovos.length > 0 && <span className="rounded-full bg-info px-2.5 text-[13px] text-white">{emailsNovos.length} novo{emailsNovos.length > 1 ? 's' : ''}</span>}
        </h2>
        <div className="flex flex-wrap gap-2">
          {age && emailsNovos.length > 1 && !verTodos && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => void ok(emailsNovos.map((e) => e.id))}>
              Ok em todos
            </button>
          )}
          <button type="button" className="btn-secondary btn-sm" aria-pressed={verTodos} onClick={() => setVerTodos(!verTodos)}>
            {verTodos ? 'Só os novos' : 'Ver os últimos 45 dias'}
          </button>
        </div>
      </div>
      {mostrar.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-ink-3">{verTodos ? 'Nenhum e-mail registrado ainda.' : 'Nenhum e-mail novo. O sistema olha a caixa a cada 5 minutos.'}</p>
      ) : (
        <ul>
          {mostrar.map((e) => (
            <ItemEmail key={e.id} e={e} age={age} ok={ok} />
          ))}
        </ul>
      )}
      {lista.length > mostrar.length && <p className="px-5 py-2 text-xs text-ink-3">e mais {lista.length - mostrar.length}</p>}
      <p className="border-t border-line-soft px-5 py-2 text-[11.5px] text-ink-3">Aqui aparecem só remetente e assunto. Para ler e responder, abra no e-mail. Devoluções e confirmações de leitura continuam indo direto para o Histórico de envios.</p>
    </section>
  );
}

function ItemEmail({ e, age, ok }: { e: EmailRecebido; age: boolean; ok: (ids: string[], desfazer?: boolean) => Promise<void> }) {
  const visto = !!e.vistoEm;
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-5 py-2.5 text-[13.5px] last:border-0 ${visto ? 'opacity-70' : ''}`}>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${visto ? 'bg-line-strong' : 'bg-info'}`} />
      <span className="min-w-0 flex-1">
        <span className={visto ? '' : 'font-bold'}>{e.assunto || '(sem assunto)'}</span>
        {e.anexos > 0 && <span className="ml-1.5 text-xs text-ink-3">📎 {e.anexos}</span>}
        <span className="block text-xs text-ink-3">
          {e.deNome ? `${e.deNome} <${e.deEmail}>` : e.deEmail}
          {e.clienteId && (
            <>
              {' · '}
              <Link to={`/clientes?busca=${encodeURIComponent(e.clienteNome ?? "")}`} className="font-semibold text-info hover:underline">
                {e.clienteNome}
              </Link>
            </>
          )}
          {' · '}
          {dataHora(e.recebidoEm)}
          {visto && ` · ok de ${e.vistoPorNome || '—'}`}
        </span>
      </span>
      {age &&
        (visto ? (
          <button type="button" className="text-xs text-ink-3 underline" onClick={() => void ok([e.id], true)}>
            voltar para novo
          </button>
        ) : (
          <button type="button" className="btn-secondary btn-sm" onClick={() => void ok([e.id])}>
            ✓ Ok, vi
          </button>
        ))}
    </li>
  );
}
