import { useEstado } from '../state';
import { Carregar } from './envio/Carregar';
import { Conferencia } from './envio/Conferencia';

export function Envio() {
  const { lote } = useEstado();
  // key: ao trocar de lote, a conferência começa do zero (seleção, filtros)
  return lote ? <Conferencia key={lote.id} /> : <Carregar />;
}
