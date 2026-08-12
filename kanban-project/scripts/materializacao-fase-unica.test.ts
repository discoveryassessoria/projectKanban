// scripts/materializacao-fase-unica.test.ts
//
// (A) NÚCLEO PURO — invariante de obrigações e resumo de pendências transversais.
// (B) COMPORTAMENTO (banco real) — um único pipeline de materialização para todas as
//     origens, ciclos preservados, obrigações alheias intactas, idempotência e reparo.
// (C) BLINDAGEM ESTÁTICA — não existe segundo materializador; toda origem chama o
//     serviço oficial; a leitura escopa por instância; o motivo do vazio é explícito.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/materializacao-fase-unica.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import {
  compararObrigacoes,
  type FotografiaObrigacoes,
  type ObrigacaoFotografada,
} from "../src/lib/motor/invariantes-obrigacoes"
import { montarPendenciasTransversais } from "../src/lib/process-stage/pendencias-transversais-core"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) Invariante de obrigações — núcleo puro")
// ============================================================

const obrig = (o: Partial<ObrigacaoFotografada> & { chave: string }): ObrigacaoFotografada => ({
  tipo: "PASSO", id: 1, workflowInstanceId: 10, faseMacroKey: "genealogia", ciclo: 1,
  status: "DISPONIVEL", obrigatorio: true, concluidoEm: null, ...o,
})
const foto = (itens: ObrigacaoFotografada[]): FotografiaObrigacoes => ({
  processoId: 1,
  porChave: new Map(itens.map((i) => [i.chave, i])),
  pendentesPorFase: new Map(),
  total: itens.length,
})

const antesBase = foto([
  obrig({ chave: "passo:1", id: 1, workflowInstanceId: 10, faseMacroKey: "genealogia" }),
  obrig({ chave: "passo:2", id: 2, workflowInstanceId: 11, faseMacroKey: "emissao_documental" }),
  obrig({ chave: "tarefa:1", tipo: "TAREFA", id: 1, workflowInstanceId: 11, status: "NAO_INICIADA|aberta" }),
])

const semMudanca = compararObrigacoes(antesBase, antesBase, { instanciaDestinoId: 12 })
check("nada mudou ⇒ invariante satisfeito", semMudanca.ok && semMudanca.violacoes.length === 0)

const comDestino = foto([
  ...antesBase.porChave.values(),
  obrig({ chave: "passo:9", id: 9, workflowInstanceId: 12, faseMacroKey: "traducao" }),
])
const soDestino = compararObrigacoes(antesBase, comDestino, { instanciaDestinoId: 12 })
check("passo NOVO na instância de destino é o único delta legítimo", soDestino.ok && soDestino.resumo.criadasNoDestino === 1)

const concluiuAlheia = foto([
  obrig({ chave: "passo:1", id: 1, workflowInstanceId: 10, status: "CONCLUIDO", concluidoEm: "2026-08-03T00:00:00.000Z" }),
  obrig({ chave: "passo:2", id: 2, workflowInstanceId: 11, faseMacroKey: "emissao_documental" }),
  obrig({ chave: "tarefa:1", tipo: "TAREFA", id: 1, workflowInstanceId: 11, status: "NAO_INICIADA|aberta" }),
])
const rConcluiu = compararObrigacoes(antesBase, concluiuAlheia, { instanciaDestinoId: 12 })
check("CONCLUIR obrigação de outra fase viola o invariante", !rConcluiu.ok && rConcluiu.violacoes[0].tipo === "OBRIGACAO_ALHEIA_ALTERADA")

const cancelouAlheia = foto([
  obrig({ chave: "passo:1", id: 1, workflowInstanceId: 10 }),
  obrig({ chave: "passo:2", id: 2, workflowInstanceId: 11, faseMacroKey: "emissao_documental", status: "CANCELADO" }),
  obrig({ chave: "tarefa:1", tipo: "TAREFA", id: 1, workflowInstanceId: 11, status: "NAO_INICIADA|aberta" }),
])
check("CANCELAR obrigação de outra fase viola o invariante", !compararObrigacoes(antesBase, cancelouAlheia, { instanciaDestinoId: 12 }).ok)

