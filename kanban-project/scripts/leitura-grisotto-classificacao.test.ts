// scripts/leitura-grisotto-classificacao.test.ts
// ============================================================================
// CASO 6 DO MANDATO (17/09/2026) — o cenário REAL da Grisotto, contra
// PRODUÇÃO, SOMENTE LEITURA. Nenhuma escrita — prova que a nova classificação
// e o novo progresso por subtarefa leem a verdade canônica já existente
// corretamente, sem precisar reconciliar dado nenhum.
//
// Roda contra o banco do `.env` (produção) de propósito: o cenário só existe
// lá. Encontra as tarefas AGUARDANDO_TERCEIRO de Emissão Documental da
// Grisotto dinamicamente — nunca por id fixo — e é seguro rodar de novo a
// qualquer momento (o estado real pode ter avançado desde a última vez).
//
// Rodar: npx tsx scripts/leitura-grisotto-classificacao.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"
import { classificarAtencaoOperacional } from "@/lib/operacional/atencao-operacional"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function main() {
  const grisotto = await prisma.processo.findFirst({ where: { nome: { contains: "Grisotto", mode: "insensitive" } }, select: { id: true, nome: true } })
  if (!grisotto) { console.log("Grisotto não encontrada em produção agora — nada a verificar."); await prisma.$disconnect(); return }

  const tarefas = await prisma.tarefa.findMany({
    where: { processoId: grisotto.id, tipo: "NORMAL", faseMacroKey: "emissao_documental", statusTarefa: "AGUARDANDO_TERCEIRO" },
    select: { id: true, responsavelId: true },
  })
  if (tarefas.length === 0) { console.log("Nenhuma tarefa AGUARDANDO_TERCEIRO de Emissão Documental na Grisotto agora — cenário já avançou; nada a verificar."); await prisma.$disconnect(); return }

  console.log(`CASO 6 (Grisotto real) — ${tarefas.length} tarefa(s) AGUARDANDO_TERCEIRO encontrada(s), lidas de produção (somente leitura)\n`)

  const porResponsavel = new Map<number, number[]>()
  for (const t of tarefas) {
    if (t.responsavelId == null) continue
    porResponsavel.set(t.responsavelId, [...(porResponsavel.get(t.responsavelId) ?? []), t.id])
  }

  for (const [responsavelId, ids] of porResponsavel) {
    const linhas = await minhaFila(responsavelId)
    const doGrupo = linhas.filter((l) => ids.includes(l.taskId))
    ok(`todas as ${ids.length} tarefa(s) do responsável ${responsavelId} aparecem em minhaFila`, doGrupo.length === ids.length, `${doGrupo.length}/${ids.length}`)

    for (const l of doGrupo) {
      const categoria = classificarAtencaoOperacional(l)
      ok(`tarefa ${l.taskId}: NÃO é "Para fazer" (passo 1 já foi concluído — depende do cartório agora)`, categoria !== "paraAgirAgora", categoria)
      ok(
        `tarefa ${l.taskId}: classificada em aguardandoTerceiros, acompanharHoje ou terceirosAtrasados (nunca "outras")`,
        ["aguardandoTerceiros", "acompanharHoje", "terceirosAtrasados"].includes(categoria),
        categoria,
      )
      if (l.passoAtual && l.passoAtual.total > 1) {
        ok(`tarefa ${l.taskId}: progresso por SUBTAREFA (não por Step) — "${l.passoAtual.ordem}/${l.passoAtual.total}", nunca "0/1"`, l.passoAtual.ordem >= 1)
      } else {
        console.log(`  · tarefa ${l.taskId}: passoAtual=${JSON.stringify(l.passoAtual)} — este passo não tem subtarefas congeladas (>1); "0/1"/"1/1" continua correto por Step.`)
      }
    }
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
