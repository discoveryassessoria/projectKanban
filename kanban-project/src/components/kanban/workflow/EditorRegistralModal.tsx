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
import { useApi } from "@/src/lib/dados"
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
   *  do workflow. Se for "localizar_registro", mostra banner amarelo + valida
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

/**
 * Casca fina: o editor só existe aberto, com identidade no documento. Cada abertura
 * carrega o documento e monta o formulário do zero.
 */
export function EditorRegistralModal(props: EditorRegistralModalProps) {
  if (!props.isOpen || !props.documentoId) return null
  return <ConteudoModal key={props.documentoId} {...props} />
}

function ConteudoModal({
  documentoId,
  stepKey,
  stepId,
  isOpen,
  onClose,
  onSaved,
}: EditorRegistralModalProps) {
  const [saving, setSaving] = useState(false)

  // Seções colapsadas (todas abertas por default no modo completo)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    identificacao: true,
    localidade: true,
    referencia: true,
    datas: true,
    rastreamento: false,
    observacoes: false,
  })

  // Modo "Localizar registro" = banner amarelo + esconde campos extras
  const isModoBuscar = stepKey === "localizar_registro"

  // -- Carrega documento pela camada oficial
  const consulta = useApi<Documento>(documentoId ? `/api/documentos/${documentoId}` : null)
  const doc = consulta.dados ?? null
  const loading = consulta.carregando
  const erro = consulta.erro ? "Erro ao carregar documento." : null
  const carregar = consulta.recarregar

  // O formulário é RASCUNHO sobre o documento carregado. `rascunho` guarda só o que
  // foi editado, e carrega a versão do documento em que foi editado: quando o
  // servidor devolve um documento novo (recarga após salvar), o rascunho deixa de
  // casar e o formulário volta a refletir o que está gravado — sem efeito.
  // A "versão" é o próprio conteúdo que o formulário reflete: se o documento voltar
  // diferente do servidor, o rascunho baseado no anterior é descartado.
  const versaoDoc = doc ? JSON.stringify(docToForm(doc)) : ''
  const [rascunho, setRascunho] = useState<{ versao: string; form: FormState } | null>(null)
  const form = rascunho?.versao === versaoDoc ? rascunho.form : (doc ? docToForm(doc) : emptyForm())
  const setForm = (proximo: FormState | ((anterior: FormState) => FormState)) => {
    const valor = typeof proximo === 'function' ? proximo(form) : proximo
    setRascunho({ versao: versaoDoc, form: valor })
  }

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

  // -- Validação pra "Localizar registro"
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
        "Para concluir a etapa Localizar registro da certidão, preencha:\n" +
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

      // 2. Se veio de uma etapa "localizar_registro", conclui a etapa
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
      <div className="fixed inset-0 bg-[var(--overlay-modal)] z-[10004] transition-opacity" onClick={onClose} />

      {/* Container centralizado */}
      <div className="fixed inset-0 z-[10005] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl overflow-hidden shadow-[var(--elev-3)] pointer-events-auto"
          style={{ background: "var(--surface-overlay)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {loading && !doc && (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
            </div>
          )}

          {erro && !doc && (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] gap-3 p-8">
              <AlertTriangle className="w-8 h-8 text-[var(--accent-text)]" />
              <p className="text-sm">{erro}</p>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs bg-[var(--surface-popover)]/10 hover:bg-[var(--surface-popover)]/15 rounded-md text-[var(--text-primary)]"
              >
                Fechar
              </button>
            </div>
          )}

          {doc && (
            <>
              {/* ============== HEADER ============== */}
              <div
                className="flex-shrink-0 px-6 py-4 border-b border-[var(--border-default)]"
                style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-1">
                      Dados registrais — {tipoLabel}
                    </div>
                    <div className="text-[13px] text-white/70 leading-snug">
                      {pessoaNome} ·{" "}
                      {isModoBuscar
                        ? "Preencha cartório + livro/folha/termo para concluir a etapa Localizar registro da certidão."
                        : "Toda alteração é registrada em auditoria."}
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-md bg-[var(--surface-popover)]/5 hover:bg-[var(--surface-popover)]/15 flex items-center justify-center text-[var(--text-primary)] flex-shrink-0"
                    aria-label="Fechar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* ============== BODY (scroll) ============== */}
              <div className="flex-1 overflow-y-auto px-6 py-5 text-white/70">
                {/* Nome base (não muda) */}
                <div className="mb-5 p-3 rounded-lg bg-[var(--surface-popover)]/5 border border-[var(--border-default)]">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-1">
                    Nome base na árvore (não muda aqui)
                  </div>
                  <div className="text-[15px] font-semibold text-white">{pessoaNome}</div>
                </div>

                {/* Banner amarelo (só em modo buscar) */}
                {isModoBuscar && (
                  <div
                    className={`mb-5 p-3.5 rounded-lg border ${
                      podeConcluirEtapa
                        ? "border-[var(--border-default)] bg-[var(--surface-secondary)]"
                        : "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10"
                    }`}
                  >
                    <div
                      className={`text-[12px] font-semibold mb-1 flex items-center gap-1.5 ${
                        podeConcluirEtapa ? "text-green-700" : "text-[var(--accent-text)]"
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {podeConcluirEtapa
                        ? "Pronto para concluir a etapa"
                        : 'Para concluir a etapa "Localizar registro da certidão":'}
                    </div>
                    <div className="text-[11.5px] text-white/75 leading-relaxed">
                      preencha{" "}
                      <strong className={cartorioOk ? "text-green-700" : "text-[var(--accent-text)]"}>
                        Cartório
                      </strong>{" "}
                      + pelo menos um de{" "}
                      <strong className={referenciaOk ? "text-green-700" : "text-[var(--accent-text)]"}>
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
                      className="w-full px-3 py-2 bg-[var(--surface-popover)]/5 border border-[var(--border-default)] rounded-md text-sm text-[var(--text-primary)] placeholder-white/30 focus:outline-none focus:border-[var(--border-default)] focus:ring-1 focus:border-[var(--border-default)] resize-none"
                    />
                  </Section>
                )}
              </div>

              {/* ============== FOOTER (botões) ============== */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--border-default)] flex items-center justify-end gap-3 bg-[var(--surface-overlay)]">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-[var(--text-primary)] hover:bg-[var(--surface-popover)]/5 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>

                {isModoBuscar ? (
                  <button
                    onClick={handleSalvar}
                    disabled={saving || !podeConcluirEtapa}
                    className="px-5 py-2 text-[12.5px] font-semibold bg-[var(--surface-secondary)] hover:bg-[var(--surface-secondary)] disabled:bg-[var(--surface-secondary)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-primary)] rounded-md inline-flex items-center gap-2 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Salvar e iniciar solicitação
                  </button>
                ) : (
                  <button
                    onClick={handleSalvar}
                    disabled={saving}
                    className="px-5 py-2 text-[12.5px] font-semibold bg-[var(--surface-secondary)] hover:bg-[var(--surface-secondary)] disabled:bg-[var(--surface-secondary)] disabled:opacity-50 text-[var(--text-primary)] rounded-md inline-flex items-center gap-2 transition-colors"
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
          <BookOpen className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
          <h3 className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-secondary)] group-hover:text-white/80">
            {title}
          </h3>
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
        )}
      </button>

      {open && (
        <div className="pl-5">
          {intro && (
            <div className="text-[11px] text-[var(--text-secondary)] italic mb-3 leading-relaxed">{intro}</div>
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
        <label className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-secondary)]">
          {label}
        </label>
        {requiredToComplete && (
          <span
            className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isEmpty
                ? "bg-[var(--accent-primary)]/20 text-[var(--accent-text)] border border-[var(--accent-primary)]/40"
                : "bg-[var(--surface-secondary)] text-green-700 border border-[var(--border-default)]"
            }`}
          >
            obrigatório p/ concluir
          </span>
        )}
        {requiredAlt && (
          <span
            className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isEmpty
                ? "bg-[var(--accent-primary)]/20 text-[var(--accent-text)] border border-[var(--accent-primary)]/40"
                : "bg-[var(--surface-secondary)] text-green-700 border border-[var(--border-default)]"
            }`}
          >
            obrigatório*
          </span>
        )}
        {critical && !requiredToComplete && !requiredAlt && (
          <span className="text-[8.5px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            crítico
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 bg-[var(--surface-popover)]/5 border rounded-md text-sm text-[var(--text-primary)] placeholder-white/30 focus:outline-none focus:ring-1 ${
          requiredEmpty || requiredAltEmpty
            ? "border-[var(--accent-primary)]/40 focus:border-[var(--accent-primary)]/60 focus:ring-[var(--accent-primary)]/30"
            : "border-[var(--border-default)] focus:border-[var(--border-default)] focus:border-[var(--border-default)]"
        }`}
      />
    </div>
  )
}