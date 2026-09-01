// scripts/subtarefas-canonicas.test.ts
// ============================================================================
// UMA FASE, UM PASSO E TRÊS SUBTAREFAS QUE NÃO EXISTEM NO CÓDIGO.
//
// A pergunta que este arquivo responde é a que decide se a arquitetura está certa:
// dá para criar uma FASE nova, um PASSO novo e SUBTAREFAS novas — de negócio, com
// dependência entre si, campos, ações, checklist, requisito, canal e política de
// reabertura — sem escrever uma linha de código? E o motor executa isso?
//
// Se para qualquer uma dessas coisas fosse preciso codificar um caso específico, a
// resposta seria não, e o teste falharia por não achar o que precisa.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=<banco de teste> npx tsx scripts/subtarefas-canonicas.test.ts
// ============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { congelarVersaoVigente, lerVersaoPublicada, definicaoHistoricaDoPasso } from "../src/services/versao-publicada"
import { publicarWorkflow, marcarRascunho, preverPublicacao } from "../src/services/publicacao-de-workflow"
import { validarWorkflowParaPublicar } from "../src/services/validacao-de-publicacao"
import {
  subtarefasDaEtapa, passoPodeConcluir, materializarSubtarefas, reconciliarSubtarefas,
} from "../src/services/subtarefas-da-etapa"
import {
  abrirExecucao, execucoesDaSubtarefa, execucaoVigente,
  ESTADOS_DA_SUBTAREFA, MOTIVOS_DE_EXECUCAO, CAUSAS_DE_BLOQUEIO,
} from "../src/services/execucao-da-subtarefa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { canaisDaSubtarefa, canaisDaOrganizacao } from "../src/lib/motor/canais-do-fornecedor"
import { exigirBancoDeTeste } from "./_banco-de-teste"

const prisma = new PrismaClient()
const M = "SUBCAN"
const ROOT = join(__dirname, "..")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

/** Varre o código de runtime procurando um nome. É a prova de que ele não está lá. */
function existeNoCodigo(agulha: string): string | null {
  const raizes = ["src/services", "src/lib", "src/components", "src/app/api"]
  const pilha = raizes.map((r) => join(ROOT, r)).filter((d) => existsSync(d))
  while (pilha.length) {
    const dir = pilha.pop()!
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome)
      if (statSync(caminho).isDirectory()) { pilha.push(caminho); continue }
      if (!/\.(ts|tsx)$/.test(nome)) continue
      if (readFileSync(caminho, "utf8").includes(agulha)) return caminho.replace(ROOT + "/", "")
    }
  }
  return null
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: p.id } })
    await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: `${M} ` } } } } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.pessoa.deleteMany({ where: { arvore: { nome: { startsWith: `${M} ` } } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "fase_de_teste_universal" } } })
  await prisma.organizacaoCanal.deleteMany({ where: { organizacao: { name: { startsWith: `${M} ` } } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: `${M} ` } } })
  await prisma.canalOperacional.deleteMany({ where: { key: { startsWith: "SUBCAN_" } } })
}

