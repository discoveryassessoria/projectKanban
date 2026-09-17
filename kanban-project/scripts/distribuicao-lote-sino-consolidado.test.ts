// scripts/distribuicao-lote-sino-consolidado.test.ts
// ============================================================================
// DISTRIBUIÇÃO EM LOTE + SINO CONSOLIDADO — correção 17/09/2026.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/distribuicao-lote-sino-consolidado.test.ts
//
// TRÊS PONTOS OBRIGATÓRIOS (nenhum fora):
//   A — seleção em lote (`/api/tarefas/redistribuir`) atribui N tarefas de
//       uma vez, pela porta canônica, sem criar tarefa nova.
//   B — sino do Marco: SÓ a notificação DISTRIBUICAO_NECESSARIA da
//       obrigação administrativa — nunca também "novas tarefas" pra ela.
//   C — sino da Daniela: UMA notificação consolidada ("Grisotto — N tarefas
//       atribuídas a você"), nunca N ATRIBUICAO individuais, nem as mesmas N
//       explodindo em "próximos 3 dias"/"novas tarefas" ao mesmo tempo.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { reconciliarObrigacaoDeAtribuicao, usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { urlMinhaOperacaoDoProcesso } from "@/lib/operacional/navegacao"
import { GET as getNotificacoes } from "@/src/app/api/notificacoes/route"
import { GET as getTarefasOperacao } from "@/src/app/api/operacao/tarefas/route"
import { NextRequest } from "next/server"

const MARCA = "LOTESINO"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function tokenPara(userId: number, email: string, tipo: string): Promise<string> {
  return signAuthToken({ userId, email, tipo, sessaoInicio: Date.now() })
}
async function sinoDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new NextRequest("http://localhost/api/notificacoes", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getNotificacoes(req)
  if (resp.status !== 200) throw new Error(`sino respondeu ${resp.status}`)
  return resp.json() as Promise<{
    vencidas: Array<{ id: number }>; hoje: Array<{ id: number }>; proximos3Dias: Array<{ id: number }>; novas: Array<{ id: number }>
    acontecimentos: Array<{ id: number; tipo: string; titulo: string; link: string }>
  }>
}
async function minhaFilaDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new NextRequest("http://localhost/api/operacao/tarefas?visao=minha_fila", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getTarefasOperacao(req)
  if (resp.status !== 200) throw new Error(`minha_fila respondeu ${resp.status}`)
  return resp.json() as Promise<{ linhas: Array<{ taskId: number; processoId: number | null }> }>
}

