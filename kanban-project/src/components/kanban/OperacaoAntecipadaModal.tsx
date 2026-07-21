// src/components/kanban/OperacaoAntecipadaModal.tsx
// Modal p/ criar uma OPERAÇÃO ANTECIPADA: usa a operação OFICIAL de outra fase para atender uma
// necessidade da fase atual, SEM avançar o processo. O tipo de operação vem do CATÁLOGO
// (dinâmico) — nunca de uma lista fixa. A fase-destino também é catálogo (dinâmica).
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeftRight, X } from "lucide-react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface CampoAdicional { key: string; label: string; type: "tipoDocumento" | "pais" | "pessoa" | "text"; required: boolean }
interface CatalogoItem { operationType: string; label: string; camposAdicionais?: CampoAdicional[] }
interface FaseOpt { faseCode: string; faseLabel: string }
interface NecOpt { id: number; label: string; pessoaId: number | null }
interface TipoDoc { id: number; publicCode?: string | null; name: string; code: string | null; countryCode: string | null }

interface Props {
  processoId: number
  necessidadeId?: number | null
  necessidadeLabel?: string
  pessoaId?: number | null
  faseAtivaCode?: string | null
  usuarios?: Array<{ id: number; nome: string; publicCode?: string | null }>
  onClose: () => void
  onCreated: () => void
}

