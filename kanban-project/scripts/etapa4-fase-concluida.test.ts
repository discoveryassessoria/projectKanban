// scripts/etapa4-fase-concluida.test.ts
// ============================================================================
// ETAPA 4 — CASO 12/13/14: fase concluída notifica admin, retry não duplica,
// movimentação manual NUNCA finge ser conclusão.
//
// CONTRATO DO SINO AGRUPADO (29/09/2026): FASE_CONCLUIDA é aviso do GESTOR, UM não lido por
// (admin, família), atualizado no lugar ("<Família> — N fases concluídas"); cada conclusão
// é um item `fase::<chave>` no resumo — o replay do mesmo fato não soma duas vezes.
//
// TRUNCATA o banco de teste — só roda isolado, nunca junto de outro teste que
// dependa de dados persistentes (mesmo padrão de mover-fase-manual.test.ts).
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { garantirOferta } from "./_fixture-oferta"

let ok = 0
const falhas: string[] = []
const check = (n: string, c: boolean, e?: string) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("Etapa 4 — fase concluída — PULADO (sem banco de teste local)")
  process.exit(0)
}

const prisma = new PrismaClient()

async function main() {
  const { advance, movePhaseManual } = await import("../src/lib/motor/phase-advance")
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")

  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","PhaseAdvanceLog","LogAuditoria","NotificacaoOperacional" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "alemanha", countryLabel: "Alemanha", nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM-E4" }, update: {},
    create: { code: "ALE-ADM-E4", name: "Alemã (Etapa 4)", paisId: oferta.paisId, processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  await prisma.tipoProcessoModalidadeHabilitada.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } },
    update: {}, create: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId },
  })
  const FASES = ["fase_um", "fase_dois"]
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: "Macro E4", versao: 1 } })
  for (let i = 0; i < FASES.length; i++) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASES[i], label: FASES[i], ordem: i, versao: 1 } })
  }
  for (const phaseKey of FASES) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `all::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1 } })
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: `passo_${phaseKey}`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "PROCESSO" },
    })
  }

  const admin1 = await prisma.usuario.upsert({ where: { email: "admin1.e4@teste.local" }, update: {}, create: { nome: "Admin Um", email: "admin1.e4@teste.local", senha: "x", tipo: "admin" } })
  const admin2 = await prisma.usuario.upsert({ where: { email: "admin2.e4@teste.local" }, update: {}, create: { nome: "Admin Dois", email: "admin2.e4@teste.local", senha: "x", tipo: "admin" } })

  const arvore = await prisma.arvore.create({ data: { nome: "Árvore E4" } })
  await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })

  async function novoProcesso(nome: string) {
    const p = await prisma.processo.create({ data: { nome, codigo: `T-${nome}`, arvoreId: arvore.id, faseAtualKey: "fase_um", tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, workflowRuntime: "v2" } })
    await materializarExecucaoDaFase({ processoId: p.id, fonte: "CADASTRO_EM_ANDAMENTO" })
    return p
  }

  console.log("\nCASO 12 — Fase concluída notifica admin, no máximo 1 por destinatário")
  const p1 = await novoProcesso("E4-P1")
  await prisma.phaseWorkflowStepInstance.updateMany({ where: { processoId: p1.id, faseMacroKey: "fase_um" }, data: { status: "CONCLUIDO", completedAt: new Date() } })
  const r1 = await advance(p1.id, { origem: "teste-e4" })
  check("avanço aceito (fase_um → fase_dois)", r1.success === true, JSON.stringify(r1))
  check("resultado é AVANCADO (conclusão real, não forçada)", r1.success && r1.resultado === "AVANCADO")

  // O banco de teste é COMPARTILHADO entre arquivos de teste, e `Usuario` fica
  // FORA do TRUNCATE de propósito — outros arquivos podem ter deixado admins
  // seus. O avanço notifica TODO admin real (correto em
  // produção); aqui escopamos a prova aos DOIS admins que ESTE teste criou.
  const meusAdmins = new Set([admin1.id, admin2.id])
  const notifsP1Todos = await prisma.notificacaoOperacional.findMany({ where: { processoId: p1.id, tipo: "FASE_CONCLUIDA" } })
  const notifsP1 = notifsP1Todos.filter((n) => meusAdmins.has(n.destinatarioId))
  check("exatamente 2 notificações (1 por admin, 2 admins) entre os admins deste teste", notifsP1.length === 2, String(notifsP1.length))
  check("uma para cada admin, nenhuma duplicada", new Set(notifsP1.map((n) => n.destinatarioId)).size === 2)
  check("todo admin REAL do sistema foi notificado (não só os 2 deste teste)", notifsP1Todos.length >= notifsP1.length, String(notifsP1Todos.length))
  check("grão PROCESSO — sem tarefaId", notifsP1.every((n) => n.tarefaId === null))
  check("com processoId correto", notifsP1.every((n) => n.processoId === p1.id))
  check("aviso AGRUPADO (não legado), contagem 1", notifsP1.every((n) => n.agrupado === true && n.contagem === 1), JSON.stringify(notifsP1.map((n) => [n.agrupado, n.contagem])))
  check("o fato entra como item `fase::<chave>` no resumo", notifsP1.every((n) => { const it = (n.resumo as { itens?: string[] } | null)?.itens ?? []; return it.length === 1 && it[0].startsWith("fase::") }), JSON.stringify(notifsP1[0]?.resumo))
  check("texto: '<Família> — 1 fase concluída'", notifsP1.every((n) => /— 1 fase concluída$/.test(n.titulo)), notifsP1[0]?.titulo)
  check("link → /tarefas?processo=<id> (nunca /kanban)", notifsP1.every((n) => n.link === `/tarefas?processo=${p1.id}`), notifsP1[0]?.link ?? "")
  check("nasce não lida", notifsP1.every((n) => n.lidaEm === null))

  console.log("\nCASO 13 — Retry do mesmo commit não duplica")
  if (notifsP1[0]) {
    const { somarAoAviso } = await import("../lib/operacional/notificacao-canonica")
    const n0 = notifsP1[0]
    const itensOriginais = (n0.resumo as { itens?: string[] }).itens ?? []
    const retry = await somarAoAviso(prisma, {
      tipo: "FASE_CONCLUIDA", destinatarioId: n0.destinatarioId, processoId: p1.id, familiaNome: null,
      itens: itensOriginais, link: n0.link ?? "",
    })
    check("retry do MESMO fato (mesmo item `fase::<chave>`) não soma nem abre outro aviso", retry.criado === false && retry.id === n0.id && retry.contagem === 1, JSON.stringify(retry))
    const recontagem = (await prisma.notificacaoOperacional.findMany({ where: { processoId: p1.id, tipo: "FASE_CONCLUIDA" } })).filter((n) => meusAdmins.has(n.destinatarioId))
    check("continuam exatamente 2 (não virou 3)", recontagem.length === 2, String(recontagem.length))
    check("e a contagem de cada um continua 1", recontagem.every((n) => n.contagem === 1))
    // Um fato NOVO da mesma família soma no aviso aberto ("2 fases concluídas"), no mesmo lugar.
    const soma = await somarAoAviso(prisma, {
      tipo: "FASE_CONCLUIDA", destinatarioId: n0.destinatarioId, processoId: p1.id, familiaNome: null,
      itens: ["fase::teste-e4-outra-conclusao"], link: n0.link ?? "",
    })
    const somado = await prisma.notificacaoOperacional.findUniqueOrThrow({ where: { id: n0.id } })
    check("fato novo soma NO LUGAR: mesmo aviso, contagem 2, '2 fases concluídas'", soma.criado === false && soma.id === n0.id && somado.contagem === 2 && /— 2 fases concluídas$/.test(somado.titulo), somado.titulo)
  }
  // Concorrência real: duas chamadas simultâneas de avanço da MESMA fase não podem duplicar.
  const p2 = await novoProcesso("E4-P2")
  await prisma.phaseWorkflowStepInstance.updateMany({ where: { processoId: p2.id, faseMacroKey: "fase_um" }, data: { status: "CONCLUIDO", completedAt: new Date() } })
  const [race1, race2] = await Promise.all([advance(p2.id, { origem: "race1" }), advance(p2.id, { origem: "race2" })])
  const resultados = [race1, race2].map((r) => r.success ? r.resultado : "REJEITADO")
  check("concorrência: uma chamada avança de verdade, a outra converge idempotente (nenhuma rejeitada/erro)",
    resultados.includes("AVANCADO") && resultados.filter((r) => r === "AVANCADO").length === 1 && resultados.every((r) => r === "AVANCADO" || r === "IDEMPOTENTE"),
    JSON.stringify(resultados))
  const notifsP2 = (await prisma.notificacaoOperacional.findMany({ where: { processoId: p2.id, tipo: "FASE_CONCLUIDA" } })).filter((n) => meusAdmins.has(n.destinatarioId))
  check("mesmo com 2 chamadas simultâneas, só 2 notificações (1 por admin), não 4", notifsP2.length === 2, String(notifsP2.length))

  console.log("\nCASO 14 — Movimentação manual NUNCA finge ser fase concluída")
  const p3 = await novoProcesso("E4-P3")
  const r3 = await movePhaseManual(p3.id, { faseAlvo: "fase_dois", justificativa: "Teste de movimentação manual — não é conclusão.", motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: admin1.id, origem: "teste-e4" })
  check("movimentação manual aceita", r3.success === true, JSON.stringify(r3))
  check("resultado é MOVIDO (nem AVANCADO, nem FORCADO)", r3.success && r3.resultado === "MOVIDO")
  const notifsP3 = await prisma.notificacaoOperacional.findMany({ where: { processoId: p3.id, tipo: "FASE_CONCLUIDA" } })
  check("ZERO notificações de fase concluída — mover não é concluir", notifsP3.length === 0, String(notifsP3.length))

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${ok + falhas.length} | ✅ ${ok} | ❌ ${falhas.length}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhas.length === 0
    ? "Fase concluída notifica 1x por admin; retry e concorrência não duplicam; mover nunca finge concluir."
    : "CASO 12/13/14 quebrou.")
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}

void main()
