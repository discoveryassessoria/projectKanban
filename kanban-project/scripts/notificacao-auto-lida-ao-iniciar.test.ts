// scripts/notificacao-auto-lida-ao-iniciar.test.ts
// ============================================================================
// O AVISO DE "CHEGOU TRABALHO" NÃO PRECISA DE CLIQUE QUANDO O PROGRESSO JÁ
// PROVOU QUE FOI VISTO — "se ela já iniciou a tarefa, por que a tarefa continua
// no aviso de atribuição do sino?"
//
// CONTRATO DO SINO AGRUPADO (29/09/2026): a atribuição é UM aviso CHEGOU_TRABALHO por
// (pessoa, família), com `tarefaIds`. "Agir" (iniciar, concluir, cancelar) RETIRA a
// tarefa daquele aviso — contagem e texto recompostos; se o aviso esvazia, ele deixa de
// existir — em vez de marcar o aviso inteiro como lido (as outras tarefas continuam
// novas para ela). A porta é a MESMA de antes, `marcarAtribuicaoComoLidaAoProgredir`
// (lib/operacional/notificacao-canonica.ts), chamada por `iniciarTarefa`
// (tarefa-comandos.ts), `concluirTarefaSemWorkflow`/`cancelarTarefaNucleo`
// (tarefa-ciclo.ts) e `concluirPasso`/`concluirTarefa` (src/services/task-step-sync.ts).
//
// Nenhum outro aviso é tocado por iniciar: agir na tarefa não resolve o fato que o
// PRECISA_AGIR avisa (a tarefa continua vencida).
//
//   npx tsx scripts/notificacao-auto-lida-ao-iniciar.test.ts
//
// Banco de TESTE, palco próprio.
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, iniciarTarefa } from "../lib/operacional/tarefa-comandos"
import { concluirTarefaSemWorkflow, cancelarTarefa } from "../lib/operacional/tarefa-ciclo"
import { avaliarPrecisaAgir } from "../lib/operacional/avisos-sino"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "AUTOLIDA"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const users = await prisma.usuario.findMany({ where: { email: { endsWith: "@autolida.test" } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { processoId: { in: ids } }, { destinatarioId: { in: users.map((u) => u.id) } }] },
  })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@autolida.test" } } })
}

