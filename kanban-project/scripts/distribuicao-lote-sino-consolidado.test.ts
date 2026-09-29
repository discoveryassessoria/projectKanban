// scripts/distribuicao-lote-sino-consolidado.test.ts
// ============================================================================
// DISTRIBUIÇÃO EM LOTE + SINO CONSOLIDADO — correção 17/09/2026, no sino AGRUPADO
// (redesenho 29/09/2026).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/distribuicao-lote-sino-consolidado.test.ts
//
// TRÊS PONTOS OBRIGATÓRIOS (nenhum fora):
//   A — seleção em lote (`/api/tarefas/redistribuir`) atribui N tarefas de
//       uma vez, pela porta canônica, sem criar tarefa nova.
//   B — sino do Marco: SÓ o aviso de gestor SEM_RESPONSAVEL da família ("N tarefas sem
//       responsável há mais de 1 dia", que absorveu a DISTRIBUICAO_NECESSARIA) — e ele
//       some quando a última é atribuída. Nunca também um aviso pessoal para ela.
//   C — sino da Daniela: UM aviso CHEGOU_TRABALHO ("Grisotto — N tarefas atribuídas a
//       você"), nunca N avisos individuais, nem as mesmas N explodindo em outro aviso
//       ao mesmo tempo.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { reconciliarObrigacaoDeAtribuicao, usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { avisarGestores } from "@/lib/operacional/avisos-sino"
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
    avisos: Array<{ id: number; tipo: string; titulo: string; link: string; familiaId: number | null; contagem: number }>
    anteriores: Array<{ id: number }>; total: number
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

  // "Sem responsável há mais de 1 dia": recua a criação das 15 (como sino-agrupado.test.ts).
  await prisma.tarefa.updateMany({ where: { id: { in: tarefaIds } }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } })
  await avisarGestores({ agora: new Date() })
  const sinoAdminAntes = await sinoDe(admin.id, admin.email, admin.tipo)
  const distribAntes = sinoAdminAntes.avisos.filter((a) => a.tipo === "SEM_RESPONSAVEL" && a.familiaId === proc.id)
  ok("A) sino do Admin tem exatamente 1 aviso de distribuição (SEM_RESPONSAVEL) para esta família, não 15", distribAntes.length === 1, String(distribAntes.length))
  ok("A) diz '15 tarefas sem responsável há mais de 1 dia' e leva à distribuição da família",
    distribAntes[0]?.titulo === `${MARCA} Grisotto — 15 tarefas sem responsável há mais de 1 dia` && distribAntes[0].link === `/operacao/distribuicao?processo=${proc.id}`,
    distribAntes[0]?.titulo)
  const pessoalAntes = sinoAdminAntes.avisos.filter((a) => a.familiaId === proc.id && a.tipo !== "SEM_RESPONSAVEL")
  ok("B) a tarefa administrativa e as 15 sem dono NÃO viram aviso pessoal do Admin (sem redundância)", pessoalAntes.length === 0, String(pessoalAntes.length))

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
  const distribDepois = sinoAdminDepois.avisos.filter((a) => a.tipo === "SEM_RESPONSAVEL" && a.familiaId === proc.id)
  ok("B) o aviso de distribuição não fica mais pendente", distribDepois.length === 0)
  const semRedundante = sinoAdminDepois.avisos.filter((a) => a.familiaId === proc.id)
  ok("B) nenhum aviso redundante (nem SEM_RESPONSAVEL, nem pessoal) sobrou pendente pra esta família", semRedundante.length === 0, String(semRedundante.length))

  // ══════════════════════════════════════════════════════════════════════
  secao("C) SINO DA DANIELA — 1 notificação consolidada, nunca a triplicação")
  // ══════════════════════════════════════════════════════════════════════
  const sinoDaniela = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  const lote = sinoDaniela.avisos.filter((a) => a.tipo === "CHEGOU_TRABALHO")
  ok("C) exatamente 1 aviso consolidado de atribuição", lote.length === 1, String(lote.length))
  ok("C) o título nomeia a família (Grisotto) e a quantidade: '15 tarefas atribuídas a você'",
    lote[0]?.titulo === `${MARCA} Grisotto — 15 tarefas atribuídas a você` && lote[0].contagem === 15, lote[0]?.titulo)
  ok("C) o link leva direto para a fila da família na Operação (nunca /kanban)", lote[0]?.link === `/operacao?processo=${proc.id}&aba=fila`, lote[0]?.link ?? "")

  const individuais = await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, OR: [{ tarefaId: { in: tarefaIds } }, { agrupado: false }] } })
  ok("C) NÃO existem 15 avisos individuais 'Nova tarefa atribuída'", individuais === 0, String(individuais))

  ok("C) NÃO as mesmas 15 explodindo em outro aviso simultâneo (só o consolidado; total do sino = 1)",
    sinoDaniela.avisos.length === 1 && sinoDaniela.total === 1, `${sinoDaniela.avisos.length} aviso(s), total ${sinoDaniela.total}`)

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
  ok("D) o aviso consolidado não aparece mais como pendente (e o badge cai a 0)", !sinoDanielaDepoisDeLer.avisos.some((a) => a.id === lote[0]!.id) && sinoDanielaDepoisDeLer.total === 0)

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
