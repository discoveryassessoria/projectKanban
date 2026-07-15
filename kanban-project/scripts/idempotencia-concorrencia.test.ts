/**
 * Idempotência sob CONCORRÊNCIA — simulação pura (sem banco, sem código novo de produção).
 * Rodar: npx tsx scripts/idempotencia-concorrencia.test.ts
 *
 * Valida o DESIGN de idempotência que o motor já usa: MotorArtefato.automaticKey
 * @unique + create-first + P2002 = "já criado". Aqui simulamos uma constraint
 * UNIQUE atômica (como o banco faz) e provamos que:
 *   • N tentativas PARALELAS com a mesma chave → exatamente 1 vence;
 *   • o anti-padrão "check-then-create" (com await no meio) DUPLICA — por isso a
 *     garantia PRECISA morar no banco (unique), nunca na aplicação.
 *
 * Não cria mecanismo novo: a simulação existe só no teste.
 */

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const tick = () => Promise.resolve() // yield de microtask p/ forçar interleaving

/** Store que imita uma coluna UNIQUE: a decisão de unicidade é ATÔMICA
 *  (has()+add() sem await no meio), como o INSERT do banco. */
class UniqueStoreAtomico {
  private keys = new Set<string>()
  async insert(key: string): Promise<boolean> {
    await tick() // round-trip assíncrono ANTES da decisão (como ir ao banco)
    if (this.keys.has(key)) return false // P2002 simulado
    this.keys.add(key) // ponto atômico: sem await entre has() e add()
    return true
  }
}

/** Anti-padrão: await ENTRE checar e gravar → janela de corrida (aplicação decide). */
class UniqueStoreNaive {
  private keys = new Set<string>()
  async insert(key: string): Promise<boolean> {
    await tick()
    if (this.keys.has(key)) return false
    await tick() // <-- janela de corrida
    this.keys.add(key)
    return true
  }
}

/** Mimetiza comIdempotencia(): só executa `criar` quem venceu a chave. */
async function tentar(store: { insert: (k: string) => Promise<boolean> }, key: string, criar: () => void) {
  const venceu = await store.insert(key)
  if (!venceu) return 'skip'
  criar()
  return 'criado'
}

async function main() {
  console.log('Idempotência sob concorrência — simulação\n')

  // 1) Atômico: 20 tentativas paralelas, mesma chave → 1 criado, 19 skip
  {
    const store = new UniqueStoreAtomico()
    let criacoes = 0
    const N = 20
    const res = await Promise.all(Array.from({ length: N }, () => tentar(store, 'proc::fase::trigger::1', () => { criacoes++ })))
    const criados = res.filter((r) => r === 'criado').length
    ok(criacoes === 1, '1) atômico: criar() executou exatamente 1 vez sob 20 paralelas')
    ok(criados === 1 && res.filter((r) => r === 'skip').length === N - 1, '1b) 1 vencedor, 19 idempotentes')
  }

  // 2) Chaves diferentes em paralelo → cada uma cria 1 vez (não interferem)
  {
    const store = new UniqueStoreAtomico()
    let criacoes = 0
    const chaves = ['a::custo', 'a::receita', 'b::custo']
    await Promise.all(chaves.flatMap((k) => [tentar(store, k, () => { criacoes++ }), tentar(store, k, () => { criacoes++ })]))
    ok(criacoes === 3, '2) 3 chaves distintas (cada com 2 tentativas) → 3 criações')
  }

  // 3) Demonstração do anti-padrão: check-then-create DUPLICA (por isso a garantia é no banco)
  {
    const store = new UniqueStoreNaive()
    let criacoes = 0
    await Promise.all(Array.from({ length: 5 }, () => tentar(store, 'k', () => { criacoes++ })))
    ok(criacoes > 1, '3) naive (await entre check e create) DUPLICA — justifica UNIQUE no banco')
  }

  // 4) Reprocesso sequencial (retry) da MESMA chave → nunca duplica
  {
    const store = new UniqueStoreAtomico()
    let criacoes = 0
    await tentar(store, 'x', () => { criacoes++ })
    await tentar(store, 'x', () => { criacoes++ }) // "worker rodou de novo"
    await tentar(store, 'x', () => { criacoes++ })
    ok(criacoes === 1, '4) reprocesso sequencial da mesma chave não duplica')
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
  console.log('Idempotência sob concorrência: design validado ✅')
}

void main()
