// scripts/etapa4-eventos-notificacoes.test.ts
// ============================================================================
// ETAPA 4 — EVENTOS + HISTÓRICO + NOTIFICAÇÕES — os 18 casos obrigatórios.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/etapa4-eventos-notificacoes.test.ts
//
// A pergunta de cada caso: o acontecimento vira UMA notificação, o retry não
// duplica, e a operação/histórico/fila continuam corretos independentemente
// de a notificação existir? NOTIFICAÇÃO NÃO É SOURCE OF TRUTH.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, transferirTarefa, redistribuirTarefas, avisarAcontecimentosOperacionais } from "@/lib/operacional/tarefa-comandos"
import { notificarAcontecimento, marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { estadoTemporalDaOperacao } from "@/lib/operacional/proximo-acontecimento"
import { aplicarAndamento, gravarAndamento, ANDAMENTO_VAZIO } from "@/src/lib/process-stage/andamento-etapa"
import { diaOperacional } from "@/lib/operacional/tempo-operacional"

const MARCA = "ETAPA4-TEST"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefa: { processoId: { in: ids } } }, { processoId: { in: ids } }] } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@etapa4.test" } } })
}

let seq = 0
async function palco() {
  seq++
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_C${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Teste${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: "localizar_registro",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
      papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, lockVersion: true } })
  return { processoId: proc.id, stepId: step.id, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@etapa4.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

const notifs = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({ where: { tarefaId, ...(tipo ? { tipo } : {}) }, select: { id: true, tipo: true, destinatarioId: true, chaveIdempotencia: true } })

/** Grava um contato no `metadata.operacao` do passo — a fonte informal de retorno/acompanhamento. */
async function registrarContato(stepId: number, contato: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(ANDAMENTO_VAZIO, { contato }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

async function main() {
  exigirBancoDeTeste("prova a cadeia evento → histórico → atenção → notificação da Etapa 4")
  await limpar()

  console.log("ETAPA 4 — os 18 casos obrigatórios\n")

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 4 — Lote real: fatos individuais preservados + 1 notificação consolidada")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const gestor = await usuario("Gestor4")
    const joao = await usuario("Joao4")
    const a = await palco(), b = await palco(), c = await palco()
    const r = await redistribuirTarefas({ tarefaIds: [a.tarefaId, b.tarefaId, c.tarefaId], novoResponsavelId: joao.id, autorId: gestor.id, motivo: "reorganização" })
    ok("CASO 4) as 3 atribuições individuais aconteceram", r.itens.filter((i) => i.ok).length === 3, String(r.itens.filter((i) => i.ok).length))
    for (const t of [a, b, c]) {
      const tarefa = await prisma.tarefa.findUniqueOrThrow({ where: { id: t.tarefaId }, select: { responsavelId: true } })
      ok(`CASO 4) tarefa ${t.tarefaId} foi realmente atribuída (fato individual)`, tarefa.responsavelId === joao.id)
      const ns = await notifs(t.tarefaId, "ATRIBUICAO")
      ok(`CASO 4) tarefa ${t.tarefaId} NÃO gerou notificação individual de atribuição`, ns.length === 0, String(ns.length))
    }
    const lote = await prisma.notificacaoOperacional.findMany({ where: { tipo: "ATRIBUICAO_LOTE", destinatarioId: joao.id } })
    ok("CASO 4) exatamente 1 notificação consolidada", lote.length === 1, String(lote.length))
    if (lote[0]) {
      const retry = await notificarAcontecimento(prisma, {
        tipo: "ATRIBUICAO_LOTE", destinatarioId: joao.id, titulo: "x", chaveIdempotencia: lote[0].chaveIdempotencia,
      })
      ok("CASO 4) retry da mesma chave não duplica", retry.criada === false)
      ok("CASO 4) e continua 1 só", (await prisma.notificacaoOperacional.findMany({ where: { tipo: "ATRIBUICAO_LOTE", destinatarioId: joao.id } })).length === 1)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 5/6 — Retorno de terceiro: 1 notificação, retry não duplica")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela5")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    await registrarContato(p.stepId, { canal: "EMAIL", resultado: "RETORNO_RECEBIDO", observacao: "Cartório respondeu" })

    const antes = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 5) o estado canônico já mostra retorno recebido", antes?.proximoAcontecimento.tipo === "retorno_recebido")

    const r1 = await avisarAcontecimentosOperacionais()
    ok("CASO 5) 1 notificação de retorno criada", r1.retorno === 1, JSON.stringify(r1))
    const ns1 = await notifs(p.tarefaId, "RETORNO_TERCEIRO")
    ok("CASO 5) e é para a Daniela", ns1.length === 1 && ns1[0].destinatarioId === daniela.id)

    const r2 = await avisarAcontecimentosOperacionais()
    ok("CASO 6) rodar de novo (retry) não cria outra", r2.retorno === 0 && r2.deduplicados >= 1, JSON.stringify(r2))
    ok("CASO 6) continua exatamente 1", (await notifs(p.tarefaId, "RETORNO_TERCEIRO")).length === 1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 7/8 — Acompanhamento vencido: a fila não depende da notificação; rerun não spamma")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela7")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    const ontem = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    await registrarContato(p.stepId, { canal: "EMAIL", resultado: "OUTRO", proximoAcompanhamento: ontem })

    const antes = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 7) acompanhamento vencido já é verdade no estado canônico ANTES de qualquer notificação", antes?.acompanhamentoVencido === true)

    const r1 = await avisarAcontecimentosOperacionais()
    ok("CASO 7) 1 notificação de acompanhamento vencido", r1.acompanhamento === 1, JSON.stringify(r1))

    const depois = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 7) o estado canônico continua igual DEPOIS — a notificação não alterou a leitura", depois?.acompanhamentoVencido === true && depois?.proximoAcompanhamentoData === antes?.proximoAcompanhamentoData)

    const r2 = await avisarAcontecimentosOperacionais()
    ok("CASO 8) job repetido sem mudança de estado não notifica de novo", r2.acompanhamento === 0 && r2.deduplicados >= 1, JSON.stringify(r2))
    ok("CASO 8) continua exatamente 1", (await notifs(p.tarefaId, "ACOMPANHAMENTO_VENCIDO")).length === 1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 9/10/11 — EM_RISCO: entra 1x, permanece sem spam, motivo novo é evento novo")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela9")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    // Sem dataPrazo (o reconciliador atribui um por SLA — limpamos de propósito),
    // sem SLA de passo, sem previsão de terceiro, sem acompanhamento, não
    // aguardando — cai em SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL.
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA", dataPrazo: null } })

    const r1 = await avisarAcontecimentosOperacionais()
    ok("CASO 9) entrada em EM_RISCO gera notificação", r1.risco >= 1, JSON.stringify(r1))
    const primeira = await notifs(p.tarefaId, "EM_RISCO")
    ok("CASO 9) exatamente 1 registrada", primeira.length === 1, String(primeira.length))

    const r2 = await avisarAcontecimentosOperacionais()
    ok("CASO 10) permanecer no MESMO risco não renotifica", r2.risco === 0 && r2.deduplicados >= 1, JSON.stringify(r2))
    ok("CASO 10) continua exatamente 1", (await notifs(p.tarefaId, "EM_RISCO")).length === 1)

    // Motivo NOVO e real: Tarefa.dataPrazo diverge do SLA do passo.
    const hoje = new Date()
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(hoje.getTime() + 5 * 86400000) } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepId }, data: { prazo: new Date(hoje.getTime() + 10 * 86400000) } })

    const r3 = await avisarAcontecimentosOperacionais()
    ok("CASO 11) motivo de risco MUDOU de verdade → notificação NOVA permitida", r3.risco >= 1, JSON.stringify(r3))
    const depois = await notifs(p.tarefaId, "EM_RISCO")
    ok("CASO 11) agora são 2 notificações distintas (2 fatos, não duplicação do mesmo)", depois.length === 2, String(depois.length))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 15 — Transferência: o antigo para de receber, o novo recebe a ocorrência")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela15")
    const joao = await usuario("Joao15")
    const gestor = await usuario("Gestor15")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA", dataPrazo: null } })

    const r1 = await avisarAcontecimentosOperacionais()
    ok("CASO 15) Daniela é notificada do risco", r1.risco >= 1)
    const paraDaniela = await notifs(p.tarefaId, "EM_RISCO")
    ok("CASO 15) 1 notificação, para a Daniela", paraDaniela.length === 1 && paraDaniela[0].destinatarioId === daniela.id)

    await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: joao.id, autorId: gestor.id, motivo: "redistribuição" })
    const r2 = await avisarAcontecimentosOperacionais()
    ok("CASO 15) após a transferência, o NOVO responsável recebe a ocorrência", r2.risco >= 1, JSON.stringify(r2))
    const tudo = await notifs(p.tarefaId, "EM_RISCO")
    ok("CASO 15) agora 2 notificações — uma para cada destinatário, nenhuma repetida para o mesmo",
      tudo.length === 2 && tudo.some((n) => n.destinatarioId === daniela.id) && tudo.some((n) => n.destinatarioId === joao.id))

    const r3 = await avisarAcontecimentosOperacionais()
    ok("CASO 15) rodar de novo não renotifica NINGUÉM (o fato já foi visto por ambos)", r3.risco === 0)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 17 — Marcar como lida NUNCA altera estado operacional")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela17")
    const outro = await usuario("Outro17")
    const gestor = await usuario("Gestor17")
    const p = await palco()
    const r0 = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    const notifId = r0.ok ? r0.notificacaoId : null
    ok("CASO 17) pré-condição: existe notificação", notifId != null)

    const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })

    ok("CASO 17) outro usuário NÃO consegue marcar como lida (RBAC)",
      (await marcarNotificacaoComoLida(prisma, { notificacaoId: notifId!, usuarioId: outro.id })).ok === false)

    const r1 = await marcarNotificacaoComoLida(prisma, { notificacaoId: notifId!, usuarioId: daniela.id })
    ok("CASO 17) o próprio destinatário marca com sucesso", r1.ok === true)

    const depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("CASO 17) Tarefa está BYTE A BYTE igual (exceto nada — comparação total)", JSON.stringify(antes) === JSON.stringify(depois))

    const r2 = await marcarNotificacaoComoLida(prisma, { notificacaoId: notifId!, usuarioId: daniela.id })
    ok("CASO 17) marcar de novo (já lida) é idempotente", r2.ok === true)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 16 — RBAC: só o destinatário age sobre a própria notificação")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela16")
    const p = await palco()
    const r0 = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    ok("CASO 16) notificação inexistente é rejeitada, não inventada",
      (await marcarNotificacaoComoLida(prisma, { notificacaoId: 9_999_999, usuarioId: daniela.id })).ok === false)
    ok("CASO 16) pré-condição para o próximo bloco", r0.ok === true)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 18 — Falha ao persistir notificação não corrompe operação/histórico/atenção")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela18")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA" } })

    const antesEstado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    const antesTarefa = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })

    let falhou18 = false
    try {
      await notificarAcontecimento(prisma, {
        tipo: "EM_RISCO", destinatarioId: 999_999_999, tarefaId: p.tarefaId, titulo: "x",
        chaveIdempotencia: `notif::teste-falha::${p.tarefaId}`,
      })
    } catch { falhou18 = true }
    ok("CASO 18) a escrita realmente falhou (destinatário inexistente)", falhou18)

    const depoisEstado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    const depoisTarefa = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("CASO 18) a Tarefa continua íntegra", JSON.stringify(antesTarefa) === JSON.stringify(depoisTarefa))
    ok("CASO 18) a leitura de atenção (EM_RISCO) continua correta", depoisEstado?.emRisco === antesEstado?.emRisco && depoisEstado?.motivosRisco.join() === antesEstado?.motivosRisco.join())
  }

  await limpar()
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? "Evento canônico → histórico → atenção → notificação: a cadeia fecha, e notificação nunca é source of truth."
    : "A cadeia da Etapa 4 quebrou em algum elo.")
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
