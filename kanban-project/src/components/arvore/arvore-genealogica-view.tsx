// src/components/arvore/arvore-genealogica-view.tsx

"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { calcularParentesco, caminhoGenealogico } from "@/src/lib/genealogia/motor/parentesco"
import { jsPDF } from "jspdf"
import type { PessoaArvore, UniaoArvore } from "./types"
import { PessoaDetailsPage } from "./pessoa-details-page"
import { ArvoreInteligente, type ArvoreInteligenteRef } from "./motor/arvore-inteligente"
import type { NecessidadeOficial } from "@/src/lib/genealogia/documental/indicadores"
import { TreeOnboarding } from "./tree-onboarding"
import { RequerenteSelector } from "./requerente-selector"
import { ChecagemDuplicidade, AvisoChecagemPendente, type CandidatoPessoa } from "./checagem-duplicidade"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Plus, User, Loader2, FileDown } from "lucide-react"
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

const fsColors = {
  male: '#3073B5',
  female: '#BF3D79',
  green: '#87B940',
  line: '#9CA3AF'
}

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
  const [pessoas, setPessoas] = useState<PessoaArvore[]>([])
  const [unioes, setUnioes] = useState<UniaoArvore[]>([])
  const [pessoaPrincipal, setPessoaPrincipal] = useState<PessoaArvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [arvoreId, setArvoreId] = useState<number | null>(initialArvoreId || null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<PessoaArvore | null>(null)
  const [fullDetailsPerson, setFullDetailsPerson] = useState<PessoaArvore | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  
  const arvoreRef = useRef<ArvoreInteligenteRef>(null)

  const [showAddPersonModal, setShowAddPersonModal] = useState(false)
  const [addPersonType, setAddPersonType] = useState<'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null>(null)
  const [addPersonParentId, setAddPersonParentId] = useState<number | null>(null)
  const [addConjugeForPessoaId, setAddConjugeForPessoaId] = useState<number | null>(null)

  const [showEditPersonModal, setShowEditPersonModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<PessoaArvore | null>(null)

  const [pessoaFocada, setPessoaFocada] = useState(false)
  const [sidebarTabInicial, setSidebarTabInicial] = useState<string | undefined>(undefined)

  const [posicoesNodes, setPosicoesNodes] = useState<
    Record<string, Record<string, { x: number; y: number }>> | null
  >(null)

  // INDICADOR DOCUMENTAL — consumido do Sistema Documental, nunca derivado
  // aqui. A árvore lia `Pessoa.documentos` (o Documento cru) e pintava semáforo
  // por tipo; isso era regra documental morando na árvore. Agora ela lê o
  // endpoint OFICIAL de necessidades e só agrupa por sujeito.
  const [necessidades, setNecessidades] = useState<NecessidadeOficial[]>([])

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
  }, [pessoaIdParaFocar, sidebarTabParaFocar, pessoas, pessoaFocada])

  // A pessoa selecionada acompanha a lista recarregada: ajuste de estado durante
  // o render (derivado de `pessoas`), sem efeito.
  const [pessoasAplicadas, setPessoasAplicadas] = useState(pessoas)
  if (pessoasAplicadas !== pessoas) {
    setPessoasAplicadas(pessoas)
    if (selectedPerson) {
      const pessoaAtualizada = pessoas.find(p => p.id === selectedPerson.id)
      if (pessoaAtualizada && pessoaAtualizada !== selectedPerson) setSelectedPerson(pessoaAtualizada)
    }
  }

  // Exportação em PDF.
  //
  // Mudança relevante: a captura agora passa por `arvoreRef.capturar`, que
  // desliga a virtualização e zera a transformação da câmera antes de gerar a
  // imagem. Antes, o PDF era tirado do DOM como ele estava na tela — com a
  // árvore nova (virtualizada) isso exportaria só a parte visível, com buracos.
  const handleExportPDF = useCallback(async () => {
    if (pessoas.length === 0 || !pessoaPrincipal || !arvoreRef.current) return
    setIsExporting(true)

    try {
      const { toPng } = await import('html-to-image')

      let imgData = ''
      let dims = { largura: 0, altura: 0 }

      await arvoreRef.current.capturar(async (elemento, dimensoes) => {
        dims = dimensoes

        // Elementos de interface não entram no documento entregue ao cliente.
        const ocultar = elemento.querySelectorAll<HTMLElement>('[data-no-pan] button, .group\\/doctip')
        const restaurar: Array<() => void> = []
        ocultar.forEach((el) => {
          const anterior = el.style.display
          el.style.setProperty('display', 'none', 'important')
          restaurar.push(() => { el.style.display = anterior })
        })

        // Sombras viram borrões cinza na rasterização — saem também.
        const comSombra = elemento.querySelectorAll<HTMLElement>('*')
        comSombra.forEach((el) => {
          if (!el.style.boxShadow && !el.className?.toString().includes('shadow')) return
          const anterior = el.style.boxShadow
          el.style.setProperty('box-shadow', 'none', 'important')
          restaurar.push(() => { el.style.boxShadow = anterior })
        })

        // Nome truncado no card precisa aparecer inteiro no papel.
        const nomes = elemento.querySelectorAll<HTMLElement>('h3')
        nomes.forEach((el) => {
          const anterior = el.getAttribute('style') || ''
          el.style.setProperty('-webkit-line-clamp', 'unset', 'important')
          el.style.setProperty('overflow', 'visible', 'important')
          restaurar.push(() => el.setAttribute('style', anterior))
        })

        try {
          imgData = await toPng(elemento, {
            backgroundColor: '#ffffff',
            pixelRatio: 2,
            skipFonts: true,
            width: Math.ceil(dimensoes.largura),
            height: Math.ceil(dimensoes.altura),
          })
        } finally {
          restaurar.forEach((f) => f())
        }
      })

      if (!imgData) {
        alert('Não foi possível gerar a imagem da árvore.')
        return
      }

      const pxToMm = 0.264583
      const imgWidthMM = dims.largura * pxToMm
      const imgHeightMM = dims.altura * pxToMm

      const marginX = 8
      const marginTop = 14
      const marginBottom = 8
      const pageWidth = Math.max(imgWidthMM + marginX * 2, 297)
      const pageHeight = Math.max(imgHeightMM + marginTop + marginBottom, 210)

      const pdf = new jsPDF({
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight],
      })

      const actualPageWidth = pdf.internal.pageSize.getWidth()
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(30, 30, 30)
      const titulo = `Albero Genealogico - Famiglia ${nomeFamilia || pessoaPrincipal.sobrenome || pessoaPrincipal.nome}`
      pdf.text(titulo, actualPageWidth / 2, 10, { align: 'center' })

      pdf.addImage(imgData, 'PNG', (actualPageWidth - imgWidthMM) / 2, marginTop, imgWidthMM, imgHeightMM)

      const dataAtual = new Date().toLocaleDateString('pt-BR')
      const nomeArquivo = `arvore-${(nomeFamilia || pessoaPrincipal.nome).toLowerCase().replace(/\s+/g, '-')}-${dataAtual.replace(/\//g, '-')}.pdf`
      pdf.save(nomeArquivo)
    } catch (error) {
      console.error('Erro ao exportar PDF:', error)
      alert('Erro ao exportar PDF. Verifique o console para mais detalhes.')
    } finally {
      setIsExporting(false)
    }
  }, [pessoas, pessoaPrincipal, nomeFamilia])

  // EXCLUSÃO DOCUMENTAL REMOVIDA DA ÁRVORE.
  //
  // A árvore chamava DELETE /api/documentos/:id sob a permissão
  // `arvore.excluir_documento` — ou seja, reimplementava uma permissão
  // documental e executava ciclo de vida de documento fora do módulo dono.
  // Pela Constituição, documento pertence exclusivamente ao Sistema
  // Documental. A árvore agora só ABRE a Pasta Documental no contexto certo.

  const handleEditPerson = (pessoa: PessoaArvore) => {
    setEditingPerson(pessoa)
    setShowEditPersonModal(true)
    setSelectedPerson(null)
  }

  const handleDeletePerson = async (pessoa: PessoaArvore) => {
    try {
      const response = await authFetch(`/api/pessoas/${pessoa.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchArvore()
        setSelectedPerson(null)
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao excluir pessoa')
      }
    } catch (error) {
      console.error('Erro ao excluir pessoa:', error)
      alert('Erro ao excluir pessoa')
    }
  }

  const handleAddConjuge = (pessoa: PessoaArvore) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoa.id)
    setShowAddPersonModal(true)
  }

  const handleCreateArvore = async () => {
    setCreating(true)
    try {
      const response = await authFetch('/api/arvore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: `Árvore do Processo ${processoId}`,
          processoId: processoId
        })
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
  
  const handleSavePositions = useCallback((positions: Record<string, Record<string, { x: number; y: number }>>) => {
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

  const fetchNecessidades = useCallback(async () => {
    if (!processoId) return
    try {
      const r = await authFetch(`/api/processos/${processoId}/necessidades`)
      if (!r.ok) return // sem permissão documental: a árvore segue sem o indicador
      const data = await r.json()
      setNecessidades(Array.isArray(data?.necessidades) ? data.necessidades : [])
    } catch (error) {
      console.error('Erro ao carregar indicadores documentais:', error)
    }
  }, [processoId])

  // Indicadores documentais: busca no efeito, estado só na continuação.
  useEffect(() => {
    if (!processoId) return
    const ac = new AbortController()
    authFetch(`/api/processos/${processoId}/necessidades`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)) // sem permissão documental: segue sem indicador
      .then((data) => { if (!ac.signal.aborted && data) setNecessidades(Array.isArray(data?.necessidades) ? data.necessidades : []) })
      .catch((error) => { if (!ac.signal.aborted) console.error('Erro ao carregar indicadores documentais:', error) })
    return () => ac.abort()
  }, [processoId])


  // Recarga da árvore por ação do usuário (adicionar/editar/excluir pessoa).
  const fetchArvore = useCallback(async () => {
if (!arvoreId) return

    try {
      const response = await authFetch(`/api/arvore/${arvoreId}`)

      if (response.ok) {
        const data = await response.json()
        setPessoas(data.pessoas || [])
        setPosicoesNodes(data.posicoesNodes || null)  // ✅ NOVO

        if (!data.pessoas || data.pessoas.length === 0) {
          setShowOnboarding(true)
        } else {
          setShowOnboarding(false)
        }

        const todasUnioes: UniaoArvore[] = []
        data.pessoas?.forEach((p: PessoaArvore) => {
          p.unioesComoPessoa1?.forEach((u: UniaoArvore) => {
            if (!todasUnioes.find(x => x.id === u.id)) {
              todasUnioes.push(u)
            }
          })
          p.unioesComoPessoa2?.forEach((u: UniaoArvore) => {
            if (!todasUnioes.find(x => x.id === u.id)) {
              todasUnioes.push(u)
            }
          })
        })
        setUnioes(todasUnioes)

        if (data.pessoaPrincipalId) {
          const principal = data.pessoas?.find((p: PessoaArvore) => p.id === data.pessoaPrincipalId)
          setPessoaPrincipal(principal || null)
        } else if (data.pessoas?.length > 0) {
          setPessoaPrincipal(data.pessoas[0])
        }
      }
    } catch (error) {
      console.error('Erro ao carregar árvore:', error)
    } finally {
      setLoading(false)
    }
  }, [arvoreId])

  // Carga da árvore. O corpo vive DENTRO do efeito: nenhuma escrita de estado
  // acontece no corpo síncrono — todas ficam na continuação assíncrona.
  useEffect(() => {
    void (async () => {
      if (!arvoreId) return

      try {
        const response = await authFetch(`/api/arvore/${arvoreId}`)

        if (response.ok) {
          const data = await response.json()
          setPessoas(data.pessoas || [])
          setPosicoesNodes(data.posicoesNodes || null)  // ✅ NOVO

          if (!data.pessoas || data.pessoas.length === 0) {
            setShowOnboarding(true)
          } else {
            setShowOnboarding(false)
          }

          const todasUnioes: UniaoArvore[] = []
          data.pessoas?.forEach((p: PessoaArvore) => {
            p.unioesComoPessoa1?.forEach((u: UniaoArvore) => {
              if (!todasUnioes.find(x => x.id === u.id)) {
                todasUnioes.push(u)
              }
            })
            p.unioesComoPessoa2?.forEach((u: UniaoArvore) => {
              if (!todasUnioes.find(x => x.id === u.id)) {
                todasUnioes.push(u)
              }
            })
          })
          setUnioes(todasUnioes)

          if (data.pessoaPrincipalId) {
            const principal = data.pessoas?.find((p: PessoaArvore) => p.id === data.pessoaPrincipalId)
            setPessoaPrincipal(principal || null)
          } else if (data.pessoas?.length > 0) {
            setPessoaPrincipal(data.pessoas[0])
          }
        }
      } catch (error) {
        console.error('Erro ao carregar árvore:', error)
      } finally {
        setLoading(false)
      }
    })()
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
        arvoreRef.current?.centralizarPessoa(pessoa.id)
      }, 50)
    }
  }, [pessoas])

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

  const findPais = (pessoa: PessoaArvore): PessoaArvore[] => {
    return [pessoa.paiId, pessoa.maeId]
      .map(id => (id == null ? null : pessoas.find(p => p.id === id) ?? null))
      .filter(Boolean) as PessoaArvore[]
  }

  // Irmão = compartilha PELO MENOS UM genitor. Exigir os dois apagaria o
  // meio-irmão, que num processo de cidadania é justamente quem muda o escopo
  // de certidão. A classificação fina (inteiro/meio) vive no motor genealógico;
  // aqui a página só precisa da lista.
  const findIrmaos = (pessoa: PessoaArvore): PessoaArvore[] => {
    if (pessoa.paiId == null && pessoa.maeId == null) return []
    return pessoas.filter(
      p =>
        p.id !== pessoa.id &&
        ((pessoa.paiId != null && p.paiId === pessoa.paiId) ||
          (pessoa.maeId != null && p.maeId === pessoa.maeId)),
    )
  }

  /**
   * PARENTESCO COM O REQUERENTE — para a página completa da pessoa.
   *
   * A ação "Ver parentesco" nascia permanentemente desabilitada porque ninguém
   * calculava o grau: o motor existia, a página aceitava a prop, e o host não
   * ligava os dois. Aqui o cálculo acontece sobre o MESMO grafo do domínio
   * (nada de heurística nova) e devolve o grau mais a distância em gerações.
   */
  const grafoParentesco = useMemo(
    () => construirGrafo(pessoas as never[], unioes as never[]),
    [pessoas, unioes],
  )

  const parentescoComRequerente = useMemo(() => {
    const alvo = fullDetailsPerson
    const raiz = pessoaPrincipal
    if (!alvo || !raiz || alvo.id === raiz.id) return null
    const grau = calcularParentesco(grafoParentesco, raiz.id, alvo.id)?.rotulo ?? null
    if (!grau) return null
    const caminho = caminhoGenealogico(grafoParentesco, raiz.id, alvo.id)
    return caminho && caminho.length > 1
      ? `${grau} · ${caminho.length - 1} geração(ões) do requerente`
      : grau
  }, [fullDetailsPerson, pessoaPrincipal, grafoParentesco])

  // "Ver árvore" a partir da página: fecha a ficha e reposiciona o desenho.
  const handleVerArvoreDaPagina = useCallback((pessoaId: number) => {
    setFullDetailsPerson(null)
    arvoreRef.current?.centralizarPessoa(pessoaId)
  }, [])

  // ATALHO CONTEXTUAL — a árvore não gere documento; ela leva o operador até o
  // módulo que gere, já no contexto certo (processo + pessoa).
  const handleAbrirPastaDocumental = useCallback((pessoaId: number) => {
    const url = `/dashboard/processos/${processoId}/documentos?pessoaId=${pessoaId}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [processoId])

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
            className="px-8 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  // Onboarding
  if (showOnboarding && arvoreId) {
    return (
      <div ref={containerRef} className="h-full">
        <TreeOnboarding
          arvoreId={arvoreId}
          processoId={processoId}
          paisProcesso={paisProcesso}
          onComplete={handleOnboardingComplete}
        />
      </div>
    )
  }

  // Árvore principal
  return (
    <div ref={containerRef} className="h-full flex flex-col relative" style={{ background: "#f4f5f6" }}>
      {/* Overlay de transição */}
      <div className={`absolute inset-0 bg-white z-[9999] pointer-events-none transition-opacity duration-300 ${isTransitioning ? 'opacity-60' : 'opacity-0'}`} />

      {/* Container da árvore — a barra de ferramentas agora pertence à própria
          árvore (modos, orientação, densidade, busca, inteligência, câmera).
          O PDF continua sendo responsabilidade desta view e entra como ação
          extra na barra, sem duplicar barra em cima de barra. */}
      <div ref={treeContainerRef} className="flex-1 overflow-hidden relative">
        {pessoas.length === 0 && !showOnboarding && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-8 max-w-sm text-center px-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
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
                className="px-6 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2"
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
          <ArvoreInteligente
            ref={arvoreRef}
            pessoas={pessoas}
            unioes={unioes}
            pessoaPrincipal={pessoaPrincipal}
            paisProcesso={paisProcesso}
            selecionadaId={selectedPerson?.id ?? null}
            aoSelecionarPessoa={handlePersonClick}
            aoAdicionarPai={pode('arvore.criar') ? handleAddPai : undefined}
            aoAdicionarMae={pode('arvore.criar') ? handleAddMae : undefined}
            aoAdicionarFilho={pode('arvore.criar') ? handleAddFilho : undefined}
            aoAdicionarConjuge={pode('arvore.criar') ? handleAddConjugeById : undefined}
            telaCheia={isFullscreen}
            aoAlternarTelaCheia={handleToggleFullscreen}
            posicoesSalvas={posicoesNodes}
            aoSalvarPosicoes={handleSavePositions}
            necessidades={necessidades}
            aoAbrirPastaDocumental={handleAbrirPastaDocumental}
            pessoaSelecionada={selectedPerson}
            aoFecharPainel={handleCloseSidebar}
            aoEditarPessoa={pode('arvore.editar') ? handleEditPerson : undefined}
            aoAbrirPaginaPessoa={handleOpenFullDetails}
            acoesExtras={
              <button
                type="button"
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleExportPDF}
                disabled={isExporting || pessoas.length === 0}
                title="Exportar a árvore em PDF"
                aria-label="Exportar a árvore em PDF"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
              </button>
            }
          />
        )}
      </div>

      {/* O painel lateral operacional vive DENTRO da árvore (ArvoreInteligente):
          ele abre sobre o canvas sem overlay e sem tirar posição/zoom. O
          PessoaSidebar antigo saiu — era outro componente para a mesma função. */}

      {/* Full Details Page */}
      {fullDetailsPerson && (
        <PessoaDetailsPage
          pessoa={fullDetailsPerson}
          conjuge={findConjuge(fullDetailsPerson)}
          casamento={findCasamento(fullDetailsPerson)}
          filhos={findFilhos(fullDetailsPerson)}
          pais={findPais(fullDetailsPerson)}
          irmaos={findIrmaos(fullDetailsPerson)}
          necessidades={necessidades}
          parentesco={parentescoComRequerente}
          onBack={handleCloseFullDetails}
          onPersonClick={handlePersonClickFromDetails}
          onAddPai={pode('arvore.criar') ? handleAddPai : undefined}
          onAddMae={pode('arvore.criar') ? handleAddMae : undefined}
          onAddFilho={pode('arvore.criar') ? handleAddFilho : undefined}
          onAddConjuge={pode('arvore.criar') ? handleAddConjugeById : undefined}
          onEditar={pode('arvore.editar') ? handleEditPerson : undefined}
          onAbrirPastaDocumental={handleAbrirPastaDocumental}
          onVerArvore={handleVerArvoreDaPagina}
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
  onClose: () => void
  onSuccess: () => void
}) {
  // Modo de cadastro: pessoa comum (cria Pessoa) OU requerente do processo (REUSA a
  // Pessoa já existente — nunca duplica). O requerente NUNCA é criado por este form.
  const [modo, setModo] = useState<'pessoa' | 'requerente'>('pessoa')
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
  const [isCasado, setIsCasado] = useState(false)
  const [dataCasamento, setDataCasamento] = useState('')
  const [localCasamento, setLocalCasamento] = useState('')
  const [conjugeId, setConjugeId] = useState<number | string>('')
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)
  
  // ✅ NOVOS CAMPOS
  const [requerente, setRequerente] = useState<string>('nao')
  // Trava de deduplicação: a criação só destrava depois da checagem no
  // Cadastro Mestre. Ver checagem-duplicidade.tsx para o porquê.
  const [criacaoLiberada, setCriacaoLiberada] = useState(false)
  // Id da decisão registrada no servidor — a API exige para criar.
  const [decisaoDedupId, setDecisaoDedupId] = useState<number | null>(null)
  const [vinculando, setVinculando] = useState(false)
  const [numeroLinhagem, setNumeroLinhagem] = useState<string>('')
  const [isLinhaReta, setIsLinhaReta] = useState<boolean>(type !== 'conjuge')
  const [precisaDocumentacao, setPrecisaDocumentacao] = useState<boolean>(true)

  // Classes padrão
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px]"
  
  const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px] appearance-none cursor-pointer"
  
  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center'
  }

  // Adição de cônjuge implica casamento: derivado do tipo, ajustado no render.
  const [tipoAplicado, setTipoAplicado] = useState(type)
  if (tipoAplicado !== type) {
    setTipoAplicado(type)
    if (type === 'conjuge') setIsCasado(true)
  }

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

  // Vincular Pessoa EXISTENTE — nenhuma Pessoa nova é criada. Usa só endpoints
  // oficiais já existentes: adoção na árvore + filiação + união.
  const handleVincularExistente = async (c: CandidatoPessoa) => {
    setVinculando(true)
    try {
      const patch: Record<string, unknown> = { arvoreId }
      if (type === 'filho' && parentId) {
        const pessoaPai = pessoas.find(p => p.id === parentId)
        if (pessoaPai?.sexo === 'Feminino') patch.maeId = parentId
        else patch.paiId = parentId
        const uniaoExistente = unioes.find(u => u.pessoa1Id === parentId || u.pessoa2Id === parentId)
        if (uniaoExistente) {
          const cId = uniaoExistente.pessoa1Id === parentId ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id
          const conjuge = pessoas.find(p => p.id === cId)
          if (conjuge) {
            if (conjuge.sexo === 'Feminino') patch.maeId = cId
            else patch.paiId = cId
          }
        }
      }

      const r = await authFetch(`/api/pessoas/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        alert(err.error || 'Não foi possível vincular esta pessoa.')
        return
      }

      if ((type === 'pai' || type === 'mae') && parentId) {
        await authFetch(`/api/pessoas/${parentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(type === 'pai' ? { paiId: c.id } : { maeId: c.id }),
        })
      }
      if (type === 'conjuge' && conjugeDePessoaId) {
        await authFetch('/api/unioes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pessoa1Id: conjugeDePessoaId, pessoa2Id: c.id, tipo: 'casamento' }),
        })
      }
      onSuccess()
    } catch (error) {
      console.error('Erro ao vincular pessoa existente:', error)
      alert('Erro ao vincular pessoa existente')
    } finally {
      setVinculando(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    if (!criacaoLiberada) return

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
        decisaoDedupId,  // MDM-3: sem isso a API recusa a criação
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
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-900">{titles[type || 'pessoa']}</h2>
        </div>

        {/* Seletor de modo: pessoa comum (cria) x requerente do processo (REUSA) */}
        <div className="px-6 pt-4">
          <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-50">
            <button
              type="button"
              onClick={() => setModo('pessoa')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${modo === 'pessoa' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Pessoa da família
            </button>
            <button
              type="button"
              onClick={() => setModo('requerente')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${modo === 'requerente' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Requerente do processo
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Requerentes do processo são reaproveitados — a árvore não cria uma pessoa duplicada.
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Identificação</h3>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Nascimento</h3>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Situação</h3>
            <div className="flex flex-wrap items-center gap-6">
              {type !== 'conjuge' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                  <span className="text-sm font-medium text-gray-700">Pessoa casada</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                <span className="text-sm font-medium text-gray-700">Pessoa falecida</span>
              </label>
            </div>

            {(isCasado || type === 'conjuge') && (
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 mt-3">
                <h4 className="text-sm font-medium text-purple-800 mb-2">Dados do Casamento</h4>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Classificação no processo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Linhagem</label>
                <input type="number" min="1" value={numeroLinhagem} onChange={(e) => setNumeroLinhagem(e.target.value)} placeholder="Ex: 1, 2, 3..." className={inputClass} />
                <span className="block text-xs text-gray-400 mt-1">Ordena a pasta documental — vale pra todas as pessoas.</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              É um requerente do processo? Use a opção <strong>Requerente do processo</strong> no topo — a pessoa existente é reaproveitada, sem duplicar.
            </p>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={isLinhaReta} onChange={(e) => setIsLinhaReta(e.target.checked)} className="w-5 h-5 mt-0.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Pertence à linha reta de transmissão</span>
                <span className="block text-xs text-gray-400">Define se a pessoa entra na Linha principal ou em Cônjuges/Apoio na Central Operacional.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={precisaDocumentacao} onChange={(e) => setPrecisaDocumentacao(e.target.checked)} className="w-5 h-5 mt-0.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Precisa de documentação</span>
                <span className="block text-xs text-gray-400">Se desligado, o sistema não gera os documentos desta pessoa e ela não entra na Central Operacional / workflow.</span>
              </span>
            </label>
          </section>

          {/* ===== Observações ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Observações</h3>
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none text-sm" />
          </section>

          {/* ===== Deduplicação obrigatória ===== */}
          <section className="border-t border-gray-100 pt-5">
            <ChecagemDuplicidade
              nome={nome}
              sobrenome={sobrenome}
              dataNasc={dataNasc}
              idsNaArvore={new Set(pessoas.map(p => p.id))}
              authFetch={authFetch}
              aoVincular={handleVincularExistente}
              aoLiberarCriacao={(ok, id) => { setCriacaoLiberada(ok); setDecisaoDedupId(id) }}
              liberado={criacaoLiberada}
            />
          </section>

          <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-100">
            <span>{!criacaoLiberada && nome.trim() && <AvisoChecagemPendente />}</span>
            <span className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
              <button
                type="submit"
                disabled={saving || vinculando || !nome.trim() || !criacaoLiberada}
                title={!criacaoLiberada ? 'Faça a checagem no Cadastro Mestre antes de criar' : undefined}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando...' : 'Criar Pessoa nova'}
              </button>
            </span>
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
  onClose,
  onSuccess
}: {
  pessoa: PessoaArvore
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
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
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px]"
  
  const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px] appearance-none cursor-pointer"
  
  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

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

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-900">Editar Pessoa</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* ===== Identificação ===== */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Identificação</h3>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Nascimento</h3>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Situação</h3>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                <span className="text-sm font-medium text-gray-700">Pessoa casada</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                <span className="text-sm font-medium text-gray-700">Pessoa falecida</span>
              </label>
            </div>

            {isCasado && (
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 mt-3">
                <h4 className="text-sm font-medium text-purple-800 mb-2">Dados do Casamento</h4>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Classificação no processo</h3>
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
                <span className="block text-xs text-gray-400 mt-1">Ordena a pasta documental — vale pra todas as pessoas.</span>
              </div>
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={isLinhaReta} onChange={(e) => setIsLinhaReta(e.target.checked)} className="w-5 h-5 mt-0.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Pertence à linha reta de transmissão</span>
                <span className="block text-xs text-gray-400">Define se a pessoa entra na Linha principal ou em Cônjuges/Apoio na Central Operacional.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-200 p-3 mt-3">
              <input type="checkbox" checked={precisaDocumentacao} onChange={(e) => setPrecisaDocumentacao(e.target.checked)} className="w-5 h-5 mt-0.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
              <span>
                <span className="block text-sm font-medium text-gray-700">Precisa de documentação</span>
                <span className="block text-xs text-gray-400">Se desligado, o sistema não gera os documentos desta pessoa e ela não entra na Central Operacional / workflow.</span>
              </span>
            </label>
          </section>

          {/* ===== Observações ===== */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Observações</h3>
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none text-sm" />
          </section>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
            <button type="submit" disabled={saving || !nome.trim()} className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
