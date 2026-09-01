/**
 * MATRIZ DE ESTADOS — CADASTRADO NO PROCESSO ≠ DENTRO DA ÁRVORE.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" FINANCEIRO_DUAL_WRITE=1 \
 *   npx tsx scripts/matriz-estados-requerente.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE ISTO PROVA
 * ═══════════════════════════════════════════════════════════════════════════
 *   EXISTIR NO PROCESSO ≠ PARTICIPAR DA ÁRVORE.
 *
 * Cadastrar cinco requerentes e não adicionar nenhum à árvore é ESTADO VÁLIDO:
 * zero membership, zero evento, zero documento, zero tarefa, zero centavo. O
 * gatilho é a ação explícita "adicionar à árvore" — nunca a existência.
 *
 * O teste percorre a matriz inteira sobre O MESMO processo: cadastra 5, adiciona
 * B, adiciona D, remove B, reinsere B — verificando a cada passo que quem não
 * entrou continua completamente inerte.
 *
 * O contrato formal está em lib/genealogia/estados-requerente.ts; aqui ele é
 * confrontado com o banco.
 */
import { prisma } from "../src/lib/prisma"

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

import { vincularRequerente } from "../lib/genealogia/vincular-requerente"
import { removerPessoaDaArvore } from "../src/services/pessoa-ciclo-vida"
import { TIPO_EVENTO_REQUERENTE } from "../src/services/genealogia/emitir-evento-requerente"
import { requerentesAtivosDaArvore } from "../src/lib/genealogia/vinculo-ativo"
import {
  classificarEstado, EFEITOS_POR_ESTADO, TRANSICOES, transicaoPermitida, explicarEfeitos,
  type EstadoRequerente,
} from "../lib/genealogia/estados-requerente"
import { garantirOferta } from "./_fixture-oferta"

if (process.env.FINANCEIRO_DUAL_WRITE !== "1") {
  console.error("\n❌ Rode com FINANCEIRO_DUAL_WRITE=1 — sem o espelho V3 o Financeiro não é comparável.\n")
  process.exit(1)
}

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "MATRIZ-ESTADOS"
const FASE = "genealogia"
const NOMES = ["A", "B", "C", "D", "E"] as const

interface Palco { processoId: number; arvoreId: number; requerentes: Record<string, number> }

async function limpar() {
  const procIds = (await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id)
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
    await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.tipoServico.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  }
  const arvIds = (await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((a) => a.id)
  if (arvIds.length) {
    const pIds = (await prisma.pessoa.findMany({ where: { arvoreId: { in: arvIds } }, select: { id: true } })).map((p) => p.id)
    if (pIds.length) {
      await prisma.requerente.updateMany({ where: { personId: { in: pIds } }, data: { personId: null } })
      await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: pIds } }, data: { pessoaPrincipalId: null } })
      await prisma.pessoa.deleteMany({ where: { id: { in: pIds } } })
    }
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.requerente.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseAutomationRule.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Um processo com automação financeira armada e CINCO requerentes cadastrados. */
async function montarPalco(): Promise<Palco> {
  const oferta = await garantirOferta(prisma, { countryKey: "espanha", countryLabel: "Espanha", nationalityKey: "espanhola", nationalityLabel: "Espanhola", modalityKey: "descendencia", modalityLabel: "Descendência" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: MARCA, name: `${MARCA} tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
      }, select: { id: true },
  })
  const config = await prisma.produtoFinanceiro.create({
    data: { codigo: MARCA.slice(0, 30), nome: `${MARCA} honorários`, moedaPadrao: "BRL", possuiReceita: true },
    select: { id: true },
  })
  await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço`, configuracaoFinanceiraItemId: config.id, natureza: "VENDA", moeda: "BRL",
      modoCalculo: "first_additional", valor: 1000, valorBase: 1000, valorAdicional: 400,
      unidade: "REQUERENTE", prioridade: 10,
    },
  })
  await prisma.phaseAutomationRule.create({
    data: {
      name: `${MARCA} automação`, tipoProcessoId: tipo.id, phaseKey: FASE, kind: "financial",
      trigger: "person_added", configItemId: config.id, aplicacaoFinanceira: "RECEITA",
      active: true, arquivado: false,
    },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arvore.id, faseAtualKey: FASE, tipoProcessoMotorId: tipo.id },
    select: { id: true },
  })
  const requerentes: Record<string, number> = {}
  for (const n of NOMES) {
    const r = await prisma.requerente.create({ data: { nome: `${MARCA} ${n}` }, select: { id: true } })
    await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: r.id } })
    requerentes[n] = r.id
  }
  return { processoId: processo.id, arvoreId: arvore.id, requerentes }
}

