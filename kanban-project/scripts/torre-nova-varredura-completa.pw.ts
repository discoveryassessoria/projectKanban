// scripts/torre-nova-varredura-completa.pw.ts — VARREDURA COMPLETA (sem amostra) da Nova Torre contra o PALCO (localhost, banco efêmero). FORA da suíte crítica.
//   npx tsx scripts/torre-nova-varredura-completa.pw.ts <tela> [ini fim]      tela: visao|precisa|radar|processos|tarefas|equipe|terceiros|detalhe|foco
//   npx tsx scripts/torre-nova-varredura-completa.pw.ts numeros               o mesmo número entre Visão geral, Tarefas, Equipe, Terceiros e Radar + clique de cada cartão
//   npx tsx scripts/torre-nova-varredura-completa.pw.ts mobile                400x800 sem rolagem horizontal da página (7 abas + Detalhe) + vocabulário
// Clica em TODO controle visível (botão, link, chip, aba, select, checkbox, campo, linha clicável): nenhum por amostra. `ini fim` fatia a lista de
// controles (para a aba Tarefas, ~230, em lotes). ESCREVE no palco (e usa o Desfazer quando existe). Saída: prototipo-torre/impl/varredura-completa-<tela>[-ini].json
import { writeFileSync } from "node:fs"
import { chromium, novoContexto, vigiar, abrir, aba, txt, n, proibidosEm, base, IMPL, type Page, type Eventos } from "./_torre-nova-pw-comum"

const alvoTela = process.argv[2] ?? "visao"
const ini = Number(process.argv[3] ?? 0); const fim = Number(process.argv[4] ?? 100000)
const falhas: Array<{ tela: string; msg: string }> = []
const falha = (tela: string, msg: string) => { falhas.push({ tela, msg }); console.log(`FALHA [${tela}] ${msg}`) }
setTimeout(() => { console.log("WATCHDOG: 28 min sem terminar"); process.exit(3) }, 28 * 60_000).unref()

const chave = (c: any) => `${c.tag}|${c.tipo}|${c.cls}|${c.rot.replace(/\d+([.,]\d+)?/g, "#").replace(/\s+/g, " ").slice(0, 40)}`

async function marcar(page: Page, escopo: string): Promise<any[]> {
  return page.evaluate((esc) => {
    const SEL = 'button, a[href], select, [role=button], [role=tab], [role=link], [role=checkbox], summary, input:not([type=hidden]), textarea, [tabindex="0"]'
    const raiz = (esc ? document.querySelector(esc) : document) as ParentNode | null
    if (!raiz) return []
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" }
    const fora = (e: Element) => !esc && e.closest('aside:not([role=dialog]), [data-sidebar], [class*=sidebar], [class*=Sidebar], header')
    const lista = new Set<Element>()
    raiz.querySelectorAll(SEL).forEach((e) => lista.add(e))
    raiz.querySelectorAll("tr, li, div, span, p, td, h3, h4").forEach((e) => { if (getComputedStyle(e).cursor === "pointer" && !e.closest(SEL)) lista.add(e) })
    document.querySelectorAll("[data-rf]").forEach((e) => e.removeAttribute("data-rf"))
    const out: any[] = []; let i = 0
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
  }, escopo)
}
async function instantaneo(page: Page): Promise<any> {
  for (let t = 0; t < 6; t++) {
    try {
      return await page.evaluate(() => ({
        url: location.pathname + location.search,
        texto: document.body.innerText.replace(/\s+/g, " ").length + ":" + document.body.innerText.replace(/\s+/g, " ").slice(0, 3000) + document.body.innerText.length + "|" + Array.from(document.querySelectorAll("input,textarea,select")).map((i) => (i as HTMLInputElement).value + ((i as HTMLInputElement).checked ? "✓" : "")).join(","),
        dialogos: document.querySelectorAll("[role=dialog]").length,
        toast: (document.querySelector(".tor-toast, .tpr-toast") as HTMLElement | null)?.innerText ?? "",
        temDesfazer: !!Array.from(document.querySelectorAll(".tor-toast button, .tpr-toast button")).find((b) => /Desfazer/.test((b as HTMLElement).innerText)),
        scrollY: Array.from(document.querySelectorAll("div,main,body,html")).reduce((a, e) => a + (e as HTMLElement).scrollTop, 0),
        marcados: document.querySelectorAll("input:checked").length,
      }))
    } catch { await page.waitForTimeout(400) }
  }
  return { url: "?", texto: "?", dialogos: 0, toast: "", temDesfazer: false, scrollY: 0, marcados: 0 }
}
async function fecharDialogos(page: Page): Promise<boolean> {
  for (let t = 0; t < 4; t++) {
    if ((await page.locator("[role=dialog]").count()) === 0) return true
    const dlg = page.locator("[role=dialog]").last()
    const btn = dlg.locator("button").filter({ hasText: /^(Cancelar|Fechar|Sair|Voltar|Agora não|Não|✕|×|Pular|Concluir)$/ }).first()
    if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {}); else await page.keyboard.press("Escape")
    await page.waitForTimeout(350)
  }
  if ((await page.locator("[role=dialog]").count()) > 0) { await page.mouse.click(4, 4); await page.waitForTimeout(300) }
  return (await page.locator("[role=dialog]").count()) === 0
}

