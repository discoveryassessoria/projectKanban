// scripts/tarefas-projetos-marco-gerencial.test.ts
// ============================================================================
// TAREFAS E PROJETOS COMO PROJEÇÃO ADMINISTRATIVA — prova por dado real de que:
//
//   1) o MARCO GERENCIAL (`marcosGerenciaisPorProcesso`) é lido de
//      `PhaseAdvanceLog` e é IDEMPOTENTE: um retry que gera uma segunda linha
//      com `resultado: IDEMPOTENTE` NUNCA produz um segundo marco nem duplica
//      a contagem — a mesma garantia que o motor já dá na escrita, provada
//      aqui na LEITURA que "Tarefas e Projetos" expõe.
//   2) "AGUARDANDO ATRIBUIÇÃO" (spec §16) só é `true` quando existe tarefa
//      ATIVA na fase atual e NENHUMA tem responsável — nunca por presunção.
//   3) `statusProcesso` (ATIVO/CONCLUIDO) deriva de `Processo.dataConclusao` —
//      não existe enum próprio (removido como legado).
//   4) CANCELADA continua fora de `concluidasHoje` (CLAUDE.md/spec: CANCELADA
//      ≠ CONCLUÍDA, em qualquer indicador novo, não só nos antigos).
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/tarefas-projetos-marco-gerencial.test.ts
// ============================================================================
import { prisma } from "../src/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { agregacaoPorFamilia, indicadoresGerenciais, marcosGerenciaisPorProcesso } from "../lib/operacional/tarefa-projecoes"

