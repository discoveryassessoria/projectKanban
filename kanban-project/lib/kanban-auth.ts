// lib/kanban-auth.ts
// Utilitário para extrair usuário do token JWT do kanban no backend.

import { verifyAuthToken } from './auth-jwt'

export interface KanbanTokenPayload {
  userId: number
  email: string
  tipo: string
  /** Expiração em **milissegundos** (compat com código antigo) */
  exp: number
}

/**
 * Extrai e valida token JWT do kanban a partir do header Authorization.
 *
 * 🆕 Agora **async** porque a validação JWT envolve crypto async.
 * Quem chamava sem `await` antes precisa adicionar `await`.
 *
 * Retorna `null` em qualquer falha (header faltando, token inválido,
 * expirado, ou sem campos obrigatórios).
 */
export async function extrairUsuarioKanban(
  request: Request
): Promise<KanbanTokenPayload | null> {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.substring(7)

    // 🆕 Validação JWT real (jose, HS256). Antes era atob() + JSON.parse,
    // que aceitava qualquer string base64 — inclusive forjada.
    const decoded = await verifyAuthToken(token)
    if (!decoded) return null

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