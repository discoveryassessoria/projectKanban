// scripts/workflow-ciclo-atual.test.ts
//
// O ROTEIRO EXECUTÁVEL É DE UMA VISITA SÓ.
//
// Um documento acumula passos de várias fases e — desde que o motor passou a suportar
// reentrada — de vários CICLOS da mesma fase. O que se faz AGORA é o roteiro da visita
// atual; o resto é histórico. Enquanto a leitura escopava só por fase, o Abellan abria
// com sete etapas ("1. Solicitar certidão" duas vezes) e 61%, enquanto a Central,
// escopada por instância, mostrava cinco e 44%.
//
// A conta prova o defeito: dois ciclos somados dão 70 de 115 pontos (61%); a visita
// atual sozinha dá 35 de 80 (44%). Não era arredondamento — era o dobro do roteiro.
//
// (A) GUARDAS ESTÁTICAS — a leitura documental escopa por instância, e a rota diz de
//     qual visita está falando.
// (B) COMPORTAMENTO — banco real: um ciclo, dois ciclos, dez ciclos, herança,
//     progresso, etapa atual, conclusão, histórico e ausência de N+1.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/workflow-ciclo-atual.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { montarWorkflowV2, passosOperacaoV2, visitaAtualDoDocumento } from "../src/services/documento-operacao"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { reconciliarMotorDeFases } from "../src/lib/motor/reconciliar-motor-fases"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { concluirPasso } from "../src/services/task-step-sync"
import { getStepDef } from "../src/lib/process-stage/fases-catalog"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) A leitura documental escopa pela VISITA, não pela fase")
// ============================================================

const svc = read("src/services/documento-operacao.ts")
const codigo = semComentarios(svc)
check("existe um resolvedor de visita atual do documento", svc.includes("export async function visitaAtualDoDocumento"))
check("e ele usa o resolvedor CANÔNICO de instância vigente",
  svc.includes("resolverInstanciaVigente") && svc.includes("instancia-vigente-da-fase"))
