"use client"
// src/components/torre/TorrePassosDaFase.tsx — cartão "Onde estão as N certidões desta fase — por passo" (aba Processos): caixas
// (cada passo REAL com tarefa aberta · Concluídas) + uma linha à parte para as sem responsável (que não são um passo) e a frase do gargalo. Regras em `passosDaFase` (lib/operacional/torre-fase.ts).
import { milhar, type PassosDaFase } from "@/lib/operacional/torre-fase"
import "./torre-processos.css"

export function TorrePassosDaFase({ p }: { p: PassosDaFase }) {
  return (
    <section className="tor-pf-cartao" aria-label="Onde estão as certidões dos processos desta fase, por passo">
      <div className="tor-pf-rotulo">Onde estão as {milhar(p.total)} {p.substantivo} dos processos desta fase — por passo</div>
      <div className="tor-pf-caixas">
        {p.caixas.map((c) => (
          <div key={c.chave} className={`tor-pf-caixa ${c.classe}`}>
            <b>{c.n > 0 ? milhar(c.n) : ""}</b>
            <strong>{c.nome}</strong>
            <span>{c.obs}</span>
          </div>
        ))}
      </div>
      {p.semResponsavel > 0 && (
        <div className="tor-pf-semresp">
          {milhar(p.semResponsavel)} {p.substantivo === "certidões" ? (p.semResponsavel === 1 ? "certidão" : "certidões") : (p.semResponsavel === 1 ? "tarefa" : "tarefas")} sem responsável — ainda não entram em nenhum passo acima
        </div>
      )}
      <div className="tor-pf-texto">{p.gargalo}</div>
    </section>
  )
}
