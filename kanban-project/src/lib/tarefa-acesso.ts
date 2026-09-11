// src/lib/tarefa-acesso.ts
//
// ETAPA 4 — SEGURANÇA DE TAREFAS (anti-IDOR).
// Cadeado de DONO no backend: um usuário comum só mexe na PRÓPRIA tarefa.
// Admin mexe em tudo. O frontend NÃO é camada de segurança — esta checagem
// roda no servidor, sempre.
//
// SEM DONO ≠ QUALQUER UM PODE. "Está sem responsável" é motivo para permitir
// LEITURA (ver na lista, abrir o deep-link, ver o histórico) — é a régua de
// /api/tarefas (GET). Para EXECUTAR (iniciar, concluir, bloquear, agir num
// passo do workflow), sem dono é bloqueio: a tarefa precisa de responsável
// ANTES de alguém trabalhar nela, senão o trabalho fica em andamento sem
// ninguém por trás. `permiteSemDono` é o opt-in explícito para o caso de
// leitura; por padrão a função NEGA sem dono.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"

export interface OpcoesAcessoTarefa {
  /**
   * Sem dono NÃO é "qualquer um pode agir" — é "ninguém pode agir ainda". A
   * régua antiga tratava `responsavelId === null` como dono automático para
   * TODA chamada, inclusive EXECUTAR (iniciar, concluir, bloquear, um passo
   * do workflow). Achado real (11/09/2026): a tela mostrava "Sem responsável"
   * e mesmo assim deixava iniciar a etapa — a mesma regra que `iniciarTarefa`
   * já aplicava explicitamente ("iniciar sem dono deixaria o trabalho em
   * andamento e sem ninguém responsável por ele") não valia para as ações do
   * passo do workflow, porque elas passam por ESTA função, que nunca negava.
   *
   * `true` só faz sentido para LEITURA/navegação (abrir o deep-link, ver o
   * histórico) — nunca para uma ação que muda estado. Default `false`.
   */
  permiteSemDono?: boolean
}

/**
 * Confere se o usuário do request PODE acessar/mexer numa tarefa.
 * @returns null se PODE; ou uma Response de erro (401/403/422) se NÃO pode.
 *
 * Uso nas rotas: buscar a tarefa → checar existência (404) → então:
 *   const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
 *   if (negado) return negado
 */
export async function negarSeNaoForDonoDaTarefa(
  request: Request,
  responsavelId: number | null,
  opcoes?: OpcoesAcessoTarefa,
): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioKanban(request)

  // Sem token válido → nem entra
  if (!usuario) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  // Admin vê e mexe em tudo
  if (usuario.tipo === "admin") return null

  if (responsavelId === usuario.userId) return null

  // Sem dono: só passa quem pediu explicitamente (leitura/navegação). Para
  // EXECUTAR, sem dono é bloqueio — mesma mensagem e código que
  // `iniciarTarefa` já usa, para o frontend reconhecer os dois casos como o
  // mesmo problema ("atribua antes de agir").
  if (responsavelId === null) {
    if (opcoes?.permiteSemDono) return null
    return NextResponse.json(
      { error: "Esta tarefa/etapa não tem responsável. Atribua antes de agir sobre ela.", codigo: "SEM_RESPONSAVEL" },
      { status: 422 },
    )
  }

  return NextResponse.json(
    { error: "Você não tem acesso a esta tarefa." },
    { status: 403 },
  )
}

/**
 * MESMA COISA, mas a rota só tem o `tarefaId` — busca e checa numa chamada só.
 * Usada pelas portas que não podem falar com o Prisma diretamente (ex.: a
 * porta única de comando), para não precisarem de um `findUnique` próprio.
 */
export async function negarSeNaoForDonoDaTarefaPorId(
  request: Request,
  tarefaId: number,
  opcoes?: OpcoesAcessoTarefa,
): Promise<NextResponse | null> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { responsavelId: true } })
  if (!tarefa) {
    return NextResponse.json({ error: "tarefa não encontrada", codigo: "TAREFA_NAO_ENCONTRADA" }, { status: 404 })
  }
  return negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId, opcoes)
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