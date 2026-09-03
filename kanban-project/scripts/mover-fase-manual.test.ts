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
import { MOTIVOS_MOVIMENTACAO, motivoValido, normalizarJustificativa, JUSTIFICATIVA_MIN, JUSTIFICATIVA_MAX } from "../src/lib/motor/motivos-movimentacao"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { concluirTarefa } from "../src/services/task-step-sync"
import { tentarAvancoAutomaticoSeFaseAtual } from "../src/lib/motor/auto-avanco"
import { garantirOferta } from "./_fixture-oferta"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")
/** Só o CÓDIGO: comentários citam a regra de propósito e não podem virar violação. */
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

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
const modal = read("src/components/kanban/MovimentarFaseModal.tsx")
const board = read("src/components/kanban-board-novo.tsx")
const card = read("src/components/kanban/kanban-card.tsx")
const coluna = read("src/components/kanban/kanban-column.tsx")
const modalProcesso = read("src/components/kanban/atividade-details-modal.tsx")

check("a rota existe", rota.length > 0)
check("a rota exige a permissão exclusiva", rota.includes("temPermissao(usuario.permissoes, PERMISSAO)") && rota.includes(`const PERMISSAO = "${PERM}"`))
check("sem permissão devolve 403 (não 401 nem silêncio)", /PERMISSION_REQUIRED: 403/.test(rota))
check("o usuário da movimentação vem do TOKEN, nunca do corpo", rota.includes("solicitadoPorId: usuario.userId") && !/solicitadoPorId:\s*body/.test(rota))
check("a rota não decide regra de negócio: delega ao motor", rota.includes("movePhaseManual(processoId,"))
check("justificativa e motivo ausentes viram 422", /MISSING_JUSTIFICATION: 422/.test(rota) && /MISSING_REASON: 422/.test(rota))

