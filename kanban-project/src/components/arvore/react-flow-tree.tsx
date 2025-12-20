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
import { Plus } from "lucide-react"

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
  paisagem: { width: 200, height: 100 },
  retrato: { width: 140, height: 160 }
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
  if (!nasc && obit) return "Falecido"
  if (nasc && obit) return `${nasc}–${obit}`
  return nasc
}

function generatePID(id: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let pid = ''
  const seed = id * 12345
  for (let i = 0; i < 4; i++) {
    pid += chars[(seed * (i + 1)) % chars.length]
  }
  return `${pid.slice(0, 4)}-${pid.slice(0, 3)}`
}

// ========================================
// CUSTOM NODE: Pessoa Individual
// ========================================
interface PersonNodeData {
  pessoa: PessoaArvore
  isMain?: boolean
  isSpouse?: boolean
  mode: ViewMode
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: () => void
  onAddMae?: () => void
  hasPai?: boolean
  hasMae?: boolean
}

function PersonNode({ data }: NodeProps<PersonNodeData>) {
  const { pessoa, isMain, isSpouse, mode, onPersonClick, hasPai, hasMae, onAddPai, onAddMae } = data
  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const pid = pessoa.pid || generatePID(pessoa.id)
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const deceased = !!pessoa.data_obito

  const handleClick = () => {
    onPersonClick?.(pessoa)
  }

  // Determinar ring color baseado no tipo
  const ringClass = isMain
    ? 'ring-2 ring-green-500 ring-offset-2'
    : isSpouse
      ? 'ring-2 ring-purple-400 ring-offset-1'
      : ''

  if (mode === 'paisagem') {
    return (
      <div
        className={`person-card relative bg-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all overflow-visible ${ringClass}`}
        style={{
          width: NODE_SIZES.paisagem.width,
          height: NODE_SIZES.paisagem.height,
          borderLeft: `4px solid ${genderColors.border}`,
        }}
        onClick={handleClick}
      >
        {/* Handles para conexões - INVERTIDO para RL */}
        <Handle
          type="source"
          position={Position.Left}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />
        <Handle
          type="target"
          position={Position.Right}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />

        {/* Ícone FS */}
        <div className="absolute top-2 right-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill={colors.green} />
            <path d="M12 7v10M9 10v4M15 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <div className="p-2.5 h-full flex items-center gap-2.5">
          {/* Avatar */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg flex-shrink-0"
            style={{ backgroundColor: genderColors.border }}
          >
            {initial}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">
              {nomeCompleto}
            </h3>
            <div className="flex items-center gap-1 mt-1">
              {deceased ? (
                <span className="px-1 py-0.5 text-[8px] font-semibold rounded bg-gray-200 text-gray-600">
                  Falecido
                </span>
              ) : (
                <span
                  className="px-1 py-0.5 text-[8px] font-semibold rounded text-white"
                  style={{ backgroundColor: colors.green }}
                >
                  Vivo
                </span>
              )}
            </div>
            {dateRange && (
              <p className="text-[9px] text-gray-500 mt-0.5">{dateRange}</p>
            )}
            <span className="text-[8px] text-gray-400 font-mono">{pid}</span>
          </div>
        </div>

        {/* Botões de adicionar pai/mãe - à ESQUERDA no modo RL */}
        {!hasPai && onAddPai && (
          <button
            className="absolute -left-2 top-1/4 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md hover:bg-blue-600 transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); onAddPai(); }}
            title="Adicionar pai"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        {!hasMae && onAddMae && (
          <button
            className="absolute -left-2 bottom-1/4 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-md hover:bg-pink-600 transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); onAddMae(); }}
            title="Adicionar mãe"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>
    )
  }

  // MODO RETRATO (vertical)
  return (
    <div
      className={`person-card relative bg-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all overflow-visible ${ringClass}`}
      style={{
        width: NODE_SIZES.retrato.width,
        height: NODE_SIZES.retrato.height,
        borderTop: `4px solid ${genderColors.border}`,
      }}
      onClick={handleClick}
    >
      {/* Handles para conexões */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
      />

      {/* Ícone FS */}
      <div className="absolute top-2 right-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill={colors.green} />
          <path d="M12 7v10M9 10v4M15 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="p-2 h-full flex flex-col items-center justify-center text-center">
        {/* Avatar */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg mb-1.5"
          style={{ backgroundColor: genderColors.border }}
        >
          {initial}
        </div>

        {/* Nome */}
        <h3 className="font-bold text-gray-900 text-[10px] leading-tight line-clamp-2">
          {nomeCompleto}
        </h3>

        {/* Status */}
        <div className="flex items-center gap-1 mt-1">
          {deceased ? (
            <span className="px-1 py-0.5 text-[8px] font-semibold rounded bg-gray-200 text-gray-600">
              Falecido
            </span>
          ) : (
            <span
              className="px-1 py-0.5 text-[8px] font-semibold rounded text-white"
              style={{ backgroundColor: colors.green }}
            >
              Vivo
            </span>
          )}
        </div>
        {dateRange && (
          <p className="text-[8px] text-gray-500 mt-0.5">{dateRange}</p>
        )}
        <span className="text-[7px] text-gray-400 font-mono mt-0.5">{pid}</span>
      </div>

      {/* Botões de adicionar pai/mãe */}
      {!hasPai && onAddPai && (
        <button
          className="absolute -top-2 left-1/4 w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md hover:bg-blue-600 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onAddPai(); }}
          title="Adicionar pai"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      )}
      {!hasMae && onAddMae && (
        <button
          className="absolute -top-2 right-1/4 w-4 h-4 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-md hover:bg-pink-600 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onAddMae(); }}
          title="Adicionar mãe"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      )}
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
    pai: { label: 'ADICIONAR PAI', color: colors.male },
    mae: { label: 'ADICIONAR MÃE', color: colors.female },
    filho: { label: 'ADICIONAR FILHO(A)', color: colors.green },
    conjuge: { label: 'ADICIONAR CÔNJUGE', color: colors.neutral }
  }
  const { label, color } = config[type]

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
        style={{ width: NODE_SIZES.paisagem.width, height: NODE_SIZES.paisagem.height }}
        onClick={onClick}
      >
        <Handle type="source" position={Position.Left} className="!bg-gray-300 !w-3 !h-3" />
        <Handle type="target" position={Position.Right} className="!bg-gray-300 !w-3 !h-3" />

        <div className="h-full flex items-center gap-2 px-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-[10px] font-semibold" style={{ color }}>
            {label}
          </span>
        </div>
      </div>
    )
  }

  // RETRATO
  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
      style={{ width: NODE_SIZES.retrato.width, height: NODE_SIZES.retrato.height }}
      onClick={onClick}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-3 !h-3" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-3 !h-3" />

      <div className="h-full flex flex-col items-center justify-center text-center px-2">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
          style={{ backgroundColor: `${color}20` }}
        >
          <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <span className="text-[9px] font-semibold leading-tight" style={{ color }}>
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
  // PAISAGEM: RL (direita para esquerda) - pessoa principal à direita
  // RETRATO: TB (cima para baixo)
  dagreGraph.setGraph({
    rankdir: isHorizontal ? 'RL' : 'TB',
    nodesep: isHorizontal ? 60 : 40,
    ranksep: isHorizontal ? 100 : 80,
    marginx: 50,
    marginy: 50,
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

  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
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

    // Adicionar nó da pessoa
    nodes.push({
      id: `person-${pessoa.id}`,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        pessoa,
        isMain,
        isSpouse,
        mode,
        onPersonClick,
        hasPai: !!pai,
        hasMae: !!mae,
        onAddPai: () => onAddPai?.(pessoa.id),
        onAddMae: () => onAddMae?.(pessoa.id),
      },
    })

    // Adicionar pai
    if (pai) {
      addPersonWithAncestors(pai, false, false, depth + 1, maxDepth)
      edges.push({
        id: `edge-pai-${pessoa.id}`,
        source: `person-${pessoa.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: colors.male, strokeWidth: 2 },
      })
    } else if (depth < maxDepth) {
      // Placeholder para adicionar pai
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
          style: { stroke: colors.male, strokeWidth: 2, strokeDasharray: '5,5' },
        })
      }
    }

    // Adicionar mãe
    if (mae) {
      addPersonWithAncestors(mae, false, false, depth + 1, maxDepth)
      edges.push({
        id: `edge-mae-${pessoa.id}`,
        source: `person-${pessoa.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: colors.female, strokeWidth: 2 },
      })
    } else if (depth < maxDepth) {
      // Placeholder para adicionar mãe
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
          style: { stroke: colors.female, strokeWidth: 2, strokeDasharray: '5,5' },
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

    // Conectar pessoa principal ao cônjuge com linha especial
    edges.push({
      id: `edge-casamento-${pessoaPrincipal.id}-${conjuge.id}`,
      source: `person-${pessoaPrincipal.id}`,
      target: `person-${conjuge.id}`,
      type: 'smoothstep',
      style: { stroke: colors.green, strokeWidth: 3 },
      label: '♥',
      labelStyle: { fontSize: 14, fill: colors.green },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
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
            if (data.isSpouse) return '#9333ea' // purple
            return getGenderColors(data.pessoa.sexo).border
          }
          return '#888'
        }}
        maskColor="rgba(255, 255, 255, 0.8)"
      />
    </ReactFlow>
  )
}
