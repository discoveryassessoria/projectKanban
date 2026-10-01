"use client"
// src/components/torre/TorreBriefing.tsx — o BRIEFING DO DIA (Bloco J2 · texto do Bloco F, gerado no servidor dos números reais).
// Idêntico ao protótipo: título "Briefing · quarta-feira, 30 de setembro", o texto, e os botões "Ver a Torre" e "▶ Revisar o dia (N decisões)".
// SÓ ABRE POR PEDIDO (botão "Briefing do dia" do cabeçalho): nada abre sozinho ao entrar na Torre.
import { useSyncExternalStore } from "react"
import { PdvModal } from "./pdv-modal"

/** "quarta-feira, 30 de setembro" — no fuso da operação (nunca o do ambiente). */
const dataDeHoje = (): string => new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" })
const semAssinatura = () => () => undefined

export function TorreBriefing({ texto, n, onRevisar, onFechar }: { texto: string; n: number; onRevisar: () => void; onFechar: () => void }) {
  // A data só existe no cliente (o servidor não a conhece): o 1º render coincide com o do servidor e a data entra logo depois.
  const hoje = useSyncExternalStore(semAssinatura, dataDeHoje, () => null)
  return (
    <PdvModal rotulo="Briefing do dia" classe="brief" onFechar={onFechar}>
      <div className="pdv-modal-t">{hoje ? `Briefing · ${hoje}` : "Briefing"}</div>
      <div className="pdv-brief-txt">{texto}</div>
      <div className="pdv-brief-ac">
        <button className="pdv-m3" onClick={onFechar}>Ver a Torre</button>
        <button className="pdv-m1" onClick={onRevisar} disabled={n === 0}>▶ Revisar o dia ({n} {n === 1 ? "decisão" : "decisões"})</button>
      </div>
    </PdvModal>
  )
}
