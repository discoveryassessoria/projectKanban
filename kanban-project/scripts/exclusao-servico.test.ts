// scripts/exclusao-servico.test.ts
//
// EXCLUSÃO DEFINITIVA DE SERVIÇOS — teste do bug real (§14), matriz de regressão (§15)
// e teste de tortura (§17). Precisa de banco.
//
// Todo dado criado aqui nasce marcado com TEST_DELETE_SERVICE e é conferido no fim:
// se sobrar qualquer resíduo, o teste reprova.

import { prisma } from "@/lib/prisma"
import {
  analyzeServiceDeletion,
  deleteService,
  deactivateService,
} from "@/src/services/exclusao-definitiva"

const MARCA = "TEST_DELETE_SERVICE"
// LogAuditoria.usuarioId tem FK para Usuario — o ator do teste é um usuário REAL do banco.
let USUARIO_TESTE = 0

let passed = 0
let failed = 0
function ok(nome: string, cond: boolean, detalhe = "") {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; console.log(`  ❌ ${nome}${detalhe ? `\n     ${detalhe}` : ""}`) }
}

// ─────────────────────────────────────────────────────────────────────────────
// FÁBRICA — um serviço técnico com as dependências pedidas.
// ─────────────────────────────────────────────────────────────────────────────
interface Semente {
  configFinanceira?: boolean
  aplicabilidade?: boolean
  automacao?: boolean
  preco?: boolean
  vinculoExclusivo?: boolean // aplicação territorial (nasce e morre com o serviço)
  vinculoCompartilhado?: boolean // Tipo de Documento apontando para o mesmo item mestre
}

interface Criado {
  servicoId: number
  itemCatalogoId: number
  configId: number | null
  econIds: number[]
  autoIds: number[]
  precoIds: number[]
  tipoDocumentoId: number | null
  paisIds: number[]
}

let seq = 0
async function criarServico(sufixo: string, s: Semente = {}): Promise<Criado> {
  seq += 1
  const code = `${MARCA}_${sufixo}_${seq}`
  const item = await prisma.itemCatalogo.create({
    data: { code, name: `${MARCA} ${sufixo} ${seq}`, natureza: "SERVICO", descricao: MARCA },
  })
  const servico = await prisma.servicoProduto.create({
    data: { code, name: `${MARCA} ${sufixo} ${seq}`, descricao: MARCA, itemCatalogoId: item.id, aplicacaoGlobal: !s.vinculoExclusivo },
  })

  let configId: number | null = null
  if (s.configFinanceira || s.aplicabilidade || s.automacao || s.preco) {
    const cfg = await prisma.produtoFinanceiro.create({
      data: { codigo: code.slice(0, 30), nome: `${MARCA} cfg ${seq}`, itemCatalogoId: item.id, possuiReceita: true },
    })
    configId = cfg.id
    await prisma.servicoProduto.update({ where: { id: servico.id }, data: { itensFinanceiros: { connect: { id: cfg.id } } } })
  }

  const econIds: number[] = []
  if (s.aplicabilidade && configId != null) {
    const r = await prisma.phaseEconomicRule.create({
      data: { phaseKey: "genealogia", componentKey: code.slice(0, 40), componentName: `${MARCA} ${seq}`, custoConfigId: configId, receitaConfigId: configId },
    })
    econIds.push(r.id)
  }

  const autoIds: number[] = []
  if (s.automacao && configId != null) {
    const tp = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
    if (tp) {
      const a = await prisma.phaseAutomationRule.create({
        data: { tipoProcessoId: tp.id, phaseKey: "genealogia", name: `${MARCA} auto ${seq}`, kind: "financial", trigger: "phase.entered", action: "create_cost", configItemId: configId },
      })
      autoIds.push(a.id)
    }
  }

  const precoIds: number[] = []
  if (s.preco && configId != null) {
    const p = await prisma.tabelaValor.create({
      data: { name: `${MARCA} preco ${seq}`, valor: 100, itemCatalogoId: item.id, configuracaoFinanceiraItemId: configId, natureza: "VENDA" },
    })
    precoIds.push(p.id)
  }

  const paisIds: number[] = []
  if (s.vinculoExclusivo) {
    const pais = await prisma.catalogoPais.findFirst({ select: { id: true } })
    if (pais) {
      const v = await prisma.servicoProdutoPais.create({ data: { servicoId: servico.id, paisId: pais.id } })
      paisIds.push(v.id)
    }
  }

  let tipoDocumentoId: number | null = null
  if (s.vinculoCompartilhado) {
    const td = await prisma.tipoDocumentoCadastro.create({
      data: { code: `${code}_TD`.slice(0, 40), name: `${MARCA} tipoDoc ${seq}`, itemCatalogoId: item.id },
    })
    tipoDocumentoId = td.id
  }

  return { servicoId: servico.id, itemCatalogoId: item.id, configId, econIds, autoIds, precoIds, tipoDocumentoId, paisIds }
}

