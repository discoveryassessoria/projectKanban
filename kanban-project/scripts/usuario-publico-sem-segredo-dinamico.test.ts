// scripts/usuario-publico-sem-segredo-dinamico.test.ts
//
// Incidente 30/09/2026: `GET /api/processos/{id}` devolvia `tarefas[].responsavel` com a linha INTEIRA do Usuario
// (`include: { responsavel: true }`) — hash da senha e `permissoesCustom` incluídos. Este teste FALHA se o hash, a
// chave `senha` ou `permissoesCustom` aparecerem em QUALQUER resposta JSON dos handlers GET reais.
//
// Como: banco de teste (nunca produção), usuário-responsável com hash e permissoesCustom CONHECIDOS, processo com
// tarefa dele, e um administrador que consulta. (1) As rotas mais expostas são chamadas uma a uma, com asserção
// nominal; (2) VARREDURA: todo `src/app/api/**/route.ts` que exporta GET e cujos segmentos dinâmicos são
// resolvíveis (processoId, tarefaId) é chamado e o JSON serializado é vasculhado.
//
// A varredura NÃO afrouxa: resposta 5xx ou rota que não importa não é vazamento, mas é CONTADA e o teste exige que
// a varredura tenha realmente exercitado um número mínimo de rotas — senão ela seria um teste vazio.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("usuario-publico-sem-segredo-dinamico.test.ts")

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"

const MARCA = "USRPUB"
const HASH_RESP = "$2b$10$USRPUBHASHDORESPONSAVELxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
const HASH_ADMIN = "$2b$10$USRPUBHASHDOADMINISTRADORxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
const MARCADOR_PERM = "MARCADOR_PERMISSAO_CUSTOM_SECRETA"
const MARCADOR_PERFIL = "MARCADOR_PERMISSAO_DO_PERFIL_SECRETA"

let ok = 0, falhou = 0
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; console.error(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

/** O que NUNCA pode aparecer no corpo de nenhuma resposta. */
function vazamentos(corpo: string): string[] {
  const achados: string[] = []
  if (corpo.includes(HASH_RESP)) achados.push("hash do responsável")
  if (corpo.includes(HASH_ADMIN)) achados.push("hash do administrador")
  if (/"senha"/.test(corpo)) achados.push('chave "senha"')
  if (/"senhaHash"/.test(corpo)) achados.push('chave "senhaHash"')
  if (/"permissoesCustom"/.test(corpo)) achados.push('chave "permissoesCustom"')
  if (corpo.includes(MARCADOR_PERM)) achados.push("conteúdo de permissoesCustom")
  // perfil.permissoes NÃO entra aqui: /api/perfis devolve o catálogo de perfis de propósito (não é dado de usuário).
  return achados
}

const RAIZ_API = join("src", "app", "api")
function rotas(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) rotas(p, acc)
    else if (n === "route.ts") acc.push(p)
  }
  return acc
}

/** Rotas que a varredura não chama: efeito externo/rede, autenticação em si ou app do cliente final. */
const FORA_DA_VARREDURA = /^(cron|test-db|cambio|storage|saude|auth|app|blog)(\/|$)/

