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
// novo para a próxima versão.
//
// REFERÊNCIAS ATUALIZADAS NA MESMA TRANSAÇÃO — duas, não uma:
//   1. `dependeDe` de qualquer subtarefa irmã que dependia da key antiga
//      (já cobria isto desde a primeira versão deste script).
//   2. `regraTemporalGatilhoChave` de qualquer subtarefa irmã cuja regra
//      temporal usa a key antiga como gatilho — campo que NÃO existia
//      quando este script foi escrito pela primeira vez (19/09/2026); "Receber
//      certidão" (id 68) passa a apontar o gatilho para "Receber confirmação
//      do pedido" e precisa continuar apontando, mesmo depois da renomeação.
// Nenhuma referência fica quebrada, dos dois lados.
//
// COLISÃO DE CHAVE — checada explicitamente: se já existir uma
// StepSubtaskDefinition com a key nova NO MESMO passo, o script recusa e não
// escreve nada (a chave é `@@unique([stepId, key])` — deixar o banco recusar
// derrubaria a transação inteira sem dizer por quê).
//
// Idempotente: se a key já foi renomeada, não encontra nada para trocar e
// não faz nada. Seco por padrão. Só escreve com `--aplicar`.
//
// ORDEM DE APLICAÇÃO NO DEPLOY: depois da migração
// 20260920000000_controle_temporal_espera_subtarefa estar aplicada, e ANTES
// de scripts/configurar-emissao-documental-temporal.ts (que referencia a
// SUBTAREFA PELA KEY NOVA).
//
//   npx tsx scripts/renomear-aguardar-retorno-cartorio.ts [--aplicar]

import { prisma } from "@/lib/prisma"
import type { Prisma, PrismaClient } from "@prisma/client"

export const KEY_ANTIGA = "aguardar_retorno_do_cartorio"
export const KEY_NOVA = "receber_confirmacao_do_pedido"
export const LABEL_NOVO = "Receber confirmação do pedido"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * A LÓGICA, PARAMETRIZADA — `keyAntiga`/`keyNova`/`db` são override só para
 * o teste (`scripts/emissao-documental-scripts.test.ts`, contra o banco de
 * teste, com chaves próprias para não colidir com o cadastro real); o CLI
 * real (`main`, abaixo) sempre usa as keys de produção e o `prisma` global.
 */
export async function renomearAguardarRetornoCartorio(args: {
  aplicar: boolean
  keyAntiga?: string
  keyNova?: string
  labelNovo?: string
  db?: DB
}): Promise<{ ok: boolean; aplicado: boolean; motivo?: string }> {
  const { aplicar, keyAntiga = KEY_ANTIGA, keyNova = KEY_NOVA, labelNovo = LABEL_NOVO, db = prisma } = args

  const alvo = await db.stepSubtaskDefinition.findFirst({
    where: { key: keyAntiga },
    select: { id: true, key: true, label: true, stepId: true },
  })
  if (!alvo) {
    console.log(`Nenhuma StepSubtaskDefinition com key "${keyAntiga}" encontrada — já renomeada, ou nunca existiu. Nada a fazer.`)
    return { ok: true, aplicado: false, motivo: "JA_RENOMEADA_OU_INEXISTENTE" }
  }

  const colisao = await db.stepSubtaskDefinition.findFirst({
    where: { stepId: alvo.stepId, key: keyNova },
    select: { id: true },
  })
  if (colisao) {
    console.error(`ABORTADO: já existe uma StepSubtaskDefinition #${colisao.id} com a key "${keyNova}" no mesmo passo (stepId ${alvo.stepId}). Renomear duplicaria a chave — nada foi escrito.`)
    return { ok: false, aplicado: false, motivo: "COLISAO_DE_CHAVE" }
  }

  const irmas = await db.stepSubtaskDefinition.findMany({
    where: { stepId: alvo.stepId },
    select: { id: true, key: true, label: true, dependeDe: true, regraTemporalAtiva: true, regraTemporalGatilhoChave: true },
  })
  const dependeAtualizar = irmas.filter((d) => {
    const deps = Array.isArray(d.dependeDe) ? (d.dependeDe as string[]) : []
    return deps.includes(keyAntiga)
  })
  const gatilhoAtualizar = irmas.filter((d) => d.regraTemporalGatilhoChave === keyAntiga)

  console.log(`Encontrado: StepSubtaskDefinition #${alvo.id} — "${alvo.key}" → "${keyNova}" (label: "${alvo.label}" → "${labelNovo}")`)
  for (const d of dependeAtualizar) {
    console.log(`  também atualiza dependeDe de #${d.id} ("${d.key}"): ${JSON.stringify(d.dependeDe)} → substitui "${keyAntiga}" por "${keyNova}"`)
  }
  for (const d of gatilhoAtualizar) {
    console.log(`  também atualiza regraTemporalGatilhoChave de #${d.id} ("${d.key}"): "${keyAntiga}" → "${keyNova}"`)
  }
  if (dependeAtualizar.length === 0 && gatilhoAtualizar.length === 0) {
    console.log("  nenhuma referência de irmã aponta para a key antiga ainda (normal se este script rodar ANTES da configuração temporal).")
  }

  if (!aplicar) {
    console.log("\n(seco — rode com --aplicar para escrever)")
    return { ok: true, aplicado: false, motivo: "SECO" }
  }

  const commit = async (tx: DB) => {
    await tx.stepSubtaskDefinition.update({
      where: { id: alvo.id },
      data: { key: keyNova, label: labelNovo },
    })
    for (const d of dependeAtualizar) {
      const deps = (Array.isArray(d.dependeDe) ? (d.dependeDe as string[]) : []).map((k) => (k === keyAntiga ? keyNova : k))
      await tx.stepSubtaskDefinition.update({ where: { id: d.id }, data: { dependeDe: deps } })
    }
    for (const d of gatilhoAtualizar) {
      await tx.stepSubtaskDefinition.update({ where: { id: d.id }, data: { regraTemporalGatilhoChave: keyNova } })
    }
  }
  // Só abre transação PRÓPRIA quando `db` é o cliente global — dentro de um
  // `tx` de quem chama (o teste), usar o mesmo `tx` respeita a invariante
  // transação×conexão.
  if (db === prisma) await prisma.$transaction((tx) => commit(tx))
  else await commit(db)

  console.log("\n✅ Aplicado — só o cadastro DRAFT; versões já publicadas continuam com o nome antigo, como devem.")
  return { ok: true, aplicado: true }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  const r = await renomearAguardarRetornoCartorio({ aplicar })
  await prisma.$disconnect()
  if (!r.ok) process.exit(1)
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
}
