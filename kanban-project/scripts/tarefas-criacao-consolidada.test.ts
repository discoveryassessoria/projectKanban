// scripts/tarefas-criacao-consolidada.test.ts
// ============================================================================
// UNIDADE 6 do plano de consolidação (10/09/2026) — achado real: POST
// /api/tarefas tinha `prisma.tarefa.create` PRÓPRIO — um segundo owner de
// criação de Tarefa, sem o motivo obrigatório, sem checagem de duplicidade e
// sem a auditoria canônica de `criarTarefaManual` (lib/operacional/
// tarefa-ciclo.ts). A rota foi mantida por compatibilidade externa, mas passou
// a DELEGAR para o owner único — sem `prisma.tarefa.create` próprio.
//
// Prova, pela ROTA HTTP DE VERDADE (token assinado, sem imitação):
//   1. Fonte — a rota NÃO tem `prisma.tarefa.create`/`createMany` próprio e
//      CHAMA `criarTarefaManual`.
//   2. Permissão — 401 sem token, 403 sem a permissão `tarefas.criar`.
//   3. Criação manual continua funcionando — 201, Tarefa real no banco, com
//      `origem: MANUAL` e o log de auditoria canônico (TAREFA_CRIADA_MANUAL),
//      não o log paralelo antigo.
//   4. INCOMPATIBILIDADE FECHADA (decisão do usuário, 10/09/2026): `motivo`
//      passou a ser aceito no body; sem ele, 400 explícito — não um texto
//      inventado.
//   5. Identidade/idempotência aplicável preservada — a rota força
//      `confirmarDuplicidade: true` (o contrato antigo nunca bloqueava por
//      duplicidade); duas chamadas idênticas continuam criando DUAS tarefas
//      distintas, exatamente como antes.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/tarefas-criacao-consolidada.test.ts
// ============================================================================
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import type { NextRequest } from "next/server"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.")
  console.error("   node scripts/mrg-banco-teste.mjs up\n")
  process.exit(1)
}
process.env.JWT_SECRET ||= "tarefas-criacao-consolidada-segredo-de-teste-local-64-caracteres-ok"

import { prisma } from "../src/lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { POST as rotaCriarTarefa } from "../src/app/api/tarefas/route"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const MARCA = "TARCONSOL"

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
  if (arvIds.length) await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@tarconsol.test" } } })
}

const usuario = (nome: string, tipo: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@tarconsol.test`, senha: "x", tipo }, select: { id: true, email: true, tipo: true } })

async function chamar(body: unknown, token?: string) {
  const req = new Request("http://localhost/api/tarefas", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
  const res = await rotaCriarTarefa(req)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  await limpar()
  console.log("POST /api/tarefas — CRIAÇÃO CONSOLIDADA NO OWNER ÚNICO\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) FONTE — sem criação paralela, delega para o owner canônico")
  // ══════════════════════════════════════════════════════════════════════════
  const src = readFileSync(join(RAIZ, "src/app/api/tarefas/route.ts"), "utf8")
  const semPost = src.replace(/export async function GET[\s\S]*?\n}\n\n\/\/ POST/, "// POST") // isola o handler POST
  ok("1a) a rota NÃO chama prisma.tarefa.create/createMany", !/\.tarefa\s*\.\s*(create|createMany)\s*\(/.test(semPost))
  ok("1b) a rota CHAMA criarTarefaManual (owner único)", /criarTarefaManual\(/.test(src))

  const admin = await usuario("Admin", "admin")
  const semPermissao = await usuario("SemPermissao", "assistente")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })

  const tokenAdmin = await signAuthToken({ userId: admin.id, email: `admin@tarconsol.test`, tipo: "admin" })
  const tokenSemPermissao = await signAuthToken({ userId: semPermissao.id, email: `sempermissao@tarconsol.test`, tipo: "assistente" })

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) PERMISSÃO preservada")
  // ══════════════════════════════════════════════════════════════════════════
  const semToken = await chamar({ titulo: "x", processoId: proc.id, motivo: "teste" })
  ok("2a) sem token → 401", semToken.status === 401, String(semToken.status))
  const semPerm = await chamar({ titulo: "x", processoId: proc.id, motivo: "teste" }, tokenSemPermissao)
  ok("2b) sem a permissão tarefas.criar → 403", semPerm.status === 403, String(semPerm.status))

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) CRIAÇÃO MANUAL continua funcionando — pela rota HTTP de verdade")
  // ══════════════════════════════════════════════════════════════════════════
  const r1 = await chamar({
    titulo: `${MARCA} tarefa 1`, processoId: proc.id, motivo: "necessário para o teste de contrato",
    prioridade: "ALTA", descricao: "descrição livre",
  }, tokenAdmin)
  ok("3a) 201 Created", r1.status === 201, String(r1.status))
  const tarefaId1: number | undefined = r1.json?.tarefa?.id
  ok("3b) resposta traz a Tarefa com o mesmo formato de antes (id + processo)", !!tarefaId1 && r1.json?.tarefa?.processo?.id === proc.id)
  const t1 = tarefaId1 ? await prisma.tarefa.findUnique({ where: { id: tarefaId1 } }) : null
  ok("3c) origem = MANUAL (identidade do owner canônico, não um 3º grain)", t1?.origem === "MANUAL")
  ok("3d) motivo gravado em justificativa", t1?.justificativa === "necessário para o teste de contrato")
  ok("3e) descricao passou por camposDeDominio", t1?.descricao === "descrição livre")
  const logCanonico = tarefaId1
    ? await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: tarefaId1, acao: "TAREFA_CRIADA_MANUAL" } })
    : null
  ok("3f) auditoria é a CANÔNICA (TAREFA_CRIADA_MANUAL), não um log paralelo", !!logCanonico)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) INCOMPATIBILIDADE FECHADA — motivo ausente vira 400 explícito, não texto inventado")
  // ══════════════════════════════════════════════════════════════════════════
  const semMotivo = await chamar({ titulo: `${MARCA} sem motivo`, processoId: proc.id }, tokenAdmin)
  ok("4a) sem motivo → 400 (não cria silenciosamente com motivo forjado)", semMotivo.status === 400, String(semMotivo.status))
  const semMotivoNoDb = await prisma.tarefa.findFirst({ where: { titulo: `${MARCA} sem motivo` } })
  ok("4b) nenhuma tarefa foi criada nesse caminho", !semMotivoNoDb)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) IDENTIDADE/IDEMPOTÊNCIA — duas chamadas idênticas continuam criando DUAS tarefas (comportamento antigo preservado)")
  // ══════════════════════════════════════════════════════════════════════════
  const bodyRepetido = { titulo: `${MARCA} tarefa repetida`, processoId: proc.id, motivo: "motivo repetido" }
  const rA = await chamar(bodyRepetido, tokenAdmin)
  const rB = await chamar(bodyRepetido, tokenAdmin)
  ok("5a) primeira chamada cria", rA.status === 201)
  ok("5b) segunda chamada idêntica TAMBÉM cria (confirmarDuplicidade:true preserva 'sempre cria')", rB.status === 201)
  ok("5c) são DUAS tarefas distintas", rA.json?.tarefa?.id !== rB.json?.tarefa?.id)
  const contagem = await prisma.tarefa.count({ where: { titulo: `${MARCA} tarefa repetida` } })
  ok("5d) duas linhas reais no banco", contagem === 2, String(contagem))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
