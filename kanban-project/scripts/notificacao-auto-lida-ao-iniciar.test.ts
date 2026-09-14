// scripts/notificacao-auto-lida-ao-iniciar.test.ts
// ============================================================================
// A NOTIFICAÇÃO DE ATRIBUIÇÃO NÃO PRECISA DE CLIQUE QUANDO O PROGRESSO JÁ
// PROVOU QUE FOI VISTA — "se ela já iniciou a tarefa, por que a notificação
// continua no sino?"
//
// AMPLIADO (15/09/2026, mesma correção): "agir" não é só iniciar. Concluir e
// cancelar também são progresso/resolução real, e chamam a MESMA porta —
// `marcarAtribuicaoComoLidaAoProgredir` (lib/operacional/notificacao-canonica.ts)
// — a partir de `iniciarTarefa` (tarefa-comandos.ts), `concluirTarefaSemWorkflow`/
// `cancelarTarefaNucleo` (tarefa-ciclo.ts) e `concluirPasso`/`concluirTarefa`
// (src/services/task-step-sync.ts, o caminho mais comum — workflow concluindo
// sem que ninguém tenha clicado "Iniciar" à parte). Achado real: tarefas
// atribuídas ANTES desta correção existir ficaram com a notificação presa no
// sino mesmo já iniciadas/concluídas/canceladas — a correção só vale daqui
// pra frente; dado antigo precisou de reconciliação à parte (script
// `reconciliar-notificacoes-atribuicao-presas.ts`).
//
// `iniciarTarefa` (lib/operacional/tarefa-comandos.ts) marca como lida a
// notificação de ATRIBUICAO/TRANSFERENCIA daquela Tarefa para aquele
// destinatário, na MESMA transação da transição NAO_INICIADA → EM_ANDAMENTO.
// Nenhuma outra notificação (PRAZO/ATRASO/RETORNO_TERCEIRO/EM_RISCO/
// FASE_CONCLUIDA) é tocada: agir na tarefa não resolve o fato que elas avisam.
//
//   npx tsx scripts/notificacao-auto-lida-ao-iniciar.test.ts
//
// Banco de TESTE, palco próprio.
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, iniciarTarefa } from "../lib/operacional/tarefa-comandos"
import { concluirTarefaSemWorkflow, cancelarTarefa } from "../lib/operacional/tarefa-ciclo"
import { notificarAcontecimento } from "../lib/operacional/notificacao-canonica"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
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

  const tarefa = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão`, processoId: processo.id, chaveIdempotencia: `${MARCA}-t-1`, statusTarefa: "NAO_INICIADA" },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════
  secao("1-3) atribuir gera a notificação de ATRIBUICAO — não lida")
  // ══════════════════════════════════════════════════════════════════════
  const rAtrib = await atribuirTarefa({ tarefaId: tarefa.id, responsavelId: daniela.id, autorId: gestor.id })
  ok("01) atribuição sucede", rAtrib.ok === true, JSON.stringify(rAtrib).slice(0, 150))

  const avisosAntes = await prisma.notificacaoOperacional.findMany({
    where: { tarefaId: tarefa.id, destinatarioId: daniela.id }, select: { id: true, tipo: true, lidaEm: true },
  })
  ok("02) existe UMA notificação ATRIBUICAO", avisosAntes.filter((a) => a.tipo === "ATRIBUICAO").length === 1, JSON.stringify(avisosAntes))
  ok("03) ainda não está lida", avisosAntes.every((a) => a.lidaEm == null))

  // Uma notificação de OUTRO tipo, para provar que iniciar não varre tudo —
  // só o que "você recebeu isto" resolve ao começar.
  const avisoPrazo = await notificarAcontecimento(prisma, {
    tipo: "PRAZO", destinatarioId: daniela.id, tarefaId: tarefa.id,
    titulo: "Prazo perto do vencimento", chaveIdempotencia: `${MARCA}-prazo-t${tarefa.id}`,
  })
  ok("04) notificação de PRAZO criada à parte (controle)", avisoPrazo.criada === true)

  // ══════════════════════════════════════════════════════════════════════
  secao("5-9) iniciar a tarefa marca ATRIBUICAO como lida, sem tocar PRAZO")
  // ══════════════════════════════════════════════════════════════════════
  const rInicio = await iniciarTarefa({ tarefaId: tarefa.id, autorId: daniela.id })
  ok("05) iniciar sucede", rInicio.ok === true, JSON.stringify(rInicio).slice(0, 150))

  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id }, select: { statusTarefa: true, dataInicio: true } })
  ok("06) Tarefa sai de NAO_INICIADA", tarefaDepois.statusTarefa === "EM_ANDAMENTO", tarefaDepois.statusTarefa)
  ok("07) dataInicio gravada", tarefaDepois.dataInicio != null)

  const atribuicaoDepois = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa.id, destinatarioId: daniela.id, tipo: "ATRIBUICAO" }, select: { lidaEm: true },
  })
  ok("08) notificação ATRIBUICAO agora está lida", atribuicaoDepois.lidaEm != null, String(atribuicaoDepois.lidaEm))

  const prazoDepois = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa.id, destinatarioId: daniela.id, tipo: "PRAZO" }, select: { lidaEm: true },
  })
  ok("09) notificação PRAZO CONTINUA não lida (iniciar não resolve o fato que ela avisa)", prazoDepois.lidaEm == null, String(prazoDepois.lidaEm))

  // ══════════════════════════════════════════════════════════════════════
  secao("10) idempotência — iniciar de novo não falha, não desfaz o já lido")
  // ══════════════════════════════════════════════════════════════════════
  const rInicio2 = await iniciarTarefa({ tarefaId: tarefa.id, autorId: daniela.id })
  ok("10) segunda chamada é sucesso idempotente", rInicio2.ok === true && "jaEstavaIniciada" in rInicio2 && rInicio2.jaEstavaIniciada === true, JSON.stringify(rInicio2))

  // ══════════════════════════════════════════════════════════════════════
  secao("11-13) transferência gera NOVA notificação (TRANSFERENCIA) — reiniciar não se aplica (já em andamento), mas reatribuir e reiniciar via outra tarefa prova o mesmo caminho")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa2 = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão 2`, processoId: processo.id, chaveIdempotencia: `${MARCA}-t-2`, statusTarefa: "NAO_INICIADA", responsavelId: gestor.id },
    select: { id: true },
  })
  const rTransf = await atribuirTarefa({ tarefaId: tarefa2.id, responsavelId: daniela.id, autorId: gestor.id })
  ok("11) transferência sucede", rTransf.ok === true, JSON.stringify(rTransf).slice(0, 150))
  const transfAntes = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa2.id, destinatarioId: daniela.id, tipo: "TRANSFERENCIA" }, select: { lidaEm: true },
  })
  ok("12) notificação TRANSFERENCIA nasce não lida", transfAntes.lidaEm == null)
  await iniciarTarefa({ tarefaId: tarefa2.id, autorId: daniela.id })
  const transfDepois = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa2.id, destinatarioId: daniela.id, tipo: "TRANSFERENCIA" }, select: { lidaEm: true },
  })
  ok("13) notificação TRANSFERENCIA também é marcada como lida ao iniciar", transfDepois.lidaEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("14-16) CONCLUIR sem nunca ter iniciado também marca a notificação como lida (tarefa transversal)")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa3 = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão 3`, processoId: processo.id, chaveIdempotencia: `${MARCA}-t-3`, statusTarefa: "NAO_INICIADA" },
    select: { id: true },
  })
  await atribuirTarefa({ tarefaId: tarefa3.id, responsavelId: daniela.id, autorId: gestor.id })
  const antesConcluir = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa3.id, destinatarioId: daniela.id, tipo: "ATRIBUICAO" }, select: { lidaEm: true },
  })
  ok("14) notificação nasce não lida", antesConcluir.lidaEm == null)
  const rConcluir = await concluirTarefaSemWorkflow({ tarefaId: tarefa3.id, autorId: daniela.id })
  ok("15) concluir sem workflow sucede mesmo SEM nunca ter chamado iniciarTarefa", rConcluir.ok === true, JSON.stringify(rConcluir))
  const depoisConcluir = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa3.id, destinatarioId: daniela.id, tipo: "ATRIBUICAO" }, select: { lidaEm: true },
  })
  ok("16) notificação é marcada como lida ao concluir — concluir também é progresso real", depoisConcluir.lidaEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("17-19) CANCELAR sem nunca ter iniciado também marca a notificação como lida")
  // ══════════════════════════════════════════════════════════════════════
  const tarefa4 = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão 4`, processoId: processo.id, chaveIdempotencia: `${MARCA}-t-4`, statusTarefa: "NAO_INICIADA" },
    select: { id: true },
  })
  await atribuirTarefa({ tarefaId: tarefa4.id, responsavelId: daniela.id, autorId: gestor.id })
  const antesCancelar = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa4.id, destinatarioId: daniela.id, tipo: "ATRIBUICAO" }, select: { lidaEm: true },
  })
  ok("17) notificação nasce não lida", antesCancelar.lidaEm == null)
  const rCancelar = await cancelarTarefa({ tarefaId: tarefa4.id, autorId: gestor.id, motivo: "Processo arquivado" })
  ok("18) cancelar sucede mesmo SEM nunca ter iniciado (o caso que iniciarTarefa sozinho nunca cobre)", rCancelar.ok === true, JSON.stringify(rCancelar))
  const depoisCancelar = await prisma.notificacaoOperacional.findFirstOrThrow({
    where: { tarefaId: tarefa4.id, destinatarioId: daniela.id, tipo: "ATRIBUICAO" }, select: { lidaEm: true },
  })
  ok("19) notificação é marcada como lida ao cancelar", depoisCancelar.lidaEm != null)

  console.log(`\n${"─".repeat(70)}\nRESULTADO: ${passou} passaram, ${falhou} falharam\n${"─".repeat(70)}`)
  if (falhou > 0) { console.log("FALHAS:", falhas); process.exit(1) }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
