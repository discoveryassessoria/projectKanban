// scripts/aviso-sem-responsavel-fase-futura.test.ts
// ============================================================================
// AVISO "N tarefas sem responsável há mais de 1 dia" (sino do gestor) NÃO conta tarefa de FASE FUTURA (02/10/2026).
//
// Achado real: o sino dizia "Antão — 23 tarefas sem responsável" e a lista da Torre mostrava 1. A lista aplica a regra única de
// fase futura (`fase-futura.ts`: fase que ainda não chegou não é trabalho de hoje); a consulta do aviso ia direto na tabela e as
// contava. Contagem do aviso = contagem da lista.
//
//   node scripts/ci/gate-build.mjs --suite todas --so aviso-sem-responsavel-fase-futura
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("aviso-sem-responsavel-fase-futura.test.ts")

import { prisma } from "../lib/prisma"
import { precisaDeVoce } from "../lib/operacional/avisos-sino"
import { garantirOferta } from "./_fixture-oferta"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "AVSF_"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { OR: [{ titulo: { startsWith: MARCA } }, { processoId: { in: ids } }] } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipoIds } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
}

async function main() {
  await limpar()
  const agora = new Date()
  const antigo = new Date(agora.getTime() - 3 * 86_400_000)

  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}pais`, modalityKey: "administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `${MARCA}tipo`, name: `${MARCA}tipo`, paisId: oferta.paisId, processFamily: "cidadania", serviceNature: "main_process" },
  })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA}macro`, versao: 1 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: `${MARCA}fase_atual`, label: "atual", ordem: 0, versao: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: `${MARCA}fase_futura`, label: "futura", ordem: 1, versao: 1, required: true, conditional: false } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA}familia`, tipoProcessoMotorId: tipo.id, faseAtualKey: `${MARCA}fase_atual` } })

  secao("1 tarefa da fase ATUAL e 4 de fase FUTURA, todas abertas, sem dono, criadas há 3 dias")
  const atual = await prisma.tarefa.create({ data: { titulo: `${MARCA}atual`, processoId: proc.id, faseMacroKey: `${MARCA}fase_atual`, statusTarefa: "NAO_INICIADA", createdAt: antigo } })
  const futuras = []
  for (let i = 0; i < 4; i++) {
    futuras.push(await prisma.tarefa.create({ data: { titulo: `${MARCA}futura-${i}`, processoId: proc.id, faseMacroKey: `${MARCA}fase_futura`, statusTarefa: "NAO_INICIADA", createdAt: antigo } }))
  }

  const itens = await precisaDeVoce({ agora })
  const semDono = itens.filter((i) => i.tipo === "SEM_RESPONSAVEL" && i.processoId === proc.id)
  const ids = semDono.flatMap((i) => i.tarefaIds)
  ok("o aviso existe para a família (a tarefa da fase atual conta)", semDono.length === 1 && ids.includes(atual.id), JSON.stringify(ids))
  ok("o aviso conta SÓ a tarefa da fase atual (1), não as 4 de fase futura", ids.length === 1, `contou ${ids.length}`)
  ok("nenhuma tarefa de fase futura entra no aviso", futuras.every((f) => !ids.includes(f.id)))

  secao("Só fase futura: nenhum aviso")
  await prisma.tarefa.update({ where: { id: atual.id }, data: { responsavelId: (await prisma.usuario.create({ data: { nome: `${MARCA}dono`, email: `${MARCA}dono@teste.com`, senha: "x", tipo: "assistente" } })).id } })
  const itens2 = await precisaDeVoce({ agora })
  ok("sem tarefa de fase atual sem dono, não há aviso (as futuras não geram)", !itens2.some((i) => i.tipo === "SEM_RESPONSAVEL" && i.processoId === proc.id))

  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
  await limpar()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