/** Conta o que ficou de pé de um cadastro criado pela fábrica. */
async function residuo(c: Criado) {
  const [servico, item, config, econ, auto, preco, paises, cond] = await Promise.all([
    prisma.servicoProduto.count({ where: { id: c.servicoId } }),
    prisma.itemCatalogo.count({ where: { id: c.itemCatalogoId } }),
    c.configId != null ? prisma.produtoFinanceiro.count({ where: { id: c.configId } }) : Promise.resolve(0),
    c.econIds.length ? prisma.phaseEconomicRule.count({ where: { id: { in: c.econIds } } }) : Promise.resolve(0),
    c.autoIds.length ? prisma.phaseAutomationRule.count({ where: { id: { in: c.autoIds } } }) : Promise.resolve(0),
    c.precoIds.length ? prisma.tabelaValor.count({ where: { id: { in: c.precoIds } } }) : Promise.resolve(0),
    c.paisIds.length ? prisma.servicoProdutoPais.count({ where: { id: { in: c.paisIds } } }) : Promise.resolve(0),
    prisma.condicaoPagamentoServico.count({ where: { servicoId: c.servicoId } }),
  ])
  return { servico, item, config, econ, auto, preco, paises, cond, total: servico + item + config + econ + auto + preco + paises + cond }
}

async function limpar(c: Criado) {
  await prisma.obrigacaoEconomica.deleteMany({ where: { itemCatalogoId: c.itemCatalogoId, observacoes: MARCA } }).catch(() => {})
  await prisma.condicaoPagamentoServico.deleteMany({ where: { servicoId: c.servicoId } }).catch(() => {})
  await prisma.servicoProdutoPais.deleteMany({ where: { servicoId: c.servicoId } }).catch(() => {})
  if (c.econIds.length) await prisma.phaseEconomicRule.deleteMany({ where: { id: { in: c.econIds } } }).catch(() => {})
  if (c.autoIds.length) await prisma.phaseAutomationRule.deleteMany({ where: { id: { in: c.autoIds } } }).catch(() => {})
  await prisma.tabelaValor.deleteMany({ where: { itemCatalogoId: c.itemCatalogoId } }).catch(() => {})
  if (c.tipoDocumentoId != null) await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: c.tipoDocumentoId } }).catch(() => {})
  if (c.configId != null) await prisma.produtoFinanceiro.deleteMany({ where: { id: c.configId } }).catch(() => {})
  await prisma.servicoProduto.deleteMany({ where: { id: c.servicoId } }).catch(() => {})
  await prisma.itemCatalogo.deleteMany({ where: { id: c.itemCatalogoId } }).catch(() => {})
}

const criados: Criado[] = []
async function novo(sufixo: string, s: Semente = {}) {
  const c = await criarServico(sufixo, s)
  criados.push(c)
  return c
}

