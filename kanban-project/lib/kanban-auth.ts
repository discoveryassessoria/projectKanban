// lib/kanban-auth.ts
// Utilitário para extrair usuário do token do kanban no backend

export interface KanbanTokenPayload {
  userId: number
  email: string
  tipo: string
  exp: number
}

/**
 * Extrair e validar token do kanban a partir do header Authorization
 * O token do kanban é base64(JSON) com { userId, email, tipo, exp }
 */
export function extrairUsuarioKanban(request: Request): KanbanTokenPayload | null {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.substring(7)
    const decoded = JSON.parse(atob(token))

    // Validar campos obrigatórios
    if (!decoded.userId || !decoded.email || !decoded.tipo) return null

    // Verificar expiração
    if (decoded.exp && decoded.exp < Date.now()) return null

    return {
      userId: decoded.userId,
      email: decoded.email,
      tipo: decoded.tipo,
      exp: decoded.exp,
    }
  } catch {
    return null
  }
}