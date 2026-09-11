// scripts/projecoes-fecham-por-ids.test.ts
// ============================================================================
// UNIDADE 8 do plano de consolidação (10/09/2026) — lacuna real da auditoria:
// "fechamento de IDs entre Home × Central Operacional × Operação (Tarefas e
// Projetos) sob o MESMO escopo" tinha ZERO cobertura de teste. As três telas
// afirmam consumir a mesma base (`whereGerencial`/`agregacaoPorFamilia`), mas
// nenhum teste jamais comparou os números — nem os IDs — sob o mesmo filtro.
//
// CLAUDE.md §29 (Prova por IDs): "Sempre que houver investigação crítica,
// comparar conjuntos de IDs... Sob mesmo QuerySpec/scope, os conjuntos devem
// representar a mesma realidade." Este teste é essa prova, com dado real:
//
//   1. Monta uma família com 2 processos e 4 Tarefas de estado DELIBERADAMENTE
//      variado (ativa, concluída, bloqueada, de outro responsável) — o
//      gabarito de quem DEVE e quem NÃO DEVE aparecer é conhecido de
//      antemão, pela própria construção do cenário.
//   2. Sob o MESMO filtro, compara:
//        - visaoGerencial        (Tarefas e Projetos · Lista/Kanban)
//        - indicadoresGerenciais (Central Operacional / Home · card "Abertas")
//        - agregacaoPorFamilia   (Central Operacional · Família → Processo → Fase)
//      contra o gabarito — não umas contra as outras (comparar A com B só
//      prova que as duas erram igual).
//
//   ACHADO DE PERCURSO (documentado, não é bug): as três NÃO respondem a
//   mesma pergunta sobre uma Tarefa CONCLUÍDA. `visaoGerencial`/
//   `agregacaoPorFamilia` mostram o QUADRO inteiro (Kanban tem coluna
//   "Concluída", por design — STATUS_ATIVOS + STATUS_CONCLUIDOS);
//   `indicadoresGerenciais.total` é especificamente "Abertas" (só
//   STATUS_ATIVOS). O teste prova cada uma contra o gabarito CERTO para o que
//   ela promete ser — e prova que a Tarefa concluída nunca desaparece do
//   quadro nem é contada como aberta.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/projecoes-fecham-por-ids.test.ts
// ============================================================================
import { prisma } from "../src/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { visaoGerencial, indicadoresGerenciais, agregacaoPorFamilia } from "../lib/operacional/tarefa-projecoes"

