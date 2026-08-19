// scripts/cadastro-de-fases.test.ts
//
// A FASE NASCE NO CADASTRO, E O FLUXO SÓ A REFERENCIA.
//
// O cadastro mestre (`CatalogoFase`) já existia, com tela e RBAC. O que faltava para
// uma fase criada nele ser de fato utilizável era o ESCOPO — sobre qual entidade ela
// opera —, que vivia só no catálogo em código. Sem ele, o Workflow Macro recusava
// qualquer chave "fora do código", e uma fase nova era um registro decorativo.
//
// (A) GUARDAS ESTÁTICAS — a pergunta que o fluxo faz é "é utilizável?", não "está no
//     código?"; remover do fluxo não apaga o cadastro; a chave é imutável.
// (B) COMPORTAMENTO — banco real: criar, editar, inativar, compor, remover.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/cadastro-de-fases.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import {
  avaliarAptidaoDaFase, resolverEscopoDaFase, escopoCanonicoDaFase,
} from "../src/lib/process-stage/escopo-operacional-da-fase"
import { EQUIVALENCIA_LEGADA } from "../src/lib/process-stage/verificar-phasekeys"

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
console.log("\n(A) O fluxo pergunta se a fase é UTILIZÁVEL, não se está no código")
// ============================================================

const macro = semComentarios(read("src/app/api/gerenciamento/workflow-macro/route.ts"))
const macroId = semComentarios(read("src/app/api/gerenciamento/workflow-macro/[id]/route.ts"))
check("a criação do macro usa a aptidão da fase", macro.includes("avaliarAptidaoDaFase"))
check("e não recusa mais só por estar fora do catálogo em código",
  !macro.includes("phaseKeyToFaseCode(f.phaseKey) == null"))
check("a composição (adicionar/reordenar) faz a MESMA pergunta", macroId.includes("avaliarAptidaoDaFase"))

// REMOVER DO FLUXO ≠ EXCLUIR A FASE.
check("remover do fluxo apaga só a referência (FaseMacro)",
  macroId.includes("tx.faseMacro.deleteMany") && !macroId.includes("catalogoFase.delete"))
check("e a auditoria diz isso com todas as letras",
  macroId.includes("WORKFLOW_PHASE_REMOVED") && macroId.includes("O cadastro das fases não foi alterado"))
check("adicionar e reordenar são fatos distintos na auditoria",
  macroId.includes("WORKFLOW_PHASE_ADDED") && macroId.includes("WORKFLOW_PHASE_REORDERED"))

const cad = semComentarios(read("src/app/api/gerenciamento/catalogo-fases/route.ts"))
const cadId = semComentarios(read("src/app/api/gerenciamento/catalogo-fases/[id]/route.ts"))
// A chave é o vínculo com fluxos, workflows internos e runtime: o `data:` do update
// não pode conter `phaseKey` nem por engano.
const blocoUpdate = cadId.slice(cadId.indexOf("catalogoFase.update"), cadId.indexOf("const usos"))
check("a chave não entra no update (identidade imutável)", !blocoUpdate.includes("phaseKey:"),
  blocoUpdate.split("\n").filter((l) => l.includes("phaseKey")).join(" / "))
check("criar exige escopo", cad.includes("ESCOPO_OBRIGATORIO"))
check("criar recusa chave legada nomeando a canônica", cad.includes("CHAVE_LEGADA") && cad.includes("EQUIVALENCIA_LEGADA"))
check("mudar o escopo de fase EM USO é recusado", cadId.includes("ESCOPO_EM_USO"))
check("excluir fase em uso continua recusado", cadId.includes("Inative-a em vez de excluir"))
check("o cadastro audita criação, alteração e inativação",
  cad.includes("PHASE_CREATED") && cadId.includes("PHASE_UPDATED") && cadId.includes("PHASE_DISABLED"))

// RBAC — sem sistema paralelo: a mesma permissão administrativa das demais telas.
for (const [arq, txt] of [["catalogo-fases", cad], ["catalogo-fases/[id]", cadId], ["workflow-macro", macro], ["workflow-macro/[id]", macroId]] as const) {
  check(`${arq} exige permissão administrativa`, txt.includes("verificarPermissao(request, 'usuarios.gerenciar')"))
}

