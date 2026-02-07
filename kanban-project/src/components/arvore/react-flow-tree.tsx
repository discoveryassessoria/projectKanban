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
  line: '#9CA3AF',
  marriage: '#9333EA' // Roxo para linha de casamento
}

type ViewMode = 'paisagem' | 'retrato'

// Tamanhos dos nós
const NODE_SIZES = {
  paisagem: { width: 240, height: 90 },
  retrato: { width: 160, height: 120 }
}

// ========================================
// COMPONENTE: Indicador de Documento
// ========================================
interface DocumentoIndicadorProps {
  tipo: 'N' | 'C' | 'O'
  label: string
  status: 'em_busca' | 'solicitar' | 'solicitado' | 'recebido' | null // null = não mostrar
  mode: ViewMode
}

function DocumentoIndicador({ tipo, label, status, mode }: DocumentoIndicadorProps) {
  // Não mostrar se não tem status relevante
  if (!status) return null
  
  // ✅ ATUALIZADO: Verde = Recebido, Vermelho = Solicitar ou Solicitado, Azul = Em busca
  const colorMap: Record<string, string> = {
    'em_busca': '#EF4444',   // Vermelho
    'solicitar': '#F59E0B',  // Amarelo
    'solicitado': '#22C55E', // Verde
    'recebido': '#3B82F6',   // Azul
  }
  const labelMap: Record<string, string> = {
    'em_busca': 'Em busca',
    'solicitar': 'Solicitar',
    'solicitado': 'Solicitado',
    'recebido': 'Recebido',
  }
  const bgColor = colorMap[status] || '#EF4444'
  const statusText = labelMap[status] || status
  
  // Tooltip posição diferente para cada modo
  const tooltipClass = mode === 'paisagem' 
    ? "absolute bottom-full mb-1 left-1/2 -translate-x-1/2"  // Acima no modo paisagem
    : "absolute left-full ml-1 top-1/2 -translate-y-1/2"     // À direita no modo retrato
  
  return (
    <div className="group/doctip relative">
      <div
        className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm"
        style={{ backgroundColor: bgColor }}
      >
        {tipo}
      </div>
      {/* Tooltip */}
      <div className={`${tooltipClass} px-1.5 py-0.5 bg-gray-900 text-white text-[9px] rounded whitespace-nowrap opacity-0 invisible group-hover/doctip:opacity-100 group-hover/doctip:visible transition-all z-[100] pointer-events-none`}>
        {label}: {statusText}
      </div>
    </div>
  )
}

