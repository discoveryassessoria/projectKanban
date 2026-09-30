// scripts/obrigacao-atribuicao.test.ts
// ============================================================================
// OBRIGAÇÃO ADMINISTRATIVA ATRIBUIR_RESPONSAVEL — DESCONTINUADA em 30/09/2026 (cenário Grisotto).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/obrigacao-atribuicao.test.ts
//
// Decisão do usuário: a Torre de Controle já mostra quem está sem dono (visão "Sem responsável", Precisa de você),
// então "Atribuir tarefas — {família}" NÃO é mais criada. Este teste prova a metade que continua valendo — as
// tarefas sem dono continuam contadas, listadas e avisadas ao gestor (1 aviso por família, nunca 15) — e a nova:
// NENHUMA tarefa administrativa nasce, seja na materialização, na atribuição ou ao devolver à fila.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { devolverAFila } from "@/lib/operacional/tarefa-ciclo"
import { avisarGestores } from "@/lib/operacional/avisos-sino"
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
  const usersLimpeza = await prisma.usuario.findMany({ where: { email: { endsWith: "@obrig.test" } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { processoId: { in: ids } }, { destinatarioId: { in: usersLimpeza.map((u) => u.id) } }] },
  })
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
  // Produção tem único (processoId, faseMacroKey): UMA instância da fase por processo, com N passos (um por necessidade).
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}` },
    select: { id: true },
  })
  for (let i = 0; i < n; i++) {
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `Pessoa${i}`, sobrenome: sufixo }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${i}` },
      select: { id: true },
    })
    await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `pesquisar_${sufixo}_${i}`,
        ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
        papel: "equipe_documental", slaDays: 5, ciclo: 1,
        snapshot: { label: "Pesquisar registro" } as never,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${i}`,
      },
    })
  }
  await reconciliarTarefas({ processoId: proc.id })
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: proc.id, tipo: "NORMAL" }, select: { id: true } })
  return { processoId: proc.id, tarefaIds: tarefas.map((t) => t.id) }
}

async function main() {
  exigirBancoDeTeste("prova a obrigação administrativa ATRIBUIR_RESPONSAVEL")
  await limpar()

  // O gestor é QUEM O SISTEMA RESOLVE pela competência (menor id com `operacao.distribuirTarefas`). O banco
  // do gate já traz um admin de fixture, com id menor que qualquer usuário criado aqui: criar um "Marco"
  // e esperar que ele seja o resolvido dependeria da ordem de ids. Só cria o Marco se ninguém tem a competência.
  const idResolvido = await usuarioResponsavelPelaDistribuicao(prisma)
  const gestor = idResolvido != null
    ? { id: idResolvido }
    : await prisma.usuario.create({ data: { nome: "Marco", email: "marco@obrig.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const funcionario = await prisma.usuario.create({ data: { nome: "Ana Comum", email: "ana@obrig.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: "daniela@obrig.test", senha: "x", tipo: "assistente" }, select: { id: true } })

  console.log("OBRIGAÇÃO ADMINISTRATIVA DESCONTINUADA — o sem dono vive na Torre (cenário Grisotto)\n")

  const admins = (processoId: number) => prisma.tarefa.count({ where: { processoId, tipo: "ADMINISTRATIVA" } })

  // ═══════════════════════════════════════════════════════════════════════
  secao("A) 15 tarefas sem responsável → NENHUMA obrigação administrativa; o aviso do gestor continua (1 por família)")
  // ═══════════════════════════════════════════════════════════════════════
  const grisotto = await processoComTarefasSemResponsavel("GRISOTTO", 15)
  ok("A) nasceram as 15 tarefas operacionais", grisotto.tarefaIds.length === 15, String(grisotto.tarefaIds.length))
  ok("A) todas sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 15)
  ok("A) NENHUMA tarefa administrativa 'Atribuir tarefas' foi criada", (await admins(grisotto.processoId)) === 0)
  ok("A) a competência de distribuir continua resolvida pelo cadastro (não por hardcode)", (await usuarioResponsavelPelaDistribuicao(prisma)) === gestor.id)

  await avisarGestores({ agora: new Date() })
  ok("A) recém-criadas (menos de 1 dia sem dono) ainda não avisam o gestor",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: gestor.id, processoId: grisotto.processoId, tipo: "SEM_RESPONSAVEL" } })) === 0)
  await prisma.tarefa.updateMany({ where: { id: { in: grisotto.tarefaIds } }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } })
  await avisarGestores({ agora: new Date() })
  const srGris = await prisma.notificacaoOperacional.findMany({
    where: { destinatarioId: gestor.id, processoId: grisotto.processoId, tipo: "SEM_RESPONSAVEL", agrupado: true, lidaEm: null },
  })
  ok("A) o gestor recebe UM SEM_RESPONSAVEL da família cobrindo as 15 (nunca 15 avisos)",
    srGris.length === 1 && srGris[0].contagem === 15 && srGris[0].tarefaIds.length === 15, `${srGris.length}`)
  ok("A) o aviso leva à TORRE, aba Tarefas, visão Sem responsável (não mais à Distribuição)", srGris[0]?.link === "/torre?aba=tarefas&visao=semdono", srGris[0]?.link ?? "")

  // ═══════════════════════════════════════════════════════════════════════
  secao("B) A fila do gestor não ganha item administrativo; as 15 não são dele")
  // ═══════════════════════════════════════════════════════════════════════
  const filaMarco = await minhaFila(gestor.id)
  ok("B) nenhuma linha da família Grisotto na fila do gestor", filaMarco.filter((l) => l.processoId === grisotto.processoId).length === 0)
  const filaDaniela0 = await minhaFila(daniela.id)
  ok("B) Daniela ainda não tem nenhuma das 15", grisotto.tarefaIds.every((id) => !filaDaniela0.some((l) => l.taskId === id)))
  const semResp0 = await semResponsavel()
  ok("B) as 15 continuam em SEM RESPONSÁVEL — ninguém as tomou por engano", grisotto.tarefaIds.every((id) => semResp0.some((l) => l.taskId === id)))
  const filaFuncionario = await minhaFila(funcionario.id)
  ok("B) funcionário comum não recebe nada de administrativo", !filaFuncionario.some((l) => l.processoId === grisotto.processoId))

  // ═══════════════════════════════════════════════════════════════════════
  secao("H) Duas famílias com sem responsável → nenhuma obrigação em nenhuma")
  // ═══════════════════════════════════════════════════════════════════════
  const outraFamilia = await processoComTarefasSemResponsavel("OUTRAFAM", 3)
  ok("H) a segunda família também não ganha obrigação", (await admins(outraFamilia.processoId)) === 0)

  // ═══════════════════════════════════════════════════════════════════════
  secao("E/F) Atribuir 10 e depois as últimas 5 → contadores certos, nada administrativo criado")
  // ═══════════════════════════════════════════════════════════════════════
  for (const tarefaId of grisotto.tarefaIds.slice(0, 10)) {
    const r = await atribuirTarefa({ tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    if (!r.ok) console.log("    ! falhou atribuir", tarefaId, r)
  }
  ok("E) restam 5 sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 5)
  ok("E) atribuir NÃO cria obrigação", (await admins(grisotto.processoId)) === 0)
  for (const tarefaId of grisotto.tarefaIds.slice(10)) {
    const r = await atribuirTarefa({ tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    if (!r.ok) console.log("    ! falhou atribuir", tarefaId, r)
  }
  ok("F) zero sem responsável", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 0)
  ok("F) o aviso SEM_RESPONSAVEL do gestor não fica pendente (atribuir todas o tira na hora)",
    (await prisma.notificacaoOperacional.count({ where: { processoId: grisotto.processoId, tipo: "SEM_RESPONSAVEL", agrupado: true } })) === 0)
  const filaDanielaFinal = await minhaFila(daniela.id)
  ok("as 15 tarefas operacionais agora são da Daniela", grisotto.tarefaIds.every((id) => filaDanielaFinal.some((l) => l.taskId === id)))
  ok("nenhuma tarefa foi duplicada: 15 continuam sendo 15", (await prisma.tarefa.count({ where: { processoId: grisotto.processoId, tipo: "NORMAL" } })) === 15)

  // ═══════════════════════════════════════════════════════════════════════
  secao("G) Uma tarefa volta a ficar sem responsável → contada de novo, nenhuma obrigação")
  // ═══════════════════════════════════════════════════════════════════════
  await devolverAFila({ tarefaId: grisotto.tarefaIds[0], autorId: gestor.id, motivo: "reorganização" })
  ok("G) 1 sem responsável de novo", (await contarSemResponsavelDistribuivel(prisma, grisotto.processoId)) === 1)
  ok("G) devolver à fila NÃO cria obrigação", (await admins(grisotto.processoId)) === 0)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
