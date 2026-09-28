// scripts/documento-nasce-com-necessidade.test.ts
//
// MUDANÇA 1 (Documento nasce junto com a necessidade) + MUDANÇA 2 (flag
// dadosPreenchidos), rodada 28/09/2026.
//
// Achado real que motivou as duas mudanças: a necessidade 607 (união, processo
// 651, Cibils) tinha a Tarefa #3827 em EM_ANDAMENTO desde 24/09 sem NENHUM
// Documento por trás — "iniciar a tarefa" e "abrir o editor Localizar registro"
// eram ações independentes, e só a segunda criava o Documento (que ninguém tinha
// feito ainda pra essa necessidade específica).
//
// ATENÇÃO: este teste EXECUTA `materializarGenealogia(651)` de verdade contra o
// banco de PRODUÇÃO (autorizado explicitamente pelo usuário nesta rodada — é a
// mesma função que já roda em todo POST/PUT/DELETE de pessoa/união em produção,
// aditiva e idempotente, nunca destrutiva). O bloco (4) prova que a MESMA função,
// chamada dentro de uma transação que sempre dá rollback (o padrão real de
// `simularImpactoPessoa`), não deixa nenhum Documento pra trás.
import { prisma } from "@/lib/prisma"
import { documentoTemDadosPreenchidos } from "@/src/lib/documentos/dados-preenchidos"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"
import { garantirDocumentoDaNecessidade } from "@/src/services/genealogia/operacao-necessidade"
import { resolverCompletudeDocumental } from "@/src/lib/process-stage/completude-documental"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const PROCESSO_CIBILS = 651
const NECESSIDADE_607 = 607

