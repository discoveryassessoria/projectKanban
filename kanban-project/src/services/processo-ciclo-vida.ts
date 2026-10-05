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
// ─── ÁRVORE ÓRFÃ (revisado 16/09/2026) ──────────────────────────────────────
// Este serviço não decide o LIFECYCLE de Árvore/Pessoa/Requerente/Família —
// quem decide continua sendo `pessoa-ciclo-vida.ts`
// (`limparArvoreOrfaAposExclusaoDeProcesso` → `removerPessoaDaArvore`).
// "Exclusão não deixa órfão": se este Processo era o ÚLTIMO apontando para a
// Árvore, ela só existia por causa dele, e a rota que chama `excluirProcesso`
// chama, em seguida, `limparArvoreOrfaAposExclusaoDeProcesso`, que agora
// (decisão explícita do usuário) FORÇA a remoção mesmo com fato histórico
// protegido — a árvore só sobrevive se outro processo ainda apontar pra ela.
// Achado real anterior: a versão original documentava "não tocar a Árvore"
// como fora de escopo e ela ficava órfã para sempre; a correção seguinte
// (15/09/2026) adicionou a limpeza mas ainda respeitava fato protegido, o que
// deixava a árvore visível em Pesquisa Genealógica mesmo com o Processo já
// excluído sempre que uma única pessoa tinha um arquivo/protocolo/solicitação
// anexado — o caso real que motivou esta segunda correção.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { OCORRENCIAS_DE_MOVIMENTO } from "@/src/services/pessoa-ciclo-vida"
import { CONTA } from "@/lib/financeiro/ledger/plano-contas"
import {
  levantarArquivosDoProcesso, apagarChavesComNovaTentativa, chavesAindaReferenciadas,
  type ApagadorDeObjeto, type LevantamentoDeArquivos,
} from "@/src/services/processo-arquivos"
import { ehChavePrivada } from "@/src/lib/r2-buckets"

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
  /** Arquivos (objetos no storage) que o processo possui e que serão apagados DEPOIS da exclusão. */
  arquivosNoStorage: number
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
    arquivosNoStorage: (await levantarArquivosDoProcesso(processoId, db)).arquivos.length,
    obrigacoesRemoviveis: podeExcluir ? obrigacaoIds.length : 0,
    fatosProtegidos,
    podeExcluir,
  }
}

export interface ExcluirProcessoInput {
  processoId: number
  actorUserId?: number | null
  /** Só para teste: quem apaga o objeto no storage. Padrão: o storage real (R2). */
  apagarObjeto?: ApagadorDeObjeto
  /** Só para teste: nova tentativa mais rápida. */
  novaTentativa?: { tentativas?: number; esperaMs?: number }
}

/** O que aconteceu com os ARQUIVOS do processo no storage (depois do commit da exclusão). */
export interface ResultadoDosArquivos {
  /** Quantas chaves o processo possuía no storage (únicas). */
  levantadas: number
  apagadas: number
  /** NÃO apagadas (falharam todas as tentativas) — registradas na auditoria; o conferidor semanal as lista como órfãs. */
  falhas: Array<{ chave: string; erro: string; tentativas: number }>
  /** Preservadas porque outra linha viva ainda aponta para elas. */
  aindaReferenciadas: string[]
  /** Valores que não são do nosso storage (nada a apagar). */
  externos: number
  /** Documentos gerados que sobrevivem à exclusão (vínculo com o processo desfeito) — NUNCA apagados aqui. */
  geradosPreservados: number
}

export interface ResultadoExclusaoProcesso {
  ok: boolean
  plano: PlanoExclusaoProcesso | null
  erro?: string
  code?: "PROCESSO_NAO_ENCONTRADO" | "FATO_FINANCEIRO_PROTEGIDO"
  arquivos?: ResultadoDosArquivos
}

/** O apagador real: chave `privado/` no bucket privado (regra do modo duplo); o resto, no bucket de anexos. Nunca lê o conteúdo. */
export async function apagadorPadraoDoStorage(chave: string): Promise<void> {
  if (ehChavePrivada(chave)) {
    const { removerObjetoPrivado } = await import("@/src/lib/documentos/modelos/storage-privado")
    await removerObjetoPrivado(chave)
    return
  }
  const { r2, R2_BUCKET } = await import("@/src/lib/r2")
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3")
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: chave }))
}

const LIMITE_DE_CHAVES_NA_AUDITORIA = 2000

/**
 * EXECUÇÃO — transacional. Recalcula o plano com a linha travada (o preview
 * que a tela mostrou é preview; o que decide é este). Não existe meia
 * exclusão: qualquer erro reverte a transação inteira.
 *
 * NÃO toca Árvore/Família — ver cabeçalho do arquivo.
 */
