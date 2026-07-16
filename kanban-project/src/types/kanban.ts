// ESTE ARQUIVO VAI EM: src/types/kanban.ts
// =====================================================
// KANBAN MOTOR-NATIVE (5/jul)
// - País NÃO é mais enum fixo: é o countryKey do CatalogoPais (ex.: "italia")
// - Coluna NÃO é mais Status: é a FASE do Workflow Macro (faseAtualKey)
// - enum Pais / PAISES_CONFIG ficam no fim como LEGADO (pra não quebrar
//   código antigo fora do kanban). Não usar em código novo.
// =====================================================

// Enum de Prioridade de Tarefa (inalterado)
export enum PrioridadeTarefa {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
  URGENTE = 'URGENTE'
}

// Configuração visual de prioridades (inalterado)
export const PRIORIDADE_CONFIG: Record<PrioridadeTarefa, {
  label: string
  cor: string
  corBg: string
}> = {
  [PrioridadeTarefa.BAIXA]: { label: 'Baixa', cor: '#6b7280', corBg: '#6b728020' },
  [PrioridadeTarefa.MEDIA]: { label: 'Média', cor: '#3b82f6', corBg: '#3b82f620' },
  [PrioridadeTarefa.ALTA]: { label: 'Alta', cor: '#f59e0b', corBg: '#f59e0b20' },
  [PrioridadeTarefa.URGENTE]: { label: 'Urgente', cor: '#ef4444', corBg: '#ef444420' },
}

// =====================================================
// PAÍS (dinâmico — vem do CatalogoPais via /api/kanban-config)
// =====================================================
export interface PaisKanban {
  countryKey: string        // "italia", "franca"...
  countryLabel: string      // "Itália", "França"...
  flag: string | null       // emoji 🇮🇹 (no Windows aparece como IT)
}

// Fase do Workflow Macro = coluna do kanban
export interface FaseKanban {
  phaseKey: string          // "genealogia", "analise_documental"...
  label: string             // "Genealogia"...
  ordem: number
}

// Tipo de processo do motor + as fases dele (colunas do board)
export interface TipoKanban {
  id: number
  code: string
  name: string              // "Cidadania Italiana · Judicial"
  countryKey: string
  modalityLabel: string
  fases: FaseKanban[]       // só as showInKanban, em ordem
}

// Cor do país (CatalogoPais não guarda cor → cores fixas pros conhecidos
// + cor determinística da paleta pros novos)
const CORES_FIXAS: Record<string, string> = {
  portugal: '#006600',
  espanha: '#c60b1e',
  alemanha: '#000000',
  italia: '#009246',
}
const PALETA = ['#0055A4', '#7c3aed', '#0891b2', '#ea580c', '#be123c', '#4d7c0f', '#b45309', '#1d4ed8']
export function corDoPais(countryKey: string): string {
  const k = (countryKey || '').toLowerCase()
  if (CORES_FIXAS[k]) return CORES_FIXAS[k]
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 99991
  return PALETA[h % PALETA.length]
}

// =====================================================
// INTERFACES BASE
// =====================================================

/** LEGADO — colunas antigas editadas na mão. O kanban não usa mais. */
export interface Status {
  id: number
  nome: string
  ordem?: number
  pais?: string
  faseCode?: string | null
  _count?: {
    processos: number
  }
}

export interface Usuario {
  id: number
  nome: string
  email: string
  tipo?: string
}

// =====================================================
// CONTRATANTE - CLIENTE QUE CONTRATA
// =====================================================
export interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
  createdAt?: string
  updatedAt?: string
  _count?: {
    processos: number
  }
}

// =====================================================
// REQUERENTE - QUEM VAI RECEBER CIDADANIA
// =====================================================
export interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
  createdAt?: string
  updatedAt?: string
}

// =====================================================
// TAREFA - AFAZERES DOS FUNCIONÁRIOS
// =====================================================
export interface Tarefa {
  id: number
  titulo: string
  descricao?: string | null
  processoId: number
  responsavelId?: number | null
  responsavel?: Usuario | null
  concluida: boolean
  prioridade: PrioridadeTarefa
  dataPrazo?: string | null
  dataConclusao?: string | null
  createdAt?: string
  updatedAt?: string
  processo?: {
    id: number
    nome: string
    pais: string
  }
}

