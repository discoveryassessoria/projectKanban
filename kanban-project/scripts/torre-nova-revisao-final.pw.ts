// scripts/torre-nova-revisao-final.pw.ts — REVISÃO FINAL da Nova Torre contra o PALCO (localhost, banco efêmero). FORA da suíte crítica.
//   npx tsx scripts/torre-nova-revisao-final.pw.ts [numeros|varredura|funcoes|mobile|todas]   (padrão: todas)
// Pré-requisito: `node scripts/dev-torre-nova.mjs` vivo (lê /private/tmp/claude-501/torre-nova-dev.json). ESCREVE no palco (atribui, cobra,
// pausa… e desfaz quando existe Desfazer) — nunca contra outra coisa que não seja o palco em localhost. Relatório JSON em
// prototipo-torre/impl/revisao-final-relatorio.json.
//   numeros   — o mesmo número em Visão geral = Tarefas = Equipe = Terceiros; clique em cada cartão abre a lista com o MESMO total.
//   varredura — clica em TODO controle visível de cada aba / Detalhe / Foco (amostra de até 3 por grupo repetido) e registra o efeito;
//               texto proibido, erro de console e HTTP >= 400 inesperado em cada tela.
//   funcoes   — funções antigas: Briefing manual, Revisar o dia, Pausar/Reativar, comentário com @menção, relatórios reais, Equipe, Terceiros.
//   mobile    — 400x800 sem rolagem horizontal da página nas 7 abas e no Detalhe.
import { chromium, type Page, type BrowserContext } from "playwright"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { PrismaClient } from "@prisma/client"

const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
const base = `http://localhost:${d.porta}`
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error("só contra o palco local")
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(d.urlBanco)) throw new Error("banco do palco não é local")
mkdirSync("prototipo-torre/impl", { recursive: true })
const fase = process.argv[2] ?? "todas"
const quer = (f: string) => fase === "todas" || fase === f
/** RF_TELAS="visao,precisa,detalhe,foco" limita a varredura (permite rodar em processos paralelos); RF_TAG nomeia os arquivos de saída. */
const TELAS = (process.env.RF_TELAS ?? "visao,precisa,radar,processos,tarefas,equipe,terceiros,detalhe,foco").split(",")
const TAG = process.env.RF_TAG ? `-${process.env.RF_TAG}` : ""

