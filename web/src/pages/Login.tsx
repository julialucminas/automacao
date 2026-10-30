import { useState, type FormEvent } from 'react';
import { useEstado } from '../state';
import { EMPRESA } from '../lib/email';
import { IcEmail } from '../components/Icones';
import { MODO_DEMO } from '../api';

export function Login() {
  const { entrar } = useEstado();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    setEntrando(true);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={enviar} className="card flex w-full max-w-[400px] flex-col gap-4 p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand text-ink">
            <IcEmail tamanho={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Envio de Faturas</h1>
            <div className="text-xs text-ink-3">{EMPRESA}</div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-email" className="label">
            E-mail
          </label>
          <input id="login-email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-senha" className="label">
            Senha
          </label>
          <input id="login-senha" type="password" autoComplete="current-password" className="input" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
        {MODO_DEMO && <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-xs text-warn-strong">Versão de demonstração: qualquer e-mail e senha entram.</p>}
      </form>
    </div>
  );
}
