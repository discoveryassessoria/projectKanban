// lib/api-auth.ts
// ============================================================
// Autenticação JWT real para rotas de API (/api/*).
//
// ⚠️ ARQUIVO DORMENTE: este arquivo não altera comportamento
// nenhum do sistema enquanto as rotas não o importarem.
// Foi criado em conjunto com o expediente de segurança para
// permitir a troca do token Base64 atual (inseguro) por JWT
// assinado com segredo do servidor (JWT_SECRET).
//
// Para ativar:
//   1. Garantir que JWT_SECRET está nas env vars (Production/Preview)
//   2. Emitir tokens via `gerarTokenEquipe(...)` no login
//   3. Validar nas rotas via `getUsuarioLogado(request)`
//   4. Substituir usos de `extrairUsuarioKanban` (kanban-auth.ts)
//      por esta lib. Manter kanban-auth.ts existente durante a
//      transição para não quebrar rotas antigas.
// ============================================================

import { NextRequest, NextResponse } from "next/server"
import jwt from "jsonwebtoken"
import { prisma } from "@/lib/prisma"
import {
  calcularPermissoes,
  temPermissao,
  type MapaPermissoes,
  type PermissaoChave,
} from "@/src/lib/permissoes"

const JWT_SECRET = process.env.JWT_SECRET

// ============================================================
// TIPOS
// ============================================================

export interface UsuarioLogado {
  id: number
  nome: string
  email: string
  tipo: string
  perfilId: number | null
  permissoes: MapaPermissoes
}

export interface TokenPayloadEquipe {
  id: number
  email: string
  tipo: string
  iat?: number
  exp?: number
}

// ============================================================
// GERAR / VERIFICAR TOKEN
// ============================================================

/**
 * Gera um JWT assinado para um usuário da equipe interna.
 * Validade padrão: 7 dias.
 */
export function gerarTokenEquipe(payload: {
  id: number
  email: string
  tipo: string
}): string {
  if (!JWT_SECRET) {
    throw new Error("[api-auth] JWT_SECRET não está configurado")
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" })
}

/**
 * Verifica e decodifica um JWT.
 * Retorna null se inválido, expirado ou se JWT_SECRET não estiver configurado.
 */
export function verificarTokenEquipe(token: string): TokenPayloadEquipe | null {
  if (!JWT_SECRET) return null
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayloadEquipe
  } catch {
    return null
  }
}

// ============================================================
// EXTRAIR TOKEN DA REQUISIÇÃO
// ============================================================

/**
 * Procura o token em:
 *   1. Header Authorization: Bearer <token>
 *   2. Cookie authToken
 */
function extrairToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7)
  }
  const cookie = request.cookies.get("authToken")?.value
  if (cookie) return cookie
  return null
}

// ============================================================
// OBTER USUÁRIO LOGADO (COM PERMISSÕES EFETIVAS)
// ============================================================

/**
 * Retorna o usuário autenticado com permissões efetivas já calculadas.
 * Retorna null se o token for inválido, expirado, ou se o usuário não
 * existir mais no banco.
 *
 * Uso recomendado:
 *   const usuario = await getUsuarioLogado(request)
 *   if (!usuario) return respostaNaoAutenticado()
 */
export async function getUsuarioLogado(
  request: NextRequest
): Promise<UsuarioLogado | null> {
  const token = extrairToken(request)
  if (!token) return null

  const payload = verificarTokenEquipe(token)
  if (!payload) return null

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.id },
    include: { perfil: true },
  })

  if (!usuario) return null

  const perfilPermissoes =
    (usuario.perfil?.permissoes as MapaPermissoes) || null
  const permissoesCustom =
    (usuario.permissoesCustom as MapaPermissoes) || null

  const permissoes = calcularPermissoes(
    usuario.tipo,
    perfilPermissoes,
    permissoesCustom
  )

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    tipo: usuario.tipo,
    perfilId: usuario.perfilId,
    permissoes,
  }
}

// ============================================================
// RESPOSTAS PADRÃO
// ============================================================

export function respostaNaoAutenticado() {
  return NextResponse.json(
    { error: "Não autenticado" },
    { status: 401 }
  )
}

export function respostaSemPermissao(permissao?: string) {
  return NextResponse.json(
    {
      error: "Sem permissão para executar esta ação",
      permissaoNecessaria: permissao,
    },
    { status: 403 }
  )
}

// ============================================================
// GUARDS (HELPERS PARA USAR NO TOPO DE UMA ROTA)
// ============================================================

/**
 * Exige autenticação. Se não tiver, retorna 401 pronto.
 *
 * Uso:
 *   const auth = await exigirAutenticacao(request)
 *   if (auth instanceof NextResponse) return auth
 *   const usuario = auth  // UsuarioLogado
 */
export async function exigirAutenticacao(
  request: NextRequest
): Promise<UsuarioLogado | NextResponse> {
  const usuario = await getUsuarioLogado(request)
  if (!usuario) return respostaNaoAutenticado()
  return usuario
}

/**
 * Exige autenticação + permissão específica.
 *
 * Uso:
 *   const auth = await exigirPermissao(request, "financeiro.pagamento_editar")
 *   if (auth instanceof NextResponse) return auth
 *   const usuario = auth
 */
export async function exigirPermissao(
  request: NextRequest,
  permissao: PermissaoChave
): Promise<UsuarioLogado | NextResponse> {
  const usuario = await getUsuarioLogado(request)
  if (!usuario) return respostaNaoAutenticado()
  if (!temPermissao(usuario.permissoes, permissao)) {
    return respostaSemPermissao(permissao)
  }
  return usuario
}
