/**
 * Hook para criação rápida de tarefas
 * Usa a API /api/tarefas
 */
import { useState, useCallback } from 'react'
import { invalidateActivities } from './useActivitiesData'
import { PrazoCategory } from "@/src/utils/prazoUtils"

// Tipo flexível para aceitar ambos os formatos de form data
interface QuickAddFormData {
  nome: string
  descricao?: string
  prioridade?: string
  responsavelId?: number | null
  processoId?: number | null
  prazo_category: string
  // Campos antigos para compatibilidade (ignorados)
  projeto_id?: number
  status_id?: number
}

interface UseQuickAddActivityOptions {
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function useQuickAddActivity({ onSuccess, onError }: UseQuickAddActivityOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Função para calcular data baseada na categoria de prazo
  const calculateDateForCategory = useCallback((category: string): string | null => {
    const now = new Date()
    
    switch (category) {
      case 'vencido':
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        return yesterday.toISOString()
        
      case 'hoje':
        const today = new Date(now)
        today.setHours(23, 59, 59, 999)
        return today.toISOString()
        
      case 'proximos-3-dias':
        const in2Days = new Date(now)
        in2Days.setDate(now.getDate() + 2)
        in2Days.setHours(23, 59, 59, 999)
        return in2Days.toISOString()
        
      case 'proxima-semana':
        const in5Days = new Date(now)
        in5Days.setDate(now.getDate() + 5)
        in5Days.setHours(23, 59, 59, 999)
        return in5Days.toISOString()
        
      case 'futuro':
        const in15Days = new Date(now)
        in15Days.setDate(now.getDate() + 15)
        in15Days.setHours(23, 59, 59, 999)
        return in15Days.toISOString()
        
      case 'sem-prazo':
      default:
        return null
    }
  }, [])

  // Função principal para criar tarefa
  const createQuickActivity = useCallback(async (formData: QuickAddFormData): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      // Calcular data de prazo baseada na categoria
      const dataPrazo = calculateDateForCategory(formData.prazo_category)

      // Preparar dados para a API de tarefas
      const tarefaData = {
        titulo: formData.nome.trim(),
        descricao: formData.descricao?.trim() || null,
        prioridade: formData.prioridade || 'MEDIA',
        responsavelId: formData.responsavelId || null,
        processoId: formData.processoId || null,
        dataPrazo: dataPrazo
      }

      // Fazer request para API de tarefas
      const response = await fetch('/api/tarefas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tarefaData)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Erro ao criar tarefa')
      }

      const result = await response.json()

      // Invalidar cache para recarregar lista
      invalidateActivities()

      // Callback de sucesso
      if (onSuccess) {
        onSuccess()
      }

      return result.tarefa
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido ao criar tarefa'
      setError(errorMessage)
      
      if (onError) {
        onError(errorMessage)
      }
      
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [calculateDateForCategory, onSuccess, onError])

  // Função para limpar erro
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    createQuickActivity,
    isLoading,
    error,
    clearError
  }
}