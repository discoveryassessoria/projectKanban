/**
 * GUARDA — a pessoa, dentro do processo, é o NOME.
 * Rodar: npm run test:pessoa-nome
 *
 * REGRA: em qualquer tela de processo (Geral, cards, Central Operacional,
 * Árvore, Financeiro, Documentos, Eventos, Histórico) a pessoa é apresentada
 * SOMENTE pelo nome completo. O código público do cliente (CLI-n) continua
 * existindo no domínio, no banco e na API, e continua visível no cadastro de
 * origem e nos contextos administrativos.
 *
 * Fonte única da apresentação: src/lib/ui/pessoa-exibicao.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { nomePessoa, nomesPessoas, rotuloAdministrativoPessoa } from '../src/lib/ui/pessoa-exibicao'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

let falhas = 0
let testes = 0
function verificar(nome: string, condicao: boolean, detalhe = '') {
  testes++
  if (condicao) { console.log(`  ✓ ${nome}`); return }
  falhas++
  console.log(`  ✗ ${nome}${detalhe ? `\n      ${detalhe}` : ''}`)
}

// ─── Superfícies OPERACIONAIS do processo: código de cliente é proibido ──────
const SUPERFICIES_OPERACIONAIS = [
  'src/components/kanban',
  'src/components/arvore',
  'src/components/financeiro',
  'src/components/activitiesComponents',
  'src/app/kanban',
]

// ─── Superfícies ADMINISTRATIVAS: o código continua visível ──────────────────
const FICHA_CLIENTE = 'src/components/contratantes-tabela.tsx'

/**
 * Exceções nomeadas: `publicCode` que NÃO é código de pessoa. Cada linha diz
 * de quem é o código. Documento e tipo de documento têm identidade própria e
 * seguem exibindo o código dentro do processo.
 */
const EXCECOES: Array<{ arquivo: string; trecho: string; motivo: string }> = [
  {
    arquivo: 'src/components/kanban/ProcessoProtocolos.tsx',
    trecho: 'const codigo = d.publicCode',
    motivo: 'Código do DOCUMENTO (DOC-n) no rótulo do documento protocolado — não é código de pessoa.',
  },
  {
    arquivo: 'src/components/kanban/OperacaoAntecipadaModal.tsx',
    trecho: 't.publicCode ? t.publicCode + " — " : ""',
    motivo: 'Código do TIPO DE DOCUMENTO (DOC-n) no seletor de documento — não é código de pessoa.',
  },
]

function arquivos(dir: string): string[] {
  const abs = join(RAIZ, dir)
  let entradas: string[]
  try { entradas = readdirSync(abs) } catch { return [] }
  const out: string[] = []
  for (const e of entradas) {
    const p = join(abs, e)
    if (statSync(p).isDirectory()) { out.push(...arquivos(join(dir, e))); continue }
    if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(join(dir, e))
  }
  return out
}

