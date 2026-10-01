"use client"
// src/components/torre/TorrePassosDaFase.tsx — cartão "Onde estão as N certidões desta fase — por passo" (aba Processos): caixas
// (Sem responsável · cada passo com tarefa aberta · Concluídas) e a frase do gargalo. Regras em `passosDaFase` (lib/operacional/torre-fase.ts).
import { milhar, type PassosDaFase } from "@/lib/operacional/torre-fase"
import "./torre-processos.css"

export function TorrePassosDaFase({ p }: { p: PassosDaFase }) {
  return (
    <section className="tor-pf-cartao" aria-label="Onde estão as certidões desta fase, por passo">
      <div className="tor-pf-rotulo">Onde estão as {milhar(p.total)} {p.substantivo} desta fase — por passo</div>
      <div className="tor-pf-caixas">
        {p.caixas.map((c) => (
          <div key={c.chave} className={`tor-pf-caixa ${c.classe}`}>
            <b>{c.n > 0 ? milhar(c.n) : ""}</b>
            <strong>{c.nome}</strong>
            <span>{c.obs}</span>
          </div>
        ))}
      </div>
      <div className="tor-pf-texto">{p.gargalo}</div>
    </section>
  )
}
