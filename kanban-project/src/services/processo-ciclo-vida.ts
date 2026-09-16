// src/services/processo-ciclo-vida.ts
// ============================================================================
// CICLO DE VIDA DO PROCESSO — dono único da exclusão de Processo.
//
// ─── O QUE ESTE SERVIÇO CORRIGE ─────────────────────────────────────────────
// `DELETE /api/processos/[id]` fazia `prisma.processo.delete()` cru: o
// `onDelete: Cascade` de `ObrigacaoEconomica.processoId` (schema.prisma)
// cascateia até o Ledger, mesmo pago/liquidado — sem nenhuma análise de
// impacto. É exatamente o mesmo risco que `pessoa-ciclo-vida.ts` já resolveu
// para Pessoa, só que numa via mais curta: uma obrigação lançada DIRETO no
// Processo (sem `personId`/`documentoId`) é invisível para aquele mecanismo.
//
// ─── A DECISÃO DE DOMÍNIO ───────────────────────────────────────────────────
// Mesma régua de `pessoa-ciclo-vida.ts` (fato financeiro protegido = dinheiro
// que se moveu), reaplicada por `processoId` direto: se existe QUALQUER
// movimento (`OcorrenciaFinanceira` de movimento) ou lançamento de liquidação
// (`LedgerEntry` em Caixa/Banco) ligado a uma `ObrigacaoEconomica` deste
// Processo, a exclusão é recusada por inteiro — não há "exclusão parcial que
// preserva só o financeiro". Binário, como Pessoa: sem fato → HARD; com
// fato → bloqueado (aqui não existe um modo DESATIVAR para Processo; fora de
// escopo desta correção criar um).
//
// ─── ÁRVORE ÓRFÃ (revisado 15/09/2026) ──────────────────────────────────────
// Este serviço não decide o LIFECYCLE de Árvore/Pessoa/Requerente/Família —
// quem decide continua sendo `pessoa-ciclo-vida.ts` (`analisarExclusaoArvore`
// + `removerPessoaDaArvore`, o MESMO guard de `DELETE /api/arvore/[id]`).
// Mas "exclusão não deixa órfão": se este Processo era o ÚLTIMO apontando
// para a Árvore, ela só existia por causa dele, e a rota que chama
// `excluirProcesso` chama, em seguida,
// `limparArvoreOrfaAposExclusaoDeProcesso` — mesmo guard, sem lógica nova.
// Com fato protegido (arquivo oficial, protocolo, pagamento…) ou outro
// processo ainda vivo na mesma árvore, ela continua intacta; do contrário,
// sai junto. Achado real: a versão anterior documentava isto como "fora de
// escopo de propósito" e a árvore ficava órfã para sempre — não existia
// nenhum job nem rotina que realmente a buscasse.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { OCORRENCIAS_DE_MOVIMENTO } from "@/src/services/pessoa-ciclo-vida"
import { CONTA } from "@/lib/financeiro/ledger/plano-contas"

type DB = Prisma.TransactionClient | typeof prisma

export interface FatoFinanceiroProtegidoProcesso {
  tipo: "PAGAMENTO_OU_MOVIMENTO" | "LANCAMENTO_CONTABIL"
  quantidade: number
  ids: number[]
  descricao: string
}

export interface PlanoExclusaoProcesso {
  processoId: number
  processoNome: string
  arvoreId: number | null
  familiaId: number | null
  /** Contagens do que é EXCLUSIVO do processo e sairia junto — informativo, para o preview. */
  tarefas: number
  necessidades: number
  passos: number
  anexos: number
  solicitacoes: number
  /** Só preenchido quando não há fato protegido (plano honesto, não otimista). */
  obrigacoesRemoviveis: number
  fatosProtegidos: FatoFinanceiroProtegidoProcesso[]
  podeExcluir: boolean
}

/**
 * Mesma régua de `pessoa-ciclo-vida.ts::levantarFatosProtegidos` para a fatia
 * financeira — reaplicada às obrigações que pertencem DIRETO a um Processo
 * (não a uma Pessoa/Documento). Não redefine o predicado: importa a mesma
 * lista de tipos de movimento e a mesma conta contábil de liquidação.
 */
async function fatosFinanceirosDoProcesso(
  obrigacaoIds: number[],
  db: DB,
): Promise<FatoFinanceiroProtegidoProcesso[]> {
  if (obrigacaoIds.length === 0) return []
  const fatos: FatoFinanceiroProtegidoProcesso[] = []

  const ocorrencias = await db.ocorrenciaFinanceira.findMany({
    where: {
      obrigacaoId: { in: obrigacaoIds },
      tipo: { in: OCORRENCIAS_DE_MOVIMENTO },
      status: { notIn: ["REJEITADA", "REVERTIDA"] },
    },
    select: { id: true },
  })
  if (ocorrencias.length > 0) {
    fatos.push({
      tipo: "PAGAMENTO_OU_MOVIMENTO",
      quantidade: ocorrencias.length,
      ids: ocorrencias.slice(0, 20).map((o) => o.id),
      descricao: `${ocorrencias.length} movimento(s) financeiro(s) registrado(s) neste processo — pagamento, estorno ou baixa`,
    })
  }

  // Mesma régua de liquidação de `pessoa-ciclo-vida.ts`: entry na conta
  // Caixa/Banco é o dinheiro tendo de fato se mexido, não o nascimento da
  // obrigação (par balanceado `OBRIGACAO_CRIADA`, que sai junto sem ser fato).
  const entries = await db.ledgerEntry.findMany({
    where: { obrigacaoId: { in: obrigacaoIds }, contaContabil: CONTA.CAIXA_BANCO },
    select: { id: true },
  })
  if (entries.length > 0) {
    fatos.push({
      tipo: "LANCAMENTO_CONTABIL",
      quantidade: entries.length,
      ids: entries.slice(0, 20).map((e) => e.id),
      descricao: `${entries.length} lançamento(s) de liquidação no Ledger deste processo — dinheiro que entrou ou saiu`,
    })
  }

  return fatos
}

