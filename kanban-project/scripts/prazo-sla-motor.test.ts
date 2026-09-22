// scripts/prazo-sla-motor.test.ts
// ============================================================================
// MOTOR PURO de Prazo/SLA — mandato "Módulo de Prazos, SLA e Políticas de
// Acompanhamento" (22/09/2026). `lib/operacional/motor-prazo-sla.ts` é ZERO
// Prisma, ZERO `new Date()` interno — todo "agora"/"base" é parâmetro
// explícito. Esta suíte não toca banco, roda instantânea, e prova o
// CONTRATO do cálculo: dias corridos × dias úteis, combinações incomuns mas
// válidas (DIAS_UTEIS + tratamentoFimDeSemana:"CONTA"), feriado nacional,
// feriado custom, ajuste de data não útil nos dois sentidos, horário-limite,
// a honestidade de nunca inventar prazo (quantidade <= 0 → null), e as três
// fronteiras exatas de classificarRisco/acompanhamentoVencido.
//
//   npx tsx scripts/prazo-sla-motor.test.ts
// ============================================================================
import {
  calcularPrazoGeral,
  calcularAcompanhamento,
  classificarRisco,
  acompanhamentoVencido,
  diaContaParaPrazo,
  ehDiaUtilNoCalendario,
  FUSO_OPERACIONAL,
  type ParametrosContagemDias,
} from "../lib/operacional/motor-prazo-sla"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean | null | undefined, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}
function secao(t: string) { console.log(`\n${t}`) }

