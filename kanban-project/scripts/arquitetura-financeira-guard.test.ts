// scripts/arquitetura-financeira-guard.test.ts
// ============================================================================
// GUARDA da arquitetura financeira definitiva (itens 1, 3, 4).
//   1. FinanceRuleEngine é o ÚNICO criador — POST manual bloqueado (405).
//   3. modoCalculo unificado num enum oficial + aliases legados.
//   4. Honorários genéricos por requerente — sem tratamento por nacionalidade.
// Puro: lê os arquivos, não precisa de banco.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MODO,
  MODO_HONORARIO_REQUERENTE,
  normalizarModo,
  modoMultiplicaQuantidade,
} from '../lib/financeiro/modo-calculo'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)

// ── 3 · enum oficial de modoCalculo ─────────────────────────────────────────
secao('Item 3 — modoCalculo unificado')
{
  ok('enum oficial existe', MODO.FIXO === 'fixed' && MODO.POR_REQUERENTE === 'per_applicant')
  ok('honorário por requerente aponta ao oficial', MODO_HONORARIO_REQUERENTE === 'per_applicant')
  // aliases legados normalizam para o oficial
  for (const legado of ['honorario_por_requerente', 'per_unit', 'unit', 'por_unidade', 'quantidade']) {
    ok(`alias "${legado}" → per_applicant`, normalizarModo(legado) === 'per_applicant')
  }
  ok('desconhecido → fixed', normalizarModo('xpto') === 'fixed')
  ok('nulo → fixed', normalizarModo(null) === 'fixed')
  ok('fixed não multiplica', !modoMultiplicaQuantidade('fixed'))
  ok('per_applicant multiplica', modoMultiplicaQuantidade('per_applicant'))
  ok('alias legado multiplica', modoMultiplicaQuantidade('honorario_por_requerente'))

  // o resolver de preço delega ao helper oficial (não tem mais lista própria divergente)
  const resolver = readFileSync(join(RAIZ, 'src/lib/motor/resolver-preco-financeiro.ts'), 'utf8')
  ok('resolver importa o helper oficial', resolver.includes("modoMultiplicaQuantidade } from '@/lib/financeiro/modo-calculo'"))
  ok('resolver delega ehPerUnit ao oficial', /function ehPerUnit[\s\S]{0,400}return modoMultiplicaQuantidade\(modo\)/.test(resolver))
  ok('resolver não mantém lista própria divergente', !/m === 'per_unit' \|\| m === 'unit'/.test(resolver))
}

// ── 4 · honorários genéricos, sem nacionalidade ─────────────────────────────
secao('Item 4 — honorários sem tratamento por nacionalidade')
{
  const exec = readFileSync(join(RAIZ, 'src/lib/motor/executor.ts'), 'utf8')
  ok('função genérica existe', exec.includes('export async function aplicarHonorariosPorRequerente'))
  ok('nome legado preservado como alias', exec.includes('export const aplicarHonorariosCidadaniaItaliana = aplicarHonorariosPorRequerente'))
  ok('sem gate de país "IT"', !exec.includes("isoDoPais(proc.pais) !== 'IT'"))
  ok('sem import isoDoPais', !exec.includes('isoDoPais'))
  ok('sem string "Cidadania Italiana" hardcoded', !exec.includes("'Honorários Contratuais — Cidadania Italiana'"))
  ok('descrição derivada da nacionalidade do tipo de processo', exec.includes('proc.tipoProcessoMotor?.nationalityLabel'))
  ok('preço resolvido por TIPO DE PROCESSO', exec.includes('configuracaoFinanceiraItem: { tipoProcessoId: proc.tipoProcessoMotorId }'))
  ok('aceita estratégia canônica + modos/aliases legados (fonte única)', exec.includes('MODOS_REQUERENTE = MODOS_PRIMEIRO_ADICIONAL'))
  ok('chave idempotente genérica', exec.includes('honorario_por_requerente::VENDA'))
  ok('compat com chave legada', exec.includes('honorario_cidadania_italiana::VENDA'))
  // nenhuma outra nacionalidade citada no fluxo de honorários
  const trecho = exec.slice(exec.indexOf('aplicarHonorariosPorRequerente'))
  // Sem LÓGICA por país nem STRING DE EXIBIÇÃO por nacionalidade. A ÚNICA menção
  // tolerada a 'italiana' é a chave técnica legada de idempotência (compat).
  ok('sem lógica por país', !/=== 'IT'|=== 'DE'|=== 'ES'|isoDoPais/.test(trecho))
  ok('sem string de exibição por nacionalidade', !/Cidadania Italiana|Cidadania Alemã|nacionalidade alemã|nacionalidade italiana|nacionalidade espanhola/i.test(trecho))
  const soCompat = (trecho.match(/cidadania_italiana/g) || []).length
  ok('menções a italiana são só a chave legada de compat (<=2)', soCompat <= 2)
}