export function OperacaoAntecipadaModal({ processoId, necessidadeId, necessidadeLabel, pessoaId, faseAtivaCode, usuarios, onClose, onCreated }: Props) {
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([])
  const [fases, setFases] = useState<FaseOpt[]>([])
  const [necessidades, setNecessidades] = useState<NecOpt[]>([])
  const [necSel, setNecSel] = useState<string>(necessidadeId ? String(necessidadeId) : "")
  const [operationType, setOperationType] = useState<string>("")
  const [tipos, setTipos] = useState<TipoDoc[]>([])
  const [tipoDocumentoId, setTipoDocumentoId] = useState<string>("")
  const [targetPhaseCode, setTargetPhaseCode] = useState<string>("")
  const [objetivo, setObjetivo] = useState("")
  const [resultadoEsperado, setResultadoEsperado] = useState("")
  const [responsavelId, setResponsavelId] = useState<string>("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Catálogo operacional (tipos elegíveis para antecipação) — dinâmico.
  useEffect(() => {
    fetch("/api/operacoes-antecipadas/catalogo", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        const lista: CatalogoItem[] = j.catalogo ?? []
        setCatalogo(lista)
        if (lista.length === 1) setOperationType(lista[0].operationType) // atalho quando só há um tipo
      })
      .catch(() => setErro("Não foi possível carregar o catálogo operacional."))
  }, [])

  // Cadastro mestre de tipos de documento (para o campo "Documento a emitir").
  useEffect(() => {
    fetch("/api/tipos-documento", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => setTipos((j.tipos ?? []) as TipoDoc[]))
      .catch(() => {})
  }, [])

  // Fases (destino) — catálogo dinâmico; não oferece a própria fase ativa.
  useEffect(() => {
    fetch("/api/tarefas-transversais/acoes", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => setFases(((j.fases ?? []) as FaseOpt[]).filter((f) => f.faseCode !== faseAtivaCode)))
      .catch(() => {})
  }, [faseAtivaCode])

  // Necessidades do processo (quando não veio pré-selecionada).
  useEffect(() => {
    if (necessidadeId) return
    fetch(`/api/processos/${processoId}/necessidades`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        const lista: NecOpt[] = (j.necessidades ?? [])
          .filter((n: { status: string }) => n.status !== "DISPENSADA")
          .map((n: { id: number; pessoaId: number | null; itemCatalogo?: { name?: string; code?: string }; status: string }) => ({
            id: n.id, pessoaId: n.pessoaId ?? null,
            label: `${n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? "Necessidade"} #${n.id} · ${n.status}`,
          }))
        setNecessidades(lista)
      })
      .catch(() => {})
  }, [processoId, necessidadeId])

  const necIdFinal = necessidadeId ?? (necSel ? Number(necSel) : null)
  const pessoaIdFinal = pessoaId ?? necessidades.find((n) => String(n.id) === necSel)?.pessoaId ?? null
  // Campos gerados pelos METADADOS do adaptador selecionado (sem lista fixa / sem condicionar por fase).
  const itemSel = catalogo.find((c) => c.operationType === operationType)
  const campoDoc = itemSel?.camposAdicionais?.find((c) => c.type === "tipoDocumento")
  const tipoSel = tipos.find((t) => String(t.id) === tipoDocumentoId)
  const faltaDoc = !!campoDoc?.required && !tipoDocumentoId

  const criar = useCallback(async () => {
    if (!necIdFinal) { setErro("Selecione a necessidade a atender."); return }
    if (!operationType) { setErro("Selecione o tipo de operação."); return }
    if (faltaDoc) { setErro("Selecione o documento a emitir."); return }
    setEnviando(true); setErro(null)
    try {
      const params: Record<string, unknown> = {}
      if (campoDoc && tipoDocumentoId) params.tipoDocumentoId = Number(tipoDocumentoId)
      if (pessoaIdFinal != null) params.pessoaId = pessoaIdFinal
      const res = await fetch(`/api/processos/${processoId}/operacoes-antecipadas`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          necessidadeId: necIdFinal, operationType,
          targetPhaseCode: targetPhaseCode || undefined,
          objetivo: objetivo.trim() || undefined,
          resultadoEsperado: resultadoEsperado.trim() || undefined,
          responsavelId: responsavelId ? Number(responsavelId) : undefined,
          pessoaId: pessoaIdFinal ?? undefined,
          params: Object.keys(params).length ? params : undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j?.error || `Falha (HTTP ${res.status}).`); return }
      onCreated()
    } catch { setErro("Falha de rede ao criar a operação antecipada.") }
    finally { setEnviando(false) }
  }, [processoId, necIdFinal, pessoaIdFinal, operationType, campoDoc, tipoDocumentoId, faltaDoc, targetPhaseCode, objetivo, resultadoEsperado, responsavelId, onCreated])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && onClose()}>
      <div className="max-w-lg w-full rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-[15px] font-extrabold text-gray-900 flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-gray-500" /> Nova operação antecipada</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4.5 h-4.5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px] text-gray-500 leading-relaxed">Executa a operação oficial de outra fase para atender esta necessidade — <b>sem avançar o processo</b>.</p>
          {necessidadeId && necessidadeLabel ? (
            <div className="text-[12.5px]"><span className="text-gray-400">Necessidade:</span> <span className="font-semibold text-gray-800">{necessidadeLabel}</span></div>
          ) : !necessidadeId ? (
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Necessidade a atender</span>
              <select value={necSel} onChange={(e) => setNecSel(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">Selecionar…</option>
                {necessidades.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Tipo de operação</span>
              <select value={operationType} onChange={(e) => setOperationType(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">Selecionar…</option>
                {catalogo.map((c) => <option key={c.operationType} value={c.operationType}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Fase de referência</span>
              <select value={targetPhaseCode} onChange={(e) => setTargetPhaseCode(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">—</option>
                {fases.map((f) => <option key={f.faseCode} value={f.faseCode}>{f.faseLabel}</option>)}
              </select>
            </label>
          </div>
          {/* Campo dinâmico gerado pelos metadados do adaptador (ex.: documental → "Documento a emitir"). */}
          {campoDoc && (
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">{campoDoc.label}{campoDoc.required ? " *" : ""}</span>
              <select value={tipoDocumentoId} onChange={(e) => setTipoDocumentoId(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">Selecionar…</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.publicCode ? t.publicCode + " — " : ""}{t.name}{t.countryCode ? ` (${t.countryCode})` : ""}</option>)}
              </select>
              <span className="block text-[10.5px] text-gray-400 mt-1">
                {tipoSel?.countryCode ? `Jurisdição: ${tipoSel.countryCode}. ` : ""}Se diferir do documento exigido pela necessidade, será tratado como <b>documento de apoio</b> (não substitui a necessidade).
              </span>
            </label>
          )}
          <label className="block">
            <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Objetivo</span>
            <textarea value={objetivo} onChange={(e) => setObjetivo(e.target.value)} rows={2} placeholder="Ex.: obter os dados do registro de nascimento pela certidão de casamento" className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:border-blue-400" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Resultado esperado</span>
              <input value={resultadoEsperado} onChange={(e) => setResultadoEsperado(e.target.value)} placeholder="O que se espera obter" className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:border-blue-400" />
            </label>
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Responsável</span>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">—</option>
                {(usuarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + ' — ' : ''}{u.nome}</option>)}
              </select>
            </label>
          </div>
          {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12.5px] text-red-700">{erro}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button disabled={enviando} onClick={onClose} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 disabled:opacity-50">Cancelar</button>
          <button disabled={enviando || !necIdFinal || !operationType || faltaDoc} onClick={() => void criar()} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />} Criar operação antecipada
          </button>
        </div>
      </div>
    </div>
  )
}
