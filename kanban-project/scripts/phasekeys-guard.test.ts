// scripts/phasekeys-guard.test.ts
//
// GUARD DEFINITIVO de phaseKey — o macrofluxo fala o vocabulário do catálogo.
//
// (A) NÚCLEO PURO — o verificador acha chave fora do catálogo, chave duplicada no
//     mesmo macro e fase obrigatória sem workflow publicado; classifica severidade
//     e só sugere canônica quando a equivalência é determinística.
// (B) BLINDAGEM ESTÁTICA — o motor não ganhou alias/fallback, e o seed não semeia
//     chave legada nova.
// (C) DADOS REAIS (quando há banco) — nenhuma pendência ALÉM das DECLARADAS.
//     Pendência conhecida vive no inventário abaixo, com motivo e SQL de correção;
//     qualquer registro fora dele quebra o build. É o mesmo padrão do guard de
//     referências: exceção existe, mas é NOMEADA — nunca silenciosa.
//
// Falha ⇒ quebra o build/CI.

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import {
  verificarPhaseKeys,
  phaseKeysCanonicas,
  EQUIVALENCIA_LEGADA,
  type FaseMacroParaVerificar,
} from "../src/lib/process-stage/verificar-phasekeys"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
// INVENTÁRIO DE PENDÊNCIAS DECLARADAS
// ------------------------------------------------------------
// Cadastro em produção que ainda não foi corrigido, com o motivo de não ter sido.
//
// Aqui só entra o que NÃO tem correção determinística. Erro com equivalência
// confirmada se corrige — não se inventaria. ALE-ADM, ESP-ADM, ITA-JUD e o
// CatalogoFase foram corrigidos em 04/08/2026 e saíram desta lista; a checagem
// abaixo (`sem exceção determinística`) impede que voltem a se esconder aqui.
//
// Cada linha é uma dívida VISÍVEL: enquanto estiver aqui, o guard passa; um
// registro novo fora daqui, não.
// ============================================================
interface PendenciaDeclarada {
  macroWorkflowId: number
  phaseKey: string
  faseMacroId: number
  motivo: string
  correcao: string
}
const PENDENCIAS_DECLARADAS: PendenciaDeclarada[] = [
  {
    macroWorkflowId: -1, phaseKey: "transcricoes", faseMacroId: 11,
    motivo:
      "CatalogoFase #11 'Transcrições' (ordem 20). Não tem correspondente no catálogo canônico e " +
      "não há equivalência determinística — corrigir seria inventar arquitetura. Nenhum MacroWorkflow " +
      "a utiliza hoje. Aguarda decisão: a fase é oficial (entra no catálogo) ou sai do cadastro.",
    correcao: "(sem correção automática — decisão arquitetural)",
  },
]
const declarada = (macroWorkflowId: number, phaseKey: string) =>
  PENDENCIAS_DECLARADAS.some((p) => p.macroWorkflowId === macroWorkflowId && p.phaseKey === phaseKey)

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

const modoLegado = verificarPhaseKeys({ ...ctxBase, fases: [], modosDeFase: [{ id: 1, phaseKey: "retificacao", key: "judicial", modeUid: "all::retificacao::judicial" }] })
check("modo de fase com chave legada é detectado", modoLegado.length === 1 && modoLegado[0].tipo === "MODO_DE_FASE_COM_CHAVE_LEGADA")
check("e sugere a canônica", modoLegado[0].canonicaSugerida === "retificacao_registros")

check("o mais grave vem primeiro",
  verificarPhaseKeys({ ...ctxBase, fases: [fase({ id: 1, phaseKey: "retificacao", required: false }), fase({ id: 2, phaseKey: "traducao", required: true, ordem: 2 })] })[0].severidade === "CRITICA")

// ============================================================
console.log("\n(B) Blindagem estática — sem alias, sem fallback, sem seed legado")
// ============================================================

const catalogo = read("src/lib/process-stage/fases-catalog.ts")
const phaseWorkflow = read("src/services/phase-workflow.ts")
const verificador = read("src/lib/process-stage/verificar-phasekeys.ts")
const corretor = read("scripts/corrigir-phasekeys-macro.ts")

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