type Resultado = { tela: string; rot: string; tipo: string; efeito: string; categoria: "efeito" | "estado-atual" | "desabilitado" | "nao-clicado" | "falha"; detalhe?: string }

async function varrer(page: Page, ev: Eventos, tela: string, preparar: () => Promise<void>, escopo = ""): Promise<{ resumo: any; resultados: Resultado[] }> {
  const resultados: Resultado[] = []
  await preparar()
  const texto0 = await txt(page)
  for (const p of proibidosEm(texto0)) falha(tela, `texto proibido ${p}`)
  const inicial = await marcar(page, escopo)
  const grupos = new Map<string, number>(); const plano: Array<{ c: any; ord: number; key: string }> = []
  for (const c of inicial) { const key = chave(c); const ord = grupos.get(key) ?? 0; grupos.set(key, ord + 1); plano.push({ c, ord, key }) }
  const fatia = plano.slice(ini, fim)
  console.log(`[${tela}] ${inicial.length} controles visíveis em ${grupos.size} grupos; clicando ${fatia.length} (${ini}..${Math.min(fim, plano.length)})`)
  const errosAntes = ev.erros.length
  let reload = false; let k = 0
  for (const { c, ord, key } of fatia) {
    k++
    if (k % 20 === 0) console.log(`   … ${k}/${fatia.length}`)
    const r: Resultado = { tela, rot: c.rot || `(${c.tag}${c.cls ? "." + c.cls : ""})`, tipo: c.tag + (c.tipo ? `[${c.tipo}]` : ""), efeito: "", categoria: "efeito" }
    const push = () => resultados.push(r)
    try {
      if (reload) { await preparar(); reload = false }
      let atuais = await marcar(page, escopo)
      if (!atuais.find((a) => chave(a) === key)) { await preparar(); atuais = await marcar(page, escopo) }
      const alvo = atuais.filter((a) => chave(a) === key)[ord]
      if (!alvo) { r.efeito = "sumiu após ação anterior (a lista mudou: o controle não existe mais no estado atual)"; r.categoria = "nao-clicado"; push(); continue }
      if (alvo.desab) { r.efeito = "desabilitado (estado legítimo)"; r.categoria = "desabilitado"; push(); continue }
      await page.locator(".tor-toast button[aria-label*='Fechar'], .tpr-toast button[aria-label*='Fechar']").first().click({ timeout: 600 }).catch(() => {})
      const antes = await instantaneo(page)
      const nEsc = ev.escritas.length, nDl = ev.downloads.length, nErr = ev.erros.length
      const loc = page.locator(`[data-rf="${alvo.i}"]`)
      let pagina2: Page | null = null
      const onPopup = (p: Page) => { pagina2 = p }
      page.context().on("page", onPopup)
      try {
        if (alvo.tag === "select") {
          const opcoes = await loc.locator("option").evaluateAll((os) => os.map((o: any) => ({ v: o.value, s: o.selected })))
          const outra = opcoes.find((o: any) => !o.s)
          if (!outra) { r.efeito = "select com uma só opção (nada a trocar)"; r.categoria = "estado-atual"; push(); page.context().off("page", onPopup); continue }
          await loc.selectOption(outra.v, { timeout: 8000 })
        } else if (alvo.tag === "input" && /text|search|^$/.test(alvo.tipo)) await loc.fill("zzqx", { timeout: 8000 })
        else if (alvo.tag === "textarea") await loc.fill("teste de varredura", { timeout: 8000 })
        else if (alvo.tag === "input" && alvo.tipo === "file") { r.efeito = "input de arquivo: abre o seletor do sistema operacional (não automatizável aqui)"; r.categoria = "nao-clicado"; push(); page.context().off("page", onPopup); continue }
        else if (alvo.tag === "input" && /date|number|time/.test(alvo.tipo)) await loc.fill(alvo.tipo === "date" ? "2026-12-01" : "3", { timeout: 8000 })
        else { await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {}); await loc.click({ timeout: 8000 }) }
      } catch (e: any) {
        page.context().off("page", onPopup)
        r.efeito = "NÃO CLICÁVEL"; r.categoria = "falha"; r.detalhe = String(e.message).split("\n").filter((l) => /Timeout|intercepts|not visible|not stable|detached|outside|disabled/.test(l)).map((l) => l.trim()).join(" | ").slice(0, 240)
        push(); reload = true; falha(tela, `controle "${r.rot}" não clicável: ${r.detalhe}`); continue
      }
      let depois = await instantaneo(page)
      for (let t = 0; t < 12; t++) {
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
      if (depois.toast && depois.toast !== antes.toast) efeitos.push(`toast "${depois.toast.replace(/\s+/g, " ").slice(0, 70)}"`)
      if (!efeitos.length && depois.texto !== antes.texto) efeitos.push("filtra/atualiza a tela")
      if (!efeitos.length && depois.marcados !== antes.marcados) efeitos.push("marca/seleciona")
      if (!efeitos.length && depois.scrollY !== antes.scrollY) efeitos.push("rola a página")
      const linkAquiMesmo = alvo.tag === "a" && c.href && (antes.url === c.href || antes.url === c.href.replace(/&amp;/g, "&"))
      if (efeitos.length) r.efeito = efeitos.join(" + ")
      else if (alvo.ativo || linkAquiMesmo || /^Todos\d+$|^Visão geral$/.test(c.rot)) { r.efeito = "estado atual (reclicar o item já selecionado não muda nada)"; r.categoria = "estado-atual" }
      else if (/^Limpar filtros$/.test(c.rot)) { r.efeito = "sem filtro ativo (nada a limpar)"; r.categoria = "estado-atual" }
      else { r.efeito = "SEM EFEITO"; r.categoria = "falha"; falha(tela, `botão morto? "${r.rot}" (${r.tipo}${c.href ? " href=" + c.href : ""}) sem efeito observável`) }
      if (depois.dialogos > 0) for (const p of proibidosEm(await page.locator("[role=dialog]").last().innerText().catch(() => ""))) falha(tela, `modal de "${r.rot}": texto proibido ${p}`)
      if (depois.toast) for (const p of proibidosEm(depois.toast)) falha(tela, `toast de "${r.rot}": texto proibido ${p}`)
      if (ev.erros.length > nErr) { r.detalhe = ev.erros.slice(nErr).join(" | "); r.categoria = "falha"; falha(tela, `erro após "${r.rot}": ${r.detalhe}`) }
      if (depois.temDesfazer && ev.escritas.length > nEsc) {
        const nE2 = ev.escritas.length; const toastAntes = (await instantaneo(page)).toast
        await page.locator(".tor-toast button, .tpr-toast button", { hasText: "Desfazer" }).first().click().catch(() => {})
        let t2 = toastAntes
        for (let t = 0; t < 24 && t2 === toastAntes; t++) { await page.waitForTimeout(250); t2 = (await instantaneo(page)).toast }
        await page.waitForTimeout(400)
        r.efeito += ` + Desfazer (${ev.escritas.length > nE2 ? "gravou" : "sem chamada"}; "${t2.replace(/\s+/g, " ").slice(0, 50)}")`
        if (/n[ãa]o foi poss[ií]vel/i.test(t2)) { r.categoria = "falha"; falha(tela, `Desfazer de "${r.rot}" recusado: ${t2}`) }
      }
      if (depois.dialogos > antes.dialogos) { if (!(await fecharDialogos(page))) { falha(tela, `modal de "${r.rot}" não fechou`); reload = true } }
      if (depois.url !== antes.url || ev.escritas.length > nEsc || depois.texto !== antes.texto) reload = true
      push()
    } catch (e: any) { r.efeito = "ERRO DO ROTEIRO: " + String(e.message).split("\n")[0].slice(0, 160); r.categoria = "falha"; push(); falha(tela, `${r.rot}: ${r.efeito}`); reload = true }
  }
  const por = (c: Resultado["categoria"]) => resultados.filter((x) => x.categoria === c).length
  const resumo = { tela, visiveis: inicial.length, grupos: grupos.size, planejados: fatia.length, clicados: resultados.filter((x) => !["nao-clicado", "desabilitado"].includes(x.categoria)).length, comEfeito: por("efeito"), estadoAtual: por("estado-atual"), desabilitados: por("desabilitado"), naoClicados: por("nao-clicado"), falhas: por("falha"), errosConsole: ev.erros.slice(errosAntes) }
  return { resumo, resultados }
}

