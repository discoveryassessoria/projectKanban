// src/components/arvore/react-flow-tree.tsx

"use client"

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import ReactFlow, {
  Node,
  Edge,
  Background,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  NodeProps,
  MarkerType,
  ConnectionLineType,
} from "reactflow"
import dagre from "dagre"
import "reactflow/dist/style.css"
import type { PessoaArvore, UniaoArvore } from "./types"

// Cores estilo FamilySearch
const colors = {
  male: '#3073B5',
  maleBg: '#E8F4FC',
  female: '#BF3D79',
  femaleBg: '#FCE8F2',
  neutral: '#6B7280',
  neutralBg: '#F3F4F6',
  green: '#87B940',
  line: '#9CA3AF'
}

type ViewMode = 'paisagem' | 'retrato'

// Tamanhos dos nós
const NODE_SIZES = {
  paisagem: { width: 200, height: 90 },
  retrato: { width: 140, height: 110 }
}

// Funções auxiliares
function getGenderColors(sexo: string | null | undefined) {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'
  if (isMale) return { border: colors.male, bg: colors.maleBg }
  if (isFemale) return { border: colors.female, bg: colors.femaleBg }
  return { border: colors.neutral, bg: colors.neutralBg }
}

function formatDateRange(nascimento: Date | string | null | undefined, obito: Date | string | null | undefined): string {
  const formatYear = (date: Date | string | null | undefined) => {
    if (!date) return ""
    return new Date(date).getFullYear().toString()
  }
  const nasc = formatYear(nascimento)
  const obit = obito ? formatYear(obito) : ""
  if (!nasc && !obit) return ""
  if (!nasc && obit) return `†${obit}`
  if (nasc && obit) return `${nasc} – ${obit}`
  return nasc
}

function formatDate(dateStr: string | Date | null | undefined): string | null {
  if (!dateStr) return null
  
  // Se for string ISO, extrair apenas a parte da data para evitar problemas de timezone
  if (typeof dateStr === 'string') {
    // Formato ISO: "2025-12-08T00:00:00.000Z" -> pegar só "2025-12-08"
    const datePart = dateStr.split('T')[0]
    if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = datePart.split('-')
      return `${day}/${month}/${year}`
    }
  }
  
  // Fallback para Date object
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null
  
  // Usar UTC para evitar problemas de timezone
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  
  return `${day}/${month}/${year}`
}

// ========================================
// CUSTOM NODE: Pessoa Individual (SIMPLIFICADO)
// ========================================
interface PersonNodeData {
  pessoa: PessoaArvore
  isMain?: boolean
  isSpouse?: boolean
  mode: ViewMode
  unioes?: UniaoArvore[]
  onPersonClick?: (pessoa: PessoaArvore) => void
}

