/**
 * CP-SEC — testes de segurança (unitários, sem servidor/DB).
 *
 * Rodar: npm run test:cp-sec
 *
 * Cobre os invariantes do CP-SEC que são verificáveis de forma pura:
 *  - JWT interno (jose): aceita token bem assinado; rejeita forjado (sem
 *    assinatura), assinatura errada, expirado e campos faltando.
 *  - JWT do app (app-auth): aceita válido; rejeita forjado; exige segredo
 *    (fail-closed, sem fallback).
 *  - O decoder inseguro `src/lib/verify-auth.ts` foi removido.
 *  - O middleware é o guard central: gateia /api e não usa decoder inseguro.
 */

import { SignJWT } from 'jose'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirnameLocal = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirnameLocal, '..')

// Segredos de teste (>=32) — definidos ANTES de qualquer chamada às libs
// (os getters de segredo são lazy, então isto é suficiente).
const TEST_SECRET = 'x'.repeat(48)
process.env.JWT_SECRET = TEST_SECRET
process.env.APP_JWT_SECRET = 'a'.repeat(48)

let passed = 0
let failed = 0
const falhas: string[] = []

function ok(cond: boolean, nome: string) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

async function run() {
  console.log('CP-SEC — testes de segurança\n')

  // ---- 1) JWT interno (jose) ----
  console.log('1) JWT interno (lib/auth-jwt):')
  const { signAuthToken, verifyAuthToken } = await import('../lib/auth-jwt')

  const tokenValido = await signAuthToken({ userId: 1, email: 'a@a.com', tipo: 'admin' })
  ok((await verifyAuthToken(tokenValido)) !== null, 'aceita token válido bem assinado')

  // forjado: header.payload.<vazio> (o que o decoder antigo aceitava)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const forjado =
    b64({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    b64({ userId: 1, email: 'a@a.com', tipo: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }) +
    '.'
  ok((await verifyAuthToken(forjado)) === null, 'rejeita token forjado sem assinatura')

  // assinatura com segredo errado
  const outroSegredo = new TextEncoder().encode('z'.repeat(48))
  const tokenOutroSegredo = await new SignJWT({ userId: 1, email: 'a@a.com', tipo: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(outroSegredo)
  ok((await verifyAuthToken(tokenOutroSegredo)) === null, 'rejeita assinatura de outro segredo')

  // expirado
  const key = new TextEncoder().encode(TEST_SECRET)
  const tokenExpirado = await new SignJWT({ userId: 1, email: 'a@a.com', tipo: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(key)
  ok((await verifyAuthToken(tokenExpirado)) === null, 'rejeita token expirado')

  // campos obrigatórios faltando
  const tokenSemCampos = await new SignJWT({ foo: 'bar' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)
  ok((await verifyAuthToken(tokenSemCampos)) === null, 'rejeita token sem campos obrigatórios')

  // ---- 2) JWT do app (app-auth) ----
  console.log('\n2) JWT do app (src/lib/app-auth):')
  const appAuth = await import('../src/lib/app-auth')

  const appToken = appAuth.gerarToken({ clienteAuthId: 5, email: 'c@c.com', nome: 'C' })
  ok(appAuth.verificarToken(appToken)?.clienteAuthId === 5, 'aceita app token válido')
  ok(appAuth.verificarToken(forjado) === null, 'rejeita app token forjado')

  // fail-closed: sem segredo, deve lançar (nunca fallback)
  const bkp = process.env.APP_JWT_SECRET
  delete process.env.APP_JWT_SECRET
  let lancou = false
  try {
    appAuth.gerarToken({ clienteAuthId: 1, email: 'x@x.com', nome: 'X' })
  } catch {
    lancou = true
  }
  process.env.APP_JWT_SECRET = bkp
  ok(lancou, 'exige APP_JWT_SECRET (fail-closed, sem fallback)')

  // senha temporária: comprimento adequado e alfanumérica
  const senha = appAuth.gerarSenhaTemporaria()
  ok(senha.length >= 10 && /^[A-Za-z0-9]+$/.test(senha), 'senha temporária forte (>=10, CSPRNG)')

  // ---- 3) decoder inseguro removido ----
  console.log('\n3) Higiene:')
  ok(!existsSync(join(ROOT, 'src/lib/verify-auth.ts')), 'src/lib/verify-auth.ts foi removido')

  // ---- 4) middleware é o guard central ----
  console.log('\n4) Guard central (middleware.ts):')
  const mw = readFileSync(join(ROOT, 'middleware.ts'), 'utf8')
  ok(mw.includes('/api/:path*'), 'middleware gateia /api/:path*')
  ok(mw.includes('verifyAuthToken') && !mw.includes('verify-auth'), 'middleware usa verificação real (não o decoder inseguro)')
  ok(mw.includes('status: 401'), 'middleware retorna 401 para /api não autorizado')

  // ---- resultado ----
  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) {
    console.log('FALHAS: ' + falhas.join('; '))
    process.exit(1)
  }
  console.log('CP-SEC: todos os testes verdes ✅')
}

run().catch((e) => {
  console.error('Erro ao rodar testes CP-SEC:', e)
  process.exit(1)
})