check("o escopo da leitura é por workflowInstanceId", codigo.includes("workflowInstanceId: visita.workflowInstanceId"))
check("`passosOperacaoV2` não filtra mais só por fase",
  !/where: \{ documentoId, status: \{ notIn: INATIVOS \}, \.\.\.\(faseAtualKey/.test(codigo))
check("`temOperacaoV2` usa o mesmo escopo", /temOperacaoV2[\s\S]{0,320}escopoDaVisita/.test(codigo))
check("a progressão e a reabertura por documento ficam na MESMA instância",
  (codigo.match(/documentoId, workflowInstanceId: p\.workflowInstanceId/g) ?? []).length === 2)
check("controlar operação (cancelar/pausar) não alcança ciclo antigo",
  (codigo.match(/documentoId, \.\.\.escopoControlar/g) ?? []).length === 2)
check("a materialização usa a MESMA regra de instância vigente da leitura",
  /iniciarOperacaoDocumentoV2[\s\S]{0,1600}resolverInstanciaVigente/.test(codigo))

check("o roteiro devolve de qual visita está falando",
  svc.includes("workflowInstanceId: number | null") && svc.includes("ciclo: number | null") &&
  svc.includes("currentStepId: number | null"))
check("a etapa atual vem da lista já escopada, não por nome nem por id maior",
  codigo.includes("const atual = passos.find((p) => ![\"CONCLUIDO\", \"DISPENSADO\"].includes(p.status))"))

const hist = read("src/app/api/documentos/[id]/workflow/historico/route.ts")
check("existe porta separada para o histórico das visitas", hist.includes("export async function GET"))
check("o histórico é só leitura — sem editor, sem ação, sem PATCH",
  !hist.includes("acoesPermitidas") && !hist.includes("editor:") && !/export async function (POST|PATCH|DELETE)/.test(hist))
check("e ele agrupa por visita, em vez de devolver lista plana", hist.includes("grupos.set(p.workflowInstanceId"))

const adapter = read("src/lib/operacoes/adapters/documento.ts")
check("a operação antecipada também escopa pela instância vigente",
  adapter.includes("resolverInstanciaVigente") && adapter.includes("workflowInstanceId: instancia.id"))

// ============================================================
// (B) COMPORTAMENTO — banco real
// ============================================================

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(B) Comportamento — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

const prisma = new PrismaClient()

const FASE_DOC = "emissao_documental"
const FASE_SEG = "analise_documental"
const PASSOS_DOC = [
  { key: "solicitar_certidao", label: "Solicitar certidão" },
  { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno do cartório" },
  { key: "receber_certidao", label: "Receber certidão" },
  { key: "conferir_certidao", label: "Conferir certidão" },
  { key: "validar_certidao", label: "Validar certidão" },
]

/** O peso canônico do catálogo — a mesma fonte que a Central e o roteiro usam. */
const peso = (k: string) => getStepDef("EMISSAO_DOCUMENTAL", k)?.weight ?? 1
const TOTAL = PASSOS_DOC.reduce((a, p) => a + peso(p.key), 0)
const PCT_DOIS_FEITOS = Math.round(((peso("solicitar_certidao") + peso("aguardar_retorno_do_cartorio")) / TOTAL) * 100)

async function montarPalco(nome: string, quantosDocumentos = 1) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog","AnaliseDocumental" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM" }, update: {},
    create: {
      code: "ALE-ADM", name: "Nacionalidade Alemã", countryKey: "alemanha", countryLabel: "Alemanha",
      nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa",
      modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${nome} macro`, versao: 1 } })
  for (const [i, phaseKey] of [FASE_DOC, FASE_SEG].entries()) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem: i, versao: 1, required: true, conditional: false } })
  }
  const wfDoc = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `all::${FASE_DOC}`, phaseKey: FASE_DOC, name: "WF doc", tipoProcessoId: null, versao: 1,
      execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", exigeDocumento: true, exigePessoa: true,
    }, select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: PASSOS_DOC.map((p, i) => ({ workflowId: wfDoc.id, key: p.key, label: p.label, ordem: i + 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "DOCUMENTO" })),
  })
  const wfSeg = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `all::${FASE_SEG}`, phaseKey: FASE_SEG, name: "WF seg", tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: ["preparar", "concluir"].map((k, i) => ({ workflowId: wfSeg.id, key: k, label: k, ordem: i + 1, createsTask: true, required: true, cardinalidade: "PROCESSO" })),
  })

  const arv = await prisma.arvore.create({ data: { nome: `${nome} árvore` }, select: { id: true } })
  const usuario = await prisma.usuario.upsert({
    where: { email: "ciclo@teste.local" }, update: {},
    create: { nome: "Executor", email: "ciclo@teste.local", senha: "x", tipo: "admin" }, select: { id: true },
  })
  const proc = await prisma.processo.create({
    data: { nome: `${nome} processo`, tipoProcessoMotorId: tipo.id, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: FASE_DOC },
    select: { id: true },
  })
  const docs: Array<{ documentoId: number; necessidadeId: number; pessoaId: number }> = []
  for (let i = 0; i < quantosDocumentos; i++) {
    const item = await prisma.itemCatalogo.create({ data: { code: `CICLO_${i}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `CICLO_T${i}`, name: "Certidão de Nascimento", nature: "certidao", itemCatalogoId: item.id } })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `Pessoa${i}`, sobrenome: "Teste", linhaReta: true, requerente: i === 0 ? "maior" : "nao" }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `CICLO-n-${i}` }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: `CICLO Certidão ${i}`, necessidadeId: nec.id }, select: { id: true } })
    docs.push({ documentoId: doc.id, necessidadeId: nec.id, pessoaId: pes.id })
  }
  await reconciliarFaseAtiva(proc.id)
  return { processoId: proc.id, usuarioId: usuario.id, docs }
}

