/**
 * Hooks para gerenciamento de dados com cache usando SWR
 * Centraliza fetches e evita requisições redundantes
 */

import useSWR, { mutate } from 'swr'

// Tipos compartilhados
interface Usuario {
  nome: string
  email: string
}

interface Projeto {
  id?: number
  nome: string
  descricao: string | null
  _count?: {
    atividades: number
  }
}

interface Status {
  id?: number
  nome: string
}

interface UserAtv {
  usuario: Usuario
}

interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  projeto: Projeto
  status: Status
  usuarios: UserAtv[]
}

// Fetcher genérico para SWR
const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Erro ao carregar dados')
  }
  return response.json()
}

// Configuração padrão do SWR
const swrConfig = {
  revalidateOnFocus: false, // Não revalidar ao focar na janela
  revalidateOnReconnect: true, // Revalidar ao reconectar
  dedupingInterval: 2000, // Evitar requisições duplicadas em 2 segundos
  keepPreviousData: true, // Manter dados anteriores durante revalidação (evita flicker)
}

/**
 * Hook para buscar atividades com filtros
 * @param filters - Filtros opcionais para atividades
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
  const url = `/api/activities${queryString ? `?${queryString}` : ''}`
  
  const { data, error, isLoading, mutate: revalidate } = useSWR<Atividade[]>(
    url,
    fetcher,
    swrConfig
  )
  
  return {
    activities: data,
    isLoading,
    error,
    revalidate,
    mutate: revalidate // Alias para compatibilidade
  }
}

/**
 * Hook para buscar projetos
 */
export function useProjects() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<{ projetos: Projeto[] }>(
    '/api/projetos',
    fetcher,
    swrConfig
  )
  
  return {
    projects: data?.projetos || [],
    isLoading,
    error,
    revalidate,
    mutate: revalidate
  }
}

/**
 * Hook para buscar status
 */
export function useStatuses() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<{ status: Status[] }>(
    '/api/status',
    fetcher,
    swrConfig
  )
  
  return {
    statuses: data?.status || [],
    isLoading,
    error,
    revalidate,
    mutate: revalidate
  }
}

/**
 * Hook para buscar usuários
 */
export function useUsers() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<Usuario[]>(
    '/api/usuarios',
    fetcher,
    swrConfig
  )
  
  return {
    users: data || [],
    isLoading,
    error,
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
    `/api/activities/calendar?year=${year}&month=${month}`,
    fetcher,
    swrConfig
  )
  
  return {
    calendarData: data || [],
    isLoading,
    error,
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
    enabled && date ? `/api/activities/day?date=${date}` : null,
    fetcher,
    swrConfig
  )
  
  return {
    dayData: data,
    isLoading,
    error,
    revalidate
  }
}

/**
 * Funções utilitárias para invalidar cache
 */

// Invalidar cache de atividades (todas as queries de activities)
export function invalidateActivities() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/activities'))
}

// Invalidar cache de projetos
export function invalidateProjects() {
  mutate('/api/projetos')
}

// Invalidar cache de status
export function invalidateStatuses() {
  mutate('/api/status')
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
  
  return {
    contratantes: data?.contratantes || [],
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
  
  return {
    requerentes: data?.requerentes || [],
    isLoading,
    error: error?.message,
    mutate: revalidate
  }
}

/**
 * Hook para buscar dados de um projeto específico
 */
export function useProject(projectId: number | null | undefined) {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    projectId ? `/api/projetos/${projectId}` : null,
    fetcher,
    swrConfig
  )
  
  return {
    project: data || null,
    isLoading,
    error: error?.message,
    mutate: revalidate
  }
}

// Invalidar cache de um projeto específico
export function invalidateProject(projectId: number) {
  mutate(`/api/projetos/${projectId}`, undefined, { revalidate: true })
}

// Invalidar tudo
export function invalidateAll() {
  invalidateActivities()
  invalidateProjects()
  invalidateStatuses()
  invalidateUsers()
}

// Tipos exportados
export type { Atividade, Projeto, Status, Usuario, UserAtv }
