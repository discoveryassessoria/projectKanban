"use client"
// src/components/torre/TorreBriefing.tsx — o BRIEFING DO DIA (Bloco J2 · texto do Bloco F, gerado dos números reais).
import { Modal } from "./torre-base"

export function TorreBriefing({ texto, n, onRevisar, onFechar }: { texto: string; n: number; onRevisar: () => void; onFechar: () => void }) {
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })
  return (
    <Modal titulo={`Briefing · ${hoje}`} onFechar={onFechar} rodape={<>
      <button className="tor-btn pri" onClick={onRevisar} disabled={n === 0}>▶ Revisar o dia ({n} decisões)</button>
      <button className="tor-btn" onClick={onFechar}>Ver a Torre</button>
    </>}>
      <div style={{ borderLeft: "4px solid var(--action-primary)", padding: "12px 16px", fontSize: 14, lineHeight: 1.55 }}>{texto}</div>
    </Modal>
  )
}
