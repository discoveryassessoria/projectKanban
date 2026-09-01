/**
 * PLANILHA DOCUMENTAL — projeção configurável, sem preço próprio.
 *
 * Rodar (banco de teste local, NUNCA o oficial):
 *   node scripts/mrg-banco-teste.mjs up
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/planilha-documental-projecao.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 * A planilha só sabia somar obrigação JÁ LANÇADA. Documento sem lançamento dava
 * R$ 0,00 — e R$ 0,00 é um preço válido, então a grade dizia "custa zero" quando
 * queria dizer "ainda não sei". E as colunas eram casadas por NOME
 * (`PhaseEconomicRule.componentName` = `TipoServico.nome`): renomear o serviço
 * apagava a coluna sem erro.
 *
 * Aqui a coluna é âncora por ID no cadastro canônico, o valor vem do resolvedor
 * oficial de preço, e a célula tem ESTADO — o número só aparece quando significa
 * alguma coisa.
 */
import { prisma } from "../src/lib/prisma"

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

import { montarPlanilhaDocumental } from "../lib/financeiro/leitura/planilha-documental"
import {
  adicionarColuna, listarColunasConfiguradas, definirAtiva, reordenarColunas, definirRotulo, removerColuna,
} from "../lib/financeiro/leitura/planilha-colunas"
import { criarObrigacaoEconomicaComLedger } from "../lib/financeiro/ledger/ledger-service"
import { vincularRequerente } from "../lib/genealogia/vincular-requerente"
import { removerPessoaDaArvore } from "../src/services/pessoa-ciclo-vida"
import { garantirOferta } from "./_fixture-oferta"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "PLANILHA-PROJ"
const FASE = "emissao_documental"

interface Palco {
  processoId: number; arvoreId: number; pessoaId: number; documentoId: number
  tipoDocId: number; cfgCertidao: number; cfgTraducao: number; cfgSemPreco: number; cfgZero: number
  cfgA_expl: number
}

