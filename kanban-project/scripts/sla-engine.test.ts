/**
 * ENGINE DE SLA — testes da lógica pura (sem banco).
 * Rodar: tsx scripts/sla-engine.test.ts
 *
 * Prova o contrato operacional do prazo:
 *  • prazo total = soma dos SLAs das fases OBRIGATÓRIAS (mesma conta da tela de
 *    configuração — o cadastro continua sendo a única fonte de verdade);
 *  • semáforo 🟢 no prazo / 🟡 até 7 dias / 🔴 vencido;
 *  • faixas da Central Operacional são um refinamento do MESMO semáforo;
 *  • fase responsável pelo atraso sai do tempo real gasto em cada fase;
 *  • processo concluído congela — não "atrasa" mais a cada dia;
 *  • sem configuração de SLA não vira "no prazo": vira "sem prazo".
 */
import {
  buildSlaProjection,
  classificarSla,
  faixaSla,
  rotuloDiasSla,
  slaVazio,
  DIAS_ATENCAO_SLA,
  type SlaFaseConfig,
  type SlaInstanciaFase,
} from "../src/lib/motor/sla-core"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

/** Data ao meio-dia UTC — mesma convenção de dia civil da engine. */
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

const FASES: SlaFaseConfig[] = [
  { phaseKey: "genealogia", label: "Genealogia", ordem: 1, required: true, slaDays: 30 },
  { phaseKey: "documentos", label: "Documentos", ordem: 2, required: true, slaDays: 60 },
  { phaseKey: "traducao", label: "Tradução", ordem: 3, required: false, slaDays: 45 },
  { phaseKey: "protocolo", label: "Protocolo", ordem: 4, required: true, slaDays: 10 },
]

const inst = (
  faseMacroKey: string,
  startedAt: string,
  completedAt: string | null,
  extra: Partial<SlaInstanciaFase> = {},
): SlaInstanciaFase => ({
  faseMacroKey,
  ciclo: 1,
  status: completedAt ? "CONCLUIDO" : "ATIVO",
  startedAt: dia(startedAt),
  completedAt: completedAt ? dia(completedAt) : null,
  createdAt: dia(startedAt),
  ...extra,
})

const base = (over: Partial<Parameters<typeof buildSlaProjection>[0]> = {}) =>
  buildSlaProjection({
    processoId: 1,
    inicio: dia("2026-01-01"),
    dataConclusao: null,
    faseAtualKey: "documentos",
    fases: FASES,
    instancias: [inst("genealogia", "2026-01-01", "2026-01-20"), inst("documentos", "2026-01-20", null)],
    hoje: dia("2026-02-01"),
    ...over,
  })

