// src/lib/tarefa-acesso.ts
//
// ETAPA 4 — SEGURANÇA DE TAREFAS (anti-IDOR).
// Cadeado de DONO no backend: um usuário comum só mexe/vê a PRÓPRIA tarefa
// (ou uma sem dono). Admin vê tudo. O frontend NÃO é camada de segurança —
// esta checagem roda no servidor, sempre.
//
// Regra igual à da lista /api/tarefas (GET): dono = a tarefa é do usuário
// OU está sem responsável. Admin ignora a regra.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"

/**
 * Confere se o usuário do request PODE acessar/mexer numa tarefa.
 * @returns null se PODE; ou uma Response de erro (401/403) se NÃO pode.
 *
 * Uso nas rotas: buscar a tarefa → checar existência (404) → então:
 *   const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
 *   if (negado) return negado
 */
export async function negarSeNaoForDonoDaTarefa(
  request: Request,
  responsavelId: number | null,
): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioKanban(request)

  // Sem token válido → nem entra
  if (!usuario) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  // Admin vê e mexe em tudo
  if (usuario.tipo === "admin") return null

  // Comum: só a própria tarefa OU uma sem dono (mesma régua da lista)
  const ehDono = responsavelId === usuario.userId || responsavelId === null
  if (!ehDono) {
    return NextResponse.json(
      { error: "Você não tem acesso a esta tarefa." },
      { status: 403 },
    )
  }

  return null
}

/**
 * Versão em LOTE — para rotas que mexem em várias tarefas de uma vez
 * (ex.: /api/tarefas/reordenar). Barra se QUALQUER tarefa da lista tiver
 * dono diferente do usuário (tarefa sem dono é permitida). Admin passa.
 *
 * @param ids  ids das tarefas que a ação vai alterar.
 * @returns null se PODE; ou uma Response de erro (401/403) se NÃO pode.
 */
export async function negarSeNaoForDonoDasTarefas(
  request: Request,
  ids: number[],
): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioKanban(request)

  if (!usuario) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  if (usuario.tipo === "admin") return null
  if (!ids || ids.length === 0) return null

  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: ids } },
    select: { responsavelId: true },
  })

  // Alguma tarefa com dono diferente do usuário? (sem dono = ok)
  const temAlheia = tarefas.some(
    (t) => t.responsavelId !== null && t.responsavelId !== usuario.userId,
  )
  if (temAlheia) {
    return NextResponse.json(
      { error: "Você não tem acesso a uma ou mais dessas tarefas." },
      { status: 403 },
    )
  }

  return null
}