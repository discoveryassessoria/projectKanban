// scripts/mover-fase-manual.test.ts
//
// MOVIMENTAÇÃO MANUAL DE FASE — Administrador Master.
//
// (A) AUTORIZAÇÃO (núcleo puro): a permissão é EXCLUSIVA. Nem `tipo = 'admin'` a
//     recebe por ser admin; funcionário não a recebe de jeito nenhum. Só concessão
//     nominal (perfil ou permissões custom) autoriza.
//
// (B) COMPORTAMENTO (banco real): mover para QUALQUER fase — anterior, posterior ou
//     intermediária — sem as validações do fluxo, preservando integralmente tarefas,
//     passos, histórico e auditoria das demais fases, e registrando origem, destino,
//     usuário, data e motivo.
//
// (C) BLINDAGEM ESTÁTICA: a rota exige a permissão exclusiva, lê o usuário do TOKEN
//     (nunca do corpo) e a operação nunca conclui a fase de origem.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/mover-fase-manual.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { calcularPermissoes, PERMISSOES_EXCLUSIVAS, temPermissao } from "../src/lib/permissoes"
import { resultadoDaOperacao, exigeJustificativa } from "../src/lib/motor/phase-advance-helpers"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const PERM = "processos.moverFaseManual"

// ============================================================
console.log("\n(A) Autorização — permissão EXCLUSIVA do Administrador Master")
// ============================================================

check("a permissão existe no catálogo", read("src/lib/permissoes.ts").includes(`'${PERM}'`))
check("está declarada como EXCLUSIVA", PERMISSOES_EXCLUSIVAS.has(PERM))

const funcionario = calcularPermissoes("funcionario")
check("funcionário NÃO recebe a permissão", funcionario[PERM] === false)
check("funcionário é barrado por temPermissao", temPermissao(funcionario, PERM) === false)

const admin = calcularPermissoes("admin")
check("admin por TIPO não recebe a permissão (ser admin não é autorização)", admin[PERM] === false)
check("mas admin continua recebendo as permissões normais", admin["processos.editar"] === true)

const masterPorPerfil = calcularPermissoes("funcionario", { [PERM]: true })
check("concessão NOMINAL no perfil autoriza", masterPorPerfil[PERM] === true)

const masterPorCustom = calcularPermissoes("admin", null, { [PERM]: true })
check("concessão NOMINAL nas permissões custom autoriza", masterPorCustom[PERM] === true)

const revogado = calcularPermissoes("admin", { [PERM]: true }, { [PERM]: false })
check("override individual revoga a concessão do perfil", revogado[PERM] === false)

console.log("\n(A2) A operação é um FATO PRÓPRIO no vocabulário do motor")
check("MOVER tem resultado próprio (não vira FORCADO nem RETORNADO)", resultadoDaOperacao("MOVER") === "MOVIDO")
check("FORCAR continua sendo FORCADO", resultadoDaOperacao("FORCAR") === "FORCADO")
check("RETORNAR continua sendo RETORNADO", resultadoDaOperacao("RETORNAR") === "RETORNADO")
check("MOVER exige justificativa + motivo", exigeJustificativa("MOVER") === true)
check("AVANCAR (fluxo normal) não exige justificativa", exigeJustificativa("AVANCAR") === false)

// ============================================================
console.log("\n(C) Blindagem estática")
// ============================================================

const rota = read("src/app/api/processos/[processoId]/phase/move/route.ts")
const motor = read("src/lib/motor/phase-advance.ts")
const schema = read("prisma/schema.prisma")

check("a rota existe", rota.length > 0)
check("a rota exige a permissão exclusiva", rota.includes(`temPermissao(usuario.permissoes, "${PERM}")`))
check("sem permissão devolve 403 (não 401 nem silêncio)", /status: 403/.test(rota))
check("o usuário da movimentação vem do TOKEN, nunca do corpo", rota.includes("solicitadoPorId: usuario.userId") && !/solicitadoPorId:\s*body/.test(rota))
check("a rota não decide regra de negócio: delega ao motor", rota.includes("movePhaseManual(processoId,"))
check("justificativa e motivo ausentes viram 422", rota.includes("JUSTIFICATIVA_OBRIGATORIA") && rota.includes("MOTIVO_OBRIGATORIO") && /\?\s*422/.test(rota))

