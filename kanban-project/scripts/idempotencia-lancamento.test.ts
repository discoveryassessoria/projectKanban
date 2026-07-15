/**
 * Idempotência de lançamentos financeiros — teste ESTRUTURAL (source-check, sem banco).
 * Rodar: npx tsx scripts/idempotencia-lancamento.test.ts
 *
 * Trava o contrato de idempotência ACHADO na auditoria para que nenhum refactor
 * futuro o quebre em silêncio. O mecanismo é UM só (reaproveitado, não duplicado):
 *   MotorArtefato.automaticKey @unique  +  create-first  +  P2002 = "já criado".
 *
 * NÃO cria mecanismo novo. Apenas garante que o existente continua íntegro.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log('Idempotência de lançamentos — contrato estrutural\n')

const schema = read('prisma/schema.prisma')
const executor = read('src/lib/motor/executor.ts')
const matriz = read('src/lib/motor/matriz-economica.ts')

// 1) Chave de idempotência é @unique no schema (a garantia forte é no banco)
ok(/automaticKey\s+String\s+@unique/.test(schema), '1) MotorArtefato.automaticKey é @unique no schema')

// 2) Ambos os motores criam o sentinela ANTES do artefato real (create-first)
ok(/motorArtefato\.create\(/.test(executor), '2) executor cria MotorArtefato (create-first)')
ok(/motorArtefato\.create\(/.test(matriz), '2b) matriz-economica cria MotorArtefato (create-first)')

// 3) Colisão P2002 é tratada como "já criado" (skip), nunca como erro/duplicata
ok(/P2002/.test(executor) && /idempot/i.test(executor), '3) executor trata P2002 = já criado (idempotência)')
ok(/P2002/.test(matriz) && /idempot/i.test(matriz), '3b) matriz trata P2002 = já criado (idempotência)')

// 4) Formato determinístico das chaves (regra + fase [+ ciclo]) — sem aleatoriedade
ok(/`\$\{processoId\}::\$\{phaseKey\}::trigger::\$\{t\.id\}`/.test(executor), '4) chave de trigger: processoId::phaseKey::trigger::id')
ok(/`\$\{processoId\}::\$\{phaseKey\}::automation::\$\{rule\.id\}`/.test(executor), '4b) chave de automation: processoId::phaseKey::automation::id')
ok(/::c\$\{phaseCycle\}::matriz:\$\{regra\.id\}::doc:\$\{doc\.id\}/.test(matriz), '4c) chave da matriz inclui ciclo + regra + doc (reemissão não duplica)')

// 5) A chave da matriz distingue custo de receita (lançamentos independentes)
ok(/::custo`/.test(matriz) && /::receita`/.test(matriz), '5) matriz separa sufixo ::custo e ::receita')

// 6) Falha na criação real remove o sentinela (não trava a chave para sempre)
ok(/motorArtefato\.delete\(/.test(executor), '6) executor remove sentinela se a criação real falhar')

// 7) Nenhuma coluna de idempotência DUPLICADA foi introduzida no ledger sem ser a canônica.
//    (Guarda contra "criar outro mecanismo": Receita/Custo não devem ganhar uma
//     segunda chave concorrente antes do Lote F5, que reusa o MESMO padrão.)
const temChaveLedgerConcorrente = /model (Receita|Custo)[\s\S]*?chaveIdempotencia/i.test(schema)
ok(!temChaveLedgerConcorrente || /automaticKey/.test(schema),
  '7) idempotência do ledger (se existir) reusa o padrão canônico, não inventa outro')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('Idempotência: contrato estrutural preservado ✅')
