import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import { Modal } from './ui';

export function TrocarSenha({ aberto, fechar }: { aberto: boolean; fechar: () => void }) {
  const { avisar } = useEstado();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const limparEFechar = () => {
    setAtual('');
    setNova('');
    setConfirma('');
    setErro('');
    fechar();
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (nova.length < 8) return setErro('A nova senha precisa ter pelo menos 8 caracteres.');
    if (nova !== confirma) return setErro('A confirmação não é igual à nova senha.');
    if (nova === atual) return setErro('A nova senha precisa ser diferente da atual.');
    setSalvando(true);
    try {
      await api.trocarSenha(atual, nova);
      avisar('Senha trocada. Se você estava conectado em outro computador, vai precisar entrar de novo lá.');
      limparEFechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} fechar={limparEFechar} titulo="Trocar minha senha">
      <form onSubmit={salvar} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="senha-atual" className="label">
            Senha atual
          </label>
          <input id="senha-atual" type="password" autoComplete="current-password" className="input" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="senha-nova" className="label">
            Nova senha <span className="font-normal text-ink-3">(mínimo 8 caracteres)</span>
          </label>
          <input id="senha-nova" type="password" autoComplete="new-password" className="input" value={nova} onChange={(e) => setNova(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="senha-confirma" className="label">
            Repita a nova senha
          </label>
          <input id="senha-confirma" type="password" autoComplete="new-password" className="input" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        </div>
        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={limparEFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={salvando || !atual || !nova}>
            {salvando ? 'Salvando…' : 'Trocar senha'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