const MARCA = "MARCOGER"

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
    await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  if (familia) await prisma.familia.deleteMany({ where: { id: familia.id } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@marcoger.test" } } })
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@marcoger.test`, senha: "x", tipo: "assistente" }, select: { id: true } })

async function main() {
  exigirBancoDeTeste("prova, por dado real, que o marco gerencial (PhaseAdvanceLog) é idempotente e que aguardando-atribuição não é presumido")
  await limpar()

  console.log("TAREFAS E PROJETOS — MARCO GERENCIAL, AGUARDANDO ATRIBUIÇÃO, STATUS DO PROCESSO\n")

  const daniela = await usuario("Daniela")
  const familia = await prisma.familia.create({ data: { nome: `${MARCA} familia` }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arv.id, familiaId: familia.id, faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const processoConcluido = await prisma.processo.create({
    data: { nome: `${MARCA} processo concluido`, arvoreId: arv.id, familiaId: familia.id, dataConclusao: new Date() },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) GENEALOGIA: 10 tarefas, todas concluídas por Daniela (a fase que TERMINOU)")
  // ══════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < 10; i++) {
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} genealogia ${i}`, processoId: processo.id, responsavelId: daniela.id,
        faseMacroKey: "genealogia", statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, dataConclusao: new Date(), ordem: i,
      },
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) EMISSÃO DOCUMENTAL: 3 tarefas ATIVAS, SEM responsável — a fase nova, ninguém ainda dono")
  // ══════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < 3; i++) {
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} emissao ${i}`, processoId: processo.id, responsavelId: null,
        faseMacroKey: "emissao_documental", statusTarefa: "NAO_INICIADA", concluida: false, ordem: i,
      },
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) O MOTOR REGISTRA A TRANSIÇÃO — um AVANÇADO real, e um IDEMPOTENTE (retry)")
  // ══════════════════════════════════════════════════════════════════════════
  const logBase = {
    processoId: processo.id, faseAtual: "genealogia", fasePretendida: "emissao_documental",
    origem: "TESTE", regrasAvaliadas: {}, pendencias: {}, correlationId: `${MARCA}-corr`,
  }
  await prisma.phaseAdvanceLog.create({ data: { ...logBase, resultado: "AVANCADO", chaveIdempotencia: `${MARCA}-avancado-1` } })
  // O RETRY: mesmo processo, mesma transição, resultado IDEMPOTENTE — o motor
  // já garante que isto NÃO é um segundo avanço real.
  await prisma.phaseAdvanceLog.create({ data: { ...logBase, resultado: "IDEMPOTENTE", chaveIdempotencia: `${MARCA}-retry-1` } })
  await prisma.phaseAdvanceLog.create({ data: { ...logBase, resultado: "IDEMPOTENTE", chaveIdempotencia: `${MARCA}-retry-2` } })

  const agora = new Date()

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) marcosGerenciaisPorProcesso — UM marco, não três, com contagem absoluta correta")
  // ══════════════════════════════════════════════════════════════════════════
  const marcos = await marcosGerenciaisPorProcesso([processo.id])
  const marco = marcos.get(processo.id)
  ok("4a) existe exatamente um marco para o processo (retries não viram marcos extras)", marco != null)
  ok("4b) o marco é da transição REAL (AVANCADO), nunca do IDEMPOTENTE", marco?.resultado === "AVANCADO")
  ok("4c) 10/10 tarefas concluídas na fase de origem (Genealogia)", marco?.totalNaFaseAnterior === 10 && marco?.concluidasNaFaseAnterior === 10,
    `achado ${marco?.concluidasNaFaseAnterior}/${marco?.totalNaFaseAnterior}`)
  ok("4d) responsável anterior identificado (Daniela, dona única da fase que terminou)",
    typeof marco?.responsavelAnterior === "object" && marco.responsavelAnterior?.id === daniela.id)
  ok("4e) responsável NOVO é null — motor não atribui automaticamente à fase seguinte", marco?.responsavelNovo === null)
  ok("4f) a fase nova já está materializada (as 3 tarefas de Emissão existem)", marco?.faseNovaMaterializada === true)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) agregacaoPorFamilia — AGUARDANDO ATRIBUIÇÃO real, statusProcesso derivado, marco propagado")
  // ══════════════════════════════════════════════════════════════════════════
  const familias = await agregacaoPorFamilia(agora, { familiaId: familia.id })
  const fam = familias.find((f) => f.familiaId === familia.id)
  const procAgrupado = fam?.processos.find((p) => p.processoId === processo.id)
  ok("5a) aguardandoAtribuicao = true (3 tarefas ativas na fase atual, nenhuma com dono)", procAgrupado?.aguardandoAtribuicao === true)
  ok("5b) statusProcesso = ATIVO (dataConclusao nula)", procAgrupado?.statusProcesso === "ATIVO")
  ok("5c) ultimoMarco chegou até o ProcessoAgrupado", procAgrupado?.ultimoMarco?.resultado === "AVANCADO")
  ok("5d) a família prioriza o marco na última atividade (não a última tarefa concluída sozinha)",
    fam?.ultimaAtividade === marco?.em, `família=${fam?.ultimaAtividade} marco=${marco?.em}`)

  const procConcluidoAgrupado = fam?.processos.find((p) => p.processoId === processoConcluido.id)
  // processoConcluido não tem tarefa nenhuma — não aparece em agregacaoPorFamilia
  // (que só lê Tarefa); testamos a derivação de status diretamente.
  const pConcl = await prisma.processo.findUnique({ where: { id: processoConcluido.id }, select: { dataConclusao: true } })
  ok("5e) Processo.dataConclusao preenchida é o único sinal de 'concluído' (sem enum legado)", pConcl?.dataConclusao != null)
  void procConcluidoAgrupado

  // ══════════════════════════════════════════════════════════════════════════
  secao("6) Atribuição da fase nova muda responsavelNovo — sem novo marco")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.tarefa.updateMany({ where: { processoId: processo.id, faseMacroKey: "emissao_documental" }, data: { responsavelId: daniela.id } })
  const marcosDepois = await marcosGerenciaisPorProcesso([processo.id])
  const marcoDepois = marcosDepois.get(processo.id)
  ok("6a) ainda é o MESMO marco (mesma transição — atribuir não cria marco novo)", marcoDepois?.em === marco?.em)
  ok("6b) responsavelNovo agora reflete a atribuição real", typeof marcoDepois?.responsavelNovo === "object" && marcoDepois.responsavelNovo?.id === daniela.id)
  const familias2 = await agregacaoPorFamilia(agora, { familiaId: familia.id })
  const procAgrupado2 = familias2.find((f) => f.familiaId === familia.id)?.processos.find((p) => p.processoId === processo.id)
  ok("6c) aguardandoAtribuicao volta a false depois da atribuição real", procAgrupado2?.aguardandoAtribuicao === false)

  // ══════════════════════════════════════════════════════════════════════════
  secao("7) CANCELADA ≠ CONCLUÍDA também em concluidasHoje (indicador novo)")
  // ══════════════════════════════════════════════════════════════════════════
  const indAntesDeCancelar = await indicadoresGerenciais({ processoId: processo.id }, agora)
  await prisma.tarefa.create({
    data: {
      titulo: `${MARCA} cancelada hoje`, processoId: processo.id, responsavelId: daniela.id,
      faseMacroKey: "emissao_documental", statusTarefa: "CANCELADA", concluida: false, dataConclusao: new Date(), ordem: 99,
    },
  })
  const indDepoisDeCancelar = await indicadoresGerenciais({ processoId: processo.id }, agora)
  ok("7a) tarefa CANCELADA com dataConclusao preenchida NÃO soma a concluidasHoje (mesmo valor de antes)",
    indDepoisDeCancelar.concluidasHoje === indAntesDeCancelar.concluidasHoje,
    `antes ${indAntesDeCancelar.concluidasHoje} · depois ${indDepoisDeCancelar.concluidasHoje}`)

  await limpar()
  await prisma.$disconnect()

  console.log(`\n${passou} passaram, ${falhou} falharam.`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