async function idDoDetalhe(page: Page): Promise<string> {
  await abrir(page, aba("radar"))
  const href = await page.locator("a[href*='/torre/processo/']").first().getAttribute("href")
  return href ?? "/torre/processo/1"
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await novoContexto(browser); const page = await ctx.newPage(); page.setDefaultTimeout(30000)
  page.on("dialog", (dlg) => { void dlg.dismiss().catch(() => {}) })
  const ev = vigiar(page)
  if (["visao", "precisa", "radar", "processos", "tarefas", "equipe", "terceiros"].includes(alvoTela)) {
    const r = await varrer(page, ev, alvoTela, () => abrir(page, aba(alvoTela)))
    saida(r)
  } else if (alvoTela === "detalhe") {
    const url = await idDoDetalhe(page)
    const r = await varrer(page, ev, "detalhe", () => abrir(page, url)); saida(r)
  } else if (alvoTela === "foco") {
    const preparar = async () => { await abrir(page, aba("tarefas")); await page.getByRole("button", { name: "Foco ›" }).first().click(); await page.locator("[role=dialog][aria-label='Foco da família']").waitFor({ timeout: 30000 }); await page.waitForTimeout(1500) }
    const r = await varrer(page, ev, "foco", preparar, "[role=dialog][aria-label='Foco da família']"); saida(r)
  } else if (alvoTela === "numeros") await numeros(page)
  else if (alvoTela === "mobile") await mobile(browser)
  else throw new Error("tela desconhecida: " + alvoTela)
  console.log(`\nFALHAS: ${falhas.length} · erros de console/HTTP: ${ev.erros.length}`)
  for (const e of ev.erros) console.log("  erro:", e)
  await browser.close()
  process.exit(falhas.length ? 1 : 0)
}