function PersonNode({ data }: NodeProps<PersonNodeData>) {
  const { pessoa, isMain, isSpouse, mode, unioes = [], onPersonClick } = data
  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  
  // Formatar datas
  const dataNasc = formatDate(pessoa.data_nasc)
  const dataObito = formatDate(pessoa.data_obito)
  
  // Múltiplas datas de casamento
  const datasCasamento = unioes
    .filter(u => u.data_inicio)
    .map(u => formatDate(u.data_inicio))
    .filter(Boolean) as string[]
  
  // Verificar se pessoa é falecida (vivo === false)
  const isFalecido = pessoa.vivo === false

  const handleClick = () => {
    onPersonClick?.(pessoa)
  }

  // Sem destaque especial para nenhum card
  const ringClass = ''

  if (mode === 'paisagem') {
    return (
      <div
        className={`relative bg-white rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all ${ringClass}`}
        style={{
          width: NODE_SIZES.paisagem.width,
          height: NODE_SIZES.paisagem.height,
          borderLeft: `4px solid ${genderColors.border}`,
        }}
        onClick={handleClick}
      >
        {/* Handles para conexões - LR */}
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-gray-400 !w-2 !h-2 !border-2 !border-white"
        />
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-2 !h-2 !border-2 !border-white"
        />

        <div className="p-2 h-full flex flex-col justify-center">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-1">
            {nomeCompleto}
          </h3>
          <div className="mt-1 text-[10px] text-gray-500 space-y-0.5">
            {/* Linha 1: Nascimento e Casamentos */}
            {(dataNasc || datasCasamento.length > 0) && (
              <div className="flex items-center gap-2 flex-wrap">
                {dataNasc && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 text-center">★</span>
                    <span>{dataNasc}</span>
                  </span>
                )}
                {datasCasamento.map((data, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1">
                    <span className="w-3 text-center">♥</span>
                    <span>{data}</span>
                  </span>
                ))}
              </div>
            )}
            {/* Linha 2: Óbito */}
            {(dataObito || isFalecido) && (
              <div className="inline-flex items-center gap-1">
                <span className="w-3 text-center">✝</span>
                <span>{dataObito || 'Falecido(a)'}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // MODO RETRATO
  return (
    <div
      className={`relative bg-white rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all ${ringClass}`}
      style={{
        width: NODE_SIZES.retrato.width,
        height: NODE_SIZES.retrato.height,
        borderTop: `4px solid ${genderColors.border}`,
      }}
      onClick={handleClick}
    >
      {/* Handles para conexões - BT */}
      <Handle
        type="source"
        position={Position.Top}
        className="!bg-gray-400 !w-2 !h-2 !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className="!bg-gray-400 !w-2 !h-2 !border-2 !border-white"
      />

      <div className="p-2 h-full flex flex-col items-center justify-center text-center">
        <h3 className="font-semibold text-gray-900 text-[11px] leading-tight line-clamp-2">
          {nomeCompleto}
        </h3>
        <div className="mt-1 text-[9px] text-gray-500 space-y-0.5">
          {/* Linha 1: Nascimento e Casamentos */}
          {(dataNasc || datasCasamento.length > 0) && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {dataNasc && (
                <span className="inline-flex items-center gap-0.5">
                  <span>★</span>
                  <span>{dataNasc}</span>
                </span>
              )}
              {datasCasamento.map((data, idx) => (
                <span key={idx} className="inline-flex items-center gap-0.5">
                  <span>♥</span>
                  <span>{data}</span>
                </span>
              ))}
            </div>
          )}
          {/* Linha 2: Óbito */}
          {(dataObito || isFalecido) && (
            <div className="inline-flex items-center justify-center gap-0.5">
              <span>✝</span>
              <span>{dataObito || 'Falecido(a)'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ========================================
// CUSTOM NODE: Adicionar Pessoa (placeholder)
// ========================================
interface AddPersonNodeData {
  type: 'pai' | 'mae' | 'filho' | 'conjuge'
  mode: ViewMode
  onClick?: () => void
}

function AddPersonNode({ data }: NodeProps<AddPersonNodeData>) {
  const { type, mode, onClick } = data

  const config = {
    pai: { label: 'Adicionar Pai', color: colors.neutral },
    mae: { label: 'Adicionar Mãe', color: colors.neutral },
    filho: { label: 'Adicionar Filho(a)', color: colors.green },
    conjuge: { label: 'Adicionar Cônjuge', color: colors.neutral }
  }
  const { label, color } = config[type]

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
        style={{ width: NODE_SIZES.paisagem.width, height: NODE_SIZES.paisagem.height }}
        onClick={onClick}
      >
        <Handle type="source" position={Position.Right} className="!bg-gray-300 !w-2 !h-2" />
        <Handle type="target" position={Position.Left} className="!bg-gray-300 !w-2 !h-2" />

        <div className="h-full flex items-center justify-center">
          <span className="text-xs font-medium" style={{ color }}>
            {label}
          </span>
        </div>
      </div>
    )
  }

  // RETRATO
  return (
    <div
      className="relative bg-white rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
      style={{ width: NODE_SIZES.retrato.width, height: NODE_SIZES.retrato.height }}
      onClick={onClick}
    >
      <Handle type="source" position={Position.Top} className="!bg-gray-300 !w-2 !h-2" />
      <Handle type="target" position={Position.Bottom} className="!bg-gray-300 !w-2 !h-2" />

      <div className="h-full flex items-center justify-center text-center px-2">
        <span className="text-[10px] font-medium leading-tight" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  )
}

// Tipos de nós customizados
const nodeTypes = {
  person: PersonNode,
  addPerson: AddPersonNode,
}

// ========================================
// DAGRE LAYOUT CONFIGURATION
// ========================================
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  mode: ViewMode,
  pessoas?: PessoaArvore[]
) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const isHorizontal = mode === 'paisagem'
  const nodeSize = NODE_SIZES[mode]
  
  // Configuração do Dagre com mais espaço
  dagreGraph.setGraph({
    rankdir: isHorizontal ? 'LR' : 'BT',
    nodesep: isHorizontal ? 80 : 60,  // Espaço entre nós no mesmo rank
    ranksep: isHorizontal ? 120 : 100, // Espaço entre ranks (gerações)
    marginx: 50,
    marginy: 50,
  })

  // Identificar casais (pessoas que compartilham filhos)
  const casais = new Map<string, { pessoa1Id: number; pessoa2Id: number }>()
  
  if (pessoas) {
    pessoas.forEach(pessoa => {
      if (pessoa.paiId && pessoa.maeId) {
        const pairKey = `${Math.min(pessoa.paiId, pessoa.maeId)}-${Math.max(pessoa.paiId, pessoa.maeId)}`
        if (!casais.has(pairKey)) {
          casais.set(pairKey, { pessoa1Id: pessoa.paiId, pessoa2Id: pessoa.maeId })
        }
      }
    })
  }

  // Adicionar todos os nós ao Dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || nodeSize.width,
      height: node.height || nodeSize.height,
    })
  })

  // Adicionar todas as edges ao Dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Executar layout inicial do Dagre
  dagre.layout(dagreGraph)

  // Criar array de nós com posições iniciais
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeSize.width / 2,
        y: nodeWithPosition.y - nodeSize.height / 2,
      },
    }
  })

  // ========================================
  // PÓS-PROCESSAMENTO: Ajustar casais
  // ========================================
  if (pessoas && casais.size > 0) {
    // Ordenar casais por "profundidade" na árvore (pais primeiro, depois filhos)
    // Isso garante que ajustamos de cima para baixo
    const casaisOrdenados = Array.from(casais.values()).sort((a, b) => {
      const nodeA1 = layoutedNodes.find(n => n.id === `person-${a.pessoa1Id}`)
      const nodeB1 = layoutedNodes.find(n => n.id === `person-${b.pessoa1Id}`)
      if (!nodeA1 || !nodeB1) return 0
      
      if (isHorizontal) {
        return nodeA1.position.x - nodeB1.position.x
      } else {
        return nodeB1.position.y - nodeA1.position.y // BT: Y maior = mais acima
      }
    })

    // Ajustar cada casal para ficar lado a lado no mesmo nível
    casaisOrdenados.forEach(({ pessoa1Id, pessoa2Id }) => {
      const node1 = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const node2 = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!node1 || !node2) return

      if (isHorizontal) {
        // Modo paisagem: mesmo X (coluna), Y adjacentes
        const avgX = (node1.position.x + node2.position.x) / 2
        const spacing = nodeSize.height + 15
        
        node1.position.x = avgX
        node2.position.x = avgX
        
        // Garantir que estão um acima do outro
        const avgY = (node1.position.y + node2.position.y) / 2
        node1.position.y = avgY - spacing / 2
        node2.position.y = avgY + spacing / 2
      } else {
        // Modo retrato: mesmo Y (linha), X adjacentes
        const avgY = (node1.position.y + node2.position.y) / 2
        const spacing = nodeSize.width + 20
        
        node1.position.y = avgY
        node2.position.y = avgY
        
        // Garantir que estão lado a lado horizontalmente
        // Manter a ordem relativa original (quem estava à esquerda continua à esquerda)
        const avgX = (node1.position.x + node2.position.x) / 2
        if (node1.position.x <= node2.position.x) {
          node1.position.x = avgX - spacing / 2
          node2.position.x = avgX + spacing / 2
        } else {
          node1.position.x = avgX + spacing / 2
          node2.position.x = avgX - spacing / 2
        }
      }
    })

    // ========================================
    // SEGUNDA PASSADA: Resolver sobreposições
    // ========================================
    // Agrupar nós por nível (rank/geração) com tolerância maior
    const nodesByLevel = new Map<number, Node[]>()
    const levelTolerance = isHorizontal ? nodeSize.width / 2 : nodeSize.height / 2
    
    layoutedNodes.forEach(node => {
      const position = isHorizontal ? node.position.x : node.position.y
      
      // Encontrar um nível existente próximo ou criar um novo
      let foundLevel: number | null = null
      nodesByLevel.forEach((_, level) => {
        if (Math.abs(position - level) < levelTolerance) {
          foundLevel = level
        }
      })
      
      const level = foundLevel !== null ? foundLevel : position
      
      if (!nodesByLevel.has(level)) {
        nodesByLevel.set(level, [])
      }
      nodesByLevel.get(level)!.push(node)
    })

    // Para cada nível, verificar e resolver sobreposições
    nodesByLevel.forEach((nodesInLevel) => {
      if (nodesInLevel.length <= 1) return

      // Ordenar nós por posição
      if (isHorizontal) {
        nodesInLevel.sort((a, b) => a.position.y - b.position.y)
      } else {
        nodesInLevel.sort((a, b) => a.position.x - b.position.x)
      }

      // Verificar e corrigir sobreposições - múltiplas passadas para garantir
      const minSpacing = isHorizontal ? nodeSize.height + 20 : nodeSize.width + 30
      
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < nodesInLevel.length; i++) {
          const prevNode = nodesInLevel[i - 1]
          const currNode = nodesInLevel[i]
          
          if (isHorizontal) {
            const prevBottom = prevNode.position.y + nodeSize.height
            const currTop = currNode.position.y
            const overlap = prevBottom + minSpacing - nodeSize.height - currTop
            
            if (overlap > 0) {
              // Mover o nó atual e todos os descendentes
              const pessoaId = parseInt(currNode.id.replace('person-', ''))
              if (!isNaN(pessoaId)) {
                moverPessoaEDescendentes(layoutedNodes, pessoaId, overlap, pessoas, casais, isHorizontal)
              } else {
                currNode.position.y += overlap
              }
            }
          } else {
            const prevRight = prevNode.position.x + nodeSize.width
            const currLeft = currNode.position.x
            const overlap = prevRight + minSpacing - nodeSize.width - currLeft
            
            if (overlap > 0) {
              // Mover o nó atual e todos os descendentes
              const pessoaId = parseInt(currNode.id.replace('person-', ''))
              if (!isNaN(pessoaId)) {
                moverPessoaEDescendentes(layoutedNodes, pessoaId, overlap, pessoas, casais, isHorizontal)
              } else {
                currNode.position.x += overlap
              }
            }
          }
        }
        
        // Re-ordenar após ajustes
        if (isHorizontal) {
          nodesInLevel.sort((a, b) => a.position.y - b.position.y)
        } else {
          nodesInLevel.sort((a, b) => a.position.x - b.position.x)
        }
      }
    })

    // ========================================
    // TERCEIRA PASSADA: Centralizar filhos sob os pais
    // ========================================
    casaisOrdenados.forEach(({ pessoa1Id, pessoa2Id }) => {
      const nodePai = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const nodeMae = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!nodePai || !nodeMae) return

      // Encontrar filhos deste casal
      const filhos = pessoas.filter(p => 
        (p.paiId === pessoa1Id && p.maeId === pessoa2Id) ||
        (p.paiId === pessoa2Id && p.maeId === pessoa1Id)
      )

      if (filhos.length === 0) return

      // Encontrar nós dos filhos
      const nodosFilhos = filhos
        .map(f => layoutedNodes.find(n => n.id === `person-${f.id}`))
        .filter(Boolean) as Node[]

      if (nodosFilhos.length === 0) return

      // Calcular centro dos pais
      const centroPaisX = (nodePai.position.x + nodeMae.position.x + nodeSize.width) / 2
      const centroPaisY = (nodePai.position.y + nodeMae.position.y + nodeSize.height) / 2

      // Calcular centro atual dos filhos
      const minFilhoX = Math.min(...nodosFilhos.map(n => n.position.x))
      const maxFilhoX = Math.max(...nodosFilhos.map(n => n.position.x + nodeSize.width))
      const centroFilhosX = (minFilhoX + maxFilhoX) / 2

      // Ajustar filhos para ficarem centralizados sob os pais (apenas no modo retrato)
      if (!isHorizontal) {
        const deltaX = centroPaisX - centroFilhosX
        
        // Mover todos os filhos e seus descendentes
        nodosFilhos.forEach(nodoFilho => {
          // Encontrar ID da pessoa
          const pessoaId = parseInt(nodoFilho.id.replace('person-', ''))
          moverPessoaEDescendentes(layoutedNodes, pessoaId, deltaX, pessoas, casais, isHorizontal)
        })
      }
    })

    // ========================================
    // QUARTA PASSADA: Verificação final de sobreposições
    // ========================================
    // Verificar TODOS os pares de nós e resolver qualquer sobreposição restante
    const minSpacingFinal = isHorizontal ? nodeSize.height + 20 : nodeSize.width + 30
    
    for (let pass = 0; pass < 5; pass++) {
      let hasOverlap = false
      
      for (let i = 0; i < layoutedNodes.length; i++) {
        for (let j = i + 1; j < layoutedNodes.length; j++) {
          const nodeA = layoutedNodes[i]
          const nodeB = layoutedNodes[j]
          
          // Verificar se estão no mesmo nível (mesma geração)
          const sameLevel = isHorizontal
            ? Math.abs(nodeA.position.x - nodeB.position.x) < nodeSize.width / 2
            : Math.abs(nodeA.position.y - nodeB.position.y) < nodeSize.height / 2
          
          if (!sameLevel) continue
          
          // Verificar sobreposição
          if (isHorizontal) {
            const aTop = nodeA.position.y
            const aBottom = nodeA.position.y + nodeSize.height
            const bTop = nodeB.position.y
            const bBottom = nodeB.position.y + nodeSize.height
            
            const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop) + minSpacingFinal - nodeSize.height
            
            if (overlap > 0) {
              hasOverlap = true
              // Mover o que está mais abaixo para baixo
              if (nodeA.position.y < nodeB.position.y) {
                nodeB.position.y += overlap
              } else {
                nodeA.position.y += overlap
              }
            }
          } else {
            const aLeft = nodeA.position.x
            const aRight = nodeA.position.x + nodeSize.width
            const bLeft = nodeB.position.x
            const bRight = nodeB.position.x + nodeSize.width
            
            const overlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft) + minSpacingFinal - nodeSize.width
            
            if (overlap > 0) {
              hasOverlap = true
              // Mover o que está mais à direita para a direita
              if (nodeA.position.x < nodeB.position.x) {
                nodeB.position.x += overlap
              } else {
                nodeA.position.x += overlap
              }
            }
          }
        }
      }
      
      if (!hasOverlap) break
    }
  }

  return { nodes: layoutedNodes, edges }
}

