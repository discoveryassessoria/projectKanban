/**
 * EQUIVALÊNCIA DAS DUAS ROTAS DE EXCLUSÃO — a origem da ação não pode mudar o
 * estado final do domínio.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/pessoa-equivalencia-rotas.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 * `DELETE /api/pessoas/[id]` reconciliava DENTRO da rota. `DELETE
 * /api/arvore/[arvoreid]` chamava o mesmo serviço de remoção e não reconciliava
 * nada. Duas portas de entrada, dois estados finais — e nenhuma das duas errada
 * o suficiente para dar erro.
 *
 * A reconciliação desceu para o serviço. Este teste monta CENÁRIOS IDÊNTICOS,
 * remove a mesma pessoa por caminhos diferentes e exige que o censo do banco
 * seja igual, campo a campo.
 */
import { prisma } from "../src/lib/prisma"
import { vincularRequerente } from "../lib/genealogia/vincular-requerente"
import { removerPessoaDaArvore, reconciliarAposRemocao } from "../src/services/pessoa-ciclo-vida"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.")
  console.error("   node scripts/mrg-banco-teste.mjs up\n")
  process.exit(1)
}

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "EQUIV-ROTAS"

interface Cenario { arvoreId: number; processoId: number; requerenteId: number; pessoaId: number }

/**
 * Censo SEMÂNTICO: o que o domínio afirma sobre o processo depois da remoção.
 * IDs não entram — eles diferem por construção entre dois cenários distintos.
 */
interface Censo {
  pessoasAtivasNaArvore: number
  vinculosAtivosNoProcesso: number
  participantesFinanceiros: number
  necessidades: number
  documentos: number
  passos: number
  tarefas: number
  tarefasOrfas: number
  receitas: number
  custos: number
  obrigacoes: number
  requerenteAindaExiste: boolean
  requerentePersonIdNulo: boolean
}

async function censo(c: Cenario): Promise<Censo> {
  const pessoaIds = (await prisma.pessoa.findMany({ where: { arvoreId: c.arvoreId }, select: { id: true } })).map((p) => p.id)
  const tarefas = await prisma.tarefa.findMany({
    where: { processoId: c.processoId },
    select: { workflowStepInstanceId: true, necessidadeId: true, documentoId: true, origem: true },
  })
  const req = await prisma.requerente.findUnique({ where: { id: c.requerenteId }, select: { personId: true } })
  return {
    pessoasAtivasNaArvore: await prisma.pessoa.count({ where: { arvoreId: c.arvoreId, removidaEm: null } }),
    vinculosAtivosNoProcesso: await prisma.processoRequerente.count({ where: { processoId: c.processoId, removidoEm: null } }),
    participantesFinanceiros: await prisma.receitaRequerente.count({ where: { receita: { processoId: c.processoId } } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: c.processoId } }),
    documentos: pessoaIds.length ? await prisma.documento.count({ where: { pessoaId: { in: pessoaIds } } }) : 0,
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: c.processoId } }),
    tarefas: tarefas.length,
    tarefasOrfas: tarefas.filter((t) => !t.workflowStepInstanceId && !t.necessidadeId && !t.documentoId && (t.origem ?? "") !== "MANUAL").length,
    receitas: await prisma.receita.count({ where: { processoId: c.processoId } }),
    custos: await prisma.custo.count({ where: { processoId: c.processoId } }),
    obrigacoes: await prisma.obrigacaoEconomica.count({ where: { processoId: c.processoId } }),
    requerenteAindaExiste: req != null,
    requerentePersonIdNulo: req?.personId == null,
  }
}

