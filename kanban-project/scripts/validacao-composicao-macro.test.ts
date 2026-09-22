// scripts/validacao-composicao-macro.test.ts
// ============================================================================
// VALIDAÇÕES DE PUBLICAÇÃO do Workflow Macro — positivos e negativos
// (mandato "Catálogo de Fases", 20/09/2026, continuação).
//
// Lógica pura (src/lib/motor/validar-composicao-macro.ts) + integração real
// contra PUT /api/gerenciamento/workflow-macro/[id].
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/validacao-composicao-macro.test.ts
// ============================================================================
import {
  validarFormatoPhaseKey,
  validarCondicaoValida,
  validarFimGarantido,
  validarTipoProcesso,
  validarComposicaoMacro,
} from "../src/lib/motor/validar-composicao-macro"
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { signAuthToken } from "../lib/auth-jwt"
import { NextRequest } from "next/server"
import { PUT as putWorkflowMacro } from "../src/app/api/gerenciamento/workflow-macro/[id]/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// ══════════════════════════════════════════════════════════════════════════
secao("1) Formato de código — positivo e negativo")
// ══════════════════════════════════════════════════════════════════════════
ok("1.1) 'genealogia' é aceito", validarFormatoPhaseKey("genealogia") === null)
ok("1.2) 'retificacao_registros' (com _) é aceito", validarFormatoPhaseKey("retificacao_registros") === null)
ok("1.3) 'TESTEVIS_fase' (maiúscula) é RECUSADO", validarFormatoPhaseKey("TESTEVIS_fase")?.codigo === "CODIGO_INVALIDO_NAO_NORMALIZADO")
ok("1.4) '1_fase' (começa com número) é RECUSADO", validarFormatoPhaseKey("1_fase")?.codigo === "CODIGO_INVALIDO_NAO_NORMALIZADO")
ok("1.5) 'fase com espaço' é RECUSADO", validarFormatoPhaseKey("fase com espaço")?.codigo === "CODIGO_INVALIDO_NAO_NORMALIZADO")
ok("1.6) 'fase-com-traco' é RECUSADO", validarFormatoPhaseKey("fase-com-traco")?.codigo === "CODIGO_INVALIDO_NAO_NORMALIZADO")

// ══════════════════════════════════════════════════════════════════════════
secao("2) Condição válida — obrigatória×condicional")
// ══════════════════════════════════════════════════════════════════════════
ok("2.1) obrigatória e não-condicional: aceita", validarCondicaoValida({ phaseKey: "a", required: true, conditional: false }) === null)
ok("2.2) opcional e condicional: aceita", validarCondicaoValida({ phaseKey: "a", required: false, conditional: true }) === null)
ok("2.3) obrigatória E condicional ao mesmo tempo: RECUSADA (contraditório)",
  validarCondicaoValida({ phaseKey: "a", required: true, conditional: true })?.codigo === "CONDICAO_INVALIDA")

// ══════════════════════════════════════════════════════════════════════════
secao("3) Fim garantido — a última fase precisa ser obrigatória e não-condicional")
// ══════════════════════════════════════════════════════════════════════════
ok("3.1) composição terminando em obrigatória/não-condicional: aceita",
  validarFimGarantido([{ phaseKey: "a", required: true, conditional: false }, { phaseKey: "finalizado", required: true, conditional: false }]) === null)
ok("3.2) composição terminando em CONDICIONAL: RECUSADA (sem desfecho garantido)",
  validarFimGarantido([{ phaseKey: "a", required: true, conditional: false }, { phaseKey: "retificacao", required: false, conditional: true }])?.codigo === "FASE_FINAL_SEM_DESFECHO_GARANTIDO")
ok("3.3) composição vazia: sem problema (nada a terminar)", validarFimGarantido([]) === null)

// ══════════════════════════════════════════════════════════════════════════
secao("4) Tipo de processo — ausente/inativo/arquivado")
// ══════════════════════════════════════════════════════════════════════════
ok("4.1) tipo ativo e não arquivado: aceito", validarTipoProcesso({ id: 1, ativo: true, arquivado: false }) === null)
ok("4.2) tipo ausente (null): RECUSADO", validarTipoProcesso(null)?.codigo === "TIPO_PROCESSO_AUSENTE")
ok("4.3) tipo arquivado: RECUSADO", validarTipoProcesso({ id: 1, ativo: true, arquivado: true })?.codigo === "TIPO_PROCESSO_INCOMPATIVEL")
ok("4.4) tipo inativo: RECUSADO", validarTipoProcesso({ id: 1, ativo: false, arquivado: false })?.codigo === "TIPO_PROCESSO_INCOMPATIVEL")

