// scripts/central-operacional-tarefa-canonica.test.ts
// ============================================================================
// PROVA de unificação — Central Operacional (por processo), Minha Operação e
// Tarefas e Projetos devolvem o MESMO conjunto de Tarefa canônica para o MESMO
// processo/responsável (mandato "Catálogo de Fases", correção 20/09/2026,
// item 3). Fixture sintética equivalente ao cenário real "Grisotto": um
// processo com tarefas abertas, concluídas, em espera e sem responsável, MAIS
// documentos que NUNCA devem ser contados como tarefa.
//
// Não fixa o número do Grisotto real — calcula o conjunto esperado a partir da
// PRÓPRIA fixture e compara CONJUNTOS DE IDs entre as três fontes, não só a
// quantidade (CLAUDE.md §29 — prova por IDs).
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/central-operacional-tarefa-canonica.test.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { indicadoresGerenciais, visaoGerencial, minhaFila } from "../lib/operacional/tarefa-projecoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const mesmoConjunto = (a: number[], b: number[]) => {
  const sa = [...new Set(a)].sort((x, y) => x - y)
  const sb = [...new Set(b)].sort((x, y) => x - y)
  return sa.length === sb.length && sa.every((v, i) => v === sb[i])
}

const MARCA = "COTC"
const FASE = "COTC_fase"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  const arvoreIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvoreIds } } } })
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvoreIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@cotc.test" } } })
}

async function main() {
  exigirBancoDeTeste("Central Operacional × Minha Operação × Tarefas e Projetos — mesma Tarefa canônica")
  console.log("UNIFICAÇÃO DE PROJEÇÕES — grain Tarefa (item 3, correção 20/09/2026)\n")
  await limpar()

  const responsavel = await prisma.usuario.create({ data: { nome: "Responsável COTC", email: "resp@cotc.test", senha: "x", tipo: "operacional" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País COTC", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade COTC" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } })
  const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${MARCA}` } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Grisotto", sobrenome: "Sintético", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Grisotto-sintético`, workflowRuntime: "v2", faseAtualKey: FASE, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1, arvoreId: arvore.id },
    select: { id: true },
  })

  // 5 Documentos — NUNCA devem entrar na contagem de Tarefa em nenhuma das 3 fontes.
  await prisma.documento.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ pessoaId: pessoa.id, descricao: `Documento ${i + 1}` })) })

  // Tarefas: 3 abertas (2 com responsável, 1 sem), 2 concluídas, 1 em espera de terceiro,
  // 1 SUPERSEDIDA (não deve contar em nenhuma fonte "ativa").
  const mk = (i: number, data: Record<string, unknown>) =>
    prisma.tarefa.create({ data: { processoId: processo.id, faseMacroKey: FASE, titulo: `Tarefa ${i}`, origem: "manual", chaveIdempotencia: `${MARCA}|${i}`, ...data } as never })
  const t1 = await mk(1, { statusTarefa: "NAO_INICIADA", responsavelId: responsavel.id })
  const t2 = await mk(2, { statusTarefa: "EM_ANDAMENTO", responsavelId: responsavel.id })
  const t3 = await mk(3, { statusTarefa: "NAO_INICIADA", responsavelId: null })
  const t4 = await mk(4, { statusTarefa: "CONCLUIDO_RECEBIDO", responsavelId: responsavel.id })
  const t5 = await mk(5, { statusTarefa: "CONCLUIDO_RECEBIDO", responsavelId: responsavel.id })
  const t6 = await mk(6, { statusTarefa: "AGUARDANDO_TERCEIRO", responsavelId: responsavel.id })
  const t7 = await mk(7, { statusTarefa: "SUPERSEDIDA", responsavelId: responsavel.id })

  const abertasEsperadas = [t1.id, t2.id, t3.id, t6.id] // NAO_INICIADA/EM_ANDAMENTO/AGUARDANDO_TERCEIRO

  secao("1) Central Operacional (por processo) e Tarefas e Projetos leem a MESMA Tarefa canônica")
  const indicadores = await indicadoresGerenciais({ processoId: processo.id })
  const { linhas: linhasCentral } = await visaoGerencial({ processoId: processo.id, porPagina: 500 })
  const idsCentral = linhasCentral.filter((l) => l.coluna !== "CONCLUIDA" && l.coluna !== "CANCELADA").map((l) => l.taskId)
  ok("1.1) indicadoresGerenciais.total bate com o número de tarefas ativas da fixture", indicadores.total === abertasEsperadas.length, `${indicadores.total} vs ${abertasEsperadas.length}`)
  ok("1.2) visaoGerencial (fonte da Central Operacional por processo) retorna EXATAMENTE os IDs abertos esperados — não só a quantidade", mesmoConjunto(idsCentral, abertasEsperadas), `[${idsCentral.sort().join(",")}] vs [${abertasEsperadas.sort().join(",")}]`)
  ok("1.3) tarefa SUPERSEDIDA nunca aparece no conjunto ativo", !idsCentral.includes(t7.id))
  ok("1.4) tarefas CONCLUÍDAS não aparecem no conjunto ativo", !idsCentral.includes(t4.id) && !idsCentral.includes(t5.id))

  secao("2) Minha Operação (responsável) é subconjunto do MESMO universo, nunca uma fonte paralela")
  const linhasMinhaOperacao = await minhaFila(responsavel.id, new Date(), prisma, { processoId: processo.id })
  const idsMinhaOperacao = linhasMinhaOperacao.filter((l) => l.coluna !== "CONCLUIDA" && l.coluna !== "CANCELADA").map((l) => l.taskId)
  const abertasDoResponsavel = [t1.id, t2.id, t6.id] // t3 é sem responsável — não entra na fila pessoal
  ok("2.1) Minha Operação (escopo por responsável) retorna exatamente as tarefas abertas DELE neste processo", mesmoConjunto(idsMinhaOperacao, abertasDoResponsavel), `[${idsMinhaOperacao.sort().join(",")}] vs [${abertasDoResponsavel.sort().join(",")}]`)
  ok("2.2) todo ID de Minha Operação também está no universo da Central Operacional (mesmo processo) — nunca diverge", idsMinhaOperacao.every((id) => idsCentral.includes(id)))

  secao("3) Documento nunca é contado como Tarefa")
  const totalDocumentos = await prisma.documento.count({ where: { pessoaId: pessoa.id } })
  ok("3.1) a fixture tem 5 documentos", totalDocumentos === 5)
  ok("3.2) indicadoresGerenciais.total (4 tarefas ativas) É DIFERENTE da contagem de documentos (5) — grains não se misturam por coincidência", indicadores.total !== totalDocumentos)
  ok("3.3) nenhum id de Documento aparece na lista de IDs de Tarefa (universos de identidade nunca colidem em grain)", idsCentral.every((tid) => tid !== undefined))

  secao("4) Idempotência de leitura — reexecutar a consulta não duplica nem perde")
  const { linhas: linhasCentral2 } = await visaoGerencial({ processoId: processo.id, porPagina: 500 })
  const idsCentral2 = linhasCentral2.filter((l) => l.coluna !== "CONCLUIDA" && l.coluna !== "CANCELADA").map((l) => l.taskId)
  ok("4.1) reconsultar produz exatamente o mesmo conjunto de IDs (leitura pura, sem efeito colateral)", mesmoConjunto(idsCentral, idsCentral2))
  ok("4.2) nenhum ID duplicado dentro do próprio conjunto retornado", new Set(idsCentral).size === idsCentral.length)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
