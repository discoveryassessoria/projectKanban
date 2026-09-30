// scripts/hidratacao-cabecalho-cambio.test.ts
// ============================================================================
// REACT #418 (hydration mismatch) EM TODA TELA COM O CABEÇALHO — 30/09/2026.
// Causa: `CambioMiniApp` lia o localStorage num `useState(() => ...)` durante o render. O servidor (sem
// storage) renderizava o skeleton; o navegador de quem já tinha cache hidratava com o <a> das cotações →
// "Hydration failed" a cada carregamento. Correção: o cache entra por `useLocalStorage`
// (useSyncExternalStore, snapshot de servidor `null`) e a data usa o fuso da operação.
//   (a) varredura estática: nada de storage/Date no corpo de render dos componentes do cabeçalho;
//   (b) prova de execução: SSR (sem window) → hydrateRoot em jsdom COM cache no localStorage, nos fusos
//       UTC e America/Sao_Paulo: zero erros recuperáveis e mesmo HTML antes do mount.
// Sem banco.
// ============================================================================
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import React from "react"
import { renderToString } from "react-dom/server"

const RAIZ = join(__dirname, "..")
let ok = 0
const check = (cond: unknown, msg: string) => { assert.ok(cond, msg); ok++ }

// ── (a) estático ────────────────────────────────────────────────────────────
const fonteCambio = readFileSync(join(RAIZ, "src/components/cambio/cambio-mini-app.tsx"), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const codigo = semComentarios(fonteCambio)
check(!/useState(<[^>]*>)?\(\s*\(\)\s*=>[^)]*(localStorage|lerCache|sessionStorage|window)/.test(codigo), "CambioMiniApp não pode ler storage/window num useState lazy (React #418)")
check(!/typeof window[\s\S]{0,40}\?[\s\S]{0,40}localStorage/.test(codigo.split("export function CambioMiniApp")[1] ?? ""), "corpo do CambioMiniApp sem ramo typeof window + localStorage")
check(/useLocalStorage\(CHAVE_CACHE\)/.test(codigo), "o cache do câmbio entra por useLocalStorage (useSyncExternalStore com snapshot de servidor)")
const chamadasData = codigo.match(/new Date\([^)]*\)\.toLocale\w+\([^;]*?\}\)/g) ?? []
check(chamadasData.length >= 1 && chamadasData.every((c) => /timeZone:\s*FUSO_OPERACIONAL/.test(c)), "data do câmbio usa o fuso da operação explícito")

// Cabeçalho: relógio/data SÓ dentro de useEffect (estado inicial vazio nos dois lados).
for (const f of ["src/components/header-bar-app.tsx", "src/components/header-bar.tsx"]) {
  const src = semComentarios(readFileSync(join(RAIZ, f), "utf8"))
  const antes = src.split(/useEffect\(/)[0]
  check(!/new Date\(|Date\.now\(|Math\.random\(|toLocale\w*String\(/.test(antes.split("export function")[1] ?? ""), `${f}: nada de Date/toLocale/random no corpo de render antes do useEffect`)
  check(/useState<string>\(""\)/.test(src), `${f}: relógio começa vazio (igual no servidor e na hidratação)`)
}

// ── (b) execução: SSR sem window → hidratação em jsdom com cache ────────────
const CHAVE = "discovery:cambio:ultimo-snapshot"
const CACHE = JSON.stringify({ moedas: [
  { moeda: "EUR", valor: 6.1234, consultadoEm: "2026-09-30T02:30:00.000Z", estado: "ATUALIZADO" },
  { moeda: "USD", valor: 5.4321, consultadoEm: "2026-09-30T02:30:00.000Z", estado: "ATUALIZADO" },
] })

async function main() {
  // 1) servidor: sem window/document/localStorage
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined")
  const { CambioMiniApp } = await import("../src/components/cambio/cambio-mini-app")
  const htmlServidor = renderToString(React.createElement(CambioMiniApp))
  check(htmlServidor.includes("Carregando cotações"), "servidor renderiza o skeleton (sem cache)")

  // 2) navegador: jsdom com o cache já gravado
  // @ts-expect-error -- jsdom não traz tipos neste repositório
  const { JSDOM } = await import("jsdom")
  const dom = new JSDOM(`<!doctype html><html><body><div id="raiz">${htmlServidor}</div></body></html>`, { url: "http://localhost/dashboard", pretendToBeVisual: true })
  dom.window.localStorage.setItem(CHAVE, CACHE)
  const g = globalThis as Record<string, unknown>
  const guardar: Record<string, unknown> = {}
  for (const k of ["window", "document", "localStorage", "navigator", "Event", "HTMLElement", "Node", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "self", "IntersectionObserver"]) guardar[k] = Object.getOwnPropertyDescriptor(g, k)
  const w = dom.window as unknown as Record<string, unknown>
  for (const k of ["window", "document", "localStorage", "Event", "HTMLElement", "Node", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
    Object.defineProperty(g, k, { value: k === "window" ? dom.window : w[k], configurable: true, writable: true })
  }
  Object.defineProperty(g, "self", { value: dom.window, configurable: true, writable: true })
  Object.defineProperty(g, "IntersectionObserver", { value: class { observe() {} unobserve() {} disconnect() {} }, configurable: true, writable: true })
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true, writable: true })
  g.fetch = () => Promise.reject(new Error("sem rede no teste"))
  const erros: string[] = []
  const erroOriginal = console.error
  console.error = (...a: unknown[]) => { erros.push(a.map(String).join(" ")) }
  try {
    const { hydrateRoot } = await import("react-dom/client")
    const recuperaveis: string[] = []
    const raiz = dom.window.document.getElementById("raiz")!
    const htmlAntes = raiz.innerHTML
    const root = hydrateRoot(raiz, React.createElement(CambioMiniApp), { onRecoverableError: (e) => recuperaveis.push(String((e as Error).message)) })
    await new Promise((r) => setTimeout(r, 300))
    check(recuperaveis.length === 0, `hidratação sem erro recuperável (#418) — obtido: ${recuperaveis[0] ?? "nenhum"}`)
    check(!erros.some((e) => /Hydration|did not match|hydrat/i.test(e)), "console sem aviso de hidratação")
    check(htmlAntes.includes("Carregando cotações"), "HTML do servidor era o skeleton")
    // depois do mount o último valor válido aparece (cache honrado, sem piscar traço)
    const depois = raiz.textContent ?? ""
    if (process.env.DEBUG_HID) console.log(erros.join("\n---\n").slice(0, 2500), "\nHTML:", raiz.innerHTML.slice(0, 300))
    check(/6,1234/.test(depois) && /5,4321/.test(depois), "depois do mount o câmbio do cache aparece")
    // fuso da operação: 02:30Z = 29/09 23:30 em São Paulo, independente do TZ do processo
    check(/29\/09/.test(depois) && /23:30/.test(depois), "data do câmbio no fuso da operação (29/09 23:30), não no do ambiente")
    root.unmount()
  } finally {
    console.error = erroOriginal
    for (const [k, d] of Object.entries(guardar)) { if (d) Object.defineProperty(g, k, d as PropertyDescriptor); else delete g[k] }
  }
  console.log(`hidratacao-cabecalho-cambio: ${ok} checks OK (TZ=${process.env.TZ ?? "padrão"})`)
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
