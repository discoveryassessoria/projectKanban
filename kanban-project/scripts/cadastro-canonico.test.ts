// scripts/cadastro-canonico.test.ts
//
// O ADMINISTRADOR É DONO DO NEGÓCIO.
//
// A pergunta que este arquivo responde é uma só: dá para mudar o negócio sem mudar o
// código? Criar uma fase, um passo, um canal, um resultado, um item de conferência —
// e ver isso rodar num processo. E, ao mesmo tempo: o que já estava rodando continua
// rodando como estava, porque a versão publicada é imutável.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/cadastro-canonico.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { validarConfiguracao, detectarCiclo, executorEfetivo, validarWorkflowParaPublicar } from "../src/services/validacao-de-publicacao"
import { CATALOGO_DE_EFEITOS, efeito, efeitosDaFase, COMPETENCIAS } from "../src/lib/motor/catalogo-de-efeitos"
import { REGISTRO_DE_EXECUTORES, executorSuportaEfeito } from "../src/lib/motor/registro-de-executores"
import { liberadosPor, descendentes, impactoDaReabertura, type PassoComDependencia } from "../src/services/dependencias-do-passo"
import { congelarVersaoVigente, publicarNovaVersao, lerVersaoPublicada, definicaoHistoricaDoPasso } from "../src/services/versao-publicada"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"

const ROOT = join(__dirname, "..")
const read = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ════════════════════════════════════════════════════════════════
console.log("\n(A) O cadastro é a fonte — e a publicação recusa o impossível")
// ════════════════════════════════════════════════════════════════

const val = semComentarios(read("src/services/validacao-de-publicacao.ts"))
check("existe validação de publicação", val.includes("export function validarConfiguracao"))
const rota = semComentarios(read("src/app/api/gerenciamento/workflows-fase/[id]/route.ts"))
check("publicar PASSA pela validação", rota.includes("validarWorkflowParaPublicar"))
check("e configuração inválida DESFAZ a publicação inteira",
  rota.includes("throw Object.assign(new Error('PUBLICACAO_INVALIDA')"))
check("a recusa devolve os problemas, não um 500 mudo", rota.includes("status: 422"))
check("as ações são gravadas junto com o passo", rota.includes("tx.stepAction.createMany"))

const vp = semComentarios(read("src/services/versao-publicada.ts"))
check("a versão congela as AÇÕES", vp.includes("acoes: p.acoes.map"))
check("congela os CAMPOS", vp.includes("campos: p.campos.map"))
check("congela o CHECKLIST", vp.includes("checkItens: p.checkItens.map"))
check("congela a DEPENDÊNCIA declarada", vp.includes("dependeDe: Array.isArray(p.dependeDe)"))

const efe = semComentarios(read("src/lib/motor/catalogo-de-efeitos.ts"))
check("o catálogo de efeitos é fechado e declara competência", efe.includes("competencia: COMPETENCIAS."))
check("GO_RETIFICATION é competência da ANÁLISE",
  efeito("GO_RETIFICATION")?.competencia === COMPETENCIAS.ANALISE)
check("a conferência NÃO sabe disparar GO_RETIFICATION",
  !executorSuportaEfeito("conferencia_documento", "GO_RETIFICATION"))
check("a validação jurídica sabe", executorSuportaEfeito("validacao_juridica", "GO_RETIFICATION"))
check("o executor declarativo desenha todo tipo de campo e dispara todo efeito",
  REGISTRO_DE_EXECUTORES.padrao.efeitos === "*" && REGISTRO_DE_EXECUTORES.padrao.acoesCadastradas)
check("todo efeito do catálogo tem execução ligada",
  CATALOGO_DE_EFEITOS.every((e) => semComentarios(read("src/services/executar-acao-cadastrada.ts")).includes(`case "${e.key}"`)),
  CATALOGO_DE_EFEITOS.filter((e) => !read("src/services/executar-acao-cadastrada.ts").includes(`case "${e.key}"`)).map((e) => e.key).join(","))

