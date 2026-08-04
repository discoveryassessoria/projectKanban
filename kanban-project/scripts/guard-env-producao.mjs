#!/usr/bin/env node
// scripts/guard-env-producao.mjs
//
// TRAVA DE BUILD — produção não sobe sem o banco certo.
//
// Roda DENTRO do build da Vercel, antes de o Next compilar. Se o build falha, o
// deployment não é criado e o alias NÃO vira: a produção que está no ar continua
// no ar. Essa é a proteção inteira — chegar antes do alias.
//
// O INCIDENTE QUE ELE IMPEDE (04/08/2026)
// ---------------------------------------
// `PRISMA_DATABASE_URL` e `DIRECT_DATABASE_URL` perderam o target `production`.
// Nada no build precisa do banco, então o build passou; o deployment subiu; o
// alias virou; e o app inteiro passou a devolver 500 com
// `PrismaClientInitializationError: Environment variable not found`. Login,
// crons e toda rota de dados caíram junto. O erro só apareceu DEPOIS de o
// deployment quebrado já estar servindo o domínio.
//
// SÓ LEITURA DE VARIÁVEL: não abre conexão, não escreve, não consulta banco.
// Comparar strings é suficiente para as duas falhas que importam (variável
// ausente; variável apontando para o banco errado) e não introduz uma dependência
// de rede no caminho do build.
//
// FORA DE PRODUÇÃO ELE NÃO OPINA: preview e desenvolvimento têm outro banco de
// propósito. Aqui a regra vale para VERCEL_ENV=production.

import { conferirAmbiente, EXPLICACAO, MOTIVO } from '../lib/db/fingerprint-producao.mjs'

const log = (m) => console.log(`[guard-env] ${m}`)

const alvo = process.env.VERCEL_ENV ?? (process.env.CI ? 'ci' : 'local')
if (alvo !== 'production') {
  log(`VERCEL_ENV=${alvo} — a trava vale para production. Seguindo o build.`)
  process.exit(0)
}

const resultados = conferirAmbiente()
const falhas = resultados.filter((r) => !r.ok)

for (const r of resultados) {
  const onde = r.host ? ` · host ${r.host} · fingerprint ${r.fingerprint}` : ''
  log(`${r.ok ? 'OK ' : 'FALHA'} ${r.nome}${onde}`)
}

if (falhas.length === 0) {
  log('produção aponta para o banco registrado. Build liberado.')
  process.exit(0)
}

console.error('')
console.error('[guard-env] BUILD REPROVADO — produção não pode subir assim.')
for (const f of falhas) {
  console.error(`[guard-env]   ${f.nome}: ${f.motivo}`)
  console.error(`[guard-env]     ${EXPLICACAO[f.motivo]}`)
}
if (falhas.some((f) => f.motivo === MOTIVO.AUSENTE)) {
  console.error('')
  console.error('[guard-env] Para corrigir, no projeto Vercel:')
  console.error('[guard-env]   Settings › Environment Variables › target Production.')
  console.error('[guard-env]   NÃO promova a entrada de Preview: ela aponta para a homologação.')
}
console.error('')
console.error('[guard-env] Nenhum deployment foi criado. O que está no ar continua no ar.')
process.exit(1)
