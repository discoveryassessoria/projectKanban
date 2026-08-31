// src/components/kanban/ProcessoProtocolos.tsx
//
// PROTOCOLIZAÇÕES DO PROCESSO — o único lugar onde um protocolo é registrado.
// Protocolo não é cadastro: é um ato operacional (órgão, setor, data/hora,
// número, tipo, forma de envio, responsável, comprovante, observações e
// documentos enviados). Cada registro gera Evento na Timeline e entra no
// Histórico do Processo — a única fonte cronológica oficial.

"use client"

import { nomePessoa } from "@/src/lib/ui/pessoa-exibicao"
import { useState } from "react"
import { buscar, useApi, useConsulta } from "@/src/lib/dados"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { uploadFiles } from "@/src/lib/storage"
import { AlertTriangle, Building2, Calendar, Edit2, Eye, FileText, Hash, Layers, Loader2, Paperclip, Plus, Send, Trash2, Upload, User, X } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// Tipos compatíveis com os do modal
interface PessoaBase {
  id: number
  publicCode?: string | null   // CLI-n — código público do cliente (contratante/requerente)
  nome: string
  email?: string | null
  telefone?: string | null
}

interface Anexo {
  id: number
  nome: string
  tipo?: string | null
  nomeArquivo: string
  urlArquivo: string
  tamanho?: number | null
  mimeType?: string | null
  createdAt: string
}

interface DocumentoEnviado {
  id: number
  documentoId: number
  documento?: {
    id: number
    publicCode?: string | null
    tipo?: string | null
    descricao?: string | null
    status?: string | null
    pessoa?: { id: number; nome: string } | null
  } | null
}

interface Protocolo {
  id: number
  processoId: number
  contratanteId?: number | null
  contratante?: PessoaBase | null
  orgaoId?: number | null
  orgao?: { id: number; name: string; type?: string | null; city?: string | null } | null
  setor?: string | null
  dataProtocolo?: string | null
  numeroProtocolo?: string | null
  numeroProcesso?: string | null
  finalidade?: string | null
  situacao?: string | null
  requerentesCobertos?: { requerente: PessoaBase }[]
  tipoProtocoloId?: number | null
  tipo?: { id: number; code: string; nome: string } | null
  exigencias?: { id: number; descricao: string; prazo?: string | null; cumpridaEm?: string | null }[]
  formaEnvio?: string | null
  responsavelId?: number | null
  responsavel?: { id: number; nome: string } | null
  observacoes?: string | null
  anexos?: Anexo[]
  documentos?: DocumentoEnviado[]
  createdAt: string
  // legado (Espanha) — exibido quando o registro antigo não tem órgão
}

interface OpcoesProtocolo {
  orgaos: { id: number; name: string; type?: string | null; city?: string | null }[]
  /** INDIVIDUAL | COLETIVO — vem da Modalidade Legal do processo, não do país. */
  cardinalidade?: "INDIVIDUAL" | "COLETIVO"
  /** false = a rota do processo não declara a regra; o valor acima é fallback. */
  cardinalidadeDeclarada?: boolean
  rota?: { enquadramento: string; modalidade: string | null } | null
  tiposCadastro?: { id: number; code: string; nome: string; descricao?: string | null }[]
  finalidades?: string[]
  situacoes?: string[]
  responsaveis: { id: number; nome: string }[]
  documentos: { id: number; publicCode: string | null; tipo: string | null; descricao: string | null; pessoa: string }[]
  formasEnvio: { valor: string; label: string }[]
}

interface ProcessoProtocolosProps {
  processoId: number
  contratantes: PessoaBase[]
  requerentes: PessoaBase[]
  onUpdate?: () => void
}