// Função auxiliar para mover uma pessoa e todos os seus descendentes
function moverPessoaEDescendentes(
  nodes: Node[], 
  pessoaId: number, 
  delta: number, 
  pessoas: PessoaArvore[],
  casais: Map<string, { pessoa1Id: number; pessoa2Id: number }>,
  isHorizontal: boolean
) {
  const nodesToMove = new Set<string>()
  const visited = new Set<number>()
  
  const collectNodes = (pId: number) => {
    if (visited.has(pId)) return
    visited.add(pId)
    
    nodesToMove.add(`person-${pId}`)
    
    // Adicionar cônjuge(s)
    casais.forEach((casal) => {
      if (casal.pessoa1Id === pId && !visited.has(casal.pessoa2Id)) {
        nodesToMove.add(`person-${casal.pessoa2Id}`)
      }
      if (casal.pessoa2Id === pId && !visited.has(casal.pessoa1Id)) {
        nodesToMove.add(`person-${casal.pessoa1Id}`)
      }
    })
    
    // Adicionar filhos recursivamente
    pessoas.forEach(p => {
      if ((p.paiId === pId || p.maeId === pId) && !visited.has(p.id)) {
        collectNodes(p.id)
      }
    })
  }
  
  collectNodes(pessoaId)
  
  // Mover todos os nós coletados
  nodes.forEach(node => {
    if (nodesToMove.has(node.id)) {
      if (isHorizontal) {
        node.position.y += delta
      } else {
        node.position.x += delta
      }
    }
  })
}

