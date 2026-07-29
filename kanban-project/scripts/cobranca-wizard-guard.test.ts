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
ok('exatamente 4 etapas no indicador (PASSOS)', (src.match(/n: [1-4], label:/g) || []).length === 4 && !src.includes('n: 5, label:') && src.includes('const PASSOS ='))
ok('Simulação e geração é a etapa 4', src.includes("{ n: 4, label: 'Simulação e geração'"))
ok('etapas full-page (barra + resumo lateral)', src.includes('PASSOS.map') && src.includes('Resumo da configuração') && src.includes('Receita selecionada'))
ok('NÃO existe render de step === 5', !/step === 5/.test(src))
ok('NÃO há navegação para etapa 5 (step < 5 / setStep(5))', !src.includes('step < 5') && !src.includes('setStep(5'))
ok('Próximo só até a etapa 3 (step < 4)', src.includes('step < 4 ?'))

// ── botão final na Simulação ──
ok('botão final "Confirmar e gerar cobrança"', src.includes('Confirmar e gerar cobrança'))
ok('geração só no clique final (confirmar)', src.includes('onClick={confirmar}') && src.includes("jf(`/api/financeiro/receitas/${receitaId}/cobrancas`"))
ok('anti-duplo-clique (botão desabilita ao salvar)', src.includes('disabled={salvando'))
ok('não cria cobrança ao avançar (avançar só faz setStep)', src.includes('onClick={() => setStep(step + 1)}'))

// ── conversão origem→destino (apresentação; runtime é a autoridade do cálculo) ──
ok('conversão dupla por moeda de destino', src.includes('const temConv') && src.includes('emDest') && src.includes('moedaDestino'))
ok('valores em duas moedas (dual)', src.includes('const dual = ') && src.includes('brl(v, moeda)') && src.includes('brl(emDest(v), destino'))
ok('cronograma com coluna da moeda de destino', src.includes('Valor ({destino})') && src.includes('temConv &&'))
ok('cotação exibida com origem/fonte/tipo', src.includes('Cotação:') && src.includes('sim.cambio.tipo') && src.includes('sim.cambio.fonte'))
ok('frontend NÃO recalcula taxa (usa sim.*)', src.includes('sim.valorTaxa') && src.includes('sim.totalCobrado') && !src.includes('valorTaxa ='))
// ── full-page + sucesso ──
ok('layout full-page (não modal pequeno)', src.includes('max-w-[1400px]') && src.includes('h-[92vh]') && !src.includes('max-w-lg'))
ok('resumo lateral persistente (aside)', src.includes('<aside') && src.includes('Valores de referência'))
// O cartão de valores existe — e vive no ESCOPO DE MÓDULO. Declarar componente
// dentro do render cria um tipo novo a cada passagem e remonta a subárvore.
ok('cards de valores (total/entrada/saldo/líquido)', /function Card\(|const Card =/.test(src) && src.includes('Saldo financiado') && src.includes('Valor líquido'))
ok('Card não é declarado dentro do render', !/^\s+const Card = /m.test(src))
ok('tela de sucesso pós-geração', src.includes('Cobrança criada com sucesso') && src.includes('setSucesso'))
ok('barra "Etapa X de 4"', src.includes('Etapa {step} de 4'))

// ── etapa Recebimento: moeda de recebimento + cotação (auto/manual) ──
ok('moeda de recebimento selecionável', src.includes('Moeda de recebimento') && src.includes('moedaRecebimento'))
ok('cotação manual (com justificativa)', src.includes('cotacaoManualAtiva') && src.includes('justificativaCotacao'))
ok('idempotência enviada na criação', src.includes('idempotencyKey: idemKey'))

// ── rótulo correto da taxa (não "ao mês") ──
ok('taxa rotulada como "da operação" (não "ao mês")', src.includes('Taxa da operação') && !src.includes('Taxa (ao mês)'))

// ── snapshot/cotação preservados: a criação recalcula e congela ──
ok('criação usa POST de cobrança (backend recalcula/congela)', src.includes("method: 'POST'") && src.includes('cobrancas'))

console.log(`\nWizard Cadastrar Cobrança: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