check("o motor expõe movePhaseManual", motor.includes("export async function movePhaseManual"))
// A fase de origem NUNCA é concluída ao mover (CONCLUIR nunca aparece nesta operação):
// por padrão é SUPERSEDIDA; com `preservarHistorico` (a Movimentação Manual do admin,
// para preservar tarefas de fases anteriores regularizáveis depois) fica intocada
// (NENHUM) — a escolha é explícita, nunca um terceiro modo inventado.
check(
  "a fase de origem nunca é CONCLUÍDA ao mover — SUPERSEDIDA por padrão, preservada (NENHUM) com preservarHistorico",
  /operacao: "MOVER"[\s\S]{0,800}encerramento: preservarHistorico \? "NENHUM" : "SUPERSEDER"/.test(semComentarios(motor)),
)
check("o evento de fase é próprio (FASE_MOVIDA)", motor.includes('eventoFaseTipo: "FASE_MOVIDA"'))
check("`forcado` NÃO é usado para marcar a movimentação manual", /operacao: "MOVER"[\s\S]{0,800}forcado: false/.test(semComentarios(motor)))
check("a movimentação não consulta o gate", !/movePhaseManual[\s\S]{0,3000}calcularPendencias\([\s\S]{0,200}blocking/.test(motor))
check("mover para a fase atual é rejeitado (isso é reabertura)", motor.includes("Para reiniciar o ciclo da fase atual, use a reabertura."))
check("fase-alvo tem de existir no macro DO PROCESSO", motor.includes("Fase-alvo inexistente no macro do processo"))

check("enum AdvanceResultado ganhou MOVIDO", /enum AdvanceResultado \{[\s\S]*?MOVIDO/.test(schema))
check("enum WorkflowEventoTipo ganhou FASE_MOVIDA", /enum WorkflowEventoTipo \{[\s\S]*?FASE_MOVIDA/.test(schema))
const mig = read("prisma/migrations/20260803d_mover_fase_manual/migration.sql")
check("a migration é aditiva e idempotente", mig.includes("ADD VALUE IF NOT EXISTS 'MOVIDO'") && mig.includes("ADD VALUE IF NOT EXISTS 'FASE_MOVIDA'"))
check("a migration não altera nem remove nada", !/DROP |DELETE |UPDATE |ALTER TABLE/i.test(mig))
check("a migration está declarada no guard do baseline", read("scripts/baseline-verificar.test.ts").includes("20260803d_mover_fase_manual"))

console.log("\n(C2) Catálogo de motivos — do SERVIDOR, nunca do frontend")
check("o catálogo vive no servidor", read("src/lib/motor/motivos-movimentacao.ts").includes("MOTIVOS_MOVIMENTACAO"))
check("tem os motivos oficiais", ["PROCESSO_JA_EM_ANDAMENTO", "CORRECAO_DE_FASE", "OPERACAO_ADMINISTRATIVA", "RETORNO_PARA_REGULARIZACAO", "OUTRO_AUTORIZADO"].every((c) => MOTIVOS_MOVIMENTACAO.some((m) => m.codigo === c)))
check("código fora do catálogo é rejeitado", motivoValido("INVENTADO_NO_FRONT") === false)
check("código do catálogo é aceito", motivoValido("CORRECAO_DE_FASE") === true)
check("justificativa só de espaços vira vazio", normalizarJustificativa("      ") === "")
check("limites de justificativa declarados", JUSTIFICATIVA_MIN === 10 && JUSTIFICATIVA_MAX === 500)
check("o modal NÃO cadastra motivo no frontend", !modal.includes("PROCESSO_JA_EM_ANDAMENTO") && !modal.includes("CORRECAO_DE_FASE"))
check("o modal lê o catálogo da API", modal.includes("/phase/move`") && modal.includes("ctx?.motivos"))
check("a rota serve o catálogo por GET", rota.includes("export async function GET") && rota.includes("motivos: MOTIVOS_MOVIMENTACAO"))
check("as fases do modal vêm do MACRO do processo", rota.includes("macroWorkflow.findUnique") && modal.includes("ctx?.fases"))

console.log("\n(C3) Erros ESTRUTURADOS — a tela mostra o motivo real")
for (const code of ["UNAUTHORIZED", "PERMISSION_REQUIRED", "INVALID_TARGET_PHASE", "SAME_PHASE", "PROCESS_NOT_FOUND", "PHASE_NOT_IN_WORKFLOW", "MISSING_REASON", "MISSING_JUSTIFICATION", "CONCURRENT_MODIFICATION", "MIGRATION_NOT_READY", "INTERNAL_ERROR"]) {
  check(`a rota conhece ${code}`, rota.includes(code))
}
check("todo erro sai com { code, message }", /\{ success: false, code, message/.test(rota))
check("o modal exibe a MESSAGE do servidor", modal.includes("d?.message ||"))
check("o board deixou de tratar tudo como erro genérico", !board.includes('"Erro ao mover processo"'))
check("o board prefere a mensagem do servidor", board.includes("d.message || d.error"))

console.log("\n(C4) Kanban — permissão, modal e sem otimismo indevido")
check("o board usa a permissão OFICIAL", board.includes("pode('processos.moverFaseManual')"))
check("não autoriza por tipo/nome/e-mail/flag do cliente", (() => { const c = semComentarios(board); return !/tipo\s*===\s*['\"]admin['\"]/.test(c) && !c.includes("usuario.email ===") })())
check("o card só é arrastável com permissão", card.includes("disabled: !podeArrastar") && coluna.includes("podeArrastar={podeArrastar}"))
check("sem permissão o cursor não promete movimento", card.includes('cursor: podeArrastar ? undefined : "default"'))
check("o drop ABRE o modal em vez de mover", board.includes("setMovimentacao({ processoId: activeId, faseAlvo: targetFaseKey })"))
check("o card NÃO muda de coluna antes da resposta do servidor", (() => {
  const c = semComentarios(board)
  const i = c.indexOf("if (podeMoverManual) {")
  if (i < 0) return false
  // fecha no `\n    }` do if — não no `}` do objeto passado a setMovimentacao.
  const ramo = c.slice(i, c.indexOf("\n    }", i))
  // O ramo do Master abre o modal e RETORNA: nada de setLocalProcessos ali.
  return ramo.includes("setMovimentacao(") && ramo.includes("return") && !ramo.includes("setLocalProcessos")
})())
check("só move depois do onMovido (confirmação do servidor)", board.includes("onMovido={(r) =>") && board.includes("faseAtualKey: r.faseAtual"))
check("cancelar não chama API", modal.includes("onCancelar") && !/onCancelar[\s\S]{0,120}fetch\(/.test(modal))
check("duplo envio é bloqueado por ref", modal.includes("enviandoRef.current") && modal.includes("if (enviandoRef.current) return"))
check("há estado de carregamento no confirmar", modal.includes("Movendo…"))
check("o payload NÃO leva userId", !/userId/.test(semComentarios(modal)))
check("o payload leva a origem da chamada", modal.includes("origem }"))
check("origem KANBAN_DRAG_DROP é reconhecida pela rota", rota.includes('"KANBAN_DRAG_DROP"'))

console.log("\n(C5) UI alternativa e auditoria da tentativa negada")
check("existe ação 'Movimentar fase' no menu do processo", modalProcesso.includes("Movimentar fase") && modalProcesso.includes("<MovimentarFaseModal"))
check("a ação do menu é gated pela mesma permissão", modalProcesso.includes("pode('processos.moverFaseManual')"))
check("a ação do menu usa o MESMO modal e endpoint", modalProcesso.includes('origem="MENU_PROCESSO"'))
check("tentativa negada é auditada", rota.includes("auditarTentativaNegada") && rota.includes("negado: true"))
check("auditar a negativa não pode derrubar o 403", rota.includes("// Auditar a negativa não pode derrubar a negativa"))

// ============================================================
console.log("\n(C6) Preservação de histórico — fases anteriores existem, disponíveis, sem auto-avanço")
// ============================================================
//
// Regra do administrador: mover manualmente o processo pra frente NUNCA pode
// concluir, cancelar, anular, marcar como não aplicável, apagar, resetar ou
// recriar tarefa de fase anterior — elas continuam existindo e disponíveis pra
// serem regularizadas manualmente, uma a uma, sem mexer na fase atual do processo.

const autoAvanco = read("src/lib/motor/auto-avanco.ts")
const rotaConcluirTarefa = read("src/app/api/tarefas/[tarefaId]/concluir/route.ts")
const retrocesso = read("src/services/retrocesso-de-fase.ts")
const recalcularFase = read("src/lib/process-stage/recalcular-fase.ts")

check("MoveInput ganhou o parâmetro opcional preservarHistorico", motor.includes("preservarHistorico?: boolean"))
check("só a rota de movimentação manual liga preservarHistorico", rota.includes("preservarHistorico: true"))
check(
  "o Retrocesso (congelado) NÃO usa preservarHistorico — comportamento anterior intocado",
  !retrocesso.includes("preservarHistorico"),
)

check(
  "com preservarHistorico, fases intermediárias puladas são materializadas pelo materializador único",
  /async function materializarFasesPuladas[\s\S]{0,2500}materializarExecucaoDaFase\(/.test(semComentarios(motor)) &&
    motor.includes('materializarFasesPuladas(processoId, c.fases, faseOrigem, faseAlvo'),
)
check(
  "a materialização das fases puladas é idempotente (pula fase já visitada, não duplica)",
  /materializarFasesPuladas[\s\S]{0,1500}if \(jaExiste\) continue/.test(semComentarios(motor)),
)
check(
  "só materializa fases puladas quando o destino é POSTERIOR à origem",
  /ordemDestino <= ordemOrigem\) return/.test(semComentarios(motor)),
)

check(
  "existe o gancho de auto-avanço escopado à fase ATUAL (não reage a conclusão de tarefa histórica)",
  autoAvanco.includes("export async function tentarAvancoAutomaticoSeFaseAtual"),
)
check(
  "o guard compara a fase da unidade concluída com Processo.faseAtualKey antes de tentar avançar",
  /tentarAvancoAutomaticoSeFaseAtual[\s\S]{0,600}processo\.faseAtualKey !== faseMacroKeyDaUnidade/.test(semComentarios(autoAvanco)),
)
check(
  "a rota de concluir tarefa usa o gancho escopado, não o incondicional",
  rotaConcluirTarefa.includes("tentarAvancoAutomaticoSeFaseAtual(") && !rotaConcluirTarefa.includes("tentarAvancoAutomatico(tarefaAtual"),
)
check(
  "recalcularFaseDoProcesso aceita a fase de origem e recusa avançar se não for a atual",
  recalcularFase.includes("faseMacroKeyOrigem?: string | null") &&
    recalcularFase.includes("faseMacroKeyOrigem !== processo.faseAtualKey"),
)

// A Central de Tarefas conclui pela porta `concluirEtapa` (lib/operacional/tarefa-etapa.ts),
// NÃO por `concluirTarefa` — é uma porta diferente do gancho de auto-avanço, e por isso
// precisou do MESMO guard aplicado separadamente aqui.
const tarefaEtapa = read("lib/operacional/tarefa-etapa.ts")
const rotaNecessidade = read("src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts")

check(
  "concluirEtapa (a porta que a Central de Tarefas realmente usa) também usa o gancho escopado",
  tarefaEtapa.includes("tentarAvancoAutomaticoSeFaseAtual(processoAfetado, faseMacroKeyAfetada)") &&
    !tarefaEtapa.includes("tentarAvancoAutomatico(processoAfetado)"),
)
check(
  "a transição de necessidade documental usa o gancho escopado por necessidade",
  rotaNecessidade.includes("tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(isNaN(pid) ? null : pid, id)"),
)

// Varredura adicional: TODO chamador que conclui algo de uma fase/necessidade
// específica e depois tenta avançar precisa do guard — não só os dois primeiros
// achados. `concluirFaseBespokeEAvancar` (Análise/Apostilamento/Tradução/
// Retificação/Emissão Retificada) e os dois serviços que atendem necessidade por
// fora da rota HTTP (Operação Antecipada, Tarefa Transversal) tinham o mesmo bug.
check(
  "concluirFaseBespokeEAvancar (fases bespoke: Análise, Apostilamento, Tradução...) usa o gancho escopado por fase",
  autoAvanco.includes("await tentarAvancoAutomaticoSeFaseAtual(processoId, faseMacroKey)"),
)
check(
  "existe o gancho escopado por NECESSIDADE (Operação Antecipada / Tarefa Transversal não têm a fase à mão)",
  autoAvanco.includes("export async function tentarAvancoAutomaticoSeNecessidadeDaFaseAtual"),
)
const operacaoAntecipada = read("src/services/operacao-antecipada.ts")
const tarefaTransversal = read("src/services/tarefa-transversal.ts")
check(
  "Operação Antecipada usa o gancho escopado por necessidade (preserva o fallback sem necessidade)",
  operacaoAntecipada.includes("tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(op.processoId, op.necessidadeId)") &&
    operacaoAntecipada.includes("tentarAvancoAutomatico(op.processoId)"),
)
check(
  "Tarefa Transversal usa o gancho escopado por necessidade",
  tarefaTransversal.includes("tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(t.processoId, t.necessidadeId)") &&
    !tarefaTransversal.includes("tentarAvancoAutomatico(t.processoId)"),
)

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
  const oferta = await garantirOferta(prisma, { countryKey: "alemanha", countryLabel: "Alemanha", nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM" }, update: {},
    create: {
      code: "ALE-ADM", name: "Nacionalidade Alemã", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
      processFamily: "CIDADANIA", serviceNature: "PROCESSO",
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
    data: { nome: "Processo Mover", codigo: "T-MOV", arvoreId: arvore.id, faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
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

  console.log("\n(B6) preservarHistorico: origem intocada, MÚLTIPLAS intermediárias puladas materializadas, sem auto-avanço em histórico")
  // Processo PRÓPRIO, do zero: nasce em "genealogia" e salta direto pra última fase,
  // pulando emissao_documental, analise_documental E retificacao_registros — nenhuma
  // delas visitada antes, pra provar a materialização FRESCA (não o atalho idempotente).
  const processo2 = await prisma.processo.create({
    data: { nome: "Processo Mover B6", codigo: "T-MOV-B6", arvoreId: arvore.id, faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  await reconciliarFaseAtiva(processo2.id)

  const origemAntes = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: processo2.id, faseMacroKey: "genealogia" },
    orderBy: { ciclo: "desc" }, select: { id: true, status: true },
  })
  check("(setup B6) fase de origem está ATIVA antes do salto", origemAntes?.status === "ATIVO", String(origemAntes?.status))

  const tarefaOrigemAntes = await prisma.tarefa.findFirst({
    where: { workflowInstanceId: origemAntes?.id ?? -1, concluida: false },
    select: { id: true },
  })
  check("(setup B6) existe tarefa aberta na fase de origem", tarefaOrigemAntes != null)

  const puladasAntes = ["emissao_documental", "analise_documental", "retificacao_registros"]
  const semIntermediariasAntes = await prisma.phaseWorkflowInstance.count({
    where: { processoId: processo2.id, faseMacroKey: { in: puladasAntes } },
  })
  check("(setup B6) as 3 fases que serão puladas ainda não existem pra este processo", semIntermediariasAntes === 0, String(semIntermediariasAntes))

  const r4 = await movePhaseManual(processo2.id, {
    faseAlvo: "emissao_documental_retificada",
    justificativa: "Processo chegou pronto pra fase final; fases anteriores serão regularizadas depois.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: usuario.id, origem: "teste",
    preservarHistorico: true,
  })
  check("movimentação com preservarHistorico é aceita", r4.success === true, JSON.stringify(r4))
  const p4 = await prisma.processo.findUnique({ where: { id: processo2.id }, select: { faseAtualKey: true } })
  check("a fase atual pulou direto pro destino (emissao_documental_retificada)", p4?.faseAtualKey === "emissao_documental_retificada", String(p4?.faseAtualKey))

  const origemDepois = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: origemAntes?.id ?? -1 }, select: { status: true, supersededAt: true, completedAt: true },
  })
  check("a fase de origem NÃO foi supersedida (preservarHistorico)", origemDepois?.status === "ATIVO" && origemDepois?.supersededAt === null, JSON.stringify(origemDepois))

  const passosOrigemSupersedidos = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: origemAntes?.id ?? -1, status: "SUPERSEDIDO" },
  })
  check("nenhum passo da fase de origem foi supersedido", passosOrigemSupersedidos === 0, String(passosOrigemSupersedidos))

  for (const faseKey of puladasAntes) {
    const intermediaria = await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId: processo2.id, faseMacroKey: faseKey }, select: { id: true, status: true },
    })
    check(`a fase pulada "${faseKey}" FOI materializada do zero`, intermediaria != null, JSON.stringify(intermediaria))
    const passosIntermediaria = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: intermediaria?.id ?? -1 } })
    check(`"${faseKey}" tem passos reais`, passosIntermediaria > 0, String(passosIntermediaria))
    const tarefasIntermediaria = await prisma.tarefa.count({ where: { workflowInstanceId: intermediaria?.id ?? -1 } })
    check(`"${faseKey}" tem tarefas reais, disponíveis pra regularizar depois`, tarefasIntermediaria > 0, String(tarefasIntermediaria))
  }

  // Regra 3: concluir uma tarefa HISTÓRICA não pode mexer na fase atual do processo.
  const rConclusao = tarefaOrigemAntes ? await concluirTarefa(tarefaOrigemAntes.id, { origem: "USER", usuarioId: usuario.id }) : null
  check("a tarefa histórica pôde ser concluída (não travada por supersessão)", rConclusao?.success === true, JSON.stringify(rConclusao))
  await tentarAvancoAutomaticoSeFaseAtual(processo2.id, "genealogia", "teste-b6")
  const pDepoisDeConcluir = await prisma.processo.findUnique({ where: { id: processo2.id }, select: { faseAtualKey: true } })
  check(
    "concluir tarefa da fase histórica NÃO mudou a fase atual do processo",
    pDepoisDeConcluir?.faseAtualKey === "emissao_documental_retificada",
    String(pDepoisDeConcluir?.faseAtualKey),
  )

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
