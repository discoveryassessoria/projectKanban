// scripts/seed-permissoes-registral.ts
// ============================================================================
// SEED da matriz de permissões do MOTOR REGISTRAL nos perfis existentes.
//
// Por que é necessário: `Perfil.permissoes` é um JSON gravado quando o perfil foi
// criado. As 8 chaves `registral.*` são novas, então elas simplesmente NÃO existem
// no JSON dos perfis já em produção — e `temPermissao` devolve falso. Sem este
// seed, ninguém que não seja `tipo='admin'` consegue usar o motor.
//
// REGRAS DE SEGURANÇA:
//  • Toca SOMENTE as 8 chaves `registral.*`. Qualquer outra permissão do perfil é
//    preservada byte a byte.
//  • Perfil fora da matriz não é tocado (nem criado, nem zerado).
//  • `registral.mesclar_pessoas` é OPT-IN: fica FALSA em todos os perfis.
//  • Idempotente: rodar duas vezes não muda nada na segunda vez.
//  • Em banco NÃO-local exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
//  • `--dry-run` mostra o diff sem gravar.
// ============================================================================
import { prisma } from '@/lib/prisma'
import {
  CHAVE_REGISTRAL,
  MATRIZ_REGISTRAL,
  OPERACOES_REGISTRAIS,
  aplicarMatrizRegistral,
  diffRegistral,
} from '@/lib/genealogia/permissoes-registral'

type Mapa = Record<string, boolean>

async function main() {
  const dry = process.argv.includes('--dry-run')
  const url = process.env.PRISMA_DATABASE_URL ?? ''
  const local = /(127\.0\.0\.1|localhost)/.test(url)
  // Duas convenções de confirmação convivem no projeto: '1' (scripts de seed) e a
  // frase exigida pelo guard de migration. Ambas são a MESMA autorização humana
  // explícita, dada fora do código.
  const confirmado = ['1', 'SIM, ESCREVER EM PRODUCAO'].includes(
    process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO ?? '',
  )
  if (!local && !confirmado && !dry) {
    console.error(
      "❌ Banco não-local: exija EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 (ou 'SIM, ESCREVER EM PRODUCAO'), ou rode com --dry-run.",
    )
    process.exit(1)
  }
  console.log(
    `Seed de permissões registrais — ${local ? 'banco LOCAL' : 'banco REMOTO'}${dry ? ' (dry-run)' : ''}\n`,
  )

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, permissoes: true } })
  let alterados = 0
  for (const perfil of perfis) {
    const permitidas = MATRIZ_REGISTRAL[perfil.nome.trim()]
    if (!permitidas) {
      console.log(`  ·  ${perfil.nome}: fora da matriz — NÃO tocado`)
      continue
    }
    const antes = (perfil.permissoes ?? {}) as Mapa
    const depois = aplicarMatrizRegistral(antes, permitidas)
    const mudou = diffRegistral(antes, depois)
    if (!mudou.length) {
      console.log(`  =  ${perfil.nome}: já conforme`)
      continue
    }
    console.log(`  ${dry ? '~' : '↻'}  ${perfil.nome}: ${mudou.join(' · ')}`)
    if (!dry) await prisma.perfil.update({ where: { id: perfil.id }, data: { permissoes: depois } })
    alterados++
  }

  // Conferência final, restrita ao que ESTE seed é responsável: nenhum perfil DA
  // MATRIZ pode sair daqui com a permissão OPT-IN.
  //
  // O escopo importa. Perfil fora da matriz pode ter `mesclar_pessoas` concedida
  // explicitamente — é exatamente para isso que OPT-IN existe. Conferir todos os
  // perfis faria o seed abortar por uma concessão legítima que ele nem tocou.
  if (!dry) {
    const nomesDaMatriz = Object.keys(MATRIZ_REGISTRAL)
    const depois = await prisma.perfil.findMany({
      where: { nome: { in: nomesDaMatriz } },
      select: { nome: true, permissoes: true },
    })
    const comFusao = depois.filter((p) => ((p.permissoes ?? {}) as Mapa)[CHAVE_REGISTRAL.mesclar_pessoas] === true)
    if (comFusao.length) {
      console.error(
        `\n❌ ABORTADO na conferência: ${comFusao.map((p) => p.nome).join(', ')} — perfil da matriz não pode ter ${CHAVE_REGISTRAL.mesclar_pessoas} (OPT-IN).`,
      )
      await prisma.$disconnect()
      process.exit(1)
    }
    console.log(`\nConferência OPT-IN: ${depois.length} perfil(is) da matriz sem ${CHAVE_REGISTRAL.mesclar_pessoas}.`)
  }

  console.log(
    `\n${alterados} perfil(is) ${dry ? 'seriam alterados' : 'atualizados'}; ${perfis.length} analisado(s); ${OPERACOES_REGISTRAIS.length} chaves na matriz.`,
  )
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
}
