// scripts/dossie-receita-guard.test.ts
// ============================================================================
// GUARDA — Detalhe da Receita: UM só dono.
//
// O "Dossiê da Receita" como PÁGINA própria (rota /processos/[id]/financeiro/
// receitas/[receitaId] + endpoint /receitas/[id]/dossie + subaba Receitas) foi
// REMOVIDO como legado morto. O detalhe vive hoje em ReceitaDetalheView, servido
// pelo endpoint /receitas/[id]/detalhe e aberto pela lista de Receitas (V3).
//
// Esta guarda impede as duas regressões: (a) o legado voltar; (b) o caminho atual
// sumir ou ganhar um dono paralelo.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const DETALHE_API = join(RAIZ, 'src/app/api/financeiro/receitas/[id]/detalhe/route.ts')
const DETALHE_VIEW = join(RAIZ, 'src/components/financeiro/v3/ReceitaDetalheView.tsx')
const LISTA = join(RAIZ, 'src/components/financeiro/v3/ReceitasTab.tsx')

sec('1 — o legado removido continua removido (sem dono paralelo)')
{
  ok('página de dossiê não voltou', !existsSync(join(RAIZ, 'src/app/processos/[processoId]/financeiro/receitas/[receitaId]/page.tsx')))
  ok('endpoint /dossie não voltou', !existsSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/dossie/route.ts')))
  ok('subaba legada Receitas não voltou', !existsSync(join(RAIZ, 'src/components/financeiro/subabas/Receitas.tsx')))
  ok('rota legada de reparcelamento não voltou', !existsSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/parcelas/route.ts')))
  ok('rota legada de supressão não voltou', !existsSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/supressao/route.ts')))
}

sec('2 — o detalhe atual existe e é servido por um agregador')
{
  ok('view de detalhe existe', existsSync(DETALHE_VIEW))
  ok('endpoint de detalhe existe', existsSync(DETALHE_API))
  const a = readFileSync(DETALHE_API, 'utf8')
  ok('permissão financeiro.ver', a.includes("'financeiro.ver'"))
  ok('composição em Promise.all (sem N+1)', a.includes('Promise.all'))
  ok('não cria tabela/anexo paralelo', !a.includes('prisma.anexoReceita') && !a.includes('AnexoReceita'))
}

sec('3 — a lista abre o detalhe (um caminho só)')
{
  const lista = readFileSync(LISTA, 'utf8')
  ok('lista tem ação de abrir o detalhe', lista.includes('Abrir detalhe'))
  ok('lista não reabre o modal de cobrança como detalhe', !lista.includes('ReceitaCobrancaModal'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Detalhe da Receita: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
