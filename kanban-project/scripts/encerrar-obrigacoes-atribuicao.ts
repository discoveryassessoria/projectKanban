// scripts/encerrar-obrigacoes-atribuicao.ts
// ============================================================================
// ENCERRA as duas tarefas "Atribuir tarefas — {família}" que estavam abertas (30/09/2026, autorizado pelo usuário):
// #3980 (processo 651, Cibils) e #3928 (processo 676, Salvarani). A obrigação foi descontinuada — a Torre de
// Controle mostra quem está sem dono — e nenhum ponto do sistema volta a criá-la.
//
// Encerra pela porta canônica `cancelarTarefa` (CANCELADA, com auditoria TAREFA_CANCELADA e o motivo), nunca por
// UPDATE direto e nunca como "concluída" (cancelada ≠ concluída: não vira sucesso em nenhum KPI). Só toca as IDS
// NOMEADAS e só se forem realmente a obrigação (tipo ADMINISTRATIVA, origem obrigacao-atribuicao, do processo esperado).
// Idempotente. Não toca nenhuma tarefa de trabalho, nenhum responsável, nenhum outro processo.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { cancelarTarefa } from "@/lib/operacional/tarefa-ciclo"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
const ALVOS: Array<{ id: number; processoId: number }> = [{ id: 3980, processoId: 651 }, { id: 3928, processoId: 676 }]
const MOTIVO = "substituída pela Torre de Controle"

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const classe = classificar(await retratar(prisma))
  console.log(`Banco: ${identificador(url)} — classificado como ${classe}`)
  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Banco é PRODUÇÃO mas --prod não foi passado. Abortando."); process.exit(1) }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) { console.error("--prod pedido mas o banco não é PRODUÇÃO. Abortando."); process.exit(1) }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO. Abortando."); process.exit(1) }
    }
  }
  for (const alvo of ALVOS) {
    const t = await prisma.tarefa.findUnique({ where: { id: alvo.id }, select: { id: true, titulo: true, tipo: true, origem: true, processoId: true, statusTarefa: true, responsavelId: true } })
    if (!t) { console.log(`  #${alvo.id}: não existe — nada a fazer`); continue }
    if (t.tipo !== "ADMINISTRATIVA" || t.origem !== "obrigacao-atribuicao" || t.processoId !== alvo.processoId) {
      console.error(`  #${alvo.id}: NÃO é a obrigação esperada (tipo ${t.tipo}, origem ${t.origem}, processo ${t.processoId}). Abortando.`); process.exit(1)
    }
    if (t.statusTarefa === "CANCELADA" || t.statusTarefa.startsWith("CONCLUIDO") || t.statusTarefa === "SUPERSEDIDA") { console.log(`  #${t.id}: já encerrada (${t.statusTarefa}) — nada a fazer (idempotente)`); continue }
    console.log(`  #${t.id} "${t.titulo}" (processo ${t.processoId}, ${t.statusTarefa}) → CANCELADA — ${MOTIVO}`)
    if (!APLICAR) continue
    const r = await cancelarTarefa({ tarefaId: t.id, autorId: t.responsavelId!, motivo: MOTIVO, codigo: "SUBSTITUIDA_PELA_TORRE" })
    console.log(r.ok ? `    ✔ encerrada` : `    ✖ ${JSON.stringify(r)}`)
    if (r.ok) {
      await prisma.logAuditoria.create({ data: {
        acao: "OBRIGACAO_ATRIBUICAO_ENCERRADA_PELA_TORRE", entidade: "Tarefa", entidadeId: t.id, usuarioId: t.responsavelId,
        descricao: `Obrigação "Atribuir tarefas" encerrada por decisão do administrador (30/09/2026): ${MOTIVO}. O sem dono passa a viver na Torre.`,
        detalhes: { motivo: MOTIVO, processoId: t.processoId, origem: "scripts/encerrar-obrigacoes-atribuicao.ts" } as never,
      } })
    }
  }
  if (!APLICAR) console.log("\n[dry-run] nada foi escrito. Rode com --aplicar --prod para gravar.")
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