/** Monta processo + árvore + requerente + pessoa + cadeia derivada. */
async function montarCenario(sufixo: string): Promise<Cenario> {
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, pais: "Brasil", arvoreId: arvore.id }, select: { id: true },
  })
  const requerente = await prisma.requerente.create({
    data: { nome: `${MARCA} ${sufixo}`, cpf: `000.000.000-0${sufixo === "A" ? 1 : 2}` }, select: { id: true },
  })
  await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: requerente.id } })

  const v = await vincularRequerente({ arvoreId: arvore.id, requerenteId: requerente.id })
  if (!v.ok) throw new Error(`vínculo falhou: ${v.code}`)

  const doc = await prisma.documento.create({ data: { pessoaId: v.pessoaId, descricao: `${MARCA} certidão` }, select: { id: true } })
  await prisma.tarefa.create({
    data: { titulo: `${MARCA} localizar`, processoId: processo.id, documentoId: doc.id, pessoaId: v.pessoaId, origem: "reconciliacao" },
  })
  await prisma.receita.create({
    data: {
      codigo: `EQ-${sufixo}-1`, processoId: processo.id, personId: v.pessoaId, descricao: `${MARCA} honorários`,
      valor: "500.00", fxEstimado: "1.0000", data1: new Date(),
      requerentes: { create: { idx: 0, nome: `${MARCA} ${sufixo}`, requerenteId: requerente.id } },
    },
  })
  await prisma.obrigacaoEconomica.create({
    data: {
      processoId: processo.id, personId: v.pessoaId, documentoId: doc.id, natureza: "RECEITA", direcao: "ENTRADA",
      codigoOperacional: `EQ-${sufixo}-OBR`, moedaContratual: "BRL", moedaContabil: "BRL", valorContratado: "500.00",
    },
  })

  return { arvoreId: arvore.id, processoId: processo.id, requerenteId: requerente.id, pessoaId: v.pessoaId }
}

async function limpar() {
  const arvs = (await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((a) => a.id)
  const procs = (await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id)
  const reqs = (await prisma.requerente.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((r) => r.id)
  if (procs.length) {
    const rec = (await prisma.receita.findMany({ where: { processoId: { in: procs } }, select: { id: true } })).map((r) => r.id)
    if (rec.length) {
      await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: rec } } })
      await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: rec } } })
      await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: rec } } })
    }
    const obs = (await prisma.obrigacaoEconomica.findMany({ where: { processoId: { in: procs } }, select: { id: true } })).map((o) => o.id)
    if (obs.length) {
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obs } } })
    }
    await prisma.receita.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: { in: procs } } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: { in: procs } } })
    await prisma.processo.deleteMany({ where: { id: { in: procs } } })
  }
  if (arvs.length) {
    const ps = (await prisma.pessoa.findMany({ where: { arvoreId: { in: arvs } }, select: { id: true } })).map((p) => p.id)
    if (ps.length) {
      await prisma.documento.deleteMany({ where: { pessoaId: { in: ps } } })
      await prisma.uniao.deleteMany({ where: { pessoa1Id: { in: ps } } })
      await prisma.requerente.updateMany({ where: { personId: { in: ps } }, data: { personId: null } })
      await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: ps } }, data: { pessoaPrincipalId: null } })
      await prisma.pessoa.deleteMany({ where: { id: { in: ps } } })
    }
    await prisma.arvore.deleteMany({ where: { id: { in: arvs } } })
  }
  if (reqs.length) await prisma.requerente.deleteMany({ where: { id: { in: reqs } } })
}

