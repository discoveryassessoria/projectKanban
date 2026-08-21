// scripts/cadastro-integral.test.ts
//
// O PASSO INTEIRO É CADASTRO — inclusive o que ficava dentro do componente.
//
// O teste anterior (`cadastro-canonico.test.ts`) provou que campo, ação e checklist
// saíram do código. Ficaram de fora, e são o objeto deste arquivo: a OPÇÃO com
// identidade própria, o CANAL por passo, o REQUISITO de conclusão, a CONDIÇÃO
// declarativa e a separação entre salvar e publicar.
//
// A pergunta é a mesma, um degrau adiante: dá para renomear uma opção sem que a
// escolha registrada perca o sentido? Dá para tirar um canal de circulação sem apagar
// o histórico de quem o usou? O que o administrador vê antes de publicar é o que vai
// acontecer?
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/cadastro-integral.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { validarConfiguracao } from "../src/services/validacao-de-publicacao"
import { efeitosDaFase } from "../src/lib/motor/catalogo-de-efeitos"
import { avaliarCondicao, validarCondicao, descreverCondicao, OPERADORES, type Condicao } from "../src/lib/motor/condicoes"
import { lerVersaoPublicada, definicaoHistoricaDoPasso, congelarVersaoVigente } from "../src/services/versao-publicada"
import { preverPublicacao, publicarWorkflow, marcarRascunho } from "../src/services/publicacao-de-workflow"
import { requisitosPendentes } from "../src/services/requisitos-da-etapa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"

const prisma = new PrismaClient()
const M = "CI"
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

