import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EstadoProvider, useEstado } from './state';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Envio } from './pages/Envio';
import { Clientes } from './pages/Clientes';
import { Historico } from './pages/Historico';

function Rotas() {
  const { usuario, carregando } = useEstado();
  if (carregando) return <div className="p-10 text-ink-3">Carregando…</div>;
  if (!usuario) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/envio" element={<Envio />} />
        <Route path="/clientes" element={<Clientes />} />
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
