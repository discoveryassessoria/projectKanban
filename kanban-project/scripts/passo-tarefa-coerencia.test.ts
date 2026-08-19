// scripts/passo-tarefa-coerencia.test.ts
//
// PASSO É O ESTADO OFICIAL; A TAREFA É PROJEÇÃO DELE.
//
// (A) NÚCLEO PURO — mapeamento oficial e regra de coerência (contradição ≠ diferença).
// (B) COMPORTAMENTO (banco real) — iniciar/concluir pelos dois lados, reabertura,
//     movimentação de fase, novo ciclo, rollback e reparo idempotente.
// (C) BLINDAGEM ESTÁTICA — nenhum caminho escreve status de passo sem projetar a
//     tarefa; a trava de coerência roda antes do commit.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL (ver materializacao-fase-unica.test.ts).

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { paresCoerentes, STATUS_TAREFA_POR_PASSO } from "../src/services/passo-tarefa-projecao"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) Mapeamento oficial passo → tarefa")
// ============================================================

check("PENDENTE → NAO_INICIADA", STATUS_TAREFA_POR_PASSO.PENDENTE === "NAO_INICIADA")
check("DISPONIVEL → NAO_INICIADA", STATUS_TAREFA_POR_PASSO.DISPONIVEL === "NAO_INICIADA")
check("EM_ANDAMENTO → EM_ANDAMENTO", STATUS_TAREFA_POR_PASSO.EM_ANDAMENTO === "EM_ANDAMENTO")
check("CONCLUIDO → CONCLUIDO_RECEBIDO", STATUS_TAREFA_POR_PASSO.CONCLUIDO === "CONCLUIDO_RECEBIDO")
check("CANCELADO → CANCELADA", STATUS_TAREFA_POR_PASSO.CANCELADO === "CANCELADA")
check("DISPENSADO (não aplicável) → CANCELADA", STATUS_TAREFA_POR_PASSO.DISPENSADO === "CANCELADA")
check("SUPERSEDIDO → SUPERSEDIDA", STATUS_TAREFA_POR_PASSO.SUPERSEDIDO === "SUPERSEDIDA")
check("BLOQUEADO → BLOQUEADA", STATUS_TAREFA_POR_PASSO.BLOQUEADO === "BLOQUEADA")
check("aprovação pendente NÃO projeta (fluxo, não divergência)",
  STATUS_TAREFA_POR_PASSO.EXECUTADO === null && STATUS_TAREFA_POR_PASSO.AGUARDANDO_APROVACAO === null)
check("todo status de passo tem decisão explícita",
  Object.values(STATUS_TAREFA_POR_PASSO).length === 12)

console.log("\n(A2) Coerência — proíbe contradição, não diferença")
check("o caso de produção é contradição: CONCLUIDO × NAO_INICIADA", paresCoerentes("CONCLUIDO", "NAO_INICIADA") === false)
check("CONCLUIDO × CONCLUIDO_RECEBIDO é coerente", paresCoerentes("CONCLUIDO", "CONCLUIDO_RECEBIDO") === true)
check("CONCLUIDO × CONCLUIDO_NAO_POSSUI é coerente (desfecho 'não possui')", paresCoerentes("CONCLUIDO", "CONCLUIDO_NAO_POSSUI") === true)
check("tarefa concluída sobre passo pendente é contradição", paresCoerentes("PENDENTE", "CONCLUIDO_RECEBIDO") === false)
check("tarefa concluída sobre passo em andamento é contradição", paresCoerentes("EM_ANDAMENTO", "CONCLUIDO_RECEBIDO") === false)
check("passo cancelado com tarefa concluída é contradição (naturezas opostas)", paresCoerentes("CANCELADO", "CONCLUIDO_RECEBIDO") === false)
check("passo concluído com tarefa cancelada é contradição", paresCoerentes("CONCLUIDO", "CANCELADA") === false)
check("CANCELADO × CANCELADA é coerente", paresCoerentes("CANCELADO", "CANCELADA") === true)
check("SUPERSEDIDO × SUPERSEDIDA é coerente", paresCoerentes("SUPERSEDIDO", "SUPERSEDIDA") === true)
check("DISPONIVEL × EM_ANDAMENTO NÃO é contradição (começou a trabalhar)", paresCoerentes("DISPONIVEL", "EM_ANDAMENTO") === true)
check("BLOQUEADO × EM_ANDAMENTO não trava o desbloqueio", paresCoerentes("BLOQUEADO", "EM_ANDAMENTO") === true)
check("aprovação pendente nunca acusa divergência",
  paresCoerentes("AGUARDANDO_APROVACAO", "CONCLUIDO_RECEBIDO") === true && paresCoerentes("EXECUTADO", "NAO_INICIADA") === true)