async function main() {
  // ── palco ────────────────────────────────────────────────────────────────
  const mail = (q: string) => `${q}@${MARCA.toLowerCase()}.test`
  const limpar = async () => {
    const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${MARCA} ` } }, select: { id: true } })
    for (const p of procs) {
      await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
      await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
    }
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } })
    await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
    await prisma.perfil.deleteMany({ where: { nome: `${MARCA} perfil` } })
  }
  await limpar()

  const perfil = await prisma.perfil.create({ data: { nome: `${MARCA} perfil`, permissoes: { [MARCADOR_PERFIL]: true } } })
  const responsavel = await prisma.usuario.create({
    data: { nome: `${MARCA} Responsável`, email: mail("resp"), senha: HASH_RESP, tipo: "funcionario", perfilId: perfil.id, permissoesCustom: { [MARCADOR_PERM]: true } },
  })
  const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: mail("admin"), senha: HASH_ADMIN, tipo: "admin" } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id, workflowRuntime: "v2" }, select: { id: true } })
  const tarefa = await prisma.tarefa.create({
    data: { processoId: proc.id, titulo: `${MARCA} tarefa`, responsavelId: responsavel.id, statusTarefa: "NAO_INICIADA", dataPrazo: new Date(Date.now() + 5 * 86_400_000) },
    select: { id: true },
  })
  await prisma.tarefaHistorico.create({ data: { tarefaId: tarefa.id, usuarioId: responsavel.id, acao: "COMENTARIO", descricao: `${MARCA} nota` } }).catch(() => null)

  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  const req = (caminho: string) => new NextRequest(`http://localhost${caminho}`, { method: "GET", headers })

  // Sanidade do palco: sem isto o teste passaria por não ter o que vazar.
  const cru = await prisma.usuario.findUnique({ where: { id: responsavel.id } })
  check("palco: o responsável tem mesmo o hash e permissoesCustom gravados", cru?.senha === HASH_RESP && !!cru?.permissoesCustom)

  type Handler = (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>
  const carregar = async (arquivo: string): Promise<Handler | null> => {
    try {
      const mod = await import(join("..", arquivo).split(sep).join("/"))
      return typeof mod.GET === "function" ? (mod.GET as Handler) : null
    } catch { return null }
  }
  const chamar = async (h: Handler, caminho: string, params: Record<string, string>) => {
    const r = await Promise.race([
      h(req(caminho), { params: Promise.resolve(params) }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 20s")), 20_000)),
    ])
    return { status: r.status, corpo: await r.text() }
  }

  // ── 1) rotas mais expostas, nominalmente ─────────────────────────────────
  console.log("\n1) rotas mais expostas — asserção nominal")
  const expostas: Array<{ nome: string; arquivo: string; caminho: string; params?: Record<string, string>; devePassarPeloResponsavel?: boolean }> = [
    { nome: "GET /api/processos", arquivo: "src/app/api/processos/route.ts", caminho: "/api/processos", devePassarPeloResponsavel: true },
    { nome: "GET /api/processos/[id]", arquivo: "src/app/api/processos/[processoId]/route.ts", caminho: `/api/processos/${proc.id}`, params: { processoId: String(proc.id) }, devePassarPeloResponsavel: true },
    { nome: "GET /api/tarefas", arquivo: "src/app/api/tarefas/route.ts", caminho: "/api/tarefas" },
    { nome: "GET /api/operacao/tarefas", arquivo: "src/app/api/operacao/tarefas/route.ts", caminho: "/api/operacao/tarefas" },
    { nome: "GET /api/operacao/visao-global", arquivo: "src/app/api/operacao/visao-global/route.ts", caminho: "/api/operacao/visao-global" },
    { nome: "GET /api/home", arquivo: "src/app/api/home/route.ts", caminho: "/api/home" },
    { nome: "GET /api/tarefas/[id]/historico", arquivo: "src/app/api/tarefas/[tarefaId]/historico/route.ts", caminho: `/api/tarefas/${tarefa.id}/historico`, params: { tarefaId: String(tarefa.id) } },
    { nome: "GET /api/usuarios", arquivo: "src/app/api/usuarios/route.ts", caminho: "/api/usuarios?all=true" },
    { nome: "GET /api/operacao/atribuiveis", arquivo: "src/app/api/operacao/atribuiveis/route.ts", caminho: "/api/operacao/atribuiveis" },
    { nome: "GET /api/operacao/capacidade", arquivo: "src/app/api/operacao/capacidade/route.ts", caminho: "/api/operacao/capacidade" },
    { nome: "GET /api/logs", arquivo: "src/app/api/logs/route.ts", caminho: "/api/logs" },
  ]
  for (const e of expostas) {
    const h = await carregar(e.arquivo)
    if (!h) { check(`${e.nome}: handler GET importável`, false); continue }
    try {
      const { status, corpo } = await chamar(h, e.caminho, e.params ?? {})
      check(`${e.nome}: respondeu 200`, status === 200, `status=${status} ${corpo.slice(0, 120)}`)
      const v = vazamentos(corpo)
      check(`${e.nome}: sem segredo de usuário`, v.length === 0, v.join("; "))
      if (e.devePassarPeloResponsavel) {
        // Prova de que o teste vê o objeto que importa: o responsável ESTÁ na resposta, só que enxuto.
        const j = JSON.parse(corpo)
        const proc0 = e.nome.endsWith("[id]") ? j.processo : (j.processos as Array<{ id: number }>).find((p) => p.id === proc.id)
        const r0 = proc0?.tarefas?.[0]?.responsavel
        check(`${e.nome}: tarefas[].responsavel presente`, !!r0 && r0.id === responsavel.id)
        check(`${e.nome}: responsavel só tem id, nome e publicCode`, !!r0 && Object.keys(r0).sort().join(",") === "id,nome,publicCode", JSON.stringify(r0))
      }
    } catch (err) {
      check(`${e.nome}: executou`, false, String(err))
    }
  }

  // ── 2) varredura de todos os GET resolvíveis ─────────────────────────────
  console.log("\n2) varredura — todo GET de src/app/api com segmentos resolvíveis")
  const resolvedores: Record<string, string> = { processoId: String(proc.id), tarefaId: String(tarefa.id), usuarioId: String(responsavel.id) }
  let exercitadas = 0, semHandler = 0, naoResolvivel = 0, foraDaVarredura = 0
  const vazaram: string[] = []
  for (const arquivo of rotas(RAIZ_API).sort()) {
    const rel = relative(RAIZ_API, arquivo).split(sep).join("/")
    if (FORA_DA_VARREDURA.test(rel)) { foraDaVarredura++; continue }
    if (!/export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b/.test(readFileSync(arquivo, "utf8"))) continue
    const params: Record<string, string> = {}
    let resolvivel = true
    const caminho = "/api/" + rel.replace(/\/?route\.ts$/, "").split("/").filter(Boolean).map((seg) => {
      const m = /^\[(\w+)\]$/.exec(seg)
      if (!m) return seg
      const v = resolvedores[m[1]]
      if (!v) { resolvivel = false; return seg }
      params[m[1]] = v
      return v
    }).join("/")
    if (!resolvivel) { naoResolvivel++; continue }
    const h = await carregar(arquivo)
    if (!h) { semHandler++; continue }
    try {
      const { corpo } = await chamar(h, caminho, params)
      exercitadas++
      const v = vazamentos(corpo)
      if (v.length) vazaram.push(`${caminho} → ${v.join("; ")}`)
    } catch { /* erro/timeout não é vazamento; a contagem mínima abaixo impede varredura vazia */ }
  }
  console.log(`     exercitadas=${exercitadas} · fora da varredura=${foraDaVarredura} · segmento não resolvível=${naoResolvivel} · sem handler=${semHandler}`)
  for (const v of vazaram) console.error(`     VAZOU: ${v}`)
  check("varredura: NENHUMA rota GET vazou segredo de usuário", vazaram.length === 0, vazaram.join(" | "))
  check("varredura: exercitou um número relevante de rotas (não é teste vazio)", exercitadas >= 100, `exercitadas=${exercitadas}`)

  await limpar()
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
