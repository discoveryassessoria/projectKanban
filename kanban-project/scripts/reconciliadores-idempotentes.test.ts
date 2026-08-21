// scripts/reconciliadores-idempotentes.test.ts
//
// RECONCILIAR DUAS VEZES TEM DE DAR NO MESMO.
//
// Um reconciliador que muda algo na segunda passagem não converge: ele oscila. E
// como esses jobs rodam de hora em hora, oscilação vira ruído contínuo — lançamento
// financeiro criado e removido, tarefa reaberta e fechada, evento repetido no
// histórico. O sintoma aparece longe da causa, semanas depois.
//
// A prova é direta: rodar, fotografar o banco, rodar de novo, comparar. A segunda
// execução tem de produzir ZERO mutação semântica. `updatedAt` muda e não conta —
// o que conta é o CONTEÚDO.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/reconciliadores-idempotentes.test.ts

import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { PrismaClient } from "@prisma/client"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function arquivos(dir: string): string[] {
  const base = join(ROOT, dir)
  if (!existsSync(base)) return []
  const saida: string[] = []
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome)
      if (nome === "node_modules" || nome === ".next") continue
      if (statSync(p).isDirectory()) andar(p)
      else if (nome.endsWith(".ts")) saida.push(relative(ROOT, p))
    }
  }
  andar(base)
  return saida
}

// ════════════════════════════════════════════════════════════════
console.log("\n(1) O INVENTÁRIO — todo reconciliador está mapeado")
// ════════════════════════════════════════════════════════════════

// Este teste falha quando alguém acrescenta um reconciliador e não o declara aqui.
// É de propósito: reconciliador não declarado é reconciliador não vigiado, e foi
// assim que dois deles passaram a fazer a mesma coisa sem ninguém notar.
const RECONCILIADORES: Array<{ arquivo: string; fn: string; oQueConverge: string }> = [
  { arquivo: "src/lib/motor/reconciliar-requerente-economico.ts", fn: "reconciliarAutomacaoPorRequerente", oQueConverge: "lançamentos por requerente" },
  { arquivo: "src/lib/motor/matriz-economica.ts", fn: "reconciliarEconomicoDaFase", oQueConverge: "matriz econômica da fase" },
  { arquivo: "src/lib/motor/matriz-economica.ts", fn: "reconciliarEconomicoDoProcesso", oQueConverge: "matriz econômica do processo" },
  { arquivo: "src/lib/motor/executor.ts", fn: "reconciliarFinanceiroDaFase", oQueConverge: "regras financeiras da fase" },
  { arquivo: "src/lib/motor/executor.ts", fn: "reconciliarPorRegra", oQueConverge: "uma regra financeira em todos os processos" },
  { arquivo: "src/lib/motor/executor.ts", fn: "reconciliarFinanceiroDoProcesso", oQueConverge: "regras financeiras do processo" },
  { arquivo: "src/lib/motor/reconciliar-motor-fases.ts", fn: "reconciliarMotorDeFases", oQueConverge: "posição macro do processo" },
  { arquivo: "src/services/pessoa-ciclo-vida.ts", fn: "reconciliarAposRemocao", oQueConverge: "estado derivado após remover pessoa" },
  { arquivo: "src/services/reconciliar-fase.ts", fn: "reconciliarFaseAtiva", oQueConverge: "passos materializados da fase ativa" },
  { arquivo: "src/services/operacao-antecipada.ts", fn: "reconciliarOperacoesAntecipadas", oQueConverge: "operação antecipada ao entrar na fase" },
  { arquivo: "src/services/tarefa-transversal.ts", fn: "reconciliarTransversaisNaFase", oQueConverge: "tarefas transversais" },
  { arquivo: "src/services/necessidade-documental.ts", fn: "reconciliarNecessidadesPorPassos", oQueConverge: "ciclo de vida da necessidade" },
  { arquivo: "src/services/registral/reconciliacao-documental.ts", fn: "reconciliarDocumentalDoProcesso", oQueConverge: "documentos × linhagem registral" },
  { arquivo: "src/services/financeiro/reconciliacao-documental-financeira.ts", fn: "reconciliarDocumentalFinanceiro", oQueConverge: "documento × lançamento financeiro" },
  { arquivo: "lib/operacional/reconciliar-tarefas.ts", fn: "reconciliarTarefas", oQueConverge: "tarefa × passos" },
  // Concluir uma subtarefa muda o estado das que dependiam dela. Sem reconciliar, elas
  // continuariam BLOQUEADO no banco enquanto a projeção já as considera disponíveis —
  // duas respostas para a mesma pergunta.
  { arquivo: "src/services/subtarefas-da-etapa.ts", fn: "reconciliarSubtarefas", oQueConverge: "execução da subtarefa × dependências e condições" },
]

