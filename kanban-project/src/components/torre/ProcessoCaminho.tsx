"use client"
// src/components/torre/ProcessoCaminho.tsx — "Caminho do processo" (as fases do Workflow Macro do processo) e os cinco cartões
// (Passo atual · Com quem · Prazo · Cartórios · Cancelada / não exigida — este último é um botão que liga e desliga a exibição dessas certidões na lista). Os textos nascem de `torre-caminho.ts` e `torre-processo-puro.ts` (puros).
import { textosDaFase } from "@/lib/operacional/torre-caminho"
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import { ROTULO_ENCERRADAS, contaDaFase, textoDaContaDaFase } from "@/lib/operacional/torre-processo-puro"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"

export function ProcessoCaminho({ d, agora, encerradasNaLista, onAlternarEncerradas, faseSelecionada, onFase }: { d: DetalheDoProcesso; agora: Date; encerradasNaLista: boolean; onAlternarEncerradas: () => void; faseSelecionada: string | null; onFase: (phaseKey: string | null) => void }) {
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
                const conta = contaDaFase(d.tabela, f.phaseKey)
                const escolhida = faseSelecionada === f.phaseKey
                return (
                  <button key={f.phaseKey} type="button" className={`tpr-fase tpr-fase-bt ${f.estado} ${escolhida ? "escolhida" : ""}`} data-fase={f.phaseKey} data-estado={f.estado}
                    aria-pressed={escolhida} title={escolhida ? "Clique para voltar a ver todas as fases" : `Clique para ver só as tarefas abertas de ${f.label}`}
                    onClick={() => onFase(escolhida ? null : f.phaseKey)}>
                    <div className="l1">{t.l1}</div>
                    <div className="l2">{t.l2}</div>
                    {t.l3 && <div className="l3">{t.l3}</div>}
                    <div className="conta" data-conta={f.phaseKey}>{textoDaContaDaFase(conta)}</div>
                  </button>
                )
              })}
            </div>
          )}
      </div>

      <div className="tpr-cinco">
        {d.cartoes.map((c) => {
          const miolo = (
            <>
              <span className="rot">{c.rotulo}</span>
              <span className={`tit ${c.tom === "normal" ? "" : c.tom}`}>{c.titulo}</span>
              <span className="sub">{c.sub}</span>
            </>
          )
          if (c.rotulo !== ROTULO_ENCERRADAS) return <div key={c.rotulo} className="tpr-cartao">{miolo}</div>
          const temEncerradas = d.tabela.some((l) => l.tipo === "CANCELADA" || l.tipo === "NAO_EXIGIDA")
          return (
            <button key={c.rotulo} type="button" className={`tpr-cartao tpr-cartao-bt ${encerradasNaLista ? "ligado" : ""}`} aria-pressed={encerradasNaLista} disabled={!temEncerradas}
              title={!temEncerradas ? "Nenhuma certidão cancelada nem dispensada pela árvore." : encerradasNaLista ? "Clique para voltar à lista só com as certidões ativas." : "Clique para mostrar essas certidões na lista, riscadas e no fim."}
              onClick={onAlternarEncerradas}>
              {miolo}
            </button>
          )
        })}
      </div>
    </>
  )
}