check("o motor expõe movePhaseManual", motor.includes("export async function movePhaseManual"))
check("a fase de origem é SUPERSEDIDA, nunca concluída", /operacao: "MOVER"[\s\S]{0,600}encerramento: "SUPERSEDER"/.test(motor))
check("o evento de fase é próprio (FASE_MOVIDA)", motor.includes('eventoFaseTipo: "FASE_MOVIDA"'))
check("`forcado` NÃO é usado para marcar a movimentação manual", /operacao: "MOVER"[\s\S]{0,900}forcado: false/.test(motor))
check("a movimentação não consulta o gate", !/movePhaseManual[\s\S]{0,3000}calcularPendencias\([\s\S]{0,200}blocking/.test(motor))
check("mover para a fase atual é rejeitado (isso é reabertura)", motor.includes("Para reiniciar o ciclo da fase atual, use a reabertura."))
check("fase-alvo tem de existir no macro DO PROCESSO", motor.includes("Fase-alvo inexistente no macro do processo"))

check("enum AdvanceResultado ganhou MOVIDO", /enum AdvanceResultado \{[\s\S]*?MOVIDO/.test(schema))
check("enum WorkflowEventoTipo ganhou FASE_MOVIDA", /enum WorkflowEventoTipo \{[\s\S]*?FASE_MOVIDA/.test(schema))
const mig = read("prisma/migrations/20260803d_mover_fase_manual/migration.sql")
check("a migration é aditiva e idempotente", mig.includes("ADD VALUE IF NOT EXISTS 'MOVIDO'") && mig.includes("ADD VALUE IF NOT EXISTS 'FASE_MOVIDA'"))
check("a migration não altera nem remove nada", !/DROP |DELETE |UPDATE |ALTER TABLE/i.test(mig))
check("a migration está declarada no guard do baseline", read("scripts/baseline-verificar.test.ts").includes("20260803d_mover_fase_manual"))

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

const FASES_MACRO = [
  "genealogia",
  "emissao_documental",
  "analise_documental",
  "retificacao_registros",
  "emissao_documental_retificada",
]

async function main() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog" RESTART IDENTITY CASCADE',
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

  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro ALE", versao: 1 } })
  for (let i = 0; i < FASES_MACRO.length; i++) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASES_MACRO[i], label: FASES_MACRO[i], ordem: i, versao: 1 } })
  }
  for (const phaseKey of FASES_MACRO) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `all::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1 },
    })
    await prisma.phaseInternalWorkflowStep.createMany({
      data: [1, 2].map((n) => ({
        workflowId: wf.id, key: `passo_${n}`, label: `Passo ${n}`, ordem: n,
        createsTask: true, required: true, owner: "equipe_documental", slaDays: 3,
        cardinalidade: "PROCESSO",
      })),
    })
  }

  const arvore = await prisma.arvore.create({ data: { nome: "Árvore Mover" } })
  const pai = await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "nao" } })
  await prisma.pessoa.create({ data: { nome: "Marco", sobrenome: "Rovatti", arvoreId: arvore.id, linhaReta: true, requerente: "maior", paiId: pai.id } })
  // O usuário sobrevive ao TRUNCATE (Usuario fica fora dele, de propósito): upsert.
  const usuario = await prisma.usuario.upsert({
    where: { email: "master@teste.local" },
    update: {},
    create: { nome: "Master", email: "master@teste.local", senha: "x", tipo: "admin" },
  })
  const processo = await prisma.processo.create({
    data: { nome: "Processo Mover", codigo: "T-MOV", pais: "Alemanha", arvoreId: arvore.id, faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  await reconciliarFaseAtiva(processo.id)

  const fotografar = async () => ({
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id } }),
    tarefas: await prisma.tarefa.count({ where: { processoId: processo.id } }),
    instancias: await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id } }),
    eventos: await prisma.workflowEvento.count({ where: { processoId: processo.id } }),
  })

  console.log("\n(B1) Move para uma fase POSTERIOR sem as validações do fluxo")
  const antes = await fotografar()
  const pendentes = await prisma.phaseWorkflowStepInstance.count({
    where: { processoId: processo.id, faseMacroKey: "genealogia", status: { notIn: ["CONCLUIDO", "DISPENSADO"] } },
  })
  check("a fase de origem TEM trabalho pendente (o fluxo automático barraria)", pendentes > 0, String(pendentes))

  const r1 = await movePhaseManual(processo.id, {
    faseAlvo: "retificacao_registros", justificativa: "Processo já estava em retificação no cartório.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("movimentação para fase posterior é aceita", r1.success === true, JSON.stringify(r1))
  check("o resultado é MOVIDO (nem FORCADO, nem RETORNADO)", r1.success && r1.resultado === "MOVIDO")
  const p1 = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  check("a fase atual do processo mudou para o destino", p1?.faseAtualKey === "retificacao_registros", String(p1?.faseAtualKey))

  console.log("\n(B2) Preservação integral do que já existia")
  const depois = await fotografar()
  check("nenhum passo foi apagado", depois.passos >= antes.passos, `${antes.passos} → ${depois.passos}`)
  check("nenhuma tarefa foi apagada", depois.tarefas >= antes.tarefas, `${antes.tarefas} → ${depois.tarefas}`)
  check("nenhuma instância de fase foi apagada", depois.instancias > antes.instancias, `${antes.instancias} → ${depois.instancias}`)
  check("o histórico de eventos só cresce (append-only)", depois.eventos > antes.eventos)

  const origem = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: processo.id, faseMacroKey: "genealogia" }, orderBy: { ciclo: "desc" },
    select: { status: true, completedAt: true, supersededAt: true },
  })
  check("a fase de origem foi SUPERSEDIDA, não concluída", origem?.status === "SUPERSEDIDO" && origem?.completedAt === null)
  check("e ficou com a marca de supersessão", origem?.supersededAt != null)
  const passosOrigem = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id, faseMacroKey: "genealogia" } })
  check("os passos da fase de origem continuam existindo", passosOrigem > 0, String(passosOrigem))

  console.log("\n(B3) Registro obrigatório: origem, destino, usuário, data e motivo")
  const log = await prisma.phaseAdvanceLog.findFirst({
    where: { processoId: processo.id, resultado: "MOVIDO" }, orderBy: { id: "desc" },
  })
  check("existe registro de auditoria da movimentação", log != null)
  check("registra a ORIGEM", log?.faseAtual === "genealogia", String(log?.faseAtual))
  check("registra o DESTINO", log?.fasePretendida === "retificacao_registros", String(log?.fasePretendida))
  check("registra o USUÁRIO", log?.solicitadoPorId === usuario.id)
  check("registra a DATA", log?.criadoEm != null)
  check("registra o MOTIVO (código + justificativa)", log?.motivoCodigo === "CORRECAO_CADASTRO" && (log?.justificativa ?? "").includes("retificação"))
  check("registra de ONDE veio a chamada", log?.origem === "teste")
  check("NÃO se declara 'forçado' (o gate nem foi consultado)", log?.forcado === false)
  const evento = await prisma.workflowEvento.findFirst({ where: { processoId: processo.id, tipo: "FASE_MOVIDA" }, orderBy: { id: "desc" } })
  check("emite evento próprio na timeline (FASE_MOVIDA)", evento != null)
  check("o evento carrega de→para", (() => {
    const d = evento?.dados as { de?: string; para?: string } | null
    return d?.de === "genealogia" && d?.para === "retificacao_registros"
  })())

  console.log("\n(B4) Move para fase ANTERIOR e para fase INTERMEDIÁRIA")
  const r2 = await movePhaseManual(processo.id, {
    faseAlvo: "genealogia", justificativa: "Faltou certidão; voltar ao início.",
    motivoCodigo: "REABERTURA_ADM", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("movimentação para fase anterior é aceita", r2.success === true, JSON.stringify(r2))
  check("a fase anterior recebeu um NOVO ciclo (histórico do ciclo antigo preservado)",
    r2.success && r2.ciclo === 2, r2.success ? String(r2.ciclo) : "")
  const ciclosGenealogia = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id, faseMacroKey: "genealogia" } })
  check("as duas instâncias da genealogia coexistem", ciclosGenealogia === 2, String(ciclosGenealogia))

  const r3 = await movePhaseManual(processo.id, {
    faseAlvo: "analise_documental", justificativa: "Retomar da análise.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("movimentação para fase intermediária é aceita", r3.success === true, JSON.stringify(r3))
  const p3 = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  check("a fase atual reflete a fase intermediária", p3?.faseAtualKey === "analise_documental")

  console.log("\n(B5) Recusas — o que a movimentação manual NÃO aceita")
  const semJust = await movePhaseManual(processo.id, { faseAlvo: "genealogia", justificativa: "", motivoCodigo: "X", solicitadoPorId: usuario.id })
  check("sem justificativa é recusada", !semJust.success && semJust.code === "JUSTIFICATIVA_OBRIGATORIA")
  const semMotivo = await movePhaseManual(processo.id, { faseAlvo: "genealogia", justificativa: "ok", motivoCodigo: "", solicitadoPorId: usuario.id })
  check("sem código de motivo é recusada", !semMotivo.success && semMotivo.code === "MOTIVO_OBRIGATORIO")
  const inexistente = await movePhaseManual(processo.id, { faseAlvo: "fase_que_nao_existe", justificativa: "ok", motivoCodigo: "X", solicitadoPorId: usuario.id })
  check("fase fora do macro do processo é recusada", !inexistente.success && inexistente.code === "FASE_ALVO_INVALIDA")
  const mesma = await movePhaseManual(processo.id, { faseAlvo: "analise_documental", justificativa: "ok", motivoCodigo: "X", solicitadoPorId: usuario.id })
  check("mover para a fase atual é recusado (isso é reabertura)", !mesma.success && mesma.code === "FASE_ALVO_INVALIDA")

  const faseFinal = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  check("nenhuma recusa mexeu na fase do processo", faseFinal?.faseAtualKey === "analise_documental")
  const logsRecusa = await prisma.phaseAdvanceLog.count({ where: { processoId: processo.id, resultado: "MOVIDO" } })
  check("recusa NÃO gera registro de movimentação", logsRecusa === 3, String(logsRecusa))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
  }
  await prisma.$disconnect()
  process.exit(falhas.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
