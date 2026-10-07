"use client"
// src/components/operacao/RepactuarPrazoModal.tsx
// ============================================================================
// REPACTUAR PRAZO — Torre de Controle, Bloco D (29/09/2026). Único front-end
// para a porta que já existia (`POST /api/tarefas/[id]/comando`,
// `acao:"alterar_prazo"` → `alterarPrazo`, `lib/operacional/tarefa-ciclo.ts`):
// motivo obrigatório, autor e de/para gravados em LogAuditoria
// (`TAREFA_PRAZO_ALTERADO`), já lidos por "Andamento" — nenhuma gravação
// nova, só a interface que faltava.
//
// SÓ QUEM GERE (`tarefas.editar`) — mudar o prazo oficial é decisão de
// gestão, não do executor (mesma régua que já separa "Delegar" no cabeçalho
// deste drawer).
// ============================================================================

import { useState } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { CampoDataTexto } from "@/src/components/ui/campo-data-texto"

/** yyyy-mm-dd (input date) a partir de um ISO — sem hora, o próprio input não tem. */
function paraInputDate(iso: string | null): string {
  if (!iso) return ""
  return iso.slice(0, 10)
}

export function RepactuarPrazoModal({
  prazoAtualIso, onFechar, onEnviar,
}: {
  prazoAtualIso: string | null
  onFechar: () => void
  onEnviar: (dados: { novoPrazo: string | null; motivo: string }) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const [novoPrazo, setNovoPrazo] = useState(paraInputDate(prazoAtualIso))
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const motivoValido = motivo.trim().length >= 5
  const mudou = novoPrazo !== paraInputDate(prazoAtualIso)

  const confirmar = async () => {
    if (!motivoValido || !mudou) return
    setEnviando(true); setErro(null)
    try {
      // Meio-dia UTC (mesma convenção de `isoDoDia` em proximo-acontecimento.ts)
      // — nunca meia-noite, que vira o dia anterior no fuso operacional.
      const iso = novoPrazo ? `${novoPrazo}T12:00:00.000Z` : null
      const r = await onEnviar({ novoPrazo: iso, motivo: motivo.trim() })
      if (!r.ok) { setErro(r.mensagem ?? "Não foi possível repactuar o prazo."); return }
    } catch { setErro("Erro de conexão. O prazo não foi alterado.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[var(--border-default)]"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface-popover)] shadow-[var(--elev-3)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-extrabold text-white/95">Repactuar prazo</h3>
        <p className="text-[12px] text-[var(--text-secondary)]">É o prazo OFICIAL da tarefa — fica registrado no Andamento, de/para, com autor e motivo.</p>

        <label className="block space-y-1">
          <span className={rot}>Prazo atual</span>
          <div className="text-[13px] text-white/70">{prazoAtualIso ? new Date(prazoAtualIso).toLocaleDateString("pt-BR") : "Sem prazo"}</div>
        </label>

        <label className="block space-y-1">
          <span className={rot}>Novo prazo</span>
          <CampoDataTexto value={novoPrazo} onChange={setNovoPrazo} className={inp} />
        </label>

        <label className="block space-y-1">
          <span className={rot}>Motivo (obrigatório)</span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={inp} placeholder="Por que o prazo está mudando?" />
        </label>

        {erro && <div className="text-[12px] text-red-700 bg-[var(--surface-secondary)] rounded-lg px-3 py-2">{erro}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onFechar} disabled={enviando} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-white/68 hover:bg-[var(--surface-tertiary)]">Cancelar</button>
          <button onClick={confirmar} disabled={enviando || !motivoValido || !mudou} className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
            {enviando ? "Repactuando…" : "Repactuar prazo"}
          </button>
        </div>
      </div>
    </div>
  )
}