const MARCA = "PROJIDS"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const familia = await prisma.familia.findFirst({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  if (ids.length) {
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  if (familia) await prisma.familia.deleteMany({ where: { id: familia.id } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@projids.test" } } })
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@projids.test`, senha: "x", tipo: "assistente" }, select: { id: true } })

async function main() {
  exigirBancoDeTeste("prova, por IDs, que Home/Central/Operação enxergam a MESMA realidade de Tarefa sob o mesmo filtro")
  await limpar()

  console.log("PROJEÇÕES FECHAM POR IDs — Home × Central Operacional × Tarefas e Projetos\n")

  const x = await usuario("ResponsavelX")
  const y = await usuario("ResponsavelY")
  const familia = await prisma.familia.create({ data: { nome: `${MARCA} familia` }, select: { id: true } })
  const arvA = await prisma.arvore.create({ data: { nome: `${MARCA} arvoreA` }, select: { id: true } })
  const arvB = await prisma.arvore.create({ data: { nome: `${MARCA} arvoreB` }, select: { id: true } })
  const procA = await prisma.processo.create({ data: { nome: `${MARCA} processoA`, arvoreId: arvA.id, familiaId: familia.id }, select: { id: true } })
  const procB = await prisma.processo.create({ data: { nome: `${MARCA} processoB`, arvoreId: arvB.id, familiaId: familia.id }, select: { id: true } })

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) O GABARITO — 4 Tarefas, estado deliberadamente variado")
  // ══════════════════════════════════════════════════════════════════════════
  const t1 = await prisma.tarefa.create({ data: { titulo: `${MARCA} t1 ativa`, processoId: procA.id, responsavelId: x.id, statusTarefa: "NAO_INICIADA", concluida: false, ordem: 0 }, select: { id: true } })
  const t2 = await prisma.tarefa.create({ data: { titulo: `${MARCA} t2 concluida`, processoId: procA.id, responsavelId: x.id, statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, dataConclusao: new Date(), ordem: 1 }, select: { id: true } })
  const t3 = await prisma.tarefa.create({ data: { titulo: `${MARCA} t3 bloqueada`, processoId: procB.id, responsavelId: x.id, statusTarefa: "BLOQUEADA", concluida: false, ordem: 0 }, select: { id: true } })
  const t4 = await prisma.tarefa.create({ data: { titulo: `${MARCA} t4 de outro responsavel`, processoId: procB.id, responsavelId: y.id, statusTarefa: "NAO_INICIADA", concluida: false, ordem: 1 }, select: { id: true } })

  // ACHADO DURANTE A ESCREVA DESTE TESTE: a primeira versão assumia que "Tarefa
  // concluída nunca aparece em nenhuma projeção" — GABARITO ERRADO, não bug do
  // produto. `indicadoresGerenciais.total` conta só STATUS_ATIVOS ("Abertas");
  // `visaoGerencial`/`agregacaoPorFamilia` mostram o QUADRO INTEIRO
  // (STATUS_ATIVOS + STATUS_CONCLUIDOS — a coluna "Concluída" do Kanban existe
  // de propósito). São duas perguntas DIFERENTES, deliberadamente — corrigido
  // aqui para provar CADA uma contra o gabarito certo, não uma contra a outra.
  //
  // Sob filtro {responsavelId: X}: ativas do X = t1, t3. Quadro completo do X
  // (ativas + concluídas) = t1, t2, t3. t4 é de outro responsável, sempre fora.
  const abertasX = new Set([t1.id, t3.id])
  const quadroX = new Set([t1.id, t2.id, t3.id])
  // Sem filtro de responsável: ativas = t1, t3, t4. Quadro completo = as 4.
  const abertasTodos = new Set([t1.id, t3.id, t4.id])
  const quadroTodos = new Set([t1.id, t2.id, t3.id, t4.id])

  const agora = new Date()

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) SOB O FILTRO {responsavelId: X}")
  // ══════════════════════════════════════════════════════════════════════════
  const filtroX = { responsavelId: x.id, processoId: undefined as number | undefined }
  const listaX = await visaoGerencial(filtroX, agora)
  const idsQuadroX = new Set(listaX.linhas.filter((l) => [procA.id, procB.id].includes(l.processoId as number)).map((l) => l.taskId))
  ok("2a) Tarefas e Projetos (visaoGerencial) mostra o QUADRO completo (ativas + concluídas) do X",
    idsQuadroX.size === quadroX.size && [...quadroX].every((id) => idsQuadroX.has(id)),
    `esperado {${[...quadroX].join(",")}} · achado {${[...idsQuadroX].join(",")}}`)
  const idsAbertasX = new Set(listaX.linhas.filter((l) => [procA.id, procB.id].includes(l.processoId as number) && l.statusTarefa !== "CONCLUIDO_RECEBIDO" && l.statusTarefa !== "CONCLUIDO_NAO_POSSUI").map((l) => l.taskId))
  ok("2b) e o subconjunto ATIVO da mesma lista bate com o gabarito de 'abertas'",
    idsAbertasX.size === abertasX.size && [...abertasX].every((id) => idsAbertasX.has(id)))

  const indX = await indicadoresGerenciais(filtroX, agora)
  ok("2c) Central Operacional/Home (indicadoresGerenciais.total) = 'Abertas' do X, NÃO o quadro inteiro",
    indX.total === abertasX.size, `esperado ${abertasX.size} · achado ${indX.total}`)
  ok("2d) e indicadoresGerenciais.concluidas fecha com o que sobrou (t2)", indX.concluidas === quadroX.size - abertasX.size)

  const famX = await agregacaoPorFamilia(agora, filtroX)
  const nossaFamiliaX = famX.find((f) => f.familiaId === familia.id)
  ok("2e) Central Operacional (agregacaoPorFamilia) — soma da família bate com o QUADRO completo do X",
    (nossaFamiliaX?.total ?? 0) === quadroX.size, `esperado ${quadroX.size} · achado ${nossaFamiliaX?.total}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) SEM FILTRO DE RESPONSÁVEL (visão gerencial completa da família)")
  // ══════════════════════════════════════════════════════════════════════════
  const filtroTodos = { familiaId: familia.id }
  const listaTodos = await visaoGerencial(filtroTodos, agora)
  const idsQuadroTodos = new Set(listaTodos.linhas.map((l) => l.taskId))
  ok("3a) Tarefas e Projetos — QUADRO completo bate com o gabarito (as 4 tarefas)",
    idsQuadroTodos.size === quadroTodos.size && [...quadroTodos].every((id) => idsQuadroTodos.has(id)),
    `esperado {${[...quadroTodos].join(",")}} · achado {${[...idsQuadroTodos].join(",")}}`)

  const indTodos = await indicadoresGerenciais(filtroTodos, agora)
  ok("3b) Central Operacional/Home ('Abertas') — bate com o gabarito de ativas (3, t2 fora)",
    indTodos.total === abertasTodos.size, `esperado ${abertasTodos.size} · achado ${indTodos.total}`)

  const famTodos = await agregacaoPorFamilia(agora, filtroTodos)
  const nossaFamiliaTodos = famTodos.find((f) => f.familiaId === familia.id)
  ok("3c) Central Operacional (agregacaoPorFamilia) — soma da família bate com o QUADRO completo (4)",
    (nossaFamiliaTodos?.total ?? 0) === quadroTodos.size, `esperado ${quadroTodos.size} · achado ${nossaFamiliaTodos?.total}`)

  // A família tem 2 processos — ambos precisam aparecer na agregação, provando
  // que a Central realmente soma por FAMÍLIA (não só pelo primeiro processo).
  ok("3d) a família agregada tem os 2 processos (A e B)",
    (nossaFamiliaTodos?.processos.length ?? 0) === 2)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) TAREFA CONCLUÍDA (t2) — some do KPI 'Abertas', NUNCA do quadro/histórico")
  // ══════════════════════════════════════════════════════════════════════════
  ok("4a) t2 aparece no quadro completo de Tarefas e Projetos (coluna Concluída do Kanban)", idsQuadroTodos.has(t2.id))
  ok("4b) t2 NÃO infla indicadoresGerenciais.total ('Abertas')", indTodos.total === abertasTodos.size)
  ok("4c) t2 é contada em indicadoresGerenciais.concluidas, não descartada", indTodos.concluidas >= 1)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
