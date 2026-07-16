/**
 * CENTRAL OPERACIONAL — testes da lógica pura da Home.
 * Rodar: tsx scripts/home-logic.test.ts   (sem banco — só funções puras)
 */
import {
  agruparProcessosPorFase,
  atividadeRelevante,
  calcularAttentionSummary,
  isVencida,
  nivelPorQuantidade,
  normalizarPrioridade,
  ordenarProximasAcoes,
  rankBottlenecks,
  tipoAtividade,
  venceHoje,
} from "../src/lib/home/home-logic"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const HOJE = new Date("2026-07-15T12:00:00")
// Normaliza data-only (YYYY-MM-DD) para hora local, evitando ambiguidade de fuso
// no teste (em produção, dataPrazo é um timestamp completo do Prisma).
const t = (id: number, prazo: string | null, prioridade = "MEDIA", extra: any = {}) => ({
  id,
  dataPrazo: prazo && prazo.length === 10 ? `${prazo}T12:00:00` : prazo,
  prioridade,
  concluida: false,
  statusTarefa: "EM_ANDAMENTO",
  ...extra,
})

function run() {
  console.log("CENTRAL OPERACIONAL — home-logic\n")

  // ---- vencida / hoje ----
  ok(isVencida(t(1, "2026-07-10"), HOJE) === true, "prazo passado => vencida")
  ok(isVencida(t(2, "2026-07-20"), HOJE) === false, "prazo futuro => não vencida")
  ok(isVencida(t(3, "2026-07-10", "MEDIA", { concluida: true }), HOJE) === false, "concluída nunca vencida")
  ok(isVencida(t(4, "2026-07-10", "MEDIA", { statusTarefa: "CANCELADA" }), HOJE) === false, "terminal (CANCELADA) não vencida")
  ok(venceHoje(t(5, "2026-07-15"), HOJE) === true, "prazo hoje => venceHoje")
  ok(isVencida(t(6, null), HOJE) === false, "sem prazo => não vencida")

  // ---- ordenação de próximas ações ----
  const lista = [
    t(3, "2026-07-20", "URGENTE"), // futura urgente
    t(2, "2026-07-15", "BAIXA"),   // hoje
    t(1, "2026-07-10", "MEDIA"),   // vencida MEDIA
    t(4, "2026-07-01", "BAIXA"),   // vencida BAIXA
  ]
  const ordenada = ordenarProximasAcoes(lista as any, HOJE).map((x) => x.id)
  ok(JSON.stringify(ordenada) === JSON.stringify([1, 4, 2, 3]), "ordem: vencidas>hoje>prioridade>prazo (" + ordenada.join(",") + ")")

  // ---- processos por fase (ordem do catálogo, contagens, ignora fase desconhecida) ----
  const colunas = agruparProcessosPorFase({
    catalogo: [
      { phaseKey: "traducao", label: "Tradução", ordem: 5 },
      { phaseKey: "genealogia", label: "Genealogia", ordem: 0 },
      { phaseKey: "finalizado", label: "Finalizado", ordem: 9 },
    ],
    faseDeProcesso: new Map([[1, "genealogia"], [2, "genealogia"], [3, "traducao"], [4, "inexistente"]]),
    bloqueados: new Set([2]),
    prontos: new Set([3]),
    slaVencidos: new Set([1]),
    href: (k) => `/kanban?fase=${k}`,
  })
  ok(colunas.map((c) => c.phaseKey).join(",") === "genealogia,traducao,finalizado", "fases na ordem do catálogo")
  ok(colunas[0].total === 2 && colunas[0].bloqueados === 1 && colunas[0].slaVencido === 1, "genealogia: total/bloq/sla corretos")
  ok(colunas[1].total === 1 && colunas[1].prontos === 1, "traducao: total/prontos corretos")
  ok(colunas[2].total === 0, "finalizado: total 0 (nenhum processo)")
  ok(colunas.reduce((s, c) => s + c.total, 0) === 3, "fase desconhecida é ignorada (não vira coluna)")

  // ---- attention summary ----
  const resumo = calcularAttentionSummary({ processosBloqueados: 3, tarefasVencidas: 5, fasesProntas: 2, eventosHoje: 4, minhasPendencias: 3 })
  ok(resumo.total === 17, "attentionSummary.total soma os componentes (17)")

  // ---- gargalos: remove zeros e ordena por impacto ----
  const gargalos = rankBottlenecks([
    { key: "a", titulo: "A", quantidade: 0, nivel: "baixo", href: "#" },
    { key: "b", titulo: "B", quantidade: 3, nivel: "medio", href: "#" },
    { key: "c", titulo: "C", quantidade: 9, nivel: "alto", href: "#" },
  ])
  ok(gargalos.length === 2, "gargalos: zeros removidos")
  ok(gargalos[0].key === "c" && gargalos[1].key === "b", "gargalos: ordenados por quantidade desc")

  // ---- atividade: filtra ruído técnico de tarefas ----
  ok(atividadeRelevante({ acao: "editou", entidade: "TAREFA" }) === false, "editou/TAREFA é ruído")
  ok(atividadeRelevante({ acao: "excluiu", entidade: "TAREFA" }) === false, "excluiu/TAREFA é ruído")
  ok(atividadeRelevante({ acao: "concluiu", entidade: "TAREFA" }) === true, "concluiu/TAREFA é relevante")
  ok(atividadeRelevante({ acao: "criou", entidade: "PROCESSO" }) === true, "criou/PROCESSO é relevante")
  ok(atividadeRelevante({ acao: "moveu", entidade: "PROCESSO" }) === true, "moveu/PROCESSO é relevante")
  ok(tipoAtividade("concluiu") === "conclusao", "tipoAtividade(concluiu)=conclusao")

  // ---- utilitários ----
  ok(normalizarPrioridade("alta") === "ALTA", "normalizarPrioridade minúsculo")
  ok(normalizarPrioridade("xyz") === "MEDIA", "normalizarPrioridade fallback")
  ok(nivelPorQuantidade(0) === "baixo" && nivelPorQuantidade(12) === "alto" && nivelPorQuantidade(30) === "critico", "nivelPorQuantidade escalona")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