const supersedeuAlheia = foto([
  obrig({ chave: "passo:1", id: 1, workflowInstanceId: 10, status: "SUPERSEDIDO" }),
  obrig({ chave: "passo:2", id: 2, workflowInstanceId: 11, faseMacroKey: "emissao_documental" }),
  obrig({ chave: "tarefa:1", tipo: "TAREFA", id: 1, workflowInstanceId: 11, status: "NAO_INICIADA|aberta" }),
])
check("INVALIDAR (superseder) obrigação de outra fase viola o invariante", !compararObrigacoes(antesBase, supersedeuAlheia, { instanciaDestinoId: 12 }).ok)

const removeu = foto([...antesBase.porChave.values()].filter((o) => o.chave !== "passo:2"))
const rRemoveu = compararObrigacoes(antesBase, removeu, { instanciaDestinoId: 12 })
check("EXCLUIR obrigação de outra fase viola o invariante", !rRemoveu.ok && rRemoveu.violacoes[0].tipo === "OBRIGACAO_ALHEIA_REMOVIDA")

const tarefaAlheiaConcluida = foto([
  obrig({ chave: "passo:1", id: 1, workflowInstanceId: 10 }),
  obrig({ chave: "passo:2", id: 2, workflowInstanceId: 11, faseMacroKey: "emissao_documental" }),
  obrig({ chave: "tarefa:1", tipo: "TAREFA", id: 1, workflowInstanceId: 11, status: "CONCLUIDA|concluida" }),
])
check("CONCLUIR tarefa de outra fase viola o invariante", !compararObrigacoes(antesBase, tarefaAlheiaConcluida, { instanciaDestinoId: 12 }).ok)

const criouForaDoDestino = foto([
  ...antesBase.porChave.values(),
  obrig({ chave: "passo:99", id: 99, workflowInstanceId: 11, faseMacroKey: "emissao_documental" }),
])
const rFora = compararObrigacoes(antesBase, criouForaDoDestino, { instanciaDestinoId: 12 })
check("criar obrigação FORA da instância de destino viola o invariante", !rFora.ok && rFora.violacoes[0].tipo === "OBRIGACAO_CRIADA_FORA_DO_DESTINO")

// ============================================================
console.log("\n(A2) Pendências transversais — a posição do card não conclui nada")
// ============================================================

const FASES_TESTE = [
  { phaseKey: "genealogia", ordem: 0, label: "Genealogia" },
  { phaseKey: "emissao_documental", ordem: 1, label: "Emissão documental" },
  { phaseKey: "analise_documental", ordem: 2, label: "Análise Documental" },
  { phaseKey: "traducao", ordem: 3, label: "Tradução juramentada" },
]

const resumo = montarPendenciasTransversais(
  [
    // Genealogia: ciclo 1 SUPERSEDIDO com 2 pendentes — continuam devidas.
    { faseMacroKey: "genealogia", ciclo: 1, status: "DISPONIVEL", obrigatorio: true, statusDaInstancia: "SUPERSEDIDO" },
    { faseMacroKey: "genealogia", ciclo: 1, status: "DISPONIVEL", obrigatorio: true, statusDaInstancia: "SUPERSEDIDO" },
    { faseMacroKey: "genealogia", ciclo: 2, status: "CONCLUIDO", obrigatorio: true, statusDaInstancia: "CONCLUIDO" },
    // Emissão: 4 pendentes.
    ...Array.from({ length: 4 }, () => ({ faseMacroKey: "emissao_documental", ciclo: 1, status: "DISPONIVEL", obrigatorio: true, statusDaInstancia: "SUPERSEDIDO" })),
    // Análise: 3 pendentes.
    ...Array.from({ length: 3 }, () => ({ faseMacroKey: "analise_documental", ciclo: 1, status: "PENDENTE", obrigatorio: true, statusDaInstancia: "SUPERSEDIDO" })),
    // Tradução (fase atual): 1 pendente + 1 opcional (não conta).
    { faseMacroKey: "traducao", ciclo: 1, status: "DISPONIVEL", obrigatorio: true, statusDaInstancia: "ATIVO" },
    { faseMacroKey: "traducao", ciclo: 1, status: "DISPONIVEL", obrigatorio: false, statusDaInstancia: "ATIVO" },
  ],
  FASES_TESTE,
  "traducao",
)

check("pendências de fase ANTERIOR continuam contadas", resumo.pendentesAnteriores === 9, String(resumo.pendentesAnteriores))
check("pendência da fase ATUAL é contada à parte", resumo.pendentesNaFaseAtual === 1, String(resumo.pendentesNaFaseAtual))
check("total transversal soma todas as fases", resumo.totalPendentes === 10, String(resumo.totalPendentes))
check("ciclo SUPERSEDIDO com pendência é sinalizado, não descartado",
  resumo.porFase.find((f) => f.phaseKey === "genealogia")?.temPendenciaEmCicloSupersedido === true)
