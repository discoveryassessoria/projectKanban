// scripts/prazo-sla-politica-e-reconciliacao.test.ts
// ============================================================================
// CICLO DE VIDA DA POLÍTICA DE PRAZO/SLA + RECONCILIAÇÃO + IDEMPOTÊNCIA —
// mandato "Módulo de Prazos, SLA e Políticas de Acompanhamento" (22/09/2026).
// Prova, contra o BANCO DE TESTE local:
//   • criar/editar política RASCUNHO;
//   • validarParametrosVersao recusa configuração inválida, com o código certo;
//   • publicar congela PoliticaPrazoSlaVersao (versão 1, 2, 3…) — histórico
//     preservado, nunca sobrescrito;
//   • unicidade (politicaId, versao) É do BANCO, não só da regra de negócio;
//   • preverImpactoPublicacao ANTES de publicar;
//   • publicar ENFILEIRA no DomainOutbox (nunca aplica na hora);
//   • processarReconciliacaoPrazoSla é o EFEITO — lido do outbox real, nunca
//     inventado — e é IDEMPOTENTE (rodar 2x não duplica EventoPrazoSla nem
//     muda a Tarefa de novo);
//   • Tarefa concluída NUNCA é tocada pela reconciliação (nem enfileirada);
//   • SOMENTE_NOVAS não enfileira nada; MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO
//     muda só o acompanhamento, nunca o prazo.
//
// Rodar (banco de teste LOCAL apenas — exigirBancoDeTeste trava produção):
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/prazo-sla-politica-e-reconciliacao.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prazo-sla-politica-e-reconciliacao.test.ts")

import { prisma } from "../lib/prisma"
import {
  validarParametrosVersao,
  publicarPoliticaPrazoSla,
  preverImpactoPublicacao,
  TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA,
  type ParametrosVersaoInput,
} from "../src/services/prazo-sla/politica-prazo-sla"
import { processarReconciliacaoPrazoSla, type ReconciliacaoPrazoSlaPayload } from "../src/services/prazo-sla/reconciliar-prazo-sla"
import { calcularPrazoGeral, calcularAcompanhamento, type ParametrosContagemDias } from "../lib/operacional/motor-prazo-sla"

const MARCA = "PRZSLA2"
const CHAVE = `${MARCA.toLowerCase()}_politica`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean | null | undefined, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}
function secao(t: string) { console.log(`\n${t}`) }

async function limpar() {
  const tarefas = await prisma.tarefa.findMany({ where: { titulo: { startsWith: `[${MARCA}]` } }, select: { id: true } })
  const tarefaIds = tarefas.map((t) => t.id)
  await prisma.eventoPrazoSla.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Tarefa", aggregateId: { in: tarefaIds } } })
  await prisma.tarefa.deleteMany({ where: { id: { in: tarefaIds } } })

  const politicas = await prisma.politicaPrazoSla.findMany({ where: { chave: { startsWith: MARCA.toLowerCase() } }, select: { id: true } })
  const politicaIds = politicas.map((p) => p.id)
  await prisma.eventoPrazoSla.deleteMany({ where: { politicaId: { in: politicaIds } } })
  await prisma.politicaPrazoSlaVersao.deleteMany({ where: { politicaId: { in: politicaIds } } })
  await prisma.politicaPrazoSla.deleteMany({ where: { id: { in: politicaIds } } })
}

/** Parâmetros válidos-base — cada teste de validação sobrescreve só o campo que quer quebrar. */
function paramsValidos(overrides: Partial<ParametrosVersaoInput> = {}): ParametrosVersaoInput {
  return {
    prazoQuantidade: 5,
    prazoUnidade: "DIAS_UTEIS",
    prazoEventoInicialChave: `${MARCA.toLowerCase()}_evento_inicial`,
    tratamentoFimDeSemana: "PULA",
    tratamentoFeriado: "PULA",
    politicaDataNaoUtil: "PROXIMO_DIA_UTIL",
    riscoAntecedenciaDias: 2,
    acompanhamentoPrimeiroDias: 2,
    acompanhamentoPadraoDias: 3,
    acompanhamentoUnidade: "DIAS_UTEIS",
    ...overrides,
  }
}

