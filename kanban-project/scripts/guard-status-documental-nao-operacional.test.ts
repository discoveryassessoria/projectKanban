/**
 * GUARD — `Documento.status` não volta a disputar o estado operacional.
 *
 * O enum StatusDocumento tem 15 valores e eles SÃO o workflow escrito uma
 * segunda vez: PENDENTE → SOLICITAR → SOLICITADO → EM_BUSCA → RECEBIDO →
 * EM_ANALISE → … → ENTREGUE. É resíduo do motor antigo. Hoje só quatro
 * valores ainda são escritos (o upload do app grava RECEBIDO; cancelar,
 * invalidar e "desnecessário" gravam os outros três), e nenhum passo do
 * workflow toca o campo.
 *
 * Exibi-lo ao lado do estado operacional produzia a contradição que motivou
 * este guard: uma certidão parada em "Solicitar certidão" anunciando
 * "Doc.: Recebido", porque o RECEBIDO vinha de um ciclo anterior concluído.
 *
 * Onde a execução está, quem diz é o PASSO. O campo continua no banco — quem
 * escreve nele não foi alterado —, mas não volta para a superfície operacional.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const RAIZ = ["src/components/kanban", "src/components/home", "src/app/dashboard"]

/** Renderizar o rótulo = interpolar o label num JSX de texto visível. */
const PROIBIDO = [
  /Doc\.:\s*\{[^}]*statusDocumental/,
  /Documento:\s*\{[^}]*statusDocumental/,
]

function arquivos(dir: string): string[] {
  let out: string[] = []
  let itens: string[]
  try { itens = readdirSync(dir) } catch { return [] }
  for (const it of itens) {
    const p = join(dir, it)
    if (statSync(p).isDirectory()) out = out.concat(arquivos(p))
    else if (p.endsWith(".tsx")) out.push(p)
  }
  return out
}

const violacoes: string[] = []
for (const raiz of RAIZ) {
  for (const arq of arquivos(raiz)) {
    const linhas = readFileSync(arq, "utf8").split("\n")
    linhas.forEach((l, i) => {
      for (const re of PROIBIDO) {
        if (re.test(l)) violacoes.push(`${arq}:${i + 1}  ${l.trim().slice(0, 90)}`)
      }
    })
  }
}

if (violacoes.length) {
  console.error("\n❌ `Documento.status` voltou à superfície operacional:\n")
  violacoes.forEach((v) => console.error("   " + v))
  console.error("\n   O ponto da execução é o PASSO. Este campo é do motor antigo.\n")
  process.exit(1)
}
console.log(`✅ ${arquivos(RAIZ[0]).length + arquivos(RAIZ[1]).length + arquivos(RAIZ[2]).length} telas · nenhuma exibe o estado legado do Documento`)
