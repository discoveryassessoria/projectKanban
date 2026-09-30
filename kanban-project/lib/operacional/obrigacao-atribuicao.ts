// lib/operacional/obrigacao-atribuicao.ts
// ============================================================================
// OBRIGAÇÃO ADMINISTRATIVA "Atribuir tarefas — {família}" — DESCONTINUADA (30/09/2026).
//
// Decisão do usuário: a Torre de Controle mostra quem está sem dono (KPI/visão "Sem responsável", Precisa de
// você, Distribuição absorvida), então NENHUMA tarefa administrativa é mais criada para "gerir a distribuição".
// A criação (`reconciliarObrigacaoDeAtribuicao`, chamada em passo-tarefa, atribuirTarefa, devolverAFila e no
// reconciliador de tarefas) foi REMOVIDA. As duas que estavam abertas (#3980 no 651, #3928 no 676) foram
// canceladas com auditoria e o motivo "substituída pela Torre de Controle"
// (`scripts/encerrar-obrigacoes-atribuicao.ts`). As já CONCLUÍDAS (histórico) continuam existindo com
// `origem = ORIGEM_OBRIGACAO_ATRIBUICAO` — por isso os leitores (Distribuição, Central, tabela por família) ainda
// filtram por essa origem: são fatos históricos, nunca apagados.
//
// O que fica aqui: a marca da origem, "quem é o responsável pela distribuição" (competência
// `operacao.distribuirTarefas`) e a contagem de tarefas distribuíveis sem responsável.
// ============================================================================

import { type Prisma, TipoTarefa, type StatusTarefa } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { STATUS_ATIVOS } from "./tarefa-canonica"
import { calcularPermissoes, temPermissao, type MapaPermissoes } from "@/src/lib/permissoes"

type DB = Prisma.TransactionClient | typeof prisma

/** Marca só desta obrigação — nunca confundir com origem "workflow" (certidões). */
export const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

/**
 * QUEM está resolvido HOJE para receber a obrigação — pela COMPETÊNCIA
 * (`operacao.distribuirTarefas`), nunca por `tipo === 'admin'` direto.
 * Hoje só o Administrador tem a competência por padrão (regra-base de
 * `calcularPermissoes`); conceder a um Gerente é cadastro (perfil/custom),
 * não uma mudança nesta função. Determinístico: o menor `id` entre os
 * competentes — para duas leituras no mesmo instante concordarem.
 */
export async function usuarioResponsavelPelaDistribuicao(db: DB): Promise<number | null> {
  const usuarios = await db.usuario.findMany({
    select: { id: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
    orderBy: { id: "asc" },
  })
  for (const u of usuarios) {
    const efetivas = calcularPermissoes(
      u.tipo,
      (u.perfil?.permissoes as MapaPermissoes | null) ?? null,
      (u.permissoesCustom as MapaPermissoes | null) ?? null,
    )
    if (temPermissao(efetivas, "operacao.distribuirTarefas")) return u.id
  }
  return null
}

/**
 * Quantas tarefas DISTRIBUÍVEIS (canônicas, `tipo: NORMAL`, ativas) deste
 * processo estão sem responsável AGORA. Nunca histórico, nunca concluída,
 * cancelada, inválida ou meramente encerrada — `STATUS_ATIVOS` já garante
 * isso. Nunca conta a própria obrigação administrativa (ela sempre tem
 * responsável; o filtro de `tipo` é reforço, não a única barreira).
 */
export async function contarSemResponsavelDistribuivel(db: DB, processoId: number): Promise<number> {
  return db.tarefa.count({
    where: {
      processoId,
      tipo: TipoTarefa.NORMAL,
      responsavelId: null,
      statusTarefa: { in: STATUS_ATIVOS as StatusTarefa[] },
    },
  })
}
