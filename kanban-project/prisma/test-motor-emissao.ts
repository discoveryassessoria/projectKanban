// prisma/test-motor-emissao.ts
// Testa a fatia 1 (Emissão) — v2. Roda: npx tsx prisma/test-motor-emissao.ts
import { prisma } from '@/lib/prisma'
import { gerarEconomicoDaMatriz } from '@/src/lib/motor/matriz-economica'

const TIPO = 5
const PHASE = 'emissao_documental'

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

  const res = await gerarEconomicoDaMatriz(proc.id, TIPO, PHASE) // ciclo 1

  console.log(`CRIADOS: ${res.criados.length}`)
  for (const it of res.criados) {
    const cu = it.custo ? `${it.custo.valor} ${it.custo.moeda}` : '—'
    const re = it.receita ? `${it.receita.valor} ${it.receita.moeda}` : '—'
    console.log(`  • pessoa ${it.pessoaId} · doc ${it.documentoId} · ${it.componente}`)
    console.log(`      custo:  ${cu}   (id ${it.custoId ?? '-'})`)
    console.log(`      receita:${re}   (id ${it.receitaId ?? '-'})`)
  }
  if (res.pulados.length) { console.log('\nPULADOS:'); res.pulados.forEach((p) => console.log(`  - ${p.motivo}${p.detalhe ? ' (' + p.detalhe + ')' : ''}`)) }
  if (res.erros.length) { console.log('\nERROS:'); res.erros.forEach((e) => console.log(`  ! ${e}`)) }

  // Teste F: custo e receita têm de ser INDEPENDENTES
  const amostra = res.criados.find((i) => i.custo && i.receita)
  if (amostra) {
    const dif = amostra.custo!.valor !== amostra.receita!.valor || amostra.custo!.moeda !== amostra.receita!.moeda
    console.log(`\nTeste F (custo ≠ receita): ${dif ? '✅ OK' : '❌ FALHOU — estão iguais'}`)
  }
  console.log('\n▶ Rode DE NOVO: "CRIADOS" deve vir 0 (idempotência).')
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())