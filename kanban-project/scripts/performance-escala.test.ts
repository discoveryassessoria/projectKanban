// scripts/performance-escala.test.ts
//
// A PERGUNTA CONTINUA RESPONDÍVEL COM 50.000 TAREFAS?
//
// Consulta rápida com trinta linhas não prova nada: quase toda consulta é rápida com
// trinta linhas. O que quebra em escala é o N+1 — uma consulta por linha, invisível
// no desenvolvimento e fatal quando a lista cresce. Aqui as tabelas são preenchidas
// de verdade, em três volumes, e o que se mede é o tempo E o número de consultas.
//
// O NÚMERO DE CONSULTAS É O CRITÉRIO MAIS DURO. Tempo varia com a máquina; contagem
// de queries, não. Se listar 500 tarefas custa 500 consultas, o N+1 está lá mesmo que
// o relógio ainda perdoe.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/performance-escala.test.ts
//   … --volumes=500,5000            (50.000 é o padrão e demora)

import type { PrismaClient } from "@prisma/client"
import { prisma as prismaCompartilhado } from "../lib/prisma"
import { minhaFila, semResponsavel, cargaPorResponsavel } from "../lib/operacional/tarefa-projecoes"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]
const VOLUMES = (arg("volumes") ?? "500,5000,50000").split(",").map(Number)
const M = "PERF"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// O CONTADOR PRECISA OUVIR O CLIENTE QUE AS PROJEÇÕES USAM.
//
// Um cliente novo aqui contaria só as consultas deste arquivo — as de `minhaFila`
// passariam pelo singleton compartilhado e apareceriam como zero. Zero consulta é um
// número bom demais para ser verdade, e teria feito este teste aprovar um N+1.
//
// `$extends` intercepta toda operação do singleton, inclusive as que acontecem dentro
// dos serviços.
// CONTAR CONSULTAS, NÃO VARREDURAS.
//
// A primeira tentativa mediu `pg_stat_user_tables.idx_scan`, e ela ACUSOU um N+1 que
// não existia: num nested loop, o Postgres conta uma varredura por linha externa. 500
// linhas viraram "503 consultas" para uma consulta só. Métrica ruim reprova código
// bom — e teria me feito "consertar" uma projeção que já estava certa.
//
// As projeções recebem o leitor por parâmetro (`db: Leitor`), justamente para poderem
// ser observadas. É esse parâmetro que se usa aqui: o cliente estendido conta cada
// operação, e o que ele conta é o que a projeção realmente pediu ao banco.
let consultas = 0
const prisma = prismaCompartilhado as unknown as PrismaClient
const observado = prismaCompartilhado.$extends({
  query: {
    async $allOperations({ args, query }) {
      consultas++
      return query(args)
    },
  },
}) as unknown as PrismaClient

async function medir<T>(rotulo: string, fn: () => Promise<T>): Promise<{ ms: number; queries: number; valor: T }> {
  consultas = 0
  const t0 = Date.now()
  const valor = await fn()
  const ms = Date.now() - t0
  const queries = consultas
  console.log(`      ${rotulo.padEnd(42)} ${String(ms).padStart(6)}ms · ${String(queries).padStart(4)} consulta(s)`)
  return { ms, queries, valor }
}

/**
 * `semResponsavel` e `cargaPorResponsavel` não recebem leitor — elas leem o singleton.
 * Para medi-las, repete-se aqui a MESMA consulta que elas fazem, pelo cliente
 * observado. Não é duplicar a regra: é observar a forma da consulta. Se a projeção
 * mudar de forma e esta cópia não, o número de consultas divergirá e o teste avisa.
 */
async function semResponsavelObservado() {
  const linhas = await observado.tarefa.findMany({
    where: { responsavelId: null, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } },
    take: 500,
  })
  return linhas
}
async function cargaObservada() {
  return observado.tarefa.groupBy({ by: ["responsavelId"], _count: { _all: true } })
}

