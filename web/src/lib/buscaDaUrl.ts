import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/** A busca do topo abre a tela com ?busca=...; a tela preenche o próprio campo de busca com isso. */
export function useBuscaDaUrl(definir: (v: string) => void) {
  const [params] = useSearchParams();
  const v = params.get('busca');
  useEffect(() => {
    if (v !== null) definir(v);
  }, [v, definir]);
}