/**
 * Cria um FATO HISTÓRICO amarrado ao serviço. Usa ObrigacaoEconomica (motor V3): é o fato
 * financeiro que não exige Processo real — o teste nunca encosta em dado de produção.
 */
async function darFatoHistorico(c: Criado): Promise<number> {
  const o = await prisma.obrigacaoEconomica.create({
    data: {
      natureza: "RECEITA", direcao: "A_RECEBER", valorContratado: 100,
      observacoes: MARCA,
      itemCatalogoId: c.itemCatalogoId,
      ...(c.configId != null ? { configFinanceiraId: c.configId } : {}),
    },
  })
  return o.id
}

async function main() {
  console.log("\n🧪 EXCLUSÃO DEFINITIVA DE SERVIÇOS\n")

  const ator = await prisma.usuario.findFirst({ select: { id: true }, orderBy: { id: "asc" } })
  if (!ator) { console.log("❌ nenhum usuário no banco — a auditoria não teria ator real"); process.exit(1) }
  USUARIO_TESTE = ator.id

  // ── §14 — o bug real: Localização de Registro ──────────────────────────────
  console.log("§14) Caso real — serviço com 1 Regra de Aplicabilidade Econômica e zero histórico")
  {
    const c = await novo("LOCALIZACAO", { configFinanceira: true, aplicabilidade: true })
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("a análise enxerga a Regra de Aplicabilidade como CONFIGURAÇÃO", !!a?.configDependencies.itens.some((d) => d.entidade === "RegraAplicabilidadeEconomica"))
    ok("a Regra de Aplicabilidade NÃO aparece entre os fatos históricos", !a?.historicalFacts.itens.some((f) => (f.entidade as string) === "RegraAplicabilidadeEconomica"))
    ok("a Configuração Financeira NÃO aparece entre os fatos históricos", !a?.historicalFacts.itens.some((f) => (f.entidade as string) === "ConfiguracaoFinanceira"))
    ok("historicalFacts.total === 0", a?.historicalFacts.total === 0, JSON.stringify(a?.historicalFacts))
    ok("deletionAllowed === true", a?.deletionAllowed === true)
    ok("deactivationRequired === false", a?.deactivationRequired === false)

    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE, motivo: MARCA })
    const r = await residuo(c)
    ok("Serviço removido", r.servico === 0)
    ok("Regra de Aplicabilidade Econômica removida", r.econ === 0)
    ok("Configuração Financeira removida", r.config === 0)
    ok("Item mestre órfão removido", r.item === 0)
    ok("órfãos = 0", r.total === 0, JSON.stringify(r))
  }

  // ── §15 — matriz de regressão ─────────────────────────────────────────────
  console.log("\n§15) Matriz de regressão")

  // 1. sem dependências → exclui
  {
    const c = await novo("SEMDEP")
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("1. serviço sem dependências → deletionAllowed", a?.deletionAllowed === true)
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    ok("1. zero órfãos", (await residuo(c)).total === 0)
  }

  // 2. + aplicabilidade → exclui  (coberto em §14; repetido isolado)
  {
    const c = await novo("APLIC", { configFinanceira: true, aplicabilidade: true })
    ok("2. serviço + aplicabilidade → deletionAllowed", (await analyzeServiceDeletion(c.servicoId))?.deletionAllowed === true)
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    ok("2. zero órfãos", (await residuo(c)).total === 0)
  }

  // 3. + configuração financeira → exclui
  {
    const c = await novo("CFG", { configFinanceira: true })
    ok("3. serviço + configuração financeira → deletionAllowed", (await analyzeServiceDeletion(c.servicoId))?.deletionAllowed === true)
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    ok("3. zero órfãos", (await residuo(c)).total === 0)
  }

  // 4. + regra de precificação → exclui
  {
    const c = await novo("PRECO", { configFinanceira: true, preco: true })
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("4. serviço + regra de preço → deletionAllowed", a?.deletionAllowed === true)
    ok("4. o preço é declarado como configuração a excluir", !!a?.configDependencies.itens.some((d) => d.entidade === "RegraDePreco" && d.acao === "EXCLUIR"))
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    ok("4. zero órfãos", (await residuo(c)).total === 0)
  }

  // 4b. + automação de fase → exclui
  {
    const c = await novo("AUTO", { configFinanceira: true, automacao: true })
    ok("4b. serviço + automação de fase → deletionAllowed", (await analyzeServiceDeletion(c.servicoId))?.deletionAllowed === true)
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    ok("4b. zero órfãos", (await residuo(c)).total === 0)
  }

  // 5. + vínculo EXCLUSIVO → exclui junto
  {
    const c = await novo("VEXCL", { configFinanceira: true, vinculoExclusivo: true })
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("5. vínculo exclusivo é marcado como EXCLUIR", !!a?.configDependencies.itens.some((d) => d.entidade === "AplicacaoTerritorial" && d.acao === "EXCLUIR"))
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    const r = await residuo(c)
    ok("5. vínculo territorial removido", r.paises === 0)
    ok("5. zero órfãos", r.total === 0)
  }

  // 6. + vínculo COMPARTILHADO → desvincula, preserva o mestre
  {
    const c = await novo("VCOMP", { configFinanceira: true, vinculoCompartilhado: true })
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("6. mestre compartilhado marcado como DESVINCULAR", !!a?.configDependencies.itens.some((d) => d.entidade === "VinculoTipoDocumento" && d.acao === "DESVINCULAR"))
    ok("6. item mestre compartilhado NÃO é marcado para exclusão", !!a?.configDependencies.itens.some((d) => d.entidade === "ItemCatalogoMestre" && d.acao === "DESVINCULAR"))
    ok("6. deletionAllowed mesmo com vínculo compartilhado", a?.deletionAllowed === true)
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    const [svc, tipoDoc, item] = await Promise.all([
      prisma.servicoProduto.count({ where: { id: c.servicoId } }),
      prisma.tipoDocumentoCadastro.count({ where: { id: c.tipoDocumentoId! } }),
      prisma.itemCatalogo.count({ where: { id: c.itemCatalogoId } }),
    ])
    ok("6. serviço removido", svc === 0)
    ok("6. Tipo de Documento PRESERVADO (só desvinculado)", tipoDoc === 1)
    ok("6. Item mestre compartilhado PRESERVADO", item === 1)
  }

  // 6b. mestre COMPARTILHADO com parametrização — a parametrização é de terceiros e fica intacta
  {
    const c = await novo("VCOMP2", { configFinanceira: true, aplicabilidade: true, preco: true, vinculoCompartilhado: true })
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("6b. com mestre compartilhado, a Config Financeira é DESVINCULAR (não EXCLUIR)",
      !!a?.configDependencies.itens.some((d) => d.entidade === "ConfiguracaoFinanceira" && d.acao === "DESVINCULAR"))
    ok("6b. preço do mestre compartilhado não é declarado para exclusão",
      !a?.configDependencies.itens.some((d) => d.entidade === "RegraDePreco"))
    ok("6b. regra econômica do mestre compartilhado não é declarada para exclusão",
      !a?.configDependencies.itens.some((d) => d.entidade === "RegraAplicabilidadeEconomica"))
    await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE })
    const [svc, cfg, preco, econ, item] = await Promise.all([
      prisma.servicoProduto.count({ where: { id: c.servicoId } }),
      prisma.produtoFinanceiro.count({ where: { id: c.configId! } }),
      prisma.tabelaValor.count({ where: { id: { in: c.precoIds } } }),
      prisma.phaseEconomicRule.count({ where: { id: { in: c.econIds } } }),
      prisma.itemCatalogo.count({ where: { id: c.itemCatalogoId } }),
    ])
    ok("6b. serviço removido", svc === 0)
    ok("6b. Configuração Financeira do mestre PRESERVADA", cfg === 1)
    ok("6b. preço do mestre PRESERVADO", preco === 1)
    ok("6b. regra econômica do mestre PRESERVADA", econ === 1)
    ok("6b. item mestre PRESERVADO", item === 1)
  }

  // 7-10. fato histórico → bloqueia
  {
    const c = await novo("HIST", { configFinanceira: true, aplicabilidade: true })
    await darFatoHistorico(c)
    const a = await analyzeServiceDeletion(c.servicoId)
    ok("7-10. fato histórico detectado", (a?.historicalFacts.total ?? 0) > 0)
    ok("7-10. deletionAllowed === false", a?.deletionAllowed === false)
    ok("7-10. deactivationRequired === true", a?.deactivationRequired === true)
    let bloqueou = false
    try { await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE }) } catch { bloqueou = true }
    ok("7-10. deleteService recusa executar", bloqueou)
    const r = await residuo(c)
    ok("7-10. nada foi apagado (histórico intacto)", r.servico === 1 && r.econ === 1 && r.config === 1)

    // 12. inativação preserva o histórico
    await deactivateService(c.servicoId, { usuarioId: USUARIO_TESTE, motivo: MARCA })
    const svc = await prisma.servicoProduto.findUnique({ where: { id: c.servicoId }, select: { ativo: true } })
    const fatos = await prisma.obrigacaoEconomica.count({ where: { configFinanceiraId: c.configId!, observacoes: MARCA } })
    ok("12. serviço inativado (não apagado)", svc?.ativo === false)
    ok("12. fato histórico preservado", fatos === 1)
  }

  // 11. uso operacional real (necessidade documental em processo) → bloqueia
  {
    const c = await novo("NECES", { configFinanceira: true })
    // NecessidadeDocumental exige sujeito (pessoaId XOR uniaoId) — CHECK no banco.
    const proc = await prisma.processo.findFirst({ select: { id: true } })
    const pessoa = await prisma.pessoa.findFirst({ select: { id: true } })
    if (!proc || !pessoa) {
      console.log("  ⏭️  11. sem processo/pessoa no banco — cenário de uso operacional não exercitado")
    } else {
      const nec = await prisma.necessidadeDocumental.create({
        data: { processoId: proc.id, pessoaId: pessoa.id, itemCatalogoId: c.itemCatalogoId, chaveIdempotencia: `${MARCA}-${c.servicoId}-${Date.now()}` },
      })
      const a = await analyzeServiceDeletion(c.servicoId)
      ok("11. uso operacional real bloqueia", a?.deletionAllowed === false && a.historicalFacts.itens.some((f) => f.entidade === "NecessidadeDocumental"))
      await prisma.necessidadeDocumental.delete({ where: { id: nec.id } })
    }
  }

  // 14. concorrência revalida — fato criado DEPOIS da prévia aborta a execução
  {
    const c = await novo("RACE", { configFinanceira: true, aplicabilidade: true })
    const previa = await analyzeServiceDeletion(c.servicoId)
    ok("14. prévia autoriza", previa?.deletionAllowed === true)
    await darFatoHistorico(c) // alguém lançou uma receita entre a prévia e o clique
    let abortou = false
    try { await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE }) } catch { abortou = true }
    ok("14. execução revalida e aborta", abortou)
    const r = await residuo(c)
    ok("13. rollback total — nada foi excluído parcialmente", r.servico === 1 && r.config === 1 && r.econ === 1, JSON.stringify(r))
  }

  // 18. auditoria existe
  {
    const c = await novo("AUDIT", { configFinanceira: true, aplicabilidade: true })
    const r = await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE, motivo: `${MARCA} auditoria` })
    const log = await prisma.logAuditoria.findFirst({
      where: { acao: "EXCLUSAO_DEFINITIVA", entidade: "SERVICO", entidadeId: c.servicoId },
      orderBy: { id: "desc" },
    })
    const d = (log?.detalhes ?? {}) as Record<string, unknown>
    ok("18. log de auditoria gravado", !!log)
    ok("18. auditoria tem correlationId", d.correlationId === r.correlationId)
    ok("18. auditoria registra o que caiu em cascata", Array.isArray(d.configDependenciesRemoved) && (d.configDependenciesRemoved as unknown[]).length > 0)
    ok("18. auditoria registra deletionMode", d.deletionMode === "HARD_DELETE")
    ok("18. auditoria registra zero fatos históricos", Array.isArray(d.historicalFactsFound) && (d.historicalFactsFound as unknown[]).length === 0)
    ok("18. zero órfãos", (await residuo(c)).total === 0)
  }

  // ── §17 — teste de tortura: 10 rodadas criar → configurar → excluir ────────
  console.log("\n§17) Teste de tortura — 10 rodadas")
  {
    const antes = await contarMarca()
    let residuoAcumulado = 0
    for (let i = 1; i <= 10; i++) {
      const c = await criarServico("TORTURA", { configFinanceira: true, aplicabilidade: true, automacao: true, preco: true, vinculoExclusivo: true })
      const a = await analyzeServiceDeletion(c.servicoId)
      if (a?.deletionAllowed !== true) { failed++; console.log(`  ❌ rodada ${i}: prévia não autorizou`); break }
      await deleteService(c.servicoId, { usuarioId: USUARIO_TESTE, motivo: `${MARCA} tortura ${i}` })
      const r = await residuo(c)
      residuoAcumulado += r.total
      if (r.total !== 0) console.log(`  ❌ rodada ${i}: resíduo ${JSON.stringify(r)}`)
    }
    ok("17. 10 rodadas sem resíduo por rodada", residuoAcumulado === 0)
    // Mede só o que ESTE teste cria (prefixo TEST_DELETE_SERVICE). Contar o banco inteiro
    // mediria também quem mais estiver escrevendo — a asserção precisa ser do escopo do teste.
    const depois = await contarMarca()
    ok(
      "17. nenhum registro marcado sobreviveu às 10 rodadas",
      JSON.stringify(antes) === JSON.stringify(depois),
      `antes=${JSON.stringify(antes)} depois=${JSON.stringify(depois)}`,
    )
  }

  // ── §15.15 — varredura global de órfãos ───────────────────────────────────
  console.log("\n§15.15) Órfãos no banco")
  {
    const orfaos = await varrerOrfaos()
    ok("15. zero órfãos estruturais no banco", orfaos.total === 0, JSON.stringify(orfaos))
  }

  // Limpeza final: varre TUDO que carrega a marca, na ordem de dependência. O teste não pode
  // deixar rastro no banco nem quando um cenário falha no meio.
  await purgarMarca()
  const sobra = await contarMarca()
  ok("15. o teste não deixou resíduo no banco", Object.values(sobra).every((n) => n === 0), JSON.stringify(sobra))

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passaram, ${failed} falharam\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

