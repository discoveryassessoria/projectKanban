// scripts/pre-cadastro-guards.test.ts
//
// GUARDS DA PARAMETRIZAÇÃO — provam que estrutura sem valor NÃO vira dinheiro.
//
// A estrutura pode ser pré-cadastrada; o que ela não pode é gerar lançamento
// enquanto o preço, a publicação ou a ativação não existirem. Cada asserção aqui
// corresponde a uma das travas pedidas: componente inativo não gera, regra em
// rascunho não executa, preço ausente ou zero não vale, placeholder não publica.
//
// ⚠ ESCREVE. Banco NÃO-produtivo. Limpa o que cria.

import { prisma } from "@/lib/prisma"
import { resolverElegibilidadeDocumental } from "@/src/lib/motor/elegibilidade-documental"
import { pendenciasDoComponente, podePublicarRegraDocumental, MARCA_PLACEHOLDER } from "@/src/services/financeiro/pendencias-parametrizacao"

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const TS = Date.now()
const TAG = `guard-${TS}`
const FASE = `fase_guard_${TS}`.slice(0, 60)

const criado: { tipoProcessoId?: number; itemId?: number; cfgId?: number; econId?: number; matrizId?: number; tabelaIds: number[]; macroId?: number; faseId?: number } = { tabelaIds: [] }

async function montar() {
  const tp = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `TPG-${TS}`.slice(0, 40), name: `Tipo ${TAG}`, pais: { connectOrCreate: { where: { countryKey: 'x' }, create: { countryKey: 'x', countryLabel: 'X', nationalityKey: 'x', nationalityLabel: 'X' } } },
      modalityKey: 'x', modalityLabel: 'X' },
  })
  criado.tipoProcessoId = tp.id
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tp.id, name: `Macro ${TAG}` } })
  criado.macroId = macro.id
  const fase = await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE, label: `Fase ${TAG}`, ordem: 1 } })
  criado.faseId = fase.id

  const item = await prisma.itemCatalogo.create({ data: { code: `SRVG_${TS}`, name: `Serviço ${TAG}`, natureza: 'SERVICO', unidade: 'DOCUMENTO', ativo: true } })
  criado.itemId = item.id
  const cfg = await prisma.produtoFinanceiro.create({ data: { codigo: `CFGG_${TS}`.slice(0, 30), nome: `Config ${TAG}`, itemCatalogoId: item.id, ativo: true } })
  criado.cfgId = cfg.id
  // componente INATIVO e SEM preço — exatamente como o pré-cadastro o cria
  const econ = await prisma.phaseEconomicRule.create({
    data: { phaseKey: FASE, componentKey: `COMP_${TS}`.slice(0, 40), componentName: `Componente ${TAG}`, custoConfigId: cfg.id, receitaConfigId: cfg.id, ativo: false, participaPlanilha: true },
  })
  criado.econId = econ.id
  // regra documental em RASCUNHO (status default), declarando que gera custo
  const m = await prisma.matrizDocumental.create({
    data: { tipoProcessoId: tp.id, phaseKey: FASE, documentTypeCode: 'X-GUARD', nome: `Regra ${TAG}`, createsTask: false, createsCost: true, createsRevenue: false },
  })
  criado.matrizId = m.id
}

async function limpar() {
  if (criado.tabelaIds.length) await prisma.tabelaValor.deleteMany({ where: { id: { in: criado.tabelaIds } } })
  if (criado.matrizId) await prisma.matrizDocumental.deleteMany({ where: { id: criado.matrizId } })
  if (criado.econId) await prisma.phaseEconomicRule.deleteMany({ where: { id: criado.econId } })
  if (criado.cfgId) await prisma.produtoFinanceiro.deleteMany({ where: { id: criado.cfgId } })
  if (criado.itemId) await prisma.itemCatalogo.deleteMany({ where: { id: criado.itemId } })
  if (criado.faseId) await prisma.faseMacro.deleteMany({ where: { id: criado.faseId } })
  if (criado.macroId) await prisma.macroWorkflow.deleteMany({ where: { id: criado.macroId } })
  if (criado.tipoProcessoId) await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: criado.tipoProcessoId } })
}

