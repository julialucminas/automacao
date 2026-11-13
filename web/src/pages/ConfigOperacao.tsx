import { ConfigChecklistEntrega, ConfigConferencia, RegrasManutencao } from '../components/RegrasManutencao';

/** Configurações da operação: regras da manutenção, janela da conferência e checklist da entrega. */
export function ConfigOperacao() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Configurações da operação</h1>
        <p className="text-[13px] text-ink-3">Tipos de visita e periféricos da manutenção, dias da conferência do mês e o checklist de quando a máquina sai para o cliente.</p>
      </div>
      <RegrasManutencao />
      <ConfigConferencia />
      <ConfigChecklistEntrega />
    </div>
  );
}
