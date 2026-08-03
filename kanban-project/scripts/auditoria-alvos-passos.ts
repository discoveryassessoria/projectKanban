// scripts/auditoria-alvos-passos.ts
//
// RELATÓRIO (somente leitura) dos ALVOS das instâncias de passo.
//
// A hierarquia da Central — pessoa → documento → workflow → passos — só se sustenta
// se cada instância souber, por ID, sobre QUE entidade ela opera. Este script mede
// isso na base antes de qualquer correção, porque corrigir sem medir é adivinhar.
//
// Ele NÃO escreve nada. NÃO cria documento, NÃO move tarefa, NÃO apaga instância.
// Casos ambíguos são LISTADOS para decisão, nunca resolvidos em silêncio.
//
//   npx tsx scripts/auditoria-alvos-passos.ts            # base do PRISMA_DATABASE_URL
//   npx tsx scripts/auditoria-alvos-passos.ts --detalhe  # lista os ids de cada caso

import { PrismaClient } from "@prisma/client"
import { FASES } from "../src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

const prisma = new PrismaClient()
const detalhe = process.argv.includes("--detalhe")

/** Escopo canônico da fase (fases-catalog): o que a instância DEVERIA carregar. */
const ESCOPO_DA_FASE = new Map<string, string>(
  Object.values(FASES).map((f) => [f.phaseKey, f.scope]),
)

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? ""
  console.log(`\nAUDITORIA DE ALVOS — base: ${url.replace(/:[^:@/]+@/, ":***@").slice(0, 80)}\n`)

  const instancias = await prisma.phaseWorkflowStepInstance.findMany({
    where: { status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
    select: {
      id: true, processoId: true, faseMacroKey: true, stepKey: true, stepDefinitionId: true,
      ciclo: true, pessoaId: true, necessidadeId: true, documentoId: true, chaveIdempotencia: true,
    },
  })
  console.log(`Instâncias ativas analisadas: ${instancias.length}`)

  const semAlvo: typeof instancias = []
  const faseDocumentalSemEntidade: typeof instancias = []
  const duplicadas: string[] = []
  const vistos = new Map<string, number>()

  for (const s of instancias) {
    const temAlvo = s.pessoaId != null || s.necessidadeId != null || s.documentoId != null
    const escopoDaFase = ESCOPO_DA_FASE.get(s.faseMacroKey) ?? null

    if (!temAlvo) {
      semAlvo.push(s)
      // Fase declarada por-entidade sem entidade na instância: é o caso que faria a
      // tela mostrar trabalho "da fase" onde deveria haver trabalho de um documento.
      if (escopoDaFase === "NECESSIDADE" || escopoDaFase === "DOCUMENTO") faseDocumentalSemEntidade.push(s)
    }

    const alvo =
      s.necessidadeId != null ? `n${s.necessidadeId}`
      : s.documentoId != null ? `d${s.documentoId}`
      : s.pessoaId != null ? `p${s.pessoaId}`
      : "processo"
    const identidade = `${s.processoId}|${s.faseMacroKey}|${s.stepDefinitionId ?? s.stepKey}|${alvo}|${s.ciclo}`
    const anterior = vistos.get(identidade)
    if (anterior != null) duplicadas.push(`${identidade} → #${anterior} e #${s.id}`)
    else vistos.set(identidade, s.id)
  }

  // PERTENCIMENTO: o alvo da instância pertence ao MESMO processo dela?
  const necIds = [...new Set(instancias.map((s) => s.necessidadeId).filter((x): x is number => x != null))]
  const docIds = [...new Set(instancias.map((s) => s.documentoId).filter((x): x is number => x != null))]
  const [necs, docs] = await Promise.all([
    necIds.length ? prisma.necessidadeDocumental.findMany({ where: { id: { in: necIds } }, select: { id: true, processoId: true, pessoaId: true, uniaoId: true } }) : [],
    docIds.length ? prisma.documento.findMany({ where: { id: { in: docIds } }, select: { id: true, pessoaId: true, necessidadeId: true } }) : [],
  ])
  const necMap = new Map(necs.map((n) => [n.id, n]))
  const docMap = new Map(docs.map((d) => [d.id, d]))

  const alvoDeOutroProcesso = instancias.filter(
    (s) => s.necessidadeId != null && necMap.get(s.necessidadeId) != null && necMap.get(s.necessidadeId)!.processoId !== s.processoId,
  )
  const alvoInexistente = instancias.filter(
    (s) => (s.necessidadeId != null && !necMap.has(s.necessidadeId)) || (s.documentoId != null && !docMap.has(s.documentoId)),
  )
  const necSemSujeito = instancias.filter(
    (s) => s.necessidadeId != null && necMap.get(s.necessidadeId) != null &&
      necMap.get(s.necessidadeId)!.pessoaId == null && necMap.get(s.necessidadeId)!.uniaoId == null,
  )

  const linha = (rotulo: string, n: number) =>
    console.log(`  ${n === 0 ? "✅" : "⚠️ "} ${rotulo}: ${n}`)

  console.log("\nRESULTADO")
  linha("instâncias sem alvo (escopo PROCESSO — legítimo se a fase é por processo)", semAlvo.length)
  linha("instâncias de fase POR-ENTIDADE sem entidade vinculada", faseDocumentalSemEntidade.length)
  linha("instâncias duplicadas (mesma definição + alvo + ciclo)", duplicadas.length)
  linha("instâncias cujo alvo pertence a OUTRO processo", alvoDeOutroProcesso.length)
  linha("instâncias cujo alvo não existe mais", alvoInexistente.length)
  linha("necessidades-alvo sem pessoa nem união (sujeito indeterminado)", necSemSujeito.length)

  if (detalhe) {
    const dump = (rotulo: string, ids: number[]) => {
      if (ids.length === 0) return
      console.log(`\n${rotulo} (${ids.length}):`)
      console.log(`  ${ids.slice(0, 200).join(", ")}${ids.length > 200 ? " …" : ""}`)
    }
    dump("stepInstanceIds de fase por-entidade SEM entidade", faseDocumentalSemEntidade.map((s) => s.id))
    dump("stepInstanceIds com alvo de outro processo", alvoDeOutroProcesso.map((s) => s.id))
    dump("stepInstanceIds com alvo inexistente", alvoInexistente.map((s) => s.id))
    dump("stepInstanceIds com necessidade sem sujeito", necSemSujeito.map((s) => s.id))
    if (duplicadas.length) {
      console.log(`\nDuplicadas (${duplicadas.length}):`)
      for (const d of duplicadas.slice(0, 100)) console.log(`  ${d}`)
    }
  }

  // CASOS AMBÍGUOS não são corrigidos aqui — e nem deveriam ser corrigidos por
  // heurística em lugar nenhum. Mover uma tarefa de alvo é decisão operacional.
  const ambiguos = faseDocumentalSemEntidade.length + alvoDeOutroProcesso.length + alvoInexistente.length + necSemSujeito.length
  console.log(
    ambiguos === 0
      ? "\n✅ Nenhum backfill necessário: toda instância ativa carrega um alvo íntegro."
      : `\n⚠️  ${ambiguos} caso(s) exigem DECISÃO. Nada foi alterado — rode com --detalhe e trate um a um.`,
  )
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
