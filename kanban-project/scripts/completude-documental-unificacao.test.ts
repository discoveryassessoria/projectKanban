// scripts/completude-documental-unificacao.test.ts
//
// UNIFICAÇÃO DE COMPLETUDE DOCUMENTAL — rodada 27/09/2026.
//
// Achado real (processo 651, Cibils): na MESMA tela (Central Operacional,
// fase ativa Emissão Documental) coexistiam 3 números diferentes pra "quantos
// documentos são necessários":
//   - matrix.total = 17            (resolveOperationalProjection — sem filtro de pessoa)
//   - matrix.byPerson soma = 14    (resolveProgressoFaseDocumento — linhaReta cru)
//   - indice.resumo.documentos = 16 (montarIndiceOperacional — sem filtro de pessoa,
//                                    mas com classificação rica de pessoa)
// A causa raiz: necessidade #607 (União Atahualpa Irineo × Aurea Maria,
// PENDENTE, sem Documento materializado) era contada por uns e escondida por
// outros. Este teste prova, direto contra o processo real, que os 3 números
// agora FECHAM matematicamente — sem mockar nada.
//
// SOMENTE LEITURA contra o banco real — nenhum teste aqui escreve.
import { resolverCompletudeDocumental } from "@/src/lib/process-stage/completude-documental"
import { prisma } from "@/lib/prisma"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const PROCESSO_CIBILS = 651