async function main() {
  // ESTE TESTE ESCREVE: cria fase, workflow, processo, 50 certidões e execuções. A
  // trava recusa qualquer alvo que não seja o banco de teste local — teste que escreve
  // em produção é defeito, não configuração.
  exigirBancoDeTeste("prova as subtarefas canônicas")
  await limpar()
  // UM USUÁRIO DE VERDADE: a auditoria referencia `Usuario` por chave estrangeira, e
  // um id inventado faria a gravação do log falhar no meio da execução.
  const operador = await prisma.usuario.findFirst({ orderBy: { id: "asc" }, select: { id: true } })
    ?? await prisma.usuario.create({ data: { nome: "Operador SUBCAN", email: `${M}@teste.local`, senha: "x", tipo: "admin" }, select: { id: true } })
  const UID = operador.id

  // ══════════════════════════════════════════════════════════════
  console.log("\n(A) Os nomes que este teste usa NÃO existem no código")
  // ══════════════════════════════════════════════════════════════
  for (const nome of [
    "fase_de_teste_universal", "verificacao_especial_x",
    "conferir_elemento_y", "medir_elemento_z", "arquivar_elemento_w",
  ]) {
    const onde = existeNoCodigo(nome)
    check(`"${nome}" não aparece em nenhum arquivo de runtime`, onde === null, onde ?? "")
  }

  // ══════════════════════════════════════════════════════════════
  console.log("\n(B) O administrador cria a fase, o passo e três subtarefas")
  // ══════════════════════════════════════════════════════════════
  const canalA = await prisma.canalOperacional.create({
    data: { key: "SUBCAN_PORTAL", label: "Portal", ordem: 97, protocoloObrigatorio: true }, select: { id: true, key: true },
  })
  const canalB = await prisma.canalOperacional.create({
    data: { key: "SUBCAN_BALCAO", label: "Balcão", ordem: 98 }, select: { id: true, key: true },
  })
  // DOIS FORNECEDORES COM CANAIS DIFERENTES — é o teste do §17.
  const fornecedorA = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Cartório do Portal`, ativo: true }, select: { id: true },
  })
  const fornecedorB = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Cartório do Balcão`, ativo: true }, select: { id: true },
  })
  await prisma.organizacaoCanal.createMany({
    data: [
      { organizacaoId: fornecedorA.id, canalId: canalA.id, ordem: 1 },
      { organizacaoId: fornecedorA.id, canalId: canalB.id, ordem: 2 },
      { organizacaoId: fornecedorB.id, canalId: canalB.id, ordem: 1 },
    ],
  })

  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: "fase_de_teste_universal", label: "Fase de Teste Universal", escopo: "PROCESSO",
      ordemPadrao: 97, slaDiasPadrao: 5,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
    },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow universal", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true, versao: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "verificacao_especial_x", label: "Verificação Especial X",
      ordem: 1, createsTask: true, required: true, cardinalidade: "DOCUMENTO",
      executorKey: "padrao", dependeDe: [] as never, slaDays: 5,
      // O PASSO SÓ CONCLUI QUANDO AS SUBTAREFAS OBRIGATÓRIAS ESTIVEREM FEITAS.
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })

  // ── SUBTAREFA A: envia pelo fornecedor ──────────────────────────────────
  const subA = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "conferir_elemento_y", label: "Conferir elemento Y", ordem: 1,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "FORNECEDOR_RELACIONADO", dependeDe: [] as never, slaDays: 2,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: subA.id, key: "conferido", label: "Elemento conferido", effectKey: "REGISTER_ONLY", ordem: 1 },
  })
  await prisma.stepField.create({
    data: { stepId: passo.id, subtaskId: subA.id, key: "achado", label: "O que foi achado", tipo: "textarea", obrigatorio: true, ordem: 1 },
  })
  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: passo.id, subtaskId: subA.id, key: "item_visto", label: "Elemento visto", obrigatorio: true, ordem: 1 },
      { stepId: passo.id, subtaskId: subA.id, key: "item_anotado", label: "Anotação feita", obrigatorio: false, ordem: 2 },
    ],
  })
  await prisma.stepRequirement.create({
    data: {
      stepId: passo.id, subtaskId: subA.id, key: "conferencia_feita", label: "Conferência completa",
      tipo: "CHECKLIST_COMPLETO", acaoKey: "conferido", ordem: 1,
    },
  })

  // ── SUBTAREFAS B e C: dependem de A, e NÃO uma da outra ─────────────────
  const subB = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "medir_elemento_z", label: "Medir elemento Z", ordem: 2,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["conferir_elemento_y"] as never,
      reaberturaPermitida: true, reaberturaExigeJustificativa: true,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: subB.id, key: "medido", label: "Medido", effectKey: "REGISTER_ONLY", ordem: 1 },
  })
  const subC = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "arquivar_elemento_w", label: "Arquivar elemento W", ordem: 3,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["conferir_elemento_y"] as never,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: subC.id, key: "arquivado", label: "Arquivado", effectKey: "COMPLETE_STEP", ordem: 1 },
  })

  check("fase, passo e três subtarefas cadastrados sem deploy",
    (await prisma.stepSubtaskDefinition.count({ where: { stepId: passo.id } })) === 3)

  const probs = await validarWorkflowParaPublicar(wf.id)
  check("a configuração inteira é publicável", probs.length === 0, JSON.stringify(probs))

  await congelarVersaoVigente(wf.id, "CRIACAO")
  const v1 = await lerVersaoPublicada(wf.id, 1)
  const p1 = v1?.passos.find((p) => p.key === "verificacao_especial_x")
  check("a versão congela as SUBTAREFAS", (p1?.subtarefas ?? []).length === 3)
  check("com os filhos DELAS, e não do passo",
    (p1?.subtarefas.find((s) => s.key === "conferir_elemento_y")?.campos ?? []).length === 1 &&
    (p1?.subtarefas.find((s) => s.key === "conferir_elemento_y")?.checkItens ?? []).length === 2 &&
    (p1?.campos ?? []).length === 0 && (p1?.checkItens ?? []).length === 0,
    "campo da subtarefa aparecendo também como campo do passo seria contagem dobrada")
  check("e congela a regra de conclusão", p1?.regraDeConclusao === "TODAS_SUBTAREFAS_OBRIGATORIAS")
  check("e a dependência entre irmãs",
    JSON.stringify(p1?.subtarefas.find((s) => s.key === "medir_elemento_z")?.dependeDe) === '["conferir_elemento_y"]')

  // ══════════════════════════════════════════════════════════════
  console.log("\n(C) Dois fornecedores, canais diferentes — sem hardcode")
  // ══════════════════════════════════════════════════════════════
  const canaisA = await canaisDaOrganizacao(fornecedorA.id)
  const canaisB = await canaisDaOrganizacao(fornecedorB.id)
  check("o fornecedor A atende por dois canais", canaisA.map((c) => c.key).sort().join(",") === "SUBCAN_BALCAO,SUBCAN_PORTAL")
  check("o fornecedor B atende só pelo balcão", canaisB.map((c) => c.key).join(",") === "SUBCAN_BALCAO")
  check("a exigência do TIPO vale para quem o atende",
    canaisA.find((c) => c.key === "SUBCAN_PORTAL")?.exigeProtocolo === true &&
    canaisA.find((c) => c.key === "SUBCAN_BALCAO")?.exigeProtocolo === false)
  check("restringir por tipo é INTERSEÇÃO, nunca acréscimo",
    (await canaisDaSubtarefa({ fonteDeCanais: "TIPOS_PERMITIDOS", tiposPermitidos: ["SUBCAN_PORTAL"], fornecedorId: fornecedorB.id })).length === 0,
    "o passo não pode habilitar um canal que o fornecedor não atende")
  check("sem fornecedor, a lista é vazia — não é a lista global",
    (await canaisDaSubtarefa({ fonteDeCanais: "FORNECEDOR_RELACIONADO", fornecedorId: null })).length === 0)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(D) Executar num processo real: A libera B e C")
  // ══════════════════════════════════════════════════════════════
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
    select: { id: true },
  })
  const pessoa = await prisma.pessoa.create({
    data: { nome: "Fulano", sobrenome: "de Teste", arvoreId: arv.id }, select: { id: true },
  })
  // O DOCUMENTO APONTA PARA O ÓRGÃO — é dele que os canais da subtarefa saem.
  const doc = await prisma.documento.create({
    data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", orgaoId: fornecedorA.id },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const si = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never, documentoId: doc.id,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p1`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  const mat = await materializarSubtarefas({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  check("materializar cria uma execução por subtarefa", mat.criadas === 3)
  const mat2 = await materializarSubtarefas({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  check("e rodar de novo não cria a segunda", mat2.criadas === 0 && mat2.jaExistiam === 3)

  const proj1 = await subtarefasDaEtapa({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  const a1 = proj1.find((s) => s.key === "conferir_elemento_y")!
  const b1 = proj1.find((s) => s.key === "medir_elemento_z")!
  const c1 = proj1.find((s) => s.key === "arquivar_elemento_w")!
  check("A está disponível", a1.disponivel && a1.status === ESTADOS_DA_SUBTAREFA.DISPONIVEL)
  check("B está bloqueada por dependência", !b1.disponivel && b1.bloqueioCodigo === CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE)
  check("e o motivo diz o NOME da subtarefa que falta", (b1.bloqueioTexto ?? "").includes("Conferir elemento Y"))
  check("C também — e por A, não por B", !c1.disponivel && c1.bloqueioAlvo === "conferir_elemento_y")
  check("A oferece os canais do FORNECEDOR daquele documento",
    a1.canais.map((c) => c.key).sort().join(",") === "SUBCAN_BALCAO,SUBCAN_PORTAL")
  check("B não oferece canal nenhum — ela não envia nada", b1.canais.length === 0)

  const gate0 = await passoPodeConcluir({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  check("o passo NÃO pode concluir com as três em aberto", !gate0.pode && gate0.faltando.length === 3)

  // ── executar B antes de A é recusado ────────────────────────────────────
  const cedo = await executarAcaoCadastrada(si.id, "medido", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-x1`, subtaskKey: "medir_elemento_z", fornecedorId: fornecedorA.id,
  })
  check("executar B antes de A é RECUSADO pelo servidor",
    !cedo.ok && cedo.codigo === "SUBTAREFA_INDISPONIVEL", JSON.stringify(cedo))

  // ── A: o requisito de checklist é cobrado ───────────────────────────────
  const semChecklist = await executarAcaoCadastrada(si.id, "conferido", { achado: "tudo certo" }, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a1`, subtaskKey: "conferir_elemento_y", fornecedorId: fornecedorA.id,
  })
  check("A recusa sem o checklist obrigatório",
    !semChecklist.ok && semChecklist.codigo === "REQUISITO_PENDENTE", JSON.stringify(semChecklist))

  const feitoA = await executarAcaoCadastrada(si.id, "conferido",
    { achado: "elemento presente", checklist: { item_visto: true } }, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a2`, subtaskKey: "conferir_elemento_y", fornecedorId: fornecedorA.id,
  })
  check("A executa quando o checklist obrigatório está marcado", feitoA.ok, JSON.stringify(feitoA))

  const proj2 = await subtarefasDaEtapa({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  check("A ficou concluída", proj2.find((s) => s.key === "conferir_elemento_y")?.concluida === true)
  check("B foi liberada", proj2.find((s) => s.key === "medir_elemento_z")?.disponivel === true)
  check("C também", proj2.find((s) => s.key === "arquivar_elemento_w")?.disponivel === true)
  const execA = await execucaoVigente(si.id, "conferir_elemento_y")
  check("e quem executou ficou registrado NA SUBTAREFA", execA?.executadoPorId === UID && execA?.resultado === "conferido")
  check("com o que foi preenchido nela",
    ((execA?.payload as { valores?: Record<string, unknown> })?.valores?.achado) === "elemento presente")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(E) Concluir o passo respeita a regra cadastrada")
  // ══════════════════════════════════════════════════════════════
  // CONCLUIR C COM B ABERTA VALE — o operador arquivou de verdade. O que não acontece
  // é a conclusão do PASSO, e a resposta diz isso com o nome do que falta. Recusar a
  // ação inteira desfaria uma subtarefa realmente concluída.
  const cedoDemais = await executarAcaoCadastrada(si.id, "arquivado", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-c1`, subtaskKey: "arquivar_elemento_w", fornecedorId: fornecedorA.id,
  })
  check("concluir C com B aberta VALE para C", cedoDemais.ok, JSON.stringify(cedoDemais))
  check("mas o passo NÃO conclui", cedoDemais.concluiuPasso === false && cedoDemais.codigo === "SUBTAREFAS_PENDENTES")
  check("e a resposta diz QUAL subtarefa falta",
    JSON.stringify(cedoDemais.detalhes).includes("Medir elemento Z"))
  check("a etapa continua em andamento",
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si.id }, select: { status: true } }))?.status !== "CONCLUIDO")

  // A ÚLTIMA SUBTAREFA OBRIGATÓRIA A FICAR PRONTA É QUEM CONCLUI O PASSO — mesmo que
  // o efeito dela seja só "registrar". Amarrar isso a uma ação específica deixaria o
  // passo pendurado esperando um clique que ninguém sabe que precisa dar.
  const fim = await executarAcaoCadastrada(si.id, "medido", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-b1`, subtaskKey: "medir_elemento_z", fornecedorId: fornecedorA.id,
  })
  check("concluir a ÚLTIMA subtarefa obrigatória conclui o passo", fim.ok && fim.concluiuPasso === true, JSON.stringify(fim))
  check("e a etapa ficou CONCLUIDO",
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si.id }, select: { status: true } }))?.status === "CONCLUIDO")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(F) Reabrir B: C fica intacta, e o histórico sobrevive")
  // ══════════════════════════════════════════════════════════════
  const antesC = await execucaoVigente(si.id, "arquivar_elemento_w")
  const reab = await abrirExecucao({
    stepInstanceId: si.id, subtaskKey: "medir_elemento_z",
    motivo: MOTIVOS_DE_EXECUCAO.REABERTURA_MANUAL, status: ESTADOS_DA_SUBTAREFA.DISPONIVEL,
  })
  check("reabrir B abre uma execução nova", reab.criada && reab.substituiu !== null)
  const historicoB = await execucoesDaSubtarefa(si.id, "medir_elemento_z")
  check("a execução anterior de B continua existindo, com a conclusão dela",
    historicoB.length === 2 && historicoB[0].completedAt != null && historicoB[0].supersededAt != null)
  check("e a vigente é a nova, ainda sem conclusão",
    historicoB[1].supersededAt === null && historicoB[1].completedAt === null)
  const depoisC = await execucaoVigente(si.id, "arquivar_elemento_w")
  check("C NÃO foi tocada — ela não depende de B",
    JSON.stringify(depoisC) === JSON.stringify(antesC),
    "reabrir uma irmã não pode alcançar quem não depende dela")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(G) Reconciliar é idempotente — vinte vezes, zero diferença")
  // ══════════════════════════════════════════════════════════════
  const primeira = await reconciliarSubtarefas({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  let ajustesDepois = 0
  for (let i = 0; i < 20; i++) {
    const r = await reconciliarSubtarefas({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
    ajustesDepois += r.ajustadas
  }
  check("depois da primeira, vinte reconciliações não ajustam nada", ajustesDepois === 0, `${primeira.ajustadas} → ${ajustesDepois}`)
  check("e não criaram execução nenhuma",
    (await prisma.subtaskExecution.count({ where: { stepInstanceId: si.id } })) === 4,
    "3 originais + 1 da reabertura de B")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(H) Cinquenta certidões: reabrir uma não toca as outras 49")
  // ══════════════════════════════════════════════════════════════
  const instancias: number[] = []
  for (let i = 0; i < 50; i++) {
    const d = await prisma.documento.create({
      data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", orgaoId: fornecedorA.id }, select: { id: true },
    })
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
        stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never, documentoId: d.id,
        stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-cert${i}`,
      },
      select: { id: true },
    })
    await garantirTentativa(s.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
    await materializarSubtarefas({ stepInstanceId: s.id, fornecedorId: fornecedorA.id })
    instancias.push(s.id)
  }
  check("cinquenta certidões, cada uma com as próprias execuções de subtarefa",
    (await prisma.subtaskExecution.count({ where: { stepInstanceId: { in: instancias } } })) === 150)

  const alvo = instancias[17]
  const outras = instancias.filter((x) => x !== alvo)
  const retratoAntes = JSON.stringify(await prisma.subtaskExecution.findMany({
    where: { stepInstanceId: { in: outras } }, orderBy: { id: "asc" },
  }))
  await executarAcaoCadastrada(alvo, "conferido",
    { achado: "só nesta", checklist: { item_visto: true } }, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-iso`, subtaskKey: "conferir_elemento_y", fornecedorId: fornecedorA.id,
  })
  await abrirExecucao({
    stepInstanceId: alvo, subtaskKey: "conferir_elemento_y",
    motivo: MOTIVOS_DE_EXECUCAO.REABERTURA_MANUAL, status: ESTADOS_DA_SUBTAREFA.DISPONIVEL,
  })
  const retratoDepois = JSON.stringify(await prisma.subtaskExecution.findMany({
    where: { stepInstanceId: { in: outras } }, orderBy: { id: "asc" },
  }))
  check("executar e reabrir a certidão #17 deixa as outras 49 byte a byte iguais",
    retratoAntes === retratoDepois)
  check("e a #17 tem duas execuções da subtarefa reaberta",
    (await execucoesDaSubtarefa(alvo, "conferir_elemento_y")).length === 2)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(I) V1 × V2: quem já roda não ganha subtarefa nova")
  // ══════════════════════════════════════════════════════════════
  await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "revisar_elemento_v", label: "Revisar elemento V", ordem: 4,
      obrigatoria: false, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: [] as never,
    },
  })
  await prisma.stepAction.create({
    data: {
      stepId: passo.id, key: "revisado", label: "Revisado", effectKey: "REGISTER_ONLY", ordem: 1,
      subtaskId: (await prisma.stepSubtaskDefinition.findFirst({ where: { stepId: passo.id, key: "revisar_elemento_v" }, select: { id: true } }))!.id,
    },
  })
  await marcarRascunho(wf.id, null)
  const prev = await preverPublicacao(wf.id)
  check("a prévia enxerga a subtarefa acrescentada",
    (prev?.mudancas ?? []).some((m) => m.escopo === "SUBTAREFA" && m.tipo === "ACRESCENTADO"),
    JSON.stringify(prev?.mudancas?.slice(0, 3)))
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: wf.versao })
  check("publicar cria a v2", pub.ok && pub.versaoNova === 2, JSON.stringify(pub))

  const histV1 = await definicaoHistoricaDoPasso(si.id)
  check("a etapa que começou na v1 continua na v1", histV1?.versao === 1)
  check("e NÃO enxerga a subtarefa nova",
    !(histV1?.passo.subtarefas ?? []).some((s) => s.key === "revisar_elemento_v"))
  const v2 = await lerVersaoPublicada(wf.id, 2)
  check("já a v2 tem as quatro",
    (v2?.passos[0].subtarefas ?? []).length === 4)
  const projV1 = await subtarefasDaEtapa({ stepInstanceId: si.id, fornecedorId: fornecedorA.id })
  check("a projeção da etapa antiga continua com três subtarefas", projV1.length === 3)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(J) A publicação recusa o impossível dentro da subtarefa")
  // ══════════════════════════════════════════════════════════════
  await prisma.stepSubtaskDefinition.updateMany({
    where: { stepId: passo.id, key: "revisar_elemento_v" },
    data: { dependeDe: ["nao_existe"] as never },
  })
  const probsRuins = await validarWorkflowParaPublicar(wf.id)
  check("dependência de subtarefa para o nada é recusada",
    probsRuins.some((p) => p.codigo === "DEPENDENCIA_INEXISTENTE"), JSON.stringify(probsRuins.map((p) => p.codigo)))
  await prisma.stepSubtaskDefinition.updateMany({
    where: { stepId: passo.id, key: "revisar_elemento_v" },
    data: { dependeDe: ["conferir_elemento_y"] as never },
  })
  await prisma.stepAction.deleteMany({ where: { subtask: { key: "revisar_elemento_v" } } })
  const probsMuda = await validarWorkflowParaPublicar(wf.id)
  check("subtarefa manual sem ação é recusada",
    probsMuda.some((p) => p.codigo === "SUBTAREFA_SEM_ACAO"), JSON.stringify(probsMuda.map((p) => p.codigo)))

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exitCode = 1 }
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
