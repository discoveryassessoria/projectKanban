// src/components/arvore/react-flow-tree.tsx

"use client"

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
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
import { opacidadeDe, type EstadoFoco, type GrupoRecolhivel } from "@/src/lib/genealogia/navegacao/foco"
import { COR_NIVEL, ROTULO_NIVEL, type SaudePessoa } from "@/src/lib/genealogia/operacional/saude"

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
      <div className={`${tooltipClass} px-1.5 py-0.5 bg-[var(--surface-popover)] text-white text-[9px] rounded whitespace-nowrap opacity-0 invisible group-hover/doctip:opacity-100 group-hover/doctip:visible transition-all z-[100] pointer-events-none`}>
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
/**
 * SINAIS DISCRETOS do cartão — acrescentam o que o cartão ainda não dizia.
 *
 * Deliberadamente NÃO incluem estado documental: o cartão já tem os indicadores
 * N/C/O, e um segundo sinal documental na mesma superfície seria uma segunda
 * verdade sobre a mesma coisa. Aqui entram só duas marcas, ambas de 6px, ambas
 * no canto superior direito, ambas ausentes quando não há o que sinalizar:
 * contradição de dado (motor genealógico) e tarefa aberta (Tarefa do processo).
 */
export interface SinaisPessoa {
  /** Há divergência crítica/alta apurada pelo motor. */
  divergencia?: boolean
  /** Há tarefa aberta ligada a esta pessoa. */
  tarefaAberta?: boolean
}

function MarcasDiscretas({ sinais }: { sinais?: SinaisPessoa }) {
  if (!sinais?.divergencia && !sinais?.tarefaAberta) return null
  return (
    <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
      {sinais.divergencia && (
        <span
          title="Divergência de dados nesta pessoa"
          className="block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: '#dc2626' }}
        />
      )}
      {sinais.tarefaAberta && (
        <span
          title="Tarefa aberta para esta pessoa"
          className="block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: '#2563eb' }}
        />
      )}
    </div>
  )
}

interface PersonNodeData {
  pessoa: PessoaArvore
  isMain?: boolean
  isSpouse?: boolean
  mode: ViewMode
  unioes?: UniaoArvore[]
  sinais?: SinaisPessoa
  onPersonClick?: (pessoa: PessoaArvore) => void
}

function PersonNode({ data }: NodeProps<PersonNodeData>) {
  const { pessoa, isMain, isSpouse, mode, unioes = [], sinais, onPersonClick } = data
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
        className={`relative bg-[var(--surface-primary)] rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all ${ringClass}`}
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
          className="!bg-gray-400 !w-2 !h-2 !border-2 !border-[var(--border-default)]"
        />
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-2 !h-2 !border-2 !border-[var(--border-default)]"
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

        <MarcasDiscretas sinais={sinais} />

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
      className={`relative bg-[var(--surface-primary)] rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all ${ringClass}`}
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
        className="!bg-gray-400 !w-2 !h-2 !border-2 !border-[var(--border-default)]"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className="!bg-gray-400 !w-2 !h-2 !border-2 !border-[var(--border-default)]"
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

      <MarcasDiscretas sinais={sinais} />

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
  /**
   * O que a ausência significa, apurado pelo grafo (`navegacao/lacunas.ts`).
   * Ausente = o placeholder se comporta exatamente como antes.
   */
  contexto?: { titulo: string; explicacao: string; relevancia: string }
}

