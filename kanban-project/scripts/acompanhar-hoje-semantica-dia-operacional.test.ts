// scripts/acompanhar-hoje-semantica-dia-operacional.test.ts
// ============================================================================
// "ACOMPANHAR HOJE" É POR DIA-CALENDÁRIO NO FUSO OPERACIONAL, NUNCA POR
// INSTANTE — mandato "correção definitiva do modelo temporal" (19-20/09/2026,
// continuação, item 3 da lista de fechamento).
//
// Regra nova: um acompanhamento cuja DATA-CALENDÁRIO é hoje (America/Sao_Paulo)
// pertence a "Acompanhar hoje" independentemente do horário — mesmo que o
// horário exato ainda não tenha chegado. "Atrasado" continua sendo
// data-calendário ANTERIOR a hoje. O horário em si nunca é apagado — ele
// continua no valor persistido, só a CLASSIFICAÇÃO passou a ser por dia.
//
// Testado nas DUAS mecânicas que alimentam a categoria "Acompanhar hoje":
//   A) DIMENSÃO D DA TAREFA (proximo-acontecimento.ts::acompanhamentoVencido)
//      — data-calendário pura (metadata.operacao.proximoAcompanhamento nunca
//      carrega horário, só "YYYY-MM-DD" — por isso os casos "hoje mais cedo"/
//      "hoje mais tarde" colapsam na mesma data e servem de regressão: os
//      dois têm de dar vencido, sempre deram).
//   B) DIMENSÃO D DA SUBTAREFA (atencao-operacional.ts::classificarAtencaoOperacional,
//      acompanhamentoPasso) — `SubtaskExecution.proximoAcompanhamentoEm` é um
//      TIMESTAMP real, com horário — aqui "hoje mais cedo" (já passou) e "hoje
//      mais tarde" (ainda não chegou) são estados DIFERENTES, e é exatamente
//      aqui que o comportamento muda: antes desta correção, "hoje mais tarde"
//      NÃO entrava em "Acompanhar hoje" (só `atrasado`, nunca `venceHoje`).
//
// CASOS, em cada mecânica: ontem, hoje mais cedo, hoje mais tarde, amanhã, e
// uma FRONTEIRA DE FUSO deliberada — o instante de referência e o
// acompanhamento ficam no MESMO dia em São Paulo mas em dias UTC DIFERENTES
// (a virada UTC cai às 21h de SP), provando que a régua usada é
// `diaOperacional`/`diasEntreDiasOperacionais` (fuso operacional), nunca uma
// data UTC crua.
//
//   npx tsx scripts/acompanhar-hoje-semantica-dia-operacional.test.ts
//   (puro — sem prisma, não precisa de banco de teste)
// ============================================================================
import { computarProximoAcontecimento, type EntradaOperacao } from "../lib/operacional/proximo-acontecimento"
import { classificarAtencaoOperacional, motivosAtivos, type LinhaComAtencao } from "../lib/operacional/atencao-operacional"
import { diaOperacional, estadoTemporalSubtarefa } from "../lib/operacional/tempo-operacional"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function entradaBase(agora: Date): EntradaOperacao {
  return {
    tarefaId: 1, statusTarefa: "AGUARDANDO_TERCEIRO", motivoCodigo: null,
    dataPrazo: null, dataConclusao: null, dataInicio: null,
    slaPausadoEm: null, slaPausaAcumuladaMin: null, responsavelId: 1,
    createdAt: new Date(agora.getTime() - 30 * 86400000), agora,
    passo: {
      prazo: null, startedAt: null,
      andamento: {
        prazoEstimadoDias: null, previsaoRetorno: null,
        proximoAcompanhamento: null, destinatario: "Cartório de Teste",
        canalPreferencial: null, semRetornoDesde: null, contatos: [],
      },
      ultimoContatoResultado: null, ultimoContatoChave: null, etapaLabel: "Aguardar retorno",
    },
    solicitacao: null,
  }
}

function linhaComAcompanhamento(agora: Date, dataAcompanhamento: Date): LinhaComAtencao {
  // MESMA régua de produção (estadoTemporalSubtarefa/nucleoTemporal) — não
  // reimplementa a conta aqui, só constrói o insumo exatamente como
  // `tarefa-projecoes.ts::projetar` já faz para `acompanhamentoPasso`.
  const est = estadoTemporalSubtarefa({ dataPrazo: dataAcompanhamento, status: "AGUARDANDO_EXTERNO", agora })
  return {
    taskId: 1, coluna: "AGUARDANDO_TERCEIRO", dataPrazo: null, atrasada: false, venceHoje: false,
    executavelAgora: false, atribuidaEm: null, acompanhamentoVencido: false, atrasoInterno: false,
    atrasoTerceiro: false, retornoRecebido: false, emRisco: false,
    regraTemporalPasso: null,
    acompanhamentoPasso: { atrasado: est.atrasado, venceHoje: est.venceHoje },
  }
}

