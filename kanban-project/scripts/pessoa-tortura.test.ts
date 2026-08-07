/**
 * TESTE DE TORTURA — CRIAR → MATERIALIZAR → EXCLUIR → RECRIAR, 10 rodadas.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/pessoa-tortura.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE TESTE PROVA QUE NENHUM GUARD ESTÁTICO PROVA
 * ═══════════════════════════════════════════════════════════════════════════
 * Que o ciclo CONVERGE. Um guard prova que existe um dono e que a cadeia está
 * declarada; só a execução repetida prova que nada CRESCE.
 *
 * O defeito original não dava erro: apagar a pessoa deixava o vínculo com o
 * processo, as tarefas e o lançamento vivos, e a rodada seguinte somava por
 * cima. Em dez ciclos, dez representações da mesma pessoa — e em nenhum momento
 * uma exceção. Contagem é a única testemunha.
 *
 * Depois de CADA rodada, tudo abaixo tem de valer:
 *   pessoas ativas na árvore ............ 1
 *   vínculos ativos pessoa↔processo ..... 1
 *   participantes financeiros ........... 1
 *   necessidades documentais ............ igual à 1ª rodada
 *   documentos operacionais ............. igual à 1ª rodada
 *   tarefas órfãs ....................... 0
 *   passos órfãos ....................... 0
 *   lançamentos órfãos .................. 0
 */
import { prisma } from "../src/lib/prisma"
import { vincularRequerenteTx } from "../lib/genealogia/vincular-requerente"
import { removerPessoaDaArvore, analisarRemocaoPessoa } from "../src/services/pessoa-ciclo-vida"

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

const MARCA = "TORTURA-PESSOA"

interface Censo {
  pessoasAtivas: number
  vinculosAtivos: number
  participantes: number
  necessidades: number
  documentos: number
  tarefas: number
  passos: number
  tarefasOrfas: number
  passosOrfaos: number
  receitasSemDono: number
  obrigacoesOrfas: number
  requerentesDaPessoa: number
}

async function censo(processoId: number, arvoreId: number, requerenteId: number): Promise<Censo> {
  const pessoaIds = (await prisma.pessoa.findMany({ where: { arvoreId }, select: { id: true } })).map((p) => p.id)
  const vivas = new Set(pessoaIds)

  const tarefas = await prisma.tarefa.findMany({
    where: { processoId },
    select: { id: true, pessoaId: true, workflowStepInstanceId: true, necessidadeId: true, documentoId: true, origem: true },
  })
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId },
    select: { id: true, pessoaId: true, necessidadeId: true, documentoId: true },
  })

  return {
    pessoasAtivas: await prisma.pessoa.count({ where: { arvoreId, removidaEm: null } }),
    vinculosAtivos: await prisma.processoRequerente.count({ where: { processoId, removidoEm: null } }),
    participantes: await prisma.receitaRequerente.count({ where: { requerenteId, receita: { processoId } } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId } }),
    documentos: await prisma.documento.count({ where: { pessoaId: { in: pessoaIds } } }),
    tarefas: tarefas.length,
    passos: passos.length,
    // Órfã = não projeta nada E não é manual.
    tarefasOrfas: tarefas.filter(
      (t) => !t.workflowStepInstanceId && !t.necessidadeId && !t.documentoId &&
             (t.origem ?? "") !== "MANUAL" &&
             (t.pessoaId == null || !vivas.has(t.pessoaId)),
    ).length,
    // Passo que aponta para pessoa que não existe mais.
    passosOrfaos: passos.filter((s) => s.pessoaId != null && !vivas.has(s.pessoaId)).length,
    receitasSemDono: await prisma.receita.count({ where: { processoId, personId: null } }),
    obrigacoesOrfas: await prisma.obrigacaoEconomica.count({
      where: { processoId, personId: { notIn: pessoaIds.length ? pessoaIds : [-1] } },
    }),
    requerentesDaPessoa: await prisma.requerente.count({ where: { personId: { in: pessoaIds } } }),
  }
}

async function limpar() {
  const arvores = await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const arvoreIds = arvores.map((a) => a.id)
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  const reqs = await prisma.requerente.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const reqIds = reqs.map((r) => r.id)

  if (procIds.length) {
    const recIds = (await prisma.receita.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((r) => r.id)
    if (recIds.length) {
      await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } })
      await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } })
      await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: recIds } } })
    }
    const obIds = (await prisma.obrigacaoEconomica.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((o) => o.id)
    if (obIds.length) {
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obIds } } })
    }
    await prisma.receita.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  }
  if (arvoreIds.length) {
    const pIds = (await prisma.pessoa.findMany({ where: { arvoreId: { in: arvoreIds } }, select: { id: true } })).map((p) => p.id)
    if (pIds.length) {
      await prisma.documento.deleteMany({ where: { pessoaId: { in: pIds } } })
      await prisma.uniao.deleteMany({ where: { pessoa1Id: { in: pIds } } })
      await prisma.requerente.updateMany({ where: { personId: { in: pIds } }, data: { personId: null } })
      await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: pIds } }, data: { pessoaPrincipalId: null } })
      await prisma.pessoa.deleteMany({ where: { id: { in: pIds } } })
    }
    await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  }
  if (reqIds.length) await prisma.requerente.deleteMany({ where: { id: { in: reqIds } } })
}

