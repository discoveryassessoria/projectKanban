// scripts/custo-documental.test.ts
//
// CUSTO DOCUMENTAL AUTOMÁTICO — do registro localizado até a planilha.
//
// Monta um cenário canônico completo (árvore → pessoa → documento → passo
// registral → Matriz → componente econômico → Tabela de Preços) e prova a cadeia
// inteira: o custo nasce da conclusão do passo, carrega pessoa/documento/serviço,
// congela o preço, não duplica em retry nem em reabertura, não se mistura com o
// custo manual, e a planilha soma por linha, por pessoa e por processo.
//
// ⚠ ESCREVE. Roda contra banco NÃO-produtivo (o guard de escrita cobre isso nos
// scripts npm). Limpa tudo o que cria, na ordem das FKs.

import { prisma } from "@/lib/prisma"
import { projetarCustosDocumentaisDoPasso } from "@/src/services/financeiro/projecao-documental"
import { montarPlanilhaDocumental } from "@/lib/financeiro/leitura/planilha-documental"
import { criarLancamentoExtra } from "@/lib/financeiro/extras/lancamento-extra-service"
import { reconciliarDocumentalFinanceiro } from "@/src/services/financeiro/reconciliacao-documental-financeira"
import { ORIGEM_AUTOMATICA, ORIGEM_MANUAL, ehAutomatico } from "@/lib/financeiro/dominio/origem-lancamento"

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const TS = Date.now()
const TAG = `custo-doc-${TS}`

const FASE = "genealogia"
let TIPO_PROCESSO = 0 // criado no cenário (Processo.tipoProcessoMotorId tem FK)
const CODE_DOC = `CERT_NAS_${TS}`.slice(0, 40)   // identidade da regra: o CÓDIGO do cadastro
const VALOR_EMISSAO = 250
const VALOR_APOSTILA = 120

interface Criado {
  arvoreId?: number; pessoaId?: number; documentoId?: number; processoId?: number
  wfInstanceId?: number; stepId?: number
  tipoProcessoId?: number; tipoDocId?: number
  matrizIds: number[]; econIds: number[]; configIds: number[]; tabelaIds: number[]
  tipoDocExtraIds: number[]; documentoExtraIds: number[]
}
const criado: Criado = { matrizIds: [], econIds: [], configIds: [], tabelaIds: [], tipoDocExtraIds: [], documentoExtraIds: [] }

async function montarCenario() {
  const tipoProc = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `TP-${TS}`.slice(0, 40), name: `Tipo ${TAG}`,
      countryKey: "italia", countryLabel: "Itália", nationalityKey: "italiana", nationalityLabel: "Italiana",
      modalityKey: "teste", modalityLabel: "Teste",
    },
  })
  TIPO_PROCESSO = tipoProc.id
  criado.tipoProcessoId = tipoProc.id

  // O tipo documental é CADASTRO próprio do cenário — o teste não altera nem
  // depende do cadastro do ambiente. `code` é a identidade que a regra da Matriz
  // referencia; sem `legacyEnumKey`, para provar que a resolução é pelo VÍNCULO.
  const tipoDoc = await prisma.tipoDocumentoCadastro.create({
    data: { code: CODE_DOC, name: `Certidão de Nascimento — Inteiro Teor ${TAG}`, participaPlanilha: true, ativo: true },
  })
  criado.tipoDocId = tipoDoc.id

  const arvore = await prisma.arvore.create({ data: { nome: `Arvore ${TAG}` } })
  criado.arvoreId = arvore.id

  const pessoa = await prisma.pessoa.create({
    data: { nome: "Requerente", sobrenome: TAG, arvoreId: arvore.id, linhaReta: true, casado: false, vivo: true, numeroLinhagem: 1 },
  })
  criado.pessoaId = pessoa.id

  // Documento LOCALIZADO pela régua oficial: cartório + livro.
  const doc = await prisma.documento.create({
    data: {
      // enum legado presente E vínculo canônico presente: o canônico é quem manda.
      pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR", documentTypeId: tipoDoc.id, status: "RECEBIDO",
      cartorio: "Cartório de Teste", livro: "A-1", folha: "10", termo: "1234",
    },
  })
  criado.documentoId = doc.id

  const processo = await prisma.processo.create({
    data: { nome: `Processo ${TAG}`, pais: "Italia", arvoreId: arvore.id, tipoProcessoMotorId: TIPO_PROCESSO, faseAtualKey: FASE },
  })
  criado.processoId = processo.id

  const wf = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: FASE, chaveIdempotencia: `wf-${TAG}` },
  })
  criado.wfInstanceId = wf.id

  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: wf.id, stepKey: "localizar_registro", processoId: processo.id,
      faseMacroKey: FASE, documentoId: doc.id, ciclo: 1, status: "CONCLUIDO", completedAt: new Date(),
      chaveIdempotencia: `step-${TAG}`,
    },
  })
  criado.stepId = step.id

  // ── CADASTRO: o que exige (Matriz) e o que produz (componente + preço) ──────
  const matriz = await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: TIPO_PROCESSO, phaseKey: FASE, documentTypeCode: CODE_DOC,
      target: "direct_line_person", generationRule: "all_direct_line",
      createsTask: false, createsCost: true, createsRevenue: false, status: 'PUBLICADA',
    },
  })
  criado.matrizIds.push(matriz.id)

  for (const [nome, valor] of [["Emissão de Certidão", VALOR_EMISSAO], ["Apostilamento da Certidão", VALOR_APOSTILA]] as const) {
    const cfg = await prisma.produtoFinanceiro.create({
      data: { codigo: `CFG-${TAG}-${nome.slice(0, 6)}`.slice(0, 30), nome, ativo: true },
    })
    criado.configIds.push(cfg.id)
    const tv = await prisma.tabelaValor.create({
      data: {
        name: nome, moeda: "BRL", valor, modoCalculo: "per_document", unidade: "documento",
        natureza: "CUSTO", configuracaoFinanceiraItemId: cfg.id, vigenciaInicio: "2020-01-01",
      },
    })
    criado.tabelaIds.push(tv.id)
    const econ = await prisma.phaseEconomicRule.create({
      data: {
        tipoProcessoId: TIPO_PROCESSO, phaseKey: FASE, documentTypeCode: CODE_DOC,
        componentKey: nome.toUpperCase().replace(/\W+/g, "_").slice(0, 40), componentName: nome,
        custoConfigId: cfg.id, participaPlanilha: true, ordem: criado.econIds.length, ativo: true,
      },
    })
    criado.econIds.push(econ.id)
  }
}

