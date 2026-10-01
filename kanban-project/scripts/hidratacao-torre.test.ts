// scripts/hidratacao-torre.test.ts
// ============================================================================
// HIDRATAÇÃO DA /torre (React #418) — 30/09/2026.
//
// O Marco ainda via "Minified React error #418" na /torre em produção depois do conserto do CambioMiniApp. A investigação
// (Playwright + next dev + banco efêmero, dev-mode = diff de hidratação completo, UTC e America/Sao_Paulo, mobile e desktop,
// com e sem cache de câmbio no localStorage, URLs ?aba=tarefas&visao=minhas&resp=eu · ?processo= · ?tarefa= · ?pais=&q= · ?kpi=)
// NÃO reproduziu nenhum aviso/erro de hidratação. A razão é ESTRUTURAL: `/torre` só monta o corpo da Torre (cabeçalho, KPIs,
// abas) DEPOIS do portão `useIsClient()` (src/app/torre/page.tsx) — o servidor e o primeiro render da hidratação produzem o
// MESMO `CARREGANDO`; nada da Torre é renderizado no servidor. Este teste TRAVA isso e endurece o que dava para endurecer:
//
//   (a) o PORTÃO: a page só devolve a Torre depois de `!mounted` (useIsClient) — estático;
//   (b) VARREDURA de render-time: nenhum `new Date()`/`Date.now()`/`Math.random()` no CORPO DE RENDER (corpo do componente,
//       useMemo/useState lazy, callbacks de .map/.filter… — não handlers nem efeitos) dos componentes da Torre, salvo a
//       ALLOWLIST NOMINAL abaixo, cada uma justificada (todas dependem do portão (a));
//   (c) VARREDURA de fuso: todo `toLocale*String` tem `timeZone`; proibido `getDate/getMonth/getHours/toDateString/…` (fuso do
//       navegador) — corrigidos hoje: TorreFeito (Hoje/Ontem por `toDateString()`) e `fmtData` (getDate/getMonth);
//   (d) datas do topo/prazo INDEPENDENTES do fuso do processo (TZ=UTC e America/Sao_Paulo): mesma frase, mesmo "dd/mm";
//   (e) EXECUÇÃO: SSR sem window → hydrateRoot em jsdom com `user`/token no localStorage → zero erro recuperável (#418) e
//       mesmo HTML antes do mount; CONTROLE POSITIVO: um componente que lê o storage no render PRODUZ o erro (o teste enxerga).
// Sem banco.
// ============================================================================
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import React from "react"
import { renderToString } from "react-dom/server"
import ts from "typescript"

const RAIZ = join(__dirname, "..")
let ok = 0
const check = (cond: unknown, msg: string) => { assert.ok(cond, msg); ok++ }
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

// ── arquivos da Torre ───────────────────────────────────────────────────────
const DIR_TORRE = "src/components/torre"
const COMPONENTES = [...readdirSync(join(RAIZ, DIR_TORRE)).filter((f) => f.endsWith(".tsx")).map((f) => `${DIR_TORRE}/${f}`), "src/app/torre/page.tsx"]
// Módulos PUROS chamados no render da Torre (formatam datas): mesma regra de fuso, sem regra de "componente".
const AUXILIARES = ["src/components/operacao/operacao-v3-derivacoes.ts", "lib/operacional/torre-topo.ts", "src/lib/tarefa/texto-prazo.ts"]

