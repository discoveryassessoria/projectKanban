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
import { MovimentarFaseModal } from "./MovimentarFaseModal"
import { ProcessoCentralOperacional } from "./ProcessoCentralOperacional"
// Diagnóstico técnico do Runtime v2 (WorkflowV2Panel/WorkflowV2AtivacaoPanel) foi
// movido para Gerenciamento → Motor → Diagnóstico do Runtime. A Central Operacional
// é puramente operacional.
import { ProcessoDocumentos } from "./ProcessoDocumentos"
import { ProcuracaoDoProcesso } from "./ProcuracaoDoProcesso"
import { ProcessoProtocolos } from "./ProcessoProtocolos"
import { ProcessoInformacoes } from "./ProcessoInformacoes"
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
  Settings, 
  MoveRight,
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
  FileText
} from "lucide-react"
import {
  Pais,
  PAISES_CONFIG,
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
  initialTarefaPaiId?: number  // ← ADICIONAR
  initialAtividadeId?: number  // ← ADICIONAR
}

/** País do processo — usado tanto no valor inicial da aba quanto no corpo do modal. */
function ehItalia(processo: ProcessoWithStatus | Processo | null): boolean {
  return processo?.pais === "ITALIA"
}

/** Abas válidas do modal. */
type AbaProcesso = "geral" | "central" | "documentos" | "faturas" | "financeiroV2" | "historico" | "arvore" | "protocolos" | "informacoes" | "eventos"

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
  if (initialTab === "informacoes" && isItalia) return "informacoes"
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
  initialTarefaPaiId,    // ← ADICIONAR ESTA LINHA
  initialAtividadeId,    // ← ADICIONAR ESTA LINHA
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
  // Movimentação manual de fase pelo menu do processo (mesma ação do arraste).
  const [movendoFase, setMovendoFase] = useState(false)
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
  // `bg-white` e sem cor de texto é a semente do bug — quem copiar daqui herda
  // o campo branco no branco.
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder:text-gray-400 text-sm h-[42px]"

  // ✅ Verificar se o processo é da Itália (aba Informações)
  const isItalia = ehItalia(processo)

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
    if (isOpen && contratantesProp.length === 0) {
      fetch('/api/contratantes')
        .then(res => res.json())
        .then(data => setContratantes(data.contratantes || []))
        .catch(console.error)
    }
    if (isOpen && requerentesProp.length === 0) {
      fetch('/api/requerentes')
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

  const paisConfig = PAISES_CONFIG[processo.pais as keyof typeof PAISES_CONFIG] || { label: processo.pais, bandeira: "🏳" }

  const dataCriacao = processo.createdAt
  const dataFormatada = dataCriacao ? new Date(dataCriacao).toLocaleDateString('pt-BR') : ""

  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "central", label: "Central Operacional" },
    ...(pode('arvore.ver') ? [{ id: "arvore", label: "Árvore Genealógica" }] : []),
    ...(isItalia && pode('processos.ver_paginas') ? [{ id: "informacoes", label: "Informações" }] : []),
    ...(pode('processos.ver_paginas') ? [{ id: "protocolos", label: "Protocolos" }] : []),
    ...(pode('financeiro.ver') ? [{ id: "faturas", label: "Financeiro" }] : []),
    { id: "documentos", label: "Documentos" },           // ← NOVO
    ...(pode('eventos.ver') ? [{ id: "eventos", label: "Eventos" }] : []),
    { id: "historico", label: "Histórico" },
  ]

  // Abas com o Discovery Design System (dark glass/dourado). As demais permanecem
  // no tema claro. Skin only — layout idêntico.
  const finDark = activeTab === "faturas" || activeTab === "geral" || activeTab === "central" || activeTab === "documentos" || activeTab === "historico" || activeTab === "protocolos" || activeTab === "eventos" || activeTab === "arvore"

  const modalContent = (
    <>
      {movendoFase && (
        <MovimentarFaseModal
          processoId={processo.id}
          origem="MENU_PROCESSO"
          onCancelar={() => setMovendoFase(false)}
          onMovido={() => {
            setMovendoFase(false)
            // A fase mudou: invalida a projeção do header e avisa quem abriu o modal.
            setPhaseRefreshExtra((k) => k + 1)
            onSave?.()
          }}
        />
      )}
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={handleClose} />

      <div 
        className={`fixed z-[9999] shadow-2xl flex flex-col overflow-hidden rounded-tl-xl rounded-tr-xl ${
          finDark ? 'bg-[#15191f]' : 'bg-white'
        }`}
        style={{ left: '155px', top: '45px', right: '35px', bottom: '0px' }}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${
          finDark ? 'bg-[#15191f] border-white/10' : 'bg-white'
        }`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleClose}
              className="w-10 h-10 bg-[#2563eb] hover:bg-[#1d4ed8] rounded-lg flex items-center justify-center transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
            
            <div>
              <h1 className={`text-xl font-semibold ${finDark ? 'text-white' : 'text-gray-900'}`}>{processo.nome}</h1>
              <span className={`text-sm ${finDark ? 'text-white/68' : 'text-gray-500'}`}>{paisConfig.label}</span>
            </div>

            {/* ✅ NOVO: barrinha de progresso da fase do processo */}
            <div className={`border-l pl-4 ml-2 hidden lg:block min-w-[260px] ${finDark ? 'border-white/10' : 'border-gray-200'}`}>
              <PhaseProgressHeader
                processoId={processo.id}
                refreshKey={phaseRefreshKey}
                variant={finDark ? "dark" : "light"}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className={finDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700'}>
              <Phone className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className={finDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700'}>
              <Mail className="h-5 w-5" />
            </Button>
            {/* MOVIMENTAR FASE — mesma ação do arraste, pelo menu. Existe para quem
                não tem drag (acessibilidade, tela sensível ao toque) e como caminho
                que não depende da biblioteca de drag-and-drop. Mesmo modal, mesmo
                endpoint, mesma permissão exclusiva. */}
            {pode('processos.moverFaseManual') && (
              <Button
                variant="ghost"
                size="icon"
                title="Movimentar fase"
                aria-label="Movimentar fase"
                onClick={() => setMovendoFase(true)}
                className={finDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700'}
              >
                <MoveRight className="h-5 w-5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className={finDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700'}>
              <Settings className="h-5 w-5" />
            </Button>
            {pode('processos.excluir') && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                onClick={handleDelete}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>

        {/* Abas principais - dinâmicas */}
        <div className={`flex border-b px-6 flex-shrink-0 ${finDark ? 'bg-[#15191f] border-white/10' : 'bg-white'}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? (finDark ? 'border-[#d2a948] text-[#d2a948]' : 'border-[#2563eb] text-white')
                  : (finDark ? 'border-transparent text-white/60 hover:text-white' : 'border-transparent text-gray-500 hover:text-gray-700')}
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
              <div className="border-r border-white/10 overflow-y-auto p-6 min-h-0">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wide">
                    Sobre o Negócio
                  </h2>
                  {!isEditing ? (
                    pode('processos.editar') && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="text-sm text-[#7dd3fc] hover:text-[#a5e0fc]"
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
                      <label className="text-xs text-white/40 uppercase">Etapa</label>
                      <p className="text-white/95 font-medium">
                        {processo.faseAtualKey ?? "—"}
                      </p>
                    </div>

                    {/* País */}
                    <div className="mb-6">
                      <label className="text-xs text-white/40 uppercase">País</label>
                      <p className="text-white/95 font-medium">{paisConfig.label}</p>
                    </div>

                    {/* Contratantes - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6">
                      <label className="text-xs text-white/40 uppercase mb-2 block">Contratantes</label>
                      {contratantesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {[...contratantesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((cont) => (
                            <div
                              key={cont.id}
                              onClick={() => pode('clientes.ver') && abrirDetalhesCliente(cont, "contratante")}
                              className={`p-4 bg-[#1b2027] border border-white/10 rounded-xl transition-colors ${pode('clientes.ver') ? 'hover:bg-[#252c35] cursor-pointer' : 'cursor-default'}`}
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
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-[#7dd3fc]">
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
                                <Button variant="outline" size="sm" className="border-white/15 bg-transparent text-white/70 hover:bg-[#252c35] hover:text-white">
                                  <Phone className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="border-white/15 bg-transparent text-white/70 hover:bg-[#252c35] hover:text-white">
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="border-white/15 bg-transparent text-white/70 hover:bg-[#252c35] hover:text-white">
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-white/40 italic">Nenhum contratante vinculado</p>
                      )}
                    </div>

                    {/* Requerentes - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6">
                      <label className="text-xs text-white/40 uppercase mb-2 block">Requerentes</label>
                      {requerentesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {[...requerentesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((req) => (
                            <div
                              key={req.id}
                              onClick={() => pode('clientes.ver') && abrirDetalhesCliente(req, "requerente")}
                              className={`p-3 bg-[#1b2027] border border-white/10 rounded-xl transition-colors ${pode('clientes.ver') ? 'hover:bg-[#252c35] cursor-pointer' : 'cursor-default'}`}
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
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-[#7dd3fc]">
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
                        <p className="text-white/40 italic">Nenhum requerente vinculado</p>
                      )}
                    </div>
                  </>
                ) : (
                  /* ===== MODO EDIÇÃO ===== */
                  <>
                    {/* Nome */}
                    <div className="mb-6">
                      <label className="text-xs text-white/40 uppercase mb-1 block">Nome</label>
                      <Input
                        value={nomeEditado}
                        onChange={(e) => setNomeEditado(e.target.value)}
                        className="w-full bg-[#1b2027] border-white/15 text-white/95 placeholder:text-white/40"
                      />
                    </div>

                    {/* Contratantes (busca múltipla) - ✅ ORDENADOS ALFABETICAMENTE */}
                    <div className="mb-6" ref={contratanteRef}>
                      <label className="text-xs text-white/40 uppercase mb-1 block">Contratantes</label>

                      {contratantesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {[...contratantesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((cont) => (
                            <div key={cont.id} className="flex items-center justify-between p-2 bg-[#1b2027] border border-white/10 rounded-xl">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-white/68" />
                                <span className="text-white/95 text-sm">{nomePessoa(cont)}</span>
                              </div>
                              <button
                                onClick={() => removeContratante(cont.id)}
                                className="text-white/40 hover:text-[#f87171]"
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
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#7dd3fc] hover:bg-[#252c35] rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar contratante
                        </button>

                        {showContratanteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-[#14161a] border border-white/10 rounded-xl shadow-lg z-10">
                            <div className="p-2 border-b border-white/10">
                              <Input
                                placeholder="Buscar contratante..."
                                value={buscaContratante}
                                onChange={(e) => setBuscaContratante(e.target.value)}
                                className="h-8 text-sm bg-[#1b2027] border-white/15 text-white/95 placeholder:text-white/40"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {contratantesFiltrados.length > 0 ? (
                                contratantesFiltrados.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => addContratante(c)}
                                    className="w-full px-4 py-2 text-left hover:bg-[#252c35] flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-[#7dd3fc]/15 rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-[#7dd3fc]" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-white/95 text-sm">{nomePessoa(c)}</p>
                                      <p className="text-xs text-white/40">{c.email || c.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-white/40 text-center">
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
                      <label className="text-xs text-white/40 uppercase mb-1 block">Requerentes</label>

                      {requerentesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {[...requerentesSelecionados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((req) => (
                            <div key={req.id} className="flex items-center justify-between p-2 bg-[#1b2027] border border-white/10 rounded-xl">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-[#7dd3fc]" />
                                <span className="text-white/95 text-sm">{nomePessoa(req)}</span>
                              </div>
                              <button
                                onClick={() => removeRequerente(req.id)}
                                className="text-white/40 hover:text-[#f87171]"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <button
                          onClick={() => setShowRequerenteDropdown(!showRequerenteDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#7dd3fc] hover:bg-[#252c35] rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar requerente
                        </button>

                        {showRequerenteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-[#14161a] border border-white/10 rounded-xl shadow-lg z-10">
                            <div className="p-2 border-b border-white/10">
                              <Input
                                placeholder="Buscar requerente..."
                                value={buscaRequerente}
                                onChange={(e) => setBuscaRequerente(e.target.value)}
                                className="h-8 text-sm bg-[#1b2027] border-white/15 text-white/95 placeholder:text-white/40"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {requerentesFiltrados.length > 0 ? (
                                requerentesFiltrados.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => addRequerente(r)}
                                    className="w-full px-4 py-2 text-left hover:bg-[#252c35] flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-[#4ade80]/15 rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-[#4ade80]" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-white/95 text-sm">{nomePessoa(r)}</p>
                                      <p className="text-xs text-white/40">{r.email || r.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-white/40 text-center">
                                  Nenhum requerente encontrado
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Botões salvar/cancelar */}
                    <div className="flex gap-3 pt-4 border-t border-white/10">
                      <Button onClick={handleSaveEdit} className="bg-[#d2a948] hover:bg-[#e0b957] text-[#1b1508]">
                        Salvar
                      </Button>
                      <Button variant="outline" onClick={handleCancelEdit} className="border-white/15 bg-transparent text-white/80 hover:bg-[#252c35] hover:text-white">
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
                onProcessoMudou={() => {
                  // Retorno de fase (ou outra mudança da fase ATIVA): invalida a
                  // projeção — Header (refreshKey) + Kanban/Drawer (onSave).
                  setPhaseRefreshExtra((k) => k + 1)
                  onSave?.()
                }}
              />
            </div>
          )}

          {activeTab === "documentos" && (
            <div className="space-y-6">
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
              pessoaIdParaFocar={pessoaIdParaFocar}
              sidebarTabParaFocar={sidebarTabParaFocar}
              nomeFamilia={processo.nome}
            />
          )}

          {/* ✅ Aba Informações (apenas para Itália) */}
          {activeTab === "informacoes" && isItalia && (
            <ProcessoInformacoes
              processoId={processo.id}
              onUpdate={onSave}
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