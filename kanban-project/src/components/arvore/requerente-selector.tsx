"use client"

// src/components/arvore/requerente-selector.tsx
// ============================================================================
// SELETOR de Requerente para a Árvore (fluxo de REUSO — dedup).
// Em vez de um formulário de criação de Pessoa, o usuário escolhe um Requerente
// já participante do processo; o vínculo REUSA a Pessoa existente (ou cria UMA
// única vez, gravando Requerente.personId). Os dados-mestre são SOMENTE LEITURA.
// ============================================================================

import { useEffect, useState } from "react"
import { Loader2, Check, User, ArrowLeft, AlertCircle } from "lucide-react"

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

export interface RequerenteDisponivel {
  requerenteId: number
  nome: string
  personId: number | null
  sexo: string | null
  dataNascimento: string | null
  nacionalidade: string | null
  jaNaArvore: boolean
}

interface RequerenteSelectorProps {
  processoId: number
  arvoreId: number
  /** Passados ao vínculo (posição no canvas / relações), se aplicável. */
  x?: number | null
  y?: number | null
  paiId?: number | null
  maeId?: number | null
  onLinked: (pessoaId: number, criada: boolean) => void
  onBack?: () => void
  onCancel?: () => void
}

function idadeDe(dataNasc: string | null): string | null {
  if (!dataNasc) return null
  const d = new Date(dataNasc)
  if (isNaN(d.getTime())) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - d.getFullYear()
  const m = hoje.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) idade--
  return `${idade} anos`
}

/** Faixa etária p/ o rótulo Adulto/Menor (≥18 = Adulto). Null se sem data. */
function faixaDe(dataNasc: string | null): "Adulto" | "Menor" | null {
  if (!dataNasc) return null
  const d = new Date(dataNasc)
  if (isNaN(d.getTime())) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - d.getFullYear()
  const m = hoje.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) idade--
  return idade >= 18 ? "Adulto" : "Menor"
}

function pendenciasDe(r: RequerenteDisponivel): string[] {
  const faltando: string[] = []
  if (!r.sexo) faltando.push("sexo")
  if (!r.dataNascimento) faltando.push("data de nascimento")
  if (!r.nacionalidade) faltando.push("nacionalidade")
  return faltando
}

export function RequerenteSelector({
  processoId,
  arvoreId,
  x,
  y,
  paiId,
  maeId,
  onLinked,
  onBack,
  onCancel,
}: RequerenteSelectorProps) {
  const [loading, setLoading] = useState(true)
  const [requerentes, setRequerentes] = useState<RequerenteDisponivel[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const res = await authFetch(`/api/processos/${processoId}/requerentes-disponiveis`)
        if (!res.ok) throw new Error("Falha ao carregar requerentes")
        const data = await res.json()
        if (!ativo) return
        const lista: RequerenteDisponivel[] = data.requerentes || []
        setRequerentes(lista)
        // Pré-seleciona se houver exatamente 1 disponível (ainda não na árvore).
        const disponiveis = lista.filter((r) => !r.jaNaArvore)
        if (disponiveis.length === 1) setSelectedId(disponiveis[0].requerenteId)
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : "Erro ao carregar requerentes")
      } finally {
        if (ativo) setLoading(false)
      }
    })()
    return () => {
      ativo = false
    }
  }, [processoId])

  const disponiveis = requerentes.filter((r) => !r.jaNaArvore)

  const handleConfirm = async () => {
    if (selectedId == null) return
    setSaving(true)
    setErro(null)
    try {
      const res = await authFetch(`/api/arvore/${arvoreId}/vincular-requerente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requerenteId: selectedId, x, y, paiId, maeId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Erro ao vincular requerente")
      }
      onLinked(data.pessoaId, !!data.criada)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao vincular requerente")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    )
  }

  // Nenhum requerente participante do processo.
  const nenhumRequerente = requerentes.length === 0
  // Existem requerentes, mas todos já são nós desta árvore.
  const todosJaNaArvore = !nenhumRequerente && disponiveis.length === 0

  return (
    <div className="w-full max-w-2xl mx-auto">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Selecionar requerente</h2>
        <p className="text-sm text-gray-500 mb-5">
          O requerente já cadastrado no processo é reaproveitado — a árvore não cria uma
          pessoa duplicada. Os dados-mestre são somente leitura.
        </p>

        {nenhumRequerente && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">Nenhum requerente vinculado.</p>
                <p className="text-sm text-amber-700 mt-1">
                  Adicione um requerente ao processo na aba <strong>Informações</strong> antes de
                  incluí-lo na árvore. A árvore não cria requerentes.
                </p>
              </div>
            </div>
          </div>
        )}

        {todosJaNaArvore && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">
              Todos os requerentes deste processo já estão na árvore.
            </p>
          </div>
        )}

        {!nenhumRequerente && !todosJaNaArvore && (
          <>
            <div className="space-y-2 mb-5">
              {disponiveis.map((r) => {
                const isSel = selectedId === r.requerenteId
                const idade = idadeDe(r.dataNascimento)
                const faixa = faixaDe(r.dataNascimento)
                const pend = pendenciasDe(r)
                return (
                  <button
                    key={r.requerenteId}
                    onClick={() => setSelectedId(r.requerenteId)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      isSel
                        ? "border-teal-500 bg-teal-50"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          isSel ? "border-teal-500 bg-teal-500" : "border-gray-300"
                        }`}
                      >
                        {isSel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          {r.nome}
                          {faixa && (
                            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${faixa === "Menor" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                              {faixa}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {[r.sexo, idade, r.nacionalidade].filter(Boolean).join(" · ") ||
                            "Sem dados demográficos"}
                        </p>
                        {pend.length > 0 && (
                          <p className="text-xs text-amber-600 mt-1">
                            Pendências: {pend.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

            <div className="flex gap-2">
              {onCancel && (
                <button
                  onClick={onCancel}
                  disabled={saving}
                  className="px-4 py-3 rounded-lg font-medium text-sm text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={handleConfirm}
                disabled={selectedId == null || saving}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 ${
                  selectedId != null
                    ? "bg-teal-600 text-white hover:bg-teal-700"
                    : "bg-gray-200 text-gray-500 cursor-not-allowed"
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    VINCULANDO...
                  </>
                ) : (
                  "VINCULAR REQUERENTE"
                )}
              </button>
            </div>
          </>
        )}

        {(nenhumRequerente || todosJaNaArvore) && onCancel && (
          <button
            onClick={onCancel}
            className="mt-4 px-4 py-2 rounded-lg font-medium text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Fechar
          </button>
        )}
      </div>
    </div>
  )
}
