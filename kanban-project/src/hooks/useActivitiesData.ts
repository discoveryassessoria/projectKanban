/**
 * Hooks para gerenciamento de dados com cache usando SWR
 * Centraliza fetches e evita requisições redundantes
 */
import useSWR, { mutate } from 'swr'
import { Pais } from '@prisma/client'

// Tipos compartilhados
export interface Usuario {
  id?: number
  nome: string
  email?: string
}

export interface Status {
  id?: number
  nome: string
  pais?: string
}

export interface UserAtv {
  usuario: Usuario
}

export interface Contratante {
  id: number
  nome: string
  email: string | null
}

export interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  pais: Pais
  status: Status | null
  contratante: Contratante | null
  usuarios: UserAtv[]
  // Campos extras para compatibilidade
  processo?: {
    id: number
    nome: string
    pais?: Pais
  }
  responsavel?: Usuario | null
  concluida?: boolean
  prioridade?: string
}

// Tipo da resposta da API de tarefas
interface TarefaAPI {
  id: number
  titulo: string
  descricao: string | null
  dataPrazo: string | null
  createdAt: string
  pais: Pais | null
  status: Status | null
  statusId: number | null
  processo: {
    id: number
    nome: string
    pais?: Pais
  } | null
  responsavel: Usuario | null
  concluida: boolean
  prioridade: string
  subtarefas?: TarefaAPI[]
}

// Fetcher genérico para SWR com tratamento de erro melhorado
const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    // Se for 404 ou 401, retorna array vazio silenciosamente
    if (response.status === 404 || response.status === 401) {
      console.warn(`API ${url} retornou ${response.status}`)
      return []
    }
    throw new Error('Erro ao carregar dados')
  }
  return response.json()
}

// Fetcher com autenticação
const fetcherWithAuth = async (url: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const response = await fetch(url, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  })
  if (!response.ok) {
    if (response.status === 404 || response.status === 401) {
      console.warn(`API ${url} retornou ${response.status}`)
      return []
    }
    throw new Error('Erro ao carregar dados')
  }
  return response.json()
}

// Configuração padrão do SWR
const swrConfig = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  keepPreviousData: true,
  onErrorRetry: (error: any, key: string, config: any, revalidate: any, { retryCount }: any) => {
    // Não retentar em erros 404 ou 401
    if (error?.status === 404 || error?.status === 401) return
    // Máximo de 3 tentativas
    if (retryCount >= 3) return
    // Retentar após 5 segundos
    setTimeout(() => revalidate({ retryCount }), 5000)
  }
}

/**
 * Função para gerar status baseado no campo concluida
 */
function getStatusFromConcluida(concluida: boolean): Status {
  return concluida 
    ? { id: -1, nome: 'Concluída' }
    : { id: -2, nome: 'Pendente' }
}

/**
 * Função para mapear tarefa da API para o formato esperado pelo componente
 */
function mapTarefaToAtividade(tarefa: TarefaAPI): Atividade {
  return {
    id: tarefa.id,
    nome: tarefa.titulo, // titulo -> nome
    descricao: tarefa.descricao,
    data_termino: tarefa.dataPrazo, // dataPrazo -> data_termino
    data_criacao: tarefa.createdAt, // createdAt -> data_criacao
    pais: tarefa.pais || tarefa.processo?.pais || 'PORTUGAL' as Pais,
    // Usar status baseado em concluida ao invés do status do processo
    status: getStatusFromConcluida(tarefa.concluida),
    contratante: null,
    usuarios: tarefa.responsavel 
      ? [{ usuario: tarefa.responsavel }] 
      : [],
    // Campos extras
    processo: tarefa.processo || undefined,
    responsavel: tarefa.responsavel,
    concluida: tarefa.concluida,
    prioridade: tarefa.prioridade
  }
}

/**
 * Hook para buscar atividades com filtros
 * Usa /api/tarefas (nome correto da API no sistema)
 */
export function useActivities(filters?: any) {
  // Construir query string com filtros
  const params = new URLSearchParams()
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== '' && value !== 'all') {
        params.append(key, value as string)
      }
    })
  }
  
  const queryString = params.toString()
  // Usar /api/tarefas (nome correto da API)
  const url = `/api/tarefas${queryString ? `?${queryString}` : ''}`
  
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    url,
    fetcher,
    swrConfig
  )
  
  // Normalizar resposta e mapear campos
  let rawTarefas: TarefaAPI[] = []
  
  if (Array.isArray(data)) {
    rawTarefas = data
  } else if (data?.tarefas) {
    rawTarefas = data.tarefas
  } else if (data?.atividades) {
    rawTarefas = data.atividades
  }
  
  // Mapear tarefas para o formato esperado pelo componente
  const activities: Atividade[] = rawTarefas.map(mapTarefaToAtividade)
  
  return {
    activities,
    isLoading,
    error: error?.message,
    revalidate,
    mutate: revalidate
  }
}

