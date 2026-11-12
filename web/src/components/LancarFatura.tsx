import { useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import { hojeIso } from '../lib/calendario';
import { referenciaAtual } from '../lib/email';
import { Modal } from './ui';

/** Só quem cuida do faturamento vê o "faturado no mês" e lança fatura manual: administrador e financeiro. */
export const cuidaDoFaturamento = (perfil: string | undefined) => perfil === 'admin' || perfil === 'financeiro';

/**
 * Fatura que saiu por fora do sistema (e-mail mandado à mão, entregue em mãos…): lança que foi emitida.
 * Vai para o Histórico de envios como "lançada manualmente" e o cliente fica como faturado no mês.
 */
export function LancarFatura({ clienteId, mes, fechar }: { clienteId?: string; mes?: string; fechar: () => void }) {
  const { clientes, recarregarEnvios, avisar } = useEstado();
  const ativos = clientes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
  const [cli, setCli] = useState(clienteId ?? '');
  const [referencia, setReferencia] = useState(mes ?? referenciaAtual());
  const [data, setData] = useState(hojeIso());
  const [numero, setNumero] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const fixo = clienteId ? clientes.find((c) => c.id === clienteId) : undefined;

  const salvar = async () => {
    setErro('');
    if (!cli) return setErro('Escolha o cliente.');
    if (!data) return setErro('Informe a data em que a fatura foi enviada.');
    setSalvando(true);
    try {
      await api.lancarFaturaManual({ clienteId: cli, referencia, data, numero: numero.trim(), observacao: obs.trim() });
      await recarregarEnvios();
      avisar(`Fatura de ${clientes.find((c) => c.id === cli)?.nome ?? 'cliente'} lançada como emitida.`);
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível lançar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={fechar} titulo="Lançar fatura emitida">
      <p className="text-[13px] text-ink-2">Para a fatura que foi enviada por fora do sistema. Ela entra no Histórico de envios como lançada manualmente e o cliente fica como faturado no mês.</p>
      <label className="flex flex-col gap-1.5">
        <span className="label">Cliente</span>
        {fixo ? (
          <b className="text-[15px]">{fixo.nome}</b>
        ) : (
          <select className="input" value={cli} onChange={(e) => setCli(e.target.value)}>
            <option value="">Escolha…</option>
            {ativos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">Mês de referência</span>
          <input type="month" className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Enviada em</span>
          <input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Nº da fatura <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Observação <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: mandei pelo meu e-mail" />
      </label>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Lançando…' : 'Lançar como emitida'}
        </button>
      </div>
    </Modal>
  );
}