// ══════════════════════════════════════════════════════════════════════════
secao("5) validarComposicaoMacro — agregação (todos os problemas de uma vez, nunca só o primeiro)")
// ══════════════════════════════════════════════════════════════════════════
const problemasMultiplos = validarComposicaoMacro(
  [
    { phaseKey: "OK_fase", required: true, conditional: true }, // 2 problemas: formato + condição
    { phaseKey: "condicional_final", required: false, conditional: true },
  ],
  null, // tipo ausente
)
ok("5.1) acumula TODOS os problemas (não para no primeiro)", problemasMultiplos.length >= 4, `${problemasMultiplos.length}: ${problemasMultiplos.map((p) => p.codigo).join(", ")}`)
ok("5.2) inclui TIPO_PROCESSO_AUSENTE", problemasMultiplos.some((p) => p.codigo === "TIPO_PROCESSO_AUSENTE"))
ok("5.3) inclui CODIGO_INVALIDO_NAO_NORMALIZADO", problemasMultiplos.some((p) => p.codigo === "CODIGO_INVALIDO_NAO_NORMALIZADO"))
ok("5.4) inclui CONDICAO_INVALIDA", problemasMultiplos.some((p) => p.codigo === "CONDICAO_INVALIDA"))
ok("5.5) inclui FASE_FINAL_SEM_DESFECHO_GARANTIDO", problemasMultiplos.some((p) => p.codigo === "FASE_FINAL_SEM_DESFECHO_GARANTIDO"))

const composicaoValida = validarComposicaoMacro(
  [
    { phaseKey: "genealogia", required: true, conditional: false },
    { phaseKey: "retificacao_registros", required: false, conditional: true },
    { phaseKey: "finalizado", required: true, conditional: false },
  ],
  { id: 1, ativo: true, arquivado: false },
)
ok("5.6) composição válida não acusa NENHUM problema", composicaoValida.length === 0, JSON.stringify(composicaoValida))

// ══════════════════════════════════════════════════════════════════════════
secao("6) Integração real — PUT /workflow-macro/[id] recusa composição inválida")
// ══════════════════════════════════════════════════════════════════════════
const MARCA = "VALCOMP"
const MARCA_MINUSCULA = "valcomp"
async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipos.map((t) => t.id) } }, select: { id: true } })
  await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@valcomp.test" } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA_MINUSCULA } } })
}

async function integrar() {
  exigirBancoDeTeste("integração das validações de composição do Workflow Macro")
  await limpar()

  const admin = await prisma.usuario.create({ data: { nome: "Admin ValComp", email: "admin@valcomp.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: "admin@valcomp.test", tipo: "admin", sessaoInicio: Date.now() })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País ValComp", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade ValComp" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  for (const phaseKey of [`${MARCA_MINUSCULA}_a`, `${MARCA_MINUSCULA}_b`, `${MARCA_MINUSCULA}_fim`]) {
    await prisma.catalogoFase.create({ data: { phaseKey, label: phaseKey, escopo: "PROCESSO", requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA" } })
  }

  const chamar = (fases: unknown[]) => {
    const req = new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${macro.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fases }),
    })
    return putWorkflowMacro(req, { params: Promise.resolve({ id: String(macro.id) }) })
  }

  const rInvalida = await chamar([
    { phaseKey: `${MARCA_MINUSCULA}_a`, label: "A", required: true, conditional: false },
    { phaseKey: `${MARCA_MINUSCULA}_b`, label: "B", required: false, conditional: true }, // termina condicional
  ])
  ok("6.1) composição terminando em condicional é RECUSADA pela rota (422)", rInvalida.status === 422, String(rInvalida.status))
  const corpoInvalido = await rInvalida.json()
  ok("6.2) o código de erro é COMPOSICAO_INVALIDA", corpoInvalido.code === "COMPOSICAO_INVALIDA", JSON.stringify(corpoInvalido))

  const semFases = await prisma.faseMacro.count({ where: { macroWorkflowId: macro.id } })
  ok("6.3) NADA foi escrito — recusa é antes da transação", semFases === 0, `${semFases}`)

  const rValida = await chamar([
    { phaseKey: `${MARCA_MINUSCULA}_a`, label: "A", required: true, conditional: false },
    { phaseKey: `${MARCA_MINUSCULA}_fim`, label: "Fim", required: true, conditional: false },
  ])
  ok("6.4) composição válida é ACEITA (200)", rValida.status === 200, String(rValida.status))
  const comFases = await prisma.faseMacro.count({ where: { macroWorkflowId: macro.id } })
  ok("6.5) as 2 fases foram gravadas", comFases === 2, `${comFases}`)

  await limpar()
}

integrar()
  .then(() => {
    console.log(`\n${passou} ok, ${falhou} falhas`)
    if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  })
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
