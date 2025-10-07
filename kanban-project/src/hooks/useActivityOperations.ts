import { useState, useCallback } from 'react'
import { ActivityService } from '@/src/services/activityService'

interface UseActivityOperationsReturn {
  updateDeadline: (id: number, newDeadline: string | null) => Promise<boolean>
  updateStatus: (id: number, statusId: number) => Promise<boolean>
  isUpdating: boolean
  error: string | null
  clearError: () => void
}

export function useActivityOperations(): UseActivityOperationsReturn {
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const updateDeadline = useCallback(async (
    id: number, 
    newDeadline: string | null
  ): Promise<boolean> => {
    try {
      setIsUpdating(true)
      setError(null)
      
      await ActivityService.updateDeadline(id, newDeadline)
      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido'
      setError(errorMessage)
      console.error('Erro ao atualizar prazo:', errorMessage)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [])

  const updateStatus = useCallback(async (
    id: number, 
    statusId: number
  ): Promise<boolean> => {
    try {
      setIsUpdating(true)
      setError(null)
      
      await ActivityService.updateStatus(id, statusId)
      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido'
      setError(errorMessage)
      console.error('Erro ao atualizar status:', errorMessage)
      return false
    } finally {
      setIsUpdating(false)
    }
  }, [])

  return {
    updateDeadline,
    updateStatus,
    isUpdating,
    error,
    clearError
  }
}