"use client"

// src/components/kanban/ConferenciaColetaModal.tsx
// ============================================================================
// CONFERÊNCIA DA COLETA DE DADOS — abre ao mover o processo para Genealogia quando há
// pré-cadastro pendente (docs/coleta-de-dados-mandato.md §2.8). O administrador decide,
// pessoa a pessoa, quem entra como cliente (e com qual papel) e quem é descartado.
//
//  • Só depois de decidir TODOS o botão "Concluir conferência" habilita.
//  • "Seguir sem cadastrar ninguém" pede confirmação dizendo quantos envios serão descartados.
//  • Não move o processo: ao concluir, a tela que pediu repete a ação (mover/avançar).
//  • Não toca a árvore: confirmar cria cliente e vínculo com o processo, nada mais.
// ============================================================================

import { useMemo, useState } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { useApi } from "@/src/lib/dados"
import { LAYER } from "@/src/lib/ui/layers"
import { mascararCpf } from "@/src/lib/cpf"
import { PAPEIS_COLETA, type PapelColeta } from "@/src/lib/coleta/campos"
import type { PreCadastro } from "@/src/services/coleta/coleta-conferencia"
import { ListaPreCadastro, ROTULO_PAPEL } from "./ProcessoPreCadastro"

type Decisao = { acao: "CONFIRMAR"; papel: PapelColeta } | { acao: "DESCARTAR" }

interface Props {
  processoId: number
  onFechar: () => void
  onConcluida: () => void
}

const token = () => (typeof window !== "undefined" ? localStorage.getItem("authToken") : null)

