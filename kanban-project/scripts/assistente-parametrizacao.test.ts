// scripts/assistente-parametrizacao.test.ts
//
// ASSISTENTE DE PARAMETRIZAÇÃO — orquestra sem duplicar, publica sem quebrar.
//
// O que precisa ser provado não é que a tela renderiza: é que o assistente lê o
// estado das entidades canônicas (e não de uma cópia), que a simulação usa o
// motor real, que a publicação é tudo-ou-nada e que ele não consegue publicar
// configuração incompleta nem mais do que o guard de regra deixaria passar.
//
// ⚠ ESCREVE. Banco NÃO-produtivo. Limpa o que cria.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { estadoParametrizacao, ETAPAS } from "@/src/services/parametrizacao/estado-parametrizacao"
import { simularParametrizacao } from "@/src/services/parametrizacao/simulacao-parametrizacao"
import { publicarParametrizacao } from "@/src/services/parametrizacao/publicacao-coordenada"
import { concluirParametrizacao } from "@/src/services/parametrizacao/concluir-parametrizacao"

import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const RAIZ = join(__dirname, "..")
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")
const TS = Date.now()
const TAG = `wiz-${TS}`
const FASE = `fase_wiz_${TS}`.slice(0, 60)

const c: { tipoId?: number; macroId?: number; faseId?: number; itemId?: number; cfgId?: number; econId?: number; matrizId?: number; precoId?: number; progressoId?: number } = {}

async function montar() {
  const oferta = await garantirOferta(prisma, { countryKey: 'x', countryLabel: 'País X', nationalityKey: 'x', nationalityLabel: 'X', modalityKey: 'x', modalityLabel: 'X' })
  const tp = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `TPW-${TS}`.slice(0, 40), name: `Tipo ${TAG}`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
      },
  })
  c.tipoId = tp.id
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tp.id, name: `Macro ${TAG}` } })
  c.macroId = macro.id
  const f = await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE, label: `Fase ${TAG}`, ordem: 1, required: true } })
  c.faseId = f.id
  const item = await prisma.itemCatalogo.create({ data: { code: `SRVW_${TS}`, name: `Serviço ${TAG}`, natureza: 'SERVICO', unidade: 'DOCUMENTO', ativo: true } })
  c.itemId = item.id
  const cfg = await prisma.produtoFinanceiro.create({ data: { codigo: `CFGW_${TS}`.slice(0, 30), nome: `Config ${TAG}`, itemCatalogoId: item.id, ativo: true } })
  c.cfgId = cfg.id
  const econ = await prisma.phaseEconomicRule.create({
    data: { phaseKey: FASE, componentKey: `CW_${TS}`.slice(0, 40), componentName: `Componente ${TAG}`, custoConfigId: cfg.id, ativo: false, participaPlanilha: true },
  })
  c.econId = econ.id
  const m = await prisma.matrizDocumental.create({
    data: { tipoProcessoId: tp.id, phaseKey: FASE, documentTypeCode: 'X-WIZ', nome: `Regra ${TAG}`, createsTask: false, createsCost: true, createsRevenue: false },
  })
  c.matrizId = m.id
}

async function limpar() {
  if (c.progressoId) await prisma.assistenteParametrizacaoProgresso.deleteMany({ where: { id: c.progressoId } })
  if (c.tipoId) await prisma.assistenteParametrizacaoProgresso.deleteMany({ where: { tipoProcessoId: c.tipoId } })
  if (c.precoId) await prisma.tabelaValor.deleteMany({ where: { id: c.precoId } })
  if (c.matrizId) await prisma.matrizDocumental.deleteMany({ where: { id: c.matrizId } })
  if (c.econId) await prisma.phaseEconomicRule.deleteMany({ where: { id: c.econId } })
  if (c.cfgId) await prisma.produtoFinanceiro.deleteMany({ where: { id: c.cfgId } })
  if (c.itemId) await prisma.itemCatalogo.deleteMany({ where: { id: c.itemId } })
  if (c.faseId) await prisma.faseMacro.deleteMany({ where: { id: c.faseId } })
  if (c.macroId) await prisma.macroWorkflow.deleteMany({ where: { id: c.macroId } })
  if (c.tipoId) await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: c.tipoId } })
}

