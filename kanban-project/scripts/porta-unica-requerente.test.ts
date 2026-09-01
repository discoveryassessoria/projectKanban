/**
 * PORTA ÚNICA DE INSERÇÃO — a origem da ação não pode mudar o estado final.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" FINANCEIRO_DUAL_WRITE=1 \
 *   npx tsx scripts/porta-unica-requerente.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 * Colocar um requerente na árvore tinha DUAS portas com efeitos diferentes:
 *
 *   pela tela   POST /api/arvore/[id]/vincular-requerente
 *               → vínculo + evento `requerente.adicionado` + materialização
 *   por serviço vincularRequerenteTx
 *               → só o vínculo
 *
 * Ninguém errava: a rota é que era dona de um efeito de negócio. Medido em
 * produção — os requerentes 134, 135 e 137 do processo 513 tiveram nó de árvore
 * e nunca geraram `MotorArtefato`; as únicas chaves `::req:` do processo são de
 * quem entrou pela tela.
 *
 * Este teste monta TRÊS cenários idênticos, entra por TRÊS portas diferentes e
 * exige censo igual campo a campo — incluindo a rota HTTP de verdade, chamada
 * com token assinado, não uma imitação do que ela faz.
 */
import { prisma } from "../src/lib/prisma"
import {
  vincularRequerente,
  vincularRequerenteTx,
  efeitosDoVinculoPosCommit,
} from "../lib/genealogia/vincular-requerente"
import { TIPO_EVENTO_REQUERENTE } from "../src/services/genealogia/emitir-evento-requerente"
import { signAuthToken } from "../lib/auth-jwt"
import { POST as rotaVincular } from "../src/app/api/arvore/[arvoreid]/vincular-requerente/route"
import type { NextRequest } from "next/server"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.")
  console.error("   node scripts/mrg-banco-teste.mjs up\n")
  process.exit(1)
}
if (process.env.FINANCEIRO_DUAL_WRITE !== "1") {
  console.error("\n❌ Rode com FINANCEIRO_DUAL_WRITE=1 — sem o espelho V3 o Financeiro não é comparável.\n")
  process.exit(1)
}
// Segredo local do teste. `getSecretKey()` lê `process.env.JWT_SECRET` na PRIMEIRA
// assinatura (lazy), então definir aqui, depois dos imports, chega a tempo.
process.env.JWT_SECRET ||= "porta-unica-requerente-segredo-de-teste-local-64-caracteres-ok"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "PORTA-UNICA"
const FASE = "genealogia"

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO — idêntico para as três portas. Moeda BRL para o preço não depender
// de cotação: o que se mede aqui é a porta, não a mesa de câmbio.
// ═══════════════════════════════════════════════════════════════════════════

interface Cenario { processoId: number; arvoreId: number; requerenteId: number }

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  if (procIds.length) {
    const obIds = (await prisma.obrigacaoEconomica.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((o) => o.id)
    if (obIds.length) {
      await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obIds } } })
    }
    await prisma.receita.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.motorArtefato.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.pendenciaFinanceira.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.tipoServico.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  }
  const arvoreIds = (await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((a) => a.id)
  if (arvoreIds.length) {
    const pIds = (await prisma.pessoa.findMany({ where: { arvoreId: { in: arvoreIds } }, select: { id: true } })).map((p) => p.id)
    if (pIds.length) {
      await prisma.requerente.updateMany({ where: { personId: { in: pIds } }, data: { personId: null } })
      await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: pIds } }, data: { pessoaPrincipalId: null } })
      await prisma.pessoa.deleteMany({ where: { id: { in: pIds } } })
    }
    await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  }
  await prisma.requerente.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseAutomationRule.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: "porta-unica@" } } })
}

