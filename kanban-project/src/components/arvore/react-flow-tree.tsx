// src/components/arvore/react-flow-tree.tsx

"use client"

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
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
import { desenharArvore, ladosDoCasal, type Retangulo } from "@/src/lib/genealogia/layout/arvore-camadas"
import { LinhaDeFiliacao, type DadosDeFiliacao } from "./linha-de-filiacao"
import "reactflow/dist/style.css"
import type { PessoaArvore, UniaoArvore } from "./types"
import { classificarMaioridade, ehRequerente } from "@/src/lib/documentos/maioridade"
import { opacidadeDe, type EstadoFoco, type GrupoRecolhivel } from "@/src/lib/genealogia/navegacao/foco"
import { COR_NIVEL, ROTULO_NIVEL, type SaudePessoa } from "@/src/lib/genealogia/operacional/saude"

// Cores estilo FamilySearch
const colors = {
  male: '#3073B5',
  maleBg: '#E8F4FC',
  female: '#BF3D79',
  femaleBg: '#FCE8F2',
  neutral: '#4e6879',
  neutralBg: '#d8ecf8',
  green: '#87B940',
  line: '#8fa6b5',
  marriage: '#9333EA' // Roxo para linha de casamento
}

type ViewMode = 'paisagem' | 'retrato'

/** Chave, em `Arvore.posicoesNodes`, dos ajustes MANUAIS de cada disposição (nunca compartilhados entre paisagem e retrato). */
const chaveManual = (modo: ViewMode): string => `manual-${modo}`

// Tamanhos dos nós
const NODE_SIZES = {
  paisagem: { width: 240, height: 90 },
  retrato: { width: 160, height: 120 }
}

