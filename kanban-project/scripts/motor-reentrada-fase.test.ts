// scripts/motor-reentrada-fase.test.ts
//
// RETROCESSO, REENTRADA E RECONCILIAÇÃO DE FASE — o motor universal.
//
// A pergunta que este arquivo responde: depois de o administrador mover o processo
// para uma fase anterior, e depois de o operador concluir o que faltava lá, o
// processo volta a andar sozinho — sem que nada tenha sido apagado, recriado,
// resetado ou duplicado no caminho?
//
// (A) GUARDAS ESTÁTICAS — sem banco. A regra não pode ter nome de processo nem de
//     fase, e o retrocesso não pode conter operação destrutiva.
//
// (B) COMPORTAMENTO — banco real. O ciclo completo A→B→A→B, com progresso parcial,
//     idempotência, concorrência e recuperação.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/motor-reentrada-fase.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { reconciliarMotorDeFases } from "../src/lib/motor/reconciliar-motor-fases"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { concluirPasso } from "../src/services/task-step-sync"
import { calcularPendencias } from "../src/lib/motor/blocking-engine"
import { garantirOferta } from "./_fixture-oferta"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")
/** Só o CÓDIGO: comentários citam o caso real de propósito e não podem virar violação. */
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) A regra é UNIVERSAL — nenhum nome próprio no motor")
// ============================================================