// ========================================
// FUNÇÃO PARA CONVERTER ÁRVORE EM NÓS/ARESTAS
// ========================================
interface BuildTreeOptions {
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  pessoaPrincipal: PessoaArvore | null
  mode: ViewMode
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
}

function buildTreeNodesAndEdges(options: BuildTreeOptions): { nodes: Node[]; edges: Edge[] } {
  const { pessoas, unioes, pessoaPrincipal, mode, onPersonClick, onAddPai, onAddMae } = options

  if (!pessoaPrincipal || pessoas.length === 0) {
    return { nodes: [], edges: [] }
  }

  const nodes: Node[] = []
  const edges: Edge[] = []
  const processedIds = new Set<number>()

  // Retorna TODAS as uniões de uma pessoa
  const findUnioes = (pessoa: PessoaArvore): UniaoArvore[] => {
    return unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  }

  // Retorna a primeira união (para compatibilidade)
  const findUniao = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
  }

  // Retorna TODOS os cônjuges de uma pessoa
  const findConjuges = (pessoa: PessoaArvore): PessoaArvore[] => {
    const unioesP = findUnioes(pessoa)
    return unioesP
      .map(u => {
        const conjugeId = u.pessoa1Id === pessoa.id ? u.pessoa2Id : u.pessoa1Id
        return pessoas.find(p => p.id === conjugeId)
      })
      .filter(Boolean) as PessoaArvore[]
  }

  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = findUniao(pessoa)
    if (!uniao) return null
    const conjugeId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
    return pessoas.find(p => p.id === conjugeId) || null
  }

  const findPai = (pessoa: PessoaArvore): PessoaArvore | null => {
    if (!pessoa.paiId) return null
    return pessoas.find(p => p.id === pessoa.paiId) || null
  }

  const findMae = (pessoa: PessoaArvore): PessoaArvore | null => {
    if (!pessoa.maeId) return null
    return pessoas.find(p => p.id === pessoa.maeId) || null
  }

  // Função para encontrar TODOS os filhos de uma pessoa
  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  // Função para encontrar irmãos de uma pessoa
  const findIrmaos = (pessoa: PessoaArvore): PessoaArvore[] => {
    const pai = findPai(pessoa)
    const mae = findMae(pessoa)
    
    if (!pai && !mae) return []
    
    return pessoas.filter(p => {
      if (p.id === pessoa.id) return false
      const mesmoPai = pai && p.paiId === pai.id
      const mesmaMae = mae && p.maeId === mae.id
      return mesmoPai || mesmaMae
    })
  }

  // Função para adicionar um nó de pessoa (sem duplicar)
  const addPersonNode = (
    pessoa: PessoaArvore,
    isMain: boolean = false,
    isSpouse: boolean = false
  ) => {
    if (processedIds.has(pessoa.id)) return false
    processedIds.add(pessoa.id)

    nodes.push({
      id: `person-${pessoa.id}`,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        pessoa,
        isMain,
        isSpouse,
        mode,
        unioes: findUnioes(pessoa),
        onPersonClick,
      },
    })
    return true
  }

  // Função para adicionar edge (sem duplicar)
  const addEdge = (
    sourceId: string,
    targetId: string,
    edgeId: string,
    color: string,
    dashed: boolean = false
  ) => {
    if (edges.find(e => e.id === edgeId)) return
    edges.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      type: 'smoothstep',
      style: { 
        stroke: color, 
        strokeWidth: 2,
        ...(dashed ? { strokeDasharray: '5,5' } : {})
      },
    })
  }

  // ========================================
  // ✅ CORRIGIDO: Função recursiva com controle de depth
  // Placeholders só aparecem na depth 0 (pessoa principal)
  // ========================================
  const addPersonWithAncestorsAndSiblings = (
    pessoa: PessoaArvore,
    isMain: boolean = false,
    isSpouse: boolean = false,
    depth: number = 0  // ✅ NOVO: controle de profundidade
  ) => {
    // Adicionar a pessoa
    const added = addPersonNode(pessoa, isMain, isSpouse)
    if (!added) return // Já foi processada

    const pai = findPai(pessoa)
    const mae = findMae(pessoa)

    // Adicionar pai e seus ancestrais
    if (pai) {
      addPersonWithAncestorsAndSiblings(pai, false, false, depth + 1)
      addEdge(`person-${pessoa.id}`, `person-${pai.id}`, `edge-pai-${pessoa.id}`, colors.neutral)
    } else if (depth === 0) {
      // ✅ CORRIGIDO: Placeholder APENAS na primeira camada (depth === 0)
      const addPaiId = `add-pai-${pessoa.id}`
      if (!nodes.find(n => n.id === addPaiId)) {
        nodes.push({
          id: addPaiId,
          type: 'addPerson',
          position: { x: 0, y: 0 },
          data: { type: 'pai' as const, mode, onClick: () => onAddPai?.(pessoa.id) },
        })
        addEdge(`person-${pessoa.id}`, addPaiId, `edge-add-pai-${pessoa.id}`, colors.neutral, true)
      }
    }

    // Adicionar mãe e seus ancestrais
    if (mae) {
      addPersonWithAncestorsAndSiblings(mae, false, false, depth + 1)
      addEdge(`person-${pessoa.id}`, `person-${mae.id}`, `edge-mae-${pessoa.id}`, colors.neutral)
    } else if (depth === 0) {
      // ✅ CORRIGIDO: Placeholder APENAS na primeira camada (depth === 0)
      const addMaeId = `add-mae-${pessoa.id}`
      if (!nodes.find(n => n.id === addMaeId)) {
        nodes.push({
          id: addMaeId,
          type: 'addPerson',
          position: { x: 0, y: 0 },
          data: { type: 'mae' as const, mode, onClick: () => onAddMae?.(pessoa.id) },
        })
        addEdge(`person-${pessoa.id}`, addMaeId, `edge-add-mae-${pessoa.id}`, colors.neutral, true)
      }
    }

    // Adicionar irmãos desta pessoa (filhos dos mesmos pais)
    const irmaos = findIrmaos(pessoa)
    irmaos.forEach(irmao => {
      if (processedIds.has(irmao.id)) return
      
      addPersonNode(irmao, false, false)
      
      // Conectar irmão a AMBOS os pais
      if (pai && irmao.paiId === pai.id) {
        addEdge(`person-${irmao.id}`, `person-${pai.id}`, `edge-irmao-pai-${irmao.id}`, colors.neutral)
      }
      if (mae && irmao.maeId === mae.id) {
        addEdge(`person-${irmao.id}`, `person-${mae.id}`, `edge-irmao-mae-${irmao.id}`, colors.neutral)
      }

      // Adicionar cônjuges do irmão (sem linha de casamento - relação implícita pelos filhos)
      const conjugesIrmao = findConjuges(irmao)
      conjugesIrmao.forEach(conjugeIrmao => {
        if (addPersonNode(conjugeIrmao, false, false)) {
          // Adicionar ancestrais do cônjuge do irmão (sem placeholders)
          addPersonWithAncestorsAndSiblings(conjugeIrmao, false, false, depth + 1)
        }
      })

      // Adicionar filhos do irmão (sobrinhos)
      addAllDescendants(irmao)
    })
  }

  // Função para adicionar TODOS os descendentes de uma pessoa
  const addAllDescendants = (pessoa: PessoaArvore) => {
    const filhos = findFilhos(pessoa)
    
    filhos.forEach(filho => {
      if (processedIds.has(filho.id)) {
        // Filho já existe, mas precisamos garantir conexão com este pai/mãe
        addEdge(`person-${filho.id}`, `person-${pessoa.id}`, `edge-filho-${filho.id}-${pessoa.id}`, colors.neutral)
        return
      }
      
      addPersonNode(filho, false, false)
      
      // Conectar filho a AMBOS os pais se existirem
      const pai = findPai(filho)
      const mae = findMae(filho)
      
      if (pai && processedIds.has(pai.id)) {
        addEdge(`person-${filho.id}`, `person-${pai.id}`, `edge-filho-${filho.id}-pai-${pai.id}`, colors.neutral)
      }
      if (mae && processedIds.has(mae.id)) {
        addEdge(`person-${filho.id}`, `person-${mae.id}`, `edge-filho-${filho.id}-mae-${mae.id}`, colors.neutral)
      }
      
      // Se nenhum dos pais foi conectado ainda, conectar ao pai/mãe atual
      if ((!pai || !processedIds.has(pai.id)) && (!mae || !processedIds.has(mae.id))) {
        addEdge(`person-${filho.id}`, `person-${pessoa.id}`, `edge-filho-${filho.id}-${pessoa.id}`, colors.neutral)
      }

      // Adicionar cônjuges do filho (sem linha de casamento - relação implícita pelos filhos)
      const conjugesFilho = findConjuges(filho)
      conjugesFilho.forEach(conjugeFilho => {
        if (addPersonNode(conjugeFilho, false, false)) {
          // Adicionar ancestrais do cônjuge (sem placeholders, depth > 0)
          addPersonWithAncestorsAndSiblings(conjugeFilho, false, false, 1)
        }
      })

      // Recursivamente adicionar descendentes
      addAllDescendants(filho)
    })
  }

  // ========================================
  // CONSTRUÇÃO DA ÁRVORE
  // ========================================

  // 1. Adicionar pessoa principal com todos os ancestrais e irmãos de ancestrais
  //    depth = 0 para mostrar placeholders apenas aqui
  addPersonWithAncestorsAndSiblings(pessoaPrincipal, true, false, 0)

  // 2. Adicionar TODOS os cônjuges da pessoa principal e suas famílias
  //    Sem linha de casamento - relação implícita pelos filhos em comum
  const conjuges = findConjuges(pessoaPrincipal)
  conjuges.forEach(conjuge => {
    // Cônjuge usa depth = 1 para NÃO mostrar placeholders
    addPersonWithAncestorsAndSiblings(conjuge, false, false, 1)
  })

  // 3. Adicionar descendentes da pessoa principal
  addAllDescendants(pessoaPrincipal)

  // 4. Garantir que TODOS os filhos de TODAS as pessoas na árvore estão incluídos
  // Fazer uma segunda passada para pegar qualquer pessoa que tenha pais já processados
  let changed = true
  let iterations = 0
  const maxIterations = 100 // Prevenir loop infinito
  
  while (changed && iterations < maxIterations) {
    changed = false
    iterations++
    
    pessoas.forEach(pessoa => {
      if (processedIds.has(pessoa.id)) return
      
      // Se o pai OU a mãe desta pessoa já está na árvore, adicionar esta pessoa também
      const paiNaArvore = pessoa.paiId && processedIds.has(pessoa.paiId)
      const maeNaArvore = pessoa.maeId && processedIds.has(pessoa.maeId)
      
      if (paiNaArvore || maeNaArvore) {
        addPersonNode(pessoa, false, false)
        changed = true
        
        // Conectar a AMBOS os pais se existirem na árvore
        if (paiNaArvore && pessoa.paiId) {
          addEdge(`person-${pessoa.id}`, `person-${pessoa.paiId}`, `edge-filho-${pessoa.id}-pai`, colors.neutral)
        }
        if (maeNaArvore && pessoa.maeId) {
          addEdge(`person-${pessoa.id}`, `person-${pessoa.maeId}`, `edge-filho-${pessoa.id}-mae`, colors.neutral)
        }
        
        // Adicionar cônjuges desta pessoa (sem linha de casamento)
        const conjugesPessoa = findConjuges(pessoa)
        conjugesPessoa.forEach(conjuge => {
          addPersonNode(conjuge, false, false)
        })
      }
    })
  }

  return { nodes, edges }
}

