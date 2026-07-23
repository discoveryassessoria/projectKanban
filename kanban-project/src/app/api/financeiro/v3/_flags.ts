// src/app/api/financeiro/v3/_flags.ts — helper compartilhado das rotas V3.
import { NextRequest } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { type UsuarioFlag } from '@/lib/financeiro/flags'

/** Converte o usuário autenticado no formato que os feature flags V3 entendem. */
export async function usuarioFlag(req: NextRequest): Promise<UsuarioFlag | null> {
  const u = await extrairUsuarioComPermissoes(req)
  if (!u) return null
  // permissoes é um MapaPermissoes (objeto) no domínio; a autorização V3 usa a
  // presença da chave granular. Admin é resolvido por tipo (cobre Preview+admin).
  const permsObj = (u.permissoes ?? {}) as Record<string, unknown>
  const permissoes = permsObj['financeiro.motor_v3'] ? ['financeiro.motor_v3'] : []
  return { id: u.userId ?? undefined, tipo: u.tipo ?? null, permissoes, isAdmin: u.tipo === 'admin' }
}
