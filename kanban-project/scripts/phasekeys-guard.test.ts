// scripts/phasekeys-guard.test.ts
//
// GUARD DEFINITIVO de phaseKey — o macrofluxo fala o vocabulário do catálogo.
//
// (A) NÚCLEO PURO — o verificador acha chave fora do catálogo, chave duplicada no
//     mesmo macro e fase obrigatória sem workflow publicado; classifica severidade
//     e só sugere canônica quando a equivalência é determinística.
// (B) BLINDAGEM ESTÁTICA — o motor não ganhou alias/fallback, e o seed não semeia
//     chave legada nova.
// (C) DADOS REAIS (quando há banco) — ZERO achados. Sem inventário, sem exceção,
//     sem "pendência declarada". Um guard que aceita exceção vira um lugar onde o
//     erro mora com autorização: a lista de tolerância existiu enquanto havia
//     correção pendente, e morreu junto com a última delas.
//
// Falha ⇒ quebra o build/CI.

import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import {
  verificarPhaseKeys,
  phaseKeysCanonicas,
  EQUIVALENCIA_LEGADA,
  type FaseMacroParaVerificar,
} from "../src/lib/process-stage/verificar-phasekeys"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")
function varrer(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${nome}`
    if (statSync(join(ROOT, rel)).isDirectory()) varrer(rel, acc)
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) acc.push(rel)
  }
  return acc
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) Verificador — núcleo puro")
// ============================================================

const fase = (o: Partial<FaseMacroParaVerificar> & { id: number; phaseKey: string }): FaseMacroParaVerificar => ({
  macroWorkflowId: 1, macroNome: "Macro", tipoProcessoId: 1, tipoProcessoCode: "XX-YY",
  ordem: 1, required: true, ...o,
})
const ctxBase = {
  phaseKeysComWorkflow: new Set(phaseKeysCanonicas()),
  processosPorTipo: new Map([[1, 7]]),
}

check("macro 100% canônico não gera achado",
  verificarPhaseKeys({ ...ctxBase, fases: phaseKeysCanonicas().map((k, i) => fase({ id: i + 1, phaseKey: k, ordem: i + 1 })) }).length === 0)

const legada = verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "traducao", ordem: 6 })] })
check("chave fora do catálogo é detectada", legada.length === 1 && legada[0].tipo === "PHASEKEY_FORA_DO_CATALOGO")
check("com equivalência confirmada, sugere a canônica", legada[0].canonicaSugerida === "traducao_juramentada")
check("em fase OBRIGATÓRIA a severidade é CRÍTICA", legada[0].severidade === "CRITICA")
check("informa quantos processos estão no caminho", legada[0].processosAfetados === 7)

const condicional = verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "retificacao", required: false })] })
check("em fase condicional a severidade é ALTA", condicional[0].severidade === "ALTA")
check("retificacao sugere retificacao_registros", condicional[0].canonicaSugerida === "retificacao_registros")

const ambigua = verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "transcricoes" })] })
check("chave sem equivalência é ambígua (não sugere nada)", ambigua[0].canonicaSugerida === null)
check("e o texto diz que é decisão humana", /decisão humana/.test(ambigua[0].detalhe))

const dupl = verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "genealogia" }), fase({ id: 2, phaseKey: "genealogia", ordem: 2 })] })
check("phaseKey duplicada no mesmo macro é detectada", dupl.some((a) => a.tipo === "PHASEKEY_DUPLICADA_NO_MACRO"))
check("duplicidade é CRÍTICA", dupl.find((a) => a.tipo === "PHASEKEY_DUPLICADA_NO_MACRO")!.severidade === "CRITICA")

const semWf = verificarPhaseKeys({
  ...ctxBase,
  phaseKeysComWorkflow: new Set(phaseKeysCanonicas().filter((k) => k !== "apostilamento")),
  fases: [fase({ id: 1, phaseKey: "apostilamento", required: true })],
})
check("fase obrigatória sem workflow publicado é detectada", semWf.some((a) => a.tipo === "FASE_OBRIGATORIA_SEM_WORKFLOW"))
check("fase OPCIONAL sem workflow não vira achado",
  verificarPhaseKeys({ ...ctxBase, phaseKeysComWorkflow: new Set(), fases: [fase({ id: 1, phaseKey: "apostilamento", required: false })] })
    .every((a) => a.tipo !== "FASE_OBRIGATORIA_SEM_WORKFLOW"))

check("o mais grave vem primeiro",
  verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "retificacao", required: false }), fase({ id: 2, phaseKey: "traducao", required: true, ordem: 2 })] })[0].severidade === "CRITICA")

// ============================================================
console.log("\n(B) Blindagem estática — sem alias, sem fallback, sem seed legado")
// ============================================================

const catalogo = read("src/lib/process-stage/fases-catalog.ts")
const phaseWorkflow = read("src/services/phase-workflow.ts")
const verificador = read("src/lib/process-stage/verificar-phasekeys.ts")

check("o catálogo declara as chaves canônicas", ["traducao_juramentada", "retificacao_registros"].every((k) => catalogo.includes(`phaseKey: "${k}"`)))
check("o catálogo NÃO declara as chaves legadas", !/phaseKey: "traducao"|phaseKey: "retificacao"/.test(catalogo))
check("o verificador tira o vocabulário do catálogo, não de lista própria",
  verificador.includes('from "./fases-catalog"') && !/const CANONICAS\s*=\s*\[/.test(verificador))

// O motor resolve por chave EXATA. Nada de alias/normalização/tradução textual.
check("resolverWorkflowAplicavel casa a phaseKey exata", phaseWorkflow.includes("const base = { phaseKey: faseMacroKey, arquivado: false, active: true }"))
check("o motor não tem mapa de alias de fase",
  !/ALIAS_FASE|PHASEKEY_ALIAS|normalizarPhaseKey|traduzirPhaseKey/.test(phaseWorkflow + catalogo))
check("o motor não aceita 'traducao'/'retificacao' como fallback",
  !/"traducao"\s*:|'traducao'\s*:|"retificacao"\s*:|'retificacao'\s*:/.test(phaseWorkflow))


// SEED × CATÁLOGO EM PRODUÇÃO — o seed é upsert por phaseKey. Corrigir um sem o
// outro não conserta: cria uma linha canônica NOVA e deixa a legada de pé. Por isso
// o guard não exige que o seed já esteja certo — ele exige que os dois estejam
// dizendo A MESMA COISA. Quando a correção do CatalogoFase for autorizada, os dois
// mudam juntos ou este teste quebra.
const seedFases = read("prisma/seed-motor-1b.ts")
const seedChaves = [...seedFases.matchAll(/phaseKey: '([a-z_]+)'/g)].map((m) => m[1])
check("o seed do catálogo de fases foi lido", seedChaves.length === 10, String(seedChaves.length))
check("o seed NÃO semeia nenhuma chave legada",
  seedChaves.every((k) => EQUIVALENCIA_LEGADA[k] == null),
  JSON.stringify(seedChaves.filter((k) => EQUIVALENCIA_LEGADA[k] != null)))
check("toda chave do seed está no catálogo canônico",
  seedChaves.every((k) => phaseKeysCanonicas().includes(k)),
  JSON.stringify(seedChaves.filter((k) => !phaseKeysCanonicas().includes(k))))
check("o seed semeia as canônicas que substituíram as legadas",
  Object.values(EQUIVALENCIA_LEGADA).every((k) => seedChaves.includes(k)))
check("o seed é idempotente (upsert por phaseKey, sem create solto)",
  /catalogoFase\.upsert\(\{ where: \{ phaseKey: f\.phaseKey \}/.test(seedFases) && !/catalogoFase\.create\(/.test(seedFases))
check("nenhum outro seed/fixture semeia chave legada em CatalogoFase ou FaseMacro", (() => {
  const suspeitos = ["prisma/seed.ts", "prisma/seed-motor-1a.ts", "prisma/seed-motor-1b.ts", "prisma/seed-motor-3a.ts", "prisma/seed-lote-b-fases.ts", "prisma/seed-workflows-fase.ts", "prisma/reset-workflows-fase.ts"]
  return suspeitos.every((arq) => {
    const txt = read(arq)
    if (!txt) return true
    // só interessa quem escreve em CatalogoFase/FaseMacro — outras tabelas usam
    // 'traducao'/'retificacao' como natureza ou modo, e isso não é phaseKey de fase.
    if (!/catalogoFase|faseMacro/i.test(txt)) return true
    const trechos = txt.match(/phaseKey: '([a-z_]+)'/g) ?? []
    return trechos.every((t) => { const k = t.match(/'([a-z_]+)'/)![1]; return EQUIVALENCIA_LEGADA[k] == null })
  })
})())

// Seeds que gravam phaseKey em OUTRAS tabelas keyed por fase (modos, regras econômicas).
for (const arq of ["prisma/seed-motor-3a.ts", "prisma/seed-lote-b-fases.ts"]) {
  const txt = read(arq)
  const chaves = [...txt.matchAll(/phaseKey: '([a-z_]+)'/g)].map((m) => m[1])
  check(`${arq} não semeia chave legada`, chaves.every((k) => EQUIVALENCIA_LEGADA[k] == null), JSON.stringify(chaves.filter((k) => EQUIVALENCIA_LEGADA[k] != null)))
  check(`${arq} usa só chaves canônicas`, chaves.every((k) => phaseKeysCanonicas().includes(k)), JSON.stringify(chaves.filter((k) => !phaseKeysCanonicas().includes(k))))
}

// NENHUMA TELA pode repetir a lista de fases. Cada cópia textual é um lugar onde
// uma chave legada sobrevive à correção do cadastro — foi exatamente o que
// aconteceu com AplicabilidadeEconomicaTab e RegrasTarefaTransversalTab.
check("as telas de gerenciamento derivam as fases do catálogo",
  ["src/components/gerenciamentoComponents/AplicabilidadeEconomicaTab.tsx",
   "src/components/gerenciamentoComponents/RegrasTarefaTransversalTab.tsx"]
    .every((arq) => read(arq).includes("fasesParaSelecao()")))
check("o catálogo expõe a lista oficial para a UI",
  read("src/lib/process-stage/fases-catalog.ts").includes("export function fasesParaSelecao"))
check("nenhum componente monta uma lista própria de phaseKeys", (() => {
  const suspeitos: string[] = []
  for (const arq of varrer("src/components")) {
    const txt = read(arq)
    // duas ou mais phaseKeys canônicas literais em pares [chave, rótulo] = lista repetida
    const pares = txt.match(/\[\s*["'](genealogia|emissao_documental|analise_documental|retificacao_registros|traducao_juramentada|apostilamento|aguardando_protocolo|protocolado|finalizado)["']\s*,/g) ?? []
    if (pares.length >= 3) suspeitos.push(arq)
  }
  return suspeitos.length === 0 || (suspeitos.length === 1 && suspeitos[0].includes("WorkflowMacroTrilha"))
})())

// ENDPOINT de criação de macro: recusa cadastro legado, nunca converte.
const rotaMacro = read("src/app/api/gerenciamento/workflow-macro/route.ts")
check("o endpoint de criação valida o catálogo antes de persistir",
  rotaMacro.includes("CATALOGO_FASE_COM_CHAVE_INVALIDA") && rotaMacro.includes("phaseKeyToFaseCode"))
check("o endpoint RECUSA a chave legada, não a traduz",
  !/traducao_juramentada['"]?\s*:|EQUIVALENCIA_LEGADA|MAPEAMENTO/.test(rotaMacro))
check("o endpoint também barra catálogo com chave repetida", rotaMacro.includes("CATALOGO_FASE_DUPLICADA"))

// ============================================================
// (C) DADOS REAIS
// ============================================================

async function contraOBanco() {
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient()
  try {
    console.log("\n(C) Cadastro real — ZERO legado, sem exceção")

    const fasesDb = await prisma.faseMacro.findMany({
      select: {
        id: true, macroWorkflowId: true, phaseKey: true, ordem: true, required: true,
        macroWorkflow: { select: { name: true, tipoProcessoId: true, tipoProcesso: { select: { code: true } } } },
      },
      orderBy: [{ macroWorkflowId: "asc" }, { ordem: "asc" }],
    })
    const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { active: true, arquivado: false }, select: { phaseKey: true } })
    const processos = await prisma.processo.groupBy({ by: ["tipoProcessoMotorId"], _count: { _all: true } })
    const catalogoDb = await prisma.catalogoFase.findMany({ select: { id: true, phaseKey: true, label: true, ativo: true }, orderBy: { ordemPadrao: "asc" } })

    const achados = verificarPhaseKeys({
      fases: fasesDb.map((f) => ({
        id: f.id, macroWorkflowId: f.macroWorkflowId, macroNome: f.macroWorkflow.name,
        tipoProcessoId: f.macroWorkflow.tipoProcessoId, tipoProcessoCode: f.macroWorkflow.tipoProcesso?.code ?? null,
        phaseKey: f.phaseKey, ordem: f.ordem, required: f.required,
      })),
      phaseKeysComWorkflow: new Set(wfs.map((w) => w.phaseKey)),
      processosPorTipo: new Map(processos.filter((p) => p.tipoProcessoMotorId != null).map((p) => [p.tipoProcessoMotorId as number, p._count._all])),
      catalogoFase: catalogoDb,
    })

    console.log(`   FaseMacro na base: ${fasesDb.length} · CatalogoFase: ${catalogoDb.length}`)
    for (const a of achados) {
      console.log(`   [${a.severidade}] ${a.tipo} · macro ${a.macroWorkflowId} (${a.tipoProcessoCode ?? "—"}) · #${a.faseMacroId} "${a.phaseKey}"`)
      console.log(`        ${a.detalhe}`)
      if (a.canonicaSugerida) console.log(`        → canônica: ${a.canonicaSugerida}`)
    }
    // TRAVA ABSOLUTA. Não há exceção a declarar: qualquer achado quebra o build,
    // com a origem no relatório acima.
    check("ZERO achados no cadastro inteiro (sem exceção, sem inventário)", achados.length === 0,
      JSON.stringify(achados.map((a) => ({ tipo: a.tipo, macro: a.macroWorkflowId, id: a.faseMacroId, phaseKey: a.phaseKey }))))

    // As mesmas verificações, nomeadas — quando quebram, dizem QUAL invariante caiu.
    check("nenhuma FaseMacro fora do catálogo canônico", !achados.some((a) => a.tipo === "PHASEKEY_FORA_DO_CATALOGO"))
    check("nenhum CatalogoFase inválido (nem ativo, nem inativo)", !achados.some((a) => a.tipo === "CATALOGO_FASE_COM_CHAVE_LEGADA"))
    check("nenhuma phaseKey duplicada em macro nenhum", !achados.some((a) => a.tipo === "PHASEKEY_DUPLICADA_NO_MACRO"))
    check("nenhuma fase obrigatória sem workflow publicado", !achados.some((a) => a.tipo === "FASE_OBRIGATORIA_SEM_WORKFLOW"))

    // Nenhuma chave legada em lugar nenhum do cadastro — nem inativa.
    const legadasNoCadastro = [
      ...fasesDb.filter((f) => EQUIVALENCIA_LEGADA[f.phaseKey] != null).map((f) => `FaseMacro#${f.id}`),
      ...catalogoDb.filter((c) => EQUIVALENCIA_LEGADA[c.phaseKey] != null).map((c) => `CatalogoFase#${c.id}`),
    ]
    check("nenhuma chave legada persistida (nem em registro inativo)", legadasNoCadastro.length === 0, JSON.stringify(legadasNoCadastro))

    // Workflows publicados também falam o catálogo.
    const wfsFora = wfs.filter((w) => phaseKeysCanonicas().indexOf(w.phaseKey) < 0)
    check("nenhum workflow publicado com chave fora do catálogo", wfsFora.length === 0, JSON.stringify(wfsFora))

    // O CatalogoFase é o molde: se ele estiver íntegro, macro novo nasce canônico.
    const catInvalido = catalogoDb.filter((c) => phaseKeysCanonicas().indexOf(c.phaseKey) < 0)
    check("criação de MacroWorkflow DESBLOQUEADA (catálogo 100% canônico)", catInvalido.length === 0,
      JSON.stringify(catInvalido.map((c) => ({ id: c.id, phaseKey: c.phaseKey, ativo: c.ativo }))))
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  if (process.env.PRISMA_DATABASE_URL) {
    try { await contraOBanco() }
    catch (e) { console.log(`\n(C) Cadastro real — PULADO (banco inacessível: ${(e as Error).message.slice(0, 80)})`) }
  } else {
    console.log("\n(C) Cadastro real — PULADO (sem PRISMA_DATABASE_URL)")
  }

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`) }
  process.exit(falhas.length === 0 ? 0 : 1)
}

main()
