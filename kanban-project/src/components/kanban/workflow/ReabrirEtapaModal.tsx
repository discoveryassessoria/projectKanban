"use client"
// src/components/kanban/workflow/ReabrirEtapaModal.tsx
//
// REABRIR UMA TAREFA — desta pessoa, deste documento, desta etapa.
//
// A tela precisa dizer, sem ambiguidade, DE QUEM é o trabalho que vai ser refeito.
// "Reabrir Solicitar certidão" não é um comando: numa Emissão com cinquenta certidões,
// é ambíguo entre cinquenta. Por isso o cabeçalho mostra fase, pessoa, documento e
// etapa — e o rodapé diz quantas outras unidades NÃO serão tocadas.
//
// O impacto vem calculado do servidor, pelo mesmo grafo que o motor executa e no mesmo
// escopo de unidade: a cadeia dependente é a DESTE documento, nunca a das etapas
// homônimas dos outros.

import { useCallback, useEffect, useState } from "react"

interface Plano {
  identidade: {
    faseLabel: string
    ciclo: number
    pessoaNome: string | null
    documentoTitulo: string | null
    documentoId: number | null
    stepTitulo: string
    stepKey: string
  }
  podeReabrir: boolean
  motivoNaoPode: string | null
  estrategiaPadrao: string
  exigeJustificativa: boolean
  execucoes: Array<{
    sequencia: number; status: string; motivo: string
    iniciadaEm: string | null; concluidaEm: string | null
    executadoPorNome: string | null; resultado: string | null
  }>
  dependentesDaMesmaUnidade: Array<{ stepInstanceId: number; stepKey: string; titulo: string; status: string }>
  outrasUnidadesNaFase: number
  aviso: string
}

interface Motivo { codigo: string; label: string; descricao: string }