async function main() {
  console.log("MUDANÇA 1 + MUDANÇA 2 — Documento nasce com a necessidade / dadosPreenchidos\n")

  console.log("(1) documentoTemDadosPreenchidos — função pura:")
  t(documentoTemDadosPreenchidos(null) === false, "documento null → false")
  t(documentoTemDadosPreenchidos({ cartorio: null, livro: null, folha: null }) === false, "tudo null → false")
  t(documentoTemDadosPreenchidos({ cartorio: "X", livro: null, folha: null }) === false, "só cartório → false (parcial não conta)")
  t(documentoTemDadosPreenchidos({ cartorio: "X", livro: "1", folha: null }) === false, "cartório+livro sem folha → false")
  t(documentoTemDadosPreenchidos({ cartorio: "X", livro: "1", folha: "2" }) === true, "os 3 preenchidos → true")

  console.log("\n(2) dadosPreenchidos contra os Documentos reais do achado (processo 651):")
  const docs = await prisma.documento.findMany({
    where: { id: { in: [2260, 2261] } },
    select: { id: true, cartorio: true, livro: true, folha: true },
  })
  const d2260 = docs.find((d) => d.id === 2260)
  const d2261 = docs.find((d) => d.id === 2261)
  t(!!d2260 && documentoTemDadosPreenchidos(d2260) === true, "Documento #2260 (óbito, cartório/livro/folha reais) → true")
  t(!!d2261 && documentoTemDadosPreenchidos(d2261) === false, "Documento #2261 (nascimento, rascunho vazio) → false")

  console.log("\n(3) Documento nasce junto com a necessidade — rodando a materialização real (processo 651):")
  const necAntes = await prisma.necessidadeDocumental.findUnique({
    where: { id: NECESSIDADE_607 }, select: { id: true, documentos: { select: { id: true } } },
  })
  t(!!necAntes, "necessidade #607 existe")

  const r1 = await materializarGenealogia(PROCESSO_CIBILS)
  t(r1.pendencias.length === 0 || r1.pendencias.every((p) => !p.toLowerCase().includes("erro")), "materialização rodou sem erro", JSON.stringify(r1.pendencias))

  const necDepois = await prisma.necessidadeDocumental.findUnique({
    where: { id: NECESSIDADE_607 }, select: { id: true, documentos: { select: { id: true, cartorio: true, livro: true, folha: true } } },
  })
  t(!!necDepois && necDepois.documentos.length === 1, "necessidade #607 agora tem EXATAMENTE 1 Documento", String(necDepois?.documentos.length))
  t(!!necDepois && documentoTemDadosPreenchidos(necDepois.documentos[0] ?? null) === false, "e esse Documento está vazio (rascunho) — dadosPreenchidos=false, correto: ninguém preencheu dado real ainda")

  console.log("\n(3b) Idempotência — rodar de novo não duplica:")
  const r2 = await materializarGenealogia(PROCESSO_CIBILS)
  const necDepois2 = await prisma.necessidadeDocumental.findUnique({
    where: { id: NECESSIDADE_607 }, select: { documentos: { select: { id: true } } },
  })
  t(!!necDepois2 && necDepois2.documentos.length === 1 && necDepois2.documentos[0].id === necDepois!.documentos[0].id,
    "rodar a materialização de novo reusa o MESMO Documento, não cria um segundo", String(necDepois2?.documentos.length))
  t(r2.documentosCriados === 0, "2ª rodada: 0 Documentos criados (tudo reusado)", String(r2.documentosCriados))

  console.log("\n(4) Transação: dentro de um rollback (padrão simularImpactoPessoa), o Documento NÃO vaza pro banco:")
  // Testa `garantirDocumentoDaNecessidade` diretamente (a unidade que ganhou o
  // parâmetro `db`) em vez de `materializarGenealogia` inteira — materializar 1
  // processo inteiro contra o banco remoto de produção passa fácil do timeout de
  // transação interativa do Prisma; a função sozinha é rápida e é exatamente o que
  // este teste precisa provar: participa da tx do chamador, nunca abre uma segunda.
  const necSemDoc = await prisma.necessidadeDocumental.findFirst({
    where: { processoId: PROCESSO_CIBILS, documentos: { none: {} }, id: { not: NECESSIDADE_607 } },
    select: { id: true },
  })
  if (necSemDoc) {
    let docIdDentroDaTx: number | null = null
    try {
      await prisma.$transaction(async (tx) => {
        const { documentoId } = await garantirDocumentoDaNecessidade(PROCESSO_CIBILS, necSemDoc.id, tx)
        docIdDentroDaTx = documentoId
        throw new Error("ROLLBACK_PROPOSITAL_DO_TESTE")
      })
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "ROLLBACK_PROPOSITAL_DO_TESTE") throw e
    }
    t(docIdDentroDaTx != null, "dentro da transação, o Documento foi criado (visível na própria tx)", String(docIdDentroDaTx))
    const foraDaTx = await prisma.necessidadeDocumental.findUnique({ where: { id: necSemDoc.id }, select: { documentos: { select: { id: true } } } })
    t((foraDaTx?.documentos.length ?? 0) === 0, "depois do rollback, o Documento NÃO existe no banco (não vazou)", String(foraDaTx?.documentos.length))
  } else {
    console.log("  (pulado — nenhuma necessidade sem Documento sobrou no processo 651 pra testar o rollback sem mexer em dado real)")
  }

  console.log("\n(5) resolverCompletudeDocumental expõe dadosPreenchidos no missing[]:")
  const completude = await resolverCompletudeDocumental(PROCESSO_CIBILS, { escopoPessoa: "TODAS" })
  const item607 = completude.missing.find((m) => m.necessidadeId === NECESSIDADE_607)
  if (item607) {
    t(item607.documentoId != null, "missing[#607].documentoId não é mais null (tinha Documento agora)", String(item607.documentoId))
    t(item607.dadosPreenchidos === false, "missing[#607].dadosPreenchidos = false (rascunho vazio, honesto)")
  } else {
    console.log("  (#607 não está mais em missing — já deve ter sido atendida por outro caminho; não é falha deste teste)")
  }
  t(completude.missing.every((m) => typeof m.dadosPreenchidos === "boolean"), "todo item de missing[] tem dadosPreenchidos (boolean, nunca undefined)")

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
