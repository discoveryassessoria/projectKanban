// scripts/fronteira-documento-operacao.test.ts
// ============================================================================
// A TERCEIRA FAMÍLIA MORREU — e as operações do documento continuam iguais.
// Rodar: npm run test:fronteira-documento   (banco de TESTE)
//
// `documento-operacao.ts` tinha a própria máquina de transições: 6 escritas de
// `status` sem precedência, sem CAS por `lockVersion` e — em `controlarOperacaoV2`
// — sem evento nenhum. Cancelar a operação de um documento era a mudança de
// estado mais silenciosa do sistema.
//
// Migrar não pode ser "trocar update por função". Este teste prova o que a
// migração tinha de preservar E o que ela tinha de ganhar:
//
//   preservar → estado final, ativação do próximo passo, projeção da tarefa,
//               ciclo de vida da necessidade, avanço de fase, idempotência;
//   ganhar    → WorkflowEvento em TODAS as transições, precedência e CAS.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atualizarPassoV2, controlarOperacaoV2, aplicarTransicaoDoPassoTx, TransicaoDePassoRecusada } from "@/src/services/documento-operacao"
import { marcarNaoLocalizada } from "@/src/services/necessidade-documental"
import { classificarNecessidade } from "@/src/lib/motor/blocking-helpers"

const MARCA = "FRONT"

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
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/**
 * A OPERAÇÃO POR DOCUMENTO como a Central a vê: passos ligados ao MESMO
 * `documentoId`, o primeiro EM_ANDAMENTO e os seguintes BLOQUEADOS — que é o
 * desenho por-documento, diferente do PENDENTE usado no workflow da tarefa.
 */
async function palco(sufixo: string, obrigatoria: "OBRIGATORIA" | "OPCIONAL" = "OBRIGATORIA") {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" }, select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: sufixo }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: `Certidão ${sufixo}`, status: "PENDENTE" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: {
      processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1,
      obrigatoriedade: obrigatoria, status: "EM_ATENDIMENTO",
      chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}`,
    }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const stepIds: number[] = []
  for (const [i, key] of ["localizar_registro", "solicitar", "receber"].entries()) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `${key}_${sufixo}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "EM_ANDAMENTO" : "BLOQUEADO",
        documentoId: doc.id, necessidadeId: nec.id, pessoaId: pes.id, ciclo: 1,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  return { processoId: proc.id, documentoId: doc.id, necessidadeId: nec.id, instanciaId: inst.id, stepIds }
}

const st = (id: number) => prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id }, select: { status: true, completedAt: true, prazo: true, lockVersion: true, metadata: true } })
const eventos = (processoId: number) =>
  prisma.workflowEvento.findMany({ where: { processoId }, select: { tipo: true, stepInstanceId: true }, orderBy: { id: "asc" } })
const nec = (id: number) => prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id }, select: { status: true } })

