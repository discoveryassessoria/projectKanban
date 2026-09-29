// scripts/migrar-sino-agrupado.ts
// ============================================================================
// MIGRAÇÃO DOS DADOS DO SINO — do modelo antigo (um aviso por tarefa) para o agrupado
// (redesenho 29/09/2026). SÓ toca `NotificacaoOperacional`: nenhuma Tarefa, nenhum
// Processo é lido para escrita.
//
//   ENSAIO (padrão, só leitura no banco; grava o BACKUP em arquivo e mostra a contagem):
//     npx tsx scripts/migrar-sino-agrupado.ts
//   APLICAR (só depois do OK, e só com o deploy do schema novo já no banco):
//     EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/migrar-sino-agrupado.ts --aplicar
//
// O ENSAIO usa SÓ colunas que já existem em produção antes do deploy (nenhuma coluna
// nova), então roda ANTES da migration SQL. O APLICAR exige as colunas novas.
//
// ─── REGRAS DE CLASSIFICAÇÃO (linha do modelo antigo, `agrupado = false`) ──────────
//   já LIDA                                → APAGAR  ("viu, saiu" — histórico não migra)
//   não lida, tarefa inexistente           → APAGAR  (órfã)
//   não lida, tarefa concluída/cancelada/
//     supersedida                          → APAGAR
//   não lida, tarefa de OUTRA pessoa
//     (desatribuída/reatribuída/sem dono)  → APAGAR
//   ATRIBUICAO/TRANSFERENCIA válida,
//     com menos de 7 dias                  → CONVERTER em CHEGOU_TRABALHO (por pessoa+família)
//   ATRIBUICAO_LOTE válida (ids na chave)  → CONVERTER em CHEGOU_TRABALHO (só os ids ainda dela)
//   PRAZO/HOJE/ATRASO/ACOMPANHAMENTO_
//     VENCIDO/RETORNO_TERCEIRO/
//     TERCEIRO_ATRASADO/EM_RISCO válida    → CONVERTER em PRECISA_AGIR (foto ATUAL da pessoa+família;
//                                             não guarda a idade do aviso antigo)
//   FASE_CONCLUIDA com menos de 7 dias     → CONVERTER em FASE_CONCLUIDA agrupada (gestor, por família)
//   DISTRIBUICAO_NECESSARIA / avisos com
//     mais de 7 dias sem clique            → APAGAR  (o cron do gestor recompõe SEM_RESPONSAVEL; expirou)
//   tipo desconhecido                      → NÃO MEXE e é reportado
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import { STATUS_TERMINAIS } from "@/lib/operacional/tarefa-canonica"
import { lerLinhasOperacionais, agruparPrecisaAgir, avaliarPrecisaAgir } from "@/lib/operacional/avisos-sino"
import { somarAoAviso, rotuloDaFamilia, SELECT_ROTULO_FAMILIA } from "@/lib/operacional/notificacao-canonica"
import { urlOperacaoDaFamilia, urlVisaoGlobalDaFamilia } from "@/lib/operacional/navegacao"

const APLICAR = process.argv.includes("--aplicar")
const DIA = 86_400_000
const agora = new Date()

const CHEGOU = new Set(["ATRIBUICAO", "TRANSFERENCIA"])
const PRECISA = new Set(["PRAZO", "HOJE", "ATRASO", "ACOMPANHAMENTO_VENCIDO", "RETORNO_TERCEIRO", "TERCEIRO_ATRASADO", "EM_RISCO"])

type Motivo = "LIDA" | "ORFA" | "TAREFA_ENCERRADA" | "TAREFA_DE_OUTRA_PESSOA" | "EXPIRADA" | "SUBSTITUIDA_PELO_CRON_DO_GESTOR" | "LOTE_SEM_NADA_VALIDO"
type Decisao =
  | { acao: "APAGAR"; motivo: Motivo }
  | { acao: "CONVERTER"; para: "CHEGOU_TRABALHO"; tarefaIds: number[]; processoId: number | null }
  | { acao: "CONVERTER"; para: "PRECISA_AGIR"; processoId: number | null }
  | { acao: "CONVERTER"; para: "FASE_CONCLUIDA"; processoId: number | null; item: string }
  | { acao: "MANTER"; motivo: "TIPO_DESCONHECIDO" }