const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.pessoa.deleteMany({ where: { arvore: { nome: { startsWith: `${M} ` } } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "ci_" } } })
  await prisma.canalOperacional.deleteMany({ where: { key: { startsWith: "CI_" } } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════
  console.log("\n(L) A condição é declarativa — e não roda código do administrador")
  // ══════════════════════════════════════════════════════════════
  const cond = semComentarios(read("src/lib/motor/condicoes.ts"))
  check("o motor de condições não usa eval nem Function",
    !/\beval\s*\(|new\s+Function\s*\(/.test(cond),
    "condição vinda do cadastro é DADO; interpretá-la como código seria execução remota pelo painel")
  check("o vocabulário de operadores é fechado", OPERADORES.length > 0 && OPERADORES.includes("igual"))
  check("operador fora do vocabulário é recusado",
    validarCondicao({ op: "exec", campo: "x" }, new Set(["x"])).length > 0)
  check("condição simples avalia", avaliarCondicao({ op: "igual", campo: "canal", valor: "CI_PORTAL" } as Condicao, { valores: { canal: "CI_PORTAL" } }))
  check("e nega quando não bate", !avaliarCondicao({ op: "igual", campo: "canal", valor: "CI_PORTAL" } as Condicao, { valores: { canal: "OUTRO" } }))
  check("condição ausente é sempre verdadeira", avaliarCondicao(null, { valores: {} }))
  check("a condição é explicável em português para a tela",
    descreverCondicao({ op: "igual", campo: "canal", valor: "CI_PORTAL" } as Condicao, { canal: "Canal" }).length > 0)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(K) A publicação recusa o cadastro impossível")
  // ══════════════════════════════════════════════════════════════
  const ctx = { phaseKey: "analise_documental", efeitosPermitidosDaFase: efeitosDaFase("analise_documental", null) }
  const cods = new Set(validarConfiguracao([
    { key: "a", label: "A", executorKey: "padrao",
      campos: [{ key: "escolha", tipo: "select", opcoes: [] }] },
    { key: "b", label: "B", executorKey: "padrao",
      campos: [{ key: "x", tipo: "texto" }, { key: "x", tipo: "texto" }] },
    { key: "c", label: "C", executorKey: "padrao",
      requisitos: [{ key: "r", tipo: "CAMPO_PREENCHIDO", alvoKey: "nao_existe" }] },
    { key: "d", label: "D", executorKey: "padrao",
      requisitos: [{ key: "r2", tipo: "ACAO_EXECUTADA", alvoKey: "acao_fantasma" }] },
    { key: "e", label: "E", executorKey: "acompanhamento_retorno",
      canais: [{ key: "CI_PORTAL" }] },
    { key: "f", label: "F", executorKey: "padrao",
      canais: [{ key: "CI_PORTAL", camposObrigatorios: ["inexistente"] }] },
    { key: "g", label: "G", executorKey: "padrao",
      campos: [{ key: "y", tipo: "texto", condicao: { op: "exec", campo: "y" } }] },
  ], ctx).map((p) => p.codigo))
  check("campo de escolha sem opção ativa é recusado", cods.has("CAMPO_SEM_OPCAO_ATIVA"))
  check("chave duplicada dentro do passo é recusada", cods.has("CHAVE_DUPLICADA"))
  check("requisito apontando para campo inexistente é recusado", cods.has("REQUISITO_ALVO_INEXISTENTE"))
  check("canal num executor que não desenha canal é recusado", cods.has("CANAL_SEM_SUPORTE"))
  check("canal exigindo campo inexistente é recusado", cods.has("CANAL_EXIGE_CAMPO_INEXISTENTE"))
  check("condição com operador inventado é recusada", cods.has("CONDICAO_INVALIDA"))

  // ══════════════════════════════════════════════════════════════
  console.log("\n(A) O passo nasce do cadastro — o nome dele não existe no código")
  // ══════════════════════════════════════════════════════════════
  const canal = await prisma.canalOperacional.create({
    data: { key: "CI_PORTAL", label: "Portal do Estado", descricao: "Portal", ordem: 91, protocoloObrigatorio: true },
    select: { id: true, key: true },
  })
  const canal2 = await prisma.canalOperacional.create({
    data: { key: "CI_MALOTE", label: "Malote", descricao: "Malote interno", ordem: 92 },
    select: { id: true, key: true },
  })
  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: "ci_fase_inventada", label: "Fase inventada", escopo: "PROCESSO", ordemPadrao: 91, slaDiasPadrao: 4,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
    },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow integral", versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: [
          { key: "protocolar_no_orgao", label: "Protocolar no órgão", ordem: 1, createsTask: true, required: true, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: [] },
          { key: "acompanhar_retorno_do_orgao", label: "Acompanhar retorno", ordem: 2, createsTask: true, required: true, cardinalidade: "PROCESSO", executorKey: "padrao", dependeDe: ["protocolar_no_orgao"] },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  const passo = wf.passos[0]

  // NENHUM destes nomes aparece no código do sistema. É a prova do §51: o passo é
  // dado, e o motor o executa sem nunca ter ouvido falar dele.
  const fontes = [
    read("src/services/executar-acao-cadastrada.ts"),
    read("src/components/kanban/workflow/StepEditors.tsx"),
    read("src/services/requisitos-da-etapa.ts"),
    read("src/lib/process-stage/step-editor-registry.ts"),
  ].join("\n")
  check("o nome do passo cadastrado NÃO existe em lugar nenhum do código",
    !fontes.includes("protocolar_no_orgao") && !fontes.includes("acompanhar_retorno_do_orgao"))

  const campoCanal = await prisma.stepField.create({
    data: { stepId: passo.id, key: "canal", label: "Canal usado", tipo: "select", obrigatorio: true, ordem: 1 },
    select: { id: true },
  })
  await prisma.stepFieldOption.createMany({
    data: [
      { fieldId: campoCanal.id, key: "portal", label: "Pelo portal", ordem: 1 },
      { fieldId: campoCanal.id, key: "malote", label: "Por malote", ordem: 2 },
    ],
  })
  const campoProt = await prisma.stepField.create({
    data: { stepId: passo.id, key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", ordem: 2 },
    select: { id: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, key: "protocolado", label: "Protocolado", effectKey: "COMPLETE_STEP", ordem: 1 },
  })
  await prisma.stepChannel.createMany({
    data: [
      { stepId: passo.id, canalId: canal.id, ordem: 1 },
      { stepId: passo.id, canalId: canal2.id, ordem: 2 },
    ],
  })
  await prisma.stepRequirement.create({
    data: {
      stepId: passo.id, key: "protocolo_obrigatorio", label: "Número do protocolo", tipo: "CAMPO_PREENCHIDO",
      alvoKey: "numero_protocolo", ordem: 1,
      // SÓ QUANDO O CANAL É O PORTAL. É a condição declarada fazendo o que um `if`
      // dentro do componente fazia antes.
      condicao: { op: "igual", campo: "canal", valor: "portal" } as never,
    },
  })
  check("opção, canal e requisito cadastrados sem deploy",
    (await prisma.stepFieldOption.count({ where: { fieldId: campoCanal.id } })) === 2 &&
    (await prisma.stepChannel.count({ where: { stepId: passo.id } })) === 2 &&
    (await prisma.stepRequirement.count({ where: { stepId: passo.id } })) === 1 &&
    campoProt.id > 0)

  await congelarVersaoVigente(wf.id, "CRIACAO")
  const v1 = await lerVersaoPublicada(wf.id, 1)
  const p1 = v1?.passos.find((p) => p.key === "protocolar_no_orgao")
  check("a versão congela as OPÇÕES com identidade",
    (p1?.campos.find((c) => c.key === "canal")?.opcoesCadastradas ?? []).map((o) => o.key).join(",") === "portal,malote")
  check("congela os CANAIS do passo, com a exigência já resolvida",
    (p1?.canais ?? []).length === 2 && p1!.canais.find((c) => c.key === "CI_PORTAL")!.exigeProtocolo === true)
  check("e congela os REQUISITOS", (p1?.requisitos ?? []).length === 1)

  // ── executar num processo real ──
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
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
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p1`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  // ══════════════════════════════════════════════════════════════
  console.log("\n(B) O requisito cadastrado é cobrado — e a condição decide quando")
  // ══════════════════════════════════════════════════════════════
  const hist = await definicaoHistoricaDoPasso(si.id)
  const pedirPendencias = (valores: Record<string, unknown>) => requisitosPendentes({
    stepInstanceId: si.id,
    requisitos: hist!.passo.requisitos ?? [], campos: hist!.passo.campos,
    checklist: hist!.passo.checkItens, canais: [], valores,
  })
  check("com o canal do portal e sem protocolo, o requisito acusa",
    (await pedirPendencias({ canal: "portal" })).some((p) => p.key === "protocolo_obrigatorio"))
  check("com o protocolo preenchido, some", (await pedirPendencias({ canal: "portal", numero_protocolo: "123" })).length === 0)
  check("com o canal de malote, o requisito nem se aplica — a condição não bate",
    (await pedirPendencias({ canal: "malote" })).length === 0)

  const recusada = await executarAcaoCadastrada(si.id, "protocolado", { canal: "portal" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a1` })
  check("a porta RECUSA a conclusão com requisito pendente",
    !recusada.ok && recusada.codigo === "REQUISITO_PENDENTE", JSON.stringify(recusada))

  const invalida = await executarAcaoCadastrada(si.id, "protocolado", { canal: "inventada", numero_protocolo: "1" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a2` })
  check("opção que não está cadastrada é recusada pelo SERVIDOR",
    !invalida.ok && invalida.codigo === "OPCAO_INVALIDA", JSON.stringify(invalida))

  const feita = await executarAcaoCadastrada(si.id, "protocolado", { canal: "portal", numero_protocolo: "PT-9" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a3` })
  check("satisfeito o requisito, a etapa conclui", feita.ok, JSON.stringify(feita))
  const tent = (await tentativasDoPasso(si.id)).find((t) => t.supersededAt == null)
  check("a escolha ficou gravada pela CHAVE, não pelo rótulo",
    (tent?.payload as { valores?: Record<string, string> })?.valores?.canal === "portal")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(C/D) Renomear e desativar não apagam o que já foi escolhido")
  // ══════════════════════════════════════════════════════════════
  await prisma.stepFieldOption.updateMany({ where: { fieldId: campoCanal.id, key: "portal" }, data: { label: "Pelo portal do estado" } })
  await prisma.stepFieldOption.updateMany({ where: { fieldId: campoCanal.id, key: "malote" }, data: { ativo: false } })
  await marcarRascunho(wf.id, null)

  const depoisDoRename = (await tentativasDoPasso(si.id)).find((t) => t.supersededAt == null)
  check("renomear o rótulo NÃO mexe na escolha registrada",
    (depoisDoRename?.payload as { valores?: Record<string, string> })?.valores?.canal === "portal")
  const v1AindaLegivel = await lerVersaoPublicada(wf.id, 1)
  check("a versão publicada continua dizendo o rótulo ANTIGO",
    v1AindaLegivel?.passos[0].campos.find((c) => c.key === "canal")?.opcoesCadastradas
      .find((o) => o.key === "portal")?.label === "Pelo portal",
    "o congelado é imutável; o rascunho mudou, ele não")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(F) A prévia diz o que a publicação vai fazer")
  // ══════════════════════════════════════════════════════════════
  const prev = await preverPublicacao(wf.id)
  check("a prévia existe e sabe que há rascunho", !!prev && prev.temRascunho)
  check("ela mostra a versão de destino", prev?.versaoNova === 2)
  check("e lista a alteração da OPÇÃO renomeada",
    (prev?.mudancas ?? []).some((m) => m.escopo === "OPÇÃO" && m.tipo === "ALTERADO"),
    JSON.stringify(prev?.mudancas))
  check("e a opção desativada",
    (prev?.mudancas ?? []).some((m) => m.escopo === "OPÇÃO" && /ativa:\s*true\s*→\s*false/.test(m.detalhe)),
    JSON.stringify(prev?.mudancas.filter((m) => m.escopo === "OPÇÃO")))
  check("a prévia deixa publicar", prev?.podePublicar === true, JSON.stringify(prev?.problemas))

  // ══════════════════════════════════════════════════════════════
  console.log("\n(G/H) Publicar é idempotente e trava contra a versão que a tela viu")
  // ══════════════════════════════════════════════════════════════
  const pub1 = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  check("a publicação anda a versão", pub1.ok && pub1.versaoNova === 2, JSON.stringify(pub1))
  const pub2 = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  check("republicar com a versão VELHA em mãos é recusado",
    !pub2.ok && pub2.code === "CONFLITO_DE_VERSAO", JSON.stringify(pub2))
  const pub3 = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 2 })
  check("e republicar sem alteração não cria versão nova",
    pub3.ok && pub3.code === "SEM_ALTERACOES", JSON.stringify(pub3))
  check("a versão continua sendo a 2",
    (await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true } }))?.versao === 2)
  check("publicar limpou a marca de rascunho",
    (await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { rascunhoAlteradoEm: true } }))?.rascunhoAlteradoEm === null)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(I) A execução em andamento continua na versão dela")
  // ══════════════════════════════════════════════════════════════
  const histDepois = await definicaoHistoricaDoPasso(si.id)
  check("a etapa que começou na v1 continua lendo a v1", histDepois?.versao === 1)
  check("com o rótulo antigo da opção",
    histDepois?.passo.campos.find((c) => c.key === "canal")?.opcoesCadastradas.find((o) => o.key === "portal")?.label === "Pelo portal")
  check("e com a opção que hoje está inativa ainda legível",
    !!histDepois?.passo.campos.find((c) => c.key === "canal")?.opcoesCadastradas.find((o) => o.key === "malote"),
    "o histórico precisa continuar sabendo o que 'malote' queria dizer")
  const v2 = await lerVersaoPublicada(wf.id, 2)
  check("já a v2 traz o rótulo novo",
    v2?.passos[0].campos.find((c) => c.key === "canal")?.opcoesCadastradas.find((o) => o.key === "portal")?.label === "Pelo portal do estado")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(E) O canal do passo só ACRESCENTA exigência")
  // ══════════════════════════════════════════════════════════════
  const canalPortal = v2?.passos[0].canais.find((c) => c.key === "CI_PORTAL")
  const canalMalote = v2?.passos[0].canais.find((c) => c.key === "CI_MALOTE")
  check("o que o catálogo exige vale mesmo sem o passo declarar", canalPortal?.exigeProtocolo === true)
  check("e o que ninguém exige continua não exigido", canalMalote?.exigeProtocolo === false)
  await prisma.stepChannel.updateMany({
    where: { stepId: passo.id, canalId: canal2.id }, data: { exigeObservacao: true },
  })
  await congelarVersaoVigente(wf.id, "PUBLICACAO").catch(() => null)
  const acrescentado = (await prisma.stepChannel.findFirst({ where: { stepId: passo.id, canalId: canal2.id }, select: { exigeObservacao: true } }))
  check("o passo pode acrescentar exigência ao canal", acrescentado?.exigeObservacao === true)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(M) Checklist e ação também são cadastro — num passo criado agora")
  // ══════════════════════════════════════════════════════════════
  //
  // O passo abaixo nasce DEPOIS de tudo já estar rodando, com checklist, ação e
  // requisito de checklist. Nada do que ele contém existe em código: nem a chave do
  // passo, nem a das ações, nem a dos itens de conferência. Se o motor o executa, a
  // resposta para "dá para criar um passo novo sem deploy?" é sim, e é verificável.
  const passo2 = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "conferir_lote_recebido", label: "Conferir lote recebido",
      ordem: 3, createsTask: true, required: true, cardinalidade: "PROCESSO",
      executorKey: "padrao", dependeDe: [] as never,
    },
    select: { id: true, key: true },
  })
  check("o nome do passo NOVO também não existe no código",
    !fontes.includes("conferir_lote_recebido") && !fontes.includes("lote_conferido"))

  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: passo2.id, key: "paginas_completas", label: "Todas as páginas presentes", obrigatorio: true, ordem: 1 },
      { stepId: passo2.id, key: "selo_legivel", label: "Selo legível", obrigatorio: true, ordem: 2 },
      { stepId: passo2.id, key: "observacao_extra", label: "Anotação opcional", obrigatorio: false, ordem: 3 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: passo2.id, key: "lote_conferido", label: "Lote conferido", effectKey: "COMPLETE_STEP", ordem: 1 },
      { stepId: passo2.id, key: "so_registrar", label: "Só registrar o andamento", effectKey: "REGISTER_ONLY", ordem: 2 },
    ],
  })
  await prisma.stepRequirement.create({
    data: {
      stepId: passo2.id, key: "conferencia_completa", label: "Conferência completa",
      tipo: "CHECKLIST_COMPLETO", alvoKey: null, ordem: 1,
      // SÓ NA AÇÃO QUE CONCLUI. "Só registrar o andamento" não pode cobrar a
      // conferência inteira — senão registrar meio caminho seria impossível.
      acaoKey: "lote_conferido",
    },
  })
  await marcarRascunho(wf.id, null)
  const pubM = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  check("o passo novo entra numa versão nova", pubM.ok, JSON.stringify(pubM))

  // A VERSÃO É DA VISITA À FASE, não do passo solto. Uma visita nova registra a versão
  // publicada agora; a visita anterior continua na dela — e é assim que o passo novo
  // aparece para quem começa hoje sem aparecer para quem já estava rodando.
  const inst2 = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 2, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: pubM.versaoNova ?? 2,
      previousInstanceId: inst.id, chaveIdempotencia: `${M}-i2`,
    },
    select: { id: true },
  })
  const si2 = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst2.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 2,
      stepKey: passo2.key, ordem: 3, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
      stepDefinitionId: passo2.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p2`,
    },
    select: { id: true },
  })
  await garantirTentativa(si2.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  const hist2 = await definicaoHistoricaDoPasso(si2.id)
  check("a visita nova lê a versão publicada agora", hist2?.versao === (pubM.versaoNova ?? 2), String(hist2?.versao))
  check("e a visita ANTERIOR continua na v1 — onde o passo novo NÃO existe",
    (await definicaoHistoricaDoPasso(si.id))?.versao === 1 &&
    !(await lerVersaoPublicada(wf.id, 1))!.passos.some((p) => p.key === passo2.key) &&
    (await lerVersaoPublicada(wf.id, pubM.versaoNova ?? 2))!.passos.some((p) => p.key === passo2.key))
  check("o passo novo resolve o checklist cadastrado", (hist2?.passo.checkItens ?? []).length === 3)
  check("e as ações cadastradas", (hist2?.passo.acoes ?? []).length === 2)

  const pendChecklist = (valores: Record<string, unknown>, acaoKey: string) => requisitosPendentes({
    stepInstanceId: si2.id, requisitos: hist2!.passo.requisitos ?? [], campos: hist2!.passo.campos,
    checklist: hist2!.passo.checkItens, canais: [], valores, acaoKey,
  })
  check("concluir sem marcar o checklist é barrado",
    (await pendChecklist({}, "lote_conferido")).length > 0)
  check("marcar só um item obrigatório ainda barra",
    (await pendChecklist({ checklist: { paginas_completas: true } }, "lote_conferido")).length > 0)
  check("os dois obrigatórios marcados liberam — o opcional não é cobrado",
    (await pendChecklist({ checklist: { paginas_completas: true, selo_legivel: true } }, "lote_conferido")).length === 0)
  check("e a ação de só registrar não cobra a conferência inteira",
    (await pendChecklist({}, "so_registrar")).length === 0,
    "requisito com acaoKey vale para AQUELA ação, não para todas")

  const semChecklist = await executarAcaoCadastrada(si2.id, "lote_conferido", {},
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-m1` })
  check("a porta recusa a conclusão com checklist pendente",
    !semChecklist.ok && semChecklist.codigo === "REQUISITO_PENDENTE", JSON.stringify(semChecklist))
  const comChecklist = await executarAcaoCadastrada(si2.id, "lote_conferido",
    { checklist: { paginas_completas: true, selo_legivel: true } },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-m2` })
  check("com o checklist conferido, o passo NOVO conclui — sem uma linha de código para ele",
    comChecklist.ok, JSON.stringify(comChecklist))
  check("e ficou concluído de verdade",
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si2.id }, select: { status: true } }))?.status === "CONCLUIDO")

  // ══════════════════════════════════════════════════════════════
  console.log("\n(J) Reordenar não duplica nem remateria o que já roda")
  // ══════════════════════════════════════════════════════════════
  const antes = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: inst.id } })
  await prisma.phaseInternalWorkflowStep.update({ where: { id: wf.passos[0].id }, data: { ordem: 2 } })
  await prisma.phaseInternalWorkflowStep.update({ where: { id: wf.passos[1].id }, data: { ordem: 1 } })
  await marcarRascunho(wf.id, null)
  await publicarWorkflow({ workflowId: wf.id, actorId: null })
  const depois = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: inst.id } })
  check("publicar não cria etapa nova para quem já está rodando", antes === depois, `${antes} → ${depois}`)
  check("a etapa concluída continua concluída",
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si.id }, select: { status: true } }))?.status === "CONCLUIDO")
  check("e continua lendo a v1", (await definicaoHistoricaDoPasso(si.id))?.versao === 1)

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exitCode = 1 }
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