check("os dois ciclos da Genealogia aparecem", resumo.porFase.find((f) => f.phaseKey === "genealogia")?.ciclos === 2)
check("passo opcional não vira obrigação pendente",
  resumo.porFase.find((f) => f.phaseKey === "traducao")?.pendentes === 1)
check("processo com pendência transversal não pode ser dado por concluído", resumo.temPendenciaTransversal === true)

const semPendencia = montarPendenciasTransversais(
  [{ faseMacroKey: "traducao", ciclo: 1, status: "CONCLUIDO", obrigatorio: true, statusDaInstancia: "ATIVO" }],
  FASES_TESTE, "traducao",
)
check("sem obrigação devida, não há pendência transversal", semPendencia.temPendenciaTransversal === false)

// ============================================================
console.log("\n(C) Blindagem estática — UM materializador, uma fonte")
// ============================================================

const materializador = read("src/services/materializar-fase.ts")
const advance = read("src/lib/motor/phase-advance.ts")
const reconciliar = read("src/services/reconciliar-fase.ts")
const phaseWorkflow = read("src/services/phase-workflow.ts")
const estrutura = read("src/lib/process-stage/estrutura-operacional.ts")
const progresso = read("src/lib/process-stage/resolve-fase-progresso.ts")
const rotaCentral = read("src/app/api/processos/[processoId]/central-operacional/route.ts")
const modal = read("src/components/kanban/MovimentarFaseModal.tsx")
const genealogia = read("src/services/genealogia/materializar-genealogia.ts")
const rotaArvore = read("src/app/api/arvore/route.ts")

check("o serviço oficial existe", materializador.includes("export async function materializarExecucaoDaFase"))
check("ele DELEGA aos serviços canônicos (não reimplementa)",
  materializador.includes("instanciarWorkflowDaFase") && materializador.includes("garantirTarefaDePasso"))
check("ele não cria instância de fase por conta própria",
  !/phaseWorkflowInstance\.create/.test(materializador))
check("ele não escreve no Processo (mudar de fase é do PhaseAdvanceService)",
  !/prisma\.processo\.(update|updateMany|create)|tx\.processo\.(update|updateMany)/.test(materializador))
check("ele devolve um estado NOMEADO", materializador.includes("EstadoMaterializacao") && materializador.includes("SEM_ALVO_APLICAVEL"))
check("zero sem motivo é tratado como inconsistência", materializador.includes("MATERIALIZACAO_VAZIA_SEM_MOTIVO"))
check("há validação pós-materialização", materializador.includes("export async function validarMaterializacaoDaFase"))

check("reconciliar NÃO tem implementação própria — delega",
  reconciliar.includes("materializarExecucaoDaFase") && !reconciliar.includes("garantirTarefaDePasso"))

check("o avanço de fase usa o serviço oficial", advance.includes("materializarExecucaoDaFase"))
check("o avanço NÃO gera tarefa por fora", !advance.includes("garantirTarefaDePasso"))
for (const [op, fonte] of [
  ["AVANCAR", "AVANCO_AUTOMATICO"], ["FORCAR", "AVANCO_FORCADO"],
  ["REABRIR", "REABERTURA"], ["RETORNAR", "RETORNO_CONTROLADO"], ["MOVER", "MOVIMENTACAO_MANUAL"],
] as const) {
  check(`${op} declara a fonte ${fonte} para o materializador`, advance.includes(`fonteMaterializacao: "${fonte}"`))
}
check("a árvore recém-criada converge a fase pelo serviço oficial", rotaArvore.includes("materializarExecucaoDaFase"))
check("o gatilho por árvore chama o serviço oficial antes do caminho da Matriz",
  genealogia.indexOf("materializarExecucaoDaFase") < genealogia.indexOf("await materializarGenealogia(p.id)"))

