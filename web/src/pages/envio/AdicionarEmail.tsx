import { useState } from 'react';
import type { Cliente, ItemLote } from '../../types';
import { chaveItem, useEstado } from '../../state';
import { statusDoItem } from '../../lib/pareamento';
import { emailValido } from '../../lib/normalizar';

/** Separa o que foi digitado/colado ("a@x.com; b@y.com") em e-mails. */
export function separarEmails(t: string): string[] {
  return [...new Set(t.split(/[\s,;]+/).map((e) => e.trim().replace(/^<|>$/g, '').toLowerCase()).filter(Boolean))];
}

/**
 * Adiciona e-mails ao cliente direto da conferência do envio, salvando no cadastro.
 * Só acrescenta: não tira nem troca e-mail nenhum (para mexer nos existentes, use o cadastro do cliente).
 */
export function AdicionarEmail({ cliente, item, abertoDeInicio = false }: { cliente: Cliente; item: ItemLote; abertoDeInicio?: boolean }) {
  const { salvarCliente, atualizarItem, clientes, pode, avisar } = useEstado();
  const [aberto, setAberto] = useState(abertoDeInicio);
  const [texto, setTexto] = useState('');
  const [onde, setOnde] = useState<'para' | 'cc'>(cliente.para.length ? 'cc' : 'para');
  const [salvando, setSalvando] = useState(false);
  if (!pode('clientes', 2)) return null;

  const lista = separarEmails(texto);
  const invalidos = lista.filter((e) => !emailValido(e));
  const jaTem = new Set([...cliente.para, ...cliente.cc].map((e) => e.toLowerCase()));
  const repetidos = lista.filter((e) => jaTem.has(e));
  const novos = lista.filter((e) => emailValido(e) && !jaTem.has(e));

  const salvar = async () => {
    if (!novos.length || invalidos.length) return;
    setSalvando(true);
    const estavaPronta = statusDoItem(item, clientes) === 'pronto';
    try {
      const salvo = await salvarCliente({ ...cliente, para: onde === 'para' ? [...cliente.para, ...novos] : cliente.para, cc: onde === 'cc' ? [...cliente.cc, ...novos] : cliente.cc });
      // estava sem e-mail e agora pode sair: já deixa marcada para envio
      if (!estavaPronta && statusDoItem(item, clientes.map((c) => (c.id === salvo.id ? salvo : c))) === 'pronto') atualizarItem(chaveItem(item), (i) => ({ ...i, marcado: true }));
      avisar(`${novos.length === 1 ? novos[0] : `${novos.length} e-mails`} adicionado${novos.length > 1 ? 's' : ''} em ${onde === 'para' ? 'Para' : 'Cópia'} de ${cliente.nome}, também no cadastro.`);
      setTexto('');
      setAberto(abertoDeInicio);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar o e-mail.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  if (!aberto)
    return (
      <button type="button" className="self-start text-[12.5px] font-semibold text-info underline underline-offset-2" onClick={() => setAberto(true)}>
        + Adicionar e-mail para {cliente.nome}
      </button>
    );

  return (
    <form
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <label htmlFor={`novo-email-${cliente.id}`} className="font-semibold">
        Novo e-mail para {cliente.nome}
      </label>
      <input
        id={`novo-email-${cliente.id}`}
        className="input"
        type="text"
        inputMode="email"
        autoComplete="off"
        autoFocus={!abertoDeInicio}
        placeholder="financeiro@cliente.com.br (dá para colar vários)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Onde entra">
        {(
          [
            ['para', 'Para'],
            ['cc', 'Cópia'],
          ] as const
        ).map(([v, r]) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="radio" name={`onde-${cliente.id}`} className="accent-ink" checked={onde === v} onChange={() => setOnde(v)} />
            {r}
          </label>
        ))}
      </div>
      {invalidos.length > 0 && <span className="text-xs text-bad">Não parece e-mail: {invalidos.join(', ')}</span>}
      {repetidos.length > 0 && <span className="text-xs text-ink-3">Já está no cadastro: {repetidos.join(', ')}</span>}
      <span className="text-[11.5px] text-ink-3">Fica salvo no cadastro do cliente e vale para este envio e os próximos.</span>
      <div className="flex justify-end gap-2">
        {!abertoDeInicio && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setAberto(false)}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn-primary btn-sm" disabled={!novos.length || invalidos.length > 0 || salvando}>
          {salvando ? 'Salvando…' : 'Adicionar e salvar no cadastro'}
        </button>
      </div>
    </form>
  );
}