// Linha de casamento (invisível): um ponto de saída e um de chegada em CADA lado do cartão. O lado usado em cada linha é escolhido pela
// posição real dos dois cartões (`ladosDoCasal`), e acompanha o cartão se ele for arrastado para o outro lado.
const LADOS_DO_CARTAO: Array<[Position, string]> = [
  [Position.Top, 'top'], [Position.Right, 'right'], [Position.Bottom, 'bottom'], [Position.Left, 'left'],
]
function HandlesDeCasamento() {
  return (
    <>
      {LADOS_DO_CARTAO.map(([posicao, lado]) => (
        <Fragment key={lado}>
          <Handle type="source" position={posicao} id={`ms-${lado}`} className="!opacity-0 !w-1 !h-1" />
          <Handle type="target" position={posicao} id={`mt-${lado}`} className="!opacity-0 !w-1 !h-1" />
        </Fragment>
      ))}
    </>
  )
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
    'recebido': '#4f91c5',   // Azul
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
        className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-[var(--elev-1)]"
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

// O círculo do nó da árvore — a Tarefa viva do documento (`status` já vem
// derivado da API, nunca `Documento.status` cru; ver
// `lib/operacional/documento-estado.ts`). `BLOQUEADA` acende vermelho
// (impedimento real), `AGUARDANDO_TERCEIRO` e os estados internos (sem
// responsável/a fazer/em andamento) acendem âmbar/verde como antes — a
// distinção que importa aqui é "precisa de atenção" vs. "em andamento normal".
function getDocumentosStatus(pessoa: PessoaArvore, temConjuge: boolean) {
  const documentos = pessoa.documentos || []
  const falecido = pessoa.vivo === false || !!pessoa.data_obito

  const CORES_POR_ESTADO: Record<string, 'em_busca' | 'solicitar' | 'solicitado' | 'recebido'> = {
    BLOQUEADA: 'em_busca',
    SEM_RESPONSAVEL: 'solicitar',
    A_FAZER: 'solicitar',
    AGUARDANDO_TERCEIRO: 'solicitado',
    EM_ANDAMENTO: 'solicitado',
    RECEBIDO: 'recebido',
  }

  const verificarDocumento = (tipo: string): 'em_busca' | 'solicitar' | 'solicitado' | 'recebido' | null => {
    // ✅ CORRIGIDO: Usar includes() ao invés de ===
    const doc = documentos.find(d => d.tipo?.toUpperCase().includes(tipo))
    if (!doc) return null
    return CORES_POR_ESTADO[doc.status ?? ''] ?? null // Pendente/cancelado/inválido = não mostrar
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
 * verdade sobre a mesma coisa. Aqui entra só uma marca, de 6px, no canto
 * superior direito, ausente quando não há o que sinalizar: contradição de dado
 * (motor genealógico). Tarefa aberta NÃO é marca (Etapa 2): é trabalho em
 * andamento, não pendência de árvore — já tem lugar na Torre e em Tarefas.
 */
export interface SinaisPessoa {
  /** Há divergência crítica/alta apurada pelo motor. */
  divergencia?: boolean
}

function MarcasDiscretas({ sinais }: { sinais?: SinaisPessoa }) {
  if (!sinais?.divergencia) return null
  return (
    <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
      {sinais.divergencia && (
        <span
          title="Divergência de dados nesta pessoa"
          className="block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: 'var(--danger-solid)' }}
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
  //
  // `requerente` também aceita "sim" — quando mais de uma pessoa é vinculada
  // como requerente na mesma árvore, só a PRIMEIRA vira "maior" (auto-
  // principal); as demais entram como "sim" até alguém classificar
  // maior/menor no Editar Pessoa. Sem tratar "sim" aqui, essas pessoas
  // ficavam com o vínculo gravado certo no banco mas SEM NENHUM selo na
  // tela — pareciam não-requerentes mesmo estando marcadas.
  const requerente = (pessoa as any).requerente
  const isRequerente = ehRequerente(requerente)
  // Maior/menor vem da função ÚNICA (data de nascimento manda; sem data, o marcador
  // do cadastro; sem nenhum dos dois, só "Requerente" — a classificar).
  const maioridade = classificarMaioridade(pessoa.data_nasc ?? null, requerente, new Date())
  const requerenteLabel = !isRequerente
    ? null
    : maioridade.estado === 'MAIOR'
      ? 'Requerente maior de idade'
      : maioridade.estado === 'MENOR'
        ? 'Requerente menor de idade'
        : 'Requerente'

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
        className={`relative bg-[var(--surface-primary)] rounded-lg shadow-[var(--elev-2)] cursor-pointer hover:shadow-[var(--elev-2)] transition-all ${ringClass}`}
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
        <HandlesDeCasamento />

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
                maioridade.estado === 'MAIOR' 
                  ? 'bg-[var(--surface-secondary)] text-green-800' 
                  : 'bg-[var(--surface-secondary)] text-amber-800'
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
      className={`relative bg-[var(--surface-primary)] rounded-lg shadow-[var(--elev-2)] cursor-pointer hover:shadow-[var(--elev-2)] transition-all ${ringClass}`}
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
      <HandlesDeCasamento />

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
              maioridade.estado === 'MAIOR' 
                ? 'bg-[var(--surface-secondary)] text-green-800' 
                : 'bg-[var(--surface-secondary)] text-amber-800'
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
  type: 'filho' | 'conjuge'
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
const edgeTypes = { filiacao: LinhaDeFiliacao }

const nodeTypes = {
  person: PersonNode,
  addPerson: AddPersonNode,
  grupoRecolhido: GrupoRecolhidoNode,
}

// ========================================
// DESENHO — algoritmo em camadas para casais (`arvore-camadas.ts`), 06/10/2026
// ========================================
// Substitui o dagre + as cinco passadas de correção. O motor é puro e testado; aqui só se aplicam as posições e se montam as linhas:
//  • casamento: segmento curto entre os lados que se tocam (`ladosDoCasal`, recalculado a cada movimento do cartão);
//  • filiação: do meio do casal, barra, e descida até o filho (`LinhaDeFiliacao`).
const idDaPessoa = (nodeId: string): number | null => {
  const m = nodeId.match(/^person-(\d+)$/)
  return m ? Number(m[1]) : null
}

const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  mode: ViewMode,
  pessoas?: PessoaArvore[],
  unioes?: UniaoArvore[],
  principalId?: number | null,
) => {
  const nodeSize = NODE_SIZES[mode]
  const desenhadas = new Set<number>()
  for (const n of nodes) { const id = idDaPessoa(n.id); if (id != null) desenhadas.add(id) }
  const doDesenho = (pessoas ?? []).filter((p) => desenhadas.has(p.id))

  const resultado = desenharArvore(
    doDesenho.map((p) => ({ id: p.id, paiId: p.paiId, maeId: p.maeId, sexo: p.sexo, data_nasc: p.data_nasc })),
    (unioes ?? []).map((u) => ({ id: u.id, pessoa1Id: u.pessoa1Id, pessoa2Id: u.pessoa2Id, data_inicio: u.data_inicio })),
    { disposicao: mode, largura: nodeSize.width, altura: nodeSize.height, principalId },
  )

  const layoutedNodes = nodes.map((node) => {
    const id = idDaPessoa(node.id)
    const pos = id != null ? resultado.posicoes.get(id) : undefined
    return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node
  })

  const retangulo = (id: number): Retangulo => {
    const p = resultado.posicoes.get(id)!
    return { x: p.x, y: p.y, w: nodeSize.width, h: nodeSize.height }
  }
  const porId = new Map(doDesenho.map((p) => [p.id, p]))

  // Casamento: UMA linha por casal (união registrada ou pais em comum), mesmo quando há filhos.
  const casamentos: Edge[] = resultado.casais.map(({ a, b }) => {
    const lados = ladosDoCasal(retangulo(a), retangulo(b))
    return {
      id: `edge-marriage-${Math.min(a, b)}-${Math.max(a, b)}`,
      source: `person-${a}`,
      target: `person-${b}`,
      sourceHandle: `ms-${lados.a}`,
      targetHandle: `mt-${lados.b}`,
      type: 'straight',
      style: { stroke: colors.neutral, strokeWidth: 2 },
    }
  })

  // Filiação: uma aresta por genitor (sem duplicatas), do filho ao genitor — a convenção que `classificarVinculo` lê.
  const vistas = new Set<string>()
  const filiacao: Edge[] = []
  for (const e of edges) {
    if (e.id.startsWith('edge-marriage-') || e.id.startsWith('edge-grupo-')) continue
    const filho = idDaPessoa(e.source), genitor = idDaPessoa(e.target)
    if (filho == null || genitor == null) { filiacao.push(e); continue }
    const chave = `${e.source}|${e.target}`
    if (vistas.has(chave)) continue
    vistas.add(chave)
    const f = porId.get(filho)
    const conhecidos = [f?.paiId, f?.maeId].filter((x): x is number => x != null && desenhadas.has(x))
    const doisConhecidos = conhecidos.length === 2 && conhecidos.includes(genitor)
    const outro = doisConhecidos ? conhecidos.find((x) => x !== genitor)! : null
    const dados: DadosDeFiliacao = {
      disposicao: mode, largura: nodeSize.width, altura: nodeSize.height,
      outroId: outro != null ? `person-${outro}` : null,
      tronco: doisConhecidos ? genitor === f?.paiId : true,
    }
    filiacao.push({ ...e, type: 'filiacao', data: dados })
  }
  // Arestas que não são de pessoa (ex.: grupos recolhidos) seguem como estavam.
  const outras = edges.filter((e) => e.id.startsWith('edge-grupo-'))

  return { nodes: layoutedNodes, edges: [...filiacao, ...casamentos, ...outras] }
}

/** Reaponta a linha de casamento aos lados que HOJE se tocam (o cartão pode ter sido arrastado). Devolve o mesmo array se nada mudou. */
function ajustarLadosDeCasamento(nodes: Node[], edges: Edge[], mode: ViewMode): Edge[] {
  const tam = NODE_SIZES[mode]
  const rect = new Map<string, Retangulo>()
  for (const n of nodes) if (n.type === 'person') rect.set(n.id, { x: n.position.x, y: n.position.y, w: n.width ?? tam.width, h: n.height ?? tam.height })
  let mudou = false
  const novas = edges.map((e) => {
    if (!e.id.startsWith('edge-marriage-')) return e
    const a = rect.get(e.source), b = rect.get(e.target)
    if (!a || !b) return e
    const l = ladosDoCasal(a, b)
    const sh = `ms-${l.a}`, th = `mt-${l.b}`
    if (e.sourceHandle === sh && e.targetHandle === th) return e
    mudou = true
    return { ...e, sourceHandle: sh, targetHandle: th }
  })
  return mudou ? novas : edges
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
  const { pessoas, unioes, pessoaPrincipal, mode, onPersonClick } = options

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
    }
    // SEM cartão tracejado "Adicionar Pai" (01/10/2026): pai/mãe ausente se adiciona DENTRO do cartão da pessoa
    // (painel operacional, página de detalhes e barra lateral) — o canvas não oferece mais esse atalho.

    if (mae) {
      addPersonWithAncestorsAndSiblings(mae, false, false, depth + 1)
      addEdge(`person-${pessoa.id}`, `person-${mae.id}`, `edge-mae-${pessoa.id}`, colors.neutral)
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
  // Desenha as arestas de pai/mãe/filho de UMA pessoa contra quem já está
  // desenhado — usada tanto para quem o laço abaixo alcança na própria vez
  // quanto para um cônjuge que vira nó como EFEITO COLATERAL de ser casado com
  // quem o laço alcançou (ver o `forEach` de cônjuges logo abaixo: sem isto, o
  // cônjuge era adicionado só com a aresta de casamento — e o casamento nem
  // desenha linha quando o casal já tem filho em comum, `casalTemFilhos` acima
  // — e `processedIds.has` já marcado fazia a PRÓPRIA vez dele no laço externo
  // ser pulada silenciosamente. Era exatamente o defeito que este laço existe
  // para fechar, só que por um caminho lateral: pai/mãe corretos no banco,
  // sem nenhuma aresta, porque a vez dele nunca chegou a rodar.
  const desenharVinculosDeParentesco = (p: PessoaArvore) => {
    if (p.paiId && processedIds.has(p.paiId)) {
      addEdge(`person-${p.id}`, `person-${p.paiId}`, `edge-filho-${p.id}-pai`, colors.neutral)
    }
    if (p.maeId && processedIds.has(p.maeId)) {
      addEdge(`person-${p.id}`, `person-${p.maeId}`, `edge-filho-${p.id}-mae`, colors.neutral)
    }
    findFilhos(p).filter(f => processedIds.has(f.id)).forEach(filho => {
      if (filho.paiId === p.id) {
        addEdge(`person-${filho.id}`, `person-${p.id}`, `edge-filho-${filho.id}-pai`, colors.neutral)
      }
      if (filho.maeId === p.id) {
        addEdge(`person-${filho.id}`, `person-${p.id}`, `edge-filho-${filho.id}-mae`, colors.neutral)
      }
    })
  }

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
      // ASCENSÃO — o espelho exato da adoção acima, na direção oposta: um FILHO
      // já desenhado revela o pai/mãe que ainda não entrou. Sem isto, um pai/mãe
      // só alcançado pela caminhada descendente (`addAllDescendants`) — quando o
      // filho é visitado ANTES dele — nunca ganhava a aresta até o filho: entrava
      // só pelo laço de segurança final (linha ~1417), que desenha o card mas não
      // a ligação de parentesco. Resultado: pai/mãe reais, corretos no banco
      // (`paiId`/`maeId` da FK), aparecendo soltos no canvas.
      const filhosNaArvore = findFilhos(pessoa).filter(f => processedIds.has(f.id))

      if (paiNaArvore || maeNaArvore || filhosNaArvore.length > 0) {
        addPersonNode(pessoa, false, false)
        changed = true
        desenharVinculosDeParentesco(pessoa)

        const conjugesPessoa = findConjuges(pessoa)
        conjugesPessoa.forEach(conjuge => {
          const conjugeJaEstavaDesenhado = processedIds.has(conjuge.id)
          addPersonNode(conjuge, false, false)
          addMarriageEdge(pessoa.id, conjuge.id)
          if (!conjugeJaEstavaDesenhado) desenharVinculosDeParentesco(conjuge)
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
  // como nó solto, exatamente com o mesmo cartão — o desenho em camadas a posiciona num
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
// O desenho em camadas roda sobre a árvore inteira e produz as
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
  // Os placeholders "Adicionar Filho/Cônjuge" pertencem à pessoa que os ancora: se ela
  // recuou, o convite recua junto. Deixá-lo em pleno ao lado de um card apagado é
  // oferecer ação sobre alguém que saiu de foco. (Pai/Mãe não têm mais placeholder no canvas.)
  const a = nodeId.match(/^add-(?:filho|conjuge)-(\d+)$/)
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
  /**
   * Põe cartões em posições dadas (desfazer/refazer de "mover"). Atualiza o canvas
   * quando `modo` é o modo visível e SEMPRE persiste no modo informado — as
   * posições são guardadas por modo (paisagem/retrato).
   */
  aplicarPosicoes: (modo: string, posicoes: Record<string, { x: number; y: number }>) => void
  /** Limpa os ajustes manuais da disposição `modo` (desfazer do "mover" até o automático; refazer do reset). */
  resetarAjustes: (modo: string) => void
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
  /** Cartões arrastados (antes/depois) — alimenta o Desfazer. Só chega com movimento real. */
  onPosicoesMovidas?: (modo: ViewMode, movimentos: { pessoaId: number; antes: { x: number; y: number }; depois: { x: number; y: number } }[]) => void
  /** O operador limpou os ajustes manuais da disposição visível (botão "Resetar layout"): `anteriores` é o que havia — alimenta o Desfazer. */
  onLayoutResetado?: (modo: ViewMode, anteriores: Record<string, { x: number; y: number }>) => void
  /** Aresta selecionada no canvas (clique ou Enter); `null` ao limpar. Quem decide o que é removível é a tela. */
  onVinculoSelecionado?: (aresta: { id: string; source: string; target: string } | null) => void
  /** Aresta em destaque — CONTROLADA pela tela (ela a limpa ao remover/recarregar). */
  arestaSelecionadaId?: string | null
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
  onPosicoesMovidas,
  onLayoutResetado,
  onVinculoSelecionado,
  arestaSelecionadaId = null,
}, ref) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [isLocked, setIsLocked] = useState(false)

  const { zoomIn, zoomOut, fitView, setCenter, getZoom, getNodes } = useReactFlow()

  const savedPositionsRef = useRef(savedPositions)
  const onSavePositionsRef = useRef(onSavePositions)
  const onPosicoesMovidasRef = useRef(onPosicoesMovidas)
  const onVinculoSelecionadoRef = useRef(onVinculoSelecionado)
  const onLayoutResetadoRef = useRef(onLayoutResetado)
  // O desenho AUTOMÁTICO de cada cartão, na disposição visível — para saber se um arrasto é, de fato, um ajuste manual.
  const automaticoRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Quais cartões têm ajuste manual (só os arrastados, só nesta disposição) — marcados na tela.
  const [ajustados, setAjustados] = useState<Set<string>>(new Set())
  const posicoesNoInicioDoArrasteRef = useRef<Map<string, { x: number; y: number }>>(new Map())

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
    onPosicoesMovidasRef.current = onPosicoesMovidas
    onVinculoSelecionadoRef.current = onVinculoSelecionado
    onLayoutResetadoRef.current = onLayoutResetado
  }, [onPersonClick, onAddPai, onAddMae, onAddFilho, onAddConjuge, savedPositions, onSavePositions, onPosicoesMovidas, onLayoutResetado, onVinculoSelecionado])

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

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, mode, pessoas, unioes, pessoaPrincipal?.id ?? null)

    // O desenho AUTOMÁTICO é o padrão. Só vale posição salva se for um AJUSTE MANUAL explícito (arrastar um cartão) feito NESTA disposição:
    // `manual-paisagem` / `manual-retrato`. As chaves antigas `paisagem`/`retrato` (um retrato de TODOS os cartões, gravado a cada arrasto
    // pelo desenho anterior) já não são aplicadas — ficam intactas no banco, só deixam de mandar no desenho.
    const automatico = new Map<string, { x: number; y: number }>()
    layoutedNodes.forEach((n) => automatico.set(n.id, { x: n.position.x, y: n.position.y }))
    automaticoRef.current = automatico
    const manuais = savedPositionsRef.current?.[chaveManual(mode)] ?? {}
    const marcados = new Set<string>()
    layoutedNodes.forEach(node => {
      const match = node.id.match(/^person-(\d+)$/)
      const saved = match ? manuais[match[1]] : undefined
      if (saved) { node.position = { x: saved.x, y: saved.y }; marcados.add(node.id) }
    })
    setAjustados(marcados)

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [pessoas, unioes, pessoaPrincipal, mode, setNodes, setEdges])

  useEffect(() => {
    calculateLayout()
  }, [calculateLayout])

  // RESET (por árvore, só a disposição visível): limpa os ajustes manuais DESTA árvore e volta ao desenho automático. As posições de OUTRAS
  // árvores nunca são tocadas (cada árvore tem o próprio `posicoesNodes`). O que havia vai para o Desfazer (`onLayoutResetado`).
  const limparAjustes = useCallback((modoAlvo: ViewMode) => {
    const atuais = { ...(savedPositionsRef.current || {}) }
    delete atuais[chaveManual(modoAlvo)]
    savedPositionsRef.current = atuais
    onSavePositionsRef.current?.(atuais)
  }, [])

  const handleResetLayout = useCallback(() => {
    const anteriores = { ...(savedPositionsRef.current?.[chaveManual(mode)] ?? {}) }
    if (Object.keys(anteriores).length > 0) onLayoutResetadoRef.current?.(mode, anteriores)
    limparAjustes(mode)
    calculateLayout()
  }, [calculateLayout, mode, limparAjustes])

  // Persistência: grava SÓ os cartões movidos (`sobrescritas`) — nunca um retrato de todos. Um cartão devolvido ao ponto do desenho automático
  // deixa de ser ajuste (a entrada é removida).
  const persistirPosicoes = useCallback((
    modoAlvo: ViewMode,
    sobrescritas: Record<string, { x: number; y: number }> = {},
  ) => {
    const atuais = { ...(savedPositionsRef.current || {}) }
    const doModo = { ...(atuais[chaveManual(modoAlvo)] || {}) }
    for (const [id, pos] of Object.entries(sobrescritas)) {
      const auto = modoAlvo === mode ? automaticoRef.current.get(`person-${id}`) : undefined
      if (auto && Math.abs(auto.x - pos.x) < 0.5 && Math.abs(auto.y - pos.y) < 0.5) delete doModo[id]
      else doModo[id] = { x: pos.x, y: pos.y }
    }
    if (Object.keys(doModo).length > 0) atuais[chaveManual(modoAlvo)] = doModo
    else delete atuais[chaveManual(modoAlvo)]
    savedPositionsRef.current = atuais
    onSavePositionsRef.current?.(atuais)
    if (modoAlvo === mode) setAjustados(new Set(Object.keys(doModo).map((id) => `person-${id}`)))
  }, [mode])

  // Posição de cada cartão no INÍCIO do arrasto — é o "antes" do Desfazer.
  const handleNodeDragStart = useCallback((_: unknown, node: Node, arrastados?: Node[]) => {
    const mapa = new Map<string, { x: number; y: number }>()
    for (const n of (arrastados && arrastados.length > 0 ? arrastados : [node])) {
      mapa.set(n.id, { x: n.position.x, y: n.position.y })
    }
    posicoesNoInicioDoArrasteRef.current = mapa
  }, [])

  // ✅ Salvar posição ao arrastar (e informar o movimento ao histórico)
  const handleNodeDragStop = useCallback((_: unknown, node: Node, arrastados?: Node[]) => {
    const match = node.id.match(/^person-(\d+)$/)
    if (!match) return

    const movimentos: { pessoaId: number; antes: { x: number; y: number }; depois: { x: number; y: number } }[] = []
    for (const n of (arrastados && arrastados.length > 0 ? arrastados : [node])) {
      const m = n.id.match(/^person-(\d+)$/)
      const antes = posicoesNoInicioDoArrasteRef.current.get(n.id)
      if (!m || !antes) continue
      movimentos.push({ pessoaId: Number(m[1]), antes, depois: { x: n.position.x, y: n.position.y } })
    }
    posicoesNoInicioDoArrasteRef.current = new Map()

    // Persiste TODOS os cartões arrastados (arrasto em grupo), e só eles: cada um passa a ser um ajuste manual explícito.
    const movidos: Record<string, { x: number; y: number }> = { [match[1]]: { x: node.position.x, y: node.position.y } }
    for (const n of (arrastados && arrastados.length > 0 ? arrastados : [])) {
      const m = n.id.match(/^person-(\d+)$/)
      if (m) movidos[m[1]] = { x: n.position.x, y: n.position.y }
    }
    persistirPosicoes(mode, movidos)

    // Movimento nulo (clique) não é ação: não entra no histórico.
    const reais = movimentos.filter(m => Math.abs(m.antes.x - m.depois.x) > 0.5 || Math.abs(m.antes.y - m.depois.y) > 0.5)
    if (reais.length > 0) onPosicoesMovidasRef.current?.(mode, reais)
  }, [mode, persistirPosicoes])

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
    aplicarPosicoes: (modoAlvo: string, posicoes: Record<string, { x: number; y: number }>) => {
      const alvo: ViewMode = modoAlvo === 'retrato' ? 'retrato' : 'paisagem'
      if (alvo === mode) {
        setNodes((atuais) => atuais.map((n) => {
          const m = n.id.match(/^person-(\d+)$/)
          const nova = m ? posicoes[m[1]] : undefined
          return nova ? { ...n, position: { x: nova.x, y: nova.y } } : n
        }))
      }
      persistirPosicoes(alvo, posicoes)
    },
    resetarAjustes: (modoAlvo: string) => {
      const alvo: ViewMode = modoAlvo === 'retrato' ? 'retrato' : 'paisagem'
      limparAjustes(alvo)
      if (alvo === mode) calculateLayout()
    },
  }), [getNodes, setCenter, getZoom, fitView, mode, setNodes, persistirPosicoes, limparAjustes, calculateLayout])

  // A linha de casamento acompanha os cartões: a cada movimento, escolhe de novo os lados que se tocam.
  const edgesComLados = useMemo(() => ajustarLadosDeCasamento(nodes, edges, mode), [nodes, edges, mode])
  // Ajuste manual MARCADO na tela: contorno tracejado âmbar no cartão arrastado (o desenho automático não tem marca).
  const nodesMarcados = useMemo(
    () => (ajustados.size === 0 ? nodes : nodes.map((n) => (ajustados.has(n.id)
      ? { ...n, style: { ...n.style, outline: '2px dashed #d97706', outlineOffset: 3, borderRadius: 8 } }
      : n))),
    [nodes, ajustados],
  )

  // Foco aplicado sobre o layout já calculado. Ver `aplicarFoco`: nada aqui
  // recalcula o desenho, então trocar de linhagem não move card nenhum.
  const { nodes: nodesEmTela, edges: edgesEmTela } = useMemo(
    () => aplicarFoco(nodesMarcados, edgesComLados, { foco, sinais, grupos: gruposRecolhidos, lacunas, saude, mode, onExpandirGrupo }),
    [nodesMarcados, edgesComLados, foco, sinais, gruposRecolhidos, lacunas, saude, mode, onExpandirGrupo],
  )

  // Aresta selecionada ganha destaque PRÓPRIO (cor de ação, traço mais grosso):
  // a seleção do reactflow não sobrevive ao `aplicarFoco`, que reconstrói arestas.
  // Seleção cuja aresta sumiu do desenho (pessoa removida, recarga) não destaca nada;
  // a tela também a descarta, pois `classificarVinculo` não acha mais o vínculo.
  const edgesDesenhadas = useMemo(
    () => arestaSelecionadaId == null
      ? edgesEmTela
      : edgesEmTela.map((e) => e.id === arestaSelecionadaId
        ? { ...e, style: { ...e.style, stroke: '#0d2c58', strokeWidth: 4 }, zIndex: 10 }
        : e),
    [edgesEmTela, arestaSelecionadaId],
  )

  const selecionarAresta = useCallback((_: unknown, edge: Edge) => {
    if (edge.id.startsWith('edge-grupo-')) return
    onVinculoSelecionadoRef.current?.({ id: edge.id, source: edge.source, target: edge.target })
  }, [])

  const limparSelecaoDeAresta = useCallback(() => {
    onVinculoSelecionadoRef.current?.(null)
  }, [])

  return (
    <ReactFlow
      nodes={nodesEmTela}
      edges={edgesDesenhadas}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStart={handleNodeDragStart}
      onNodeDragStop={handleNodeDragStop}
      onEdgeClick={selecionarAresta}
      onPaneClick={limparSelecaoDeAresta}
      onNodeClick={limparSelecaoDeAresta}
      // DELETE/BACKSPACE NÃO APAGAM NADA. O padrão do reactflow remove o elemento
      // selecionado do estado local — para o operador parecia que o vínculo foi
      // apagado (e uma pessoa também!), mas era só o desenho; no próximo
      // recarregamento voltava. Remover vínculo é ação explícita, com confirmação
      // (ver remover-vinculo-modal.tsx) e passa pela porta oficial da árvore.
      deleteKeyCode={null}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
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
      
      {ajustados.size > 0 && (
        <Panel position="top-left">
          <div
            data-testid="aviso-ajustes-manuais"
            className="flex items-center gap-2 rounded border bg-[var(--surface-primary)] px-2.5 py-1.5 text-[12px] text-gray-700 shadow-[var(--elev-1)]"
            style={{ borderColor: '#d97706' }}
          >
            <span style={{ color: '#b45309', fontWeight: 600 }}>
              {ajustados.size} {ajustados.size === 1 ? 'cartão ajustado' : 'cartões ajustados'} à mão
            </span>
            <button onClick={handleResetLayout} className="rounded border border-gray-300 px-2 py-0.5 font-semibold hover:bg-gray-100">
              Voltar ao desenho automático
            </button>
          </div>
        </Panel>
      )}

      <Panel position="bottom-left">
        {/* text-gray-700 EXPLÍCITO: os SVGs abaixo usam stroke="currentColor" e não
            declaram cor própria. Sem isto, herdam a cor do ancestral — e quando a
            árvore abre dentro do modal de processo (tema escuro, text-white), o
            ícone fica branco sobre botão branco: invisível. */}
        <div className="flex flex-col bg-[var(--surface-primary)] border border-gray-200 rounded shadow-[var(--elev-1)] text-gray-700">
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