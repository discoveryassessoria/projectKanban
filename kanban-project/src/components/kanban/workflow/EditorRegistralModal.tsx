// src/components/kanban/workflow/EditorRegistralModal.tsx
//
// Modal centralizado para edição dos 23 campos canônicos da certidão.
// Espelha o "Editor registral completo" do HTML do Marco (Image 5).
//
// Hierarquia visual: 3º nível
//   1. Documentos drawer (z=10001)
//   2. Central da Etapa drawer (z=10003)
//   3. EditorRegistralModal (z=10005)  ← este

"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, AlertTriangle, BookOpen, ChevronDown, ChevronUp } from "lucide-react"

// ============================================================
// TIPOS
// ============================================================

interface Documento {
  id: number
  tipo: string

  // Identificação literal
  nome_registrado?: string | null
  pai_registrado?: string | null
  mae_registrada?: string | null
  conjuge_registrado?: string | null

  // Localidade
  pais_registro?: string | null
  estado_registro?: string | null
  cidade_registro?: string | null
  comune?: string | null
  cartorio?: string | null
  orgao_emissor?: string | null

  // Referência registral
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numero_registro?: string | null
  matricula?: string | null
  crc?: string | null
  protocolo?: string | null

  // Datas
  data_evento?: string | null
  data_registro?: string | null

  // Rastreamento
  nro_pedido?: string | null
  canal_solicitacao?: string | null
  link_acompanhamento?: string | null
  localizacao_fisica?: string | null

  // Observações
  observacoes?: string | null

  pessoa?: {
    id: number
    nome: string
    sobrenome: string | null
  } | null
}

export interface EditorRegistralModalProps {
  documentoId: number | null
  /** Quando passado, o modal sabe que está sendo aberto a partir de uma etapa
   *  do workflow. Se for "buscar_documento", mostra banner amarelo + valida
   *  cartório + (livro OR folha OR termo) antes de salvar. */
  stepKey?: string | null
  /** Se passado, ao salvar com sucesso o modal chama PATCH de conclusão da etapa. */
  stepId?: number | null
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

// ============================================================
// LABELS
// ============================================================

const TIPO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
}

const nomeCompleto = (p: { nome: string; sobrenome: string | null } | null | undefined): string =>
  p ? `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}` : "—"

// Label dinâmico de "Data do evento" conforme tipo do documento
const labelDataEvento = (tipo: string): string => {
  if (tipo.includes("NASCIMENTO")) return "Data de Nascimento"
  if (tipo.includes("CASAMENTO")) return "Data do Casamento"
  if (tipo.includes("OBITO")) return "Data do Óbito"
  if (tipo.includes("BATISMO")) return "Data do Batismo"
  return "Data do evento"
}

const userId = (): number | null => {
  try {
    const stored = localStorage.getItem("user")
    if (stored) {
      const u = JSON.parse(stored)
      return u.id ?? null
    }
  } catch {}
  return null
}

// ============================================================
// FORM STATE
// ============================================================

interface FormState {
  // Identificação literal
  nome_registrado: string
  pai_registrado: string
  mae_registrada: string
  conjuge_registrado: string

  // Localidade
  pais_registro: string
  estado_registro: string
  cidade_registro: string
  comune: string
  cartorio: string
  orgao_emissor: string

  // Referência
  livro: string
  folha: string
  termo: string
  numero_registro: string
  matricula: string
  crc: string
  protocolo: string

  // Datas (yyyy-mm-dd pro input[type=date])
  data_evento: string
  data_registro: string

  // Rastreamento
  nro_pedido: string
  canal_solicitacao: string
  link_acompanhamento: string
  localizacao_fisica: string

  // Observações
  observacoes: string
}

const emptyForm = (): FormState => ({
  nome_registrado: "",
  pai_registrado: "",
  mae_registrada: "",
  conjuge_registrado: "",
  pais_registro: "",
  estado_registro: "",
  cidade_registro: "",
  comune: "",
  cartorio: "",
  orgao_emissor: "",
  livro: "",
  folha: "",
  termo: "",
  numero_registro: "",
  matricula: "",
  crc: "",
  protocolo: "",
  data_evento: "",
  data_registro: "",
  nro_pedido: "",
  canal_solicitacao: "",
  link_acompanhamento: "",
  localizacao_fisica: "",
  observacoes: "",
})

