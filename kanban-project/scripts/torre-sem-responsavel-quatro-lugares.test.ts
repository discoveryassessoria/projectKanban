// scripts/torre-sem-responsavel-quatro-lugares.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — "SEM RESPONSÁVEL" É O MESMO NÚMERO NOS QUATRO LUGARES (e a única diferença para o banco é explicada).
//
//   node scripts/ci/gate-build.mjs --so torre-sem-responsavel-quatro-lugares      (banco de teste descartável)
//
// Achado do palco: o banco dizia 39 tarefas abertas sem responsável e a Torre 38. Não era bug de cartão x lista: a tarefa a mais é de um
// PROCESSO PAUSADO, que sai de TODAS as contagens da Torre por decisão (pausa = fora do Radar e dos números). Este teste monta o caso
// (3 sem dono visíveis + 1 sem dono em processo pausado + 1 já atribuída) e prova, no mesmo instante:
//   Visão geral (cartão `ninguem`) = Tarefas (visão "Sem responsável") = Equipe (bloco "sem dono") = Precisa de você (soma das certidões dos
//   itens "Sem responsável") = 3; o banco puro = 4; a diferença é exatamente a tarefa do processo pausado, e some do banco-puro ao reativar.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-sem-responsavel-quatro-lugares.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { predicadoDaVisao } from "../lib/operacional/torre-tarefas-tela"
import { numeroDoKpi } from "../lib/operacional/torre-kpis"
import { quadroDaEquipe } from "../lib/operacional/torre-equipe"
import { montarPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"
import { pausarProcesso, reativarProcesso } from "../src/services/processo-pausa"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const MARCA = "SEMRESP"
const ABERTAS = ["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_TERCEIRO", "AGUARDANDO_CLIENTE", "BLOQUEADA"] as never

async function numeros(agora: Date) {
  const { linhas } = await listarTarefasDaTorre({}, agora)
  const nosso = new Set(linhas.filter((l) => l.processoNome?.startsWith(MARCA)).map((l) => l.taskId))
  const doNosso = linhas.filter((l) => nosso.has(l.taskId))
  const visaoGeral = numeroDoKpi("ninguem", doNosso, agora)
  const tarefas = doNosso.filter(predicadoDaVisao("semdono", null, agora)).length
  const equipe = (await quadroDaEquipe(doNosso, agora)).semResponsavel.ativas
  const precisa = (await montarPrecisaDeVoce(agora)).itens
    .filter((i) => i.tipo === "SEM_DONO")
    .flatMap((i) => ((i.contexto as { tarefaIds?: number[] }).tarefaIds ?? []))
    .filter((id) => nosso.has(id)).length
  return { visaoGeral, tarefas, equipe, precisa }
}

async function main() {
  const c = await montarCenario(MARCA)
  const usuarios: number[] = []
  try {
    const dono = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: `${MARCA.toLowerCase()}-d@t.com`, senha: "x", tipo: "assistente" } })
    usuarios.push(dono.id)
    const admin = await prisma.usuario.create({ data: { nome: "Marco Rovatti", email: `${MARCA.toLowerCase()}-m@t.com`, senha: "x", tipo: "admin" } })
    usuarios.push(admin.id)
    const a = await c.novaObrigacao({ responsavelId: null })
    const b = await c.novaObrigacao({ responsavelId: null })
    const d = await c.novaObrigacao({ responsavelId: null })
    const pausada = await c.novaObrigacao({ responsavelId: null })
    await c.novaObrigacao({ responsavelId: dono.id })
    const agora = new Date()
    const bancoPuro = () => prisma.tarefa.count({ where: { processoId: { in: [a.processoId, b.processoId, d.processoId, pausada.processoId] }, responsavelId: null, statusTarefa: { in: ABERTAS } } })

    console.log("\nantes de pausar: tudo igual, banco = telas")
    const n0 = await numeros(agora)
    ok(`Visão geral = Tarefas = Equipe = Precisa de você = 4 (${JSON.stringify(n0)})`, n0.visaoGeral === 4 && n0.tarefas === 4 && n0.equipe === 4 && n0.precisa === 4)
    ok("banco puro = 4", (await bancoPuro()) === 4)

    console.log("\nprocesso da 4ª tarefa PAUSADO: as quatro telas dizem 3 e o banco puro segue 4")
    const pz = await pausarProcesso({ processoId: pausada.processoId, usuarioId: admin.id, justificativa: "pausa do teste do número" })
    ok("pausar pela porta oficial", pz.ok === true)
    const n1 = await numeros(agora)
    ok(`Visão geral (cartão) = ${n1.visaoGeral}`, n1.visaoGeral === 3)
    ok(`Tarefas (visão "Sem responsável") = ${n1.tarefas}`, n1.tarefas === 3)
    ok(`Equipe (bloco "sem dono") = ${n1.equipe}`, n1.equipe === 3)
    ok(`Precisa de você (certidões dos itens "Sem responsável") = ${n1.precisa}`, n1.precisa === 3)
    const banco = await bancoPuro()
    ok(`banco puro = ${banco}: a diferença (${banco - n1.visaoGeral}) é EXATAMENTE a tarefa do processo pausado`, banco === 4 && banco - n1.visaoGeral === 1)
    const dentro = await listarTarefasDaTorre({}, agora, { incluirPausados: true })
    ok("com `incluirPausados` (só o Foco do processo) a tarefa pausada aparece: nada se perde, só não conta", dentro.linhas.some((l) => l.taskId === pausada.tarefaId))

    console.log("\nreativar: volta a contar nas quatro")
    const rv = await reativarProcesso({ processoId: pausada.processoId, usuarioId: admin.id })
    const n2 = await numeros(agora)
    ok(`reativado: ${JSON.stringify(n2)}`, rv.ok === true && n2.visaoGeral === 4 && n2.tarefas === 4 && n2.equipe === 4 && n2.precisa === 4)
  } finally {
    await c.limpar()
    await prisma.processoPausa.deleteMany({ where: { pausadoPorId: { in: usuarios } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