/** Conta APENAS o que este teste cria. Escopo próprio — imune a quem mais escreve no banco. */
async function contarMarca() {
  const [servicos, itens, configs, precos, econ, auto] = await Promise.all([
    prisma.servicoProduto.count({ where: { code: { startsWith: MARCA } } }),
    prisma.itemCatalogo.count({ where: { code: { startsWith: MARCA } } }),
    prisma.produtoFinanceiro.count({ where: { codigo: { startsWith: MARCA } } }),
    prisma.tabelaValor.count({ where: { name: { startsWith: MARCA } } }),
    prisma.phaseEconomicRule.count({ where: { componentKey: { startsWith: MARCA } } }),
    prisma.phaseAutomationRule.count({ where: { name: { startsWith: MARCA } } }),
  ])
  return { servicos, itens, configs, precos, econ, auto }
}

/** Órfãos ESTRUTURAIS: ponteiro apontando para linha que não existe mais. */
async function varrerOrfaos() {
  const [precoSemConfig] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "TabelaValor" t
     WHERE t."configuracaoFinanceiraItemId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = t."configuracaoFinanceiraItemId")`,
  )
  const [precoSemItem] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "TabelaValor" t
     WHERE t."itemCatalogoId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "ItemCatalogo" i WHERE i.id = t."itemCatalogoId")`,
  )
  const [econOrfa] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "PhaseEconomicRule" r
     WHERE (r."custoConfigId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = r."custoConfigId"))
        OR (r."receitaConfigId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = r."receitaConfigId"))`,
  )
  const [autoOrfa] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "PhaseAutomationRule" a
     WHERE a."configItemId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = a."configItemId")`,
  )
  const [condProjecao] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "CondicaoPagamento" c, unnest(c."servicos") s
     WHERE NOT EXISTS (SELECT 1 FROM "ServicoProduto" v WHERE v.id = s)`,
  )
  const [configSemItem] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "ProdutoFinanceiro" p
     WHERE p."itemCatalogoId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "ItemCatalogo" i WHERE i.id = p."itemCatalogoId")`,
  )
  const r = {
    precoSemConfig: Number(precoSemConfig.n),
    precoSemItem: Number(precoSemItem.n),
    econOrfa: Number(econOrfa.n),
    autoOrfa: Number(autoOrfa.n),
    condProjecaoOrfa: Number(condProjecao.n),
    configSemItem: Number(configSemItem.n),
  }
  return { ...r, total: Object.values(r).reduce((a, b) => a + b, 0) }
}

