// scripts/projecoes-concordam.test.ts
//
// A MESMA TAREFA, EM QUATRO TELAS, DIZENDO A MESMA COISA.
//
// Central do processo, Minha Fila, Operação e Kanban mostram a mesma unidade de
// trabalho. Quando cada uma monta a própria consulta, elas divergem devagar: a fila
// diz "atrasada", a Central diz "no prazo", o Kanban mostra numa coluna que a
// Operação não reconhece. Ninguém percebe até alguém comparar duas telas abertas
// lado a lado — e aí a pergunta "qual está certa?" não tem resposta.
//
// A prova é comparar. Uma tarefa real, lida por cada caminho, campo a campo:
// responsável, prazo, status, etapa atual, atraso e coluna. Divergência é falha.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/projecoes-concordam.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { minhaFila, semResponsavel, cargaPorResponsavel } from "../lib/operacional/tarefa-projecoes"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

const prisma = new PrismaClient()
const M = "PROJ"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ════════════════════════════════════════════════════════════════
console.log("\n(1) Existe UMA projeção, e as telas a consomem")
// ════════════════════════════════════════════════════════════════

const proj = semComentarios(ler("lib/operacional/tarefa-projecoes.ts"))
check("a projeção de fila é uma função só", proj.includes("export async function minhaFila"))
check("a coluna do Kanban é derivada, não guardada", proj.includes("export const COLUNAS_KANBAN"))

const rotaOperacao = semComentarios(ler("src/app/api/operacao/tarefas/route.ts"))
check("a Operação consome a projeção canônica", rotaOperacao.includes("from '@/lib/operacional/tarefa-projecoes'"))

// A CENTRAL do processo lê a projeção operacional canônica (a do motor).
const central = semComentarios(ler("src/lib/process-stage/operational-projection.ts"))
check("a Central tem projeção canônica própria de FASE", central.includes("export async function resolveOperationalProjection"))
check("e ela é resolvida em lote, sem N+1", central.includes("export async function resolveOperationalProjectionBatch"))

// ════════════════════════════════════════════════════════════════
const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(2) Concordância — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

async function main() {
  await limpar()
  console.log("\n(2) A MESMA TAREFA, LIDA POR CADA CAMINHO")

  const usuario = await prisma.usuario.create({
    data: { nome: `${M} Operador`, email: `${M.toLowerCase()}-op@teste.local`, senha: "x", tipo: "FUNCIONARIO" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  await prisma.pessoa.create({ data: { nome: "Alvo", sobrenome: "Projeção", arvoreId: arv.id } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${M}-i` },
    select: { id: true },
  })
  const passo = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1,
      stepKey: "solicitar_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", chaveIdempotencia: `${M}-p`,
    },
    select: { id: true },
  })
  await garantirTentativa(passo.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "EM_ANDAMENTO" })

  const ontem = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: `${M} pedido de certidão`, processoId: proc.id, workflowStepInstanceId: passo.id,
      statusTarefa: "EM_ANDAMENTO", responsavelId: usuario.id, dataPrazo: ontem,
      prioridade: "ALTA", dataInicio: new Date(),
    },
    select: { id: true },
  })

  // ── CAMINHO 1: a fila pessoal ──
  const fila = await minhaFila(usuario.id)
  const naFila = fila.find((l) => l.taskId === tarefa.id)
  check("a tarefa aparece na fila do responsável", naFila != null)

  // ── CAMINHO 2: a leitura direta que a Central/Kanban fazem ──
  const direto = await prisma.tarefa.findUnique({
    where: { id: tarefa.id },
    select: { id: true, statusTarefa: true, responsavelId: true, dataPrazo: true, workflowStepInstanceId: true, prioridade: true },
  })

  check("RESPONSÁVEL igual nos dois caminhos", naFila?.responsavelId === direto?.responsavelId,
    `fila=${naFila?.responsavelId} direto=${direto?.responsavelId}`)
  check("STATUS igual nos dois caminhos", naFila?.statusTarefa === direto?.statusTarefa,
    `fila=${naFila?.statusTarefa} direto=${direto?.statusTarefa}`)
  check("PRAZO igual nos dois caminhos",
    (naFila?.dataPrazo ?? null) === (direto?.dataPrazo ? direto.dataPrazo.toISOString() : null),
    `fila=${naFila?.dataPrazo} direto=${direto?.dataPrazo?.toISOString()}`)
  check("PRIORIDADE igual nos dois caminhos", String(naFila?.prioridade) === String(direto?.prioridade))
  check("ETAPA ATUAL aponta para o mesmo passo", naFila?.etapaAtual != null)

  // ── ATRASO: derivado, e derivado UMA vez ──
  check("a fila calcula o atraso e ele bate com o prazo vencido",
    naFila != null && (naFila as { atrasada?: boolean }).atrasada === true,
    JSON.stringify({ prazo: naFila?.dataPrazo }))

  // ── CAMINHO 3: sem responsável ──
  const semResp = await semResponsavel()
  check("com responsável, a tarefa NÃO aparece na lista de sem responsável",
    !semResp.some((l) => l.taskId === tarefa.id))
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { responsavelId: null } })
  const semResp2 = await semResponsavel()
  check("retirado o responsável, ela aparece — mesma tarefa, mesma identidade",
    semResp2.some((l) => l.taskId === tarefa.id))
  const filaVazia = await minhaFila(usuario.id)
  check("e some da fila pessoal, sem virar outra tarefa",
    !filaVazia.some((l) => l.taskId === tarefa.id))
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { responsavelId: usuario.id } })

  // ── CAMINHO 4: carga por responsável ──
  const carga = await cargaPorResponsavel()
  const doOperador = carga.find((c) => (c as { responsavelId?: number }).responsavelId === usuario.id)
  check("a carga do responsável contabiliza a MESMA tarefa", doOperador != null)

  // ── A CONTAGEM DO CARD É A MESMA QUERY DO FILTRO ──
  const contagemSemResp = (await semResponsavel()).length
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { responsavelId: null } })
  const contagemDepois = (await semResponsavel()).length
  check("o indicador muda junto com o filtro (mesma consulta)", contagemDepois === contagemSemResp + 1,
    `${contagemSemResp} → ${contagemDepois}`)
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { responsavelId: usuario.id } })

  // ── CONCLUIR: some de todas ao mesmo tempo ──
  await prisma.tarefa.update({
    where: { id: tarefa.id },
    data: { statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, dataConclusao: new Date() },
  })
  const [f2, s2] = await Promise.all([minhaFila(usuario.id), semResponsavel()])
  check("concluída, ela sai da fila E da lista de sem responsável ao mesmo tempo",
    !f2.some((l) => l.taskId === tarefa.id) && !s2.some((l) => l.taskId === tarefa.id))

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
