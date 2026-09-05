// src/components/kanban/atividade-details-modal.tsx

"use client"

import { nomePessoa } from "@/src/lib/ui/pessoa-exibicao"
import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MapTooltip } from "../ui/map-tooltip"
import { ArvoreGenealogicaView } from "../arvore"
// ⚠ ALTERAÇÃO: ProcessoTarefas sai do Geral e vai migrar para Central Operacional (aba a criar)
// import { ProcessoTarefas } from "./ProcessoTarefas"
import { ProcessoEstatisticas } from "./ProcessoEstatisticas"
import { ProcessoCentralOperacional } from "./ProcessoCentralOperacional"
import { ProcessoAnalise } from "./ProcessoAnalise"
// Diagnóstico técnico do Runtime v2 (WorkflowV2Panel/WorkflowV2AtivacaoPanel) foi
// movido para Gerenciamento → Motor → Diagnóstico do Runtime. A Central Operacional
// é puramente operacional.
import { ProcessoDocumentos } from "./ProcessoDocumentos"
import { ProcuracaoDoProcesso } from "./ProcuracaoDoProcesso"
import { ProcessoProtocolos } from "./ProcessoProtocolos"
import { ProcessoHistorico } from "./ProcessoHistorico"
// SLA operacional do processo (engine única — src/lib/motor/sla-core.ts)
import { ProcessoSlaCard } from "./ProcessoSlaCard"
import { ProcessoFinanceiroShell } from "@/src/components/financeiro/v3/ProcessoFinanceiroShell"
// ✅ IMPORTAR o modal e o initialFormData
import { ContratanteModal, initialFormData } from "../contratantes-tabela"
import { ProcessoEventos } from "./ProcessoEventos"
import { usePermissoes } from "@/src/hooks/use-permissoes"
// ✅ NOVO: header de progresso da fase do processo
import { PhaseProgressHeader } from "@/src/components/processo/PhaseProgressHeader"
import { 
  X,
  Phone,
  Mail,
  ChevronDown,
  Plus,
  MessageSquare,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  GitBranch,
  User,
  MapPin,
  Trash2,
  FileText,
  Link2
} from "lucide-react"
import {
  type ProcessoWithStatus,
  type Processo,
  type Contratante,
  type Requerente
} from "@/src/types/kanban"

// Lista de países (necessária para o modal)
const PAISES_OPTIONS = [
  { nome: "Brasil", codigo: "br" },
  { nome: "Estados Unidos", codigo: "us" },
  { nome: "Portugal", codigo: "pt" },
  { nome: "Espanha", codigo: "es" },
  { nome: "Itália", codigo: "it" },
  { nome: "Alemanha", codigo: "de" },
  { nome: "França", codigo: "fr" },
  { nome: "Reino Unido", codigo: "gb" },
  { nome: "Argentina", codigo: "ar" },
  { nome: "Canadá", codigo: "ca" },
  { nome: "Japão", codigo: "jp" },
  { nome: "Outro", codigo: null },
]

interface ProcessoDetailsModalProps {
  processo: ProcessoWithStatus | Processo | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  initialTab?: string
  initialPessoaId?: number
  initialSidebarTab?: string
  initialAtividadeId?: number  // ← ADICIONAR
  /** DEEP-LINK: tarefa que a Central Operacional deve localizar. */
  initialTaskId?: number
}

/**
 * País do processo, por IDENTIDADE.
 *
 * Comparava com "ITALIA" em maiúsculas enquanto o banco grava a chave do
 * cadastro em minúsculas ('italia') — nunca era verdadeiro. Comparação de
 * negócio por texto tem exatamente esse defeito: ela não falha, ela mente.
 */
function ehItalia(processo: ProcessoWithStatus | Processo | null): boolean {
  const p = processo as { paisCanonico?: { countryKey?: string } | null; pais?: string | null } | null
  const chave = p?.paisCanonico?.countryKey ?? p?.pais ?? ""
  return chave.toLowerCase() === "italia"
}

/** Abas válidas do modal. */
type AbaProcesso = "geral" | "central" | "documentos" | "analise" | "faturas" | "financeiroV2" | "historico" | "arvore" | "protocolos" | "eventos"

/**
 * Aba inicial a partir do deep-link. Puro: mesma entrada, mesma saída — era isto que a
 * cadeia de `else if` dentro do efeito fazia, com um flag `initialParamsProcessed` para
 * não repetir. Sem efeito, não há o que repetir.
 */
function abaInicial(initialTab: string | undefined, isItalia: boolean): AbaProcesso {
  const permitidas: AbaProcesso[] = ["documentos", "central", "arvore", "geral", "faturas", "historico", "eventos"]
  if (initialTab && (permitidas as string[]).includes(initialTab)) return initialTab as AbaProcesso
  // Protocolo é ocorrência de QUALQUER processo — não é mais exclusivo da Espanha.
  if (initialTab === "protocolos") return "protocolos"
  return "geral"
}

/**
 * Casca fina: o conteúdo do modal só existe ABERTO, e a sua identidade é o processo.
 * Substitui três efeitos — o que aplicava os parâmetros do deep-link uma única vez, o
 * que limpava tudo ao fechar, e o que copiava `processo` para os campos editáveis.
 */
export function ProcessoDetailsModal(props: ProcessoDetailsModalProps) {
  if (!props.isOpen || !props.processo) return null
  return <ConteudoModal key={props.processo.id} {...props} />
}

