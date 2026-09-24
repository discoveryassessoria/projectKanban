// scripts/remover-documento-2258-anexo-indevido.ts
// ============================================================================
// LIMPEZA pontual: o Documento 2258 (processo 647 "Teste", Ademir Matheus) foi
// criado pela rota `POST /api/processos/[id]/analise/documentos` — capacidade
// removida em 24/09/2026 por decisão do usuário: "certidões necessárias para
// a pasta documental serão única e exclusivamente criadas na árvore
// genealógica e nunca em nenhum outro lugar". O documento é órfão
// (documentTypeId=null, necessidadeId=null), duplica o MESMO arquivo que o
// Documento 2257 (esse sim canônico, nascido da Emissão Documental/árvore) e
// só existe porque a rota condenada permitiu.
//
// Usa a porta canônica de remoção (`removerDocumento`, documento-operacional.ts
// — "dono único da remoção"), não SQL cru: ela cuida de tarefas/passos/
// solicitações/arquivos/financeiro vinculados ao documento; PastaTraducaoDocumento
// cai por FK onDelete:Cascade (schema).
//
// USO:
//   npx tsx scripts/remover-documento-2258-anexo-indevido.ts                 → dry-run (só relatório)
//   npx tsx scripts/remover-documento-2258-anexo-indevido.ts --aplicar --prod → exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { removerDocumento } from "../src/services/documento-operacional"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")
const DOCUMENTO_ID = 2258

async function main() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[remover-doc-2258] alvo ${identificador(url)} classificado como ${classe}`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) { console.error("[remover-doc-2258] RECUSADO: --prod passado mas alvo não é PRODUCAO."); process.exit(1) }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("[remover-doc-2258] RECUSADO: exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO."); process.exit(1) }
  }

  const doc = await prisma.documento.findUnique({
    where: { id: DOCUMENTO_ID },
    select: { id: true, pessoaId: true, tipo: true, documentTypeId: true, necessidadeId: true, origem: true, arquivo_url: true },
  })
  if (!doc) { console.log(`[remover-doc-2258] Documento ${DOCUMENTO_ID} não existe (já removido?)`); return }
  console.log("[remover-doc-2258] documento alvo:", JSON.stringify(doc, null, 2))

  if (doc.documentTypeId != null || doc.necessidadeId != null) {
    console.error("[remover-doc-2258] RECUSADO: este documento passou a ter documentTypeId/necessidadeId — não é mais o órfão esperado, não removo sem reconferir.")
    process.exit(1)
  }

  if (!APLICAR) {
    console.log("[remover-doc-2258] DRY-RUN — rode com --aplicar --prod para remover de fato.")
    return
  }

  const r = await removerDocumento(DOCUMENTO_ID)
  console.log("[remover-doc-2258] resultado:", JSON.stringify(r, null, 2))
}

main().finally(() => prisma.$disconnect())