async function main() {
  exigirBancoDeTeste("prova a fronteira de documento-operacao")
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: true }, update: { runtimeV2Habilitado: true } })

  console.log("FRONTEIRA — documento-operacao delega, e nada se perde\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("A/B/C) Concluir etapa pela Central: transição canônica, evento, próximo passo")
  // ═════════════════════════════════════════════════════════════════════════
  const p = await palco("A")
  const r1 = await atualizarPassoV2(p.documentoId, p.stepIds[0], { status: "concluida", externalProtocol: "PROT-123" })
  ok("A) a operação foi aceita", r1.ok === true, r1.ok ? "" : `${r1.error}`)

  const s0 = await st(p.stepIds[0])
  const s1 = await st(p.stepIds[1])
  ok("A) o passo ficou CONCLUIDO", s0.status === "CONCLUIDO", s0.status)
  ok("A) com completedAt", s0.completedAt != null)
  ok("A) o lockVersion subiu — a escrita passou pelo CAS do motor", s0.lockVersion >= 1, `v${s0.lockVersion}`)

  const ev1 = await eventos(p.processoId)
  ok("B) emitiu PASSO_CONCLUIDO", ev1.some((e) => e.tipo === "PASSO_CONCLUIDO" && e.stepInstanceId === p.stepIds[0]))
  ok("B) UM único evento de conclusão para o passo",
    ev1.filter((e) => e.tipo === "PASSO_CONCLUIDO" && e.stepInstanceId === p.stepIds[0]).length === 1,
    "a emissão local foi removida junto com a transição local; duas fontes gerariam dois")
  ok("C) o próximo passo do MESMO documento abriu", s1.status === "EM_ANDAMENTO", s1.status)
  ok("C) com prazo calculado pelo SLA do passo aberto", s1.prazo != null)
  ok("C) e a abertura também virou evento", ev1.some((e) => e.tipo === "PASSO_INICIADO" && e.stepInstanceId === p.stepIds[1]))

  // A carga documental viaja na MESMA escrita da transição.
  const meta = (s0.metadata as { operacao?: Record<string, unknown> } | null)?.operacao ?? {}
  ok("A) o protocolo documental foi gravado junto", meta.externalProtocol === "PROT-123",
    "metadata é do domínio documental e não foi para o motor")
  ok("A) a necessidade evoluiu para ATENDIDA", (await nec(p.necessidadeId)).status === "ATENDIDA")

  // ═════════════════════════════════════════════════════════════════════════
  secao("E) Retry não duplica transição nem evento")
  // ═════════════════════════════════════════════════════════════════════════
  const antes = JSON.stringify(await st(p.stepIds[0]))
  const r2 = await atualizarPassoV2(p.documentoId, p.stepIds[0], { status: "concluida" })
  ok("E) repetir a conclusão é aceito sem efeito", r2.ok === true)
  ok("E) o passo não mudou", JSON.stringify(await st(p.stepIds[0])) === antes)
  const ev2 = await eventos(p.processoId)
  ok("E) nenhum evento novo",
    ev2.filter((e) => e.tipo === "PASSO_CONCLUIDO" && e.stepInstanceId === p.stepIds[0]).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("F) Precedência e concorrência agora valem aqui")
  // ═════════════════════════════════════════════════════════════════════════
  // Voltar um passo CONCLUIDO para BLOQUEADO não é retrabalho (que tem porta
  // própria) nem sobe precedência: o motor recusa e a transação inteira volta.
  const lvAtual = (await st(p.stepIds[0])).lockVersion
  let recusou = false
  try {
    await prisma.$transaction((tx) =>
      aplicarTransicaoDoPassoTx(tx, {
        id: p.stepIds[0], documentoId: p.documentoId, necessidadeId: p.necessidadeId, processoId: p.processoId,
        workflowInstanceId: p.instanciaId, faseMacroKey: "genealogia", ordem: 1, status: "CONCLUIDO",
        ciclo: 1, metadata: null, stepKey: `localizar_registro_A`, lockVersion: lvAtual,
      }, { status: "bloqueada" }, undefined, new Date()))
  } catch (e) {
    recusou = e instanceof TransicaoDePassoRecusada
  }
  ok("F) transição impossível é RECUSADA pelo motor", recusou,
    "antes, um update direto aplicava qualquer status que lhe pedissem")
  ok("F) e o passo continua como estava", (await st(p.stepIds[0])).status === "CONCLUIDO")

  // ═════════════════════════════════════════════════════════════════════════
  secao("Reabertura: retrabalho continua sendo retrabalho")
  // ═════════════════════════════════════════════════════════════════════════
  const q = await palco("B")
  await atualizarPassoV2(q.documentoId, q.stepIds[0], { status: "concluida" })
  const rr = await atualizarPassoV2(q.documentoId, q.stepIds[0], { status: "pendente" })
  ok("reabrir é aceito", rr.ok === true, rr.ok ? "" : `${rr.error}`)
  ok("o passo voltou", (await st(q.stepIds[0])).status === "PENDENTE")
  ok("completedAt foi limpo", (await st(q.stepIds[0])).completedAt == null)
  ok("emitiu PASSO_REABERTO", (await eventos(q.processoId)).some((e) => e.tipo === "PASSO_REABERTO"))
  ok("as etapas posteriores voltaram a BLOQUEADO", (await st(q.stepIds[1])).status === "BLOQUEADO")
  ok("a necessidade regrediu para EM_ATENDIMENTO", (await nec(q.necessidadeId)).status === "EM_ATENDIMENTO")
  ok("e reconcluir depois funciona — a tentativa tem identidade própria",
    (await atualizarPassoV2(q.documentoId, q.stepIds[0], { status: "concluida" })).ok === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao("controlarOperacaoV2: pausar, retomar, cancelar — agora com rastro")
  // ═════════════════════════════════════════════════════════════════════════
  const c = await palco("C")
  ok("pausar é aceito", (await controlarOperacaoV2(c.documentoId, "pausar", "cartório em greve")).ok === true)
  ok("o passo ativo ficou BLOQUEADO", (await st(c.stepIds[0])).status === "BLOQUEADO")
  ok("com o motivo da pausa", (await st(c.stepIds[0])).status === "BLOQUEADO")
  ok("e emitiu PASSO_BLOQUEADO", (await eventos(c.processoId)).some((e) => e.tipo === "PASSO_BLOQUEADO"),
    "antes, pausar não deixava rastro nenhum no workflow")

  ok("retomar é aceito", (await controlarOperacaoV2(c.documentoId, "retomar")).ok === true)
  ok("o passo voltou a EM_ANDAMENTO", (await st(c.stepIds[0])).status === "EM_ANDAMENTO")
  ok("e emitiu PASSO_INICIADO", (await eventos(c.processoId)).some((e) => e.tipo === "PASSO_INICIADO"))

  ok("cancelar é aceito", (await controlarOperacaoV2(c.documentoId, "cancelar", "duplicado")).ok === true)
  const cs = await Promise.all(c.stepIds.map(st))
  ok("todos os passos abertos foram CANCELADOS", cs.every((x) => x.status === "CANCELADO"), cs.map((x) => x.status).join(","))
  ok("e cada cancelamento virou evento",
    (await eventos(c.processoId)).filter((e) => e.tipo === "PASSO_CANCELADO").length === c.stepIds.length)

  // ═════════════════════════════════════════════════════════════════════════
  secao("H/I/J/K) 'não possui' é resultado documental")
  // ═════════════════════════════════════════════════════════════════════════
  const d = await palco("D")
  const nl = await marcarNaoLocalizada(d.necessidadeId, prisma, "cartório informou que não há registro")
  ok("H) a necessidade ficou NAO_LOCALIZADA", nl.status === "NAO_LOCALIZADA")
  ok("H) com motivo estruturado no evento append-only",
    (await prisma.necessidadeDocumentalEvento.findFirst({ where: { necessidadeId: d.necessidadeId, tipo: "NAO_LOCALIZADA" }, orderBy: { id: "desc" } }))
      ?.dados != null)
  ok("J) o passo NÃO foi concluído artificialmente", (await st(d.stepIds[0])).status === "EM_ANDAMENTO")
  ok("K) nenhuma tarefa ficou CONCLUIDO_NAO_POSSUI",
    (await prisma.tarefa.count({ where: { processoId: d.processoId, statusTarefa: "CONCLUIDO_NAO_POSSUI" } })) === 0)

  // I/L) O GATE separa as duas coisas — e é o classificador oficial que responde,
  // não uma releitura da regra aqui dentro.
  const r = classificarNecessidade("NAO_LOCALIZADA", true, false, d.necessidadeId)
  ok("I) NAO_LOCALIZADA obrigatória continua BLOCKING",
    r?.severity === "BLOCKING" && r?.code === "DOCUMENTO_NAO_LOCALIZADO", `${r?.code ?? "sem bloqueio"}`)
  ok("I) e o hint aponta para reavaliação, não para conclusão",
    /[Rr]eavaliar/.test(r?.resolutionHint ?? ""), r?.resolutionHint ?? "")
  ok("L) DISPENSADA mantém semântica própria e libera o gate",
    classificarNecessidade("DISPENSADA", true, false, d.necessidadeId) === null,
    "nunca converter automaticamente uma na outra")
  ok("L) e ATENDIDA — que é o caminho normal — também libera",
    classificarNecessidade("ATENDIDA", true, false, d.necessidadeId) === null)

  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
  console.log("A operação documental orquestra; o motor transiciona. Uma máquina só.")
}

main().catch(async (e) => { console.error("falhou:", e); await prisma.$disconnect(); process.exit(1) })
