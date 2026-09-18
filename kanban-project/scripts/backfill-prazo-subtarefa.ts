// scripts/backfill-prazo-subtarefa.ts
//
// ANTES desta rodada (auditoria 18/09/2026), só o ramo DISPONIVEL de
// `materializarSubtarefas`/`reconciliarSubtarefas` calculava `SubtaskExecution.
// prazo`. Uma subtarefa que nascia direto EM_ANDAMENTO (ação síncrona) ou
// AGUARDANDO_EXTERNO (espera automática/manual) ficava com o relógio
// desligado para sempre, mesmo tendo `slaDays` cadastrado e congelado na
// versão publicada — não porque faltasse regra de negócio, mas porque a
// materialização não cobria todos os ramos de nascimento. Isso já foi
// corrigido no motor (`relogioDeNascimentoDaSubtarefa`, em
// `src/services/subtarefas-da-etapa.ts`); este script reconcilia o dado que
// já nasceu pelo caminho antigo.
//
// REGRA: para toda `SubtaskExecution` vigente (`supersededAt: null`) com
// `prazo: null` em status DISPONIVEL/EM_ANDAMENTO/AGUARDANDO_EXTERNO/
// CONCLUIDO (as únicas em que o relógio já esteve, ou continua, correndo —
// PENDENTE/BLOQUEADO/CANCELADO/INVALIDADO/FALHOU ficam de fora, de
// propósito: nunca tiveram ação viva ou nunca chegaram a cumprir), resolve o
// SLA efetivo (dela mesma, herdado do passo quando vazio) na DEFINIÇÃO
// HISTÓRICA da versão que a execução registrou — nunca no cadastro vivo de
// hoje — e calcula o prazo a partir da data CANÔNICA de liberação daquela
// execução: `criadoEm` (o instante em que a linha nasceu — é exatamente esse
// instante que `abrirExecucao` grava, e é o mesmo que o motor ao vivo agora
// usa como base). NUNCA `new Date()` — isso inventaria prazo para o passado.
//
// Para AGUARDANDO_EXTERNO com `previstoPara: null`, aplica a mesma regra
// (mesma fórmula, mesmo valor de `prazo`) — sem criar SLA novo, sem cadastro
// paralelo: é o MESMO `slaDays` já congelado na versão.
//
// Quando a definição histórica não resolve a subtarefa (versão sem registro,
// ou SLA efetivo nulo/zero — nada cadastrado, de propósito, nunca é erro) a
// linha fica INTACTA e é reportada à parte — nunca inventa prazo sem fonte.
//
// Idempotente por construção: só toca `prazo IS NULL`; rodar de novo depois
// de aplicado não encontra mais candidato nenhum.
//
// Não toca em Tarefa, ownership, status, histórico de execução ou qualquer
// outra coluna além de `prazo`/`previstoPara`. Não hardcoda Grisotto,
// Daniela, nem datas específicas — roda sobre TODA `SubtaskExecution`
// vigente do banco.
//
// Seco por padrão. Só escreve com `--aplicar`.
// Rodar: npx tsx scripts/backfill-prazo-subtarefa.ts [--aplicar]

import { prisma } from "@/lib/prisma"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import { slaEfetivoDaSubtarefa } from "@/src/services/subtarefas-da-etapa"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

const STATUS_COM_RELOGIO_JA_LIGADO = ["DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO_EXTERNO", "CONCLUIDO"]

export interface ItemReconciliado {
  id: number
  stepInstanceId: number
  subtaskKey: string
  status: string
  prazo: Date | null
  previstoPara: Date | null
}

export interface ResultadoReconciliacaoPrazo {
  candidatas: number
  aplicaveis: number
  semDefinicao: number
  semSla: number
  itens: ItemReconciliado[]
}

/**
 * O NÚCLEO — usado tanto pelo CLI (`main`, abaixo) quanto pelos testes de
 * regressão (item E do mandato: reconciliação rodada duas vezes não altera
 * de novo os mesmos dados). `aplicar: false` só relata; `aplicar: true`
 * escreve. `db` permite passar o client do banco de teste.
 */