function run() {
  console.log("ENGINE DE SLA — núcleo puro\n")

  // ---- Prazo contratado ----
  console.log("Prazo total (configuração):")
  const s = base()
  ok(s.prazoTotalDias === 100, "soma só as fases obrigatórias (30 + 60 + 10 = 100)")
  ok(s.prazoPrevisto?.slice(0, 10) === "2026-04-11", "prazo previsto = início + prazo total")
  ok(s.configurado === true, "com fases e SLA > 0 o processo está configurado")
  ok(
    base({ fases: [] }).configurado === false && base({ fases: [] }).status === "sem_prazo",
    "sem Workflow Macro não vira 'no prazo': vira 'sem prazo'",
  )
  ok(
    base({ fases: FASES.map((f) => ({ ...f, slaDays: 0 })) }).status === "sem_prazo",
    "todas as fases com SLA 0 = sem prazo definido",
  )

  // ---- Semáforo ----
  console.log("\nSemáforo:")
  ok(classificarSla(30) === "no_prazo", "🟢 folga > 7 dias")
  ok(classificarSla(DIAS_ATENCAO_SLA) === "proximo_vencimento", "🟡 exatamente 7 dias já é atenção")
  ok(classificarSla(1) === "proximo_vencimento", "🟡 falta 1 dia")
  ok(classificarSla(0) === "proximo_vencimento", "🟡 vence hoje ainda não está vencido")
  ok(classificarSla(-1) === "atrasado", "🔴 vencido ontem")
  ok(classificarSla(null) === "sem_prazo", "sem prazo configurado não recebe cor")
  ok(base().status === "no_prazo", "processo com 69 dias de folga está no prazo")
  ok(base({ hoje: dia("2026-04-05") }).status === "proximo_vencimento", "6 dias para vencer = atenção")
  ok(base({ hoje: dia("2026-04-11") }).status === "proximo_vencimento", "no dia do vencimento ainda não atrasou")
  ok(base({ hoje: dia("2026-04-12") }).status === "atrasado", "um dia após o prazo = atrasado")

  // ---- Dias ----
  console.log("\nContagem de dias:")
  const atrasado = base({ hoje: dia("2026-04-23") })
  ok(atrasado.diasAtraso === 12, "12 dias de atraso")
  ok(atrasado.diasRestantes === 0, "atrasado não tem dias restantes")
  ok(atrasado.diasDecorridos === 112, "dias decorridos contam do início até hoje")
  ok(atrasado.rotuloDias === "12 dias atrasado", "rótulo do atraso")
  ok(rotuloDiasSla(0) === "Vence hoje" && rotuloDiasSla(1) === "Vence amanhã", "rótulos de hoje/amanhã")
  ok(rotuloDiasSla(3) === "Vence em 3 dias", "rótulo de vencimento futuro")
  ok(rotuloDiasSla(-1) === "1 dia atrasado", "singular no atraso de 1 dia")
  ok(rotuloDiasSla(null) === "—", "sem prazo não inventa número")

  // ---- Faixas da Central Operacional ----
  console.log("\nFaixas da Central Operacional:")
  ok(base({ hoje: dia("2026-04-12") }).faixa === "atrasados", "vencido → atrasados")
  ok(base({ hoje: dia("2026-04-11") }).faixa === "vencem-hoje", "vence hoje tem faixa própria")
  ok(base({ hoje: dia("2026-04-08") }).faixa === "proximos-7", "3 dias → próximos 7")
  ok(base().faixa === "no-prazo", "com folga → no prazo")
  ok(faixaSla({ configurado: false, concluido: false, diasParaVencimento: null }) === null, "sem SLA não entra em faixa")
  ok(
    faixaSla({ configurado: true, concluido: true, diasParaVencimento: -5 }) === null,
    "processo concluído sai das faixas operacionais",
  )
  // A faixa NUNCA pode discordar do semáforo — mesma fronteira, um cálculo só.
  const coerente = [-10, -1, 0, 1, 7, 8, 90].every((d) => {
    const st = classificarSla(d)
    const fx = faixaSla({ configurado: true, concluido: false, diasParaVencimento: d })
    if (st === "atrasado") return fx === "atrasados"
    if (st === "no_prazo") return fx === "no-prazo"
    return fx === "vencem-hoje" || fx === "proximos-7"
  })
  ok(coerente, "faixa e status nunca discordam (mesma fronteira)")

  // ---- Fase atual ----
  console.log("\nSLA da fase atual:")
  const f = base().faseAtual!
  ok(f.phaseKey === "documentos" && f.label === "Documentos", "fase atual vem da configuração")
  ok(f.slaDias === 60, "SLA da fase atual é o configurado na fase")
  ok(f.diasDecorridos === 12, "dias na fase contam do início da instância")
  ok(f.prazo?.slice(0, 10) === "2026-03-21", "prazo da fase = início da fase + SLA da fase")
  ok(f.status === "no_prazo", "fase dentro do prazo")
  const faseVencida = base({ hoje: dia("2026-04-01") }).faseAtual!
  ok(faseVencida.status === "atrasado" && faseVencida.diasAtraso === 11, "fase estourada acusa atraso próprio")
  ok(
    base({ faseAtualKey: "fase_nao_configurada" }).faseAtual?.slaDias === 0,
    "fase fora da configuração aparece sem SLA, não quebra",
  )

  // ---- Fase responsável pelo atraso ----
  console.log("\nFase responsável pelo atraso:")
  ok(base().faseResponsavelAtraso === null, "sem fase estourada, ninguém é responsável")
  const estourou = base({
    instancias: [
      inst("genealogia", "2026-01-01", "2026-03-10"), // 68 dias num SLA de 30 → +38
      inst("documentos", "2026-03-10", null),
    ],
    hoje: dia("2026-03-20"),
  })
  ok(estourou.faseResponsavelAtraso?.phaseKey === "genealogia", "a fase que estourou é apontada")
  ok(estourou.faseResponsavelAtraso?.diasExcedidos === 38, "excedente = consumido - SLA da fase")
  ok(estourou.faseResponsavelAtraso?.emAndamento === false, "fase já concluída não está em andamento")

  const doisEstouros = base({
    instancias: [
      inst("genealogia", "2026-01-01", "2026-02-10"), // 40 → +10
      inst("documentos", "2026-02-10", null), // corre desde então
    ],
    hoje: dia("2026-05-01"), // 80 dias em documentos, SLA 60 → +20
  })
  ok(doisEstouros.faseResponsavelAtraso?.phaseKey === "documentos", "vence o MAIOR excedente")
  ok(doisEstouros.faseResponsavelAtraso?.emAndamento === true, "fase corrente ainda em andamento")

  const reaberta = base({
    instancias: [
      inst("genealogia", "2026-01-01", "2026-01-15"), // 14 dias
      inst("genealogia", "2026-02-01", "2026-03-05", { ciclo: 2 }), // + 32 dias = 46 num SLA de 30
      inst("documentos", "2026-03-05", null),
    ],
    hoje: dia("2026-03-10"),
  })
  ok(reaberta.faseResponsavelAtraso?.diasConsumidos === 46, "reabertura soma o tempo de todos os ciclos")

  const cancelada = base({
    instancias: [
      inst("genealogia", "2026-01-01", null, { status: "CANCELADO" }),
      inst("documentos", "2026-01-20", null),
    ],
    hoje: dia("2026-06-01"),
  })
  ok(
    cancelada.faseResponsavelAtraso?.phaseKey === "documentos",
    "instância cancelada não consome prazo da fase",
  )

  // ---- Próximo vencimento ----
  console.log("\nPróximo vencimento:")
  const pv = base().proximoVencimento!
  ok(pv.origem === "fase" && pv.data.slice(0, 10) === "2026-03-21", "vence antes o prazo da fase")
  const pvProc = base({ hoje: dia("2026-04-01") }).proximoVencimento!
  ok(pvProc.origem === "processo", "com a fase já vencida, o próximo é o do processo")
  ok(base({ hoje: dia("2026-05-01") }).proximoVencimento === null, "tudo vencido não inventa próximo vencimento")

  // ---- Conclusão congela o SLA ----
  console.log("\nProcesso concluído:")
  const concluido = base({ dataConclusao: dia("2026-02-15"), hoje: dia("2026-12-31") })
  ok(concluido.concluido === true, "processo com data de conclusão está concluído")
  ok(concluido.status === "no_prazo", "entregue dentro do prazo continua verde meses depois")
  ok(concluido.diasDecorridos === 45, "tempo decorrido congela na conclusão")
  ok(concluido.faixa === null, "concluído não polui as faixas operacionais")
  ok(concluido.proximoVencimento === null, "processo encerrado não tem próximo vencimento")
  const fechadoNaFaseFinal = base({ faseAtualKey: "finalizado", hoje: dia("2026-12-31") })
  ok(fechadoNaFaseFinal.concluido === true, "fase 'finalizado' também encerra o processo")

  // ---- Determinismo e borda ----
  console.log("\nRobustez:")
  ok(
    JSON.stringify(base()) === JSON.stringify(base()),
    "mesmo snapshot ⇒ mesmo resultado (nenhum 'agora' escondido)",
  )
  ok(base({ inicio: null }).status === "sem_prazo", "sem data de início não há prazo previsto")
  ok(base({ instancias: [] }).faseAtual?.inicio === null, "processo sem instância não quebra a fase atual")
  const vazio = slaVazio(99)
  ok(vazio.processoId === 99 && vazio.status === "sem_prazo" && vazio.faixa === null, "projeção vazia é neutra")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
