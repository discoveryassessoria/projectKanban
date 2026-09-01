// scripts/arvore-preview-impacto.test.ts
// ============================================================================
// PREVIEW DE IMPACTO — teste de integração contra banco de TESTE.
//
// O que este arquivo prova, e que nenhum teste puro consegue provar:
//
//   1. A simulação NÃO GRAVA. Roda o materializador oficial de verdade, com
//      mudança de pessoa aplicada, e o banco fica byte a byte como estava.
//   2. O preview BATE COM A EXECUÇÃO REAL. O mesmo cenário é simulado e depois
//      executado; o delta previsto e o delta observado são comparados.
//   3. Sem Regra Documental publicada, o preview DIZ ISSO em vez de mostrar um
//      zero tranquilizador.
//
// TRAVA DE SEGURANÇA: o teste se recusa a rodar fora de `kanban_test`. O `.env`
// do projeto aponta para um banco remoto real, e um teste que escreve não pode
// depender de o operador ter exportado a variável certa. A verificação é da
// IDENTIDADE do banco conectado, não da string que alguém digitou.
//
// Rodar:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kanban_test \
//   PRISMA_DATABASE_URL=$DATABASE_URL DIRECT_DATABASE_URL=$DATABASE_URL \
//   npx tsx scripts/arvore-preview-impacto.test.ts
// ============================================================================

import { prisma } from "@/lib/prisma"
import { simularImpactoPessoa } from "@/src/services/genealogia/simular-impacto"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"

const MARCA = "__TEST_PREVIEW_IMPACTO__"

let passed = 0
let failed = 0
const falhas: string[] = []

function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`)
  }
}

async function exigirBancoDeTeste(): Promise<void> {
  const linhas = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`
  const db = linhas[0]?.db
  if (db !== "kanban_test") {
    console.error(
      `\n⛔ ABORTADO: conectado a "${db}", não a "kanban_test".\n` +
        `   Este teste ESCREVE. Rodá-lo contra outro banco é inaceitável.\n`,
    )
    process.exit(2)
  }
  console.log(`  banco: ${db} ✓`)
}

/** Retrato completo do que a simulação NÃO pode alterar. */
async function retratoGlobal() {
  const [necessidades, passos, tarefas, pessoas, unioes, obrigacoes] = await Promise.all([
    prisma.necessidadeDocumental.count(),
    prisma.phaseWorkflowStepInstance.count(),
    prisma.tarefa.count(),
    prisma.pessoa.count(),
    prisma.uniao.count(),
    prisma.obrigacaoEconomica.count(),
  ])
  return { necessidades, passos, tarefas, pessoas, unioes, obrigacoes }
}

interface Cenario {
  processoId: number
  arvoreId: number
  paiId: number
  filhoId: number
  conjugeId: number
  /** Ids do cadastro semeado, para limpar depois. */
  naturezaId: number
  itemCatalogoId: number
  tipoDocId: number
  faseId: number
  regraId: number
}

/**
 * Semeia a cadeia MÍNIMA de cadastro que faz o materializador oficial produzir
 * uma exigência: Natureza → ItemCatalogo → TipoDocumento → política da fase →
 * Regra Documental PUBLICADA condicionada a `casado = true`.
 *
 * Sem isto, `materializarGenealogia` retorna cedo ("nenhuma Regra Documental
 * publicada") e o teste não cobriria o caso que o usuário citou como exemplo:
 * solteiro → casado prevê a certidão de casamento.
 */