/**
 * Plano de exclusão — só leitura. É o que o preview (GET .../impacto-exclusao)
 * mostra e o que `excluirProcesso` recalcula dentro da transação antes de agir.
 */
export async function analisarExclusaoProcesso(
  processoId: number,
  db: DB = prisma,
): Promise<PlanoExclusaoProcesso | null> {
  const processo = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, arvoreId: true, familiaId: true },
  })
  if (!processo) return null

  const [tarefas, necessidades, passos, anexos, solicitacoes, obrigacoes] = await Promise.all([
    db.tarefa.count({ where: { processoId } }),
    db.necessidadeDocumental.count({ where: { processoId } }),
    db.phaseWorkflowStepInstance.count({ where: { processoId } }),
    db.anexoProcesso.count({ where: { processoId } }),
    db.solicitacaoDocumento.count({ where: { processoId } }),
    db.obrigacaoEconomica.findMany({ where: { processoId }, select: { id: true } }),
  ])
  const obrigacaoIds = obrigacoes.map((o) => o.id)

  const fatosProtegidos = await fatosFinanceirosDoProcesso(obrigacaoIds, db)
  const podeExcluir = fatosProtegidos.length === 0

  return {
    processoId,
    processoNome: processo.nome,
    arvoreId: processo.arvoreId,
    familiaId: processo.familiaId,
    tarefas,
    necessidades,
    passos,
    anexos,
    solicitacoes,
    obrigacoesRemoviveis: podeExcluir ? obrigacaoIds.length : 0,
    fatosProtegidos,
    podeExcluir,
  }
}

export interface ExcluirProcessoInput {
  processoId: number
  actorUserId?: number | null
}

export interface ResultadoExclusaoProcesso {
  ok: boolean
  plano: PlanoExclusaoProcesso | null
  erro?: string
  code?: "PROCESSO_NAO_ENCONTRADO" | "FATO_FINANCEIRO_PROTEGIDO"
}

/**
 * EXECUÇÃO — transacional. Recalcula o plano com a linha travada (o preview
 * que a tela mostrou é preview; o que decide é este). Não existe meia
 * exclusão: qualquer erro reverte a transação inteira.
 *
 * NÃO toca Árvore/Família — ver cabeçalho do arquivo.
 */
export async function excluirProcesso(input: ExcluirProcessoInput): Promise<ResultadoExclusaoProcesso> {
  return prisma.$transaction(async (tx) => {
    // LOCK: a linha do Processo é reservada antes de qualquer leitura de plano.
    // Duas exclusões concorrentes serializam aqui; a segunda, quando destravar,
    // encontra a linha já removida pela primeira e sai idempotente (404 lógico),
    // sem tentar apagar de novo nem duplicar auditoria.
    const travado = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "Processo" WHERE id = ${input.processoId} FOR UPDATE
    `
    if (travado.length === 0) {
      return { ok: false, plano: null, erro: "Processo não encontrado", code: "PROCESSO_NAO_ENCONTRADO" as const }
    }

    const plano = await analisarExclusaoProcesso(input.processoId, tx)
    if (!plano) {
      return { ok: false, plano: null, erro: "Processo não encontrado", code: "PROCESSO_NAO_ENCONTRADO" as const }
    }

    if (!plano.podeExcluir) {
      return {
        ok: false,
        plano,
        erro: "Este processo tem fatos financeiros já materializados e não pode ser excluído definitivamente.",
        code: "FATO_FINANCEIRO_PROTEGIDO" as const,
      }
    }

    await tx.processo.delete({ where: { id: input.processoId } })

    await tx.logAuditoria.create({
      data: {
        acao: "processo_excluido_definitivo",
        entidade: "Processo",
        entidadeId: input.processoId,
        usuarioId: input.actorUserId ?? null,
        descricao:
          `Processo "${plano.processoNome}" excluído definitivamente — ` +
          `${plano.tarefas} tarefa(s), ${plano.necessidades} necessidade(s) documental(is), ` +
          `${plano.passos} passo(s) de workflow, ${plano.anexos} anexo(s), ` +
          `${plano.solicitacoes} solicitação(ões) removidos junto; nenhum fato financeiro protegido encontrado`,
        detalhes: JSON.parse(JSON.stringify({
          arvoreId: plano.arvoreId,
          familiaId: plano.familiaId,
          removidos: {
            tarefas: plano.tarefas,
            necessidades: plano.necessidades,
            passos: plano.passos,
            anexos: plano.anexos,
            solicitacoes: plano.solicitacoes,
            obrigacoesEconomicas: plano.obrigacoesRemoviveis,
          },
        })) as Prisma.InputJsonValue,
      },
    })

    return { ok: true, plano }
  }, { timeout: 30_000, maxWait: 15_000 })
}
