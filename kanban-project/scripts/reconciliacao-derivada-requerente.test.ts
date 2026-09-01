/**
 * RECONCILIAÇÃO DO ESTADO DERIVADO — remover da árvore ≠ deixar órfão.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" FINANCEIRO_DUAL_WRITE=1 \
 *   npx tsx scripts/reconciliacao-derivada-requerente.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE TESTE PROVA
 * ═══════════════════════════════════════════════════════════════════════════
 * Que a remoção de uma pessoa da árvore RECONCILIA os efeitos que perderam a
 * última causa válida — e SÓ esses.
 *
 * O defeito que ele trava (medido no processo 513, produção, 08/08/2026):
 * `processarRequerenteAdicionado` cria Receita + espelho V3 + MotorArtefato a
 * partir da entrada da pessoa na árvore, e não existia o inverso. A remoção só
 * alcançava o que estivesse ligado por `Receita.personId` — a coluna que o
 * próprio apagamento zera (`onDelete: SetNull`). Restaram R$ 6.800 de receita
 * ATIVA sem causa viva, exibidos como "Requerente não identificado".
 *
 * Nada disso deu erro. Só a contagem — e o Financeiro do cliente.
 *
 * Cenários A–N exigidos pela especificação.
 */
import { prisma } from "../src/lib/prisma"
import { vincularRequerente } from "../lib/genealogia/vincular-requerente"
import { removerPessoaDaArvore } from "../src/services/pessoa-ciclo-vida"
import { reconciliarAutomacaoPorRequerente } from "../src/lib/motor/reconciliar-requerente-economico"
import { listarReceitas } from "../lib/financeiro/leitura/receitas-lista"
import { pessoaCausadoraDaReceita, pessoaDaChaveIdempotencia } from "../lib/financeiro/causa-requerente"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.")
  console.error("   node scripts/mrg-banco-teste.mjs up\n")
  process.exit(1)
}
if (process.env.FINANCEIRO_DUAL_WRITE !== "1") {
  console.error("\n❌ Rode com FINANCEIRO_DUAL_WRITE=1 — o espelho V3 é metade do defeito testado aqui.\n")
  process.exit(1)
}

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "RECONC-DERIVADO"
const FASE = "genealogia"

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO — processo com automação financeira POR REQUERENTE cadastrada.
// Moeda BRL de propósito: assim o preço não depende de cotação de câmbio e o
// teste mede a reconciliação, não a mesa de câmbio.
// ═══════════════════════════════════════════════════════════════════════════