const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") ?? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export default function ReabrirEtapaModal({
  stepInstanceId, onFechar, onReaberto,
}: {
  stepInstanceId: number
  onFechar: () => void
  onReaberto: () => void
}) {
  const [plano, setPlano] = useState<Plano | null>(null)
  const [motivos, setMotivos] = useState<Motivo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [motivoCodigo, setMotivoCodigo] = useState("")
  const [justificativa, setJustificativa] = useState("")
  const [comDependentes, setComDependentes] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reabrir`, { headers: headers() })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.plano) { setErro(j?.error ?? "Não foi possível carregar esta tarefa."); return }
      setPlano(j.plano as Plano)
      setMotivos((j.motivos ?? []) as Motivo[])
      // A estratégia CADASTRADA é a sugestão; a decisão continua sendo de quem confirma.
      setComDependentes((j.plano as Plano).estrategiaPadrao === "ESTA_E_DEPENDENTES")
    } catch { setErro("Erro de conexão ao carregar esta tarefa.") }
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
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reabrir`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          motivoCodigo, justificativa, comDependentes,
          // A correlação inclui quantas execuções já havia: o mesmo comando reenviado
          // (duplo clique, segunda aba, retry) não abre uma execução a mais.
          correlationId: `reabrir|si${stepInstanceId}|${plano?.execucoes.length ?? 0}`,
        }),
      })
      const j = await r.json()
      if (!j.ok) { setErro(j.mensagem ?? j.error ?? "Não foi possível reabrir."); return }
      onReaberto()
    } catch { setErro("Erro de conexão. Nada foi reaberto.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[var(--border-default)]"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
  const atual = plano?.execucoes.find((e) => e.status !== "SUPERSEDIDO") ?? plano?.execucoes[plano.execucoes.length - 1] ?? null
  const podeConfirmar =
    !enviando && !!plano?.podeReabrir && !!motivoCodigo &&
    (!plano.exigeJustificativa || justificativa.trim().length >= 5)

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-[var(--overlay-modal)] px-4" onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reabrir tarefa">
        <div className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-white/95">Reabrir tarefa</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Uma execução nova começa. A atual é arquivada com o que foi registrado nela — nada é apagado.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {carregando && <div className="text-[13px] text-[var(--text-secondary)]">Carregando…</div>}

          {plano && (
            <>
              {/* DE QUEM É O TRABALHO — a identidade, antes de tudo. */}
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
                <div className="col-span-2"><div className={rot}>Passo</div><div className="text-[13px] text-white/90">{plano.identidade.stepTitulo}</div></div>
              </div>

              {/* O QUE JÁ HOUVE NESTA UNIDADE */}
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-3">
                <div className={rot}>Execução anterior</div>
                {atual ? (
                  <div className="mt-1 text-[12.5px] text-white/80">
                    Execução {atual.sequencia} · {atual.status.toLowerCase()}
                    {atual.concluidaEm && ` · concluída em ${data(atual.concluidaEm)}`}
                    {atual.executadoPorNome && ` · por ${atual.executadoPorNome}`}
                    {atual.resultado && ` · resultado: ${atual.resultado}`}
                  </div>
                ) : <div className="mt-1 text-[12.5px] text-[var(--text-secondary)]">Sem execução registrada.</div>}
                {plano.execucoes.length > 1 && (
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {plano.execucoes.length} execuções no histórico desta tarefa; a próxima será a {plano.execucoes.length + 1}ª.
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
                  <div>
                    <div className={rot}>O que reabrir</div>
                    <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2">
                      <input type="radio" className="mt-0.5" checked={!comDependentes} onChange={() => setComDependentes(false)} />
                      <span className="text-[12.5px] text-white/85">
                        Reabrir somente esta tarefa
                        <span className="block text-[11px] text-[var(--text-muted)]">Nenhuma outra etapa é tocada.</span>
                      </span>
                    </label>
                    <label className={`mt-1.5 flex items-start gap-2 rounded-lg border px-3 py-2 ${plano.dependentesDaMesmaUnidade.length ? "cursor-pointer border-[var(--border-default)] bg-[var(--surface-popover)]" : "cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-popover)]/50 opacity-50"}`}>
                      <input type="radio" className="mt-0.5" disabled={!plano.dependentesDaMesmaUnidade.length}
                        checked={comDependentes} onChange={() => setComDependentes(true)} />
                      <span className="text-[12.5px] text-white/85">
                        Reabrir esta tarefa e as que dependem dela
                        <span className="block text-[11px] text-[var(--text-muted)]">
                          {plano.dependentesDaMesmaUnidade.length
                            ? "Só as deste documento — as etapas de mesmo nome dos outros documentos não são tocadas."
                            : "Nenhuma etapa depende desta."}
                        </span>
                      </span>
                    </label>
                  </div>

                  {/* PREVIEW EXATO — o que vai acontecer, com nome e sobrenome. */}
                  <div className="rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 px-3 py-3 text-[12px]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-text)]">Será criada nova execução para</div>
                    <div className="mt-1 text-white/85">
                      {plano.identidade.pessoaNome ?? "—"}
                      <div className="ml-3">→ {plano.identidade.documentoTitulo ?? "—"}</div>
                      <div className="ml-6">→ {plano.identidade.stepTitulo}</div>
                    </div>
                    {comDependentes && plano.dependentesDaMesmaUnidade.length > 0 && (
                      <>
                        <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--accent-text)]">Também serão afetados</div>
                        <div className="mt-1 text-white/85">
                          {plano.dependentesDaMesmaUnidade.map((d) => (
                            <div key={d.stepInstanceId} className="ml-3">→ {d.titulo}</div>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="mt-2 font-semibold text-white/70">
                      {plano.outrasUnidadesNaFase > 0
                        ? `Nenhuma outra unidade será alterada — as outras ${plano.outrasUnidadesNaFase} desta fase ficam exatamente como estão.`
                        : "Nenhuma outra unidade será alterada."}
                    </div>
                    <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{plano.aviso}</p>
                  </div>

                  <label className="block">
                    <span className={rot}>Motivo da reabertura *</span>
                    <select className={`${inp} mt-1`} value={motivoCodigo} onChange={(e) => setMotivoCodigo(e.target.value)}>
                      <option value="">— escolher —</option>
                      {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.label}</option>)}
                    </select>
                    {motivoCodigo && (
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{motivos.find((m) => m.codigo === motivoCodigo)?.descricao}</span>
                    )}
                  </label>

                  <label className="block">
                    <span className={rot}>Justificativa {plano.exigeJustificativa ? "*" : "(opcional)"}</span>
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