async function main() {
  console.log(`EQUIVALÊNCIA DAS ROTAS DE EXCLUSÃO\nBanco: ${URL_DB.replace(/:[^:@]*@/, ":***@")}\n`)
  await limpar()

  // ── Dois cenários idênticos ──────────────────────────────────────────────
  const A = await montarCenario("A")
  const B = await montarCenario("B")

  secao("1) Os dois cenários nascem iguais")
  const censoA0 = await censo(A)
  const censoB0 = await censo(B)
  ok("censo inicial idêntico", JSON.stringify(censoA0) === JSON.stringify(censoB0),
    JSON.stringify(censoA0) === JSON.stringify(censoB0) ? "" : `${JSON.stringify(censoA0)} vs ${JSON.stringify(censoB0)}`)
  ok("cada cenário tem cadeia derivada real",
    censoA0.documentos === 1 && censoA0.tarefas === 1 && censoA0.receitas === 1 &&
    censoA0.obrigacoes === 1 && censoA0.participantesFinanceiros === 1)

  // ── CAMINHO A: exclusão de UMA pessoa (o que DELETE /api/pessoas/[id] faz) ─
  secao("2) Caminho A — exclusão da pessoa")
  const rA = await removerPessoaDaArvore({ pessoaId: A.pessoaId, modo: "HARD" })
  ok("removida em modo HARD", rA.ok && rA.modoExecutado === "HARD", rA.code ?? "")

  // ── CAMINHO B: exclusão da ÁRVORE (o que DELETE /api/arvore/[id] faz) ─────
  // A rota itera as pessoas e chama o MESMO serviço; nada além disso. Este
  // teste reproduz exatamente essa sequência, sem HTTP.
  secao("3) Caminho B — exclusão da árvore inteira")
  const pessoasDaArvore = await prisma.pessoa.findMany({ where: { arvoreId: B.arvoreId }, select: { id: true } })
  for (const p of pessoasDaArvore) {
    const r = await removerPessoaDaArvore({ pessoaId: p.id, modo: "HARD" })
    ok(`pessoa ${p.id} removida em modo HARD`, r.ok && r.modoExecutado === "HARD", r.code ?? "")
  }

  // ── A PROVA ──────────────────────────────────────────────────────────────
  secao("4) Estado final: semanticamente IDÊNTICO")
  const censoA1 = await censo(A)
  const censoB1 = await censo(B)

  for (const chave of Object.keys(censoA1) as (keyof Censo)[]) {
    ok(`${chave}: A === B`, censoA1[chave] === censoB1[chave], `${censoA1[chave]} vs ${censoB1[chave]}`)
  }

  secao("5) O estado final é o CORRETO (não só igual)")
  for (const [nome, c] of [["A (pessoa)", censoA1], ["B (árvore)", censoB1]] as const) {
    ok(`${nome}: 0 pessoa ativa`, c.pessoasAtivasNaArvore === 0, `${c.pessoasAtivasNaArvore}`)
    ok(`${nome}: 0 vínculo ativo`, c.vinculosAtivosNoProcesso === 0, `${c.vinculosAtivosNoProcesso}`)
    ok(`${nome}: 0 participante financeiro`, c.participantesFinanceiros === 0, `${c.participantesFinanceiros}`)
    ok(`${nome}: 0 documento`, c.documentos === 0, `${c.documentos}`)
    ok(`${nome}: 0 tarefa órfã`, c.tarefasOrfas === 0, `${c.tarefasOrfas}`)
    ok(`${nome}: 0 receita`, c.receitas === 0, `${c.receitas}`)
    ok(`${nome}: 0 obrigação`, c.obrigacoes === 0, `${c.obrigacoes}`)
    ok(`${nome}: cadastro do requerente preservado`, c.requerenteAindaExiste)
    ok(`${nome}: ponteiro para a árvore desfeito`, c.requerentePersonIdNulo)
  }

  // ── IDEMPOTÊNCIA DA RECONCILIAÇÃO ────────────────────────────────────────
  secao("6) Reconciliar de novo não muda nada")
  await reconciliarAposRemocao({ arvoreId: A.arvoreId, processoIds: [A.processoId] })
  await reconciliarAposRemocao({ arvoreId: B.arvoreId, processoIds: [B.processoId] })
  const censoA2 = await censo(A)
  const censoB2 = await censo(B)
  ok("A: censo inalterado após 2ª reconciliação",
    JSON.stringify(censoA1) === JSON.stringify(censoA2), JSON.stringify(censoA2))
  ok("B: censo inalterado após 2ª reconciliação",
    JSON.stringify(censoB1) === JSON.stringify(censoB2), JSON.stringify(censoB2))

  await reconciliarAposRemocao({ arvoreId: A.arvoreId, processoIds: [A.processoId] })
  const censoA3 = await censo(A)
  ok("A: censo inalterado após 3ª reconciliação",
    JSON.stringify(censoA1) === JSON.stringify(censoA3), JSON.stringify(censoA3))
  ok("a reconciliação não recria pessoa", censoA3.pessoasAtivasNaArvore === 0)
  ok("a reconciliação não recria participante financeiro", censoA3.participantesFinanceiros === 0)
  ok("a reconciliação não recria documento", censoA3.documentos === 0)
  ok("a reconciliação não duplica tarefa", censoA3.tarefas === censoA1.tarefas)
  ok("a reconciliação não duplica receita", censoA3.receitas === censoA1.receitas)
  ok("a reconciliação não duplica obrigação", censoA3.obrigacoes === censoA1.obrigacoes)

  await limpar()

  console.log(`\n${"═".repeat(64)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log("As duas rotas terminam no mesmo estado. A origem da ação não importa.\n")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await limpar().catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})