const dep = semComentarios(read("src/services/dependencias-do-passo.ts"))
check("existe propagação por dependência", dep.includes("export function descendentes"))
const sync = semComentarios(read("src/services/task-step-sync.ts"))
check("concluir libera QUEM DEPENDE, não quem vem depois", sync.includes("liberadosPor(comoDependencia"))
const docop = semComentarios(read("src/services/documento-operacao.ts"))
check("reabrir alcança descendentes, não `ordem > N`", docop.includes("impactoDaReabertura(grafo, p.stepKey)"))

const esc = semComentarios(read("src/services/phase-workflow-escopo.ts"))
check("a dependência DECLARADA manda na materialização", esc.includes("const declaradas = Array.isArray(def.dependeDe)"))

// ── funções puras ──
console.log("\n(B) As regras puras")
check("ciclo é detectado", JSON.stringify(detectarCiclo([
  { key: "a", label: "A", dependeDe: ["b"] }, { key: "b", label: "B", dependeDe: ["a"] },
])) !== "null")
check("um DAG legítimo não acusa ciclo", detectarCiclo([
  { key: "a", label: "A", dependeDe: [] }, { key: "b", label: "B", dependeDe: ["a"] },
  { key: "c", label: "C", dependeDe: ["a"] }, { key: "d", label: "D", dependeDe: ["b", "c"] },
]) === null)

const problemas = validarConfiguracao([
  { key: "a", label: "A", executorKey: "padrao", dependeDe: ["nao_existe"] },
  { key: "b", label: "B", executorKey: "padrao", dependeDe: ["b"] },
  { key: "c", label: "C", executorKey: "padrao", acoes: [{ key: "x", effectKey: "NAO_EXISTE" }] },
  { key: "d", label: "D", executorKey: "conferencia_documento", acoes: [{ key: "r", effectKey: "GO_RETIFICATION" }] },
  { key: "e", label: "E", executorKey: "padrao", campos: [{ key: "f", tipo: "holograma" }] },
  { key: "f", label: "F", executorKey: "padrao", acoes: [{ key: "y", effectKey: "COMPLETE_STEP", requerCampos: ["inexistente"] }] },
], { phaseKey: "analise_documental", efeitosPermitidosDaFase: efeitosDaFase("analise_documental", null) })
const cods = new Set(problemas.map((p) => p.codigo))
check("dependência inexistente é recusada", cods.has("DEPENDENCIA_INEXISTENTE"))
check("auto-dependência é recusada", cods.has("DEPENDENCIA_REFLEXIVA"))
check("efeito fora do catálogo é recusado", cods.has("EFEITO_INEXISTENTE"))
check("efeito que o executor não dispara é recusado", cods.has("EFEITO_SEM_SUPORTE"))
check("tipo de campo inexistente é recusado", cods.has("CAMPO_TIPO_DESCONHECIDO"))
check("ação que exige campo inexistente é recusada", cods.has("ACAO_EXIGE_CAMPO_INEXISTENTE"))

const foraDeCompetencia = validarConfiguracao(
  [{ key: "conferir", label: "Conferir", executorKey: "validacao_juridica", campos: [{ key: "justificativa", tipo: "textarea" }], acoes: [{ key: "r", effectKey: "GO_RETIFICATION", requerCampos: [] }] }],
  { phaseKey: "emissao_documental", efeitosPermitidosDaFase: efeitosDaFase("emissao_documental", null) },
)
check("A EMISSÃO NÃO PODE PUBLICAR A DECISÃO DE RETIFICAR",
  foraDeCompetencia.some((p) => p.codigo === "EFEITO_FORA_DE_COMPETENCIA"),
  JSON.stringify(foraDeCompetencia.map((p) => p.codigo)))