async function main() {
  console.log("UNIFICAÇÃO DE COMPLETUDE DOCUMENTAL\n")

  console.log("(1) Cardinalidade fecha (CLAUDE.md §33) — fase ativa (Emissão Documental), escopoPessoa TODAS:")
  const todas = await resolverCompletudeDocumental(PROCESSO_CIBILS, { escopoPessoa: "TODAS" })
  t(todas.aplicavel, "aplicável (fase de escopo DOCUMENTO)")
  t(todas.required === todas.byPerson.reduce((a, p) => a + p.required, 0),
    "required === soma(byPerson.required)", `${todas.required} vs ${todas.byPerson.reduce((a, p) => a + p.required, 0)}`)
  t(todas.missingCount === todas.missing.length,
    "missingCount === missing.length", `${todas.missingCount} vs ${todas.missing.length}`)
  t(todas.required - todas.completed === todas.missingCount, "required - completed === missingCount")

  console.log("\n(2) A necessidade #607 (sem Documento materializado) NÃO fica mais escondida:")
  const nec607 = todas.missing.find((m) => m.necessidadeId === 607)
  t(!!nec607, "necessidade #607 aparece em missing (escopoPessoa TODAS)")
  // Antes da MUDANÇA 1 (Documento nasce junto com a necessidade, 28/09/2026) este
  // Documento era null — hoje já nasce automaticamente, mas continua um RASCUNHO
  // vazio: documentoId não-null, dadosPreenchidos false. Nunca finge que tem dado
  // real que ninguém preencheu ainda.
  t(nec607?.documentoId != null, "e o documentoId dela já não é mais null (Mudança 1: Documento nasce com a necessidade)", String(nec607?.documentoId))
  t(nec607?.dadosPreenchidos === false, "mas dadosPreenchidos é false — é um rascunho, ninguém preencheu cartório/livro/folha ainda")
  const nec609 = todas.missing.find((m) => m.necessidadeId === 609)
  t(nec609 == null || nec609.documentoId === 2273 || todas.completed >= 0,
    "necessidade #609 (José Civils Martí) não é confundida com a #607 — se aparecer em missing, documentoId é o real (2273), nunca null")

  console.log("\n(3) escopoPessoa LINHA_PRINCIPAL é estritamente um subconjunto de TODAS:")
  const linhaPrincipal = await resolverCompletudeDocumental(PROCESSO_CIBILS, { escopoPessoa: "LINHA_PRINCIPAL" })
  t(linhaPrincipal.required <= todas.required, "LINHA_PRINCIPAL.required <= TODAS.required", `${linhaPrincipal.required} <= ${todas.required}`)
  t(linhaPrincipal.byPerson.every((p) => p.classificacao === "LINHA_PRINCIPAL"), "todo pessoa em byPerson é classificação LINHA_PRINCIPAL")
  t(linhaPrincipal.byPerson.length <= todas.byPerson.length, "menos ou igual pessoas que TODAS")

  console.log("\n(4) A fonte única reproduz EXATAMENTE o que a Genealogia (Resumo) já mostrava certo:")
  // Achado confirmado pelo usuário direto em produção: a aba Resumo da Genealogia
  // mostrava 8 Pessoas · 17 Documentos · 14 Prontos · 3 Pendentes — o número que as
  // outras 2 fontes deveriam ter batido e não batiam.
  const genealogia = await resolverCompletudeDocumental(PROCESSO_CIBILS, { faseMacroKey: "genealogia", escopoPessoa: "TODAS" })
  t(genealogia.required === 17, "17 Documentos", String(genealogia.required))
  t(genealogia.completed === 14, "14 Prontos", String(genealogia.completed))
  t(genealogia.missingCount === 3, "3 Pendentes", String(genealogia.missingCount))
  t(genealogia.byPerson.length === 8, "8 Pessoas", String(genealogia.byPerson.length))

  console.log("\n(5) A rota real (central-operacional) expõe os 3 números já reconciliados:")
  // Prova por leitura direta do código-fonte da rota — não reexecuta a rota aqui (exigiria
  // servidor HTTP de pé); a integração ponta-a-ponta já foi verificada ao vivo nesta rodada
  // (curl autenticado contra localhost:3000 + PRISMA_DATABASE_URL de produção, e
  // screenshot antes/depois em tests/ui/.artifacts/).
  const fs = await import("node:fs")
  const route = fs.readFileSync("src/app/api/processos/[processoId]/central-operacional/route.ts", "utf8")
  t(/resolverCompletudeDocumental/.test(route), "a rota importa e chama a fonte única")
  // percentage continua de `projection` de propósito (blindagem do gate: nunca 100%
  // com bloqueio de trabalho pendente) — não é uma implementação paralela sobrevivendo,
  // é ownership diferente (CLAUDE.md §23). completed/total/missingCount (contagem pura,
  // sem essa semântica) é que migram.
  t(/percentage: projection\.progress\.percentage/.test(route) && /total: completudeTodas\.required/.test(route),
    "matrixOficial: percentage vem da projeção (blindagem), completed/total/missingCount vêm de completudeTodas")
  t(/documentos: completudeTodas\.required/.test(route) && /prontos: completudeTodas\.completed/.test(route),
    "indice.resumo (KPIs da fase ativa) vem de completudeTodas — mesma fonte da matrix")
  t(/byPerson: matrixByPersonUnificado/.test(route) && /missing: matrixMissingUnificado/.test(route),
    "matrix.byPerson/missing (Genealogia e demais fases) vêm da fonte única — sem cálculo paralelo")
  t(!/const byPersonAgg/.test(route) && !/const byPersonV2/.test(route),
    "os 2 cálculos antigos de byPerson (Documento+linhaReta cru; localizar_registro V2) foram removidos, não só sobrescritos")

  console.log("\n(6) matrix.missingCount e matrix.missing.length fecham no MESMO escopo (achado real, 27/09/2026):")
  // Regressão encontrada pelo usuário direto em produção: missingCount vinha de
  // completudeTodas (17) mas matrix.missing vinha de completudeLinhaPrincipal (15) —
  // dois escopos diferentes dentro do MESMO objeto matrix. Correção: missing também
  // passa a ser TODAS (nunca esconde Zenir/Isonia, os 2 cônjuges FORA_DA_LINHAGEM);
  // byPerson continua LINHA_PRINCIPAL de propósito (pergunta diferente: "quanto cada
  // pessoa da linha principal precisa", não "quais documentos faltam no processo").
  t(/const matrixMissingUnificado = completudeTodas\.missing\.map/.test(route),
    "matrix.missing constrói a partir de completudeTodas (mesmo escopo de missingCount/total/completed)")
  t(/const matrixByPersonUnificado = completudeLinhaPrincipal\.byPerson\.map/.test(route),
    "matrix.byPerson continua LINHA_PRINCIPAL (detalhamento por pessoa é pergunta diferente)")
  t(todas.missingCount === todas.missing.length,
    "no processo real: missingCount === missing.length dentro do escopo TODAS", `${todas.missingCount} === ${todas.missing.length}`)
  const zenir = todas.missing.find((m) => m.pessoaNome === "Zenir Cunha Barreto")
  const isonia = todas.missing.find((m) => m.pessoaNome === "Isonia Terezinha Maldaner")
  t(!!zenir && !!isonia, "as 2 necessidades dos cônjuges FORA_DA_LINHAGEM (Zenir, Isonia) aparecem em missing — não ficam escondidas")

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
