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
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/envio" element={<Envio />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/calendario" element={<Calendario />} />
        <Route path="/frotas" element={<Frotas />} />
        <Route path="/solicitacoes" element={<Solicitacoes />} />
        <Route path="/historico" element={<Historico />} />
        <Route path="*" element={<Navigate to="/envio" replace />} />
      </Route>
    </Routes>
  );
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