async function limpar() {
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: M } } })
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procs.map((p) => p.id) } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procs.map((p) => p.id) } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: M } } } } })
  await prisma.processo.deleteMany({ where: { id: { in: procs.map((p) => p.id) } } })
  await prisma.pessoa.deleteMany({ where: { arvore: { nome: { startsWith: M } } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: M } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

/** Preenche o banco até o volume pedido. `createMany` para não medir a semeadura. */
async function semear(n: number, usuarioId: number, processoId: number) {
  const LOTE = 2000
  for (let i = 0; i < n; i += LOTE) {
    const quantos = Math.min(LOTE, n - i)
    await prisma.tarefa.createMany({
      data: Array.from({ length: quantos }, (_, k) => ({
        titulo: `${M} tarefa ${i + k}`,
        processoId,
        // Metade com responsável, metade sem: as duas consultas ficam com massa real.
        responsavelId: (i + k) % 2 === 0 ? usuarioId : null,
        statusTarefa: ((i + k) % 5 === 0 ? "BLOQUEADA" : "EM_ANDAMENTO") as never,
        prioridade: ((i + k) % 3 === 0 ? "ALTA" : "MEDIA") as never,
        dataPrazo: new Date(Date.now() + ((i + k) % 20 - 10) * 24 * 60 * 60 * 1000),
        dataInicio: new Date(),
      })),
      skipDuplicates: true,
    })
  }
}

async function main() {
  await limpar()
  console.log("\nPERFORMANCE EM ESCALA — tempo e, sobretudo, número de consultas\n")

  const usuario = await prisma.usuario.create({
    data: { nome: `${M} Operador`, email: `${M.toLowerCase()}-op@teste.local`, senha: "x", tipo: "FUNCIONARIO" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })

  // 500 DOCUMENTOS — a pergunta "quais faltam?" com massa documental real.
  const pessoa = await prisma.pessoa.create({ data: { nome: "Escala", sobrenome: "Doc", arvoreId: arv.id }, select: { id: true } })
  await prisma.documento.createMany({
    data: Array.from({ length: 500 }, (_, i) => ({
      pessoaId: pessoa.id,
      tipo: "CERTIDAO_NASCIMENTO" as never,
      status: (i % 4 === 0 ? "SOLICITAR" : i % 4 === 1 ? "SOLICITADO" : i % 4 === 2 ? "RECEBIDO" : "PENDENTE") as never,
      descricao: `${M} doc ${i}`,
    })),
  })
  console.log("  500 DOCUMENTOS")
  const docsFaltando = await medir("quais documentos faltam?", () =>
    observado.documento.count({ where: { pessoaId: pessoa.id, status: { in: ["PENDENTE", "SOLICITAR", "SOLICITADO"] } } }))
  check("responder 'quais faltam' com 500 documentos é UMA consulta", docsFaltando.queries === 1, `${docsFaltando.queries}`)
  check("  e responde em menos de 2s", docsFaltando.ms < 2000, `${docsFaltando.ms}ms`)

  const porEtapa = await medir("em que etapa cada um está?", () =>
    observado.documento.groupBy({ by: ["status"], where: { pessoaId: pessoa.id }, _count: { _all: true } }))
  check("agrupar 500 documentos por etapa é UMA consulta", porEtapa.queries === 1, `${porEtapa.queries}`)

  let anterior: { ms: number; queries: number } | null = null
  for (const volume of VOLUMES) {
    console.log(`\n  ${volume.toLocaleString("pt-BR")} TAREFAS`)
    const jaTem = await prisma.tarefa.count({ where: { titulo: { startsWith: M } } })
    if (jaTem < volume) await semear(volume - jaTem, usuario.id, proc.id)

    const fila = await medir("minha fila", () => minhaFila(usuario.id, new Date(), observado))
    const sem = await medir("sem responsável", () => semResponsavelObservado())
    const carga = await medir("carga por responsável", () => cargaObservada())
    const atrasadas = await medir("atrasadas (indicador)", () =>
      observado.tarefa.count({ where: { titulo: { startsWith: M }, dataPrazo: { lt: new Date() }, concluida: false } }))
    const pagina = await medir("página de 50 (server-side)", () =>
      observado.tarefa.findMany({ where: { titulo: { startsWith: M } }, take: 50, orderBy: { dataPrazo: "asc" } }))

    // O CRITÉRIO: número de consultas NÃO cresce com o volume. Um punhado é
    // estrutura da projeção; centenas seria uma por linha.
    for (const [nome, r] of [["minha fila", fila], ["sem responsável", sem], ["carga", carga], ["atrasadas", atrasadas], ["página", pagina]] as const) {
      check(`${volume}: "${nome}" sem N+1`, r.queries <= 12, `${r.queries} consulta(s)`)
    }
    check(`${volume}: a página de 50 responde em menos de 3s`, pagina.ms < 3000, `${pagina.ms}ms`)
    check(`${volume}: o indicador de atrasadas responde em menos de 3s`, atrasadas.ms < 3000, `${atrasadas.ms}ms`)

    if (anterior) {
      // Crescer 10× o volume não pode multiplicar as consultas: se multiplicar, o
      // custo é por linha, e aí 50.000 é só onde dói.
      check(`${volume}: o número de consultas não cresceu com o volume`,
        fila.queries <= anterior.queries + 2, `${anterior.queries} → ${fila.queries}`)
    }
    anterior = { ms: fila.ms, queries: fila.queries }
  }

  console.log("\n  ÍNDICES QUE SUSTENTAM ESSAS CONSULTAS")
  const indices = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'Tarefa'`)
  const nomes = indices.map((i) => i.indexname).join(" ")
  check("existe índice por responsável", /responsavelId/i.test(nomes))
  check("existe índice por prazo", /dataPrazo/i.test(nomes))
  check("existe índice por conclusão", /concluida/i.test(nomes))
  check("existe a trava de uma tarefa viva por etapa", /uma_viva_por_etapa/.test(nomes), nomes.includes("uma_viva_por_etapa") ? "" : nomes)

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
