// scripts/backfill-cadastro-integral-do-passo.ts
// ============================================================================
// LEVA PARA O CADASTRO O QUE HOJE VIVE EM JSON E EM CÓDIGO.
//
//   npx tsx scripts/backfill-cadastro-integral-do-passo.ts              SOMENTE LEITURA
//   npx tsx scripts/backfill-cadastro-integral-do-passo.ts --execute
//
// ─── O QUE MUDA DE LUGAR ────────────────────────────────────────────────────
// 1. OPÇÕES DE CAMPO. `StepField.opcoes` guardava uma lista de textos. Um texto não
//    tem identidade: renomear "Cartório" para "Cartório de origem" apagava a opção
//    antiga e criava outra, e as execuções que escolheram a primeira passavam a
//    apontar para nada. `StepFieldOption` tem `key` — o rótulo muda, a escolha
//    registrada continua sabendo o que foi escolhido.
//
// 2. CANAIS DO PASSO. Quem oferecia canais era o componente: a tela do executor
//    `solicitacao_cartorio` listava todos os canais ativos porque o código dizia que
//    sim. Agora quem diz é `StepChannel`. O backfill grava exatamente o que a tela já
//    fazia — todos os canais ativos, na ordem do catálogo, sem exigência própria
//    (`null` = herda o catálogo). Nada muda para o operador; o que muda é quem manda.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não apaga `StepField.opcoes` (a coluna continua respondendo enquanto não
// houver opção cadastrada — ver `resolverOpcoes` na rota de execução), não toca em passo, execução, tarefa ou
// documento, não publica versão. IDEMPOTENTE: pula o que já está cadastrado.
// ============================================================================
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

const EXECUTAR = process.argv.includes('--execute')

function slug(s: string) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** As opções que a coluna JSON guarda, em qualquer um dos formatos já vistos. */
function lerOpcoesJson(v: unknown): { key: string; label: string }[] {
  if (!Array.isArray(v)) return []
  const out: { key: string; label: string }[] = []
  const usadas = new Set<string>()
  for (const [i, item] of v.entries()) {
    let key = ''
    let label = ''
    if (typeof item === 'string') { label = item; key = slug(item) }
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      label = String(o.label ?? o.value ?? o.key ?? '')
      key = slug(String(o.key ?? o.value ?? label))
    }
    if (!label) continue
    if (!key) key = `opcao_${i + 1}`
    let k = key, n = 2
    while (usadas.has(k)) { k = `${key}_${n}`; n++ }
    usadas.add(k)
    out.push({ key: k.slice(0, 60), label: label.slice(0, 200) })
  }
  return out
}

async function main() {
  console.log(EXECUTAR
    ? 'CADASTRO INTEGRAL DO PASSO — APLICANDO\n'
    : 'CADASTRO INTEGRAL DO PASSO — SOMENTE LEITURA (use --execute)\n')

  // ── 1. OPÇÕES DE CAMPO ──────────────────────────────────────────────────
  console.log('OPÇÕES DE CAMPO (JSON → StepFieldOption)')
  const campos = await prisma.stepField.findMany({
    where: { opcoes: { not: Prisma.JsonNull } },
    orderBy: { id: 'asc' },
    select: {
      id: true, key: true, label: true, opcoes: true,
      step: { select: { key: true, workflow: { select: { name: true } } } },
      opcoesCadastradas: { select: { id: true } },
    },
  })
  let opcoesCriadas = 0
  let camposPulados = 0
  for (const c of campos) {
    if (c.opcoesCadastradas.length > 0) { camposPulados++; continue }
    const opcoes = lerOpcoesJson(c.opcoes)
    if (opcoes.length === 0) continue
    console.log(`  ${EXECUTAR ? '✔' : '→'} ${(c.step?.workflow?.name ?? '?').slice(0, 24).padEnd(24)} ${c.step?.key.padEnd(28)} ${c.key.padEnd(22)} ${opcoes.length} opção(ões): ${opcoes.map((o) => o.key).join(', ')}`)
    if (EXECUTAR) {
      await prisma.stepFieldOption.createMany({
        data: opcoes.map((o, i) => ({ fieldId: c.id, key: o.key, label: o.label, ordem: i + 1, ativo: true })),
        skipDuplicates: true,
      })
      opcoesCriadas += opcoes.length
    }
  }
  if (camposPulados) console.log(`  · ${camposPulados} campo(s) já com opções cadastradas`)

  // ── 2. CANAIS DO PASSO ──────────────────────────────────────────────────
  //
  // SÓ os passos cujo executor JÁ mostrava a lista de canais. Dar canal a um passo
  // que nunca ofereceu canal seria inventar configuração que ninguém pediu.
  console.log('\nCANAIS DO PASSO (componente → StepChannel)')
  const canais = await prisma.canalOperacional.findMany({
    where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    select: { id: true, key: true },
  })
  if (canais.length === 0) {
    console.log('  ! Nenhum canal cadastrado — rode scripts/seed-cadastro-canonico.ts antes.')
  }
  const passos = await prisma.phaseInternalWorkflowStep.findMany({
    where: { executorKey: 'solicitacao_cartorio' },
    orderBy: { id: 'asc' },
    select: { id: true, key: true, workflow: { select: { name: true } }, canais: { select: { id: true } } },
  })
  let vinculosCriados = 0
  let passosPulados = 0
  for (const p of passos) {
    if (p.canais.length > 0) { passosPulados++; continue }
    console.log(`  ${EXECUTAR ? '✔' : '→'} ${(p.workflow?.name ?? '?').slice(0, 24).padEnd(24)} ${p.key.padEnd(28)} ${canais.length} canal(is): ${canais.map((c) => c.key).join(', ')}`)
    if (EXECUTAR && canais.length) {
      await prisma.stepChannel.createMany({
        data: canais.map((c, i) => ({ stepId: p.id, canalId: c.id, ordem: i + 1, ativo: true })),
        skipDuplicates: true,
      })
      vinculosCriados += canais.length
    }
  }
  if (passosPulados) console.log(`  · ${passosPulados} passo(s) já com canais cadastrados`)

  console.log(`\n${'═'.repeat(74)}`)
  console.log(`Opções criadas agora: ${opcoesCriadas} · vínculos de canal criados agora: ${vinculosCriados}`)
  console.log(`Em banco → opções: ${await prisma.stepFieldOption.count()} · canais do passo: ${await prisma.stepChannel.count()}`)
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
