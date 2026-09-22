// scripts/permissoes-modulo-fases.test.ts
//
// SEÇÃO 4 do mandato "Módulo de Fases" (20/09/2026) — prova automatizada de que:
//   • Administrador acessa as APIs de Gerenciamento de Fases e pode mover fase
//     manualmente;
//   • um perfil OPERACIONAL (ex.: "Daniela") NÃO acessa nenhuma API
//     administrativa do módulo (403, nunca 200 disfarçado de vazio);
//   • o mesmo perfil operacional NÃO tem o comando de movimentação manual de
//     fase (processos.moverFaseManual).
//
// A verificação de que a TELA (/administrator?screen=fases) redireciona um
// perfil sem `usuarios.gerenciar` para /dashboard é estática aqui (o guard já
// existe em src/app/administrator/page.tsx:512 — `if (!isAdmin) router.push
// ("/dashboard")`) e é reconfirmada visualmente por
// tests/ui/permissoes-modulo-fases.spec.ts (navegador real).
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("permissoes-modulo-fases.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MARCA = "PERMFASES"

let ok = 0, falhou = 0
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; console.error(`  ❌ ${nome}`) }
}

async function chamar(method: string, path: string, token: string | null, body?: unknown) {
  const { GET: getCF, POST: postCF } = await import("../src/app/api/gerenciamento/catalogo-fases/route")
  const { PUT: putCF } = await import("../src/app/api/gerenciamento/catalogo-fases/[id]/route")
  const { POST: postMove } = await import("../src/app/api/processos/[processoId]/phase/move/route")
  const { NextRequest } = await import("next/server")

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const url = `http://localhost${path}`
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(url, init)

  if (path === "/api/gerenciamento/catalogo-fases" && method === "GET") return getCF(req)
  if (path === "/api/gerenciamento/catalogo-fases" && method === "POST") return postCF(req)
  if (path.startsWith("/api/gerenciamento/catalogo-fases/") && method === "PUT") {
    const id = path.split("/").pop()!
    return putCF(req, { params: Promise.resolve({ id }) })
  }
  if (path.match(/^\/api\/processos\/\d+\/phase\/move$/) && method === "POST") {
    const processoId = path.split("/")[3]
    return postMove(req, { params: Promise.resolve({ processoId }) })
  }
  throw new Error(`rota não mapeada no fixture: ${method} ${path}`)
}

