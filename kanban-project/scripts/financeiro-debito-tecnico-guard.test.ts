// F7.6 — GUARDA do débito técnico do Financeiro.
// Invariantes: uma única definição de autenticação HTTP no cliente, uma única formatação
// monetária, nenhuma flag declarada sem consumidor, e índice presente onde a leitura é feita.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

function arquivos(dir: string, ext = '.tsx'): string[] {
  const abs = join(RAIZ, dir)
  let entradas: string[] = []
  try { entradas = readdirSync(abs) } catch { return [] }
  const out: string[] = []
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(join(RAIZ, p)).isDirectory()) out.push(...arquivos(p, ext))
    else if (e.endsWith(ext)) out.push(p)
  }
  return out
}

async function main() {
  const telas = arquivos('src/components/financeiro')
  chk(telas.length > 20, `telas do Financeiro varridas (${telas.length})`)

  // (1) autenticação: nenhuma tela lê o token direto nem redeclara authHeaders
  const redeclaram = telas.filter((f) => /const authHeaders = |function authHeaders/.test(ler(f)))
  chk(redeclaram.length === 0, `nenhuma tela redeclara authHeaders (${redeclaram.join(', ') || 'nenhuma'})`)
  const lemToken = telas.filter((f) => f !== 'src/lib/financeiro/http.ts' && /localStorage\.getItem\(["']authToken["']\)/.test(ler(f)))
  chk(lemToken.length === 0, `nenhuma tela lê o token direto do localStorage (${lemToken.join(', ') || 'nenhuma'})`)
  const http = ler('src/lib/financeiro/http.ts')
  chk(http.includes('export function authHeaders') && http.includes('export function authToken'), 'helper único de HTTP exporta authHeaders/authToken')

  // (2) moeda: formatação vem do módulo único (exceção documentada: quem precisa de "—" p/ nulo)
  const EXCECOES = new Set(['src/components/financeiro/shared/FinanceiroGeralShared.tsx'])
  const formatamNaMao = telas.filter((f) => !EXCECOES.has(f) && /style: ["']currency["']/.test(ler(f)))
  chk(formatamNaMao.length === 0, `nenhuma tela reimplementa formatação monetária (${formatamNaMao.join(', ') || 'nenhuma'})`)
  const fmt = ler('src/lib/financeiro/formato.ts')
  chk(fmt.includes('export function fmtMoeda') && fmt.includes('export function fmtBrl'), 'módulo único de formatação exporta fmtMoeda/fmtBrl')

  // (3) flags: toda flag declarada precisa de consumidor real (flagAtiva('x')) fora do módulo
  const flags = ler('lib/financeiro/flags.ts')
  const declaradas = [...flags.matchAll(/^\s*\|\s*'([a-zA-Z]+)'/gm)].map((m) => m[1])
  chk(declaradas.length > 0, `flags declaradas (${declaradas.join(', ')})`)
  const fontes = [...arquivos('src/app', '.ts'), ...arquivos('lib', '.ts'), ...arquivos('src/components', '.tsx'), ...arquivos('scripts', '.ts')]
    .filter((f) => f !== 'lib/financeiro/flags.ts')
    .map(ler).join('\n')
  const orfas = declaradas.filter((f) => !fontes.includes(`flagAtiva('${f}'`) && !fontes.includes(`flags?.${f}`) && !fontes.includes(`flags.${f}`))
  chk(orfas.length === 0, `nenhuma flag declarada sem consumidor (${orfas.join(', ') || 'nenhuma'})`)

  // (4) índice: leitura de documento por obrigação precisa de índice
  const schema = ler('prisma/schema.prisma')
  const bloco = schema.slice(schema.indexOf('model ReceitaDocumento'), schema.indexOf('model EventoFinanceiro'))
  chk(bloco.includes('@@index([obrigacaoId])'), 'ReceitaDocumento tem índice por obrigacaoId')

  // (5) detalhe: metadados independentes carregados em paralelo (não em série)
  const detalhe = ler('lib/financeiro/leitura/receita-detalhe.ts')
  chk(/const \[proj, fornecedor, receita, itemMestre, processo, criador\] = await Promise\.all/.test(detalhe),
    'metadados do detalhe são carregados em paralelo')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
