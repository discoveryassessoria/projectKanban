// scripts/sanear-arvore-675-676.ts
// ============================================================================
// SANEAMENTO PONTUAL DO DADO REAL (30/09/2026) — autorizado pelo Marco, só estes itens:
//   (a) 675 Antão: cancelar a tarefa "Certidão de casamento · Edison Nás Antão Junior" (3984) e marcar o documento 2303
//       NAO_EXIGIDO (pessoa deixou de ser casada na árvore), com auditoria, sem apagar;
//   (c) qualquer outra sobra da varredura da árvore em 675/676: Documento automático órfão → NAO_EXIGIDO (+ tarefa, se houver).
//       Varredura de 30/09: só o Documento 2286 do 676 (Certidão de casamento · Alberto Luís de Mello Rosatto Júnior).
// Usa as portas canônicas do sistema (cancelarTarefa; tirarDocumentosOrfaosDeJogo). Só age nos ids listados; aborta se a
// varredura achar QUALQUER outro órfão. Idempotente. --dry por padrão; --aplicar --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { tirarDocumentosOrfaosDeJogo } from "@/src/services/genealogia/materializar-genealogia"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
const TAREFA = 3984
// 675: a tarefa 3984 e o documento 2303 JÁ foram cancelados por decisão humana (Marco, pela tela, 30/09 17:48Z) — não se sobrescreve CANCELADO.
const ORFAOS_ESPERADOS: Record<number, number[]> = { 675: [], 676: [2286] }

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const classe = classificar(await retratar(prisma))
  console.log(`Banco: ${identificador(url)} — ${classe}`)
  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Produção sem --prod. Abortando."); process.exit(1) }
    if (PROD && (classe !== CLASSE.PRODUCAO || process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO")) { console.error("Confirmação de produção ausente/inconsistente. Abortando."); process.exit(1) }
  }
  // 1) varredura: órfãos = Documento automático, não recebido, sem necessidade (mesmo critério da função do sistema)
  for (const [procId, esperados] of Object.entries(ORFAOS_ESPERADOS)) {
    const proc = await prisma.processo.findUnique({ where: { id: Number(procId) }, select: { arvoreId: true } })
    const achados = await prisma.documento.findMany({
      where: { pessoa: { arvoreId: proc!.arvoreId! }, origem: "automatica", necessidadeId: null, status: { in: ["PENDENTE", "SOLICITAR", "SOLICITADO", "EM_BUSCA", "NAO_ENCONTRADO"] } },
      select: { id: true, status: true, documentType: { select: { name: true } }, pessoa: { select: { nome: true, sobrenome: true } } },
    })
    const ids = achados.map((d) => d.id).sort()
    for (const d of achados) console.log(`  processo ${procId}: órfão #${d.id} ${d.documentType?.name} · ${d.pessoa.nome} ${d.pessoa.sobrenome ?? ""} (${d.status})`)
    if (JSON.stringify(ids) !== JSON.stringify(esperados)) { console.error(`  processo ${procId}: órfãos ${JSON.stringify(ids)} ≠ autorizados ${JSON.stringify(esperados)}. Abortando.`); process.exit(1) }
  }
  const t = await prisma.tarefa.findUnique({ where: { id: TAREFA }, select: { id: true, titulo: true, statusTarefa: true, documentoId: true, processoId: true } })
  console.log(`  tarefa #${TAREFA}: ${t?.titulo} — ${t?.statusTarefa} (documento ${t?.documentoId}, processo ${t?.processoId})`)
  if (t && (t.processoId !== 675 || t.documentoId !== 2303)) { console.error("Tarefa 3984 não é a esperada. Abortando."); process.exit(1) }
  if (t && t.statusTarefa !== "CANCELADA") { console.error("Tarefa 3984 deveria estar CANCELADA (decisão humana); não está. Abortando para decisão."); process.exit(1) }
  if (!APLICAR) { console.log("\n[dry-run] nada foi escrito."); await prisma.$disconnect(); return }

  for (const procId of [676]) {
    const motivo = "necessidade removida pela árvore: o documento não tem necessidade ativa (cônjuge removido da árvore)"
    const ids = await prisma.$transaction((tx) => tirarDocumentosOrfaosDeJogo(procId, tx, motivo), { maxWait: 20000, timeout: 60000 })
    console.log(`  processo ${procId}: NAO_EXIGIDO →`, JSON.stringify(ids))
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