const encontrados: string[] = []
for (const f of [...arquivos("src"), ...arquivos("lib")]) {
  if (f.includes("scripts/")) continue
  const t = ler(f)
  for (const m of t.matchAll(/export async function (reconciliar\w+)/g)) encontrados.push(`${f}::${m[1]}`)
}
const declarados = new Set(RECONCILIADORES.map((r) => `${r.arquivo}::${r.fn}`))
const naoDeclarados = encontrados.filter((e) => !declarados.has(e))
check(`os ${RECONCILIADORES.length} reconciliadores do sistema estão declarados`, naoDeclarados.length === 0,
  naoDeclarados.length ? `não declarado(s): ${naoDeclarados.join(", ")}` : "")
const mortos = [...declarados].filter((d) => !encontrados.includes(d))
check("nenhuma declaração morta", mortos.length === 0, mortos.join(", "))
for (const r of RECONCILIADORES) {
  check(`${r.fn} diz o que converge`, r.oQueConverge.length > 5)
}

// ════════════════════════════════════════════════════════════════
console.log("\n(2) NENHUM deles apaga histórico ao convergir")
// ════════════════════════════════════════════════════════════════

// Convergir é ajustar o estado DERIVADO. Um reconciliador que apaga evento, tentativa
// ou log está reescrevendo o passado para fazer a conta fechar.
const PROIBIDO = [
  { padrao: /workflowEvento\.delete/, nome: "apagar evento de workflow" },
  { padrao: /stepExecution\.delete/, nome: "apagar tentativa de execução" },
  { padrao: /logAuditoria\.delete/, nome: "apagar auditoria" },
  { padrao: /phaseAdvanceLog\.delete/, nome: "apagar log de avanço" },
]
for (const r of RECONCILIADORES) {
  const t = ler(r.arquivo)
  const i = t.indexOf(`export async function ${r.fn}`)
  const corpo = i >= 0 ? t.slice(i, t.indexOf("\nexport ", i + 1) < 0 ? undefined : t.indexOf("\nexport ", i + 1)) : ""
  const viola = PROIBIDO.filter((p) => p.padrao.test(corpo))
  check(`${r.fn} não reescreve o passado`, viola.length === 0, viola.map((v) => v.nome).join(", "))
}

// ════════════════════════════════════════════════════════════════
const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(3) Convergência — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

const prisma = new PrismaClient()

/**
 * A FOTOGRAFIA DO BANCO — só o que é semântico.
 *
 * `updatedAt` muda a cada escrita e não significa mudança de estado; incluí-lo faria
 * toda reconciliação parecer não-idempotente. O que entra é o conteúdo que o domínio
 * afirma.
 */
async function fotografar(processoId: number) {
  const [passos, tarefas, docs, necessidades, receitas, obrigacoes, eventos, instancias] = await Promise.all([
    prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, stepKey: true, status: true, ordem: true, ciclo: true, responsavelId: true, prazo: true, completedAt: true, dependeDeStepKeys: true },
    }),
    prisma.tarefa.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, statusTarefa: true, responsavelId: true, dataPrazo: true, concluida: true, workflowStepInstanceId: true },
    }),
    prisma.documento.findMany({
      where: { pessoa: { arvore: { processos: { some: { id: processoId } } } } }, orderBy: { id: "asc" },
      select: { id: true, status: true, necessidadeId: true, derivadoDeId: true, substituidoEm: true },
    }),
    prisma.necessidadeDocumental.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, status: true, pessoaId: true },
    }),
    prisma.receita.count({ where: { processoId } }),
    prisma.obrigacaoEconomica.count({ where: { processoId } }).catch(() => 0),
    prisma.workflowEvento.count({ where: { processoId } }),
    prisma.phaseWorkflowInstance.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, faseMacroKey: true, ciclo: true, status: true },
    }),
  ])
  return JSON.stringify({ passos, tarefas, docs, necessidades, receitas, obrigacoes, eventos, instancias })
}

const M = "RECON"
async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
}

