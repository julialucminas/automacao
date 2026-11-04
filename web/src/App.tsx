import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EstadoProvider, useEstado } from './state';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Envio } from './pages/Envio';
import { Clientes } from './pages/Clientes';
import { Historico } from './pages/Historico';
import { Calendario } from './pages/Calendario';
import { Frotas } from './pages/Frotas';
import { Solicitacoes } from './pages/Solicitacoes';
import { Movimentacoes } from './pages/Movimentacoes';
import { Aprovacoes } from './pages/Aprovacoes';
import { Registro } from './pages/Registro';
import { Configuracoes } from './pages/Configuracoes';
import { ConferenciaMes } from './pages/ConferenciaMes';
import { Inicio } from './pages/Inicio';
import { Usuarios } from './pages/Usuarios';
import { Equipamentos } from './pages/Equipamentos';
import { Manutencao } from './pages/Manutencao';
import { useMenu } from './components/Layout';
import type { Aba } from './lib/acesso';
import type { ReactNode } from 'react';

/** Cada tela só existe para quem o perfil deixa ver (o servidor confere de novo). */
const TELAS: [Aba, string, ReactNode][] = [
  ['inicio', '/inicio', <Inicio />],
  ['solicitacoes', '/solicitacoes', <Solicitacoes />],
  ['manutencao', '/manutencao', <Manutencao />],
  ['movimentacoes', '/movimentacoes', <Movimentacoes />],
  ['conferencia', '/conferencia', <ConferenciaMes />],
  ['calendario', '/calendario', <Calendario />],
  ['frotas', '/equipamentos', <Equipamentos />],
  ['frotas', '/frotas', <Frotas />],
  ['envio', '/envio', <Envio />],
  ['historico', '/historico', <Historico />],
  ['configuracoes', '/configuracoes', <Configuracoes />],
  ['clientes', '/clientes', <Clientes />],
  ['registro', '/registro', <Registro />],
  ['usuarios', '/usuarios', <Usuarios />],
];

function RotasLogado() {
  const { pode } = useEstado();
  const menu = useMenu();
  const primeira = pode('inicio') ? '/inicio' : (menu[0]?.rota ?? '/inicio');
  return (
    <Routes>
      <Route element={<Layout />}>
        {TELAS.filter(([aba]) => pode(aba, aba === 'envio' ? 2 : 1)).map(([, rota, tela]) => (
          <Route key={rota} path={rota} element={tela} />
        ))}
        {/* aprovações (quem aprova) ou "Minhas alterações" (quem propõe) */}
        <Route path="/aprovacoes" element={<Aprovacoes />} />
        <Route path="*" element={menu.length ? <Navigate to={primeira} replace /> : <SemAcesso />} />
      </Route>
    </Routes>
  );
}

function SemAcesso() {
  return (
    <div className="mx-auto mt-10 max-w-[480px] rounded-xl border border-line bg-white p-6">
      <h1 className="text-lg font-bold">Seu usuário ainda não tem acesso a nenhuma tela</h1>
      <p className="mt-2 text-ink-2">Peça ao administrador do sistema para ajustar o seu perfil em Usuários e permissões.</p>
    </div>
  );
}

function Rotas() {
  const { usuario, carregando, erroInicial } = useEstado();
  if (carregando) return <div className="p-10 text-ink-3">Carregando…</div>;
  if (erroInicial)
    return (
      <div className="mx-auto mt-16 max-w-[480px] rounded-xl border border-line bg-white p-6">
        <h1 className="text-lg font-bold">Não foi possível conectar ao servidor</h1>
        <p className="mt-2 text-ink-2">{erroInicial}</p>
        <p className="mt-2 text-[13px] text-ink-3">Tente de novo em alguns minutos. Se continuar, avise quem cuida do sistema.</p>
        <button type="button" className="btn-primary mt-4" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      </div>
    );
  if (!usuario) return <Login />;
  return <RotasLogado />;
}

export default function App() {
  return (
    <EstadoProvider>
      {/* HashRouter: funciona em qualquer hospedagem sem configurar o servidor */}
      <HashRouter>
        <Rotas />
      </HashRouter>
    </EstadoProvider>
  );
}