/**
 * Hook para obter lista de países (enum fixo)
 */
export function usePaises() {
  // Países são fixos, não precisam de fetch
  const paises = Object.values(Pais)
  return {
    paises,
    isLoading: false,
    error: null
  }
}

/**
 * Hook para buscar status
 * @param pais - País opcional para filtrar status (se não passar, busca todos)
 */
export function useStatuses(pais?: string) {
  // Construir URL com filtro de país se fornecido
  const url = pais && pais !== 'all' 
    ? `/api/status?pais=${pais}` 
    : '/api/status'
  
  const { data, error, isLoading, mutate: revalidate } = useSWR<{ status: Status[] } | Status[]>(
    url,
    fetcher,
    swrConfig
  )
  
  // Normalizar resposta
  let statuses = Array.isArray(data) 
    ? data 
    : (data as any)?.status || []
  
  // Remover duplicatas por nome (caso a API não filtre corretamente)
  if (pais && pais !== 'all') {
    // Se temos um país específico, já deve vir filtrado da API
    // Mas por segurança, removemos duplicatas
    const seen = new Set<string>()
    statuses = statuses.filter((s: Status) => {
      if (seen.has(s.nome)) return false
      seen.add(s.nome)
      return true
    })
  } else {
    // Se não tem país, retorna lista única de nomes (sem duplicatas)
    const seen = new Set<string>()
    statuses = statuses.filter((s: Status) => {
      if (seen.has(s.nome)) return false
      seen.add(s.nome)
      return true
    })
  }
  
  return {
    statuses,
    isLoading,
    error: error?.message,
    revalidate,
    mutate: revalidate
  }
}

/**
 * Hook para buscar usuários
 */
export function useUsers() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<Usuario[] | { usuarios: Usuario[] }>(
    '/api/usuarios',
    fetcherWithAuth,
    swrConfig
  )
  
  // Normalizar resposta
  const users = Array.isArray(data) 
    ? data 
    : (data as any)?.usuarios || []
  
  return {
    users,
    isLoading,
    error: error?.message,
    revalidate,
    mutate: revalidate
  }
}

/**
 * Hook para buscar dados do calendário
 * @param year - Ano
 * @param month - Mês (1-12)
 */
export function useCalendarData(year: number, month: number) {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    `/api/tarefas/calendar?year=${year}&month=${month}`,
    fetcher,
    swrConfig
  )
  
  return {
    calendarData: data || [],
    isLoading,
    error: error?.message,
    revalidate
  }
}

/**
 * Hook para buscar dados de um dia específico
 * @param date - Data no formato YYYY-MM-DD
 * @param enabled - Se deve buscar os dados
 */
export function useDayData(date: string | null, enabled = true) {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    enabled && date ? `/api/tarefas/day?date=${date}` : null,
    fetcher,
    swrConfig
  )
  
  return {
    dayData: data,
    isLoading,
    error: error?.message,
    revalidate
  }
}

/**
 * Funções utilitárias para invalidar cache
 */

// Invalidar cache de atividades (todas as queries de tarefas)
export function invalidateActivities() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/tarefas'))
}

// Invalidar cache de status
export function invalidateStatuses() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/status'))
}

// Invalidar cache de usuários
export function invalidateUsers() {
  mutate('/api/usuarios')
}

/**
 * Hook para buscar contratantes
 */
export function useContratantes() {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    '/api/contratantes',
    fetcher,
    swrConfig
  )
  
  // Normalizar resposta
  const contratantes = Array.isArray(data) 
    ? data 
    : (data as any)?.contratantes || []
  
  return {
    contratantes,
    isLoading,
    error: error?.message,
    mutate: revalidate
  }
}

/**
 * Hook para buscar requerentes
 */
export function useRequerentes() {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    '/api/requerentes',
    fetcher,
    swrConfig
  )
  
  // Normalizar resposta
  const requerentes = Array.isArray(data) 
    ? data 
    : (data as any)?.requerentes || []
  
  return {
    requerentes,
    isLoading,
    error: error?.message,
    mutate: revalidate
  }
}

// Invalidar tudo
export function invalidateAll() {
  invalidateActivities()
  invalidateStatuses()
  invalidateUsers()
}