// ============================================================
console.log("\n(C) Blindagem estática — nenhum caminho escreve passo sem projetar tarefa")
// ============================================================

const projecao = read("src/services/passo-tarefa-projecao.ts")
const docOp = read("src/services/documento-operacao.ts")
const sync = read("src/services/task-step-sync.ts")

check("existe UM mapeamento oficial", projecao.includes("export const STATUS_TAREFA_POR_PASSO"))
check("existe a projeção transacional", projecao.includes("export async function projetarTarefaDoPasso"))
check("existe a trava de invariante", projecao.includes("export async function assegurarCoerenciaPassoTarefa"))
check("a trava lança (⇒ rollback), não avisa", projecao.includes("throw new DivergenciaPassoTarefaError"))
check("a projeção nunca decide a transição do PASSO", !/phaseWorkflowStepInstance\.(update|updateMany|create)/.test(projecao))

check("a operação por documento projeta a tarefa", docOp.includes("projetarTarefaDoPasso"))
check("a operação por documento trava a coerência antes do commit", docOp.includes("assegurarCoerenciaPassoTarefa"))
check("o sincronismo canônico também trava", sync.includes("assegurarCoerenciaPassoTarefa"))

// Nenhum arquivo fora do trio oficial pode escrever `status:` num passo.
const AUTORIZADOS = new Set([
  "src/services/task-step-sync.ts",
  "src/services/documento-operacao.ts",
  "src/services/phase-workflow.ts",
  "src/services/passo-tarefa-projecao.ts",
])
import { readdirSync, statSync } from "fs"
function varrer(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${nome}`
    if (statSync(join(ROOT, rel)).isDirectory()) varrer(rel, acc)
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) acc.push(rel)
  }
  return acc
}
const escritoresIndevidos: string[] = []
for (const arquivo of varrer("src")) {
  if (AUTORIZADOS.has(arquivo)) continue
  const texto = read(arquivo)
  // escrita de STATUS de passo (o que muda o estado operacional) fora dos autorizados
  const trechos = texto.match(/phaseWorkflowStepInstance\.update(Many)?\(\{[\s\S]{0,400}?\}\)/g) ?? []
  for (const t of trechos) if (/data:\s*\{[\s\S]{0,300}?status:/.test(t)) { escritoresIndevidos.push(arquivo); break }
}
check("nenhum arquivo fora dos serviços oficiais escreve STATUS de passo",
  escritoresIndevidos.length === 0, escritoresIndevidos.join(", "))

// RESPONSABILIDADE SÓ MUDA PELA PORTA CANÔNICA.
//
// Havia uma rota (`genealogia/delegar`) que gravava `responsavelId` no passo e
// na tarefa com `updateMany` cru: sem auditoria, sem notificação, sem CAS e sem
// guarda de tarefa encerrada. Ela não tinha mais consumidor e foi removida — o
// que a substitui é `atribuirTarefa`/`devolverAFila`, as MESMAS portas que a
// Operação usa. Este check impede que o atalho volte por outra rota: distribuir
// trabalho tem uma porta, e ela audita e avisa.
const rotasComResponsavel = varrer("src/app/api")
  .filter((f) => !f.includes("/api/tarefas/"))
  .filter((f) => {
    const t = read(f)
    return /tarefa\.update(Many)?\s*\(/.test(t) && /responsavelId/.test(t)
  })
check("nenhuma rota fora de /api/tarefas escreve responsável de tarefa",
  rotasComResponsavel.length === 0, rotasComResponsavel.join(", "))

const reparo = read("scripts/reparar-passo-tarefa.ts")
check("o reparo existe e é dry-run por padrão", reparo.includes("--execute") && reparo.includes("SOMENTE LEITURA"))
check("o reparo só age com o desfecho CONFIRMADO pelo histórico", reparo.includes("EVENTO_CONFIRMADOR") && reparo.includes("ambiguos"))
check("o reparo não inventa data", reparo.includes("nunca `now`") && !/dataConclusao:\s*new Date\(\)/.test(reparo))
check("o reparo não conclui passo a partir da tarefa", !/phaseWorkflowStepInstance\.update/.test(reparo))
check("o reparo audita", reparo.includes("PASSO_TAREFA_REPARADO"))

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
const FASES_MACRO = ["genealogia", "emissao_documental", "analise_documental", "traducao"]

async function main() {
  const { iniciarPasso, concluirPasso, concluirTarefa, iniciarTarefa } = await import("../src/services/task-step-sync")
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")
  const { movePhaseManual, reopenPhase } = await import("../src/lib/motor/phase-advance")
  const { conferirCoerenciaPassoTarefa, assegurarCoerenciaPassoTarefa, DivergenciaPassoTarefaError } =
    await import("../src/services/passo-tarefa-projecao")

  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog","LogAuditoria" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "SYNC-TEST" }, update: {},
    create: {
      code: "SYNC-TEST", name: "Sincronismo", countryKey: "alemanha", countryLabel: "Alemanha",
      nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa",
      modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro SYNC", versao: 1 } })
  for (let i = 0; i < FASES_MACRO.length; i++) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASES_MACRO[i], label: FASES_MACRO[i], ordem: i, versao: 1 } })
  }
  for (const phaseKey of FASES_MACRO) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `all::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1 },
    })
    await prisma.phaseInternalWorkflowStep.create({
      data: {
        workflowId: wf.id,
        key: phaseKey === "genealogia" ? "localizar_registro" : "passo_1",
        label: phaseKey === "genealogia" ? "Localizar registro da certidão" : "Passo 1",
        ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3,
        cardinalidade: phaseKey === "genealogia" ? null : "PROCESSO",
      },
    })
  }
  const item = await prisma.itemCatalogo.create({ data: { code: "CERT_NASC_SYNC", name: "Nasc IT", natureza: "DOCUMENTO" } })
  await prisma.tipoDocumentoCadastro.create({
    data: { code: "IT - NAS", name: "IT - NAS", legacyEnumKey: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR", itemCatalogoId: item.id, nature: "certidao" },
  })
  const usuario = await prisma.usuario.upsert({
    where: { email: "sync@teste.local" }, update: {},
    create: { nome: "Sync", email: "sync@teste.local", senha: "x", tipo: "admin" },
  })
  const arvore = await prisma.arvore.create({ data: { nome: "Árvore SYNC" } })
  const ana = await prisma.pessoa.create({ data: { nome: "Ana", sobrenome: "Souza", arvoreId: arvore.id, linhaReta: true, requerente: "maior" }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: "Processo SYNC", codigo: "T-SYNC", pais: "Alemanha", arvoreId: arvore.id, faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  // A OBRIGAÇÃO REAL. O passo `localizar_registro` opera por NECESSIDADE: sem
  // uma certidão a localizar, o motor recusa materializar e explica por quê
  // (SEM_ALVO_APLICAVEL) — comportamento correto que este palco não atendia.
  // O que se prova aqui é a coerência passo × tarefa, e ela pressupõe trabalho.
  await prisma.necessidadeDocumental.create({
    data: {
      processoId: processo.id, itemCatalogoId: item.id, pessoaId: ana.id, ciclo: 1,
      chaveIdempotencia: "SYNC-nec-nasc-ana",
    },
  })
  const rel = await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })
  if (rel.passosTotais === 0) {
    throw new Error(`palco não materializou: ${rel.estado} — ${rel.mensagemAdministrativa ?? ""}`)
  }

  const parAtual = async () => {
    const p = await prisma.phaseWorkflowStepInstance.findFirst({
      where: { processoId: processo.id, faseMacroKey: "genealogia", stepKey: "localizar_registro" },
      orderBy: { id: "desc" },
      select: { id: true, status: true, completedAt: true, tarefas: { select: { id: true, statusTarefa: true, concluida: true, dataConclusao: true, dataInicio: true }, orderBy: { id: "asc" } } },
    })
    return { passo: p!, tarefa: p!.tarefas[0]! }
  }

  console.log("\n(B1) Nasce coerente")
  let par = await parAtual()
  check("passo nasce DISPONIVEL", par.passo.status === "DISPONIVEL", par.passo.status)
  check("tarefa nasce NAO_INICIADA", par.tarefa.statusTarefa === "NAO_INICIADA", par.tarefa.statusTarefa)
  check("par coerente", paresCoerentes(par.passo.status, par.tarefa.statusTarefa))

  console.log("\n(B2) Iniciar o PASSO atualiza a tarefa")
  await iniciarPasso(par.passo.id, { origem: "USER", usuarioId: usuario.id })
  par = await parAtual()
  check("passo EM_ANDAMENTO", par.passo.status === "EM_ANDAMENTO", par.passo.status)
  check("tarefa EM_ANDAMENTO", par.tarefa.statusTarefa === "EM_ANDAMENTO", par.tarefa.statusTarefa)
  check("tarefa ganhou dataInicio", par.tarefa.dataInicio != null)

  console.log("\n(B3) Concluir o PASSO conclui a tarefa")
  await concluirPasso(par.passo.id, { origem: "USER", usuarioId: usuario.id })
  par = await parAtual()
  check("passo CONCLUIDO", par.passo.status === "CONCLUIDO", par.passo.status)
  check("tarefa CONCLUIDO_RECEBIDO", par.tarefa.statusTarefa === "CONCLUIDO_RECEBIDO", par.tarefa.statusTarefa)
  check("tarefa marcada como concluída", par.tarefa.concluida === true)
  check("completedAt e dataConclusao existem dos DOIS lados",
    par.passo.completedAt != null && par.tarefa.dataConclusao != null)
  check("zero divergência no par", (await conferirCoerenciaPassoTarefa(prisma, [par.passo.id])).length === 0)

  console.log("\n(B4) Concluir pela TAREFA conclui o passo (o outro sentido)")
  // Fase seguinte (escopo PROCESSO), passo novo e limpo.
  //
  // O AVANÇO JÁ ACONTECEU: concluir o passo acima derrubou a última pendência, e a
  // máquina de passos reconcilia o motor de fases logo depois de commitar. Pedir
  // `advance` aqui devolveria BLOQUEADO — não porque algo falhou, mas porque a
  // pergunta já foi feita e respondida, e agora o processo está na fase seguinte,
  // com o trabalho dela em aberto.
  check("o motor levou o processo para a próxima fase sozinho",
    (await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } }))?.faseAtualKey === "emissao_documental")
  const parEmissao = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { processoId: processo.id, faseMacroKey: "emissao_documental" },
    select: { id: true, status: true, tarefas: { select: { id: true }, orderBy: { id: "asc" } } },
  })
  const tarefaEmissao = parEmissao!.tarefas[0]
  check("a fase nova nasceu com par passo+tarefa", tarefaEmissao != null)
  await iniciarTarefa(tarefaEmissao!.id, { origem: "USER", usuarioId: usuario.id })
  let pEmissao = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: parEmissao!.id }, select: { status: true } })
  check("iniciar a TAREFA colocou o passo EM_ANDAMENTO", pEmissao?.status === "EM_ANDAMENTO", String(pEmissao?.status))
  await concluirTarefa(tarefaEmissao!.id, { origem: "USER", usuarioId: usuario.id })
  pEmissao = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: parEmissao!.id }, select: { status: true } })
  const tEmissao = await prisma.tarefa.findUnique({ where: { id: tarefaEmissao!.id }, select: { statusTarefa: true, concluida: true } })
  check("concluir a TAREFA concluiu o passo", pEmissao?.status === "CONCLUIDO", String(pEmissao?.status))
  check("tarefa ficou concluída", tEmissao?.concluida === true)
  check("par sem divergência", (await conferirCoerenciaPassoTarefa(prisma, [parEmissao!.id])).length === 0)

  console.log("\n(B5) Recarregar mantém a consistência (o estado está no banco, não na tela)")
  const releitura = await conferirCoerenciaPassoTarefa(prisma, (await prisma.phaseWorkflowStepInstance.findMany({ where: { processoId: processo.id }, select: { id: true } })).map((x) => x.id))
  check("nenhuma divergência em todo o processo", releitura.length === 0, JSON.stringify(releitura))

  console.log("\n(B6) Movimentação de fase NÃO altera estados do par")
  const antes = await prisma.$queryRawUnsafe<Array<{ id: number; status: string; tarefa: string }>>(
    `select s.id, s.status::text, coalesce(t."statusTarefa"::text,'-') as tarefa from "PhaseWorkflowStepInstance" s left join "Tarefa" t on t."workflowStepInstanceId" = s.id where s."processoId" = ${processo.id} order by s.id`,
  )
  const mv = await movePhaseManual(processo.id, {
    faseAlvo: "genealogia", justificativa: "Voltar para revisar o registro localizado.",
    motivoCodigo: "RETORNO_PARA_REGULARIZACAO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("movimentação aceita", mv.success === true, JSON.stringify(mv))
  const depois = await prisma.$queryRawUnsafe<Array<{ id: number; status: string; tarefa: string }>>(
    `select s.id, s.status::text, coalesce(t."statusTarefa"::text,'-') as tarefa from "PhaseWorkflowStepInstance" s left join "Tarefa" t on t."workflowStepInstanceId" = s.id where s."processoId" = ${processo.id} and s.id in (${antes.map((a) => a.id).join(",")}) order by s.id`,
  )
  check("nenhum par preexistente mudou de estado", JSON.stringify(antes) === JSON.stringify(depois), JSON.stringify({ antes, depois }))

  console.log("\n(B7) VOLTAR reencontra o trabalho; REABRIR é que pede de novo")
  const ciclo2 = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 2 }, select: { id: true } })
  const passosCiclo2 = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: ciclo2!.id }, select: { id: true, status: true, stepKey: true, tarefas: { select: { id: true, statusTarefa: true } } } })
  check("o ciclo 2 tem passos próprios", passosCiclo2.length > 0, String(passosCiclo2.length))
  // MUDANÇA DE REGRA, deliberada. Antes, reentrar numa fase pedia o trabalho DE
  // NOVO: o ciclo 2 nascia zerado e cada passo ganhava a sua tarefa. Isso fazia uma
  // certidão com "solicitar" e "aguardar" já concluídos voltar a 0 de 5 só porque o
  // administrador precisou olhar a fase anterior — trabalho real desaparecendo da
  // tela sem que ninguém o tivesse desfeito.
  //
  // Agora VOLTAR reencontra: o passo equivalente da visita anterior entrega o seu
  // estado terminal ao passo novo, e passo concluído não gera tarefa (não há o que
  // fazer nele). Quem quer o trabalho de novo tem uma operação com esse nome —
  // `reopenPhase` —, e ela continua nascendo do zero. Ver
  // `scripts/motor-reentrada-fase.test.ts` para o ciclo completo.
  check("os passos do ciclo 2 herdaram o estado terminal da visita anterior",
    passosCiclo2.every((p) => p.status === "CONCLUIDO"), JSON.stringify(passosCiclo2.map((p) => p.status)))
  check("passo herdado como concluído não abre tarefa nova (não há o que fazer nele)",
    passosCiclo2.every((p) => p.tarefas.length === 0), JSON.stringify(passosCiclo2.map((p) => p.tarefas.length)))
  check("nenhum passo do ciclo 2 é o mesmo registro do ciclo 1",
    passosCiclo2.every((p) => !antes.some((a) => a.id === p.id)))

  // A CONTRAPARTE: reabrir pede o trabalho de novo, e por isso NÃO herda.
  const reab = await reopenPhase(processo.id, {
    justificativa: "Refazer a localização do registro por erro na certidão.",
    motivoCodigo: "RETORNO_PARA_REGULARIZACAO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("reabertura aceita", reab.success === true, JSON.stringify(reab).slice(0, 140))
  const ciclo3 = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 3 }, select: { id: true } })
  const passosCiclo3 = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: ciclo3!.id }, select: { id: true, status: true, tarefas: { select: { id: true, statusTarefa: true } } } })
  check("a reabertura materializou um ciclo novo", passosCiclo3.length > 0, String(passosCiclo3.length))
  check("e ele NÃO herdou — o trabalho é para fazer de novo",
    passosCiclo3.every((p) => !["CONCLUIDO", "DISPENSADO"].includes(p.status)), JSON.stringify(passosCiclo3.map((p) => p.status)))
  check("cada passo reaberto tem a sua tarefa", passosCiclo3.every((p) => p.tarefas.length === 1),
    JSON.stringify(passosCiclo3.map((p) => p.tarefas.length)))

  console.log("\n(B8) Divergência derruba a transação (rollback)")
  // O alvo tem de ser um passo ABERTO com tarefa: é a combinação em que "concluir o
  // passo sem projetar a tarefa" é de fato uma contradição. Os passos herdados do
  // ciclo 2 já nascem concluídos e sem tarefa — o ciclo REABERTO é onde há trabalho
  // em aberto.
  const alvo = passosCiclo3[0]
  let derrubou = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.phaseWorkflowStepInstance.update({ where: { id: alvo.id }, data: { status: "CONCLUIDO", completedAt: new Date() } })
      await assegurarCoerenciaPassoTarefa(tx, [alvo.id]) // tarefa segue NAO_INICIADA
    })
  } catch (e) { derrubou = e instanceof DivergenciaPassoTarefaError }
  check("concluir o passo sem projetar a tarefa é recusado", derrubou)
  const depoisRollback = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: alvo.id }, select: { status: true, completedAt: true } })
  check("o passo voltou ao estado anterior (rollback integral)",
    depoisRollback?.status !== "CONCLUIDO" && depoisRollback?.completedAt == null, JSON.stringify(depoisRollback))

  console.log("\n(B9) Reparo idempotente do caso de produção")
  // Reproduz a divergência exatamente como ela nasceu: passo concluído com data,
  // evento na timeline, tarefa intocada.
  await prisma.phaseWorkflowStepInstance.update({ where: { id: alvo.id }, data: { status: "CONCLUIDO", completedAt: new Date("2026-08-04T00:17:20.315Z") } })
  const divergencias = await conferirCoerenciaPassoTarefa(prisma, [alvo.id])
  check("a divergência é detectada", divergencias.length === 1, JSON.stringify(divergencias))

  const { execSync } = await import("child_process")
  const saida = execSync(`npx tsx scripts/reparar-passo-tarefa.ts --execute`, { cwd: ROOT, env: process.env }).toString()
  check("o reparo reporta a divergência como REPARÁVEL", /Divergências REPARÁVEIS: 1/.test(saida), saida.slice(-400))
  const reparado = await prisma.tarefa.findUnique({ where: { id: alvo.tarefas[0].id }, select: { statusTarefa: true, concluida: true, dataConclusao: true } })
  check("a tarefa foi realinhada ao passo", reparado?.statusTarefa === "CONCLUIDO_RECEBIDO" && reparado?.concluida === true)
  check("a data veio do PASSO, não do relógio do reparo",
    reparado?.dataConclusao?.toISOString() === "2026-08-04T00:17:20.315Z", String(reparado?.dataConclusao?.toISOString()))
  check("o reparo foi auditado",
    (await prisma.logAuditoria.count({ where: { acao: "PASSO_TAREFA_REPARADO", entidadeId: alvo.tarefas[0].id } })) === 1)

  const saida2 = execSync(`npx tsx scripts/reparar-passo-tarefa.ts --execute`, { cwd: ROOT, env: process.env }).toString()
  check("rodar o reparo de novo não faz nada (idempotente)", /Nenhuma divergência passo↔tarefa/.test(saida2), saida2.slice(-300))

  console.log("\n(B10) Relatório global limpo")
  const todos = await prisma.phaseWorkflowStepInstance.findMany({ where: { processoId: processo.id }, select: { id: true } })
  const restantes = await conferirCoerenciaPassoTarefa(prisma, todos.map((x) => x.id))
  check("nenhuma inconsistência permanece", restantes.length === 0, JSON.stringify(restantes))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
