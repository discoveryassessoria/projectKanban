"use client"

import { useState, useCallback } from "react"
import { PrazoCategory } from "@/src/utils/prazoUtils"
import { QuickAddFormData } from "@/src/components/activitiesComponents/QuickAddModal"
import { toast } from "@/src/hooks/use-toast"

interface UseQuickAddActivityOptions {
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function useQuickAddActivity({ onSuccess, onError }: UseQuickAddActivityOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Função para calcular data baseada na categoria de prazo
  const calculateDateForCategory = useCallback((category: PrazoCategory): string | null => {
    const now = new Date()
    
    switch (category) {
      case 'vencido':
        // Um dia atrás
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        return yesterday.toISOString()
        
      case 'hoje':
        // Hoje, mas no final do dia
        const today = new Date(now)
        today.setHours(23, 59, 59, 999)
        return today.toISOString()
        
      case 'proximos-3-dias':
        // Em 2 dias (dentro dos próximos 3)
        const in2Days = new Date(now)
        in2Days.setDate(now.getDate() + 2)
        in2Days.setHours(23, 59, 59, 999)
        return in2Days.toISOString()
        
      case 'proxima-semana':
        // Em 5 dias (próxima semana)
        const in5Days = new Date(now)
        in5Days.setDate(now.getDate() + 5)
        in5Days.setHours(23, 59, 59, 999)
        return in5Days.toISOString()
        
      case 'futuro':
        // Em 15 dias
        const in15Days = new Date(now)
        in15Days.setDate(now.getDate() + 15)
        in15Days.setHours(23, 59, 59, 999)
        return in15Days.toISOString()
        
      case 'sem-prazo':
        // Sem prazo
        return null
        
      default:
        return null
    }
  }, [])

  // Função para buscar status padrão (não mais necessária pois agora é selecionado no form)
  const getDefaultStatus = useCallback(async (): Promise<number> => {
    try {
      const response = await fetch('/api/status')
      if (!response.ok) {
        throw new Error('Erro ao buscar status')
      }
      
      const data = await response.json()
      const statuses = data.status || []
      
      // Procurar por status padrão como "A Fazer", "Pendente", etc.
      const defaultStatus = statuses.find((status: any) => 
        status.nome.toLowerCase().includes('fazer') ||
        status.nome.toLowerCase().includes('pendente') ||
        status.nome.toLowerCase().includes('novo')
      )
      
      if (defaultStatus) {
        return defaultStatus.id
      }
      
      // Se não encontrar, usar o primeiro status disponível
      if (statuses.length > 0) {
        return statuses[0].id
      }
      
      throw new Error('Nenhum status disponível')
    } catch (error) {
      console.error('Erro ao buscar status padrão:', error)
      throw error
    }
  }, [])

  // Função principal para criar atividade
  const createQuickActivity = useCallback(async (formData: QuickAddFormData): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      // Calcular data de término baseada na categoria
      const dataTermino = calculateDateForCategory(formData.prazo_category as PrazoCategory)
      
      // Validação se status foi selecionado
      if (!formData.status_id || formData.status_id === 0) {
        throw new Error('Status é obrigatório')
      }

      // Preparar dados para envio
      const activityData = {
        nome: formData.nome.trim(),
        descricao: formData.descricao.trim() || null,
        data_termino: dataTermino,
        projeto_id: formData.projeto_id,
        status_id: formData.status_id,
        prazo_category: formData.prazo_category
      }

      // Fazer request para API
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(activityData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Erro ao criar atividade')
      }

      const newActivity = await response.json()
      
      // Toast de sucesso
      toast({
        title: "Atividade criada com sucesso!",
        description: `"${formData.nome}" foi adicionada ao projeto.`,
        variant: "success",
      })
      
      // Callback de sucesso
      if (onSuccess) {
        onSuccess()
      }

      return newActivity
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido ao criar atividade'
      setError(errorMessage)
      
      // Toast de erro
      toast({
        title: "Erro ao criar atividade",
        description: errorMessage,
        variant: "destructive",
      })
      
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