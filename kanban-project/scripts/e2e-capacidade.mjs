// scripts/e2e-capacidade.mjs
// ============================================================================
// EQUIPES E CAPACIDADE OPERACIONAL PELO NAVEGADOR.
//
//   node scripts/e2e-capacidade.mjs <base> <saida> <tokGestor> <tokFunc>
//
// A prova que interessa é a ligação: o gestor mexe no CADASTRO e a
// RECOMENDAÇÃO muda — sem tocar em nenhuma tarefa. Se essas duas pontas não se
// falarem, a camada nova é decoração cara.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_FUNC] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function sessao(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const user = readFileSync(tokPath + ".user", "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } })
  // O /administrator é protegido por MIDDLEWARE, que lê o COOKIE — não o
  // localStorage. Um login real grava os dois; o harness também precisa.
  await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)
const get = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}
const patch = async (s, corpo) => {
  const r = await s.page.request.patch(`${BASE}/api/operacao/capacidade`, {
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, data: corpo,
  })
  return { status: r.status(), body: await r.json().catch(() => ({})) }
}

const CTX = JSON.parse(process.env.CTX_GERENCIAL ?? "{}")
const DANI = CTX.dani?.id
const SEM_DONO = CTX.tarefas?.["sem-dono"]

console.log("E2E — EQUIPES E CAPACIDADE OPERACIONAL\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§8 · A tela existe e mostra o que o gestor precisa")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/administrator?screen=opcapacity`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(4000)
const tela = await gestor.page.locator("body").innerText()
ok("§8) a área 'Equipes e capacidade operacional' abre", /capacidade operacional/i.test(tela))
for (const coluna of ["Funcionário", "Equipe(s)", "Aptidões", "Disponibilidade", "Capacidade", "Carga ativa", "Executável", "Atrasadas", "Aguardando terceiro"]) {
  ok(`§8) mostra a coluna "${coluna}"`, new RegExp(coluna.replace(/[()]/g, "\\$&"), "i").test(tela))
}
ok("§8) sem ranking nem pontuação de produtividade",
  !/ranking|produtividade|pontua[çc]/i.test(tela))
ok("§2) e diz que nada ali concede permissão", /nada aqui concede permissão/i.test(tela))
await gestor.page.screenshot({ path: `${OUT}/cap-1-tela.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§9 · O cadastro muda a RECOMENDAÇÃO — a ligação que importa")
// ═══════════════════════════════════════════════════════════════════════════
const antes = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
const eraElegivel = (antes.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)?.elegivel
ok("§9) antes, a funcionária é elegível", eraElegivel === true)

const ferias = await patch(gestor, {
  acao: "indisponibilizar", usuarioId: DANI, tipo: "FERIAS",
  inicio: new Date(Date.now() - 86400000).toISOString(),
  fim: new Date(Date.now() + 7 * 86400000).toISOString(),
  motivo: "férias de teste",
})
ok("§5) registrar férias funciona", ferias.status === 200, `HTTP ${ferias.status}`)

const durante = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
const dela = (durante.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)
ok("§I) e a recomendação muda IMEDIATAMENTE", dela?.elegivel === false)
ok("§12) com o critério de disponibilidade reprovado",
  dela?.criterios?.find((c) => c.chave === "DISPONIBILIDADE")?.veredito === "reprovado",
  dela?.criterios?.find((c) => c.chave === "DISPONIBILIDADE")?.detalhe ?? "—")
ok("§12) e o motivo em português", /férias/i.test(dela?.motivos?.[0]?.texto ?? ""),
  dela?.motivos?.[0]?.texto ?? "—")

// desfaz, e a elegibilidade volta
const lista = await get(gestor, "/api/operacao/capacidade")
const registro = (lista.body?.linhas ?? []).find((l) => l.usuarioId === DANI)?.indisponivelPor
const encerrou = await patch(gestor, { acao: "encerrar_indisponibilidade", usuarioId: DANI, indisponibilidadeId: registro?.id })
ok("§5) encerrar a indisponibilidade funciona", encerrou.status === 200)
const depois = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
ok("§I) e ela volta a ser elegível",
  (depois.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)?.elegivel === true)
const listaFinal = await get(gestor, "/api/operacao/capacidade")
ok("§5) o registro PERMANECE no histórico, com data de fim",
  ((listaFinal.body?.linhas ?? []).find((l) => l.usuarioId === DANI)?.indisponibilidades ?? []).some((i) => i.fim != null))

// ═══════════════════════════════════════════════════════════════════════════
secao("§4 · Aptidão pela fase publicada — e a regra que só liga quando declarada")
// ═══════════════════════════════════════════════════════════════════════════
const fases = lista.body?.fases ?? []
ok("§4) as fases oferecidas vêm do catálogo publicado", fases.length >= 5, `${fases.length} fases`)
ok("§4) com rótulo de gente, não chave técnica", fases.some((f) => /Emiss/i.test(f.label)))
const invalida = await patch(gestor, { acao: "aptidoes", usuarioId: DANI, faseKeys: ["fase_inventada"] })
ok("§4) e recusa fase fora do catálogo", invalida.status === 422, `HTTP ${invalida.status}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§6 · Capacidade configurável, sem número mágico")
// ═══════════════════════════════════════════════════════════════════════════
const semTeto = (lista.body?.linhas ?? []).every((l) => l.limiteExecutaveis === null)
ok("§6) por padrão ninguém tem teto — nada foi inventado", semTeto)
const teto = await patch(gestor, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: 1 })
ok("§6) definir teto funciona", teto.status === 200)
const comTeto = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
const cTeto = (comTeto.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)
  ?.criterios?.find((c) => c.chave === "CAPACIDADE")
ok("§12) o critério de capacidade passa a ser avaliado", cTeto?.veredito !== "nao_aplicavel", cTeto?.detalhe ?? "—")
await patch(gestor, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: null })
const semTetoDeNovo = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
ok("§6) remover o teto volta ao modo relativo",
  (semTetoDeNovo.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)
    ?.criterios?.find((c) => c.chave === "CAPACIDADE")?.veredito === "nao_aplicavel")

// ═══════════════════════════════════════════════════════════════════════════
secao("§2 · Segurança — a camada não é autorização, e é protegida como gestão")
// ═══════════════════════════════════════════════════════════════════════════
const proibidoLer = await get(func, "/api/operacao/capacidade")
ok("§2) funcionário comum não lê a camada", proibidoLer.status === 403, `HTTP ${proibidoLer.status}`)
const proibidoEscrever = await patch(func, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: 99 })
ok("§2) nem escreve nela por chamada direta", proibidoEscrever.status === 403, `HTTP ${proibidoEscrever.status}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§J · Nada disso tocou em tarefa nenhuma")
// ═══════════════════════════════════════════════════════════════════════════
const estado = async () => {
  const r = await get(gestor, "/api/operacao/visao-global?busca=GERENCIAL&incluirEncerradas=1")
  return JSON.stringify((r.body?.linhas ?? []).map((l) => [l.taskId, l.responsavelId, l.statusTarefa]))
}
const eA = await estado()
await get(gestor, "/api/operacao/sugestao?lote=1")
await get(gestor, "/api/operacao/capacidade")
ok("§J) nenhuma tarefa mudou de responsável ou de estado", (await estado()) === eA)
await gestor.page.screenshot({ path: `${OUT}/cap-2-final.png` })

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
