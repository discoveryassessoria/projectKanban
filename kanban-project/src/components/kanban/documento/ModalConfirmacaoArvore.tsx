"use client"
// src/components/kanban/documento/ModalConfirmacaoArvore.tsx
// ============================================================================
// CONFIRMAÇÃO ÁRVORE × CADASTRO (07/10/2026). O servidor recusou a gravação (409 `CONFIRMACAO_ARVORE`) porque o valor digitado difere do da árvore. Aqui a pessoa
// ESCOLHE — nenhum botão vem marcado e nada confirma sozinho:
//   «O correto é o da árvore»                → a Genealogia assume o valor da árvore; o digitado não é salvo.
//   «O correto é o que estou cadastrando»    → salva e corrige a árvore.
//   «Cancelar»                               → não salva nada.
// Com mais de uma divergência, escolhe-se uma opção em cada e confirma-se em «Salvar com estas escolhas» (só habilita com todas escolhidas).
// ============================================================================
import { useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"

export interface DivergenciaDaArvore {
  chave: string
  rotulo: string
  pessoaNome: string
  arvoreTexto: string
  digitadoTexto: string
}
export type EscolhasDaArvore = Record<string, "ARVORE" | "CADASTRO">

/** Lê a resposta 409 do servidor: as divergências, ou `null` se a resposta é outra coisa. */
export function divergenciasDaResposta(status: number, corpo: unknown): DivergenciaDaArvore[] | null {
  if (status !== 409 || !corpo || typeof corpo !== "object") return null
  const c = corpo as { codigo?: string; divergencias?: DivergenciaDaArvore[] }
  return c.codigo === "CONFIRMACAO_ARVORE" && Array.isArray(c.divergencias) && c.divergencias.length > 0 ? c.divergencias : null
}

export function ModalConfirmacaoArvore({ divergencias, onDecidir, onCancelar, salvando = false }: {
  divergencias: DivergenciaDaArvore[]
  onDecidir: (escolhas: EscolhasDaArvore) => void
  onCancelar: () => void
  salvando?: boolean
}) {
  const [escolhas, setEscolhas] = useState<EscolhasDaArvore>({})
  const unica = divergencias.length === 1
  const completo = divergencias.every((d) => escolhas[d.chave] != null)
  const escolher = (chave: string, opcao: "ARVORE" | "CADASTRO") => {
    if (unica) { onDecidir({ [chave]: opcao }); return }
    setEscolhas((e) => ({ ...e, [chave]: opcao }))
  }
  const cls = (ativo: boolean) => `px-3 py-2 rounded-md text-[12.5px] font-semibold border disabled:opacity-50 ${ativo ? "bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]" : "border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"}`

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: LAYER.popover }} data-testid="modal-confirmacao-arvore" role="dialog" aria-modal="true" aria-label="Confirmar divergência com a árvore">
      <div className="w-[520px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-1">O dado difere da árvore</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">Escolha qual é o correto. Nada é salvo antes da sua escolha.</p>
        <div className="space-y-4">
          {divergencias.map((d) => (
            <div key={d.chave} data-testid={`divergencia-${d.chave}`} className="rounded-md border border-[var(--border-default)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)] mb-1">{d.pessoaNome} · {d.rotulo}</div>
              <p className="text-[13px] text-[var(--text-primary)] mb-2.5">
                Na árvore está: <b data-testid="valor-arvore">{d.arvoreTexto}</b>. Você está cadastrando: <b data-testid="valor-digitado">{d.digitadoTexto}</b>. Qual é o correto?
              </p>
              <div className="flex gap-2 flex-wrap">
                <button type="button" disabled={salvando} data-testid="opcao-arvore" aria-pressed={escolhas[d.chave] === "ARVORE"} onClick={() => escolher(d.chave, "ARVORE")} className={cls(escolhas[d.chave] === "ARVORE")}>O correto é o da árvore</button>
                <button type="button" disabled={salvando} data-testid="opcao-cadastro" aria-pressed={escolhas[d.chave] === "CADASTRO"} onClick={() => escolher(d.chave, "CADASTRO")} className={cls(escolhas[d.chave] === "CADASTRO")}>O correto é o que estou cadastrando</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" disabled={salvando} data-testid="opcao-cancelar" onClick={onCancelar} className="px-3 py-2 rounded-md text-[12.5px] border border-[var(--border-default)] text-[var(--text-primary)]">Cancelar</button>
          {!unica && (
            <button type="button" disabled={!completo || salvando} data-testid="salvar-com-escolhas" onClick={() => onDecidir(escolhas)} className="px-3 py-2 rounded-md text-[12.5px] font-semibold bg-[var(--accent-primary)] text-white disabled:opacity-50">Salvar com estas escolhas</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
