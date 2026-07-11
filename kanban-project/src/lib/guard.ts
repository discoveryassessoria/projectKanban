// src/lib/guard.ts
// CP-SEC — Guard central de autenticação para uso DENTRO dos handlers.
//
// O middleware já garante autenticação no edge (401 para /api/* sem token
// válido), mas alguns handlers precisam da IDENTIDADE verificada do usuário
// (ex.: operar só sobre o próprio registro, checar admin). Este helper
// entrega o usuário verificado, ou uma resposta 401 pronta — sem jamais usar
// decodificação insegura de token.

import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

export interface UsuarioAutenticado {
  userId: number
  nome: string
  email: string
  tipo: string
  isAdmin: boolean
}

type GuardResultado =
  | { usuario: UsuarioAutenticado; erro: null }
  | { usuario: null; erro: NextResponse }

/**
 * Exige um usuário interno autenticado (JWT verificado via jose).
 *
 * Uso:
 * ```ts
 * const { usuario, erro } = await requireUsuario(request)
 * if (erro) return erro
 * // usuario.userId é confiável (veio da assinatura, não do body)
 * ```
 */
export async function requireUsuario(request: Request): Promise<GuardResultado> {
  const u = await extrairUsuarioComPermissoes(request)
  if (!u) {
    return {
      usuario: null,
      erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
    }
  }
  return {
    usuario: {
      userId: u.userId,
      nome: u.nome,
      email: u.email,
      tipo: u.tipo,
      isAdmin: u.tipo === "admin",
    },
    erro: null,
  }
}