const MOTOR = [
  "src/lib/motor/reconciliar-motor-fases.ts",
  "src/lib/motor/auto-avanco.ts",
  "src/lib/motor/phase-advance.ts",
  "src/app/api/cron/reconciliar-fases/route.ts",
]
for (const arq of MOTOR) {
  const codigo = semComentarios(read(arq))
  check(`${arq}: sem nome de fase no código`,
    !/["'`](genealogia|emissao_documental|analise_documental)["'`]/.test(codigo))
  check(`${arq}: sem id/nome de processo específico`,
    !/Abellan/i.test(codigo) && !/processoId\s*===\s*\d+/.test(codigo))
}

// A próxima fase vem do macro — não de lista fixa, não de "ordem + 1" cego.
const advance = read("src/lib/motor/phase-advance.ts")
check("a próxima fase é resolvida pelo MACRO do processo",
  advance.includes("macroWorkflow") && advance.includes("proximaFaseAplicavel"))
check("o desvio condicional continua sendo consultado",
  advance.includes("proximaFaseComCondicional") && advance.includes("conditional"))

// ============================================================
console.log("\n(A2) Retrocesso manual NÃO é destrutivo")
// ============================================================

const trechoMover = advance.slice(advance.indexOf("export async function movePhaseManual"))
check("movePhaseManual não apaga tarefa", !/deleteMany|\.delete\(/.test(trechoMover))
check("movePhaseManual não reabre nem conclui passo", !/CONCLUIDO|reabrir/i.test(trechoMover))
check("a fase de origem é SUPERSEDIDA, nunca concluída", trechoMover.includes('encerramento: "SUPERSEDER"'))
check("o destino ganha um ciclo novo (a visita é outra)", trechoMover.includes("proximoCiclo"))

// ============================================================
console.log("\n(A3) O motor tem UMA implementação e ela converge")
// ============================================================

const auto = read("src/lib/motor/auto-avanco.ts")
const reconc = read("src/lib/motor/reconciliar-motor-fases.ts")
check("o reconciliador canônico existe", reconc.includes("export async function reconciliarMotorDeFases"))
check("o gancho por evento DELEGA ao reconciliador (uma implementação só)",
  auto.includes("reconciliarMotorDeFases") && !semComentarios(auto).includes("for (let i"))
check("o reconciliador nunca lança (é chamado depois do commit)", reconc.includes("catch (e)"))
check("o reconciliador EXPLICA quando não avança",
  reconc.includes("pendencias") && reconc.includes("motivo") && reconc.includes("code"))
check("observabilidade técnica com os campos do diagnóstico",
  reconc.includes("faseInicial=") && reconc.includes("satisfeita=") && reconc.includes("corr="))

const cron = read("src/app/api/cron/reconciliar-fases/route.ts")
check("existe varredura de convergência (recuperação)", cron.includes("reconciliarMotorDeFases"))
check("a varredura está agendada", read("vercel.json").includes("/api/cron/reconciliar-fases"))
check("a varredura usa o MESMO gate (não força)", !cron.includes("forceAdvance"))

const ciclo = read("lib/operacional/tarefa-ciclo.ts")
check("as portas canônicas de comando reconciliam depois de mexer no gate",
  ciclo.includes("reconciliarMotorApos") &&
  ["cancelarTarefa", "desbloquearTarefa", "retomarDeEspera", "decidirSobreCausaRemovida", "reabrirTarefa", "removerDependencia"]
    .every((f) => new RegExp(`export async function ${f}\\(`).test(ciclo) && ciclo.includes(`${f}Nucleo(args)`)))
check("e a rota HTTP continua sem conhecer Prisma",
  !semComentarios(read("src/app/api/tarefas/[tarefaId]/comando/route.ts")).includes("prisma."))
const sync = read("src/services/task-step-sync.ts")
check("a máquina de passos pergunta ao motor depois de transição terminal",
  sync.includes("reconciliarMotorAposCommit") && sync.includes("TRANSICOES_QUE_MEXEM_NO_GATE"))

// A herança de reentrada mora no materializador canônico, não num caminho paralelo.
const pw = read("src/services/phase-workflow.ts")
check("a reentrada herda o estado terminal da visita anterior", pw.includes("REENTRADA NA FASE"))
check("só herda estado terminal POSITIVO", pw.includes('HERDAVEIS: StepInstanceStatus[] = ["CONCLUIDO", "DISPENSADO"]'))
check("a herança é registrada no evento (causalidade)", pw.includes("herdadoDoPassoId"))
check("a fila é reposicionada no STATUS INICIAL, não por transição depois",
  pw.includes("ONDE A FILA COMEÇA") && pw.includes("statusInicial.get(a)"))

// ── O RÓTULO DE ORIGEM NÃO PODE DERRUBAR A TRANSIÇÃO ──────────────────────
// `PhaseAdvanceLog.origem` é VarChar(20). Um rótulo comprido a mais fazia o INSERT
// do log estourar e a transação inteira cair — o processo deixava de avançar por
// causa do nome de quem pediu. Aconteceu de verdade ao reconciliar o 523.
check("o motor corta o rótulo de origem no tamanho da coluna",
  advance.includes("function rotuloDeOrigem") && advance.includes("slice(0, 20)"))
check("nenhuma escrita de origem escapa do corte",
  !/origem: (p\.origemLog|ctx\.origem)\b/.test(advance), "há origem sem rotuloDeOrigem")
const ORIGENS = [
  ...ciclo.matchAll(/reconciliarMotorApos\(args\.tarefaId, '([^']+)'\)/g),
  ...sync.matchAll(/reconciliarMotorAposCommit\([^,]+, "([^"]+)"\)/g),
].map((m) => m[1])
check("e os rótulos que o código usa já cabem sem corte",
  ORIGENS.length > 0 && ORIGENS.every((o) => o.length <= 20),
  JSON.stringify(ORIGENS.filter((o) => o.length > 20)))

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

/**
 * AS FASES DO PALCO. O motor não sabe estes nomes — a matriz é do MACRO, não do
 * código, e é por isso que o palco pode escolher quaisquer fases do catálogo.
 *
 * São fases de escopo PROCESSO de propósito: o que está sob teste é o motor de
 * POSIÇÃO (retroceder, reentrar, reconciliar, avançar), não as regras documentais de
 * genealogia/emissão — essas têm suíte própria e trariam para cá pendências que não
 * dizem respeito ao que se quer provar. A última é CONDICIONAL: sem decisão de
 * retificação ela é pulada, o que exercita o desvio e dá ao teste uma fase terminal.
 */
const FASES = ["analise_documental", "traducao_juramentada", "apostilamento", "retificacao_registros"]
const A = FASES[0], B = FASES[1], C = FASES[2]
const PASSOS_POR_FASE = 5

async function montarPalco(nome: string) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog","AnaliseDocumental" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "alemanha", countryLabel: "Alemanha", nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM" }, update: {},
    create: {
      code: "ALE-ADM", name: "Nacionalidade Alemã", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
      processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro palco", versao: 1 } })
  for (let i = 0; i < FASES.length; i++) {
    await prisma.faseMacro.create({
      data: {
        macroWorkflowId: macro.id, phaseKey: FASES[i], label: FASES[i], ordem: i, versao: 1,
        // A última é CONDICIONAL de propósito: o caminho condicional continua sendo
        // exercitado (sem decisão de retificação, ela é pulada).
        required: i < 3, conditional: i === 3,
      },
    })
  }
  for (const phaseKey of FASES) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `all::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL" },
    })
    await prisma.phaseInternalWorkflowStep.createMany({
      data: Array.from({ length: PASSOS_POR_FASE }, (_, n) => ({
        workflowId: wf.id, key: `passo_${n + 1}`, label: `Passo ${n + 1}`, ordem: n + 1,
        createsTask: true, required: true, owner: "equipe_documental", slaDays: 3,
        cardinalidade: "PROCESSO",
      })),
    })
  }
  const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${nome}` } })
  const pai = await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "nao" } })
  await prisma.pessoa.create({ data: { nome: "Marco", sobrenome: "Rovatti", arvoreId: arvore.id, linhaReta: true, requerente: "maior", paiId: pai.id } })
  const usuario = await prisma.usuario.upsert({
    where: { email: "motor@teste.local" }, update: {},
    create: { nome: "Master", email: "motor@teste.local", senha: "x", tipo: "admin" },
  })
  const processo = await prisma.processo.create({
    data: { nome: `Processo ${nome}`, codigo: `T-${nome}`, arvoreId: arvore.id, faseAtualKey: A, tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  await reconciliarFaseAtiva(processo.id)
  return { processo, usuario, tipo }
}

const fase = async (id: number) =>
  (await prisma.processo.findUnique({ where: { id }, select: { faseAtualKey: true } }))?.faseAtualKey ?? null

const contagens = async (id: number) => ({
  passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: id } }),
  tarefas: await prisma.tarefa.count({ where: { processoId: id } }),
  instancias: await prisma.phaseWorkflowInstance.count({ where: { processoId: id } }),
  documentos: await prisma.documento.count({ where: { pessoa: { arvore: { processos: { some: { id } } } } } }),
  necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: id } }),
})

