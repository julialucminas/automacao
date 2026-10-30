import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useEstado } from '../state';
import { temAviso } from '../lib/pareamento';
import { EMPRESA, REMETENTE } from '../lib/email';
import { IcFechar, IcSair } from './Icones';
import { MODO_DEMO } from '../api';
import { TrocarSenha } from './TrocarSenha';

export function Layout() {
  const { usuario, sair, lote, clientes, envios, aviso, fecharAviso } = useEstado();
  const avisosLote = lote ? lote.itens.filter((i) => temAviso(i, clientes)).length : 0;
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const comoChamar = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';
  const devolvidos = envios.filter((e) => e.status === 'devolvido').length;

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(fecharAviso, 6000);
    return () => clearTimeout(t);
  }, [aviso, fecharAviso]);

  const abas = [
    { para: '/envio', rotulo: 'Envio do mês', badge: avisosLote, alerta: true },
    { para: '/calendario', rotulo: 'Calendário', badge: 0, alerta: false },
    { para: '/frotas', rotulo: 'Frotas', badge: 0, alerta: false },
    { para: '/clientes', rotulo: 'Clientes', badge: clientes.filter((c) => c.ativo).length, alerta: false },
    { para: '/historico', rotulo: 'Histórico', badge: devolvidos, alerta: true },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-noite text-white">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pt-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <img src="./logo-icone.png" alt="Lucminas" width={40} height={40} className="h-10 w-10" />
            <div>
              <div className="text-base font-bold">Envio de Faturas</div>
              <div className="text-xs text-white/65">{EMPRESA} · Financeiro</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80">
              <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
              {REMETENTE} · {MODO_DEMO ? 'demonstração (nenhum e-mail sai)' : 'envio ainda não ativado'}
            </span>
            {comoChamar && <span className="px-1 text-[15px] font-bold text-brand">Oi {comoChamar}! :)</span>}
            <button type="button" onClick={() => setTrocandoSenha(true)} className="btn btn-sm text-white/75 hover:bg-white/10 hover:text-white">
              Trocar senha
            </button>
            <button type="button" onClick={sair} className="btn btn-sm border border-white/25 text-white hover:bg-white/10" title={usuario?.email}>
              <IcSair tamanho={14} /> Sair
            </button>
          </div>
          <nav aria-label="Seções" className="flex basis-full flex-wrap gap-1">
            {abas.map((a) => (
              <NavLink
                key={a.para}
                to={a.para}
                className={({ isActive }) =>
                  `inline-flex min-h-[44px] items-center gap-2 border-b-[3px] px-3.5 font-semibold ${
                    isActive ? 'border-brand text-white' : 'border-transparent text-white/60 hover:text-white'
                  }`
                }
              >
                {a.rotulo}
                {a.badge > 0 && (
                  <span
                    className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold ${
                      a.alerta ? 'bg-brand text-ink' : 'bg-white/15 text-white'
                    }`}
                  >
                    {a.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        {aviso && (
          <div
            role="status"
            className={`mb-5 flex items-center justify-between gap-3 rounded-[10px] px-4 py-2 font-medium ${
              aviso.tom === 'ok' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-strong'
            }`}
          >
            <span>{aviso.texto}</span>
            <button type="button" aria-label="Fechar aviso" onClick={fecharAviso} className="flex h-11 w-11 shrink-0 items-center justify-center">
              <IcFechar />
            </button>
          </div>
        )}
        <Outlet />
      </main>
      <TrocarSenha aberto={trocandoSenha} fechar={() => setTrocandoSenha(false)} />
    </div>
  );
}
