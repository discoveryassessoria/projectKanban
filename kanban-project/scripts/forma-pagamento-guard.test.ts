// scripts/forma-pagamento-guard.test.ts
// ============================================================================
// GUARDA — Forma de Pagamento = capacidades técnicas + compatibilidade central.
// (1) validadores PUROS Forma×Condição e Forma×Cobrança.
// (2) estrutura: identidade premium, mapeamento único, fonte única de enums.
// Puro: sem banco.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  validarCompatibilidadeCondicao, validarCompatibilidadeCobranca, paraFormaView, type FormaView,
} from '../lib/financeiro/payment-method-rules'
import { TIPOS_FORMA, TIPOS_INTEGRACAO } from '../lib/financeiro/payment-method-constants'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const base: FormaView = {
  id: 1, name: 'Cartão', ativo: true, moedasAceitas: ['BRL'], permiteParcelas: true, maxParcelas: 12,
  aceitaEntrada: true, aceitaRecorrencia: false, aceitaMoedaEstrangeira: false, permiteInternacional: false,
  carteirasCompativeis: [], contasCompativeis: [],
}

sec('1 — Forma × Condição')
{
  ok('forma 12x aceita condição 6x', validarCompatibilidadeCondicao(base, { parcelasMax: 6 }).compativel)
  ok('forma sem parcelamento rejeita condição 6x', !validarCompatibilidadeCondicao({ ...base, permiteParcelas: false }, { parcelasMax: 6 }).compativel)
  ok('forma máx 6 rejeita condição 12x', !validarCompatibilidadeCondicao({ ...base, maxParcelas: 6 }, { parcelasMax: 12 }).compativel)
  ok('forma BRL rejeita condição só-EUR', !validarCompatibilidadeCondicao(base, { moedasPermitidas: ['EUR'] }).compativel)
  ok('forma BRL aceita condição BRL+EUR', validarCompatibilidadeCondicao({ ...base, moedasAceitas: ['BRL', 'EUR'] }, { moedasPermitidas: ['EUR'] }).compativel)
  ok('condição com entrada rejeita forma sem entrada', !validarCompatibilidadeCondicao({ ...base, aceitaEntrada: false }, { temEntrada: true }).compativel)
  ok('à vista (1x) ignora limite de parcelas', validarCompatibilidadeCondicao({ ...base, permiteParcelas: false }, { parcelas: 1 }).compativel)
}

sec('2 — Forma × Cobrança')
{
  ok('forma ativa + moeda ok', validarCompatibilidadeCobranca(base, { moeda: 'BRL' }).compativel)
  ok('forma inativa rejeita', !validarCompatibilidadeCobranca({ ...base, ativo: false }, {}).compativel)
  ok('moeda não aceita rejeita', !validarCompatibilidadeCobranca(base, { moeda: 'USD' }).compativel)
  ok('internacional em forma nacional rejeita', !validarCompatibilidadeCobranca(base, { internacional: true }).compativel)
  ok('carteira incompatível rejeita', !validarCompatibilidadeCobranca({ ...base, carteirasCompativeis: [7] }, { carteiraId: 9 }).compativel)
  ok('carteira compatível aceita', validarCompatibilidadeCobranca({ ...base, carteirasCompativeis: [7, 9] }, { carteiraId: 9 }).compativel)
  ok('sem restrição de destino aceita qualquer', validarCompatibilidadeCobranca(base, { carteiraId: 123 }).compativel)
}

sec('3 — paraFormaView (fallback moeda legada)')
{
  const v = paraFormaView({ id: 2, name: 'PIX', ativo: true, moeda: 'BRL', moedasAceitas: [], permiteParcelas: false, maxParcelas: null, aceitaEntrada: false, aceitaRecorrencia: false, aceitaMoedaEstrangeira: false, permiteInternacional: false, carteirasCompativeis: [], contasCompativeis: [] })
  ok('moedasAceitas vazio cai para moeda única', v.moedasAceitas.length === 1 && v.moedasAceitas[0] === 'BRL')
}

sec('4 — estrutura & fonte única')
{
  const tab = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/FormasPagamentoTab.tsx'), 'utf8')
  ok('identidade premium (OURO)', tab.includes('#D2A948'))
  ok('consome enums da fonte única', tab.includes('payment-method-constants'))
  ok('multi-moeda (moedasAceitas)', tab.includes('moedasAceitas'))
  ok('destinos compatíveis', tab.includes('carteirasCompativeis') && tab.includes('contasCompativeis'))
  ok('disclosure de integração', tab.includes('semIntegracao'))
  ok('não usa mais o azul de CRUD (bg-blue-600)', !tab.includes('bg-blue-600'))

  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/formas-pagamento/route.ts'), 'utf8')
  const idRoute = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/formas-pagamento/[id]/route.ts'), 'utf8')
  ok('POST/PUT usam mapeamento único', route.includes('paraColunasForma') && idRoute.includes('paraColunasForma'))
  ok('DELETE bloqueia forma em uso', idRoute.includes('EM_USO') && idRoute.includes('cobranca.count'))

  const rules = readFileSync(join(RAIZ, 'lib/financeiro/payment-method-rules.ts'), 'utf8')
  ok('regras puras (sem prisma no módulo de regras)', !rules.includes('@/lib/prisma'))

  const svc = readFileSync(join(RAIZ, 'lib/financeiro/financial-configuration-service.ts'), 'utf8')
  ok('service de config expõe moedasAceitas', svc.includes('moedasAceitas'))

  ok('enums controlados definidos', TIPOS_FORMA.includes('PIX') && TIPOS_INTEGRACAO.includes('GATEWAY'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Forma de Pagamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
