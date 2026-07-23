// scripts/cobranca-wizard-guard.test.ts
// GUARDA estrutural do wizard "Cadastrar Cobrança" (ReceitaCobrancaModal):
// 4 etapas, sem "Confirmação", Simulação é a última com o botão final, e
// conversão EUR/BRL no painel de simulação. Componente REAL (o único com o
// título "Cadastrar Cobrança"). Puro (inspeciona o fonte).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }

const src = readFileSync(join(RAIZ, 'src/components/financeiro/ReceitaCobrancaModal.tsx'), 'utf8')

console.log('\nWizard Cadastrar Cobrança — 4 etapas + EUR/BRL')

// ── fluxo de 4 etapas, sem etapa 5 ──
ok('é o componente real (título Cadastrar Cobrança)', src.includes('Cadastrar Cobrança'))
ok('exatamente 4 Passos no indicador', (src.match(/<Passo n=\{[1-4]\}/g) || []).length === 4 && !src.includes('<Passo n={5}'))
ok('Simulação e geração é a etapa 4', src.includes('label="Simulação e geração" icon={Wallet} />') && !src.includes('label="Simulação e geração" icon={Wallet} /><Passo'))
ok('NÃO existe render de step === 5', !/step === 5/.test(src))
ok('NÃO há navegação para etapa 5 (step < 5 / setStep(5))', !src.includes('step < 5') && !src.includes('setStep(5'))
ok('Próximo só até a etapa 3 (step < 4)', src.includes('step < 4 ?'))

// ── botão final na Simulação ──
ok('botão final "Confirmar e gerar cobrança"', src.includes('Confirmar e gerar cobrança'))
ok('geração só no clique final (confirmar)', src.includes('onClick={confirmar}') && src.includes("jf(`/api/financeiro/receitas/${receitaId}/cobrancas`"))
ok('anti-duplo-clique (botão desabilita ao salvar)', src.includes('disabled={salvando'))
ok('não cria cobrança ao avançar (avançar só faz setStep)', src.includes('onClick={() => setStep(step + 1)}'))

// ── conversão EUR/BRL (apresentação; runtime é a autoridade do cálculo) ──
ok('conversão dupla EUR/BRL', src.includes('const temConv') && src.includes('emBRL') && src.includes('cotacao'))
ok('valores em duas moedas (dual)', src.includes('const dual = ') && src.includes("brl(v, moeda)") && src.includes("brl(emBRL(v), 'BRL')"))
ok('cronograma com coluna BRL condicional', src.includes('Valor (BRL)') && src.includes('temConv &&'))
ok('cotação exibida com origem/estado', src.includes('Cotação: 1') && src.includes('congelada nesta cobrança'))
ok('frontend NÃO recalcula taxa (usa sim.*)', src.includes('sim.valorTaxa') && src.includes('sim.totalCobrado') && !src.includes('valorTaxa ='))

// ── rótulo correto da taxa (não "ao mês") ──
ok('taxa rotulada como "da operação" (não "ao mês")', src.includes('Taxa da operação') && !src.includes('Taxa (ao mês)'))

// ── snapshot/cotação preservados: a criação recalcula e congela ──
ok('criação usa POST de cobrança (backend recalcula/congela)', src.includes("method: 'POST'") && src.includes('cobrancas'))

console.log(`\nWizard Cadastrar Cobrança: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
