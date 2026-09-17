"use client"
// src/components/kanban/workflow/ReabrirSubtarefaModal.tsx
//
// REABRIR UMA SUBTAREFA — mesma régua visual do `ReabrirEtapaModal`, um nível
// abaixo. Achado real (16/09/2026): o botão "Reabrir" de uma subtarefa usava
// `window.prompt` — sem identidade, sem histórico, sem mostrar o que a
// cascata de dependência ia afetar. Desde que a reabertura passou a bloquear
// em cascata as subtarefas dependentes já concluídas, esconder isso do
// administrador que confirma deixou de ser uma opção.

import { useCallback, useEffect, useState } from "react"

interface Plano {
  identidade: {
    faseLabel: string
    pessoaNome: string | null
    documentoTitulo: string | null
    documentoId: number | null
    stepTitulo: string
    stepKey: string
    subtaskLabel: string
    subtaskKey: string
  }
  podeReabrir: boolean
  motivoNaoPode: string | null
  passoSeraReaberto: boolean
  execucoes: Array<{
    sequencia: number; status: string; motivo: string
    startedAt: string | null; completedAt: string | null
    executadoPorNome: string | null; resultado: string | null
  }>
  dependentes: Array<{ key: string; label: string; status: string }>
  aviso: string
}

const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") ?? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export default function ReabrirSubtarefaModal({
  stepInstanceId, subtaskKey, onFechar, onReaberto,
}: {
  stepInstanceId: number
  subtaskKey: string
  onFechar: () => void
  onReaberto: () => void
}) {
  const [plano, setPlano] = useState<Plano | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [justificativa, setJustificativa] = useState("")
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/workflow-step-instances/${stepInstanceId}/subtarefas/${encodeURIComponent(subtaskKey)}/reabrir`,
        { headers: headers() },
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.plano) { setErro(j?.error ?? j?.mensagem ?? "Não foi possível carregar esta subtarefa."); return }
      setPlano(j.plano as Plano)
    } catch { setErro("Erro de conexão ao carregar esta subtarefa.") }
    finally { setCarregando(false) }
  }, [stepInstanceId, subtaskKey])

  useEffect(() => {
    let vivo = true
    void Promise.resolve().then(() => { if (vivo) return carregar() })
    return () => { vivo = false }
  }, [carregar])

  async function confirmar() {
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(
        `/api/workflow-step-instances/${stepInstanceId}/subtarefas/${encodeURIComponent(subtaskKey)}/reabrir`,
        {
          method: "POST", headers: headers(),
          body: JSON.stringify({
            justificativa,
            correlationId: `reabrir-sub|si${stepInstanceId}|${subtaskKey}|${plano?.execucoes.length ?? 0}`,
          }),
        },
      )
      const j = await r.json()
      if (!j.ok) { setErro(j.mensagem ?? j.error ?? "Não foi possível reabrir."); return }
      onReaberto()
    } catch { setErro("Erro de conexão. Nada foi reaberto.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[var(--border-default)]"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
  const atual = plano?.execucoes.find((e) => e.status !== "SUPERSEDIDO") ?? plano?.execucoes[plano.execucoes.length - 1] ?? null
  const podeConfirmar = !enviando && !!plano?.podeReabrir && justificativa.trim().length >= 5

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-[var(--overlay-modal)] px-4" onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reabrir subtarefa">
        <div className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-white/95">Reabrir subtarefa</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Uma execução nova começa. A atual é arquivada com o que foi registrado nela — nada é apagado.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {carregando && <div className="text-[13px] text-[var(--text-secondary)]">Carregando…</div>}

          {plano && (
            <>
              {/* DE QUEM É O TRABALHO */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-3">
                <div><div className={rot}>Fase</div><div className="text-[13px] text-white/90">{plano.identidade.faseLabel}</div></div>
                <div><div className={rot}>Pessoa</div><div className="text-[13px] text-white/90">{plano.identidade.pessoaNome ?? "—"}</div></div>
                <div className="col-span-2">
                  <div className={rot}>Documento</div>
                  <div className="text-[13px] text-white/90">
                    {plano.identidade.documentoTitulo ?? "—"}
                    {plano.identidade.documentoId && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">#{plano.identidade.documentoId}</span>}
                  </div>
                </div>
                <div><div className={rot}>Passo</div><div className="text-[13px] text-white/90">{plano.identidade.stepTitulo}</div></div>
                <div><div className={rot}>Subtarefa</div><div className="text-[13px] text-white/90">{plano.identidade.subtaskLabel}</div></div>
              </div>

              {/* O QUE JÁ HOUVE NESTA SUBTAREFA */}
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-3">
                <div className={rot}>Execução anterior</div>
                {atual ? (
                  <div className="mt-1 text-[12.5px] text-white/80">
                    Execução {atual.sequencia} · {atual.status.toLowerCase()}
                    {atual.completedAt && ` · concluída em ${data(atual.completedAt)}`}
                    {atual.executadoPorNome && ` · por ${atual.executadoPorNome}`}
                    {atual.resultado && ` · resultado: ${atual.resultado}`}
                  </div>
                ) : <div className="mt-1 text-[12.5px] text-[var(--text-secondary)]">Sem execução registrada.</div>}
                {plano.execucoes.length > 1 && (
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {plano.execucoes.length} execuções no histórico desta subtarefa; a próxima será a {plano.execucoes.length + 1}ª.
                  </div>
                )}
              </div>

              {!plano.podeReabrir && (
                <div className="rounded-lg border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-3 py-2.5 text-[12.5px] text-[var(--accent-text)]">
                  {plano.motivoNaoPode}
                </div>
              )}

              {plano.podeReabrir && (
                <>
                  {/* PREVIEW EXATO — o que a confirmação vai fazer. */}
                  <div className="rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 px-3 py-3 text-[12px]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-text)]">Vai voltar a disponível</div>
                    <div className="mt-1 text-white/85">
                      {plano.identidade.pessoaNome ?? "—"}
                      <div className="ml-3">→ {plano.identidade.documentoTitulo ?? "—"}</div>
                      <div className="ml-6">→ {plano.identidade.stepTitulo}</div>
                      <div className="ml-9">→ {plano.identidade.subtaskLabel}</div>
                    </div>
                    {plano.passoSeraReaberto && (
                      <div className="mt-2 text-[11.5px] text-white/80">
                        O passo <strong>{plano.identidade.stepTitulo}</strong> já estava concluído — ele também volta a ficar aberto.
                      </div>
                    )}
                    {plano.dependentes.length > 0 && (
                      <>
                        <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--accent-text)]">
                          Também bloqueadas (dependiam desta e já estavam concluídas)
                        </div>
                        <div className="mt-1 text-white/85">
                          {plano.dependentes.map((d) => (
                            <div key={d.key} className="ml-3">→ {d.label}</div>
                          ))}
                        </div>
                      </>
                    )}
                    <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{plano.aviso}</p>
                  </div>

                  <label className="block">
                    <span className={rot}>Justificativa * (mínimo 5 caracteres)</span>
                    <textarea className={`${inp} mt-1 resize-y`} rows={3} value={justificativa}
                      onChange={(e) => setJustificativa(e.target.value.slice(0, 400))}
                      placeholder="ex.: certidão recebida com o nome da mãe errado; refazer o pedido" />
                  </label>
                </>
              )}
            </>
          )}

          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-[12.5px] text-red-700">{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-4">
          <button onClick={onFechar} disabled={enviando}
            className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-[12.5px] font-semibold text-white/80 hover:bg-[var(--surface-hover)] disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={() => void confirmar()} disabled={!podeConfirmar}
            className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-[12.5px] font-bold text-[#1b2027] hover:bg-[#e0bd6a] disabled:opacity-40">
            {enviando ? "Reabrindo…" : "Confirmar reabertura"}
          </button>
        </div>
      </div>
    </div>
  )
}