// ── 1 · FinanceRuleEngine é o único criador ─────────────────────────────────
secao('Item 1 — criação manual desativada')
{
  for (const nat of ['receitas', 'custos']) {
    const src = readFileSync(join(RAIZ, `src/app/api/financeiro/${nat}/route.ts`), 'utf8')
    ok(`${nat}: POST retorna 405`, /export async function POST\(\)[\s\S]{0,300}status: 405/.test(src))
    ok(`${nat}: código CRIACAO_MANUAL_DESATIVADA`, src.includes('CRIACAO_MANUAL_DESATIVADA'))
    ok(`${nat}: POST não cria mais no banco`, !/export async function POST[\s\S]*prisma\.(receita|custo)\.create/.test(src))
    ok(`${nat}: GET preservado`, src.includes('export async function GET'))
  }
  // nenhum criador de lançamento fora do motor e do fluxo de estorno
  // (varredura textual: só executor, matriz-economica e cancelamento-estorno podem criar)
  const permitidos = ['src/lib/motor/executor.ts', 'src/lib/motor/matriz-economica.ts', 'lib/financeiro/cancelamento-estorno.ts']
  for (const f of permitidos) {
    const src = readFileSync(join(RAIZ, f), 'utf8')
    ok(`${f} é criador autorizado`, /\.(receita|custo)\.create/.test(src))
  }
}

// ── 5 · Financeiro Geral > Cobranças = MESMA base única (sem tabela paralela) ─
secao('Item 5 — view Cobranças no Financeiro Geral (base única)')
{
  const api = readFileSync(join(RAIZ, 'src/app/api/financeiro/cobrancas/route.ts'), 'utf8')
  ok('lista a MESMA entidade Cobranca', /prisma\.cobranca\.findMany/.test(api))
  ok('todos os processos (sem filtro fixo de processoId)', !/where:\s*{\s*processoId:/.test(api))
  ok('processoId é só FILTRO opcional', api.includes("sp.get('processoId')"))
  ok('exige permissão financeiro.ver', api.includes("verificarPermissao(req, 'financeiro.ver')"))
  ok('não cria tabela/entidade paralela', !/prisma\.cobrancaGeral|CobrancaGeral|cobrancaEspelho/i.test(api))

  const tab = readFileSync(join(RAIZ, 'src/components/financeiroComponents/CobrancasTab.tsx'), 'utf8')
  ok('reutiliza o MESMO modal do processo', tab.includes('ReceitaCobrancaModal'))
  ok('consome a API consolidada', tab.includes('/api/financeiro/cobrancas'))
  ok('tem busca + filtro de status', tab.includes('setBusca') && tab.includes('STATUS_FILTROS'))

  const page = readFileSync(join(RAIZ, 'src/app/financeiro/page.tsx'), 'utf8')
  ok('aba Cobranças registrada', /key:\s*"cobrancas"/.test(page))
  ok('aba Cobranças renderizada', page.includes('<CobrancasTab />'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Arquitetura financeira: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