async function montarCenario(sufixo: string): Promise<Cenario> {
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${MARCA}-${sufixo}`, name: `${MARCA} tipo ${sufixo}`,
      pais: { connectOrCreate: { where: { countryKey: "espanha" }, create: { countryKey: "espanha", countryLabel: "Espanha", nationalityKey: "espanhola", nationalityLabel: "Espanhola" } } },
      modalityKey: "descendencia", modalityLabel: "Descendência",
    }, select: { id: true },
  })
  const config = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA}-${sufixo}`.slice(0, 30), nome: `${MARCA} honorários ${sufixo}`, moedaPadrao: "BRL", possuiReceita: true },
    select: { id: true },
  })
  await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço ${sufixo}`, configuracaoFinanceiraItemId: config.id,
      natureza: "VENDA", moeda: "BRL", modoCalculo: "first_additional",
      valor: 1000, valorBase: 1000, valorAdicional: 400, unidade: "REQUERENTE", prioridade: 10,
    },
  })
  await prisma.phaseAutomationRule.create({
    data: {
      name: `${MARCA} automação ${sufixo}`, tipoProcessoId: tipo.id, phaseKey: FASE,
      kind: "financial", trigger: "person_added", configItemId: config.id,
      aplicacaoFinanceira: "RECEITA", active: true, arquivado: false,
    },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${sufixo}` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo ${sufixo}`, arvoreId: arvore.id, faseAtualKey: FASE, tipoProcessoMotorId: tipo.id },
    select: { id: true },
  })
  const requerente = await prisma.requerente.create({ data: { nome: `${MARCA} Requerente ${sufixo}` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: requerente.id } })
  return { processoId: processo.id, arvoreId: arvore.id, requerenteId: requerente.id }
}

// ═══════════════════════════════════════════════════════════════════════════
// CENSO SEMÂNTICO — só o que é comparável entre cenários. Ids não entram
// (mudam por construção); contagens, valores e estados entram.
// ═══════════════════════════════════════════════════════════════════════════

interface Censo {
  pessoasNaArvore: number
  pessoaEhRequerente: boolean
  requerenteVinculado: boolean
  eventosNaOutbox: number
  eventosPendentes: number
  eventosEnviados: number
  artefatosAtivos: number
  receitasAtivas: number
  valorTotalReceitas: number
  obrigacoesAtivas: number
  participantes: number
  necessidades: number
}

async function censo(c: Cenario): Promise<Censo> {
  const pessoas = await prisma.pessoa.findMany({ where: { arvoreId: c.arvoreId, removidaEm: null }, select: { id: true, requerente: true } })
  const eventos = await prisma.domainOutbox.findMany({
    where: { tipo: TIPO_EVENTO_REQUERENTE, aggregateId: c.processoId }, select: { status: true },
  })
  const receitas = await prisma.receita.findMany({ where: { processoId: c.processoId, arquivadaEm: null }, select: { id: true, valor: true } })
  return {
    pessoasNaArvore: pessoas.length,
    pessoaEhRequerente: pessoas.every((p) => ["sim", "maior", "menor"].includes(String(p.requerente))),
    requerenteVinculado: (await prisma.requerente.count({ where: { id: c.requerenteId, personId: { not: null } } })) === 1,
    eventosNaOutbox: eventos.length,
    eventosPendentes: eventos.filter((e) => e.status === "PENDENTE").length,
    eventosEnviados: eventos.filter((e) => e.status === "ENVIADO").length,
    artefatosAtivos: await prisma.motorArtefato.count({ where: { processoId: c.processoId, ruleSource: "automation", status: "active" } }),
    receitasAtivas: receitas.length,
    valorTotalReceitas: receitas.reduce((s, r) => s + Number(r.valor), 0),
    obrigacoesAtivas: await prisma.obrigacaoEconomica.count({ where: { processoId: c.processoId, arquivadaEm: null, status: { not: "CANCELADO" } } }),
    participantes: await prisma.receitaRequerente.count({ where: { receita: { processoId: c.processoId } } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: c.processoId } }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AS TRÊS PORTAS
// ═══════════════════════════════════════════════════════════════════════════

/** PORTA 1 — a rota HTTP de verdade, com token assinado e permissão real. */
async function portaUI(c: Cenario, usuarioId: number): Promise<number> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { id: true, email: true, tipo: true } })
  const token = await signAuthToken({ userId: usuario.id, email: usuario.email, tipo: String(usuario.tipo) })
  const req = new Request(`http://localhost/api/arvore/${c.arvoreId}/vincular-requerente`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ requerenteId: c.requerenteId }),
  }) as unknown as NextRequest
  const res = await rotaVincular(req, { params: Promise.resolve({ arvoreid: String(c.arvoreId) }) })
  if (res.status !== 200) throw new Error(`rota devolveu ${res.status}: ${await res.text()}`)
  return res.status
}

/** PORTA 2 — a porta pública do serviço. */
async function portaServico(c: Cenario): Promise<void> {
  const r = await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: c.requerenteId })
  if (!r.ok) throw new Error(`serviço falhou: ${r.code}`)
}

/** PORTA 3 — script compondo com transação própria + saída obrigatória. */
async function portaScript(c: Cenario): Promise<void> {
  const r = await prisma.$transaction((tx) => vincularRequerenteTx(tx, { arvoreId: c.arvoreId, requerenteId: c.requerenteId }))
  if (!r.ok) throw new Error(`script falhou: ${r.code}`)
  await efeitosDoVinculoPosCommit({ arvoreId: c.arvoreId })
}

