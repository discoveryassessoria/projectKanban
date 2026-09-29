// scripts/sino-consolidacao-nao-explode-apos-lida.test.ts
// ============================================================================
// O BUG EXATO DA AUDITORIA DA GRISOTTO (18/09/2026), no sino AGRUPADO (29/09/2026):
// uma atribuição em lote gera UM aviso de família — e assim que ele é LIDO, nada pode
// reexplodir as tarefas do lote uma por uma. Antes o balde "novas" (derivado direto de
// `Tarefa.createdAt`) voltava a mostrar as tarefas do lote; agora o GET /api/notificacoes
// lê SÓ a tabela de avisos (`{ avisos, anteriores, total }`), sem baldes recalculados.
// Prova o cenário completo do mandato (itens 1-6, 19, 21):
//
//   1) atribuição individual  → 1 aviso CHEGOU_TRABALHO "1 tarefa" → badge 1
//   2) atribuição em lote     → 1 aviso "3 tarefas atribuídas a você" → badge 1
//   4) ler o aviso            → badge cai, tarefas continuam abertas
//   5) novo lote (novo acontecimento, mesma família) → aviso NOVO ("2 tarefas"),
//      nunca fundido retroativamente com o anterior já lido
//   6) deep-link do aviso aponta para a Operação da família (aba fila), nunca /kanban
//   19) o bug exato: depois de lido, o sino NUNCA mais explode em N avisos soltos para o
//       MESMO acontecimento — nem pela leitura, nem pelo resumo diário / varredura horária
//   21) badge = avisos não lidos, nunca tarefas dentro de um lote
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
import { rodarResumoDiario, rodarVarreduraHoraria } from "@/lib/operacional/avisos-sino"
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

type AvisoResp = { id: number; tipo: string; titulo: string; link: string | null; familiaId: number | null; contagem: number; lidaEm: string | null }
type Sino = { avisos: AvisoResp[]; anteriores: AvisoResp[]; total: number }