async function main() {
  console.log(`TESTE DE TORTURA — ciclo de vida da Pessoa\nBanco: ${URL_DB.replace(/:[^:@]*@/, ":***@")}\n`)
  await limpar()

  // ── Cenário: um processo, uma árvore, um requerente ──────────────────────
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, pais: "Brasil", arvoreId: arvore.id },
    select: { id: true },
  })
  const requerente = await prisma.requerente.create({
    data: { nome: `${MARCA} Requerente Um`, cpf: "000.000.000-00" },
    select: { id: true },
  })
  await prisma.processoRequerente.create({
    data: { processoId: processo.id, requerenteId: requerente.id },
  })

  secao("Rodada 0 — estado inicial")
  const inicial = await censo(processo.id, arvore.id, requerente.id)
  ok("árvore começa vazia", inicial.pessoasAtivas === 0, `${inicial.pessoasAtivas}`)
  ok("vínculo com o processo existe", inicial.vinculosAtivos === 1, `${inicial.vinculosAtivos}`)

  let referencia: Censo | null = null

  for (let rodada = 1; rodada <= 10; rodada++) {
    // ── CRIAR: o requerente vira nó da árvore ──────────────────────────────
    const vinculo = await prisma.$transaction((tx) =>
      vincularRequerenteTx(tx, { arvoreId: arvore.id, requerenteId: requerente.id }),
    )
    if (!vinculo.ok) {
      ok(`rodada ${rodada}: vínculo criado`, false, vinculo.code)
      break
    }
    const pessoaId = vinculo.pessoaId

    // ── MATERIALIZAR: dados derivados que a exclusão vai ter de levar ──────
    // Documento e tarefa são criados diretamente porque a materialização real
    // depende de Regras Documentais publicadas — que são CADASTRO, não código.
    // O que o teste precisa é de cadeia derivada existindo; a origem dela não
    // muda o que a exclusão tem de fazer.
    const doc = await prisma.documento.create({
      data: { pessoaId, descricao: `${MARCA} certidão` },
      select: { id: true },
    })
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} localizar registro`,
        processoId: processo.id,
        documentoId: doc.id,
        pessoaId,
        origem: "reconciliacao",
      },
    })
    const receita = await prisma.receita.create({
      data: {
        codigo: `${MARCA}-R${rodada}`,
        processoId: processo.id,
        personId: pessoaId,
        descricao: `${MARCA} honorários`,
        valor: "1000.00",
        fxEstimado: "1.0000",
        data1: new Date(),
        requerentes: { create: { idx: 0, nome: `${MARCA} Requerente Um`, requerenteId: requerente.id } },
      },
      select: { id: true },
    })

    const depoisDeCriar = await censo(processo.id, arvore.id, requerente.id)
    if (rodada === 1) referencia = depoisDeCriar

    secao(`Rodada ${rodada} — depois de CRIAR + MATERIALIZAR`)
    ok(`pessoas ativas = 1`, depoisDeCriar.pessoasAtivas === 1, `${depoisDeCriar.pessoasAtivas}`)
    ok(`vínculos ativos = 1`, depoisDeCriar.vinculosAtivos === 1, `${depoisDeCriar.vinculosAtivos}`)
    ok(`participantes financeiros = 1`, depoisDeCriar.participantes === 1, `${depoisDeCriar.participantes}`)
    ok(`Requerentes desta Pessoa = 1`, depoisDeCriar.requerentesDaPessoa === 1, `${depoisDeCriar.requerentesDaPessoa}`)
    ok(`documentos = ${referencia!.documentos} (igual à 1ª rodada)`,
      depoisDeCriar.documentos === referencia!.documentos, `${depoisDeCriar.documentos}`)
    ok(`tarefas = ${referencia!.tarefas} (igual à 1ª rodada)`,
      depoisDeCriar.tarefas === referencia!.tarefas, `${depoisDeCriar.tarefas}`)

    // ── EXCLUIR ────────────────────────────────────────────────────────────
    const plano = await analisarRemocaoPessoa(pessoaId)
    ok(`rodada ${rodada}: sem fato protegido → hard delete permitido`,
      plano?.podeHardDelete === true, plano?.fatosProtegidos.map((f) => f.tipo).join(", ") || "—")

    const r = await removerPessoaDaArvore({ pessoaId, modo: "AUTO", motivo: `tortura ${rodada}` })
    ok(`rodada ${rodada}: exclusão executada em modo HARD`, r.ok && r.modoExecutado === "HARD",
      `${r.modoExecutado ?? r.code}`)

    // ── CONFERIR: zero resíduo ─────────────────────────────────────────────
    const vazio = await censo(processo.id, arvore.id, requerente.id)
    secao(`Rodada ${rodada} — depois de EXCLUIR`)
    ok("pessoas ativas = 0", vazio.pessoasAtivas === 0, `${vazio.pessoasAtivas}`)
    ok("vínculos ativos = 0", vazio.vinculosAtivos === 0, `${vazio.vinculosAtivos}`)
    ok("participantes financeiros = 0", vazio.participantes === 0, `${vazio.participantes}`)
    ok("necessidades = 0", vazio.necessidades === 0, `${vazio.necessidades}`)
    ok("documentos = 0", vazio.documentos === 0, `${vazio.documentos}`)
    ok("tarefas órfãs = 0", vazio.tarefasOrfas === 0, `${vazio.tarefasOrfas}`)
    ok("passos órfãos = 0", vazio.passosOrfaos === 0, `${vazio.passosOrfaos}`)
    ok("receitas sem dono = 0", vazio.receitasSemDono === 0, `${vazio.receitasSemDono}`)
    ok("obrigações órfãs = 0", vazio.obrigacoesOrfas === 0, `${vazio.obrigacoesOrfas}`)
    ok("Requerente sobreviveu (o cadastro do cliente não é apagado)",
      (await prisma.requerente.count({ where: { id: requerente.id } })) === 1)

    // ── RECRIAR: o vínculo com o processo volta ────────────────────────────
    await prisma.processoRequerente.create({
      data: { processoId: processo.id, requerenteId: requerente.id },
    })
    void receita
  }

  secao("Estado final")
  const final = await censo(processo.id, arvore.id, requerente.id)
  ok("10 rodadas depois: nenhuma tarefa órfã", final.tarefasOrfas === 0, `${final.tarefasOrfas}`)
  ok("10 rodadas depois: nenhum passo órfão", final.passosOrfaos === 0, `${final.passosOrfaos}`)
  ok("10 rodadas depois: nenhuma obrigação órfã", final.obrigacoesOrfas === 0, `${final.obrigacoesOrfas}`)
  ok("10 rodadas depois: um único Requerente para a identidade",
    (await prisma.requerente.count({ where: { nome: { startsWith: MARCA } } })) === 1)

  // ── FATO PROTEGIDO IMPEDE HARD DELETE ────────────────────────────────────
  secao("Fato protegido: pagamento impede exclusão definitiva")
  const v2 = await prisma.$transaction((tx) =>
    vincularRequerenteTx(tx, { arvoreId: arvore.id, requerenteId: requerente.id }),
  )
  if (v2.ok) {
    const obrig = await prisma.obrigacaoEconomica.create({
      data: {
        processoId: processo.id, personId: v2.pessoaId, natureza: "RECEITA", direcao: "ENTRADA",
        codigoOperacional: `${MARCA}-OBR`, moedaContratual: "BRL", moedaContabil: "BRL",
        valorContratado: "1000.00",
      },
      select: { id: true },
    })
    await prisma.ocorrenciaFinanceira.create({
      data: { obrigacaoId: obrig.id, tipo: "PAGAMENTO", status: "PROCESSADA", valor: "1000.00", data: new Date() },
    })

    const planoBloq = await analisarRemocaoPessoa(v2.pessoaId)
    ok("o pagamento é reconhecido como fato protegido",
      planoBloq?.fatosProtegidos.some((f) => f.tipo === "PAGAMENTO_OU_MOVIMENTO") === true)
    ok("hard delete fica indisponível", planoBloq?.podeHardDelete === false)
    ok("o modo sugerido vira DESATIVAR", planoBloq?.modoSugerido === "DESATIVAR")

    const recusa = await removerPessoaDaArvore({ pessoaId: v2.pessoaId, modo: "HARD" })
    ok("hard delete explícito é RECUSADO",
      !recusa.ok && recusa.code === "FATO_PROTEGIDO_IMPEDE_HARD_DELETE", recusa.code ?? "")

    const preservado = await removerPessoaDaArvore({ pessoaId: v2.pessoaId, modo: "AUTO" })
    ok("AUTO executa a desativação", preservado.ok && preservado.modoExecutado === "DESATIVAR")
    ok("a Pessoa continua existindo",
      (await prisma.pessoa.count({ where: { id: v2.pessoaId } })) === 1)
    ok("a Pessoa sai da árvore ATIVA",
      (await prisma.pessoa.count({ where: { id: v2.pessoaId, removidaEm: null } })) === 0)
    ok("o pagamento continua lá",
      (await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: obrig.id } })) === 1)

    // ── REINSERÇÃO reativa em vez de duplicar ──────────────────────────────
    secao("Reinserção depois da desativação")
    const v3 = await prisma.$transaction((tx) =>
      vincularRequerenteTx(tx, { arvoreId: arvore.id, requerenteId: requerente.id }),
    )
    ok("a reinserção REUSA o nó, não cria outro", v3.ok && !v3.criada && v3.pessoaId === v2.pessoaId)
    ok("a árvore volta com UMA pessoa ativa",
      (await prisma.pessoa.count({ where: { arvoreId: arvore.id, removidaEm: null } })) === 1)
    ok("continua havendo UM Requerente para a identidade",
      (await prisma.requerente.count({ where: { personId: v2.pessoaId } })) === 1)
  }

  await limpar()

  console.log(`\n${"═".repeat(64)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log("10 ciclos criar→excluir→recriar: nada cresceu, nada sobrou.\n")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await limpar().catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})
