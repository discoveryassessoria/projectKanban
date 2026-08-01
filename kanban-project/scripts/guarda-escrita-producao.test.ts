/**
 * GUARDA — escrita em produção pelos scripts administrativos.
 * Rodar: npm run test:guarda-producao
 *
 * O defeito que este teste trava: quatro scripts de operação de dados
 * (prod-consolidar-categorias, prod-ativar-certidoes-mestre,
 * prod-registrar-enquadramentos-lmd, prod-resolver-matriz-orfas) rodavam
 * dentro do `npm run build` sem NENHUMA trava de ambiente. Liam
 * `PRISMA_DATABASE_URL || DATABASE_URL` e escreviam contra o que achassem.
 * Um build local com o ambiente errado carregado escreveria em produção.
 *
 * Nenhum teste aqui abre conexão com banco: o Prisma é injetado como duplo.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MOTIVO,
  VALOR_FLAG_AUTORIZACAO,
  avaliarAutorizacao,
  executarOperacaoProducao,
  rodarScriptProducao,
} from '../lib/db/guarda-escrita-producao.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)

console.log('Guarda de escrita em produção — scripts administrativos\n')

async function main() {

const FLAG = 'PROD_TESTE_OPERACAO'
const URL_FICTICIA = 'postgresql://usuario:x@host-de-teste:5432/banco'

/** Retrato que `classificar()` reconhece como PRODUCAO. */
const PRODUCAO = { tabelas: 153, migrations: 101, requerentes: 900 }
/** Retrato de um banco de desenvolvimento — mesma forma, volume incompatível. */
const DESENVOLVIMENTO = { tabelas: 12, migrations: 3, requerentes: 0 }

/**
 * Duplo de PrismaClient. Responde só aos SELECTs de `retratar()`.
 * Não expõe NENHUM model: qualquer tentativa de escrita estoura na hora,
 * que é exatamente a prova que interessa.
 */
function bancoFalso({ tabelas, migrations, requerentes }: { tabelas: number; migrations: number; requerentes: number }) {
  const consultas: string[] = []
  return {
    consultas,
    $queryRawUnsafe: async (sql: string) => {
      consultas.push(sql)
      if (sql.includes("table_type='BASE TABLE'")) return [{ n: tabelas }]
      if (sql.includes('table_name=')) return [{ n: 1 }]          // sentinelas presentes
      if (sql.includes('_prisma_migrations')) return [{ n: migrations }]
      if (sql.includes('"Requerente"')) return [{ n: requerentes }]
      return [{ n: 0 }]
    },
    $disconnect: async () => {},
  }
}

/** Monta um cenário completo e devolve o que aconteceu, sem efeitos colaterais. */
async function cenario(env: Record<string, string | undefined>, retrato = PRODUCAO, operacaoQuebra = false) {
  let criouPrisma = false
  let operacaoChamada = false
  let erro: unknown = null
  let resultado: { executado: boolean; motivo: string } | null = null
  try {
    resultado = await executarOperacaoProducao({
      nome: 'teste',
      flag: FLAG,
      env,
      criarPrisma: () => { criouPrisma = true; return bancoFalso(retrato) },
      operacao: async () => {
        operacaoChamada = true
        if (operacaoQuebra) throw new Error('falha simulada no meio da operação')
      },
    })
  } catch (e) {
    erro = e
  }
  return { criouPrisma, operacaoChamada, erro, resultado }
}

// ── 1) LOCAL SEM FLAG ───────────────────────────────────────────────────────
secao('1) Local, sem flag: zero escrita')
{
  const veredito = avaliarAutorizacao({ flag: FLAG, env: {} })
  ok('não autoriza', veredito.autorizado === false)
  ok('motivo é ambiente não-produção', veredito.motivo === MOTIVO.AMBIENTE_NAO_PRODUCAO)
  ok('não é falha fatal (o comando sai 0)', veredito.fatal === false)

  const r = await cenario({})
  ok('nenhuma conexão de banco foi aberta', r.criouPrisma === false)
  ok('a operação nunca foi chamada', r.operacaoChamada === false)
  ok('não lançou erro', r.erro === null)
  ok('resultado diz que não executou', r.resultado?.executado === false)
}

// ── 2) LOCAL COM VARIÁVEL DE BANCO POR ACIDENTE ─────────────────────────────
secao('2) Local com variável de banco carregada por acidente: zero escrita')
{
  // O cenário real: `.env.local` ou task do editor injetando credencial no shell.
  const envAcidental = {
    DATABASE_URL: URL_FICTICIA,
    PRISMA_DATABASE_URL: URL_FICTICIA,
    DIRECT_DATABASE_URL: URL_FICTICIA,
    [FLAG]: VALOR_FLAG_AUTORIZACAO,           // até a flag: ainda assim não basta
  }
  const veredito = avaliarAutorizacao({ flag: FLAG, env: envAcidental })
  ok('credencial presente não autoriza nada', veredito.autorizado === false)
  ok('barrado pelo ambiente, não pela ausência de URL', veredito.motivo === MOTIVO.AMBIENTE_NAO_PRODUCAO)

  const r = await cenario(envAcidental)
  ok('nenhuma conexão de banco foi aberta', r.criouPrisma === false)
  ok('a operação nunca foi chamada', r.operacaoChamada === false)
}