export async function reconciliarPrazoDeSubtarefasLegadas(
  opts: { aplicar: boolean; log?: boolean; db?: typeof prisma } = { aplicar: false },
): Promise<ResultadoReconciliacaoPrazo> {
  const db = opts.db ?? prisma
  const log = opts.log !== false ? console.log : () => {}

  const candidatas = await db.subtaskExecution.findMany({
    where: { supersededAt: null, prazo: null, status: { in: STATUS_COM_RELOGIO_JA_LIGADO } },
    select: { id: true, stepInstanceId: true, subtaskKey: true, status: true, criadoEm: true, previstoPara: true },
    orderBy: { id: "asc" },
  })

  if (candidatas.length === 0) {
    log("Nenhuma SubtaskExecution vigente com prazo pendente de materialização. Nada a fazer.")
    return { candidatas: 0, aplicaveis: 0, semDefinicao: 0, semSla: 0, itens: [] }
  }

  log(`${candidatas.length} execução(ões) vigente(s) com prazo=null em status com relógio já ligado.\n`)

  const histCache = new Map<number, Awaited<ReturnType<typeof definicaoHistoricaDoPasso>>>()
  let aplicaveis = 0
  let semDefinicao = 0
  let semSla = 0
  const itens: ItemReconciliado[] = []

  for (const e of candidatas) {
    if (!histCache.has(e.stepInstanceId)) {
      histCache.set(e.stepInstanceId, await definicaoHistoricaDoPasso(e.stepInstanceId))
    }
    const hist = histCache.get(e.stepInstanceId)
    const def = hist?.passo.subtarefas.find((d) => d.key === e.subtaskKey)

    if (!hist || !def) {
      semDefinicao++
      log(
        `  ⏭ execução ${e.id} (passo ${e.stepInstanceId}, "${e.subtaskKey}") — sem definição histórica resolvível ` +
        `(versão ${hist?.versao ?? "desconhecida"}) — deixada intacta.`,
      )
      continue
    }

    const slaEfetivo = slaEfetivoDaSubtarefa(def.slaDays, hist.passo.slaDays)
    if (slaEfetivo == null || slaEfetivo <= 0) {
      semSla++
      log(
        `  ⏭ execução ${e.id} (passo ${e.stepInstanceId}, "${e.subtaskKey}") — sem SLA cadastrado (própria=${def.slaDays ?? "null"}, ` +
        `passo=${hist.passo.slaDays}) — nada a materializar, não é erro.`,
      )
      continue
    }

    const dataBase = e.criadoEm // a data CANÔNICA de liberação — nunca "hoje"
    const novoPrazo = prazoOperacional(slaEfetivo, dataBase)
    const novoPrevistoPara =
      e.status === "AGUARDANDO_EXTERNO" && e.previstoPara == null ? novoPrazo : undefined

    aplicaveis++
    itens.push({ id: e.id, stepInstanceId: e.stepInstanceId, subtaskKey: e.subtaskKey, status: e.status, prazo: novoPrazo, previstoPara: novoPrevistoPara ?? e.previstoPara })
    log(
      `  ✅ execução ${e.id} (passo ${e.stepInstanceId}, "${e.subtaskKey}", status=${e.status}) — ` +
      `SLA efetivo=${slaEfetivo}d, base=${dataBase.toISOString()} → prazo=${novoPrazo?.toISOString() ?? "null"}` +
      (novoPrevistoPara !== undefined ? `, previstoPara=${novoPrevistoPara?.toISOString() ?? "null"}` : ""),
    )

    if (opts.aplicar) {
      await db.subtaskExecution.update({
        where: { id: e.id },
        data: {
          prazo: novoPrazo,
          ...(novoPrevistoPara !== undefined ? { previstoPara: novoPrevistoPara } : {}),
        },
      })
    }
  }

  log(`\nResumo: ${aplicaveis} aplicável/aplicada(s), ${semDefinicao} sem definição histórica, ${semSla} sem SLA cadastrado.`)
  log(opts.aplicar ? "\n✅ Aplicado." : "\n(seco — rode com --aplicar para escrever)")
  return { candidatas: candidatas.length, aplicaveis, semDefinicao, semSla, itens }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  await reconciliarPrazoDeSubtarefasLegadas({ aplicar })
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
}