async function corpo() {
  console.log("DISTRIBUIÇÃO EM LOTE + SINO CONSOLIDADO (cenário Grisotto)\n")

  const marco = await prisma.usuario.create({
    data: { nome: `${MARCA} Marco`, email: `marco@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
    select: { id: true, email: true, tipo: true },
  })
  const daniela = await prisma.usuario.create({
    data: {
      nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente",
      permissoesCustom: { "tarefas.ver": true } as never,
    },
    select: { id: true, email: true, tipo: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} Grisotto`, arvoreId: arv.id }, select: { id: true } })

  const emDoisDias = new Date()
  emDoisDias.setDate(emDoisDias.getDate() + 2)

  // ══════════════════════════════════════════════════════════════════════
  secao("A) 15 tarefas NORMAL sem responsável → 1 obrigação administrativa")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaIds: number[] = []
  for (let i = 0; i < 15; i++) {
    const r = await criarTarefaManual({
      processoId: proc.id, titulo: `${MARCA} certidao ${i}`, autorId: marco.id,
      responsavelId: null, dataPrazo: emDoisDias, motivo: "cenário — lote/sino", confirmarDuplicidade: true,
    })
    if (!r.ok) throw new Error(`falha ao criar tarefa #${i}: ${r.mensagem}`)
    tarefaIds.push(r.tarefaId)
  }
  await reconciliarObrigacaoDeAtribuicao(prisma, proc.id)

  const donoId = await usuarioResponsavelPelaDistribuicao(prisma)
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { id: donoId! }, select: { id: true, email: true, tipo: true } })
  const obrigacao = await prisma.tarefa.findFirstOrThrow({
    where: { processoId: proc.id, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao", concluida: false },
    select: { id: true, responsavelId: true },
  })
  ok("A) a obrigação pertence ao Admin resolvido", obrigacao.responsavelId === admin.id)

  const sinoAdminAntes = await sinoDe(admin.id, admin.email, admin.tipo)
  const distribAntes = sinoAdminAntes.acontecimentos.filter((a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processo=${proc.id}`))
  ok("A) sino do Admin tem exatamente 1 notificação de distribuição para este processo", distribAntes.length === 1, String(distribAntes.length))
  const novaTarefaAntes = sinoAdminAntes.novas.filter((n) => n.id === obrigacao.id)
  ok("B) a tarefa administrativa NÃO aparece em 'novas tarefas' do Admin (sem redundância)", novaTarefaAntes.length === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("A) SELEÇÃO EM LOTE — Marco seleciona as 15 e atribui a Daniela, uma única confirmação")
  // ══════════════════════════════════════════════════════════════════════
  // A mesma porta que a UI de "Selecionar todas" chama (POST /api/tarefas/redistribuir).
  const totalAntes = await prisma.tarefa.count({ where: { processoId: proc.id } })
  const resLote = await redistribuirTarefas({ tarefaIds, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "Atribuição em lote — Operação → Distribuição" })
  ok("A) as 15 foram atribuídas numa única operação", resLote.sucesso === 15, `${resLote.sucesso}/${resLote.total}`)
  const totalDepois = await prisma.tarefa.count({ where: { processoId: proc.id } })
  ok("A) nenhuma tarefa NORMAL nova foi criada (mesmo total de tarefas)", totalDepois === totalAntes, `${totalAntes} → ${totalDepois}`)
  const historico = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: tarefaIds }, acao: "TAREFA_ATRIBUIDA" } })
  ok("A) histórico/auditoria preservado — 1 entrada por tarefa", historico === 15, String(historico))

  // ══════════════════════════════════════════════════════════════════════
  secao("B) SINO DO MARCO DEPOIS — a obrigação se resolveu, sem notificação redundante")
  // ══════════════════════════════════════════════════════════════════════
  const obrigacaoDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: obrigacao.id }, select: { concluida: true } })
  ok("B) a obrigação administrativa foi concluída pela reconciliação canônica", obrigacaoDepois.concluida === true)

  const sinoAdminDepois = await sinoDe(admin.id, admin.email, admin.tipo)
  const distribDepois = sinoAdminDepois.acontecimentos.filter((a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processo=${proc.id}`))
  ok("B) a notificação de distribuição não fica mais pendente", distribDepois.length === 0)
  const semRedundante = sinoAdminDepois.acontecimentos.filter((a) => a.link.includes(`processo=${proc.id}`))
  ok("B) nenhuma notificação redundante (nem DISTRIBUICAO_NECESSARIA, nem NOVA_TAREFA) sobrou pendente pra este processo", semRedundante.length === 0, String(semRedundante.length))

  // ══════════════════════════════════════════════════════════════════════
  secao("C) SINO DA DANIELA — 1 notificação consolidada, nunca a triplicação")
  // ══════════════════════════════════════════════════════════════════════
  const sinoDaniela = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  const lote = sinoDaniela.acontecimentos.filter((a) => a.tipo === "ATRIBUICAO_LOTE")
  ok("C) exatamente 1 notificação consolidada de atribuição", lote.length === 1, String(lote.length))
  ok("C) o título nomeia o processo/família (Grisotto), sem hardcode no código", lote[0]?.titulo.includes("Grisotto") ?? false, lote[0]?.titulo)
  ok("C) o link leva direto para Minha Operação, escopado ao processo", lote[0]?.link === urlMinhaOperacaoDoProcesso(proc.id))

  const individuais = sinoDaniela.acontecimentos.filter((a) => a.tipo === "ATRIBUICAO")
  ok("C) NÃO existem 15 notificações individuais 'Nova tarefa atribuída'", individuais.length === 0, String(individuais.length))

  const novasDaniela = sinoDaniela.novas.filter((n) => tarefaIds.includes(n.id))
  ok("C) NÃO as mesmas 15 explodindo em 'novas tarefas' (coberta pela consolidada)", novasDaniela.length === 0, String(novasDaniela.length))

  const prazoDaniela = sinoDaniela.proximos3Dias.filter((n) => tarefaIds.includes(n.id))
  ok("C) NÃO as mesmas 15 explodindo em 'próximos 3 dias' simultaneamente à consolidada", prazoDaniela.length === 0, String(prazoDaniela.length))

  const filaDaniela = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  const idsNaFila = filaDaniela.linhas.map((l) => l.taskId)
  ok("C) Minha Operação da Daniela contém as 15 tarefas (canônicas, individuais)", tarefaIds.every((id) => idsNaFila.includes(id)))
  ok("C) todas no contexto do MESMO processo (Grisotto)", filaDaniela.linhas.filter((l) => tarefaIds.includes(l.taskId)).every((l) => l.processoId === proc.id))

  // ══════════════════════════════════════════════════════════════════════
  secao("D) Daniela marca a notificação consolidada como lida — tarefas continuam pendentes")
  // ══════════════════════════════════════════════════════════════════════
  const marcado = await marcarNotificacaoComoLida(prisma, { notificacaoId: lote[0]!.id, usuarioId: daniela.id })
  ok("D) marcar como lida sucede", marcado.ok === true)

  const sinoDanielaDepoisDeLer = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("D) a notificação consolidada não aparece mais como pendente", !sinoDanielaDepoisDeLer.acontecimentos.some((a) => a.id === lote[0]!.id))

  const filaDanielaDepois = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  const idsAindaNaFila = filaDanielaDepois.linhas.map((l) => l.taskId)
  ok("D) as 15 tarefas CONTINUAM pendentes em Minha Operação (notificação lida ≠ tarefa concluída)", tarefaIds.every((id) => idsAindaNaFila.includes(id)))
  const aindaAtivas = await prisma.tarefa.count({ where: { id: { in: tarefaIds }, concluida: false } })
  ok("D) nenhuma das 15 foi concluída sozinha", aindaAtivas === 15)
}

async function main() {
  exigirBancoDeTeste("prova distribuição em lote + sino consolidado (correção 17/09/2026)")
  await limpar()
  try {
    await corpo()
  } finally {
    await limpar()
  }
  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
