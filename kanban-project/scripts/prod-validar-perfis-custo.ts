// scripts/prod-validar-perfis-custo.ts
// ============================================================================
// VALIDAÇÃO DOS PERFIS após o seed das permissões `financeiro.custo_*`.
//
// SOMENTE LEITURA. Prova três coisas:
//   1. cada perfil da matriz tem exatamente as 10 chaves de custo esperadas;
//   2. perfis fora da matriz não foram tocados (nenhuma chave de custo apareceu
//      neles por engano);
//   3. o núcleo de decisão (podeOperarCusto) concorda com a matriz nos dois
//      modos — retrocompat e ESTRITO —, que é o que muda ao ligar a flag.
//
// Falha ⇒ exit 1.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { MATRIZ_CUSTO } from '@/scripts/seed-permissoes-custo'
import { CHAVE_CUSTO, OPERACOES_CUSTO, podeOperarCusto } from '@/lib/financeiro/permissoes-custo'
import type { MapaPermissoes } from '@/src/lib/permissoes'

let ok = 0
let fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  console.log('Validação dos perfis — permissões de custo\n')
  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, permissoes: true }, orderBy: { id: 'asc' } })
  console.log(`  ${perfis.length} perfil(is) no banco: ${perfis.map((p) => p.nome).join(', ')}\n`)

  // 1) perfis da matriz — conjunto exato de chaves de custo
  for (const [nome, permitidas] of Object.entries(MATRIZ_CUSTO)) {
    const perfil = perfis.find((p) => p.nome.trim() === nome)
    if (!perfil) { chk(false, `perfil "${nome}" existe no banco`); continue }
    const mapa = (perfil.permissoes ?? {}) as Record<string, boolean>
    const esperado = new Set(permitidas)
    const divergentes = OPERACOES_CUSTO.filter((op) => !!mapa[CHAVE_CUSTO[op]] !== esperado.has(op))
    chk(
      divergentes.length === 0,
      `${nome}: ${permitidas.length}/10 operações — ${divergentes.length ? `DIVERGE em ${divergentes.join(', ')}` : 'conforme a matriz'}`,
    )
  }

  // 2) perfis fora da matriz — nenhuma chave de custo deve ter surgido
  const foraDaMatriz = perfis.filter((p) => !MATRIZ_CUSTO[p.nome.trim()])
  for (const p of foraDaMatriz) {
    const mapa = (p.permissoes ?? {}) as Record<string, boolean>
    const tocadas = OPERACOES_CUSTO.filter((op) => mapa[CHAVE_CUSTO[op]] !== undefined)
    chk(tocadas.length === 0, `${p.nome} (fora da matriz): intocado${tocadas.length ? ` — recebeu ${tocadas.join(', ')}` : ''}`)
  }
  if (!foraDaMatriz.length) console.log('  ·  nenhum perfil fora da matriz')

  // 3) decisão de autorização nos DOIS modos
  console.log('\n  decisão (podeOperarCusto) por modo:')
  for (const [nome, permitidas] of Object.entries(MATRIZ_CUSTO)) {
    const perfil = perfis.find((p) => p.nome.trim() === nome)
    if (!perfil) continue
    const mapa = (perfil.permissoes ?? {}) as MapaPermissoes
    const esperado = new Set(permitidas)
    const estritoOk = OPERACOES_CUSTO.every((op) => podeOperarCusto(mapa, op, true) === esperado.has(op))
    chk(estritoOk, `${nome} · ESTRITO: decisão == matriz`)
    // Em retrocompat, quem tem financeiro.ver pode tudo — a decisão é um SUPERCONJUNTO da matriz.
    const superconjunto = OPERACOES_CUSTO.every((op) => !esperado.has(op) || podeOperarCusto(mapa, op, false))
    chk(superconjunto, `${nome} · retrocompat: nunca nega o que a matriz permite`)
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  if (fail) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
