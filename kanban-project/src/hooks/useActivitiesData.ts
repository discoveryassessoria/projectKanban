/**
 * Hooks para gerenciamento de dados com cache usando SWR
 * Centraliza fetches e evita requisições redundantes
 */
import useSWR, { mutate } from 'swr'
import { Pais } from '@prisma/client'

// Tipos compartilhados
interface Usuario {
  nome: string
  email: string
}

interface Status {
  id?: number
  nome: string
}

interface UserAtv {
  usuario: Usuario
}

interface Contratante {
  id: number
  nome: string
  email: string | null
}

interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  pais: Pais
  status: Status
  contratante: Contratante | null
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
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  keepPreviousData: true,
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
    error: error?.message,
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
    `/api/activities/calendar?year=${year}&month=${month}`,
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
    enabled && date ? `/api/activities/day?date=${date}` : null,
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

// Invalidar cache de atividades (todas as queries de activities)
export function invalidateActivities() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/activities'))
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

// Invalidar tudo
export function invalidateAll() {
  invalidateActivities()
  invalidateStatuses()
  invalidateUsers()
}

// Tipos exportados
export type { Atividade, Status, Usuario, UserAtv, Contratante }