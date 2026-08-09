// scripts/normalizar-vigencia-cadastros.ts
// ============================================================================
// NORMALIZAÇÃO — cadastro passa a valer por tempo indeterminado.
//
// Zera `vigenciaInicio`/`vigenciaFim` dos cadastros ATIVOS. Depois da mudança de
// 09/08/2026 nenhum resolvedor lê mais esses campos, então o valor herdado não
// muda comportamento nenhum — mas fica na tela de edição e na exportação como
// resíduo de um conceito que não existe mais, e é isso que se remove aqui.
//
// ─── O QUE ESTE SCRIPT NÃO FAZ ──────────────────────────────────────────────
// Não toca em registro INATIVO/ARQUIVADO: lá a data ainda é informação
// histórica de quando aquele cadastro esteve em uso, e apagá-la seria destruir
// contexto sem ganho. Não toca em NENHUMA data de fato — vencimento, pagamento,
// protocolo, emissão, nascimento, óbito e competência contábil ficam intactos.
//
//   Dry-run:  npx tsx scripts/normalizar-vigencia-cadastros.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/normalizar-vigencia-cadastros.ts --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"

const EXECUTAR = process.argv.includes("--execute")

/** Cada cadastro com o seu recorte de "ativo" — o ciclo de vida é do domínio. */
const ALVOS = [
  { nome: "TabelaValor", ativos: { arquivado: false }, modelo: () => prisma.tabelaValor },
  { nome: "CondicaoPagamento", ativos: { ativo: true }, modelo: () => prisma.condicaoPagamento },
  { nome: "TaxaPagamento", ativos: { ativo: true }, modelo: () => prisma.taxaPagamento },
  { nome: "Adquirente", ativos: { ativo: true }, modelo: () => prisma.adquirente },
  { nome: "MatrizDocumental", ativos: { arquivado: false }, modelo: () => prisma.matrizDocumental },
] as const

async function main() {
  console.log(`\nNORMALIZAÇÃO DE VIGÊNCIA — modo ${EXECUTAR ? "EXECUTE" : "DRY-RUN"}\n`)

  if (EXECUTAR) {
    exigirConfirmacaoDeEscritaEmProducao(
      "zera vigenciaInicio/Fim dos cadastros ATIVOS (validade passa a ser o status)",
      "normalizar-vigencia-cadastros",
    )
  }

  let total = 0
  for (const alvo of ALVOS) {
    const m = alvo.modelo() as { count: (a: unknown) => Promise<number>; updateMany: (a: unknown) => Promise<{ count: number }> }
    const comData = await m.count({
      where: { ...alvo.ativos, OR: [{ vigenciaInicio: { not: null } }, { vigenciaFim: { not: null } }] },
    })
    const inativosComData = await m.count({
      where: { NOT: alvo.ativos, OR: [{ vigenciaInicio: { not: null } }, { vigenciaFim: { not: null } }] },
    })

    if (comData === 0) {
      console.log(`  ${alvo.nome.padEnd(20)} nada a normalizar${inativosComData ? `  (${inativosComData} inativo(s) preservado(s))` : ""}`)
      continue
    }
    if (!EXECUTAR) {
      console.log(`  ${alvo.nome.padEnd(20)} ${comData} ativo(s) a normalizar${inativosComData ? `  · ${inativosComData} inativo(s) PRESERVADO(s)` : ""}`)
      total += comData
      continue
    }
    const r = await m.updateMany({ where: alvo.ativos, data: { vigenciaInicio: null, vigenciaFim: null } })
    console.log(`  ${alvo.nome.padEnd(20)} ${r.count} normalizado(s)${inativosComData ? `  · ${inativosComData} inativo(s) PRESERVADO(s)` : ""}`)
    total += r.count
  }

  if (EXECUTAR && total > 0) {
    await prisma.logAuditoria.create({
      data: {
        acao: "VIGENCIA_NORMALIZADA",
        entidade: "Cadastros",
        entidadeId: 0,
        descricao: `Validade passa a ser ESTADO, não data: ${total} cadastro(s) ativo(s) com vigência zerada. Inativos preservados; datas de fato intocadas.`,
        detalhes: { alvos: ALVOS.map((a) => a.nome), total },
      },
    })
  }

  console.log(`\n${EXECUTAR ? "✅ aplicado" : "DRY-RUN"}: ${total} registro(s).`)
  if (!EXECUTAR) console.log(`Para aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/normalizar-vigencia-cadastros.ts --execute\n`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