async function limpar() {
  const pid = criado.processoId
  if (pid) {
    const obrs = await prisma.obrigacaoEconomica.findMany({ where: { processoId: pid }, select: { id: true } })
    for (const { id } of obrs) {
      await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: id } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
      await prisma.parcelaPagavel.deleteMany({ where: { obrigacaoId: id } })
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: id } })
      await prisma.domainOutbox.deleteMany({ where: { aggregateType: "ObrigacaoEconomica", aggregateId: id } })
      await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
    }
    await prisma.motorArtefato.deleteMany({ where: { processoId: pid } })
    await prisma.pendenciaFinanceira.deleteMany({ where: { processoId: pid } })
    await prisma.tipoServico.deleteMany({ where: { processoId: pid } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: pid } })
  }
  if (criado.stepId) await prisma.phaseWorkflowStepInstance.deleteMany({ where: { id: criado.stepId } })
  if (criado.wfInstanceId) await prisma.phaseWorkflowInstance.deleteMany({ where: { id: criado.wfInstanceId } })
  if (pid) await prisma.processo.deleteMany({ where: { id: pid } })
  if (criado.documentoExtraIds.length) await prisma.documento.deleteMany({ where: { id: { in: criado.documentoExtraIds } } })
  if (criado.documentoId) await prisma.documento.deleteMany({ where: { id: criado.documentoId } })
  if (criado.pessoaId) await prisma.pessoa.deleteMany({ where: { id: criado.pessoaId } })
  if (criado.arvoreId) await prisma.arvore.deleteMany({ where: { id: criado.arvoreId } })
  await prisma.phaseEconomicRule.deleteMany({ where: { id: { in: criado.econIds } } })
  await prisma.tabelaValor.deleteMany({ where: { id: { in: criado.tabelaIds } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { id: { in: criado.configIds } } })
  await prisma.matrizDocumental.deleteMany({ where: { id: { in: criado.matrizIds } } })
  if (criado.tipoDocExtraIds.length) await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: { in: criado.tipoDocExtraIds } } })
  if (criado.tipoProcessoId) await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: criado.tipoProcessoId } })
  if (criado.tipoDocId) await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: criado.tipoDocId } })
}

