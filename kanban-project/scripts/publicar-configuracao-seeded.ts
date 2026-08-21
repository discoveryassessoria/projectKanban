// scripts/publicar-configuracao-seeded.ts
// ============================================================================
// A CONFIGURAÇÃO CADASTRADA SÓ VALE DEPOIS DE PUBLICADA.
//
//   npx tsx scripts/publicar-configuracao-seeded.ts              SOMENTE LEITURA
//   npx tsx scripts/publicar-configuracao-seeded.ts --execute
//
// O seed criou ações, campos e checklist nas definições vivas. Isso ainda não chega
// a execução nenhuma: quem responde ao runtime é a VERSÃO CONGELADA, e as versões
// congeladas hoje foram feitas antes de esses dados existirem.
//
// É assim que tem de ser. Uma execução em andamento não passa a oferecer resultados
// que não existiam quando ela começou — mudar isso seria a contaminação que o
// versionamento existe para impedir. O que este script faz é PUBLICAR uma versão
// nova, com a configuração dentro: os processos em andamento continuam na versão
// deles, e os que nascerem daqui em diante recebem a nova.
//
// Antes de publicar, VALIDA. Uma configuração que a publicação recusaria não deve
// entrar em produção por um script só porque o script não perguntou.
// ============================================================================
import { prisma } from '../lib/prisma'
import { publicarNovaVersao, congelarVersaoVigente, lerVersaoPublicada } from '../src/services/versao-publicada'
import { validarWorkflowParaPublicar } from '../src/services/validacao-de-publicacao'

const EXECUTAR = process.argv.includes('--execute')

async function main() {
  console.log(EXECUTAR ? 'PUBLICAÇÃO DA CONFIGURAÇÃO CADASTRADA — APLICANDO\n' : 'PUBLICAÇÃO DA CONFIGURAÇÃO CADASTRADA — SOMENTE LEITURA (use --execute)\n')

  const wfs = await prisma.phaseInternalWorkflow.findMany({
    where: { arquivado: false },
    select: {
      id: true, name: true, phaseKey: true, versao: true,
      passos: { select: { key: true, _count: { select: { acoes: true, campos: true, checkItens: true } } } },
    },
    orderBy: { id: 'asc' },
  })

  let publicados = 0
  let recusados = 0
  for (const wf of wfs) {
    const temConfig = wf.passos.some((p) => p._count.acoes > 0 || p._count.campos > 0 || p._count.checkItens > 0)
    if (!temConfig) { console.log(`  · wf#${wf.id} "${wf.name}" — sem configuração cadastrada, nada a publicar`); continue }

    const congelada = await lerVersaoPublicada(wf.id, wf.versao)
    const jaTem = congelada?.passos.some((p) => (p.acoes?.length ?? 0) > 0 || (p.campos?.length ?? 0) > 0)
    if (jaTem) { console.log(`  · wf#${wf.id} "${wf.name}" v${wf.versao} — a versão vigente já carrega a configuração`); continue }

    const problemas = await validarWorkflowParaPublicar(wf.id)
    if (problemas.length) {
      recusados++
      console.log(`  ✗ wf#${wf.id} "${wf.name}" — RECUSADO:`)
      for (const p of problemas) console.log(`      ${p.codigo}${p.stepKey ? ` (${p.stepKey})` : ''}: ${p.mensagem}`)
      continue
    }

    const acoes = wf.passos.reduce((n, p) => n + p._count.acoes, 0)
    const campos = wf.passos.reduce((n, p) => n + p._count.campos, 0)
    const itens = wf.passos.reduce((n, p) => n + p._count.checkItens, 0)
    console.log(`  ${EXECUTAR ? '✔' : '→'} wf#${wf.id} "${wf.name}" v${wf.versao} → v${wf.versao + 1} · ${acoes} ações, ${campos} campos, ${itens} itens`)

    if (EXECUTAR) {
      await prisma.$transaction(async (tx) => {
        await publicarNovaVersao(wf.id, tx)
        await congelarVersaoVigente(wf.id, 'PUBLICACAO', tx)
      })
      await prisma.logAuditoria.create({
        data: {
          acao: 'WORKFLOW_VERSION_PUBLISHED', entidade: 'PhaseInternalWorkflow', entidadeId: wf.id,
          descricao: `"${wf.name}" publicado na versão ${wf.versao + 1}, agora com a configuração cadastrada (ações, campos e checklist). Os processos na versão ${wf.versao} continuam nela.`,
          detalhes: { versaoAnterior: wf.versao, versaoNova: wf.versao + 1, acoes, campos, itens } as never,
        },
      }).catch(() => null)
      publicados++
    }
  }

  console.log(`\n${'═'.repeat(74)}`)
  console.log(`Workflows: ${wfs.length} · publicados agora: ${publicados} · recusados: ${recusados}`)
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
  if (recusados > 0) process.exitCode = 1
}

void main().finally(() => prisma.$disconnect())