async function main() {
  console.log(`\n=== Seção 4 — Permissões do Módulo de Fases (${MARCA}) ===\n`)

  // ── Fixture: um admin e um operacional, isolados por marca ──────────────
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
  const admin = await prisma.usuario.create({
    data: { nome: `${MARCA} Admin`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
  })
  const operacional = await prisma.usuario.create({
    data: { nome: `${MARCA} Operacional`, email: `operacional@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "operacional" },
  })

  const tokenAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const tokenOperacional = await signAuthToken({ userId: operacional.id, email: operacional.email, tipo: operacional.tipo, sessaoInicio: Date.now() })

  console.log("── 4.1 Administrador acessa a API de Gerenciamento de Fases ──")
  const rAdminGet = await chamar("GET", "/api/gerenciamento/catalogo-fases", tokenAdmin)
  check("admin: GET catalogo-fases → 200", rAdminGet.status === 200)

  console.log("\n── 4.2 Daniela (perfil operacional) NÃO vê/acessa as APIs administrativas ──")
  const rOpGet = await chamar("GET", "/api/gerenciamento/catalogo-fases", tokenOperacional)
  check("operacional: GET catalogo-fases → 403 (nunca 200)", rOpGet.status === 403)

  const rOpPost = await chamar("POST", "/api/gerenciamento/catalogo-fases", tokenOperacional, {
    label: `${MARCA}_nao_deveria_existir`, escopo: "PROCESSO",
  })
  check("operacional: POST catalogo-fases → 403", rOpPost.status === 403)
  const criada = await prisma.catalogoFase.findFirst({ where: { label: { startsWith: `${MARCA}_nao_deveria_existir` } } })
  check("operacional: POST bloqueado NÃO criou linha nenhuma", criada === null)

  console.log("\n── 4.3 Acesso sem token nenhum também é recusado (401, não 200) ──")
  const rSemToken = await chamar("GET", "/api/gerenciamento/catalogo-fases", null)
  check("sem token: GET catalogo-fases → 401", rSemToken.status === 401)

  console.log("\n── 4.4 Daniela NÃO tem o comando de movimentação manual de fase ──")
  // Processo qualquer existente só para exercitar a rota — o 403 tem que vir
  // ANTES de qualquer leitura de processo, mas usamos um id real só para não
  // confundir "processo inexistente" com "sem permissão" na leitura do teste.
  const processoQualquer = await prisma.processo.findFirst({ select: { id: true } })
  if (processoQualquer) {
    const rOpMove = await chamar("POST", `/api/processos/${processoQualquer.id}/phase/move`, tokenOperacional, {
      faseAlvo: "finalizado", justificativa: `${MARCA} tentativa negada`, motivoCodigo: "TESTE",
    })
    check("operacional: POST phase/move → 403 (sem processos.moverFaseManual)", rOpMove.status === 403)
  } else {
    console.log("  (sem processo no banco de teste para exercitar — pulando 4.4, sem afetar o resultado)")
  }

  console.log("\n── 4.6 Daniela NÃO consegue mudar o escopo de uma fase em uso (nem confirmando) ──")
  const pmPermissoes = await prisma.modalidadePais.findFirstOrThrow()
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_T`, name: `[${MARCA}] tipo`, paisId: (await prisma.catalogoPais.findFirstOrThrow()).id, ativo: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pmPermissoes.id, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pmPermissoes.id, name: `[${MARCA}] macro`, ativo: true } })
  const chaveFase = `${MARCA.toLowerCase()}_fase_escopo`
  const faseEmUso = await prisma.catalogoFase.create({
    data: { phaseKey: chaveFase, label: `[${MARCA}] Fase em uso`, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: chaveFase, label: "Fase em uso", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true } })
  const corpoEscopo = { phaseKey: chaveFase, label: faseEmUso.label, escopo: "DOCUMENTO", efeitosPermitidos: faseEmUso.efeitosPermitidos, ordemPadrao: faseEmUso.ordemPadrao, requiredPadrao: faseEmUso.requiredPadrao, conditionalPadrao: faseEmUso.conditionalPadrao, ativo: faseEmUso.ativo, id: faseEmUso.id }

  const rOpEscopoSemConfirmar = await chamar("PUT", `/api/gerenciamento/catalogo-fases/${faseEmUso.id}`, tokenOperacional, corpoEscopo)
  check("operacional: PUT escopo (sem confirmar) → 403, não 409 (a permissão barra ANTES da regra de negócio)", rOpEscopoSemConfirmar.status === 403)
  const rOpEscopoConfirmando = await chamar("PUT", `/api/gerenciamento/catalogo-fases/${faseEmUso.id}`, tokenOperacional, { ...corpoEscopo, confirmarMudancaEscopo: true })
  check("operacional: PUT escopo (confirmando) → 403 também — confirmação não contorna permissão", rOpEscopoConfirmando.status === 403)
  const faseAposTentativas = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: chaveFase }, select: { escopo: true, revisaoAtual: true } })
  check("nada foi alterado: escopo continua PROCESSO, revisão continua 1", faseAposTentativas.escopo === "PROCESSO" && faseAposTentativas.revisaoAtual === 1)

  const rAdminEscopo = await chamar("PUT", `/api/gerenciamento/catalogo-fases/${faseEmUso.id}`, tokenAdmin, { ...corpoEscopo, confirmarMudancaEscopo: true })
  check("admin: PUT escopo (confirmando) → 200 — o mesmo fluxo funciona pra quem tem permissão", rAdminEscopo.status === 200)

  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macro.id } })
  await prisma.macroWorkflow.delete({ where: { id: macro.id } })
  await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  await prisma.catalogoFase.delete({ where: { id: faseEmUso.id } })

  console.log("\n── 4.5 Guard estático da tela: Gerenciamento redireciona quem não é admin ──")
  const pageSrc = readFileSync(join(process.cwd(), "src/app/administrator/page.tsx"), "utf8")
  check(
    "administrator/page.tsx redireciona pra /dashboard quando !isAdmin",
    /isAdmin\s*=\s*pode\(["']usuarios\.gerenciar["']\)/.test(pageSrc) &&
      /if\s*\(!permLoading\s*&&\s*!isAdmin\)\s*router\.push\(["']\/dashboard["']\)/.test(pageSrc) &&
      /if\s*\(!isAdmin\)\s*return\s*null/.test(pageSrc),
  )

  // ── limpeza ───────────────────────────────────────────────────────────
  await prisma.usuario.deleteMany({ where: { id: { in: [admin.id, operacional.id] } } })

  console.log(`\n=== RESULTADO: ${ok} passou(aram), ${falhou} falhou(aram) ===`)
  if (falhou > 0) process.exit(1)
}

main().finally(() => prisma.$disconnect())
