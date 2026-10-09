// src/lib/process-stage/projecao-certidao.ts
//
// FONTE ÚNICA DE STATUS/PRAZO DE CERTIDÃO — decisão do usuário (Parte 1,
// opção ii, 29/09/2026): SolicitacaoDocumento (dataEnvio + prazoEsperadoDias
// → previsaoRetorno) + SubtaskExecution.status são o fato registrado; tudo o
// mais é CALCULADO NA LEITURA por `situacaoDaSolicitacaoCertidao` — uma única
// função, importada por todos os leitores, nunca copiada.
//
// ─── POR QUE Tarefa.statusTarefa/dataPrazo PARAM DE SER FONTE ──────────────
// Achado real (#3860, 28/09/2026): os dois só são gravados por EVENTO. Se o
// ponteiro da Tarefa estiver momentaneamente errado no instante do evento
// (bug de reancoragem, já corrigido em código), a escrita simplesmente não
// acontece — e como não é valor calculado, nada nunca reavalia depois.
// Central Operacional, Relatório de Certidões e Dashboard/PRZ-001 liam esse
// valor gravado diretamente, cada um com sua própria estratégia de fallback,
// e por isso podiam divergir entre si e da realidade.
//
// ─── O QUE CONTINUA SENDO GRAVADO ───────────────────────────────────────────
// Tarefa continua a unidade canônica de TRABALHO — responsável, atribuição,
// histórico, CANCELADA/SUPERSEDIDA/BLOQUEADA (decisão humana, nunca derivada
// daqui). Tarefa MANUAL/TRANSVERSAL/ADMINISTRATIVA e qualquer tarefa sem
// NecessidadeDocumental de origem continuam usando o que está gravado —
// não há o que calcular sem uma SolicitacaoDocumento por trás.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  situacaoDaSolicitacaoCertidao, ROTULO_SITUACAO_SOLICITACAO,
  STEP_KEY_LOCALIZAR_REGISTRO, STEP_KEY_SOLICITAR_CERTIDAO, STATUS_STEP_LOCALIZADO,
  type SituacaoSolicitacaoCertidao,
} from "./situacao-solicitacao-certidao"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"

type DB = Prisma.TransactionClient | typeof prisma

export interface ProjecaoCertidao {
  necessidadeId: number
  situacao: SituacaoSolicitacaoCertidao
  rotuloSituacao: string
  /** De `SolicitacaoDocumento.previsaoRetorno` — nunca de `Tarefa.dataPrazo`. */
  prazo: Date | null
  /**
   * O status EQUIVALENTE, no vocabulário de `Tarefa.statusTarefa` — SÓ para
   * as transições que a situação da certidão consegue provar com certeza:
   * "todas as subtarefas concluíram" (CONCLUIDO_*) e "a subtarefa corrente
   * está esperando um terceiro" (AGUARDANDO_TERCEIRO — a MESMA regra de
   * `aplicarEsperaExternaDaSubtarefaSeConfigurado`, reaplicada aqui em vez
   * de reinventada). `null` = a situação NÃO decide (ex.: nenhuma subtarefa
   * concluiu ainda — pode ser NAO_INICIADA ou EM_ANDAMENTO dependendo de o
   * operador já ter aberto a tarefa, um fato que só a própria Tarefa
   * guarda) — quem chama mantém o valor gravado nesse caso.
   */
  statusTarefaEquivalente: string | null
}

/**
 * EM LOTE — a forma que toda tela de lista (Central, verificação de Saúde)
 * deve usar; evita 1 consulta por linha para a SITUAÇÃO/PRAZO. O
 * `statusTarefaEquivalente` ainda faz 1 chamada a `subtarefasDaEtapa` por
 * necessidade com step de Emissão Documental — é a MESMA função que o motor
 * já usa pra decidir espera externa; reaproveitá-la aqui garante que a
 * verificação nunca diverge por reimplementar a regra com outra cara.
 */