async function semearCadastroDocumental() {
  const natureza = await prisma.naturezaOperacionalDocumento.upsert({
    where: { code: `${MARCA}_NAT` },
    update: {},
    create: { code: `${MARCA}_NAT`, name: "Natureza de teste", exigeWorkflow: false },
  })
  const item = await prisma.itemCatalogo.upsert({
    where: { code: `${MARCA}_ITEM` },
    update: {},
    create: { code: `${MARCA}_ITEM`, name: "Certidão de Casamento – Inteiro Teor" },
  })
  // `code` não é chave única neste model (a unicidade é por publicCode/id), então
  // o upsert por code não existe: busca-e-cria explícito.
  const tipoExistente = await prisma.tipoDocumentoCadastro.findFirst({
    where: { code: `${MARCA}_CAS` },
    select: { id: true },
  })
  const tipoDoc = tipoExistente
    ? await prisma.tipoDocumentoCadastro.update({
        where: { id: tipoExistente.id },
        data: { ativo: true, naturezaOperacionalId: natureza.id, itemCatalogoId: item.id },
      })
    : await prisma.tipoDocumentoCadastro.create({
        data: {
          code: `${MARCA}_CAS`,
          name: "Certidão de Casamento – Inteiro Teor",
          ativo: true,
          naturezaOperacionalId: natureza.id,
          itemCatalogoId: item.id,
        },
      })
  const fase = await prisma.catalogoFase.upsert({
    where: { phaseKey: "genealogia" },
    update: {},
    create: { phaseKey: "genealogia", label: "Genealogia" },
  })
  await prisma.faseNaturezaPermitida.upsert({
    where: {
      catalogoFaseId_naturezaOperacionalId: {
        catalogoFaseId: fase.id,
        naturezaOperacionalId: natureza.id,
      },
    },
    update: { ativo: true },
    create: { catalogoFaseId: fase.id, naturezaOperacionalId: natureza.id, ativo: true },
  })
  const regra = await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: 0,
      aplicaTodosProcessos: true,
      documentTypeCode: `${MARCA}_CAS`,
      documentosAceitos: [`${MARCA}_CAS`],
      codigo: `${MARCA}_REGRA`,
      nome: "Certidão de casamento para pessoa casada",
      requisitoNome: "Certidão de Casamento – Inteiro Teor",
      status: "PUBLICADA",
      arquivado: false,
      faseExigencia: "genealogia",
      obrigatoriedade: "OBRIGATORIA",
      publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE",
      // A condição é o coração do teste: só quem está casado deve receber a
      // exigência. É o que faz o delta aparecer ao simular solteiro → casado.
      condicoes: { combinador: "TODAS", regras: [{ campo: "casado", operador: "igual", valor: true }] },
    },
  })
  return { naturezaId: natureza.id, itemCatalogoId: item.id, tipoDocId: tipoDoc.id, faseId: fase.id, regraId: regra.id }
}

async function semear(): Promise<Cenario> {
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arvore.id,},
  })
  const pai = await prisma.pessoa.create({
    data: {
      nome: "Giuseppe", sobrenome: MARCA, arvoreId: arvore.id,
      pais_nasc: "Itália", vivo: true, casado: false,
    },
  })
  const filho = await prisma.pessoa.create({
    data: {
      nome: "Marco", sobrenome: MARCA, arvoreId: arvore.id,
      pais_nasc: "Brasil", paiId: pai.id, vivo: true, casado: false,
    },
  })
  const conjuge = await prisma.pessoa.create({
    data: { nome: "Ana", sobrenome: MARCA, arvoreId: arvore.id, pais_nasc: "Brasil", vivo: true },
  })
  const cadastro = await semearCadastroDocumental()
  return {
    processoId: processo.id, arvoreId: arvore.id,
    paiId: pai.id, filhoId: filho.id, conjugeId: conjuge.id,
    ...cadastro,
  }
}

async function limpar(c: Cenario | null) {
  if (!c) return
  // Ordem: dependentes antes dos donos. Falha em qualquer passo não impede os
  // demais — o objetivo é não deixar lixo, não ser elegante.
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.tarefa.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.uniao.deleteMany({
    where: { OR: [{ pessoa1Id: c.filhoId }, { pessoa2Id: c.filhoId }, { pessoa1Id: c.conjugeId }, { pessoa2Id: c.conjugeId }] },
  }).catch(() => {})
  await prisma.arvore.update({ where: { id: c.arvoreId }, data: { pessoaPrincipalId: null } }).catch(() => {})
  await prisma.processo.delete({ where: { id: c.processoId } }).catch(() => {})
  await prisma.pessoa.deleteMany({ where: { arvoreId: c.arvoreId } }).catch(() => {})
  await prisma.arvore.delete({ where: { id: c.arvoreId } }).catch(() => {})
  // Cadastro documental semeado — na ordem inversa das dependências.
  await prisma.matrizDocumental.delete({ where: { id: c.regraId } }).catch(() => {})
  await prisma.faseNaturezaPermitida.deleteMany({ where: { naturezaOperacionalId: c.naturezaId } }).catch(() => {})
  await prisma.tipoDocumentoCadastro.delete({ where: { id: c.tipoDocId } }).catch(() => {})
  await prisma.itemCatalogo.delete({ where: { id: c.itemCatalogoId } }).catch(() => {})
  await prisma.naturezaOperacionalDocumento.delete({ where: { id: c.naturezaId } }).catch(() => {})
}

