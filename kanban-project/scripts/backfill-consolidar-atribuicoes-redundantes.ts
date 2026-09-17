// scripts/backfill-consolidar-atribuicoes-redundantes.ts
//
// ANTES desta rodada, atribuir tarefa por tarefa (sem passar por
// `redistribuirTarefas`) disparava UMA notificação `ATRIBUICAO` por tarefa —
// 15 atribuições no mesmo lote/dia geravam 15 avisos "Nova tarefa atribuída"
// para o mesmo destinatário. `redistribuirTarefas` já consolida (e agora
// também ancora por processo, ver item 5/9 do mandato 17/09/2026) — este
// script é só para o DADO que já existe, gerado ANTES da consolidação.
//
// REGRA: encontra grupos de `ATRIBUICAO`/`TRANSFERENCIA` NÃO LIDAS do MESMO
// destinatário, para tarefas do MESMO processo, criadas no MESMO dia — ou
// seja, o padrão de "várias atribuições individuais que deveriam ter sido
// um lote só". Para cada grupo com 2+ notificações:
//   1. dispara UMA `ATRIBUICAO_LOTE` (mesma porta canônica,
//      `notificarAcontecimento`, idempotente) com o processo como âncora;
//   2. marca as notificações INDIVIDUAIS do grupo como lidas (`lidaEm`) —
//      NUNCA apaga: o histórico (quem recebeu o quê, quando) continua
//      inteiro na tabela, só sai do sino como pendente, porque a
//      consolidada já cobre o mesmo fato.
//
// Não toca em Tarefa, LogAuditoria, ownership, prazo ou SLA — só
// `NotificacaoOperacional`, e só as NÃO LIDAS.
//
// Seco por padrão. Só escreve com `--aplicar`.
// Rodar: npx tsx scripts/backfill-consolidar-atribuicoes-redundantes.ts [--aplicar]

import { prisma } from "@/lib/prisma"
import { notificarAcontecimento } from "@/lib/operacional/notificacao-canonica"
import { urlMinhaOperacaoDoProcesso } from "@/lib/operacional/navegacao"

function diaOperacional(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function main() {
  const aplicar = process.argv.includes("--aplicar")

  const notifs = await prisma.notificacaoOperacional.findMany({
    where: { tipo: { in: ["ATRIBUICAO", "TRANSFERENCIA"] }, lidaEm: null, tarefaId: { not: null } },
    select: { id: true, destinatarioId: true, autorId: true, tarefaId: true, criadoEm: true },
  })
  if (notifs.length === 0) { console.log("Nenhuma notificação ATRIBUICAO/TRANSFERENCIA pendente."); await prisma.$disconnect(); return }

  const tarefaIds = [...new Set(notifs.map((n) => n.tarefaId!).filter(Boolean))]
  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: { id: true, processoId: true, processo: { select: { nome: true } } },
  })
  const processoPorTarefa = new Map(tarefas.map((t) => [t.id, { processoId: t.processoId, nome: t.processo?.nome ?? null }]))

  // Agrupa por (destinatarioId, processoId, dia operacional da CRIAÇÃO).
  const grupos = new Map<string, typeof notifs>()
  for (const n of notifs) {
    const p = processoPorTarefa.get(n.tarefaId!)
    if (!p || p.processoId == null) continue // sem processo não tem contexto de lote — fica como está
    const chave = `${n.destinatarioId}::${p.processoId}::${diaOperacional(n.criadoEm)}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), n])
  }

  let gruposConsolidados = 0
  let notificacoesConsolidadas = 0

  for (const [chave, itens] of grupos) {
    if (itens.length < 2) continue // 1 notificação já é o desenho normal — nada a consolidar
    const [destinatarioIdStr, processoIdStr] = chave.split("::")
    const destinatarioId = Number(destinatarioIdStr)
    const processoId = Number(processoIdStr)
    const nomeProcesso = processoPorTarefa.get(itens[0].tarefaId!)?.nome ?? `Processo ${processoId}`
    const idsDasTarefas = itens.map((i) => i.tarefaId!).sort((a, b) => a - b)
    const autorId = itens.find((i) => i.autorId != null)?.autorId ?? null

    console.log(
      `${aplicar ? "+" : "seria"} consolidar ${itens.length} notificações — destinatário ${destinatarioId}, ` +
        `processo ${processoId} (${nomeProcesso}), tarefas [${idsDasTarefas.join(",")}]`,
    )
    gruposConsolidados++
    notificacoesConsolidadas += itens.length

    if (!aplicar) continue

    await notificarAcontecimento(prisma, {
      tipo: "ATRIBUICAO_LOTE",
      destinatarioId,
      processoId,
      autorId,
      titulo: `${nomeProcesso} — ${itens.length} tarefa${itens.length === 1 ? "" : "s"} atribuída${itens.length === 1 ? "" : "s"} a você`,
      mensagem: "Consolidação de atribuições individuais feitas antes do lote canônico existir (backfill 17/09/2026).",
      link: urlMinhaOperacaoDoProcesso(processoId),
      chaveIdempotencia: `notif::atribuicao_lote::backfill::u${destinatarioId}::p${processoId}::${idsDasTarefas.join("-")}`,
    })
    await prisma.notificacaoOperacional.updateMany({
      where: { id: { in: itens.map((i) => i.id) } },
      data: { lidaEm: new Date() },
    })
  }

  console.log(`\n${gruposConsolidados} grupo(s), ${notificacoesConsolidadas} notificação(ões) individual(is) — ${aplicar ? "aplicado." : "modo seco, rode com --aplicar para escrever."}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
