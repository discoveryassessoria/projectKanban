// scripts/condicao-regra-guard.test.ts
// ============================================================================
// GUARDA — Condição de Pagamento = REGRA REUTILIZÁVEL (não congela nada).
// (1) mapeamento paraColunas (puro) — políticas e derivações de compat.
// (2) estrutura: wizard premium, legados removidos, fonte única de enums.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paraColunas } from '../src/app/api/gerenciamento/condicoes-pagamento/campos'
import { POLITICAS_TAXAS, POLITICAS_CAMBIO, APLICA_A_LABEL } from '../lib/financeiro/condicao-constants'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

sec('1 — paraColunas: políticas e derivações')
{
  const p = paraColunas({ name: 'C' })
  ok('default politicaTaxas = IGNORAR', p.politicaTaxas === 'IGNORAR')
  ok('IGNORAR ⇒ aplicarTaxas false (derivado)', p.aplicarTaxas === false)
  const rep = paraColunas({ name: 'C', politicaTaxas: 'REPASSAR' })
  ok('REPASSAR ⇒ aplicarTaxas true', rep.aplicarTaxas === true && rep.politicaTaxas === 'REPASSAR')

  ok('default politicaCambio = PADRAO_SISTEMA', paraColunas({ name: 'C' }).politicaCambio === 'PADRAO_SISTEMA')
  const trava = paraColunas({ name: 'C', politicaCambio: 'SUGERIR_TRAVA' })
  ok('SUGERIR_TRAVA ⇒ travaCambial true (derivado)', trava.travaCambial === true)

  const e = paraColunas({ name: 'C', entradaTipo: 'VALOR_FIXO', entradaMin: 100, entradaAdicional: true })
  ok('entrada expandida mapeada', e.entradaTipo === 'VALOR_FIXO' && Number(e.entradaMin) === 100 && e.entradaAdicional === true)

  const cr = paraColunas({ name: 'C', diaInexistente: 'ULTIMO_DIA', comportamentoFimSemana: 'PROX_UTIL' })
  ok('cronograma explícito mapeado', cr.diaInexistente === 'ULTIMO_DIA' && cr.comportamentoFimSemana === 'PROX_UTIL')

  const enc = paraColunas({ name: 'C', multaTipo: 'FIXA', multaValor: 50, jurosTipo: 'COMPOSTO', jurosPeriodo: 'MENSAL', carenciaDias: 5 })
  ok('encargos expandidos mapeados', enc.multaTipo === 'FIXA' && Number(enc.multaValor) === 50 && enc.jurosTipo === 'COMPOSTO' && enc.carenciaDias === 5)

  // Aplicabilidade virou RELACIONAMENTO REAL: serviços/moedas/países/modalidades
  // saíram de paraColunas (as rotas gravam a projeção). Perfil e Canal saíram do
  // payload por não terem regra de negócio — colunas preservadas no banco.
  const ap = paraColunas({ name: 'C', servicos: [1, 2], formaSugeridaId: 7, perfil: 'VIP', canal: 'web' }) as Record<string, unknown>
  ok('forma sugerida mapeada', ap.formaSugeridaId === 7)
  ok('serviços fora de paraColunas (vira vínculo)', !('servicos' in ap))
  ok('perfil fora do payload', !('perfil' in ap))
  ok('canal fora do payload', !('canal' in ap))
  ok('código fora do payload (gerado pelo backend)', !('codigo' in ap))
  ok('enum inválido em campo opcional → null', paraColunas({ name: 'C', entradaTipo: 'xxx' }).entradaTipo === null)
}

sec('2 — enums (fonte única)')
{
  ok('POLITICAS_TAXAS completo', POLITICAS_TAXAS.includes('IGNORAR') && POLITICAS_TAXAS.includes('ESCOLHER_NA_COBRANCA'))
  ok('POLITICAS_CAMBIO novo-facing', POLITICAS_CAMBIO.includes('PADRAO_SISTEMA') && POLITICAS_CAMBIO.includes('SUGERIR_TRAVA'))
  ok('aplicaA rotulado como contas', APLICA_A_LABEL.RECEITA === 'Contas a Receber' && APLICA_A_LABEL.CUSTO === 'Contas a Pagar')
}

sec('3 — estrutura & legados removidos')
{
  const tabRaw = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx'), 'utf8')
  // ignora linhas de comentário (documentam o que foi removido)
  const tab = tabRaw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  ok('identidade premium via shell', tab.includes('pagamentoUI') && tab.includes('OURO'))
  ok('é wizard de 9 passos', tab.includes('Stepper') && (tab.match(/'Revisão'/) ? true : false) && tab.includes('Política de Taxas'))
  ok('consome enums da fonte única', tab.includes('condicao-constants'))
  ok('forma/carteira SUGERIDAS (não padrão/obrigatória)', tab.includes('Forma sugerida') && tab.includes('Carteira sugerida'))
  ok('Política de Taxas (não "Aplicar taxas")', tab.includes('Política de Taxas') && !tab.includes('Aplicar taxas nesta condição'))
  ok('sem "Forma padrão (legado)"', !tab.includes('Forma padrão'))
  ok('sem "Moeda do cadastro"', !tab.includes('Moeda do cadastro'))
  ok('fluxo de nova versão preservado', tab.includes('EXIGE_NOVA_VERSAO') && tab.includes('Nova versão'))
  ok('sem azul de CRUD', !tab.includes('bg-blue-600'))

  const campos = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/campos.ts'), 'utf8')
  ok('campos.ts grava politicaTaxas + deriva aplicarTaxas', campos.includes('politicaTaxas') && campos.includes("aplicarTaxas: enumOu"))
  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/route.ts'), 'utf8')
  ok('GET traz serviços', route.includes('servicoProduto'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Condição (regra reutilizável): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
