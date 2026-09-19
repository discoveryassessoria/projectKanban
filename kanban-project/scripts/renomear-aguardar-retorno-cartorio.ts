// scripts/renomear-aguardar-retorno-cartorio.ts
//
// CORREÇÃO DE NOMENCLATURA (mandato "correção definitiva do modelo
// temporal", 19-20/09/2026): "Aguardar retorno do cartório" nomeia o
// ESTADO/modo operacional (AGUARDANDO_TERCEIRO), não a obrigação. A
// obrigação real desta subtarefa é RECEBER A CONFIRMAÇÃO de que o cartório
// efetuou o pedido — renomeia key + label no cadastro VIVO (Gerenciamento)
// do workflow "Solicitar certidão" (Emissão Documental).
//
// Só toca o cadastro DRAFT/vivo (StepSubtaskDefinition) — nunca a versão
// JÁ PUBLICADA e congelada (13, hoje). Processos em andamento (ex.:
// Grisotto) continuam lendo a versão congelada, com o nome antigo,
// intocados — só um novo `congelarVersaoVigente`/publicação levaria o nome
// novo para a próxima versão. Atualiza também a única referência
// `dependeDe` que apontava para a key antiga (receber_certidao), na MESMA
// transação — nenhuma referência quebrada.
//
// Idempotente: se a key já foi renomeada, não encontra nada para trocar e
// não faz nada. Seco por padrão. Só escreve com `--aplicar`.
// Rodar (DEPOIS da migração 20260920000000 estar aplicada):
//   npx tsx scripts/renomear-aguardar-retorno-cartorio.ts [--aplicar]

import { prisma } from "@/lib/prisma"

const KEY_ANTIGA = "aguardar_retorno_do_cartorio"
const KEY_NOVA = "receber_confirmacao_do_pedido"
const LABEL_NOVO = "Receber confirmação do pedido"

async function main() {
  const aplicar = process.argv.includes("--aplicar")

  const alvo = await prisma.stepSubtaskDefinition.findFirst({
    where: { key: KEY_ANTIGA },
    select: { id: true, key: true, label: true, stepId: true },
  })
  if (!alvo) {
    console.log(`Nenhuma StepSubtaskDefinition com key "${KEY_ANTIGA}" encontrada — já renomeada, ou nunca existiu. Nada a fazer.`)
    await prisma.$disconnect()
    return
  }

  const dependentes = await prisma.stepSubtaskDefinition.findMany({
    where: { stepId: alvo.stepId },
    select: { id: true, key: true, label: true, dependeDe: true },
  })
  const paraAtualizar = dependentes.filter((d) => {
    const deps = Array.isArray(d.dependeDe) ? (d.dependeDe as string[]) : []
    return deps.includes(KEY_ANTIGA)
  })

  console.log(`Encontrado: StepSubtaskDefinition #${alvo.id} — "${alvo.key}" → "${KEY_NOVA}" (label: "${alvo.label}" → "${LABEL_NOVO}")`)
  for (const d of paraAtualizar) {
    console.log(`  também atualiza dependeDe de #${d.id} ("${d.key}"): ${JSON.stringify(d.dependeDe)} → substitui "${KEY_ANTIGA}" por "${KEY_NOVA}"`)
  }

  if (aplicar) {
    await prisma.$transaction(async (tx) => {
      await tx.stepSubtaskDefinition.update({
        where: { id: alvo.id },
        data: { key: KEY_NOVA, label: LABEL_NOVO },
      })
      for (const d of paraAtualizar) {
        const deps = (Array.isArray(d.dependeDe) ? (d.dependeDe as string[]) : []).map((k) => (k === KEY_ANTIGA ? KEY_NOVA : k))
        await tx.stepSubtaskDefinition.update({ where: { id: d.id }, data: { dependeDe: deps } })
      }
    })
    console.log("\n✅ Aplicado — só o cadastro DRAFT; versões já publicadas continuam com o nome antigo, como devem.")
  } else {
    console.log("\n(seco — rode com --aplicar para escrever)")
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
