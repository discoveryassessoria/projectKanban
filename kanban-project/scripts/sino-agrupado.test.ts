// scripts/sino-agrupado.test.ts
// ============================================================================
// O SINO AGRUPADO — redesenho de 29/09/2026 (etapas 1 e 2: porta + cron).
// Rodar (banco de teste local):
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test_sino \
//   DIRECT_DATABASE_URL=$PRISMA_DATABASE_URL npx tsx scripts/sino-agrupado.test.ts
//
// PRINCÍPIO: o sino mostra o que é NOVO desde a última vez que a pessoa olhou. Nunca um
// aviso por certidão. UM aviso não lido por (pessoa, família, tipo), atualizado no lugar.
//
// Os 4 TESTES OBRIGATÓRIOS do mandato:
//   (a) 5 famílias × 10 tarefas atribuídas à mesma pessoa, todas vencendo amanhã →
//       5 CHEGOU_TRABALHO + 5 PRECISA_AGIR na manhã seguinte, nunca 50;
//   (b) atribuir 1, depois mais 1 sem ler → um aviso "2 tarefas"; ler, atribuir mais 1 →
//       novo aviso "1 tarefa";
//   (c) remover atribuição → aviso antigo some, nasce MUDOU_DE_MAO;
//   (d) concluir todas as vencidas → PRECISA_AGIR daquela família some.
// + a trava física (índice único parcial), a regra 5 nos 5 casos, "viu, saiu", fato novo
//   depois do clique, expiração/retenção e a lista do gestor.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarTarefaManual, devolverAFila, concluirTarefaSemWorkflow, cancelarTarefa } from "@/lib/operacional/tarefa-ciclo"
import { atribuirTarefa, transferirTarefa, redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import {
  marcarNotificacaoComoLida, marcarTodasComoLidas, avisosDoSino, expurgarAvisos, somarAoAviso,
} from "@/lib/operacional/notificacao-canonica"
import { rodarResumoDiario, rodarVarreduraHoraria, avaliarPrecisaAgir, precisaDeVoce, avisarGestores } from "@/lib/operacional/avisos-sino"

const MARCA = "SINOAGR"
const DIA = 86_400_000

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  const users = await prisma.usuario.findMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } }, select: { id: true } })
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ destinatarioId: { in: users.map((u) => u.id) } }, { processoId: { in: ids } }, { tarefaId: { in: ts.map((t) => t.id) } }] },
  })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefaHistorico.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } }).catch(() => null)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

const usuario = (nome: string, tipo: string) =>
  prisma.usuario.create({
    data: { nome: `${MARCA} ${nome}`, email: `${nome.toLowerCase()}@${MARCA.toLowerCase()}.test`, senha: "x", tipo },
    select: { id: true },
  })

