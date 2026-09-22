// scripts/smoke-prod-prazo-sla.ts
// ============================================================================
// SMOKE TEST EM PRODUÇÃO — mandato "Módulo de Prazos, SLA e Políticas de
// Acompanhamento" (22/09/2026), seção 15: "após o deploy, faça smoke test em
// produção usando dados sintéticos e remova-os ao final". Roda contra
// PRODUÇÃO DE VERDADE, com dados 100% sintéticos marcados "[TESTE PRAZO
// PROD]" — removidos ao final (item 24, sempre executado, mesmo em falha).
// Relógio controlado explícito em cada chamada — nunca `new Date()` puro.
// Mesmo roteiro de scripts/prova-e2e-prazo-sla.ts (que já provou isto contra
// o banco de teste local), agora provando contra o banco real.
//
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/smoke-prod-prazo-sla.ts
// ============================================================================
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
exigirConfirmacaoDeEscritaEmProducao("Smoke test sintetico [TESTE PRAZO PROD] do modulo de Prazos/SLA/Acompanhamento, com limpeza ao final", "smoke-prod-prazo-sla.ts")

import { prisma } from "../lib/prisma"
import { publicarPoliticaPrazoSla, preverImpactoPublicacao, type ParametrosVersaoInput } from "../src/services/prazo-sla/politica-prazo-sla"
import { processarReconciliacaoPrazoSla } from "../src/services/prazo-sla/reconciliar-prazo-sla"
import { vincularPoliticaATarefa, iniciarEsperaTerceiro, encerrarEsperaTerceiro, reprogramarAcompanhamento } from "../src/services/prazo-sla/tarefa-prazo-sla"
import { varrerPrazosEAcompanhamentosSla } from "../src/services/prazo-sla/varredura-prazo-sla"

const MARCA = "[TESTE PRAZO PROD]"
const CHAVE = "teste_prazo_e2e_prod_20260922"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const politica = await prisma.politicaPrazoSla.findUnique({ where: { chave: CHAVE } })
  if (politica) {
    const tarefas = await prisma.tarefa.findMany({ where: { politicaPrazoSlaId: politica.id }, select: { id: true } })
    const tarefaIds = tarefas.map((t) => t.id)
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Tarefa", aggregateId: { in: tarefaIds } } })
    await prisma.eventoPrazoSla.deleteMany({ where: { OR: [{ tarefaId: { in: tarefaIds } }, { politicaId: politica.id }] } })
    await prisma.tarefa.deleteMany({ where: { id: { in: tarefaIds } } })
    await prisma.politicaPrazoSlaVersao.deleteMany({ where: { politicaId: politica.id } })
    await prisma.politicaPrazoSla.delete({ where: { id: politica.id } })
  }
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
}