console.log("\n(C2) Obrigações alheias — invariante, não comportamento de tela")
check("a transição fotografa as obrigações antes e depois", advance.includes("fotografarObrigacoes") && advance.includes("obrigacoesAntes") && advance.includes("obrigacoesDepois"))
check("a comparação roda DENTRO da transação (antes do commit)", (() => {
  const abre = advance.indexOf("await prisma.$transaction(async (tx) => {")
  const compara = advance.indexOf("invariantes = compararObrigacoes(")
  const fotoAntes = advance.indexOf("const obrigacoesAntes = await fotografarObrigacoes(tx")
  const log = advance.indexOf("await tx.phaseAdvanceLog.create(")
  return abre >= 0 && fotoAntes > abre && compara > fotoAntes && log > compara
})())
check("violação derruba a transição (throw ⇒ rollback)", advance.includes('throw err') && advance.includes("INVARIANTE_OBRIGACOES"))
check("o código de falha é do vocabulário do motor", read("src/lib/motor/phase-advance-helpers.ts").includes('"INVARIANTE_OBRIGACOES"'))
check("a auditoria registra a preservação com números", advance.includes("obrigacoesPreservadas: true"))
check("a transição NÃO altera passo nem tarefa de outra fase",
  !/phaseWorkflowStepInstance\.updateMany|tarefa\.updateMany/.test(advance))

console.log("\n(C3) Leitura — nunca misturar ciclos")
check("existe UM resolvedor de instância vigente", read("src/lib/process-stage/instancia-vigente-da-fase.ts").includes("export async function resolverInstanciaVigente"))
check("a estrutura operacional escopa por instância sempre",
  estrutura.includes("resolverInstanciaVigente") && estrutura.includes("workflowInstanceId: instanciaAlvo"))
check("o progresso da fase escopa por instância sempre",
  progresso.includes("resolverInstanciaVigente") && progresso.includes("workflowInstanceId: instanceId"))
check("a Central envia a instância vigente ao índice", rotaCentral.includes("instanciaVigente?.id ?? null"))

console.log("\n(C4) Sem fallback silencioso")
check("a Central converge a fase ativa não materializada", rotaCentral.includes("materializarExecucaoDaFase") && rotaCentral.includes("fonte: \"RECONCILIACAO\""))
check("a Central devolve o estado da materialização", rotaCentral.includes("materializacao,"))
// `NECESSIDADES_ARVORE_FALHOU` e `REGRA_ARVORE_SEM_ITEM_MESTRE` eram códigos do
// SEGUNDO materializador (garantirNecessidadesArvoreDoProcesso), eliminado em
// f8c6069c. Sobrou o que ainda existe: processo sem árvore continua sendo motivo
// NOMEADO, não console.error.
check("o motivo do escopo deixou de ser só console.error",
  phaseWorkflow.includes("PROCESSO_SEM_ARVORE"))
check("os avisos do plano chegam a quem cria a instância",
  /created: true, workflowInstance: instancia, stepInstances, warnings: avisos/.test(phaseWorkflow))
check("a tela usa a explicação do servidor quando existe",
  read("src/components/kanban/ProcessoCentralOperacional.tsx").includes("explicacaoMaterializacao"))

console.log("\n(C5) Modal — o que a movimentação faz e o que ela NÃO faz")
check("o modal diz que só a fase operacional muda",
  modal.includes("altera apenas a fase operacional do processo"))
check("o modal diz que as obrigações das outras fases permanecem",
  modal.includes("permanecerão pendentes até serem concluídas"))
check("o modal não promete 'pular' nem 'concluir' fase",
  !/pular fase|concluir a fase atual/i.test(modal))