// ── 3) PREVIEW ──────────────────────────────────────────────────────────────
secao('3) Preview: zero escrita')
{
  const envPreview = { VERCEL_ENV: 'preview', PRISMA_DATABASE_URL: URL_FICTICIA, [FLAG]: VALOR_FLAG_AUTORIZACAO }
  const veredito = avaliarAutorizacao({ flag: FLAG, env: envPreview })
  ok('preview não é production', veredito.autorizado === false)
  ok('motivo é ambiente não-produção', veredito.motivo === MOTIVO.AMBIENTE_NAO_PRODUCAO)

  const r = await cenario(envPreview)
  ok('nenhuma conexão de banco foi aberta', r.criouPrisma === false)
  ok('a operação nunca foi chamada', r.operacaoChamada === false)
}

// ── 4) PRODUÇÃO SEM FLAG ────────────────────────────────────────────────────
secao('4) Produção sem flag: zero escrita')
{
  const envProdSemFlag = { VERCEL_ENV: 'production', PRISMA_DATABASE_URL: URL_FICTICIA }
  const veredito = avaliarAutorizacao({ flag: FLAG, env: envProdSemFlag })
  ok('ambiente certo não basta', veredito.autorizado === false)
  ok('motivo é flag ausente', veredito.motivo === MOTIVO.FLAG_AUSENTE)

  const r = await cenario(envProdSemFlag)
  ok('nenhuma conexão de banco foi aberta', r.criouPrisma === false)
  ok('a operação nunca foi chamada', r.operacaoChamada === false)

  // Flag com valor aproximado também não vale.
  for (const valor of ['1', 'true', 'sim', 'aplicar', 'APLICAR ']) {
    const v = avaliarAutorizacao({ flag: FLAG, env: { ...envProdSemFlag, [FLAG]: valor } })
    ok(`flag="${valor}" não autoriza`, v.autorizado === false && v.motivo === MOTIVO.FLAG_AUSENTE)
  }
}

// ── 4b) DATABASE_URL NÃO É FALLBACK ─────────────────────────────────────────
secao('4b) DATABASE_URL não substitui a variável oficial')
{
  const env = { VERCEL_ENV: 'production', [FLAG]: VALOR_FLAG_AUTORIZACAO, DATABASE_URL: URL_FICTICIA }
  const veredito = avaliarAutorizacao({ flag: FLAG, env })
  ok('não autoriza com DATABASE_URL apenas', veredito.autorizado === false)
  ok('motivo é URL oficial ausente', veredito.motivo === MOTIVO.URL_PRODUCAO_AUSENTE)
  ok('é falha fatal (configuração quebrada em produção)', veredito.fatal === true)

  const r = await cenario(env)
  ok('lançou erro em vez de escrever', r.erro !== null)
  ok('nenhuma conexão de banco foi aberta', r.criouPrisma === false)
  ok('a operação nunca foi chamada', r.operacaoChamada === false)
}

// ── 5) PRODUÇÃO AUTORIZADA, MAS BANCO NÃO É PRODUÇÃO ────────────────────────
secao('5) Produção com flag, banco não classificado como PRODUCAO: aborta')
{
  const env = { VERCEL_ENV: 'production', [FLAG]: VALOR_FLAG_AUTORIZACAO, PRISMA_DATABASE_URL: URL_FICTICIA }
  const r = await cenario(env, DESENVOLVIMENTO)
  ok('abriu conexão para provar a identidade', r.criouPrisma === true)
  ok('abortou antes de operar', r.operacaoChamada === false)
  ok('lançou erro de guarda', r.erro !== null)
  ok('motivo é identidade não-produção', (r.erro as { motivo?: string })?.motivo === MOTIVO.IDENTIDADE_NAO_PRODUCAO)
}

// ── 6) PRODUÇÃO AUTORIZADA E BANCO CORRETO ──────────────────────────────────
secao('6) Produção autorizada e banco correto: operação permitida')
{
  const env = { VERCEL_ENV: 'production', [FLAG]: VALOR_FLAG_AUTORIZACAO, PRISMA_DATABASE_URL: URL_FICTICIA }
  const veredito = avaliarAutorizacao({ flag: FLAG, env })
  ok('autoriza', veredito.autorizado === true)
  ok('usa a URL oficial', veredito.url === URL_FICTICIA)

  const r = await cenario(env, PRODUCAO)
  ok('abriu conexão', r.criouPrisma === true)
  ok('a operação foi executada', r.operacaoChamada === true)
  ok('sem erro', r.erro === null)
  ok('resultado diz que executou', r.resultado?.executado === true)
}

