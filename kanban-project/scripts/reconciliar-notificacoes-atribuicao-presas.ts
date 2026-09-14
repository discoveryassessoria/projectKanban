// scripts/reconciliar-notificacoes-atribuicao-presas.ts
// ============================================================================
// RECONCILIAÇÃO DE DADO LEGADO (15/09/2026) — duas correções desta sessão
// mudaram o CÓDIGO, mas não o que já estava gravado:
//
//   1. `marcarAtribuicaoComoLidaAoProgredir` (notificacao-canonica.ts) passou
//      a marcar ATRIBUICAO/TRANSFERENCIA como lida quando a Tarefa progride
//      de verdade (iniciar, concluir ou cancelar) — mas só para progresso que
//      acontece DAQUI PRA FRENTE. Tarefas que já tinham progredido ANTES da
//      correção existir ficaram com a notificação presa no sino para sempre,
//      mesmo já iniciadas/concluídas/canceladas.
//   2. EM_RISCO deixou de notificar ("Operação em risco") — mas notificações
//      desse tipo já gravadas ANTES da correção continuam no banco.
//
// Esta reconciliação NÃO recria nada, NÃO toca em Tarefa nenhuma — só marca
// como lidas (`lidaEm`) notificações cujo fato já não é mais notícia:
//   (a) ATRIBUICAO/TRANSFERENCIA cuja Tarefa já saiu de NAO_INICIADA (dataInicio
//       preenchida) OU já está num status terminal (concluída/cancelada/superseded);
//   (b) toda notificação EM_RISCO ainda não lida (o tipo foi retirado).
//
// IDEMPOTENTE: rodar de novo não faz nada além do que já foi feito (só marca
// o que ainda está `lidaEm: null`).
//
// USO (conecta no banco que as env vars apontarem):
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/reconciliar-notificacoes-atribuicao-presas.ts
// ============================================================================
import { prisma } from "@/lib/prisma"

const STATUS_TERMINAIS = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"]

export async function reconciliarNotificacoesPresas() {
  // (a) ATRIBUICAO/TRANSFERENCIA de tarefas que já progrediram
  const candidatas = await prisma.notificacaoOperacional.findMany({
    where: { tipo: { in: ["ATRIBUICAO", "TRANSFERENCIA"] }, lidaEm: null, tarefaId: { not: null } },
    select: { id: true, tarefaId: true, destinatarioId: true },
  })
  const tarefaIds = [...new Set(candidatas.map((n) => n.tarefaId!).filter((id) => id != null))]
  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: { id: true, statusTarefa: true, dataInicio: true },
  })
  const tarefaPorId = new Map(tarefas.map((t) => [t.id, t]))

  const idsParaMarcar: number[] = []
  for (const n of candidatas) {
    const t = n.tarefaId != null ? tarefaPorId.get(n.tarefaId) : null
    if (!t) continue
    const progrediu = t.dataInicio != null || STATUS_TERMINAIS.includes(t.statusTarefa)
    if (progrediu) idsParaMarcar.push(n.id)
  }

  const rAtribuicao = idsParaMarcar.length > 0
    ? await prisma.notificacaoOperacional.updateMany({ where: { id: { in: idsParaMarcar } }, data: { lidaEm: new Date() } })
    : { count: 0 }

  // (b) EM_RISCO — o tipo foi retirado, nada mais deveria continuar "não lido" por causa dele
  const rEmRisco = await prisma.notificacaoOperacional.updateMany({
    where: { tipo: "EM_RISCO", lidaEm: null },
    data: { lidaEm: new Date() },
  })

  return {
    atribuicaoTransferencia: { candidatas: candidatas.length, marcadas: rAtribuicao.count, idsMarcados: idsParaMarcar },
    emRisco: { marcadas: rEmRisco.count },
  }
}

async function main() {
  const r = await reconciliarNotificacoesPresas()
  console.log(JSON.stringify(r, null, 2))
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
