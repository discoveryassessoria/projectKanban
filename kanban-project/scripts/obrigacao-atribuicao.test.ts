// scripts/obrigacao-atribuicao.test.ts
// ============================================================================
// OBRIGAÇÃO ADMINISTRATIVA ATRIBUIR_RESPONSAVEL — cenário Grisotto.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/obrigacao-atribuicao.test.ts
//
// "15 tarefas sem responsável" não é 15 interrupções, nem 30 (15 executáveis
// + 15 sem responsável, contando a mesma coisa duas vezes): é UMA obrigação
// administrativa — distribuir — que existe enquanto a condição existir, e
// desaparece sozinha quando não existir mais.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { devolverAFila } from "@/lib/operacional/tarefa-ciclo"
import { minhaFila, semResponsavel } from "@/lib/operacional/tarefa-projecoes"
import {
  contarSemResponsavelDistribuivel, usuarioResponsavelPelaDistribuicao,
} from "@/lib/operacional/obrigacao-atribuicao"

const MARCA = "OBRIG"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@obrig.test" } } })
}

/** UM processo com N tarefas SEM RESPONSÁVEL — o motor as cria, ninguém à mão. */
async function processoComTarefasSemResponsavel(sufixo: string, n: number) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: "Certidão", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" },
    select: { id: true },
  })
  for (let i = 0; i < n; i++) {
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `Pessoa${i}`, sobrenome: sufixo }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${i}` },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: i + 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${i}` },
      select: { id: true },
    })
    await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `pesquisar_${sufixo}_${i}`,
        ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
        papel: "equipe_documental", slaDays: 5, ciclo: i + 1,
        snapshot: { label: "Pesquisar registro" } as never,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${i}`,
      },
    })
  }
  await reconciliarTarefas({ processoId: proc.id })
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: proc.id, tipo: "NORMAL" }, select: { id: true } })
  return { processoId: proc.id, tarefaIds: tarefas.map((t) => t.id) }
}

const obrigacaoDoProcesso = (processoId: number) =>
  prisma.tarefa.findFirst({
    where: { processoId, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao" },
    orderBy: { id: "desc" },
  })

async function main() {
  exigirBancoDeTeste("prova a obrigação administrativa ATRIBUIR_RESPONSAVEL")
  await limpar()

  const gestor = await prisma.usuario.create({ data: { nome: "Marco", email: "marco@obrig.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const funcionario = await prisma.usuario.create({ data: { nome: "Ana Comum", email: "ana@obrig.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: "daniela@obrig.test", senha: "x", tipo: "assistente" }, select: { id: true } })

  console.log("OBRIGAÇÃO ADMINISTRATIVA — ATRIBUIR_RESPONSAVEL (cenário Grisotto)\n")

  // ═══════════════════════════════════════════════════════════════════════
  secao("A) 15 tarefas sem responsável → 1 obrigação administrativa (não 15)")
  // ═══════════════════════════════════════════════════════════════════════
  const grisotto = await processoComTarefasSemResponsavel("GRISOTTO", 15)
  ok("A) nasceram as 15 tarefas operacionais", grisotto.tarefaIds.length === 15, String(grisotto.tarefaIds.length))
  ok("A) todas sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 15)

  const todasAdm = await prisma.tarefa.findMany({ where: { processoId: grisotto.processoId, tipo: "ADMINISTRATIVA" } })
  ok("A) exatamente 1 obrigação administrativa (nunca 15)", todasAdm.length === 1, String(todasAdm.length))
  ok("A) o título identifica a família/processo", todasAdm[0]?.titulo.includes("GRISOTTO") ?? false, todasAdm[0]?.titulo)
  ok("A) nasce já com responsável (sem circularidade)", todasAdm[0]?.responsavelId === gestor.id)
  ok("A) responsável resolvido é o mesmo (competência, não hardcode)",
    (await usuarioResponsavelPelaDistribuicao(prisma)) === gestor.id)

  // ═══════════════════════════════════════════════════════════════════════
  secao("B) Minha Operação do Marco — 1 item administrativo")
  // ═══════════════════════════════════════════════════════════════════════
  const filaMarco = await minhaFila(gestor.id)
  const itemAdm = filaMarco.find((l) => l.taskId === todasAdm[0].id)
  ok("B) a obrigação aparece na Minha Operação do Marco", itemAdm != null)
  ok("B) só UMA — não 15 linhas para a mesma obrigação",
    filaMarco.filter((l) => l.processoId === grisotto.processoId).length === 1,
    String(filaMarco.filter((l) => l.processoId === grisotto.processoId).length))

  // ═══════════════════════════════════════════════════════════════════════
  secao("C) As 15 tarefas operacionais NÃO pertencem ao Marco")
  // ═══════════════════════════════════════════════════════════════════════
  const filaDaniela0 = await minhaFila(daniela.id)
  ok("C) Daniela ainda não tem nenhuma das 15", grisotto.tarefaIds.every((id) => !filaDaniela0.some((l) => l.taskId === id)))
  const semResp0 = await semResponsavel()
  ok("C) as 15 continuam em SEM RESPONSÁVEL — ninguém as tomou por engano",
    grisotto.tarefaIds.every((id) => semResp0.some((l) => l.taskId === id)))

  // ═══════════════════════════════════════════════════════════════════════
  secao("I) Funcionário comum não recebe a obrigação")
  // ═══════════════════════════════════════════════════════════════════════
  const filaFuncionario = await minhaFila(funcionario.id)
  ok("I) a obrigação não aparece na fila de quem não tem a competência",
    !filaFuncionario.some((l) => l.taskId === todasAdm[0].id))

  // ═══════════════════════════════════════════════════════════════════════
  secao("H) Duas famílias com sem responsável → 2 obrigações distintas")
  // ═══════════════════════════════════════════════════════════════════════
  const outraFamilia = await processoComTarefasSemResponsavel("OUTRAFAM", 3)
  const admOutra = await obrigacaoDoProcesso(outraFamilia.processoId)
  ok("H) a segunda família tem a própria obrigação", admOutra != null)
  ok("H) IDs diferentes — nenhuma fusão, nenhuma cópia cruzada", admOutra!.id !== todasAdm[0].id)
  ok("H) total de obrigações abertas agora é 2 (escopado a ESTES dois processos — nunca conta o resto do banco)",
    (await prisma.tarefa.count({ where: { processoId: { in: [grisotto.processoId, outraFamilia.processoId] }, tipo: "ADMINISTRATIVA", concluida: false } })) === 2)

  // ═══════════════════════════════════════════════════════════════════════
  secao("E) Marco atribui 10 das 15 → mesma obrigação, contador vira 5")
  // ═══════════════════════════════════════════════════════════════════════
  const obrigacaoAntes = todasAdm[0].id
  for (const tarefaId of grisotto.tarefaIds.slice(0, 10)) {
    const r = await atribuirTarefa({ tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    if (!r.ok) console.log("    ! falhou atribuir", tarefaId, r)
  }
  ok("E) restam 5 sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 5)
  const obrigacaoDepoisDe10 = await obrigacaoDoProcesso(grisotto.processoId)
  ok("E) é A MESMA obrigação (mesmo id) — não criou outra", obrigacaoDepoisDe10?.id === obrigacaoAntes)
  ok("E) e continua aberta", obrigacaoDepoisDe10?.concluida === false)
  const totalAindaDois = await prisma.tarefa.count({ where: { processoId: grisotto.processoId, tipo: "ADMINISTRATIVA" } })
  ok("E) nenhuma obrigação nova para o mesmo processo", totalAindaDois === 1, String(totalAindaDois))

  // ═══════════════════════════════════════════════════════════════════════
  secao("F) Marco atribui as últimas 5 → obrigação conclui automaticamente")
  // ═══════════════════════════════════════════════════════════════════════
  for (const tarefaId of grisotto.tarefaIds.slice(10)) {
    const r = await atribuirTarefa({ tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    if (!r.ok) console.log("    ! falhou atribuir", tarefaId, r)
  }
  ok("F) zero sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 0)
  const obrigacaoFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: obrigacaoAntes } })
  ok("F) a obrigação foi CONCLUÍDA (não cancelada, não apagada)",
    obrigacaoFinal.concluida === true && obrigacaoFinal.statusTarefa === "CONCLUIDO_RECEBIDO")
  const filaMarcoDepois = await minhaFila(gestor.id)
  ok("F) desaparece da Minha Operação ativa do Marco", !filaMarcoDepois.some((l) => l.taskId === obrigacaoAntes))
  const notifDaObrigacao = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: obrigacaoAntes } })
  ok("F) a notificação correspondente não fica pendente", notifDaObrigacao.every((n) => n.lidaEm != null))

  // ═══════════════════════════════════════════════════════════════════════
  secao("B/F) Daniela agora tem as 15 — ownership mudou, tarefas não se multiplicaram")
  // ═══════════════════════════════════════════════════════════════════════
  const filaDanielaFinal = await minhaFila(daniela.id)
  ok("as 15 tarefas operacionais agora são da Daniela",
    grisotto.tarefaIds.every((id) => filaDanielaFinal.some((l) => l.taskId === id)))
  ok("nenhuma tarefa foi duplicada: 15 continuam sendo 15",
    (await prisma.tarefa.count({ where: { processoId: grisotto.processoId, tipo: "NORMAL" } })) === 15)

  // ═══════════════════════════════════════════════════════════════════════
  secao("G) Uma tarefa volta a ficar sem responsável → obrigação reaparece, sem duplicar")
  // ═══════════════════════════════════════════════════════════════════════
  await devolverAFila({ tarefaId: grisotto.tarefaIds[0], autorId: gestor.id, motivo: "reorganização" })
  ok("G) 1 sem responsável de novo", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 1)
  const obrigacaoReaberta = await obrigacaoDoProcesso(grisotto.processoId)
  ok("G) a obrigação existe de novo", obrigacaoReaberta != null && obrigacaoReaberta.concluida === false)
  ok("G) é uma linha NOVA (a antiga ficou concluída — encerrada não ressuscita)",
    obrigacaoReaberta!.id !== obrigacaoAntes)
  const totalObrigacoesDoProcesso = await prisma.tarefa.count({ where: { processoId: grisotto.processoId, tipo: "ADMINISTRATIVA" } })
  ok("G) nenhuma duplicação: 2 linhas no total (1 concluída + 1 aberta), nunca 2 abertas",
    totalObrigacoesDoProcesso === 2, String(totalObrigacoesDoProcesso))
  const abertasAgora = await prisma.tarefa.count({ where: { processoId: grisotto.processoId, tipo: "ADMINISTRATIVA", concluida: false } })
  ok("G) só 1 aberta", abertasAgora === 1)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