// Função para verificar documentos de uma pessoa
function getDocumentosStatus(pessoa: PessoaArvore, temConjuge: boolean) {
  const documentos = pessoa.documentos || []
  const falecido = pessoa.vivo === false || !!pessoa.data_obito
  
  // ✅ ATUALIZADO: Status que fazem o círculo aparecer (agora inclui em_busca)
  const statusVisiveis = ['em_busca', 'solicitar', 'solicitado', 'recebido']
  
  const verificarDocumento = (tipo: string): 'em_busca' | 'solicitar' | 'solicitado' | 'recebido' | null => {
    // ✅ CORRIGIDO: Usar includes() ao invés de ===
    const doc = documentos.find(d => d.tipo?.toUpperCase().includes(tipo))
    if (!doc) return null
    
    const statusLower = doc.status?.toLowerCase()
    if (statusVisiveis.includes(statusLower || '')) {
      return statusLower as 'em_busca' | 'solicitar' | 'solicitado' | 'recebido'
    }
    return null // Pendente ou sem status = não mostrar
  }
  
  return {
    nascimento: verificarDocumento('NASCIMENTO'),
    casamento: verificarDocumento('CASAMENTO'),
    obito: verificarDocumento('OBITO'),
    temConjuge,
    falecido
  }
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

  // Verificar se é requerente
  const requerente = (pessoa as any).requerente
  const isRequerente = requerente === 'maior' || requerente === 'menor'
  const requerenteLabel = requerente === 'maior' 
    ? 'Requerente maior de idade' 
    : requerente === 'menor' 
      ? 'Requerente menor de idade' 
      : null

  // Verificar se tem cônjuge
  const temConjuge = unioes.length > 0

  // Status dos documentos
  const docStatus = getDocumentosStatus(pessoa, temConjuge)

  const handleClick = () => {
    onPersonClick?.(pessoa)
  }

  // Sem destaque especial para nenhum card
  const ringClass = ''

  // Verificar se tem algum indicador para mostrar
  const temIndicadores = docStatus.nascimento || 
    (docStatus.temConjuge && docStatus.casamento) || 
    (docStatus.falecido && docStatus.obito)

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
        {/* Handles para linha de casamento (invisíveis) */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="marriage-out"
          className="!opacity-0 !w-1 !h-1"
        />
        <Handle
          type="target"
          position={Position.Top}
          id="marriage-in"
          className="!opacity-0 !w-1 !h-1"
        />

        {/* ✅ Indicadores de documentos - EMBAIXO do card (metade dentro/metade fora) */}
        {temIndicadores && (
          <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 flex flex-row gap-1 z-10">
            <DocumentoIndicador 
              tipo="N" 
              label="Nascimento"
              status={docStatus.nascimento}
              mode={mode}
            />
            {docStatus.temConjuge && (
              <DocumentoIndicador 
                tipo="C" 
                label="Casamento"
                status={docStatus.casamento}
                mode={mode}
              />
            )}
            {docStatus.falecido && (
              <DocumentoIndicador 
                tipo="O" 
                label="Óbito"
                status={docStatus.obito}
                mode={mode}
              />
            )}
          </div>
        )}

        <div className="p-2 h-full flex flex-col justify-center">
          <h3 
            className="font-semibold text-gray-900 text-[11px] leading-tight"
            style={{ 
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word'
            }}
          >
            {nomeCompleto}
          </h3>
          {/* Badge de Requerente */}
            {isRequerente && (
              <span className={`inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded text-[8px] font-semibold w-fit ${
                requerente === 'maior' 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-amber-100 text-amber-800'
                  }`}>
                {requerenteLabel}
              </span>
            )}
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
      {/* Handles para linha de casamento (invisíveis) */}
      <Handle
        type="source"
        position={Position.Right}
        id="marriage-out"
        className="!opacity-0 !w-1 !h-1"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="marriage-in"
        className="!opacity-0 !w-1 !h-1"
      />

      {/* ✅ Indicadores de documentos - LATERAL ESQUERDA (metade dentro/metade fora) */}
      {temIndicadores && (
        <div className="absolute -left-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 z-10">
          <DocumentoIndicador 
            tipo="N" 
            label="Nascimento"
            status={docStatus.nascimento}
            mode={mode}
          />
          {docStatus.temConjuge && (
            <DocumentoIndicador 
              tipo="C" 
              label="Casamento"
              status={docStatus.casamento}
              mode={mode}
            />
          )}
          {docStatus.falecido && (
            <DocumentoIndicador 
              tipo="O" 
              label="Óbito"
              status={docStatus.obito}
              mode={mode}
            />
          )}
        </div>
      )}

      <div className="p-2 h-full flex flex-col items-center justify-center text-center">
        <h3 
          className="font-semibold text-gray-900 text-[11px] leading-tight"
          style={{ 
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word'
          }}
        >
          {nomeCompleto}
        </h3>
        {/* Badge de Requerente */}
          {isRequerente && (
            <span className={`inline-flex items-center mt-0.5 px-1 py-0.5 rounded text-[7px] font-semibold ${
              requerente === 'maior' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-amber-100 text-amber-800'
                }`}>
              {requerenteLabel}
            </span>
          )}
        <div className="mt-0.5 text-[9px] text-gray-500 space-y-0">
          {/* Linha 1: Nascimento e Casamentos */}
          {(dataNasc || datasCasamento.length > 0) && (
            <div className="flex items-center justify-center gap-1 flex-wrap">
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
  pessoas?: PessoaArvore[],
  unioes?: UniaoArvore[]  // Receber uniões para incluir casais sem filhos
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

  // Identificar casais (pessoas que compartilham filhos OU têm união registrada)
  const casais = new Map<string, { pessoa1Id: number; pessoa2Id: number }>()
  
  // Primeiro adicionar casais das uniões (inclui casais sem filhos)
  if (unioes) {
    unioes.forEach(uniao => {
      // Verificar se ambos os IDs existem
      if (uniao.pessoa1Id == null || uniao.pessoa2Id == null) return
      
      const pairKey = `${Math.min(uniao.pessoa1Id, uniao.pessoa2Id)}-${Math.max(uniao.pessoa1Id, uniao.pessoa2Id)}`
      if (!casais.has(pairKey)) {
        casais.set(pairKey, { pessoa1Id: uniao.pessoa1Id, pessoa2Id: uniao.pessoa2Id })
      }
    })
  }
  
  // Depois adicionar casais que compartilham filhos (pode sobrepor, Map evita duplicatas)
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

  // Adicionar todas as edges ao Dagre (exceto edges de casamento visuais)
  edges.forEach((edge) => {
    if (!edge.id.startsWith('edge-marriage-')) {
      dagreGraph.setEdge(edge.source, edge.target)
    }
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
    // ========================================
    // PASSADA ZERO: Posicionar cônjuge ao lado do parceiro
    // ========================================
    casais.forEach(({ pessoa1Id, pessoa2Id }) => {
      const node1 = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const node2 = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!node1 || !node2) return
      
      const temFilhos = pessoas.some(p => 
        (p.paiId === pessoa1Id && p.maeId === pessoa2Id) ||
        (p.paiId === pessoa2Id && p.maeId === pessoa1Id)
      )
      
      if (isHorizontal) {
        if (!temFilhos) {
          node2.position.x = node1.position.x
          node2.position.y = node1.position.y + nodeSize.height + 15
        } else {
          const avgX = (node1.position.x + node2.position.x) / 2
          node1.position.x = avgX
          node2.position.x = avgX
        }
      } else {
        if (!temFilhos) {
          node2.position.y = node1.position.y
          node2.position.x = node1.position.x + nodeSize.width + 20
        } else {
          const avgY = (node1.position.y + node2.position.y) / 2
          node1.position.y = avgY
          node2.position.y = avgY
        }
      }
    })
    
    const casaisOrdenados = Array.from(casais.values()).sort((a, b) => {
      const nodeA1 = layoutedNodes.find(n => n.id === `person-${a.pessoa1Id}`)
      const nodeB1 = layoutedNodes.find(n => n.id === `person-${b.pessoa1Id}`)
      if (!nodeA1 || !nodeB1) return 0
      
      if (isHorizontal) {
        return nodeA1.position.x - nodeB1.position.x
      } else {
        return nodeB1.position.y - nodeA1.position.y
      }
    })

    casaisOrdenados.forEach(({ pessoa1Id, pessoa2Id }) => {
      const node1 = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const node2 = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!node1 || !node2) return

      if (isHorizontal) {
        const avgX = (node1.position.x + node2.position.x) / 2
        const spacing = nodeSize.height + 15
        
        node1.position.x = avgX
        node2.position.x = avgX
        
        const avgY = (node1.position.y + node2.position.y) / 2
        node1.position.y = avgY - spacing / 2
        node2.position.y = avgY + spacing / 2
      } else {
        const avgY = (node1.position.y + node2.position.y) / 2
        const spacing = nodeSize.width + 20
        
        node1.position.y = avgY
        node2.position.y = avgY
        
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

    // SEGUNDA PASSADA: Resolver sobreposições
    const nodesByLevel = new Map<number, Node[]>()
    const levelTolerance = isHorizontal ? nodeSize.width / 2 : nodeSize.height / 2
    
    layoutedNodes.forEach(node => {
      const position = isHorizontal ? node.position.x : node.position.y
      
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

    nodesByLevel.forEach((nodesInLevel) => {
      if (nodesInLevel.length <= 1) return

      if (isHorizontal) {
        nodesInLevel.sort((a, b) => a.position.y - b.position.y)
      } else {
        nodesInLevel.sort((a, b) => a.position.x - b.position.x)
      }

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
              const pessoaId = parseInt(currNode.id.replace('person-', ''))
              if (!isNaN(pessoaId)) {
                moverPessoaEDescendentes(layoutedNodes, pessoaId, overlap, pessoas, casais, isHorizontal)
              } else {
                currNode.position.x += overlap
              }
            }
          }
        }
        
        if (isHorizontal) {
          nodesInLevel.sort((a, b) => a.position.y - b.position.y)
        } else {
          nodesInLevel.sort((a, b) => a.position.x - b.position.x)
        }
      }
    })

    // TERCEIRA PASSADA: Centralizar filhos sob os pais
    casaisOrdenados.forEach(({ pessoa1Id, pessoa2Id }) => {
      const nodePai = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const nodeMae = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!nodePai || !nodeMae) return

      const filhos = pessoas.filter(p => 
        (p.paiId === pessoa1Id && p.maeId === pessoa2Id) ||
        (p.paiId === pessoa2Id && p.maeId === pessoa1Id)
      )

      if (filhos.length === 0) return

      const nodosFilhos = filhos
        .map(f => layoutedNodes.find(n => n.id === `person-${f.id}`))
        .filter(Boolean) as Node[]

      if (nodosFilhos.length === 0) return

      const centroPaisX = (nodePai.position.x + nodeMae.position.x + nodeSize.width) / 2
      const centroPaisY = (nodePai.position.y + nodeMae.position.y + nodeSize.height) / 2

      const minFilhoX = Math.min(...nodosFilhos.map(n => n.position.x))
      const maxFilhoX = Math.max(...nodosFilhos.map(n => n.position.x + nodeSize.width))
      const centroFilhosX = (minFilhoX + maxFilhoX) / 2

      if (!isHorizontal) {
        const deltaX = centroPaisX - centroFilhosX
        
        nodosFilhos.forEach(nodoFilho => {
          const pessoaId = parseInt(nodoFilho.id.replace('person-', ''))
          moverPessoaEDescendentes(layoutedNodes, pessoaId, deltaX, pessoas, casais, isHorizontal)
        })
      }
    })

    // QUARTA PASSADA: Verificação GLOBAL de sobreposições
    const moverComConjuge = (node: Node, deltaX: number, deltaY: number) => {
      node.position.x += deltaX
      node.position.y += deltaY
      
      const pessoaId = parseInt(node.id.replace('person-', ''))
      if (!isNaN(pessoaId)) {
        casais.forEach((casal) => {
          let conjugeId: number | null = null
          if (casal.pessoa1Id === pessoaId) conjugeId = casal.pessoa2Id
          if (casal.pessoa2Id === pessoaId) conjugeId = casal.pessoa1Id
          
          if (conjugeId !== null) {
            const conjugeNode = layoutedNodes.find(n => n.id === `person-${conjugeId}`)
            if (conjugeNode) {
              conjugeNode.position.x += deltaX
              conjugeNode.position.y += deltaY
            }
          }
        })
      }
    }
    
    for (let pass = 0; pass < 10; pass++) {
      let hasOverlap = false
      
      for (let i = 0; i < layoutedNodes.length; i++) {
        for (let j = i + 1; j < layoutedNodes.length; j++) {
          const nodeA = layoutedNodes[i]
          const nodeB = layoutedNodes[j]
          
          const idA = parseInt(nodeA.id.replace('person-', ''))
          const idB = parseInt(nodeB.id.replace('person-', ''))
          if (!isNaN(idA) && !isNaN(idB)) {
            const pairKey = `${Math.min(idA, idB)}-${Math.max(idA, idB)}`
            if (casais.has(pairKey)) continue
          }
          
          const aLeft = nodeA.position.x
          const aRight = nodeA.position.x + nodeSize.width
          const aTop = nodeA.position.y
          const aBottom = nodeA.position.y + nodeSize.height
          
          const bLeft = nodeB.position.x
          const bRight = nodeB.position.x + nodeSize.width
          const bTop = nodeB.position.y
          const bBottom = nodeB.position.y + nodeSize.height
          
          const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft)
          const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)
          
          if (overlapX > 0 && overlapY > 0) {
            hasOverlap = true
            
            const sameLevelY = Math.abs(nodeA.position.y - nodeB.position.y) < nodeSize.height
            
            if (isHorizontal) {
              const moveAmount = overlapY + 20
              if (nodeA.position.y < nodeB.position.y) {
                moverComConjuge(nodeB, 0, moveAmount)
              } else {
                moverComConjuge(nodeA, 0, moveAmount)
              }
            } else {
              if (sameLevelY) {
                const moveAmount = overlapX + 20
                if (nodeA.position.x < nodeB.position.x) {
                  moverComConjuge(nodeB, moveAmount, 0)
                } else {
                  moverComConjuge(nodeA, moveAmount, 0)
                }
              } else {
                const moveAmount = overlapY + 20
                if (nodeA.position.y < nodeB.position.y) {
                  moverComConjuge(nodeB, 0, moveAmount)
                } else {
                  moverComConjuge(nodeA, 0, moveAmount)
                }
              }
            }
          }
        }
      }
      
      if (!hasOverlap) break
    }
    
    // QUINTA PASSADA: Garantir casais lado a lado novamente
    casaisOrdenados.forEach(({ pessoa1Id, pessoa2Id }) => {
      const node1 = layoutedNodes.find(n => n.id === `person-${pessoa1Id}`)
      const node2 = layoutedNodes.find(n => n.id === `person-${pessoa2Id}`)
      
      if (!node1 || !node2) return

      if (isHorizontal) {
        const avgX = (node1.position.x + node2.position.x) / 2
        node1.position.x = avgX
        node2.position.x = avgX
        
        const spacing = nodeSize.height + 15
        const avgY = (node1.position.y + node2.position.y) / 2
        if (Math.abs(node1.position.y - node2.position.y) < spacing * 0.8) {
          node1.position.y = avgY - spacing / 2
          node2.position.y = avgY + spacing / 2
        }
      } else {
        const avgY = (node1.position.y + node2.position.y) / 2
        node1.position.y = avgY
        node2.position.y = avgY
        
        const spacing = nodeSize.width + 20
        const avgX = (node1.position.x + node2.position.x) / 2
        if (Math.abs(node1.position.x - node2.position.x) < spacing * 0.8) {
          if (node1.position.x <= node2.position.x) {
            node1.position.x = avgX - spacing / 2
            node2.position.x = avgX + spacing / 2
          } else {
            node1.position.x = avgX + spacing / 2
            node2.position.x = avgX - spacing / 2
          }
        }
      }
    })
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
    
    casais.forEach((casal) => {
      if (casal.pessoa1Id === pId && !visited.has(casal.pessoa2Id)) {
        nodesToMove.add(`person-${casal.pessoa2Id}`)
      }
      if (casal.pessoa2Id === pId && !visited.has(casal.pessoa1Id)) {
        nodesToMove.add(`person-${casal.pessoa1Id}`)
      }
    })
    
    pessoas.forEach(p => {
      if ((p.paiId === pId || p.maeId === pId) && !visited.has(p.id)) {
        collectNodes(p.id)
      }
    })
  }
  
  collectNodes(pessoaId)
  
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
  const processedMarriageEdges = new Set<string>()

  const findUnioes = (pessoa: PessoaArvore): UniaoArvore[] => {
    return unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  }

  const findUniao = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
  }

  const findConjuges = (pessoa: PessoaArvore): PessoaArvore[] => {
    const unioesP = findUnioes(pessoa)
    return unioesP
      .map(u => {
        if (u.pessoa1Id == null || u.pessoa2Id == null) return null
        const conjugeId = u.pessoa1Id === pessoa.id ? u.pessoa2Id : u.pessoa1Id
        return pessoas.find(p => p.id === conjugeId)
      })
      .filter(Boolean) as PessoaArvore[]
  }

  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = findUniao(pessoa)
    if (!uniao || uniao.pessoa1Id == null || uniao.pessoa2Id == null) return null
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

  const casalTemFilhos = (pessoa1Id: number, pessoa2Id: number): boolean => {
    return pessoas.some(p => 
      (p.paiId === pessoa1Id && p.maeId === pessoa2Id) ||
      (p.paiId === pessoa2Id && p.maeId === pessoa1Id)
    )
  }

  const addMarriageEdge = (pessoa1Id: number, pessoa2Id: number) => {
    if (casalTemFilhos(pessoa1Id, pessoa2Id)) return
    
    const edgeKey = `${Math.min(pessoa1Id, pessoa2Id)}-${Math.max(pessoa1Id, pessoa2Id)}`
    if (processedMarriageEdges.has(edgeKey)) return
    processedMarriageEdges.add(edgeKey)
    
    edges.push({
      id: `edge-marriage-${edgeKey}`,
      source: `person-${pessoa1Id}`,
      target: `person-${pessoa2Id}`,
      sourceHandle: 'marriage-out',
      targetHandle: 'marriage-in',
      type: 'smoothstep',
      style: { 
        stroke: colors.neutral, 
        strokeWidth: 2,
      },
    })
  }

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

  const addPersonWithAncestorsAndSiblings = (
    pessoa: PessoaArvore,
    isMain: boolean = false,
    isSpouse: boolean = false,
    depth: number = 0
  ) => {
    const added = addPersonNode(pessoa, isMain, isSpouse)
    if (!added) return

    const pai = findPai(pessoa)
    const mae = findMae(pessoa)

    if (pai) {
      addPersonWithAncestorsAndSiblings(pai, false, false, depth + 1)
      addEdge(`person-${pessoa.id}`, `person-${pai.id}`, `edge-pai-${pessoa.id}`, colors.neutral)
    } else if (depth === 0) {
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

    if (mae) {
      addPersonWithAncestorsAndSiblings(mae, false, false, depth + 1)
      addEdge(`person-${pessoa.id}`, `person-${mae.id}`, `edge-mae-${pessoa.id}`, colors.neutral)
    } else if (depth === 0) {
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

    const irmaos = findIrmaos(pessoa)
    irmaos.forEach(irmao => {
      if (processedIds.has(irmao.id)) return
      
      addPersonNode(irmao, false, false)
      
      if (pai && irmao.paiId === pai.id) {
        addEdge(`person-${irmao.id}`, `person-${pai.id}`, `edge-irmao-pai-${irmao.id}`, colors.neutral)
      }
      if (mae && irmao.maeId === mae.id) {
        addEdge(`person-${irmao.id}`, `person-${mae.id}`, `edge-irmao-mae-${irmao.id}`, colors.neutral)
      }

      const conjugesIrmao = findConjuges(irmao)
      conjugesIrmao.forEach(conjugeIrmao => {
        if (addPersonNode(conjugeIrmao, false, false)) {
          addPersonWithAncestorsAndSiblings(conjugeIrmao, false, false, depth + 1)
        }
        addMarriageEdge(irmao.id, conjugeIrmao.id)
      })

      addAllDescendants(irmao)
    })
  }

  const addAllDescendants = (pessoa: PessoaArvore) => {
    const filhos = findFilhos(pessoa)
    
    filhos.forEach(filho => {
      if (processedIds.has(filho.id)) {
        addEdge(`person-${filho.id}`, `person-${pessoa.id}`, `edge-filho-${filho.id}-${pessoa.id}`, colors.neutral)
        return
      }
      
      addPersonNode(filho, false, false)
      
      const pai = findPai(filho)
      const mae = findMae(filho)
      
      if (pai && processedIds.has(pai.id)) {
        addEdge(`person-${filho.id}`, `person-${pai.id}`, `edge-filho-${filho.id}-pai-${pai.id}`, colors.neutral)
      }
      if (mae && processedIds.has(mae.id)) {
        addEdge(`person-${filho.id}`, `person-${mae.id}`, `edge-filho-${filho.id}-mae-${mae.id}`, colors.neutral)
      }
      
      if ((!pai || !processedIds.has(pai.id)) && (!mae || !processedIds.has(mae.id))) {
        addEdge(`person-${filho.id}`, `person-${pessoa.id}`, `edge-filho-${filho.id}-${pessoa.id}`, colors.neutral)
      }

      const conjugesFilho = findConjuges(filho)
      conjugesFilho.forEach(conjugeFilho => {
        if (addPersonNode(conjugeFilho, false, false)) {
          addPersonWithAncestorsAndSiblings(conjugeFilho, false, false, 1)
        }
        addMarriageEdge(filho.id, conjugeFilho.id)
      })

      addAllDescendants(filho)
    })
  }

  addPersonWithAncestorsAndSiblings(pessoaPrincipal, true, false, 0)

  const conjuges = findConjuges(pessoaPrincipal)
  conjuges.forEach(conjuge => {
    addPersonWithAncestorsAndSiblings(conjuge, false, false, 1)
    addMarriageEdge(pessoaPrincipal.id, conjuge.id)
  })

  addAllDescendants(pessoaPrincipal)

  let changed = true
  let iterations = 0
  const maxIterations = 100
  
  while (changed && iterations < maxIterations) {
    changed = false
    iterations++
    
    pessoas.forEach(pessoa => {
      if (processedIds.has(pessoa.id)) return
      
      const paiNaArvore = pessoa.paiId && processedIds.has(pessoa.paiId)
      const maeNaArvore = pessoa.maeId && processedIds.has(pessoa.maeId)
      
      if (paiNaArvore || maeNaArvore) {
        addPersonNode(pessoa, false, false)
        changed = true
        
        if (paiNaArvore && pessoa.paiId) {
          addEdge(`person-${pessoa.id}`, `person-${pessoa.paiId}`, `edge-filho-${pessoa.id}-pai`, colors.neutral)
        }
        if (maeNaArvore && pessoa.maeId) {
          addEdge(`person-${pessoa.id}`, `person-${pessoa.maeId}`, `edge-filho-${pessoa.id}-mae`, colors.neutral)
        }
        
        const conjugesPessoa = findConjuges(pessoa)
        conjugesPessoa.forEach(conjuge => {
          addPersonNode(conjuge, false, false)
          addMarriageEdge(pessoa.id, conjuge.id)
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
  
  const { zoomIn, zoomOut, fitView, setCenter, getNodes } = useReactFlow()

  const onPersonClickRef = useRef(onPersonClick)
  const onAddPaiRef = useRef(onAddPai)
  const onAddMaeRef = useRef(onAddMae)
  const onAddFilhoRef = useRef(onAddFilho)
  const onAddConjugeRef = useRef(onAddConjuge)

  useEffect(() => {
    onPersonClickRef.current = onPersonClick
    onAddPaiRef.current = onAddPai
    onAddMaeRef.current = onAddMae
    onAddFilhoRef.current = onAddFilho
    onAddConjugeRef.current = onAddConjuge
  }, [onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge])

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

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, mode, pessoas, unioes)

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [pessoas, unioes, pessoaPrincipal, mode])

  useEffect(() => {
    calculateLayout()
  }, [calculateLayout])

  const handleResetLayout = useCallback(() => {
    calculateLayout()
  }, [calculateLayout])

  useImperativeHandle(ref, () => ({
    centerOnPerson: (pessoaId: number) => {
      const currentNodes = getNodes()
      const targetNode = currentNodes.find(n => n.id === `person-${pessoaId}`)
      
      if (targetNode) {
        const nodeSize = NODE_SIZES[mode]
        const x = targetNode.position.x + nodeSize.width / 2
        const y = targetNode.position.y + nodeSize.height / 2
        
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
      
      <Panel position="bottom-left">
        <div className="flex flex-col bg-white border border-gray-200 rounded shadow-sm">
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
          
          <button
            onClick={() => zoomOut()}
            className="p-2 hover:bg-gray-100 border-b border-gray-200"
            title="Diminuir zoom"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          
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

export const ReactFlowTree = forwardRef<ReactFlowTreeRef, ReactFlowTreeProps>((props, ref) => {
  return (
    <ReactFlowProvider>
      <ReactFlowTreeInner {...props} ref={ref} />
    </ReactFlowProvider>
  )
})

ReactFlowTree.displayName = 'ReactFlowTree'