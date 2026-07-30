/**
 * TESTES VISUAIS DA ÁRVORE — comparação por screenshot.
 *
 * Rodar:
 *   npm run dev                      (em outro terminal)
 *   node scripts/arvore-visual.test.mjs            → compara com os aprovados
 *   node scripts/arvore-visual.test.mjs --aprovar  → grava a nova referência
 *
 * Por que screenshot e não asserção de DOM: o que este módulo precisa proteger
 * é ESPAÇAMENTO, ALINHAMENTO, SOBREPOSIÇÃO e CLIPPING — defeitos que passam
 * ilesos por qualquer teste que olhe só a árvore de elementos. Um card que
 * cresceu 4px e encostou no vizinho continua tendo o mesmo HTML.
 *
 * A comparação é por PIXEL, com tolerância pequena (0,15% da imagem) para
 * absorver antialiasing de fonte entre execuções. Diferença maior falha e grava
 * a imagem nova ao lado da aprovada, para inspeção.
 *
 * A superfície fotografada é /arvore-render, que roda com fixtures fixas e sem
 * banco — mesma entrada, mesmo desenho, sempre.
 */
import { chromium } from "playwright"
import { PNG } from "pngjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

const BASE = process.env.ARVORE_BASE_URL || "http://localhost:3000"
const DIR = "tests/visual/arvore"
const DIR_FALHAS = "capturas/arvore/falhas"
const APROVAR = process.argv.includes("--aprovar")

/** Tolerância: fração de pixels que pode diferir sem reprovar. */
const TOLERANCIA = 0.0015
/** Distância de canal a partir da qual dois pixels contam como diferentes. */
const LIMIAR_CANAL = 24

const MACBOOK = { width: 1512, height: 900 }
const LARGO = { width: 1920, height: 1080 }
const TABLET = { width: 1024, height: 768 }

/**
 * Os vinte estados exigidos.
 *
 * Cada um existe para travar uma regressão concreta — não são variações
 * decorativas. O nome do arquivo é o nome do estado.
 */
const CENARIOS = [
  { nome: "01-retrato", qs: "vista=retrato", viewport: MACBOOK },
  { nome: "02-paisagem", qs: "vista=paisagem", viewport: MACBOOK },
  { nome: "03-casal-cards-separados", qs: "vista=paisagem", viewport: MACBOOK, checarCasal: true },
  { nome: "04-sem-conjuge", qs: "vista=paisagem&caso=sem-conjuge", viewport: MACBOOK },
  { nome: "05-sem-pais", qs: "vista=paisagem&caso=sem-pais", viewport: MACBOOK },
  { nome: "06-muitos-filhos", qs: "vista=paisagem&caso=muitos-filhos", viewport: MACBOOK, ajustar: true },
  { nome: "07-multiplos-casamentos", qs: "vista=paisagem&caso=multiplos-casamentos", viewport: MACBOOK, ajustar: true },
  { nome: "08-gaveta-aberta", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK },
  { nome: "09-minimapa", qs: "vista=paisagem", viewport: MACBOOK, recorte: "[data-minimapa='aberto']" },
  { nome: "10-zoom-minimo", qs: "vista=paisagem", viewport: MACBOOK, zoom: -8 },
  { nome: "11-zoom-maximo", qs: "vista=paisagem", viewport: MACBOOK, zoom: 8 },
  { nome: "12-enquadrar", qs: "vista=paisagem", viewport: MACBOOK, ajustar: true },
  { nome: "13-pagina-pessoa", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK, abrirPagina: true },
  { nome: "14-aba-sobre", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK, abrirPagina: true, aba: "Sobre" },
  { nome: "15-aba-detalhes", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK, abrirPagina: true, aba: "Detalhes" },
  { nome: "16-aba-fontes", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK, abrirPagina: true, aba: "Fontes" },
  { nome: "17-aba-linha-do-tempo", qs: "vista=paisagem&gaveta=1", viewport: MACBOOK, abrirPagina: true, aba: "Linha do tempo" },
  { nome: "18-viewport-macbook", qs: "vista=paisagem", viewport: MACBOOK, ajustar: true },
  { nome: "19-viewport-largo", qs: "vista=paisagem", viewport: LARGO, ajustar: true },
  { nome: "20-viewport-tablet", qs: "vista=paisagem", viewport: TABLET, ajustar: true },
]

let passed = 0
let failed = 0
const falhas = []
function ok(cond, nome, detalhe = "") {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ""}`)
    console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`)
  }
}

function comparar(aprovado, novo) {
  const a = PNG.sync.read(aprovado)
  const b = PNG.sync.read(novo)
  if (a.width !== b.width || a.height !== b.height) {
    return { iguais: false, motivo: `tamanho ${a.width}x${a.height} → ${b.width}x${b.height}`, fracao: 1 }
  }
  let diferentes = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d > LIMIAR_CANAL) diferentes++
  }
  const fracao = diferentes / (a.width * a.height)
  return {
    iguais: fracao <= TOLERANCIA,
    motivo: `${(fracao * 100).toFixed(3)}% dos pixels diferem (limite ${(TOLERANCIA * 100).toFixed(3)}%)`,
    fracao,
  }
}