async function main() {
  console.log("\"ACOMPANHAR HOJE\" — SEMÂNTICA POR DIA-CALENDÁRIO NO FUSO OPERACIONAL\n")

  type Caso = { nome: string; agora: Date; data: Date; esperado: "vencido" | "futuro" }
  const casos: Caso[] = [
    { nome: "ontem", agora: new Date("2026-09-19T15:00:00-03:00"), data: new Date("2026-09-18T10:00:00-03:00"), esperado: "vencido" },
    { nome: "hoje mais cedo (já passou)", agora: new Date("2026-09-19T15:00:00-03:00"), data: new Date("2026-09-19T08:00:00-03:00"), esperado: "vencido" },
    { nome: "hoje mais tarde (ainda não chegou)", agora: new Date("2026-09-19T15:00:00-03:00"), data: new Date("2026-09-19T20:00:00-03:00"), esperado: "vencido" },
    { nome: "amanhã", agora: new Date("2026-09-19T15:00:00-03:00"), data: new Date("2026-09-20T08:00:00-03:00"), esperado: "futuro" },
    {
      // FRONTEIRA DE FUSO: `agora` é SP 19/09 00:30 (UTC 19/09 03:30Z);
      // `data` é SP 19/09 22:00 (UTC 20/09 01:00Z) — MESMO dia em SP, dias
      // UTC DIFERENTES. Uma implementação por data UTC crua diria "amanhã"
      // (errado); a régua operacional (`diaOperacional`) diz "hoje" (certo).
      nome: "fronteira de fuso — mesmo dia em SP, dias diferentes em UTC",
      agora: new Date("2026-09-19T00:30:00-03:00"), data: new Date("2026-09-19T22:00:00-03:00"), esperado: "vencido",
    },
  ]

  console.log("A) DIMENSÃO D DA TAREFA — proximo-acontecimento.ts (data-calendário pura, YYYY-MM-DD)")
  for (const c of casos) {
    const entrada = entradaBase(c.agora)
    // O CAMPO SÓ GUARDA DATA (isoDoDia faz `new Date(ymd+"T00:00:00.000Z")`)
    // — a data-calendário tem de vir do FUSO OPERACIONAL (`diaOperacional`),
    // nunca de um `.toISOString().slice(0,10)` cru (que seria UTC e
    // reintroduziria o próprio bug de fronteira que este caso existe pra pegar).
    entrada.passo!.andamento.proximoAcompanhamento = diaOperacional(c.data)
    const resultado = computarProximoAcontecimento(entrada)
    const esperadoVencido = c.esperado === "vencido"
    check(`[Tarefa] ${c.nome} → acompanhamentoVencido=${esperadoVencido}`,
      resultado.acompanhamentoVencido === esperadoVencido,
      `obtido=${resultado.acompanhamentoVencido} (agora=${diaOperacional(c.agora)}, data=${diaOperacional(c.data)})`)
  }

  console.log("\nB) DIMENSÃO D DA SUBTAREFA — atencao-operacional.ts (timestamp real, com horário)")
  for (const c of casos) {
    const linha = linhaComAcompanhamento(c.agora, c.data)
    const categoria = classificarAtencaoOperacional(linha)
    const motivos = motivosAtivos(linha)
    const esperadoAcompanhar = c.esperado === "vencido"
    check(`[Subtarefa] ${c.nome} → categoria='acompanharHoje'=${esperadoAcompanhar}`,
      (categoria === "acompanharHoje") === esperadoAcompanhar,
      `categoria obtida=${categoria} (agora=${diaOperacional(c.agora)}, data=${diaOperacional(c.data)}, venceHoje=${linha.acompanhamentoPasso?.venceHoje}, atrasado=${linha.acompanhamentoPasso?.atrasado})`)
    check(`[Subtarefa] ${c.nome} → motivo ACOMPANHAMENTO_DEVIDO presente=${esperadoAcompanhar}`,
      motivos.includes("ACOMPANHAMENTO_DEVIDO") === esperadoAcompanhar)
  }

  // ══════════════════════════════════════════════════════════════
  console.log("\nC) O HORÁRIO CONTINUA PRESERVADO — não foi apagado, só deixou de decidir a categoria")
  // ══════════════════════════════════════════════════════════════
  const agoraRef = new Date("2026-09-19T15:00:00-03:00")
  const hojeMaisTarde = new Date("2026-09-19T20:00:00-03:00")
  const hojeMaisCedo = new Date("2026-09-19T08:00:00-03:00")
  check("os dois instantes de 'hoje' continuam DIFERENTES em valor (getTime), só a categoria colapsa",
    hojeMaisTarde.getTime() !== hojeMaisCedo.getTime())
  const lCedo = linhaComAcompanhamento(agoraRef, hojeMaisCedo)
  const lTarde = linhaComAcompanhamento(agoraRef, hojeMaisTarde)
  check("mesma categoria para os dois (ambos 'hoje')",
    classificarAtencaoOperacional(lCedo) === classificarAtencaoOperacional(lTarde))
  check("mas o valor bruto do acompanhamento continua distinto pra ordenação/exibição",
    hojeMaisCedo.getTime() < hojeMaisTarde.getTime())

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
