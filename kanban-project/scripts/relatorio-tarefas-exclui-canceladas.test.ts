// scripts/relatorio-tarefas-exclui-canceladas.test.ts
//
// RELATÓRIO DE TAREFAS — CANCELADA/SUPERSEDIDA não contam por padrão.
//
// Achado real (28/09/2026): de 48 tarefas totais em produção, 13 eram
// CANCELADA(3)/SUPERSEDIDA(10) aparecendo por padrão quando ninguém escolhia
// filtro de status nenhum — inclusive nas visões do sistema (ex.: "Backlog
// (não concluídas)", que contava as 13 porque cancelamento não vira
// `concluida: true`, CLAUDE.md: "Cancelada != Concluída").
//
// Regra nova: sem filtro de status explícito, CANCELADA/SUPERSEDIDA ficam de
// fora. Escolher "Status" explicitamente (mesmo incluindo essas duas, ou
// "Todos") continua trazendo tudo — o padrão muda, a escolha do usuário nunca
// é sobreposta.
//
// SOMENTE LEITURA contra o banco real — nenhum teste aqui escreve.
import { prisma } from "@/lib/prisma"
import { DOMINIO_TAREFAS } from "@/src/lib/relatorios/motor/dominios/tarefas"
import { executar } from "@/src/lib/relatorios/motor/executar"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const TODOS_OS_STATUS = [
  "NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO",
  "CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "BLOQUEADA", "SUPERSEDIDA", "CANCELADA",
]

async function main() {
  console.log("RELATÓRIO DE TAREFAS — CANCELADA/SUPERSEDIDA fora do padrão\n")

  console.log("(1) Números reais de produção (prova, não suposição):")
  const totalBruto = await prisma.tarefa.count()
  const canceladaSuperseidaBruto = await prisma.tarefa.count({ where: { statusTarefa: { in: ["CANCELADA", "SUPERSEDIDA"] } } })
  console.log(`  total bruto (Tarefa.count sem filtro): ${totalBruto}`)
  console.log(`  CANCELADA+SUPERSEDIDA: ${canceladaSuperseidaBruto}`)
  const esperadoPadrao = totalBruto - canceladaSuperseidaBruto

  console.log("\n(2) Sem filtro de status nenhum — exclui CANCELADA/SUPERSEDIDA:")
  const semFiltro = await executar(DOMINIO_TAREFAS, { dominio: "tarefas", filtros: [], porPagina: 5 })
  t(semFiltro.total === esperadoPadrao, `total = ${esperadoPadrao} (bruto ${totalBruto} - ${canceladaSuperseidaBruto} CANCELADA/SUPERSEDIDA)`, String(semFiltro.total))
  t(semFiltro.linhas.every((l) => !["CANCELADA", "SUPERSEDIDA"].includes(String(l.celulas.find((c) => c.key === "status")?.valor))),
    "nenhuma linha carregada é CANCELADA/SUPERSEDIDA")

  console.log("\n(3) Filtro explícito incluindo CANCELADA/SUPERSEDIDA ('Todos') — traz tudo de volta:")
  const todos = await executar(DOMINIO_TAREFAS, {
    dominio: "tarefas",
    filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: TODOS_OS_STATUS } }],
    porPagina: 5,
  })
  t(todos.total === totalBruto, "escolha explícita de 'Todos' nunca é sobreposta pelo padrão", `${todos.total} vs esperado ${totalBruto}`)

  console.log("\n(4) Filtro explícito só CANCELADA — usuário ainda consegue ver, sozinha:")
  const soCancelada = await executar(DOMINIO_TAREFAS, {
    dominio: "tarefas",
    filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["CANCELADA"] } }],
    porPagina: 5,
  })
  const canceladaBruto = await prisma.tarefa.count({ where: { statusTarefa: "CANCELADA" } })
  t(soCancelada.total === canceladaBruto, "filtro explícito 'CANCELADA' prevalece sobre o padrão", `${soCancelada.total} vs ${canceladaBruto}`)

  console.log("\n(5) Combinar status com outro filtro (ex.: responsável) — escolha de status ainda prevalece:")
  const tarefaSuperseidada = await prisma.tarefa.findFirst({ where: { statusTarefa: "SUPERSEDIDA", responsavelId: { not: null } }, select: { responsavelId: true } })
  if (tarefaSuperseidada?.responsavelId) {
    const rComResp = await executar(DOMINIO_TAREFAS, {
      dominio: "tarefas",
      filtros: [
        { key: "responsavel", valor: { tipo: "entidade", id: tarefaSuperseidada.responsavelId } },
        { key: "status", valor: { tipo: "multi_selecao", valores: ["SUPERSEDIDA"] } },
      ],
      porPagina: 5,
    })
    t(rComResp.total > 0, "filtro composto (responsável + status=SUPERSEDIDA) ainda encontra a SUPERSEDIDA — padrão não interfere quando status já foi escolhido", String(rComResp.total))
  } else {
    console.log("  (pulado — nenhuma tarefa SUPERSEDIDA com responsável pra montar o caso composto)")
  }

  console.log("\n(6) Visões do sistema herdam o padrão automaticamente (nenhuma precisou de ajuste próprio):")
  for (const v of DOMINIO_TAREFAS.visoesDoSistema) {
    const temFiltroDeStatus = v.spec.filtros?.some((f) => f.key === "status") ?? false
    t(!temFiltroDeStatus, `visão "${v.nome}" não define filtro de status próprio — herda o padrão da fonte única`)
    const r = await executar(DOMINIO_TAREFAS, { dominio: "tarefas", ...v.spec, porPagina: 5 })
    t(Number.isFinite(r.total), `visão "${v.nome}" roda sem erro`, `total=${r.total}`)
  }

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