// Todo instante em meio-dia UTC (09h em América/São_Paulo, -03:00) — nunca
// vira o dia por causa de fuso, e o dia-da-semana lido localmente
// (isFimDeSemana/isFeriado, em src/lib/diasUteis.ts) sempre bate com o
// calendário brasileiro pretendido no teste, seja qual for o TZ do processo
// que roda este script (America/Sao_Paulo é o TZ real desta máquina — meio-dia
// UTC nunca cruza a virada de dia em nenhum fuso entre UTC-11 e UTC+12).
const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`)
/** Instante exato EM SÃO PAULO — para os testes de fronteira de classificarRisco/acompanhamentoVencido. */
const sp = (iso: string) => new Date(`${iso}-03:00`)
const ymd = (dt: Date) => dt.toISOString().slice(0, 10)
const horaEm = (dt: Date) => dt.toLocaleString("pt-BR", { timeZone: FUSO_OPERACIONAL, hour: "2-digit", minute: "2-digit", hour12: false })

function main() {
  console.log("\n=== MOTOR PURO — Prazo/SLA/Acompanhamento (sem banco) ===\n")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) DIAS CORRIDOS × DIAS ÚTEIS — mesmo base+quantidade, resultados diferentes com fim de semana no meio")
  // ══════════════════════════════════════════════════════════════════════
  // Base: sexta 13/03/2026. quantidade=3.
  const sexta = d("2026-03-13")
  const corridos: ParametrosContagemDias = { unidade: "DIAS_CORRIDOS", tratamentoFimDeSemana: "CONTA", tratamentoFeriado: "CONTA" }
  const uteis: ParametrosContagemDias = { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA" }
  const prazoCorridos = calcularPrazoGeral(sexta, { ...corridos, quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  const prazoUteis = calcularPrazoGeral(sexta, { ...uteis, quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("1.1) corridos: sex 13/03 + 3 dias corridos = seg 16/03 (sáb+dom contam)", prazoCorridos && ymd(prazoCorridos) === "2026-03-16", prazoCorridos && ymd(prazoCorridos))
  check("1.2) úteis: sex 13/03 + 3 dias úteis = qua 18/03 (sáb+dom pulados)", prazoUteis && ymd(prazoUteis) === "2026-03-18", prazoUteis && ymd(prazoUteis))
  check("1.3) mesmo base, mesma quantidade, resultados DIFERENTES", ymd(prazoCorridos!) !== ymd(prazoUteis!))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) COMBINAÇÃO INCOMUM MAS VÁLIDA — DIAS_UTEIS + tratamentoFimDeSemana:\"CONTA\"")
  // ══════════════════════════════════════════════════════════════════════
  // O cadastro pede pra ignorar a exceção normalmente aplicada — fim de
  // semana conta como dia útil mesmo na unidade DIAS_UTEIS. Motor nunca
  // recusa a combinação por conta própria.
  const uteisContaFDS: ParametrosContagemDias = { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "CONTA", tratamentoFeriado: "PULA" }
  const prazoUteisConta = calcularPrazoGeral(sexta, { ...uteisContaFDS, quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("2.1) DIAS_UTEIS com tratamentoFimDeSemana:CONTA conta o fim de semana normalmente",
    prazoUteisConta && ymd(prazoUteisConta) === "2026-03-16", prazoUteisConta && ymd(prazoUteisConta))
  check("2.2) e por isso bate com o resultado dos dias corridos (mesmo efeito, unidades diferentes)",
    prazoUteisConta && prazoCorridos && ymd(prazoUteisConta) === ymd(prazoCorridos))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) FERIADO NACIONAL — pulado quando tratamentoFeriado:\"PULA\"")
  // ══════════════════════════════════════════════════════════════════════
  // Base: quarta 23/12/2026. 25/12 (sexta) é Natal. quantidade=2 já prova o
  // PULA sozinho (o Natal e o fim de semana são pulados); quantidade=3 é o
  // valor que isola o efeito do feriado sem o ajuste final de dia-não-útil
  // (que sempre empurra a DATA FINAL pro próximo dia útil do calendário,
  // *independente* de tratamentoFeriado) mascarar a diferença — com
  // quantidade=2 os dois bruto acabam empurrados pro MESMO dia 28/12 pelo
  // ajuste final, o que provaria a coisa errada.
  const quartaAntesDoNatal = d("2026-12-23")
  const uteisPulaFeriado: ParametrosContagemDias = { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA" }
  const prazoPulaNatal = calcularPrazoGeral(quartaAntesDoNatal, { ...uteisPulaFeriado, quantidade: 2, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("3.1) qua 23/12 + 2 dias úteis, pulando o Natal (25/12) e o fim de semana = seg 28/12",
    prazoPulaNatal && ymd(prazoPulaNatal) === "2026-12-28", prazoPulaNatal && ymd(prazoPulaNatal))
  const uteisContaFeriado: ParametrosContagemDias = { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "CONTA" }
  const prazoPula3 = calcularPrazoGeral(quartaAntesDoNatal, { ...uteisPulaFeriado, quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  const prazoConta3 = calcularPrazoGeral(quartaAntesDoNatal, { ...uteisContaFeriado, quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("3.2) qua 23/12 + 3 dias úteis pulando o Natal = ter 29/12", prazoPula3 && ymd(prazoPula3) === "2026-12-29", prazoPula3 && ymd(prazoPula3))
  check("3.3) mesma conta com tratamentoFeriado:CONTA — o Natal passa a contar como 1 dia útil, resultado chega 1 dia antes = seg 28/12",
    prazoConta3 && ymd(prazoConta3) === "2026-12-28", prazoConta3 && ymd(prazoConta3))
  check("3.4) PULA e CONTA divergem exatamente pelo feriado nacional", ymd(prazoPula3!) !== ymd(prazoConta3!))

  // ══════════════════════════════════════════════════════════════════════
  secao("4) FERIADO CUSTOM — respeitado via feriadosCustom, sem estar no calendário nacional")
  // ══════════════════════════════════════════════════════════════════════
  // 16/03/2026 (segunda) não é feriado nacional nenhum — só custom aqui.
  const feriadoCustom = [{ data: d("2026-03-16"), recorrenteAnual: false }]
  const semCustom = calcularPrazoGeral(sexta, { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", quantidade: 2, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  const comCustom = calcularPrazoGeral(sexta, { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", feriadosCustom: feriadoCustom, quantidade: 2, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("4.1) sem feriado custom: sex 13/03 + 2 dias úteis = ter 17/03", semCustom && ymd(semCustom) === "2026-03-17", semCustom && ymd(semCustom))
  check("4.2) com 16/03 como feriado CUSTOM: o mesmo cálculo empurra pra qua 18/03", comCustom && ymd(comCustom) === "2026-03-18", comCustom && ymd(comCustom))
  check("4.3) diaContaParaPrazo nega o dia custom", !diaContaParaPrazo(d("2026-03-16"), { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", feriadosCustom: feriadoCustom }))
  check("4.4) e ehDiaUtilNoCalendario também nega, só com o feriado custom informado", !ehDiaUtilNoCalendario(d("2026-03-16"), feriadoCustom))
  check("4.5) sem o feriado custom informado, o mesmo dia É dia útil", ehDiaUtilNoCalendario(d("2026-03-16")))
  // recorrenteAnual: bate em qualquer ano, mesmo mês/dia
  const feriadoRecorrente = [{ data: d("2020-03-16"), recorrenteAnual: true }]
  check("4.6) feriado custom recorrenteAnual bate em ANO diferente do cadastrado (2026, cadastrado em 2020)",
    !ehDiaUtilNoCalendario(d("2026-03-16"), feriadoRecorrente))

  // ══════════════════════════════════════════════════════════════════════
  secao("5) politicaDataNaoUtil — empurra pro PRÓXIMO dia útil OU pro ANTERIOR, quando o prazo bruto cai em dia não útil")
  // ══════════════════════════════════════════════════════════════════════
  // Base: segunda 09/03/2026. quantidade=5, DIAS_CORRIDOS (CONTA fim de
  // semana e feriado) — o bruto cai exatamente no sábado 14/03.
  const segunda = d("2026-03-09")
  const brutoNoSabado = calcularPrazoGeral(segunda, { unidade: "DIAS_CORRIDOS", tratamentoFimDeSemana: "CONTA", tratamentoFeriado: "CONTA", quantidade: 5, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  check("5.0) confirma que o bruto (sem ajuste) cairia no sábado 14/03", brutoNoSabado !== null)
  const proximoUtil = calcularPrazoGeral(segunda, { unidade: "DIAS_CORRIDOS", tratamentoFimDeSemana: "CONTA", tratamentoFeriado: "CONTA", quantidade: 5, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" })
  const utilAnterior = calcularPrazoGeral(segunda, { unidade: "DIAS_CORRIDOS", tratamentoFimDeSemana: "CONTA", tratamentoFeriado: "CONTA", quantidade: 5, politicaDataNaoUtil: "DIA_UTIL_ANTERIOR" })
  check("5.1) PROXIMO_DIA_UTIL empurra o sábado 14/03 pra frente = seg 16/03", proximoUtil && ymd(proximoUtil) === "2026-03-16", proximoUtil && ymd(proximoUtil))
  check("5.2) DIA_UTIL_ANTERIOR empurra o MESMO bruto pra trás = sex 13/03", utilAnterior && ymd(utilAnterior) === "2026-03-13", utilAnterior && ymd(utilAnterior))
  check("5.3) mesmo bruto, direções opostas, resultados diferentes", ymd(proximoUtil!) !== ymd(utilAnterior!))

  // ══════════════════════════════════════════════════════════════════════
  secao("6) horarioLimite — aplica a HORA certa na data final")
  // ══════════════════════════════════════════════════════════════════════
  const comHorario = calcularPrazoGeral(segunda, { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL", horarioLimite: "17:30" })
  check("6.1) horarioLimite \"17:30\" fica gravado na data final (17:30 em América/São_Paulo)", comHorario && horaEm(comHorario) === "17:30", comHorario && horaEm(comHorario))
  const semHorario = calcularPrazoGeral(segunda, { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", quantidade: 3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL", horarioLimite: null })
  check("6.2) sem horarioLimite, a data final mantém a hora da base (meio-dia UTC = 09h em SP)", semHorario && horaEm(semHorario) === "09:00", semHorario && horaEm(semHorario))
  check("6.3) mesma data-base (dia), horários diferentes conforme horarioLimite", comHorario && semHorario && ymd(comHorario) === ymd(semHorario) && horaEm(comHorario) !== horaEm(semHorario))

  // ══════════════════════════════════════════════════════════════════════
  secao("7) quantidade <= 0 — NUNCA inventa prazo, devolve null")
  // ══════════════════════════════════════════════════════════════════════
  const paramsBase: ParametrosContagemDias = { unidade: "DIAS_UTEIS", tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA" }
  check("7.1) calcularPrazoGeral com quantidade=0 → null", calcularPrazoGeral(segunda, { ...paramsBase, quantidade: 0, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" }) === null)
  check("7.2) calcularPrazoGeral com quantidade negativa → null", calcularPrazoGeral(segunda, { ...paramsBase, quantidade: -3, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" }) === null)
  check("7.3) calcularPrazoGeral com quantidade NaN → null", calcularPrazoGeral(segunda, { ...paramsBase, quantidade: NaN, politicaDataNaoUtil: "PROXIMO_DIA_UTIL" }) === null)
  check("7.4) calcularAcompanhamento com quantidade=0 → null", calcularAcompanhamento(segunda, 0, paramsBase) === null)
  check("7.5) calcularAcompanhamento com quantidade negativa → null", calcularAcompanhamento(segunda, -1, paramsBase) === null)
  check("7.6) calcularAcompanhamento com quantidade válida (>0) devolve data real", calcularAcompanhamento(segunda, 2, paramsBase) !== null)

  // ══════════════════════════════════════════════════════════════════════
  secao("8) classificarRisco — as TRÊS fronteiras exatas, com relógio controlado (fuso operacional)")
  // ══════════════════════════════════════════════════════════════════════
  // Prazo: 20/08/2026 (fixo). Antecedência de risco: 3 dias → limite de risco
  // é 17/08/2026 (prazo - 3 dias).
  const prazoRisco = sp("2026-08-20T12:00:00")
  const antecedencia = 3

  const dentro = classificarRisco(sp("2026-08-10T09:00:00"), prazoRisco, antecedencia)
  check("8.1) 10 dias antes do prazo: DENTRO_DO_PRAZO", dentro === "DENTRO_DO_PRAZO", dentro)

  const vesperaDoLimite = classificarRisco(sp("2026-08-16T23:59:00"), prazoRisco, antecedencia)
  check("8.2) um dia ANTES do limite de risco (16/08, limite é 17/08): ainda DENTRO_DO_PRAZO", vesperaDoLimite === "DENTRO_DO_PRAZO", vesperaDoLimite)

  const noLimiteExato = classificarRisco(sp("2026-08-17T00:00:00"), prazoRisco, antecedencia)
  check("8.3) EXATAMENTE no dia-limite de risco (17/08 = 20/08 - 3): PROXIMO_DO_VENCIMENTO", noLimiteExato === "PROXIMO_DO_VENCIMENTO", noLimiteExato)

  const vesperaDoPrazo = classificarRisco(sp("2026-08-19T23:00:00"), prazoRisco, antecedencia)
  check("8.4) véspera do prazo (19/08, ainda dentro da janela de risco): PROXIMO_DO_VENCIMENTO", vesperaDoPrazo === "PROXIMO_DO_VENCIMENTO", vesperaDoPrazo)

  const noDiaDoPrazo = classificarRisco(sp("2026-08-20T00:05:00"), prazoRisco, antecedencia)
  check("8.5) EXATAMENTE no dia do prazo (20/08, de madrugada): VENCIDO — vence NO DIA, não é \"próximo\"", noDiaDoPrazo === "VENCIDO", noDiaDoPrazo)
  const noDiaDoPrazoNoite = classificarRisco(sp("2026-08-20T23:59:00"), prazoRisco, antecedencia)
  check("8.6) e continua VENCIDO até o fim do mesmo dia (23h59 do dia do prazo)", noDiaDoPrazoNoite === "VENCIDO", noDiaDoPrazoNoite)

  const depoisDoPrazo = classificarRisco(sp("2026-08-25T09:00:00"), prazoRisco, antecedencia)
  check("8.7) dias depois do prazo: VENCIDO", depoisDoPrazo === "VENCIDO", depoisDoPrazo)

  check("8.8) sem prazo (null): classificarRisco devolve null — nunca inventa risco", classificarRisco(sp("2026-08-20T09:00:00"), null, antecedencia) === null)

  // ══════════════════════════════════════════════════════════════════════
  secao("9) acompanhamentoVencido — hoje ou passado é true; futuro é false; sem data é false")
  // ══════════════════════════════════════════════════════════════════════
  const proximoAcomp = sp("2026-08-20T09:00:00")
  check("9.1) mesmo dia, mais tarde: vencido", acompanhamentoVencido(sp("2026-08-20T23:00:00"), proximoAcomp) === true)
  check("9.2) mesmo dia, mesma hora: vencido", acompanhamentoVencido(sp("2026-08-20T09:00:00"), proximoAcomp) === true)
  check("9.3) um dia depois: vencido", acompanhamentoVencido(sp("2026-08-21T00:05:00"), proximoAcomp) === true)
  check("9.4) um dia antes: NÃO vencido", acompanhamentoVencido(sp("2026-08-19T23:59:00"), proximoAcomp) === false)
  check("9.5) proximoAcompanhamentoEm null: NÃO vencido (nunca inventa vencimento)", acompanhamentoVencido(sp("2026-08-25T09:00:00"), null) === false)

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${ok + falhou} | ✅ ${ok} | ❌ ${falhou}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  process.exit(falhou > 0 ? 1 : 0)
}

main()