export async function projecoesDeCertidaoPorNecessidade(
  necessidadeIds: number[],
  db: DB = prisma,
): Promise<Map<number, ProjecaoCertidao>> {
  const mapa = new Map<number, ProjecaoCertidao>()
  if (necessidadeIds.length === 0) return mapa

  const necs = await db.necessidadeDocumental.findMany({
    where: { id: { in: necessidadeIds } },
    select: {
      id: true,
      status: true,
      stepInstances: {
        where: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { in: [...STATUS_STEP_LOCALIZADO] } },
        select: { id: true },
        take: 1,
      },
      documentos: {
        select: {
          solicitacoes: { select: { previsaoRetorno: true }, orderBy: { id: "desc" }, take: 1 },
          stepInstances: {
            where: { stepKey: STEP_KEY_SOLICITAR_CERTIDAO, status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
            orderBy: { id: "desc" },
            select: { id: true, execucoesDeSubtarefa: { where: { status: "CONCLUIDO" }, select: { subtaskKey: true } } },
            take: 1,
          },
        },
        take: 1,
      },
    },
  })

  await Promise.all(necs.map(async (n) => {
    const doc = n.documentos[0] ?? null
    const stepInstance = doc?.stepInstances[0] ?? null
    const chavesConcluidas = stepInstance?.execucoesDeSubtarefa.map((e) => e.subtaskKey) ?? []
    const situacao = situacaoDaSolicitacaoCertidao({
      necessidadeStatus: n.status,
      registroLocalizado: n.stepInstances.length > 0,
      chavesConcluidas,
    })

    let statusTarefaEquivalente: string | null = null
    if (stepInstance) {
      const subs = await subtarefasDaEtapa({ stepInstanceId: stepInstance.id }).catch(() => [])
      if (subs.length > 0) {
        if (subs.every((s) => s.concluida)) {
          statusTarefaEquivalente = situacao === "DISPENSADA" ? "CONCLUIDO_NAO_POSSUI" : "CONCLUIDO_RECEBIDO"
        } else {
          const corrente = subs.find((s) => !s.concluida && s.bloqueioCodigo === null)
          const aguardandoTerceiro = corrente?.execucao?.status === "AGUARDANDO_EXTERNO"
            || corrente?.definicao?.esperaExternaAoLiberar === true
          if (aguardandoTerceiro) statusTarefaEquivalente = "AGUARDANDO_TERCEIRO"
          // senão: fica null — NAO_INICIADA×EM_ANDAMENTO não é decidível pela
          // situação da certidão, só pelo que a Tarefa já guarda.
        }
      }
    }

    mapa.set(n.id, {
      necessidadeId: n.id,
      situacao,
      rotuloSituacao: ROTULO_SITUACAO_SOLICITACAO[situacao],
      prazo: doc?.solicitacoes[0]?.previsaoRetorno ?? null,
      statusTarefaEquivalente,
    })
  }))
  return mapa
}

/** Conveniência para 1 necessidade só. */
export async function projecaoDeCertidao(necessidadeId: number, db: DB = prisma): Promise<ProjecaoCertidao | null> {
  const mapa = await projecoesDeCertidaoPorNecessidade([necessidadeId], db)
  return mapa.get(necessidadeId) ?? null
}

/**
 * Estados da Tarefa que NUNCA são substituídos pela projeção — são decisão
 * humana ou do motor sobre o TRABALHO em si (cancelamento, supersessão,
 * bloqueio por outro motivo), não fato de progresso da certidão. Calcular
 * por cima deles reviveria uma tarefa cancelada só porque a certidão em si
 * "parece" pendente.
 */
const STATUS_TAREFA_NUNCA_CALCULADOS = new Set(["CANCELADA", "SUPERSEDIDA", "BLOQUEADA"])

export interface StatusPrazoEfetivo {
  statusTarefa: string
  dataPrazo: Date | null
  origem: "CERTIDAO" | "GRAVADO"
}

/**
 * O QUE UMA TAREFA DEVE MOSTRAR — calculado SÓ para a Tarefa da Emissão
 * Documental ("solicitar_certidao", `faseMacroKey: "emissao_documental"")
 * que tem NecessidadeDocumental de origem e não está num estado que a
 * Tarefa manda sozinha. Gravado em qualquer outro caso — manual,
 * transversal, administrativa, a Tarefa de Genealogia ("localizar_registro")
 * da MESMA necessidade (achado real, 29/09/2026: uma necessidade tem UMA
 * Tarefa de Genealogia e, mais tarde, UMA Tarefa de Emissão Documental — as
 * duas compartilham `necessidadeId`, mas só a segunda é "a solicitação da
 * certidão"; calcular por cima da primeira comparava a situação errada) —
 * ou sem projeção calculada (ex.: necessidade fora da categoria Registro Civil).
 */
export function statusEPrazoEfetivos(
  tarefa: { necessidadeId: number | null; tipo: string; statusTarefa: string; dataPrazo: Date | null; faseMacroKey: string | null },
  projecoes: Map<number, ProjecaoCertidao>,
): StatusPrazoEfetivo {
  const projecao = tarefa.necessidadeId != null ? projecoes.get(tarefa.necessidadeId) : undefined
  const temOrigem = tarefa.tipo === "NORMAL" && tarefa.faseMacroKey === "emissao_documental" && projecao != null
  if (!temOrigem || STATUS_TAREFA_NUNCA_CALCULADOS.has(tarefa.statusTarefa)) {
    return { statusTarefa: tarefa.statusTarefa, dataPrazo: tarefa.dataPrazo, origem: "GRAVADO" }
  }
  // Prazo: a PREVISÃO DO ÓRGÃO (`previsaoRetorno`) decide sozinha quando existe. ANTES do pedido não há previsão (a projeção é `null`) e o prazo
  // que vale é o da própria Tarefa (entrada na fase + SLA do passo) — `null` não significa «sem prazo», significa «o órgão ainda não deu previsão»
  // (08/10/2026: a Carlota Salvarani, prazo 16/10, era acusada de divergir da projeção «sem prazo»).
  // Status só troca quando a situação PROVA a transição (aguardando terceiro
  // ou concluído); no meio do caminho, o gravado continua sendo o fato —
  // ver o comentário de `statusTarefaEquivalente`.
  return {
    statusTarefa: projecao.statusTarefaEquivalente ?? tarefa.statusTarefa,
    dataPrazo: projecao.prazo ?? tarefa.dataPrazo,
    origem: "CERTIDAO",
  }
}