// ── (a) o portão ────────────────────────────────────────────────────────────
const page = ler("src/app/torre/page.tsx")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
const pageCod = semComentarios(page)
const iPortao = pageCod.indexOf("if (!mounted")
check(/const mounted = useIsClient\(\)/.test(pageCod), "page: `mounted` vem de useIsClient() (useSyncExternalStore: false no servidor e na hidratação)")
check(iPortao > 0 && /if \(!mounted \|\| carregando \|\| !autorizado\) return CARREGANDO/.test(pageCod), "page: o portão devolve CARREGANDO enquanto !mounted")
check(iPortao > 0 && pageCod.indexOf("<Torre />") > iPortao && pageCod.indexOf("<HeaderBarApp") > iPortao, "page: nem a Torre nem o cabeçalho (relógio/câmbio/sino) são renderizados antes do portão")
check(!/useState\(\s*\(\)\s*=>[^)]*(localStorage|sessionStorage|window)/.test(pageCod) && !/typeof window/.test(pageCod), "page: sem leitura de storage/window no render")
check(/useJsonLocalStorage<[^>]*>\("user"\)/.test(pageCod), "page: o usuário vem de useJsonLocalStorage (snapshot de servidor null), nunca de localStorage direto")

// ── (b)/(c) varredura com o compilador do TypeScript ────────────────────────
interface Achado { arquivo: string; componente: string; trecho: string; linha: number }
const FUNCOES_RENDER = new Set(["useMemo", "useState", "useReducer", "useRef", "useSyncExternalStore"])
const METODOS_DE_LISTA = new Set(["map", "filter", "sort", "reduce", "find", "some", "every", "flatMap", "findIndex", "toSorted"])
const FUNCOES_DEFERIDAS = new Set(["useEffect", "useLayoutEffect", "useCallback", "useImperativeHandle", "setTimeout", "setInterval", "then", "catch", "finally", "addEventListener", "requestAnimationFrame"])

const nomeDaChamada = (c: ts.CallExpression): string => {
  const e = c.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return ""
}
const ehFuncao = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)
const ehComponente = (n: ts.Node): string | null => {
  if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) return n.name.text
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text) && n.initializer && ehFuncao(n.initializer)) return n.name.text
  return null
}

/** O nó roda DURANTE o render do componente `comp`? Sobe os pais: cada função intermediária precisa ser de render (useMemo/useState lazy, callback de lista). */
function rodaNoRender(no: ts.Node, comp: ts.Node): boolean {
  for (let p: ts.Node | undefined = no.parent; p && p !== comp; p = p.parent) {
    if (!ehFuncao(p)) continue
    const pai = p.parent
    if (p === (comp as ts.VariableDeclaration).initializer) return true
    if (ts.isJsxExpression(pai) && pai.parent && ts.isJsxAttribute(pai.parent)) return false // onClick={() => …}
    if (ts.isCallExpression(pai) && pai.arguments.includes(p as ts.Expression)) {
      const nome = nomeDaChamada(pai)
      if (FUNCOES_DEFERIDAS.has(nome)) return false
      if (FUNCOES_RENDER.has(nome) || METODOS_DE_LISTA.has(nome)) continue
      return false // callback passado a função desconhecida: não se presume render
    }
    return false // `const tratar = () => …`, função aninhada: só roda quando chamada (handler/efeito)
  }
  return true
}

function varrer(rel: string): { render: Achado[]; fuso: Achado[] } {
  const src = ler(rel)
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const render: Achado[] = [], fuso: Achado[] = []
  const linhaDe = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const trecho = (n: ts.Node) => n.getText().replace(/\s+/g, " ").slice(0, 90)
  const visitar = (n: ts.Node, comp: ts.Node | null, nomeComp: string) => {
    const nome = ehComponente(n)
    if (nome) { ts.forEachChild(n, (f) => visitar(f, n, nome)); return }
    // ── render-time: `new Date()` sem argumento, `Date.now()`, `Math.random()`
    if (comp) {
      const novoDataVazio = ts.isNewExpression(n) && n.expression.getText() === "Date" && (n.arguments?.length ?? 0) === 0
      const agoraOuRandom = ts.isCallExpression(n) && /^(Date\.now|Math\.random)$/.test(n.expression.getText())
      if ((novoDataVazio || agoraOuRandom) && rodaNoRender(n, comp)) render.push({ arquivo: rel, componente: nomeComp, trecho: trecho(n), linha: linhaDe(n) })
    }
    // ── fuso (em qualquer posição do arquivo): toLocale* sem timeZone e getters de fuso local
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text
      if (/^toLocale(Date|Time)?String$/.test(m)) {
        const opcoes = n.arguments[1]
        if (!opcoes || !/timeZone/.test(opcoes.getText())) fuso.push({ arquivo: rel, componente: nomeComp, trecho: trecho(n), linha: linhaDe(n) })
      } else if (/^(getDate|getMonth|getFullYear|getHours|getMinutes|getSeconds|getDay|toDateString|toTimeString)$/.test(m) && n.arguments.length === 0) {
        fuso.push({ arquivo: rel, componente: nomeComp, trecho: trecho(n), linha: linhaDe(n) })
      }
    }
    ts.forEachChild(n, (f) => visitar(f, comp, nomeComp))
  }
  visitar(sf, null, "")
  return { render, fuso }
}

