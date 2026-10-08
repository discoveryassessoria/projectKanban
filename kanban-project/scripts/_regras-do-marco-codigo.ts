// scripts/_regras-do-marco-codigo.ts — varreduras de CÓDIGO das regras do Marco (usadas pelo script e pelo teste da suíte).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const arquivos = (raiz: string, ext: RegExp): string[] => {
  const out: string[] = []
  const varrer = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== ".next") varrer(p) } else if (ext.test(n)) out.push(p) } }
  varrer(raiz)
  return out
}
export const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** As «portas de atribuição» da interface: quem chama as rotas que gravam responsável. */
const CHAMA_ATRIBUICAO = [
  /acao:\s*["']atribuir["']/, /acao:\s*["']transferir["']/, /ATRIBUIR_ESCOLHIDO/, /"ATRIBUIR"/, /\/api\/tarefas\/redistribuir/, /\/api\/tarefas\/\$\{[^}]+\}\/atribuir/,
  /\/api\/torre\/tarefas\/lote/, /atribuirEmLote/, /novoResponsavelId/, /responsavelId:\s*Number\(/,
  // 07/10/2026 — os padrões que o detector antigo NÃO via (a tela viva /operacao e outras portas passavam batido).
  /"atribuir"\s*:\s*"transferir"/, /["']devolver_a_fila["']/, /\/atribuir-sugerido/, /\/remover-responsavel/, /ATRIBUIR_SUGERIDO/, /\/api\/tarefas\/\$\{[^}]+\}\/comando[\s\S]{0,200}atribuir/,
]
/** Os componentes que PODEM atribuir hoje, FORA da página do processo (/torre/processo/[id]). Lista-baseline: novo item aqui quebra o teste. */
export function portasDeAtribuicaoForaDoProcesso(): string[] {
  const NA_PAGINA_DO_PROCESSO = new Set(["src/components/torre/TorreProcessoPagina.tsx", "src/components/torre/ProcessoCertidoes.tsx", "src/components/torre/lote-atribuicao.tsx"])
  return arquivos("src/components", /\.tsx$/)
    .filter((f) => !NA_PAGINA_DO_PROCESSO.has(f))
    .filter((f) => CHAMA_ATRIBUICAO.some((re) => re.test(semComentarios(readFileSync(f, "utf8")))))
    .sort()
}
export { arquivos }