async function sinoDe(userId: number, email: string, tipo: string): Promise<Sino> {
  const token = await tokenPara(userId, email, tipo)
  const req = new Request("http://localhost/api/notificacoes?anteriores=1", { headers: { Authorization: `Bearer ${token}` } })
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

  // Prazo longe (>7 dias) de propósito: fica FORA do resumo do dia (vencidas/hoje/amanhã)
  // — só assim o teste isola o aviso de chegada, exatamente como as 3 tarefas reais da
  // Grisotto (dataPrazo a 12 dias).
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
  secao("Cenário 1 — atribuição INDIVIDUAL: 1 tarefa → 1 aviso → badge 1")
  // ══════════════════════════════════════════════════════════════════════
  const t1 = await novaTarefa("individual 1")
  const r1 = await atribuirTarefa({ tarefaId: t1, responsavelId: daniela.id, autorId: marco.id, motivo: "atribuição individual" })
  ok("1) atribuição individual sucede", r1.ok, JSON.stringify(r1))
  const sino1 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("1) exatamente 1 aviso", sino1.avisos.length === 1, String(sino1.avisos.length))
  ok("1) tipo CHEGOU_TRABALHO, '1 tarefa atribuída a você'",
    sino1.avisos[0]?.tipo === "CHEGOU_TRABALHO" && sino1.avisos[0].titulo === `${MARCA} Grisotto — 1 tarefa atribuída a você`, sino1.avisos[0]?.titulo)
  ok("1) badge = 1", sino1.total === 1, String(sino1.total))
  ok("1) o sino não traz mais baldes recalculados de Tarefa (só a tabela de avisos)",
    !("novas" in sino1) && !("vencidas" in sino1) && !("acontecimentos" in sino1) && !("proximos3Dias" in sino1), Object.keys(sino1).join(","))
  // Daniela lê — fecha o cenário 1 antes de abrir o 2.
  if (sino1.avisos[0]) await marcarNotificacaoComoLida(prisma, { notificacaoId: sino1.avisos[0].id, usuarioId: daniela.id })

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 2 — atribuição em LOTE (3 tarefas): 1 aviso de família → badge 1")
  // ══════════════════════════════════════════════════════════════════════
  const loteIds = [await novaTarefa("lote A"), await novaTarefa("lote B"), await novaTarefa("lote C")]
  const rLote = await redistribuirTarefas({ tarefaIds: loteIds, novoResponsavelId: daniela.id, autorId: marco.id, motivo: "atribuição em lote" })
  ok("2) as 3 do lote foram atribuídas", rLote.sucesso === 3, `${rLote.sucesso}/${rLote.total}`)
  const sino2 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("2) exatamente 1 aviso NOVO (o da atribuição individual já foi lido)", sino2.avisos.length === 1, String(sino2.avisos.length))
  ok("2) tipo CHEGOU_TRABALHO e a contagem cobre as 3 tarefas do lote", sino2.avisos[0]?.tipo === "CHEGOU_TRABALHO" && sino2.avisos[0].contagem === 3)
  ok("2) título consolida a família e a quantidade", sino2.avisos[0]?.titulo === `${MARCA} Grisotto — 3 tarefas atribuídas a você`, sino2.avisos[0]?.titulo)
  ok("2) badge = 1 (1 aviso, não 3 tarefas)", sino2.total === 1, String(sino2.total))
  ok("2) nenhum aviso por tarefa: as 3 do lote são representadas por UM aviso de família",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, agrupado: true, lidaEm: null, tarefaIds: { hasSome: loteIds } } })) === 1
    && (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, tarefaId: { in: loteIds } } })) === 0)
  ok("6) deep-link do aviso aponta para a Operação da família (aba fila), nunca /kanban",
    sino2.avisos[0]?.link === `/operacao?processo=${proc.id}&aba=fila`, sino2.avisos[0]?.link ?? "")

  const avisoLote = sino2.avisos[0]!

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 19 (o bug exato) — depois de lido, o sino NÃO reexplode em N avisos soltos")
  // ══════════════════════════════════════════════════════════════════════
  await marcarNotificacaoComoLida(prisma, { notificacaoId: avisoLote.id, usuarioId: daniela.id })
  const sino19 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("19) o aviso do lote não aparece mais como pendente", !sino19.avisos.some((a) => a.id === avisoLote.id))
  ok("19) ele passa para 'anteriores' (lido, dentro dos 30 dias)", sino19.anteriores.some((a) => a.id === avisoLote.id))
  ok("19) nenhuma das 3 tarefas do lote volta como aviso solto (o bug real: elas voltavam uma por uma)",
    sino19.avisos.length === 0 && (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, lidaEm: null } })) === 0,
    JSON.stringify(sino19.avisos.map((n) => n.titulo)))
  ok("19) badge cai para 0 (nenhum aviso pendente, nenhuma tarefa solta)", sino19.total === 0, String(sino19.total))
  // O motor novo também não reabre o mesmo acontecimento: prazo longe = nada a fazer hoje.
  await rodarVarreduraHoraria({ agora: new Date() })
  await rodarResumoDiario({ agora: new Date() })
  const sino19b = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("19) nem o resumo diário nem a varredura horária reabrem o lote já lido", sino19b.total === 0 && sino19b.avisos.length === 0,
    JSON.stringify(sino19b.avisos.map((n) => n.titulo)))

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 4 — ler o aviso NÃO conclui/altera as tarefas")
  // ══════════════════════════════════════════════════════════════════════
  const tarefasDoLote = await prisma.tarefa.findMany({ where: { id: { in: loteIds } }, select: { id: true, responsavelId: true, concluida: true, statusTarefa: true } })
  ok("4) as 3 continuam atribuídas à Daniela", tarefasDoLote.every((t) => t.responsavelId === daniela.id))
  ok("4) nenhuma foi concluída por ler o aviso", tarefasDoLote.every((t) => t.concluida === false))

  // ══════════════════════════════════════════════════════════════════════
  secao("Cenário 5 — um SEGUNDO lote, depois, é um aviso NOVO — nunca fundido com o anterior")
  // ══════════════════════════════════════════════════════════════════════
  const loteIds2 = [await novaTarefa("lote D"), await novaTarefa("lote E")]
  const rLote2 = await redistribuirTarefas({ tarefaIds: loteIds2, novoResponsavelId: daniela.id, autorId: marco.id, motivo: "segundo lote, depois" })
  ok("5) as 2 do segundo lote foram atribuídas", rLote2.sucesso === 2, `${rLote2.sucesso}/${rLote2.total}`)
  const sino5 = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok("5) exatamente 1 aviso NOVO (o primeiro lote continua lido, não ressuscita)", sino5.avisos.length === 1, String(sino5.avisos.length))
  ok("5) é um aviso DIFERENTE do primeiro lote (não soma no que já foi lido)", sino5.avisos[0]?.id !== avisoLote.id)
  ok("5) o título fala em 2, não em 5 nem funde com o lote anterior", sino5.avisos[0]?.titulo === `${MARCA} Grisotto — 2 tarefas atribuídas a você`, sino5.avisos[0]?.titulo)
  ok("5) badge = 1 (só o aviso novo pendente)", sino5.total === 1, String(sino5.total))
  ok("5) o primeiro lote segue intacto em 'anteriores' com as suas 3 tarefas", sino5.anteriores.some((a) => a.id === avisoLote.id && a.contagem === 3))

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