// A tela do compositor não virou CRUD: ela LINKA para o cadastro.
const tela = read("src/components/gerenciamentoComponents/MacroKanbanTab.tsx")
check("o Workflow Macro aponta para o cadastro em vez de criar fase", tela.includes('href="?screen=fases"'))
check("e continua sem criar fase por conta própria", !tela.includes("catalogo-fases"))
const nav = read("src/components/gerenciamentoComponents/managementNavigation.tsx")
check("o cadastro de fases continua existindo uma única vez na navegação",
  (nav.match(/a\(\d+, "fases"/g) ?? []).length === 1)

// O escopo canônico continua vindo do código para as fases do catálogo oficial.
check("genealogia opera sobre registro a localizar", escopoCanonicoDaFase("genealogia") === "NECESSIDADE")
check("emissão documental opera sobre documento", escopoCanonicoDaFase("emissao_documental") === "DOCUMENTO")
check("análise documental opera sobre o processo", escopoCanonicoDaFase("analise_documental") === "PROCESSO")
check("uma chave desconhecida não tem escopo em código", escopoCanonicoDaFase("fase_que_nao_existe") === null)

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
const CHAVE = "teste_de_fase"

async function limpar() {
  await prisma.faseMacro.deleteMany({ where: { phaseKey: CHAVE } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: CHAVE } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B1) A fase é criada no cadastro — sem código, sem migration")
  // ══════════════════════════════════════════════════════════════════════════
  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: CHAVE, label: "Teste de Fase",
      descricao: "Fase criada para teste de integração.",
      escopo: "PROCESSO", ordemPadrao: 99, requiredPadrao: true,
      conditionalPadrao: false, slaDiasPadrao: 10, ativo: true,
    },
  })
  check("a fase existe no cadastro", fase.id > 0)
  check("com descrição e escopo", fase.descricao != null && fase.escopo === "PROCESSO")
  check("a chave é única", await prisma.catalogoFase.count({ where: { phaseKey: CHAVE } }) === 1)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B2) E é APTA a compor um fluxo, sem estar no catálogo em código")
  // ══════════════════════════════════════════════════════════════════════════
  check("o código não a conhece", escopoCanonicoDaFase(CHAVE) === null)
  const apt = await avaliarAptidaoDaFase(CHAVE)
  check("mas o sistema a considera utilizável", apt.apta === true, JSON.stringify(apt))
  check("com o escopo que o cadastro declarou", apt.escopo === "PROCESSO")
  check("e o resolvedor devolve o mesmo escopo", (await resolverEscopoDaFase(CHAVE)) === "PROCESSO")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B3) Editar não muda a identidade")
  // ══════════════════════════════════════════════════════════════════════════
  const editada = await prisma.catalogoFase.update({
    where: { id: fase.id }, data: { label: "Teste de Fase (renomeada)" },
  })
  check("o id não mudou", editada.id === fase.id)
  check("a chave não mudou", editada.phaseKey === fase.phaseKey)
  check("o nome mudou", editada.label !== fase.label)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B4) Fases sem escopo e chaves legadas são recusadas — com motivo")
  // ══════════════════════════════════════════════════════════════════════════
  const semEscopo = await prisma.catalogoFase.create({
    data: { phaseKey: "teste_sem_escopo", label: "Sem escopo", ativo: true },
  })
  const aptSem = await avaliarAptidaoDaFase("teste_sem_escopo")
  check("fase sem escopo não é apta", aptSem.apta === false && aptSem.code === "SEM_ESCOPO")
  check("e o motivo diz o que fazer", (aptSem.motivo ?? "").includes("Defina o escopo"))
  await prisma.catalogoFase.delete({ where: { id: semEscopo.id } })

  const legada = Object.keys(EQUIVALENCIA_LEGADA)[0]
  const aptLeg = await avaliarAptidaoDaFase(legada)
  check(`a chave legada "${legada}" é recusada`, aptLeg.apta === false && aptLeg.code === "CHAVE_LEGADA")
  check("nomeando a canônica que deve ser usada", aptLeg.canonica === EQUIVALENCIA_LEGADA[legada], String(aptLeg.canonica))

  const aptInex = await avaliarAptidaoDaFase("fase_que_nunca_existiu")
  check("chave inexistente é recusada", aptInex.apta === false && aptInex.code === "INEXISTENTE")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B5) A ordem pertence ao FLUXO, não à fase")
  // ══════════════════════════════════════════════════════════════════════════
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ where: { ativo: true }, select: { id: true } })
  if (!tipo) { console.log("  (sem tipo de processo no banco de teste — parte do fluxo pulada)") }
  else {
    const macroWf = await prisma.macroWorkflow.upsert({
      where: { tipoProcessoId: tipo.id },
      update: {}, create: { tipoProcessoId: tipo.id, name: "Macro teste fases", versao: 1 },
      select: { id: true },
    })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macroWf.id } })
    // A MESMA fase em posições diferentes: é o que prova que a ordem não é dela.
    await prisma.faseMacro.create({ data: { macroWorkflowId: macroWf.id, phaseKey: "genealogia", label: "Genealogia", ordem: 1, versao: 1 } })
    const ref = await prisma.faseMacro.create({
      data: { macroWorkflowId: macroWf.id, phaseKey: CHAVE, label: editada.label, ordem: 2, versao: 1, required: true, conditional: false, slaDays: 10, showInKanban: true },
    })
    check("a fase entrou no fluxo por referência", ref.phaseKey === CHAVE)
    check("a ordem está na referência, não no cadastro", ref.ordem === 2 && editada.ordemPadrao === 99)

    await prisma.faseMacro.update({ where: { id: ref.id }, data: { ordem: 1 } })
    await prisma.faseMacro.updateMany({ where: { macroWorkflowId: macroWf.id, phaseKey: "genealogia" }, data: { ordem: 2 } })
    const cadastroDepois = await prisma.catalogoFase.findUnique({ where: { id: fase.id } })
    check("reordenar o fluxo não tocou no cadastro", cadastroDepois?.ordemPadrao === 99)

    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n(B6) Remover do fluxo NÃO apaga a fase")
    // ══════════════════════════════════════════════════════════════════════════
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macroWf.id, phaseKey: CHAVE } })
    const aindaExiste = await prisma.catalogoFase.findUnique({ where: { phaseKey: CHAVE } })
    check("a referência saiu do fluxo", (await prisma.faseMacro.count({ where: { macroWorkflowId: macroWf.id, phaseKey: CHAVE } })) === 0)
    check("e o cadastro canônico continua lá", aindaExiste != null)
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macroWf.id } })
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B7) Fase em uso não é destruída; inativar preserva o histórico")
  // ══════════════════════════════════════════════════════════════════════════
  const tipo2 = await prisma.tipoProcessoNacionalidade.findFirst({ where: { ativo: true }, select: { id: true } })
  if (tipo2) {
    const mw = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId: tipo2.id }, select: { id: true } })
    if (mw) await prisma.faseMacro.create({ data: { macroWorkflowId: mw.id, phaseKey: CHAVE, label: "Teste", ordem: 1, versao: 1 } })
    const usos = await prisma.faseMacro.count({ where: { phaseKey: CHAVE } })
    check("a fase consta como usada", usos > 0, String(usos))
    const inativa = await prisma.catalogoFase.update({ where: { phaseKey: CHAVE }, data: { ativo: false } })
    check("inativar não apaga", inativa.ativo === false && inativa.id === fase.id)
    check("e a referência no fluxo continua de pé (histórico intacto)",
      (await prisma.faseMacro.count({ where: { phaseKey: CHAVE } })) === usos)
    const ativas = await prisma.catalogoFase.findMany({ where: { ativo: true }, select: { phaseKey: true } })
    check("a fase inativa some do seletor de fases ativas", !ativas.some((f) => f.phaseKey === CHAVE))
    if (mw) await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: mw.id, phaseKey: CHAVE } })
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B8) O Workflow Interno referencia a identidade, não o nome")
  // ══════════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.upsert({
    where: { wfUid: `all::${CHAVE}` },
    update: { phaseKey: CHAVE },
    create: { wfUid: `all::${CHAVE}`, phaseKey: CHAVE, name: "WF da fase de teste", tipoProcessoId: null, versao: 1 },
    select: { id: true, phaseKey: true },
  })
  check("o workflow interno guarda a CHAVE da fase", wf.phaseKey === CHAVE)
  await prisma.catalogoFase.update({ where: { phaseKey: CHAVE }, data: { label: "Nome completamente diferente" } })
  const wfDepois = await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { phaseKey: true } })
  check("renomear a fase não quebra o vínculo", wfDepois?.phaseKey === CHAVE)
  await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B9) O catálogo em código vence o cadastro para as fases canônicas")
  // ══════════════════════════════════════════════════════════════════════════
  const genealogia = await prisma.catalogoFase.findUnique({ where: { phaseKey: "genealogia" }, select: { id: true, escopo: true } })
  if (genealogia) {
    await prisma.catalogoFase.update({ where: { id: genealogia.id }, data: { escopo: "PROCESSO" } })
    check("mesmo com o cadastro dizendo outra coisa, a canônica mantém o escopo do código",
      (await resolverEscopoDaFase("genealogia")) === "NECESSIDADE")
    await prisma.catalogoFase.update({ where: { id: genealogia.id }, data: { escopo: genealogia.escopo } })
  }

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