const contagemDe = (v: { prazoUnidade: string; tratamentoFimDeSemana: string; tratamentoFeriado: string }): ParametrosContagemDias => ({
  unidade: v.prazoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS",
  tratamentoFimDeSemana: v.tratamentoFimDeSemana as "PULA" | "CONTA",
  tratamentoFeriado: v.tratamentoFeriado as "PULA" | "CONTA",
})

async function outboxPayloadDaTarefa(tarefaId: number, versaoNova: number): Promise<ReconciliacaoPrazoSlaPayload> {
  const linha = await prisma.domainOutbox.findUnique({
    where: { chaveIdempotencia: `${TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA}::${tarefaId}::v${versaoNova}` },
  })
  if (!linha) throw new Error(`DomainOutbox não encontrado para tarefa=${tarefaId} versaoNova=${versaoNova} — teste mal montado`)
  return linha.payload as unknown as ReconciliacaoPrazoSlaPayload
}

async function main() {
  console.log(`\n=== Política de Prazo/SLA — ciclo de vida + reconciliação + idempotência (${MARCA}) ===\n`)
  await limpar()

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CRIAR política (nasce RASCUNHO) e EDITAR o rascunho")
  // ══════════════════════════════════════════════════════════════════════
  const politica = await prisma.politicaPrazoSla.create({
    data: { chave: CHAVE, nome: `[${MARCA}] Política original`, status: "RASCUNHO" },
  })
  check("1.1) nasce RASCUNHO", politica.status === "RASCUNHO")
  check("1.2) nasce com versaoAtual=0 (nenhuma versão publicada ainda)", politica.versaoAtual === 0)

  const politicaEditada = await prisma.politicaPrazoSla.update({ where: { id: politica.id }, data: { nome: `[${MARCA}] Política editada`, descricao: "descrição editada" } })
  check("1.3) editar rascunho muda nome/descrição", politicaEditada.nome === `[${MARCA}] Política editada` && politicaEditada.descricao === "descrição editada")
  check("1.4) editar rascunho NÃO mexe em status/versaoAtual", politicaEditada.status === "RASCUNHO" && politicaEditada.versaoAtual === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) validarParametrosVersao — bloqueia configuração inválida, cada erro com o código certo")
  // ══════════════════════════════════════════════════════════════════════
  const erroPrazo = validarParametrosVersao(paramsValidos({ prazoQuantidade: 0 }))
  check("2.1) prazo <= 0 → PRAZO_INVALIDO", erroPrazo.some((e) => e.codigo === "PRAZO_INVALIDO" && e.campo === "prazoQuantidade"), erroPrazo)
  const erroPrazoNeg = validarParametrosVersao(paramsValidos({ prazoQuantidade: -5 }))
  check("2.2) prazo negativo também → PRAZO_INVALIDO", erroPrazoNeg.some((e) => e.codigo === "PRAZO_INVALIDO"))

  const erroAcompPrimeiro = validarParametrosVersao(paramsValidos({ acompanhamentoPrimeiroDias: 0 }))
  check("2.3) acompanhamentoPrimeiroDias <= 0 → ACOMPANHAMENTO_INVALIDO", erroAcompPrimeiro.some((e) => e.codigo === "ACOMPANHAMENTO_INVALIDO" && e.campo === "acompanhamentoPrimeiroDias"), erroAcompPrimeiro)
  const erroAcompPadrao = validarParametrosVersao(paramsValidos({ acompanhamentoPadraoDias: -1 }))
  check("2.4) acompanhamentoPadraoDias <= 0 → ACOMPANHAMENTO_INVALIDO", erroAcompPadrao.some((e) => e.codigo === "ACOMPANHAMENTO_INVALIDO" && e.campo === "acompanhamentoPadraoDias"), erroAcompPadrao)

  const erroUnidade = validarParametrosVersao(paramsValidos({ prazoUnidade: undefined as unknown as "DIAS_UTEIS" }))
  check("2.5) unidade do prazo ausente → UNIDADE_INEXISTENTE", erroUnidade.some((e) => e.codigo === "UNIDADE_INEXISTENTE" && e.campo === "prazoUnidade"), erroUnidade)

  const erroEvento = validarParametrosVersao(paramsValidos({ prazoEventoInicialChave: "" }))
  check("2.6) evento inicial ausente → EVENTO_INICIAL_AUSENTE", erroEvento.some((e) => e.codigo === "EVENTO_INICIAL_AUSENTE" && e.campo === "prazoEventoInicialChave"), erroEvento)
  const erroEventoSoEspaco = validarParametrosVersao(paramsValidos({ prazoEventoInicialChave: "   " }))
  check("2.7) evento inicial só espaço em branco também → EVENTO_INICIAL_AUSENTE", erroEventoSoEspaco.some((e) => e.codigo === "EVENTO_INICIAL_AUSENTE"))

  const erroAntecedencia = validarParametrosVersao(paramsValidos({ riscoAntecedenciaDias: -1 }))
  check("2.8) antecedência de risco negativa → ANTECEDENCIA_INVALIDA", erroAntecedencia.some((e) => e.codigo === "ANTECEDENCIA_INVALIDA" && e.campo === "riscoAntecedenciaDias"), erroAntecedencia)
  check("2.9) antecedência ZERO é válida (não é negativa)", validarParametrosVersao(paramsValidos({ riscoAntecedenciaDias: 0 })).length === 0)

  check("2.10) configuração inteiramente válida não gera erro nenhum", validarParametrosVersao(paramsValidos()).length === 0)

  // publicarPoliticaPrazoSla recusa a mesma configuração inválida (não é só a função solta)
  const publicacaoInvalida = await publicarPoliticaPrazoSla({
    politicaId: politica.id, parametros: paramsValidos({ prazoQuantidade: 0 }), estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: null,
  })
  check("2.11) publicarPoliticaPrazoSla também recusa configuração inválida (ok:false)", publicacaoInvalida.ok === false)
  const politicaAindaRascunho = await prisma.politicaPrazoSla.findUniqueOrThrow({ where: { id: politica.id } })
  check("2.12) publicação recusada NÃO mudou o status/versaoAtual", politicaAindaRascunho.status === "RASCUNHO" && politicaAindaRascunho.versaoAtual === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) PUBLICAR v1 — congela PoliticaPrazoSlaVersao, status vira PUBLICADA, versaoAtual vira 1")
  // ══════════════════════════════════════════════════════════════════════
  const paramsV1 = paramsValidos({ prazoQuantidade: 5 })
  const pubV1 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: paramsV1, estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: null })
  check("3.1) publicação v1 aceita (ok:true)", pubV1.ok === true, !pubV1.ok ? pubV1.erros : null)
  if (!pubV1.ok) throw new Error("publicação v1 falhou — impossível continuar a suíte")
  check("3.2) versão criada é a 1", pubV1.versao.versao === 1)
  check("3.3) versão criada guarda o prazoQuantidade informado (5)", pubV1.versao.prazoQuantidade === 5)
  const politicaAposV1 = await prisma.politicaPrazoSla.findUniqueOrThrow({ where: { id: politica.id } })
  check("3.4) status vira PUBLICADA", politicaAposV1.status === "PUBLICADA")
  check("3.5) versaoAtual vira 1", politicaAposV1.versaoAtual === 1)
  check("3.6) sem tarefa vinculada ainda: reconciliação da v1 não alcança nada", pubV1.reconciliacao.tarefasAlcancadas === 0 && pubV1.reconciliacao.outboxRegistrados === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) Tarefa sintética vinculada à v1")
  // ══════════════════════════════════════════════════════════════════════
  const D0 = new Date("2026-01-05T12:00:00.000Z") // segunda-feira, fixa
  const tarefa1 = await prisma.tarefa.create({ data: { titulo: `[${MARCA}] Tarefa em andamento`, statusTarefa: "EM_ANDAMENTO", concluida: false } })

  const { vincularPoliticaATarefa } = await import("../src/services/prazo-sla/tarefa-prazo-sla")
  const vinculo1 = await vincularPoliticaATarefa({ tarefaId: tarefa1.id, politicaChave: CHAVE, baseCalculoEm: D0 })
  check("4.1) vincular à política PUBLICADA é aceito", vinculo1.success === true)
  const tarefa1AposVinculo = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  check("4.2) prazoBaseCalculoEm gravado é o D0 informado (nunca now())", tarefa1AposVinculo.prazoBaseCalculoEm?.getTime() === D0.getTime())
  const dataPrazoAposV1 = tarefa1AposVinculo.dataPrazo
  check("4.3) dataPrazo calculado a partir da v1 (5 dias úteis de D0)", dataPrazoAposV1 !== null)
  const esperadoV1 = calcularPrazoGeral(D0, { ...contagemDe(paramsV1), quantidade: paramsV1.prazoQuantidade, politicaDataNaoUtil: paramsV1.politicaDataNaoUtil })
  check("4.4) o valor bate com o motor calculado independentemente", dataPrazoAposV1?.getTime() === esperadoV1?.getTime(), { service: dataPrazoAposV1, motor: esperadoV1 })

  // ══════════════════════════════════════════════════════════════════════
  secao("5) preverImpactoPublicacao — a contagem certa ANTES de publicar")
  // ══════════════════════════════════════════════════════════════════════
  const impactoRecalcular = await preverImpactoPublicacao(politica.id, "RECALCULAR_DA_ORIGEM")
  check("5.1) 1 tarefa em andamento vinculada", impactoRecalcular.tarefasEmAndamentoVinculadas === 1, impactoRecalcular)
  check("5.2) com RECALCULAR_DA_ORIGEM, 1 tarefa será retroagida", impactoRecalcular.tarefasQueSeraoRetroagidas === 1)
  check("5.3) a amostra inclui a tarefa1", impactoRecalcular.amostra.some((t: { id: number }) => t.id === tarefa1.id))
  const impactoSomenteNovas = await preverImpactoPublicacao(politica.id, "SOMENTE_NOVAS")
  check("5.4) com SOMENTE_NOVAS, a mesma tarefa em andamento vinculada aparece...", impactoSomenteNovas.tarefasEmAndamentoVinculadas === 1)
  check("5.5) ...mas ZERO será retroagida (a prévia já mostra que a estratégia não toca ninguém)", impactoSomenteNovas.tarefasQueSeraoRetroagidas === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("6) PUBLICAR v2 (mudança real) — versão 2 nova, v1 preservada e consultável")
  // ══════════════════════════════════════════════════════════════════════
  const paramsV2 = paramsValidos({ prazoQuantidade: 10 })
  const pubV2 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: paramsV2, estrategiaRetroacao: "RECALCULAR_DA_ORIGEM", publicadoPorId: null })
  check("6.1) publicação v2 aceita", pubV2.ok === true, !pubV2.ok ? pubV2.erros : null)
  if (!pubV2.ok) throw new Error("publicação v2 falhou — impossível continuar a suíte")
  check("6.2) versão criada é a 2", pubV2.versao.versao === 2)
  const politicaAposV2 = await prisma.politicaPrazoSla.findUniqueOrThrow({ where: { id: politica.id } })
  check("6.3) versaoAtual vira 2", politicaAposV2.versaoAtual === 2)
  check("6.4) status continua PUBLICADA", politicaAposV2.status === "PUBLICADA")
  check("6.5) a reconciliação alcançou a tarefa1 (1 tarefa, 1 outbox)", pubV2.reconciliacao.tarefasAlcancadas === 1 && pubV2.reconciliacao.outboxRegistrados === 1, pubV2.reconciliacao)

  const v1Historico = await prisma.politicaPrazoSlaVersao.findUniqueOrThrow({ where: { politicaId_versao: { politicaId: politica.id, versao: 1 } } })
  check("6.6) v1 CONTINUA existindo, intacta, com o prazoQuantidade original (5)", v1Historico.prazoQuantidade === 5)
  const v2Lida = await prisma.politicaPrazoSlaVersao.findUniqueOrThrow({ where: { politicaId_versao: { politicaId: politica.id, versao: 2 } } })
  check("6.7) v2 tem o NOVO prazoQuantidade (10)", v2Lida.prazoQuantidade === 10)
  check("6.8) histórico tem as DUAS versões — nenhuma foi sobrescrita", (await prisma.politicaPrazoSlaVersao.count({ where: { politicaId: politica.id } })) === 2)

  // ══════════════════════════════════════════════════════════════════════
  secao("7) UNICIDADE (politicaId, versao) — é do BANCO, não só da regra de negócio")
  // ══════════════════════════════════════════════════════════════════════
  let unicidadeDoBanco = false
  try {
    await prisma.politicaPrazoSlaVersao.create({
      data: {
        politicaId: politica.id, versao: 2, // MESMA versão de novo — deve bater na constraint única
        prazoQuantidade: 999, prazoUnidade: "DIAS_UTEIS", prazoEventoInicialChave: "duplicata_proibida",
        tratamentoFimDeSemana: "PULA", tratamentoFeriado: "PULA", politicaDataNaoUtil: "PROXIMO_DIA_UTIL",
        riscoAntecedenciaDias: 1, acompanhamentoPrimeiroDias: 1, acompanhamentoPadraoDias: 1, acompanhamentoUnidade: "DIAS_UTEIS",
        estrategiaRetroacao: "SOMENTE_NOVAS",
      },
    })
  } catch (e: unknown) {
    unicidadeDoBanco = (e as { code?: string })?.code === "P2002"
  }
  check("7.1) o ÍNDICE do banco (não só a rota/service) impede duas versões iguais pra mesma política", unicidadeDoBanco)
  check("7.2) a tentativa duplicada não criou linha nenhuma a mais", (await prisma.politicaPrazoSlaVersao.count({ where: { politicaId: politica.id } })) === 2)

  // ══════════════════════════════════════════════════════════════════════
  secao("8) RECONCILIAÇÃO — o payload é lido do DomainOutbox REAL (não inventado), e é IDEMPOTENTE")
  // ══════════════════════════════════════════════════════════════════════
  const payloadV2 = await outboxPayloadDaTarefa(tarefa1.id, 2)
  check("8.1) o payload do outbox referencia a tarefa1 certa", payloadV2.tarefaId === tarefa1.id)
  check("8.2) e a versão nova certa (2)", payloadV2.versaoNova === 2)

  await processarReconciliacaoPrazoSla(payloadV2)
  const tarefa1AposReconciliacao1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  const esperadoV2 = calcularPrazoGeral(D0, { ...contagemDe(paramsV2), quantidade: paramsV2.prazoQuantidade, politicaDataNaoUtil: paramsV2.politicaDataNaoUtil })
  check("8.3) dataPrazo mudou conforme o NOVO parâmetro (10 dias úteis), a partir da prazoBaseCalculoEm ORIGINAL (D0)",
    tarefa1AposReconciliacao1.dataPrazo?.getTime() === esperadoV2?.getTime(), { depois: tarefa1AposReconciliacao1.dataPrazo, esperado: esperadoV2 })
  check("8.4) e é DIFERENTE do valor da v1 (a reconciliação teve efeito real)", tarefa1AposReconciliacao1.dataPrazo?.getTime() !== dataPrazoAposV1?.getTime())
  check("8.5) politicaPrazoSlaVersaoId da tarefa agora aponta pra v2", tarefa1AposReconciliacao1.politicaPrazoSlaVersaoId === v2Lida.id)

  const chaveReconciliado = `PRAZO_RECONCILIADO::${tarefa1.id}::v2`
  const eventosAntesDaSegunda = await prisma.eventoPrazoSla.count({ where: { chaveIdempotencia: chaveReconciliado } })
  check("8.6) exatamente 1 EventoPrazoSla PRAZO_RECONCILIADO registrado", eventosAntesDaSegunda === 1)

  // MESMO payload, RODADO DE NOVO — idempotência real.
  await processarReconciliacaoPrazoSla(payloadV2)
  const tarefa1AposReconciliacao2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  check("8.7) rodar a MESMA reconciliação 2x: dataPrazo NÃO muda de novo", tarefa1AposReconciliacao2.dataPrazo?.getTime() === tarefa1AposReconciliacao1.dataPrazo?.getTime())
  const eventosDepoisDaSegunda = await prisma.eventoPrazoSla.count({ where: { chaveIdempotencia: chaveReconciliado } })
  check("8.8) e ZERO EventoPrazoSla duplicado (mesma chaveIdempotencia, mesma contagem antes/depois)", eventosDepoisDaSegunda === eventosAntesDaSegunda && eventosDepoisDaSegunda === 1)

  // ══════════════════════════════════════════════════════════════════════
  secao("9) TAREFA CONCLUÍDA — NUNCA tocada pela reconciliação, nem enfileirada no outbox")
  // ══════════════════════════════════════════════════════════════════════
  const D0b = new Date("2026-01-06T12:00:00.000Z")
  const tarefa2 = await prisma.tarefa.create({ data: { titulo: `[${MARCA}] Tarefa concluída`, statusTarefa: "EM_ANDAMENTO", concluida: false } })
  const vinculo2 = await vincularPoliticaATarefa({ tarefaId: tarefa2.id, politicaChave: CHAVE, baseCalculoEm: D0b })
  check("9.1) tarefa2 vinculada com sucesso (ainda em andamento neste instante)", vinculo2.success === true)
  await prisma.tarefa.update({ where: { id: tarefa2.id }, data: { concluida: true, statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date("2026-01-10T12:00:00.000Z") } })
  const tarefa2Concluida = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa2.id } })
  const dataPrazoTarefa2Antes = tarefa2Concluida.dataPrazo

  const paramsV3 = paramsValidos({ prazoQuantidade: 15 })
  const pubV3 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: paramsV3, estrategiaRetroacao: "RECALCULAR_DA_ORIGEM", publicadoPorId: null })
  check("9.2) publicação v3 aceita", pubV3.ok === true)
  if (!pubV3.ok) throw new Error("publicação v3 falhou")
  check("9.3) só a tarefa1 (não concluída) foi alcançada — tarefa2 concluída ficou de fora", pubV3.reconciliacao.tarefasAlcancadas === 1 && pubV3.reconciliacao.outboxRegistrados === 1, pubV3.reconciliacao)

  const outboxTarefa2 = await prisma.domainOutbox.findFirst({ where: { aggregateType: "Tarefa", aggregateId: tarefa2.id, tipo: TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA } })
  check("9.4) NENHUM DomainOutbox foi criado para a tarefa concluída", outboxTarefa2 === null)

  const tarefa2AposV3 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa2.id } })
  check("9.5) dataPrazo da tarefa2 é IDÊNTICO a antes (nunca foi tocada)", tarefa2AposV3.dataPrazo?.getTime() === dataPrazoTarefa2Antes?.getTime())

  // Guarda dupla: mesmo que alguém chamasse processarReconciliacaoPrazoSla
  // manualmente para a tarefa2 (bypassando o enqueue), o EFEITO se recusa a
  // tocar tarefa concluída — a proteção não depende só do filtro do enqueue.
  const v3 = await prisma.politicaPrazoSlaVersao.findUniqueOrThrow({ where: { politicaId_versao: { politicaId: politica.id, versao: 3 } } })
  await processarReconciliacaoPrazoSla({ tarefaId: tarefa2.id, politicaId: politica.id, versaoId: v3.id, versaoAnterior: 2, versaoNova: 3, estrategiaRetroacao: "RECALCULAR_DA_ORIGEM", publicadoPorId: null })
  const tarefa2AposTentativaManual = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa2.id } })
  check("9.6) mesmo chamando o EFEITO diretamente pra tarefa concluída, dataPrazo continua intacto", tarefa2AposTentativaManual.dataPrazo?.getTime() === dataPrazoTarefa2Antes?.getTime())
  check("9.7) e nenhum EventoPrazoSla PRAZO_RECONCILIADO foi gravado pra ela", (await prisma.eventoPrazoSla.count({ where: { tarefaId: tarefa2.id, tipo: "PRAZO_RECONCILIADO" } })) === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("10) ESTRATÉGIA SOMENTE_NOVAS — publica mas não enfileira NADA, ninguém em andamento muda")
  // ══════════════════════════════════════════════════════════════════════
  const dataPrazoTarefa1AntesV4 = (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })).dataPrazo
  const paramsV4 = paramsValidos({ prazoQuantidade: 20 })
  const pubV4 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: paramsV4, estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: null })
  check("10.1) publicação v4 aceita", pubV4.ok === true)
  if (!pubV4.ok) throw new Error("publicação v4 falhou")
  check("10.2) reconciliação devolve ZERO alcançadas / ZERO outbox", pubV4.reconciliacao.tarefasAlcancadas === 0 && pubV4.reconciliacao.outboxRegistrados === 0, pubV4.reconciliacao)
  const outboxV4 = await prisma.domainOutbox.count({ where: { chaveIdempotencia: { endsWith: "::v4" }, tipo: TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA } })
  check("10.3) NENHUM DomainOutbox criado para a versão 4", outboxV4 === 0)
  const tarefa1AposV4 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  check("10.4) a tarefa em andamento (tarefa1) NÃO mudou", tarefa1AposV4.dataPrazo?.getTime() === dataPrazoTarefa1AntesV4?.getTime())

  // ══════════════════════════════════════════════════════════════════════
  secao("11) ESTRATÉGIA MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO — dataPrazo intacto, só o acompanhamento muda")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa1AntesV5 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  const paramsV5 = paramsValidos({ acompanhamentoPadraoDias: 7 })
  const pubV5 = await publicarPoliticaPrazoSla({ politicaId: politica.id, parametros: paramsV5, estrategiaRetroacao: "MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO", publicadoPorId: null })
  check("11.1) publicação v5 aceita", pubV5.ok === true)
  if (!pubV5.ok) throw new Error("publicação v5 falhou")
  check("11.2) a tarefa1 foi alcançada (1 outbox)", pubV5.reconciliacao.tarefasAlcancadas === 1 && pubV5.reconciliacao.outboxRegistrados === 1, pubV5.reconciliacao)

  const payloadV5 = await outboxPayloadDaTarefa(tarefa1.id, 5)
  await processarReconciliacaoPrazoSla(payloadV5)
  const tarefa1AposV5 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa1.id } })
  check("11.3) dataPrazo NÃO mudou", tarefa1AposV5.dataPrazo?.getTime() === tarefa1AntesV5.dataPrazo?.getTime())
  check("11.4) proximoAcompanhamentoEm MUDOU", tarefa1AposV5.proximoAcompanhamentoEm?.getTime() !== tarefa1AntesV5.proximoAcompanhamentoEm?.getTime())

  const v5 = await prisma.politicaPrazoSlaVersao.findUniqueOrThrow({ where: { politicaId_versao: { politicaId: politica.id, versao: 5 } } })
  const esperadoAcompV5 = calcularAcompanhamento(v5.publicadoEm, v5.acompanhamentoPadraoDias, contagemDe(v5))
  check("11.5) o novo proximoAcompanhamentoEm bate com o motor (a partir de publicadoEm, acompanhamentoPadraoDias=7)",
    tarefa1AposV5.proximoAcompanhamentoEm?.getTime() === esperadoAcompV5?.getTime(), { service: tarefa1AposV5.proximoAcompanhamentoEm, motor: esperadoAcompV5 })

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) { console.error("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
}

main().finally(() => prisma.$disconnect())
