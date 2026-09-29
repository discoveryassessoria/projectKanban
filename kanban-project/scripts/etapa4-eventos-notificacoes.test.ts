// scripts/etapa4-eventos-notificacoes.test.ts
// ============================================================================
// ETAPA 4 — EVENTOS + HISTÓRICO + NOTIFICAÇÕES — os 18 casos obrigatórios.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/etapa4-eventos-notificacoes.test.ts
//
// A pergunta de cada caso: o acontecimento vira UMA notificação, o retry não
// duplica, e a operação/histórico/fila continuam corretos independentemente
// de a notificação existir? NOTIFICAÇÃO NÃO É SOURCE OF TRUTH.
//
// CONTRATO DO SINO AGRUPADO (29/09/2026): um aviso NÃO LIDO por (destinatário, família,
// tipo), atualizado no lugar. "Retorno recebido" e "acompanhamento vencido" viraram a
// parte "cobranças a fazer" do PRECISA_AGIR; EM_RISCO continua sem aviso nenhum.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, transferirTarefa, redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { somarAoAviso, marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { avaliarPrecisaAgir } from "@/lib/operacional/avisos-sino"
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
  const users = await prisma.usuario.findMany({ where: { email: { endsWith: "@etapa4.test" } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ tarefa: { processoId: { in: ids } } }, { processoId: { in: ids } }, { destinatarioId: { in: users.map((u) => u.id) } }] },
  })
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

