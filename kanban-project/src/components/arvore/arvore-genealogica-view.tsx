// src/components/arvore/arvore-genealogica-view.tsx

"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useApi, invalidar } from '@/src/lib/dados'
import { jsPDF } from "jspdf"
import dagre from "dagre"
import type { PessoaArvore, UniaoArvore, DocumentoArvore } from "./types"
import { RemocaoPessoaModal, type PlanoRemocaoUI } from '@/src/components/arvore/remocao-pessoa-modal'
import { PessoaSidebar } from "./pessoa-sidebar"
import { PessoaDetailsPage } from "./pessoa-details-page"
import { ReactFlowTree, ReactFlowTreeRef } from "./react-flow-tree"
import { useAnaliseArvore, paisAlvoDe } from "./inteligencia/use-analise-arvore"
import { useArvoreOperacional } from "./inteligencia/use-arvore-operacional"
import { BarraLinhagem, EVENTO_FECHAR_CAMADA, MARCA_MENU_ABERTO } from "./inteligencia/barra-linhagem"
import { PainelDiagnostico, SeloSaude } from "./inteligencia/painel-diagnostico"
import {
  PreviewImpactoModal,
  type AlteracaoDescrita,
  type PropostaImpacto,
} from "./inteligencia/preview-impacto"
import type { EstadoAtual } from "@/src/lib/genealogia/operacional/comparacao"
import { PainelInteligencia } from "./inteligencia/painel-inteligencia"
import { PaletaComandos } from "./inteligencia/paleta-comandos"
import { ImportarArvoreModal } from "./importar-arvore-modal"
import { TreeOnboarding } from "./tree-onboarding"
import { RequerenteSelector } from "./requerente-selector"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Plus,
  User,
  Loader2,
  Minimize2,
  Maximize2,
  FileDown,
  Search,
  Sparkles,
  ImagePlus,
} from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// Helper para fetch autenticado
function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

interface ArvoreGenealogicaViewProps {
  processoId: number
  arvoreId?: number | null
  onArvoreCreated?: (arvoreId: number) => void
  pessoaIdParaFocar?: number
  sidebarTabParaFocar?: string
  nomeFamilia?: string  // ✅ NOVA PROP
  paisProcesso?: "PORTUGAL" | "ESPANHA" | "ALEMANHA" | "ITALIA"
}

type ViewMode = 'paisagem' | 'retrato'

const fsColors = {
  male: '#3073B5',
  female: '#BF3D79',
  green: '#87B940',
  line: '#8fa6b5'
}

/** Resposta da árvore como a API a devolve. */
type PosicoesNodes = Record<string, Record<string, { x: number; y: number }>>
interface RespostaArvore {
  pessoas?: PessoaArvore[]
  pessoaPrincipalId?: number | null
  posicoesNodes?: PosicoesNodes | null
}
const SEM_PESSOAS: PessoaArvore[] = []

