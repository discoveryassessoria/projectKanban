// prisma/test-motor-emissao.ts
// Testa a fatia 1 (Emissão) — v2. Testes A · F · C · D · E numa única rodada.
//
// ⚠ PRÉ-REQUISITO: o processo precisa estar SEM artefatos de teste do motor.
//    Se já tiver (ex.: da rodada A de antes), o script AVISA e para — aí rode:
//        npx tsx prisma/limpa-teste-motor.ts
//    e depois:
//        npx tsx prisma/test-motor-emissao.ts
//
// Este teste cria ciclo 1 E ciclo 2 de propósito (pra provar reemissão).
// No fim, se quiser deixar o banco limpo: npx tsx prisma/limpa-teste-motor.ts

import { prisma } from '@/lib/prisma'
import { gerarEconomicoDaMatriz, type ResultadoMatriz } from '@/src/lib/motor/matriz-economica'

const TIPO = 5
const PHASE = 'emissao_documental'

function imprime(res: ResultadoMatriz) {
  console.log(`CRIADOS: ${res.criados.length}`)
  for (const it of res.criados) {
    const cu = it.custo ? `${it.custo.valor} ${it.custo.moeda}` : '—'
    const re = it.receita ? `${it.receita.valor} ${it.receita.moeda}` : '—'
    console.log(`  • pessoa ${it.pessoaId} · doc ${it.documentoId} · ${it.componente}`)
    console.log(`      custo:  ${cu}   (id ${it.custoId ?? '-'})`)
    console.log(`      receita:${re}   (id ${it.receitaId ?? '-'})`)
  }
  if (res.pulados.length) { console.log('PULADOS:'); res.pulados.forEach((p) => console.log(`  - ${p.motivo}${p.detalhe ? ' (' + p.detalhe + ')' : ''}`)) }
  if (res.erros.length) { console.log('ERROS:'); res.erros.forEach((e) => console.log(`  ! ${e}`)) }
}

async function main() {
  const proc = await prisma.processo.findFirst({
    where: { arvore: { pessoas: { some: {
      linhaReta: true,
      documentos: { some: { tipo: { in: ['CERTIDAO_NASCIMENTO', 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR'] } } },
    } } } },
    select: { id: true, nome: true },
  })
  if (!proc) { console.log('❌ Nenhum processo com pessoa linha reta + certidão de nascimento.'); return }
  console.log(`▶ Processo #${proc.id} — "${proc.nome}" (tipo ${TIPO}, fase ${PHASE})\n`)

  // ── GUARDA: estado precisa estar limpo, senão A/C ficam enganosos ──────────
  const jaExiste = await prisma.motorArtefato.count({ where: { processoId: proc.id, ruleSource: 'matriz' } })
  if (jaExiste > 0) {
    console.log(`⚠ Este processo já tem ${jaExiste} artefato(s) de teste do motor.`)
    console.log('  Rode a limpeza ANTES, senão os Testes A e C ficam enganosos:')
    console.log('      npx tsx prisma/limpa-teste-motor.ts')
    console.log('  Depois rode este teste de novo.')
    return
  }

  // ── TESTE A — ciclo 1, 1ª vez → deve CRIAR ─────────────────────────────────
  console.log('═══ TESTE A — ciclo 1, 1ª vez (deve criar) ═══')
  const c1a = await gerarEconomicoDaMatriz(proc.id, TIPO, PHASE, 1)
  imprime(c1a)
  console.log(`Teste A: ${c1a.criados.length > 0 ? '✅ OK (criou)' : '❌ FALHOU (não criou nada)'}`)

  // ── TESTE F — custo ≠ receita (independentes) ──────────────────────────────
  const amostra = c1a.criados.find((i) => i.custo && i.receita)
  if (amostra) {
    const dif = amostra.custo!.valor !== amostra.receita!.valor || amostra.custo!.moeda !== amostra.receita!.moeda
    console.log(`Teste F (custo ≠ receita): ${dif ? '✅ OK' : '❌ FALHOU — estão iguais'}`)
  } else {
    console.log('Teste F: inconclusivo (nenhum item com custo E receita)')
  }

  // ids do ciclo 1 (pra comparar no D)
  const idsCusto1 = c1a.criados.map((i) => i.custoId).filter((x): x is number => x != null)

  // ── TESTE C — ciclo 1 DE NOVO (sai/volta sem trocar ciclo) → NÃO duplica ────
  console.log('\n═══ TESTE C — ciclo 1, 2ª vez (NÃO pode duplicar) ═══')
  const c1b = await gerarEconomicoDaMatriz(proc.id, TIPO, PHASE, 1)
  imprime(c1b)
  console.log(`Teste C: ${c1b.criados.length === 0 ? '✅ OK (não duplicou)' : '❌ FALHOU (duplicou ' + c1b.criados.length + ')'}`)

  // ── TESTE D — ciclo 2 (reemissão) → cria conjunto NOVO, ids diferentes ──────
  console.log('\n═══ TESTE D — ciclo 2 (reemissão, deve criar NOVO) ═══')
  const c2 = await gerarEconomicoDaMatriz(proc.id, TIPO, PHASE, 2)
  imprime(c2)
  const idsCusto2 = c2.criados.map((i) => i.custoId).filter((x): x is number => x != null)
  const criouNovo = c2.criados.length > 0
  const semSobreposicao = idsCusto2.every((id) => !idsCusto1.includes(id))
  console.log(`Teste D: ${criouNovo && semSobreposicao ? '✅ OK (novo conjunto, ids diferentes)' : '❌ FALHOU (' + (!criouNovo ? 'não criou' : 'reusou ids do ciclo 1') + ')'}`)

  // ── TESTE E — doc fora da regra (não-nascimento) NÃO gera ──────────────────
  console.log('\n═══ TESTE E — doc desnecessário não gera ═══')
  // Percorre a árvore do MESMO jeito que o motor (linha reta + mesmo filtro de status)
  const tree = await prisma.processo.findUnique({
    where: { id: proc.id },
    select: { arvore: { select: { pessoas: { select: {
      id: true, linhaReta: true,
      documentos: { where: { status: { notIn: ['CANCELADO', 'INVALIDO'] } }, select: { id: true, tipo: true } },
    } } } } },
  })
  const pessoasLR = (tree?.arvore?.pessoas ?? []).filter((p) => p.linhaReta)
  const docsNasc = new Set<number>()
  let docsForaEscopo = 0
  for (const p of pessoasLR) {
    for (const d of p.documentos) {
      if (String(d.tipo).includes('NASCIMENTO')) docsNasc.add(d.id)
      else docsForaEscopo++
    }
  }
  const criadosTodos = [...c1a.criados, ...c2.criados]
  const geradosForaEscopo = criadosTodos.filter((i) => !docsNasc.has(i.documentoId))
  if (docsForaEscopo === 0) {
    console.log('Teste E: ⚠ inconclusivo — este processo só tem doc de nascimento em linha reta (nada fora do escopo pra testar). NÃO falhou.')
  } else {
    console.log(`  docs fora do escopo (não-nascimento) em linha reta: ${docsForaEscopo}`)
    console.log(`Teste E: ${geradosForaEscopo.length === 0 ? '✅ OK (nenhum doc fora do escopo gerou)' : '❌ FALHOU (' + geradosForaEscopo.length + ' geraram indevidamente)'}`)
  }

  console.log('\n─────────────────────────────────────────')
  console.log('Feito. O banco agora tem ciclo 1 + ciclo 2 (proposital).')
  console.log('Pra deixar limpo: npx tsx prisma/limpa-teste-motor.ts')
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())