/** Remove, na ordem de dependência, todo registro criado por este teste. Idempotente. */
async function purgarMarca() {
  const itemIds = (await prisma.itemCatalogo.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })).map((i) => i.id)
  const cfgIds = (await prisma.produtoFinanceiro.findMany({ where: { OR: [{ codigo: { startsWith: MARCA } }, { itemCatalogoId: { in: itemIds } }] }, select: { id: true } })).map((c) => c.id)
  const svcIds = (await prisma.servicoProduto.findMany({ where: { OR: [{ code: { startsWith: MARCA } }, { itemCatalogoId: { in: itemIds } }] }, select: { id: true } })).map((s) => s.id)

  await prisma.obrigacaoEconomica.deleteMany({ where: { OR: [{ observacoes: MARCA }, { configFinanceiraId: { in: cfgIds } }, { itemCatalogoId: { in: itemIds } }] } })
  await prisma.necessidadeDocumental.deleteMany({ where: { chaveIdempotencia: { startsWith: MARCA } } })
  await prisma.phaseEconomicRule.deleteMany({ where: { OR: [{ componentKey: { startsWith: MARCA } }, { custoConfigId: { in: cfgIds } }, { receitaConfigId: { in: cfgIds } }] } })
  await prisma.phaseAutomationRule.deleteMany({ where: { OR: [{ name: { startsWith: MARCA } }, { configItemId: { in: cfgIds } }] } })
  await prisma.tabelaValor.deleteMany({ where: { OR: [{ name: { startsWith: MARCA } }, { itemCatalogoId: { in: itemIds } }, { configuracaoFinanceiraItemId: { in: cfgIds } }] } })
  await prisma.servicoProdutoPais.deleteMany({ where: { servicoId: { in: svcIds } } })
  await prisma.condicaoPagamentoServico.deleteMany({ where: { servicoId: { in: svcIds } } })
  for (const id of svcIds) {
    const existe = await prisma.servicoProduto.findUnique({ where: { id }, select: { id: true } })
    if (existe) await prisma.servicoProduto.update({ where: { id }, data: { itensFinanceiros: { set: [] } } })
  }
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.servicoProduto.deleteMany({ where: { id: { in: svcIds } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { id: { in: cfgIds } } })
  await prisma.itemCatalogo.deleteMany({ where: { id: { in: itemIds } } })
}

main().catch(async (e) => {
  console.error(e)
  await purgarMarca().catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})