console.log("\n(C6) Reparo")
const reparo = read("scripts/reparar-materializacao-fase.ts")
check("o reparo existe e é dry-run por padrão", reparo.includes("--execute") && reparo.includes("SOMENTE LEITURA"))
check("o reparo usa o serviço oficial (sem lógica própria)", reparo.includes("materializarExecucaoDaFase"))
check("o reparo não apaga nem recria ciclo", !/delete|deleteMany|\.create\(/.test(reparo))
check("o reparo só olha fase ATIVA sem materialização", reparo.includes("if (instancia && passosAntes > 0) continue"))

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

const FASES_MACRO = ["genealogia", "emissao_documental", "analise_documental", "traducao", "apostilamento"]

async function main() {
  const { movePhaseManual, advance } = await import("../src/lib/motor/phase-advance")
  const { materializarExecucaoDaFase, validarMaterializacaoDaFase } = await import("../src/services/materializar-fase")
  const { reconciliarFaseAtiva } = await import("../src/services/reconciliar-fase")
  const { getPhaseOperationalStructure } = await import("../src/lib/process-stage/estrutura-operacional")
  const { resolvePendenciasTransversais } = await import("../src/lib/process-stage/pendencias-transversais")

  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog","LogAuditoria" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "MAT-TEST" }, update: {},
    create: {
      code: "MAT-TEST", name: "Materialização", countryKey: "alemanha", countryLabel: "Alemanha",
      nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa",
      modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })

  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro MAT", versao: 1 } })
  for (let i = 0; i < FASES_MACRO.length; i++) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASES_MACRO[i], label: FASES_MACRO[i], ordem: i, versao: 1 } })
  }
  // Genealogia opera por NECESSIDADE (escopo canônico da fase); as demais, por PROCESSO.
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

  // Documento Mestre com as certidões da regra da árvore (NASC/CAS/OBT inteiro teor).
  for (const [code, enumKey] of [
    ["IT - NAS", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR"],
    ["IT - CAS", "CERTIDAO_CASAMENTO_INTEIRO_TEOR"],
    ["IT - OBI", "CERTIDAO_OBITO_INTEIRO_TEOR"],
  ] as const) {
    const item = await prisma.itemCatalogo.create({
      data: { code: `CERT_${code.replace(/\W+/g, "_")}`, name: code, natureza: "DOCUMENTO" },
    })
    await prisma.tipoDocumentoCadastro.create({
      data: { code, name: code, legacyEnumKey: enumKey, itemCatalogoId: item.id, nature: "certidao" },
    })
  }

  const usuario = await prisma.usuario.upsert({
    where: { email: "master@materializacao.local" }, update: {},
    create: { nome: "Master", email: "master@materializacao.local", senha: "x", tipo: "admin" },
  })

  // ------------------------------------------------------------
  console.log("\n(B1) O processo nasce SEM árvore — a fase fica sem alvo, e diz por quê")
  // ------------------------------------------------------------
  const processo = await prisma.processo.create({
    data: { nome: "Processo Materialização", codigo: "T-MAT", pais: "Alemanha", faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  const semArvore = await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })
  check("fase publicada + processo sem árvore ⇒ SEM_ALVO_APLICAVEL", semArvore.estado === "SEM_ALVO_APLICAVEL", semArvore.estado)
  check("o motivo é NOMEADO, não silencioso", semArvore.motivos.length > 0 && semArvore.motivos.some((m) => m.code === "PROCESSO_SEM_ARVORE"), JSON.stringify(semArvore.motivos.map((m) => m.code)))
  check("há mensagem administrativa acionável", (semArvore.mensagemAdministrativa ?? "").length > 20)
  check("nenhum passo foi criado", semArvore.passosTotais === 0)

  // ------------------------------------------------------------
  console.log("\n(B2) A árvore aparece DEPOIS — a fase converge, sem ciclo novo")
  // ------------------------------------------------------------
  const arvore = await prisma.arvore.create({ data: { nome: "Árvore MAT" } })
  const pai = await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "nao", vivo: false } })
  await prisma.pessoa.create({ data: { nome: "Marco", sobrenome: "Rovatti", arvoreId: arvore.id, linhaReta: true, requerente: "maior", paiId: pai.id } })
  await prisma.processo.update({ where: { id: processo.id }, data: { arvoreId: arvore.id } })

  const convergiu = await materializarExecucaoDaFase({ processoId: processo.id, fonte: "RECONCILIACAO" })
  check("com pessoas na árvore, a MESMA fase materializa", convergiu.estado === "MATERIALIZADO", `${convergiu.estado} ${JSON.stringify(convergiu.motivos.map((m) => m.code))}`)
  check("passos de 'Localizar registro' foram criados", convergiu.passosTotais > 0, String(convergiu.passosTotais))
  check("tarefas de busca foram criadas", convergiu.tarefasCriadas > 0, String(convergiu.tarefasCriadas))
  check("as necessidades vieram da regra da árvore", (await prisma.necessidadeDocumental.count({ where: { processoId: processo.id } })) > 0)
  const ciclosGen1 = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id, faseMacroKey: "genealogia" } })
  check("materializar NÃO cria ciclo novo", ciclosGen1 === 1, String(ciclosGen1))

  const val1 = await validarMaterializacaoDaFase(convergiu.workflowInstanceId!)
  check("validação estrutural passa", val1.ok, JSON.stringify(val1.problemas))
  check("as pessoas oficiais foram carregadas", val1.pessoasOficiais === 2, String(val1.pessoasOficiais))
  check("cada alvo tem a sua instância", val1.alvosResolvidos === val1.passos, `${val1.alvosResolvidos}/${val1.passos}`)
  check("nenhum passo vazou de ciclo", val1.vazamentoDeCiclo === 0)

  // ------------------------------------------------------------
  console.log("\n(B3) Idempotência — rodar de novo não duplica nada")
  // ------------------------------------------------------------
  const antesIdem = {
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id } }),
    tarefas: await prisma.tarefa.count({ where: { processoId: processo.id } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: processo.id } }),
  }
  for (let i = 0; i < 3; i++) await materializarExecucaoDaFase({ processoId: processo.id, fonte: "RECONCILIACAO" })
  await reconciliarFaseAtiva(processo.id)
  const depoisIdem = {
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id } }),
    tarefas: await prisma.tarefa.count({ where: { processoId: processo.id } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: processo.id } }),
  }
  check("passos não duplicam", depoisIdem.passos === antesIdem.passos, `${antesIdem.passos} → ${depoisIdem.passos}`)
  check("tarefas não duplicam", depoisIdem.tarefas === antesIdem.tarefas, `${antesIdem.tarefas} → ${depoisIdem.tarefas}`)
  check("necessidades não duplicam", depoisIdem.necessidades === antesIdem.necessidades, `${antesIdem.necessidades} → ${depoisIdem.necessidades}`)

  // ------------------------------------------------------------
  console.log("\n(B4) Movimentação manual PARA FRENTE — destino materializado, resto intacto")
  // ------------------------------------------------------------
  const fotografar = async () => {
    const passos = await prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId: processo.id }, select: { id: true, status: true, completedAt: true, faseMacroKey: true, ciclo: true },
      orderBy: { id: "asc" },
    })
    const tarefas = await prisma.tarefa.findMany({
      where: { processoId: processo.id }, select: { id: true, statusTarefa: true, concluida: true }, orderBy: { id: "asc" },
    })
    return {
      passos: new Map(passos.map((p) => [p.id, `${p.status}|${p.completedAt?.toISOString() ?? "-"}`])),
      tarefas: new Map(tarefas.map((t) => [t.id, `${t.statusTarefa}|${t.concluida}`])),
      porFase: passos.reduce<Record<string, number>>((a, p) => { a[`${p.faseMacroKey}#${p.ciclo}`] = (a[`${p.faseMacroKey}#${p.ciclo}`] ?? 0) + 1; return a }, {}),
    }
  }
  const alheiasIntactas = (antes: Awaited<ReturnType<typeof fotografar>>, depois: Awaited<ReturnType<typeof fotografar>>) => {
    for (const [id, v] of antes.passos) if (depois.passos.get(id) !== v) return `passo ${id}: ${v} → ${depois.passos.get(id)}`
    for (const [id, v] of antes.tarefas) if (depois.tarefas.get(id) !== v) return `tarefa ${id}: ${v} → ${depois.tarefas.get(id)}`
    return null
  }

  const antesMove = await fotografar()
  const mv1 = await movePhaseManual(processo.id, {
    faseAlvo: "traducao", justificativa: "Processo já estava em tradução no fornecedor.",
    motivoCodigo: "CORRECAO_DE_FASE", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("mover para frente é aceito", mv1.success === true, JSON.stringify(mv1))
  check("o destino foi materializado pelo pipeline oficial", mv1.success && mv1.materializacao?.estado === "MATERIALIZADO", JSON.stringify(mv1.success ? mv1.materializacao : null))
  check("o destino ganhou tarefa própria", mv1.success && mv1.tarefasCriadas > 0, mv1.success ? String(mv1.tarefasCriadas) : "")
  check("a auditoria prova a preservação das obrigações", mv1.success && mv1.obrigacoesPreservadas != null)

  const depoisMove = await fotografar()
  check("NENHUMA obrigação preexistente mudou de estado", alheiasIntactas(antesMove, depoisMove) === null, alheiasIntactas(antesMove, depoisMove) ?? "")
  check("nenhuma obrigação foi excluída", depoisMove.passos.size >= antesMove.passos.size && depoisMove.tarefas.size >= antesMove.tarefas.size)
  const genDepois = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: "genealogia" }, orderBy: { ciclo: "desc" } })
  check("a fase de origem foi SUPERSEDIDA, não concluída", genDepois?.status === "SUPERSEDIDO" && genDepois?.completedAt === null)
  const passosGenPendentes = await prisma.phaseWorkflowStepInstance.count({
    where: { processoId: processo.id, faseMacroKey: "genealogia", status: { notIn: ["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO", "CANCELADO"] } },
  })
  check("o ciclo SUPERSEDIDO mantém as tarefas pendentes", passosGenPendentes > 0, String(passosGenPendentes))

  console.log("\n(B4.1) Fases atravessadas continuam devendo")
  const pend1 = await resolvePendenciasTransversais(processo.id)
  check("a Genealogia atravessada aparece com pendência", (pend1.porFase.find((f) => f.phaseKey === "genealogia")?.pendentes ?? 0) > 0)
  check("as pendências anteriores são contadas", pend1.pendentesAnteriores > 0, String(pend1.pendentesAnteriores))
  check("o processo não pode ser dado por concluído", pend1.temPendenciaTransversal === true)
  check("nenhuma fase intermediária foi marcada como concluída",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id, faseMacroKey: { in: ["emissao_documental", "analise_documental"] }, status: "CONCLUIDO" } })) === 0)

  // ------------------------------------------------------------
  console.log("\n(B5) Movimentação manual PARA TRÁS — ciclo 2 materializado, ciclo 1 intacto")
  // ------------------------------------------------------------
  const cicloAntigo = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 1 } })
  const passosCiclo1Antes = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: cicloAntigo!.id }, select: { id: true, status: true }, orderBy: { id: "asc" },
  })
  const antesVolta = await fotografar()

  const mv2 = await movePhaseManual(processo.id, {
    faseAlvo: "genealogia", justificativa: "Faltou uma certidão; retomar a busca registral.",
    motivoCodigo: "RETORNO_PARA_REGULARIZACAO", solicitadoPorId: usuario.id, origem: "teste",
  })
  check("mover para trás é aceito", mv2.success === true, JSON.stringify(mv2))
  check("a Genealogia recebeu o ciclo 2", mv2.success && mv2.ciclo === 2, mv2.success ? String(mv2.ciclo) : "")
  check("o ciclo 2 foi materializado", mv2.success && mv2.materializacao?.estado === "MATERIALIZADO", JSON.stringify(mv2.success ? mv2.materializacao : null))
  check("o ciclo 2 tem passos próprios", mv2.success && (mv2.materializacao?.passos ?? 0) > 0, String(mv2.success ? mv2.materializacao?.passos : 0))

  const passosCiclo1Depois = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: cicloAntigo!.id }, select: { id: true, status: true }, orderBy: { id: "asc" },
  })
  check("o ciclo 1 tem exatamente os mesmos passos", JSON.stringify(passosCiclo1Antes) === JSON.stringify(passosCiclo1Depois))
  const instCiclo2 = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 2 } })
  const passosCiclo2 = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: instCiclo2!.id }, select: { id: true, ciclo: true } })
  check("os passos do ciclo 2 são NOVOS (nenhum id do ciclo 1)",
    passosCiclo2.every((p) => !passosCiclo1Antes.some((a) => a.id === p.id)))
  check("todos os passos do ciclo 2 estão no ciclo 2", passosCiclo2.every((p) => p.ciclo === 2))
  const tarefasCiclo2 = await prisma.tarefa.count({ where: { workflowStepInstanceId: { in: passosCiclo2.map((p) => p.id) } } })
  check("o ciclo 2 tem tarefas próprias de busca", tarefasCiclo2 > 0, String(tarefasCiclo2))
  const depoisVolta = await fotografar()
  check("voltar não alterou obrigação nenhuma preexistente", alheiasIntactas(antesVolta, depoisVolta) === null, alheiasIntactas(antesVolta, depoisVolta) ?? "")
  check("as tarefas da Tradução continuam preservadas",
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id, faseMacroKey: "traducao" } })) > 0)

  console.log("\n(B5.1) A Central lê o ciclo ATIVO, sem misturar")
  const estruturaAtiva = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "genealogia" })
  const idsNaLeitura: number[] = []
  for (const grupo of [estruturaAtiva.estrutura.linhaPrincipal, estruturaAtiva.estrutura.foraDaLinha, estruturaAtiva.estrutura.pendenteClassificacao]) {
    for (const pessoa of grupo) for (const doc of pessoa.documentos) for (const passo of doc.passos) idsNaLeitura.push(passo.stepInstanceId)
  }
  check("a leitura da fase ativa devolve trabalho", idsNaLeitura.length > 0, String(idsNaLeitura.length))
  const ciclosNaLeitura = new Set(
    (await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: idsNaLeitura } }, select: { ciclo: true } })).map((x) => x.ciclo),
  )
  check("a leitura devolve UM só ciclo", ciclosNaLeitura.size <= 1, JSON.stringify([...ciclosNaLeitura]))
  check("e é o ciclo ATIVO (2)", ciclosNaLeitura.has(2), JSON.stringify([...ciclosNaLeitura]))
  const estruturaCiclo1 = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "genealogia", workflowInstanceId: cicloAntigo!.id })
  check("o ciclo 1 continua consultável por instância",
    estruturaCiclo1.estrutura.resumo.documentos > 0 || estruturaCiclo1.estrutura.linhaPrincipal.length > 0)

  // ------------------------------------------------------------
  console.log("\n(B6) Avanço automático usa o MESMO pipeline")
  // ------------------------------------------------------------
  await prisma.phaseWorkflowStepInstance.updateMany({
    where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 2 },
    data: { status: "CONCLUIDO", completedAt: new Date() },
  })
  const av = await advance(processo.id, { origem: "teste" })
  check("avanço automático é aceito com a fase concluída", av.success === true, JSON.stringify(av))
  check("o destino do avanço foi materializado pelo serviço oficial",
    av.success && av.materializacao?.estado === "MATERIALIZADO", JSON.stringify(av.success ? av.materializacao : null))
  check("a auditoria do avanço também prova a preservação", av.success && av.obrigacoesPreservadas != null)

  // ------------------------------------------------------------
  console.log("\n(B7) Reparo do ciclo vazio — completa, não recria")
  // ------------------------------------------------------------
  const p2 = await prisma.processo.create({
    data: { nome: "Processo Vazio", codigo: "T-VAZIO", pais: "Alemanha", faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
  })
  await materializarExecucaoDaFase({ processoId: p2.id, fonte: "PROCESSO_CRIADO" }) // sem árvore ⇒ vazio
  const instVazia = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: p2.id, faseMacroKey: "genealogia" } })
  check("a fase ficou ATIVA e vazia (cenário de produção)", instVazia?.status === "ATIVO" && (await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: instVazia!.id } })) === 0)

  const arvore2 = await prisma.arvore.create({ data: { nome: "Árvore MAT 2" } })
  await prisma.pessoa.create({ data: { nome: "Ana", sobrenome: "Souza", arvoreId: arvore2.id, linhaReta: true, requerente: "maior" } })
  await prisma.processo.update({ where: { id: p2.id }, data: { arvoreId: arvore2.id } })

  const reparado = await materializarExecucaoDaFase({ processoId: p2.id, fonte: "REPARO_ADMINISTRATIVO" })
  check("o reparo materializa o ciclo existente", reparado.estado === "MATERIALIZADO" && reparado.passosTotais > 0, `${reparado.estado} ${reparado.passosTotais}`)
  check("o reparo NÃO criou ciclo novo", reparado.workflowInstanceId === instVazia!.id && reparado.ciclo === 1)
  check("o reparo não tocou no outro processo",
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 1 } })) === passosCiclo1Antes.length)
  const auditoriaReparo = await prisma.logAuditoria.findFirst({
    where: { acao: "FASE_MATERIALIZADA", entidadeId: p2.id }, orderBy: { id: "desc" },
  })
  check("o reparo é auditado", auditoriaReparo != null)
  check("a auditoria registra a FONTE", (auditoriaReparo?.detalhes as { fonte?: string } | null)?.fonte === "REPARO_ADMINISTRATIVO")

  console.log("\n(B8) Auditoria da movimentação preservada")
  const evtMovida = await prisma.workflowEvento.count({ where: { processoId: processo.id, tipo: "FASE_MOVIDA" } })
  check("FASE_MOVIDA continua sendo emitido", evtMovida === 2, String(evtMovida))
  const logsMovidos = await prisma.phaseAdvanceLog.findMany({ where: { processoId: processo.id, resultado: "MOVIDO" } })
  check("os logs de movimentação existem", logsMovidos.length === 2, String(logsMovidos.length))
  check("o log carrega o bloco de invariantes",
    logsMovidos.every((l) => (l.regrasAvaliadas as { invariantes?: { obrigacoesPreservadas?: boolean } } | null)?.invariantes?.obrigacoesPreservadas === true))

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