/** O estado de UM requerente, lido dos fatos — nunca de personId sozinho. */
async function estadoDe(p: Palco, nome: string): Promise<EstadoRequerente> {
  const reqId = p.requerentes[nome]
  const req = await prisma.requerente.findUnique({
    where: { id: reqId },
    select: { personId: true, pessoa: { select: { arvoreId: true, removidaEm: true, requerente: true } } },
  })
  const vinculado = (await prisma.processoRequerente.count({ where: { processoId: p.processoId, requerenteId: reqId, removidoEm: null } })) > 0
  const no = req?.pessoa ?? null
  return classificarEstado({
    vinculadoAoProcesso: vinculado,
    temNoNaArvore: no != null && no.arvoreId === p.arvoreId,
    noRemovido: no?.removidaEm != null,
    noMarcadoComoRequerente: ["sim", "maior", "menor"].includes(String(no?.requerente)),
  })
}

/** Tudo o que o domínio genealógico produziu para UM requerente. */
async function efeitosDe(p: Palco, nome: string) {
  const reqId = p.requerentes[nome]
  const req = await prisma.requerente.findUnique({ where: { id: reqId }, select: { personId: true } })
  const pid = req?.personId ?? -1
  return {
    membershipAtivo: await prisma.pessoa.count({ where: { ...requerentesAtivosDaArvore(p.arvoreId), id: pid } }),
    eventos: await prisma.domainOutbox.count({ where: { tipo: TIPO_EVENTO_REQUERENTE, chaveIdempotencia: `req.add::${p.processoId}::${pid}` } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: p.processoId, pessoaId: pid } }),
    tarefas: await prisma.tarefa.count({ where: { processoId: p.processoId, pessoaId: pid } }),
    receitas: await prisma.receita.count({ where: { processoId: p.processoId, arquivadaEm: null, chaveIdempotencia: { contains: `::req:${pid}::` } } }),
    participantes: await prisma.receitaRequerente.count({ where: { requerenteId: reqId, receita: { processoId: p.processoId, arquivadaEm: null } } }),
  }
}

const inerte = (e: Awaited<ReturnType<typeof efeitosDe>>) =>
  e.membershipAtivo === 0 && e.eventos === 0 && e.necessidades === 0 && e.tarefas === 0 && e.receitas === 0 && e.participantes === 0