// A equivalência legada existe em UM lugar (o verificador) e o corretor a espelha.
check("a equivalência legada vive só no verificador", verificador.includes("export const EQUIVALENCIA_LEGADA"))
check("o corretor usa exatamente o mesmo mapeamento",
  Object.entries(EQUIVALENCIA_LEGADA).every(([de, para]) => corretor.includes(`${de}: "${para}"`)) &&
  (corretor.match(/^\s{2}\w+: "/gm) ?? []).length === Object.keys(EQUIVALENCIA_LEGADA).length)
check("o corretor resolve o macro pelo código oficial, nunca por id fixo",
  corretor.includes('findUnique({ where: { code: TIPO_CODE }') && !/macroWorkflowId\s*=\s*\d+/.test(corretor))
check("o corretor valida 1 linha por UPDATE", corretor.includes("if (r.count !== 1) throw new ValidacaoFalhou"))
check("o corretor dá rollback quando a validação falha", corretor.includes("class ValidacaoFalhou") && corretor.includes("❌ ROLLBACK"))
check("o corretor não toca em processo, ciclo ou tarefa",
  !/(prisma|tx)\.(processo|phaseWorkflowInstance|phaseWorkflowStepInstance|tarefa)\.(update|updateMany|delete|deleteMany|create)/.test(corretor))

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
    console.log("\n(C) Cadastro real — nenhuma pendência além das DECLARADAS")

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
    const modosDb = await prisma.phaseInternalMode.findMany({ select: { id: true, phaseKey: true, key: true, modeUid: true }, orderBy: { id: "asc" } })

    const achados = verificarPhaseKeys({
      fases: fasesDb.map((f) => ({
        id: f.id, macroWorkflowId: f.macroWorkflowId, macroNome: f.macroWorkflow.name,
        tipoProcessoId: f.macroWorkflow.tipoProcessoId, tipoProcessoCode: f.macroWorkflow.tipoProcesso?.code ?? null,
        phaseKey: f.phaseKey, ordem: f.ordem, required: f.required,
      })),
      phaseKeysComWorkflow: new Set(wfs.map((w) => w.phaseKey)),
      processosPorTipo: new Map(processos.filter((p) => p.tipoProcessoMotorId != null).map((p) => [p.tipoProcessoMotorId as number, p._count._all])),
      catalogoFase: catalogoDb,
      modosDeFase: modosDb,
    })

    console.log(`   FaseMacro na base: ${fasesDb.length} · achados: ${achados.length}`)
    const naoDeclarados = achados.filter((a) => !declarada(a.macroWorkflowId, a.phaseKey))
    for (const a of achados) {
      const marca = declarada(a.macroWorkflowId, a.phaseKey) ? "declarado" : "NÃO DECLARADO"
      console.log(`   [${a.severidade}] macro ${a.macroWorkflowId} (${a.tipoProcessoCode}) "${a.phaseKey}" — ${a.tipo} · ${a.processosAfetados} processo(s) · ${marca}`)
      if (a.canonicaSugerida) console.log(`        → canônica: ${a.canonicaSugerida}`)
    }

    check("o ALE-ADM não tem NENHUM achado", !achados.some((a) => a.tipoProcessoCode === "ALE-ADM"),
      JSON.stringify(achados.filter((a) => a.tipoProcessoCode === "ALE-ADM")))
    check("nenhuma pendência fora do inventário declarado", naoDeclarados.length === 0,
      JSON.stringify(naoDeclarados.map((a) => ({ macro: a.macroWorkflowId, phaseKey: a.phaseKey, tipo: a.tipo }))))
    check("nenhuma phaseKey duplicada em macro nenhum", !achados.some((a) => a.tipo === "PHASEKEY_DUPLICADA_NO_MACRO"))
    // O inventário não é esconderijo: erro com equivalência CONFIRMADA tem correção
    // determinística e precisa ser corrigido, não declarado.
    const determinísticosEscondidos = achados.filter((a) => a.canonicaSugerida != null && declarada(a.macroWorkflowId, a.phaseKey))
    check("o inventário não abriga erro determinístico (corrigir ≠ declarar)",
      determinísticosEscondidos.length === 0,
      JSON.stringify(determinísticosEscondidos.map((a) => ({ macro: a.macroWorkflowId, phaseKey: a.phaseKey, canonica: a.canonicaSugerida }))))
    check("as chaves legadas sumiram do cadastro inteiro",
      !achados.some((a) => Object.keys(EQUIVALENCIA_LEGADA).includes(a.phaseKey)),
      JSON.stringify(achados.filter((a) => Object.keys(EQUIVALENCIA_LEGADA).includes(a.phaseKey))))
    // O inventário lista registros de PRODUÇÃO, por id. Contra um banco de teste esses
    // ids não existem, e cobrar "entrada morta" ali acusaria uma dívida que aquele
    // banco nunca teve. A verificação de higiene do inventário — impedir que ele
    // guarde exceção já resolvida — só faz sentido no dataset a que ele se refere.
    const ehDatasetDeProducao = await prisma.macroWorkflow.count({ where: { id: { in: [11, 14, 15] } } }) === 3
    if (ehDatasetDeProducao) {
      check("toda pendência declarada ainda existe (inventário sem entrada morta)",
        PENDENCIAS_DECLARADAS.every((p) => achados.some((a) => a.macroWorkflowId === p.macroWorkflowId && a.phaseKey === p.phaseKey)),
        JSON.stringify(PENDENCIAS_DECLARADAS.filter((p) => !achados.some((a) => a.macroWorkflowId === p.macroWorkflowId && a.phaseKey === p.phaseKey))))
    } else {
      console.log("   (inventário de pendências não conferido — este não é o dataset de produção)")
    }
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
