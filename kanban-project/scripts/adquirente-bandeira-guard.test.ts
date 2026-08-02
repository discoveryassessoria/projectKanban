// scripts/adquirente-bandeira-guard.test.ts
// ============================================================================
// GUARDA — Adquirente e Bandeira como ENTIDADES definitivas (aditivo).
// Estrutural (sem banco): constantes-semente, models no schema, migration
// idempotente, prefixos de código, API CRUD, seed idempotente, aplicador.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADQUIRENTES_SEED, BANDEIRAS_SEED } from '../lib/financeiro/adquirente-constants'
import { CODE_PREFIX } from '../lib/codigos/code-patterns'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => (existsSync(join(RAIZ, p)) ? readFileSync(join(RAIZ, p), 'utf8') : '')

sec('1 — cadastro-semente (as reais do escritório)')
{
  const adq = ADQUIRENTES_SEED.map((a) => a.slug)
  ok('6 adquirentes: Cielo/Rede/Stone/Getnet/Mercado Pago/PagBank', ['CIELO', 'REDE', 'STONE', 'GETNET', 'MERCADO_PAGO', 'PAGBANK'].every((s) => adq.includes(s)))
  const bnd = BANDEIRAS_SEED.map((b) => b.slug)
  ok('5 bandeiras: Visa/Mastercard/Elo/Amex/Hipercard', ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD'].every((s) => bnd.includes(s)))
  ok('adquirentes suportam formas (cartão)', ADQUIRENTES_SEED.every((a) => a.formas.includes('CARTAO_CREDITO')))
}

sec('2 — prefixos de código')
{
  ok('ADQ (adquirente)', CODE_PREFIX.ACQUIRER === 'ADQ')
  ok('BND (bandeira)', CODE_PREFIX.CARD_BRAND === 'BND')
  ok('TXP (taxa) — lacuna preenchida', CODE_PREFIX.PAYMENT_FEE === 'TXP')
}

sec('3 — schema: entidades + vínculos aditivos')
{
  const s = ler('prisma/schema.prisma')
  ok('model Adquirente', /model Adquirente\s*{/.test(s) && s.includes('formasSuportadas') && s.includes('slug'))
  ok('model Bandeira', /model Bandeira\s*{/.test(s) && s.includes('adquirentesCompativeis'))
  ok('TaxaPagamento.adquirenteId/bandeiraId (aditivo)', s.includes('adquirenteId') && s.includes('bandeiraId'))
  ok('string adquirente PRESERVADA (compat)', /adquirente\s+String\?/.test(s))
  ok('Cobranca ganha snapshot adquirente/bandeira', /snapshot da adquirente\/bandeira/.test(s))
}

sec('4 — migration idempotente')
{
  const m = ler('prisma/migrations-arquivo/20260805000000_adquirente_bandeira/migration.sql')
  ok('CREATE TABLE IF NOT EXISTS Adquirente/Bandeira', m.includes('CREATE TABLE IF NOT EXISTS "Adquirente"') && m.includes('CREATE TABLE IF NOT EXISTS "Bandeira"'))
  ok('ADD COLUMN IF NOT EXISTS (aditivo, sem drop)', m.includes('ADD COLUMN IF NOT EXISTS "adquirenteId"') && !m.includes('DROP'))
  ok('índices únicos idempotentes', m.includes('CREATE UNIQUE INDEX IF NOT EXISTS "Adquirente_slug_key"'))
}

sec('5 — API CRUD')
{
  const aGet = ler('src/app/api/gerenciamento/adquirentes/route.ts')
  const aId = ler('src/app/api/gerenciamento/adquirentes/[id]/route.ts')
  ok('adquirentes GET/POST (código imutável na criação)', aGet.includes('gerarCodigoPublico') && aGet.includes("'ACQUIRER'"))
  ok('adquirentes DELETE bloqueia em uso', aId.includes('EM_USO') && aId.includes('adquirenteId'))
  ok('adquirentes: permissão + slug único', aGet.includes("verificarPermissao(req, 'usuarios.gerenciar')") && aGet.includes('DUPLICADO'))
  const bGet = ler('src/app/api/gerenciamento/bandeiras/route.ts')
  ok('bandeiras GET/POST (BND)', bGet.includes('gerarCodigoPublico') && bGet.includes("'CARD_BRAND'"))
  ok('bandeiras DELETE bloqueia em uso', ler('src/app/api/gerenciamento/bandeiras/[id]/route.ts').includes('EM_USO'))
}

sec('6 — seed idempotente + aplicador')
{
  const seed = ler('scripts/prod-seed-adquirentes-bandeiras.mjs')
  ok('seed roda só em production + trava PRODUCAO', seed.includes("VERCEL_ENV !== 'production'") && seed.includes('CLASSE.PRODUCAO'))
  ok('seed só INSERT do ausente (idempotente, sem update/delete)', seed.includes('adqExist.has') && !seed.includes('.delete(') && !seed.includes('.update('))
  ok('seed gera ADQ/BND pela CodeSequence', seed.includes("proximoCodigo(tx, 'ADQ')") && seed.includes("proximoCodigo(tx, 'BND')"))
  const ap = ler('scripts/prod-apply-cadastros-aditivas.mjs')
  ok('migration no aplicador + sentinelas', ap.includes('20260805000000_adquirente_bandeira') && ap.includes("['Adquirente', ['slug'"))
  const pkg = ler('package.json')
  ok('seed declarado como script administrativo', pkg.includes('prod-seed-adquirentes-bandeiras.mjs'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Adquirente & Bandeira: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