async function main() {
  await montar()
  const tipoId = c.tipoId as number

  // ── 1. ESTADO derivado das entidades canônicas ──────────────────────────
  const e1 = await estadoParametrizacao({ tipoProcessoId: tipoId })
  chk(e1.etapas.length === ETAPAS.length, `as ${ETAPAS.length} etapas são apuradas (${e1.etapas.length})`)
  chk(e1.escopo.fases.length === 1 && e1.escopo.fases[0].phaseKey === FASE, "o escopo lê as fases do catálogo publicado")
  const matriz = e1.etapas.find((x) => x.etapa === "matriz")!
  chk(matriz.status === "EM_PREENCHIMENTO" && matriz.pendentes === 1, `Matriz reflete o rascunho real (${matriz.status})`)
  const aplic = e1.etapas.find((x) => x.etapa === "aplicabilidade")!
  chk(aplic.pendentes === 1, "Aplicabilidade Econômica acusa o componente inativo")
  chk(e1.etapas.find((x) => x.etapa === "publicacao")!.status === "BLOQUEADA", "Publicação nasce BLOQUEADA sem preço")
  chk(!e1.publicavel, "estado diz que ainda não é publicável")

  // ── 2. PUBLICAÇÃO é recusada, e nada é escrito ──────────────────────────
  const p1 = await publicarParametrizacao({ tipoProcessoId: tipoId })
  chk(!p1.publicou, "publicação recusada com parametrização incompleta")
  chk(p1.impedimentos.some((i) => i.mensagem.startsWith("Falta o custo")), `impedimento nomeia o que falta ("${p1.impedimentos[0]?.mensagem ?? "—"}")`)
  const aposFalha = await prisma.matrizDocumental.findUnique({ where: { id: c.matrizId as number }, select: { status: true } })
  const econAposFalha = await prisma.phaseEconomicRule.findUnique({ where: { id: c.econId as number }, select: { ativo: true } })
  chk(aposFalha?.status === "RASCUNHO" && econAposFalha?.ativo === false, "nada foi publicado parcialmente — rascunho preservado")

  // ── 3. PROGRESSO guarda lugar, nunca configuração ───────────────────────
  const prog = await prisma.assistenteParametrizacaoProgresso.create({
    data: { tipoProcessoId: tipoId, phaseKey: null, etapaAtual: "custos", etapasConcluidas: ["escopo", "matriz"] },
  })
  c.progressoId = prog.id
  const colunas = Object.keys(prog)
  const proibidas = ["valor", "preco", "documentTypeCode", "fornecedor", "configuracao", "regras"]
  chk(!colunas.some((k) => proibidas.some((x) => k.toLowerCase().includes(x))),
    `progresso não carrega configuração (colunas: ${colunas.join(", ")})`)
  const e2 = await estadoParametrizacao({ tipoProcessoId: tipoId })
  chk(e2.progresso?.etapaAtual === "custos", "o assistente reabre na etapa em que parou")

  // ── 4. SIMULAÇÃO usa o motor real e não escreve ─────────────────────────
  const obrsAntes = await prisma.obrigacaoEconomica.count()
  const artefatosAntes = await prisma.motorArtefato.count()
  const sim = await simularParametrizacao({ tipoProcessoId: tipoId })
  chk(sim.escreveu === false, "simulação declara que não escreve")
  chk(await prisma.obrigacaoEconomica.count() === obrsAntes, "nenhuma obrigação criada pela simulação")
  chk(await prisma.motorArtefato.count() === artefatosAntes, "nenhum artefato de motor criado pela simulação")
  chk(sim.motivos.length > 0, `simulação explica por que não produziu ("${sim.motivos[0]?.motivo ?? "—"}")`)

  // ── 5. com preço REAL, publica — e publica TUDO junto ───────────────────
  const preco = await prisma.tabelaValor.create({
    data: { name: `custo ${TAG}`, moeda: 'BRL', valor: 120, modoCalculo: 'fixed', natureza: 'CUSTO', configuracaoFinanceiraItemId: c.cfgId as number, vigenciaInicio: '2020-01-01' },
  })
  c.precoId = preco.id
  await prisma.produtoFinanceiro.update({ where: { id: c.cfgId as number }, data: { repasse: true, fornecedorPadraoId: null } })
  const e3 = await estadoParametrizacao({ tipoProcessoId: tipoId })
  chk(e3.publicavel, "com preço vigente, o estado passa a publicável")
  const p2 = await publicarParametrizacao({ tipoProcessoId: tipoId, usuarioId: 1 })
  chk(p2.publicou, "publicação coordenada executa")
  chk(p2.regrasPublicadas.length === 1 && p2.componentesAtivados.length === 1,
    `regra publicada E componente ativado na mesma transação (${p2.regrasPublicadas.length}/${p2.componentesAtivados.length})`)
  const mFinal = await prisma.matrizDocumental.findUnique({ where: { id: c.matrizId as number }, select: { status: true, publicadoEm: true } })
  const eFinal = await prisma.phaseEconomicRule.findUnique({ where: { id: c.econId as number }, select: { ativo: true } })
  chk(mFinal?.status === "PUBLICADA" && !!mFinal.publicadoEm && eFinal?.ativo === true, "estado final coerente: publicada + ativo + carimbo")

  // ── 6. republicar não duplica ───────────────────────────────────────────
  const p3 = await publicarParametrizacao({ tipoProcessoId: tipoId })
  chk(!p3.publicou && p3.regrasPublicadas.length === 0, "republicar não republica o que já está publicado")

  // ── 7. ZERO SEGUNDA FONTE — o guard estrutural ──────────────────────────
  const svcEstado = src("src/services/parametrizacao/estado-parametrizacao.ts")
  const svcSim = src("src/services/parametrizacao/simulacao-parametrizacao.ts")
  const tela = src("src/components/gerenciamentoComponents/AssistenteParametrizacaoTab.tsx")
  chk(/resolverElegibilidadeDocumental/.test(svcSim) && /resolverPrecoPorConfigDB/.test(svcSim),
    "a simulação chama os resolvedores do runtime (sem cálculo paralelo)")
  chk(/pendenciasDaParametrizacao/.test(svcEstado), "o estado usa o MESMO apurador de pendências do guard de publicação")
  chk(!/prisma\./.test(tela), "a tela não fala com o banco — só com as APIs oficiais")
  for (const t of ["RegrasDocumentaisTab", "AplicabilidadeEconomicaTab", "TabelaValoresTab", "FornecedoresTab"]) {
    chk(tela.includes(t), `a etapa embute a tela oficial ${t} (não a reimplementa)`)
  }
  const migr = src("prisma/migrations/20260806b_assistente_parametrizacao/migration.sql")
  chk(!/valor|preco|documentTypeCode|fornecedor/i.test(migr.split("CREATE TABLE")[1] ?? ""),
    "a tabela de progresso não tem coluna de configuração")

  // ── 8. CONCLUIR: o ciclo inteiro pela interface, sem terminal ───────────
  // O escopo aqui não tem processo nenhum, então nada é materializado — o que
  // importa provar é que as OITO etapas executam em ordem, cada uma com
  // métrica, e que o relatório final sai com o resumo administrativo.
  const eventos: any[] = []
  for await (const ev of concluirParametrizacao({ tipoProcessoId: tipoId, usuarioId: 1 })) eventos.push(ev)
  const passos = eventos.filter((e) => !("relatorio" in e))
  const rel = eventos.find((e) => "relatorio" in e)?.relatorio
  chk(passos.length === 8, `as 8 etapas de execução rodam em sequência (${passos.length})`)
  chk(passos.every((p) => typeof p.duracaoMs === "number" && typeof p.processados === "number"),
    "cada etapa reporta duração e quantidades")
  chk(passos.map((p) => p.etapa).join(",") === "validar,publicar,materializar,reconciliar,projecoes,financeiro,planilha,guards",
    `a ordem é a canônica (${passos.map((p: any) => p.etapa).join(" → ")})`)
  chk(!!rel && typeof rel.resumo?.documentos?.criados === "number" && typeof rel.resumo?.reconciliacao?.restantes === "number",
    "o relatório final traz o resumo administrativo completo")
  chk(rel?.pendencias !== undefined, "o relatório lista as pendências restantes em vez de mandar procurar")

  // idempotência do ciclo inteiro: rodar de novo não republica nem duplica
  const antesRegras = await prisma.matrizDocumental.count({ where: { tipoProcessoId: tipoId, status: "PUBLICADA" } })
  const eventos2: any[] = []
  for await (const ev of concluirParametrizacao({ tipoProcessoId: tipoId, usuarioId: 1 })) eventos2.push(ev)
  const depoisRegras = await prisma.matrizDocumental.count({ where: { tipoProcessoId: tipoId, status: "PUBLICADA" } })
  chk(antesRegras === depoisRegras, `concluir de novo não republica (${antesRegras} → ${depoisRegras})`)

  // ── 9. o ciclo NÃO depende de terminal ─────────────────────────────────
  const rota = src("src/app/api/gerenciamento/parametrizacao/concluir/route.ts")
  chk(/concluirParametrizacao/.test(rota), "existe endpoint HTTP que executa o ciclo")
  chk(/verificarPermissao/.test(rota), "o endpoint é gated por permissão restrita")
  const svc = src("src/services/parametrizacao/concluir-parametrizacao.ts")
  chk(/materializarExecucaoDaFase/.test(svc), "usa o materializador canônico (não recria)")
  chk(/reconciliarDocumentalFinanceiro/.test(svc), "usa o reconciliador canônico (não recria)")
  chk(/publicarParametrizacao/.test(svc), "usa a publicação coordenada (não republica por conta própria)")
  chk(!/execSync|spawn|child_process/.test(svc + rota), "nenhuma etapa chama processo de terminal")

  console.log(`\n${ok} passaram, ${fail} falharam`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => { await limpar().catch((e) => console.error("limpeza:", e)); await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