const docToForm = (doc: Documento): FormState => ({
  nome_registrado: doc.nome_registrado || "",
  pai_registrado: doc.pai_registrado || "",
  mae_registrada: doc.mae_registrada || "",
  conjuge_registrado: doc.conjuge_registrado || "",
  pais_registro: doc.pais_registro || "",
  estado_registro: doc.estado_registro || "",
  cidade_registro: doc.cidade_registro || "",
  comune: doc.comune || "",
  cartorio: doc.cartorio || "",
  orgao_emissor: doc.orgao_emissor || "",
  livro: doc.livro || "",
  folha: doc.folha || "",
  termo: doc.termo || "",
  numero_registro: doc.numero_registro || "",
  matricula: doc.matricula || "",
  crc: doc.crc || "",
  protocolo: doc.protocolo || "",
  data_evento: doc.data_evento ? doc.data_evento.slice(0, 10) : "",
  data_registro: doc.data_registro ? doc.data_registro.slice(0, 10) : "",
  nro_pedido: doc.nro_pedido || "",
  canal_solicitacao: doc.canal_solicitacao || "",
  link_acompanhamento: doc.link_acompanhamento || "",
  localizacao_fisica: doc.localizacao_fisica || "",
  observacoes: doc.observacoes || "",
})

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function EditorRegistralModal({
  documentoId,
  stepKey,
  stepId,
  isOpen,
  onClose,
  onSaved,
}: EditorRegistralModalProps) {
  const [doc, setDoc] = useState<Documento | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Seções colapsadas (todas abertas por default no modo completo)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    identificacao: true,
    localidade: true,
    referencia: true,
    datas: true,
    rastreamento: false,
    observacoes: false,
  })

  // Modo "Buscar documento" = banner amarelo + esconde campos extras
  const isModoBuscar = stepKey === "buscar_documento"

  // -- Carrega documento
  const carregar = useCallback(async () => {
    if (!documentoId) return
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(`/api/documentos/${documentoId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Documento = await res.json()
      setDoc(data)
      setForm(docToForm(data))
    } catch (e) {
      console.warn("[EditorRegistralModal] falha:", e)
      setErro("Erro ao carregar documento.")
    } finally {
      setLoading(false)
    }
  }, [documentoId])

  useEffect(() => {
    if (isOpen && documentoId) {
      carregar()
    }
  }, [isOpen, documentoId, carregar])

  // -- Trava scroll body e ESC
  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => {
      document.body.style.overflow = orig
      document.removeEventListener("keydown", onEsc)
    }
  }, [isOpen, onClose])

  // -- Validação pra "Buscar documento"
  // Marco define: cartório obrigatório + pelo menos um de livro/folha/termo
  const cartorioOk = form.cartorio.trim().length > 0
  const referenciaOk =
    form.livro.trim().length > 0 || form.folha.trim().length > 0 || form.termo.trim().length > 0
  const podeConcluirEtapa = cartorioOk && referenciaOk

  // -- Salvar (e opcionalmente concluir etapa)
  const handleSalvar = async () => {
    if (!documentoId || !doc) return

    // Em modo buscar, valida antes
    if (isModoBuscar && !podeConcluirEtapa) {
      alert(
        "Para concluir a etapa Buscar documento, preencha:\n" +
          "• Cartório\n" +
          "• Pelo menos um de: Livro, Folha ou Termo",
      )
      return
    }

    setSaving(true)
    try {
      // 1. Salva todos os campos no Documento
      const body: Record<string, unknown> = {
        nome_registrado: form.nome_registrado.trim() || null,
        pai_registrado: form.pai_registrado.trim() || null,
        mae_registrada: form.mae_registrada.trim() || null,
        conjuge_registrado: form.conjuge_registrado.trim() || null,

        pais_registro: form.pais_registro.trim() || null,
        estado_registro: form.estado_registro.trim() || null,
        cidade_registro: form.cidade_registro.trim() || null,
        comune: form.comune.trim() || null,
        cartorio: form.cartorio.trim() || null,
        orgao_emissor: form.orgao_emissor.trim() || null,

        livro: form.livro.trim() || null,
        folha: form.folha.trim() || null,
        termo: form.termo.trim() || null,
        numero_registro: form.numero_registro.trim() || null,
        matricula: form.matricula.trim() || null,
        crc: form.crc.trim() || null,
        protocolo: form.protocolo.trim() || null,

        data_evento: form.data_evento || null,
        data_registro: form.data_registro || null,

        nro_pedido: form.nro_pedido.trim() || null,
        canal_solicitacao: form.canal_solicitacao.trim() || null,
        link_acompanhamento: form.link_acompanhamento.trim() || null,
        localizacao_fisica: form.localizacao_fisica.trim() || null,

        observacoes: form.observacoes.trim() || null,
      }

      // Em modo buscar, já dispara mudança de status pra SOLICITAR
      if (isModoBuscar && podeConcluirEtapa) {
        body.status = "SOLICITAR"
      }

      const resDoc = await fetch(`/api/documentos/${documentoId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify(body),
      })
      if (!resDoc.ok) throw new Error(`PUT documento HTTP ${resDoc.status}`)

      // 2. Se veio de uma etapa "buscar_documento", conclui a etapa
      if (isModoBuscar && stepId && podeConcluirEtapa) {
        const resStep = await fetch(
          `/api/documentos/${documentoId}/workflow/steps/${stepId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("authToken")}`,
            },
            body: JSON.stringify({
              status: "concluida",
              completedById: userId(),
            }),
          },
        )
        if (!resStep.ok) {
          console.warn("[EditorRegistralModal] step não foi concluída:", resStep.status)
        }
      }

      onSaved?.()
      onClose()
    } catch (e) {
      console.error("[EditorRegistralModal] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const tipoLabel = doc ? TIPO_LABELS[doc.tipo] || doc.tipo : ""
  const pessoaNome = nomeCompleto(doc?.pessoa)

  // -- Toggle seção
  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // -- Conteúdo do modal
  const modalContent = (
    <>
      {/* Backdrop empilhado por cima da Central da Etapa */}
      <div className="fixed inset-0 bg-black/65 z-[10004] transition-opacity" onClick={onClose} />

      {/* Container centralizado */}
      <div className="fixed inset-0 z-[10005] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl overflow-hidden shadow-2xl pointer-events-auto"
          style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {loading && !doc && (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-white/50" />
            </div>
          )}

          {erro && !doc && (
            <div className="flex-1 flex flex-col items-center justify-center text-white/60 gap-3 p-8">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="text-sm">{erro}</p>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 rounded-md text-white"
              >
                Fechar
              </button>
            </div>
          )}

          {doc && (
            <>
              {/* ============== HEADER ============== */}
              <div
                className="flex-shrink-0 px-6 py-4 border-b border-white/10"
                style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-white/55 mb-1">
                      Dados registrais — {tipoLabel}
                    </div>
                    <div className="text-[13px] text-white/70 leading-snug">
                      {pessoaNome} ·{" "}
                      {isModoBuscar
                        ? "Preencha cartório + livro/folha/termo para concluir a etapa Buscar documento."
                        : "Toda alteração é registrada em auditoria."}
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/15 flex items-center justify-center text-white flex-shrink-0"
                    aria-label="Fechar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* ============== BODY (scroll) ============== */}
              <div className="flex-1 overflow-y-auto px-6 py-5 text-slate-200">
                {/* Nome base (não muda) */}
                <div className="mb-5 p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1">
                    Nome base na árvore (não muda aqui)
                  </div>
                  <div className="text-[15px] font-semibold text-white">{pessoaNome}</div>
                </div>

                {/* Banner amarelo (só em modo buscar) */}
                {isModoBuscar && (
                  <div
                    className={`mb-5 p-3.5 rounded-lg border ${
                      podeConcluirEtapa
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-amber-500/30 bg-amber-500/10"
                    }`}
                  >
                    <div
                      className={`text-[12px] font-semibold mb-1 flex items-center gap-1.5 ${
                        podeConcluirEtapa ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {podeConcluirEtapa
                        ? "Pronto para concluir a etapa"
                        : 'Para concluir a etapa "Buscar documento":'}
                    </div>
                    <div className="text-[11.5px] text-white/75 leading-relaxed">
                      preencha{" "}
                      <strong className={cartorioOk ? "text-emerald-300" : "text-amber-200"}>
                        Cartório
                      </strong>{" "}
                      + pelo menos um de{" "}
                      <strong className={referenciaOk ? "text-emerald-300" : "text-amber-200"}>
                        Livro / Folha / Termo
                      </strong>
                      . Os demais campos são opcionais aqui.
                    </div>
                  </div>
                )}

                {/* ============== SEÇÃO 1: Identificação ============== */}
                <Section
                  id="identificacao"
                  title="Identificação no documento"
                  intro="Texto literal de como pessoa, pai, mãe e cônjuge aparecem na certidão."
                  open={openSections.identificacao}
                  onToggle={() => toggleSection("identificacao")}
                >
                  <div className="grid grid-cols-1 gap-3">
                    <Field
                      label="Nome registrado"
                      critical
                      value={form.nome_registrado}
                      onChange={(v) => setForm({ ...form, nome_registrado: v })}
                    />
                    {!isModoBuscar && (
                      <>
                        <Field
                          label="Pai registrado"
                          critical
                          value={form.pai_registrado}
                          onChange={(v) => setForm({ ...form, pai_registrado: v })}
                        />
                        <Field
                          label="Mãe registrada"
                          critical
                          value={form.mae_registrada}
                          onChange={(v) => setForm({ ...form, mae_registrada: v })}
                        />
                        <Field
                          label="Cônjuge registrado"
                          value={form.conjuge_registrado}
                          onChange={(v) => setForm({ ...form, conjuge_registrado: v })}
                        />
                      </>
                    )}
                  </div>
                </Section>

                {/* ============== SEÇÃO 2: Localidade ============== */}
                <Section
                  id="localidade"
                  title="Localidade"
                  open={openSections.localidade}
                  onToggle={() => toggleSection("localidade")}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Cartório"
                      requiredToComplete={isModoBuscar}
                      value={form.cartorio}
                      onChange={(v) => setForm({ ...form, cartorio: v })}
                      colSpan={2}
                    />
                    {!isModoBuscar && (
                      <>
                        <Field
                          label="País"
                          value={form.pais_registro}
                          onChange={(v) => setForm({ ...form, pais_registro: v })}
                        />
                        <Field
                          label="Estado/Província"
                          value={form.estado_registro}
                          onChange={(v) => setForm({ ...form, estado_registro: v })}
                        />
                        <Field
                          label="Cidade"
                          value={form.cidade_registro}
                          onChange={(v) => setForm({ ...form, cidade_registro: v })}
                        />
                        <Field
                          label="Comune"
                          value={form.comune}
                          onChange={(v) => setForm({ ...form, comune: v })}
                        />
                        <Field
                          label="Órgão emissor"
                          value={form.orgao_emissor}
                          onChange={(v) => setForm({ ...form, orgao_emissor: v })}
                          colSpan={2}
                        />
                      </>
                    )}
                  </div>
                </Section>

                {/* ============== SEÇÃO 3: Referência registral ============== */}
                <Section
                  id="referencia"
                  title="Referência registral"
                  intro={
                    isModoBuscar
                      ? "Pelo menos um destes (Livro, Folha ou Termo) é obrigatório para concluir a etapa."
                      : undefined
                  }
                  open={openSections.referencia}
                  onToggle={() => toggleSection("referencia")}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Livro"
                      requiredAlt={isModoBuscar}
                      value={form.livro}
                      onChange={(v) => setForm({ ...form, livro: v })}
                    />
                    <Field
                      label="Folha"
                      requiredAlt={isModoBuscar}
                      value={form.folha}
                      onChange={(v) => setForm({ ...form, folha: v })}
                    />
                    <Field
                      label="Termo"
                      requiredAlt={isModoBuscar}
                      value={form.termo}
                      onChange={(v) => setForm({ ...form, termo: v })}
                    />
                    <Field
                      label="Nº registro"
                      value={form.numero_registro}
                      onChange={(v) => setForm({ ...form, numero_registro: v })}
                    />
                    {!isModoBuscar && (
                      <>
                        <Field
                          label="Matrícula"
                          value={form.matricula}
                          onChange={(v) => setForm({ ...form, matricula: v })}
                        />
                        <Field
                          label="CRC"
                          value={form.crc}
                          onChange={(v) => setForm({ ...form, crc: v })}
                        />
                        <Field
                          label="Protocolo"
                          value={form.protocolo}
                          onChange={(v) => setForm({ ...form, protocolo: v })}
                          colSpan={2}
                        />
                      </>
                    )}
                  </div>
                </Section>

                {/* ============== SEÇÃO 4: Datas ============== */}
                <Section
                  id="datas"
                  title="Datas"
                  open={openSections.datas}
                  onToggle={() => toggleSection("datas")}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={labelDataEvento(doc.tipo)}
                      type="date"
                      value={form.data_evento}
                      onChange={(v) => setForm({ ...form, data_evento: v })}
                    />
                    <Field
                      label="Data do registro"
                      type="date"
                      value={form.data_registro}
                      onChange={(v) => setForm({ ...form, data_registro: v })}
                    />
                  </div>
                </Section>

                {/* ============== SEÇÃO 5: Rastreamento (só no modo completo) ============== */}
                {!isModoBuscar && (
                  <Section
                    id="rastreamento"
                    title="Rastreamento"
                    open={openSections.rastreamento}
                    onToggle={() => toggleSection("rastreamento")}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label="Nº do pedido"
                        value={form.nro_pedido}
                        onChange={(v) => setForm({ ...form, nro_pedido: v })}
                      />
                      <Field
                        label="Canal de solicitação"
                        value={form.canal_solicitacao}
                        onChange={(v) => setForm({ ...form, canal_solicitacao: v })}
                      />
                      <Field
                        label="Link de acompanhamento"
                        value={form.link_acompanhamento}
                        onChange={(v) => setForm({ ...form, link_acompanhamento: v })}
                        colSpan={2}
                      />
                      <Field
                        label="Localização física"
                        value={form.localizacao_fisica}
                        onChange={(v) => setForm({ ...form, localizacao_fisica: v })}
                        colSpan={2}
                      />
                    </div>
                  </Section>
                )}

                {/* ============== SEÇÃO 6: Observações ============== */}
                {!isModoBuscar && (
                  <Section
                    id="observacoes"
                    title="Observações"
                    open={openSections.observacoes}
                    onToggle={() => toggleSection("observacoes")}
                  >
                    <textarea
                      rows={4}
                      value={form.observacoes}
                      onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                      placeholder="Observações registrais…"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 resize-none"
                    />
                  </Section>
                )}
              </div>

              {/* ============== FOOTER (botões) ============== */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3 bg-[#11151b]">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>

                {isModoBuscar ? (
                  <button
                    onClick={handleSalvar}
                    disabled={saving || !podeConcluirEtapa}
                    className="px-5 py-2 text-[12.5px] font-semibold bg-red-500 hover:bg-red-600 disabled:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Salvar e iniciar solicitação
                  </button>
                ) : (
                  <button
                    onClick={handleSalvar}
                    disabled={saving}
                    className="px-5 py-2 text-[12.5px] font-semibold bg-blue-500 hover:bg-blue-600 disabled:bg-blue-900 disabled:opacity-50 text-white rounded-md inline-flex items-center gap-2 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Salvar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(modalContent, document.body)
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function Section({
  id,
  title,
  intro,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  intro?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 mb-2 group"
      >
        <div className="flex items-center gap-2 text-left">
          <BookOpen className="w-3.5 h-3.5 text-white/40 group-hover:text-white/60" />
          <h3 className="text-[11px] uppercase font-bold tracking-wider text-white/55 group-hover:text-white/80">
            {title}
          </h3>
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-white/40 group-hover:text-white/60" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-white/40 group-hover:text-white/60" />
        )}
      </button>

      {open && (
        <div className="pl-5">
          {intro && (
            <div className="text-[11px] text-white/45 italic mb-3 leading-relaxed">{intro}</div>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  critical,
  requiredToComplete,
  requiredAlt,
  colSpan = 1,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: "text" | "date"
  critical?: boolean
  requiredToComplete?: boolean
  requiredAlt?: boolean
  colSpan?: 1 | 2
}) {
  const isEmpty = !value.trim()
  const requiredEmpty = requiredToComplete && isEmpty
  const requiredAltEmpty = requiredAlt && isEmpty

  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-white/50">
          {label}
        </label>
        {requiredToComplete && (
          <span
            className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isEmpty
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
            }`}
          >
            obrigatório p/ concluir
          </span>
        )}
        {requiredAlt && (
          <span
            className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isEmpty
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
            }`}
          >
            obrigatório*
          </span>
        )}
        {critical && !requiredToComplete && !requiredAlt && (
          <span className="text-[8.5px] font-semibold uppercase tracking-wider text-blue-300/70">
            crítico
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 bg-white/5 border rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 ${
          requiredEmpty || requiredAltEmpty
            ? "border-amber-500/40 focus:border-amber-500/60 focus:ring-amber-500/30"
            : "border-white/10 focus:border-blue-500/50 focus:ring-blue-500/30"
        }`}
      />
    </div>
  )
}