async function main() {
  await montarCenario()
  const pid = criado.processoId as number
  const stepId = criado.stepId as number
  const docId = criado.documentoId as number

  // ── 1. registro localizado dispara a projeção ────────────────────────────
  const r1 = await projetarCustosDocumentaisDoPasso(stepId)
  chk(r1.projetou, `passo registral concluído projeta (motivo=${r1.motivo ?? "—"})`)
  const custos1 = await prisma.obrigacaoEconomica.findMany({ where: { processoId: pid, natureza: "CUSTO" } })
  chk(custos1.length === 2, `dois custos criados, um por serviço configurado (${custos1.length})`)

  // ── 2. cada custo tem pessoa, documento, serviço, evento e preço congelado ─
  const emissao = custos1.find((c) => Number(c.valorContratado) === VALOR_EMISSAO)
  chk(emissao?.personId === criado.pessoaId, "custo vincula a PESSOA")
  chk(emissao?.documentoId === docId, "custo vincula o DOCUMENTO")
  chk(emissao?.tipoServicoId != null, "custo vincula o SERVIÇO")
  chk(emissao?.eventoOrigemId === stepId, "custo guarda o EVENTO de origem (passo)")
  chk(emissao?.origemLancamento === ORIGEM_AUTOMATICA, "origem declarada como automática documental")
  chk(emissao?.pricingRuleId != null && emissao?.valorUnitario != null, "preço CONGELADO (regra + unitário)")
  chk(emissao?.chaveIdempotencia != null, "chave idempotente gravada")
  chk(!custos1.some((c) => c.pricingRuleId == null), "nenhum valor veio de fora da Tabela de Preços")

  // ── 3. retry não duplica ─────────────────────────────────────────────────
  await projetarCustosDocumentaisDoPasso(stepId)
  await projetarCustosDocumentaisDoPasso(stepId)
  const custos2 = await prisma.obrigacaoEconomica.count({ where: { processoId: pid, natureza: "CUSTO" } })
  chk(custos2 === 2, `reprocessar o evento NÃO duplica (${custos2})`)

  // ── 4. reabrir e concluir de novo não duplica ────────────────────────────
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { status: "EM_ANDAMENTO" } })
  const rReaberto = await projetarCustosDocumentaisDoPasso(stepId)
  chk(!rReaberto.projetou && rReaberto.motivo === "PASSO_NAO_CONCLUIDO", "passo reaberto não projeta")
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { status: "CONCLUIDO" } })
  await projetarCustosDocumentaisDoPasso(stepId)
  chk((await prisma.obrigacaoEconomica.count({ where: { processoId: pid, natureza: "CUSTO" } })) === 2,
    "reabertura + nova conclusão NÃO duplica")

  // ── 5. custo pago não é apagado nem recriado ─────────────────────────────
  chk(custos1.every((c) => c.status !== "CANCELADO"), "custos permanecem ativos entre reprocessos")

  // ── 6. mudar a Tabela de Preços não reescreve o histórico ────────────────
  const antes = Number(emissao?.valorContratado)
  await prisma.tabelaValor.update({ where: { id: criado.tabelaIds[0] }, data: { valor: 999 } })
  await projetarCustosDocumentaisDoPasso(stepId)
  const depois = await prisma.obrigacaoEconomica.findUnique({ where: { id: emissao!.id } })
  chk(Number(depois?.valorContratado) === antes, `preço histórico intacto após nova tabela (${antes})`)
  await prisma.tabelaValor.update({ where: { id: criado.tabelaIds[0] }, data: { valor: VALOR_EMISSAO } })

  // ── 7. custo manual permanece separado ───────────────────────────────────
  const manual = await criarLancamentoExtra({ natureza: "CUSTO", valor: 77, moeda: "BRL", processoId: pid, descricao: `manual ${TAG}` })
  const todos = await prisma.obrigacaoEconomica.findMany({ where: { processoId: pid, natureza: "CUSTO" } })
  const manualRow = todos.find((c) => c.id === manual.obrigacaoId)
  chk(manualRow?.origemLancamento === ORIGEM_MANUAL, "custo manual nasce declarado MANUAL")
  chk(manualRow?.documentoId == null, "custo manual não inventa vínculo documental")
  chk(todos.filter((c) => ehAutomatico(c.origemLancamento)).length === 2, "automáticos continuam 2 depois do manual")

  // ── 8. planilha: colunas derivadas e somas corretas ──────────────────────
  const pl = await montarPlanilhaDocumental(pid)
  chk(pl.colunas.length === 2, `colunas derivadas do cadastro, não fixas (${pl.colunas.length})`)
  const bloco = pl.pessoas.find((b) => b.pessoaId === criado.pessoaId)
  chk(!!bloco && bloco.linhas.length === 1, "uma linha por documento da pessoa")
  const linha = bloco!.linhas[0]
  chk(linha.localizado, "linha marcada como localizada (régua oficial)")
  chk(Math.abs(linha.totalBrl - (VALOR_EMISSAO + VALOR_APOSTILA)) < 0.01, `total da LINHA correto (${linha.totalBrl})`)
  chk(Math.abs(bloco!.totalBrl - (VALOR_EMISSAO + VALOR_APOSTILA)) < 0.01, `total da PESSOA correto (${bloco!.totalBrl})`)
  chk(Math.abs(pl.totalGeralBrl - (VALOR_EMISSAO + VALOR_APOSTILA)) < 0.01, `total GERAL correto (${pl.totalGeralBrl})`)
  chk(pl.custosSemVinculo === 1, "custo manual fica FORA da grade e é contado explicitamente")

  // ── 9. reconciliação não acusa falta onde está tudo lançado ──────────────
  const rec = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: false })
  chk(rec.documentosLocalizados === 1, "reconciliação enxerga o documento localizado")
  chk(!rec.achados.some((a) => a.tipo === "SEM_REGRA_NA_MATRIZ"), "não acusa falta de regra quando há regra")

  // ── 10. reconciliação detecta o custo AUSENTE ────────────────────────────
  const alvo = custos1[0]
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: alvo.id } })
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: alvo.id } })
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: alvo.id } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: alvo.id } })
  await prisma.obrigacaoEconomica.delete({ where: { id: alvo.id } })
  await prisma.motorArtefato.deleteMany({ where: { processoId: pid, automaticKey: { contains: "::custo" } } })
  const rec2 = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: true })
  chk(rec2.reparados >= 1, `backfill recria o lançamento ausente (${rec2.reparados})`)
  const recriado = await prisma.obrigacaoEconomica.findFirst({
    where: { processoId: pid, natureza: "CUSTO", origemLancamento: "BACKFILL_DOCUMENTAL" },
  })
  chk(recriado?.documentoId === docId, "lançamento do backfill nasce com o mesmo vínculo documental")
  const rec3 = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: true })
  chk(rec3.reparados === 0, "backfill é idempotente (segunda passada não cria nada)")

  // ── 11. REGRESSÃO: documento de tipo NOVO (sem enum legado) gera custo ────
  // Antes, o motor filtrava por `String(d.tipo).includes('NAS')`. Um documento
  // criado a partir de um tipo mestre novo tem `tipo = null` e `documentTypeId`
  // preenchido — e não gerava custo NENHUM, sem erro e sem linha em `pulados`.
  const tipoNovo = await prisma.tipoDocumentoCadastro.create({
    data: { code: `CERT_NOVO_${TS}`.slice(0, 40), name: `Certidão sem enum ${TAG}`, participaPlanilha: true, ativo: true },
  })
  const docSemEnum = await prisma.documento.create({
    data: {
      pessoaId: criado.pessoaId as number, tipo: null, documentTypeId: tipoNovo.id, status: "RECEBIDO",
      cartorio: "Cartório Novo", livro: "B-2", folha: "20", termo: "5678",
    },
  })
  const matrizNova = await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: TIPO_PROCESSO, phaseKey: FASE, documentTypeCode: tipoNovo.code as string,
      target: "direct_line_person", generationRule: "all_direct_line",
      createsTask: false, createsCost: true, createsRevenue: false, status: 'PUBLICADA',
    },
  })
  const econNova = await prisma.phaseEconomicRule.create({
    data: {
      tipoProcessoId: TIPO_PROCESSO, phaseKey: FASE, documentTypeCode: tipoNovo.code as string,
      tipoDocumentoId: tipoNovo.id, componentKey: `EMISSAO_NOVO_${TS}`.slice(0, 40), componentName: "Emissão de Certidão",
      custoConfigId: criado.configIds[0], participaPlanilha: true, ordem: 9, ativo: true,
    },
  })
  const stepNovo = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: criado.wfInstanceId as number, stepKey: "localizar_registro",
      processoId: pid, faseMacroKey: FASE, documentoId: docSemEnum.id, ciclo: 1,
      status: "CONCLUIDO", completedAt: new Date(), chaveIdempotencia: `step-novo-${TAG}`,
    },
  })
  const rNovo = await projetarCustosDocumentaisDoPasso(stepNovo.id)
  chk(rNovo.projetou, "documento de tipo NOVO (sem enum legado) projeta")
  const custoNovo = await prisma.obrigacaoEconomica.findFirst({
    where: { processoId: pid, natureza: "CUSTO", documentoId: docSemEnum.id },
  })
  chk(custoNovo != null, "documento resolvido pelo VÍNCULO canônico gera custo (era o defeito silencioso)")

  // ── 12. REGRESSÃO: código sem tipo cadastrado é relatado, não ignorado ────
  const matrizOrfa = await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: TIPO_PROCESSO, phaseKey: FASE, documentTypeCode: `INEXISTENTE_${TS}`.slice(0, 40),
      target: "direct_line_person", generationRule: "all_direct_line",
      createsTask: false, createsCost: true, createsRevenue: false, status: 'PUBLICADA',
    },
  })
  const recOrfa = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: false })
  chk(recOrfa.achados.some((a) => a.tipo === "REGRA_SEM_TIPO_DOCUMENTAL"),
    "regra apontando para tipo inexistente vira achado nomeado")

  // ── 13. REGRESSÃO: "reparável" só quando o --execute realmente cria ───────
  // Sem preço vigente, o motor registra pendência e NÃO lança. O relatório tem
  // de dizer SEM_PRECO_VIGENTE, nunca prometer um reparo que não acontece.
  // Para isso é preciso um lançamento AUSENTE: com tudo lançado, não há o que
  // prometer, e o teste não provaria nada.
  const paraApagar = await prisma.obrigacaoEconomica.findFirst({
    where: { processoId: pid, natureza: "CUSTO", documentoId: criado.documentoId as number },
  })
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: paraApagar!.id } })
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: paraApagar!.id } })
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: paraApagar!.id } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: paraApagar!.id } })
  await prisma.obrigacaoEconomica.delete({ where: { id: paraApagar!.id } })
  await prisma.motorArtefato.deleteMany({ where: { automaticKey: paraApagar!.chaveIdempotencia as string } })

  // com preço vigente: promete o reparo
  const recComPreco = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: false })
  chk(recComPreco.achados.some((a) => a.tipo === "CUSTO_AUSENTE" && a.reparavel),
    "lançamento ausente com preço vigente é prometido como reparável")

  // sem preço vigente: NÃO promete, e diz por quê
  await prisma.tabelaValor.updateMany({ where: { id: { in: criado.tabelaIds } }, data: { vigenciaFim: "2020-12-31" } })
  const recSemPreco = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: false })
  chk(recSemPreco.achados.some((a) => a.tipo === "SEM_PRECO_VIGENTE"), "preço fora da vigência vira SEM_PRECO_VIGENTE")
  chk(recSemPreco.achados.filter((a) => a.reparavel).length === 0,
    `nada é prometido como reparável sem preço vigente (${recSemPreco.achados.filter((a) => a.reparavel).length})`)
  const antesExec = await prisma.obrigacaoEconomica.count({ where: { processoId: pid, natureza: "CUSTO" } })
  const recExec = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: true })
  const depoisExec = await prisma.obrigacaoEconomica.count({ where: { processoId: pid, natureza: "CUSTO" } })
  chk(recExec.reparados === 0 && antesExec === depoisExec,
    "relatório e --execute concordam: prometeu zero, criou zero")

  // preço de volta: o que foi prometido é entregue
  await prisma.tabelaValor.updateMany({ where: { id: { in: criado.tabelaIds } }, data: { vigenciaFim: null } })
  const recVolta = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: true })
  chk(recVolta.reparados >= 1, `com preço de volta, o --execute entrega o prometido (${recVolta.reparados})`)

  // limpeza do cenário extra
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { id: stepNovo.id } })
  criado.matrizIds.push(matrizNova.id, matrizOrfa.id)
  criado.econIds.push(econNova.id)
  criado.tipoDocExtraIds.push(tipoNovo.id)
  criado.documentoExtraIds.push(docSemEnum.id)

  // ── 14. GUARD: regra despublicada deixa de gerar, e diz por quê ──────────
  await prisma.matrizDocumental.updateMany({ where: { id: { in: criado.matrizIds } }, data: { status: "RASCUNHO" } })
  const recRascunho = await reconciliarDocumentalFinanceiro({ processoId: pid, executar: true })
  chk(recRascunho.reparados === 0, "regra em rascunho não gera lançamento nem no --execute")
  chk(recRascunho.achados.some((a) => a.detalhe.includes("não publicada")),
    "e o relatório nomeia: regra documental ainda não publicada")
  await prisma.matrizDocumental.updateMany({ where: { id: { in: criado.matrizIds } }, data: { status: "PUBLICADA" } })

  console.log(`\n${ok} passaram, ${fail} falharam`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await limpar().catch((e) => console.error("limpeza:", e))
    await prisma.$disconnect()
    process.exit(fail ? 1 : 0)
  })
