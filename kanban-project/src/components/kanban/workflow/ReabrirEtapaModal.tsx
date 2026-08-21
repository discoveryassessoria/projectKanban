"use client"
// src/components/kanban/workflow/ReabrirEtapaModal.tsx
//
// REABRIR UMA ETAPA — o ato explícito, com o impacto na frente.
//
// Aqui havia um `confirm()` do navegador com três linhas de texto escritas à mão,
// que afirmavam o que ia acontecer sem perguntar ao servidor: "bloquear a próxima
// etapa ativa", "manter concluídas posteriores intactas". Eram descrições da
// intenção, não do efeito — e o efeito depende das dependências CADASTRADAS, que a
// tela não conhecia.
//
// Agora o impacto vem calculado do servidor, pelo mesmo grafo que o motor executa:
// o que é reexecutado, o que é reavaliado por depender disso, o que é herdado e o
// que fica onde está. E a execução anterior é dita pelo que ela é — arquivada, não
// apagada.

import { useCallback, useEffect, useState } from "react"

interface Preview {
  passo: { id: number; stepKey: string; status: string; fase: string; ciclo: number }
  seraReexecutado: Array<{ id: number; stepKey: string; status: string }>
  seraoReavaliados: Array<{ id: number; stepKey: string; status: string }>
  herdados: Array<{ id: number; stepKey: string; status: string }>
  intactos: Array<{ id: number; stepKey: string; status: string }>
  execucoesAnteriores: number
  aviso: string
}

const ROTULO: Record<string, string> = {
  CONCLUIDO: "concluída", EM_ANDAMENTO: "em execução", DISPONIVEL: "disponível",
  BLOQUEADO: "aguardando dependência", PENDENTE: "pendente", AGUARDANDO: "aguardando terceiro",
}

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") ?? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

const lista = (v: Array<{ stepKey: string }>) => (v.length ? v.map((x) => x.stepKey).join(" · ") : "nenhuma")

export default function ReabrirEtapaModal({
  stepInstanceId, titulo, onFechar, onReaberto,
}: {
  stepInstanceId: number
  titulo: string
  onFechar: () => void
  onReaberto: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [justificativa, setJustificativa] = useState("")
  const [comDependentes, setComDependentes] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reexecutar`, { headers: headers() })
      if (!r.ok) { setErro("Não foi possível calcular o impacto da reabertura."); return }
      setPreview(await r.json())
    } catch { setErro("Erro de conexão ao calcular o impacto.") }
    finally { setCarregando(false) }
  }, [stepInstanceId])

  useEffect(() => {
    let vivo = true
    void Promise.resolve().then(() => { if (vivo) return carregar() })
    return () => { vivo = false }
  }, [carregar])

  async function confirmar() {
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reexecutar`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          justificativa,
          // A correlação é do PASSO e da execução atual: reenviar o mesmo comando não
          // abre uma segunda execução.
          correlationId: `reabrir|si${stepInstanceId}|${preview?.execucoesAnteriores ?? 0}`,
        }),
      })
      const j = await r.json()
      if (!j.ok) { setErro(j.mensagem ?? j.error ?? "Não foi possível reabrir."); return }
      onReaberto()
    } catch { setErro("Erro de conexão. Nada foi reaberto.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-white/10 bg-[#15191f] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[#7dd3fc]/50"

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/60 px-4" onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-[540px] max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#1b2027] shadow-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reabrir etapa">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-white/95">Reabrir “{titulo}”</h2>
          <p className="mt-0.5 text-[12px] text-white/50">
            Reabrir cria uma execução NOVA. A execução atual é arquivada com o que foi registrado nela — nada é apagado.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {carregando && <div className="text-[13px] text-white/50">Calculando o impacto…</div>}

          {preview && (
            <div className="rounded-lg border border-[#d2a948]/30 bg-[#d2a948]/5 px-3 py-3 text-[12px]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#d2a948]">O que a reabertura faz</div>
              <ul className="mt-1.5 space-y-1 text-white/75">
                <li>Reexecutada: <b>{lista(preview.seraReexecutado)}</b></li>
                <li>Reavaliadas por dependerem dela: <b>{lista(preview.seraoReavaliados)}</b></li>
                <li>Herdadas (continuam valendo): <b>{lista(preview.herdados)}</b></li>
                <li>Intactas: <b>{lista(preview.intactos)}</b></li>
              </ul>
              <p className="mt-2 text-[11.5px] text-white/45">{preview.aviso}</p>
              {preview.execucoesAnteriores > 1 && (
                <p className="mt-1 text-[11.5px] text-white/45">
                  Esta obrigação já teve {preview.execucoesAnteriores} execuções; a próxima será a {preview.execucoesAnteriores + 1}ª.
                </p>
              )}
              <p className="mt-1 text-[11.5px] text-white/45">
                Estado atual: {ROTULO[preview.passo.status] ?? preview.passo.status.toLowerCase()}.
              </p>
            </div>
          )}

          {preview && preview.seraoReavaliados.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={comDependentes} onChange={(e) => setComDependentes(e.target.checked)} />
              <span className="text-[12.5px] text-white/80">
                Reabrir a cadeia dependente
                <span className="block text-[11px] text-white/45">
                  As etapas acima dependem desta pelo cadastro; enquanto ela não concluir de novo, elas ficam aguardando.
                </span>
              </span>
            </label>
          )}

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Por quê *</span>
            <textarea className={`${inp} mt-1 resize-y`} rows={3} value={justificativa}
              onChange={(e) => setJustificativa(e.target.value.slice(0, 400))}
              placeholder="ex.: certidão recebida com o nome da mãe errado; refazer o pedido" />
          </label>

          {erro && (
            <div className="rounded-lg border border-[#f87171]/40 bg-[#f87171]/10 px-3 py-2.5 text-[12.5px] text-[#f87171]">{erro}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button onClick={onFechar} disabled={enviando}
            className="rounded-lg border border-white/10 px-4 py-2 text-[12.5px] font-semibold text-white/80 hover:bg-white/5 disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={() => void confirmar()} disabled={enviando || justificativa.trim().length < 5 || !preview}
            className="rounded-lg bg-[#d2a948] px-4 py-2 text-[12.5px] font-bold text-[#1b2027] hover:bg-[#e0bd6a] disabled:opacity-40">
            {enviando ? "Reabrindo…" : "Confirmar reabertura"}
          </button>
        </div>
      </div>
    </div>
  )
}