const ABAS = ["visao", "precisa", "radar", "processos", "tarefas", "equipe", "terceiros"] as const
const PROIBIDOS: Array<[RegExp, string]> = [
  [/\bundefined\b/i, "undefined"], [/\bNaN\b/, "NaN"], [/\[object/i, "[object"], [/\bTODO\b/, "TODO"], [/\bexemplo\b/i, "exemplo"], [/em breve/i, "em breve"],
  [/com o cart[óo]rio/i, "Com o cartório"], [/\bning[uú][eé]m\b/i, "ninguém"], [/sem ningu[ée]m/i, "Sem ninguém"], [/Equipe e Terceiros/i, "Equipe e Terceiros"],
  [/Aguardando (o |a )?(cart[óo]rio|ju[íi]zo|consulado)/i, "Aguardando cartório/juízo/consulado (o status oficial é 'Aguardando terceiros')"],
  [/\b[A-Z]{3,}_[A-Z_]{2,}\b/, "enum cru (MAIUSCULA_COM_SUBLINHADO)"], [/\b(EMAIL|TELEFONE|WHATSAPP|OFICIO|PRESENCIAL)\b/, "canal em código cru"], [/usu[aá]rio \d+\b/i, "usuário por número"],
]
// O status oficial é 'Aguardando terceiros' (ROTULO_STATUS_TAREFA): 'Aguardando cartório/juízo/consulado' agora CONTA como falha.
const SO_REPORTAR = new Set(["usuário por número"]) // textos de auditoria gerados pelo backend (fora da Torre): reportados, não bloqueiam

const relatorio: any = { numeros: {}, divergencias: [], telas: {}, vocabulario: {}, funcoes: {}, mobile: {}, falhas: [] }
const falha = (tela: string, msg: string) => { relatorio.falhas.push({ tela, msg }); console.log(`FALHA [${tela}] ${msg}`) }
const ok = (nome: string, cond: boolean, extra = "") => { console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` — ${extra}` : ""}`); if (!cond) relatorio.falhas.push({ tela: "funcoes", msg: `${nome} ${extra}` }) }

async function novoContexto(browser: any, w = 1440, h = 900): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true })
  await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: base }])
  await ctx.addInitScript(([t, u]: any) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
  await ctx.addInitScript("window.__name = window.__name || ((f) => f)") // tsx injeta __name nas arrow functions de page.evaluate
  return ctx
}
type Eventos = { erros: string[]; escritas: string[]; downloads: string[] }
function vigiar(page: Page): Eventos {
  const ev: Eventos = { erros: [], escritas: [], downloads: [] }
  page.on("pageerror", (e) => ev.erros.push("pageerror: " + e.message))
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|_next\/image/.test(m.text())) ev.erros.push("console.error: " + m.text().slice(0, 200)) })
  page.on("response", (r) => {
    const u = r.url(); const m = r.request().method()
    if (r.status() >= 400 && u.startsWith(base) && !/_next\/(image|static)|favicon|\/__nextjs/.test(u)) ev.erros.push(`HTTP ${r.status()} ${m} ${u.replace(base, "")}`)
    if (m !== "GET" && u.includes("/api/") && r.status() < 400) ev.escritas.push(`${m} ${u.replace(base, "").split("?")[0]}`)
  })
  page.on("download", (dl) => ev.downloads.push(dl.suggestedFilename()))
  return ev
}
async function abrir(page: Page, caminho: string) {
  await page.goto(`${base}${caminho}`, { waitUntil: "domcontentloaded", timeout: 240000 })
  await page.locator(".tor, [role=tablist], button:has-text('Revisar o dia')").first().waitFor({ timeout: 90000 })
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(900)
}
const aba = (a: string) => `/torre?aba=${a}`
const txt = async (page: Page) => (await page.locator("body").innerText()).replace(/[ \t]+/g, " ")
const n = (s: string) => Number(s.replace(/[^\d]/g, ""))

function varrerTexto(tela: string, corpo: string) {
  for (const [re, nome] of PROIBIDOS) {
    const m = re.exec(corpo)
    if (!m) continue
    const ctx = corpo.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")
    ;(relatorio.vocabulario[nome] ??= []).push(`${tela}: …${ctx}…`)
    if (!SO_REPORTAR.has(nome)) falha(tela, `texto proibido "${nome}": …${ctx}…`)
  }
}

// ───────────────────────── enumeração de controles ─────────────────────────
const chave = (c: any) => `${c.tag}|${c.tipo}|${c.cls}|${c.rot.replace(/\d+([.,]\d+)?/g, "#").replace(/\s+/g, " ").slice(0, 40)}`

/** Devolve os elementos visíveis (mesma ordem da enumeração) como locators indexados — usa data-rf para marcar. */
async function marcar(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const SEL = 'button, a[href], select, [role=button], [role=tab], [role=link], [role=checkbox], summary, input:not([type=hidden]), textarea, [tabindex="0"]'
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" }
    const fora = (e: Element) => e.closest('aside:not([role=dialog]), [data-sidebar], [class*=sidebar], [class*=Sidebar], header')
    const lista = new Set<Element>()
    document.querySelectorAll(SEL).forEach((e) => lista.add(e))
    document.querySelectorAll("tr, li, div, span, p, td, h3, h4").forEach((e) => { if (getComputedStyle(e).cursor === "pointer" && !e.closest(SEL)) lista.add(e) })
    document.querySelectorAll("[data-rf]").forEach((e) => e.removeAttribute("data-rf"))
    const out: any[] = []
    let i = 0
    for (const e of lista) {
      if (!vis(e) || fora(e)) continue
      const el = e as HTMLInputElement
      const rot = ((e.getAttribute("aria-label") || (e as HTMLElement).innerText || el.value || e.getAttribute("placeholder") || e.getAttribute("title") || "") + "").replace(/\s+/g, " ").trim()
      e.setAttribute("data-rf", String(i))
      const cl = (e.className && e.className.toString()) || ""
      const ativo = e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-current") != null || /(^|[\s-_])(on|ativ[oa]?|active|sel|selected|atual)($|[\s-_])/i.test(cl) || /\bpri\b/.test(cl)
      out.push({ i, ativo, tag: e.tagName.toLowerCase(), tipo: e.getAttribute("type") || "", rot: rot.slice(0, 70), href: e.getAttribute("href") || "", desab: !!el.disabled || e.getAttribute("aria-disabled") === "true", cls: ((e.className && e.className.toString().split(" ")[0]) || "") })
      i++
    }
    return out
  })
}

async function instantaneo(page: Page): Promise<any> {
  for (let t = 0; t < 6; t++) {
    try { return await instantaneoUma(page) } catch { await page.waitForTimeout(400) } // navegação em curso: o documento troca
  }
  return { url: "?", texto: "?", dialogos: 0, toast: "", temDesfazer: false, scrollY: 0, marcados: 0 }
}
async function instantaneoUma(page: Page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    texto: document.body.innerText.replace(/\s+/g, " ").length + ":" + document.body.innerText.replace(/\s+/g, " ").slice(0, 3000) + document.body.innerText.length + "|" + Array.from(document.querySelectorAll("input,textarea,select")).map((i) => (i as HTMLInputElement).value + ((i as HTMLInputElement).checked ? "✓" : "")).join(","),
    dialogos: document.querySelectorAll("[role=dialog]").length,
    toast: (document.querySelector(".tor-toast") as HTMLElement | null)?.innerText ?? "",
    temDesfazer: !!Array.from(document.querySelectorAll(".tor-toast button")).find((b) => /Desfazer/.test((b as HTMLElement).innerText)),
    scrollY: Array.from(document.querySelectorAll("div,main,body,html")).reduce((a, e) => a + (e as HTMLElement).scrollTop, 0),
    marcados: document.querySelectorAll("input:checked").length,
  }))
}
async function fecharDialogos(page: Page): Promise<boolean> {
  for (let t = 0; t < 3; t++) {
    if ((await page.locator("[role=dialog]").count()) === 0) return true
    const dlg = page.locator("[role=dialog]").last()
    const btn = dlg.locator("button").filter({ hasText: /^(Cancelar|Fechar|Sair|Voltar|Agora não|Não|✕|×|Pular|Concluir)$/ }).first()
    if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {})
    else { await page.keyboard.press("Escape"); }
    await page.waitForTimeout(350)
  }
  return (await page.locator("[role=dialog]").count()) === 0
}

type Resultado = { tela: string; rot: string; tipo: string; efeito: string; detalhe?: string }
const resultados: Resultado[] = []

async function varrerTela(page: Page, ev: Eventos, tela: string, caminho: string, opts: { amostra?: number; pular?: RegExp } = {}) {
  const amostra = opts.amostra ?? 3
  await abrir(page, caminho)
  varrerTexto(tela, await txt(page))
  const inicial = await marcar(page)
  const grupos = new Map<string, number>()
  const plano: Array<{ c: any; ord: number; key: string }> = []
  for (const c of inicial) {
    const key = chave(c); const ord = grupos.get(key) ?? 0; grupos.set(key, ord + 1)
    if (ord < amostra) plano.push({ c, ord, key })
  }
  console.log(`\n[${tela}] ${inicial.length} controles visíveis em ${grupos.size} grupos; clicando ${plano.length}`)
  let precisaRecarregar = false
  const errosAntes = ev.erros.length
  for (const { c, ord, key } of plano) {
    const urlAgora = page.url().replace(base, "")
    if (precisaRecarregar || (urlAgora !== caminho && urlAgora !== caminho.replace("?aba=visao", ""))) { await abrir(page, caminho); precisaRecarregar = false }
    let atuais = await marcar(page)
    if (!atuais.find((a) => chave(a) === key)) { await abrir(page, caminho); atuais = await marcar(page) } // 2ª chance: a tela pode ter mudado por navegação tardia
    if (process.env.RF_VERBOSE && !atuais.find((a) => chave(a) === key)) console.log(`     (controle sumiu: ${atuais.length} controles na tela; url ${page.url().replace(base, "")})`)
    const alvo = atuais.filter((a) => chave(a) === key)[ord]
    if (process.env.RF_VERBOSE) console.log(`  → clicando [${alvo?.tag}] "${(alvo?.rot ?? c.rot)}"`)
    const r: Resultado = { tela, rot: c.rot || `(${c.tag}${c.cls ? "." + c.cls : ""})`, tipo: c.tag + (c.tipo ? `[${c.tipo}]` : ""), efeito: "" }
    if (!alvo) { r.efeito = "sumiu após ação anterior (não clicado)"; resultados.push(r); continue }
    if (opts.pular?.test(c.rot)) { r.efeito = "NÃO CLICADO (excluído da varredura; testado em 'funcoes')"; resultados.push(r); continue }
    if (alvo.desab) { r.efeito = "desabilitado (estado legítimo)"; resultados.push(r); continue }
    await page.locator(".tor-toast button[aria-label*='Fechar'], .tor-toast button:has-text('✕')").first().click({ timeout: 800 }).catch(() => {}) // toast fixo cobre o rodapé: fecha antes de clicar
    const antes = await instantaneo(page)
    const nEsc = ev.escritas.length, nDl = ev.downloads.length, nErr = ev.erros.length
    const loc = page.locator(`[data-rf="${alvo.i}"]`)
    let pagina2: Page | null = null
    const onPopup = (p: Page) => { pagina2 = p }
    page.context().on("page", onPopup)
    try {
      if (alvo.tag === "select") {
        const opcoes = await loc.locator("option").evaluateAll((os) => os.map((o: any) => ({ v: o.value, t: o.textContent, s: o.selected })))
        const outra = opcoes.find((o: any) => !o.s)
        if (!outra) { r.efeito = "select de 1 opção"; resultados.push(r); page.context().off("page", onPopup); continue }
        await loc.selectOption(outra.v, { timeout: 3000 })
      } else if (alvo.tag === "input" && /text|search|^$/.test(alvo.tipo)) {
        await loc.fill("zzqx", { timeout: 3000 })
      } else if (alvo.tag === "textarea") {
        await loc.fill("teste de varredura", { timeout: 3000 })
      } else if (alvo.tag === "input" && alvo.tipo === "file") {
        r.efeito = "input de arquivo (não clicado)"; resultados.push(r); page.context().off("page", onPopup); continue
      } else if (alvo.tag === "input" && /date|number|time/.test(alvo.tipo)) {
        r.efeito = "campo de data/número (testado na função)"; resultados.push(r); page.context().off("page", onPopup); continue
      } else {
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
        try { await loc.click({ timeout: 3000 }) } catch {
          // dev server sob carga: a tela re-renderizou entre localizar e clicar — uma 2ª tentativa depois de recarregar e relocalizar
          await abrir(page, caminho)
          const outra = (await marcar(page)).filter((a) => chave(a) === key)[ord]
          if (!outra) throw new Error("controle sumiu ao recarregar")
          await page.locator(`[data-rf="${outra.i}"]`).click({ timeout: 6000 })
        }
      }
    } catch (e: any) {
      r.efeito = "NÃO CLICÁVEL"; r.detalhe = String(e.message).split("\n").filter((l) => /Timeout|intercepts|not visible|not stable|detached|outside|disabled/.test(l)).map((l) => l.trim()).join(" | ").slice(0, 300)
      resultados.push(r); page.context().off("page", onPopup); precisaRecarregar = true; falha(tela, `controle "${r.rot}" não clicável: ${r.detalhe}`); continue
    }
    let depois = await instantaneo(page)
    for (let t = 0; t < 12; t++) { // espera até 3 s por QUALQUER efeito (navegação, modal, toast, gravação, download, texto)
      if (pagina2 || depois.url !== antes.url || depois.dialogos !== antes.dialogos || ev.escritas.length > nEsc || ev.downloads.length > nDl || depois.toast !== antes.toast || depois.texto !== antes.texto || depois.marcados !== antes.marcados || depois.scrollY !== antes.scrollY) break
      await page.waitForTimeout(250); depois = await instantaneo(page)
    }
    await page.waitForTimeout(300); depois = await instantaneo(page)
    page.context().off("page", onPopup)
    const efeitos: string[] = []
    if (pagina2) { efeitos.push(`abre nova aba ${(pagina2 as Page).url().replace(base, "")}`); await (pagina2 as Page).close().catch(() => {}) }
    if (depois.url !== antes.url) efeitos.push(`navega ${antes.url} → ${depois.url}`)
    if (depois.dialogos > antes.dialogos) efeitos.push("abre modal/gaveta")
    if (ev.escritas.length > nEsc) efeitos.push(`grava (${ev.escritas.slice(nEsc).join(", ")})`)
    if (ev.downloads.length > nDl) efeitos.push(`baixa ${ev.downloads.slice(nDl).join(", ")}`)
    if (depois.toast && depois.toast !== antes.toast) efeitos.push(`toast "${depois.toast.replace(/\s+/g, " ").slice(0, 80)}"`)
    if (!efeitos.length && depois.texto !== antes.texto) efeitos.push("filtra/atualiza a tela")
    if (!efeitos.length && depois.marcados !== antes.marcados) efeitos.push("marca/seleciona")
    if (!efeitos.length && depois.scrollY !== antes.scrollY) efeitos.push("rola a página")
    const ehLinkParaAquiMesmo = alvo.tag === "a" && c.href && (antes.url === c.href || antes.url === c.href.replace(/&amp;/g, "&"))
    r.efeito = efeitos.length ? efeitos.join(" + ") : (alvo.ativo || ehLinkParaAquiMesmo || /^Todos\d+$|^Visão geral$/.test(c.rot) ? "estado atual (reclicar o item já selecionado não muda nada)" : /^Limpar filtros$/.test(c.rot) ? "sem filtro ativo (nada a limpar; o efeito com filtro é provado nos roteiros de Tarefas/Radar/Processos)" : "SEM EFEITO")
    if (r.efeito === "SEM EFEITO") {
      falha(tela, `botão morto? "${r.rot}" (${r.tipo}${c.href ? " href=" + c.href : ""}) não produziu efeito observável`)
    }
    if (depois.dialogos > 0) varrerTexto(`${tela} › modal "${r.rot}"`, await page.locator("[role=dialog]").last().innerText().catch(() => ""))
    if (depois.toast) varrerTexto(`${tela} › toast "${r.rot}"`, depois.toast)
    if (ev.erros.length > nErr) { r.detalhe = ev.erros.slice(nErr).join(" | "); falha(tela, `erro após "${r.rot}": ${r.detalhe}`) }
    // Desfazer onde existe
    if (depois.temDesfazer && ev.escritas.length > nEsc) {
      const nE2 = ev.escritas.length
      const toastAntes = (await instantaneo(page)).toast
      await page.locator(".tor-toast button", { hasText: "Desfazer" }).first().click().catch(() => {})
      let t2 = toastAntes
      for (let t = 0; t < 24 && t2 === toastAntes; t++) { await page.waitForTimeout(250); t2 = (await instantaneo(page)).toast } // o Desfazer leva até alguns segundos no dev
      await page.waitForTimeout(400)
      r.efeito += ` + Desfazer (${ev.escritas.length > nE2 ? "gravou" : "sem chamada"}; toast "${t2.replace(/\s+/g, " ").slice(0, 60)}")`
      if (/n[ãa]o foi poss[ií]vel/i.test(t2)) falha(tela, `Desfazer de "${r.rot}" recusado: ${t2}`)
    }
    if (depois.dialogos > 0) { const fechou = await fecharDialogos(page); if (!fechou) { falha(tela, `modal de "${r.rot}" não fechou com Cancelar/Esc`); precisaRecarregar = true } }
    if (depois.url !== antes.url || ev.escritas.length > nEsc || depois.texto !== antes.texto) precisaRecarregar = true
    resultados.push(r)
  }
  const novosErros = ev.erros.slice(errosAntes)
  relatorio.telas[tela] = { controles: inicial.length, grupos: grupos.size, clicados: plano.length, semEfeito: resultados.filter((x) => x.tela === tela && x.efeito === "SEM EFEITO").length, comEfeito: resultados.filter((x) => x.tela === tela && !/SEM EFEITO|NÃO CLIC|sumiu|desabilitado|NÃO CLICADO|não clicado|testado|estado atual/.test(x.efeito)).length, erros: novosErros }
}

/** Só no banco efêmero: deixa pedidos com a cobrança vencida/de hoje, para os números "Cobranças a fazer" não serem todos 0. */
async function prepararPalco() {
  if (!/^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(d.urlBanco)) throw new Error("só o banco efêmero do palco")
  const db = new PrismaClient({ datasources: { db: { url: d.urlBanco } } })
  try {
    const execs = await db.subtaskExecution.findMany({ where: { subtaskKey: "aguardar_retorno", supersededAt: null, status: "AGUARDANDO_EXTERNO" }, orderBy: { id: "asc" }, take: 6, select: { id: true } })
    const dias = [-1, -1, 0, -3, -2, 0]
    for (const [i, e] of execs.entries()) await db.subtaskExecution.update({ where: { id: e.id }, data: { proximoAcompanhamentoEm: new Date(Date.now() + dias[i] * 86_400_000) } })
    console.log(`palco preparado: ${execs.length} pedido(s) com a cobrança vencida/de hoje`)
  } finally { await db.$disconnect() }
}

async function main() {
  await prepararPalco()
  const browser = await chromium.launch()
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)
  page.on("dialog", (dlg) => { void dlg.dismiss().catch(() => {}) })
  const ev = vigiar(page)

  // ═════════════ NÚMEROS CONSISTENTES ═════════════
  if (quer("numeros")) {
    console.log("\n===== NÚMEROS =====")
    const lerNum = async (re: RegExp, corpo: string) => { const m = re.exec(corpo); return m ? n(m[1]) : NaN }
    await abrir(page, aba("visao")); const v = await txt(page)
    const cartoes = (rot: string) => { const m = new RegExp(`${rot}\\s*\\n?\\s*([\\d.]+)`, "i").exec(v); return m ? n(m[1]) : NaN }
    const vg = {
      ativos: cartoes("PROCESSOS ATIVOS"), abertas: cartoes("TAREFAS ABERTAS"), equipe: cartoes("COM A EQUIPE"), aguard: cartoes("AGUARDANDO TERCEIROS"), semResp: cartoes("SEM RESPONSÁVEL"),
      atrasadas: await lerNum(/([\d.]+)\s*\n?\s*Atrasadas/, v), hoje: await lerNum(/([\d.]+)\s*\n?\s*Vence hoje/, v), amanha: await lerNum(/([\d.]+)\s*\n?\s*Amanhã/, v),
      prox7: await lerNum(/([\d.]+)\s*\n?\s*Próximos 7 dias/, v), semPrazo: await lerNum(/([\d.]+)\s*\n?\s*Sem prazo/, v), cobrancas: await lerNum(/([\d.]+)\s*\n?\s*Cobranças a fazer/, v),
      pdv: await lerNum(/Precisa de você · ([\d.]+)/, v),
    }
    const seloAbas = { processos: await lerNum(/Processos\s*\n?\s*(\d+)\s*\n?\s*Tarefas/, v), tarefas: await lerNum(/Tarefas\s*\n?\s*(\d+)\s*\n?\s*Equipe/, v) }
    relatorio.numeros.visao = vg; relatorio.numeros.seloAbas = seloAbas
    // Tarefas
    await abrir(page, aba("tarefas")); const t = await txt(page)
    const chip = (rot: string) => { const m = new RegExp(`${rot}\\s*\\n?\\s*([\\d.]+)`).exec(t); return m ? n(m[1]) : NaN }
    const tf = { abertas: chip("Todas as abertas"), minhas: chip("Minhas"), vencidas: chip("Vencidas"), semResp: chip("Sem responsável"), aguard: chip("Aguardando terceiros"), cobrarHoje: chip("Cobrar hoje"), bloqueadas: chip("Bloqueadas"), feito: chip("Feito"), mostrando: await lerNum(/Mostrando ([\d.]+) de/, t) }
    relatorio.numeros.tarefas = tf
    // Equipe
    await abrir(page, aba("equipe")); const e = await txt(page)
    const linhas = await page.locator("table tbody tr, .eqp-linha, .eqp-tr").count()
    relatorio.numeros.equipeLinhasDom = linhas
    const eqp = await page.evaluate(() => {
      const out: any = { ativas: 0, atrasadas: 0, aguard: 0 }
      const rows = Array.from(document.querySelectorAll("tr, [class*=eqp-row], [class*=eqp-lin]")) as HTMLElement[]
      return { rows: rows.length }
    })
    relatorio.numeros.equipeDom = eqp
    // soma das colunas ATIVAS/ATRASADAS/AGUARD por linha via texto: pega linhas de "pessoa" pelo botão Simular saída + Sem responsável
    const somaCols = await page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll("button")).filter((b) => /Simular saída/.test(b.textContent || ""))
      let a = 0, at = 0, ag = 0
      for (const b of bs) {
        let row: HTMLElement | null = b as HTMLElement
        for (let i = 0; i < 6 && row; i++) { if (row.innerText.split("\n").filter((x) => /^\d+$/.test(x.trim())).length >= 3) break; row = row.parentElement }
        const nums = (row?.innerText || "").split("\n").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
        if (nums.length >= 3) { a += nums[nums.length - 3]; at += nums[nums.length - 2]; ag += nums[nums.length - 1] }
      }
      return { a, at, ag, pessoas: bs.length }
    })
    const semDono = await lerNum(/Sem responsável[\s\S]{0,40}?([\d.]+) sem dono/, e)
    const semDonoCols = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("*")).find((x) => /sem dono$/.test((x as HTMLElement).innerText?.trim() || "") && x.children.length <= 1 && /^\d+ sem dono$/.test((x as HTMLElement).innerText.trim()))
      let row: HTMLElement | null = el as HTMLElement | null
      for (let i = 0; i < 6 && row; i++) { if (row.innerText.split("\n").filter((x) => /^\d+$/.test(x.trim())).length >= 3) break; row = row.parentElement }
      const nums = (row?.innerText || "").split("\n").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
      return nums
    })
    relatorio.numeros.equipe = { ...somaCols, semDono, semDonoCols }
    // Terceiros
    await abrir(page, aba("terceiros")); const te = await txt(page)
    const kp = await page.locator(".ter-kpi .ter-kpi-n").allInnerTexts()
    const linhasTer = await page.locator(".ter-g").count()
    relatorio.numeros.terceiros = { kpis: kp, linhasPedido: linhasTer, cobrarSelo: await lerNum(/Terceiros\s*(\d+) a cobrar/, v), cobrarTodos: await lerNum(/Cobrar todos os vencidos \((\d+)\)/, te) }
    console.log(JSON.stringify(relatorio.numeros, null, 1))
    const cmp = (nome: string, vals: Array<[string, number]>) => {
      const set = new Set(vals.map(([, x]) => x))
      if (set.size > 1) { const m = `${nome}: ${vals.map(([o, x]) => `${o}=${x}`).join(" · ")}`; relatorio.divergencias.push(m); console.log("DIVERGÊNCIA " + m) } else console.log(`ok   ${nome} = ${vals[0][1]} (${vals.map(([o]) => o).join(" = ")})`)
    }
    const eq = relatorio.numeros.equipe
    cmp("tarefas abertas", [["Visão geral", vg.abertas], ["Tarefas (chip)", tf.abertas], ["Tarefas (Mostrando)", tf.mostrando], ["selo da aba", seloAbas.tarefas], ["Equipe Σ ativas+sem dono", eq.a + (eq.semDonoCols?.[eq.semDonoCols.length - 3] ?? 0)]])
    cmp("sem responsável", [["Visão geral", vg.semResp], ["Tarefas", tf.semResp], ["Equipe", eq.semDono]])
    cmp("aguardando terceiros", [["Visão geral", vg.aguard], ["Tarefas", tf.aguard], ["Equipe Σ", eq.ag], ["Terceiros", n(kp[0] ?? "")]])
    cmp("atrasadas", [["Visão geral", vg.atrasadas], ["Tarefas (Vencidas)", tf.vencidas], ["Equipe Σ", eq.at + (eq.semDonoCols?.[eq.semDonoCols.length - 2] ?? 0)]])
    cmp("cobranças a fazer", [["Visão geral", vg.cobrancas], ["Tarefas (Cobrar hoje)", tf.cobrarHoje], ["Terceiros (para cobrar)", n(kp[4] ?? "")], ["selo Terceiros", relatorio.numeros.terceiros.cobrarSelo], ["Cobrar todos", relatorio.numeros.terceiros.cobrarTodos]])
    await abrir(page, aba("radar")); const rd = await txt(page)
    const radar = { todas: await lerNum(/Todas\s*(\d+)/, rd), criticas: await lerNum(/Críticas\s*(\d+)/, rd), precisam: await lerNum(/Precisam de alguém\s*(\d+)/, rd) }
    relatorio.numeros.radar = radar
    cmp("processos ativos × Radar 'Todas'", [["Visão geral", vg.ativos], ["Radar Todas", radar.todas]])
    cmp("processos em risco", [["Visão geral 'N em risco'", await lerNum(/(\d+) em risco/, v)], ["Radar Críticas", radar.criticas]])
    await abrir(page, aba("processos")); const pr = await txt(page)
    relatorio.numeros.processosSomaFases = (await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => /^(.+?)\s+(\d+)$/.exec((b.textContent || "").trim())).filter(Boolean).length))
    void pr
    cmp("decisões do Precisa de você", [["Visão geral (título)", vg.pdv], ["Revisar o dia (N)", await lerNum(/Revisar o dia \((\d+)\)/, v)], ["selo da aba", await lerNum(/Precisa de você\s*(\d+)/, v)]])
    // processos ativos × cabeçalho "Todos N" × selo Processos
    const todos = await lerNum(/Todos\s*(\d+)/, v)
    cmp("processos ativos", [["Visão geral", vg.ativos], ["cabeçalho Todos", todos], ["selo Processos", seloAbas.processos]])
    // cartões da Visão geral → lista com MESMO total
    await abrir(page, aba("visao"))
    const cartoesVG = [["PROCESSOS ATIVOS", "processos"], ["TAREFAS ABERTAS", "tarefas"], ["COM A EQUIPE", "tarefas"], ["AGUARDANDO TERCEIROS", "tarefas"], ["SEM RESPONSÁVEL", "tarefas"], ["Atrasadas", "tarefas"], ["Vence hoje", "tarefas"], ["Amanhã", "tarefas"], ["Próximos 7 dias", "tarefas"], ["Sem prazo", "tarefas"], ["Cobranças a fazer", "tarefas"]]
    relatorio.numeros.cliqueCartoes = []
    for (const [rot] of cartoesVG) {
      await abrir(page, aba("visao"))
      const ehAgenda = /^(Atrasadas|Vence hoje|Amanhã|Próximos 7 dias|Sem prazo|Cobranças a fazer)$/.test(rot)
      const alvo = ehAgenda ? page.locator("a.tvg-ag").filter({ hasText: rot }).first() : page.locator("button, [role=button], a, div[class*=kpi], div[class*=card]").filter({ hasText: new RegExp(`^\\s*${rot}`, "i") }).first()
      const valor = await page.evaluate((r) => {
        const els = Array.from(document.querySelectorAll("button, [role=button], a, div")).filter((e) => new RegExp(`^\\s*${r}\\s*\\n`, "i").test((e as HTMLElement).innerText || "") && ((e as HTMLElement).innerText || "").length < 140)
        const e = els[els.length - 1] as HTMLElement | undefined
        const m = e && /\n\s*([\d.]+)\s*\n/.exec((e.innerText || "") + "\n"); return m ? m[1] : null
      }, rot)
      let numeroDoCartao = valor ? n(valor) : NaN
      if (isNaN(numeroDoCartao)) { // layout "N\nRótulo" (Agenda)
        numeroDoCartao = await page.evaluate((r) => { const els = Array.from(document.querySelectorAll("button, [role=button], a, div")).filter((e) => new RegExp(`^\\s*[\\d.]+\\s*\\n\\s*${r}\\s*$`, "i").test((e as HTMLElement).innerText || "")); const e = els[els.length - 1] as HTMLElement | undefined; const m = e && /^\s*([\d.]+)/.exec(e.innerText); return m ? Number(m[1].replace(/\./g, "")) : NaN }, rot)
      }
      try {
        await alvo.click({ timeout: 4000 }); await page.waitForTimeout(1500)
        const u = page.url().replace(base, "")
        const c = await txt(page)
        const mostrando = await lerNum(/Mostrando ([\d.]+) de/, c)
        const selo = await lerNum(/Mostrando [\d.]+ de ([\d.]+)/, c)
        const radar = await lerNum(/([\d.]+) (?:processos|famílias)/i, c)
        const rec = { cartao: rot, numeroDoCartao, destino: u, mostrando, deTotal: selo, radar }
        relatorio.numeros.cliqueCartoes.push(rec)
        const lista = isNaN(selo) ? radar : selo
        const bate = rot === "PROCESSOS ATIVOS" ? numeroDoCartao >= selo : numeroDoCartao === selo
        console.log(`${bate ? "ok  " : "DIVERGÊNCIA"} cartão ${rot} = ${numeroDoCartao} → ${u} → lista "${mostrando} de ${selo}"`)
        if (!bate) relatorio.divergencias.push(`cartão "${rot}" mostra ${numeroDoCartao} mas a lista aberta (${u}) mostra ${mostrando} de ${selo}`)
        void lista
      } catch (e2: any) { falha("visao", `cartão ${rot} não clicável: ${String(e2.message).split("\n")[0]}`) }
    }
  }

  // ═════════════ VARREDURA DE CONTROLES ═════════════
  if (quer("varredura")) {
    console.log("\n===== VARREDURA =====")
    const pular = /^(Cobrar todos os vencidos|Redistribuir|Aplicar|Distribuir as|Exportar|Excel|PDF|CSV)/i
    for (const a of ABAS) {
      if (!TELAS.includes(a)) continue
      await varrerTela(page, ev, `aba ${a}`, aba(a), { amostra: 2, pular })
    }
    // Detalhe do processo e Foco
    await abrir(page, aba("radar"))
    const href = await page.locator("a[href*='/torre/processo/']").first().getAttribute("href")
    const idProc = href?.match(/processo\/(\d+)/)?.[1]
    relatorio.numeros.processoUsadoNoDetalhe = idProc
    if (!TELAS.includes("detalhe")) { /* fora desta rodada */ }
    else if (idProc) await varrerTela(page, ev, "detalhe do processo", `/torre/processo/${idProc}`, { amostra: 2, pular: /^(Pausar|Reativar|Distribuir)/ })
    else falha("radar", "nenhum link para /torre/processo/[id]")
    if (TELAS.includes("foco")) await abrir(page, aba("tarefas"))
    const foco = page.getByText("Foco ›").first()
    if (TELAS.includes("foco") && await foco.count()) {
      await foco.click(); await page.waitForTimeout(1200)
      varrerTexto("Foco", await page.locator("[role=dialog]").last().innerText().catch(() => ""))
      const botoes = await page.locator("[role=dialog]").last().locator("button, a[href]").evaluateAll((bs) => bs.map((b: any) => (b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()))
      relatorio.telas["Foco"] = { botoes }
      console.log("Foco: botões", botoes)
    }
    writeFileSync(`prototipo-torre/impl/revisao-final-varredura${TAG}.json`, JSON.stringify(resultados, null, 1))
  }

  // ═════════════ FUNÇÕES ANTIGAS (ver funcoes() abaixo) ═════════════
  if (quer("funcoes")) await funcoes(browser, page, ev)

  // ═════════════ MOBILE ═════════════
  if (quer("mobile")) {
    console.log("\n===== MOBILE 400x800 =====")
    const m = await novoContexto(browser, 400, 800)
    const p = await m.newPage(); const e2 = vigiar(p)
    await abrir(p, aba("radar"))
    const href = await p.locator("a[href*='/torre/processo/']").first().getAttribute("href")
    const alvos = [...ABAS.map((a) => aba(a)), href ?? "/torre/processo/1"]
    for (const u of alvos) {
      await abrir(p, u); await p.waitForTimeout(800)
      const r = await p.evaluate(() => {
        const todos = [document.documentElement, document.body, ...Array.from(document.querySelectorAll("div,main"))] as HTMLElement[]
        const rolaveis = todos.filter((e) => e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX) && e.clientWidth > 300).map((e) => e.className?.toString().slice(0, 40))
        return { vw: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, janelaRola: document.documentElement.scrollWidth > window.innerWidth + 1, rolaveisInternos: rolaveis }
      })
      relatorio.mobile[u] = r
      ok(`mobile ${u} sem rolagem horizontal da página`, !r.janelaRola, `doc=${r.doc} vw=${r.vw}${r.rolaveisInternos.length ? " internos=" + r.rolaveisInternos.join(",") : ""}`)
      varrerTexto(`mobile ${u}`, await txt(p))
      await p.screenshot({ path: `prototipo-torre/impl/revisao-final-mobile-${u.replace(/[^\w]+/g, "_")}.png` })
    }
    relatorio.mobileErros = e2.erros
    await m.close()
  }

  relatorio.errosGlobais = ev.erros
  writeFileSync(`prototipo-torre/impl/revisao-final-relatorio${TAG}.json`, JSON.stringify(relatorio, null, 1))
  console.log(`\nFALHAS: ${relatorio.falhas.length} · DIVERGÊNCIAS: ${relatorio.divergencias.length} · erros de console/HTTP: ${ev.erros.length}`)
  for (const e of ev.erros) console.log("  erro:", e)
  await browser.close()
  process.exit(relatorio.falhas.length ? 1 : 0)
}

// ═════════════ FUNÇÕES ANTIGAS (item 5) + HISTÓRICO/DESFAZER/JUSTIFICATIVA (item 2) ═════════════
import { execSync } from "node:child_process"
import { statSync } from "node:fs"

async function baixar(page: Page, abrirBotao: () => Promise<void>, rotulo: string, destino: string): Promise<string | null> {
  const espera = page.waitForEvent("download", { timeout: 60000 }).catch(() => null)
  await abrirBotao()
  const dl = await espera
  if (!dl) return null
  await dl.saveAs(destino)
  return dl.suggestedFilename()
}

async function funcoes(browser: any, page: Page, ev: Eventos) {
  console.log("\n===== FUNÇÕES ANTIGAS =====")
  const db = new PrismaClient({ datasources: { db: { url: d.urlBanco } } })
  const inicio = new Date()
  const scratch = process.env.RF_TMP ?? "/tmp/torre-rf"; mkdirSync(scratch, { recursive: true })
  try {
    // ── Briefing: SÓ manual
    const frio = await novoContexto(browser); const pf = await frio.newPage()
    await abrir(pf, aba("visao")); await pf.waitForTimeout(5000)
    ok("Briefing NUNCA abre sozinho (visão geral, 5 s depois do carregamento)", (await pf.locator("[role=dialog]").count()) === 0)
    await pf.getByRole("button", { name: /Briefing do dia/ }).click(); await pf.waitForTimeout(800)
    ok("Briefing abre pelo botão (manual)", (await pf.locator("[role=dialog]").count()) === 1)
    varrerTexto("Briefing", await pf.locator("[role=dialog]").innerText())
    await fecharDialogos(pf)
    ok("Briefing fecha", (await pf.locator("[role=dialog]").count()) === 0)
    // ── Revisar o dia
    await pf.getByRole("button", { name: /Revisar o dia/ }).first().click(); await pf.waitForTimeout(800)
    ok("Revisar o dia abre (tela de uma decisão por vez)", (await pf.locator("[role=dialog]").count()) >= 1)
    const dlgTxt = await pf.locator("[role=dialog]").last().innerText()
    ok("Revisar o dia mostra progresso, Pular e Sair", /\d+\s*(de|\/)\s*\d+/.test(dlgTxt) && /Pular/.test(dlgTxt) && /Sair/.test(dlgTxt), dlgTxt.slice(0, 80).replace(/\s+/g, " "))
    varrerTexto("Revisar o dia", dlgTxt)
    await pf.getByRole("button", { name: /^Sair/ }).first().click().catch(() => {}); await pf.waitForTimeout(500)
    await frio.close()

    // ── Tarefas: lote, visões salvas, Feito, Fazer agora, gaveta, Foco
    await abrir(page, aba("tarefas"))
    const cks = page.locator("button[aria-label^='Selecionar a tarefa']")
    const nck = await cks.count()
    if (nck >= 2) {
      await cks.nth(0).click(); await cks.nth(1).click(); await page.waitForTimeout(600)
      const barra = await txt(page)
      ok("seleção em lote mostra a barra de ações em lote", /selecionad/i.test(barra), (barra.match(/\d+ selecionad\w+/i) ?? [""])[0])
      const bt = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter((t) => /Atribuir|Repactuar|Vincular|Limpar sele|Cancelar sele|Cobrar|Bloquear/i.test(t)))
      ok("barra de lote tem ao menos 2 ações", bt.length >= 2, bt.slice(0, 8).join(" | "))
      await cks.nth(0).click(); await cks.nth(1).click()
    } else falha("tarefas", "sem botões de seleção em lote")
    // visão salva: salvar → aparece → excluir
    const nome = `RF ${Date.now() % 100000}`
    await page.getByRole("button", { name: "+ Salvar visão atual" }).click()
    await page.getByRole("dialog").getByLabel("Nome da visão").fill(nome)
    await page.getByRole("dialog").getByLabel("Justificativa").fill("visão de teste da revisão final")
    await page.getByRole("dialog").getByRole("button", { name: "Salvar", exact: true }).click()
    await page.getByRole("button", { name: new RegExp(nome) }).first().waitFor({ timeout: 15000 }).catch(() => {})
    ok("visão salva aparece em 'Salvas' com toast", (await page.getByRole("button", { name: new RegExp(nome) }).count()) > 0 && /Visão salva/.test(await page.locator(".tor-toast").innerText().catch(() => "")))
    await page.getByRole("button", { name: new RegExp(nome) }).first().click(); await page.waitForTimeout(500)
    page.removeAllListeners("dialog"); page.once("dialog", (dlg) => { void dlg.accept() })
    await page.getByRole("button", { name: "Excluir visão" }).click(); await page.waitForTimeout(1200)
    page.on("dialog", (dlg) => { void dlg.dismiss().catch(() => {}) })
    ok("visão salva excluída", (await page.getByRole("button", { name: new RegExp(nome) }).count()) === 0)
    // Feito
    await page.getByRole("button", { name: /^Feito/ }).first().click(); await page.waitForTimeout(1000)
    { const f = await txt(page); const chipFeito = Number((/Feito\s*\n?\s*(\d+)/.exec(f) ?? [])[1]); const lista = Number((/Concluídas nos últimos 14 dias · toda a equipe · (\d+) certid/.exec(f) ?? [])[1])
      ok("Feito lista as concluídas e o total do chip = total da lista", lista > 0 && lista === chipFeito, `chip ${chipFeito} · lista ${lista}`) }
    await abrir(page, aba("tarefas"))
    // Fazer agora
    await page.getByRole("button", { name: /Fazer agora/ }).first().click(); await page.waitForTimeout(1200)
    ok("Fazer agora abre o Modo foco", (await page.locator("[role=dialog]").count()) >= 1 || /Modo foco|Foco/.test(await txt(page)))
    await fecharDialogos(page); await abrir(page, aba("tarefas"))
    // gaveta: linha → Abrir
    await page.getByRole("button", { name: "Abrir", exact: true }).first().click(); await page.waitForTimeout(1200)
    ok("gaveta da tarefa abre", (await page.getByRole("dialog", { name: "Painel da tarefa" }).count()) === 1)
    varrerTexto("gaveta", await page.getByRole("dialog", { name: "Painel da tarefa" }).innerText().catch(() => ""))
    await fecharDialogos(page); await page.keyboard.press("Escape")
    await abrir(page, aba("tarefas"))

    // ── Modais com justificativa: <5 letras recusada; ≥5 grava no histórico; Desfazer funciona
    {
      const linha = page.locator("button", { hasText: "Adiar" }).first()
      if (await linha.count()) {
        const antesLog = await db.logAuditoria.count({ where: { criadoEm: { gte: inicio } } })
        await linha.click()
        const dlg = page.getByRole("dialog", { name: "Adiar a cobrança" })
        await dlg.waitFor({ timeout: 10000 })
        const amanha = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
        await dlg.getByLabel("Nova data").fill(amanha)
        await dlg.getByLabel("Justificativa").fill("abc")
        const eW0 = ev.escritas.length
        await dlg.getByRole("button", { name: "Adiar", exact: true }).click({ force: true }); await page.waitForTimeout(700)
        ok("justificativa < 5 letras é recusada (modal Adiar: botão inerte, nenhuma gravação)", ev.escritas.length === eW0 && (await dlg.count()) === 1 && /pelo menos 5 letras/.test(await dlg.innerText()))
        await dlg.getByLabel("Justificativa").fill("teste de revisão final")
        await dlg.getByRole("button", { name: "Adiar", exact: true }).click({ force: true }); await page.waitForTimeout(1800)
        const toastTxt = await page.locator(".tor-toast").innerText().catch(() => "")
        ok("Adiar com justificativa válida grava e mostra toast", ev.escritas.length > eW0 && /adiada/i.test(toastTxt), toastTxt.replace(/\s+/g, " "))
        const logs = await db.logAuditoria.findMany({ where: { criadoEm: { gte: inicio } }, orderBy: { id: "desc" }, take: 10 })
        const th = await db.tarefaHistorico.findMany({ orderBy: { id: "desc" }, take: 5 }).catch(() => [] as any[])
        const achou = logs.some((l) => /revisão final/i.test(JSON.stringify(l.detalhes ?? "") + l.descricao)) || th.some((h: any) => /revisão final/i.test(JSON.stringify(h)))
        ok("histórico gravado com quem/o quê/quando/justificativa (LogAuditoria ou TarefaHistorico)", achou, logs.slice(0, 3).map((l) => `${l.acao}/${l.entidade}/u${l.usuarioId}`).join(", ") + (th[0] ? " · TH:" + JSON.stringify(th[0]).slice(0, 160) : ""))
        void antesLog
        const desf = page.locator(".tor-toast button", { hasText: "Desfazer" })
        if (await desf.count()) { await desf.click(); await page.waitForTimeout(1200); ok("Desfazer do Adiar funciona", /Desfeito|desfeit/i.test(await page.locator(".tor-toast").innerText().catch(() => "")), await page.locator(".tor-toast").innerText().catch(() => "")) }
        else console.log("   (Adiar: sem Desfazer — fato histórico, ver DIVERGÊNCIAS SUGERIDAS do PROGRESSO)")
      } else console.log("   sem linha com 'Adiar' no palco agora")
    }

    // ── Radar/Processos: relatório real CSV/Excel/PDF (Processos) 
    await abrir(page, aba("processos"))
    await page.locator("button.tor-pf-rel").first().click(); await page.waitForTimeout(1000)
    for (const f of [["Exportar CSV", "csv"], ["Exportar Excel", "xlsx"], ["Exportar PDF", "pdf"]] as const) {
      const arq = `${scratch}/proc.${f[1]}`
      const nome2 = await baixar(page, async () => { await page.getByRole("button", { name: f[0], exact: true }).click() }, f[0], arq)
      if (!nome2) { falha("Processos › Relatório", `${f[0]} não baixou arquivo`); await abrir(page, aba("processos")); await page.locator("button.tor-pf-rel").first().click(); continue }
      const tam = statSync(arq).size
      let linhas = -1
      if (f[1] === "csv") linhas = readFileSync(arq, "utf8").trim().split("\n").length
      if (f[1] === "xlsx") { try { linhas = Number((execSync(`unzip -p "${arq}" xl/worksheets/sheet1.xml | grep -o "<row " | wc -l`).toString().trim())) } catch { linhas = -1 } }
      if (f[1] === "pdf") linhas = readFileSync(arq).subarray(0, 5).toString() === "%PDF-" ? 1 : 0
      ok(`Processos › Relatório ${f[1].toUpperCase()} baixa arquivo real (${nome2}, ${tam} bytes, ${f[1] === "pdf" ? "cabeçalho %PDF" : linhas + " linhas"})`, tam > 500 && (f[1] === "pdf" ? linhas === 1 : linhas > 1))
      await page.waitForTimeout(1200)
      if ((await page.locator("[role=dialog]").count()) === 0) { await page.locator("button.tor-pf-rel").first().click(); await page.waitForTimeout(800) } // exportar fecha o modal
    }
    await fecharDialogos(page)

    // ── Detalhe: relatório + pausa/reativa + @menção
    await abrir(page, aba("radar"))
    const links = await page.locator("a[href*='/torre/processo/']").evaluateAll((as) => as.map((a: any) => a.getAttribute("href")))
    const idProc = links[0]!.match(/processo\/(\d+)/)![1]
    const familia = (await page.locator(`a[href='/torre/processo/${idProc}']`).first().innerText()).split("\n")[0].trim()
    await abrir(page, `/torre/processo/${idProc}`)
    await page.getByRole("button", { name: "Relatório de controle" }).click(); await page.waitForTimeout(900)
    for (const f of [["Exportar CSV", "csv"], ["Exportar Excel", "xlsx"], ["Exportar PDF", "pdf"]] as const) {
      const arq = `${scratch}/det.${f[1]}`
      const nome2 = await baixar(page, async () => { await page.getByRole("button", { name: f[0], exact: true }).click() }, f[0], arq)
      if (!nome2) { falha("Detalhe › Relatório", `${f[0]} não baixou arquivo`); continue }
      const tam = statSync(arq).size
      let linhas = 0
      if (f[1] === "csv") linhas = readFileSync(arq, "utf8").trim().split("\n").length
      if (f[1] === "xlsx") { try { linhas = Number((execSync(`unzip -p "${arq}" xl/worksheets/sheet1.xml | grep -o "<row " | wc -l`).toString().trim())) } catch { linhas = -1 } }
      if (f[1] === "pdf") linhas = readFileSync(arq).subarray(0, 5).toString() === "%PDF-" ? 1 : 0
      ok(`Detalhe › Relatório de controle ${f[1].toUpperCase()} baixa arquivo real (${nome2}, ${tam} bytes, ${linhas} linhas)`, tam > 500 && linhas > 1 || (f[1] === "pdf" && linhas === 1 && tam > 500))
      await page.waitForTimeout(1000)
      if ((await page.locator("[role=dialog]").count()) === 0) { await page.getByRole("button", { name: "Relatório de controle" }).click(); await page.waitForTimeout(700) }
    }
    await fecharDialogos(page)
    // comentário com @menção → sino do mencionado
    const alvo = await db.usuario.findFirst({ where: { nome: { startsWith: "Daniela" } }, select: { id: true, nome: true, email: true, tipo: true } })
    const marca = `revisão final ${Date.now() % 100000}`
    await page.getByLabel("Novo comentário").fill(`@Daniela ${marca}`)
    await page.getByRole("button", { name: "Comentar", exact: true }).click(); await page.waitForTimeout(2500)
    ok("comentário com @menção aparece no Detalhe", (await page.getByText(marca).count()) > 0)
    if (alvo) {
      const { SignJWT } = await import("jose")
      const tk = await new SignJWT({ userId: alvo.id, email: alvo.email, tipo: alvo.tipo, sessaoInicio: Date.now() }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(new TextEncoder().encode(d.jwtSecretDeTeste))
      const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await ctxD.addCookies([{ name: "authToken", value: tk, url: base }])
      await ctxD.addInitScript(([t, u]: any) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [tk, { id: alvo.id, nome: alvo.nome, email: alvo.email, tipo: alvo.tipo }])
      const pd = await ctxD.newPage(); pd.setDefaultTimeout(15000)
      await pd.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 240000 }); await pd.waitForTimeout(3000) // o sino é o do cabeçalho global (a Torre pode nem estar no perfil dela)
      const sino = pd.getByRole("button", { name: /Notificações/ }).first()
      let achouMencao = false; let corpoSino = ""
      for (let t = 0; t < 4 && !achouMencao; t++) {
        await sino.click().catch(() => {}); await pd.waitForTimeout(1500)
        corpoSino = await pd.locator("body").innerText()
        achouMencao = /menç(ão|ões) a você \(a última de Marco/.test(corpoSino) && new RegExp(`Família ${familia.replace(/^Família /, "")} — \\d+ menç`).test(corpoSino)
        if (!achouMencao) { await pd.keyboard.press("Escape"); await pd.reload({ waitUntil: "domcontentloaded" }); await pd.waitForTimeout(2500) }
      }
      const mencoesBanco = await db.comentarioMencao.count({ where: { usuarioId: alvo.id } }).catch(() => -1)
      ok(`@menção aparece no sino do mencionado (${alvo.nome})`, achouMencao, `menções no banco para ele: ${mencoesBanco}`)
      await ctxD.close()
    } else falha("funcoes", "usuária Daniela não encontrada para o teste do sino")

    // ── Pausar/Reativar: some do Radar e volta
    const cont = async () => { await abrir(page, aba("radar")); return /Radar[\s\S]{0,40}/.test(await txt(page)) ? (await txt(page)).match(/Todos\s*(\d+)/)?.[1] : "?" }
    const todosAntes = await cont()
    await abrir(page, `/torre/processo/${idProc}`)
    await page.getByRole("button", { name: "Pausar processo" }).click()
    const conf = page.getByRole("button", { name: "Pausar processo" }).last()
    await page.locator("textarea").fill("abc")
    ok("Pausar: motivo < 5 letras recusado (botão desabilitado)", await conf.isDisabled())
    await page.locator("textarea").fill("pausa de revisão final")
    await conf.click(); await page.waitForSelector("text=Reativar processo", { timeout: 60000 })
    const logP = await db.logAuditoria.findFirst({ where: { criadoEm: { gte: inicio }, OR: [{ acao: { contains: "PAUS" } }, { descricao: { contains: "pausa", mode: "insensitive" } }] }, orderBy: { id: "desc" } })
    ok("pausa grava histórico (quem/o quê/quando/motivo)", !!logP && logP.usuarioId === 1 && /revisão final/.test(JSON.stringify(logP.detalhes) + logP.descricao), logP ? `${logP.acao}: ${logP.descricao.slice(0, 80)}` : "nada no LogAuditoria")
    const todosDepois = await cont()
    await abrir(page, aba("radar"))
    const aindaNoRadar = await page.locator(`a[href='/torre/processo/${idProc}']`).count()
    ok(`Pausar tira o processo do Radar (Todos ${todosAntes} → ${todosDepois}; link presente: ${aindaNoRadar})`, aindaNoRadar === 0 && Number(todosDepois) === Number(todosAntes) - 1)
    await abrir(page, `/torre/processo/${idProc}`)
    await page.getByRole("button", { name: /Reativar processo/ }).first().click(); await page.waitForTimeout(2500)
    await abrir(page, aba("radar"))
    const todosVolta = (await txt(page)).match(/Todos\s*(\d+)/)?.[1]
    ok(`Reativar devolve o processo (Todos → ${todosVolta})`, Number(todosVolta) === Number(todosAntes))
    void familia

    // ── Equipe: Mover carteira, Simular + Aplicar, Redistribuir — cada um com toast, histórico e Desfazer
    {
      await abrir(page, aba("equipe"))
      const linha = (nm: string) => page.locator(".eqp-row", { hasText: nm }).first()
      const toast = async () => (await page.locator(".tor-toast").innerText().catch(() => "")).replace(/\s+/g, " ")
      const desfazer = async (rotulo: string) => {
        const b = page.locator(".tor-toast button", { hasText: "Desfazer" })
        if (!(await b.count())) { ok(`${rotulo}: tem Desfazer`, false, "sem botão"); return }
        const antes = await toast(); await b.click()
        for (let t = 0; t < 24 && (await toast()) === antes; t++) await page.waitForTimeout(250)
        const depois = await toast()
        ok(`${rotulo}: Desfazer funciona`, /Desfeito|desfeit/i.test(depois) && !/Não foi possível/i.test(depois), depois)
      }
      // mover carteira (Lucas → Daniela)
      await linha("Lucas Ferraz").getByRole("button", { name: "Mover carteira" }).click()
      const dlgM = page.getByRole("dialog", { name: /Mover carteira · Lucas Ferraz/ })
      await dlgM.locator("select").first().selectOption({ label: "Daniela Brait" })
      await dlgM.getByRole("button", { name: "Mover", exact: true }).click()
      await page.locator(".tor-toast", { hasText: /tarefas? movidas? de Lucas Ferraz/ }).waitFor({ timeout: 60000 }).catch(() => {})
      const tm = await toast()
      ok("Mover carteira: toast 'N tarefas movidas de <nome>'", /\d+ tarefas? movidas? de Lucas Ferraz/.test(tm), tm)
      const logM = await db.logAuditoria.count({ where: { criadoEm: { gte: inicio }, usuarioId: 1, acao: { in: ["TAREFA_TRANSFERIDA", "TAREFA_ATRIBUIDA"] } } })
      ok("Mover carteira grava histórico por tarefa (quem/o quê/quando)", logM > 0, `${logM} linhas`)
      await desfazer("Mover carteira")
      // simular + aplicar
      await page.waitForTimeout(1500)
      await linha("Daniela Brait").getByRole("button", { name: "Simular saída" }).click()
      await page.getByText("Nada foi gravado").waitFor({ timeout: 30000 })
      await page.getByRole("button", { name: /^Aplicar: marcar ausência e mover carteira/ }).click()
      await page.locator(".tor-toast", { hasText: /Ausência marcada e carteira de Daniela Brait movida/ }).waitFor({ timeout: 90000 }).catch(() => {})
      const ta = await toast()
      ok("Aplicar simulação: toast 'Ausência marcada e carteira de <nome> movida'", /Ausência marcada e carteira de Daniela Brait movida/.test(ta), ta)
      const logA = await db.logAuditoria.findFirst({ where: { criadoEm: { gte: inicio }, usuarioId: 1, OR: [{ acao: { contains: "AUSENCIA" } }, { descricao: { contains: "ausência", mode: "insensitive" } }] }, orderBy: { id: "desc" } })
      ok("ausência grava histórico (quem/o quê/quando)", !!logA, logA ? `${logA.acao}: ${logA.descricao.slice(0, 90)}` : "nada")
      await desfazer("Aplicar simulação")
      await page.waitForTimeout(1500); await abrir(page, aba("equipe"))
      if (await linha("Daniela Brait").getByRole("button", { name: "Cancelar ausência" }).count()) { await linha("Daniela Brait").getByRole("button", { name: "Cancelar ausência" }).click(); await page.waitForTimeout(1500) }
      // redistribuir
      const red = page.getByRole("button", { name: "Redistribuir", exact: true })
      if (await red.count()) {
        await red.click(); await page.locator(".tor-toast").waitFor({ timeout: 90000 }).catch(() => {})
        const tr = await toast()
        ok("Redistribuir: toast com o resultado", /movidas? para|sem dono|Nenhuma|distribu/i.test(tr), tr)
        await desfazer("Redistribuir")
      } else console.log("   (Redistribuir indisponível: sem sugestão com ação no palco agora)")
    }

    // ── Sub-roteiros dos donos (cada um já cobre sua aba: Equipe, Terceiros, Precisa, Tarefas, Radar/Processos, Processo)
    for (const sub of ["equipe", "terceiros", "precisa", "tarefas", "radar-processos", "processo"]) {
      try {
        const saida = execSync(`npx tsx scripts/torre-nova-${sub}.pw.ts`, { timeout: 600000, stdio: ["ignore", "pipe", "pipe"] }).toString()
        const falhas = (saida.match(/FALHA|❌/g) ?? []).length
        ok(`sub-roteiro torre-nova-${sub}.pw.ts`, falhas === 0, falhas ? saida.split("\n").filter((l) => /FALHA|❌/.test(l)).slice(0, 4).join(" | ") : "ok")
      } catch (e: any) {
        const out = String(e.stdout ?? "") + String(e.stderr ?? "")
        ok(`sub-roteiro torre-nova-${sub}.pw.ts`, false, out.split("\n").filter((l) => /FALHA|❌|Error|rror:/.test(l)).slice(0, 4).join(" | ").slice(0, 400))
      }
    }
  } finally { await db.$disconnect() }
}

main().catch((e) => { console.error(e); process.exit(2) })