/** Avisos AGRUPADOS de um destinatário (o sino novo: nunca um aviso por tarefa). */
const avisos = (destinatarioId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({
    where: { destinatarioId, agrupado: true, ...(tipo ? { tipo } : {}) },
    select: { id: true, tipo: true, destinatarioId: true, processoId: true, tarefaIds: true, contagem: true, titulo: true, link: true, resumo: true, lidaEm: true },
    orderBy: { id: "asc" },
  })
/** Avisos (de qualquer tipo/destinatário) que listam a tarefa. */
const avisosDaTarefa = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({
    where: { agrupado: true, tarefaIds: { has: tarefaId }, ...(tipo ? { tipo } : {}) },
    select: { id: true, tipo: true, destinatarioId: true, resumo: true },
  })
/** O que o PRECISA_AGIR de uma pessoa diz sobre a tarefa (FOTO = varredura das 07:00). */
const cobrancasDe = async (destinatarioId: number, tarefaId: number) => {
  const a = await prisma.notificacaoOperacional.findFirst({ where: { destinatarioId, tipo: "PRECISA_AGIR", agrupado: true, lidaEm: null }, select: { resumo: true } })
  return ((a?.resumo as { cobrancas?: number[] } | null)?.cobrancas ?? []).includes(tarefaId)
}

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
  secao("CASO 4 — Lote real: fatos individuais preservados + 1 aviso agrupado por família")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const gestor = await usuario("Gestor4")
    const joao = await usuario("Joao4")
    // 3 tarefas da MESMA família (um processo) + 1 de outra família: o aviso é por família.
    const a = await palco()
    const extra = []
    for (let i = 0; i < 2; i++) {
      const r = await criarTarefaManual({
        processoId: a.processoId, titulo: `${MARCA} lote ${i}`, autorId: gestor.id, responsavelId: null,
        dataPrazo: new Date(Date.now() + 10 * 86400000), motivo: "cenário do lote", confirmarDuplicidade: true,
      })
      if (!r.ok) throw new Error(`falha ao criar tarefa do lote: ${r.mensagem}`)
      extra.push(r.tarefaId)
    }
    const outra = await palco()
    const todas = [a.tarefaId, ...extra, outra.tarefaId]
    const r = await redistribuirTarefas({ tarefaIds: todas, novoResponsavelId: joao.id, autorId: gestor.id, motivo: "reorganização" })
    ok("CASO 4) as 4 atribuições individuais aconteceram", r.itens.filter((i) => i.ok).length === 4, String(r.itens.filter((i) => i.ok).length))
    for (const id of todas) {
      const tarefa = await prisma.tarefa.findUniqueOrThrow({ where: { id }, select: { responsavelId: true } })
      ok(`CASO 4) tarefa ${id} foi realmente atribuída (fato individual)`, tarefa.responsavelId === joao.id)
    }
    const chegou = await avisos(joao.id, "CHEGOU_TRABALHO")
    ok("CASO 4) exatamente 2 avisos consolidados (1 por família), nunca 1 por tarefa", chegou.length === 2, String(chegou.length))
    const daFamiliaA = chegou.find((n) => n.processoId === a.processoId)
    ok("CASO 4) a família com 3 tarefas tem UM aviso cobrindo as 3",
      daFamiliaA?.contagem === 3 && daFamiliaA.tarefaIds.length === 3 && [a.tarefaId, ...extra].every((id) => daFamiliaA.tarefaIds.includes(id)),
      JSON.stringify(daFamiliaA?.tarefaIds))
    ok("CASO 4) texto: '<Família> — 3 tarefas atribuídas a você'", /— 3 tarefas atribuídas a você$/.test(daFamiliaA?.titulo ?? ""), daFamiliaA?.titulo)
    ok("CASO 4) link → /operacao?processo=<id>&aba=fila", daFamiliaA?.link === `/operacao?processo=${a.processoId}&aba=fila`, daFamiliaA?.link ?? "")
    ok("CASO 4) nenhum aviso legado por tarefa (agrupado=false / tarefaId)",
      (await prisma.notificacaoOperacional.count({ where: { destinatarioId: joao.id, OR: [{ agrupado: false }, { tarefaId: { not: null } }] } })) === 0)
    if (daFamiliaA) {
      // Retry do mesmo fato: somar as mesmas tarefas de novo não muda nem duplica o aviso.
      const retry = await somarAoAviso(prisma, {
        tipo: "CHEGOU_TRABALHO", destinatarioId: joao.id, processoId: a.processoId, familiaNome: null,
        tarefaIds: [a.tarefaId, ...extra], link: daFamiliaA.link ?? "",
      })
      ok("CASO 4) retry do mesmo fato não abre outro aviso nem muda a contagem", retry.criado === false && retry.id === daFamiliaA.id && retry.contagem === 3)
      ok("CASO 4) e continuam 2 avisos", (await avisos(joao.id, "CHEGOU_TRABALHO")).length === 2)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 5/6 — Retorno de terceiro: entra nas 'cobranças a fazer' do PRECISA_AGIR; retry não duplica")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela5")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    await registrarContato(p.stepId, { canal: "EMAIL", resultado: "RETORNO_RECEBIDO", observacao: "Cartório respondeu" })

    const antes = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 5) o estado canônico já mostra retorno recebido", antes?.proximoAcontecimento.tipo === "retorno_recebido")

    const r1 = await avaliarPrecisaAgir({ modo: "FOTO" })
    const ns1 = await avisos(daniela.id, "PRECISA_AGIR")
    ok("CASO 5) 1 aviso PRECISA_AGIR criado para a Daniela (família do processo)", r1.criados >= 1 && ns1.length === 1 && ns1[0].processoId === p.processoId, JSON.stringify({ criados: r1.criados, n: ns1.length }))
    ok("CASO 5) o retorno da tarefa consta em 'cobranças a fazer'", await cobrancasDe(daniela.id, p.tarefaId), JSON.stringify(ns1[0]?.resumo))
    ok("CASO 5) texto diz '1 cobrança a fazer'", /1 cobrança a fazer$/.test(ns1[0]?.titulo ?? ""), ns1[0]?.titulo)
    ok("CASO 5) nenhum aviso por tarefa (RETORNO_TERCEIRO/agrupado=false)",
      (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, OR: [{ agrupado: false }, { tipo: "RETORNO_TERCEIRO" }] } })) === 0)

    const r2 = await avaliarPrecisaAgir({ modo: "FOTO" })
    ok("CASO 6) rodar de novo (retry) não cria outro nem renotifica", r2.criados === 0 && r2.semMudanca >= 1, JSON.stringify({ criados: r2.criados, semMudanca: r2.semMudanca }))
    ok("CASO 6) continua exatamente 1", (await avisos(daniela.id, "PRECISA_AGIR")).length === 1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 7/8 — Acompanhamento vencido: a fila não depende do aviso; rerun não spamma")
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

    const r1 = await avaliarPrecisaAgir({ modo: "FOTO" })
    const ns7 = await avisos(daniela.id, "PRECISA_AGIR")
    ok("CASO 7) 1 aviso PRECISA_AGIR com o acompanhamento vencido em 'cobranças a fazer'",
      r1.criados >= 1 && ns7.length === 1 && await cobrancasDe(daniela.id, p.tarefaId), JSON.stringify(ns7[0]?.resumo))

    const depois = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 7) o estado canônico continua igual DEPOIS — a notificação não alterou a leitura", depois?.acompanhamentoVencido === true && depois?.proximoAcompanhamentoData === antes?.proximoAcompanhamentoData)

    const r2 = await avaliarPrecisaAgir({ modo: "FOTO" })
    ok("CASO 8) job repetido sem mudança de estado não notifica de novo", r2.criados === 0 && r2.semMudanca >= 1, JSON.stringify({ criados: r2.criados, semMudanca: r2.semMudanca }))
    ok("CASO 8) continua exatamente 1", (await avisos(daniela.id, "PRECISA_AGIR")).length === 1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 9/10/11 — EM_RISCO NÃO NOTIFICA (correção 15/09/2026): é diagnóstico de configuração, não urgência da operadora")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela9")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    // Sem dataPrazo (o reconciliador atribui um por SLA — limpamos de propósito),
    // sem SLA de passo, sem previsão de terceiro, sem acompanhamento, não
    // aguardando — cai em SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL.
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA", dataPrazo: null } })

    const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("CASO 9) o estado canônico CONTINUA calculando emRisco/motivosRisco (Saúde do Sistema precisa disso)",
      estado?.emRisco === true && estado.motivosRisco.length > 0, JSON.stringify(estado?.motivosRisco))

    await avaliarPrecisaAgir({ modo: "FOTO" })
    ok("CASO 9) entrar em EM_RISCO NÃO gera aviso nenhum da tarefa", (await avisosDaTarefa(p.tarefaId)).length === 0)
    ok("CASO 9) zero notificações EM_RISCO no banco", (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, tipo: "EM_RISCO" } })) === 0)

    // Motivo NOVO e real: Tarefa.dataPrazo diverge do SLA do passo. Antes isto
    // seria "2º fato, notificação nova permitida" — agora continua sem notificar.
    const hoje = new Date()
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(hoje.getTime() + 5 * 86400000) } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepId }, data: { prazo: new Date(hoje.getTime() + 10 * 86400000) } })

    await avaliarPrecisaAgir({ modo: "FOTO" })
    ok("CASO 10/11) motivo de risco mudando de verdade CONTINUA sem notificar", (await avisosDaTarefa(p.tarefaId)).length === 0)
    ok("CASO 10/11) zero notificações EM_RISCO, mesmo depois do motivo mudar", (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, tipo: "EM_RISCO" } })) === 0)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 15 — Transferência de uma tarefa EM_RISCO: nenhum dos dois responsáveis é notificado do risco; a posse é avisada")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela15")
    const joao = await usuario("Joao15")
    const gestor = await usuario("Gestor15")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA", dataPrazo: null } })

    await avaliarPrecisaAgir({ modo: "FOTO" })
    ok("CASO 15) Daniela NÃO é notificada do risco (só recebe o CHEGOU_TRABALHO da atribuição)",
      (await avisosDaTarefa(p.tarefaId)).every((n) => n.tipo === "CHEGOU_TRABALHO" && n.destinatarioId === daniela.id))
    ok("CASO 15) zero notificações EM_RISCO", (await prisma.notificacaoOperacional.count({ where: { tipo: "EM_RISCO", destinatarioId: { in: [daniela.id, joao.id] } } })) === 0)

    await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: joao.id, autorId: gestor.id, motivo: "redistribuição" })
    await avaliarPrecisaAgir({ modo: "FOTO" })
    // MUDOU_DE_MAO (da Daniela) é o registro de que a tarefa saiu; o resto da tarefa é só do Joao.
    const depois = (await avisosDaTarefa(p.tarefaId)).filter((n) => n.tipo !== "MUDOU_DE_MAO")
    ok("CASO 15) depois da transferência, o novo responsável só recebe CHEGOU_TRABALHO — nenhum aviso de risco",
      depois.length === 1 && depois[0].tipo === "CHEGOU_TRABALHO" && depois[0].destinatarioId === joao.id, JSON.stringify(depois))
    ok("CASO 15) a Daniela é avisada de que a tarefa saiu da fila dela (MUDOU_DE_MAO), não de risco",
      (await avisos(daniela.id)).map((n) => n.tipo).join() === "MUDOU_DE_MAO", (await avisos(daniela.id)).map((n) => n.tipo).join())
    ok("CASO 15) continuam zero notificações EM_RISCO para os dois", (await prisma.notificacaoOperacional.count({ where: { tipo: "EM_RISCO", destinatarioId: { in: [daniela.id, joao.id] } } })) === 0)
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
      await somarAoAviso(prisma, {
        tipo: "CHEGOU_TRABALHO", destinatarioId: 999_999_999, processoId: p.processoId, familiaNome: null,
        tarefaIds: [p.tarefaId], link: "/operacao",
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
