"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
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
  Panel,
} from "reactflow"
import dagre from "dagre"
import "reactflow/dist/style.css"
import { PessoaArvore, UniaoArvore } from "./pessoa-card"
import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus } from "lucide-react"

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
  paisagem: { width: 220, height: 120 },
  retrato: { width: 160, height: 180 }
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
  mode: ViewMode
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: () => void
  onAddMae?: () => void
  onAddConjuge?: () => void
  hasParents?: boolean
  hasPai?: boolean
  hasMae?: boolean
}

function PersonNode({ data, id }: NodeProps<PersonNodeData>) {
  const { pessoa, isMain, mode, onPersonClick, hasParents, hasPai, hasMae, onAddPai, onAddMae, onAddConjuge } = data
  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const pid = pessoa.pid || generatePID(pessoa.id)
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const deceased = !!pessoa.data_obito

  const handleClick = () => {
    onPersonClick?.(pessoa)
  }

  if (mode === 'paisagem') {
    return (
      <div
        className={`person-card relative bg-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all overflow-visible ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
        style={{
          width: NODE_SIZES.paisagem.width,
          height: NODE_SIZES.paisagem.height,
          borderLeft: `4px solid ${genderColors.border}`,
        }}
        onClick={handleClick}
      >
        {/* Handles para conexões */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />

        {/* Ícone FS */}
        <div className="absolute top-2 right-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill={colors.green} />
            <path d="M12 7v10M9 10v4M15 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <div className="p-3 h-full flex items-center gap-3">
          {/* Avatar */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-white text-xl flex-shrink-0"
            style={{ backgroundColor: genderColors.border }}
          >
            {initial}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">
              {nomeCompleto}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              {deceased ? (
                <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-200 text-gray-600">
                  Falecido
                </span>
              ) : (
                <span
                  className="px-1.5 py-0.5 text-[9px] font-semibold rounded text-white"
                  style={{ backgroundColor: colors.green }}
                >
                  Vivo
                </span>
              )}
              <span className="text-[9px] text-gray-400 font-mono">{pid}</span>
            </div>
            {dateRange && (
              <p className="text-[10px] text-gray-500 mt-0.5">{dateRange}</p>
            )}
          </div>
        </div>

        {/* Botões de adicionar pai/mãe se não tiver */}
        {!hasPai && onAddPai && (
          <button
            className="absolute -right-2 top-1/4 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md hover:bg-blue-600 transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); onAddPai(); }}
            title="Adicionar pai"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        {!hasMae && onAddMae && (
          <button
            className="absolute -right-2 bottom-1/4 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-md hover:bg-pink-600 transition-colors z-10"
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
      className={`person-card relative bg-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all overflow-visible ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill={colors.green} />
          <path d="M12 7v10M9 10v4M15 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="p-3 h-full flex flex-col items-center justify-center text-center">
        {/* Avatar */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-white text-xl mb-2"
          style={{ backgroundColor: genderColors.border }}
        >
          {initial}
        </div>

        {/* Nome */}
        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">
          {nomeCompleto}
        </h3>

        {/* Status + PID */}
        <div className="flex items-center gap-1 mt-1.5">
          {deceased ? (
            <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-200 text-gray-600">
              Falecido
            </span>
          ) : (
            <span
              className="px-1.5 py-0.5 text-[9px] font-semibold rounded text-white"
              style={{ backgroundColor: colors.green }}
            >
              Vivo
            </span>
          )}
        </div>
        <span className="text-[9px] text-gray-400 font-mono mt-0.5">{pid}</span>

        {/* Datas */}
        {dateRange && (
          <p className="text-[10px] text-gray-500 mt-0.5">{dateRange}</p>
        )}
      </div>

      {/* Botões de adicionar pai/mãe se não tiver */}
      {!hasPai && onAddPai && (
        <button
          className="absolute -top-2 left-1/4 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-md hover:bg-blue-600 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onAddPai(); }}
          title="Adicionar pai"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
      {!hasMae && onAddMae && (
        <button
          className="absolute -top-2 right-1/4 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-md hover:bg-pink-600 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onAddMae(); }}
          title="Adicionar mãe"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

// ========================================
// CUSTOM NODE: Casal (Pessoa + Cônjuge)
// ========================================
interface CoupleNodeData {
  pessoa1: PessoaArvore
  pessoa2?: PessoaArvore | null
  isMain?: boolean
  mode: ViewMode
  filhos?: PessoaArvore[]
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddConjuge?: () => void
  onAddFilho?: () => void
}

function CoupleNode({ data, id }: NodeProps<CoupleNodeData>) {
  const { pessoa1, pessoa2, isMain, mode, filhos = [], onPersonClick, onAddConjuge, onAddFilho } = data
  const [showFilhos, setShowFilhos] = useState(false)

  // Ordenar: homem primeiro
  const isMale = (p: PessoaArvore) => p.sexo?.toLowerCase() === 'masculino' || p.sexo?.toLowerCase() === 'm'
  let marido: PessoaArvore | null = null
  let esposa: PessoaArvore | null = null

  if (pessoa2) {
    if (isMale(pessoa1)) {
      marido = pessoa1
      esposa = pessoa2
    } else {
      esposa = pessoa1
      marido = pessoa2
    }
  } else {
    if (isMale(pessoa1)) {
      marido = pessoa1
    } else {
      esposa = pessoa1
    }
  }

  const renderMiniCard = (pessoa: PessoaArvore | null, isPlaceholder = false) => {
    if (!pessoa && isPlaceholder) {
      return (
        <div
          className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors border border-dashed border-gray-300"
          onClick={(e) => { e.stopPropagation(); onAddConjuge?.(); }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100">
            <Plus className="w-4 h-4 text-gray-400" />
          </div>
          <span className="text-[10px] font-semibold text-gray-500">
            ADICIONAR CÔNJUGE
          </span>
        </div>
      )
    }

    if (!pessoa) return null

    const genderColors = getGenderColors(pessoa.sexo)
    const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
    const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
    const deceased = !!pessoa.data_obito

    return (
      <div
        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors"
        onClick={(e) => { e.stopPropagation(); onPersonClick?.(pessoa); }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
          style={{ backgroundColor: genderColors.border }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 text-xs leading-tight truncate">
            {nomeCompleto}
          </h4>
          <div className="flex items-center gap-1 mt-0.5">
            {deceased ? (
              <span className="text-[8px] text-gray-500">Falecido</span>
            ) : (
              <span className="text-[8px] text-green-600 flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Vivo
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'paisagem') {
    return (
      <div
        className={`relative bg-white rounded-xl shadow-lg overflow-visible ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
        style={{ minWidth: 200 }}
      >
        {/* Handles */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white"
        />

        {/* Marido */}
        {marido && renderMiniCard(marido)}
        {!marido && esposa && renderMiniCard(null, !pessoa2)}

        {/* Divisor */}
        {(marido || esposa) && <div className="border-t border-gray-100" />}

        {/* Esposa */}
        {esposa && marido && renderMiniCard(esposa)}
        {!esposa && marido && renderMiniCard(null, !pessoa2)}
        {esposa && !marido && renderMiniCard(esposa)}

        {/* Dropdown Filhos */}
        <div className="border-t border-gray-200">
          <button
            className="w-full px-3 py-2 flex items-center justify-between text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            onClick={(e) => { e.stopPropagation(); setShowFilhos(!showFilhos); }}
          >
            <span>Filhos ({filhos.length})</span>
            {showFilhos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showFilhos && (
            <div className="border-t border-gray-100 bg-gray-50 max-h-40 overflow-y-auto">
              {filhos.map(filho => (
                <div
                  key={filho.id}
                  className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onPersonClick?.(filho); }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-xs"
                    style={{ backgroundColor: getGenderColors(filho.sexo).border }}
                  >
                    {filho.nome?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <span className="text-xs text-gray-700 truncate">
                    {filho.sobrenome ? `${filho.nome} ${filho.sobrenome}` : filho.nome}
                  </span>
                </div>
              ))}
              <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={(e) => { e.stopPropagation(); onAddFilho?.(); }}
              >
                <div className="w-6 h-6 rounded-full flex items-center justify-center bg-green-100">
                  <Plus className="w-3 h-3 text-green-600" />
                </div>
                <span className="text-xs text-green-600 font-semibold">
                  Adicionar filho(a)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // MODO RETRATO
  return (
    <div
      className={`relative bg-white rounded-xl shadow-lg overflow-visible ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
      style={{ minWidth: 280 }}
    >
      {/* Handles */}
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

      {/* Duas pessoas lado a lado */}
      <div className="flex">
        <div className="flex-1 border-r border-gray-100">
          {marido ? renderMiniCard(marido) : (esposa ? renderMiniCard(esposa) : null)}
        </div>
        <div className="flex-1">
          {esposa && marido ? renderMiniCard(esposa) : renderMiniCard(null, !pessoa2)}
        </div>
      </div>

      {/* Dropdown Filhos */}
      <div className="border-t border-gray-200">
        <button
          className="w-full px-3 py-2 flex items-center justify-between text-xs text-gray-600 hover:bg-gray-50 transition-colors"
          onClick={(e) => { e.stopPropagation(); setShowFilhos(!showFilhos); }}
        >
          <span>Filhos ({filhos.length})</span>
          {showFilhos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showFilhos && (
          <div className="border-t border-gray-100 bg-gray-50 max-h-40 overflow-y-auto">
            {filhos.map(filho => (
              <div
                key={filho.id}
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={(e) => { e.stopPropagation(); onPersonClick?.(filho); }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-xs"
                  style={{ backgroundColor: getGenderColors(filho.sexo).border }}
                >
                  {filho.nome?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="text-xs text-gray-700 truncate">
                  {filho.sobrenome ? `${filho.nome} ${filho.sobrenome}` : filho.nome}
                </span>
              </div>
            ))}
            <div
              className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
              onClick={(e) => { e.stopPropagation(); onAddFilho?.(); }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center bg-green-100">
                <Plus className="w-3 h-3 text-green-600" />
              </div>
              <span className="text-xs text-green-600 font-semibold">
                Adicionar filho(a)
              </span>
            </div>
          </div>
        )}
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
    pai: { label: 'ACRESCENTAR PAI', color: colors.male },
    mae: { label: 'ACRESCENTAR MÃE', color: colors.female },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green },
    conjuge: { label: 'ACRESCENTAR CÔNJUGE', color: colors.neutral }
  }
  const { label, color } = config[type]

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
        style={{ width: NODE_SIZES.paisagem.width, height: NODE_SIZES.paisagem.height }}
        onClick={onClick}
      >
        <Handle type="target" position={Position.Left} className="!bg-gray-300 !w-3 !h-3" />
        <Handle type="source" position={Position.Right} className="!bg-gray-300 !w-3 !h-3" />

        <div className="h-full flex items-center gap-3 px-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${color}20` }}
          >
            <svg className="w-6 h-6" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-xs font-semibold" style={{ color }}>
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
          className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
          style={{ backgroundColor: `${color}20` }}
        >
          <svg className="w-6 h-6" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <span className="text-[10px] font-semibold leading-tight" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  )
}

// Tipos de nós customizados
const nodeTypes = {
  person: PersonNode,
  couple: CoupleNode,
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
    rankdir: isHorizontal ? 'LR' : 'TB',
    nodesep: isHorizontal ? 80 : 60,
    ranksep: isHorizontal ? 120 : 100,
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
  const { pessoas, unioes, pessoaPrincipal, mode, onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge } = options

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

  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  // Adicionar pessoa principal com cônjuge como CoupleNode
  const conjuge = findConjuge(pessoaPrincipal)
  const filhosPrincipal = findFilhos(pessoaPrincipal)

  nodes.push({
    id: `couple-${pessoaPrincipal.id}`,
    type: 'couple',
    position: { x: 0, y: 0 },
    data: {
      pessoa1: pessoaPrincipal,
      pessoa2: conjuge,
      isMain: true,
      mode,
      filhos: filhosPrincipal,
      onPersonClick,
      onAddConjuge: () => onAddConjuge?.(pessoaPrincipal.id),
      onAddFilho: () => onAddFilho?.(pessoaPrincipal.id),
    },
  })
  processedIds.add(pessoaPrincipal.id)
  if (conjuge) processedIds.add(conjuge.id)

  // Adicionar pais da pessoa principal
  const pai = findPai(pessoaPrincipal)
  const mae = findMae(pessoaPrincipal)

  if (pai) {
    const conjugePai = findConjuge(pai)
    const hasMae = !!mae

    nodes.push({
      id: `person-${pai.id}`,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        pessoa: pai,
        mode,
        onPersonClick,
        hasPai: !!findPai(pai),
        hasMae: !!findMae(pai),
        onAddPai: () => onAddPai?.(pai.id),
        onAddMae: () => onAddMae?.(pai.id),
      },
    })
    processedIds.add(pai.id)

    edges.push({
      id: `edge-pai-${pai.id}`,
      source: `person-${pai.id}`,
      target: `couple-${pessoaPrincipal.id}`,
      type: 'smoothstep',
      style: { stroke: colors.line, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: colors.line },
    })

    // Avós paternos
    const avoPai = findPai(pai)
    const avoPaiMae = findMae(pai)

    if (avoPai) {
      nodes.push({
        id: `person-${avoPai.id}`,
        type: 'person',
        position: { x: 0, y: 0 },
        data: { pessoa: avoPai, mode, onPersonClick },
      })
      edges.push({
        id: `edge-avo-pai-${avoPai.id}`,
        source: `person-${avoPai.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2 },
      })
      processedIds.add(avoPai.id)
    } else {
      nodes.push({
        id: `add-pai-${pai.id}`,
        type: 'addPerson',
        position: { x: 0, y: 0 },
        data: { type: 'pai' as const, mode, onClick: () => onAddPai?.(pai.id) },
      })
      edges.push({
        id: `edge-add-pai-${pai.id}`,
        source: `add-pai-${pai.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
      })
    }

    if (avoPaiMae) {
      nodes.push({
        id: `person-${avoPaiMae.id}`,
        type: 'person',
        position: { x: 0, y: 0 },
        data: { pessoa: avoPaiMae, mode, onPersonClick },
      })
      edges.push({
        id: `edge-avo-mae-pai-${avoPaiMae.id}`,
        source: `person-${avoPaiMae.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2 },
      })
      processedIds.add(avoPaiMae.id)
    } else {
      nodes.push({
        id: `add-mae-${pai.id}`,
        type: 'addPerson',
        position: { x: 0, y: 0 },
        data: { type: 'mae' as const, mode, onClick: () => onAddMae?.(pai.id) },
      })
      edges.push({
        id: `edge-add-mae-${pai.id}`,
        source: `add-mae-${pai.id}`,
        target: `person-${pai.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
      })
    }
  } else {
    // Placeholder para adicionar pai
    nodes.push({
      id: `add-pai-principal`,
      type: 'addPerson',
      position: { x: 0, y: 0 },
      data: { type: 'pai' as const, mode, onClick: () => onAddPai?.(pessoaPrincipal.id) },
    })
    edges.push({
      id: `edge-add-pai-principal`,
      source: `add-pai-principal`,
      target: `couple-${pessoaPrincipal.id}`,
      type: 'smoothstep',
      style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
    })
  }

  if (mae) {
    nodes.push({
      id: `person-${mae.id}`,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        pessoa: mae,
        mode,
        onPersonClick,
        hasPai: !!findPai(mae),
        hasMae: !!findMae(mae),
        onAddPai: () => onAddPai?.(mae.id),
        onAddMae: () => onAddMae?.(mae.id),
      },
    })
    processedIds.add(mae.id)

    edges.push({
      id: `edge-mae-${mae.id}`,
      source: `person-${mae.id}`,
      target: `couple-${pessoaPrincipal.id}`,
      type: 'smoothstep',
      style: { stroke: colors.line, strokeWidth: 2 },
    })

    // Avós maternos
    const avoMae = findPai(mae)
    const avoMaeMae = findMae(mae)

    if (avoMae) {
      nodes.push({
        id: `person-${avoMae.id}`,
        type: 'person',
        position: { x: 0, y: 0 },
        data: { pessoa: avoMae, mode, onPersonClick },
      })
      edges.push({
        id: `edge-avo-pai-mae-${avoMae.id}`,
        source: `person-${avoMae.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2 },
      })
      processedIds.add(avoMae.id)
    } else {
      nodes.push({
        id: `add-pai-mae-${mae.id}`,
        type: 'addPerson',
        position: { x: 0, y: 0 },
        data: { type: 'pai' as const, mode, onClick: () => onAddPai?.(mae.id) },
      })
      edges.push({
        id: `edge-add-pai-mae-${mae.id}`,
        source: `add-pai-mae-${mae.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
      })
    }

    if (avoMaeMae) {
      nodes.push({
        id: `person-${avoMaeMae.id}`,
        type: 'person',
        position: { x: 0, y: 0 },
        data: { pessoa: avoMaeMae, mode, onPersonClick },
      })
      edges.push({
        id: `edge-avo-mae-mae-${avoMaeMae.id}`,
        source: `person-${avoMaeMae.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2 },
      })
      processedIds.add(avoMaeMae.id)
    } else {
      nodes.push({
        id: `add-mae-mae-${mae.id}`,
        type: 'addPerson',
        position: { x: 0, y: 0 },
        data: { type: 'mae' as const, mode, onClick: () => onAddMae?.(mae.id) },
      })
      edges.push({
        id: `edge-add-mae-mae-${mae.id}`,
        source: `add-mae-mae-${mae.id}`,
        target: `person-${mae.id}`,
        type: 'smoothstep',
        style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
      })
    }
  } else {
    // Placeholder para adicionar mãe
    nodes.push({
      id: `add-mae-principal`,
      type: 'addPerson',
      position: { x: 0, y: 0 },
      data: { type: 'mae' as const, mode, onClick: () => onAddMae?.(pessoaPrincipal.id) },
    })
    edges.push({
      id: `edge-add-mae-principal`,
      source: `add-mae-principal`,
      target: `couple-${pessoaPrincipal.id}`,
      type: 'smoothstep',
      style: { stroke: colors.line, strokeWidth: 2, strokeDasharray: '5,5' },
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
          if (node.type === 'couple') return colors.green
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
}