// =====================================================
// PROCESSO - CARD DO KANBAN (FAMÍLIA)
// =====================================================
export interface Processo {
  id: number
  nome: string
  descricao?: string | null
  observacoes?: string | null
  pais: string                        // countryKey ("italia")
  faseAtualKey?: string | null        // fase do motor = coluna atual
  tipoProcessoMotorId?: number | null // vínculo com o tipo do motor
  contratantes?: Contratante[]
  arvoreId?: number | null
  arvore?: {
    id: number
    nome: string
  } | null
  dataInicio?: string
  previsaoTermino?: string | null
  dataConclusao?: string | null
  createdAt?: string
  updatedAt?: string
  requerentes?: Requerente[]
  tarefas?: Tarefa[]
  _count?: {
    tarefas: number
    anexos: number
  }
}

/** @deprecated LEGADO — alias de Processo (o kanban novo agrupa por faseAtualKey).
 * Mantido só porque muitos arquivos importam esse nome. */
export type ProcessoWithStatus = Processo

// =====================================================
// DADOS AGREGADOS POR PAÍS (para o Kanban)
// =====================================================
export interface DadosPais {
  pais: PaisKanban
  tipos: TipoKanban[]
  processos: Processo[]
}

// =====================================================
// TIPOS PARA CRIAÇÃO/EDIÇÃO
// =====================================================
export interface CriarProcesso {
  nome: string
  descricao?: string
  observacoes?: string
  pais: string                   // countryKey
  tipoProcessoMotorId: number    // obrigatório — é o que liga no motor
  contratanteIds?: number[]
  requerenteIds?: number[]
  arvoreId?: number
  previsaoTermino?: string
}

export interface AtualizarProcesso {
  nome?: string
  descricao?: string
  observacoes?: string
  faseAtualKey?: string
  contratanteIds?: number[]
  requerenteIds?: number[]
  arvoreId?: number | null
  previsaoTermino?: string | null
  dataConclusao?: string | null
}

export interface CriarTarefa {
  titulo: string
  descricao?: string
  processoId: number
  responsavelId?: number
  prioridade?: PrioridadeTarefa
  dataPrazo?: string
}

export interface AtualizarTarefa {
  titulo?: string
  descricao?: string
  responsavelId?: number | null
  prioridade?: PrioridadeTarefa
  dataPrazo?: string | null
  concluida?: boolean
}

// =====================================================
// LEGADO - Manter para compatibilidade temporária
// (código antigo fora do kanban pode importar; NÃO usar em código novo)
// =====================================================

/** @deprecated País agora é dinâmico (CatalogoPais/countryKey). */
export enum Pais {
  PORTUGAL = 'PORTUGAL',
  ESPANHA = 'ESPANHA',
  ALEMANHA = 'ALEMANHA',
  ITALIA = 'ITALIA'
}

/** @deprecated Use corDoPais(countryKey) + dados do CatalogoPais. */
export const PAISES_CONFIG: Record<Pais, {
  label: string
  bandeira: string
  cor: string
  corClara: string
}> = {
  [Pais.PORTUGAL]: { label: 'Portugal', bandeira: '🇵🇹', cor: '#006600', corClara: '#00660020' },
  [Pais.ESPANHA]: { label: 'Espanha', bandeira: '🇪🇸', cor: '#c60b1e', corClara: '#c60b1e20' },
  [Pais.ALEMANHA]: { label: 'Alemanha', bandeira: '🇩🇪', cor: '#000000', corClara: '#00000020' },
  [Pais.ITALIA]: { label: 'Itália', bandeira: '🇮🇹', cor: '#009246', corClara: '#00924620' },
}

/** @deprecated Use a lista de países do /api/kanban-config. */
export const PAISES_LISTA = Object.values(Pais)

/** @deprecated Use Processo ao invés de Atividade */
export interface Atividade {
  id: number
  nome: string
  descricao: string | null
  pais: string
  statusId: number
  data_termino?: string | null
  data_criacao?: string
  arvore_id?: number | null
  contratanteId?: number | null
  contratante?: Contratante | null
  requerentes?: Requerente[]
}

/** @deprecated Use Processo ao invés de AtividadeWithStatus */
export interface AtividadeWithStatus extends Atividade {
  status: Status
}