function AddPersonNode({ data }: NodeProps<AddPersonNodeData>) {
  const { type, mode, onClick, contexto } = data

  const config = {
    pai: { label: 'Adicionar Pai', color: colors.neutral },
    mae: { label: 'Adicionar Mãe', color: colors.neutral },
    filho: { label: 'Adicionar Filho(a)', color: colors.green },
    conjuge: { label: 'Adicionar Cônjuge', color: colors.neutral }
  }
  const { label, color } = config[type]

  // O CONTEXTO VAI NO `title`, não em texto novo dentro do card.
  //
  // A caixa tracejada é parte do desenho aprovado e tem dimensão fixa: enfiar
  // duas linhas de explicação dentro dela mudaria o layout. O tooltip nativo
  // entrega a mesma informação sem tocar num pixel — e some quando não há o que
  // dizer, em vez de repetir uma frase genérica.
  const dica = contexto ? `${contexto.titulo}. ${contexto.explicacao}` : undefined
  // Único sinal visual: quem CONTINUA a linha ganha a borda um tom mais firme.
  // Mesma cor da paleta, mesma espessura — só deixa de ser cinza-claro.
  const bordaContexto =
    contexto?.relevancia === 'continua_linha' ? 'border-gray-400' : 'border-gray-300'

  if (mode === 'paisagem') {
    return (
      <div
        className={`relative bg-[var(--surface-primary)] rounded-lg border-2 border-dashed ${bordaContexto} cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all`}
        style={{ width: NODE_SIZES.paisagem.width, height: NODE_SIZES.paisagem.height }}
        onClick={onClick}
        title={dica}
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
      className={`relative bg-[var(--surface-primary)] rounded-lg border-2 border-dashed ${bordaContexto} cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all`}
      style={{ width: NODE_SIZES.retrato.width, height: NODE_SIZES.retrato.height }}
      onClick={onClick}
      title={dica}
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

// ========================================
// CUSTOM NODE: Ramo recolhido ("+18 irmãos")
// ========================================
// Reusa EXATAMENTE a gramática do placeholder que já existia no canvas — mesma
// caixa branca, mesma borda tracejada cinza, mesma dimensão de card, mesmo hover.
// Não é um elemento visual novo: é o mesmo elemento com outro rótulo. Recolher
// ramo grande foi pedido; inventar um estilo para isso, não.
interface GrupoNodeData {
  rotulo: string
  mode: ViewMode
  onClick?: () => void
}

function GrupoRecolhidoNode({ data }: NodeProps<GrupoNodeData>) {
  const { rotulo, mode, onClick } = data
  const tamanho = NODE_SIZES[mode]
  return (
    <div
      className="relative bg-[var(--surface-primary)] rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
      style={{ width: tamanho.width, height: tamanho.height }}
      onClick={onClick}
      title="Expandir este ramo"
    >
      <Handle
        type="source"
        position={mode === 'paisagem' ? Position.Right : Position.Top}
        className="!bg-gray-300 !w-2 !h-2"
      />
      <Handle
        type="target"
        position={mode === 'paisagem' ? Position.Left : Position.Bottom}
        className="!bg-gray-300 !w-2 !h-2"
      />
      <div className="h-full flex items-center justify-center text-center px-2">
        <span className="text-xs font-medium" style={{ color: colors.neutral }}>
          {rotulo}
        </span>
      </div>
    </div>
  )
}

// Tipos de nós customizados
const nodeTypes = {
  person: PersonNode,
  addPerson: AddPersonNode,
  grupoRecolhido: GrupoRecolhidoNode,
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

  // ADOÇÃO — puxa para o desenho quem a caminhada recursiva não alcançou.
  //
  // Este laço já existia e revela a intenção: o desenho deve conter TODOS os
  // membros da árvore, não só os que a caminhada a partir da pessoa principal
  // encontrou. Ele estava incompleto — só adotava quem tivesse pai ou mãe JÁ
  // desenhado. Quem entrasse na árvore sem nenhum vínculo ficava de fora, e o
  // resultado é o pior tipo de defeito: a pessoa existe no banco, aparece na
  // busca, no diagnóstico e no painel, e não está na tela. Ver o bloco logo
  // abaixo, que fecha a lacuna.
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

  // CONTRATO: todo MEMBRO ATIVO da árvore é desenhado.
  //
  // Quem alimenta este canvas é `GET /api/arvore/:id`, que devolve as pessoas
  // filtradas por `PESSOA_ATIVA` — "nó da árvore que ainda participa da
  // operação" (`vinculo-ativo.ts`). É o mesmo recorte que o materializador, o
  // roster da Central e o motor financeiro usam. O canvas era o ÚNICO consumidor
  // que estreitava esse recorte por conta própria, para a componente conexa da
  // pessoa principal — e isso nunca foi decisão documentada em lugar nenhum:
  // não está no guard de layout congelado, nem no ADR, nem em commit.
  //
  // Pessoa sem vínculo é cadastro em andamento, não pessoa inexistente. Ela entra
  // como nó solto, exatamente com o mesmo cartão — o dagre a posiciona num
  // componente próprio, sem tocar nas coordenadas de quem já estava conectado.
  for (const pessoa of pessoas) {
    if (processedIds.has(pessoa.id)) continue
    addPersonNode(pessoa, false, false)
    // Cônjuge de quem acabou de entrar também entra: senão o casal aparece pela
    // metade, que é uma forma diferente do mesmo defeito.
    for (const conjuge of findConjuges(pessoa)) {
      addPersonNode(conjuge, false, false)
      addMarriageEdge(pessoa.id, conjuge.id)
    }
  }

  return { nodes, edges }
}

// ========================================
// CAMADA DE FOCO — aplicada DEPOIS do layout, nunca dentro dele
// ========================================
//
// Esta é a decisão central da evolução da árvore: o foco NÃO recalcula posição.
// O dagre roda sobre a árvore inteira, como sempre rodou, e produz exatamente as
// mesmas coordenadas de antes. O que esta função faz é decidir, por nó já
// posicionado, se ele aparece inteiro, apagado, ou não aparece.
//
// Consequências que valem por si:
//   • entrar e sair do modo linhagem não move um único card — a referência
//     espacial que o operador construiu sobrevive ao filtro;
//   • trocar de requerente é instantâneo: é um Map novo, não um layout novo;
//   • as posições que o usuário arrastou continuam valendo, porque ninguém
//     recalculou nada.
//
// Puro: mesmas entradas → mesmas saídas. Não lê estado, não escreve estado.
interface OpcoesFoco {
  foco?: ReadonlyMap<number, EstadoFoco>
  sinais?: ReadonlyMap<number, SinaisPessoa>
  grupos?: readonly GrupoRecolhivel[]
  /** Contexto dos slots "+pai/+mãe", por chave `pai-<id>` / `mae-<id>`. */
  lacunas?: ReadonlyMap<string, { titulo: string; explicacao: string; relevancia: string }>
  /** Heatmap. Ausente = nenhum anel; o cartão fica exatamente como sempre foi. */
  saude?: ReadonlyMap<number, SaudePessoa>
  mode: ViewMode
  onExpandirGrupo?: (chave: string) => void
}

function idPessoaDoNode(nodeId: string): number | null {
  const m = nodeId.match(/^person-(\d+)$/)
  if (m) return Number(m[1])
  // Os placeholders "Adicionar Pai/Mãe" pertencem à pessoa que os ancora: se ela
  // recuou, o convite para adicionar pai dela recua junto. Deixá-lo em pleno ao
  // lado de um card apagado é oferecer ação sobre alguém que saiu de foco.
  const a = nodeId.match(/^add-(?:pai|mae|filho|conjuge)-(\d+)$/)
  return a ? Number(a[1]) : null
}

function aplicarFoco(
  nodes: Node[],
  edges: Edge[],
  opcoes: OpcoesFoco,
): { nodes: Node[]; edges: Edge[] } {
  const { foco, sinais, grupos, lacunas, saude, mode, onExpandirGrupo } = opcoes
  const temFoco = Boolean(foco && foco.size)
  const temSinais = Boolean(sinais && sinais.size)
  const temGrupos = Boolean(grupos && grupos.length)
  const temLacunas = Boolean(lacunas && lacunas.size)
  const temSaude = Boolean(saude && saude.size)

  // Caminho de custo zero: sem foco, sem sinais e sem grupos a árvore é a de
  // antes, referência por referência. Nenhum objeto novo, nenhum re-render.
  if (!temFoco && !temSinais && !temGrupos && !temLacunas && !temSaude) return { nodes, edges }

  const estadoDe = (nodeId: string): EstadoFoco => {
    const pessoaId = idPessoaDoNode(nodeId)
    if (pessoaId == null) return 'pleno'
    return foco?.get(pessoaId) ?? 'pleno'
  }

  const posicaoPorPessoa = new Map<number, { x: number; y: number }>()
  for (const n of nodes) {
    const id = n.id.match(/^person-(\d+)$/)
    if (id) posicaoPorPessoa.set(Number(id[1]), n.position)
  }

  const nodesFinais: Node[] = nodes.map((n) => {
    const estado = estadoDe(n.id)
    const pessoaId = idPessoaDoNode(n.id)
    const marcas = pessoaId != null ? sinais?.get(pessoaId) : undefined
    const precisaData = n.type === 'person' && marcas !== (n.data as PersonNodeData)?.sinais

    // Slot "+pai/+mãe": recebe o contexto apurado pelo grafo, quando existe.
    if (n.type === 'addPerson' && lacunas) {
      const chave = n.id.replace(/^add-/, '').replace(/-(\d+)$/, '-$1')
      const contexto = lacunas.get(chave)
      if (contexto) {
        return {
          ...n,
          hidden: estado === 'oculto',
          style: { ...n.style, opacity: opacidadeDe(estado) },
          data: { ...(n.data as AddPersonNodeData), contexto },
        }
      }
    }

    // HEATMAP NO WRAPPER — o cartão continua intocado.
    //
    // O anel é um `box-shadow` no `.react-flow__node`, que é o div que o
    // reactflow desenha EM VOLTA do componente. `PersonNode` não sabe que o modo
    // Saúde existe, não recebe prop nova e não muda um pixel: desligar o modo
    // devolve exatamente o cartão de sempre. Sombra não ocupa espaço no layout,
    // então nenhum nó se desloca por causa dela.
    const nivel = pessoaId != null ? saude?.get(pessoaId) : undefined
    const anel = nivel
      ? { boxShadow: `0 0 0 2px ${COR_NIVEL[nivel.nivel]}`, borderRadius: 8 }
      : undefined

    return {
      ...n,
      hidden: estado === 'oculto',
      // Só a OPACIDADE muda (e o anel do heatmap, quando ligado). Nem dimensão,
      // nem cor do cartão, nem borda dele, nem posição — o guarda de layout
      // congelado continua verdadeiro depois desta linha.
      style: { ...n.style, opacity: opacidadeDe(estado), ...anel },
      // Quem recuou CONTINUA clicável de propósito. Esmaecer é tirar do primeiro
      // plano, não desativar: o operador que vê um nome apagado e quer conferi-lo
      // não deveria ter de sair do modo linhagem para isso.
      data: precisaData ? { ...(n.data as PersonNodeData), sinais: marcas } : n.data,
      // O motivo do nível vira tooltip do wrapper — texto nenhum entra no cartão.
      title: nivel ? `${ROTULO_NIVEL[nivel.nivel]}: ${nivel.motivo}` : undefined,
    }
  })

  // Nó "+N irmãos": ocupa o lugar do primeiro membro recolhido, para o ramo não
  // deixar um buraco onde estava. Só entra quando o membro de fato saiu da tela.
  if (temGrupos) {
    for (const grupo of grupos!) {
      const primeiro = grupo.membros.find((id) => foco?.get(id) === 'oculto')
      if (primeiro == null) continue
      const posicao = posicaoPorPessoa.get(primeiro)
      if (!posicao) continue
      nodesFinais.push({
        id: `grupo-${grupo.chave}`,
        type: 'grupoRecolhido',
        position: posicao,
        draggable: false,
        data: { rotulo: grupo.rotulo, mode, onClick: () => onExpandirGrupo?.(grupo.chave) },
      })
      const ancora = posicaoPorPessoa.get(grupo.ancoraId)
      if (ancora) {
        edges = [
          ...edges,
          {
            id: `edge-grupo-${grupo.chave}`,
            source: `grupo-${grupo.chave}`,
            target: `person-${grupo.ancoraId}`,
            type: 'smoothstep',
            style: { stroke: colors.neutral, strokeWidth: 2, strokeDasharray: '5,5' },
          },
        ]
      }
    }
  }

  const estadoNode = new Map(nodesFinais.map((n) => [n.id, estadoDe(n.id)]))
  const edgesFinais: Edge[] = edges.map((e) => {
    if (e.id.startsWith('edge-grupo-')) return e
    const a = estadoNode.get(e.source) ?? 'pleno'
    const b = estadoNode.get(e.target) ?? 'pleno'
    if (a === 'oculto' || b === 'oculto') return { ...e, hidden: true }
    const opacidade = Math.min(opacidadeDe(a), opacidadeDe(b))
    return { ...e, hidden: false, style: { ...e.style, opacity: opacidade } }
  })

  return { nodes: nodesFinais, edges: edgesFinais }
}

// ========================================
// TIPOS EXPORTADOS PARA REF
// ========================================
export interface ReactFlowTreeRef {
  /** Centraliza numa pessoa. `zoom` opcional — sem ele preserva o zoom atual. */
  centerOnPerson: (pessoaId: number, opcoes?: { zoom?: number }) => void
  /** Enquadra um conjunto de pessoas (ex.: a linhagem em foco). */
  enquadrar: (pessoaIds: number[]) => void
}

// ========================================
// COMPONENTE PRINCIPAL: ReactFlowTree
// ========================================
interface ReactFlowTreeProps {
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  pessoaPrincipal: PessoaArvore | null
  mode: ViewMode
  savedPositions?: Record<string, Record<string, { x: number; y: number }>> // { paisagem: { "123": {x,y} }, retrato: { "456": {x,y} } }
  onSavePositions?: (positions: Record<string, Record<string, { x: number; y: number }>>) => void
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
  /** Estado de foco por pessoa. Ausente = árvore inteira em pleno, como sempre. */
  foco?: ReadonlyMap<number, EstadoFoco>
  /** Marcas discretas por pessoa (divergência, tarefa). */
  sinais?: ReadonlyMap<number, SinaisPessoa>
  /** Ramos recolhidos a exibir como "+N irmãos". */
  gruposRecolhidos?: readonly GrupoRecolhivel[]
  onExpandirGrupo?: (chave: string) => void
  /** Contexto dos slots "+pai/+mãe" (`navegacao/lacunas.ts`). */
  lacunas?: ReadonlyMap<string, { titulo: string; explicacao: string; relevancia: string }>
  /** Heatmap por pessoa. Ausente = modo Saúde desligado. */
  saude?: ReadonlyMap<number, SaudePessoa>
}

const ReactFlowTreeInner = forwardRef<ReactFlowTreeRef, ReactFlowTreeProps>(({
  pessoas,
  unioes,
  pessoaPrincipal,
  mode,
  savedPositions,
  onSavePositions,
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge,
  foco,
  sinais,
  gruposRecolhidos,
  onExpandirGrupo,
  lacunas,
  saude,
}, ref) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [isLocked, setIsLocked] = useState(false)

  const { zoomIn, zoomOut, fitView, setCenter, getZoom, getNodes } = useReactFlow()

  const savedPositionsRef = useRef(savedPositions)
  const onSavePositionsRef = useRef(onSavePositions)

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
    savedPositionsRef.current = savedPositions
    onSavePositionsRef.current = onSavePositions
  }, [onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge, savedPositions, onSavePositions])

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

    // ✅ NOVO: Aplicar posições salvas (override do dagre)
    const modePositions = savedPositionsRef.current?.[mode]
    if (modePositions) {
      layoutedNodes.forEach(node => {
        // Extrair pessoaId do node.id (formato: "person-123")
        const match = node.id.match(/^person-(\d+)$/)
        if (match) {
          const pessoaId = match[1]
          const saved = modePositions[pessoaId]
          if (saved) {
            node.position = { x: saved.x, y: saved.y }
          }
        }
      })
    }

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [pessoas, unioes, pessoaPrincipal, mode, setNodes, setEdges])

  useEffect(() => {
    calculateLayout()
  }, [calculateLayout])

  const handleResetLayout = useCallback(() => {
    // Limpar posições salvas do modo atual
    const currentPositions = { ...(savedPositionsRef.current || {}) }
    delete currentPositions[mode]
    savedPositionsRef.current = currentPositions
    onSavePositionsRef.current?.(currentPositions)
    
    calculateLayout()
  }, [calculateLayout, mode])

  // ✅ NOVO: Salvar posição ao arrastar
  const handleNodeDragStop = useCallback((_: any, node: Node) => {
    const match = node.id.match(/^person-(\d+)$/)
    if (!match) return

    const pessoaId = match[1]
    const currentPositions = { ...(savedPositionsRef.current || {}) }
    
    if (!currentPositions[mode]) {
      currentPositions[mode] = {}
    }
    
    currentPositions[mode] = {
      ...currentPositions[mode],
      [pessoaId]: { x: node.position.x, y: node.position.y }
    }

    // Salvar posição de todos os nós person- visíveis
    const currentNodes = getNodes()
    currentNodes.forEach(n => {
      const m = n.id.match(/^person-(\d+)$/)
      if (m) {
        currentPositions[mode][m[1]] = { x: n.position.x, y: n.position.y }
      }
    })

    savedPositionsRef.current = currentPositions
    onSavePositionsRef.current?.(currentPositions)
  }, [mode, getNodes])

  useImperativeHandle(ref, () => ({
    centerOnPerson: (pessoaId: number, opcoes?: { zoom?: number }) => {
      const currentNodes = getNodes()
      const targetNode = currentNodes.find(n => n.id === `person-${pessoaId}`)

      if (targetNode) {
        const nodeSize = NODE_SIZES[mode]
        const x = targetNode.position.x + nodeSize.width / 2
        const y = targetNode.position.y + nodeSize.height / 2

        // Sem zoom pedido, PRESERVA o zoom atual. Forçar 1 a cada busca era
        // "perder o contexto": quem estava olhando a árvore de longe voltava ao
        // detalhe, e quem estava no detalhe era jogado para longe.
        const zoom = opcoes?.zoom ?? getZoom()
        setCenter(x, y, { zoom, duration: 500 })
      }
    },
    enquadrar: (pessoaIds: number[]) => {
      if (pessoaIds.length === 0) {
        fitView({ padding: 0.2, duration: 500 })
        return
      }
      const alvos = new Set(pessoaIds.map((id) => `person-${id}`))
      const nos = getNodes().filter((n) => alvos.has(n.id) && !n.hidden)
      if (nos.length === 0) {
        fitView({ padding: 0.2, duration: 500 })
        return
      }
      fitView({ padding: 0.25, duration: 500, maxZoom: 1.2, nodes: nos.map((n) => ({ id: n.id })) })
    },
  }), [getNodes, setCenter, getZoom, fitView, mode])

  // Foco aplicado sobre o layout já calculado. Ver `aplicarFoco`: nada aqui
  // recalcula dagre, então trocar de linhagem não move card nenhum.
  const { nodes: nodesEmTela, edges: edgesEmTela } = useMemo(
    () => aplicarFoco(nodes, edges, { foco, sinais, grupos: gruposRecolhidos, lacunas, saude, mode, onExpandirGrupo }),
    [nodes, edges, foco, sinais, gruposRecolhidos, lacunas, saude, mode, onExpandirGrupo],
  )

  return (
    <ReactFlow
      nodes={nodesEmTela}
      edges={edgesEmTela}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
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
        {/* text-gray-700 EXPLÍCITO: os SVGs abaixo usam stroke="currentColor" e não
            declaram cor própria. Sem isto, herdam a cor do ancestral — e quando a
            árvore abre dentro do modal de processo (tema escuro, text-white), o
            ícone fica branco sobre botão branco: invisível. */}
        <div className="flex flex-col bg-[var(--surface-primary)] border border-gray-200 rounded shadow-sm text-gray-700">
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