check("e a mesma configuração na ANÁLISE é aceita",
  validarConfiguracao(
    [{ key: "validar", label: "Validar", executorKey: "validacao_juridica", campos: [{ key: "justificativa", tipo: "textarea" }], acoes: [{ key: "r", effectKey: "GO_RETIFICATION" }] }],
    { phaseKey: "analise_documental", efeitosPermitidosDaFase: efeitosDaFase("analise_documental", null) },
  ).length === 0)

const grafo: PassoComDependencia[] = [
  { id: 1, stepKey: "a", ordem: 1, status: "CONCLUIDO", dependeDeStepKeys: [] },
  { id: 2, stepKey: "b", ordem: 2, status: "PENDENTE", dependeDeStepKeys: ["a"] },
  { id: 3, stepKey: "c", ordem: 3, status: "PENDENTE", dependeDeStepKeys: ["a"] },
  { id: 4, stepKey: "d", ordem: 4, status: "PENDENTE", dependeDeStepKeys: ["b", "c"] },
  { id: 5, stepKey: "z", ordem: 5, status: "CONCLUIDO", dependeDeStepKeys: [] },
]
check("concluir A libera B e C — os DOIS",
  JSON.stringify(liberadosPor(grafo, "a").map((p) => p.stepKey)) === '["b","c"]')
check("D não é liberado enquanto B e C não estiverem cumpridos",
  !liberadosPor(grafo, "a").some((p) => p.stepKey === "d"))
check("os descendentes de A são B, C e D",
  JSON.stringify(descendentes(grafo, "a").map((p) => p.stepKey)) === '["b","c","d"]')
check("Z é INDEPENDENTE e a reabertura de A não o alcança",
  impactoDaReabertura(grafo, "a").preservados.some((p) => p.stepKey === "z") &&
  !impactoDaReabertura(grafo, "a").alcancados.some((p) => p.stepKey === "z"))
check("reabrir B alcança só D", JSON.stringify(descendentes(grafo, "b").map((p) => p.stepKey)) === '["d"]')

// ════════════════════════════════════════════════════════════════
const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(C) Comportamento — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