interface Legado {
  id: number; tipo: string; destinatarioId: number; tarefaId: number | null; processoId: number | null
  chaveIdempotencia: string; lidaEm: Date | null; criadoEm: Date
}

const mascarar = (u: string) => u.replace(/:[^:@/]*@/, ":***@")

async function confirmarAmbienteV2() {
  const url = process.env.PRISMA_DATABASE_URL || ""
  const tabelas = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    AND table_name IN ('ProdutoFinanceiro','PhaseAutomationRule','TabelaValor','DomainOutbox','MotorArtefato','Pessoa','Processo')`
  console.log(`ALVO: ${mascarar(url) || "(URL do .env do projeto)"}`)
  console.log(`Teste V2 (7 tabelas-âncora): ${tabelas.length}/7`)
  if (tabelas.length !== 7) { console.error("⛔ NÃO é o V2 oficial — abortando."); process.exit(1) }
}

async function colunasNovasExistem(): Promise<boolean> {
  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'NotificacaoOperacional'
    AND column_name IN ('agrupado','contagem','tarefaIds','resumo','atualizadoEm')`
  return cols.length === 5
}

async function backup(): Promise<{ arquivo: string; linhas: number }> {
  // `SELECT *` de propósito: o backup guarda a linha inteira, tenha o banco as colunas novas ou não.
  const todas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "NotificacaoOperacional" ORDER BY id`)
  const dir = join(homedir(), ".discovery-backups")
  mkdirSync(dir, { recursive: true })
  const stamp = agora.toISOString().replace(/[:.]/g, "-")
  const arquivo = join(dir, `sino-antes-${APLICAR ? "aplicar" : "ensaio"}-${stamp}.json`)
  writeFileSync(arquivo, JSON.stringify(todas, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))
  return { arquivo, linhas: todas.length }
}

async function classificar(): Promise<{ legado: Legado[]; decisoes: Map<number, Decisao> }> {
  // SÓ colunas antigas: roda antes da migration SQL.
  const legado: Legado[] = await prisma.notificacaoOperacional.findMany({
    select: { id: true, tipo: true, destinatarioId: true, tarefaId: true, processoId: true, chaveIdempotencia: true, lidaEm: true, criadoEm: true },
    orderBy: { id: "asc" },
  })
  const paraClassificar = APLICAR
    ? legado.filter((l) => !l.chaveIdempotencia.startsWith("aviso::")) // linhas do modelo novo não se tocam
    : legado.filter((l) => !l.chaveIdempotencia.startsWith("aviso::"))

  // ids de tarefa envolvidos: coluna + ids na chave do lote
  const idsLote = (l: Legado) => {
    const m = /^notif::atribuicao_lote::u\d+::[\d-]+::([\d-]+)$/.exec(l.chaveIdempotencia)
    return m ? m[1].split("-").map(Number).filter((n) => Number.isInteger(n)) : []
  }
  const todosIds = new Set<number>()
  for (const l of paraClassificar) { if (l.tarefaId != null) todosIds.add(l.tarefaId); for (const i of idsLote(l)) todosIds.add(i) }
  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: [...todosIds] } }, select: { id: true, responsavelId: true, statusTarefa: true, processoId: true },
  })
  const porId = new Map(tarefas.map((t) => [t.id, t]))
  const valeParaEla = (id: number, dest: number) => {
    const t = porId.get(id)
    return !!t && !(STATUS_TERMINAIS as string[]).includes(t.statusTarefa) && t.responsavelId === dest
  }

  const decisoes = new Map<number, Decisao>()
  for (const l of paraClassificar) {
    const velha = agora.getTime() - l.criadoEm.getTime() > 7 * DIA
    if (l.lidaEm) { decisoes.set(l.id, { acao: "APAGAR", motivo: "LIDA" }); continue }

    if (l.tipo === "DISTRIBUICAO_NECESSARIA") { decisoes.set(l.id, { acao: "APAGAR", motivo: "SUBSTITUIDA_PELO_CRON_DO_GESTOR" }); continue }

    if (l.tipo === "FASE_CONCLUIDA") {
      if (velha) decisoes.set(l.id, { acao: "APAGAR", motivo: "EXPIRADA" })
      else decisoes.set(l.id, { acao: "CONVERTER", para: "FASE_CONCLUIDA", processoId: l.processoId, item: `legado::${l.chaveIdempotencia}` })
      continue
    }

    if (l.tipo === "ATRIBUICAO_LOTE") {
      const ids = idsLote(l).filter((id) => valeParaEla(id, l.destinatarioId))
      if (ids.length === 0) { decisoes.set(l.id, { acao: "APAGAR", motivo: "LOTE_SEM_NADA_VALIDO" }); continue }
      if (velha) { decisoes.set(l.id, { acao: "APAGAR", motivo: "EXPIRADA" }); continue }
      decisoes.set(l.id, { acao: "CONVERTER", para: "CHEGOU_TRABALHO", tarefaIds: ids, processoId: l.processoId })
      continue
    }

    if (CHEGOU.has(l.tipo) || PRECISA.has(l.tipo)) {
      const t = l.tarefaId != null ? porId.get(l.tarefaId) : undefined
      if (!t) { decisoes.set(l.id, { acao: "APAGAR", motivo: "ORFA" }); continue }
      if ((STATUS_TERMINAIS as string[]).includes(t.statusTarefa)) { decisoes.set(l.id, { acao: "APAGAR", motivo: "TAREFA_ENCERRADA" }); continue }
      if (t.responsavelId !== l.destinatarioId) { decisoes.set(l.id, { acao: "APAGAR", motivo: "TAREFA_DE_OUTRA_PESSOA" }); continue }
      if (CHEGOU.has(l.tipo)) {
        if (velha) { decisoes.set(l.id, { acao: "APAGAR", motivo: "EXPIRADA" }); continue }
        decisoes.set(l.id, { acao: "CONVERTER", para: "CHEGOU_TRABALHO", tarefaIds: [t.id], processoId: t.processoId })
      } else {
        decisoes.set(l.id, { acao: "CONVERTER", para: "PRECISA_AGIR", processoId: t.processoId })
      }
      continue
    }
    decisoes.set(l.id, { acao: "MANTER", motivo: "TIPO_DESCONHECIDO" })
  }
  return { legado: paraClassificar, decisoes }
}

async function main() {
  console.log(APLICAR ? "MIGRAÇÃO DO SINO — APLICAR\n" : "MIGRAÇÃO DO SINO — ENSAIO (nada é alterado no banco)\n")
  await confirmarAmbienteV2()

  if (APLICAR) {
    exigirConfirmacaoDeEscritaEmProducao("converter/apagar avisos do modelo antigo do sino (só NotificacaoOperacional)", "migrar-sino-agrupado")
    if (!(await colunasNovasExistem())) {
      console.error("⛔ As colunas novas de NotificacaoOperacional ainda não existem neste banco — faça o deploy da migration 20260929230000 antes."); process.exit(1)
    }
  }

  const bk = await backup()
  console.log(`BACKUP: ${bk.linhas} linha(s) → ${bk.arquivo}\n`)

  const { legado, decisoes } = await classificar()
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: [...new Set(legado.map((l) => l.destinatarioId))] } }, select: { id: true, nome: true } })
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]))

  // ── contagem por (destinatário, tipo) ────────────────────────────────────
  type Cel = { total: number; apagar: number; converter: number; manter: number; motivos: Record<string, number> }
  const tabela = new Map<string, Cel>()
  for (const l of legado) {
    const d = decisoes.get(l.id)!
    const k = `${l.destinatarioId}|${l.tipo}`
    const c = tabela.get(k) ?? { total: 0, apagar: 0, converter: 0, manter: 0, motivos: {} }
    c.total++
    if (d.acao === "APAGAR") { c.apagar++; c.motivos[d.motivo] = (c.motivos[d.motivo] ?? 0) + 1 }
    else if (d.acao === "CONVERTER") c.converter++
    else c.manter++
    tabela.set(k, c)
  }
  console.log("POR (DESTINATÁRIO, TIPO) — linhas do modelo antigo:")
  console.log("destinatário".padEnd(34), "tipo".padEnd(24), "total".padStart(6), "apagar".padStart(7), "converter".padStart(10), "manter".padStart(7), " motivos de apagar")
  for (const [k, c] of [...tabela.entries()].sort()) {
    const [dest, tipo] = k.split("|")
    console.log(`${dest} ${nome.get(Number(dest)) ?? "?"}`.padEnd(34).slice(0, 34), tipo.padEnd(24), String(c.total).padStart(6), String(c.apagar).padStart(7), String(c.converter).padStart(10), String(c.manter).padStart(7), " ", Object.entries(c.motivos).map(([m, n]) => `${m}=${n}`).join(" "))
  }
  const soma = (f: (d: Decisao) => boolean) => legado.filter((l) => f(decisoes.get(l.id)!)).length
  console.log(`\nTOTAL: ${legado.length} linhas antigas → ${soma((d) => d.acao === "APAGAR")} a APAGAR, ${soma((d) => d.acao === "CONVERTER")} a CONVERTER, ${soma((d) => d.acao === "MANTER")} a MANTER (tipo desconhecido)`)

  // ── o que nasce no modelo novo ───────────────────────────────────────────
  const chegou = new Map<string, Set<number>>()     // dest|proc → ids
  const fase = new Map<string, Set<string>>()       // dest|proc → itens
  const precisaPares = new Set<string>()            // dest|proc
  for (const l of legado) {
    const d = decisoes.get(l.id)!
    if (d.acao !== "CONVERTER") continue
    const k = `${l.destinatarioId}|${d.processoId ?? 0}`
    if (d.para === "CHEGOU_TRABALHO") chegou.set(k, new Set([...(chegou.get(k) ?? []), ...d.tarefaIds]))
    else if (d.para === "FASE_CONCLUIDA") fase.set(k, new Set([...(fase.get(k) ?? []), d.item]))
    else precisaPares.add(k)
  }
  const linhas = await lerLinhasOperacionais(agora)
  const grupos = agruparPrecisaAgir(linhas, agora).filter((g) => precisaPares.has(`${g.destinatarioId}|${g.processoId ?? 0}`))
  const rotulos = new Map<number, string | null>()
  const procIds = [...new Set([...chegou.keys(), ...fase.keys(), ...precisaPares].map((k) => Number(k.split("|")[1])).filter((n) => n > 0))]
  for (const p of await prisma.processo.findMany({ where: { id: { in: procIds } }, select: { id: true, ...SELECT_ROTULO_FAMILIA.select } })) rotulos.set(p.id, rotuloDaFamilia(p))
  const fam = (k: string) => { const p = Number(k.split("|")[1]); return p ? (rotulos.get(p) ?? `processo ${p}`) : "Tarefas avulsas" }
  const dest = (k: string) => `${k.split("|")[0]} ${nome.get(Number(k.split("|")[0])) ?? "?"}`

  console.log("\nNASCE NO MODELO NOVO:")
  for (const [k, ids] of chegou) console.log(`  CHEGOU_TRABALHO  ${dest(k).padEnd(28)} ${fam(k)} — ${ids.size} tarefa(s)`)
  for (const g of grupos) console.log(`  PRECISA_AGIR     ${`${g.destinatarioId} ${nome.get(g.destinatarioId) ?? "?"}`.padEnd(28)} ${g.familiaNome} — ${g.vencidas.length} vencida(s) · ${g.hoje.length} hoje · ${g.amanha.length} amanhã · ${g.cobrancas.length} cobrança(s)`)
  for (const [k, it] of fase) console.log(`  FASE_CONCLUIDA   ${dest(k).padEnd(28)} ${fam(k)} — ${it.size} fase(s)`)
  const semFoto = [...precisaPares].filter((k) => !grupos.some((g) => `${g.destinatarioId}|${g.processoId ?? 0}` === k))
  if (semFoto.length) console.log(`  (${semFoto.length} par(es) pessoa/família tinham aviso de prazo válido mas a foto atual está vazia → nenhum PRECISA_AGIR nasce)`)
  console.log(`\nRESUMO NOVO: ${chegou.size} CHEGOU_TRABALHO · ${grupos.length} PRECISA_AGIR · ${fase.size} FASE_CONCLUIDA`)

  if (!APLICAR) {
    console.log("\n✅ ENSAIO concluído — nada foi alterado. Backup gravado. Aguardando OK para --aplicar.")
    await prisma.$disconnect()
    return
  }

  // ═══ APLICAR ═══════════════════════════════════════════════════════════
  const apagarIds = legado.filter((l) => decisoes.get(l.id)!.acao === "APAGAR").map((l) => l.id)
  const converterIds = legado.filter((l) => decisoes.get(l.id)!.acao === "CONVERTER").map((l) => l.id)

  for (const [k, ids] of chegou) {
    const [d, p] = k.split("|").map(Number)
    await somarAoAviso(prisma, {
      tipo: "CHEGOU_TRABALHO", destinatarioId: d, processoId: p || null, familiaNome: p ? rotulos.get(p) ?? null : null,
      tarefaIds: [...ids], link: urlOperacaoDaFamilia(p || null, "fila"),
    })
  }
  for (const [k, it] of fase) {
    const [d, p] = k.split("|").map(Number)
    await somarAoAviso(prisma, {
      tipo: "FASE_CONCLUIDA", destinatarioId: d, processoId: p || null, familiaNome: p ? rotulos.get(p) ?? null : null,
      itens: [...it], link: p ? urlVisaoGlobalDaFamilia(p) : "/tarefas",
    })
  }
  // PRECISA_AGIR: a FOTO atual, só das (pessoa, família) que tinham aviso de prazo válido.
  const linhasDosPares = linhas.filter((l) => l.responsavelId != null && precisaPares.has(`${l.responsavelId}|${l.processoId ?? 0}`))
  const rPA = await avaliarPrecisaAgir({ agora, modo: "FOTO", linhas: linhasDosPares })

  for (let i = 0; i < apagarIds.length; i += 500) await prisma.notificacaoOperacional.deleteMany({ where: { id: { in: apagarIds.slice(i, i + 500) } } })
  for (let i = 0; i < converterIds.length; i += 500) await prisma.notificacaoOperacional.deleteMany({ where: { id: { in: converterIds.slice(i, i + 500) } } })

  const restantes = await prisma.notificacaoOperacional.count({ where: { agrupado: false } })
  const novos = await prisma.notificacaoOperacional.groupBy({ by: ["destinatarioId", "tipo"], where: { agrupado: true, lidaEm: null }, _count: { _all: true } })
  console.log(`\nAPLICADO: ${apagarIds.length} apagadas · ${converterIds.length} convertidas · PRECISA_AGIR criados=${rPA.criados} · legado restante=${restantes} (esperado: só 'tipo desconhecido')`)
  console.log("AVISOS NÃO LIDOS AGORA, por (destinatário, tipo):")
  for (const n of novos) console.log(`  ${n.destinatarioId} ${nome.get(n.destinatarioId) ?? ""}`.padEnd(30), n.tipo.padEnd(18), n._count._all)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1) })
