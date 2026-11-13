import { useEffect, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { IntegracaoAutentique as Config } from '../types';

/**
 * Configurações → Integrações → Autentique (só a administradora). O token é colado aqui, vai direto para o
 * servidor e nunca volta para a tela: depois de salvo aparece só "••••" e os 4 últimos caracteres.
 */
export function IntegracaoAutentique() {
  const { avisar } = useEstado();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [token, setToken] = useState('');
  const [d, setD] = useState({ lucminasNome: '', lucminasEmail: '', testemunhaNome: '', testemunhaEmail: '', teste: true });
  const [ocupado, setOcupado] = useState('');
  useEffect(() => {
    api.lerAutentique().then((c) => {
      setCfg(c);
      setD({ lucminasNome: c.lucminasNome || 'Arnaldo', lucminasEmail: c.lucminasEmail, testemunhaNome: c.testemunhaNome, testemunhaEmail: c.testemunhaEmail, teste: c.teste });
    }, () => undefined);
  }, []);

  const rodar = async (qual: string, f: () => Promise<Config>, ok: string) => {
    setOcupado(qual);
    try {
      setCfg(await f());
      avisar(ok);
      return true;
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível.', 'bad');
      return false;
    } finally {
      setOcupado('');
    }
  };
  const salvar = async () => {
    const t = token.trim();
    if (await rodar('salvar', () => api.salvarAutentique({ ...d, ...(t ? { token: t } : {}) }), t ? 'Token guardado. Agora clique em “Testar conexão”.' : 'Integração salva.')) setToken('');
  };
  if (!cfg) return null;
  const campo = (k: keyof typeof d, rot: string, tipo = 'text') => (
    <label className="flex flex-col gap-1.5">
      <span className="label">{rot}</span>
      <input type={tipo} className="input" value={String(d[k])} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  );

  return (
    <section aria-label="Integrações" className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold">Integrações · Autentique (assinatura de contratos)</h2>
          <p className="text-[13px] text-ink-3">Com o token, a aba Contratos manda o PDF para assinar e recebe o contrato assinado de volta sozinha.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${cfg.configurado ? 'bg-ok-soft text-ok' : 'bg-line-soft text-ink-3'}`}>
          {cfg.configurado ? `Ligada · token ••••${cfg.final}` : 'Não ligada'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="aut-token" className="label">
          {cfg.configurado ? 'Trocar o token' : 'Token de API'}
        </label>
        <input
          id="aut-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="input font-mono"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={cfg.configurado ? 'deixe em branco para manter o atual' : 'cole aqui o token gerado no painel da Autentique'}
        />
        <p className="text-[12.5px] text-ink-3">
          Na Autentique: Configurações da conta → API → gerar token. Cole aqui e salve. O token fica guardado no servidor e não aparece de novo nesta tela.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo('lucminasNome', 'Quem assina pela Lucminas')}
        {campo('lucminasEmail', 'E-mail de quem assina pela Lucminas', 'email')}
        {campo('testemunhaNome', 'Testemunha da Lucminas (padrão)')}
        {campo('testemunhaEmail', 'E-mail da testemunha da Lucminas', 'email')}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-ink" checked={d.teste} onChange={(e) => setD({ ...d, teste: e.target.checked })} />
        <span>
          <b className="text-[14px]">Modo de teste</b>
          <span className="block text-[12.5px] text-ink-3">Os contratos vão como teste: não gastam crédito e a Autentique apaga em alguns dias. Desmarque quando for usar de verdade.</span>
        </span>
      </label>

      {cfg.conta && <p className="text-[13px] text-ok">✓ Conectado à conta {cfg.conta}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {cfg.configurado && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={!!ocupado}
              onClick={() => void rodar('apagar', () => api.salvarAutentique({ apagarToken: true }), 'Token apagado. A Autentique está desligada.')}
            >
              Apagar token
            </button>
            <button type="button" className="btn-secondary" disabled={!!ocupado} onClick={() => void rodar('testar', () => api.testarAutentique(), 'A Autentique respondeu. Está tudo certo.')}>
              {ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}
            </button>
          </>
        )}
        <button type="button" className="btn-primary" disabled={!!ocupado} onClick={() => void salvar()}>
          {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </section>
  );
}
