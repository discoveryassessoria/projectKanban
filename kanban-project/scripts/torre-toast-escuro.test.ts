// scripts/torre-toast-escuro.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — TOAST ESCURO DO PROTÓTIPO (#17223b), texto claro, contraste AA, em TODAS as telas da Torre.
//
//   npx tsx scripts/torre-toast-escuro.test.ts   (sem banco)
//
// O hex mora SÓ nos tokens do bloco delimitado "toast" do fim de torre.css; as três superfícies de toast (.tor-toast: torre-base e
// Precisa de você; .tpr-toast: Detalhe do Processo) usam os tokens; nenhum componente do Torre tem cor solta de toast.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const DIR = "src/components/torre"

const css = ler(`${DIR}/torre.css`)
const m = /\/\* ===== toast \(início\) ===== \*\/([\s\S]*?)\/\* ===== toast \(fim\) ===== \*\//.exec(css)
ok("bloco delimitado '===== toast (início/fim) =====' existe no fim de torre.css", !!m && css.trimEnd().endsWith("/* ===== toast (fim) ===== */"))
const bloco = m?.[1] ?? ""

// tokens
const tok = (n: string) => new RegExp(`--${n}:\\s*([^;]+);`).exec(bloco)?.[1].trim() ?? ""
ok("token do fundo = #17223b (o do protótipo)", tok("tor-toast-fundo").toLowerCase() === "#17223b", tok("tor-toast-fundo"))
ok("token do texto = branco", tok("tor-toast-texto").toLowerCase() === "#ffffff")

// contraste WCAG 2.x
const lum = (r: number, g: number, b: number) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const contraste = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(...a), lum(...b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const fundo = hex(tok("tor-toast-fundo")), texto = hex(tok("tor-toast-texto"))
const c1 = contraste(texto, fundo)
ok(`texto sobre o fundo: ${c1.toFixed(1)}:1 ≥ 4.5 (AA) — e ≥ 7 (AAA)`, c1 >= 7, c1.toFixed(2))
const suave = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(tok("tor-toast-texto-suave"))
const a = Number(suave?.[4] ?? 0)
const misturado = [0, 1, 2].map((i) => Math.round(Number(suave?.[i + 1]) * a + fundo[i] * (1 - a))) as [number, number, number]
const c2 = contraste(misturado, fundo)
ok(`texto suave (detalhe) sobre o fundo: ${c2.toFixed(1)}:1 ≥ 4.5 (AA)`, c2 >= 4.5, c2.toFixed(2))
const contorno = hex(tok("tor-toast-contorno"))
ok(`contorno dos botões sobre o fundo: ${contraste(contorno, fundo).toFixed(1)}:1 ≥ 3 (componente de interface)`, contraste(contorno, fundo) >= 3)

// as três superfícies usam o token
ok(".tor-toast e .tpr-toast pintam com var(--tor-toast-fundo) e var(--tor-toast-texto)", /\.tor-toast,\s*\.tpr-toast\s*\{[^}]*background:\s*var\(--tor-toast-fundo\)[^}]*color:\s*var\(--tor-toast-texto\)/.test(bloco))
ok("os botões Desfazer/✕ do toast têm contorno e texto claros (tokens)", /\.tor-toast \.tor-btn,\s*\.tpr-toast \.tor-btn\s*\{[^}]*color:\s*var\(--tor-toast-texto\)/.test(bloco) && /border:\s*1px solid var\(--tor-toast-contorno\)/.test(bloco))
ok("o detalhe do toast do Precisa de você usa o texto suave claro", /\.tor-toast \.pdv-toast-det\s*\{[^}]*var\(--tor-toast-texto-suave\)/.test(bloco))
ok("as regras antigas (torre.css/processo.css) não pintam mais o toast com o tema claro", !/\.tor-toast\s*\{[^}]*(surface-popover|text-primary)/.test(css.replace(bloco, "")) && !/\.tpr-toast\s*\{[^}]*(surface-popover|text-primary)/.test(ler(`${DIR}/processo.css`)))

// quem renderiza toast usa as classes (e não cor própria)
const tsx = readdirSync(DIR).filter((f) => f.endsWith(".tsx"))
const comToast = tsx.filter((f) => /className="(tor|tpr)-toast"/.test(ler(`${DIR}/${f}`)))
ok("as superfícies de toast são exatamente torre-base, acoes-do-item e TorreProcessoPagina", JSON.stringify(comToast.sort()) === JSON.stringify(["TorreProcessoPagina.tsx", "acoes-do-item.tsx", "torre-base.tsx"]), comToast.join(", "))
ok("nenhum componente do Torre dá cor própria ao toast (style com background/color no elemento do toast)", comToast.every((f) => !/className="(tor|tpr)-toast"[^>]*style=/.test(ler(`${DIR}/${f}`))))

// hex solto: #17223b não aparece em nenhum outro lugar de CSS/TSX da Torre fora do bloco de tokens
const solto: string[] = []
for (const f of readdirSync(DIR)) {
  if (!/\.(css|tsx|ts)$/.test(f)) continue
  const t = ler(`${DIR}/${f}`)
  const semBloco = f === "torre.css" ? t.replace(bloco, "") : t
  if (/#17223b/i.test(semBloco)) solto.push(f)
}
ok("o hex #17223b só existe no bloco de tokens do toast (nada solto)", solto.length === 0, solto.join(", "))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
