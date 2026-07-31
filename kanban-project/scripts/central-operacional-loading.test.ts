/**
 * GUARDA — Central Operacional: o carregamento SEMPRE termina.
 * Rodar: npm run test:central-loading
 *
 * DEFEITO QUE ISTO TRAVA (produção, 31/07): a aba ficava eternamente no spinner.
 *
 * Causa raiz em DUAS camadas, e as duas precisam continuar corrigidas:
 *   1. `useApi` devolvia objeto e `recarregar` NOVOS a cada render. Qualquer
 *      `useCallback`/`useEffect` que dependesse do resultado disparava sempre.
 *   2. A Central tinha `useEffect(() => carregar(), [carregar])`, que somado a (1)
 *      virava revalidação infinita: mutate → render → nova identidade → mutate.
 *      A consulta nunca estabilizava, então `carregando` nunca virava false.
 *
 * Não adianta consertar só a tela: sem (1), qualquer tela nova recria o defeito.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)

console.log('Central Operacional — o loading sempre termina\n')

const dados = src('src/lib/dados/index.ts')
const central = src('src/components/kanban/ProcessoCentralOperacional.tsx')

secao('1) Camada de dados: identidade estável (causa raiz)')
{
  ok('recarregar é memoizado por mutate', dados.includes('const recarregar = useCallback((dados?: T) => mutate(dados as T | undefined), [mutate])'))
  ok('o resultado é memoizado', dados.includes('return useMemo(') && dados.includes('[data, isLoading, isValidating, error, recarregar]'))
  ok('nenhuma arrow inline em recarregar', !/recarregar:\s*\(dados\?: T\)\s*=>\s*mutate/.test(dados))
  ok('useApi e useConsulta corrigidos', (dados.match(/const recarregar = useCallback/g) ?? []).length === 2)
  ok('a razão está escrita no código', dados.includes('ESTABILIDADE REFERENCIAL'))
}

secao('2) A Central não reabastece o ciclo')
{
  ok('sem efeito de carga redundante', !/useEffect\(\(\) => \{\s*carregar\(\)\s*\}, \[carregar\]\)/.test(central))
  ok('a ausência do efeito está justificada', central.includes('NÃO existe efeito de carga aqui'))
}

secao('3) Os quatro estados existem e o loading termina em todos')
{
  ok('carregando', central.includes('ESTADO 1: carregando') && central.includes('if (loading && !data)'))
  ok('erro', central.includes('ESTADO 2: erro') && central.includes('if (erro && !data)'))
  ok('erro tem ação "Tentar novamente"', /ESTADO 2[\s\S]{0,900}Tentar novamente/.test(central))
  ok('erro é recuperável (limpa e recarrega)', central.includes('setErro(null); carregar()'))
  ok('vazio NÃO é mais um return null mudo', !/if \(!data\) return null/.test(central))
  ok('vazio explica o que houve', central.includes('Nenhuma operação materializada para este processo'))
  ok('vazio também oferece nova tentativa', /ESTADO 3[\s\S]{0,1200}Tentar novamente/.test(central))
  ok('conteúdo segue após os três estados', central.indexOf('ESTADO 3') < central.indexOf('CÁLCULOS'))
}

secao('4) Nada de máscara sobre o defeito')
{
  ok('sem timeout escondendo o loading da Central', !/setTimeout\([^)]*setLoading/.test(central))
  ok('sem dado fictício', !/mock|fixture|dadosFalsos/i.test(central))
  // A Central consulta a MESMA rota duas vezes: fase ativa e fase passada. Não é
  // leitura paralela — é a Central unificada, com a fase no PARÂMETRO. O que não
  // pode existir é uma segunda FONTE para a mesma fase, nem consulta de fase
  // passada ligada quando nenhuma foi escolhida.
  ok('a fase passada usa a MESMA rota oficial', (central.match(/central-operacional\?\$\{params/g) ?? []).length === 2)
  ok('a consulta de fase passada desliga com null', central.includes('if (!selectedPhaseKey) return null'))
  ok('sem fetch manual da Central fora da camada oficial', !/fetch\(`\/api\/processos\/\$\{processo\.id\}\/central-operacional/.test(central))
}

secao('5) Requisições obsoletas são canceladas')
{
  ok('AbortController nos fetches manuais', central.includes('new AbortController()') && central.includes('signal: ctrl.signal'))
  ok('loading do fetch manual sempre encerra', central.includes('} finally {'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Central Operacional: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log('\nFalhas:'); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
console.log('Loading sempre termina · quatro estados garantidos ✅')
