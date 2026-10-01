"use client"
// src/components/torre/ProcessoCaminho.tsx — "Caminho do processo" (as fases do Workflow Macro do processo) e os cinco cartões
// (Passo atual · Com quem · Prazo · Cartórios · Fora do jogo). Os textos nascem de `torre-caminho.ts` e `torre-processo-puro.ts` (puros).
import { textosDaFase } from "@/lib/operacional/torre-caminho"
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"

export function ProcessoCaminho({ d, agora }: { d: DetalheDoProcesso; agora: Date }) {
  const fases = d.caminho.fases
  return (
    <>
      <div className="tpr-bloco">
        <div className="rot">Caminho do processo</div>
        {fases.length === 0
          ? <div className="tpr-13 tpr-mut">Este processo não tem Workflow Macro cadastrado para o tipo e a modalidade dele — o caminho não pode ser desenhado.</div>
          : (
            <div className="tpr-caminho" style={{ gridTemplateColumns: `repeat(${fases.length}, minmax(96px, 1fr))` }}>
              {fases.map((f) => {
                const atual = f.estado === "atual"
                const t = textosDaFase(f, agora, atual ? { tempoNaFase: textoTempoNaFase(d.faseAtual), certidoes: d.certidoes } : {})
                return (
                  <div key={f.phaseKey} className={`tpr-fase ${f.estado}`} data-fase={f.phaseKey} data-estado={f.estado}>
                    <div className="l1">{t.l1}</div>
                    <div className="l2">{t.l2}</div>
                    {t.l3 && <div className="l3">{t.l3}</div>}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      <div className="tpr-cinco">
        {d.cartoes.map((c) => (
          <div key={c.rotulo} className="tpr-cartao">
            <span className="rot">{c.rotulo}</span>
            <span className={`tit ${c.tom === "normal" ? "" : c.tom}`}>{c.titulo}</span>
            <span className="sub">{c.sub}</span>
          </div>
        ))}
      </div>
    </>
  )
}