interface Cenario {
  processoId: number
  arvoreId: number
  tipoProcessoId: number
  configId: number
  ruleId: number
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  if (procIds.length) {
    const recIds = (await prisma.receita.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((r) => r.id)
    const obIds = (await prisma.obrigacaoEconomica.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((o) => o.id)
    if (obIds.length) {
      await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obIds } } })
      await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obIds } } })
    }
    if (recIds.length) await prisma.receita.deleteMany({ where: { id: { in: recIds } } })
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
  const arvores = await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const arvoreIds = arvores.map((a) => a.id)
  if (arvoreIds.length) {
    const pIds = (await prisma.pessoa.findMany({ where: { arvoreId: { in: arvoreIds } }, select: { id: true } })).map((p) => p.id)
    if (pIds.length) {
      await prisma.documentoArquivo.deleteMany({ where: { documento: { pessoaId: { in: pIds } } } })
      await prisma.documento.deleteMany({ where: { pessoaId: { in: pIds } } })
      await prisma.uniao.deleteMany({ where: { OR: [{ pessoa1Id: { in: pIds } }, { pessoa2Id: { in: pIds } }] } })
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
}

async function montarCenario(sufixo: string): Promise<Cenario> {
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${MARCA}-${sufixo}`, name: `${MARCA} tipo ${sufixo}`,
      countryKey: "espanha", countryLabel: "Espanha",
      nationalityKey: "espanhola", nationalityLabel: "Espanhola",
      modalityKey: "descendencia", modalityLabel: "Descendência",
    },
    select: { id: true },
  })
  const config = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA.slice(0, 20)}-${sufixo}`.slice(0, 30), nome: `${MARCA} honorários ${sufixo}`, moedaPadrao: "BRL", possuiReceita: true },
    select: { id: true },
  })
  await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço ${sufixo}`, configuracaoFinanceiraItemId: config.id,
      natureza: "VENDA", moeda: "BRL", modoCalculo: "first_additional",
      valor: 1000, valorBase: 1000, valorAdicional: 400, unidade: "REQUERENTE", prioridade: 10,
    },
  })
  const regra = await prisma.phaseAutomationRule.create({
    data: {
      name: `${MARCA} automação ${sufixo}`, tipoProcessoId: tipo.id, phaseKey: FASE,
      kind: "financial", trigger: "person_added", configItemId: config.id,
      aplicacaoFinanceira: "RECEITA", active: true, arquivado: false,
    },
    select: { id: true },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${sufixo}` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo ${sufixo}`, arvoreId: arvore.id, faseAtualKey: FASE, tipoProcessoMotorId: tipo.id },
    select: { id: true },
  })
  return { processoId: processo.id, arvoreId: arvore.id, tipoProcessoId: tipo.id, configId: config.id, ruleId: regra.id }
}

/**
 * Coloca um requerente na árvore pela PORTA PÚBLICA — e mais nada.
 *
 * Antes deste arquivo existir o efeito econômico não vinha junto: era preciso
 * marcar o flag na mão e chamar `processarRequerenteAdicionado` explicitamente,
 * porque a emissão do evento morava na rota HTTP. As duas linhas saíram daqui
 * quando o efeito voltou para o serviço; que os cenários abaixo continuem
 * passando é a prova de que a porta faz o ato inteiro.
 */
async function entrarNaArvore(c: Cenario, nome: string): Promise<{ pessoaId: number; requerenteId: number }> {
  const requerente = await prisma.requerente.create({ data: { nome: `${MARCA} ${nome}` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: c.processoId, requerenteId: requerente.id } })
  const v = await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: requerente.id })
  if (!v.ok) throw new Error(`vínculo falhou: ${v.code}`)
  return { pessoaId: v.pessoaId, requerenteId: requerente.id }
}

/** Censo do que a operação enxerga (não do que existe no histórico). */
async function censoFinanceiro(processoId: number) {
  const lista = await listarReceitas(processoId)
  const participantes = lista.receitas.flatMap((g) => g.participantes)
  const naoIdentificados = participantes.filter((p) => /não identificado/i.test(p.nome))
  return {
    linhas: participantes.length,
    totalContratado: participantes.reduce((s, l) => s + (l.valorContratadoBrl ?? 0), 0),
    participantes: participantes.map((p) => p.nome),
    naoIdentificados: naoIdentificados.length,
    receitasAtivas: await prisma.receita.count({ where: { processoId, arquivadaEm: null } }),
    obrigacoesAtivas: await prisma.obrigacaoEconomica.count({ where: { processoId, arquivadaEm: null, status: { not: "CANCELADO" } } }),
    artefatosAtivos: await prisma.motorArtefato.count({ where: { processoId, ruleSource: "automation", status: "active" } }),
    entriesLedger: await prisma.ledgerEntry.count({ where: { obrigacao: { processoId } } }),
  }
}

async function main() {
  console.log(`RECONCILIAÇÃO DO ESTADO DERIVADO\nBanco: ${URL_DB.replace(/:[^:@]*@/, ":***@")}\n`)
  await limpar()

  // ═════════════════════════════════════════════════════════════════════════
  secao("0) A proveniência é lida da chave, não da coluna que o delete apaga")
  // ═════════════════════════════════════════════════════════════════════════
  ok("chave de idempotência revela a pessoa causadora",
    pessoaDaChaveIdempotencia("513::cfg:59::rule:35::req:2646::VENDA") === 2646)
  ok("chave sem requerente não atribui causa",
    pessoaDaChaveIdempotencia("513::c1::doc:9::custo") === null)
  ok("a causa sobrevive a personId nulo — o caso do processo 513",
    pessoaCausadoraDaReceita({ chaveIdempotencia: "513::cfg:59::rule:35::req:2646::VENDA", personId: null }) === 2646,
    "era exatamente aqui que a reconciliação perdia o rastro")
  ok("sem proveniência nenhuma, a causa é desconhecida (e nada se remove)",
    pessoaCausadoraDaReceita({ chaveIdempotencia: null, contextoAplicado: null, personId: null }) === null)

  // ═════════════════════════════════════════════════════════════════════════
  secao("A) Remover pessoa SEM efeitos derivados")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("A")
    const req = await prisma.requerente.create({ data: { nome: `${MARCA} SemEfeito` }, select: { id: true } })
    const v = await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: req.id })
    const r = await removerPessoaDaArvore({ pessoaId: (v as { pessoaId: number }).pessoaId })
    ok("remoção concluída", r.ok, r.erro ?? "")
    const f = await censoFinanceiro(c.processoId)
    ok("nada sobra no Financeiro", f.linhas === 0 && f.artefatosAtivos === 0, JSON.stringify(f))
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("E/H/L/N) Remover o ÚLTIMO requerente — receita, espelho e artefato saem")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("E")
    const p1 = await entrarNaArvore(c, "Único")
    const antes = await censoFinanceiro(c.processoId)
    ok("o efeito econômico nasceu", antes.linhas === 1 && antes.artefatosAtivos === 1, JSON.stringify(antes))
    ok("o participante tem nome (L: nenhuma linha nasce sem identidade)",
      antes.naoIdentificados === 0, antes.participantes.join(" | "))

    const r = await removerPessoaDaArvore({ pessoaId: p1.pessoaId })
    ok("remoção concluída em modo HARD", r.ok && r.modoExecutado === "HARD", r.erro ?? String(r.modoExecutado))

    const depois = await censoFinanceiro(c.processoId)
    ok("N: o Financeiro não mostra mais nenhuma linha", depois.linhas === 0, JSON.stringify(depois))
    ok("nenhum espelho V3 sobrou", depois.obrigacoesAtivas === 0, `${depois.obrigacoesAtivas}`)
    ok("nenhum artefato ativo sobrou", depois.artefatosAtivos === 0, `${depois.artefatosAtivos}`)
    ok("L: zero 'Requerente não identificado' gerado pela operação", depois.naoIdentificados === 0)

    // J) idempotência — três reconciliações seguidas não mudam mais nada.
    const estado = async () => JSON.stringify(await censoFinanceiro(c.processoId))
    const e1 = await estado()
    for (let i = 0; i < 3; i++) await reconciliarAutomacaoPorRequerente(c.processoId, { dryRun: false })
    ok("J: reconciliar 3× produz exatamente o mesmo estado", (await estado()) === e1)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("G/H) Duas causas: remover UMA preserva o efeito da outra")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("G")
    const a = await entrarNaArvore(c, "Alpha")
    const b = await entrarNaArvore(c, "Beta")
    const antes = await censoFinanceiro(c.processoId)
    ok("dois efeitos, um por requerente", antes.linhas === 2, JSON.stringify(antes))

    await removerPessoaDaArvore({ pessoaId: a.pessoaId })
    const meio = await censoFinanceiro(c.processoId)
    ok("G: o efeito do requerente que FICOU é preservado", meio.linhas === 1, JSON.stringify(meio))
    ok("e continua nomeado", meio.naoIdentificados === 0, meio.participantes.join(" | "))
    const sobrouDoBeta = await prisma.receita.count({
      where: { processoId: c.processoId, arquivadaEm: null, chaveIdempotencia: { contains: `::req:${b.pessoaId}::` } },
    })
    ok("a receita preservada é a do requerente certo (por ID, não por nome)", sobrouDoBeta === 1)

    await removerPessoaDaArvore({ pessoaId: b.pessoaId })
    const fim = await censoFinanceiro(c.processoId)
    ok("H: removida a ÚLTIMA causa válida, o efeito sai", fim.linhas === 0, JSON.stringify(fim))
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("C/K) Fato histórico: preserva o Ledger, tira da operação")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("C")
    const p = await entrarNaArvore(c, "ComArquivo")
    // Documento com arquivo oficial = fato protegido (papel que existe).
    const doc = await prisma.documento.create({ data: { pessoaId: p.pessoaId, descricao: `${MARCA} certidão` }, select: { id: true } })
    await prisma.documentoArquivo.create({ data: { documentoId: doc.id, url: "https://exemplo/certidao.pdf", nome: "certidao.pdf" } })

    const entriesAntes = (await censoFinanceiro(c.processoId)).entriesLedger
    const r = await removerPessoaDaArvore({ pessoaId: p.pessoaId })
    ok("C: com fato histórico a saída é DESATIVAR, não apagar", r.ok && r.modoExecutado === "DESATIVAR", String(r.modoExecutado))
    ok("o arquivo oficial continua existindo", (await prisma.documentoArquivo.count({ where: { documentoId: doc.id } })) === 1)
    ok("a pessoa fica marcada como removida, não apagada",
      (await prisma.pessoa.count({ where: { id: p.pessoaId, removidaEm: { not: null } } })) === 1)

    const depois = await censoFinanceiro(c.processoId)
    ok("N: o lançamento sai da operação", depois.linhas === 0, JSON.stringify(depois))
    ok("K: o Ledger permanece INTACTO", depois.entriesLedger === entriesAntes, `${depois.entriesLedger} vs ${entriesAntes}`)
    ok("K: a receita não foi apagada — foi excluída logicamente",
      (await prisma.receita.count({ where: { processoId: c.processoId } })) === 1)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("B/D/M) Documento pendente e tarefa saem; a Central converge")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("B")
    const p = await entrarNaArvore(c, "ComTarefa")
    const doc = await prisma.documento.create({ data: { pessoaId: p.pessoaId, descricao: `${MARCA} pendente` }, select: { id: true } })
    await prisma.tarefa.create({
      data: { titulo: `${MARCA} localizar`, processoId: c.processoId, documentoId: doc.id, pessoaId: p.pessoaId, origem: "reconciliacao" },
    })
    await removerPessoaDaArvore({ pessoaId: p.pessoaId })
    ok("B: documento pendente sai", (await prisma.documento.count({ where: { id: doc.id } })) === 0)
    ok("D: tarefa derivada sai", (await prisma.tarefa.count({ where: { processoId: c.processoId } })) === 0)
    ok("M: a árvore que a Central lê não tem mais a pessoa",
      (await prisma.pessoa.count({ where: { arvoreId: c.arvoreId, removidaEm: null } })) === 0)
    ok("M: nenhuma necessidade documental órfã",
      (await prisma.necessidadeDocumental.count({ where: { processoId: c.processoId } })) === 0)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("F) Remover da ÁRVORE não apaga o cadastro de cliente")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("F")
    const p = await entrarNaArvore(c, "Cliente")
    await removerPessoaDaArvore({ pessoaId: p.pessoaId })
    ok("F: o Requerente (cadastro mestre) continua existindo",
      (await prisma.requerente.count({ where: { id: p.requerenteId } })) === 1)
    ok("F: o nó da árvore saiu", (await prisma.pessoa.count({ where: { id: p.pessoaId } })) === 0)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("I) Remover e REINSERIR — o efeito volta, sem duplicar")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("I")
    const p = await entrarNaArvore(c, "IdaEVolta")
    const antes = await censoFinanceiro(c.processoId)
    await removerPessoaDaArvore({ pessoaId: p.pessoaId })
    ok("saiu", (await censoFinanceiro(c.processoId)).linhas === 0)

    // Reinserção: o hard delete levou o ProcessoRequerente junto (§4.17), então
    // são DUAS etapas — devolver ao processo e revincular à árvore.
    await prisma.processoRequerente.upsert({
      where: { processoId_requerenteId: { processoId: c.processoId, requerenteId: p.requerenteId } },
      create: { processoId: c.processoId, requerenteId: p.requerenteId },
      update: { removidoEm: null, removidoPorId: null, motivoRemocao: null },
    })
    await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: p.requerenteId })

    const depois = await censoFinanceiro(c.processoId)
    ok("I: o efeito volta a existir", depois.linhas === 1, JSON.stringify(depois))
    ok("I: sem duplicar — mesma quantidade de antes", depois.linhas === antes.linhas, `${depois.linhas} vs ${antes.linhas}`)
    ok("I: um único artefato ativo", depois.artefatosAtivos === 1, `${depois.artefatosAtivos}`)
    ok("I: o participante volta com nome", depois.naoIdentificados === 0, depois.participantes.join(" | "))
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("Regressão 513) Espelho V3 cuja Receita foi apagada é um órfão ATIVO")
  // ═════════════════════════════════════════════════════════════════════════
  {
    const c = await montarCenario("Z")
    const p = await entrarNaArvore(c, "Espelho")
    const receita = await prisma.receita.findFirstOrThrow({ where: { processoId: c.processoId }, select: { id: true } })
    // Reproduz o estado REAL do 513, que é o do espelho LEGADO: gravado antes de o
    // dual-write copiar `personId`, ele não tinha nenhum vínculo com a pessoa — só
    // `origemId`, coluna solta. Depois a Receita foi apagada e o espelho ficou.
    await prisma.obrigacaoEconomica.updateMany({
      where: { processoId: c.processoId, origemTipo: "Receita", origemId: receita.id },
      data: { personId: null },
    })
    await prisma.receita.delete({ where: { id: receita.id } })
    const orfaos = await prisma.obrigacaoEconomica.count({
      where: { processoId: c.processoId, origemTipo: "Receita", origemId: receita.id, arquivadaEm: null },
    })
    ok("o espelho sobrevive ao apagamento da Receita (origemId é coluna solta)", orfaos === 1)
    ok("e ele APARECE no Financeiro enquanto ninguém reconcilia",
      (await censoFinanceiro(c.processoId)).linhas === 1)

    await removerPessoaDaArvore({ pessoaId: p.pessoaId })
    const depois = await censoFinanceiro(c.processoId)
    ok("a reconciliação arquiva o espelho órfão", depois.linhas === 0, JSON.stringify(depois))
    ok("K: o Ledger do espelho arquivado permanece", depois.entriesLedger > 0, `${depois.entriesLedger}`)
  }

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exitCode = 1
    return
  }
  console.log("Remover da árvore reconcilia o que perdeu a última causa — e preserva o resto.\n")
}

main()
  .catch((e) => { console.error("\n💥", e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
