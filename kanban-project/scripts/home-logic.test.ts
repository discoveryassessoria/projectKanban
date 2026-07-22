/**
 * CENTRO OPERACIONAL — testes da lógica pura da Home.
 * Rodar: tsx scripts/home-logic.test.ts   (sem banco — só funções puras)
 */
import {
  diasEntre,
  ehPassoDeEspera,
  estaAtrasado,
  filaDoStepKey,
  grupoDaData,
  montarStatus,
  nivelDaFila,
  ordenarFilas,
  rotuloDoDia,
  somarDias,
  venceHoje,
  verboDoStep,
  TODAS_FILAS,
} from "../src/lib/home/home-logic"
import type { FilaOperacional } from "../src/types/home"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const HOJE = new Date("2026-07-22T12:00:00")

const fila = (key: string, quantidade: number, nivel: FilaOperacional["nivel"]): FilaOperacional => ({
  key,
  titulo: key,
  descricao: "",
  quantidade,
  nivel,
  modulo: "processos",
  href: `/dashboard/fila/${key}`,
})

function run() {
  console.log("CENTRO OPERACIONAL — home-logic\n")

  // ---- Classificação de trabalho pelo verbo do passo ----
  console.log("Filas derivadas do stepKey:")
  ok(verboDoStep("solicitar_certidao") === "solicitar", "verbo extraído do stepKey")
  ok(filaDoStepKey("solicitar_certidao") === "solicitar", "solicitar_certidao → fila solicitar")
  ok(filaDoStepKey("solicitar_certidao_retificada") === "solicitar", "variação retificada cai na mesma fila")
  ok(filaDoStepKey("conferir_apostilas") === "conferir", "conferir_apostilas → fila conferir")
  ok(filaDoStepKey("validar_pasta_traduzida") === "validar", "validar_pasta_traduzida → fila validar")
  ok(filaDoStepKey("montar_pasta_traducao") === "preparar", "montar_* → fila preparar")
  ok(filaDoStepKey("enviar_tradutor_juramentado") === "preparar", "enviar_* → fila preparar")
  ok(filaDoStepKey("protocolar_pedido") === "protocolar", "protocolar_pedido → fila protocolar")
  ok(filaDoStepKey("agendar_protocolo") === "protocolar", "agendar_protocolo → fila protocolar")
  ok(filaDoStepKey("localizar_registro") === "localizar", "localizar_registro → fila localizar")
  ok(filaDoStepKey("passo_novo_de_fase_futura") === "outras", "stepKey desconhecido não some: cai em 'outras'")
  ok(ehPassoDeEspera("aguardar_retorno") && !ehPassoDeEspera("conferir_certidao"), "espera de terceiro não é ação")

  // ---- Prioridade ----
  console.log("\nPrioridade:")
  ok(nivelDaFila("medio", 0) === "medio", "sem atraso mantém o nível base")
  ok(nivelDaFila("medio", 1) === "critico", "1 item atrasado torna a fila crítica")
  ok(nivelDaFila("baixo", 3) === "critico", "atraso escala qualquer fila")

  const ordenadas = ordenarFilas([
    fila("a", 0, "critico"),
    fila("b", 2, "medio"),
    fila("c", 9, "baixo"),
    fila("d", 1, "critico"),
    fila("e", 40, "medio"),
  ])
  ok(!ordenadas.some((f) => f.quantidade === 0), "fila vazia não aparece na Home")
  ok(ordenadas[0].key === "d", "crítico vem primeiro mesmo com volume menor")
  ok(ordenadas[1].key === "e" && ordenadas[2].key === "b", "dentro do nível, maior volume primeiro")
  ok(ordenadas[ordenadas.length - 1].key === "c", "nível baixo por último")

  // ---- Status operacional ----
  console.log("\nStatus operacional:")
  ok(montarStatus({ totalAcoes: 0, criticos: 0, alertas: 0 }).nivel === "estavel", "sem trabalho → estável")
  ok(montarStatus({ totalAcoes: 12, criticos: 0, alertas: 0 }).nivel === "atencao", "trabalho de rotina → atenção")
  ok(montarStatus({ totalAcoes: 12, criticos: 3, alertas: 0 }).nivel === "critico", "itens críticos → crítico")
  ok(montarStatus({ totalAcoes: 0, criticos: 0, alertas: 1 }).nivel === "critico", "alerta sozinho já é crítico")
  ok(/1 item exige/.test(montarStatus({ totalAcoes: 1, criticos: 1, alertas: 0 }).mensagem), "mensagem no singular")

  // ---- Datas / agenda ----
  console.log("\nDatas e agenda:")
  ok(estaAtrasado("2026-07-21T23:00:00", HOJE), "prazo de ontem está atrasado")
  ok(!estaAtrasado("2026-07-22T08:00:00", HOJE), "prazo de hoje não está atrasado")
  ok(!estaAtrasado(null, HOJE), "sem prazo não é atraso")
  ok(venceHoje("2026-07-22T23:00:00", HOJE), "vence hoje detectado")
  ok(diasEntre(new Date("2026-07-24T01:00:00"), HOJE) === 2, "diferença por dia civil")
  ok(grupoDaData("2026-07-22T15:00:00", HOJE) === "hoje", "agenda: hoje")
  ok(grupoDaData("2026-07-23T09:00:00", HOJE) === "amanha", "agenda: amanhã")
  ok(grupoDaData("2026-07-26T09:00:00", HOJE) === "proximos", "agenda: próximos dias")
  ok(grupoDaData("2026-07-21T09:00:00", HOJE) === null, "agenda não mostra passado")
  ok(rotuloDoDia("2026-07-24T09:00:00").length > 0, "rótulo do dia é gerado")
  ok(somarDias(HOJE, 7).getDate() === 29, "soma de dias")

  // ---- Catálogo de filas ----
  console.log("\nCatálogo de filas:")
  const chaves = TODAS_FILAS.map((f) => f.key)
  ok(new Set(chaves).size === chaves.length, "chaves de fila são únicas")
  ok(
    [
      "solicitar",
      "conferir",
      "validar",
      "protocolar",
      "bloqueios",
      "pendencias-financeiras",
      "sem-responsavel",
      "processos-parados",
      "aguardando-cliente",
    ].every((k) => chaves.includes(k)),
    "filas exigidas pelo conceito existem",
  )
  ok(TODAS_FILAS.every((f) => f.titulo.length > 0 && f.descricao.length > 0), "toda fila tem título e descrição")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
