"use client"

import { useState, useEffect } from "react"
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  NodeProps,
  MarkerType,
  ConnectionLineType,
} from "reactflow"
import dagre from "dagre"
import "reactflow/dist/style.css"
import { PessoaArvore, UniaoArvore } from "./pessoa-card"

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
  uniao?: UniaoArvore | null
  onPersonClick?: (pessoa: PessoaArvore) => void
}

function PersonNode({ data }: NodeProps<PersonNodeData>) {
  const { pessoa, isMain, isSpouse, mode, uniao, onPersonClick } = data
  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  
  // Formatar datas
  const dataNasc = formatDate(pessoa.data_nasc)
  const dataObito = formatDate(pessoa.data_obito)
  const dataCasamento = formatDate(uniao?.data_inicio)
  
  // Verificar se pessoa é falecida (vivo === false)
  const isFalecido = pessoa.vivo === false

  const handleClick = () => {
    onPersonClick?.(pessoa)
  }

  // Ring para pessoa principal ou cônjuge
  const ringClass = isMain
    ? 'ring-2 ring-green-500 ring-offset-2'
    : isSpouse
      ? 'ring-2 ring-purple-400 ring-offset-1'
      : ''

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
            {/* Linha 1: Nascimento e Casamento */}
            {(dataNasc || dataCasamento) && (
              <div className="flex items-center gap-3">
                {dataNasc && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 text-center">★</span>
                    <span>{dataNasc}</span>
                  </span>
                )}
                {dataCasamento && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 text-center">♥</span>
                    <span>{dataCasamento}</span>
                  </span>
                )}
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
          {/* Linha 1: Nascimento e Casamento */}
          {(dataNasc || dataCasamento) && (
            <div className="flex items-center justify-center gap-2">
              {dataNasc && (
                <span className="inline-flex items-center gap-0.5">
                  <span>★</span>
                  <span>{dataNasc}</span>
                </span>
              )}
              {dataCasamento && (
                <span className="inline-flex items-center gap-0.5">
                  <span>♥</span>
                  <span>{dataCasamento}</span>
                </span>
              )}
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
  mode: ViewMode
) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const isHorizontal = mode === 'paisagem'
  
  dagreGraph.setGraph({
    rankdir: isHorizontal ? 'LR' : 'BT',
    nodesep: isHorizontal ? 50 : 30,
    ranksep: isHorizontal ? 80 : 60,
    marginx: 40,
    marginy: 40,
  })

  const nodeSize = NODE_SIZES[mode]

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || nodeSize.width,
      height: node.height || nodeSize.height,
    })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    const size = NODE_SIZES[mode]

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - size.width / 2,
        y: nodeWithPosition.y - size.height / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
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

  const findUniao = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
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

  // Helper para adicionar pessoa e seus ancestrais
  const addPersonWithAncestors = (
    pessoa: PessoaArvore,
    isMain: boolean = false,
    isSpouse: boolean = false,
    depth: number = 0,
    maxDepth: number = 3
  ) => {
    if (processedIds.has(pessoa.id) || depth > maxDepth) return
    processedIds.add(pessoa.id)

    const pai = findPai(pessoa)
    const mae = findMae(pessoa)
    const uniao = findUniao(pessoa)

    // Adicionar nó da pessoa (simplificado)
    nodes.push({
      id: `person-${pessoa.id}`,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        pessoa,
        isMain,
        isSpouse,
        mode,
        uniao,
        onPersonClick,
      },
    })

    // Adicionar pai
    if (pai) {
      addPersonWithAncestors(pai, false, false, depth + 1, maxDepth)
      // Cor baseada no sexo da pessoa (pai), não no tipo de relação
      const paiColor = getGenderColors(pai.sexo).border
      edges.push({
        id: `edge-pai-${pessoa.id}`,
        source: `person-${pessoa.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: paiColor, strokeWidth: 2 },
      })
    } else if (depth < maxDepth) {
      // Placeholder para adicionar pai - linha neutra
      const addPaiId = `add-pai-${pessoa.id}`
      if (!nodes.find(n => n.id === addPaiId)) {
        nodes.push({
          id: addPaiId,
          type: 'addPerson',
          position: { x: 0, y: 0 },
          data: { type: 'pai' as const, mode, onClick: () => onAddPai?.(pessoa.id) },
        })
        edges.push({
          id: `edge-add-pai-${pessoa.id}`,
          source: `person-${pessoa.id}`,
          target: addPaiId,
          type: 'smoothstep',
          style: { stroke: colors.neutral, strokeWidth: 2, strokeDasharray: '5,5' },
        })
      }
    }

    // Adicionar mãe
    if (mae) {
      addPersonWithAncestors(mae, false, false, depth + 1, maxDepth)
      // Cor baseada no sexo da pessoa (mãe), não no tipo de relação
      const maeColor = getGenderColors(mae.sexo).border
      edges.push({
        id: `edge-mae-${pessoa.id}`,
        source: `person-${pessoa.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: maeColor, strokeWidth: 2 },
      })
    } else if (depth < maxDepth) {
      // Placeholder para adicionar mãe - linha neutra
      const addMaeId = `add-mae-${pessoa.id}`
      if (!nodes.find(n => n.id === addMaeId)) {
        nodes.push({
          id: addMaeId,
          type: 'addPerson',
          position: { x: 0, y: 0 },
          data: { type: 'mae' as const, mode, onClick: () => onAddMae?.(pessoa.id) },
        })
        edges.push({
          id: `edge-add-mae-${pessoa.id}`,
          source: `person-${pessoa.id}`,
          target: addMaeId,
          type: 'smoothstep',
          style: { stroke: colors.neutral, strokeWidth: 2, strokeDasharray: '5,5' },
        })
      }
    }
  }

  // Adicionar pessoa principal com ancestrais
  addPersonWithAncestors(pessoaPrincipal, true, false, 0)

  // Adicionar cônjuge e família do cônjuge
  const conjuge = findConjuge(pessoaPrincipal)
  if (conjuge) {
    addPersonWithAncestors(conjuge, false, true, 0)

    // Conectar pessoa principal ao cônjuge - linha neutra/roxa para união
    edges.push({
      id: `edge-casamento-${pessoaPrincipal.id}-${conjuge.id}`,
      source: `person-${pessoaPrincipal.id}`,
      target: `person-${conjuge.id}`,
      type: 'smoothstep',
      style: { stroke: '#9333ea', strokeWidth: 2 },
    })
  }

  return { nodes, edges }
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

export function ReactFlowTree({
  pessoas,
  unioes,
  pessoaPrincipal,
  mode,
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge,
}: ReactFlowTreeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Recalcular nós e arestas quando os dados mudam
  useEffect(() => {
    const { nodes: rawNodes, edges: rawEdges } = buildTreeNodesAndEdges({
      pessoas,
      unioes,
      pessoaPrincipal,
      mode,
      onPersonClick,
      onAddPai,
      onAddMae,
      onAddFilho,
      onAddConjuge,
    })

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, mode)

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [pessoas, unioes, pessoaPrincipal, mode, onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge])

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
    >
      <Background color="#e0e0e0" gap={20} />
      <Controls />
      <MiniMap
        nodeStrokeWidth={3}
        nodeColor={(node) => {
          if (node.type === 'addPerson') return '#ddd'
          const data = node.data as PersonNodeData
          if (data?.pessoa) {
            if (data.isMain) return colors.green
            if (data.isSpouse) return '#9333ea'
            return getGenderColors(data.pessoa.sexo).border
          }
          return '#888'
        }}
        maskColor="rgba(255, 255, 255, 0.8)"
      />
    </ReactFlow>
  )
}