function saida(r: { resumo: any; resultados: Resultado[] }) {
  const sufixo = ini > 0 || fim < 100000 ? `-${ini}` : ""
  writeFileSync(`${IMPL}/varredura-completa-${alvoTela}${sufixo}.json`, JSON.stringify({ ...r, falhas }, null, 1))
  console.log("RESUMO " + JSON.stringify(r.resumo))
}

// ───────────────────────────── números que fecham entre as telas ─────────────────────────────
async function numeros(page: Page) {
  const lerNum = (re: RegExp, corpo: string) => { const m = re.exec(corpo); return m ? n(m[1]) : NaN }
  const div: string[] = []; const linhas: string[] = []
  const cmp = (nome: string, vals: Array<[string, number]>) => { const set = new Set(vals.map(([, x]) => x)); const l = `${set.size > 1 ? "DIVERGE" : "ok"} ${nome}: ${vals.map(([o, x]) => `${o}=${x}`).join(" · ")}`; linhas.push(l); console.log(l); if (set.size > 1) { div.push(l); falha("numeros", l) } }
  await abrir(page, aba("visao")); const v = await txt(page)
  const cartao = (rot: string) => lerNum(new RegExp(`${rot}\\s*\\n?\\s*([\\d.]+)`, "i"), v)
  const vg = { ativos: cartao("PROCESSOS ATIVOS"), abertas: cartao("TAREFAS ABERTAS"), aguard: cartao("AGUARDANDO TERCEIROS"), semResp: cartao("SEM RESPONSÁVEL"), equipe: cartao("COM A EQUIPE"),
    atrasadas: lerNum(/([\d.]+)\s*\n?\s*Atrasadas/, v), cobr: lerNum(/([\d.]+)\s*\n?\s*Cobranças a fazer/, v), pdv: lerNum(/Precisa de você · ([\d.]+)/, v), emRisco: lerNum(/(\d+) em risco/, v), todos: lerNum(/Todos\s*(\d+)/, v) }
  await abrir(page, aba("tarefas")); const t = await txt(page)
  const chip = (rot: string) => lerNum(new RegExp(`${rot}\\s*\\n?\\s*([\\d.]+)`), t)
  const tf = { abertas: chip("Todas as abertas"), venc: chip("Vencidas"), semResp: chip("Sem responsável"), aguard: chip("Aguardando terceiros"), cobr: chip("Cobrar hoje"), mostrando: lerNum(/Mostrando ([\d.]+) de/, t) }
  await abrir(page, aba("equipe")); const e = await txt(page)
  const eq = await page.evaluate(() => {
    let a = 0, at = 0, ag = 0
    for (const b of Array.from(document.querySelectorAll("button")).filter((x) => /Simular saída/.test(x.textContent || ""))) {
      let row: HTMLElement | null = b as HTMLElement
      for (let i = 0; i < 6 && row; i++) { if (row.innerText.split("\n").filter((x) => /^\d+$/.test(x.trim())).length >= 3) break; row = row.parentElement }
      const nums = (row?.innerText || "").split("\n").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
      if (nums.length >= 3) { a += nums[nums.length - 3]; at += nums[nums.length - 2]; ag += nums[nums.length - 1] }
    }
    const el = Array.from(document.querySelectorAll("*")).find((x) => x.children.length <= 1 && /^\d+ sem dono$/.test((x as HTMLElement).innerText?.trim() || ""))
    let row: HTMLElement | null = el as HTMLElement | null
    for (let i = 0; i < 6 && row; i++) { if (row.innerText.split("\n").filter((x) => /^\d+$/.test(x.trim())).length >= 3) break; row = row.parentElement }
    const nums = (row?.innerText || "").split("\n").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
    return { a, at, ag, sd: nums.slice(-3) }
  })
  const semDono = lerNum(/Sem responsável[\s\S]{0,40}?([\d.]+) sem dono/, e)
  await abrir(page, aba("terceiros")); const te = await txt(page)
  const kp = await page.locator(".ter-kpi .ter-kpi-n").allInnerTexts()
  const ter = { aguard: n(kp[0] ?? ""), cobrar: n(kp[4] ?? ""), todos: lerNum(/Cobrar todos os vencidos \((\d+)\)/, te), selo: lerNum(/Terceiros\s*(\d+) a cobrar/, v) }
  await abrir(page, aba("radar")); const rd = await txt(page)
  const radar = { todas: lerNum(/Todas\s*(\d+)/, rd), criticas: lerNum(/Críticas\s*(\d+)/, rd) }
  console.log(JSON.stringify({ vg, tf, eq, semDono, ter, radar }))
  cmp("tarefas abertas", [["Visão geral", vg.abertas], ["Tarefas (chip)", tf.abertas], ["Tarefas (Mostrando)", tf.mostrando], ["Equipe Σ (pessoas + sem dono)", eq.a + (eq.sd[0] ?? 0)]])
  cmp("Sem responsável", [["Visão geral", vg.semResp], ["Tarefas", tf.semResp], ["Equipe", semDono]])
  cmp("Aguardando terceiros", [["Visão geral", vg.aguard], ["Tarefas", tf.aguard], ["Equipe Σ", eq.ag + (eq.sd[2] ?? 0)], ["Terceiros", ter.aguard]])
  cmp("Atrasadas", [["Visão geral", vg.atrasadas], ["Tarefas (Vencidas)", tf.venc], ["Equipe Σ", eq.at + (eq.sd[1] ?? 0)]])
  cmp("Cobranças a fazer", [["Visão geral", vg.cobr], ["Tarefas (Cobrar hoje)", tf.cobr], ["Terceiros (para cobrar)", ter.cobrar], ["selo Terceiros", ter.selo], ["Cobrar todos", ter.todos]])
  cmp("processos ativos", [["Visão geral", vg.ativos], ["cabeçalho Todos", vg.todos]])
  // cada cartão da Visão geral abre uma lista com o MESMO total
  const cartoes: Array<[string, string]> = [["PROCESSOS ATIVOS", "kpi"], ["TAREFAS ABERTAS", "kpi"], ["COM A EQUIPE", "kpi"], ["AGUARDANDO TERCEIROS", "kpi"], ["SEM RESPONSÁVEL", "kpi"], ["Atrasadas", "ag"], ["Vence hoje", "ag"], ["Amanhã", "ag"], ["Próximos 7 dias", "ag"], ["Sem prazo", "ag"], ["Cobranças a fazer", "ag"]]
  const cliques: string[] = []
  for (const [rot, tipo] of cartoes) {
    await abrir(page, aba("visao"))
    let valor = NaN
    if (tipo === "ag") valor = await page.evaluate((r) => { const a = Array.from(document.querySelectorAll("a.tvg-ag")).find((x) => (x as HTMLElement).innerText.includes(r)) as HTMLElement | undefined; const m = a && /^\s*([\d.]+)/.exec(a.innerText); return m ? Number(m[1].replace(/\./g, "")) : NaN }, rot)
    else valor = await page.evaluate((r) => { const els = Array.from(document.querySelectorAll("button, a")).filter((x) => new RegExp(`^\\s*${r}`, "i").test((x as HTMLElement).innerText || "")); const x = els[0] as HTMLElement | undefined; const m = x && /\n\s*([\d.]+)/.exec(x.innerText); return m ? Number(m[1].replace(/\./g, "")) : NaN }, rot)
    const alvo = tipo === "ag" ? page.locator("a.tvg-ag").filter({ hasText: rot }).first() : page.locator("button, a").filter({ hasText: new RegExp(`^\\s*${rot}`, "i") }).first()
    await alvo.click(); await page.waitForTimeout(2200)
    const c = await txt(page); const u = page.url().replace(base, "")
    const total = lerNum(/Mostrando [\d.]+ de ([\d.]+)/, c)
    const procs = lerNum(/Mostrando [\d.]+ de ([\d.]+) processos/i, c)
    const lista = Number.isNaN(total) ? procs : total
    const bate = rot === "PROCESSOS ATIVOS" ? valor >= lista : valor === lista
    const l = `${bate ? "ok" : "DIVERGE"} cartão ${rot} = ${valor} → ${u} → lista com ${lista}`; cliques.push(l); console.log(l)
    if (!bate) { div.push(l); falha("numeros", l) }
  }
  writeFileSync(`${IMPL}/varredura-completa-numeros.json`, JSON.stringify({ vg, tf, eq, semDono, ter, radar, comparacoes: linhas, cliques, divergencias: div }, null, 1))
}