async function main() {
  console.log(`PORTA ÚNICA DE INSERÇÃO DE REQUERENTE\nBanco: ${URL_DB.replace(/:[^:@]*@/, ":***@")}\n`)
  await limpar()

  const usuario = await prisma.usuario.create({
    data: {
      nome: `${MARCA} Operador`, email: "porta-unica@teste.local", senha: "x", tipo: "operador",
      permissoesCustom: { "arvore.criar": true, "arvore.ver": true, "arvore.editar": true },
    },
    select: { id: true },
  })

  // ═════════════════════════════════════════════════════════════════════════
  secao("1–3) As três portas executam")
  // ═════════════════════════════════════════════════════════════════════════
  const cUI = await montarCenario("UI")
  const status = await portaUI(cUI, usuario.id)
  ok("1: pela UI — rota HTTP real, token assinado, permissão verificada", status === 200, `HTTP ${status}`)

  const cSvc = await montarCenario("SVC")
  await portaServico(cSvc)
  ok("2: pelo serviço — porta pública", true)

  const cScr = await montarCenario("SCR")
  await portaScript(cScr)
  ok("3: por script — transação própria + saída pós-commit", true)

  const censoUI = await censo(cUI)
  const censoSvc = await censo(cSvc)
  const censoScr = await censo(cScr)

  // ═════════════════════════════════════════════════════════════════════════
  secao("4) Estado final semanticamente IDÊNTICO")
  // ═════════════════════════════════════════════════════════════════════════
  const campos = Object.keys(censoUI) as (keyof Censo)[]
  for (const campo of campos) {
    const a = censoUI[campo], b = censoSvc[campo], d = censoScr[campo]
    ok(`4: ${campo} igual nas três portas`, a === b && b === d, `UI=${a} serviço=${b} script=${d}`)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("5) Evento emitido EXATAMENTE UMA VEZ — e drenado")
  // ═════════════════════════════════════════════════════════════════════════
  for (const [nome, cs] of [["UI", censoUI], ["serviço", censoSvc], ["script", censoScr]] as const) {
    ok(`5: ${nome} — um único evento na outbox`, cs.eventosNaOutbox === 1, `${cs.eventosNaOutbox}`)
    ok(`5: ${nome} — evento ENVIADO, não represado`, cs.eventosEnviados === 1 && cs.eventosPendentes === 0,
      `enviados=${cs.eventosEnviados} pendentes=${cs.eventosPendentes}`)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("6–8) Materialização, Financeiro e ausência de cobrança dupla")
  // ═════════════════════════════════════════════════════════════════════════
  for (const [nome, cs] of [["UI", censoUI], ["serviço", censoSvc], ["script", censoScr]] as const) {
    ok(`6: ${nome} — um artefato ativo (a marca de idempotência do motor)`, cs.artefatosAtivos === 1, `${cs.artefatosAtivos}`)
    ok(`7: ${nome} — uma receita, um espelho, um participante`,
      cs.receitasAtivas === 1 && cs.obrigacoesAtivas === 1 && cs.participantes === 1,
      `rec=${cs.receitasAtivas} obr=${cs.obrigacoesAtivas} part=${cs.participantes}`)
    ok(`8: ${nome} — valor do primeiro requerente, cobrado uma vez`, cs.valorTotalReceitas === 1000, `${cs.valorTotalReceitas}`)
  }
  ok("6: materialização documental igual nas três",
    censoUI.necessidades === censoSvc.necessidades && censoSvc.necessidades === censoScr.necessidades,
    `${censoUI.necessidades} (sem Regra Documental publicada no cenário — o que se prova é a IGUALDADE)`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("9) Retry na MESMA porta não duplica")
  // ═════════════════════════════════════════════════════════════════════════
  await portaUI(cUI, usuario.id)
  await portaServico(cSvc)
  await portaScript(cScr)
  const retryUI = await censo(cUI), retrySvc = await censo(cSvc), retryScr = await censo(cScr)
  ok("9: UI — censo inalterado após repetir", JSON.stringify(retryUI) === JSON.stringify(censoUI), JSON.stringify(retryUI))
  ok("9: serviço — censo inalterado após repetir", JSON.stringify(retrySvc) === JSON.stringify(censoSvc))
  ok("9: script — censo inalterado após repetir", JSON.stringify(retryScr) === JSON.stringify(censoScr))

  // ═════════════════════════════════════════════════════════════════════════
  secao("10) Reexecução CRUZADA — trocar de porta também não duplica")
  // ═════════════════════════════════════════════════════════════════════════
  // O caso real: alguém cria pela tela e um backfill reprocessa pelo serviço.
  await portaServico(cUI)
  await portaScript(cUI)
  const cruzado = await censo(cUI)
  ok("10: três portas sobre o MESMO cenário deixam o estado intacto",
    JSON.stringify(cruzado) === JSON.stringify(censoUI), JSON.stringify(cruzado))

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exitCode = 1
    return
  }
  console.log("Tela, serviço e script terminam no mesmo estado. A porta é uma só.\n")
}

main()
  .catch((e) => { console.error("\n💥", e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
