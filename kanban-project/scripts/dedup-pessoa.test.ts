// scripts/dedup-pessoa.test.ts — deduplicação por identidade canônica (personId).
// Roda: npx tsx scripts/dedup-pessoa.test.ts
import { dedupPorPessoa } from '@/lib/financeiro/identidade/dedup-pessoa'

let ok = 0, fail = 0
function eq(nome: string, a: unknown, b: unknown) {
  const pa = JSON.stringify(a), pb = JSON.stringify(b)
  if (pa === pb) { ok++ } else { fail++; console.error(`✗ ${nome}\n   esperado: ${pb}\n   obtido:   ${pa}`) }
}

// 1) mesma Pessoa (personId 10) em 2 requerentes → 1 na lista, mantém o PRIMEIRO
{
  const r = dedupPorPessoa([{ id: 1, personId: 10, nome: 'Matheus Kruger' } as any, { id: 2, personId: 10, nome: 'Matheus Kruger Accioli Magalhães' } as any])
  eq('dedup: 1 por pessoa', r.itens.map((x: any) => x.id), [1])
  eq('dedup: mantém o primeiro', (r.itens[0] as any).nome, 'Matheus Kruger')
  eq('dedup: registra pendência', r.duplicatas, [{ personId: 10, requerenteIds: [1, 2] }])
}

// 2) personId nulo NUNCA é deduplicado (mantém todos, individualmente)
{
  const r = dedupPorPessoa([{ id: 3, personId: null }, { id: 4, personId: null }, { id: 5, personId: undefined }])
  eq('nulos: preserva todos', r.itens.map((x) => x.id), [3, 4, 5])
  eq('nulos: sem pendência', r.duplicatas, [])
}

// 3) pessoas distintas (personId diferente) permanecem separadas — nunca merge por nome
{
  const r = dedupPorPessoa([{ id: 6, personId: 20, nome: 'João Silva' } as any, { id: 7, personId: 21, nome: 'João Silva' } as any])
  eq('distintas: mantém 2', r.itens.map((x) => x.id), [6, 7])
  eq('distintas: sem pendência', r.duplicatas, [])
}

// 4) misto: 2 da pessoa 30, 1 nula, 1 da pessoa 31 → [primeiro-30, nula, 31]
{
  const r = dedupPorPessoa([{ id: 8, personId: 30 }, { id: 9, personId: null }, { id: 10, personId: 30 }, { id: 11, personId: 31 }])
  eq('misto: ordem estável e dedup', r.itens.map((x) => x.id), [8, 9, 11])
  eq('misto: pendência só da 30', r.duplicatas, [{ personId: 30, requerenteIds: [8, 10] }])
}

console.log(`\n${fail === 0 ? '✅' : '❌'} dedup-pessoa: ${ok} ok, ${fail} falhas`)
process.exit(fail === 0 ? 0 : 1)