// ALLOWLIST NOMINAL — cada linha: `arquivo :: componente :: trecho` e POR QUE é seguro. TODAS dependem do portão (a): a Torre
// (e o cabeçalho) só são renderizados no CLIENTE, depois de `useIsClient()`; o servidor nunca as renderiza, então não há HTML
// de servidor com que o relógio possa divergir. Datas exibidas usam `timeZone` explícito (varredura (c)).
const ALLOWLIST: Array<{ chave: string; porque: string }> = [
  { chave: "src/app/torre/page.tsx :: TorrePageConteudo :: new Date()", porque: "data por extenso do subtítulo; depois do portão `!mounted` (nunca no SSR) e com timeZone America/Sao_Paulo" },
  { chave: "src/components/torre/Torre.tsx :: Torre :: new Date()", porque: "`agora` (useMemo por recarga) é o instante único da AGENDA de KPIs e da aba Tarefas; a Torre só monta depois do portão" },
]
const chaveDe = (a: Achado) => `${a.arquivo} :: ${a.componente} :: ${a.trecho.startsWith("new Date(") ? "new Date()" : a.trecho}`

const todosRender: Achado[] = [], todosFuso: Achado[] = []
for (const f of [...COMPONENTES, ...AUXILIARES]) {
  const r = varrer(f)
  if (COMPONENTES.includes(f)) todosRender.push(...r.render)
  todosFuso.push(...r.fuso)
}
const fora = todosRender.filter((a) => !ALLOWLIST.some((l) => l.chave === chaveDe(a)))
check(fora.length === 0, `Date/random no corpo de render fora da allowlist (quebra a hidratação se o componente for renderizado no servidor): ${fora.map((a) => `${a.arquivo}:${a.linha} ${a.trecho}`).join(" | ")}`)
const obsoletas = ALLOWLIST.filter((l) => !todosRender.some((a) => chaveDe(a) === l.chave))
check(obsoletas.length === 0, `allowlist com entrada que não existe mais (remova): ${obsoletas.map((l) => l.chave).join(" | ")}`)
check(ALLOWLIST.every((l) => l.porque.length > 25), "toda entrada da allowlist tem justificativa escrita")
check(todosFuso.length === 0, `toLocale* sem timeZone ou getter de fuso local (o fuso do navegador/servidor vaza na tela): ${todosFuso.map((a) => `${a.arquivo}:${a.linha} ${a.trecho}`).join(" | ")}`)
// o scanner precisa ENXERGAR: controle positivo sobre um fonte sintético
{
  const falso = ts.createSourceFile("x.tsx", `import {useMemo} from "react"
    export function Ruim() { const a = useMemo(() => new Date(), []); const b = Date.now(); const f = () => new Date(); return <button onClick={() => new Date()}>{[1].map(() => Math.random())}{a}{b}{f}</button> }`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let achou = 0
  const v = (n: ts.Node, comp: ts.Node | null) => {
    if (ts.isFunctionDeclaration(n) && n.name) { ts.forEachChild(n, (f) => v(f, n)); return }
    if (comp && ((ts.isNewExpression(n) && n.expression.getText() === "Date") || (ts.isCallExpression(n) && /^(Date\.now|Math\.random)$/.test(n.expression.getText()))) && rodaNoRender(n, comp)) achou++
    ts.forEachChild(n, (f) => v(f, comp))
  }
  v(falso, null)
  check(achou === 3, `controle positivo do scanner: useMemo(new Date) + Date.now() + map(Math.random) são render-time (3); handler onClick e const f = () => … não são — obtido ${achou}`)
}

// ── (d) datas independentes do fuso do processo ────────────────────────────
async function datas() {
  const { dataPorExtenso } = await import("../lib/operacional/torre-topo")
  const { diaMesDoPrazo, textoPrazoDaTarefa } = await import("../src/lib/tarefa/texto-prazo")
  const { fmtData } = await import("../src/components/operacao/operacao-v3-derivacoes")
  const { diaOperacional } = await import("../lib/operacional/tempo-operacional")
  // 01/10 02:30 UTC = 30/09 23:30 em São Paulo — a virada onde UTC e SP divergem
  const virada = new Date("2026-10-01T02:30:00.000Z")
  check(dataPorExtenso(virada) === "30 de setembro", `frase do topo no fuso da operação (30 de setembro), não no do ambiente — obtido "${dataPorExtenso(virada)}" (TZ=${process.env.TZ ?? "padrão"})`)
  check(diaMesDoPrazo("2026-10-01T02:30:00.000Z") === "30/09", "prazo 'dd/mm' no fuso da operação")
  check(textoPrazoDaTarefa({ dataPrazo: "2026-10-01T02:30:00.000Z", rotuloDoPrazo: "Vence amanhã" }) === "Vence amanhã · 30/09", "texto do prazo estável entre fusos")
  check(fmtData("2026-10-01T02:30:00.000Z") === "30/09", `fmtData (colunas Prazo/Concluída em) no fuso da operação — obtido ${fmtData("2026-10-01T02:30:00.000Z")}`)
  check(diaOperacional(virada) === "2026-09-30", "diaOperacional (Hoje/Ontem da aba Feito) no fuso da operação")
}

// ── (e) execução: SSR sem window → hydrateRoot em jsdom ────────────────────
async function execucao() {
  // Next e CSS não existem no Node puro: stubs mínimos (só o roteador/searchParams/pathname e os .css).
  const Module = require("node:module") as { _load: (...a: unknown[]) => unknown }
  const original = Module._load
  const navegacao = {
    useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {}, refresh() {} }),
    usePathname: () => "/torre",
    useSearchParams: () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
    redirect() {}, notFound() {},
  }
  Module._load = function (this: unknown, ...a: unknown[]) {
    const req = String(a[0])
    if (req === "next/navigation") return navegacao
    if (req.endsWith(".css")) return {}
    return original.apply(this, a)
  }
  try {
    assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined")
    const { default: TorrePageSolta } = await import("../src/app/torre/page")
    // O mesmo contexto do layout real (SidebarWrapper > SidebarProvider) — o cabeçalho lê o estado da barra lateral.
    const { SidebarProvider } = await import("../src/contexts/sidebar-context")
    const TorrePage = () => React.createElement(SidebarProvider, null, React.createElement(TorrePageSolta))
    const htmlServidor = renderToString(React.createElement(TorrePage))
    check(htmlServidor.includes("Carregando a Torre de Controle"), "servidor renderiza só o CARREGANDO (portão)")
    check(!/tor-cab|tor-kpi|tor-frase|Torre de Controle<\/h/.test(htmlServidor), "servidor NÃO renderiza cabeçalho/KPIs/frase da Torre")

    // @ts-expect-error -- jsdom não traz tipos neste repositório
    const { JSDOM } = await import("jsdom")
    const dom = new JSDOM(`<!doctype html><html><body><div id="raiz">${htmlServidor}</div></body></html>`, { url: "http://localhost/torre?aba=tarefas&visao=minhas&resp=eu", pretendToBeVisual: true })
    dom.window.localStorage.setItem("authToken", "token-de-teste")
    dom.window.localStorage.setItem("user", JSON.stringify({ nome: "Marco Teste", tipo: "admin", email: "a@b.c", id: 1 }))
    const g = globalThis as Record<string, unknown>
    const guardar: Record<string, unknown> = {}
    const chaves = ["window", "document", "localStorage", "sessionStorage", "navigator", "Event", "HTMLElement", "Node", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "self", "IntersectionObserver", "matchMedia", "ResizeObserver", "fetch", "getComputedStyle", "CustomEvent", "KeyboardEvent", "MouseEvent", "Element", "innerWidth"]
    for (const k of chaves) guardar[k] = Object.getOwnPropertyDescriptor(g, k)
    const w = dom.window as unknown as Record<string, unknown>
    for (const k of ["window", "document", "localStorage", "sessionStorage", "Event", "HTMLElement", "Node", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "CustomEvent", "KeyboardEvent", "MouseEvent", "Element"]) {
      Object.defineProperty(g, k, { value: k === "window" ? dom.window : w[k], configurable: true, writable: true })
    }
    Object.defineProperty(g, "self", { value: dom.window, configurable: true, writable: true })
    Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true, writable: true })
    Object.defineProperty(g, "innerWidth", { value: 1400, configurable: true, writable: true })
    Object.defineProperty(dom.window, "innerWidth", { value: 1400, configurable: true, writable: true })
    const mq = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })
    Object.defineProperty(g, "matchMedia", { value: mq, configurable: true, writable: true })
    Object.defineProperty(dom.window, "matchMedia", { value: mq, configurable: true, writable: true })
    class Obs { observe() {} unobserve() {} disconnect() {} }
    Object.defineProperty(g, "IntersectionObserver", { value: Obs, configurable: true, writable: true })
    Object.defineProperty(g, "ResizeObserver", { value: Obs, configurable: true, writable: true })
    // a rede: permissões reais do admin; o resto responde vazio/erro (o ponto aqui é a HIDRATAÇÃO, não os dados)
    const chamadas: string[] = []
    g.fetch = async (url: unknown) => {
      const u = String(url); chamadas.push(u)
      const corpo = u.includes("/api/me/permissoes") ? { permissoes: { "operacao.distribuirTarefas": true }, tipo: "admin", userId: 1 } : { error: "sem rede no teste" }
      return { ok: u.includes("/api/me/permissoes"), status: u.includes("/api/me/permissoes") ? 200 : 503, json: async () => corpo, text: async () => JSON.stringify(corpo), headers: new Map(), clone() { return this } }
    }
    const erros: string[] = []
    const erroOriginal = console.error
    console.error = (...a: unknown[]) => { erros.push(a.map(String).join(" ")) }
    try {
      const { hydrateRoot } = await import("react-dom/client")
      const recuperaveis: string[] = []
      const raiz = dom.window.document.getElementById("raiz")!
      const htmlAntes = raiz.innerHTML
      const root = hydrateRoot(raiz, React.createElement(TorrePage), { onRecoverableError: (e) => recuperaveis.push(String((e as Error).message)) })
      await new Promise((r) => setTimeout(r, 1200))
      check(recuperaveis.length === 0, `hidratação da /torre sem erro recuperável (#418) — obtido: ${recuperaveis[0] ?? "nenhum"}`)
      check(!erros.some((e) => /Hydration|did not match|hydrat/i.test(e)), `console sem aviso de hidratação${process.env.DEBUG_HID ? "" : ""}`)
      check(htmlAntes.includes("Carregando a Torre de Controle"), "o HTML do servidor era o CARREGANDO")
      if (process.env.DEBUG_HID) console.log(erros.join("\n---\n").slice(0, 2500), "\nHTML:", raiz.innerHTML.slice(0, 400))
      // depois do mount o portão abre (usuário admin do storage): a Torre aparece no cliente
      check(/Torre de Controle/.test(raiz.textContent ?? "") && !/Carregando a Torre de Controle/.test(raiz.textContent ?? ""), "depois do mount o portão abre e a Torre (cabeçalho) é renderizada só no cliente")
      check(/(segunda|terça|quarta|quinta|sexta|sábado|domingo)-feira|sábado|domingo/i.test(raiz.textContent ?? ""), "a data por extenso do subtítulo aparece (fuso da operação)")
      root.unmount()

      // CONTROLE POSITIVO: o mesmo harness ENXERGA um mismatch real (componente que lê o storage no render).
      const Ruim = () => React.createElement("span", null, typeof window === "undefined" ? "servidor" : (window.localStorage.getItem("user") ? "cliente-com-cache" : "cliente"))
      const html2 = (() => { const v = g.window; delete g.window; try { return renderToString(React.createElement(Ruim)) } finally { g.window = v } })()
      const dom2 = new JSDOM(`<!doctype html><html><body><div id="r2">${html2}</div></body></html>`, { url: "http://localhost/x" })
      dom2.window.localStorage.setItem("user", "{}")
      Object.defineProperty(g, "window", { value: dom2.window, configurable: true, writable: true })
      Object.defineProperty(g, "document", { value: dom2.window.document, configurable: true, writable: true })
      const rec2: string[] = []
      const r2 = hydrateRoot(dom2.window.document.getElementById("r2")!, React.createElement(Ruim), { onRecoverableError: (e) => rec2.push(String((e as Error).message)) })
      await new Promise((r) => setTimeout(r, 300))
      check(rec2.length >= 1, "controle positivo: um componente que lê o storage no render PRODUZ o erro de hidratação no harness (o teste enxerga o #418)")
      r2.unmount()
    } finally {
      console.error = erroOriginal
      for (const [k, d] of Object.entries(guardar)) { if (d) Object.defineProperty(g, k, d as PropertyDescriptor); else delete g[k] }
    }
  } finally {
    Module._load = original
  }
}

