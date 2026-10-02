// scripts/arvore-criar-tarefa-etapa5.test.ts
// ============================================================================
// ETAPA 5 (c) — "CRIAR TAREFA" DA ÁRVORE, PELA PORTA CANÔNICA, COM BANCO REAL.
//
// Prova pela ROTA HTTP DE VERDADE (token assinado, sem imitação):
//   1. permissão — 401 sem token, 403 sem `tarefas.criar`;
//   2. a tarefa nasce MANUAL, com pessoa vinculada, motivo = descrição e a chave
//      de origem em `correlationId` — e `chaveIdempotencia` NULA (gates de fase
//      tratam "tem chave" como tarefa canônica do motor; manual não pode barrar fase);
//   3. IDEMPOTÊNCIA por ID canônico: o mesmo achado de origem, com tarefa aberta,
//      volta 409 com a LISTA (a UI oferece abrir a existente) e não duplica;
//   4. "criar mesmo assim" (contrato da porta) cria a segunda;
//   5. achado DIFERENTE não conflita; mesmo achado com a tarefa já CONCLUÍDA
//      também não (trabalho fechado não bloqueia trabalho novo);
//   6. a mesma pessoa com achados distintos não conflita (pessoa sozinha é sinal
//      fraco — regra antiga da porta, preservada).
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/arvore-criar-tarefa-etapa5.test.ts
// ============================================================================
import type { NextRequest } from "next/server"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.")
  console.error("   node scripts/mrg-banco-teste.mjs up\n")
  process.exit(1)
}
process.env.JWT_SECRET ||= "arvore-criar-tarefa-etapa5-segredo-de-teste-local-64-caracteres-ok"

import { prisma } from "../src/lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { POST as rotaManual } from "../src/app/api/tarefas/manual/route"
import { chaveDeOrigem, corpoDaCriacao, type RascunhoTarefa } from "../src/lib/genealogia/operacional/tarefa-do-passo"

const MARCA = "ARVTAREFA5"
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
  if (ids.length) {
    const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: { in: ["Tarefa", "TAREFA"] }, entidadeId: { in: ts.map((t) => t.id) } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@arvtarefa5.test" } } })
}

const usuario = (nome: string, tipo: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@arvtarefa5.test`, senha: "x", tipo }, select: { id: true } })

async function chamar(body: unknown, token?: string) {
  const req = new Request("http://localhost/api/tarefas/manual", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
  const res = await rotaManual(req)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  await limpar()
  console.log("ÁRVORE → CRIAR TAREFA — porta canônica, idempotência por ID\n")

  const admin = await usuario("Admin", "admin")
  const semPerm = await usuario("SemPermissao", "assistente")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Giuseppe", sobrenome: "Rossi", arvoreId: arv.id }, select: { id: true } })
  const tokenAdmin = await signAuthToken({ userId: admin.id, email: "admin@arvtarefa5.test", tipo: "admin" })
  const tokenSem = await signAuthToken({ userId: semPerm.id, email: "sempermissao@arvtarefa5.test", tipo: "assistente" })

  const rascunho = (insightId: string): RascunhoTarefa => ({
    titulo: "Completar data de nascimento — Giuseppe Rossi",
    motivo: "Giuseppe Rossi — ficha 40% completa. Faltam: Data de nascimento.",
    pessoaId: pessoa.id,
    pessoaNome: "Giuseppe Rossi",
    necessidadeId: null,
    documentoNome: null,
    chaveOrigem: chaveDeOrigem("arvore-achado", insightId),
    origemRotulo: "Próximo passo da árvore",
  })
  const corpo = (insightId: string, extra: Record<string, unknown> = {}) =>
    ({ ...corpoDaCriacao(rascunho(insightId), proc.id), ...extra })

  secao("1) permissão preservada")
  ok("1a) sem token → 401", (await chamar(corpo("lacuna-1"))).status === 401)
  ok("1b) sem tarefas.criar → 403", (await chamar(corpo("lacuna-1"), tokenSem)).status === 403)
  ok("1c) nada foi criado por quem não pode", (await prisma.tarefa.count({ where: { processoId: proc.id } })) === 0)

  secao("2) a tarefa nasce manual, vinculada à pessoa, com a origem registrada")
  const r1 = await chamar(corpo("lacuna-1"), tokenAdmin)
  ok("2a) 200 com tarefaId", r1.status === 200 && Number.isInteger(r1.json?.tarefaId), String(r1.status))
  const t1 = await prisma.tarefa.findUnique({ where: { id: r1.json.tarefaId } })
  ok("2b) origem MANUAL e processo certo", t1?.origem === "MANUAL" && t1.processoId === proc.id)
  ok("2c) pessoa vinculada", t1?.pessoaId === pessoa.id)
  ok("2d) descrição (motivo) gravada em justificativa", (t1?.justificativa ?? "").includes("Faltam: Data de nascimento"))
  ok("2e) chave de origem em correlationId", t1?.correlationId === chaveDeOrigem("arvore-achado", "lacuna-1"), t1?.correlationId ?? "")
  ok("2f) chaveIdempotencia NULA (não vira tarefa canônica do motor / gate de fase)", t1?.chaveIdempotencia === null)
  ok("2g) auditoria canônica TAREFA_CRIADA_MANUAL", !!(await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: t1!.id, acao: "TAREFA_CRIADA_MANUAL" } })))

  secao("3) IDEMPOTÊNCIA — mesmo achado com tarefa aberta: avisa, lista, não duplica")
  const r2 = await chamar(corpo("lacuna-1"), tokenAdmin)
  ok("3a) 409 CONFLITO", r2.status === 409 && r2.json?.codigo === "CONFLITO", String(r2.status))
  ok("3b) devolve a LISTA com a tarefa existente (a UI oferece 'Abrir tarefa')", Array.isArray(r2.json?.semelhantes) && r2.json.semelhantes.some((s: { tarefaId: number }) => s.tarefaId === t1!.id))
  ok("3c) nenhuma segunda tarefa foi criada", (await prisma.tarefa.count({ where: { processoId: proc.id } })) === 1)

  secao("4) 'criar mesmo assim' é o contrato da porta (pode ser trabalho novo)")
  const r3 = await chamar(corpo("lacuna-1", { confirmarDuplicidade: true }), tokenAdmin)
  ok("4a) com confirmação cria a segunda", r3.status === 200 && r3.json.tarefaId !== t1!.id)

  secao("5) alvos diferentes não conflitam")
  const r4 = await chamar(corpo("cron-parente-jovem-4-8"), tokenAdmin)
  ok("5a) outro achado, MESMA pessoa → cria (pessoa sozinha é sinal fraco)", r4.status === 200, String(r4.status))
  await prisma.tarefa.updateMany({ where: { processoId: proc.id, correlationId: chaveDeOrigem("arvore-achado", "lacuna-1") }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true } })
  const r5 = await chamar(corpo("lacuna-1"), tokenAdmin)
  ok("5b) mesmo achado com as tarefas já CONCLUÍDAS → cria (trabalho fechado não bloqueia)", r5.status === 200, String(r5.status))

  secao("6) sem chave de origem e sem necessidade não há o que comparar")
  const semNecessidade = await chamar({ ...corpoDaCriacao({ ...rascunho("x"), chaveOrigem: null }, proc.id) }, tokenAdmin)
  ok("6a) rascunho sem chave e sem necessidade não conflita com nada", semNecessidade.status === 200, String(semNecessidade.status))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
