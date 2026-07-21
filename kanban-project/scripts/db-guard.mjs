#!/usr/bin/env node
// scripts/db-guard.mjs
// ============================================================================
// TRAVA CENTRAL — roda ANTES de qualquer comando que possa escrever no banco.
//
// Uso:
//   node scripts/db-guard.mjs --url-env PRISMA_DATABASE_URL --exigir nao-producao
//   node scripts/db-guard.mjs --url-env PRISMA_DATABASE_URL --exigir producao
//   node scripts/db-guard.mjs --comando "prisma migrate deploy"
//   node scripts/db-guard.mjs --shadow
//
// Sai com 0 se pode prosseguir; 1 (abortando) em qualquer dúvida.
// Só executa SELECT — nunca escreve.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import {
  CLASSE,
  classificar,
  comandoProibido,
  confirmacaoExplicitaOk,
  identificador,
  retratar,
  validarShadow,
} from '../lib/db/identidade-banco.mjs'

const args = process.argv.slice(2)
const opt = (nome, padrao = null) => {
  const i = args.indexOf(nome)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : (args.includes(nome) ? true : padrao)
}

const abortar = (msg) => { console.error(`\n[db-guard] ABORTADO: ${msg}\n`); process.exit(1) }
const ok = (msg) => { console.log(`[db-guard] ${msg}`) }

// ── 1. comando destrutivo? ──────────────────────────────────────────────────
const comando = opt('--comando')
if (typeof comando === 'string') {
  const v = comandoProibido(comando)
  if (v.proibido) {
    abortar(
      `comando destrutivo bloqueado.\n` +
      `  comando : ${comando}\n` +
      `  padrão  : ${v.padrao}\n` +
      `  Contra produção, o ÚNICO comando permitido é: prisma migrate deploy.\n` +
      `  Migrations se geram em desenvolvimento/staging, nunca contra produção.`,
    )
  }
  ok(`comando liberado: ${comando}`)
}

// ── 2. shadow database ──────────────────────────────────────────────────────
if (opt('--shadow')) {
  const v = validarShadow({
    shadowUrl: process.env.SHADOW_DATABASE_URL,
    mainUrl: process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL,
  })
  if (!v.ok) abortar(v.motivo)
  ok(`shadow database válido e distinto do principal: ${identificador(process.env.SHADOW_DATABASE_URL)}`)
}

// ── 3. identidade do banco ──────────────────────────────────────────────────
const urlEnv = opt('--url-env')
const exigir = opt('--exigir')

if (typeof urlEnv === 'string') {
  const url = process.env[urlEnv]
  if (!url) abortar(`variável ${urlEnv} não definida.`)

  ok(`alvo: ${identificador(url)} (via ${urlEnv})`)

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  let classe, retrato
  try {
    retrato = await retratar(prisma)
    classe = classificar(retrato)
  } catch (e) {
    await prisma.$disconnect()
    abortar(`não foi possível ler o banco: ${String(e.message).slice(0, 160)}`)
  }
  await prisma.$disconnect()

  ok(`retrato: ${retrato.tabelas} tabelas · ${retrato.migrations} migrations · ${retrato.requerentes} requerentes`)
  if (retrato.sentinelasAusentes.length) ok(`sentinelas ausentes: ${retrato.sentinelasAusentes.join(', ')}`)
  ok(`classificação: ${classe}`)

  if (exigir === 'nao-producao' && classe === CLASSE.PRODUCAO) {
    abortar('o alvo é PRODUÇÃO e a operação exige banco não-produtivo.')
  }
  if (exigir === 'producao') {
    if (classe !== CLASSE.PRODUCAO) {
      abortar(`o alvo NÃO tem assinatura de produção (classificado como ${classe}). Nada será escrito.`)
    }
    if (!confirmacaoExplicitaOk()) {
      abortar(
        'escrita em produção exige confirmação explícita fora do código:\n' +
        "  export EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'",
      )
    }
    ok('produção confirmada + confirmação explícita presente.')
  }
}

ok('todas as verificações passaram.')
process.exit(0)
