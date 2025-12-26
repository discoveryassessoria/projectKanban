// src/services/activityService.ts

interface UpdateActivityData {
  statusId?: number
  dataPrazo?: string | null  // ✅ Campo correto é dataPrazo
}

interface UpdateActivityResponse {
  success: boolean
  data: any
  message: string
}

interface ApiError {
  error: string
  details?: string
}

export class ActivityService {
  /**
   * Atualiza uma atividade com os dados fornecidos
   */
  static async updateActivity(
    id: number, 
    data: UpdateActivityData
  ): Promise<UpdateActivityResponse> {
    try {
      // ✅ CORRIGIDO: Endpoint /api/tarefas e método PUT
      const response = await fetch(`/api/tarefas/${id}`, {
        method: 'PUT',  // ✅ A API só suporta PUT, não PATCH
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData: ApiError = await response.json()
        throw new Error(errorData.error || 'Erro ao atualizar atividade')
      }

      return await response.json()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Erro de rede ao atualizar atividade')
    }
  }

  /**
   * Atualiza especificamente o prazo de uma atividade
   */
  static async updateDeadline(
    id: number, 
    newDeadline: string | null
  ): Promise<UpdateActivityResponse> {
    // ✅ CORRIGIDO: Campo correto é dataPrazo
    return this.updateActivity(id, { dataPrazo: newDeadline })
  }

  /**
   * Atualiza especificamente o status de uma atividade
   */
  static async updateStatus(
    id: number, 
    statusId: number
  ): Promise<UpdateActivityResponse> {
    return this.updateActivity(id, { statusId })
  }

  /**
   * Busca todas as atividades
   */
  static async getActivities(): Promise<any[]> {
    try {
      const response = await fetch('/api/tarefas')
      
      if (!response.ok) {
        throw new Error('Erro ao carregar atividades')
      }

      return await response.json()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Erro de rede ao carregar atividades')
    }
  }
}