// F7.1 — GUARDA PERMANENTE de autorização do Financeiro.
// Invariante: NENHUM handler HTTP do domínio financeiro (incluindo o legado e as rotas
// de fatura/pagamento em /processos) pode responder sem antes passar por um gate de
// permissão server-side. O gate é lido ESTATICAMENTE do próprio handler — se alguém criar
// uma rota nova sem gate, este teste quebra antes do deploy.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

const RAIZ = join(__dirname, '..')
const ALVOS = [
  'src/app/api/financeiro',
  'src/app/api/processos/[processoId]/faturas',
  'src/app/api/processos/[processoId]/custos',
  'src/app/api/processos/[processoId]/outros-custos',
  'src/app/api/outros-custos',
  'src/app/api/pagamentos-outro-custo',
]
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
// Qualquer uma destas chamadas conta como gate server-side de autorização.
const GATES = [
  'verificarPermissao(', 'verificarPermissoes(', 'exigirPermissao(',
  'verificarPermissaoCusto(', 'verificarPermissaoCustoDaObrigacao(', 'verificarPermissaoCustoPorRef(',
]

function rotas(dir: string): string[] {
  const abs = join(RAIZ, dir)
  let entradas: string[] = []
  try { entradas = readdirSync(abs) } catch { return [] }
  const out: string[] = []
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(join(RAIZ, p)).isDirectory()) out.push(...rotas(p))
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

/** Corpo de cada handler exportado, isolado (do `export async function X` até o próximo export). */
function handlers(src: string): Array<{ metodo: string; corpo: string }> {
  const marcas: Array<{ metodo: string; inicio: number }> = []
  for (const m of METODOS) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${m}\\s*\\(`, 'g')
    let hit: RegExpExecArray | null
    while ((hit = re.exec(src))) marcas.push({ metodo: m, inicio: hit.index })
  }
  marcas.sort((a, b) => a.inicio - b.inicio)
  return marcas.map((mk, i) => ({ metodo: mk.metodo, corpo: src.slice(mk.inicio, marcas[i + 1]?.inicio ?? src.length) }))
}

/** Helpers LOCAIS do arquivo que já contêm um gate contam como gate (padrão `guard(req)`). */
function gatesDoArquivo(src: string): string[] {
  const aceitos = [...GATES]
  const locais = [...src.matchAll(/(?:^|\n)\s*(?:export\s+)?async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g)]
    .map((m) => ({ nome: m[1], inicio: m.index ?? 0 }))
    .filter((f) => !METODOS.includes(f.nome))
  for (let volta = 0; volta < 3; volta++) {
    for (const f of locais) {
      const fim = locais.concat([{ nome: '', inicio: src.length }]).map((x) => x.inicio).filter((i) => i > f.inicio).sort((a, b) => a - b)[0] ?? src.length
      const corpo = src.slice(f.inicio, fim)
      if (aceitos.some((g) => corpo.includes(g)) && !aceitos.includes(`${f.nome}(`)) aceitos.push(`${f.nome}(`)
    }
  }
  return aceitos
}

async function main() {
  const arquivos = ALVOS.flatMap(rotas)
  chk(arquivos.length > 0, `varredura encontrou rotas (${arquivos.length} arquivos)`)

  const abertos: string[] = []
  let totalHandlers = 0
  for (const arq of arquivos) {
    const src = readFileSync(join(RAIZ, arq), 'utf8')
    const aceitos = gatesDoArquivo(src)
    for (const h of handlers(src)) {
      totalHandlers++
      if (!aceitos.some((g) => h.corpo.includes(g))) abertos.push(`${relative('src/app/api', arq)} :: ${h.metodo}`)
    }
  }
  chk(totalHandlers > 50, `handlers HTTP financeiros varridos (${totalHandlers})`)
  if (abertos.length) { console.log('\n  Handlers SEM gate de permissão:'); for (const a of abertos) console.log('    •', a) }
  chk(abertos.length === 0, `todo handler financeiro tem gate server-side (${abertos.length} aberto(s))`)

  // Regressões específicas apontadas na auditoria pré-deploy (não podem voltar):
  const exigir = (arq: string, metodo: string, gate: string) => {
    const src = readFileSync(join(RAIZ, arq), 'utf8')
    const h = handlers(src).find((x) => x.metodo === metodo)
    chk(!!h && h.corpo.includes(gate), `${relative('src/app/api', arq)} :: ${metodo} exige ${gate}`)
  }
  exigir('src/app/api/financeiro/custos/[id]/cancelar/route.ts', 'POST', "verificarPermissaoCusto(req, 'cancelar')")
  exigir('src/app/api/financeiro/custos/[id]/estornar/route.ts', 'POST', "verificarPermissaoCusto(req, 'estornar')")
  exigir('src/app/api/financeiro/receitas/[id]/route.ts', 'GET', "financeiro.ver")
  exigir('src/app/api/financeiro/receitas/[id]/route.ts', 'PATCH', "financeiro.ver")
  exigir('src/app/api/financeiro/receitas/[id]/route.ts', 'DELETE', "financeiro.ver")
  exigir('src/app/api/financeiro/receitas/[id]/detalhe/route.ts', 'GET', "financeiro.ver")
  exigir('src/app/api/financeiro/lancamento/route.ts', 'GET', "financeiro.ver")
  exigir('src/app/api/financeiro/v3/extrato/route.ts', 'GET', "financeiro.ver")
  exigir('src/app/api/financeiro/v3/pagamentos/route.ts', 'GET', "financeiro.ver")
  exigir('src/app/api/processos/[processoId]/faturas/[faturaId]/pagamentos/[pagamentoId]/route.ts', 'PATCH', "financeiro.pagamento_editar")
  exigir('src/app/api/processos/[processoId]/faturas/[faturaId]/pagamentos/[pagamentoId]/route.ts', 'DELETE', "financeiro.pagamento_excluir")

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
