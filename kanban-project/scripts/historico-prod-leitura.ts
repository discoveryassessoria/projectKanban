// scripts/historico-prod-leitura.ts
// ============================================================================
// LEITURA (SOMENTE SELECT) do Histórico do processo em PRODUÇÃO — imprime as frases redigidas e
// CONFERE que nenhuma linha crua técnica vaza para a tela.
//
//   npx tsx scripts/historico-prod-leitura.ts 675 676        # usa o .env (produção) — NUNCA escreve
//
// `historicoDoProcesso` só faz SELECT (findMany/findUnique/count); este script não importa nenhuma
// porta de escrita. Sai com código 1 se encontrar texto técnico cru nas frases.
// ============================================================================
import { historicoDoProcesso } from '../src/services/historico-processo'
import { prisma } from '../lib/prisma'
import { montarVisao, FILTROS_LIMPOS, FILTROS_PADRAO, horaSP } from '../lib/operacional/historico-filtros'

/** Padrões que só existem em texto técnico: códigos de ação/enum, nomes de tabela, JSON, rótulos de estado do motor. */
const VAZAMENTO = [
  /\b[A-Z]{2,}(?:_[A-Z0-9]+){1,}\b/,            // CODIGO_EM_CAIXA_ALTA
  /\bregistral_[a-z_]+/i, /\bMATERIALIZAD[OA]\b/i, /\bPASSO_[A-Z_]+\b/, /\bTAREFA_[A-Z_]+\b/,
  /\{\s*"/, /\[object Object\]/, /\bundefined\b/, /\bnull\b/, /\bNaN\b/,
  /Tarefa conclu[ií]da.*Passo conclu[ií]do/i,
]

async function main() {
  const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (ids.length === 0) { console.error('uso: npx tsx scripts/historico-prod-leitura.ts <processoId>…'); process.exit(2) }
  const agora = new Date()
  let vazou = 0
  for (const id of ids) {
    const h = await historicoDoProcesso(id, { agora })
    if (!h) { console.log(`\n=== processo ${id}: não encontrado`); continue }
    const v = montarVisao(h.fatos, FILTROS_LIMPOS, agora)
    const pad = montarVisao(h.fatos, FILTROS_PADRAO, agora)
    console.log(`\n=== processo ${id} · ${h.processo.nome} (${h.processo.codigo ?? '—'}) · ${h.fatos.length} fatos (${h.fatos.filter((f) => f.automatico).length} automáticos) · truncado=${h.truncado}`)
    console.log(`    padrão (7 dias, sem automáticos): mostrando ${pad.mostrando} de ${pad.total} · ${pad.automaticosOcultos} automáticos ocultos`)
    console.log(`    rodapé (todo o período): ${v.rodape.fatosNoPeriodo} fatos · atuaram: ${v.rodape.pessoasQueAtuaram.join(', ') || '—'} · ${v.rodape.cancelamentos} cancelamento(s) · ${v.rodape.certidoesValidadas} validada(s) · último: ${v.rodape.ultimoFato}`)
    console.log('    descartados (mecânica interna):', JSON.stringify(h.descartados))
    console.log('    NÃO classificados (não mostrados):', JSON.stringify(h.naoClassificados))
    for (const d of v.dias.slice(0, 4)) {
      console.log(`\n  ${d.rotulo}  (${d.fatos.length} fatos)`)
      for (const f of d.fatos.slice(0, 14)) console.log(`   ${horaSP(f.quando)} ${f.automatico ? '[auto] ' : ''}${f.frase}${f.quantidade > 1 ? `  [${f.quantidade} itens]` : ''}`)
    }
    for (const f of h.fatos) for (const t of [f.frase, ...f.agrupadoDe.map((i) => i.frase)]) for (const re of VAZAMENTO) if (re.test(t)) { vazou++; console.log(`  ⚠ POSSÍVEL VAZAMENTO (${re}): ${t}`) }
  }
  console.log(`\n${vazou === 0 ? '✅ nenhuma linha técnica crua nas frases' : `❌ ${vazou} frase(s) com texto técnico`}`)
  await prisma.$disconnect()
  process.exit(vazou === 0 ? 0 : 1)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