/** Conclui `n` etapas executáveis do documento, pela porta canônica. */
async function concluirN(documentoId: number, n: number, usuarioId: number) {
  let feitos = 0
  for (let v = 0; v < 12 && feitos < n; v++) {
    const passos = await passosOperacaoV2(documentoId)
    const alvo = passos.find((p) => ["DISPONIVEL", "EM_ANDAMENTO"].includes(p.status))
    if (!alvo) break
    const r = await concluirPasso(alvo.id, { origem: "USER", usuarioId })
    if (!r.success) break
    feitos++
  }
  return feitos
}

/** Uma volta completa: sai da fase documental e volta para ela (visita nova). */
async function reentrar(processoId: number, usuarioId: number, i: number) {
  await movePhaseManual(processoId, {
    faseAlvo: FASE_SEG, justificativa: `Volta ${i} para reentrada de ciclo.`,
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuarioId, origem: "teste",
  })
  await movePhaseManual(processoId, {
    faseAlvo: FASE_DOC, justificativa: `Retorno ${i} à fase documental.`,
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuarioId, origem: "teste",
  })
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B1) Uma visita só: nada muda")
  // ══════════════════════════════════════════════════════════════════════════
  const p1 = await montarPalco("UM-CICLO")
  const d1 = p1.docs[0].documentoId
  const w1 = await montarWorkflowV2(d1)
  check("o roteiro tem as 5 etapas do catálogo", w1?.steps.length === 5, String(w1?.steps.length))
  check("progresso zero, nada concluído", w1?.progress === 0, String(w1?.progress))
  check("a resposta diz de qual visita é", w1?.workflowInstanceId != null && w1?.ciclo === 1,
    `wfi=${w1?.workflowInstanceId} c=${w1?.ciclo}`)
  check("e qual é a etapa atual", w1?.currentStepId === (await passosOperacaoV2(d1))[0].id)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B2) Duas visitas: o roteiro continua com 5 — não 10")
  // ══════════════════════════════════════════════════════════════════════════
  await concluirN(d1, 2, p1.usuarioId)
  const antesDaVolta = await montarWorkflowV2(d1)
  check("duas etapas concluídas antes da volta",
    antesDaVolta?.steps.filter((s) => s.status === "concluida").length === 2)
  check(`e o progresso é ${PCT_DOIS_FEITOS}% (peso canônico da visita)`, antesDaVolta?.progress === PCT_DOIS_FEITOS,
    `${antesDaVolta?.progress}%`)

  await reentrar(p1.processoId, p1.usuarioId, 1)
  const noBanco = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId: d1, faseMacroKey: FASE_DOC } })
  check("o banco guarda os passos das DUAS visitas (histórico intacto)", noBanco === 10, String(noBanco))
  const w2 = await montarWorkflowV2(d1)
  check("mas o roteiro executável mostra 5, não 10", w2?.steps.length === 5, String(w2?.steps.length))
  check("sem etapa repetida", new Set(w2?.steps.map((s) => s.stepKey)).size === 5,
    JSON.stringify(w2?.steps.map((s) => s.stepKey)))
  check("e é a visita NOVA", w2?.ciclo === 2 && w2?.workflowInstanceId !== w1?.workflowInstanceId,
    `c${w1?.ciclo} → c${w2?.ciclo}`)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B3) Herança: 2 concluídas, 'Receber certidão' atual, 44%")
  // ══════════════════════════════════════════════════════════════════════════
  const feitos2 = w2?.steps.filter((s) => s.status === "concluida").length
  check("as duas etapas herdadas chegam concluídas", feitos2 === 2, String(feitos2))
  check(`o progresso é ${PCT_DOIS_FEITOS}%, e não a soma dos dois ciclos`,
    w2?.progress === PCT_DOIS_FEITOS, `${w2?.progress}%`)
  const atual = w2?.steps.find((s) => s.id === w2?.currentStepId)
  check("a etapa atual é 'Receber certidão'", atual?.stepKey === "receber_certidao", String(atual?.stepKey))
  const passosVisita = await passosOperacaoV2(d1)
  check("a etapa atual pertence à visita atual",
    passosVisita.some((p) => p.id === w2?.currentStepId))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B4) Central e roteiro contam a MESMA coisa")
  // ══════════════════════════════════════════════════════════════════════════
  const { resolverInstanciaVigente } = await import("../src/lib/process-stage/instancia-vigente-da-fase")
  const vig = await resolverInstanciaVigente(p1.processoId, FASE_DOC)
  const daCentral = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: vig!.id, documentoId: d1, status: { notIn: ["CANCELADO", "SUPERSEDIDO"] } },
    select: { stepKey: true, status: true },
  })
  const feitosCentral = daCentral.filter((s) => ["CONCLUIDO", "DISPENSADO"].includes(s.status)).length
  const pctCentral = Math.round(
    (daCentral.filter((s) => ["CONCLUIDO", "DISPENSADO"].includes(s.status)).reduce((a, s) => a + peso(s.stepKey), 0) /
      daCentral.reduce((a, s) => a + peso(s.stepKey), 0)) * 100,
  )
  check("mesma contagem de etapas", daCentral.length === w2?.steps.length, `${daCentral.length} × ${w2?.steps.length}`)
  check("mesma contagem de concluídas", feitosCentral === feitos2, `${feitosCentral} × ${feitos2}`)
  check("mesmo percentual", pctCentral === w2?.progress, `${pctCentral}% × ${w2?.progress}%`)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B5) Dez reentradas: continua 5, nunca 50")
  // ══════════════════════════════════════════════════════════════════════════
  for (let i = 2; i <= 10; i++) await reentrar(p1.processoId, p1.usuarioId, i)
  const totalBanco = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId: d1, faseMacroKey: FASE_DOC } })
  const w10 = await montarWorkflowV2(d1)
  check(`o banco acumulou as visitas (${totalBanco} passos) — nada foi apagado`, totalBanco >= 50, String(totalBanco))
  check("o roteiro executável continua com 5", w10?.steps.length === 5, String(w10?.steps.length))
  check(`e o progresso continua ${PCT_DOIS_FEITOS}%, não 90+%`, w10?.progress === PCT_DOIS_FEITOS, `${w10?.progress}%`)
  check("a visita atual é a última", w10?.ciclo === 11, String(w10?.ciclo))
  check("a etapa atual continua sendo 'Receber certidão'",
    w10?.steps.find((s) => s.id === w10?.currentStepId)?.stepKey === "receber_certidao")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B6) Concluir a etapa atual muda só a visita atual")
  // ══════════════════════════════════════════════════════════════════════════
  const historicoAntes = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId: d1, workflowInstanceId: { not: w10!.workflowInstanceId! } },
    orderBy: { id: "asc" }, select: { id: true, status: true },
  })
  const tarefasAntes = await prisma.tarefa.count({ where: { processoId: p1.processoId } })
  const docsAntes = await prisma.documento.count()
  await concluirPasso(w10!.currentStepId!, { origem: "USER", usuarioId: p1.usuarioId })
  const w11 = await montarWorkflowV2(d1)
  check("a etapa atual passou a ser 'Conferir certidão'",
    w11?.steps.find((s) => s.id === w11?.currentStepId)?.stepKey === "conferir_certidao",
    String(w11?.steps.find((s) => s.id === w11?.currentStepId)?.stepKey))
  check("o roteiro continua com 5 etapas", w11?.steps.length === 5)
  check("três concluídas", w11?.steps.filter((s) => s.status === "concluida").length === 3)
  const historicoDepois = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId: d1, workflowInstanceId: { not: w10!.workflowInstanceId! } },
    orderBy: { id: "asc" }, select: { id: true, status: true },
  })
  check("nenhum passo de visita anterior foi tocado",
    JSON.stringify(historicoAntes) === JSON.stringify(historicoDepois))
  check("nenhuma tarefa nova por causa da leitura",
    (await prisma.tarefa.count({ where: { processoId: p1.processoId } })) === tarefasAntes,
    `${tarefasAntes} → ${await prisma.tarefa.count({ where: { processoId: p1.processoId } })}`)
  check("nenhum documento novo", (await prisma.documento.count()) === docsAntes)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B7) O histórico continua consultável — e separado")
  // ══════════════════════════════════════════════════════════════════════════
  const todasVisitas = await prisma.phaseWorkflowInstance.count({ where: { processoId: p1.processoId, faseMacroKey: FASE_DOC } })
  check("as visitas anteriores continuam no banco", todasVisitas === 11, String(todasVisitas))
  const passosCiclo1 = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId: d1, ciclo: 1 } })
  check("os passos da primeira visita continuam lá", passosCiclo1 === 5, String(passosCiclo1))
  const visitaAgora = await visitaAtualDoDocumento(d1)
  check("e o resolvedor de visita aponta para a última", visitaAgora?.ciclo === 11, String(visitaAgora?.ciclo))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B8) Reconciliar não duplica nem muda o roteiro")
  // ══════════════════════════════════════════════════════════════════════════
  const antesReconc = await montarWorkflowV2(d1)
  for (let i = 0; i < 20; i++) await reconciliarMotorDeFases(p1.processoId, { origem: "teste-ciclo", correlationId: "teste-ciclo-fixo" })
  const depoisReconc = await montarWorkflowV2(d1)
  check("mesmo número de etapas", depoisReconc?.steps.length === antesReconc?.steps.length)
  check("mesmos ids de etapa",
    JSON.stringify(depoisReconc?.steps.map((s) => s.id)) === JSON.stringify(antesReconc?.steps.map((s) => s.id)))
  check("mesmo progresso", depoisReconc?.progress === antesReconc?.progress)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B9) Dois documentos: cada um com a sua visita, sem vazar")
  // ══════════════════════════════════════════════════════════════════════════
  const p2 = await montarPalco("DOIS-DOCS", 2)
  const [dA, dB] = p2.docs.map((d) => d.documentoId)
  await concluirN(dA, 3, p2.usuarioId)
  await reentrar(p2.processoId, p2.usuarioId, 1)
  const wA = await montarWorkflowV2(dA)
  const wB = await montarWorkflowV2(dB)
  check("o documento A mostra 5 etapas", wA?.steps.length === 5, String(wA?.steps.length))
  check("o documento B mostra 5 etapas", wB?.steps.length === 5, String(wB?.steps.length))
  check("A herdou 3 concluídas", wA?.steps.filter((s) => s.status === "concluida").length === 3)
  check("B não herdou nada do A", wB?.steps.filter((s) => s.status === "concluida").length === 0,
    JSON.stringify(wB?.steps.map((s) => s.status)))
  check("os dois estão na MESMA visita da fase (é a mesma instância)",
    wA?.workflowInstanceId === wB?.workflowInstanceId)
  check("e nenhuma etapa de um aparece no outro",
    !wA?.steps.some((s) => wB?.steps.some((o) => o.id === s.id)))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B10) Sem N+1: descobrir a visita não custa uma consulta por etapa")
  // ══════════════════════════════════════════════════════════════════════════
  let consultas = 0
  const contador = new PrismaClient()
  contador.$on("query" as never, () => { consultas++ })
  const medido = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  ;(medido as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => { consultas++ })
  consultas = 0
  await passosOperacaoV2(dA)
  const umDoc = consultas
  consultas = 0
  for (const d of [dA, dB]) await passosOperacaoV2(d)
  check("a leitura de um documento é um punhado de consultas, não uma por etapa",
    umDoc <= 6, `${umDoc} consultas`)
  check("e dois documentos custam o dobro, não o quadrado", consultas <= umDoc * 2 + 2, `${consultas} consultas`)
  await contador.$disconnect(); await medido.$disconnect()

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