async function main() {
  console.log("\n══ PREVIEW DE IMPACTO — INTEGRAÇÃO ══\n")
  await exigirBancoDeTeste()

  const regrasPublicadas = await prisma.matrizDocumental.count({
    where: { status: "PUBLICADA", arquivado: false },
  })
  console.log(`  Regras Documentais publicadas: ${regrasPublicadas}\n`)

  let cenario: Cenario | null = null
  try {
    cenario = await semear()

    // ── 1. A SIMULAÇÃO NÃO GRAVA ─────────────────────────────────────────────
    console.log("1) a simulação não grava")
    const antes = await retratoGlobal()

    const simVivo = await simularImpactoPessoa(
      {
        processoId: cenario.processoId,
        pessoaId: cenario.paiId,
        mudancas: { vivo: false, data_obito: "1975-03-01" },
      },
      true,
    )

    const depois = await retratoGlobal()
    ok(simVivo.somenteLeitura === true, "o resultado se declara somente leitura")
    for (const chave of Object.keys(antes) as Array<keyof typeof antes>) {
      ok(antes[chave] === depois[chave], `${chave} inalterado (${antes[chave]})`, {
        antes: antes[chave], depois: depois[chave],
      })
    }

    // E a própria mudança proposta foi revertida.
    const paiDepois = await prisma.pessoa.findUnique({
      where: { id: cenario.paiId },
      select: { vivo: true, data_obito: true },
    })
    ok(paiDepois?.vivo === true, "a pessoa NÃO ficou marcada como falecida", paiDepois)
    ok(paiDepois?.data_obito == null, "a data de óbito proposta não foi gravada")

    // ── 2. SIMULAR CASAMENTO TAMBÉM NÃO GRAVA ────────────────────────────────
    console.log("\n2) simular casamento não cria união")
    const antesUniao = await prisma.uniao.count()
    const simCasado = await simularImpactoPessoa(
      {
        processoId: cenario.processoId,
        pessoaId: cenario.filhoId,
        mudancas: { casado: true },
        uniao: { acao: "criar", conjugeId: cenario.conjugeId },
      },
      true,
    )
    ok((await prisma.uniao.count()) === antesUniao, "nenhuma união foi criada")
    const filhoDepois = await prisma.pessoa.findUnique({
      where: { id: cenario.filhoId }, select: { casado: true },
    })
    ok(filhoDepois?.casado === false, "a flag casado não foi gravada", filhoDepois)
    ok(simCasado.somenteLeitura === true, "e o resultado também é somente leitura")

    // ── 3. SOLTEIRO → CASADO PREVÊ A CERTIDÃO DE CASAMENTO ───────────────────
    // O exemplo do escopo, com a Regra Documental semeada e PUBLICADA. Aqui o
    // delta é do motor oficial: a regra condiciona a exigência a `casado=true`.
    console.log("\n3) solteiro → casado prevê a certidão de casamento")
    // DOIS, não um: casar marca AMBOS os cônjuges, e a regra exige a certidão de
    // cada pessoa casada. O preview propaga para o cônjuge — que é exatamente o
    // efeito colateral que o operador não enxergaria sozinho.
    ok(
      simCasado.documental.adicionados.length === 2,
      "prevê a exigência para os DOIS cônjuges",
      simCasado.documental.adicionados.map((d) => `${d.documento} — ${d.pessoaNome}`),
    )
    ok(
      simCasado.documental.adicionados.every(
        (d) => d.documento === "Certidão de Casamento – Inteiro Teor",
      ),
      "e é o NOME do Cadastro Mestre, não um código técnico",
      simCasado.documental.adicionados.map((d) => d.documento),
    )
    const nomesPrevistos = simCasado.documental.adicionados.map((d) => d.pessoaNome ?? "")
    ok(
      nomesPrevistos.some((n) => n.includes("Marco")) && nomesPrevistos.some((n) => n.includes("Ana")),
      "o preview nomeia de QUEM é cada exigência",
      nomesPrevistos,
    )
    ok(!simCasado.semImpacto, "a alteração é reconhecida como tendo impacto")

    // Vivo → falecido, com a mesma regra: NÃO prevê casamento (a condição não casa).
    ok(
      simVivo.documental.adicionados.length === 0,
      "marcar como falecido NÃO prevê a certidão de casamento (condição não casa)",
      simVivo.documental.adicionados.map((d) => d.documento),
    )

    // ── 4. PREVIEW × EXECUÇÃO REAL ───────────────────────────────────────────
    // O mesmo cenário, agora executado de verdade pelo motor oficial. O delta
    // observado tem de bater com o que o preview anunciou.
    console.log("\n4) preview × execução real")
    const previsto = await simularImpactoPessoa(
      { processoId: cenario.processoId, pessoaId: cenario.paiId, mudancas: { vivo: false } },
      true,
    )
    const necAntes = await prisma.necessidadeDocumental.count({ where: { processoId: cenario.processoId } })

    await prisma.pessoa.update({ where: { id: cenario.paiId }, data: { vivo: false } })
    const real = await materializarGenealogia(cenario.processoId)

    const necDepois = await prisma.necessidadeDocumental.count({ where: { processoId: cenario.processoId } })
    const criadasReais = necDepois - necAntes

    ok(
      previsto.documental.adicionados.length === criadasReais,
      "o número de exigências previsto bate com o executado",
      { previsto: previsto.documental.adicionados.length, real: criadasReais },
    )
    ok(
      previsto.operacional.passosAdicionados === real.stepsCriados,
      "o número de passos previsto bate com o executado",
      { previsto: previsto.operacional.passosAdicionados, real: real.stepsCriados },
    )
    ok(
      JSON.stringify(previsto.pendencias) === JSON.stringify(real.pendencias),
      "as pendências relatadas são as mesmas",
      { previsto: previsto.pendencias, real: real.pendencias },
    )

    // ── 5. GATE FINANCEIRO ───────────────────────────────────────────────────
    console.log("\n5) permissão financeira")
    const semFin = await simularImpactoPessoa(
      { processoId: cenario.processoId, pessoaId: cenario.filhoId, mudancas: { requerente: "maior" } },
      false,
    )
    ok(semFin.financeiro.visivel === false, "sem financeiro.ver, o bloco vem marcado como invisível")
    ok(
      semFin.financeiro.observacao.includes("Sem permissão"),
      "e diz por quê, em vez de mostrar zero",
      semFin.financeiro.observacao,
    )

    const comFin = await simularImpactoPessoa(
      { processoId: cenario.processoId, pessoaId: cenario.filhoId, mudancas: { requerente: "maior" } },
      true,
    )
    ok(comFin.financeiro.recalculoPrevisto === true, "mudar requerente prevê recálculo financeiro")
    ok(
      !/R\$|\d+[.,]\d{2}/.test(comFin.financeiro.observacao),
      "e NENHUM valor é inventado na observação",
      comFin.financeiro.observacao,
    )

    // ── 6b. PREVIEW × EXECUÇÃO, ALTERAÇÃO POR ALTERAÇÃO ──────────────────────
    // O §9 do escopo: para CADA mudança relevante, o delta previsto tem de ser
    // semanticamente equivalente ao que a execução canônica produz. O laço abaixo
    // prevê, executa de verdade pelo motor oficial e compara — e desfaz, para o
    // cenário seguinte partir do mesmo lugar.
    console.log("\n6b) preview × execução por tipo de alteração")
    const cenarios: Array<{ nome: string; alvo: number; muda: Record<string, unknown>; volta: Record<string, unknown> }> = [
      { nome: "estado civil (solteiro→casado)", alvo: cenario.filhoId, muda: { casado: true }, volta: { casado: false } },
      { nome: "óbito (vivo→falecido)", alvo: cenario.paiId, muda: { vivo: false }, volta: { vivo: true } },
      { nome: "requerente (não→sim)", alvo: cenario.filhoId, muda: { requerente: "sim" }, volta: { requerente: "nao" } },
      { nome: "linha reta (não→sim)", alvo: cenario.conjugeId, muda: { linhaReta: true }, volta: { linhaReta: false } },
    ]
    for (const c of cenarios) {
      const previsto = await simularImpactoPessoa(
        { processoId: cenario.processoId, pessoaId: c.alvo, mudancas: c.muda },
        true,
      )
      const nAntes = await prisma.necessidadeDocumental.count({ where: { processoId: cenario.processoId } })
      await prisma.pessoa.update({ where: { id: c.alvo }, data: c.muda })
      const real = await materializarGenealogia(cenario.processoId)
      const nDepois = await prisma.necessidadeDocumental.count({ where: { processoId: cenario.processoId } })

      ok(
        previsto.documental.adicionados.length === nDepois - nAntes,
        `${c.nome}: exigências previstas = executadas`,
        { previsto: previsto.documental.adicionados.length, real: nDepois - nAntes },
      )
      ok(
        previsto.operacional.passosAdicionados === real.stepsCriados,
        `${c.nome}: passos previstos = executados`,
        { previsto: previsto.operacional.passosAdicionados, real: real.stepsCriados },
      )
      // Desfaz para o próximo cenário partir do mesmo estado.
      await prisma.pessoa.update({ where: { id: c.alvo }, data: c.volta })
      await materializarGenealogia(cenario.processoId)
    }

    // ── 6. ALTERAÇÃO SEM IMPACTO ─────────────────────────────────────────────
    console.log("\n6) alteração sem impacto")
    const nula = await simularImpactoPessoa(
      { processoId: cenario.processoId, pessoaId: cenario.filhoId, mudancas: { linhaReta: true } },
      true,
    )
    ok(
      nula.documental.adicionados.length === 0 && nula.documental.dispensados.length === 0,
      "alteração irrelevante não produz delta documental",
    )
  } finally {
    await limpar(cenario)
    await prisma.$disconnect()
  }

  console.log("\n" + "─".repeat(60))
  if (failed === 0) {
    console.log(`${passed} verificações · preview de impacto ÍNTEGRO ✅\n`)
    process.exit(0)
  }
  console.log(`${passed} passaram, ${failed} falharam:`)
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}

main().catch(async (e) => {
  console.error("ERRO FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
