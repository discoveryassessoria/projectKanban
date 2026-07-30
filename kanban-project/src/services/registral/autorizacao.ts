// src/services/registral/autorizacao.ts
//
// MRG — ponte entre o sistema de permissões DO DISCOVERY e o motor registral.
//
// Não existe autenticação paralela aqui: reusa `extrairUsuarioComPermissoes`
// (JWT + Perfil + permissoesCustom). Este módulo só traduz aquele resultado no
// `AtorAplicacao` que os serviços do motor esperam, e centraliza a resposta 401/403
// para as rotas não divergirem entre si.

import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao, type PermissaoChave } from "@/src/lib/permissoes"
import type { AtorAplicacao } from "./aplicar"

export interface ContextoAutorizado {
  ator: AtorAplicacao
  usuarioId: number
  nome: string
  tipo: string
}

export type Autorizacao =
  | { ok: true; ctx: ContextoAutorizado }
  | { ok: false; resposta: NextResponse }

/**
 * Exige UMA permissão e devolve o ator. `ehMotor` é sempre false: rota HTTP é
 * sempre ação humana — o modo motor só existe no worker interno.
 */
export async function exigir(request: Request, permissao: PermissaoChave): Promise<Autorizacao> {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) {
    return { ok: false, resposta: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  if (!temPermissao(usuario.permissoes, permissao)) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Sem permissão para esta ação", permissao }, { status: 403 }),
    }
  }
  return {
    ok: true,
    ctx: {
      ator: { usuarioId: usuario.userId, permissoes: usuario.permissoes, ehMotor: false },
      usuarioId: usuario.userId,
      nome: usuario.nome,
      tipo: usuario.tipo,
    },
  }
}

/** Exige ALGUMA das permissões (leitura pode vir por mais de um caminho). */
export async function exigirAlguma(
  request: Request,
  permissoes: PermissaoChave[],
): Promise<Autorizacao> {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) {
    return { ok: false, resposta: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  if (!permissoes.some((p) => temPermissao(usuario.permissoes, p))) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { error: "Sem permissão para esta ação", permissoesAceitas: permissoes },
        { status: 403 },
      ),
    }
  }
  return {
    ok: true,
    ctx: {
      ator: { usuarioId: usuario.userId, permissoes: usuario.permissoes, ehMotor: false },
      usuarioId: usuario.userId,
      nome: usuario.nome,
      tipo: usuario.tipo,
    },
  }
}

/** Ator do MOTOR (worker interno). Nunca vem de request. */
export function atorMotor(): AtorAplicacao {
  return { usuarioId: null, permissoes: {}, ehMotor: true }
}

/** Erro padronizado das rotas do motor. */
export function erro(mensagem: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: mensagem, ...(extra ?? {}) }, { status })
}

/** Converte parâmetro de rota em inteiro positivo, ou null. */
export function idDe(v: string | undefined): number | null {
  const n = Number.parseInt(String(v ?? ""), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