/** Concatenação de código público com nome de PESSOA (campo `nome`). */
const PADROES: Array<{ re: RegExp; descricao: string }> = [
  { re: /publicCode\s*\?[^\n]*\+\s*['"`][^'"`\n]*['"`][^\n]*\{[\w.]*\bnome\b/, descricao: "`x.publicCode ? x.publicCode + ' — ' : ''}{x.nome`" },
  { re: /\$\{[^}\n]*publicCode[^}\n]*\}[^`\n]*\$\{[^}\n]*\.nome[^}\n]*\}/, descricao: '`${x.publicCode} — ${x.nome}`' },
  { re: /\[\s*[\w.]*\.publicCode\s*,/, descricao: '[x.publicCode, …].join() no título da pessoa' },
  { re: /publicCode[^\n]{0,40}\}\s*\(?\s*\{?[\w.]*\.nome/, descricao: 'código colado ao nome da pessoa' },
]

function ehExcecao(arquivo: string, linha: string): boolean {
  return EXCECOES.some((e) => arquivo.endsWith(e.arquivo.split('/').pop()!) && linha.includes(e.trecho))
}

console.log('\n═══ PESSOA NO PROCESSO = NOME COMPLETO ═══\n')

// ── 1..3 — nenhuma tela operacional concatena código de cliente ao nome ──────
console.log('Superfícies operacionais do processo')
const achados: string[] = []
for (const dir of SUPERFICIES_OPERACIONAIS) {
  for (const rel of arquivos(dir)) {
    const linhas = readFileSync(join(RAIZ, rel), 'utf8').split('\n')
    linhas.forEach((linha, i) => {
      if (!linha.includes('publicCode')) return
      if (ehExcecao(rel, linha)) return
      for (const p of PADROES) {
        if (p.re.test(linha)) {
          achados.push(`${relative('.', rel)}:${i + 1} → ${p.descricao}\n      ${linha.trim().slice(0, 160)}`)
          break
        }
      }
    })
  }
}
verificar(
  'nenhuma tela do processo concatena código de cliente ao nome',
  achados.length === 0,
  achados.join('\n    '),
)

const modal = readFileSync(join(RAIZ, 'src/components/kanban/atividade-details-modal.tsx'), 'utf8')
verificar(
  'card de requerente renderiza apenas o nome (nomePessoa)',
  /Requerentes[\s\S]{0,1200}\{nomePessoa\(req\)\}/.test(modal),
)
verificar(
  'card de contratante renderiza apenas o nome (nomePessoa)',
  /Contratantes[\s\S]{0,1200}\{nomePessoa\(cont\)\}/.test(modal),
)

// ── 4 — a fonte única devolve só o nome, para um e para muitos ──────────────
console.log('\nFonte única de apresentação')
verificar(
  'nomePessoa devolve só o nome completo',
  nomePessoa({ nome: 'Caroline Abellan Pelluci', publicCode: 'CLI-135' }) === 'Caroline Abellan Pelluci',
)
verificar(
  'dois requerentes → dois nomes, nenhum código',
  nomesPessoas([
    { nome: 'Caroline Abellan Pelluci', publicCode: 'CLI-135' },
    { nome: 'Christine Abellan dos Santos', publicCode: 'CLI-136' },
  ]) === 'Caroline Abellan Pelluci, Christine Abellan dos Santos',
)
verificar(
  'nenhum CLI-n sobrevive à apresentação operacional',
  !nomesPessoas([
    { nome: 'Caroline Abellan Pelluci', publicCode: 'CLI-135' },
    { nome: 'Christine Abellan dos Santos', publicCode: 'CLI-136' },
  ]).includes('CLI-'),
)
verificar(
  'pessoa sem nome não vira código',
  nomePessoa({ nome: null, publicCode: 'CLI-999' }) === '',
)

// ── 5..6 — o código continua vivo no cadastro e na administração ────────────
console.log('\nContexto administrativo (o código continua)')
verificar(
  'rótulo administrativo mantém código + nome',
  rotuloAdministrativoPessoa({ nome: 'Caroline Abellan Pelluci', publicCode: 'CLI-135' }) === 'CLI-135 — Caroline Abellan Pelluci',
)
const ficha = readFileSync(join(RAIZ, FICHA_CLIENTE), 'utf8')
verificar(
  'listagem de clientes segue exibindo o código em coluna própria',
  /contratante\.publicCode\s*\?\?\s*'—'/.test(ficha),
)
verificar(
  'busca administrativa de clientes segue filtrando por código',
  /c\.publicCode\?\.toLowerCase\(\)\.includes/.test(ficha),
)

// ── 7 — a API continua devolvendo o código ─────────────────────────────────
console.log('\nDomínio e API (intocados)')
const apiProcesso = readFileSync(join(RAIZ, 'src/app/api/app/processos/[id]/route.ts'), 'utf8')
verificar(
  'API do processo continua selecionando publicCode de contratante e requerente',
  /contratante:\s*\{\s*select:\s*\{[^}]*publicCode/.test(apiProcesso) &&
  /requerente:\s*\{\s*select:\s*\{[^}]*publicCode/.test(apiProcesso),
)
const apiRequerentes = readFileSync(join(RAIZ, 'src/app/api/requerentes/route.ts'), 'utf8')
verificar(
  'busca por código na API continua funcionando',
  /publicCode:\s*\{\s*contains:\s*search/.test(apiRequerentes),
)
verificar(
  'geração automática do código público segue intacta',
  /gerarCodigoPublico\(tx,\s*'CLIENT'\)/.test(apiRequerentes),
)

// ── 8 — sem CSS escondendo, sem substring/replace ──────────────────────────
console.log('\nSem atalho de apresentação')
const fonte = readFileSync(join(RAIZ, 'src/lib/ui/pessoa-exibicao.ts'), 'utf8')
verificar(
  'a fonte única não usa substring/replace/regex para tirar o código',
  !/\.replace\(|\.substring\(|\.slice\(/.test(fonte),
)

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${testes - falhas}/${testes} verificações\n`)
process.exit(falhas === 0 ? 0 : 1)
