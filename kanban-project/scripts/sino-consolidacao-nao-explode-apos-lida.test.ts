// scripts/sino-consolidacao-nao-explode-apos-lida.test.ts
// ============================================================================
// O BUG EXATO DA AUDITORIA DA GRISOTTO (18/09/2026): uma atribuição em lote
// gera UMA notificação consolidada — mas assim que ela é LIDA, o balde
// "novas" (derivado direto de `Tarefa.createdAt`, sem noção de notificação)
// voltava a mostrar as tarefas do lote UMA POR UMA, porque a supressão só
// valia `lidaEm: null`. Isto prova o cenário completo do mandato (itens 1-6,
// 19, 21):
//
//   1) atribuição individual  → 1 notificação → badge 1
//   2) atribuição em lote     → 1 notificação consolidada → badge 1
//   4) ler a notificação      → badge cai, tarefas continuam abertas
//   5) novo lote (novo acontecimento, mesma família) → notificação NOVA,
//      nunca fundida retroativamente com a anterior já lida
//   6) deep-link da consolidada aponta para Operação/processo, não uma tarefa
//   19) o bug exato: depois de lida, "novas" NUNCA mais explode em N tarefas
//       soltas para o MESMO acontecimento — mesmo com as tarefas ainda
//       "recentes" (`createdAt` dentro de 24h)
//   21) badge = acontecimentos não lidos, nunca tarefas dentro de um lote
//
// ESCREVE NO BANCO — só roda no banco de teste local.
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/sino-consolidacao-nao-explode-apos-lida.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { atribuirTarefa, redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { GET as getNotificacoes } from "@/src/app/api/notificacoes/route"

const MARCA = "SINOEXPL"

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

type Sino = {
  vencidas: Array<{ id: number }>; hoje: Array<{ id: number }>; proximos3Dias: Array<{ id: number }>
  novas: Array<{ id: number }>
  acontecimentos: Array<{ id: number; tipo: string; titulo: string; link: string }>
  total: number
}

async function sinoDe(userId: number, email: string, tipo: string): Promise<Sino> {
  const token = await tokenPara(userId, email, tipo)
  const req = new Request("http://localhost/api/notificacoes", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getNotificacoes(req as never)
  if (resp.status !== 200) throw new Error(`sino respondeu ${resp.status} para userId=${userId}`)
  return resp.json() as Promise<Sino>
}

async function main() {
  exigirBancoDeTeste("prova que 'novas' não reexplode uma atribuição consolidada depois de lida")
  await limpar()
  console.log("SINO: CONSOLIDAÇÃO NÃO EXPLODE DEPOIS DE LIDA (auditoria 18/09/2026)\n")

  const marco = await prisma.usuario.create({
    data: { nome: `${MARCA} Marco`, email: `marco@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
    select: { id: true, email: true, tipo: true },
  })
  const daniela = await prisma.usuario.create({
    data: { nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" },
    select: { id: true, email: true, tipo: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} Grisotto`, arvoreId: arv.id }, select: { id: true } })

  // Prazo longe (>7 dias) de propósito: fica FORA dos baldes de prazo
  // (vencidas/hoje/próximos 3 dias) — só assim o teste isola o balde "novas",
  // exatamente como as 3 tarefas reais da Grisotto (dataPrazo a 12 dias).
  const prazoLonge = new Date()
  prazoLonge.setDate(prazoLonge.getDate() + 20)

  async function novaTarefa(titulo: string) {
    const r = await criarTarefaManual({
      processoId: proc.id, titulo, autorId: marco.id, responsavelId: null,
      dataPrazo: prazoLonge, motivo: "cenário de teste — sino não reexplode",
      confirmarDuplicidade: true,
    })
    if (!r.ok) throw new Error(`falha ao criar tarefa "${titulo}": ${r.mensagem}`)
    return r.tarefaId
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 1 — atribuição INDIVIDUAL: 1 tarefa → 1 notificação → badge 1")
  // ══════════════════════════════════════════════════════════════════════
  const t1 = await novaTarefa("individual 1")
  const r1 = await atribuirTarefa({ tarefaId: t1, responsavelId: daniela.id, autorId: marco.id, motivo: "atribuição individual" })
  ok("1) atribuição individual sucede", r1.ok, JSON.stringify(r1))
  const sino1 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("1) exatamente 1 acontecimento", sino1.acontecimentos.length === 1, String(sino1.acontecimentos.length))
  ok("1) tipo ATRIBUICAO (não LOTE)", sino1.acontecimentos[0]?.tipo === "ATRIBUICAO")
  ok("1) badge = 1", sino1.total === 1, String(sino1.total))
  ok("1) 'novas' não duplica a mesma tarefa que já tem acontecimento", sino1.novas.every((n) => n.id !== t1))
  // Daniela lê — fecha o cenário 1 antes de abrir o 2.
  if (sino1.acontecimentos[0]) await marcarNotificacaoComoLida(prisma, { notificacaoId: sino1.acontecimentos[0].id, usuarioId: daniela.id })

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 2 — atribuição em LOTE (3 tarefas): 1 notificação consolidada → badge 1")
  // ══════════════════════════════════════════════════════════════════════
  const loteIds = [await novaTarefa("lote A"), await novaTarefa("lote B"), await novaTarefa("lote C")]
  const rLote = await redistribuirTarefas({ tarefaIds: loteIds, novoResponsavelId: daniela.id, autorId: marco.id, motivo: "atribuição em lote" })
  ok("2) as 3 do lote foram atribuídas", rLote.sucesso === 3, `${rLote.sucesso}/${rLote.total}`)
  const sino2 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("2) exatamente 1 acontecimento NOVO (o da atribuição individual já foi lido)", sino2.acontecimentos.length === 1, String(sino2.acontecimentos.length))
  ok("2) tipo ATRIBUICAO_LOTE", sino2.acontecimentos[0]?.tipo === "ATRIBUICAO_LOTE")
  ok("2) título consolida a família e a quantidade", (sino2.acontecimentos[0]?.titulo ?? "").includes("3 tarefa"), sino2.acontecimentos[0]?.titulo)
  ok("2) badge = 1 (1 acontecimento, não 3 tarefas)", sino2.total === 1, String(sino2.total))
  ok("2) NENHUMA das 3 tarefas do lote aparece solta em 'novas' — a notificação consolidada já as representa", loteIds.every((id) => !sino2.novas.some((n) => n.id === id)))
  ok("6) deep-link da consolidada aponta para Operação/processo, nunca uma tarefa arbitrária",
    (sino2.acontecimentos[0]?.link ?? "").includes("/operacao") && (sino2.acontecimentos[0]?.link ?? "").includes(String(proc.id)))

  const notifLote = sino2.acontecimentos[0]!

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 19 (o bug exato) — depois de lida, 'novas' NÃO reexplode em N tarefas soltas")
  // ══════════════════════════════════════════════════════════════════════
  await marcarNotificacaoComoLida(prisma, { notificacaoId: notifLote.id, usuarioId: daniela.id })
  const sino19 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("19) a notificação do lote não aparece mais como pendente", !sino19.acontecimentos.some((a) => a.id === notifLote.id))
  ok(
    "19) as 3 tarefas do lote CONTINUAM fora de 'novas' mesmo com a notificação já lida (o bug real: elas voltavam uma por uma)",
    loteIds.every((id) => !sino19.novas.some((n) => n.id === id)),
    JSON.stringify(sino19.novas.map((n) => n.id)),
  )
  ok("19) badge cai para 0 (nenhum acontecimento pendente, nenhuma tarefa solta)", sino19.total === 0, String(sino19.total))

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 4 — ler a notificação NÃO conclui/altera as tarefas")
  // ══════════════════════════════════════════════════════════════════════
  const tarefasDoLote = await prisma.tarefa.findMany({ where: { id: { in: loteIds } }, select: { id: true, responsavelId: true, concluida: true, statusTarefa: true } })
  ok("4) as 3 continuam atribuídas à Daniela", tarefasDoLote.every((t) => t.responsavelId === daniela.id))
  ok("4) nenhuma foi concluída por ler a notificação", tarefasDoLote.every((t) => t.concluida === false))

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 5 — um SEGUNDO lote, depois, é um acontecimento NOVO — nunca fundido com o anterior")
  // ══════════════════════════════════════════════════════════════════════
  const loteIds2 = [await novaTarefa("lote D"), await novaTarefa("lote E")]
  const rLote2 = await redistribuirTarefas({ tarefaIds: loteIds2, novoResponsavelId: daniela.id, autorId: marco.id, motivo: "segundo lote, depois" })
  ok("5) as 2 do segundo lote foram atribuídas", rLote2.sucesso === 2, `${rLote2.sucesso}/${rLote2.total}`)
  const sino5 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("5) exatamente 1 acontecimento NOVO (o primeiro lote continua lido, nãoressuscita)", sino5.acontecimentos.length === 1, String(sino5.acontecimentos.length))
  ok("5) é um acontecimento DIFERENTE do primeiro lote (chave de idempotência não colide)", sino5.acontecimentos[0]?.id !== notifLote.id)
  ok("5) o título fala em 2, não em 5 nem funde com o lote anterior", (sino5.acontecimentos[0]?.titulo ?? "").includes("2 tarefa"), sino5.acontecimentos[0]?.titulo)
  ok("5) badge = 1 (só o acontecimento novo pendente)", sino5.total === 1, String(sino5.total))
  ok("5) as 3 tarefas do PRIMEIRO lote continuam fora de 'novas'", loteIds.every((id) => !sino5.novas.some((n) => n.id === id)))
  ok("5) e as 2 do SEGUNDO lote também não aparecem soltas em 'novas' (já cobertas pela notificação nova)", loteIds2.every((id) => !sino5.novas.some((n) => n.id === id)))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
