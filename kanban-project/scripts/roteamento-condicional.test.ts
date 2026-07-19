// scripts/roteamento-condicional.test.ts
// Testa proximaFaseAplicavel: pula fases condicionais não aplicáveis (retificação).
import { proximaFaseAplicavel } from "../src/lib/motor/phase-advance-helpers"

const FASES = [
  { phaseKey: "genealogia", ordem: 0 },
  { phaseKey: "emissao_documental", ordem: 1 },
  { phaseKey: "analise_documental", ordem: 2 },
  { phaseKey: "retificacao_registros", ordem: 3 },
  { phaseKey: "emissao_documental_retificada", ordem: 4 },
  { phaseKey: "traducao_juramentada", ordem: 5 },
  { phaseKey: "apostilamento", ordem: 6 },
  { phaseKey: "aguardando_protocolo", ordem: 7 },
]
const CONDICIONAIS = new Set(["retificacao_registros", "emissao_documental_retificada"])
const pred = (requer: boolean) => (pk: string) => CONDICIONAIS.has(pk) ? requer : true

let ok = 0
const falhas: string[] = []
const eq = (nome: string, a: unknown, b: unknown) => {
  if (a === b) { ok++; console.log(`  ✅ ${nome} → ${a}`) }
  else { falhas.push(`${nome}: esperado ${b}, obteve ${a}`); console.log(`  ❌ ${nome}: esperado ${b}, obteve ${a}`) }
}

// SEM retificação: Análise pula retificação/emissão-retificada → Tradução
eq("Análise SEM retificação pula p/ Tradução", proximaFaseAplicavel(FASES, "analise_documental", pred(false)), "traducao_juramentada")
// COM retificação: Análise entra na Retificação
eq("Análise COM retificação entra na Retificação", proximaFaseAplicavel(FASES, "analise_documental", pred(true)), "retificacao_registros")
// Dentro do desvio (com retificação): Retificação → Emissão Retificada → Tradução
eq("Retificação → Emissão Retificada", proximaFaseAplicavel(FASES, "retificacao_registros", pred(true)), "emissao_documental_retificada")
eq("Emissão Retificada → Tradução", proximaFaseAplicavel(FASES, "emissao_documental_retificada", pred(true)), "traducao_juramentada")
// Fases lineares: nunca puladas
eq("Tradução → Apostilamento", proximaFaseAplicavel(FASES, "traducao_juramentada", pred(false)), "apostilamento")
eq("Emissão documental → Análise (nunca pula não-condicional)", proximaFaseAplicavel(FASES, "emissao_documental", pred(false)), "analise_documental")

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) process.exit(1)