// ───────────────────────────── mobile + vocabulário ─────────────────────────────
async function mobile(browser: any) {
  const m = await novoContexto(browser, 400, 800); const p = await m.newPage(); p.setDefaultTimeout(30000); const e2 = vigiar(p)
  await abrir(p, aba("radar"))
  const href = (await p.locator("a[href*='/torre/processo/']").first().getAttribute("href")) ?? "/torre/processo/1"
  const out: any = {}
  for (const u of [...["visao", "precisa", "radar", "processos", "tarefas", "equipe", "terceiros"].map(aba), href]) {
    await abrir(p, u); await p.waitForTimeout(800)
    const r = await p.evaluate(() => ({ vw: window.innerWidth, doc: document.documentElement.scrollWidth, janelaRola: document.documentElement.scrollWidth > window.innerWidth + 1,
      pais: Array.from(document.querySelectorAll("div,main")).filter((e: any) => e.scrollWidth > e.clientWidth + 1 && /(visible)/.test(getComputedStyle(e).overflowX) && e.clientWidth > 300 && e.getBoundingClientRect().right > window.innerWidth + 1).length }))
    out[u] = r
    console.log(`${r.janelaRola ? "FALHA" : "ok  "} mobile ${u}: doc=${r.doc} vw=${r.vw}`)
    if (r.janelaRola) falha("mobile", `${u} rola na horizontal (doc ${r.doc} > ${r.vw})`)
    for (const x of proibidosEm(await txt(p))) falha("mobile", `${u}: texto proibido ${x}`)
    await p.screenshot({ path: `${IMPL}/varredura-completa-mobile-${u.replace(/[^\w]+/g, "_")}.png` })
  }
  // vocabulário: ocorrências literais proibidas na interface (desktop, 7 abas)
  writeFileSync(`${IMPL}/varredura-completa-mobile.json`, JSON.stringify({ out, erros: e2.erros }, null, 1))
  await m.close()
}
main().catch((e) => { console.error(e); process.exit(2) })