async function principal() {
  mkdirSync(DIR, { recursive: true })
  mkdirSync(DIR_FALHAS, { recursive: true })

  const navegador = await chromium.launch()

  for (const c of CENARIOS) {
    // Contexto novo por cenário: as preferências da árvore moram em
    // localStorage, e reaproveitar o contexto faria um cenário herdar a
    // visualização do anterior — a foto compararia coisas diferentes.
    const ctx = await navegador.newContext({ viewport: c.viewport, deviceScaleFactor: 1 })
    const pg = await ctx.newPage()

    try {
      await pg.goto(`${BASE}/arvore-render?${c.qs}`, { waitUntil: "networkidle", timeout: 30_000 })
      await pg.waitForSelector("[data-arvore]", { timeout: 15_000 })

      // O selo do Next em desenvolvimento fica exatamente no canto inferior
      // esquerdo — em cima do minimapa. Ele não existe em produção, então
      // deixá-lo na foto seria travar uma regressão contra um elemento que a
      // tela real não tem.
      await pg.addStyleTag({
        content: "nextjs-portal, [data-nextjs-dev-tools-button] { display: none !important; }",
      })
      await pg.waitForTimeout(1200)

      if (c.ajustar) {
        await pg.click("[aria-label='Enquadrar a árvore inteira']")
        await pg.waitForTimeout(900)
      }
      if (c.zoom) {
        const alvo = c.zoom > 0 ? "[aria-label='Aproximar']" : "[aria-label='Afastar']"
        for (let i = 0; i < Math.abs(c.zoom); i++) {
          await pg.click(alvo)
          await pg.waitForTimeout(120)
        }
        await pg.waitForTimeout(700)
      }
      if (c.abrirPagina) {
        await pg.click("button:has-text('Pessoa')")
        await pg.waitForTimeout(600)
      }
      if (c.aba) {
        await pg.click(`[role="tab"]:has-text("${c.aba}")`)
        await pg.waitForTimeout(500)
      }

      // A REGRA ABSOLUTA, verificada no DOM real e não só no layout.
      if (c.checarCasal) {
        const dados = await pg.evaluate(() => {
          const cards = [...document.querySelectorAll("[data-cartao-pessoa]")]
          const porId = new Map()
          for (const el of cards) porId.set(el.getAttribute("data-pessoa-id"), el)
          const marido = porId.get("1")
          const esposa = porId.get("2")
          if (!marido || !esposa) return { erro: "cards do casal não encontrados" }
          const rm = marido.getBoundingClientRect()
          const re = esposa.getBoundingClientRect()
          return {
            ids: [marido.getAttribute("data-pessoa-id"), esposa.getAttribute("data-pessoa-id")],
            aninhados: marido.contains(esposa) || esposa.contains(marido),
            mesmoPai: marido.parentElement === esposa.parentElement,
            gap: Math.max(rm.top, re.top) - Math.min(rm.bottom, re.bottom),
            clicaveis:
              marido.getAttribute("role") === "button" && esposa.getAttribute("role") === "button",
          }
        })
        ok(!dados.erro, `${c.nome}: os dois cards do casal existem`, dados.erro)
        if (!dados.erro) {
          ok(dados.ids[0] !== dados.ids[1], `${c.nome}: os cards têm ids de teste distintos`)
          ok(!dados.aninhados, `${c.nome}: um card não está dentro do outro`)
          ok(dados.gap > 0, `${c.nome}: existe gap visível entre os cards`, `gap=${dados.gap}px`)
          ok(dados.clicaveis, `${c.nome}: os dois cards são clicáveis de forma independente`)

          // Clique em cada um seleciona a pessoa certa.
          await pg.click("[data-pessoa-id='2']")
          await pg.waitForTimeout(400)
          const selecionada = await pg.evaluate(
            () => document.querySelector("[data-pessoa-id][aria-current='true']")?.getAttribute("data-pessoa-id"),
          )
          ok(selecionada === "2", `${c.nome}: clicar na esposa seleciona a esposa`, `veio ${selecionada}`)
          await pg.keyboard.press("Escape")
          await pg.waitForTimeout(500)
        }
      }

      const alvo = c.recorte ? pg.locator(c.recorte) : pg
      const buffer = await alvo.screenshot()
      const caminho = join(DIR, `${c.nome}.png`)

      if (APROVAR || !existsSync(caminho)) {
        writeFileSync(caminho, buffer)
        console.log(`  📸 ${c.nome} ${APROVAR ? "aprovado" : "criado (primeira execução)"}`)
        passed++
      } else {
        const r = comparar(readFileSync(caminho), buffer)
        if (!r.iguais) writeFileSync(join(DIR_FALHAS, `${c.nome}.png`), buffer)
        ok(r.iguais, `${c.nome}: sem regressão visual`, r.motivo)
      }
    } catch (e) {
      ok(false, `${c.nome}: cenário executou`, String(e?.message || e))
    } finally {
      await ctx.close()
    }
  }

  await navegador.close()

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed) {
    console.log("\nFalhas:")
    falhas.forEach((f) => console.log(`  · ${f}`))
    console.log(`\nAs imagens novas estão em ${DIR_FALHAS}/ para comparação.`)
    process.exit(1)
  }
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