export function ArvoreGenealogicaView({ 
  processoId, 
  arvoreId: initialArvoreId, 
  onArvoreCreated,
  pessoaIdParaFocar,
  sidebarTabParaFocar,
  nomeFamilia,  // ✅ NOVA PROP
  paisProcesso
}: ArvoreGenealogicaViewProps) {
  const { pode } = usePermissoes()
  const [viewMode, setViewMode] = useState<ViewMode>('paisagem')
  const [creating, setCreating] = useState(false)
  const [arvoreId, setArvoreId] = useState<number | null>(initialArvoreId || null)
  // A árvore inteira vem de uma leitura só; pessoas, uniões e pessoa principal são
  // DERIVAÇÕES dela. Antes eram quatro estados preenchidos pelo mesmo carregador, e o
  // laço que junta as uniões rodava dentro do fetch.
  const arvoreReq = useApi<RespostaArvore>(arvoreId ? `/api/arvore/${arvoreId}` : null)
  const pessoas = arvoreReq.dados?.pessoas ?? SEM_PESSOAS
  const unioes = useMemo<UniaoArvore[]>(() => {
    const todas: UniaoArvore[] = []
    for (const p of pessoas) {
      for (const u of [...(p.unioesComoPessoa1 ?? []), ...(p.unioesComoPessoa2 ?? [])]) {
        if (!todas.some((x) => x.id === u.id)) todas.push(u)
      }
    }
    return todas
  }, [pessoas])
  const pessoaPrincipal = useMemo<PessoaArvore | null>(() => {
    const idPrincipal = arvoreReq.dados?.pessoaPrincipalId
    if (idPrincipal) return pessoas.find((p) => p.id === idPrincipal) ?? null
    return pessoas[0] ?? null
  }, [arvoreReq.dados, pessoas])
  const loading = Boolean(arvoreId) && arvoreReq.carregando

  // ── INTELIGÊNCIA DA ÁRVORE ────────────────────────────────────────────────
  // O motor genealógico já existia e estava órfão. Ligado aqui, ele NÃO participa
  // do desenho: quem renderiza a árvore continua sendo o <ReactFlowTree> abaixo,
  // intocado. O que estas telas fazem é ler a análise e navegar.
  const { analise, indice } = useAnaliseArvore(pessoas, unioes, {
    paisAlvo: paisAlvoDe(paisProcesso),
    raizId: pessoaPrincipal?.id ?? null,
  })
  const [painelAberto, setPainelAberto] = useState(false)
  const [importarAberto, setImportarAberto] = useState(false)
  const [paletaAberta, setPaletaAberta] = useState(false)
  const [diagnosticoAberto, setDiagnosticoAberto] = useState(false)

  // ── OPERAÇÃO DA ÁRVORE ────────────────────────────────────────────────────
  // Linhagens, foco, dossiê por pessoa e sinais do cartão saem daqui, numa
  // leitura só. Como o `<ReactFlowTree>` recebe o foco DEPOIS do layout, nada
  // disto recalcula posição: trocar de requerente é um Map novo, não um desenho
  // novo. Ver `aplicarFoco` em react-flow-tree.tsx.
  const operacional = useArvoreOperacional({ processoId, pessoas, unioes, analise })

  // SEM BECO SEM SAÍDA: quantos requerentes do processo ainda NÃO estão na
  // árvore. É lido AQUI, com a árvore, e não dentro do modal — porque a decisão
  // de oferecer (ou não) a aba "Requerente do processo" precisa acontecer ANTES
  // de o modal abrir. Abrir um formulário para o usuário descobrir lá dentro que
  // não há nada a fazer é gastar dois cliques dele para dar uma má notícia.
  const requerentesReq = useApi<{ requerentes?: Array<{ jaNaArvore: boolean }> }>(
    `/api/processos/${processoId}/requerentes-disponiveis`,
  )
  const requerentesForaDaArvore = useMemo(
    () => (requerentesReq.dados?.requerentes ?? []).filter((r) => !r.jaNaArvore).length,
    [requerentesReq.dados],
  )

  const nomeDePessoa = useCallback(
    (id: number) => {
      const p = pessoas.find((x) => x.id === id)
      return p ? `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ""}` : `#${id}`
    },
    [pessoas],
  )

  // Quem depende de uma pessoa — o motor de linhagem já sabe; a tela só nomeia.
  // Usado pelo preview de impacto para dizer QUAIS requerentes a alteração toca.
  const requerentesAfetadosPor = useCallback(
    (pessoaId: number) =>
      (operacional.mapa.compartilhadas.get(pessoaId) ?? []).map(nomeDePessoa),
    [operacional.mapa, nomeDePessoa],
  )

  // Ir até a pessoa no canvas: o próprio componente da árvore já expõe isso, então
  // navegar não redesenha nada. Sem zoom explícito o zoom atual é PRESERVADO —
  // quem estava lendo de longe não é jogado para o detalhe, e vice-versa.
  const irParaPessoa = useCallback((pessoaId: number, opcoes?: { zoom?: number }) => {
    reactFlowTreeRef.current?.centerOnPerson(pessoaId, opcoes)
  }, [])

  // Estável entre renders: é dependência de callbacks (ex.: confirmar remoção).
  //
  // MOTOR OPERACIONAL: recarregar a árvore invalida junto os fatos operacionais
  // do processo. Sem isto, mudar estado civil, óbito ou filiação atualizava o
  // desenho e deixava exigência, tarefa e valor exibindo o número velho — duas
  // verdades na mesma tela até alguém apertar F5.
  const fetchArvore = useCallback(async () => {
    await Promise.all([
      arvoreReq.recarregar(),
      invalidar(`/api/processos/${processoId}/genealogia/operacional`),
    ])
  }, [arvoreReq, processoId])
  // Onboarding aparece quando a árvore existe e está VAZIA — derivação, não um estado
  // que o carregador precisava ligar e desligar. Continua podendo ser aberto e fechado
  // à mão (botão "como começar" / concluir).
  const [onboardingManual, setShowOnboarding] = useState<boolean | null>(null)
  const showOnboarding = onboardingManual ?? (Boolean(arvoreReq.dados) && pessoas.length === 0)
  // CAUSA RAIZ: guardar uma CÓPIA da pessoa em estado obrigava um efeito a
  // re-sincronizá-la sempre que `pessoas` era recarregada — cópia velha na tela
  // até o efeito rodar. Guardamos o ID (primitivo, estável) e DERIVAMOS a pessoa
  // da lista viva: sem efeito, sem cópia defasada, sem setState em cascata.
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null)
  const selectedPerson = useMemo<PessoaArvore | null>(
    () => (selectedPersonId == null ? null : pessoas.find((p) => p.id === selectedPersonId) ?? null),
    [selectedPersonId, pessoas],
  )
  const setSelectedPerson = useCallback(
    (p: PessoaArvore | null) => setSelectedPersonId(p?.id ?? null),
    [],
  )

  // BUSCA: localizar não é só centralizar. O pedido é localiza → centraliza →
  // zoom → destaca → abre o painel, sem navegação manual. É o que esta função
  // faz, e é o que a paleta (⌘K) chama ao escolher alguém.
  const localizarPessoa = useCallback(
    (pessoaId: number) => {
      // Zoom de leitura: perto o bastante para ler o cartão, longe o bastante
      // para os pais e filhos dele continuarem na tela.
      irParaPessoa(pessoaId, { zoom: 1.1 })
      setSelectedPersonId(pessoaId)
    },
    [irParaPessoa],
  )
  const [fullDetailsPerson, setFullDetailsPerson] = useState<PessoaArvore | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  
  const reactFlowTreeRef = useRef<ReactFlowTreeRef>(null)

  const [showAddPersonModal, setShowAddPersonModal] = useState(false)
  const [addPersonType, setAddPersonType] = useState<'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null>(null)
  const [addPersonParentId, setAddPersonParentId] = useState<number | null>(null)
  const [addConjugeForPessoaId, setAddConjugeForPessoaId] = useState<number | null>(null)

  const [showEditPersonModal, setShowEditPersonModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<PessoaArvore | null>(null)

  const [pessoaFocada, setPessoaFocada] = useState(false)
  const [sidebarTabInicial, setSidebarTabInicial] = useState<string | undefined>(undefined)

  // Posições dos nós: o arrasto responde na hora e o salvamento é debounced, então o
  // valor local é um RASCUNHO sobre o que o servidor devolveu.
  const [posicoesLocais, setPosicoesNodes] = useState<PosicoesNodes | null>(null)
  const posicoesNodes = posicoesLocais ?? arvoreReq.dados?.posicoesNodes ?? null

  useEffect(() => {
    if (pessoaIdParaFocar && pessoas.length > 0 && !pessoaFocada) {
      const pessoaParaSelecionar = pessoas.find(p => p.id === pessoaIdParaFocar)
      if (pessoaParaSelecionar) {
        setTimeout(() => {
          setSelectedPerson(pessoaParaSelecionar)
          if (sidebarTabParaFocar) {
            setSidebarTabInicial(sidebarTabParaFocar)
          }
          setPessoaFocada(true)
        }, 300)
      }
    }
  }, [pessoaIdParaFocar, sidebarTabParaFocar, pessoas, pessoaFocada, setSelectedPerson])

  // ✅ FUNÇÃO handleExportPDF ATUALIZADA
  const handleExportPDF = useCallback(async () => {
    if (pessoas.length === 0 || !pessoaPrincipal || !treeContainerRef.current) return

    setIsExporting(true)

    // Salvar zoom atual e resetar para 100%
      const currentZoom = document.body.style.zoom
      document.body.style.zoom = '100%'

    try {
      const { toPng } = await import('html-to-image')

      const reactFlowContainer = treeContainerRef.current.querySelector('.react-flow') as HTMLElement
      
      if (!reactFlowContainer) {
        alert('Erro: não foi possível encontrar a árvore')
        setIsExporting(false)
        return
      }

      // Esconder elementos do ReactFlow (controles, minimap, etc)
      const elementsToHide = reactFlowContainer.querySelectorAll(
        '.react-flow__panel, .react-flow__minimap, .react-flow__controls, .react-flow__background'
      )
      elementsToHide.forEach((el) => {
        (el as HTMLElement).style.setProperty('display', 'none', 'important')
      })

      // ✅ NOVO: Esconder indicadores de documento (círculos verdes/vermelhos)
      const documentIndicators = reactFlowContainer.querySelectorAll('.group\\/doctip')
      documentIndicators.forEach((el) => {
        (el as HTMLElement).style.setProperty('display', 'none', 'important')
      })

      // ✅ Remover TODAS as sombras (removendo classes E estilos)
      const shadowElements = reactFlowContainer.querySelectorAll('.shadow-[var(--elev-2)], .shadow-[var(--elev-2)], .shadow-[var(--elev-1)], .shadow, .shadow-[var(--elev-3)]');
      shadowElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.classList.add('!shadow-none');
        htmlEl.style.setProperty('box-shadow', 'none', 'important');
        htmlEl.style.setProperty('filter', 'none', 'important');
        htmlEl.style.setProperty('drop-shadow', 'none', 'important');
        htmlEl.style.setProperty('-webkit-box-shadow', 'none', 'important');
        // REMOVIDO: htmlEl.style.setProperty('background-color', '#ffffff', 'important');
      });

      await new Promise(resolve => setTimeout(resolve, 100))

      // Forçar todos os nomes a aparecerem completos
      const nameElements = reactFlowContainer.querySelectorAll('h3')
      nameElements.forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.setProperty('overflow', 'visible', 'important')
        htmlEl.style.setProperty('display', 'block', 'important')
        htmlEl.style.setProperty('-webkit-line-clamp', 'unset', 'important')
        htmlEl.style.setProperty('-webkit-box-orient', 'unset', 'important')
        htmlEl.style.setProperty('white-space', 'normal', 'important')
        htmlEl.style.setProperty('text-overflow', 'unset', 'important')
      })

      const imgData = await toPng(reactFlowContainer, {
        backgroundColor: '#eaf5fc',
        pixelRatio: 2,
        skipFonts: true,
      })

      // Restaurar estilos dos nomes
      nameElements.forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.removeProperty('overflow')
        htmlEl.style.removeProperty('display')
        htmlEl.style.removeProperty('-webkit-line-clamp')
        htmlEl.style.removeProperty('-webkit-box-orient')
        htmlEl.style.removeProperty('white-space')
        htmlEl.style.removeProperty('text-overflow')
      })

      // Restaurar elementos escondidos
      elementsToHide.forEach((el) => {
        (el as HTMLElement).style.removeProperty('display')
      })

      // ✅ Restaurar indicadores de documento
      documentIndicators.forEach((el) => {
        (el as HTMLElement).style.removeProperty('display')
      })

      // ✅ Restaurar sombras
      shadowElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.classList.remove('!shadow-none');
        htmlEl.style.removeProperty('box-shadow');
        htmlEl.style.removeProperty('filter');
        htmlEl.style.removeProperty('drop-shadow');
        htmlEl.style.removeProperty('-webkit-box-shadow');
        // REMOVIDO: htmlEl.style.removeProperty('background-color');
      });

      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = imgData
      })

      const imgWidth = img.width
      const imgHeight = img.height

      const pxToMm = 0.264583 / 2
      const imgWidthMM = imgWidth * pxToMm
      const imgHeightMM = imgHeight * pxToMm

      const marginX = 8
      const marginTop = 14
      const marginBottom = 8

      const pageWidth = Math.max(imgWidthMM + marginX * 2, 297)
      const pageHeight = Math.max(imgHeightMM + marginTop + marginBottom, 210)

      const pdf = new jsPDF({
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight]
      })

      const actualPageWidth = pdf.internal.pageSize.getWidth()

      // ✅ ATUALIZADO: Título em italiano com nome da família
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(30, 30, 30)
      const titulo = `Albero Genealogico - Famiglia ${nomeFamilia || pessoaPrincipal.sobrenome || pessoaPrincipal.nome}`
      pdf.text(titulo, actualPageWidth / 2, 10, { align: 'center' })

      // ✅ REMOVIDO: Data de geração
      // ✅ REMOVIDO: Quantidade de pessoas

      const imgX = (actualPageWidth - imgWidthMM) / 2
      const imgY = marginTop

      pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidthMM, imgHeightMM)

      // ✅ ATUALIZADO: Nome do arquivo
      const dataAtual = new Date().toLocaleDateString('pt-BR')
      const nomeArquivo = `arvore-${(nomeFamilia || pessoaPrincipal.nome).toLowerCase().replace(/\s+/g, '-')}-${dataAtual.replace(/\//g, '-')}.pdf`
      pdf.save(nomeArquivo)

    } catch (error) {
      console.error('Erro ao exportar PDF:', error)
      alert('Erro ao exportar PDF. Verifique o console para mais detalhes.')
    } finally {
      // Restaurar zoom original
      document.body.style.zoom = currentZoom
      
      setIsExporting(false)
    }
  }, [pessoas, pessoaPrincipal, nomeFamilia])

  const [pessoaParaRemover, setPessoaParaRemover] = useState<number | null>(null)

  // FRONTEIRA (ADR — Árvore como camada de projeção): a exclusão de Documento
  // saiu daqui.
  //
  // Ela era a ÚNICA escrita da árvore num domínio alheio: `DELETE
  // /api/documentos/:id` apagava um DocumentoOperacional, cujo dono é o Sistema
  // Documental. Sobreviveu à remoção de 28/07 porque ficou pendurada numa
  // permissão (`arvore.excluir_documento`) que ninguém mais concede — invisível
  // na tela, viva no código, e pronta para voltar assim que a permissão fosse
  // recriada por engano.
  //
  // A árvore LÊ status documental e leva o operador até o documento. Excluir é
  // ato do módulo dono, com o ciclo de vida e a auditoria dele.

  const handleEditPerson = (pessoa: PessoaArvore) => {
    setEditingPerson(pessoa)
    setShowEditPersonModal(true)
    setSelectedPerson(null)
  }

  // O clique só ABRE o plano. Quem decide o que sai e o que fica é o domínio —
  // e ele recalcula tudo de novo dentro da transação quando a ação é confirmada.
  const handleDeletePerson = (pessoa: PessoaArvore) => {
    setPessoaParaRemover(pessoa.id)
  }

  const carregarPlanoRemocao = useCallback(async (id: number): Promise<PlanoRemocaoUI | null> => {
    const r = await authFetch(`/api/pessoas/${id}/plano-remocao`)
    if (!r.ok) return null
    return (await r.json()) as PlanoRemocaoUI
  }, [])

  const confirmarRemocao = useCallback(async (modo: 'HARD' | 'DESATIVAR') => {
    if (pessoaParaRemover == null) return
    const r = await authFetch(`/api/pessoas/${pessoaParaRemover}?modo=${modo}`, { method: 'DELETE' })
    if (!r.ok) {
      const erro = await r.json().catch(() => ({}))
      throw new Error(erro.error || 'Não foi possível remover a pessoa.')
    }
    setPessoaParaRemover(null)
    setSelectedPerson(null)
    await fetchArvore()
  }, [pessoaParaRemover, fetchArvore, setSelectedPerson])

  const handleAddConjuge = (pessoa: PessoaArvore) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoa.id)
    setShowAddPersonModal(true)
  }

  const handleCreateArvore = async () => {
    // SEM PROCESSO NÃO HÁ ÁRVORE. Esta tela montava o nome com o id na string —
    // e quando o id não tinha chegado, mandava "Árvore do Processo undefined"
    // para o servidor, que aceitava. O nome agora é problema do servidor, que
    // o tira do processo; aqui só se manda a identidade.
    if (!processoId) {
      alert('Abra a árvore a partir de um processo — ela não existe fora dele.')
      return
    }
    setCreating(true)
    try {
      const response = await authFetch('/api/arvore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processoId })
      })

      if (response.ok) {
        const data = await response.json()
        setArvoreId(data.id)
        setShowOnboarding(true)
        onArvoreCreated?.(data.id)
      } else {
        const error = await response.json()
        console.error('Erro da API:', error)
        alert(error.error || 'Erro ao criar árvore')
      }
    } catch (error) {
      console.error('Erro ao criar árvore:', error)
      alert('Erro ao criar árvore')
    } finally {
      setCreating(false)
    }
  }

  // ✅ NOVO: Salvar posições com debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const handleSavePositions = useCallback((positions: Record<string, any>) => {
    setPosicoesNodes(positions)
    
    // Debounce de 1 segundo
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      if (!arvoreId) return
      try {
        await authFetch(`/api/arvore/${arvoreId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ posicoesNodes: positions })
        })
      } catch (error) {
        console.error('Erro ao salvar posições:', error)
      }
    }, 1000)
  }, [arvoreId])

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return

    try {
      setIsTransitioning(true)
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.error('Erro ao alternar tela cheia:', error)
      setIsTransitioning(false)
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsTransitioning(true)
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(() => setIsTransitioning(false), 250)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handlePersonClick = (pessoa: PessoaArvore) => {
    setSelectedPerson(pessoa)
  }

  const handleCloseSidebar = () => {
    setSelectedPerson(null)
    setSidebarTabInicial(undefined)
  }

  const handleOpenFullDetails = (pessoa: PessoaArvore) => {
    setSelectedPerson(null)
    setFullDetailsPerson(pessoa)
  }

  const handleCloseFullDetails = () => {
    setFullDetailsPerson(null)
  }

  const handlePersonClickFromDetails = (pessoa: PessoaArvore) => {
    setFullDetailsPerson(pessoa)
  }

  const handleSelectPersonFromSidebar = useCallback((pessoa: PessoaArvore) => {
    const pessoaCompleta = pessoas.find(p => p.id === pessoa.id)
    
    if (pessoaCompleta) {
      setSelectedPerson(pessoaCompleta)
      setSidebarTabInicial("familia")
      
      setTimeout(() => {
        reactFlowTreeRef.current?.centerOnPerson(pessoa.id)
      }, 50)
    }
  }, [pessoas, setSelectedPerson])

  // ── ABERTURA CENTRADA ─────────────────────────────────────────────────────
  // A árvore nunca abre perdida: o primeiro enquadramento é no requerente. Roda
  // UMA vez por árvore carregada (a trava é o próprio id do requerente), então
  // arrastar o canvas depois não é desfeito por um recentramento surpresa.
  const requerenteEnquadradoRef = useRef<number | null>(null)
  useEffect(() => {
    const alvo = operacional.requerenteSelecionadoId
    if (alvo == null || pessoas.length === 0) return
    if (requerenteEnquadradoRef.current === alvo) return
    requerenteEnquadradoRef.current = alvo
    // O canvas monta o layout no mesmo tick; o quadro seguinte já tem posição.
    const t = setTimeout(() => {
      if (operacional.modo === "linhagem" && operacional.linhagem) {
        reactFlowTreeRef.current?.enquadrar([...operacional.linhagem.visivel])
      } else {
        reactFlowTreeRef.current?.centerOnPerson(alvo, { zoom: 1 })
      }
    }, 120)
    return () => clearTimeout(t)
  }, [operacional.requerenteSelecionadoId, operacional.modo, operacional.linhagem, pessoas.length])

  // Entrar no modo linhagem enquadra a linha. Sem isto o filtro tira a poluição
  // da tela mas deixa o usuário olhando para o mesmo espaço vazio de antes.
  const modoAnteriorRef = useRef(operacional.modo)
  useEffect(() => {
    if (modoAnteriorRef.current === operacional.modo) return
    modoAnteriorRef.current = operacional.modo
    if (operacional.modo === "linhagem" && operacional.linhagem) {
      reactFlowTreeRef.current?.enquadrar([...operacional.linhagem.visivel])
    } else {
      reactFlowTreeRef.current?.enquadrar([])
    }
  }, [operacional.modo, operacional.linhagem])

  // ── TECLADO ───────────────────────────────────────────────────────────────
  // ESC fecha · ENTER abre · setas navegam pela FAMÍLIA (↑ pai/mãe, ↓ filho,
  // ← → irmãos). Navegar por proximidade geométrica seria navegar pelo desenho;
  // aqui se navega pelo parentesco, que é o que o operador tem na cabeça.
  //
  // O atalho só age quando o foco NÃO está num campo de texto — senão digitar
  // uma data numa data seria interpretado como comando.
  const teclaGlobal = useCallback(
    (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      const digitando =
        alvo != null &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.tagName === "SELECT" ||
          alvo.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletaAberta((v) => !v)
        return
      }
      if (digitando) return

      // Atalhos de LETRA. Só disparam sem modificador: Ctrl+D é favoritar no
      // navegador e Cmd+L é a barra de endereço — sequestrar isso irrita mais do
      // que o atalho ajuda.
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const tecla = e.key.toLowerCase()
        if (tecla === "/") {
          e.preventDefault()
          setPaletaAberta(true)
          return
        }
        if (tecla === "d") {
          e.preventDefault()
          setDiagnosticoAberto((v) => !v)
          return
        }
        if (tecla === "l") {
          e.preventDefault()
          operacional.setModo(operacional.modo === "linhagem" ? "todos" : "linhagem")
          return
        }
        if (tecla === "f") {
          e.preventDefault()
          // F foca o requerente em foco; com alguém selecionado, foca a pessoa.
          const alvo = selectedPersonId ?? operacional.requerenteSelecionadoId
          if (alvo != null) irParaPessoa(alvo, { zoom: 1.1 })
          return
        }
      }

      if (e.key === "Escape") {
        // DONO ÚNICO DO ESCAPE, e só enquanto a árvore tem algo a fechar.
        //
        // A árvore abre dentro do modal do processo, que fecha no Escape por um
        // listener próprio em `document`. Este handler roda em fase de CAPTURA
        // (ver o addEventListener abaixo), então chega primeiro: quando ele
        // CONSOME o Escape, o modal não o vê e o processo não se fecha às costas
        // do usuário. Quando não há camada nenhuma aberta, ele deixa passar — e o
        // Escape volta a fazer o que sempre fez, que é fechar o processo.
        const consumir = () => {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
        // Uma camada por ESC, da mais externa para a mais interna. Fechar tudo de
        // uma vez faria o usuário perder contexto que não pediu para perder.
        if (document.body.dataset[MARCA_MENU_ABERTO]) {
          consumir()
          document.dispatchEvent(new Event(EVENTO_FECHAR_CAMADA))
          return
        }
        if (paletaAberta) { consumir(); setPaletaAberta(false); return }
        if (diagnosticoAberto) { consumir(); setDiagnosticoAberto(false); return }
        if (painelAberto) { consumir(); setPainelAberto(false); return }
        if (fullDetailsPerson) { consumir(); setFullDetailsPerson(null); return }
        if (selectedPersonId != null) {
          consumir()
          setSelectedPersonId(null)
          setSidebarTabInicial(undefined)
          return
        }
        // Última camada da árvore: sair do foco e devolver a árvore completa.
        if (operacional.modo === "linhagem") { consumir(); operacional.setModo("todos") }
        return
      }

      if (selectedPersonId == null) return
      const atual = pessoas.find((p) => p.id === selectedPersonId)
      if (!atual) return

      if (e.key === "Enter") {
        e.preventDefault()
        setFullDetailsPerson(atual)
        return
      }

      const irPara = (destino: number | null | undefined) => {
        if (destino == null) return
        e.preventDefault()
        localizarPessoa(destino)
      }

      if (e.key === "ArrowUp") {
        irPara(atual.paiId ?? atual.maeId)
      } else if (e.key === "ArrowDown") {
        const filhos = pessoas
          .filter((p) => p.paiId === atual.id || p.maeId === atual.id)
          .sort((a, b) => a.id - b.id)
        irPara(filhos[0]?.id)
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const irmaos = pessoas
          .filter(
            (p) =>
              p.id !== atual.id &&
              ((atual.paiId != null && p.paiId === atual.paiId) ||
                (atual.maeId != null && p.maeId === atual.maeId)),
          )
          .sort((a, b) => a.id - b.id)
        if (irmaos.length === 0) return
        // A pessoa atual entra na lista para o "próximo" ser calculado em roda:
        // do último irmão a seta volta ao primeiro, em vez de travar na ponta.
        const roda = [...irmaos, atual].sort((a, b) => a.id - b.id)
        const i = roda.findIndex((p) => p.id === atual.id)
        const passo = e.key === "ArrowRight" ? 1 : -1
        irPara(roda[(i + passo + roda.length) % roda.length]?.id)
      }
    },
    [
      pessoas,
      selectedPersonId,
      paletaAberta,
      painelAberto,
      diagnosticoAberto,
      fullDetailsPerson,
      localizarPessoa,
      irParaPessoa,
      operacional,
    ],
  )

  // CAPTURA (`true`): este handler precisa ver o Escape ANTES do listener do
  // modal do processo, que também fecha no Escape. É o que permite consumir o
  // evento quando a árvore tem camada aberta — e só nesse caso.
  useEffect(() => {
    document.addEventListener("keydown", teclaGlobal, true)
    return () => document.removeEventListener("keydown", teclaGlobal, true)
  }, [teclaGlobal])

  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
    if (!uniao) return null
    const conjugeId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
    return pessoas.find(p => p.id === conjugeId) || null
  }

  const findCasamento = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
  }

  const findConjuges = (pessoa: PessoaArvore): PessoaArvore[] => {
    const unioesP = unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
    return unioesP
      .map(u => {
        const conjugeId = u.pessoa1Id === pessoa.id ? u.pessoa2Id : u.pessoa1Id
        return pessoas.find(p => p.id === conjugeId)
      })
      .filter(Boolean) as PessoaArvore[]
  }

  const findCasamentos = (pessoa: PessoaArvore): UniaoArvore[] => {
    return unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  }

  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  const handleAddPai = (pessoaId: number) => {
    setAddPersonType('pai')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddMae = (pessoaId: number) => {
    setAddPersonType('mae')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddFilho = (pessoaId: number) => {
    setAddPersonType('filho')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddConjugeById = (pessoaId: number) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)
    await fetchArvore()
  }

  // "Importar Árvore" precisa existir nos DOIS caminhos de render — a árvore
  // montada e o onboarding. Definir o botão só dentro do return principal foi
  // o bug: numa árvore VAZIA o onboarding retorna antes (linha ~636) e o botão
  // nunca chegava à tela, justamente no estado em que importar é o caminho
  // mais provável. Declarado aqui, antes dos returns, ele é o mesmo elemento
  // nos dois lugares — não há como um sair de sincronia com o outro.
  const podeImportar = Boolean(pode('arvore.criar') && arvoreId)

  const botaoImportar = podeImportar ? (
    <button
      onClick={() => setImportarAberto(true)}
      title="Importar árvore a partir de um print"
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-[var(--surface-primary)] px-3 py-2 text-[13px] text-gray-600 shadow-[var(--elev-1)] transition hover:border-gray-300 hover:text-gray-900"
    >
      <ImagePlus className="h-4 w-4" />
      <span className="hidden sm:inline">Importar Árvore</span>
    </button>
  ) : null

  const modalImportar = arvoreId ? (
    <ImportarArvoreModal
      arvoreId={arvoreId}
      aberto={importarAberto}
      onFechar={() => setImportarAberto(false)}
      onImportado={() => {
        // Volta ao comportamento DERIVADO (null), não apenas `false`: se o
        // onboarding tivesse sido aberto à mão, ele continuaria na frente da
        // árvore recém-importada. Com null, `showOnboarding` passa a seguir
        // `pessoas.length` de novo e a árvore aparece sozinha.
        setShowOnboarding(null)
        void fetchArvore()
      }}
    />
  ) : null

  // Estado vazio - sem árvore
  if (!arvoreId && !loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center max-w-md px-6">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full opacity-20 animate-pulse" style={{ backgroundColor: fsColors.green }} />
            <div className="absolute inset-2 rounded-full flex items-center justify-center" style={{ backgroundColor: `${fsColors.green}30` }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill={fsColors.green} />
                <path d="M12 6v12M8 10v4M16 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-800 mb-2">Árvore Genealógica</h3>
          <p className="text-gray-500 mb-6">Crie a árvore genealógica para este processo de cidadania e gerencie todos os membros da família</p>
          <button
            className="px-8 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-[var(--elev-2)] hover:-translate-y-0.5 flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: fsColors.green }}
            onClick={handleCreateArvore}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Criando árvore...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                Criar Árvore Genealógica
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  // Loading
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[var(--border-default)] border-t-transparent rounded-full"></div>
      </div>
    )
  }

  // Onboarding
  if (showOnboarding && arvoreId) {
    return (
      // `relative` é o que ancora o botão sobreposto. O <TreeOnboarding> abaixo
      // não sabe que ele existe — segue recebendo as mesmas props e não muda de
      // layout; o botão apenas flutua no mesmo canto em que aparece na árvore
      // montada, para o operador achá-lo no mesmo lugar nos dois estados.
      <div ref={containerRef} className="relative h-full">
        <TreeOnboarding
          arvoreId={arvoreId}
          processoId={processoId}
          paisProcesso={paisProcesso}
          onComplete={handleOnboardingComplete}
        />
        {botaoImportar && <div className="absolute right-4 top-4 z-20">{botaoImportar}</div>}
        {modalImportar}
      </div>
    )
  }

  // Árvore principal
  return (
    <div ref={containerRef} className="h-full flex flex-col bg-gradient-to-b from-gray-100 to-gray-200 relative">
      {/* Overlay de transição */}
      <div className={`absolute inset-0 bg-[var(--surface-primary)] z-[9999] pointer-events-none transition-opacity duration-300 ${isTransitioning ? 'opacity-60' : 'opacity-0'}`} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--surface-popover)] border-b border-[var(--border-default)] text-white/70">
        <div className="flex items-center gap-2">
          {/* Botão Paisagem */}
          <button
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'paisagem' ? 'bg-[var(--surface-tertiary)] text-white/95' : 'hover:bg-[var(--surface-tertiary)]'}`}
            onClick={() => setViewMode('paisagem')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="9" width="6" height="6" rx="1" />
              <rect x="14" y="3" width="6" height="6" rx="1" />
              <rect x="14" y="15" width="6" height="6" rx="1" />
              <path d="M8 12 L14 6" />
              <path d="M8 12 L14 18" />
            </svg>
            <span className="text-sm font-medium">PAISAGEM</span>
          </button>

          {/* Botão Retrato */}
          <button
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'retrato' ? 'bg-[var(--surface-tertiary)] text-white/95' : 'hover:bg-[var(--surface-tertiary)]'}`}
            onClick={() => setViewMode('retrato')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="2" width="6" height="6" rx="1" />
              <rect x="15" y="2" width="6" height="6" rx="1" />
              <rect x="9" y="16" width="6" height="6" rx="1" />
              <path d="M6 8 L12 16" />
              <path d="M18 8 L12 16" />
            </svg>
            <span className="text-sm font-medium">RETRATO</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Botão Exportar PDF */}
          <button
            className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-tertiary)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleExportPDF}
            disabled={isExporting || pessoas.length === 0}
            title="Exportar para PDF"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            <span className="text-sm font-medium">
              {isExporting ? 'Exportando...' : 'PDF'}
            </span>
          </button>

          {/* Botão Fullscreen */}
          <button
            className="p-2 hover:bg-[var(--surface-tertiary)] rounded transition-colors"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Container da árvore */}
      <div ref={treeContainerRef} className="flex-1 overflow-hidden relative">
        {pessoas.length === 0 && !showOnboarding && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-8 max-w-sm text-center px-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8fa6b5" strokeWidth="1.5">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a7.5 7.5 0 0113 0" />
                  </svg>
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: fsColors.green }}
                >
                  <Plus className="w-4 h-4 text-white" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Comece sua árvore</h3>
                <p className="text-gray-500 text-sm">
                  Adicione a primeira pessoa da família para começar a construir a árvore genealógica
                </p>
              </div>
              <button
                className="px-6 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-[var(--elev-2)] hover:-translate-y-0.5 flex items-center gap-2"
                style={{ backgroundColor: fsColors.green }}
                onClick={() => setShowOnboarding(true)}
              >
                <User className="w-5 h-5" />
                Adicionar primeira pessoa
              </button>
            </div>
          </div>
        )}

        {pessoas.length > 0 && pessoaPrincipal && (
          <ReactFlowTree
            ref={reactFlowTreeRef}
            pessoas={pessoas}
            unioes={unioes}
            pessoaPrincipal={pessoaPrincipal}
            mode={viewMode}
            savedPositions={posicoesNodes || undefined}
            onSavePositions={handleSavePositions}
            onPersonClick={handlePersonClick}
            onAddPai={pode('arvore.criar') ? handleAddPai : undefined}
            onAddMae={pode('arvore.criar') ? handleAddMae : undefined}
            onAddFilho={pode('arvore.criar') ? handleAddFilho : undefined}
            onAddConjuge={pode('arvore.criar') ? handleAddConjugeById : undefined}
            foco={operacional.foco.estados}
            sinais={operacional.sinais}
            gruposRecolhidos={operacional.foco.gruposAtivos}
            onExpandirGrupo={operacional.expandirGrupo}
            lacunas={operacional.lacunas}
            saude={operacional.saude}
          />
        )}

        {/* Barra de linhagem: `absolute` no canto oposto ao dos botões
            Buscar/Importar/Análise, com a mesma casca deles. Sobreposta ao
            canvas — o <ReactFlowTree> acima não sabe que ela existe. */}
        {pessoas.length > 0 && (
          <BarraLinhagem
            mapa={operacional.mapa}
            linhagem={operacional.linhagem}
            requerenteSelecionadoId={operacional.requerenteSelecionadoId}
            onSelecionarRequerente={operacional.selecionarRequerente}
            modo={operacional.modo}
            onModo={operacional.setModo}
            estilo={operacional.estilo}
            onEstilo={operacional.setEstilo}
            filtros={operacional.filtros}
            filtrosAtivos={operacional.filtrosAtivos}
            onAlternarFiltro={operacional.alternar}
            onLimparFiltros={operacional.limparFiltros}
            resumo={operacional.resumo}
            comparacao={operacional.comparacao}
            trilha={operacional.trilha}
            proximaAcao={operacional.proximaAcao}
            relacionadosVisiveis={operacional.relacionadosVisiveis}
            onAlternarRelacionados={operacional.alternarRelacionados}
            totalRelacionados={operacional.totalRelacionados}
            saudeLigada={operacional.saudeLigada}
            onAlternarSaude={operacional.alternarSaude}
            contagemSaude={operacional.contagemSaude}
            contagemFiltros={operacional.contagemFiltros}
            totalRecuado={operacional.foco.totalRecuado}
            totalRecolhivel={operacional.totalRecolhivel}
            onRecolherTudo={operacional.recolherTudo}
            onIrParaPessoa={localizarPessoa}
            carregando={operacional.carregando}
          />
        )}

        <PainelDiagnostico
          diagnostico={operacional.diagnostico}
          proximaAcao={operacional.proximaAcao}
          aberto={diagnosticoAberto}
          onFechar={() => setDiagnosticoAberto(false)}
          onIrParaPessoa={localizarPessoa}
          escopo={
            operacional.modo === "linhagem" && operacional.linhagem
              ? `Linhagem de ${operacional.linhagem.nome}`
              : "Árvore inteira"
          }
          auditor={operacional.auditor}
        />

        {/* TELAS NOVAS — sobrepostas ao canvas, NUNCA dentro dele. Ficam em
            `absolute` no canto superior direito, longe dos controles que já
            existiam no canto inferior esquerdo. O <ReactFlowTree> acima não sabe
            que elas existem: abrir ou fechar não move um card sequer. */}
        {/* Uma barra só, nesta ordem: Buscar · Importar Árvore · Análise.
            "Importar Árvore" NÃO depende de `pessoas.length`: árvore vazia é
            justamente quando importar faz mais sentido. Buscar e Análise seguem
            condicionais — não há o que buscar nem analisar sem pessoas. Por
            ficarem em lados opostos do Importar, cada um carrega a sua própria
            guarda em vez de dividirem um fragmento. */}
        {(pessoas.length > 0 || podeImportar) && (
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            {pessoas.length > 0 && (
            <button
              onClick={() => setPaletaAberta(true)}
              title="Buscar pessoa (⌘K)"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-[var(--surface-primary)] px-3 py-2 text-[13px] text-gray-600 shadow-[var(--elev-1)] transition hover:border-gray-300 hover:text-gray-900"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Buscar</span>
              <kbd className="hidden rounded border border-gray-200 px-1 text-[10px] text-[var(--text-muted)] sm:inline">⌘K</kbd>
            </button>
            )}
            {botaoImportar}
            {pessoas.length > 0 && (
              <SeloSaude
                diagnostico={operacional.diagnostico}
                ativo={diagnosticoAberto}
                onAbrir={() => setDiagnosticoAberto((v) => !v)}
              />
            )}
            {pessoas.length > 0 && (
            <button
              onClick={() => setPainelAberto(true)}
              title="Inteligência da árvore"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-[var(--surface-primary)] px-3 py-2 text-[13px] text-gray-600 shadow-[var(--elev-1)] transition hover:border-gray-300 hover:text-gray-900"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">Análise</span>
              {/* Contagem só dos achados que exigem ação — número no botão que não
                  significa urgência vira ruído e o usuário para de olhar. */}
              {analise && analise.insights.some((i) => i.severidade === "critico" || i.severidade === "alto") && (
                <span className="rounded-full bg-[var(--surface-secondary)] px-1.5 text-[11px] font-semibold text-red-600">
                  {analise.insights.filter((i) => i.severidade === "critico" || i.severidade === "alto").length}
                </span>
              )}
            </button>
            )}
          </div>
        )}

        {modalImportar}

        <PainelInteligencia
          analise={analise}
          aberto={painelAberto}
          onFechar={() => setPainelAberto(false)}
          onIrParaPessoa={localizarPessoa}
          nomeDePessoa={nomeDePessoa}
          perguntas={operacional.perguntas}
        />
        <PaletaComandos
          indice={indice}
          aberto={paletaAberta}
          onFechar={() => setPaletaAberta(false)}
          onEscolher={localizarPessoa}
          contextoDe={operacional.contextoDe}
        />
      </div>

      {/* Overlay para sidebar */}
      {selectedPerson && (
        <div className="fixed inset-0 bg-[var(--overlay-modal)] z-[10000]" onClick={handleCloseSidebar} />
      )}

      {/* Sidebar */}
      <PessoaSidebar
        pessoa={selectedPerson}
        conjuges={selectedPerson ? findConjuges(selectedPerson) : []}
        casamentos={selectedPerson ? findCasamentos(selectedPerson) : []}
        onClose={handleCloseSidebar}
        onOpenFullDetails={handleOpenFullDetails}
        onEdit={pode('arvore.editar') ? handleEditPerson : undefined}
        onDelete={pode('arvore.excluir') ? handleDeletePerson : undefined}
        onAddFilho={pode('arvore.criar') ? handleAddFilho : undefined}
        onAddPai={pode('arvore.criar') ? handleAddPai : undefined}
        onAddMae={pode('arvore.criar') ? handleAddMae : undefined}
        onAddConjuge={pode('arvore.criar') ? handleAddConjugeById : undefined}
        onAddDocumento={undefined}
        onEditDocumento={undefined}
        onSelectPerson={handleSelectPersonFromSidebar}
        initialTab={sidebarTabInicial}
        dossie={selectedPersonId != null ? operacional.dossies.get(selectedPersonId) ?? null : null}
        financeiroVisivel={operacional.financeiroVisivel}
        nomeDeRequerente={nomeDePessoa}
        eventos={selectedPersonId != null ? operacional.eventosDe(selectedPersonId) : undefined}
      />

      {pessoaParaRemover != null && (
        <RemocaoPessoaModal
          key={pessoaParaRemover}
          pessoaId={pessoaParaRemover}
          onFechar={() => setPessoaParaRemover(null)}
          onConfirmar={confirmarRemocao}
          carregarPlano={carregarPlanoRemocao}
        />
      )}

      {/* Full Details Page */}
      {fullDetailsPerson && (
        <PessoaDetailsPage
          pessoa={fullDetailsPerson}
          conjuge={findConjuge(fullDetailsPerson)}
          casamento={findCasamento(fullDetailsPerson)}
          filhos={findFilhos(fullDetailsPerson)}
          onBack={handleCloseFullDetails}
          onPersonClick={handlePersonClickFromDetails}
          onAddPai={handleAddPai}
          onAddMae={handleAddMae}
          onAddFilho={handleAddFilho}
          onAddConjuge={handleAddConjugeById}
        />
      )}

      {/* Modal Adicionar Pessoa */}
      {showAddPersonModal && (
        <AddPersonModal
          arvoreId={arvoreId!}
          processoId={processoId}
          type={addPersonType}
          parentId={addPersonParentId}
          conjugeDePessoaId={addConjugeForPessoaId}
          pessoas={pessoas}
          unioes={unioes}
          requerentesForaDaArvore={requerentesForaDaArvore}
          onClose={() => {
            setShowAddPersonModal(false)
            setAddPersonType(null)
            setAddPersonParentId(null)
            setAddConjugeForPessoaId(null)
          }}
          onSuccess={async () => {
            await fetchArvore()
            setShowAddPersonModal(false)
            setAddPersonType(null)
            setAddPersonParentId(null)
            setAddConjugeForPessoaId(null)
          }}
        />
      )}

      {/* Modal Editar Pessoa */}
      {showEditPersonModal && editingPerson && (
        <EditPersonModal
          pessoa={editingPerson}
          pessoas={pessoas}
          unioes={unioes}
          processoId={processoId}
          requerentesAfetadosPor={requerentesAfetadosPor}
          estadoAtual={operacional.estadoAtual}
          onClose={() => {
            setShowEditPersonModal(false)
            setEditingPerson(null)
          }}
          onSuccess={async () => {
            await fetchArvore()
            setShowEditPersonModal(false)
            setEditingPerson(null)
          }}
        />
      )}
    </div>
  )
}

// ========================================
// MODAL DE ADICIONAR PESSOA - ✅ ATUALIZADO COM REQUERENTE E LINHAGEM
// ========================================
function AddPersonModal({
  arvoreId,
  processoId,
  type,
  parentId,
  conjugeDePessoaId,
  pessoas,
  unioes,
  requerentesForaDaArvore,
  onClose,
  onSuccess
}: {
  arvoreId: number
  processoId: number
  type: 'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null
  parentId: number | null
  conjugeDePessoaId?: number | null
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  /** Quantos requerentes do processo ainda não estão na árvore. */
  requerentesForaDaArvore: number
  onClose: () => void
  onSuccess: () => void
}) {
  // Modo de cadastro: pessoa comum (cria Pessoa) OU requerente do processo (REUSA a
  // Pessoa já existente — nunca duplica). O requerente NUNCA é criado por este form.
  // Quando não há requerente fora da árvore, a aba nem é oferecida — e um modo
  // 'requerente' herdado de um estado anterior é forçado de volta para 'pessoa'.
  const semRequerenteDisponivel = requerentesForaDaArvore === 0
  const [modoEscolhido, setModo] = useState<'pessoa' | 'requerente'>('pessoa')
  const modo: 'pessoa' | 'requerente' = semRequerenteDisponivel ? 'pessoa' : modoEscolhido
  const [nome, setNome] = useState('')
  const [sobrenome, setSobrenome] = useState('')
  const [sexo, setSexo] = useState<string>('')
  const [dataNasc, setDataNasc] = useState('')
  const [localNasc, setLocalNasc] = useState('')
  const [paisNasc, setPaisNasc] = useState('')
  const [nacionalidade, setNacionalidade] = useState('')
  const [isFalecido, setIsFalecido] = useState(false)
  const [dataObito, setDataObito] = useState('')
  const [localObito, setLocalObito] = useState('')
  const [isCasado, setIsCasado] = useState(type === 'conjuge')
  const [dataCasamento, setDataCasamento] = useState('')
  const [localCasamento, setLocalCasamento] = useState('')
  const [conjugeId, setConjugeId] = useState<number | string>('')
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)
  
  // ✅ NOVOS CAMPOS
  const [requerente, setRequerente] = useState<string>('nao')
  const [numeroLinhagem, setNumeroLinhagem] = useState<string>('')
  const [isLinhaReta, setIsLinhaReta] = useState<boolean>(type !== 'conjuge')
  const [precisaDocumentacao, setPrecisaDocumentacao] = useState<boolean>(true)

  // Classes padrão
  // O Preflight do Tailwind aplica `color: inherit` em input/select/textarea.
  // Declarar `bg-[var(--surface-primary)]` sem declarar a cor do texto deixa o campo à mercê do que
  // o ancestral definir — foi assim que o valor digitado virou branco no branco.
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 placeholder:text-[var(--text-muted)] text-sm h-[42px]"
  
  const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 text-sm h-[42px] appearance-none cursor-pointer"
  
  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center'
  }

  // Adicionar cônjuge implica casado — é derivação do tipo de adição, não um estado
  // que precise ser corrigido depois. Antes o formulário aparecia por um render com o
  // "casado" desmarcado, e só então o efeito o marcava.

  // Relação estrutural do tipo de adição, para o caminho de REUSO do requerente:
  // ao vincular a Pessoa existente, propaga os mesmos vínculos que o form aplicaria.
  const relacaoRequerente = (): { paiId?: number; maeId?: number } => {
    if (type !== 'filho' || !parentId) return {}
    const rel: { paiId?: number; maeId?: number } = {}
    const pessoaPai = pessoas.find(p => p.id === parentId)
    if (pessoaPai?.sexo === 'Feminino') rel.maeId = parentId
    else rel.paiId = parentId
    const uniaoExistente = unioes.find(u => u.pessoa1Id === parentId || u.pessoa2Id === parentId)
    if (uniaoExistente) {
      const cId = uniaoExistente.pessoa1Id === parentId ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id
      const conjuge = pessoas.find(p => p.id === cId)
      if (conjuge) {
        if (conjuge.sexo === 'Feminino') rel.maeId = cId
        else rel.paiId = cId
      }
    }
    return rel
  }

  // Após o vínculo do requerente (Pessoa reusada/criada), aplica a relação estrutural
  // que este tipo de adição implica (pai/mãe de um existente, ou cônjuge) via endpoints
  // já existentes — sem nunca criar uma segunda Pessoa.
  const handleRequerenteLinked = async (pessoaId: number) => {
    try {
      if ((type === 'pai' || type === 'mae') && parentId) {
        await authFetch(`/api/pessoas/${parentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(type === 'pai' ? { paiId: pessoaId } : { maeId: pessoaId }),
        })
      }
      if (type === 'conjuge' && conjugeDePessoaId) {
        await authFetch('/api/unioes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pessoa1Id: conjugeDePessoaId,
            pessoa2Id: pessoaId,
            tipo: 'casamento',
          }),
        })
      }
    } catch (err) {
      console.error('Erro ao aplicar relação do requerente vinculado:', err)
    } finally {
      onSuccess()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    setSaving(true)
    try {
      const body: any = {
        nome: nome.trim(),
        sobrenome: sobrenome.trim() || null,
        sexo: sexo || null,
        data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null,
        local_nasc: localNasc.trim() || null,
        pais_nasc: paisNasc.trim() || null,
        nacionalidade: nacionalidade.trim() || null,
        vivo: !isFalecido,
        casado: isCasado,
        data_obito: isFalecido && dataObito ? new Date(dataObito).toISOString() : null,
        local_emigracao: isFalecido && localObito ? localObito.trim() : null,
        comentario: comentario.trim() || null,
        requerente: requerente || 'nao',  // ✅ NOVO
        numeroLinhagem: numeroLinhagem ? parseInt(numeroLinhagem) : null,  // ✅ pasta documental (todos)
        linhaReta: isLinhaReta,  // ✅ Central Operacional / Documentos
        documentacao: precisaDocumentacao,  // ✅ gera documentos ou não
        arvoreId
      }

      if (type === 'pai' && parentId) {
        body.filhoId = parentId
        body.tipoPai = 'pai'
      } else if (type === 'mae' && parentId) {
        body.filhoId = parentId
        body.tipoPai = 'mae'
      } else if (type === 'filho' && parentId) {
        const pessoaPai = pessoas.find(p => p.id === parentId)
        if (pessoaPai) {
          if (pessoaPai.sexo === 'Feminino') body.maeId = parentId
          else body.paiId = parentId

          const uniaoExistente = unioes.find(u => u.pessoa1Id === parentId || u.pessoa2Id === parentId)
          if (uniaoExistente) {
            const cId = uniaoExistente.pessoa1Id === parentId ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id
            const conjuge = pessoas.find(p => p.id === cId)
            if (conjuge) {
              if (conjuge.sexo === 'Feminino') body.maeId = cId
              else body.paiId = cId
            }
          }
        } else {
          body.paiId = parentId
        }
      }

      const response = await authFetch('/api/pessoas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const novaPessoa = await response.json()

        if ((type === 'conjuge' && conjugeDePessoaId) || (isCasado && conjugeId)) {
          const pessoa1Id = conjugeDePessoaId || novaPessoa.id
          const pessoa2Id = conjugeDePessoaId ? novaPessoa.id : Number(conjugeId)

          await authFetch('/api/unioes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pessoa1Id,
              pessoa2Id,
              data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null,
              local: localCasamento.trim() || null,
              tipo: 'casamento'
            })
          })
        }

        onSuccess()
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao adicionar pessoa')
      }
    } catch (error) {
      console.error('Erro ao adicionar pessoa:', error)
      alert('Erro ao adicionar pessoa')
    } finally {
      setSaving(false)
    }
  }

  const titles: Record<string, string> = {
    pai: 'Adicionar Pai',
    mae: 'Adicionar Mãe',
    filho: 'Adicionar Filho(a)',
    pessoa: 'Adicionar Pessoa',
    conjuge: 'Adicionar Cônjuge'
  }

  const pessoasDisponiveis = pessoas.filter(p => true)

  return (
    <>
      <div className="fixed inset-0 bg-[var(--overlay-modal)] z-[10003]" onClick={onClose} />
      {/* `text-gray-900` na RAIZ do modal não é redundância com as classes dos
          campos: o modal é filho, na árvore DOM, do container de abas que ganha
          `text-white/80` quando `finDark` está ligado (atividade-details-modal),
          e `position: fixed` NÃO interrompe herança de cor. Sem uma cor própria
          aqui, todo elemento sem `text-` explícito herda branco sobre `bg-[var(--surface-primary)]`
          — inclusive qualquer campo que venha a ser adicionado depois. */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--surface-primary)] text-gray-900 rounded-xl shadow-[var(--elev-3)] z-[10004] w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-[var(--surface-primary)]">
          <h2 className="text-xl font-semibold text-gray-900">{titles[type || 'pessoa']}</h2>
        </div>

        {/* Seletor de modo: pessoa comum (cria) x requerente do processo (REUSA) */}
        <div className="px-6 pt-4">
          <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-50">
            <button
              type="button"
              onClick={() => setModo('pessoa')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${modo === 'pessoa' ? 'bg-[var(--surface-primary)] shadow-[var(--elev-1)] text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Pessoa da família
            </button>
            <button
              type="button"
              onClick={() => setModo('requerente')}
              disabled={semRequerenteDisponivel}
              title={semRequerenteDisponivel ? 'Todos os requerentes deste processo já estão na árvore' : undefined}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                semRequerenteDisponivel
                  ? 'text-[var(--text-muted)] cursor-not-allowed'
                  : modo === 'requerente' ? 'bg-[var(--surface-primary)] shadow-[var(--elev-1)] text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Requerente do processo
            </button>
          </div>
          {/* A explicação vem ANTES do clique, não depois. Botão morto com
              tooltip honesto é melhor do que botão vivo que leva a um aviso. */}
          <p className="text-xs text-[var(--text-muted)] mt-1.5">
            {semRequerenteDisponivel
              ? 'Requerente do processo: indisponível — todos já estão na árvore. Siga em Pessoa da família.'
              : 'Requerentes do processo são reaproveitados — a árvore não cria uma pessoa duplicada.'}
          </p>
        </div>

        {modo === 'requerente' ? (
          <div className="p-6">
            <RequerenteSelector
              processoId={processoId}
              arvoreId={arvoreId}
              paiId={relacaoRequerente().paiId ?? null}
              maeId={relacaoRequerente().maeId ?? null}
              onLinked={handleRequerenteLinked}
              onCancel={onClose}
            />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* ===== Identificação ===== */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Identificação</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                <input type="text" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select value={sexo} onChange={(e) => setSexo(e.target.value)} className={selectClass} style={selectStyle}>
                  <option value="">Selecione...</option>
                  <option value="Masculino">Masculino</option>
                  <option value="Feminino">Feminino</option>
                </select>
              </div>
            </div>
          </section>

          {/* ===== Nascimento ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Nascimento</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                <DatePickerField value={dataNasc} onChange={(value) => setDataNasc(value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade de Nascimento</label>
                <input type="text" value={localNasc} onChange={(e) => setLocalNasc(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">País de Nascimento</label>
                <input type="text" value={paisNasc} onChange={(e) => setPaisNasc(e.target.value)} placeholder="Ex: Brasil, Itália..." className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidade</label>
                <input type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} placeholder="Ex: Brasileiro..." className={inputClass} />
              </div>
            </div>
          </section>

          {/* ===== Situação ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Situação</h3>
            <div className="flex flex-wrap items-center gap-6">
              {type !== 'conjuge' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
                  <span className="text-sm font-medium text-gray-700">Pessoa casada</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
                <span className="text-sm font-medium text-gray-700">Pessoa falecida</span>
              </label>
            </div>

            {(isCasado || type === 'conjuge') && (
              <div className="bg-[var(--surface-secondary)] rounded-lg p-3 border border-[var(--border-default)] mt-3">
                <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Dados do Casamento</h4>
                <div className="grid grid-cols-3 gap-3">
                  {type !== 'conjuge' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cônjuge</label>
                      <select value={conjugeId} onChange={(e) => setConjugeId(e.target.value)} className={selectClass} style={selectStyle}>
                        <option value="">Selecione...</option>
                        {pessoasDisponiveis.map(p => (
                          <option key={p.id} value={p.id}>{p.nome} {p.sobrenome || ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data do Casamento</label>
                    <DatePickerField value={dataCasamento} onChange={(value) => setDataCasamento(value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local do Casamento</label>
                    <input type="text" value={localCasamento} onChange={(e) => setLocalCasamento(e.target.value)} placeholder="Cidade, País" className={inputClass} />
                  </div>
                </div>
              </div>
            )}

            {isFalecido && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 mt-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Dados do Falecimento</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Falecimento</label>
                    <DatePickerField value={dataObito} onChange={(value) => setDataObito(value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local de Falecimento</label>
                    <input type="text" value={localObito} onChange={(e) => setLocalObito(e.target.value)} placeholder="Cidade, País" className={inputClass} />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ===== Classificação no processo ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Classificação no processo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Linhagem</label>
                <input type="number" min="1" value={numeroLinhagem} onChange={(e) => setNumeroLinhagem(e.target.value)} placeholder="Ex: 1, 2, 3..." className={inputClass} />
                <span className="block text-xs text-[var(--text-muted)] mt-1">Ordena a pasta documental — vale pra todas as pessoas.</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              É um requerente do processo? Use a opção <strong>Requerente do processo</strong> no topo — a pessoa existente é reaproveitada, sem duplicar.
            </p>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={isLinhaReta} onChange={(e) => setIsLinhaReta(e.target.checked)} className="w-5 h-5 mt-0.5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Pertence à linha reta de transmissão</span>
                <span className="block text-xs text-[var(--text-muted)]">Define se a pessoa entra na Linha principal ou em Cônjuges/Apoio na Central Operacional.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={precisaDocumentacao} onChange={(e) => setPrecisaDocumentacao(e.target.checked)} className="w-5 h-5 mt-0.5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Precisa de documentação</span>
                <span className="block text-xs text-[var(--text-muted)]">Se desligado, o sistema não gera os documentos desta pessoa e ela não entra na Central Operacional / workflow.</span>
              </span>
            </label>
          </section>

          {/* ===== Observações ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Observações</h3>
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 placeholder:text-[var(--text-muted)] resize-none text-sm" />
          </section>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving || !nome.trim()} className="px-6 py-2 bg-[var(--action-primary)] text-[var(--action-primary-ink)] rounded-lg hover:bg-[var(--action-primary)] transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </form>
        )}
      </div>
    </>
  )
}

// ========================================
// MODAL DE EDITAR PESSOA - ✅ ATUALIZADO COM REQUERENTE E LINHAGEM
// ========================================
function EditPersonModal({
  pessoa,
  pessoas,
  unioes,
  processoId,
  requerentesAfetadosPor,
  estadoAtual,
  onClose,
  onSuccess
}: {
  pessoa: PessoaArvore
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  processoId: number
  /** Nomes dos requerentes cuja linha passa por esta pessoa. */
  requerentesAfetadosPor: (pessoaId: number) => string[]
  /** Números de hoje, para o preview montar a coluna ANTES. */
  estadoAtual?: EstadoAtual
  onClose: () => void
  onSuccess: () => void
}) {
  const uniaoExistente = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  const conjugeExistenteId = uniaoExistente
    ? (uniaoExistente.pessoa1Id === pessoa.id ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id)
    : null

  const [nome, setNome] = useState(pessoa.nome)
  const [sobrenome, setSobrenome] = useState(pessoa.sobrenome || '')
  const [sexo, setSexo] = useState(pessoa.sexo || '')
  const [dataNasc, setDataNasc] = useState(pessoa.data_nasc ? new Date(pessoa.data_nasc).toISOString().split('T')[0] : '')
  const [localNasc, setLocalNasc] = useState(pessoa.local_nasc || '')
  const [paisNasc, setPaisNasc] = useState(pessoa.pais_nasc || '')
  const [nacionalidade, setNacionalidade] = useState(pessoa.nacionalidade || '')
  const [isFalecido, setIsFalecido] = useState(pessoa.vivo === false || !!pessoa.data_obito)
  const [dataObito, setDataObito] = useState(pessoa.data_obito ? new Date(pessoa.data_obito).toISOString().split('T')[0] : '')
  const [localObito, setLocalObito] = useState(pessoa.local_emigracao || '')
  const [isCasado, setIsCasado] = useState(!!uniaoExistente)
  const [dataCasamento, setDataCasamento] = useState(uniaoExistente?.data_inicio ? new Date(uniaoExistente.data_inicio).toISOString().split('T')[0] : '')
  const [localCasamento, setLocalCasamento] = useState(uniaoExistente?.local || '')
  const [conjugeId, setConjugeId] = useState<number | string>(conjugeExistenteId || '')
  const [comentario, setComentario] = useState(pessoa.comentario || '')
  const [saving, setSaving] = useState(false)
  const [requerente, setRequerente] = useState((pessoa as any).requerente || 'nao')
  const [numeroLinhagem, setNumeroLinhagem] = useState((pessoa as any).numeroLinhagem?.toString() || '')
  const [isLinhaReta, setIsLinhaReta] = useState<boolean>((pessoa as any).linhaReta ?? true)
  const [precisaDocumentacao, setPrecisaDocumentacao] = useState<boolean>((pessoa as any).documentacao ?? true)

  // Classes padrão
  // O Preflight do Tailwind aplica `color: inherit` em input/select/textarea.
  // Declarar `bg-[var(--surface-primary)]` sem declarar a cor do texto deixa o campo à mercê do que
  // o ancestral definir — foi assim que o valor digitado virou branco no branco.
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 placeholder:text-[var(--text-muted)] text-sm h-[42px]"
  
  const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 text-sm h-[42px] appearance-none cursor-pointer"
  
  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center'
  }

  // ── PREVIEW DE IMPACTO ────────────────────────────────────────────────────
  // Só entra em cena quando a alteração é RELEVANTE — isto é, quando ela muda
  // algum atributo que as Regras Documentais leem (óbito, estado civil,
  // filiação, requerente). Corrigir a grafia de um nome não abre modal nenhum:
  // um preview que aparece sempre vira um "OK" automático e deixa de informar.
  const conjugeSelecionadoId = isCasado && conjugeId ? Number(conjugeId) : null
  const casamentoNasceu = !uniaoExistente && conjugeSelecionadoId != null
  const casamentoAcabou = Boolean(uniaoExistente) && !isCasado
  const obitoMudou = (pessoa.vivo === false || !!pessoa.data_obito) !== isFalecido
  const requerenteMudou = (pessoa.requerente || 'nao') !== (requerente || 'nao')

  const mudancaRelevante = obitoMudou || requerenteMudou || casamentoNasceu || casamentoAcabou

  const descreverAlteracoes = (): AlteracaoDescrita[] => {
    const lista: AlteracaoDescrita[] = []
    if (obitoMudou) {
      lista.push({
        campo: 'Situação',
        de: isFalecido ? 'Vivo' : 'Falecido',
        para: isFalecido ? 'Falecido' : 'Vivo',
      })
    }
    if (casamentoNasceu || casamentoAcabou) {
      lista.push({
        campo: 'Estado civil',
        de: uniaoExistente ? 'Casado' : 'Solteiro',
        para: isCasado ? 'Casado' : 'Solteiro',
      })
    }
    if (requerenteMudou) {
      lista.push({
        campo: 'Requerente',
        de: pessoa.requerente && pessoa.requerente !== 'nao' ? pessoa.requerente : 'não',
        para: requerente && requerente !== 'nao' ? requerente : 'não',
      })
    }
    return lista
  }

  const montarProposta = (): PropostaImpacto => ({
    processoId,
    pessoaId: pessoa.id,
    mudancas: {
      vivo: !isFalecido,
      casado: isCasado,
      requerente: requerente || 'nao',
      linhaReta: isLinhaReta,
      documentacao: precisaDocumentacao,
      data_obito: isFalecido && dataObito ? new Date(dataObito).toISOString() : null,
    },
    // A união entra na simulação porque é dela que nasce a exigência de
    // certidão de casamento — sem isso o preview diria "sem impacto" ao casar.
    uniao: casamentoNasceu
      ? { acao: 'criar', conjugeId: conjugeSelecionadoId! }
      : casamentoAcabou && uniaoExistente
        ? { acao: 'remover', uniaoId: uniaoExistente.id }
        : undefined,
    alteracoes: descreverAlteracoes(),
    requerentesAfetados: requerentesAfetadosPor(pessoa.id),
    estadoAtual,
  })

  const [proposta, setProposta] = useState<PropostaImpacto | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    // Alteração relevante ainda não confirmada: mostra o impacto primeiro.
    if (mudancaRelevante && !proposta) {
      setProposta(montarProposta())
      return
    }
    await persistir()
  }

  const persistir = async () => {
    setProposta(null)
    setSaving(true)
    try {
      const response = await authFetch(`/api/pessoas/${pessoa.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          sobrenome: sobrenome.trim() || null,
          sexo: sexo || null,
          data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null,
          local_nasc: localNasc.trim() || null,
          pais_nasc: paisNasc.trim() || null,
          nacionalidade: nacionalidade.trim() || null,
          vivo: !isFalecido,
          casado: isCasado,
          data_obito: isFalecido && dataObito ? new Date(dataObito).toISOString() : null,
          local_emigracao: isFalecido && localObito ? localObito.trim() : null,
          comentario: comentario.trim() || null,
          requerente: requerente || 'nao',
          numeroLinhagem: numeroLinhagem ? parseInt(numeroLinhagem) : null,
          linhaReta: isLinhaReta,
          documentacao: precisaDocumentacao
        })
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Erro ao atualizar pessoa')
        return
      }

      if (isCasado && conjugeId) {
        if (uniaoExistente) {
          const conjugeAtualId = uniaoExistente.pessoa1Id === pessoa.id 
            ? uniaoExistente.pessoa2Id 
            : uniaoExistente.pessoa1Id

          if (Number(conjugeId) !== conjugeAtualId) {
            // Cônjuge mudou: atualiza via PUT
            await authFetch(`/api/unioes/${uniaoExistente.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pessoa1Id: pessoa.id,
                pessoa2Id: Number(conjugeId),
                data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null,
                local: localCasamento.trim() || null
              })
            })
          } else {
            // Mesmo cônjuge: só atualiza data/local
            await authFetch(`/api/unioes/${uniaoExistente.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null,
                local: localCasamento.trim() || null
              })
            })
          }
        } else {
          await authFetch('/api/unioes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pessoa1Id: pessoa.id,
              pessoa2Id: Number(conjugeId),
              data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null,
              local: localCasamento.trim() || null,
              tipo: 'casamento'
            })
          })
        }
      } else if (!isCasado && uniaoExistente) {
        await authFetch(`/api/unioes/${uniaoExistente.id}`, { method: 'DELETE' })
      }

      onSuccess()
    } catch (error) {
      console.error('Erro ao atualizar pessoa:', error)
      alert('Erro ao atualizar pessoa')
    } finally {
      setSaving(false)
    }
  }

  const pessoasDisponiveis = pessoas.filter(p => p.id !== pessoa.id)

  // "I" abre o preview quando já existe mudança relevante pendente no formulário.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      const digitando =
        alvo != null &&
        (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable)
      if (digitando || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() !== 'i') return
      if (!mudancaRelevante || proposta) return
      e.preventDefault()
      setProposta(montarProposta())
    }
    document.addEventListener('keydown', atalho)
    return () => document.removeEventListener('keydown', atalho)
  })

  return (
    <>
      {proposta && (
        <PreviewImpactoModal
          proposta={proposta}
          onCancelar={() => setProposta(null)}
          onConfirmar={persistir}
        />
      )}
      <div className="fixed inset-0 bg-[var(--overlay-modal)] z-[10003]" onClick={onClose} />
      {/* `text-gray-900` na RAIZ do modal não é redundância com as classes dos
          campos: o modal é filho, na árvore DOM, do container de abas que ganha
          `text-white/80` quando `finDark` está ligado (atividade-details-modal),
          e `position: fixed` NÃO interrompe herança de cor. Sem uma cor própria
          aqui, todo elemento sem `text-` explícito herda branco sobre `bg-[var(--surface-primary)]`
          — inclusive qualquer campo que venha a ser adicionado depois. */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--surface-primary)] text-gray-900 rounded-xl shadow-[var(--elev-3)] z-[10004] w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-[var(--surface-primary)]">
          <h2 className="text-xl font-semibold text-gray-900">Editar Pessoa</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* ===== Identificação ===== */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Identificação</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                <input type="text" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select value={sexo} onChange={(e) => setSexo(e.target.value)} className={selectClass} style={selectStyle}>
                  <option value="">Selecione...</option>
                  <option value="Masculino">Masculino</option>
                  <option value="Feminino">Feminino</option>
                </select>
              </div>
            </div>
          </section>

          {/* ===== Nascimento ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Nascimento</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                <DatePickerField value={dataNasc} onChange={(value) => setDataNasc(value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade de Nascimento</label>
                <input type="text" value={localNasc} onChange={(e) => setLocalNasc(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">País de Nascimento</label>
                <input type="text" value={paisNasc} onChange={(e) => setPaisNasc(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidade</label>
                <input type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} className={inputClass} />
              </div>
            </div>
          </section>

          {/* ===== Situação ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Situação</h3>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
                <span className="text-sm font-medium text-gray-700">Pessoa casada</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
                <span className="text-sm font-medium text-gray-700">Pessoa falecida</span>
              </label>
            </div>

            {isCasado && (
              <div className="bg-[var(--surface-secondary)] rounded-lg p-3 border border-[var(--border-default)] mt-3">
                <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Dados do Casamento</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cônjuge</label>
                    <select value={conjugeId} onChange={(e) => setConjugeId(e.target.value)} className={selectClass} style={selectStyle}>
                      <option value="">Selecione...</option>
                      {pessoasDisponiveis.map(p => (
                        <option key={p.id} value={p.id}>{p.nome} {p.sobrenome || ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data do Casamento</label>
                    <DatePickerField value={dataCasamento} onChange={(value) => setDataCasamento(value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local do Casamento</label>
                    <input type="text" value={localCasamento} onChange={(e) => setLocalCasamento(e.target.value)} placeholder="Cidade - Estado" className={inputClass} />
                  </div>
                </div>
              </div>
            )}

            {isFalecido && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 mt-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Dados do Falecimento</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Falecimento</label>
                    <DatePickerField value={dataObito} onChange={(value) => setDataObito(value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local de Falecimento</label>
                    <input type="text" value={localObito} onChange={(e) => setLocalObito(e.target.value)} placeholder="Cidade - Estado" className={inputClass} />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ===== Classificação no processo ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Classificação no processo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requerente</label>
                {/* Requerente tem o Processo (ProcessoRequerente) como única fonte de verdade:
                    não se marca requerente por edição livre. Já-requerente pode trocar o
                    principal (maior/menor); demais é somente leitura. */}
                {["sim", "maior", "menor"].includes(String((pessoa as any).requerente ?? "").toLowerCase()) ? (
                  <select value={requerente} onChange={(e) => setRequerente(e.target.value)} className={selectClass} style={selectStyle}>
                    <option value="maior">Sim - Maior de idade</option>
                    <option value="menor">Sim - Menor de idade</option>
                  </select>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    Definido pelo processo — adicione pela lista de requerentes do processo.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Linhagem</label>
                <input type="number" min="1" value={numeroLinhagem} onChange={(e) => setNumeroLinhagem(e.target.value)} placeholder="Ex: 1, 2, 3..." className={inputClass} />
                <span className="block text-xs text-[var(--text-muted)] mt-1">Ordena a pasta documental — vale pra todas as pessoas.</span>
              </div>
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={isLinhaReta} onChange={(e) => setIsLinhaReta(e.target.checked)} className="w-5 h-5 mt-0.5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Pertence à linha reta de transmissão</span>
                <span className="block text-xs text-[var(--text-muted)]">Define se a pessoa entra na Linha principal ou em Cônjuges/Apoio na Central Operacional.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={precisaDocumentacao} onChange={(e) => setPrecisaDocumentacao(e.target.checked)} className="w-5 h-5 mt-0.5 text-amber-600 border-gray-300 rounded focus:ring-[var(--border-strong)]" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Precisa de documentação</span>
                <span className="block text-xs text-[var(--text-muted)]">Se desligado, o sistema não gera os documentos desta pessoa e ela não entra na Central Operacional / workflow.</span>
              </span>
            </label>
          </section>

          {/* ===== Observações ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Observações</h3>
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] bg-[var(--surface-primary)] text-gray-900 placeholder:text-[var(--text-muted)] resize-none text-sm" />
          </section>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving || !nome.trim()} className="px-6 py-2 bg-[var(--action-primary)] text-[var(--action-primary-ink)] rounded-lg hover:bg-[var(--action-primary)] transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