export async function excluirProcesso(input: ExcluirProcessoInput): Promise<ResultadoExclusaoProcesso> {
  let levantamento: LevantamentoDeArquivos | null = null
  const resultadoDaTransacao = await prisma.$transaction(async (tx) => {
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

    // ARQUIVOS: as chaves de tudo que o processo possui no storage são LEVANTADAS antes de qualquer linha sumir (depois do cascade não há
    // mais como saber que o objeto existia) e vão para a auditoria desta exclusão. Os objetos só são apagados DEPOIS do commit.
    levantamento = await levantarArquivosDoProcesso(input.processoId, tx)
    // `ReceitaDocumento` que só tem `obrigacaoId` não tem chave estrangeira: o cascade do processo não chega nele. Sai junto, explicitamente.
    if (levantamento.documentosFinanceirosSemCascata.length) {
      await tx.receitaDocumento.deleteMany({ where: { id: { in: levantamento.documentosFinanceirosSemCascata } } })
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
          // As chaves do storage que o processo possuía — a prova do que deveria ser apagado depois do commit.
          arquivosNoStorage: {
            total: levantamento.arquivos.length,
            truncado: levantamento.arquivos.length > LIMITE_DE_CHAVES_NA_AUDITORIA,
            chaves: levantamento.arquivos.slice(0, LIMITE_DE_CHAVES_NA_AUDITORIA).map((a) => ({ fonte: a.fonte, id: a.id, chave: a.chave })),
            externos: levantamento.externos.length,
            documentosFinanceirosApagadosJunto: levantamento.documentosFinanceirosSemCascata.length,
            documentosGeradosPreservados: levantamento.geradosPreservados,
          },
        })) as Prisma.InputJsonValue,
      },
    })

    return { ok: true, plano }
  }, { timeout: 30_000, maxWait: 15_000 })

  if (!resultadoDaTransacao.ok || !levantamento) return resultadoDaTransacao
  const lev: LevantamentoDeArquivos = levantamento
  return { ...resultadoDaTransacao, arquivos: await apagarArquivosDoProcessoExcluido(input, lev) }
}

/**
 * DEPOIS do commit: apaga os objetos do storage (com nova tentativa), registra o resultado na auditoria e DEVOLVE o que não apagou.
 * Nunca lança: a exclusão do processo já está feita e não se desfaz por falha de storage — mas a falha NUNCA fica em silêncio
 * (auditoria + retorno + log), e o conferidor semanal de órfãos a pega de novo.
 */
async function apagarArquivosDoProcessoExcluido(input: ExcluirProcessoInput, lev: LevantamentoDeArquivos): Promise<ResultadoDosArquivos> {
  const base: ResultadoDosArquivos = {
    levantadas: lev.arquivos.length, apagadas: 0, falhas: [], aindaReferenciadas: [], externos: lev.externos.length, geradosPreservados: lev.geradosPreservados.length,
  }
  try {
    const chaves = lev.arquivos.map((a) => a.chave)
    // Linhas que sobreviveram e ainda apontam para a mesma chave: o objeto fica.
    const ainda = chaves.length ? await chavesAindaReferenciadas(chaves, prisma) : new Set<string>()
    const aApagar = chaves.filter((k) => !ainda.has(k))
    const r = await apagarChavesComNovaTentativa(aApagar, input.apagarObjeto ?? apagadorPadraoDoStorage, input.novaTentativa)
    const final: ResultadoDosArquivos = { ...base, apagadas: r.apagadas.length, falhas: r.falhas, aindaReferenciadas: [...ainda] }
    if (final.falhas.length) console.error(`[excluirProcesso ${input.processoId}] ${final.falhas.length} arquivo(s) NÃO apagado(s) do storage:`, final.falhas.map((f) => f.chave))
    await prisma.logAuditoria.create({
      data: {
        acao: final.falhas.length ? "processo_arquivos_nao_apagados" : "processo_arquivos_apagados",
        entidade: "Processo",
        entidadeId: input.processoId,
        usuarioId: input.actorUserId ?? null,
        descricao: final.falhas.length
          ? `Exclusão do processo ${input.processoId}: ${final.apagadas} arquivo(s) apagado(s) do storage e ${final.falhas.length} NÃO apagado(s) — ficam como órfãos até serem apagados por ordem do dono`
          : `Exclusão do processo ${input.processoId}: ${final.apagadas} arquivo(s) apagado(s) do storage${final.aindaReferenciadas.length ? `, ${final.aindaReferenciadas.length} preservado(s) por ainda terem outra referência` : ""}`,
        detalhes: JSON.parse(JSON.stringify({ levantadas: final.levantadas, apagadas: final.apagadas, falhas: final.falhas, aindaReferenciadas: final.aindaReferenciadas })) as Prisma.InputJsonValue,
      },
    }).catch((e) => console.error("[excluirProcesso] auditoria do apagar falhou:", e))
    return final
  } catch (e) {
    console.error(`[excluirProcesso ${input.processoId}] erro ao apagar arquivos do storage:`, e)
    return { ...base, falhas: lev.arquivos.map((a) => ({ chave: a.chave, erro: String((e as Error)?.message ?? e).slice(0, 200), tentativas: 0 })) }
  }
}