async function limpar() {
  await prisma.planilhaDocumentalColuna.deleteMany({
    where: { OR: [{ config: { nome: { startsWith: MARCA } } }, { tipoDocumento: { name: { startsWith: MARCA } } }] },
  })
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
      await prisma.documento.deleteMany({ where: { pessoaId: { in: pIds } } })
      await prisma.requerente.updateMany({ where: { personId: { in: pIds } }, data: { personId: null } })
      await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: pIds } }, data: { pessoaPrincipalId: null } })
      await prisma.pessoa.deleteMany({ where: { id: { in: pIds } } })
    }
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  // A CONFIGURAÇÃO DE COLUNAS É GLOBAL — não tem processo nem marca a que
  // pertencer. Um cenário que afirma "sem configuração, zero colunas" precisa
  // portanto zerar a configuração inteira, e não só a parte que ele criou:
  // qualquer coluna deixada por outro cenário (o palco visual, por exemplo)
  // apareceria aqui como coluna "do sistema" e derrubaria a asserção.
  for (const c of await prisma.planilhaDocumentalColuna.findMany({ select: { id: true } })) {
    await prisma.planilhaDocumentalColuna.delete({ where: { id: c.id } })
  }
  await prisma.requerente.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.matrizDocumental.deleteMany({ where: { documentTypeCode: { startsWith: MARCA } } })
  await prisma.phaseEconomicRule.deleteMany({ where: { componentKey: { startsWith: MARCA } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Uma Configuração Financeira de CUSTO, opcionalmente com preço vigente. */
async function config(sufixo: string, valor: number | null): Promise<number> {
  const c = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA}-${sufixo}`.slice(0, 30), nome: `${MARCA} ${sufixo}`, moedaPadrao: "BRL", possuiCusto: true },
    select: { id: true },
  })
  if (valor !== null) {
    await prisma.tabelaValor.create({
      data: {
        name: `${MARCA} preço ${sufixo}`, configuracaoFinanceiraItemId: c.id, natureza: "CUSTO",
        moeda: "BRL", modoCalculo: "fixed", valor, prioridade: 10,
      },
    })
  }
  return c.id
}

async function montarPalco(): Promise<Palco> {
  const oferta = await garantirOferta(prisma, { countryKey: "espanha", countryLabel: "Espanha", nationalityKey: "espanhola", nationalityLabel: "Espanhola", modalityKey: "descendencia", modalityLabel: "Descendência" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: MARCA, name: `${MARCA} tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
      }, select: { id: true },
  })
  const tipoDoc = await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}-NASC`, name: `${MARCA} Certidão de Nascimento`, participaPlanilha: true, ativo: true },
    select: { id: true },
  })

  const cfgCertidao = await config("Certidao", 146.24)
  const cfgTraducao = await config("Traducao", 185.45)
  const cfgSemPreco = await config("SemPreco", null)   // aplicável, sem preço
  const cfgZero = await config("Zero", 0)              // preço REALMENTE zero

  // A Matriz publica a exigência; a Regra Econômica diz QUAIS componentes ela produz.
  await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: tipo.id, phaseKey: FASE, documentTypeCode: `${MARCA}-NASC`,
      status: "PUBLICADA", createsCost: true, createsTask: false, arquivado: false,
    },
  })
  // Certidão, Sem-preço e Zero são aplicáveis. Tradução NÃO tem regra econômica
  // aqui — é o caso "coluna configurada, serviço não aplicável".
  for (const [i, cfg] of [cfgCertidao, cfgSemPreco, cfgZero].entries()) {
    await prisma.phaseEconomicRule.create({
      data: {
        tipoProcessoId: tipo.id, phaseKey: FASE, componentKey: `${MARCA}-C${i}`,
        componentName: `${MARCA} componente ${i}`, custoConfigId: cfg, ativo: true, ordem: i,
      },
    })
  }

  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arvore.id, faseAtualKey: FASE, tipoProcessoMotorId: tipo.id },
    select: { id: true },
  })
  const req = await prisma.requerente.create({ data: { nome: `${MARCA} Valdir Teste` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: req.id } })
  const v = await vincularRequerente({ arvoreId: arvore.id, requerenteId: req.id })
  if (!v.ok) throw new Error(v.code)

  const doc = await prisma.documento.create({
    data: {
      pessoaId: v.pessoaId, documentTypeId: tipoDoc.id, descricao: `${MARCA} certidão`,
      cartorio: "1º Ofício", livro: "A-1", folha: "123", termo: "456",
      cidade_registro: "São Paulo", estado_registro: "SP",
      data_registro: new Date("1947-06-26T00:00:00Z"),
    },
    select: { id: true },
  })

  return {
    processoId: processo.id, arvoreId: arvore.id, pessoaId: v.pessoaId, documentoId: doc.id,
    tipoDocId: tipoDoc.id, cfgCertidao, cfgTraducao, cfgSemPreco, cfgZero,
    cfgA_expl: 0,
  }
}

const celula = (p: Awaited<ReturnType<typeof montarPlanilhaDocumental>>, configId: number) =>
  p.pessoas[0]?.linhas[0]?.celulas.find((c) => c.tipoServicoId === configId)

async function main() {
  console.log("PLANILHA DOCUMENTAL — projeção configurável\n")
  await limpar()
  const p = await montarPalco()

  // ═════════════════════════════════════════════════════════════════════════
  secao("0) SEM configuração, nenhuma coluna econômica nasce")
  // ═════════════════════════════════════════════════════════════════════════
  // Em 09/08/2026 quatro colunas apareceram em produção sem o usuário as ter
  // pedido. Não houve seed nem default — mas nada provava a ausência deles.
  // Estas asserções provam: existir no cadastro, ter preço ou ser usado por uma
  // Regra Documental NÃO faz um serviço virar coluna.
  {
    const vazia = await montarPlanilhaDocumental(p.processoId)
    ok("planilha sem configuração não tem coluna econômica", vazia.colunas.length === 0, `${vazia.colunas.length}`)
    ok("mesmo com o serviço cadastrado no mestre", (await prisma.produtoFinanceiro.count({ where: { id: p.cfgCertidao } })) === 1)
    ok("mesmo com preço de CUSTO vigente", (await prisma.tabelaValor.count({ where: { configuracaoFinanceiraItemId: p.cfgCertidao, natureza: "CUSTO" } })) === 1)
    ok("mesmo com Regra Documental publicada usando o serviço",
      (await prisma.phaseEconomicRule.count({ where: { custoConfigId: p.cfgCertidao, ativo: true } })) === 1)
    ok("a linha da pessoa existe, só não tem célula econômica",
      vazia.pessoas.length === 1 && vazia.pessoas[0].linhas.length === 1 && vazia.pessoas[0].linhas[0].celulas.length === 0)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("1–3) Colunas vêm do cadastro canônico, e não carregam preço")
  // ═════════════════════════════════════════════════════════════════════════
  const colServico = await adicionarColuna({ origem: "SERVICO", itemId: p.cfgCertidao })
  ok("1: coluna criada a partir de Serviço canônico (Configuração Financeira)",
    colServico.origem === "SERVICO" && colServico.configId === p.cfgCertidao)
  const colDoc = await adicionarColuna({ origem: "DOCUMENTO", itemId: p.tipoDocId })
  ok("2: coluna criada a partir de Documento canônico", colDoc.origem === "DOCUMENTO" && colDoc.tipoDocumentoId === p.tipoDocId)

  const campos = Object.keys(await prisma.planilhaDocumentalColuna.findFirstOrThrow({ where: { id: colServico.id } }))
  ok("3: a coluna NÃO tem campo de preço, moeda, fornecedor ou vigência",
    !campos.some((c) => /valor|preco|moeda|fornecedor|vigencia/i.test(c)), campos.join(", "))
  ok("3: pedir o mesmo item duas vezes não cria segunda coluna",
    (await adicionarColuna({ origem: "SERVICO", itemId: p.cfgCertidao })).id === colServico.id)

  await adicionarColuna({ origem: "SERVICO", itemId: p.cfgTraducao })
  await adicionarColuna({ origem: "SERVICO", itemId: p.cfgSemPreco })
  await adicionarColuna({ origem: "SERVICO", itemId: p.cfgZero })

  // ═════════════════════════════════════════════════════════════════════════
  secao("9–11) Estado da célula — o número só aparece quando significa algo")
  // ═════════════════════════════════════════════════════════════════════════
  let pl = await montarPlanilhaDocumental(p.processoId)
  ok("a planilha tem um bloco para a pessoa da árvore", pl.pessoas.length === 1 && pl.pessoas[0].linhas.length === 1,
    `${pl.pessoas.length} bloco(s)`)

  const cCert = celula(pl, p.cfgCertidao)
  ok("preço vem da Tabela de Preços, resolvido (PREVISTO)",
    cCert?.estado === "PREVISTO" && cCert?.valorBrl === 146.24, `${cCert?.estado} ${cCert?.valorBrl}`)
  // SEM REGRA, MAS COM PREÇO: o valor NÃO some.
  //
  // A versão anterior devolvia NAO_APLICAVEL antes mesmo de olhar a Tabela, e
  // a planilha exibia "—" com o preço cadastrado e resolvível — dizia "não
  // custa nada" quando queria dizer "ainda não sei se aplica". São duas
  // perguntas diferentes: quanto custa é da Tabela; se incide é da Regra.
  const cTrad = celula(pl, p.cfgTraducao)
  ok("10: serviço com preço mas sem regra vira BASE_DISPONIVEL, não —",
    cTrad?.estado === "BASE_DISPONIVEL", String(cTrad?.estado))
  ok("10: e o preço base cadastrado aparece", cTrad?.valorBase === 185.45, String(cTrad?.valorBase))
  // VALOR VISÍVEL SOMA. A planilha é de previsão: um número impresso na célula
  // que ficasse fora do total quebraria a conferência de quem lê — as células
  // não fechariam com o rodapé. Projetar continua não sendo lançar: nenhuma
  // obrigação nasce daqui, e `totalBaseBrl` diz quanto do total ainda depende
  // de Regra Documental.
  ok("10: e o valor visível entra no efetivo", cTrad?.valorEfetivo === 185.45, String(cTrad?.valorEfetivo))
  ok("10: e a célula aceita combinado manual", cTrad?.editavel === true)
  ok("9: aplicável sem preço na tabela mostra 'Sem valor'",
    celula(pl, p.cfgSemPreco)?.estado === "SEM_PRECO" && celula(pl, p.cfgSemPreco)?.valorBrl === null)
  // ── 11 · DIVERGÊNCIA DECLARADA ────────────────────────────────────────────
  // A especificação pede que R$ 0,00 seja preço válido e apareça como 0,00. O
  // RESOLVEDOR OFICIAL de preço recusa zero por decisão própria ("Fase 7": linha
  // com valor 0 não é preço válido, para nunca lançar cobrança zero em silêncio).
  //
  // A planilha NÃO tem uma segunda régua de preço — se tivesse, seria a segunda
  // fonte da verdade que este desenho existe para impedir. Então ela reporta o
  // que o resolvedor diz, e o teste registra a divergência em vez de escondê-la:
  // mudar isso é decisão sobre o motor de preços, não sobre a planilha.
  const cZero = celula(pl, p.cfgZero)
  ok("11: preço 0,00 segue a régua do resolvedor oficial (recusa zero), sem régua paralela na planilha",
    cZero?.estado === "SEM_PRECO" && /zero/i.test(cZero?.explicacao.motivo ?? ""),
    `${cZero?.estado} — motivo: ${cZero?.explicacao.motivo}`)
  ok("o total da linha soma TODAS as células visíveis",
    pl.pessoas[0].linhas[0].totalBrl === 331.69,
    `${pl.pessoas[0].linhas[0].totalBrl} = 146,24 (previsto) + 185,45 (base)`)
  ok("e o domínio ainda sabe quanto disso depende de Regra Documental",
    pl.totalBaseBrl === 185.45, String(pl.totalBaseBrl))

  // ═════════════════════════════════════════════════════════════════════════
  secao("18–21) Totais e centavos")
  // ═════════════════════════════════════════════════════════════════════════
  ok("18: total da linha soma toda célula com valor visível", pl.pessoas[0].linhas[0].totalBrl === 331.69, String(pl.pessoas[0].linhas[0].totalBrl))
  ok("19: subtotal da pessoa confere", pl.pessoas[0].totalBrl === 331.69, String(pl.pessoas[0].totalBrl))
  ok("20: total do processo confere", pl.totalGeralBrl === 331.69, String(pl.totalGeralBrl))
  ok("previsto e realizado são somados separadamente",
    pl.totalPrevistoBrl === 331.69 && pl.totalRealizadoBrl === 0, `${pl.totalPrevistoBrl}/${pl.totalRealizadoBrl}`)

  // 21) centavos: três preços que quebram em float (146.24 + 7.64 + 151.05).
  const cfgA = await config("CentA", 7.64); const cfgB = await config("CentB", 151.05)
  p.cfgA_expl = cfgA
  for (const [i, cfg] of [cfgA, cfgB].entries()) {
    await prisma.phaseEconomicRule.create({
      data: { tipoProcessoId: (await prisma.processo.findUniqueOrThrow({ where: { id: p.processoId }, select: { tipoProcessoMotorId: true } })).tipoProcessoMotorId, phaseKey: FASE, componentKey: `${MARCA}-CENT${i}`, componentName: `${MARCA} cent ${i}`, custoConfigId: cfg, ativo: true },
    })
    await adicionarColuna({ origem: "SERVICO", itemId: cfg })
  }
  pl = await montarPlanilhaDocumental(p.processoId)
  // 146,24 + 7,64 + 151,05 = 304,93 — e mais os 185,45 da tradução, que também
  // está visível na linha. O que este caso trava é o CENTAVO: em float a soma
  // dos três primeiros já erra, e é por isso que o acumulador é inteiro.
  ok("21: 146,24 + 7,64 + 151,05 (+185,45) = 490,38 sem erro de centavo",
    pl.pessoas[0].linhas[0].totalBrl === 490.38, String(pl.pessoas[0].linhas[0].totalBrl))

  // ═════════════════════════════════════════════════════════════════════════
  secao("4) Mudar o preço atualiza o PREVISTO")
  // ═════════════════════════════════════════════════════════════════════════
  await prisma.tabelaValor.updateMany({ where: { name: `${MARCA} preço Certidao` }, data: { valor: 160 } })
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("4: previsto acompanha a Tabela de Preços", celula(pl, p.cfgCertidao)?.valorBrl === 160, String(celula(pl, p.cfgCertidao)?.valorBrl))

  // ═════════════════════════════════════════════════════════════════════════
  secao("5) Realizado usa SNAPSHOT — mudar a tabela não reescreve o fato")
  // ═════════════════════════════════════════════════════════════════════════
  await criarObrigacaoEconomicaComLedger({
    natureza: "CUSTO", valorContratado: 146.24, moedaContratual: "BRL", codigoOperacional: `${MARCA}-CUSTO-1`,
    processoId: p.processoId, origemTipo: "nativo", origemId: null,
    vinculo: { personId: p.pessoaId, documentoId: p.documentoId, configFinanceiraId: p.cfgCertidao, phaseKey: FASE, phaseCycle: 1 },
  })
  pl = await montarPlanilhaDocumental(p.processoId)
  const cReal = celula(pl, p.cfgCertidao)
  ok("5: a célula passa a REALIZADO", cReal?.estado === "REALIZADO", String(cReal?.estado))
  ok("5: mostra o valor CONGELADO (146,24), não o da tabela nova (160,00)", cReal?.valorBrl === 146.24, String(cReal?.valorBrl))
  ok("5: a explicação diz que o valor é congelado", /congelado/i.test(cReal?.explicacao.origem ?? ""))
  await prisma.tabelaValor.updateMany({ where: { name: `${MARCA} preço Certidao` }, data: { valor: 999 } })
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("5: alterar a tabela de novo não move o histórico", celula(pl, p.cfgCertidao)?.valorBrl === 146.24)
  ok("realizado entra no total de realizado, não no de previsto", pl.totalRealizadoBrl === 146.24)

  // ═════════════════════════════════════════════════════════════════════════
  secao("40) Célula explicável")
  // ═════════════════════════════════════════════════════════════════════════
  const expPrev = celula(pl, p.cfgA_expl)?.explicacao
  ok("40: célula prevista diz serviço, origem e a linha de preço usada",
    !!expPrev?.servico && expPrev?.origem === "Tabela de Preços" && expPrev?.tabelaValorId != null,
    JSON.stringify(expPrev))
  ok("40: célula com preço em aberto diz por que não entra no total",
    /Regra Documental ainda não definiu/.test(celula(pl, p.cfgTraducao)?.explicacao.motivo ?? ""),
    celula(pl, p.cfgTraducao)?.explicacao.motivo ?? "")
  ok("40: célula sem preço diz POR QUE está vazia",
    (celula(pl, p.cfgSemPreco)?.explicacao.motivo ?? "").length > 0)

  // ═════════════════════════════════════════════════════════════════════════
  secao("6–8) Inativar, reativar e ordenar")
  // ═════════════════════════════════════════════════════════════════════════
  const todas = await listarColunasConfiguradas()
  const alvo = todas.find((c) => c.configId === p.cfgTraducao)!
  await definirAtiva(alvo.id, false)
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("6: coluna inativa some da planilha", !pl.colunas.some((c) => c.tipoServicoId === p.cfgTraducao))
  ok("6: o serviço e o preço continuam existindo",
    (await prisma.produtoFinanceiro.count({ where: { id: p.cfgTraducao } })) === 1)
  await definirAtiva(alvo.id, true)
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("7: reativar traz a coluna de volta", pl.colunas.some((c) => c.tipoServicoId === p.cfgTraducao))

  const ordemAtual = (await listarColunasConfiguradas()).map((c) => c.id)
  await reordenarColunas([...ordemAtual].reverse())
  const reordenadas = await listarColunasConfiguradas()
  ok("8: ordenar colunas funciona e persiste por POSIÇÃO",
    reordenadas.map((c) => c.id).join(",") === [...ordemAtual].reverse().join(","))
  ok("8: a planilha respeita a ordem configurada",
    (await montarPlanilhaDocumental(p.processoId)).colunas[0].tipoServicoId ===
      (reordenadas.find((c) => c.ativa)!.configId ?? reordenadas[0].tipoDocumentoId))

  await definirRotulo(alvo.id, "Tradução")
  ok("32: rótulo curto é só apresentação — o cadastro não muda",
    (await listarColunasConfiguradas()).find((c) => c.id === alvo.id)?.rotulo === "Tradução" &&
    (await prisma.produtoFinanceiro.findUniqueOrThrow({ where: { id: p.cfgTraducao }, select: { nome: true } })).nome.startsWith(MARCA))

  // ═════════════════════════════════════════════════════════════════════════
  secao("12·15) Custo ≠ venda; registro localizado")
  // ═════════════════════════════════════════════════════════════════════════
  // Preço de VENDA bem mais alto e com prioridade maior no MESMO item: se a
  // planilha de custos olhasse a natureza errada, ela apareceria aqui.
  await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço VENDA CentA`, configuracaoFinanceiraItemId: p.cfgA_expl, natureza: "VENDA",
      moeda: "BRL", modoCalculo: "fixed", valor: 500, prioridade: 99,
    },
  })
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("15: a planilha de custos usa o preço de CUSTO e ignora o de VENDA",
    celula(pl, p.cfgA_expl)?.valorBrl === 7.64, String(celula(pl, p.cfgA_expl)?.valorBrl))
  ok("12: o documento com cartório+livro/folha/termo é marcado como localizado", pl.pessoas[0].linhas[0].localizado === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao("13–14) Árvore manda: pessoa removida some, requerente fora não entra")
  // ═════════════════════════════════════════════════════════════════════════
  const reqFora = await prisma.requerente.create({ data: { nome: `${MARCA} Fora Da Arvore` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: p.processoId, requerenteId: reqFora.id } })
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("14: requerente cadastrado e fora da árvore NÃO gera bloco", pl.pessoas.length === 1, `${pl.pessoas.length}`)

  await removerPessoaDaArvore({ pessoaId: p.pessoaId })
  pl = await montarPlanilhaDocumental(p.processoId)
  ok("13: pessoa removida da árvore não deixa bloco órfão", pl.pessoas.length === 0, `${pl.pessoas.length}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("8·10) Remover a coluna some — e nada a traz de volta sozinho")
  // ═════════════════════════════════════════════════════════════════════════
  {
    for (const c of await listarColunasConfiguradas()) await removerColuna(c.id)
    const semColunas = await montarPlanilhaDocumental(p.processoId)
    ok("8: sem configuração, zero colunas econômicas", semColunas.colunas.length === 0)
    ok("8: o cadastro mestre continua intacto",
      (await prisma.produtoFinanceiro.count({ where: { id: { in: [p.cfgCertidao, p.cfgTraducao] } } })) === 2)
    ok("8: o preço continua intacto", (await prisma.tabelaValor.count({ where: { configuracaoFinanceiraItemId: p.cfgCertidao } })) >= 1)
    // Reler duas vezes: nenhuma leitura recria coluna (a projeção não escreve).
    const a = await montarPlanilhaDocumental(p.processoId)
    const b = await montarPlanilhaDocumental(p.processoId)
    ok("10: releitura preserva exatamente a configuração (zero)", a.colunas.length === 0 && b.colunas.length === 0)
  }

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`)
    process.exitCode = 1; return
  }
  console.log("A planilha projeta o domínio: colunas do cadastro, valores da Tabela de Preços.\n")
}

main().catch((e) => { console.error("\n💥", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
