// src/app/api/auth/logout/route.ts
// ============================================================================
// LOGOUT — encerra a sessão no servidor: audita o motivo e apaga o cookie.
//
// Aceita token expirado de propósito: é justamente quando a sessão morre por
// inatividade que precisamos registrar QUEM expirou. Por isso a identidade é
// lida do token mesmo sem validade — sem conceder nada, só para auditar. Se
// nem isso for possível, o encerramento acontece assim mesmo (o cliente já
// está saindo); a trilha apenas fica sem autor.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { decodeJwt } from 'jose'
import { verifyAuthToken } from '@/lib/auth-jwt'
import { registrarEncerramento } from '@/lib/sessao/auditoria-acesso'
import { MOTIVO_LABEL, type MotivoEncerramento } from '@/lib/sessao/politica'

function tokenDaRequisicao(req: NextRequest): string | null {
  return req.cookies.get('authToken')?.value || req.headers.get('authorization')?.replace('Bearer ', '') || null
}

/** Identidade para AUDITAR — inclusive de token expirado. Nunca autoriza nada. */
async function identidadeParaAuditoria(token: string | null): Promise<{ id: number | null; email: string | null }> {
  if (!token) return { id: null, email: null }
  const valido = await verifyAuthToken(token).catch(() => null)
  if (valido) return { id: valido.userId, email: valido.email }
  try {
    const p = decodeJwt(token)
    return {
      id: typeof p.userId === 'number' ? p.userId : null,
      email: typeof p.email === 'string' ? p.email : null,
    }
  } catch {
    return { id: null, email: null }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const bruto = String((body as { motivo?: string })?.motivo ?? 'manual')
  const motivo: MotivoEncerramento = (bruto in MOTIVO_LABEL ? bruto : 'manual') as MotivoEncerramento

  const { id, email } = await identidadeParaAuditoria(tokenDaRequisicao(req))
  await registrarEncerramento(motivo, id, email, req)

  const res = NextResponse.json({ ok: true, motivo })
  // Expira o cookie no servidor: some para o middleware mesmo se o cliente falhar.
  res.cookies.set('authToken', '', { path: '/', maxAge: 0 })
  return res
}