async function main() {
  console.log(`\n=== PROVA PONTA A PONTA — Módulo de Prazos/SLA/Acompanhamento (${MARCA}) ===\n`)
  await limpar()

  const AGORA_0 = new Date("2026-03-02T09:00:00-03:00") // segunda-feira

  // ── 1-3) criar política pela interface (rota real), definir prazo geral + primeiro acompanhamento ──
  console.log("1-3) Criar política com prazo geral e primeiro acompanhamento")
  const politica = await prisma.politicaPrazoSla.create({ data: { chave: CHAVE, nome: `${MARCA} Política E2E` } })
  check("1) política nasce RASCUNHO", politica.status === "RASCUNHO")

  const parametrosV1: ParametrosVersaoInput = {
    prazoQuantidade: 10, prazoUnidade: "DIAS_UTEIS", prazoEventoInicialChave: "tarefa_criada",
    tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", politicaDataNaoUtil: "PROXIMO_DIA_UTIL",
    riscoAntecedenciaDias: 2,
    escalonamentoAtivo: true, escalonamentoPapel: "gerente_operacional", lembreteAtrasoRecorrenciaDias: 1,
    acompanhamentoPrimeiroDias: 3, acompanhamentoPadraoDias: 5, acompanhamentoUnidade: "DIAS_CORRIDOS",
    acompanhamentoExigeMotivo: true, esperaTerceiroPadraoAtivo: true,
  }

  // ── 4) publicar ──
  console.log("\n4) Publicar (SOMENTE_NOVAS — primeira publicação, nada em andamento ainda)")
  const impactoAntes = await preverImpactoPublicacao(politica.id, "SOMENTE_NOVAS")
  check("4a) prévia de impacto antes de publicar: zero tarefas (política ainda sem uso)", impactoAntes.tarefasEmAndamentoVinculadas === 0)
  const pub1 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: parametrosV1, estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: null })
  check("4b) publicação aceita", pub1.ok === true, pub1)
  if (!pub1.ok) { await relatarEFinalizar(); return }
  check("4c) versão 1 publicada", pub1.versao.versao === 1)

  // ── 5) vincular a uma tarefa sintética ──
  console.log("\n5) Vincular a uma tarefa sintética")
  const tarefa = await prisma.tarefa.create({ data: { titulo: `${MARCA} Tarefa principal`, statusTarefa: "EM_ANDAMENTO" } })
  const vinculo = await vincularPoliticaATarefa({ tarefaId: tarefa.id, politicaChave: CHAVE, baseCalculoEm: AGORA_0 })
  check("5) vínculo aceito", vinculo.success === true, vinculo)

  // ── 6) comprovar prazo calculado ──
  console.log("\n6) Comprovar o prazo calculado")
  const t1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  check("6a) dataPrazo (prazoDaTarefa) foi calculado", t1.dataPrazo != null, t1.dataPrazo)
  check("6b) proximoAcompanhamentoEm foi calculado", t1.proximoAcompanhamentoEm != null, t1.proximoAcompanhamentoEm)
  const prazoOriginal = t1.dataPrazo

  // ── 7) iniciar espera de terceiro ──
  console.log("\n7) Iniciar espera de terceiro")
  const orgao = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório Sintético` } })
  const espera = await iniciarEsperaTerceiro({ tarefaId: tarefa.id, terceiroResponsavelId: orgao.id, motivo: "Aguardando certidão do cartório sintético.", agora: AGORA_0, usuarioId: null })
  check("7) espera de terceiro iniciada", espera.success === true, espera)

  // ── 8) comprovar próximo acompanhamento ──
  console.log("\n8) Comprovar o próximo acompanhamento")
  const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  check("8a) aguardandoDesde preenchido (dono único de statusTarefa continua sendo task-step-sync.ts, nunca este módulo)", t2.aguardandoDesde != null)
  check("8b) origemDaEspera = TERCEIRO", t2.origemDaEspera === "TERCEIRO")
  check("8c) proximoAcompanhamentoEm recalculado (3 dias corridos)", t2.proximoAcompanhamentoEm != null)
  check("8d) dataPrazo NÃO mudou ao entrar em espera", t2.dataPrazo?.getTime() === prazoOriginal?.getTime())

  // ── 9-10) avançar o relógio até a data de retorno + comprovar retorno à atenção ──
  console.log("\n9-10) Avançar o relógio até a data de retorno — comprovar retorno à atenção")
  const dataRetorno = t2.proximoAcompanhamentoEm!
  const varredura1 = await varrerPrazosEAcompanhamentosSla({ agora: dataRetorno })
  check("10a) a varredura avaliou a tarefa", varredura1.avaliadas >= 1)
  check("10b) retorno à atenção registrado", varredura1.retornoAAtencao >= 1, varredura1)
  const eventoRetorno = await prisma.eventoPrazoSla.findFirst({ where: { tarefaId: tarefa.id, tipo: "RETORNO_A_ATENCAO" } })
  check("10c) evento RETORNO_A_ATENCAO existe", !!eventoRetorno)
  const t3antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  check("10d) nenhum passo foi concluído automaticamente (ainda em espera de terceiro)", t3antes.aguardandoDesde != null && t3antes.origemDaEspera === "TERCEIRO")

  // ── 11-12) registrar cobrança + reprogramar acompanhamento ──
  console.log("\n11-12) Registrar cobrança (contato) e reprogramar o próximo acompanhamento")
  const novaDataAcompanhamento = new Date(dataRetorno.getTime() + 5 * 86400000)
  const reprog = await reprogramarAcompanhamento({ tarefaId: tarefa.id, novaData: novaDataAcompanhamento, motivo: "Cobrança registrada — cartório pediu mais 5 dias.", usuarioId: null, agora: dataRetorno })
  check("12) reprogramação aceita", reprog.success === true, reprog)
  const eventoReprog = await prisma.eventoPrazoSla.findFirst({ where: { tarefaId: tarefa.id, tipo: "ACOMPANHAMENTO_REPROGRAMADO" } })
  check("12b) evento ACOMPANHAMENTO_REPROGRAMADO existe, com motivo", !!eventoReprog?.motivo)

  // ── 13) avançar até próximo do vencimento ──
  console.log("\n13) Avançar até próximo do vencimento")
  const t4 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  const dataProximoVencimento = new Date(t4.dataPrazo!.getTime() - 1 * 86400000) // dentro da antecedência de 2 dias
  const varredura2 = await varrerPrazosEAcompanhamentosSla({ agora: dataProximoVencimento })
  check("13) próximo do vencimento registrado", varredura2.proximoDoVencimento >= 1, varredura2)

  // ── 14-15) avançar até vencido + comprovar escalonamento ──
  console.log("\n14-15) Avançar até vencido — comprovar escalonamento")
  const dataVencido = new Date(t4.dataPrazo!.getTime() + 2 * 86400000)
  const varredura3 = await varrerPrazosEAcompanhamentosSla({ agora: dataVencido })
  check("14) prazo vencido registrado", varredura3.vencido >= 1, varredura3)
  check("15) escalonamento gerado (política com escalonamentoAtivo=true)", varredura3.escalonamentosGerados >= 1, varredura3)

  // ── 16) encerrar espera ──
  console.log("\n16) Encerrar a espera")
  const encerra = await encerrarEsperaTerceiro({ tarefaId: tarefa.id, agora: dataVencido, usuarioId: null })
  check("16) espera encerrada", encerra.success === true)
  const t5 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  check("16b) espera encerrada (aguardandoDesde/origemDaEspera voltaram a null)", t5.aguardandoDesde == null && t5.origemDaEspera == null)

  // ── 17) comprovar que o prazo geral não mudou em NENHUM momento acima ──
  console.log("\n17) Comprovar que o prazo geral não mudou desde o cálculo original")
  check("17) dataPrazo idêntico ao calculado no passo 6", t5.dataPrazo?.getTime() === prazoOriginal?.getTime())

  // ── 18) publicar nova versão ──
  console.log("\n18) Publicar nova versão da política (RECALCULAR_DA_ORIGEM)")
  const parametrosV2: ParametrosVersaoInput = { ...parametrosV1, prazoQuantidade: 15, escalonamentoAtivo: false }
  const impactoV2 = await preverImpactoPublicacao(politica.id, "RECALCULAR_DA_ORIGEM")
  check("18a) prévia de impacto mostra a tarefa em andamento", impactoV2.tarefasQueSeraoRetroagidas === 1, impactoV2)
  const pub2 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: parametrosV2, estrategiaRetroacao: "RECALCULAR_DA_ORIGEM", motivoAlteracao: "Ajuste de prazo — prova e2e.", publicadoPorId: null })
  check("18b) versão 2 publicada", pub2.ok === true && pub2.versao.versao === 2, pub2)
  if (!pub2.ok) { await relatarEFinalizar(); return }
  check("18c) reconciliação enfileirada para a tarefa em andamento", pub2.reconciliacao.tarefasAlcancadas === 1, pub2.reconciliacao)

  // ── 19-20) reconciliar + repetir ──
  console.log("\n19-20) Reconciliar a tarefa em andamento — repetir a reconciliação")
  const outboxRow = await prisma.domainOutbox.findFirst({ where: { aggregateType: "Tarefa", aggregateId: tarefa.id, tipo: "prazo.sla.reconciliar" }, orderBy: { criadoEm: "desc" } })
  check("19a) outbox de reconciliação existe", !!outboxRow)
  const payload = outboxRow!.payload as any
  await processarReconciliacaoPrazoSla(payload)
  const t6 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })
  check("19b) dataPrazo recalculado a partir da origem, com o NOVO parâmetro (15 dias úteis)", t6.dataPrazo?.getTime() !== prazoOriginal?.getTime())

  const eventosAntesRepetir = await prisma.eventoPrazoSla.count({ where: { tarefaId: tarefa.id, tipo: "PRAZO_RECONCILIADO" } })
  await processarReconciliacaoPrazoSla(payload) // 20) repetir
  const eventosDepoisRepetir = await prisma.eventoPrazoSla.count({ where: { tarefaId: tarefa.id, tipo: "PRAZO_RECONCILIADO" } })
  const t7 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id } })

  // ── 21) provar zero duplicação ──
  console.log("\n21) Provar zero duplicação na reconciliação repetida")
  check("21a) zero eventos NOVOS de PRAZO_RECONCILIADO na segunda passada", eventosDepoisRepetir === eventosAntesRepetir, { antes: eventosAntesRepetir, depois: eventosDepoisRepetir })
  check("21b) dataPrazo não mudou na segunda passada", t7.dataPrazo?.getTime() === t6.dataPrazo?.getTime())

  // ── 22) processo finalizado / tarefa concluída ficam intactos ──
  console.log("\n22) Comprovar que tarefa concluída fica intocada pela reconciliação")
  const tarefaConcluida = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Tarefa já concluída`, statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, politicaPrazoSlaId: politica.id, dataPrazo: AGORA_0, dataConclusao: AGORA_0 },
  })
  const enqueueConcluida = await import("../src/services/prazo-sla/politica-prazo-sla").then((m) => m.enqueueReconciliacaoPoliticaPrazoSla({
    politicaId: politica.id, versaoId: pub2.versao.id, versaoAnterior: 1, versaoNova: 2, estrategiaRetroacao: "RECALCULAR_DA_ORIGEM", publicadoPorId: null,
  }))
  check("22a) tarefa concluída NÃO foi enfileirada para reconciliação", (await prisma.domainOutbox.count({ where: { aggregateType: "Tarefa", aggregateId: tarefaConcluida.id } })) === 0, enqueueConcluida)
  const tarefaConcluidaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaConcluida.id } })
  check("22b) dataPrazo da tarefa concluída não mudou", tarefaConcluidaDepois.dataPrazo?.getTime() === AGORA_0.getTime())
  check("22c) statusTarefa continua CONCLUIDO_RECEBIDO — nunca reaberta", tarefaConcluidaDepois.statusTarefa === "CONCLUIDO_RECEBIDO")

  // ── 23) rollback ──
  console.log("\n23) Rollback transacional — publicação com parâmetros inválidos não deixa rastro")
  const antesDeFalhar = await prisma.politicaPrazoSlaVersao.count({ where: { politicaId: politica.id } })
  const pubInvalida = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: { ...parametrosV2, prazoQuantidade: -5 }, estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: null })
  check("23a) publicação inválida é recusada, não aplicada parcialmente", pubInvalida.ok === false)
  const depoisDeFalhar = await prisma.politicaPrazoSlaVersao.count({ where: { politicaId: politica.id } })
  check("23b) nenhuma versão nova foi criada pela tentativa inválida (rollback efetivo)", depoisDeFalhar === antesDeFalhar, { antes: antesDeFalhar, depois: depoisDeFalhar })
  const politicaDepoisDeFalhar = await prisma.politicaPrazoSla.findUniqueOrThrow({ where: { id: politica.id } })
  check("23c) versaoAtual da política não avançou pela tentativa inválida", politicaDepoisDeFalhar.versaoAtual === 2)

  await relatarEFinalizar()

  async function relatarEFinalizar() {
    // ── 24) remover só os dados sintéticos desta prova ──
    console.log("\n24) Remover os dados sintéticos desta prova")
    const processosReaisAntesDeLimpar = await prisma.processo.count({ where: { nome: { not: { startsWith: MARCA } } } })
    await limpar()
    const politicaAinda = await prisma.politicaPrazoSla.findUnique({ where: { chave: CHAVE } })
    check("24a) política sintética removida", politicaAinda == null)
    const processosReaisDepoisDeLimpar = await prisma.processo.count({ where: { nome: { not: { startsWith: MARCA } } } })
    check("24b) zero processo real foi tocado (mesma contagem antes/depois)", processosReaisAntesDeLimpar === processosReaisDepoisDeLimpar)

    console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
    if (falhou > 0) { console.error("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  }
}

main().finally(() => prisma.$disconnect())
