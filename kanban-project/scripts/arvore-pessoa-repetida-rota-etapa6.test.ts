// scripts/arvore-pessoa-repetida-rota-etapa6.test.ts
// ============================================================================
// ETAPA 6 (a) — GET /api/genealogy/pessoas-repetidas, PELA ROTA REAL, COM BANCO.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/arvore-pessoa-repetida-rota-etapa6.test.ts
// ============================================================================
import type { NextRequest } from "next/server"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.\n")
  process.exit(1)
}
process.env.JWT_SECRET ||= "arvore-pessoa-repetida-etapa6-segredo-de-teste-local-64-caracteres"

import { prisma } from "../src/lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { GET as rota } from "../src/app/api/genealogy/pessoas-repetidas/route"

const MARCA = "ARVREP6"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  await prisma.processo.deleteMany({ where: { id: { in: procs.map((p) => p.id) } } })
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@arvrep6.test" } } })
}

async function chamar(q: Record<string, string>, token?: string) {
  const req = new Request(`http://localhost/api/genealogy/pessoas-repetidas?${new URLSearchParams(q)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest
  Object.defineProperty(req, "nextUrl", { value: new URL(req.url) })
  const res = await rota(req)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function main() {
  await limpar()
  console.log("PESSOA PARECIDA EM OUTRO PROCESSO — rota real\n")
  const admin = await prisma.usuario.create({ data: { nome: "Admin", email: "admin@arvrep6.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: "admin@arvrep6.test", tipo: "admin" })

  const arvA = await prisma.arvore.create({ data: { nome: `${MARCA} A` }, select: { id: true } })
  const arvB = await prisma.arvore.create({ data: { nome: `${MARCA} B` }, select: { id: true } })
  const procA = await prisma.processo.create({ data: { nome: `${MARCA} processo A`, arvoreId: arvA.id }, select: { id: true } })
  const procB = await prisma.processo.create({ data: { nome: `${MARCA} processo B`, arvoreId: arvB.id }, select: { id: true } })
  const data = new Date("1950-03-09T00:00:00.000Z")
  const naA = await prisma.pessoa.create({ data: { nome: "Giuseppe", sobrenome: "Bertolazzi", data_nasc: data, arvoreId: arvA.id }, select: { id: true } })
  const naB = await prisma.pessoa.create({ data: { nome: "GIUSEPPE", sobrenome: "Bertolazi", data_nasc: data, arvoreId: arvB.id }, select: { id: true } })
  await prisma.pessoa.create({ data: { nome: "Giuseppe", sobrenome: "Bertolazzi", data_nasc: new Date("1950-03-10T00:00:00.000Z"), arvoreId: arvB.id } })
  await prisma.pessoa.create({ data: { nome: "Carlo", sobrenome: "Ferrari", data_nasc: data, arvoreId: arvB.id } })
  const consulta = { nome: "Giuseppe", sobrenome: "Bertolazzi", dataNascimento: "1950-03-09", arvoreId: String(arvA.id) }

  secao("1) permissão")
  ok("1a) sem token → 401", (await chamar(consulta)).status === 401)

  secao("2) encontra a pessoa parecida de OUTRO processo")
  const r = await chamar(consulta, token)
  ok("2a) 200", r.status === 200, String(r.status))
  const c = r.json?.candidatos ?? []
  ok("2b) só a de mesma data e nome parecido (grafia/caixa tolerados)", c.length === 1 && c[0].pessoaId === naB.id, JSON.stringify(c.map((x: { pessoaId: number }) => x.pessoaId)))
  ok("2c) devolve processo e link para a pessoa", c[0]?.processo?.id === procB.id && c[0]?.link === `/kanban?processoId=${procB.id}&pessoaId=${naB.id}`)
  ok("2d) devolve só o necessário", Object.keys(c[0] ?? {}).sort().join() === "dataNascimento,link,nome,pessoaId,processo")

  secao("3) a MESMA árvore não conta")
  const dentro = await chamar({ ...consulta, arvoreId: String(arvB.id) }, token)
  ok("3a) da árvore B, a pessoa da B some e aparece a da A", (dentro.json?.candidatos ?? []).length === 1 && dentro.json.candidatos[0].pessoaId === naA.id)

  secao("4) não consulta sem nome de 3 letras e data completa")
  ok("4a) nome curto → vazio", (await chamar({ ...consulta, nome: "Gi", sobrenome: "" }, token)).json?.candidatos?.length === 0)
  ok("4b) data incompleta → vazio", (await chamar({ ...consulta, dataNascimento: "1950-03" }, token)).json?.candidatos?.length === 0)
  ok("4c) sem arvoreId → 400", (await chamar({ ...consulta, arvoreId: "" }, token)).status === 400)

  secao("5) pessoa removida e árvore sem processo ficam de fora")
  await prisma.pessoa.update({ where: { id: naB.id }, data: { removidaEm: new Date() } })
  ok("5a) removida não aparece", (await chamar(consulta, token)).json?.candidatos?.length === 0)
  await prisma.pessoa.update({ where: { id: naB.id }, data: { removidaEm: null } })
  await prisma.processo.update({ where: { id: procB.id }, data: { arvoreId: null } })
  ok("5b) árvore sem processo → sem para onde apontar", (await chamar(consulta, token)).json?.candidatos?.length === 0)
  void procA

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