async function main() {
  await montar()
  const tp = criado.tipoProcessoId as number

  // ── 1. regra em RASCUNHO não executa ─────────────────────────────────────
  const e1 = await resolverElegibilidadeDocumental(tp, tp, FASE, 1)
  chk(e1.itens.length === 0, "regra em rascunho NÃO gera item elegível")
  chk(e1.pulados.some((p) => p.motivo.includes("não publicada")), "e o motivo é nomeado: 'regra documental ainda não publicada'")

  // ── 2. publicação é RECUSADA sem preço ───────────────────────────────────
  const pub1 = await podePublicarRegraDocumental(criado.matrizId as number)
  chk(!pub1.pode, "publicação recusada enquanto a parametrização econômica está incompleta")
  chk(pub1.impedimentos.some((i) => i.mensagem.includes("componente econômico ativo")),
    `impedimento explica o que falta (${pub1.impedimentos[0]?.mensagem ?? "—"})`)

  // ── 3. pendências do componente são objetivas ────────────────────────────
  const p1 = await pendenciasDoComponente(criado.econId as number)
  chk(p1.some((x) => x.tipo === "COMPONENTE_INATIVO"), "pendência: componente inativo")
  chk(p1.some((x) => x.tipo === "SEM_PRECO_DE_CUSTO" && x.mensagem.startsWith("Falta o custo de")),
    `pendência com frase de operador ("${p1.find((x) => x.tipo === "SEM_PRECO_DE_CUSTO")?.mensagem ?? "—"}")`)
  chk(p1.some((x) => x.tipo === "SEM_FORNECEDOR"), "pendência: fornecedor não definido")
  chk(p1.every((x) => x.onde.startsWith("Gerenciamento")), "toda pendência diz ONDE preencher")

  // ── 4. VALOR ZERO não é preço ────────────────────────────────────────────
  const zero = await prisma.tabelaValor.create({
    data: { name: `zero ${TAG}`, moeda: 'BRL', valor: 0, modoCalculo: 'fixed', natureza: 'CUSTO', configuracaoFinanceiraItemId: criado.cfgId as number, vigenciaInicio: '2020-01-01' },
  })
  criado.tabelaIds.push(zero.id)
  const p2 = await pendenciasDoComponente(criado.econId as number)
  chk(p2.some((x) => x.tipo === "SEM_PRECO_DE_CUSTO"), "linha de preço com valor 0 NÃO conta como preço")

  // ── 5. PLACEHOLDER não publica ───────────────────────────────────────────
  const ph = await prisma.tabelaValor.create({
    data: { name: `${MARCA_PLACEHOLDER} custo ${TAG}`, moeda: 'BRL', valor: 100, modoCalculo: 'fixed', natureza: 'CUSTO', configuracaoFinanceiraItemId: criado.cfgId as number, vigenciaInicio: '2020-01-01' },
  })
  criado.tabelaIds.push(ph.id)
  const p3 = await pendenciasDoComponente(criado.econId as number)
  chk(p3.some((x) => x.tipo === "PRECO_PLACEHOLDER" && x.bloqueia), `preço marcado ${MARCA_PLACEHOLDER} bloqueia`)

  // ── 6. com preço REAL + componente ativo + regra publicada, tudo destrava ─
  await prisma.tabelaValor.update({ where: { id: ph.id }, data: { name: `custo real ${TAG}` } })
  await prisma.tabelaValor.delete({ where: { id: zero.id } })
  criado.tabelaIds = criado.tabelaIds.filter((i) => i !== zero.id)
  await prisma.phaseEconomicRule.update({ where: { id: criado.econId as number }, data: { ativo: true, receitaConfigId: null } })
  await prisma.produtoFinanceiro.update({ where: { id: criado.cfgId as number }, data: { repasse: true } })
  const p4 = await pendenciasDoComponente(criado.econId as number)
  chk(p4.filter((x) => x.bloqueia).length === 0, `sem impedimento após preço real (${p4.map((x) => x.tipo).join(", ") || "nenhuma pendência"})`)
  const pub2 = await podePublicarRegraDocumental(criado.matrizId as number)
  chk(pub2.pode, "publicação LIBERADA quando a parametrização está completa")

  // ── 7. e só então a regra publicada executa ──────────────────────────────
  await prisma.matrizDocumental.update({ where: { id: criado.matrizId as number }, data: { status: 'PUBLICADA' } })
  const e2 = await resolverElegibilidadeDocumental(tp, tp, FASE, 1)
  chk(!e2.pulados.some((p) => p.motivo.includes("não publicada")), "regra publicada deixa de ser barrada pelo status")

  console.log(`\n${ok} passaram, ${fail} falharam`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => { await limpar().catch((e) => console.error("limpeza:", e)); await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