// ── 7) FALHA DA OPERAÇÃO AUTORIZADA → EXIT != 0 ─────────────────────────────
secao('7) Falha durante operação autorizada: código de saída diferente de zero')
{
  const env = { VERCEL_ENV: 'production', [FLAG]: VALOR_FLAG_AUTORIZACAO, PRISMA_DATABASE_URL: URL_FICTICIA }

  const r = await cenario(env, PRODUCAO, true)
  ok('a operação foi chamada e quebrou', r.operacaoChamada === true && r.erro !== null)

  // `rodarScriptProducao` é o que os scripts usam: traduz falha em exit code.
  const antes = process.exitCode
  process.exitCode = 0
  const saida = await rodarScriptProducao({
    nome: 'teste',
    flag: FLAG,
    env,
    criarPrisma: () => bancoFalso(PRODUCAO),
    operacao: async () => { throw new Error('falha simulada') },
  })
  const codigo = process.exitCode
  process.exitCode = antes ?? 0
  ok('exit code virou 1', codigo === 1)
  ok('não relançou (o topo do processo decide)', saida.executado === false)

  // E o caminho de "pulou": tem de sair 0.
  process.exitCode = 0
  await rodarScriptProducao({
    nome: 'teste',
    flag: FLAG,
    env: {},
    criarPrisma: () => bancoFalso(PRODUCAO),
    operacao: async () => {},
  })
  const codigoPulo = process.exitCode
  process.exitCode = antes ?? 0
  ok('pular mantém exit code 0', codigoPulo === 0)
}

// ── 8) OS QUATRO SCRIPTS REAIS ESTÃO SOB A GUARDA ───────────────────────────
secao('8) Os quatro scripts administrativos usam a guarda')
{
  const SCRIPTS: Array<[string, string]> = [
    ['scripts/prod-consolidar-categorias.mjs', 'PROD_CONSOLIDAR_CATEGORIAS'],
    ['scripts/prod-ativar-certidoes-mestre.mjs', 'PROD_ATIVAR_CERTIDOES_MESTRE'],
    ['scripts/prod-registrar-enquadramentos-lmd.mjs', 'PROD_REGISTRAR_ENQUADRAMENTOS_LMD'],
    ['scripts/prod-resolver-matriz-orfas.mjs', 'PROD_RESOLVER_MATRIZ_ORFAS'],
  ]
  for (const [caminho, flag] of SCRIPTS) {
    const codigo = src(caminho)
    const nome = caminho.replace('scripts/', '')
    ok(`${nome}: importa a guarda`, codigo.includes('guarda-escrita-producao.mjs'))
    ok(`${nome}: passa pelo rodarScriptProducao`, codigo.includes('rodarScriptProducao('))
    ok(`${nome}: declara a flag ${flag}`, codigo.includes(`'${flag}'`))
    ok(`${nome}: não lê DATABASE_URL`, !/process\.env\.DATABASE_URL/.test(codigo))
    ok(`${nome}: não instancia Prisma no topo`, !/^const prisma = new PrismaClient\(\)/m.test(codigo))
    ok(`${nome}: não engole erro em main().catch`, !/main\(\)\.catch/.test(codigo))
  }
}

// ── 9) O BUILD NÃO CARREGA OPERAÇÃO DE DADOS ────────────────────────────────
secao('9) O build padrão não executa operação de dados')
{
  const pkg = JSON.parse(src('package.json')) as { scripts: Record<string, string> }
  const build = pkg.scripts.build ?? ''
  const PROIBIDOS = [
    'prod-consolidar-categorias', 'prod-ativar-certidoes-mestre',
    'prod-registrar-enquadramentos-lmd', 'prod-resolver-matriz-orfas',
    'prod-migrate-guard', 'prod-seed-', 'prod-apply-cadastros-aditivas',
    'prod-smoke-dual-write', 'prod-custos-rollout', 'prod-registral-rollout',
    'prod-reconciliar-sequencias', 'preview-sandbox-setup',
    'homolog-baseline', 'homolog-validar', 'homolog-smokes',
    'migrate deploy', 'db push', 'prisma db seed',
  ]
  for (const p of PROIBIDOS) ok(`build não contém "${p}"`, !build.includes(p))
  ok('build compila o Next', build.includes('next build'))
  ok('build gera o Prisma Client', build.includes('prisma generate'))
  ok('existe script typecheck canônico', pkg.scripts.typecheck === 'tsc --noEmit')
}

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Guarda de escrita em produção: ${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log('\nFalhas:'); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  console.log('Escrita em produção protegida ✅')
}

main().catch((e) => { console.error(e); process.exit(1) })