async function main() {
  await limpar()
  console.log("\n(3) CONVERGÊNCIA — segunda passagem não muda nada")

  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Requerente", sobrenome: "Recon", arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" },
    select: { id: true },
  })
  // A NECESSIDADE e o DOCUMENTO que a atende — é sobre esse par que a nova via age.
  // A necessidade referencia um ITEM DO CATÁLOGO — ela descreve "que documento o
  // processo precisa", e isso é vocabulário do cadastro mestre, não texto livre.
  const item = await prisma.itemCatalogo.upsert({
    where: { code: `${M}_ITEM` },
    update: {},
    create: { code: `${M}_ITEM`, name: "Certidão de nascimento (teste)", natureza: "SERVICO" },
    select: { id: true },
  })
  const necessidade = await prisma.necessidadeDocumental.create({
    data: {
      processoId: proc.id, pessoaId: pessoa.id, status: "PENDENTE",
      itemCatalogoId: item.id, chaveIdempotencia: `${M}-nec-1`,
    },
    select: { id: true },
  })
  await prisma.documento.create({
    data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", status: "RECEBIDO", necessidadeId: necessidade.id },
  })
  // Uma instância de fase com um passo: sem isso o palco não tem onde a operação
  // acontecer, e o bloco da nova via não roda — que foi o que aconteceu na primeira
  // versão deste teste. Palco incompleto prova menos do que parece.
  const instRecon = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO",
      chaveIdempotencia: `${M}-inst`,
    },
    select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instRecon.id, processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1,
      stepKey: "localizar_registro", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", chaveIdempotencia: `${M}-passo`,
    },
  })

  const { reconciliarMotorDeFases } = await import("../src/lib/motor/reconciliar-motor-fases")
  const { reconciliarEconomicoDoProcesso } = await import("../src/lib/motor/matriz-economica")
  const { reconciliarFinanceiroDoProcesso } = await import("../src/lib/motor/executor")
  const { reconciliarTarefas } = await import("../lib/operacional/reconciliar-tarefas")
  const { reconciliarDocumentalFinanceiro } = await import("../src/services/financeiro/reconciliacao-documental-financeira")

  const RODAR: Array<{ nome: string; run: () => Promise<unknown> }> = [
    { nome: "reconciliarMotorDeFases", run: () => reconciliarMotorDeFases(proc.id, { origem: "teste-idem", correlationId: `${M}-1` }) },
    { nome: "reconciliarEconomicoDoProcesso", run: () => reconciliarEconomicoDoProcesso(proc.id) },
    { nome: "reconciliarFinanceiroDoProcesso", run: () => reconciliarFinanceiroDoProcesso(proc.id) },
    { nome: "reconciliarTarefas", run: () => reconciliarTarefas({ processoId: proc.id }) },
    { nome: "reconciliarDocumentalFinanceiro", run: () => reconciliarDocumentalFinanceiro({ processoId: proc.id }) },
  ]

  for (const r of RODAR) {
    try { await r.run() } catch (e) {
      check(`${r.nome} roda sem explodir`, false, String(e).slice(0, 140))
      continue
    }
    const antes = await fotografar(proc.id)
    try { await r.run() } catch (e) {
      check(`${r.nome} roda duas vezes sem explodir`, false, String(e).slice(0, 140))
      continue
    }
    const depois = await fotografar(proc.id)
    check(`${r.nome}: S1 → reconcile → S1 (zero mutação semântica)`, antes === depois,
      antes === depois ? "" : "a segunda passagem mudou o estado")
  }

  // VINTE PASSAGENS — oscilação lenta não aparece na segunda.
  const antes20 = await fotografar(proc.id)
  for (let i = 0; i < 20; i++) for (const r of RODAR) await r.run().catch(() => null)
  const depois20 = await fotografar(proc.id)
  check("20 passagens seguidas continuam no mesmo estado", antes20 === depois20)

  // ── REENTRADA E REEXECUÇÃO NÃO DUPLICAM FINANCEIRO ────────────────────────
  console.log("\n(4) Reentrada e nova via não duplicam lançamento")
  const receitasAntes = await prisma.receita.count({ where: { processoId: proc.id } })
  const { movePhaseManual } = await import("../src/lib/motor/phase-advance")
  await movePhaseManual(proc.id, {
    faseAlvo: "emissao_documental", justificativa: "Reentrada do teste de idempotência.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: 1, origem: "teste",
  }).catch(() => null)
  await movePhaseManual(proc.id, {
    faseAlvo: "genealogia", justificativa: "Volta do teste de idempotência.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: 1, origem: "teste",
  }).catch(() => null)
  for (const r of RODAR) await r.run().catch(() => null)
  const receitasDepois = await prisma.receita.count({ where: { processoId: proc.id } })
  check("ir e voltar de fase não cria lançamento novo", receitasAntes === receitasDepois,
    `${receitasAntes} → ${receitasDepois}`)

  const { novaViaDocumental } = await import("../src/services/efeitos-de-dominio")
  const docOriginal = await prisma.documento.findFirst({ where: { pessoaId: pessoa.id }, select: { id: true } })
  const passoQualquer = await prisma.phaseWorkflowStepInstance.findFirst({ where: { processoId: proc.id }, select: { id: true } })
  if (docOriginal && passoQualquer) {
    await novaViaDocumental({
      stepInstanceId: passoQualquer.id, documentoId: docOriginal.id, processoId: proc.id,
      usuarioId: 1, sync: { origem: "USER", correlationId: `${M}-nv` }, valores: { motivo: "teste" },
    })
    for (const r of RODAR) await r.run().catch(() => null)
    const receitasPosVia = await prisma.receita.count({ where: { processoId: proc.id } })
    check("nova via não duplica lançamento do documento original", receitasPosVia === receitasDepois,
      `${receitasDepois} → ${receitasPosVia}`)
    const necessidades = await prisma.documento.findMany({
      where: { pessoaId: pessoa.id }, select: { id: true, necessidadeId: true, substituidoEm: true },
    })
    check("os dois documentos apontam para a MESMA necessidade",
      new Set(necessidades.map((d) => d.necessidadeId)).size === 1)
    check("e só um deles é o vigente", necessidades.filter((d) => d.substituidoEm == null).length === 1)
  }

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