async function main() {
  exigirBancoDeTeste("notificacao-auto-lida-ao-iniciar.test.ts")
  await limpar()
  console.log("NOTIFICAÇÃO DE ATRIBUIÇÃO SOME DO SINO QUANDO A TAREFA É INICIADA\n")

  const gestor = await prisma.usuario.create({ data: { nome: "Gestor", email: "gestor@autolida.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela", email: "daniela@autolida.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} Família`, arvoreId: arvore.id }, select: { id: true } })

  const ontem = new Date(Date.now() - 86_400_000)
  const novaTarefa = (n: number, extra: Record<string, unknown> = {}) => prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão ${n}`, processoId: processo.id, chaveIdempotencia: `${MARCA}-t-${n}`, statusTarefa: "NAO_INICIADA", ...extra },
    select: { id: true },
  })
  /** O aviso CHEGOU_TRABALHO ABERTO (não lido) da Daniela nesta família. */
  const chegou = () => prisma.notificacaoOperacional.findMany({
    where: { destinatarioId: daniela.id, processoId: processo.id, tipo: "CHEGOU_TRABALHO", agrupado: true, lidaEm: null },
    select: { id: true, tarefaIds: true, contagem: true, titulo: true, lidaEm: true },
  })
  const precisaAgir = () => prisma.notificacaoOperacional.findFirst({
    where: { destinatarioId: daniela.id, processoId: processo.id, tipo: "PRECISA_AGIR", agrupado: true, lidaEm: null },
    select: { id: true, tarefaIds: true, lidaEm: true },
  })

  // Vencida ontem: entra no PRECISA_AGIR (o controle de que iniciar não varre tudo).
  const tarefa = await novaTarefa(1, { dataPrazo: ontem })

  // ══════════════════════════════════════════════════════════════════════
  secao("1-4) atribuir gera o aviso CHEGOU_TRABALHO — não lido, agrupado por família")
  // ══════════════════════════════════════════════════════════════════════
  const rAtrib = await atribuirTarefa({ tarefaId: tarefa.id, responsavelId: daniela.id, autorId: gestor.id })
  ok("01) atribuição sucede", rAtrib.ok === true, JSON.stringify(rAtrib).slice(0, 150))

  const avisosAntes = await chegou()
  ok("02) existe UM aviso CHEGOU_TRABALHO com a tarefa", avisosAntes.length === 1 && avisosAntes[0].tarefaIds.includes(tarefa.id), JSON.stringify(avisosAntes))
  ok("03) ainda não está lido, contagem 1", avisosAntes.every((a) => a.lidaEm == null && a.contagem === 1))
  ok("03b) nenhum aviso legado por tarefa (ATRIBUICAO/agrupado=false)",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, OR: [{ agrupado: false }, { tipo: "ATRIBUICAO" }] } })) === 0)

  // Um aviso de OUTRO tipo, para provar que iniciar não varre tudo — só o que "você
  // recebeu isto" resolve ao começar. A tarefa está vencida: entra no PRECISA_AGIR.
  await avaliarPrecisaAgir({ modo: "FOTO" })
  const agirAntes = await precisaAgir()
  ok("04) PRECISA_AGIR criado à parte com a tarefa vencida (controle)", agirAntes?.tarefaIds.includes(tarefa.id) === true, JSON.stringify(agirAntes))

  // ══════════════════════════════════════════════════════════════════════
  secao("5-9) iniciar a tarefa a RETIRA do CHEGOU_TRABALHO, sem tocar PRECISA_AGIR")
  // ══════════════════════════════════════════════════════════════════════
  const rInicio = await iniciarTarefa({ tarefaId: tarefa.id, autorId: daniela.id })
  ok("05) iniciar sucede", rInicio.ok === true, JSON.stringify(rInicio).slice(0, 150))

  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id }, select: { statusTarefa: true, dataInicio: true } })
  ok("06) Tarefa sai de NAO_INICIADA", tarefaDepois.statusTarefa === "EM_ANDAMENTO", tarefaDepois.statusTarefa)
  ok("07) dataInicio gravada", tarefaDepois.dataInicio != null)

  ok("08) a tarefa saiu do CHEGOU_TRABALHO (era a única: o aviso deixa de existir)",
    (await chegou()).length === 0 && (await prisma.notificacaoOperacional.count({ where: { tipo: "CHEGOU_TRABALHO", tarefaIds: { has: tarefa.id } } })) === 0)

  const agirDepois = await precisaAgir()
  ok("09) PRECISA_AGIR CONTINUA aberto com a tarefa (iniciar não resolve o fato que ele avisa)",
    agirDepois != null && agirDepois.id === agirAntes?.id && agirDepois.tarefaIds.includes(tarefa.id) && agirDepois.lidaEm == null, JSON.stringify(agirDepois))

  // ══════════════════════════════════════════════════════════════════════
  secao("10) idempotência — iniciar de novo não falha, não desfaz o já retirado")
  // ══════════════════════════════════════════════════════════════════════
  const rInicio2 = await iniciarTarefa({ tarefaId: tarefa.id, autorId: daniela.id })
  ok("10) segunda chamada é sucesso idempotente", rInicio2.ok === true && "jaEstavaIniciada" in rInicio2 && rInicio2.jaEstavaIniciada === true, JSON.stringify(rInicio2))
  ok("10b) e não recria o aviso da tarefa", (await chegou()).length === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("11-13) transferência gera CHEGOU_TRABALHO (soma no aviso da família); iniciar retira SÓ a tarefa iniciada")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa2 = await novaTarefa(2, { responsavelId: gestor.id })
  const tarefa2b = await novaTarefa(5)
  const rTransf = await atribuirTarefa({ tarefaId: tarefa2.id, responsavelId: daniela.id, autorId: gestor.id })
  ok("11) transferência sucede", rTransf.ok === true, JSON.stringify(rTransf).slice(0, 150))
  await atribuirTarefa({ tarefaId: tarefa2b.id, responsavelId: daniela.id, autorId: gestor.id })
  const transfAntes = await chegou()
  ok("12) UM aviso não lido cobrindo as 2 tarefas recebidas ('2 tarefas atribuídas a você')",
    transfAntes.length === 1 && transfAntes[0].contagem === 2 && transfAntes[0].tarefaIds.includes(tarefa2.id) && transfAntes[0].tarefaIds.includes(tarefa2b.id) &&
    /— 2 tarefas atribuídas a você$/.test(transfAntes[0].titulo), JSON.stringify(transfAntes))
  await iniciarTarefa({ tarefaId: tarefa2.id, autorId: daniela.id })
  const transfDepois = await chegou()
  ok("13) iniciar retira SÓ a tarefa iniciada: o aviso segue aberto com a outra ('1 tarefa atribuída a você')",
    transfDepois.length === 1 && transfDepois[0].id === transfAntes[0].id && transfDepois[0].contagem === 1 &&
    transfDepois[0].tarefaIds.join() === String(tarefa2b.id) && /— 1 tarefa atribuída a você$/.test(transfDepois[0].titulo), JSON.stringify(transfDepois))

  // ══════════════════════════════════════════════════════════════════════
  secao("14-16) CONCLUIR sem nunca ter iniciado também retira a tarefa do aviso (tarefa transversal)")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa3 = await novaTarefa(3)
  await atribuirTarefa({ tarefaId: tarefa3.id, responsavelId: daniela.id, autorId: gestor.id })
  const antesConcluir = await chegou()
  ok("14) a tarefa nasce no aviso, não lido", antesConcluir.length === 1 && antesConcluir[0].tarefaIds.includes(tarefa3.id) && antesConcluir[0].contagem === 2, JSON.stringify(antesConcluir))
  const rConcluir = await concluirTarefaSemWorkflow({ tarefaId: tarefa3.id, autorId: daniela.id })
  ok("15) concluir sem workflow sucede mesmo SEM nunca ter chamado iniciarTarefa", rConcluir.ok === true, JSON.stringify(rConcluir))
  const depoisConcluir = await chegou()
  ok("16) a tarefa concluída sai do aviso — concluir também é progresso real", depoisConcluir.length === 1 && !depoisConcluir[0].tarefaIds.includes(tarefa3.id) && depoisConcluir[0].contagem === 1, JSON.stringify(depoisConcluir))

  // ══════════════════════════════════════════════════════════════════════
  secao("17-19) CANCELAR sem nunca ter iniciado também retira a tarefa do aviso")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa4 = await novaTarefa(4)
  await atribuirTarefa({ tarefaId: tarefa4.id, responsavelId: daniela.id, autorId: gestor.id })
  const antesCancelar = await chegou()
  ok("17) a tarefa nasce no aviso, não lido", antesCancelar.length === 1 && antesCancelar[0].tarefaIds.includes(tarefa4.id) && antesCancelar[0].contagem === 2, JSON.stringify(antesCancelar))
  const rCancelar = await cancelarTarefa({ tarefaId: tarefa4.id, autorId: gestor.id, motivo: "Processo arquivado" })
  ok("18) cancelar sucede mesmo SEM nunca ter iniciado (o caso que iniciarTarefa sozinho nunca cobre)", rCancelar.ok === true, JSON.stringify(rCancelar))
  const depoisCancelar = await chegou()
  ok("19) a tarefa cancelada sai do aviso; a tarefa ainda nova continua nele",
    depoisCancelar.length === 1 && !depoisCancelar[0].tarefaIds.includes(tarefa4.id) && depoisCancelar[0].tarefaIds.join() === String(tarefa2b.id), JSON.stringify(depoisCancelar))

  console.log(`\n${"─".repeat(70)}\nRESULTADO: ${passou} passaram, ${falhou} falharam\n${"─".repeat(70)}`)
  if (falhou > 0) { console.log("FALHAS:", falhas); process.exit(1) }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
