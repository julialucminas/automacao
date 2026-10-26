import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useEstado } from '../state';
import { temAviso } from '../lib/pareamento';
import { EMPRESA, REMETENTE } from '../lib/email';
import { IcEmail, IcFechar, IcSair } from './Icones';

export function Layout() {
  const { usuario, sair, lote, clientes, envios, aviso, fecharAviso } = useEstado();
  const avisosLote = lote ? lote.itens.filter(temAviso).length : 0;
  const devolvidos = envios.filter((e) => e.status === 'devolvido').length;

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(fecharAviso, 6000);
    return () => clearTimeout(t);
  }, [aviso, fecharAviso]);

  const abas = [
    { para: '/envio', rotulo: 'Envio do mês', badge: avisosLote, alerta: true },
    { para: '/clientes', rotulo: 'Clientes', badge: clientes.filter((c) => c.ativo).length, alerta: false },
    { para: '/historico', rotulo: 'Histórico', badge: devolvidos, alerta: true },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pt-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-brand text-white">
              <IcEmail tamanho={18} />
            </div>
            <div>
              <div className="text-base font-bold">Envio de Faturas</div>
              <div className="text-xs text-ink-3">{EMPRESA} · Financeiro</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-full bg-line-soft px-3 py-1.5 text-xs text-ink-2">
              <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
              {REMETENTE} · modo de teste (nenhum e-mail sai)
            </span>
            <button type="button" onClick={sair} className="btn-secondary btn-sm" title={usuario?.email}>
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
                    isActive ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink'
                  }`
                }
              >
                {a.rotulo}
                {a.badge > 0 && (
                  <span
                    className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold ${
                      a.alerta ? 'bg-warn-soft text-warn' : 'bg-line-soft text-ink-2'
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
    </div>
  );
}