async function familia(nome: string) {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv ${nome}` }, select: { id: true } })
  const p = await prisma.processo.create({ data: { nome: `${MARCA} ${nome}`, arvoreId: arv.id }, select: { id: true } })
  return p.id
}

let contador = 0
async function tarefa(processoId: number, autorId: number, prazo: Date, responsavelId: number | null = null) {
  const r = await criarTarefaManual({
    processoId, titulo: `${MARCA} tarefa ${++contador}`, autorId, responsavelId, dataPrazo: prazo,
    motivo: "cenário de teste do sino agrupado", confirmarDuplicidade: true,
  })
  if (!r.ok) throw new Error(`falha ao criar tarefa: ${r.mensagem}`)
  return r.tarefaId
}

const atribuir = async (tarefaId: number, para: number, autor: number) => {
  const r = await atribuirTarefa({ tarefaId, responsavelId: para, autorId: autor })
  if (!r.ok) throw new Error(`atribuir falhou: ${r.mensagem}`)
}

const avisos = (dest: number, extra: Record<string, unknown> = {}) =>
  prisma.notificacaoOperacional.findMany({ where: { destinatarioId: dest, agrupado: true, ...extra }, orderBy: { id: "asc" } })

async function main() {
  exigirBancoDeTeste("prova o sino agrupado (um aviso por pessoa/família/tipo)")
  await limpar()
  console.log("O SINO AGRUPADO\n")

  const marco = await usuario("Marco", "admin")
  const daniela = await usuario("Daniela", "assistente")
  const joao = await usuario("Joao", "assistente")
  const agora = new Date()
  const amanha = new Date(agora.getTime() + DIA)
  const ontem = new Date(agora.getTime() - DIA)

  // ══════════════════════════════════════════════════════════════════════
  secao("(a) 5 famílias × 10 tarefas, todas vencendo amanhã → 5 CHEGOU_TRABALHO + 5 PRECISA_AGIR, nunca 50")
  // ══════════════════════════════════════════════════════════════════════
  const familiasA: number[] = []
  for (let i = 1; i <= 5; i++) {
    const proc = await familia(`FamA${i}`)
    familiasA.push(proc)
    for (let k = 0; k < 10; k++) await atribuir(await tarefa(proc, marco.id, amanha), daniela.id, marco.id)
  }
  const chegou = await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO" })
  ok("5 CHEGOU_TRABALHO (um por família), nunca 50", chegou.length === 5, `${chegou.length}`)
  ok("cada um cobre 10 tarefas", chegou.every((a) => a.contagem === 10 && a.tarefaIds.length === 10))
  ok("texto: '<Família> — 10 tarefas atribuídas a você'", chegou.every((a) => /^SINOAGR FamA\d — 10 tarefas atribuídas a você$/.test(a.titulo)), chegou[0]?.titulo)
  ok("link → /operacao?processo=<id>&aba=fila (nunca /kanban)",
    chegou.every((a) => a.link === `/operacao?processo=${a.processoId}&aba=fila`), chegou[0]?.link ?? "")
  ok("nenhum aviso legado (agrupado=false) foi escrito", (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, agrupado: false } })) === 0)
  ok("nenhum aviso por tarefa (tarefaId preenchido)", chegou.every((a) => a.tarefaId == null))

  const manhaSeguinte = new Date(agora.getTime() + DIA)
  const r1 = await rodarResumoDiario({ agora: manhaSeguinte })
  ok("resumo diário: 5 grupos da Daniela", r1.precisaAgir.previa.length === 0 && r1.precisaAgir.criados >= 5, `criados=${r1.precisaAgir.criados}`)
  const agir = await avisos(daniela.id, { tipo: "PRECISA_AGIR" })
  ok("5 PRECISA_AGIR (um por família), nunca 50", agir.length === 5, `${agir.length}`)
  ok("texto: '<Família> — 10 vencem hoje' (manhã seguinte ao prazo de amanhã)",
    agir.every((a) => /^SINOAGR FamA\d — 10 vencem hoje$/.test(a.titulo)), agir[0]?.titulo)
  ok("link → /operacao?processo=<id>&aba=acompanhamento",
    agir.every((a) => a.link === `/operacao?processo=${a.processoId}&aba=acompanhamento`))
  const r1b = await rodarResumoDiario({ agora: manhaSeguinte })
  ok("rodar o resumo de novo não empilha nem renotifica", (await avisos(daniela.id, { tipo: "PRECISA_AGIR" })).length === 5 && r1b.precisaAgir.criados === 0,
    `criados=${r1b.precisaAgir.criados} semMudanca=${r1b.precisaAgir.semMudanca}`)
  ok("total de avisos = 10 (5+5), não 100", (await avisos(daniela.id, { lidaEm: null })).length === 10)

  // texto por foto: "1 vence amanhã" (a foto do dia anterior ao prazo)
  const rAntes = await avaliarPrecisaAgir({ agora, modo: "FOTO", ensaio: true })
  ok("ensaio: nada é gravado", rAntes.ensaio === true && (await avisos(daniela.id, { tipo: "PRECISA_AGIR" })).length === 5)
  ok("ensaio de hoje enxerga '10 vencem amanhã' por família",
    rAntes.previa.filter((p) => p.destinatarioId === daniela.id).every((p) => p.amanha === 10 && p.hoje === 0))

  // ══════════════════════════════════════════════════════════════════════
  secao("(b) atribuir 1 + mais 1 sem ler → '2 tarefas'; ler; atribuir mais 1 → novo aviso '1 tarefa'")
  // ══════════════════════════════════════════════════════════════════════
  const famB = await familia("FamB")
  const b1 = await tarefa(famB, marco.id, amanha), b2 = await tarefa(famB, marco.id, amanha), b3 = await tarefa(famB, marco.id, amanha)
  await atribuir(b1, joao.id, marco.id)
  let av = await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", lidaEm: null })
  ok("1 tarefa → '1 tarefa atribuída a você'", av.length === 1 && av[0].titulo === `${MARCA} FamB — 1 tarefa atribuída a você`, av[0]?.titulo)
  const idAviso = av[0].id
  const topoAntes = av[0].atualizadoEm
  await new Promise((r) => setTimeout(r, 20))
  await atribuir(b2, joao.id, marco.id)
  av = await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", lidaEm: null })
  ok("mais 1 sem ler → UM aviso '2 tarefas atribuídas a você' (soma no lugar)",
    av.length === 1 && av[0].id === idAviso && av[0].contagem === 2 && av[0].titulo === `${MARCA} FamB — 2 tarefas atribuídas a você`, av[0]?.titulo)
  ok("o aviso volta ao topo (atualizadoEm avançou)", av[0].atualizadoEm > topoAntes)
  const lida = await marcarNotificacaoComoLida(prisma, { notificacaoId: idAviso, usuarioId: joao.id })
  ok("clicar marca como lido", lida.ok === true)
  ok("lido sai do contador", (await avisosDoSino(prisma, joao.id)).total === 0)
  await atribuir(b3, joao.id, marco.id)
  av = await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", lidaEm: null })
  ok("depois do clique, mais 1 → NOVO aviso '1 tarefa atribuída a você'",
    av.length === 1 && av[0].id !== idAviso && av[0].titulo === `${MARCA} FamB — 1 tarefa atribuída a você`, av[0]?.titulo)
  ok("o lido continua em 'anteriores' (2 avisos no total, 1 lido)", (await avisos(joao.id, { tipo: "CHEGOU_TRABALHO" })).length === 2)
  ok("só o não lido conta no sino", (await avisosDoSino(prisma, joao.id)).total === 1)
  const outra = await tarefa(famB, marco.id, amanha)
  await atribuir(outra, joao.id, marco.id)
  ok("quem atribui a si mesmo não é avisado", (await (async () => {
    const t = await tarefa(famB, marco.id, amanha); await atribuir(t, marco.id, marco.id)
    return avisos(marco.id, { tipo: "CHEGOU_TRABALHO" })
  })()).length === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("(c) remover atribuição → aviso antigo some, nasce MUDOU_DE_MAO (e reatribuir: 5 casos da regra 5)")
  // ══════════════════════════════════════════════════════════════════════
  const famC = await familia("FamC")
  const c = [] as number[]
  for (let i = 0; i < 6; i++) c.push(await tarefa(famC, marco.id, ontem))
  for (const t of c) await atribuir(t, daniela.id, marco.id)
  await rodarVarreduraHoraria({ agora })
  await rodarResumoDiario({ agora })
  let chC = (await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO", processoId: famC, lidaEm: null }))[0]
  let agC = (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famC, lidaEm: null }))[0]
  ok("antes: CHEGOU (6) e PRECISA_AGIR (6 vencidas) da família", chC?.contagem === 6 && agC?.titulo === `${MARCA} FamC — 6 vencidas`, `${chC?.titulo} | ${agC?.titulo}`)

  // caso 1: REMOVIDA (devolvida à fila)
  await devolverAFila({ tarefaId: c[0], autorId: marco.id })
  chC = (await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO", processoId: famC, lidaEm: null }))[0]
  agC = (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famC, lidaEm: null }))[0]
  ok("caso 1 (removida): sai do CHEGOU_TRABALHO na hora (5)", chC?.contagem === 5 && !chC.tarefaIds.includes(c[0]), chC?.titulo)
  ok("caso 1 (removida): sai do PRECISA_AGIR na hora (5 vencidas)", agC?.titulo === `${MARCA} FamC — 5 vencidas` && !agC.tarefaIds.includes(c[0]), agC?.titulo)
  let mudou = (await avisos(daniela.id, { tipo: "MUDOU_DE_MAO", processoId: famC }))[0]
  ok("caso 1: nasce MUDOU_DE_MAO '1 tarefa saiu da sua fila'", mudou?.titulo === `${MARCA} FamC — 1 tarefa saiu da sua fila`, mudou?.titulo)
  ok("MUDOU_DE_MAO → /operacao?processo=<id> (sem aba)", mudou?.link === `/operacao?processo=${famC}`, mudou?.link ?? "")

  // caso 2: REATRIBUÍDA a outra pessoa
  const rT = await transferirTarefa({ tarefaId: c[1], responsavelId: joao.id, autorId: marco.id, motivo: "teste" })
  ok("transferência ok", rT.ok === true)
  chC = (await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO", processoId: famC, lidaEm: null }))[0]
  agC = (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famC, lidaEm: null }))[0]
  ok("caso 2 (reatribuída): some do aviso da anterior (4)", chC?.contagem === 4 && agC?.titulo === `${MARCA} FamC — 4 vencidas`, `${chC?.titulo} | ${agC?.titulo}`)
  mudou = (await avisos(daniela.id, { tipo: "MUDOU_DE_MAO", processoId: famC }))[0]
  ok("caso 2: o MUDOU_DE_MAO soma: '2 tarefas saíram da sua fila'", mudou?.titulo === `${MARCA} FamC — 2 tarefas saíram da sua fila`, mudou?.titulo)
  const chJoao = (await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", processoId: famC, lidaEm: null }))[0]
  ok("caso 2: quem recebeu ganha o CHEGOU_TRABALHO", chJoao?.contagem === 1 && chJoao.tarefaIds.includes(c[1]))

  // caso 3: CONCLUÍDA
  ok("concluir c[2]", (await concluirTarefaSemWorkflow({ tarefaId: c[2], autorId: daniela.id })).ok)
  agC = (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famC, lidaEm: null }))[0]
  ok("caso 3 (concluída): sai do PRECISA_AGIR na hora (3 vencidas)", agC?.titulo === `${MARCA} FamC — 3 vencidas`, agC?.titulo)
  // caso 4: CANCELADA
  ok("cancelar c[3]", (await cancelarTarefa({ tarefaId: c[3], autorId: marco.id, motivo: "teste sino" } as never)).ok)
  agC = (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famC, lidaEm: null }))[0]
  ok("caso 4 (cancelada): sai do PRECISA_AGIR na hora (2 vencidas)", agC?.titulo === `${MARCA} FamC — 2 vencidas`, agC?.titulo)
  // caso 5: SUPERSEDIDA — por um caminho que nenhuma porta de aviso conhece (rede de segurança na leitura)
  await prisma.tarefa.update({ where: { id: c[4] }, data: { statusTarefa: "SUPERSEDIDA" } })
  const sino5 = await avisosDoSino(prisma, daniela.id)
  const agC5 = sino5.naoLidos.find((a) => a.tipo === "PRECISA_AGIR" && a.familiaId === famC)
  ok("caso 5 (supersedida, por caminho sem porta): a leitura do sino já não a mostra (1 vencida)", agC5?.titulo === `${MARCA} FamC — 1 vencida`, agC5?.titulo)
  // reatribuição feita por fora das portas (UPDATE direto): a leitura também protege
  await prisma.tarefa.update({ where: { id: c[5] }, data: { responsavelId: joao.id } })
  const sino6 = await avisosDoSino(prisma, daniela.id)
  ok("posse trocada por fora das portas: o aviso da Daniela some na leitura",
    !sino6.naoLidos.some((a) => a.familiaId === famC && (a.tipo === "PRECISA_AGIR" || a.tipo === "CHEGOU_TRABALHO")))
  ok("nenhum aviso de tarefa que não é dela em nenhuma linha", (await avisos(daniela.id, { tipo: { in: ["CHEGOU_TRABALHO", "PRECISA_AGIR"] }, processoId: famC }))
    .every((a) => a.tarefaIds.length > 0))

  // ══════════════════════════════════════════════════════════════════════
  secao("(d) concluir todas as vencidas → PRECISA_AGIR da família some")
  // ══════════════════════════════════════════════════════════════════════
  const famD = await familia("FamD")
  const d = [] as number[]
  for (let i = 0; i < 3; i++) d.push(await tarefa(famD, marco.id, ontem, daniela.id))
  await rodarResumoDiario({ agora })
  ok("antes: PRECISA_AGIR '3 vencidas'", (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famD, lidaEm: null }))[0]?.titulo === `${MARCA} FamD — 3 vencidas`)
  ok("tarefa criada já atribuída também gera CHEGOU_TRABALHO", (await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO", processoId: famD, lidaEm: null }))[0]?.contagem === 3)
  for (const t of d) await concluirTarefaSemWorkflow({ tarefaId: t, autorId: daniela.id })
  ok("depois de concluir todas: PRECISA_AGIR da família some", (await avisos(daniela.id, { tipo: "PRECISA_AGIR", processoId: famD })).length === 0)
  ok("e o CHEGOU_TRABALHO também (agir nela tira do 'chegou')", (await avisos(daniela.id, { tipo: "CHEGOU_TRABALHO", processoId: famD })).length === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("Trava física — índice único parcial (um aberto por pessoa/família/tipo)")
  // ══════════════════════════════════════════════════════════════════════
  const famE = await familia("FamE")
  await somarAoAviso(prisma, { tipo: "CHEGOU_TRABALHO", destinatarioId: joao.id, processoId: famE, familiaNome: "X", tarefaIds: [999001], link: "/operacao" })
  let barrou = false
  try {
    await prisma.notificacaoOperacional.create({
      data: { tipo: "CHEGOU_TRABALHO", destinatarioId: joao.id, processoId: famE, titulo: "duplicado", agrupado: true, chaveIdempotencia: `${MARCA}-dup-${Date.now()}` },
    })
  } catch (e) { barrou = (e as { code?: string })?.code === "P2002" }
  ok("o banco recusa um segundo aviso NÃO LIDO da mesma (pessoa, família, tipo)", barrou)
  const conc = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    somarAoAviso(prisma, { tipo: "CHEGOU_TRABALHO", destinatarioId: joao.id, processoId: famE, familiaNome: "X", tarefaIds: [999100 + i], link: "/operacao" })))
  ok("8 somas concorrentes → um aviso só, sem erro", conc.length === 8 && (await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", processoId: famE, lidaEm: null })).length === 1)
  ok("… e nenhuma se perdeu (9 ids)", (await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", processoId: famE, lidaEm: null }))[0].contagem === 9)
  await prisma.notificacaoOperacional.deleteMany({ where: { destinatarioId: joao.id, processoId: famE } })

  // ══════════════════════════════════════════════════════════════════════
  secao("'Viu, saiu' e fato NOVO depois do clique (PRECISA_AGIR)")
  // ══════════════════════════════════════════════════════════════════════
  const famF = await familia("FamF")
  const f1 = await tarefa(famF, marco.id, ontem, joao.id)
  await rodarResumoDiario({ agora })
  const aF = (await avisos(joao.id, { tipo: "PRECISA_AGIR", processoId: famF, lidaEm: null }))[0]
  ok("foto: '1 vencida'", aF?.titulo === `${MARCA} FamF — 1 vencida`, aF?.titulo)
  await marcarNotificacaoComoLida(prisma, { notificacaoId: aF.id, usuarioId: joao.id })
  await rodarVarreduraHoraria({ agora })
  ok("depois do clique, varredura horária sem fato novo NÃO reabre", (await avisos(joao.id, { tipo: "PRECISA_AGIR", processoId: famF, lidaEm: null })).length === 0)
  const f2 = await tarefa(famF, marco.id, ontem, joao.id)
  await rodarVarreduraHoraria({ agora })
  const aF2 = (await avisos(joao.id, { tipo: "PRECISA_AGIR", processoId: famF, lidaEm: null }))[0]
  ok("nova vencida depois do clique → aviso que diz o que é novo: '1 nova vencida'", aF2?.titulo === `${MARCA} FamF — 1 nova vencida`, aF2?.titulo)
  await marcarNotificacaoComoLida(prisma, { notificacaoId: aF2.id, usuarioId: joao.id })
  await rodarVarreduraHoraria({ agora })
  ok("clicou de novo: sem fato novo, nada reabre", (await avisos(joao.id, { tipo: "PRECISA_AGIR", processoId: famF, lidaEm: null })).length === 0)
  const amanhaManha = new Date(agora.getTime() + DIA)
  await rodarResumoDiario({ agora: amanhaManha })
  const aF3 = (await avisos(joao.id, { tipo: "PRECISA_AGIR", processoId: famF, lidaEm: null }))[0]
  ok("o resumo das 07:00 recompõe a FOTO do dia mesmo que ela tenha clicado ontem",
    aF3?.titulo === `${MARCA} FamF — 2 vencidas`, aF3?.titulo)
  void f1; void f2

  secao("Marcar todas como lidas")
  const antes = (await avisosDoSino(prisma, daniela.id)).total
  const mt = await marcarTodasComoLidas(prisma, daniela.id)
  ok("marca todas as não lidas da pessoa", mt.quantidade === antes && (await avisosDoSino(prisma, daniela.id)).total === 0, `${mt.quantidade}/${antes}`)
  ok("não toca nos avisos dos outros", (await avisosDoSino(prisma, joao.id)).total > 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("Expiração (7 dias) e retenção (30 dias)")
  // ══════════════════════════════════════════════════════════════════════
  const famG = await familia("FamG")
  const naoLido = await somarAoAviso(prisma, { tipo: "MUDOU_DE_MAO", destinatarioId: joao.id, processoId: famG, familiaNome: "G", tarefaIds: [999200], link: "/operacao" })
  await prisma.notificacaoOperacional.update({ where: { id: naoLido.id }, data: { atualizadoEm: new Date(agora.getTime() - 8 * DIA) } })
  ok("não lido com 8 dias já não aparece no sino", !(await avisosDoSino(prisma, joao.id)).naoLidos.some((a) => a.id === naoLido.id))
  const velhoLido = await prisma.notificacaoOperacional.create({
    data: { tipo: "MUDOU_DE_MAO", destinatarioId: joao.id, processoId: famG, titulo: "velho", agrupado: true, tarefaIds: [1], contagem: 1,
      lidaEm: new Date(agora.getTime() - 31 * DIA), chaveIdempotencia: `${MARCA}-velho-${Date.now()}` },
  })
  const recente = await prisma.notificacaoOperacional.create({
    data: { tipo: "MUDOU_DE_MAO", destinatarioId: joao.id, processoId: famG, titulo: "recente", agrupado: true, tarefaIds: [2], contagem: 1,
      lidaEm: new Date(agora.getTime() - 5 * DIA), chaveIdempotencia: `${MARCA}-rec-${Date.now()}` },
  })
  const ant = await avisosDoSino(prisma, joao.id, { comAnteriores: true })
  ok("'Ver anteriores' mostra o lido de 5 dias e não o de 31", ant.anteriores.some((a) => a.id === recente.id) && !ant.anteriores.some((a) => a.id === velhoLido.id))
  const ex = await expurgarAvisos(prisma, agora)
  ok("expurgo apaga o não lido expirado e o lido com mais de 30 dias", ex.expirados >= 1 && ex.apagadosLidos >= 1, JSON.stringify(ex))
  ok("… e preserva o lido de 5 dias", (await prisma.notificacaoOperacional.count({ where: { id: recente.id } })) === 1)

  // ══════════════════════════════════════════════════════════════════════
  secao("Gestor — 'Precisa de você' (função única): SEM_RESPONSAVEL há mais de 1 dia, por família")
  // ══════════════════════════════════════════════════════════════════════
  const famH = await familia("FamH")
  const h1 = await tarefa(famH, marco.id, amanha), h2 = await tarefa(famH, marco.id, amanha)
  const recente1 = await tarefa(famH, marco.id, amanha)
  await prisma.tarefa.updateMany({ where: { id: { in: [h1, h2] } }, data: { createdAt: new Date(agora.getTime() - 2 * DIA) } })
  const lista = (await precisaDeVoce({ agora })).filter((i) => i.processoId === famH)
  ok("precisaDeVoce lista SEM_RESPONSAVEL da família com as 2 antigas (a de hoje não)",
    lista.length === 1 && lista[0].tipo === "SEM_RESPONSAVEL" && lista[0].tarefaIds.length === 2 && !lista[0].tarefaIds.includes(recente1))
  await avisarGestores({ agora })
  const sr = (await avisos(marco.id, { tipo: "SEM_RESPONSAVEL", processoId: famH, lidaEm: null }))[0]
  ok("aviso do gestor: '<Família> — 2 tarefas sem responsável há mais de 1 dia'", sr?.titulo === `${MARCA} FamH — 2 tarefas sem responsável há mais de 1 dia`, sr?.titulo)
  ok("link do gestor → Torre, aba Tarefas, visão Sem responsável (Distribuição foi absorvida pela Torre)", sr?.link === "/torre?aba=tarefas&visao=semdono", sr?.link ?? "")
  ok("operador NÃO recebe aviso de gestor", (await avisos(daniela.id, { tipo: "SEM_RESPONSAVEL" })).length === 0)
  await atribuir(h1, daniela.id, marco.id)
  const sr2 = (await avisos(marco.id, { tipo: "SEM_RESPONSAVEL", processoId: famH, lidaEm: null }))[0]
  ok("atribuir uma → sai do SEM_RESPONSAVEL na hora (1)", sr2?.titulo === `${MARCA} FamH — 1 tarefa sem responsável há mais de 1 dia`, sr2?.titulo)
  await atribuir(h2, daniela.id, marco.id)
  ok("atribuir todas → o SEM_RESPONSAVEL some", (await avisos(marco.id, { tipo: "SEM_RESPONSAVEL", processoId: famH })).length === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("Redistribuição em lote → UM aviso por família (nunca um por tarefa)")
  // ══════════════════════════════════════════════════════════════════════
  const famI = await familia("FamI")
  const lote = [] as number[]
  for (let i = 0; i < 12; i++) lote.push(await tarefa(famI, marco.id, amanha))
  const red = await redistribuirTarefas({ tarefaIds: lote, novoResponsavelId: joao.id, autorId: marco.id })
  ok("12 redistribuídas", red.sucesso === 12)
  const chI = await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", processoId: famI })
  ok("um aviso '12 tarefas atribuídas a você'", chI.length === 1 && chI[0].contagem === 12 && chI[0].titulo === `${MARCA} FamI — 12 tarefas atribuídas a você`, chI[0]?.titulo)
  const red2 = await redistribuirTarefas({ tarefaIds: lote.slice(0, 4), novoResponsavelId: daniela.id, autorId: marco.id })
  ok("passar 4 adiante", red2.sucesso === 4)
  const chI2 = (await avisos(joao.id, { tipo: "CHEGOU_TRABALHO", processoId: famI, lidaEm: null }))[0]
  ok("da anterior saem 4 (8) e nasce o MUDOU_DE_MAO '4 tarefas saíram da sua fila'",
    chI2?.contagem === 8 && (await avisos(joao.id, { tipo: "MUDOU_DE_MAO", processoId: famI }))[0]?.titulo === `${MARCA} FamI — 4 tarefas saíram da sua fila`)

  await limpar()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => null); process.exit(1) })