/** Passos VIVOS da fase, no ciclo vigente dela, em ordem. */
async function passosVivos(processoId: number, faseMacroKey: string) {
  const inst = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey }, orderBy: { ciclo: "desc" }, select: { id: true, ciclo: true },
  })
  if (!inst) return []
  return prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: inst.id, status: { notIn: ["CANCELADO", "SUPERSEDIDO"] } },
    orderBy: { ordem: "asc" },
    select: { id: true, stepKey: true, ordem: true, status: true, ciclo: true },
  })
}

const concluidos = async (processoId: number, faseMacroKey: string) =>
  (await passosVivos(processoId, faseMacroKey)).filter((s) => ["CONCLUIDO", "DISPENSADO"].includes(s.status)).length

/** Conclui os N primeiros passos executáveis da fase, pela porta canônica. */
async function concluirNPassos(processoId: number, faseMacroKey: string, n: number, usuarioId: number) {
  let feitos = 0
  for (let volta = 0; volta < PASSOS_POR_FASE + 2 && feitos < n; volta++) {
    const vivos = await passosVivos(processoId, faseMacroKey)
    const alvo = vivos.find((s) => ["DISPONIVEL", "EM_ANDAMENTO"].includes(s.status))
    if (!alvo) break
    const r = await concluirPasso(alvo.id, { origem: "USER", usuarioId })
    if (!r.success) break
    feitos++
  }
  return feitos
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B1) O ciclo real: A conclui → B → trabalho parcial em B → volta para A")
  // ══════════════════════════════════════════════════════════════════════════
  const { processo, usuario } = await montarPalco("REENTRADA")
  const pid = processo.id

  check("o processo nasce na primeira fase", (await fase(pid)) === A)
  const feitosA = await concluirNPassos(pid, A, PASSOS_POR_FASE, usuario.id)
  check("todos os passos de A foram concluídos pela porta canônica", feitosA === PASSOS_POR_FASE, String(feitosA))
  check("A satisfeita leva o processo para B sozinho", (await fase(pid)) === B, String(await fase(pid)))

  // Trabalho PARCIAL em B: 2 de 5.
  const feitosB = await concluirNPassos(pid, B, 2, usuario.id)
  check("2 passos de B concluídos", feitosB === 2, String(feitosB))
  check("B está em 2/5", (await concluidos(pid, B)) === 2, String(await concluidos(pid, B)))

  const instBantes = (await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: pid, faseMacroKey: B }, orderBy: { ciclo: "desc" }, select: { id: true } }))!.id
  const antes = await contagens(pid)
  const tarefaB = await prisma.tarefa.findFirst({ where: { processoId: pid, faseMacroKey: B }, orderBy: { id: "desc" } })
  if (tarefaB) {
    await prisma.tarefa.update({ where: { id: tarefaB.id }, data: { responsavelId: usuario.id, dataPrazo: new Date("2030-01-15T12:00:00Z") } })
  }

  // O ADMINISTRADOR RETROCEDE.
  const mv = await movePhaseManual(pid, {
    faseAlvo: A, justificativa: "Faltou localizar um registro na fase anterior.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("o retrocesso manual é aceito", mv.success === true, JSON.stringify(mv).slice(0, 160))
  check("a posição macro voltou para A", (await fase(pid)) === A)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B2) O retrocesso mudou SÓ a posição — nada foi destruído")
  // ══════════════════════════════════════════════════════════════════════════
  const depoisDoRetrocesso = await contagens(pid)
  check("nenhuma tarefa apagada", depoisDoRetrocesso.tarefas >= antes.tarefas, `${antes.tarefas} → ${depoisDoRetrocesso.tarefas}`)
  check("nenhum passo apagado", depoisDoRetrocesso.passos >= antes.passos, `${antes.passos} → ${depoisDoRetrocesso.passos}`)
  check("nenhum documento apagado", depoisDoRetrocesso.documentos >= antes.documentos)
  check("nenhuma necessidade apagada", depoisDoRetrocesso.necessidades >= antes.necessidades)

  const passosBpreservados = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: instBantes, status: "CONCLUIDO" },
  })
  check("os passos CONCLUÍDOS de B continuam concluídos", passosBpreservados === 2, String(passosBpreservados))

  if (tarefaB) {
    const t = await prisma.tarefa.findUnique({ where: { id: tarefaB.id }, select: { responsavelId: true, dataPrazo: true, statusTarefa: true } })
    check("o responsável da tarefa de B foi preservado", t?.responsavelId === usuario.id)
    check("o prazo da tarefa de B foi preservado", t?.dataPrazo?.toISOString().startsWith("2030-01-15") === true, String(t?.dataPrazo))
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B3) A volta com o que já estava feito — e uma obrigação NOVA a segura")
  // ══════════════════════════════════════════════════════════════════════════
  check("a nova visita a A herdou o trabalho já concluído", (await concluidos(pid, A)) === PASSOS_POR_FASE,
    `${await concluidos(pid, A)}/${PASSOS_POR_FASE}`)

  // NASCE UMA OBRIGAÇÃO NOVA na fase — é por isso que o administrador voltou. Ela
  // não tem de quem herdar, então tem de chegar PENDENTE e segurar a fase (§26: o
  // que manda é o estado ATUAL, não o histórico de conclusão).
  const wfA = (await prisma.phaseInternalWorkflow.findFirst({ where: { phaseKey: A } }))!
  await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wfA.id, key: `passo_${PASSOS_POR_FASE + 1}`, label: `Passo ${PASSOS_POR_FASE + 1}`,
      ordem: PASSOS_POR_FASE + 1, createsTask: true, required: true, owner: "equipe_documental",
      slaDays: 3, cardinalidade: "PROCESSO",
    },
  })
  await reconciliarFaseAtiva(pid)
  const vivosA = await passosVivos(pid, A)
  const novo = vivosA.find((s) => s.stepKey === `passo_${PASSOS_POR_FASE + 1}`)
  check("a obrigação nova foi materializada na visita atual", !!novo, JSON.stringify(vivosA.map((s) => s.stepKey)))
  check("e chegou executável, não presa atrás de dependência já cumprida",
    novo?.status === "DISPONIVEL", String(novo?.status))
  check("a nova visita a A tem trabalho a fazer", vivosA.some((s) => !["CONCLUIDO", "DISPENSADO"].includes(s.status)))
  const d1 = await reconciliarMotorDeFases(pid, { origem: "teste" })
  check("com pendência, a reconciliação não move o processo", d1.transicoes.length === 0 && (await fase(pid)) === A)
  check("e devolve a pendência real como motivo", d1.pendencias.length > 0, JSON.stringify(d1.pendencias.map((p) => p.code)))
  check("o código do motivo é BLOQUEADO", d1.code === "BLOQUEADO", d1.code)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B4) Concluída a pendência de A, o motor volta para B sozinho")
  // ══════════════════════════════════════════════════════════════════════════
  const restantes = await concluirNPassos(pid, A, PASSOS_POR_FASE, usuario.id)
  check("as pendências de A foram concluídas", restantes > 0, String(restantes))
  check("o processo voltou para B", (await fase(pid)) === B, String(await fase(pid)))
  check("não pulou para C", (await fase(pid)) !== C)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B5) B reencontrada: o trabalho de antes continua lá (2/5, não 0/5)")
  // ══════════════════════════════════════════════════════════════════════════
  const feitosBdepois = await concluidos(pid, B)
  check("B continua em 2 de 5", feitosBdepois === 2, `${feitosBdepois}/5`)
  const vivosBdepois = await passosVivos(pid, B)
  check("não é 0/5 (nada recomeçou)", feitosBdepois !== 0)
  check("não é 5/5 (nada foi dado por feito)", feitosBdepois !== PASSOS_POR_FASE)
  check("o terceiro passo está DISPONÍVEL para continuar", vivosBdepois[2]?.status === "DISPONIVEL", vivosBdepois[2]?.status)
  const herdados = await prisma.phaseWorkflowStepInstance.count({
    where: { processoId: pid, faseMacroKey: B, metadata: { path: ["reentrada", "status"], equals: "CONCLUIDO" } },
  })
  check("os passos herdados registram de onde vieram", herdados === 2, String(herdados))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B6) Reentrada NÃO duplica")
  // ══════════════════════════════════════════════════════════════════════════
  const final = await contagens(pid)
  // A DUPLICIDADE QUE IMPORTA É A VIVA. A tarefa da visita anterior continua no
  // banco, terminal — é histórico, e apagá-la seria justamente a destruição que o
  // retrocesso não pode causar. O que não pode existir é a MESMA unidade com duas
  // tarefas ABERTAS ao mesmo tempo: aí sim o mesmo trabalho apareceria duas vezes na
  // fila de alguém.
  const TERMINAIS = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] as const
  const vivasPorUnidade = await prisma.tarefa.groupBy({
    by: ["processoId", "necessidadeId", "documentoId", "faseMacroKey"],
    where: { processoId: pid, statusTarefa: { notIn: [...TERMINAIS] } },
    _count: { _all: true },
  })
  check("nenhuma unidade tem duas tarefas VIVAS na mesma fase",
    vivasPorUnidade.every((g) => g._count._all === 1), JSON.stringify(vivasPorUnidade.map((g) => g._count._all)))
  const historicaDeB = await prisma.tarefa.findFirst({
    where: { processoId: pid, faseMacroKey: B, ciclo: 1 }, select: { statusTarefa: true },
  })
  check("a tarefa da visita anterior a B foi preservada e NÃO foi reaberta",
    historicaDeB != null && (TERMINAIS as readonly string[]).includes(historicaDeB.statusTarefa), String(historicaDeB?.statusTarefa))
  check("necessidades não duplicaram", final.necessidades === antes.necessidades, `${antes.necessidades} → ${final.necessidades}`)
  check("documentos não duplicaram", final.documentos === antes.documentos, `${antes.documentos} → ${final.documentos}`)
  const instB = await prisma.phaseWorkflowInstance.count({ where: { processoId: pid, faseMacroKey: B, status: { in: ["ATIVO", "AGUARDANDO", "BLOQUEADO"] } } })
  check("existe UMA instância viva de B (a visita atual)", instB === 1, String(instB))
  const passosVivosB = await prisma.phaseWorkflowStepInstance.groupBy({
    by: ["stepKey"], where: { processoId: pid, faseMacroKey: B, status: { notIn: ["CANCELADO", "SUPERSEDIDO"] }, ciclo: 2 },
    _count: { _all: true },
  })
  check("nenhum passo duplicado no ciclo vigente de B",
    passosVivosB.every((g) => g._count._all === 1), JSON.stringify(passosVivosB))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B7) Idempotência: reconciliar 20 vezes não cria nada")
  // ══════════════════════════════════════════════════════════════════════════
  const antes20 = await contagens(pid)
  const eventos20 = await prisma.workflowEvento.count({ where: { processoId: pid } })
  const fase20 = await fase(pid)
  for (let i = 0; i < 20; i++) await reconciliarMotorDeFases(pid, { origem: "teste-idempotencia", correlationId: "teste-idem-fixo" })
  const depois20 = await contagens(pid)
  check("a fase não mudou", (await fase(pid)) === fase20)
  check("nenhum passo novo", depois20.passos === antes20.passos, `${antes20.passos} → ${depois20.passos}`)
  check("nenhuma tarefa nova", depois20.tarefas === antes20.tarefas, `${antes20.tarefas} → ${depois20.tarefas}`)
  check("nenhuma instância nova", depois20.instancias === antes20.instancias, `${antes20.instancias} → ${depois20.instancias}`)
  check("nenhum documento/necessidade novo", depois20.documentos === antes20.documentos && depois20.necessidades === antes20.necessidades)
  check("nenhum evento novo", (await prisma.workflowEvento.count({ where: { processoId: pid } })) === eventos20)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B8) A MESMA transição A→B pode acontecer de novo (histórico, não bloqueio)")
  // ══════════════════════════════════════════════════════════════════════════
  const movidas = await prisma.phaseAdvanceLog.findMany({
    where: { processoId: pid, resultado: { in: ["MOVIDO", "AVANCADO"] } },
    orderBy: { id: "asc" }, select: { faseAtual: true, fasePretendida: true, resultado: true, origem: true, chaveIdempotencia: true },
  })
  const rota = movidas.map((m) => `${m.faseAtual}→${m.fasePretendida}`)
  check("o histórico registra as três transições reais", rota.length >= 3, JSON.stringify(rota))
  check(`a rota é ${A}→${B}, ${B}→${A}, ${A}→${B}`,
    rota[0] === `${A}→${B}` && rota[1] === `${B}→${A}` && rota[2] === `${A}→${B}`, JSON.stringify(rota))
  check("as duas transições A→B têm chaves de idempotência DIFERENTES (visitas diferentes)",
    movidas[0].chaveIdempotencia !== movidas[2].chaveIdempotencia,
    `${movidas[0].chaveIdempotencia} × ${movidas[2].chaveIdempotencia}`)
  check("o histórico distingue manual de automático",
    movidas.some((m) => m.origem === "teste") && movidas.some((m) => m.origem !== "teste"),
    JSON.stringify(movidas.map((m) => m.origem)))
  const instanciasB = await prisma.phaseWorkflowInstance.count({ where: { processoId: pid, faseMacroKey: B } })
  check("as duas visitas a B são ciclos distintos, ambos preservados", instanciasB === 2, String(instanciasB))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B9) Concorrência: duas reconciliações simultâneas = UMA transição")
  // ══════════════════════════════════════════════════════════════════════════
  const palcoC = await montarPalco("CONCORRENCIA")
  await concluirNPassos(palcoC.processo.id, A, PASSOS_POR_FASE, palcoC.usuario.id)
  // Já avançou para B pelo gancho; volta o processo para A pela porta manual e
  // conclui de novo — mas dispara DUAS reconciliações ao mesmo tempo.
  await movePhaseManual(palcoC.processo.id, {
    faseAlvo: A, justificativa: "Rodada de concorrência do motor.", motivoCodigo: "CORRECAO_CADASTRO",
    solicitadoPorId: palcoC.usuario.id, origem: "teste",
  })
  await concluirNPassos(palcoC.processo.id, A, PASSOS_POR_FASE, palcoC.usuario.id)
  const faseAntesConc = await fase(palcoC.processo.id)
  const logsAntes = await prisma.phaseAdvanceLog.count({ where: { processoId: palcoC.processo.id, resultado: { in: ["MOVIDO", "AVANCADO"] } } })
  await Promise.all([
    reconciliarMotorDeFases(palcoC.processo.id, { origem: "teste-conc-1" }),
    reconciliarMotorDeFases(palcoC.processo.id, { origem: "teste-conc-2" }),
  ])
  const logsDepois = await prisma.phaseAdvanceLog.count({ where: { processoId: palcoC.processo.id, resultado: { in: ["MOVIDO", "AVANCADO"] } } })
  // A fase estava satisfeita: UMA transição é o resultado correto. O que a corrida
  // não pode produzir é DUAS — a mesma passagem contada duas vezes.
  check("a corrida produziu exatamente UMA transição", logsDepois === logsAntes + 1, `${logsAntes} → ${logsDepois}`)
  check("o processo avançou uma única fase", (await fase(palcoC.processo.id)) === B && faseAntesConc === A,
    `${faseAntesConc} → ${await fase(palcoC.processo.id)}`)
  const instDup = await prisma.phaseWorkflowInstance.groupBy({
    by: ["faseMacroKey", "ciclo"], where: { processoId: palcoC.processo.id }, _count: { _all: true },
  })
  check("nenhuma instância de fase duplicada por corrida", instDup.every((g) => g._count._all === 1), JSON.stringify(instDup))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B10) Retrocesso para uma fase JÁ satisfeita → apto a voltar")
  // ══════════════════════════════════════════════════════════════════════════
  const palcoS = await montarPalco("SATISFEITA")
  await concluirNPassos(palcoS.processo.id, A, PASSOS_POR_FASE, palcoS.usuario.id)
  check("o processo está em B", (await fase(palcoS.processo.id)) === B)
  await movePhaseManual(palcoS.processo.id, {
    faseAlvo: A, justificativa: "Revisão administrativa da fase anterior.", motivoCodigo: "CORRECAO_CADASTRO",
    solicitadoPorId: palcoS.usuario.id, origem: "teste",
  })
  check("o movimento manual coloca o processo em A mesmo com A satisfeita", (await fase(palcoS.processo.id)) === A)
  const passosAherdados = await concluidos(palcoS.processo.id, A)
  check("a nova visita a A já nasce com o trabalho anterior preservado", passosAherdados === PASSOS_POR_FASE, `${passosAherdados}/${PASSOS_POR_FASE}`)
  const gate = await calcularPendencias(palcoS.processo.id, A, { correlationId: "teste" })
  check("o gate de A está aberto (nada pendente)", gate.canAdvance === true, JSON.stringify(gate.blocking.map((b) => b.code)))
  const dS = await reconciliarMotorDeFases(palcoS.processo.id, { origem: "teste" })
  check("a reconciliação devolve o processo para B", (await fase(palcoS.processo.id)) === B, String(await fase(palcoS.processo.id)))
  check("e a transição foi registrada", dS.transicoes.length === 1, JSON.stringify(dS.transicoes))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B11) Recuperação: a pendência cai por FORA do gancho, e o motor converge")
  // ══════════════════════════════════════════════════════════════════════════
  const palcoR = await montarPalco("RECUPERACAO")
  const rid = palcoR.processo.id
  await concluirNPassos(rid, A, PASSOS_POR_FASE - 1, palcoR.usuario.id)
  check("A ainda tem o último passo em aberto", (await concluidos(rid, A)) === PASSOS_POR_FASE - 1)
  // ESCRITA DIRETA de propósito: simula exatamente o que aconteceu em produção —
  // a última pendência caindo por um caminho que NÃO chama o gancho (um reparo, uma
  // reconciliação de estado derivado, uma falha depois do commit). O motor não pode
  // depender de ter sido avisado.
  const ultimo = (await passosVivos(rid, A)).find((s) => !["CONCLUIDO", "DISPENSADO"].includes(s.status))!
  await prisma.phaseWorkflowStepInstance.update({ where: { id: ultimo.id }, data: { status: "CONCLUIDO", completedAt: new Date() } })
  await prisma.tarefa.updateMany({ where: { processoId: rid, faseMacroKey: A, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CANCELADA"] } }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date() } })
  check("o processo ficou parado em A com o gate aberto (o bug de produção)",
    (await fase(rid)) === A && (await calcularPendencias(rid, A, { correlationId: "t" })).canAdvance === true)
  const dR = await reconciliarMotorDeFases(rid, { origem: "teste-recuperacao" })
  check("a reconciliação convergente destrava o processo", (await fase(rid)) === B, String(await fase(rid)))
  check("e explica o que fez", dR.transicoes.length === 1 && dR.transicoes[0].de === A && dR.transicoes[0].para === B)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B12) Fase terminal: sem próxima fase, o motor para (sem laço)")
  // ══════════════════════════════════════════════════════════════════════════
  // C é a última fase APLICÁVEL: a seguinte é condicional e, sem decisão de
  // retificação, não entra no caminho.
  const ultimaFase = C
  await prisma.processo.update({ where: { id: rid }, data: { faseAtualKey: ultimaFase } })
  const dT = await reconciliarMotorDeFases(rid, { origem: "teste-terminal" })
  check("na última fase o motor não tenta avançar", dT.transicoes.length === 0)
  check("e o motivo é a ausência de destino", dT.code === "SEM_PROXIMA_FASE", dT.code)
  check("a fase permanece a última", (await fase(rid)) === ultimaFase)

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