// ========================================
// TIPOS EXPORTADOS PARA REF
// ========================================
export interface ReactFlowTreeRef {
  centerOnPerson: (pessoaId: number) => void
}

// ========================================
// COMPONENTE PRINCIPAL: ReactFlowTree
// ========================================
interface ReactFlowTreeProps {
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  pessoaPrincipal: PessoaArvore | null
  mode: ViewMode
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
}

// Componente interno que usa useReactFlow
const ReactFlowTreeInner = forwardRef<ReactFlowTreeRef, ReactFlowTreeProps>(({
  pessoas,
  unioes,
  pessoaPrincipal,
  mode,
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge,
}, ref) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [isLocked, setIsLocked] = useState(false)
  
  // Hooks do React Flow
  const { zoomIn, zoomOut, fitView, setCenter, getNodes } = useReactFlow()

  // Refs para callbacks - evita re-renders quando callbacks mudam
  const onPersonClickRef = useRef(onPersonClick)
  const onAddPaiRef = useRef(onAddPai)
  const onAddMaeRef = useRef(onAddMae)
  const onAddFilhoRef = useRef(onAddFilho)
  const onAddConjugeRef = useRef(onAddConjuge)

  // Atualizar refs quando callbacks mudam
  useEffect(() => {
    onPersonClickRef.current = onPersonClick
    onAddPaiRef.current = onAddPai
    onAddMaeRef.current = onAddMae
    onAddFilhoRef.current = onAddFilho
    onAddConjugeRef.current = onAddConjuge
  }, [onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge])

  // Função para calcular o layout da árvore
  const calculateLayout = useCallback(() => {
    const { nodes: rawNodes, edges: rawEdges } = buildTreeNodesAndEdges({
      pessoas,
      unioes,
      pessoaPrincipal,
      mode,
      onPersonClick: (pessoa) => onPersonClickRef.current?.(pessoa),
      onAddPai: (id) => onAddPaiRef.current?.(id),
      onAddMae: (id) => onAddMaeRef.current?.(id),
      onAddFilho: (id) => onAddFilhoRef.current?.(id),
      onAddConjuge: (id) => onAddConjugeRef.current?.(id),
    })

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, mode, pessoas)

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [pessoas, unioes, pessoaPrincipal, mode])

  // Recalcular nós e arestas APENAS quando os dados mudam (não quando callbacks mudam)
  useEffect(() => {
    calculateLayout()
  }, [calculateLayout])

  // Função para resetar o layout (exposta para uso externo se necessário)
  const handleResetLayout = useCallback(() => {
    calculateLayout()
  }, [calculateLayout])

  // ========================================
  // EXPOR FUNÇÃO centerOnPerson VIA REF
  // ========================================
  useImperativeHandle(ref, () => ({
    centerOnPerson: (pessoaId: number) => {
      // Pegar todos os nós atuais
      const currentNodes = getNodes()
      const targetNode = currentNodes.find(n => n.id === `person-${pessoaId}`)
      
      if (targetNode) {
        const nodeSize = NODE_SIZES[mode]
        // Centralizar no centro do nó
        const x = targetNode.position.x + nodeSize.width / 2
        const y = targetNode.position.y + nodeSize.height / 2
        
        // Animar até o centro do nó com zoom 1
        setCenter(x, y, { zoom: 1, duration: 500 })
      }
    }
  }), [getNodes, setCenter, mode])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={2}
      attributionPosition="bottom-left"
      proOptions={{ hideAttribution: true }}
      nodesDraggable={!isLocked}
      nodesConnectable={false}
      elementsSelectable={!isLocked}
    >
      <Background color="#e0e0e0" gap={20} />
      
      {/* Controles Customizados */}
      <Panel position="bottom-left">
        <div className="flex flex-col bg-white border border-gray-200 rounded shadow-sm">
          {/* Zoom In */}
          <button
            onClick={() => zoomIn()}
            className="p-2 hover:bg-gray-100 border-b border-gray-200"
            title="Aumentar zoom"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          
          {/* Zoom Out */}
          <button
            onClick={() => zoomOut()}
            className="p-2 hover:bg-gray-100 border-b border-gray-200"
            title="Diminuir zoom"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          
          {/* Fit View */}
          <button
            onClick={() => fitView({ padding: 0.2 })}
            className="p-2 hover:bg-gray-100 border-b border-gray-200"
            title="Ajustar visualização"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
              <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
              <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
            </svg>
          </button>
          
          {/* Lock/Unlock */}
          <button
            onClick={() => setIsLocked(!isLocked)}
            className="p-2 hover:bg-gray-100 border-b border-gray-200"
            title={isLocked ? "Desbloquear movimentação" : "Bloquear movimentação"}
          >
            {isLocked ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
              </svg>
            )}
          </button>
          
          {/* Reset Layout */}
          <button
            onClick={handleResetLayout}
            className="p-2 hover:bg-gray-100"
            title="Resetar layout da árvore"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
              <path d="M21 3v5h-5"></path>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
              <path d="M3 21v-5h5"></path>
            </svg>
          </button>
        </div>
      </Panel>
      
      <MiniMap
        nodeStrokeWidth={3}
        nodeColor={(node) => {
          if (node.type === 'addPerson') return '#ddd'
          const data = node.data as PersonNodeData
          if (data?.pessoa) {
            return getGenderColors(data.pessoa.sexo).border
          }
          return '#888'
        }}
        maskColor="rgba(255, 255, 255, 0.8)"
      />
    </ReactFlow>
  )
})

ReactFlowTreeInner.displayName = 'ReactFlowTreeInner'

// Componente wrapper com Provider que passa a ref
export const ReactFlowTree = forwardRef<ReactFlowTreeRef, ReactFlowTreeProps>((props, ref) => {
  return (
    <ReactFlowProvider>
      <ReactFlowTreeInner {...props} ref={ref} />
    </ReactFlowProvider>
  )
})

ReactFlowTree.displayName = 'ReactFlowTree'