// Helper para formatar tamanho de arquivo
const formatFileSize = (bytes?: number | null) => {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ISO → valor de <input type="datetime-local"> (hora local, sem segundos)
const paraDatetimeLocal = (iso?: string | null) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const formatarDataHora = (iso?: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

const rotuloDocumento = (d: { publicCode?: string | null; tipo?: string | null; descricao?: string | null; pessoa?: string }) => {
  const nome = d.descricao || (d.tipo ? d.tipo.replace(/_/g, " ").toLowerCase() : "Documento")
  const codigo = d.publicCode ? `${d.publicCode} — ` : ""
  return `${codigo}${nome}${d.pessoa ? ` (${d.pessoa})` : ""}`
}

/** Rótulos das dimensões fechadas. O valor é do banco; o texto é da tela. */
const ROTULO_FINALIDADE: Record<string, string> = {
  REQUERIMENTO: "Requerimento (o pedido)",
  RETIFICACAO: "Retificação de registro",
  CERTIDAO: "Solicitação de certidão",
  COMPLEMENTACAO: "Resposta a exigência",
  RECURSO: "Recurso",
  OUTRO: "Outro",
}
const ROTULO_SITUACAO: Record<string, string> = {
  PROTOCOLADO: "Protocolado",
  EM_ANALISE: "Em análise",
  EXIGENCIA: "Em exigência",
  DEFERIDO: "Deferido",
  INDEFERIDO: "Indeferido",
  ARQUIVADO: "Arquivado",
}

/** A situação usa as três famílias semânticas do contrato da paleta — nada além. */
const CorDaSituacao = (v: string): string =>
  v === "DEFERIDO" ? "var(--success-text)"
  : v === "INDEFERIDO" ? "var(--danger-text)"
  : v === "EXIGENCIA" ? "var(--warning-text)"
  : "var(--info-text)"

/**
 * Chave dos arquivos escolhidos ANTES de o protocolo existir.
 *
 * O anexo pertence a um protocolo, e o protocolo só tem id depois do POST — mas
 * obrigar o operador a registrar primeiro e anexar depois é pedir que ele lembre
 * de voltar. Ele escolhe junto; a subida acontece assim que o id existe, na
 * mesma ação. Negativo de propósito: nenhum id real colide.
 */
const PROTOCOLO_NOVO = -1

const SEM_PROTOCOLOS: Protocolo[] = []
const INPUT = "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)]"

const FORM_VAZIO = {
  orgaoId: "",
  dataProtocolo: "",
  numeroProtocolo: "",
  numeroProcesso: "",
  tipoProtocoloId: "",
  finalidade: "REQUERIMENTO",
  situacao: "PROTOCOLADO",
  requerenteIds: [] as number[],
  observacoes: "",
  documentoIds: [] as number[],
}

export function ProcessoProtocolos({
  processoId,
  contratantes,
  requerentes,
  onUpdate
}: ProcessoProtocolosProps) {

  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Protocolo | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)

  // Estados para upload
  const [arquivosPendentes, setArquivosPendentes] = useState<{[protocoloId: number]: File[]}>({})
  const [uploadingProtocoloId, setUploadingProtocoloId] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Verificar permissão do usuário
  const { pode } = usePermissoes()
  const podeEditar = pode('processos.editar_paginas')

  // Form state
  const [form, setForm] = useState(FORM_VAZIO)

  // Opções do ato: órgãos, responsáveis, documentos do processo e as dimensões
  // fechadas (tipo/forma de envio). Fonte única, resolvida no servidor.
  const opcoesReq = useApi<OpcoesProtocolo>(processoId ? `/api/protocolos/opcoes?processoId=${processoId}` : null)
  const opcoes = opcoesReq.dados
  /**
   * A CARDINALIDADE DA ROTA — quantos requerentes cabem num requerimento.
   *
   * Vem do cadastro (Modalidade Legal → `cardinalidadeRequerimento`), NUNCA do
   * país. Espanha/LMD é consular e individual: um expediente por pessoa, no
   * consulado do domicílio dela. Itália é judicial e coletiva: um ricorso, um
   * R.G., a família inteira. Enquanto o cadastro não responde, a tela assume a
   * regra mais restritiva — um requerimento coletivo criado por engano espalha o
   * erro por N pessoas de uma vez.
   */
  const cardinalidade = opcoes?.cardinalidade ?? "INDIVIDUAL"

  // ─── EXIGÊNCIAS ────────────────────────────────────────────────────────
  // O que o órgão pediu, e até quando. É o que trava o processo de verdade: sem
  // um lugar para registrar e dar baixa, o prazo do órgão vive na cabeça de
  // alguém — e o contador de "exigências em aberto" nunca sairia de zero.
  const [formExigencia, setFormExigencia] = useState<{ protocoloId: number; descricao: string; prazo: string } | null>(null)
  const [salvandoExigencia, setSalvandoExigencia] = useState(false)

  async function salvarExigencia() {
    if (!formExigencia) return
    if (!formExigencia.descricao.trim()) return setErroForm("Descreva o que o órgão exigiu.")
    setSalvandoExigencia(true)
    try {
      const res = await fetch(`/api/protocolos/${formExigencia.protocoloId}/exigencias`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({ descricao: formExigencia.descricao.trim(), prazo: formExigencia.prazo || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErroForm(j.error || "Erro ao registrar a exigência."); return }
      setFormExigencia(null)
      await fetchProtocolos()
    } finally { setSalvandoExigencia(false) }
  }

  async function alternarExigencia(protocoloId: number, exigenciaId: number, cumprida: boolean) {
    const res = await fetch(`/api/protocolos/${protocoloId}/exigencias/${exigenciaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
      body: JSON.stringify({ cumprida }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErroForm(j.error || "Erro ao atualizar a exigência.")
      return
    }
    await fetchProtocolos()
  }

  async function excluirExigencia(protocoloId: number, exigenciaId: number) {
    if (!confirm("Excluir esta exigência? O registro sai do histórico do protocolo.")) return
    const res = await fetch(`/api/protocolos/${protocoloId}/exigencias/${exigenciaId}`, {
      method: "DELETE", headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
    })
    if (!res.ok) { setErroForm("Erro ao excluir a exigência."); return }
    await fetchProtocolos()
  }

  /** Vencida, vence hoje, ou no prazo — a mesma régua semântica do resto do produto. */
  const situacaoDoPrazo = (prazo?: string | null, cumpridaEm?: string | null) => {
    if (cumpridaEm) return { cor: "var(--success-text)", texto: `cumprida em ${formatarDataHora(cumpridaEm)}` }
    if (!prazo) return { cor: "var(--text-muted)", texto: "sem prazo definido" }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const d = new Date(prazo); d.setHours(0, 0, 0, 0)
    const dias = Math.round((d.getTime() - hoje.getTime()) / 86400000)
    if (dias < 0) return { cor: "var(--danger-text)", texto: `vencida há ${Math.abs(dias)} dia(s)` }
    if (dias === 0) return { cor: "var(--warning-text)", texto: "vence hoje" }
    return { cor: "var(--text-secondary)", texto: `vence em ${dias} dia(s)` }
  }

  // Buscar protocolos
  // Leitura COMPOSTA: a lista de protocolos e, para cada um, os seus anexos. Em tela
  // isso é um resultado único, então é uma consulta única — `useConsulta` existe na
  // camada oficial exatamente para este caso, com o mesmo cache e a mesma política.
  // A tolerância por item fica: um anexo que falha vira lista vazia naquele protocolo,
  // sem derrubar a aba inteira.
  const consulta = useConsulta<Protocolo[]>(
    processoId ? `protocolos-com-anexos:${processoId}` : null,
    async () => {
      const lista = await buscar<{ protocolos?: Protocolo[] }>(`/api/protocolos?processoId=${processoId}`)
      return Promise.all(
        (lista.protocolos ?? []).map(async (protocolo) => {
          try {
            const anexos = await buscar<{ anexos?: Protocolo['anexos'] }>(`/api/protocolos/${protocolo.id}/anexos`)
            return { ...protocolo, anexos: anexos.anexos || [] }
          } catch {
            return { ...protocolo, anexos: [] }
          }
        }),
      )
    },
  )
  const protocolos = consulta.dados ?? SEM_PROTOCOLOS
  const loading = consulta.carregando
  const fetchProtocolos = consulta.recarregar

  // Resetar form
  const resetForm = () => {
    setArquivosPendentes((prev) => {
      const proximo = { ...prev }
      delete proximo[PROTOCOLO_NOVO]
      return proximo
    })
    setForm(FORM_VAZIO)
    setErroForm(null)
    setEditando(null)
    setShowForm(false)
  }

  // Abrir edição
  const abrirEdicao = (protocolo: Protocolo) => {
    setEditando(protocolo)
    setErroForm(null)
    setForm({
      orgaoId: protocolo.orgaoId ? String(protocolo.orgaoId) : "",
      dataProtocolo: paraDatetimeLocal(protocolo.dataProtocolo),
      numeroProtocolo: protocolo.numeroProtocolo || "",
      numeroProcesso: protocolo.numeroProcesso || "",
      tipoProtocoloId: protocolo.tipoProtocoloId ? String(protocolo.tipoProtocoloId) : "",
      finalidade: protocolo.finalidade || "REQUERIMENTO",
      situacao: protocolo.situacao || "PROTOCOLADO",
      requerenteIds: (protocolo.requerentesCobertos ?? []).map((r) => r.requerente.id),
      observacoes: protocolo.observacoes || "",
      documentoIds: (protocolo.documentos ?? []).map((d) => d.documentoId),
    })
    setShowForm(true)
  }

  const alternarDocumento = (documentoId: number) => {
    setForm((f) => ({
      ...f,
      documentoIds: f.documentoIds.includes(documentoId)
        ? f.documentoIds.filter((id) => id !== documentoId)
        : [...f.documentoIds, documentoId],
    }))
  }

  // Salvar (criar ou atualizar)
  const handleSalvar = async () => {
    // campos mínimos do ato — sem eles a protocolização não é rastreável
    if (!form.orgaoId) return setErroForm("Selecione o órgão que recebeu o protocolo.")
    if (!form.dataProtocolo) return setErroForm("Informe a data e a hora da protocolização.")
    if (!form.tipoProtocoloId) return setErroForm("Selecione o tipo de protocolo.")
    // A MESMA regra do servidor, dita ANTES de o operador perder o formulário.
    // Ela não substitui a do servidor — o banco continua sendo quem recusa.
    if (form.finalidade === "REQUERIMENTO") {
      if (form.requerenteIds.length === 0) {
        return setErroForm("Selecione quem este requerimento cobre.")
      }
      if (cardinalidade === "INDIVIDUAL" && form.requerenteIds.length > 1) {
        return setErroForm("Nesta rota o requerimento é individual: um requerente por protocolo.")
      }
    }

    setErroForm(null)
    setSalvando(true)
    try {
      const payload = {
        processoId,
        requerenteIds: form.requerenteIds,
        orgaoId: parseInt(form.orgaoId),
        dataProtocolo: new Date(form.dataProtocolo).toISOString(),
        numeroProtocolo: form.numeroProtocolo.trim(),
        numeroProcesso: form.numeroProcesso.trim() || null,
        tipoProtocoloId: form.tipoProtocoloId ? parseInt(form.tipoProtocoloId) : null,
        finalidade: form.finalidade,
        situacao: form.situacao,
        observacoes: form.observacoes.trim() || null,
        documentoIds: form.documentoIds,
      }

      const url = editando
        ? `/api/protocolos/${editando.id}`
        : "/api/protocolos"

      const method = editando ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        // OS ANEXOS ESCOLHIDOS NO FORMULÁRIO SOBEM AGORA, com o id recém-criado.
        // Se a subida falhar, o protocolo continua registrado e os arquivos
        // continuam pendentes no cartão — o operador reenvia de lá, sem perder o
        // ato. Anexo que falha não pode desfazer uma protocolização que aconteceu.
        const pendentesDoForm = arquivosPendentes[PROTOCOLO_NOVO] ?? []
        let novoId: number | null = null
        if (!editando && pendentesDoForm.length > 0) {
          const data = await response.json().catch(() => ({}))
          novoId = data?.protocolo?.id ?? null
          if (novoId) {
            setArquivosPendentes((prev) => {
              const proximo = { ...prev, [novoId as number]: pendentesDoForm }
              delete proximo[PROTOCOLO_NOVO]
              return proximo
            })
          }
        }
        resetForm()
        if (novoId) await handleUpload(novoId)
        fetchProtocolos()
        onUpdate?.()
      } else {
        const data = await response.json()
        setErroForm(data.error || "Erro ao salvar protocolo")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      setErroForm("Erro ao salvar protocolo")
    } finally {
      setSalvando(false)
    }
  }

  // Excluir protocolo
  const handleExcluir = async (id: number) => {
    if (!confirm("Excluir este protocolo e todos os seus anexos?")) return

    try {
      const response = await fetch(`/api/protocolos/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
      })

      if (response.ok) {
        fetchProtocolos()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao excluir:", error)
    }
  }

  // Excluir anexo
  const handleExcluirAnexo = async (protocoloId: number, anexoId: number) => {
    if (!confirm("Excluir este anexo?")) return

    try {
      const response = await fetch(`/api/protocolos/${protocoloId}/anexos/${anexoId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
      })

      if (response.ok) {
        fetchProtocolos()
      }
    } catch (error) {
      console.error("Erro ao excluir anexo:", error)
    }
  }

  // Selecionar arquivos
  const handleFileSelect = (protocoloId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const novosArquivos = Array.from(e.target.files)
      setArquivosPendentes(prev => ({
        ...prev,
        [protocoloId]: [...(prev[protocoloId] || []), ...novosArquivos]
      }))
    }
  }

  // Remover arquivo pendente
  const removerArquivoPendente = (protocoloId: number, index: number) => {
    setArquivosPendentes(prev => ({
      ...prev,
      [protocoloId]: prev[protocoloId].filter((_, i) => i !== index)
    }))
  }

  // ⬇️ R2: Fazer upload (envia pro R2 e salva metadata na API)
  const handleUpload = async (protocoloId: number) => {
    const arquivos = arquivosPendentes[protocoloId]
    if (!arquivos || arquivos.length === 0) return

    setUploadingProtocoloId(protocoloId)
    setUploadProgress(0)

    try {
      const uploaded = await uploadFiles(arquivos, {
        prefix: "processos/protocolos",
        onProgress: (_f, p) => setUploadProgress(p),
      })

      for (const file of uploaded) {
        try {
          await fetch(`/api/protocolos/${protocoloId}/anexos`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${localStorage.getItem("authToken")}`,
            },
            body: JSON.stringify({
              nome: file.name,
              nomeArquivo: file.name,
              urlArquivo: file.url,
              tamanho: file.size,
              mimeType: file.type || null,
            }),
          })
        } catch (error) {
          console.error("Erro ao salvar anexo:", error)
        }
      }

      // Limpar arquivos pendentes desse protocolo
      setArquivosPendentes(prev => {
        const novo = { ...prev }
        delete novo[protocoloId]
        return novo
      })

      fetchProtocolos()
    } catch (error: any) {
      alert(`Erro no upload: ${error.message}`)
    } finally {
      setUploadingProtocoloId(null)
      setUploadProgress(0)
    }
  }

  // CONTRATANTE vinculado (opcional). Os REQUERENTES não vêm daqui: eles são o
  // escopo do ato e saem de `requerentesCobertos`, que cabe um ou a família toda.
  const getNomePessoa = (protocolo: Protocolo) => {
    if (!protocolo.contratante) return null
    return `${nomePessoa(protocolo.contratante)} (Contratante)`
  }

  const rotuloOrgao = (protocolo: Protocolo) => {
    if (protocolo.orgao) return protocolo.orgao.city ? `${protocolo.orgao.name} — ${protocolo.orgao.city}` : protocolo.orgao.name
    // registro legado (Espanha), anterior ao órgão como fonte única
    return "Órgão não informado"
  }

  const rotuloForma = (valor?: string | null) =>
    opcoes?.formasEnvio.find((f) => f.valor === valor)?.label ?? null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-white/95">Protocolos</h3>
          {protocolos.length > 0 && (
            <span className="px-2 py-0.5 bg-[var(--surface-secondary)] text-amber-600 text-xs font-medium rounded-full">
              {protocolos.length}
            </span>
          )}
        </div>
        <Button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          size="sm"
          className={`bg-[var(--action-primary)] hover:bg-[var(--action-primary)] ${!podeEditar || protocolos.length === 0 ? 'hidden' : ''}`}
        >
          <Plus className="h-4 w-4 mr-1" />
          Registrar protocolo
        </Button>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
          </div>
        ) : showForm ? (
          /* ===== FORMULÁRIO ===== */
          <div className="max-w-2xl mx-auto bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-lg p-6">
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-semibold text-white/95">
                {editando ? "Editar protocolização" : "Registrar protocolização"}
              </h4>
              <button
                onClick={resetForm}
                className="text-[var(--text-muted)] hover:text-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-white/70 mb-6">
              O registro entra na Timeline e no Histórico do processo — a fonte cronológica oficial dos protocolos realizados.
            </p>

            <div className="space-y-4">
              {/* Órgão — o setor/guichê saiu: é detalhe de balcão que ninguém
                  consulta depois, e cada campo a mais é uma chance a mais de o
                  registro não ser feito na hora em que aconteceu. */}
              <div>
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">
                    <Building2 className="h-4 w-4 inline mr-1" />
                    Órgão *
                  </label>
                  <select
                    value={form.orgaoId}
                    onChange={(e) => setForm({ ...form, orgaoId: e.target.value })}
                    className={INPUT}
                  >
                    <option value="">Selecione o órgão</option>
                    {(opcoes?.orgaos ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.city ? `${o.name} — ${o.city}` : o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Data/hora + Número */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">
                    <Calendar className="h-4 w-4 inline mr-1" />
                    Data do protocolo *
                  </label>
                  <input
                    type="date"
                    value={form.dataProtocolo}
                    onChange={(e) => setForm({ ...form, dataProtocolo: e.target.value })}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">
                    <Hash className="h-4 w-4 inline mr-1" />
                    Número do protocolo
                  </label>
                  <Input
                    value={form.numeroProtocolo}
                    onChange={(e) => setForm({ ...form, numeroProtocolo: e.target.value })}
                    placeholder="Opcional — Ex: M8371/2"
                  />
                  <p className="text-xs text-white/60 mt-1">
                    Nem todo balcão devolve número na hora. Registre o ato agora e complete depois.
                  </p>
                </div>
              </div>

              {/* ── FINALIDADE + NÚMERO DO PROCESSO ────────────────────────────
                  São dois números diferentes e confundi-los custa caro: o
                  PROTOCOLO prova a entrega (o comprovante do guichê); o NÚMERO DO
                  PROCESSO é o que o órgão dá ao dossiê e o acompanha pelo resto da
                  vida — o *ruolo generale* do tribunal, o expediente do consulado.
                  É por ele que se consulta o andamento. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">Finalidade *</label>
                  <select
                    value={form.finalidade}
                    onChange={(e) => setForm({ ...form, finalidade: e.target.value })}
                    className={INPUT}
                  >
                    {(opcoes?.finalidades ?? ["REQUERIMENTO"]).map((f) => (
                      <option key={f} value={f}>{ROTULO_FINALIDADE[f] ?? f}</option>
                    ))}
                  </select>
                  <p className="text-xs text-white/70 mt-1">
                    O requerimento é o pedido em si. Retificação, certidão e complementação são atos do mesmo processo.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">
                    <Hash className="h-4 w-4 inline mr-1" />
                    Número do processo no órgão
                  </label>
                  <Input
                    value={form.numeroProcesso}
                    onChange={(e) => setForm({ ...form, numeroProcesso: e.target.value })}
                    placeholder="Ruolo generale / nº de expediente"
                  />
                </div>
              </div>

              {/* SITUAÇÃO — o que o ÓRGÃO respondeu. Não é a fase do nosso
                  workflow: o motor sabe em que etapa nós estamos, só o órgão sabe
                  se deferiu, exigiu ou arquivou. */}
              <div>
                <label className="block text-sm font-medium text-white/95 mb-1">Situação no órgão</label>
                <select
                  value={form.situacao}
                  onChange={(e) => setForm({ ...form, situacao: e.target.value })}
                  className={INPUT}
                >
                  {(opcoes?.situacoes ?? ["PROTOCOLADO"]).map((v) => (
                    <option key={v} value={v}>{ROTULO_SITUACAO[v] ?? v}</option>
                  ))}
                </select>
              </div>

              {/* Tipo do ato. A forma de envio saiu: presencial/correio/e-mail
                  descreve o meio, não o fato — e o fato é que foi protocolado. */}
              <div>
                <div>
                  <label className="block text-sm font-medium text-white/95 mb-1">Tipo de protocolo *</label>
                  <select
                    value={form.tipoProtocoloId}
                    onChange={(e) => setForm({ ...form, tipoProtocoloId: e.target.value })}
                    className={INPUT}
                  >
                    <option value="">Selecione o tipo</option>
                    {(opcoes?.tiposCadastro ?? []).map((t) => (
                      <option key={t.id} value={String(t.id)}>{t.nome}</option>
                    ))}
                  </select>
                  {(opcoes?.tiposCadastro ?? []).length === 0 && (
                    <p className="text-xs mt-1" style={{ color: "var(--warning-text)" }}>
                      Nenhum tipo cadastrado. Cadastre em Gerenciamento → Documentos e Protocolos → Tipos de Protocolo.
                    </p>
                  )}
                </div>
              </div>

              {/* RESPONSÁVEL e CONTRATANTE saíram do formulário.
                  Responsável é quem está registrando — perguntar é pedir que a
                  pessoa se identifique duas vezes, e a resposta errada só
                  apareceria num relatório meses depois; o servidor grava o
                  usuário da sessão. Contratante é vínculo do PROCESSO, não do
                  ato: quem contratou não muda a cada protocolo. */}

              {/* ── ESCOPO: QUEM ESTE PROTOCOLO COBRE ──────────────────────────
                  O mesmo formulário serve Espanha e Itália. O que muda é quantos
                  cabem, e isso vem do cadastro — a tela não pergunta o país. */}
              <div>
                <label className="block text-sm font-medium text-white/95 mb-1">
                  Requerentes cobertos {form.finalidade === "REQUERIMENTO" && <span className="text-[var(--danger)]">*</span>}
                </label>
                {opcoes && opcoes.cardinalidadeDeclarada === false && (
                  <p
                    className="text-xs mb-2 rounded-md px-3 py-2"
                    style={{ backgroundColor: "var(--warning-tile)", color: "var(--warning-text)" }}
                  >
                    Este processo ainda não tem <strong>modalidade legal</strong> declarada, então o sistema não sabe
                    se o requerimento desta rota é individual ou coletivo — está aplicando a regra mais restritiva
                    (um requerente). Declare em Gerenciamento para que a tela pare de adivinhar.
                  </p>
                )}
                <p className="text-xs text-white/70 mb-2">
                  {cardinalidade === "COLETIVO"
                    ? "Esta rota é coletiva: um requerimento cobre os requerentes selecionados, sob um único número de processo."
                    : "Esta rota é individual: um requerimento por requerente, com número de processo próprio."}
                </p>
                {requerentes.length === 0 ? (
                  <p className="text-sm text-white/70 border border-[var(--border-subtle)] rounded-md px-3 py-2">
                    Nenhum requerente vinculado a este processo.
                  </p>
                ) : (
                  <div className="border border-[var(--border-subtle)] rounded-md max-h-44 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                    {requerentes.map((r) => {
                      const marcado = form.requerenteIds.includes(r.id)
                      return (
                        <label
                          key={`req-${r.id}`}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-white/95 hover:bg-[var(--surface-tertiary)] cursor-pointer"
                        >
                          <input
                            type={cardinalidade === "COLETIVO" ? "checkbox" : "radio"}
                            name="requerentes-cobertos"
                            checked={marcado}
                            onChange={() => setForm({
                              ...form,
                              requerenteIds: cardinalidade === "COLETIVO"
                                ? (marcado ? form.requerenteIds.filter((id) => id !== r.id) : [...form.requerenteIds, r.id])
                                : [r.id],
                            })}
                          />
                          <span>{nomePessoa(r)}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {cardinalidade === "COLETIVO" && requerentes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      requerenteIds: form.requerenteIds.length === requerentes.length ? [] : requerentes.map((r) => r.id),
                    })}
                    className="mt-1 text-xs text-[var(--accent-text)] hover:underline"
                  >
                    {form.requerenteIds.length === requerentes.length ? "Limpar seleção" : "Selecionar todos os requerentes"}
                  </button>
                )}
              </div>

              {/* Documentos enviados */}
              <div>
                <label className="block text-sm font-medium text-white/95 mb-1">
                  <Layers className="h-4 w-4 inline mr-1" />
                  Documentos enviados
                </label>
                {(opcoes?.documentos ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-default)] rounded-md p-3">
                    Nenhum documento disponível neste processo.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto border border-[var(--border-default)] rounded-md divide-y divide-gray-100">
                    {(opcoes?.documentos ?? []).map((d) => (
                      <label key={d.id} className="flex items-start gap-2 px-3 py-2 text-sm text-white/95 hover:bg-[var(--surface-tertiary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.documentoIds.includes(d.id)}
                          onChange={() => alternarDocumento(d.id)}
                          className="mt-0.5"
                        />
                        <span>{rotuloDocumento(d)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-white/95 mb-1">
                  Observações
                </label>
                <textarea
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                  placeholder="Anotações sobre o protocolo..."
                  className={INPUT}
                  rows={3}
                />
              </div>

              {/* ── COMPROVANTES ────────────────────────────────────────────
                  Anexar junto com o registro, não depois: o comprovante do
                  guichê está na mão do operador NESTE momento. */}
              <div>
                <label className="block text-sm font-medium text-white/95 mb-1">
                  <Paperclip className="h-4 w-4 inline mr-1" />
                  Comprovantes e anexos
                </label>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border-default)] px-4 py-4 text-sm text-white/70 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
                  <Upload className="h-4 w-4" />
                  Escolher arquivos (comprovante, recibo, protocolo assinado…)
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const arquivos = Array.from(e.target.files ?? [])
                      if (arquivos.length === 0) return
                      setArquivosPendentes((prev) => ({
                        ...prev,
                        [PROTOCOLO_NOVO]: [...(prev[PROTOCOLO_NOVO] ?? []), ...arquivos],
                      }))
                      e.target.value = ""
                    }}
                  />
                </label>
                {(arquivosPendentes[PROTOCOLO_NOVO] ?? []).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {(arquivosPendentes[PROTOCOLO_NOVO] ?? []).map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md bg-[var(--surface-secondary)] px-3 py-1.5 text-xs text-white/90">
                        <span className="truncate">{f.name} · {formatFileSize(f.size)}</span>
                        <button
                          type="button"
                          onClick={() => removerArquivoPendente(PROTOCOLO_NOVO, i)}
                          className="ml-3 shrink-0 text-[var(--danger-text)] hover:underline"
                        >
                          remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-white/60 mt-1">
                  Sobem assim que o protocolo for registrado. Também dá para anexar depois, no cartão do protocolo.
                </p>
              </div>

              {erroForm && (
                <p className="text-sm text-red-600 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-md px-3 py-2">{erroForm}</p>
              )}

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSalvar}
                  disabled={salvando}
                  className="flex-1 bg-[var(--action-primary)] hover:bg-[var(--action-primary)]"
                >
                  {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editando ? "Salvar alterações" : "Registrar protocolo"}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={salvando}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        ) : protocolos.length === 0 ? (
          /* ===== EMPTY STATE ===== */
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
            <h3 className="text-lg font-medium text-white/95">Nenhuma protocolização registrada</h3>
            <p className="text-sm text-white/70 mt-1 mb-4">
              {podeEditar
                ? "Registre aqui cada protocolo realizado — ele entra na Timeline e no Histórico do processo"
                : "Ainda não há protocolos registrados para este processo"
              }
            </p>
            {podeEditar && (
              <Button
                onClick={() => setShowForm(true)}
                className="bg-[var(--action-primary)] hover:bg-[var(--action-primary)]"
              >
                <Plus className="h-4 w-4 mr-2" />
                Registrar primeiro protocolo
              </Button>
            )}
          </div>
        ) : (
          /* ===== LISTA DE PROTOCOLOS ===== */
          <div className="space-y-4">
            {protocolos.map((protocolo) => {
              const anexos = protocolo.anexos || []
              const documentos = protocolo.documentos || []
              const arquivosPendentesProtocolo = arquivosPendentes[protocolo.id] || []
              const isUploadingThis = uploadingProtocoloId === protocolo.id
              const pessoa = getNomePessoa(protocolo)

              return (
                <div
                  key={protocolo.id}
                  className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-lg overflow-hidden"
                >
                  {/* Card principal */}
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Órgão + setor */}
                        <div className="flex items-center gap-2 mb-2">
                          <Building2 className="h-4 w-4 text-white/70" />
                          <span className="font-semibold text-white/95">
                            {rotuloOrgao(protocolo)}
                          </span>
                          {protocolo.setor && (
                            <span className="text-xs px-2 py-0.5 bg-[var(--surface-tertiary)] text-white/70 rounded">
                              {protocolo.setor}
                            </span>
                          )}
                          {protocolo.tipo?.nome && (
                            <span className="text-xs px-2 py-0.5 bg-[var(--surface-secondary)] text-amber-800 rounded">
                              {protocolo.tipo.nome}
                            </span>
                          )}
                          {protocolo.finalidade && protocolo.finalidade !== "REQUERIMENTO" && (
                            <span className="text-xs px-2 py-0.5 bg-[var(--surface-secondary)] text-white/80 rounded">
                              {ROTULO_FINALIDADE[protocolo.finalidade] ?? protocolo.finalidade}
                            </span>
                          )}
                          {protocolo.situacao && protocolo.situacao !== "PROTOCOLADO" && (
                            <span
                              className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{
                                backgroundColor: `${CorDaSituacao(protocolo.situacao)}22`,
                                color: CorDaSituacao(protocolo.situacao),
                              }}
                            >
                              {ROTULO_SITUACAO[protocolo.situacao] ?? protocolo.situacao}
                            </span>
                          )}
                        </div>

                        {/* Info do protocolo */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm ml-5">
                          <div className="flex items-center gap-2 text-white/70">
                            <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
                            <span>{formatarDataHora(protocolo.dataProtocolo)}</span>
                          </div>

                          {protocolo.numeroProtocolo && (
                            <div className="flex items-center gap-2 text-white/70">
                              <Hash className="h-4 w-4 text-[var(--text-muted)]" />
                              <span className="font-mono">{protocolo.numeroProtocolo}</span>
                            </div>
                          )}

                          {protocolo.numeroProcesso && (
                            <div className="flex items-center gap-2 text-white/70">
                              <FileText className="h-4 w-4 text-[var(--text-muted)]" />
                              <span className="font-mono" title="Número do processo no órgão">
                                {protocolo.numeroProcesso}
                              </span>
                            </div>
                          )}

                          {rotuloForma(protocolo.formaEnvio) && (
                            <div className="flex items-center gap-2 text-white/70">
                              <Send className="h-4 w-4 text-[var(--text-muted)]" />
                              <span>{rotuloForma(protocolo.formaEnvio)}</span>
                            </div>
                          )}

                          {protocolo.responsavel && (
                            <div className="flex items-center gap-2 text-white/70">
                              <User className="h-4 w-4 text-[var(--text-muted)]" />
                              <span>{protocolo.responsavel.nome}</span>
                            </div>
                          )}
                        </div>

                        {/* ESCOPO — quem este protocolo cobre. Na Espanha é um
                            nome; na Itália é a família inteira. A mesma linha
                            serve aos dois porque a fonte é a mesma tabela. */}
                        {(protocolo.requerentesCobertos ?? []).length > 0 && (
                          <p className="text-xs text-white/70 mt-2 ml-5">
                            <span className="text-white/60">
                              {protocolo.requerentesCobertos!.length === 1 ? "Requerente: " : `Requerentes (${protocolo.requerentesCobertos!.length}): `}
                            </span>
                            {protocolo.requerentesCobertos!.map((r) => nomePessoa(r.requerente)).join(" · ")}
                          </p>
                        )}

                        {(protocolo.exigencias ?? []).some((e) => e.cumpridaEm == null) && (
                          <p className="text-xs mt-1 ml-5" style={{ color: "var(--warning-text)" }}>
                            {protocolo.exigencias!.filter((e) => e.cumpridaEm == null).length} exigência(s) em aberto
                          </p>
                        )}

                        {pessoa && (
                          <p className="text-xs text-white/70 mt-2 ml-5">{pessoa}</p>
                        )}

                        {/* Documentos enviados */}
                        {documentos.length > 0 && (
                          <div className="mt-2 ml-5">
                            <p className="text-xs font-medium text-white/70 flex items-center gap-1">
                              <Layers className="h-3.5 w-3.5" />
                              Documentos enviados ({documentos.length})
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {documentos.map((d) => (
                                <li key={d.id} className="text-xs text-white/70">
                                  •{" "}
                                  {rotuloDocumento({
                                    publicCode: d.documento?.publicCode,
                                    tipo: d.documento?.tipo,
                                    descricao: d.documento?.descricao,
                                    pessoa: d.documento?.pessoa?.nome,
                                  })}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Observações */}
                        {protocolo.observacoes && (
                          <p className="text-sm text-white/70 mt-2 ml-5 italic">
                            {protocolo.observacoes}
                          </p>
                        )}
                      </div>

                      {/* Ações - Apenas para quem pode editar */}
                      {podeEditar && (
                        <div className="flex items-center gap-1 ml-4">
                          <button
                            onClick={() => abrirEdicao(protocolo)}
                            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg hover:bg-[var(--surface-secondary)]"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleExcluir(protocolo.id)}
                            className="p-2 text-[var(--text-muted)] hover:text-red-500 rounded-lg hover:bg-[var(--surface-secondary)]"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── EXIGÊNCIAS DO ÓRGÃO ────────────────────────────────
                        O que trava o processo de verdade. Fica no cartão do
                        protocolo porque é o órgão daquele protocolo que exigiu —
                        e a baixa aqui move a situação sozinha: com exigência
                        aberta o protocolo está EM EXIGÊNCIA, sem nenhuma volta a
                        EM ANÁLISE. Ninguém precisa lembrar de trocar à mão. */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-white/95 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Exigências do órgão
                          {(protocolo.exigencias ?? []).filter((e) => !e.cumpridaEm).length > 0 && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ backgroundColor: "var(--warning-tile)", color: "var(--warning-text)" }}
                            >
                              {(protocolo.exigencias ?? []).filter((e) => !e.cumpridaEm).length} em aberto
                            </span>
                          )}
                        </h4>
                        {podeEditar && formExigencia?.protocoloId !== protocolo.id && (
                          <button
                            type="button"
                            onClick={() => setFormExigencia({ protocoloId: protocolo.id, descricao: "", prazo: "" })}
                            className="text-xs font-medium text-[var(--accent-text)] hover:underline"
                          >
                            + Registrar exigência
                          </button>
                        )}
                      </div>

                      {(protocolo.exigencias ?? []).length === 0 && formExigencia?.protocoloId !== protocolo.id && (
                        <p className="text-xs text-white/60">Nenhuma exigência registrada neste protocolo.</p>
                      )}

                      {(protocolo.exigencias ?? []).length > 0 && (
                        <ul className="space-y-1.5">
                          {(protocolo.exigencias ?? []).map((ex) => {
                            const prazo = situacaoDoPrazo(ex.prazo, ex.cumpridaEm)
                            return (
                              <li
                                key={ex.id}
                                className="flex items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 py-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!ex.cumpridaEm}
                                  disabled={!podeEditar}
                                  onChange={() => void alternarExigencia(protocolo.id, ex.id, !ex.cumpridaEm)}
                                  aria-label={ex.cumpridaEm ? "Reabrir exigência" : "Marcar exigência como cumprida"}
                                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--action-primary)]"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className={`text-sm ${ex.cumpridaEm ? "text-white/50 line-through" : "text-white/90"}`}>
                                    {ex.descricao}
                                  </p>
                                  <p className="text-[11px]" style={{ color: prazo.cor }}>
                                    {ex.prazo ? `prazo ${formatarDataHora(ex.prazo)} · ` : ""}{prazo.texto}
                                  </p>
                                </div>
                                {podeEditar && (
                                  <button
                                    type="button"
                                    onClick={() => void excluirExigencia(protocolo.id, ex.id)}
                                    title="Excluir exigência"
                                    className="shrink-0 rounded p-1 text-[var(--danger-text)] hover:bg-[var(--surface-hover)]"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {formExigencia?.protocoloId === protocolo.id && (
                        <div className="mt-2 space-y-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
                          <textarea
                            value={formExigencia.descricao}
                            onChange={(e) => setFormExigencia({ ...formExigencia, descricao: e.target.value })}
                            placeholder="O que o órgão exigiu, no texto dele."
                            rows={2}
                            className={INPUT}
                          />
                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="block text-[11px] text-white/70 mb-1">Prazo dado pelo órgão</label>
                              <input
                                type="date"
                                value={formExigencia.prazo}
                                onChange={(e) => setFormExigencia({ ...formExigencia, prazo: e.target.value })}
                                className={INPUT}
                              />
                            </div>
                            <div className="ml-auto flex gap-2">
                              <Button variant="outline" onClick={() => setFormExigencia(null)} disabled={salvandoExigencia}>
                                Cancelar
                              </Button>
                              <Button onClick={() => void salvarExigencia()} disabled={salvandoExigencia}>
                                {salvandoExigencia ? "Registrando…" : "Registrar exigência"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Seção de Anexos */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-sm font-medium text-white/95 flex items-center gap-2 mb-3">
                        <Paperclip className="h-4 w-4" />
                        Comprovantes e anexos
                        {anexos.length > 0 && (
                          <span className="text-xs px-1.5 py-0.5 bg-[var(--surface-secondary)] text-[var(--text-secondary)] rounded">
                            {anexos.length}
                          </span>
                        )}
                      </h4>

                      {/* Grid de anexos existentes */}
                      {anexos.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                          {anexos.map((anexo) => {
                            const isImage = anexo.mimeType?.startsWith("image/")
                            const isPDF = anexo.mimeType === "application/pdf"

                            return (
                              <div
                                key={anexo.id}
                                className="group relative bg-[var(--surface-popover)] rounded-lg border border-[var(--border-default)] overflow-hidden hover:shadow-[var(--elev-2)] transition-shadow"
                              >
                                {/* Preview */}
                                <a
                                  href={anexo.urlArquivo}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block aspect-square relative overflow-hidden"
                                >
                                  {isImage ? (
                                    <img
                                      src={anexo.urlArquivo}
                                      alt={anexo.nome}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-[var(--surface-tertiary)]">
                                      {isPDF ? (
                                        <div className="w-12 h-14 bg-red-700 rounded-sm flex items-center justify-center text-[var(--action-primary-ink)] text-xs font-bold">
                                          PDF
                                        </div>
                                      ) : (
                                        <FileText className="h-12 w-12 text-[var(--text-muted)]" />
                                      )}
                                    </div>
                                  )}

                                  {/* Overlay */}
                                  <div className="absolute inset-0 bg-[var(--overlay-modal)] group-hover:bg-[var(--overlay-modal)] transition-colors flex items-center justify-center">
                                    <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </a>

                                {/* Info */}
                                <div className="p-2 border-t border-[var(--border-default)]">
                                  <p className="text-xs text-white/95 truncate" title={anexo.nome}>
                                    {anexo.nome}
                                  </p>
                                  {anexo.tamanho && (
                                    <p className="text-xs text-[var(--text-muted)]">{formatFileSize(anexo.tamanho)}</p>
                                  )}
                                </div>

                                {/* Botão remover - apenas para quem pode editar */}
                                {podeEditar && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      handleExcluirAnexo(protocolo.id, anexo.id)
                                    }}
                                    className="absolute top-1 right-1 p-1 bg-red-600 hover:bg-red-800 rounded-full text-[var(--action-primary-ink)] opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Arquivos selecionados (pendentes de upload) - apenas para quem pode editar */}
                      {podeEditar && arquivosPendentesProtocolo.length > 0 && (
                        <div className="mb-4 space-y-2">
                          <p className="text-sm text-white/70 font-medium">Arquivos selecionados:</p>
                          {arquivosPendentesProtocolo.map((arquivo, index) => (
                            <div key={index} className="flex items-center justify-between p-3 bg-[var(--surface-secondary)] rounded-lg border border-[var(--border-default)]">
                              <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-amber-600" />
                                <div>
                                  <p className="text-sm font-medium text-white/95">{arquivo.name}</p>
                                  <p className="text-xs text-white/70">{formatFileSize(arquivo.size)}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removerArquivoPendente(protocolo.id, index)}
                                className="p-1 hover:bg-[var(--surface-secondary)] rounded text-red-500"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}

                          {/* Botão de Upload */}
                          <button
                            type="button"
                            onClick={() => handleUpload(protocolo.id)}
                            disabled={uploadingProtocoloId !== null}
                            className="mt-2 w-full py-2 px-4 bg-[var(--action-primary)] hover:bg-[var(--action-primary)] disabled:bg-[var(--text-muted)] text-[var(--action-primary-ink)] rounded-lg font-medium transition-colors"
                          >
                            {isUploadingThis ? (
                              <span className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Enviando... {uploadProgress}%
                              </span>
                            ) : (
                              `Enviar ${arquivosPendentesProtocolo.length} arquivo(s)`
                            )}
                          </button>
                        </div>
                      )}

                      {/* Área de drop/seleção - apenas para quem pode editar */}
                      {podeEditar && (
                        <label className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-[var(--border-default)] hover:bg-[var(--surface-secondary)]/50 transition-colors block">
                          <input
                            type="file"
                            multiple
                            onChange={(e) => handleFileSelect(protocolo.id, e)}
                            className="hidden"
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                          />
                          <FileText className="h-8 w-8 mx-auto mb-2 text-[var(--text-muted)]" />
                          <p className="text-sm text-white/70 font-medium">Clique para selecionar arquivos</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">Imagens, PDF, Word, Excel (máx. 64MB cada)</p>
                        </label>
                      )}

                      {/* Mensagem quando não pode editar e não tem anexos */}
                      {!podeEditar && anexos.length === 0 && (
                        <p className="text-sm text-[var(--text-muted)] text-center py-4">Nenhum anexo</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
