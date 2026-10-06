// scripts/operacao-abrir-e-feito-por-pessoa.test.ts
// Operação da Daniela: (1) o "Abrir" da aba Feito não fazia nada (a concluída não estava entre as linhas que o painel conhece); (2) o "Abrir processo"
// da aba Famílias só mostrava "Ação ainda não ligada nesta tela"; (3) o Feito listava a família inteira numa tabela só — deve vir AGRUPADO POR PESSOA,
// como em A fazer, com nascimento → casamento → óbito dentro de cada pessoa.
import { readFileSync } from 'node:fs'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }
const tela = readFileSync('src/components/operacao/operacao-v3.tsx', 'utf8')
const abas = readFileSync('src/components/operacao/operacao-v3-abas.tsx', 'utf8')

ok('o painel acha a tarefa CONCLUÍDA: o mapa de linhas inclui as do Feito (antes só as abertas)', /linhaPorId = useMemo\(\(\) => new Map\(\[\.\.\.todos, \.\.\.feitoVisivel\]\.map/.test(tela))
ok('"Abrir processo" (Famílias) leva ao processo — e não é mais um botão sem ação', /onAbrirProcesso=\{\(processoId\) => router\.push\(urlOperacionalDoProcesso\(processoId\)\)\}/.test(tela) && /onAbrirProcesso\(id\)/.test(abas) && !/Abrir processo<\/button>/.test(abas.replace(/onAbrirProcesso\(id\) \}\}>Abrir processo<\/button>/, '')))
ok('os cartões informativos do Radar (sempre 0) deixaram de ser botão morto', !/onClick=\{onNaoLigado\}/.test(abas) && !/onNaoLigado/.test(abas))
const feito = abas.slice(abas.indexOf('export function AbaFeito'))
ok('o Feito agrupa por PESSOA dentro da família (agruparDentroDaFamilia "pessoa"), cada pessoa com o seu cabeçalho', /agruparDentroDaFamilia\(g\.linhas, "pessoa"\)/.test(feito) && /<b style=\{\{ fontSize: 12\.5 \}\}>\{p\.titulo\}<\/b>/.test(feito))
ok('as linhas do Feito saem por evento (a família passa por ordenarPorEvento)', /ordenarPorEvento\(mapa\.get\(k\)!\)/.test(readFileSync('src/components/operacao/operacao-v3-derivacoes.ts', 'utf8')))
ok('o "Abrir" de cada linha do Feito chama onAbrir(taskId)', /onClick=\{\(\) => onAbrir\(t\.taskId\)\}>Abrir<\/button>/.test(feito))
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