async function main() {
  console.log("MATRIZ DE ESTADOS DO REQUERENTE\n")
  await limpar()

  // ═════════════════════════════════════════════════════════════════════════
  secao("0) O contrato formal é coerente consigo mesmo")
  // ═════════════════════════════════════════════════════════════════════════
  ok("só NA_ARVORE autoriza efeito genealógico",
    Object.entries(EFEITOS_POR_ESTADO).every(([e, a]) =>
      e === "NA_ARVORE" ? Object.values(a).every(Boolean) : Object.values(a).every((v) => !v)))
  ok("nenhuma transição tem 'cadastrar no processo' como gatilho genealógico",
    !TRANSICOES.some((t) => t.para === "NA_ARVORE" && /cadastr/i.test(t.gatilho)))
  ok("a única entrada em NA_ARVORE é a ação explícita, e emite o evento",
    TRANSICOES.filter((t) => t.para === "NA_ARVORE").every((t) => t.evento === "requerente.adicionado"))
  ok("cadastrar leva a FORA_DA_ARVORE e para nele",
    TRANSICOES.some((t) => t.de === "FORA_DO_PROCESSO" && t.para === "FORA_DA_ARVORE" && t.evento === null))
  ok("FORA_DA_ARVORE não transita para REMOVIDO_DA_ARVORE (nunca esteve dentro)",
    !transicaoPermitida("FORA_DA_ARVORE", "REMOVIDO_DA_ARVORE"))
  ok("o Explain Engine não chama 'fora da árvore' de pendência",
    /não há nada pendente nem errado/.test(explicarEfeitos("FORA_DA_ARVORE", "Fulana")))

  const p = await montarPalco()

  // ═════════════════════════════════════════════════════════════════════════
  secao("20) Cinco cadastrados, nenhum na árvore — ESTADO VÁLIDO")
  // ═════════════════════════════════════════════════════════════════════════
  ok("5 requerentes cadastrados no processo",
    (await prisma.processoRequerente.count({ where: { processoId: p.processoId, removidoEm: null } })) === 5)
  ok("0 memberships ativos", (await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) })) === 0)
  ok("0 eventos requerente.adicionado",
    (await prisma.domainOutbox.count({ where: { tipo: TIPO_EVENTO_REQUERENTE, aggregateId: p.processoId } })) === 0)
  ok("0 necessidades documentais", (await prisma.necessidadeDocumental.count({ where: { processoId: p.processoId } })) === 0)
  ok("0 tarefas", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 0)
  ok("0 receitas", (await prisma.receita.count({ where: { processoId: p.processoId } })) === 0)
  ok("0 participantes financeiros",
    (await prisma.receitaRequerente.count({ where: { receita: { processoId: p.processoId } } })) === 0)
  for (const n of NOMES) ok(`${n} está FORA_DA_ARVORE`, (await estadoDe(p, n)) === "FORA_DA_ARVORE")
  ok("nenhum personId foi criado por conveniência",
    (await prisma.requerente.count({ where: { id: { in: Object.values(p.requerentes) }, personId: { not: null } } })) === 0)

  // ═════════════════════════════════════════════════════════════════════════
  secao("21) Adicionar SOMENTE B")
  // ═════════════════════════════════════════════════════════════════════════
  await vincularRequerente({ arvoreId: p.arvoreId, requerenteId: p.requerentes.B })
  ok("5 requerentes continuam cadastrados",
    (await prisma.processoRequerente.count({ where: { processoId: p.processoId, removidoEm: null } })) === 5)
  ok("1 membership ativo", (await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) })) === 1)
  ok("B está NA_ARVORE", (await estadoDe(p, "B")) === "NA_ARVORE")
  const efB = await efeitosDe(p, "B")
  ok("B produz efeito: evento + receita + participante", efB.eventos === 1 && efB.receitas === 1 && efB.participantes === 1, JSON.stringify(efB))
  for (const n of ["A", "C", "D", "E"]) {
    ok(`${n} continua FORA_DA_ARVORE e INERTE`, (await estadoDe(p, n)) === "FORA_DA_ARVORE" && inerte(await efeitosDe(p, n)))
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("22) Adicionar D")
  // ═════════════════════════════════════════════════════════════════════════
  await vincularRequerente({ arvoreId: p.arvoreId, requerenteId: p.requerentes.D })
  ok("2 memberships ativos", (await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) })) === 2)
  ok("D está NA_ARVORE", (await estadoDe(p, "D")) === "NA_ARVORE")
  const efD = await efeitosDe(p, "D")
  ok("D produz o seu próprio efeito", efD.eventos === 1 && efD.receitas === 1, JSON.stringify(efD))
  ok("B continua com UM efeito, não dois", (await efeitosDe(p, "B")).receitas === 1)
  for (const n of ["A", "C", "E"]) {
    ok(`${n} continua inerte`, (await estadoDe(p, n)) === "FORA_DA_ARVORE" && inerte(await efeitosDe(p, n)))
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("23) Remover B — o cadastro do processo NÃO sai junto")
  // ═════════════════════════════════════════════════════════════════════════
  const pessoaB = (await prisma.requerente.findUnique({ where: { id: p.requerentes.B }, select: { personId: true } }))!.personId!
  const rem = await removerPessoaDaArvore({ pessoaId: pessoaB })
  ok("remoção concluída", rem.ok, rem.erro ?? "")
  ok("B saiu da árvore", (await prisma.pessoa.count({ where: { ...requerentesAtivosDaArvore(p.arvoreId), id: pessoaB } })) === 0)
  ok("B continua sendo requerente do processo (cadastro preservado)",
    (await prisma.requerente.count({ where: { id: p.requerentes.B } })) === 1)
  ok("D continua na árvore", (await estadoDe(p, "D")) === "NA_ARVORE")
  ok("o efeito de D é preservado — causa própria e viva", (await efeitosDe(p, "D")).receitas === 1)
  ok("o efeito de B foi reconciliado", (await efeitosDe(p, "B")).receitas === 0)
  for (const n of ["A", "C", "E"]) ok(`${n} segue inerte`, inerte(await efeitosDe(p, n)))

  // ═════════════════════════════════════════════════════════════════════════
  secao("24) Reinserir B — sem duplicar nada")
  // ═════════════════════════════════════════════════════════════════════════
  // O hard delete levou o ProcessoRequerente junto (§4.17): devolver ao processo
  // é a primeira das duas etapas da reinserção.
  await prisma.processoRequerente.upsert({
    where: { processoId_requerenteId: { processoId: p.processoId, requerenteId: p.requerentes.B } },
    create: { processoId: p.processoId, requerenteId: p.requerentes.B },
    update: { removidoEm: null, removidoPorId: null, motivoRemocao: null },
  })
  await vincularRequerente({ arvoreId: p.arvoreId, requerenteId: p.requerentes.B })
  ok("B voltou para NA_ARVORE", (await estadoDe(p, "B")) === "NA_ARVORE")
  ok("2 memberships ativos, não 3", (await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) })) === 2)
  ok("nenhuma Pessoa duplicada na árvore", (await prisma.pessoa.count({ where: { arvoreId: p.arvoreId } })) === 2)
  const efB2 = await efeitosDe(p, "B")
  ok("uma receita para B, não duas", efB2.receitas === 1, JSON.stringify(efB2))
  ok("um participante para B, não dois", efB2.participantes === 1)
  ok("nenhum requerente do processo foi perdido",
    (await prisma.processoRequerente.count({ where: { processoId: p.processoId, removidoEm: null } })) === 5)
  for (const n of ["A", "C", "E"]) ok(`${n} atravessou a matriz inteira inerte`, inerte(await efeitosDe(p, n)))

  // ═════════════════════════════════════════════════════════════════════════
  secao("25) Releitura — o estado não depende de memória de tela")
  // ═════════════════════════════════════════════════════════════════════════
  const foto = async () => JSON.stringify({
    membership: await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) }),
    receitas: await prisma.receita.count({ where: { processoId: p.processoId, arquivadaEm: null } }),
    estados: await Promise.all(NOMES.map((n) => estadoDe(p, n))),
  })
  const f1 = await foto()
  ok("segunda leitura idêntica à primeira", (await foto()) === f1, f1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("26) Cadastro permanece inerte por qualquer porta")
  // ═════════════════════════════════════════════════════════════════════════
  // Cadastrar mais um requerente — por escrita direta, o caminho mais cru
  // possível — não pode acordar o domínio genealógico.
  const f = await prisma.requerente.create({ data: { nome: `${MARCA} F` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: p.processoId, requerenteId: f.id } })
  p.requerentes.F = f.id
  ok("F cadastrado", (await prisma.processoRequerente.count({ where: { processoId: p.processoId, removidoEm: null } })) === 6)
  ok("F nasce FORA_DA_ARVORE", (await estadoDe(p, "F")) === "FORA_DA_ARVORE")
  ok("F é inerte", inerte(await efeitosDe(p, "F")))
  ok("o membership do processo não mudou", (await prisma.pessoa.count({ where: requerentesAtivosDaArvore(p.arvoreId) })) === 2)

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exitCode = 1
    return
  }
  console.log("Cadastrado no processo não é dentro da árvore. Só a ação explícita dispara.\n")
}

main()
  .catch((e) => { console.error("\n💥", e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