async function main() {
  await datas()
  await execucao()
  {
  // O HTML raiz declara o idioma real (pt-BR) e pede ao navegador para NÃO traduzir: tradução automática de DOM é causa
  // conhecida de React #418 em produção (hipótese do Marco, 30/09/2026). Antes era lang="en" com conteúdo em português.
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const layout = readFileSync("src/app/layout.tsx", "utf8")
  const okLang = /<html lang="pt-BR" translate="no"/.test(layout) && !/<html lang="en"/.test(layout)
  console.log(okLang ? "  ✅ o HTML raiz é lang=pt-BR e translate=no" : "  ❌ o HTML raiz deveria ser lang=pt-BR translate=no")
  if (!okLang) process.exitCode = 1
}
console.log(`hidratacao-torre: ${ok} checks OK (TZ=${process.env.TZ ?? "padrão"})`)
  // O gate roda o arquivo uma vez; o fuso do PROCESSO é o que a prova (d)/(e) precisa variar. Filhos com TZ fixo (UTC e São Paulo).
  if (!process.env.HID_FILHO) {
    const { spawnSync } = await import("node:child_process")
    for (const tz of ["UTC", "America/Sao_Paulo"]) {
      const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]], { env: { ...process.env, TZ: tz, HID_FILHO: "1" }, encoding: "utf8", timeout: 240_000 })
      check(r.status === 0, `filho com TZ=${tz} passou — ${(r.stdout + r.stderr).split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300)}`)
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