const prisma = new PrismaClient()
const M = "CC"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.documentoObservacao.deleteMany({ where: { documento: { pessoa: { arvoreId: { in: procs.map((p) => p.arvoreId!).filter(Boolean) } } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  for (const uid of [`${M}::wf`, `${M}::wf2`]) {
    const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: uid }, select: { id: true } })
    if (wf) {
      await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
      await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
    }
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "cc_" } } })
  await prisma.canalOperacional.deleteMany({ where: { key: { startsWith: "CC_" } } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════
  console.log("\n(C) SEM CÓDIGO: o administrador cria fase, canal, passo, campo, ação e checklist")
  // ══════════════════════════════════════════════════════════════
  // Nada abaixo referencia "cc_teste" no código do sistema. É tudo dado.

  const canal = await prisma.canalOperacional.create({
    data: { key: "CC_PORTAL_ESTADUAL", label: "Portal Estadual", descricao: "Portal do estado", ordem: 99, protocoloObrigatorio: true, anexoObrigatorioLabel: "Print do protocolo" },
    select: { id: true, key: true },
  })
  check("canal novo cadastrado sem deploy", canal.key === "CC_PORTAL_ESTADUAL")

  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: "cc_teste_dinamico", label: "Teste Dinâmico", escopo: "PROCESSO",
      ordemPadrao: 90, slaDiasPadrao: 5,
      // A fase declara a própria competência — é o cadastro dizendo o que ela pode.
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
    },
    select: { id: true, phaseKey: true },
  })
  check("fase nova cadastrada sem deploy", fase.phaseKey === "cc_teste_dinamico")

  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow do teste dinâmico",
      tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: [
          { key: "preparar", label: "Preparar pacote", ordem: 1, createsTask: true, required: true, slaDays: 2, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: [] },
          { key: "analisar", label: "Analisar pacote", ordem: 2, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: ["preparar"] },
          { key: "arquivar", label: "Arquivar", ordem: 3, createsTask: true, required: false, slaDays: 1, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: ["preparar"] },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  const analisar = wf.passos.find((p) => p.key === "analisar")!
  await prisma.stepField.createMany({
    data: [
      { stepId: analisar.id, key: "parecer", label: "Parecer", tipo: "textarea", obrigatorio: true, ordem: 1 },
      { stepId: analisar.id, key: "canal", label: "Canal usado", tipo: "select", opcoes: { catalogo: "canais" } as never, ordem: 2 },
      { stepId: analisar.id, key: "grau", label: "Grau", tipo: "select", opcoes: [{ value: "a", label: "A" }, { value: "b", label: "B" }] as never, ordem: 3 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: analisar.id, key: "concluir", label: "Concluir análise", descricao: "Fecha a etapa", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["parecer"] as never },
      { stepId: analisar.id, key: "aguardar", label: "Aguardar terceiro", descricao: "Espera externa", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", ordem: 2 },
    ],
  })
  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: analisar.id, key: "conferido", label: "Pacote conferido", ordem: 1 },
      { stepId: analisar.id, key: "assinado", label: "Documento assinado", ordem: 2 },
    ],
  })
  check("passo, campos, ações e checklist cadastrados sem deploy",
    (await prisma.stepField.count({ where: { stepId: analisar.id } })) === 3 &&
    (await prisma.stepAction.count({ where: { stepId: analisar.id } })) === 2 &&
    (await prisma.stepChecklistItem.count({ where: { stepId: analisar.id } })) === 2)
  check("o passo declara o executor e a dependência",
    executorEfetivo({ key: "analisar", executorKey: "padrao" }, fase.phaseKey) === "padrao")

  const probs = await validarWorkflowParaPublicar(wf.id)
  check("a configuração inteira é publicável", probs.length === 0, JSON.stringify(probs))
  await congelarVersaoVigente(wf.id, "CRIACAO")
  const v1 = await lerVersaoPublicada(wf.id, 1)
  check("a V1 congelou as ações", (v1?.passos.find((p) => p.key === "analisar")?.acoes.length ?? 0) === 2)
  check("congelou os campos e o checklist",
    (v1?.passos.find((p) => p.key === "analisar")?.campos.length ?? 0) === 3 &&
    (v1?.passos.find((p) => p.key === "analisar")?.checkItens.length ?? 0) === 2)
  check("e a dependência declarada",
    JSON.stringify(v1?.passos.find((p) => p.key === "analisar")?.dependeDe) === '["preparar"]')

  // ── executar num processo real ──
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Fulano", sobrenome: "de Teste", arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const criarPasso = async (key: string, ordem: number, deps: string[], status: string) =>
    prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
        stepKey: key, ordem, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: status as never, dependeDeStepKeys: deps as never,
        stepDefinitionId: wf.passos.find((p) => p.key === key)!.id, stepDefinitionVersion: 1,
        chaveIdempotencia: `${M}-${key}`,
      },
      select: { id: true },
    })
  const siPreparar = await criarPasso("preparar", 1, [], "CONCLUIDO")
  const siAnalisar = await criarPasso("analisar", 2, ["preparar"], "EM_ANDAMENTO")
  const siArquivar = await criarPasso("arquivar", 3, ["preparar"], "PENDENTE")
  for (const si of [siPreparar, siAnalisar, siArquivar]) {
    await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  }

  const cfg = await definicaoHistoricaDoPasso(siAnalisar.id)
  check("a etapa em execução resolve a configuração da SUA versão",
    cfg?.versao === 1 && cfg.passo.acoes.length === 2 && cfg.passo.campos.length === 3)

  const perms = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]
  const semParecer = await executarAcaoCadastrada(siAnalisar.id, "concluir", {}, { usuarioId: 1, permissoes: perms, correlationId: `${M}-c1` })
  check("a ação recusa sem o campo obrigatório", !semParecer.ok && semParecer.codigo === "CAMPO_OBRIGATORIO", JSON.stringify(semParecer))

  const inexistente = await executarAcaoCadastrada(siAnalisar.id, "inventada", { parecer: "x" }, { usuarioId: 1, permissoes: perms, correlationId: `${M}-c2` })
  check("a ação que não está cadastrada é recusada pelo SERVIDOR", !inexistente.ok && inexistente.codigo === "ACAO_INEXISTENTE")

  const semPermissao = await executarAcaoCadastrada(siAnalisar.id, "concluir", { parecer: "ok" }, { usuarioId: 1, permissoes: [], correlationId: `${M}-c3` })
  check("sem permissão, recusa", !semPermissao.ok && semPermissao.codigo === "SEM_PERMISSAO")

  const feito = await executarAcaoCadastrada(siAnalisar.id, "concluir", { parecer: "Pacote conferido." }, { usuarioId: 1, permissoes: perms, correlationId: `${M}-c4` })
  check("a ação cadastrada executa e conclui a etapa", feito.ok && feito.efeito === "COMPLETE_STEP", JSON.stringify(feito))
  const depoisDaAcao = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: siAnalisar.id }, select: { status: true } })
  check("a etapa ficou concluída pelo motor", depoisDaAcao?.status === "CONCLUIDO", String(depoisDaAcao?.status))
  const t = (await tentativasDoPasso(siAnalisar.id)).find((x) => x.supersededAt == null)
  check("o que foi decidido ficou na TENTATIVA", t?.resultado === "concluir")
  check("com os valores e a versão da configuração",
    (t?.payload as { versaoDaConfiguracao?: number; valores?: Record<string, string> })?.versaoDaConfiguracao === 1 &&
    (t?.payload as { valores?: Record<string, string> })?.valores?.parecer === "Pacote conferido.")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(D) V2 não contamina V1")
  // ══════════════════════════════════════════════════════════════
  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wf.id, tx)
    const alvo = await tx.phaseInternalWorkflowStep.findFirst({ where: { workflowId: wf.id, key: "analisar" }, select: { id: true } })
    await tx.stepAction.create({
      data: { stepId: alvo!.id, key: "reprovar", label: "Reprovar", descricao: "novo em V2", effectKey: "REGISTER_ONLY", ordem: 3 },
    })
    await tx.stepChecklistItem.create({ data: { stepId: alvo!.id, key: "certificado_digital", label: "Certificado digital conferido", ordem: 3 } })
    await tx.stepField.create({ data: { stepId: alvo!.id, key: "novo_campo", label: "Campo novo", tipo: "texto", ordem: 4 } })
    await congelarVersaoVigente(wf.id, "PUBLICACAO", tx)
  })
  const v2 = await lerVersaoPublicada(wf.id, 2)
  check("a V2 tem a ação nova", (v2?.passos.find((p) => p.key === "analisar")?.acoes.length ?? 0) === 3)
  check("e o item de checklist novo", (v2?.passos.find((p) => p.key === "analisar")?.checkItens.length ?? 0) === 3)
  const histDepois = await definicaoHistoricaDoPasso(siAnalisar.id)
  check("A EXECUÇÃO EM V1 NÃO VÊ A AÇÃO DE V2",
    histDepois?.versao === 1 && histDepois.passo.acoes.length === 2 &&
    !histDepois.passo.acoes.some((a) => a.key === "reprovar"))
  check("nem o checklist novo", (histDepois?.passo.checkItens.length ?? 0) === 2)
  const tentaV2 = await executarAcaoCadastrada(siPreparar.id, "reprovar", {}, { usuarioId: 1, permissoes: perms, correlationId: `${M}-c5` })
  check("e executar a ação de V2 numa execução V1 é recusado", !tentaV2.ok)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(E) Renomear e inativar não quebram o histórico")
  // ══════════════════════════════════════════════════════════════
  const vivo = await prisma.phaseInternalWorkflowStep.findFirst({ where: { workflowId: wf.id, key: "analisar" }, select: { id: true } })
  await prisma.stepAction.updateMany({ where: { stepId: vivo!.id, key: "concluir" }, data: { label: "REBATIZADA" } })
  await prisma.stepAction.updateMany({ where: { stepId: vivo!.id, key: "aguardar" }, data: { ativo: false } })
  const histRenomeada = await definicaoHistoricaDoPasso(siAnalisar.id)
  check("renomear a ação viva não altera a versão congelada",
    histRenomeada?.passo.acoes.find((a) => a.key === "concluir")?.label === "Concluir análise")
  check("a decisão registrada aponta para a CHAVE, não para o rótulo", t?.resultado === "concluir")
  await prisma.$transaction(async (tx) => { await publicarNovaVersao(wf.id, tx); await congelarVersaoVigente(wf.id, "PUBLICACAO", tx) })
  const v3 = await lerVersaoPublicada(wf.id, 3)
  check("a versão nova não oferece a ação inativada",
    v3?.passos.find((p) => p.key === "analisar")?.acoes.find((a) => a.key === "aguardar")?.ativo === false)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(F) Competência: a Emissão não decide retificação")
  // ══════════════════════════════════════════════════════════════
  const faseEmissao = await prisma.catalogoFase.upsert({
    where: { phaseKey: "cc_emissao" },
    update: {}, create: { phaseKey: "cc_emissao", label: "Emissão (teste)", escopo: "DOCUMENTO", efeitosPermitidos: efeitosDaFase("emissao_documental", null) },
    select: { phaseKey: true, efeitosPermitidos: true },
  })
  check("a Emissão NÃO tem GO_RETIFICATION entre os efeitos permitidos",
    !(faseEmissao.efeitosPermitidos as string[]).includes("GO_RETIFICATION"))
  check("mas tem APPROVE_FOR_ANALYSIS — ela entrega a quem decide",
    (faseEmissao.efeitosPermitidos as string[]).includes("APPROVE_FOR_ANALYSIS"))
  check("a Análise tem GO_RETIFICATION",
    efeitosDaFase("analise_documental", null).includes("GO_RETIFICATION"))

  // ══════════════════════════════════════════════════════════════
  console.log("\n(G) Nova via preserva o documento anterior")
  // ══════════════════════════════════════════════════════════════
  const { novaViaDocumental } = await import("../src/services/efeitos-de-dominio")
  const docA = await prisma.documento.create({
    data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", status: "RECEBIDO", cartorio: "1º Ofício", livro: "A-1", folha: "10", observacoes: "primeira via" },
    select: { id: true },
  })
  const alvo = { stepInstanceId: siAnalisar.id, documentoId: docA.id, processoId: proc.id, usuarioId: 1, sync: { origem: "USER" as const, correlationId: `${M}-nv1` }, valores: { motivo: "ilegível" } }
  const nv = await novaViaDocumental(alvo)
  const idB = (nv as { criado: number }).criado
  const [a1, b1] = await Promise.all([
    prisma.documento.findUnique({ where: { id: docA.id }, select: { id: true, status: true, observacoes: true, substituidoEm: true, necessidadeId: true, livro: true } }),
    prisma.documento.findUnique({ where: { id: idB }, select: { id: true, derivadoDeId: true, derivacaoTipo: true, status: true, necessidadeId: true, livro: true } }),
  ])
  check("a nova via é um documento NOVO", idB !== docA.id && b1?.derivadoDeId === docA.id)
  check("com a linhagem declarada", b1?.derivacaoTipo === "NOVA_VIA")
  check("O DOCUMENTO ANTERIOR CONTINUA LÁ, com o que ele dizia",
    a1?.observacoes?.includes("primeira via") === true && a1?.livro === "A-1")
  check("marcado como substituído, não apagado", a1?.substituidoEm != null && a1?.status === "RECEBIDO")
  check("a NECESSIDADE não se duplica — é a mesma nos dois", a1?.necessidadeId === b1?.necessidadeId)
  const nv2 = await novaViaDocumental(alvo)
  check("repetir o mesmo comando não cria uma terceira via",
    (nv2 as { criado: number; jaExistia: boolean }).criado === idB && (nv2 as { jaExistia: boolean }).jaExistia)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(H) O que o cadastro promete, a publicação cobra")
  // ══════════════════════════════════════════════════════════════
  const quebrado = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::wf2`, phaseKey: fase.phaseKey, name: "Quebrado", versao: 1, execucao: "SEQUENCIAL",
      passos: { create: [{ key: "x", label: "X", ordem: 1, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: ["fantasma"] }] },
    },
    select: { id: true, passos: { select: { id: true } } },
  })
  const p2 = await validarWorkflowParaPublicar(quebrado.id)
  check("workflow com dependência fantasma não passa", p2.some((x) => x.codigo === "DEPENDENCIA_INEXISTENTE"))
  await prisma.stepAction.create({ data: { stepId: quebrado.passos[0].id, key: "r", label: "R", effectKey: "GO_RETIFICATION", ordem: 1 } })
  const p3 = await validarWorkflowParaPublicar(quebrado.id)
  check("e ação fora da competência declarada da fase também não",
    p3.some((x) => x.codigo === "EFEITO_FORA_DE_COMPETENCIA"), JSON.stringify(p3.map((x) => x.codigo)))

  // ══════════════════════════════════════════════════════════════
  console.log("\n(I) A dependência é pré-condição: não se começa pelo fim")
  // ══════════════════════════════════════════════════════════════
  const { transicionarPassoTx, reabrirPassoTx } = await import("../src/services/task-step-sync")
  // `arquivar` depende de `preparar`, que está CONCLUIDO — pode abrir.
  const podeAbrir = await prisma.$transaction((tx) =>
    transicionarPassoTx(tx, siArquivar.id, "EM_ANDAMENTO", {
      correlationId: `${M}-dep1`, operacao: "teste", ciclo: 1, processoId: proc.id, workflowInstanceId: inst.id,
    }))
  check("com a dependência cumprida, a etapa abre", podeAbrir.changed, JSON.stringify(podeAbrir))

  // Agora `preparar` volta a estar aberto: `analisar` e `arquivar` dependem dele.
  // Os dois dependentes voltam a PENDENTE, que é o estado de quem espera — pedir
  // para abrir a partir daí é exatamente o gesto que a pré-condição precisa recusar
  // (de CONCLUIDO a máquina já recusaria por precedência, e provaria outra coisa).
  await prisma.phaseWorkflowStepInstance.update({ where: { id: siPreparar.id }, data: { status: "EM_ANDAMENTO", completedAt: null } })
  await prisma.phaseWorkflowStepInstance.updateMany({
    where: { id: { in: [siAnalisar.id, siArquivar.id] } },
    data: { status: "PENDENTE", completedAt: null },
  })
  const naoPodeAbrir = await prisma.$transaction((tx) =>
    transicionarPassoTx(tx, siAnalisar.id, "EM_ANDAMENTO", {
      correlationId: `${M}-dep2`, operacao: "teste", ciclo: 1, processoId: proc.id, workflowInstanceId: inst.id,
    }))
  check("COM A DEPENDÊNCIA EM ABERTO, A ETAPA NÃO ABRE",
    !naoPodeAbrir.changed && naoPodeAbrir.code === "DEPENDENCIA_PENDENTE", JSON.stringify(naoPodeAbrir))

  // Pela porta de REABERTURA: `arquivar` está concluída e `preparar`, de quem ela
  // depende, está aberto. Reabrir a sucessora sozinha é começar pelo fim.
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: siArquivar.id }, data: { status: "CONCLUIDO", completedAt: new Date("2026-08-01T12:00:00Z") },
  })
  const naoPodeReabrir = await prisma.$transaction((tx) =>
    reabrirPassoTx(tx, siArquivar.id, "EM_ANDAMENTO", {
      correlationId: `${M}-dep3`, operacao: "teste", ciclo: 1, processoId: proc.id, workflowInstanceId: inst.id,
    }))
  check("nem pela porta de reabertura — que escreve por conta própria",
    !naoPodeReabrir.changed && naoPodeReabrir.code === "DEPENDENCIA_PENDENTE", JSON.stringify(naoPodeReabrir))
  const aindaConcluida = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: siArquivar.id }, select: { status: true, completedAt: true } })
  check("e a recusa não deixou resíduo: a etapa continua concluída, com a data dela",
    aindaConcluida?.status === "CONCLUIDO" && aindaConcluida.completedAt?.toISOString() === "2026-08-01T12:00:00.000Z")

  const construindo = await prisma.$transaction((tx) =>
    transicionarPassoTx(tx, siAnalisar.id, "EM_ANDAMENTO", {
      correlationId: `${M}-dep4`, operacao: "materializacao", ciclo: 1, processoId: proc.id,
      workflowInstanceId: inst.id, ignorarDependencias: true,
    }))
  check("quem CONSTRÓI o roteiro declara que constrói, e passa", construindo.changed, JSON.stringify(construindo))

  // ══════════════════════════════════════════════════════════════
  console.log("\n(J) Os canais do runtime vêm do cadastro")
  // ══════════════════════════════════════════════════════════════
  const { canaisVigentes, faltamCamposDoCanalCadastrado } = await import("../src/lib/process-stage/canais-fonte")
  const { CANAIS_SOLICITACAO, faltamCamposDoCanal } = await import("../src/lib/process-stage/canais-solicitacao")
  await prisma.canalOperacional.createMany({
    data: CANAIS_SOLICITACAO.map((c, i) => ({
      key: c.canal, label: c.label, descricao: c.descricao, ordem: i + 1,
      protocoloObrigatorio: c.protocoloObrigatorio, anexoObrigatorioLabel: c.anexoObrigatorioLabel,
      rastreioObrigatorio: c.rastreioObrigatorio, observacaoObrigatoria: c.observacaoObrigatoria,
    })),
    skipDuplicates: true,
  })
  const doCadastro = await canaisVigentes(false)
  check("o cadastro responde, não a semente", doCadastro.every((c) => c.doCadastro))
  // SHADOW COMPARE: a validação pelo cadastro tem de dar exatamente a mesma resposta
  // que a lista em código dava — para cada canal, com o mesmo caso de entrada.
  let divergentes = 0
  for (const c of CANAIS_SOLICITACAO) {
    const entrada = { canal: c.canal, numeroProtocolo: null, anexoUrl: null, codigoRastreio: null, observacao: null, destinatarioNome: null }
    const antes = JSON.stringify(faltamCamposDoCanal(entrada).sort())
    const depois = JSON.stringify((await faltamCamposDoCanalCadastrado(entrada)).sort())
    if (antes !== depois) { divergentes++; console.log(`       ${c.canal}: código=${antes} cadastro=${depois}`) }
  }
  check("e dá EXATAMENTE a mesma resposta que a lista em código dava", divergentes === 0, `${divergentes} canal(is) divergente(s)`)
  const novoCanal = await prisma.canalOperacional.create({
    data: { key: "CC_SEM_DEPLOY", label: "Sem deploy", ordem: 50, protocoloObrigatorio: true },
    select: { key: true },
  })
  check("um canal cadastrado agora já é validado pelo runtime",
    (await faltamCamposDoCanalCadastrado({ canal: novoCanal.key, destinatarioNome: "X" })).includes("NUMERO_PROTOCOLO"))
  await prisma.canalOperacional.deleteMany({ where: { key: { in: [...CANAIS_SOLICITACAO.map((c) => c.canal), "CC_SEM_DEPLOY"] } } })

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
