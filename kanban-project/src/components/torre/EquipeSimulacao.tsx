"use client"
// src/components/torre/EquipeSimulacao.tsx — o cartão "Simulação: se X sair N dias" (SÓ LEITURA até o gestor clicar em Aplicar).
import { NOTA_SIMULACAO } from "./equipe-visual"
import type { SimulacaoDeSaida } from "./equipe-tipos"
import "./equipe.css"

export function EquipeSimulacao({ sim, podeEditar, ocupado, onAplicar, onFechar }: {
  sim: SimulacaoDeSaida; podeEditar: boolean; ocupado: boolean; onAplicar: () => void; onFechar: () => void
}) {
  return (
    <div className="eqp-sim" role="region" aria-label="Simulação de saída">
      <h2>Simulação: se {sim.nome} sair {sim.dias} dias</h2>
      <div className="eqp-sim-txt">{sim.texto}</div>
      <div className="eqp-sim-nota">{NOTA_SIMULACAO}</div>
      <div className="eqp-sim-bts">
        {podeEditar && <button className="eqp-btn pri gr" disabled={ocupado} onClick={onAplicar}>Aplicar: marcar ausência e mover carteira</button>}
        <button className="eqp-btn gr" onClick={onFechar}>Fechar</button>
      </div>
    </div>
  )
}