export function ConferenciaColetaModal({ processoId, onFechar, onConcluida }: Props) {
  const { dados, carregando, erro: erroCarga } = useApi<PreCadastro & { podeGerar: boolean }>(`/api/processos/${processoId}/coleta`)
  const [decisoes, setDecisoes] = useState<Record<number, Decisao>>({})
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)

  const envios = useMemo(() => dados?.envios ?? [], [dados])
  const todosDecididos = envios.length > 0 && envios.every((e) => decisoes[e.id])
  const confirmados = useMemo(() => envios.filter((e) => decisoes[e.id]?.acao === "CONFIRMAR").length, [envios, decisoes])

  async function enviar(corpo: unknown) {
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/coleta/conferir`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: JSON.stringify(corpo),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; anexos?: { falharam: number } }
      if (!r.ok) { setErro(d.error ?? "Não foi possível concluir a conferência. Nada foi alterado."); return }
      if (d.anexos && d.anexos.falharam > 0) {
        setErro(`Conferência feita, mas ${d.anexos.falharam} arquivo(s) não foram anexados ao cadastro. Abra a conferência de novo para repetir.`)
        return
      }
      onConcluida()
    } catch {
      setErro("Falha de rede. Nada foi alterado.")
    } finally {
      setEnviando(false)
    }
  }

  const concluir = () => enviar({ decisoes: envios.map((e) => ({ envioId: e.id, ...decisoes[e.id] })) })

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.aboveProcessCritical }} onClick={enviando ? undefined : onFechar}>
      <div
        className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-popover)] text-gray-900 shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Conferência da coleta de dados"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-default)] px-5 py-4">
          <div>
            <h2 className="text-base font-extrabold">Conferência do pré-cadastro</h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Escolha quem entra como cliente deste processo. O processo só muda de fase depois.</p>
          </div>
          <button onClick={onFechar} disabled={enviando} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {carregando && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div>}
          {erroCarga && <p className="text-sm text-red-700">Não foi possível carregar o pré-cadastro.</p>}
          {!carregando && !erroCarga && envios.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Nenhum pré-cadastro pendente. Pode fechar e mover o processo.</p>}

          {envios.map((e) => {
            const d = decisoes[e.id]
            return (
              <div key={e.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4" data-envio-coleta={e.id}>
                <ListaPreCadastro envios={[e]} processoId={processoId} compacto />
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-default)] pt-3">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Declarou: {ROTULO_PAPEL[e.papelDeclarado]}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Papel de ${e.dados?.nome ?? "pessoa"}`}
                      value={d?.acao === "CONFIRMAR" ? d.papel : ""}
                      onChange={(ev) => ev.target.value && setDecisoes((x) => ({ ...x, [e.id]: { acao: "CONFIRMAR", papel: ev.target.value as PapelColeta } }))}
                      className={`h-9 rounded-lg border px-2 text-sm ${d?.acao === "CONFIRMAR" ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]" : "border-gray-300 bg-[var(--surface-primary)]"}`}
                    >
                      <option value="">Confirmar como…</option>
                      {PAPEIS_COLETA.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setDecisoes((x) => ({ ...x, [e.id]: { acao: "DESCARTAR" } }))}
                      className={`h-9 rounded-lg border px-3 text-sm font-medium ${d?.acao === "DESCARTAR" ? "border-red-500 bg-[var(--danger-tile)] text-[var(--danger-text)]" : "border-gray-300 text-gray-800 hover:border-[var(--border-strong)]"}`}
                    >Descartar</button>
                  </div>
                </div>
                {d?.acao === "CONFIRMAR" && (e.mesmoCpf.requerente || e.mesmoCpf.contratante) && (
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    CPF {mascararCpf(e.dados?.cpf)} já cadastrado: o cadastro existente será reaproveitado e vinculado ao processo (os documentos enviados são anexados a ele).
                  </p>
                )}
              </div>
            )
          })}

          {confirmandoDescarte && (
            <div className="rounded-xl border border-red-300 bg-[var(--danger-tile)] p-4" role="alertdialog">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--danger-text)]"><AlertTriangle className="h-4 w-4" aria-hidden /> Seguir sem cadastrar ninguém?</p>
              <p className="mt-1 text-sm text-[var(--danger-text)]">
                {envios.length === 1 ? "1 envio será descartado" : `${envios.length} envios serão descartados`}. Os dados e os arquivos são apagados em 30 dias; depois disso, quem entrar você cadastra manualmente.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={enviando} onClick={() => void enviar({ descartarTodos: true })} className="h-9 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-60">
                  {enviando ? "Descartando…" : `Descartar ${envios.length === 1 ? "o envio" : `os ${envios.length} envios`}`}
                </button>
                <button type="button" disabled={enviando} onClick={() => setConfirmandoDescarte(false)} className="h-9 rounded-lg border border-gray-300 px-3 text-sm">Voltar</button>
              </div>
            </div>
          )}

          {erro && <p className="rounded-lg bg-[var(--danger-tile)] px-3 py-2 text-sm text-[var(--danger-text)]" role="alert">{erro}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-default)] px-5 py-3">
          <button type="button" disabled={enviando || envios.length === 0} onClick={() => setConfirmandoDescarte(true)} className="text-sm font-medium text-[var(--text-secondary)] underline decoration-gray-300 underline-offset-2 hover:text-gray-900 disabled:opacity-40">
            Seguir sem cadastrar ninguém
          </button>
          <div className="flex items-center gap-3">
            {envios.length > 0 && <span className="text-xs text-[var(--text-secondary)]">{confirmados} confirmado(s) · {Object.keys(decisoes).length - confirmados} descartado(s) · {envios.length - Object.keys(decisoes).length} sem decisão</span>}
            {!carregando && !erroCarga && envios.length === 0 && (
              <button type="button" onClick={onConcluida} className="inline-flex h-10 items-center rounded-lg bg-[var(--action-primary)] px-4 text-sm font-semibold text-[var(--action-primary-ink)]">Continuar</button>
            )}
            <button type="button" hidden={envios.length === 0} disabled={!todosDecididos || enviando} onClick={() => void concluir()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--action-primary)] px-4 text-sm font-semibold text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)] disabled:opacity-50">
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Concluir conferência
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