function ConteudoModal({ 
  processo, 
  isOpen, 
  onClose, 
  onSave,
  contratantes: contratantesProp = [],
  requerentes: requerentesProp = [],
  initialTab,
  initialPessoaId,
  initialSidebarTab,
  initialAtividadeId,    // ← ADICIONAR ESTA LINHA
  initialTaskId,
}: ProcessoDetailsModalProps) {
  // ✅ ATUALIZADO: Adicionado "informacoes" como possível aba
  const { pode } = usePermissoes()
  const [activeTab, setActiveTab] = useState<AbaProcesso>(
    () => abaInicial(initialTab, ehItalia(processo)),
  )
  // Financeiro V3 no processo: quando a flag posicaoRead está ativa, a aba usa a
  // tela V3 (Ledger); senão, o legado como fallback temporário.
  const [financeiroV3Ativo, setFinanceiroV3Ativo] = useState<boolean | null>(null)
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
    fetch("/api/financeiro/v3/flags", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => r.json()).then((d) => setFinanceiroV3Ativo(!!d?.flags?.posicaoRead)).catch(() => setFinanceiroV3Ativo(false))
  }, [])

  // A fase é relida quando a aba muda — o usuário pode ter mexido em docs/pessoas em
  // outra aba. Antes isso era um contador incrementado por efeito; agora a própria aba
  // IDENTIFICA a leitura, e voltar a uma aba já vista mostra o valor em cache enquanto
  // revalida, em vez de piscar.
  const [phaseRefreshExtra, setPhaseRefreshExtra] = useState(0)
  const phaseRefreshKey = `${activeTab}:${phaseRefreshExtra}`

  // Modo edição
  const [isEditing, setIsEditing] = useState(false)
  const [nomeEditado, setNomeEditado] = useState(processo?.nome || "")
  const [contratantesSelecionados, setContratantesSelecionados] = useState<Contratante[]>(processo?.contratantes || [])
  const [requerentesSelecionados, setRequerentesSelecionados] = useState<Requerente[]>(processo?.requerentes || [])
  
  // Busca de contatos
  const [buscaContratante, setBuscaContratante] = useState("")
  const [buscaRequerente, setBuscaRequerente] = useState("")
  const [showContratanteDropdown, setShowContratanteDropdown] = useState(false)
  const [showRequerenteDropdown, setShowRequerenteDropdown] = useState(false)
  
  // Listas de contatos
  const [contratantes, setContratantes] = useState<Contratante[]>(contratantesProp)
  const [requerentes, setRequerentes] = useState<Requerente[]>(requerentesProp)
  
  // Árvore genealógica
  const [arvoreIdLocal, setArvoreIdLocal] = useState<number | null>(processo?.arvoreId || null)

  // ── VINCULAR REQUERENTE A UMA PESSOA JÁ EXISTENTE NA ÁRVORE ─────────────────
  // Um requerente sem `personId` pode já estar na árvore (ex.: veio de Importar
  // Árvore) — sem isto, o único jeito de dar nó a ele era pela aba Árvore
  // Genealógica, que sempre CRIA uma pessoa nova (duplicando quem já existe).
  // Mesma porta de dedup do fluxo manual: POST /api/arvore/{id}/vincular-requerente.
  const [vinculandoRequerenteId, setVinculandoRequerenteId] = useState<number | null>(null)
  const [pessoasDaArvoreSemRequerente, setPessoasDaArvoreSemRequerente] = useState<Array<{ id: number; nome: string }>>([])
  const [carregandoPessoasArvore, setCarregandoPessoasArvore] = useState(false)
  const [pessoaEscolhidaId, setPessoaEscolhidaId] = useState<number | ''>('')
  const [salvandoVinculoArvore, setSalvandoVinculoArvore] = useState(false)
  const [erroVinculoArvore, setErroVinculoArvore] = useState<string | null>(null)

  async function abrirVinculoComArvore(requerenteId: number) {
    setVinculandoRequerenteId(requerenteId)
    setPessoaEscolhidaId('')
    setErroVinculoArvore(null)
    if (!arvoreIdLocal) return
    setCarregandoPessoasArvore(true)
    try {
      const res = await fetch(`/api/arvore/${arvoreIdLocal}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      const data = await res.json().catch(() => ({}))
      const pessoas = (data?.pessoas ?? []) as Array<{ id: number; nome: string; sobrenome?: string | null; requerente?: string | null }>
      setPessoasDaArvoreSemRequerente(
        pessoas
          .filter((p) => !["sim", "maior", "menor"].includes(String(p.requerente ?? "").toLowerCase()))
          .map((p) => ({ id: p.id, nome: [p.nome, p.sobrenome].filter(Boolean).join(" ") }))
      )
    } catch {
      setErroVinculoArvore("Não foi possível carregar as pessoas da árvore.")
    } finally {
      setCarregandoPessoasArvore(false)
    }
  }

  async function confirmarVinculoComArvore() {
    if (!vinculandoRequerenteId || !pessoaEscolhidaId || !arvoreIdLocal) return
    setSalvandoVinculoArvore(true)
    setErroVinculoArvore(null)
    try {
      const res = await fetch(`/api/arvore/${arvoreIdLocal}/vincular-requerente`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ requerenteId: vinculandoRequerenteId, pessoaId: pessoaEscolhidaId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Erro ao vincular requerente à árvore")
      setVinculandoRequerenteId(null)
      onSave?.()
    } catch (e) {
      setErroVinculoArvore(e instanceof Error ? e.message : "Erro ao vincular requerente à árvore")
    } finally {
      setSalvandoVinculoArvore(false)
    }
  }
  
  // Estado para pessoa selecionada na árvore
  // Vindos do deep-link: valor inicial desta abertura. Como o conteúdo desmonta ao
  // fechar, não existe mais o efeito que os limpava.
  const [pessoaIdParaFocar, setPessoaIdParaFocar] = useState<number | undefined>(initialPessoaId)
  const [sidebarTabParaFocar, setSidebarTabParaFocar] = useState<string | undefined>(initialSidebarTab)
  
  // ✅ NOVO: Estados para o modal de detalhes do cliente
  const [clienteModalOpen, setClienteModalOpen] = useState(false)
  const [clienteFormData, setClienteFormData] = useState(initialFormData)
  const [clienteEditingId, setClienteEditingId] = useState<number | null>(null)
  // O código público do cliente é identidade de CADASTRO: não aparece no processo,
  // mas a FICHA do cliente (contexto administrativo) tem de mostrá-lo.
  const [clienteCodigo, setClienteCodigo] = useState<string | null>(null)
  const [clienteTipo, setClienteTipo] = useState<string>("contratante")
  const [clienteIsViewMode, setClienteIsViewMode] = useState(true)
  
  const contratanteRef = useRef<HTMLDivElement>(null)
  const requerenteRef = useRef<HTMLDivElement>(null)
  

  // Classes padrão para formulários
  // Sem uso hoje, mas mantido com a cor explícita de propósito: é justamente
  // deste arquivo que sai o `text-white/80` das abas, e uma classe de campo com
  // `bg-[var(--surface-primary)]` e sem cor de texto é a semente do bug — quem copiar daqui herda
  // o campo branco no branco.
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 placeholder:text-[var(--text-muted)] text-sm h-[42px]"

  // A ABA "INFORMAÇÕES" SAIU (31/08/2026). Ela era exclusiva da Itália e
  // guardava tribunal + ruolo generale + datas de protocolo — os MESMOS fatos que
  // a aba Protocolos passou a registrar, para os dois países, com o órgão vindo
  // do cadastro em vez de um enum. Duas telas afirmando o mesmo fato é o que esta
  // rodada existiu para acabar; o tribunal agora é uma organização como outra
  // qualquer, e o número do processo mora no protocolo que o originou.

  // ✅ NOVO: Função para abrir o modal de detalhes do cliente
  const abrirDetalhesCliente = (cliente: Contratante | Requerente, tipo: "contratante" | "requerente") => {
    const clienteAny = cliente as any
    const paisSalvo = clienteAny.pais || "Brasil"
    const paisNaLista = PAISES_OPTIONS.some(p => p.nome === paisSalvo)
    
    setClienteFormData({
      tipo,
      nome: cliente.nome || "",
      cpf: cliente.cpf || "",
      rg: cliente.rg || "",
      passaporte: clienteAny.passaporte || "",
      crnm: clienteAny.crnm || "",
      dataNascimento: cliente.dataNascimento 
        ? new Date(cliente.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: cliente.sexo || "",
      estadoCivil: cliente.estadoCivil || "",
      nacionalidade: cliente.nacionalidade || "",
      telefone: cliente.telefone || "",
      email: cliente.email || "",
      pais: paisNaLista ? paisSalvo : "Outro",
      paisOutro: paisNaLista ? "" : paisSalvo,
      endereco: cliente.endereco || "",
      numero: cliente.numero || "",
      complemento: cliente.complemento || "",
      bairro: cliente.bairro || "",
      cidade: cliente.cidade || "",
      estado: cliente.estado || "",
      cep: cliente.cep || "",
      observacoes: cliente.observacoes || "",
    })
    setClienteCodigo(cliente.publicCode ?? null)
    setClienteEditingId(cliente.id)
    setClienteTipo(tipo)
    setClienteIsViewMode(true)
    setClienteModalOpen(true)
  }

  // ✅ NOVO: Função para salvar alterações do cliente
  const handleSaveCliente = async () => {
    if (!clienteFormData.nome.trim()) {
      alert("Nome é obrigatório")
      return
    }

    try {
      const baseUrl = clienteTipo === "requerente" ? "/api/requerentes" : "/api/contratantes"
      const url = `${baseUrl}/${clienteEditingId}`
      
      const { tipo, paisOutro, ...restData } = clienteFormData
      
      const dataToSend = {
        ...restData,
        pais: clienteFormData.pais === "Outro" ? (paisOutro || "Outro") : clienteFormData.pais,
      }

      // 🛡️ BLINDAGEM: serializa e checa antes de mandar
      const bodySerialized = JSON.stringify(dataToSend)
      
      if (!bodySerialized || bodySerialized === '{}' || bodySerialized.length < 10) {
        console.error('[handleSaveCliente] body vazio detectado:', { dataToSend, bodySerialized })
        alert('Erro interno: nenhum dado foi montado para envio. Recarregue a página e tente novamente.')
        return
      }

      console.log('[handleSaveCliente]', {
        url,
        method: 'PUT',
        bodyLength: bodySerialized.length,
        campos: Object.keys(dataToSend),
      })

      const response = await fetch(url, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: bodySerialized,  // ← 🎯 A CORREÇÃO CRÍTICA
      })

      if (response.ok) {
        setClienteModalOpen(false)
        // Atualizar a lista local
        if (clienteTipo === "contratante") {
          const atualizado = contratantesSelecionados.map(c => 
            c.id === clienteEditingId ? { ...c, ...dataToSend } : c
          )
          setContratantesSelecionados(atualizado as Contratante[])
        } else {
          const atualizado = requerentesSelecionados.map(r => 
            r.id === clienteEditingId ? { ...r, ...dataToSend } : r
          )
          setRequerentesSelecionados(atualizado as Requerente[])
        }
        onSave?.()
      } else {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Erro ao salvar")
      }
    } catch (error: any) {
      console.error('[handleSaveCliente] erro:', error)
      alert(error.message || "Erro ao salvar cliente")
    }
  }


  useEffect(() => {
    // 🔒 Achado real: estas duas chamadas eram as únicas neste arquivo sem
    // `Authorization` — o servidor recusava com 401, e a tela engolia o erro
    // em silêncio mostrando "Nenhum requerente/contratante encontrado" em vez
    // de avisar que a busca falhou. Os dados sempre existiram no banco.
    const auth = { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
    if (isOpen && contratantesProp.length === 0) {
      fetch('/api/contratantes', { headers: auth })
        .then(res => res.json())
        .then(data => setContratantes(data.contratantes || []))
        .catch(console.error)
    }
    if (isOpen && requerentesProp.length === 0) {
      fetch('/api/requerentes', { headers: auth })
        .then(res => res.json())
        .then(data => setRequerentes(data.requerentes || []))
        .catch(console.error)
    }
  }, [isOpen, contratantesProp.length, requerentesProp.length])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contratanteRef.current && !contratanteRef.current.contains(e.target as Node)) {
        setShowContratanteDropdown(false)
      }
      if (requerenteRef.current && !requerenteRef.current.contains(e.target as Node)) {
        setShowRequerenteDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Memoizado porque o efeito do ESC depende dele: recriado a cada render, o
  // listener era removido e readicionado em toda passagem.
  const handleClose = useCallback(() => {
    setIsEditing(false)
    setActiveTab("geral")
    onClose()
  }, [onClose])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'auto'
    }
  }, [isOpen, handleClose])

  const handleSaveEdit = async () => {
    if (!processo) return
    
    try {
      const response = await fetch(`/api/processos/${processo.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          nome: nomeEditado,
          contratanteIds: contratantesSelecionados.map(c => c.id),
          requerenteIds: requerentesSelecionados.map(r => r.id)
        })
      })
      
      if (response.ok) {
        setIsEditing(false)
        setPhaseRefreshExtra((k) => k + 1)  // ✅ NOVO: refresh fase após salvar
        onSave?.()
      } else {
        alert('Erro ao salvar alterações')
      }
    } catch (error) {
      console.error('Erro ao salvar:', error)
      alert('Erro ao salvar alterações')
    }
  }

  const handleCancelEdit = () => {
    setNomeEditado(processo?.nome || "")
    setContratantesSelecionados(processo?.contratantes || [])
    setRequerentesSelecionados(processo?.requerentes || [])
    setIsEditing(false)
  }

  const handleDelete = async () => {
    if (!processo) return
    
    const confirmDelete = window.confirm(
      `Tem certeza que deseja excluir o processo "${processo.nome}"?\n\nEsta ação não pode ser desfeita.`
    )
    
    if (!confirmDelete) return
    
    try {
      const response = await fetch(`/api/processos/${processo.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("authToken")}`
        }
      })
      
      if (response.ok) {
        onSave?.()
        onClose()
      } else {
        alert('Erro ao excluir processo')
      }
    } catch (error) {
      console.error('Erro ao excluir:', error)
      alert('Erro ao excluir processo')
    }
  }

  const contratantesFiltrados = contratantes.filter(c =>
    !contratantesSelecionados.find(sel => sel.id === c.id) &&
    (c.publicCode?.toLowerCase().includes(buscaContratante.toLowerCase()) ||
    c.nome.toLowerCase().includes(buscaContratante.toLowerCase()) ||
    c.email?.toLowerCase().includes(buscaContratante.toLowerCase()) ||
    c.telefone?.includes(buscaContratante))
  )

  const requerentesFiltrados = requerentes.filter(r =>
    !requerentesSelecionados.find(sel => sel.id === r.id) &&
    (r.publicCode?.toLowerCase().includes(buscaRequerente.toLowerCase()) ||
    r.nome.toLowerCase().includes(buscaRequerente.toLowerCase()) ||
    r.email?.toLowerCase().includes(buscaRequerente.toLowerCase()) ||
    r.telefone?.includes(buscaRequerente))
  )

  const addContratante = (cont: Contratante) => {
    setContratantesSelecionados([...contratantesSelecionados, cont])
    setBuscaContratante("")
    setShowContratanteDropdown(false)
  }

  const removeContratante = (id: number) => {
    setContratantesSelecionados(contratantesSelecionados.filter(c => c.id !== id))
  }

  const addRequerente = (req: Requerente) => {
    setRequerentesSelecionados([...requerentesSelecionados, req])
    setBuscaRequerente("")
    setShowRequerenteDropdown(false)
  }

  const removeRequerente = (id: number) => {
    setRequerentesSelecionados(requerentesSelecionados.filter(r => r.id !== id))
  }

  if (!isOpen || !processo) return null

  // Rótulo e bandeira vêm do Cadastro Mestre, carregados junto com o processo.
  // Antes saíam de um mapa fixo de quatro países escrito no código.
  const paisRel = (processo as { paisCanonico?: { countryLabel?: string; flag?: string | null } | null }).paisCanonico
  const paisConfig = { label: paisRel?.countryLabel ?? "—", bandeira: paisRel?.flag ?? "🏳" }

  const dataCriacao = processo.createdAt
  const dataFormatada = dataCriacao ? new Date(dataCriacao).toLocaleDateString('pt-BR') : ""

  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "central", label: "Central Operacional" },
    ...(pode('arvore.ver') ? [{ id: "arvore", label: "Árvore Genealógica" }] : []),
    ...(pode('processos.ver_paginas') ? [{ id: "protocolos", label: "Protocolos" }] : []),
    ...(pode('financeiro.ver') ? [{ id: "faturas", label: "Financeiro" }] : []),
    { id: "documentos", label: "Documentos" },           // ← NOVO
    { id: "analise", label: "Análise Documental" },       // ← NOVO: aba própria (saiu de dentro de Central Operacional)
    ...(pode('eventos.ver') ? [{ id: "eventos", label: "Eventos" }] : []),
    { id: "historico", label: "Histórico" },
  ]

  // Abas com o Discovery Design System (dark glass/dourado). As demais permanecem
  // no tema claro. Skin only — layout idêntico.
  const finDark = activeTab === "faturas" || activeTab === "geral" || activeTab === "central" || activeTab === "documentos" || activeTab === "historico" || activeTab === "protocolos" || activeTab === "eventos" || activeTab === "arvore" || activeTab === "analise"

  const modalContent = (
    <>
      <div className="fixed inset-0 bg-[var(--overlay-modal)] z-[9998]" onClick={handleClose} />

      <div 
        className={`fixed z-[9999] shadow-[var(--elev-3)] flex flex-col overflow-hidden rounded-tl-xl rounded-tr-xl ${
          finDark ? 'bg-[var(--surface-popover)]' : 'bg-[var(--surface-primary)]'
        }`}
        style={{ left: '155px', top: '45px', right: '35px', bottom: '0px' }}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${
          finDark ? 'bg-[var(--surface-popover)] border-[var(--border-default)]' : 'bg-[var(--surface-primary)]'
        }`}>
          <div className="flex items-center gap-4">
            {/* Avatar do processo — no mockup este quadrado é a IDENTIDADE, não um
                botão. O fechar mora à direita, junto das demais ações. */}
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--action-primary)] text-[13px] font-semibold text-[var(--action-primary-ink)]"
              aria-hidden
            >
              {processo.nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("")}
            </span>
            
            <div>
              <h1 className={`text-xl font-semibold ${finDark ? 'text-white' : 'text-gray-900'}`}>{processo.nome}</h1>
              <span className={`text-sm ${finDark ? 'text-white/68' : 'text-gray-500'}`}>{paisConfig.label}</span>
            </div>

            {/* ✅ NOVO: barrinha de progresso da fase do processo */}
            <div className={`border-l pl-4 ml-2 hidden lg:block min-w-[260px] ${finDark ? 'border-[var(--border-default)]' : 'border-gray-200'}`}>
              <PhaseProgressHeader
                processoId={processo.id}
                refreshKey={phaseRefreshKey}
                variant={finDark ? "dark" : "light"}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pode('processos.excluir') && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-red-700 hover:text-red-500 hover:bg-[var(--surface-secondary)]"
                onClick={handleDelete}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            )}
            {/* Fechar — no fim da fila de ações, como no mockup. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              aria-label="Fechar processo"
              className="text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Abas principais - dinâmicas */}
        <div className={`flex border-b px-6 flex-shrink-0 ${finDark ? 'bg-[var(--surface-popover)] border-[var(--border-default)]' : 'bg-[var(--surface-primary)]'}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? (finDark ? 'border-[var(--accent-primary)] text-[var(--accent-text)]' : 'border-[var(--border-strong)] text-white')
                  : (finDark ? 'border-transparent text-[var(--text-secondary)] hover:text-white' : 'border-transparent text-gray-500 hover:text-gray-700')}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conteúdo principal */}
        <div className={`flex-1 overflow-hidden ${finDark ? 'text-white/80' : ''}`}>
          {activeTab === "geral" && (
            <div className="grid grid-cols-2 h-full overflow-hidden">
              {/* ========== COLUNA ESQUERDA - SOBRE O NEGÓCIO ========== */}
              <div className="border-r border-[var(--border-default)] overflow-y-auto p-6 min-h-0">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                    Sobre o Negócio
                  </h2>
                  {!isEditing ? (
                    pode('processos.editar') && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
                      >
                        editar
                      </button>
                    )
                  ) : (
                    <button
                      onClick={handleCancelEdit}
                      className="text-sm text-white/68 hover:text-white/80"
                    >
                      cancelar
                    </button>
                  )}
                </div>

                {/* ===== SLA — prazo do processo (engine única, só leitura) ===== */}
                <div className="mb-6">
                  <ProcessoSlaCard processoId={processo.id} />
                </div>

                {/* ===== MODO VISUALIZAÇÃO ===== */}
                {!isEditing ? (
                  <>
                    {/* Etapa */}
                    <div className="mb-6">
                      <label className="text-xs text-[var(--text-muted)] uppercase">Etapa</label>
                      <p className="text-white/95 font-medium">
                        {processo.faseAtualKey ?? "—"}
                      </p>
                    </div>

                    {/* País */}
                    <div className="mb-6">
                      <label className="text-xs text-[var(--text-muted)] uppercase">País</label>
                      <p className="text-white/95 font-medium">{paisConfig.label}</p>
                    </div>

                    {/* Contratantes - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6">
                      <label className="text-xs text-[var(--text-muted)] uppercase mb-2 block">Contratantes</label>
                      {contratantesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {[...contratantesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((cont) => (
                            <div
                              key={cont.id}
                              onClick={() => pode('clientes.ver') && abrirDetalhesCliente(cont, "contratante")}
                              className={`p-4 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl transition-colors ${pode('clientes.ver') ? 'hover:bg-[var(--surface-tertiary)] cursor-pointer' : 'cursor-default'}`}
                            >
                              <p className="text-white/95 font-semibold">{nomePessoa(cont)}</p>

                              {cont.telefone && (
                                <div className="flex items-center gap-2 text-sm text-white/68 mt-2">
                                  <Phone className="h-4 w-4" />
                                  <span>{cont.telefone}</span>
                                </div>
                              )}

                              {cont.email && (
                                <div className="flex items-center gap-2 text-sm text-white/68 mt-1">
                                  <Mail className="h-4 w-4" />
                                  <span>{cont.email}</span>
                                </div>
                              )}

                              {cont.endereco && (
                                <div
                                  className="flex items-start gap-2 text-sm text-white/68 mt-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MapTooltip
                                    endereco={cont.endereco}
                                    numero={cont.numero}
                                    bairro={cont.bairro}
                                    cidade={cont.cidade}
                                    estado={cont.estado}
                                    cep={cont.cep}
                                  >
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-[var(--text-secondary)]">
                                      <MapPin className="h-4 w-4 mt-0.5" />
                                      <div className="underline decoration-dotted underline-offset-2">
                                        <p>{cont.endereco}{cont.numero && `, ${cont.numero}`}</p>
                                        {cont.bairro && <p>{cont.bairro}</p>}
                                        <p>{cont.cidade && cont.cidade}{cont.estado && ` - ${cont.estado}`}</p>
                                        {cont.cep && <p>CEP: {cont.cep}</p>}
                                      </div>
                                    </div>
                                  </MapTooltip>
                                </div>
                              )}

                              <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                                <Button variant="outline" size="sm" className="border-[var(--border-default)] bg-transparent text-white/70 hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]">
                                  <Phone className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="border-[var(--border-default)] bg-transparent text-white/70 hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]">
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="border-[var(--border-default)] bg-transparent text-white/70 hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]">
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[var(--text-muted)] italic">Nenhum contratante vinculado</p>
                      )}
                    </div>

                    {/* Requerentes - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6">
                      <label className="text-xs text-[var(--text-muted)] uppercase mb-2 block">Requerentes</label>
                      {requerentesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {[...requerentesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((req) => (
                            <div
                              key={req.id}
                              onClick={() => pode('clientes.ver') && abrirDetalhesCliente(req, "requerente")}
                              className={`p-3 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl transition-colors ${pode('clientes.ver') ? 'hover:bg-[var(--surface-tertiary)] cursor-pointer' : 'cursor-default'}`}
                            >
                              <p className="text-white/95 font-medium">{nomePessoa(req)}</p>
                              {req.telefone && (
                                <div className="flex items-center gap-2 text-sm text-white/68 mt-1">
                                  <Phone className="h-3 w-3" />
                                  <span>{req.telefone}</span>
                                </div>
                              )}
                              {req.email && (
                                <div className="flex items-center gap-2 text-sm text-white/68 mt-1">
                                  <Mail className="h-3 w-3" />
                                  <span>{req.email}</span>
                                </div>
                              )}
                              {req.endereco && (
                                <div
                                  className="flex items-start gap-2 text-sm text-white/68 mt-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MapTooltip
                                    endereco={req.endereco}
                                    numero={req.numero}
                                    bairro={req.bairro}
                                    cidade={req.cidade}
                                    estado={req.estado}
                                    cep={req.cep}
                                  >
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-[var(--text-secondary)]">
                                      <MapPin className="h-3 w-3 mt-0.5" />
                                      <div className="underline decoration-dotted underline-offset-2">
                                        <p>{req.endereco}{req.numero && `, ${req.numero}`}</p>
                                        {req.bairro && <p>{req.bairro}</p>}
                                        <p>{req.cidade && req.cidade}{req.estado && ` - ${req.estado}`}</p>
                                        {req.cep && <p>CEP: {req.cep}</p>}
                                      </div>
                                    </div>
                                  </MapTooltip>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[var(--text-muted)] italic">Nenhum requerente vinculado</p>
                      )}
                    </div>
                  </>
                ) : (
                  /* ===== MODO EDIÇÃO ===== */
                  <>
                    {/* Nome */}
                    <div className="mb-6">
                      <label className="text-xs text-[var(--text-muted)] uppercase mb-1 block">Nome</label>
                      <Input
                        value={nomeEditado}
                        onChange={(e) => setNomeEditado(e.target.value)}
                        className="w-full bg-[var(--surface-popover)] border-[var(--border-default)] text-white/95 placeholder:text-[var(--text-muted)]"
                      />
                    </div>

                    {/* Contratantes (busca múltipla) - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6" ref={contratanteRef}>
                      <label className="text-xs text-[var(--text-muted)] uppercase mb-1 block">Contratantes</label>

                      {contratantesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {[...contratantesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((cont) => (
                            <div key={cont.id} className="flex items-center justify-between p-2 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-white/68" />
                                <span className="text-white/95 text-sm">{nomePessoa(cont)}</span>
                              </div>
                              <button
                                onClick={() => removeContratante(cont.id)}
                                className="text-[var(--text-muted)] hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <button
                          onClick={() => setShowContratanteDropdown(!showContratanteDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar contratante
                        </button>

                        {showContratanteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-xl shadow-[var(--elev-2)] z-10">
                            <div className="p-2 border-b border-[var(--border-default)]">
                              <Input
                                placeholder="Buscar contratante..."
                                value={buscaContratante}
                                onChange={(e) => setBuscaContratante(e.target.value)}
                                className="h-8 text-sm bg-[var(--surface-popover)] border-[var(--border-default)] text-white/95 placeholder:text-[var(--text-muted)]"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {contratantesFiltrados.length > 0 ? (
                                contratantesFiltrados.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => addContratante(c)}
                                    className="w-full px-4 py-2 text-left hover:bg-[var(--surface-tertiary)] flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-[var(--surface-secondary)] rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-[var(--text-secondary)]" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-white/95 text-sm">{nomePessoa(c)}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{c.email || c.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-[var(--text-muted)] text-center">
                                  Nenhum contratante encontrado
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Requerentes (busca múltipla) - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6" ref={requerenteRef}>
                      <label className="text-xs text-[var(--text-muted)] uppercase mb-1 block">Requerentes</label>

                      {requerentesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {[...requerentesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((req) => (
                            <div key={req.id} className="p-2 bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-[var(--text-secondary)]" />
                                  <span className="text-white/95 text-sm">{nomePessoa(req)}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  {/* Requerente sem nó na árvore: pode já existir lá (ex.: árvore
                                      importada) — vincula em vez de criar duplicata. */}
                                  {!req.personId && arvoreIdLocal && (
                                    <button
                                      onClick={() => abrirVinculoComArvore(req.id)}
                                      title="Vincular a uma pessoa já existente na árvore"
                                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-amber-800 hover:bg-amber-50"
                                    >
                                      <Link2 className="h-3.5 w-3.5" />
                                      Vincular à árvore
                                    </button>
                                  )}
                                  <button
                                    onClick={() => removeRequerente(req.id)}
                                    className="text-[var(--text-muted)] hover:text-red-700"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {vinculandoRequerenteId === req.id && (
                                <div className="mt-2 pt-2 border-t border-[var(--border-default)] space-y-1.5">
                                  {carregandoPessoasArvore ? (
                                    <p className="text-xs text-[var(--text-muted)]">Carregando pessoas da árvore…</p>
                                  ) : pessoasDaArvoreSemRequerente.length === 0 ? (
                                    <p className="text-xs text-[var(--text-muted)]">
                                      Nenhuma pessoa disponível na árvore (todas já são requerentes, ou a árvore está vazia).
                                    </p>
                                  ) : (
                                    <div className="flex gap-1.5">
                                      <select
                                        value={pessoaEscolhidaId}
                                        onChange={(e) => setPessoaEscolhidaId(e.target.value ? Number(e.target.value) : '')}
                                        className="flex-1 h-8 text-xs rounded-md bg-[var(--surface-popover)] border border-[var(--border-default)] text-white/95 px-2"
                                      >
                                        <option value="">Esta pessoa é...</option>
                                        {pessoasDaArvoreSemRequerente.map((p) => (
                                          <option key={p.id} value={p.id}>{p.nome}</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={confirmarVinculoComArvore}
                                        disabled={!pessoaEscolhidaId || salvandoVinculoArvore}
                                        className="shrink-0 px-2.5 rounded-md border border-amber-300 bg-amber-50 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {salvandoVinculoArvore ? 'Vinculando…' : 'Confirmar'}
                                      </button>
                                    </div>
                                  )}
                                  {erroVinculoArvore && <p className="text-xs text-red-600">{erroVinculoArvore}</p>}
                                  <button
                                    onClick={() => setVinculandoRequerenteId(null)}
                                    className="text-xs text-[var(--text-muted)] hover:text-white/80"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <button
                          onClick={() => setShowRequerenteDropdown(!showRequerenteDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar requerente
                        </button>

                        {showRequerenteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-xl shadow-[var(--elev-2)] z-10">
                            <div className="p-2 border-b border-[var(--border-default)]">
                              <Input
                                placeholder="Buscar requerente..."
                                value={buscaRequerente}
                                onChange={(e) => setBuscaRequerente(e.target.value)}
                                className="h-8 text-sm bg-[var(--surface-popover)] border-[var(--border-default)] text-white/95 placeholder:text-[var(--text-muted)]"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {requerentesFiltrados.length > 0 ? (
                                requerentesFiltrados.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => addRequerente(r)}
                                    className="w-full px-4 py-2 text-left hover:bg-[var(--surface-tertiary)] flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-[var(--surface-secondary)] rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-green-800" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-white/95 text-sm">{nomePessoa(r)}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{r.email || r.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-[var(--text-muted)] text-center">
                                  Nenhum requerente encontrado
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Botões salvar/cancelar */}
                    <div className="flex gap-3 pt-4 border-t border-[var(--border-default)]">
                      <Button onClick={handleSaveEdit} className="bg-[var(--accent-primary)] hover:bg-[#e0b957] text-[var(--accent-ink)]">
                        Salvar
                      </Button>
                      <Button variant="outline" onClick={handleCancelEdit} className="border-[var(--border-default)] bg-transparent text-white/80 hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)]">
                        Cancelar
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* ========== COLUNA DIREITA - ESTATÍSTICAS + ALERTAS ========== */}
              {/* ⚠ ALTERAÇÃO: substituído <ProcessoTarefas> por <ProcessoEstatisticas>.
                  As tarefas vão migrar para a futura aba "Central Operacional". */}
              <div className="overflow-hidden min-h-0">
                <ProcessoEstatisticas
                  processo={processo}
                  onNavigate={(tab) => {
                    if (tab === 'arvore') setActiveTab('arvore')
                    if (tab === 'central') setActiveTab('central')
                    if (tab === 'documentos') setActiveTab('documentos')   // ← NOVO
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === "central" && (
            // Central Operacional PURAMENTE operacional + área única de rolagem
            // (header/abas fixos; só o conteúdo rola). Diagnóstico técnico do Runtime
            // fica em Gerenciamento → Motor → Diagnóstico do Runtime.
            <div className="h-full min-h-0 overflow-y-auto">
              <ProcessoCentralOperacional
                processo={processo}
                taskIdAlvo={initialTaskId ?? null}
                onProcessoMudou={() => {
                  // Retorno de fase (ou outra mudança da fase ATIVA): invalida a
                  // projeção — Header (refreshKey) + Kanban/Drawer (onSave).
                  setPhaseRefreshExtra((k) => k + 1)
                  onSave?.()
                }}
              />
            </div>
          )}

          {activeTab === "analise" && (
            // Aba própria — o mesmo componente que antes só aparecia dentro de
            // Central Operacional quando a fase ativa era Análise Documental.
            // Aqui fica acessível direto, sem a trilha macro nem o resumo do
            // processo por cima: o mockup aprovado mostra o conteúdo sozinho.
            <div className="h-full min-h-0 overflow-y-auto p-6">
              <ProcessoAnalise
                processoId={processo.id}
                onConcluido={() => {
                  setPhaseRefreshExtra((k) => k + 1)
                  onSave?.()
                }}
              />
            </div>
          )}

          {activeTab === "documentos" && (
            // Mesmo padrão de rolagem das outras abas (central/faturas): sem
            // `h-full min-h-0 overflow-y-auto` aqui, o `h-full` da biblioteca lá
            // dentro não tinha altura de referência nenhuma — crescia sem nunca
            // rolar, e o conteúdo abaixo da dobra ficava inalcançável.
            <div className="h-full min-h-0 overflow-y-auto space-y-6">
              <ProcessoDocumentos processo={processo} />
              {/* AÇÃO CONTEXTUAL — o MESMO gerador do cadastro do cliente, com o
                  processo já preenchido. Não existe segundo gerador. */}
              <ProcuracaoDoProcesso
                processoId={processo.id}
                processoRotulo={processo.nome || `#${processo.id}`}
                contratantes={contratantesSelecionados.map((c) => ({ id: c.id, nome: c.nome }))}
                requerentes={requerentesSelecionados.map((r) => ({ id: r.id, nome: r.nome }))}
              />
            </div>
          )}

          {activeTab === "arvore" && (
            <ArvoreGenealogicaView 
              processoId={processo.id}
              arvoreId={arvoreIdLocal}
              onArvoreCreated={(novoArvoreId) => {
                setArvoreIdLocal(novoArvoreId)
                onSave?.()
              }}
              onArvoreExcluida={() => {
                setArvoreIdLocal(null)
                onSave?.()
              }}
              pessoaIdParaFocar={pessoaIdParaFocar}
              sidebarTabParaFocar={sidebarTabParaFocar}
              nomeFamilia={processo.nome}
              idiomaDoPais={(processo as { paisCanonico?: { language?: string | null } | null }).paisCanonico?.language ?? null}
            />
          )}

          {/* Protocolizações do processo — o único lugar onde um protocolo é registrado */}
          {activeTab === "protocolos" && (
            <ProcessoProtocolos
              processoId={processo.id}
              contratantes={contratantesSelecionados}
              requerentes={requerentesSelecionados}
              onUpdate={onSave}
            />
          )}

          {activeTab === "faturas" && pode('financeiro.ver') && (
            <div className="h-full min-h-0 overflow-y-auto p-6">
              <ProcessoFinanceiroShell processoId={processo.id} />
            </div>
          )}

          {activeTab === "eventos" && (
            <ProcessoEventos
            processoId={processo.id}
            onUpdate={onSave}
            />
          )}

          {activeTab === "historico" && (
            <ProcessoHistorico
            processoId={processo.id}
            onUpdate={onSave}
            />
          )}
        </div>
      </div>

      {/* ✅ NOVO: Modal de detalhes do cliente */}
      <ContratanteModal
        isOpen={clienteModalOpen}
        onClose={() => {
          setClienteModalOpen(false)
          setClienteFormData(initialFormData)
          setClienteEditingId(null)
          setClienteCodigo(null)
        }}
        isViewMode={clienteIsViewMode}
        setIsViewMode={setClienteIsViewMode}
        editingId={clienteEditingId}
        editingTipo={clienteTipo}
        codigoPublico={clienteCodigo}
        clienteExistente
        formData={clienteFormData}
        setFormData={setClienteFormData}
        onSave={handleSaveCliente}
        isLoading={false}
        podeEditar={pode('clientes.editar')}
      />
    </>
  )

  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body)
  }
  
  return null
}