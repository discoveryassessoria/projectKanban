// scripts/configurar-emissao-documental-temporal.ts
//
// CONFIGURA O CONTROLE TEMPORAL das 4 subtarefas de "Solicitar certidão"
// (Emissão Documental, stepId 454) — mandato "correção definitiva do modelo
// temporal" (19-20/09/2026), seção "Configuração correta de Emissão
// Documental". Só toca o cadastro DRAFT/vivo (StepSubtaskDefinition) — a
// versão já publicada (13, hoje) e os processos em andamento continuam
// intocados até uma nova publicação.
//
// ─── O QUE MUDA, E POR QUÊ ───────────────────────────────────────────────
//
//   1. enviar_requerimento_ao_cartorio (ordem 1, ação interna)
//      Sem mudança — SLA de ação interna já correto (1 dia).
//
//   2. receber_confirmacao_do_pedido (ordem 2, AGUARDANDO_TERCEIRO — key já
//      renomeada por scripts/renomear-aguardar-retorno-cartorio.ts, que
//      precisa rodar ANTES deste)
//      NÃO liga acompanhamento nem regra temporal aqui. O mandato foi
//      explícito: "não invente agora a quantidade de dias... deixe
//      configurável e sinalize para o Administrador definir." A capacidade
//      já existe (Gerenciamento → Controle temporal, seção 2 deste mandato)
//      — quem decide o número é o Administrador, com dado real do cartório
//      em mãos, não este script.
//
//   3. receber_certidao (ordem 3, AGUARDANDO_TERCEIRO)
//      Regra temporal LIGADA — este número o mandato deu explicitamente,
//      não é invenção: 7 dias, gatilho = conclusão de
//      "receber_confirmacao_do_pedido" (o evento canônico, genérico — nunca
//      hardcoded no motor). `slaDays` (7, hoje) é ZERADO: desde a correção
//      desta rodada, uma subtarefa AGUARDANDO_TERCEIRO nunca lê `slaDays`
//      (dimensão B, SLA de ação interna) — o valor ali é dado morto, e
//      coincidir com os "7 dias" da regra temporal nova é exatamente o tipo
//      de confusão que este mandato mandou eliminar. Acompanhamento
//      próprio: mesma régua do item 2, não ligado aqui — configurável pelo
//      Administrador.
//
//   4. conferir_e_validar_certidao (ordem 4, ação interna)
//      Sem mudança.
//
// Idempotente: escreve exatamente o estado-alvo (não incrementa nada), então
// rodar duas vezes produz o mesmo resultado da primeira. Seco por padrão.
//
// ORDEM DE APLICAÇÃO NO DEPLOY: depois da migração
// 20260920000000_controle_temporal_espera_subtarefa E depois de
// scripts/renomear-aguardar-retorno-cartorio.ts (referencia a key NOVA).
//
//   npx tsx scripts/configurar-emissao-documental-temporal.ts [--aplicar]

import { prisma } from "@/lib/prisma"
import type { Prisma, PrismaClient } from "@prisma/client"

const STEP_ID_PADRAO = 454
export const KEY_CONFIRMACAO = "receber_confirmacao_do_pedido"
export const KEY_CERTIDAO = "receber_certidao"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * A LÓGICA, PARAMETRIZADA — `stepId`/`db` são override só para o teste
 * (`scripts/emissao-documental-scripts.test.ts`, contra o banco de teste); o
 * CLI real (`main`, abaixo) sempre usa o padrão de produção (454) e o
 * `prisma` global.
 */
export async function configurarEmissaoDocumentalTemporal(args: {
  aplicar: boolean
  stepId?: number
  db?: DB
}): Promise<{ ok: boolean; aplicado: boolean; motivo?: string }> {
  const { aplicar, stepId = STEP_ID_PADRAO, db = prisma } = args

  const subs = await db.stepSubtaskDefinition.findMany({
    where: { stepId },
    select: {
      id: true, key: true, label: true, ordem: true, slaDays: true, esperaExternaAoLiberar: true,
      acompanhamentoAtivo: true, regraTemporalAtiva: true, regraTemporalDias: true, regraTemporalGatilhoChave: true,
    },
    orderBy: { ordem: "asc" },
  })
  if (subs.length === 0) {
    console.error(`ABORTADO: nenhuma StepSubtaskDefinition encontrada para stepId ${stepId}.`)
    return { ok: false, aplicado: false, motivo: "STEP_NAO_ENCONTRADO" }
  }

  const confirmacao = subs.find((s) => s.key === KEY_CONFIRMACAO)
  const certidao = subs.find((s) => s.key === KEY_CERTIDAO)
  if (!confirmacao) {
    console.error(`ABORTADO: subtarefa "${KEY_CONFIRMACAO}" não encontrada — rode scripts/renomear-aguardar-retorno-cartorio.ts --aplicar primeiro.`)
    return { ok: false, aplicado: false, motivo: "CONFIRMACAO_NAO_ENCONTRADA" }
  }
  if (!certidao) {
    console.error(`ABORTADO: subtarefa "${KEY_CERTIDAO}" não encontrada.`)
    return { ok: false, aplicado: false, motivo: "CERTIDAO_NAO_ENCONTRADA" }
  }

  console.log(`Passo #${stepId} — ${subs.length} subtarefa(s):`)
  for (const s of subs) console.log(`  #${s.id} [${s.ordem}] ${s.key} — esperaExterna=${s.esperaExternaAoLiberar} slaDays=${s.slaDays ?? "—"} acompanhamento=${s.acompanhamentoAtivo} regraTemporal=${s.regraTemporalAtiva}(${s.regraTemporalDias ?? "—"}d, gatilho=${s.regraTemporalGatilhoChave ?? "própria liberação"})`)

  console.log(`\nAlvo:`)
  console.log(`  #${certidao.id} "${KEY_CERTIDAO}": regraTemporalAtiva=true, regraTemporalDias=7, regraTemporalGatilhoChave="${KEY_CONFIRMACAO}", slaDays=null (dead data zerado — não lido para AGUARDANDO_TERCEIRO)`)
  console.log(`  #${confirmacao.id} "${KEY_CONFIRMACAO}": sem mudança — acompanhamento/regra temporal ficam configuráveis, não ligados por este script (não invento a quantidade de dias)`)

  const jaAplicado = certidao.regraTemporalAtiva === true && certidao.regraTemporalDias === 7
    && certidao.regraTemporalGatilhoChave === KEY_CONFIRMACAO && certidao.slaDays == null
  if (jaAplicado) {
    console.log("\nJá está no estado-alvo — nada a fazer.")
    return { ok: true, aplicado: false, motivo: "JA_APLICADO" }
  }

  if (aplicar) {
    await db.stepSubtaskDefinition.update({
      where: { id: certidao.id },
      data: {
        regraTemporalAtiva: true,
        regraTemporalDias: 7,
        regraTemporalGatilhoChave: KEY_CONFIRMACAO,
        slaDays: null,
      },
    })
    console.log("\n✅ Aplicado — só o cadastro DRAFT; versões já publicadas continuam como estão até uma nova publicação.")
    return { ok: true, aplicado: true }
  }
  console.log("\n(seco — rode com --aplicar para escrever)")
  return { ok: true, aplicado: false, motivo: "SECO" }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  const r = await configurarEmissaoDocumentalTemporal({ aplicar })
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
