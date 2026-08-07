// src/services/pessoa-ciclo-vida.ts
// ============================================================================
// CICLO DE VIDA DA PESSOA DENTRO DO PROCESSO — dono ÚNICO da remoção.
//
// ─── O QUE ESTE SERVIÇO CORRIGE ─────────────────────────────────────────────
// A exclusão anterior (`DELETE /api/pessoas/[id]`, inline na rota) apagava a
// `Pessoa` e o que era LOCAL à genealogia (Documento, União, Necessidade). Tudo
// o que era DERIVADO no processo sobrevivia, porque as FKs para Pessoa são
// `onDelete: SetNull` — ou nem são FK, apenas colunas soltas:
//
//   Requerente.personId                → SetNull  (linha viva, identidade perdida)
//   ProcessoRequerente                 → intocado (vínculo pessoa↔processo sobrevive)
//   Tarefa.workflowStepInstanceId/…    → SetNull  (tarefa fantasma na fila ativa)
//   Tarefa.pessoaId                    → coluna solta, sem FK
//   PhaseWorkflowStepInstance.pessoaId → SetNull  (passo sem escopo)
//   Receita/Custo.personId             → SetNull  (lançamento sem dono)
//   ObrigacaoEconomica.personId        → coluna solta, sem FK
//
// Apagar a Pessoa não PROPAGA: DESLIGA o vínculo e deixa a linha viva. Ao
// readicionar a mesma pessoa nascia uma segunda representação operacional e
// financeira — a duplicação de requerente observada em produção.
//
// ─── A DECISÃO DE DOMÍNIO ───────────────────────────────────────────────────
// `Pessoa` é o NÓ DA ÁRVORE. `Requerente` é o registro de cliente (identidade
// canônica de quem participa do processo). `Requerente.personId` é o vínculo, e
// `ProcessoRequerente` é o vínculo com o processo.
//
// Remover alguém da árvore NUNCA apaga o cadastro de cliente: apaga (ou inativa)
// o VÍNCULO e o que foi DERIVADO dele naquele processo.
//
// ─── AS DUAS SAÍDAS ─────────────────────────────────────────────────────────
// Só FATO HISTÓRICO impede o hard delete. Fato = dinheiro que se moveu, papel
// que saiu, arquivo que existe, protocolo que foi entregue.
//
//   fatosProtegidos = 0  →  HARD: a cadeia derivada inteira sai, em transação.
//   fatosProtegidos > 0  →  DESATIVAR: sai da árvore ativa, o fato permanece.
//
// Nunca há meia exclusão: qualquer erro faz ROLLBACK da transação inteira.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { removerNecessidadesDoSujeito } from "@/src/services/necessidade-documental"
import { removerDocumentosDoSujeito } from "@/src/services/documento-operacional"
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"
import { reconciliarEconomicoDoProcesso } from "@/src/lib/motor/matriz-economica"

type DB = Prisma.TransactionClient | typeof prisma

export type ModoRemocao = "AUTO" | "HARD" | "DESATIVAR"

/** Tipos de ocorrência financeira que representam MOVIMENTO de dinheiro. */
const OCORRENCIAS_DE_MOVIMENTO = [
  "PAGAMENTO", "PAGAMENTO_PARCIAL", "ESTORNO", "REEMBOLSO",
  "CREDITO", "BAIXA", "RENEGOCIACAO", "DESCONTO", "JUROS", "MULTA",
]

// SOLICITAÇÃO NÃO TEM RASCUNHO: `SolicitacaoDocumento.dataEnvio` é obrigatório —
// a linha só existe depois que o pedido saiu. Por isso QUALQUER solicitação é
// fato, inclusive a CANCELADA (que o próprio schema declara "preservada para
// histórico"). Não há status a filtrar; havia, numa versão anterior deste
// arquivo, uma lista de status INVENTADOS que o cast escondia do compilador.

export interface FatoProtegido {
  /** Chave estável do tipo de fato — nunca texto livre para a UI decidir. */
  tipo:
    | "PAGAMENTO_OU_MOVIMENTO"
    | "LANCAMENTO_CONTABIL"
    | "FATURA_EMITIDA"
    | "PAGAMENTO_RECEBIDO"
    | "RECIBO_EMITIDO"
    | "PROTOCOLO_ENVIADO"
    | "PROTOCOLO_DE_DOCUMENTO"
    | "ARQUIVO_OFICIAL"
    | "SOLICITACAO_ENVIADA"
    | "DOCUMENTO_GERADO"
    | "ANEXO_DO_REQUERENTE"
  /** Quantos registros deste tipo existem. */
  quantidade: number
  /** IDs concretos (amostra de até 20) — evidência, não estatística. */
  ids: number[]
  /** Frase para a tela. O domínio escreve; a UI só exibe. */
  descricao: string
}

export interface RemoviveisPessoa {
  vinculoArvore: number
  vinculoProcesso: number
  unioes: number
  necessidades: number
  documentos: number
  passos: number
  tarefas: number
  participantesFinanceiros: number
  receitasPrevistas: number
  custosPrevistos: number
  obrigacoesPrevistas: number
  distribuicoes: number
}

export interface PlanoRemocaoPessoa {
  pessoaId: number
  pessoaNome: string
  arvoreId: number | null
  processoIds: number[]
  requerenteId: number | null
  requerenteNome: string | null
  removiveis: RemoviveisPessoa
  fatosProtegidos: FatoProtegido[]
  /** Impedimentos ABSOLUTOS — nem hard delete nem desativação resolvem. */
  bloqueios: string[]
  podeHardDelete: boolean
  podeDesativar: boolean
  /** Modo que `AUTO` escolheria agora. */
  modoSugerido: Exclude<ModoRemocao, "AUTO">
}

export interface RemocaoInput {
  pessoaId: number
  actorUserId?: number | null
  modo?: ModoRemocao
  motivo?: string | null
}

export interface ResultadoRemocao {
  ok: boolean
  modoExecutado: Exclude<ModoRemocao, "AUTO"> | null
  plano: PlanoRemocaoPessoa
  /** O que efetivamente saiu do banco (contagens reais, não estimativa do plano). */
  removidos: RemoviveisPessoa
  processosAfetados: number[]
  erro?: string
  code?: "PESSOA_NAO_ENCONTRADA" | "FATO_PROTEGIDO_IMPEDE_HARD_DELETE" | "BLOQUEIO"
}

const vazio = (): RemoviveisPessoa => ({
  vinculoArvore: 0, vinculoProcesso: 0, unioes: 0, necessidades: 0, documentos: 0,
  passos: 0, tarefas: 0, participantesFinanceiros: 0, receitasPrevistas: 0,
  custosPrevistos: 0, obrigacoesPrevistas: 0, distribuicoes: 0,
})

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO — resolve, por ID, toda a cadeia derivada de UMA pessoa.
// Nenhuma resolução por nome, CPF, e-mail, rótulo ou posição na árvore.
// ═══════════════════════════════════════════════════════════════════════════

interface ContextoPessoa {
  pessoa: { id: number; nome: string; sobrenome: string | null; arvoreId: number | null }
  processoIds: number[]
  requerenteId: number | null
  requerenteNome: string | null
  uniaoIds: number[]
  documentoIds: number[]
  necessidadeIds: number[]
  passoIds: number[]
  tarefaIds: number[]
  receitaIds: number[]
  custoIds: number[]
  obrigacaoIds: number[]
  participanteIds: number[]
}

async function carregarContexto(pessoaId: number, db: DB): Promise<ContextoPessoa | null> {
  const pessoa = await db.pessoa.findUnique({
    where: { id: pessoaId },
    select: { id: true, nome: true, sobrenome: true, arvoreId: true },
  })
  if (!pessoa) return null

  // Processos que usam ESTA árvore. É por aqui que o nó da árvore alcança o processo.
  const processos = pessoa.arvoreId
    ? await db.processo.findMany({ where: { arvoreId: pessoa.arvoreId }, select: { id: true } })
    : []
  const processoIds = processos.map((p) => p.id)

  const requerente = await db.requerente.findFirst({
    where: { personId: pessoaId },
    select: { id: true, nome: true },
  })

  const unioes = await db.uniao.findMany({
    where: { OR: [{ pessoa1Id: pessoaId }, { pessoa2Id: pessoaId }] },
    select: { id: true },
  })
  const uniaoIds = unioes.map((u) => u.id)

  const documentos = await db.documento.findMany({ where: { pessoaId }, select: { id: true } })
  const documentoIds = documentos.map((d) => d.id)

  const necessidades = await db.necessidadeDocumental.findMany({
    where: { OR: [{ pessoaId }, ...(uniaoIds.length ? [{ uniaoId: { in: uniaoIds } }] : [])] },
    select: { id: true },
  })
  const necessidadeIds = necessidades.map((n) => n.id)

  // Passos de QUALQUER um dos três escopos que a pessoa origina.
  const passos = await db.phaseWorkflowStepInstance.findMany({
    where: {
      OR: [
        { pessoaId },
        ...(necessidadeIds.length ? [{ necessidadeId: { in: necessidadeIds } }] : []),
        ...(documentoIds.length ? [{ documentoId: { in: documentoIds } }] : []),
      ],
    },
    select: { id: true },
  })
  const passoIds = passos.map((s) => s.id)

  // Tarefas: pela projeção do passo, pelo vínculo direto com necessidade/documento,
  // e pela coluna solta `pessoaId` (que não tem FK e por isso nunca foi limpa).
  const tarefas = await db.tarefa.findMany({
    where: {
      OR: [
        { pessoaId },
        ...(passoIds.length ? [{ workflowStepInstanceId: { in: passoIds } }] : []),
        ...(necessidadeIds.length ? [{ necessidadeId: { in: necessidadeIds } }] : []),
        ...(documentoIds.length ? [{ documentoId: { in: documentoIds } }] : []),
      ],
    },
    select: { id: true },
  })
  const tarefaIds = tarefas.map((t) => t.id)

  // Financeiro: o que nasceu POR ESTA PESSOA (personId) ou por documento dela.
  const orFinanceiro: Prisma.ReceitaWhereInput[] = [{ personId: pessoaId }]
  if (documentoIds.length) orFinanceiro.push({ documentoId: { in: documentoIds } })

  const receitas = await db.receita.findMany({ where: { OR: orFinanceiro }, select: { id: true } })
  const receitaIds = receitas.map((r) => r.id)
  const orCusto: Prisma.CustoWhereInput[] = [{ personId: pessoaId }]
  if (documentoIds.length) orCusto.push({ documentoId: { in: documentoIds } })
  const custos = await db.custo.findMany({ where: { OR: orCusto }, select: { id: true } })
  const custoIds = custos.map((c) => c.id)

  const obrigacoes = await db.obrigacaoEconomica.findMany({
    where: {
      OR: [
        { personId: pessoaId },
        ...(documentoIds.length ? [{ documentoId: { in: documentoIds } }] : []),
      ],
    },
    select: { id: true },
  })
  const obrigacaoIds = obrigacoes.map((o) => o.id)

  // Participante financeiro: a linha de distribuição do requerente desta pessoa.
  // Só as receitas DESTE processo — nunca varre o financeiro de outro processo.
  const participantes = requerente
    ? await db.receitaRequerente.findMany({
        where: {
          requerenteId: requerente.id,
          ...(processoIds.length ? { receita: { processoId: { in: processoIds } } } : {}),
        },
        select: { id: true },
      })
    : []

  return {
    pessoa,
    processoIds,
    requerenteId: requerente?.id ?? null,
    requerenteNome: requerente?.nome ?? null,
    uniaoIds,
    documentoIds,
    necessidadeIds,
    passoIds,
    tarefaIds,
    receitaIds,
    custoIds,
    obrigacaoIds,
    participanteIds: participantes.map((p) => p.id),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FATOS PROTEGIDOS — o que impede o hard delete.
// ═══════════════════════════════════════════════════════════════════════════

async function levantarFatosProtegidos(ctx: ContextoPessoa, db: DB): Promise<FatoProtegido[]> {
  const fatos: FatoProtegido[] = []
  const registrar = (
    tipo: FatoProtegido["tipo"],
    ids: number[],
    descricao: (n: number) => string,
  ) => {
    if (ids.length > 0) fatos.push({ tipo, quantidade: ids.length, ids: ids.slice(0, 20), descricao: descricao(ids.length) })
  }

  // ── Dinheiro que se moveu ────────────────────────────────────────────────
  if (ctx.obrigacaoIds.length) {
    const ocorrencias = await db.ocorrenciaFinanceira.findMany({
      where: {
        obrigacaoId: { in: ctx.obrigacaoIds },
        tipo: { in: OCORRENCIAS_DE_MOVIMENTO },
        status: { notIn: ["REJEITADA", "REVERTIDA"] },
      },
      select: { id: true },
    })
    registrar("PAGAMENTO_OU_MOVIMENTO", ocorrencias.map((o) => o.id),
      (n) => `${n} movimento(s) financeiro(s) registrado(s) — pagamento, estorno ou baixa`)

    const entries = await db.ledgerEntry.findMany({
      where: { obrigacaoId: { in: ctx.obrigacaoIds } },
      select: { id: true },
    })
    registrar("LANCAMENTO_CONTABIL", entries.map((e) => e.id),
      (n) => `${n} lançamento(s) no Ledger — a verdade contábil do movimento`)
  }

  if (ctx.requerenteId != null) {
    const faturas = await db.faturaDestinatario.findMany({
      where: { requerenteId: ctx.requerenteId },
      select: { id: true },
    })
    registrar("FATURA_EMITIDA", faturas.map((f) => f.id), (n) => `${n} fatura(s) emitida(s) em nome desta pessoa`)

    const pagamentos = await db.pagamentoDestinatario.findMany({
      where: { requerenteId: ctx.requerenteId },
      select: { id: true },
    })
    registrar("PAGAMENTO_RECEBIDO", pagamentos.map((p) => p.id), (n) => `${n} pagamento(s) recebido(s) desta pessoa`)

    const recibos = await db.recibo.findMany({
      where: { pagadorRequerenteId: ctx.requerenteId },
      select: { id: true },
    })
    registrar("RECIBO_EMITIDO", recibos.map((r) => r.id), (n) => `${n} recibo(s) emitido(s)`)

    const protocolos = await db.protocolo.findMany({
      where: { requerenteId: ctx.requerenteId },
      select: { id: true },
    })
    registrar("PROTOCOLO_ENVIADO", protocolos.map((p) => p.id), (n) => `${n} protocolo(s) oficial(is) entregue(s) a órgão`)

    const anexos = await db.anexoRequerente.findMany({
      where: { requerenteId: ctx.requerenteId },
      select: { id: true },
    })
    registrar("ANEXO_DO_REQUERENTE", anexos.map((a) => a.id), (n) => `${n} anexo(s) no cadastro do requerente`)
  }

  // ── Papel que existe ─────────────────────────────────────────────────────
  if (ctx.documentoIds.length) {
    const arquivos = await db.documentoArquivo.findMany({
      where: { documentoId: { in: ctx.documentoIds } },
      select: { id: true },
    })
    registrar("ARQUIVO_OFICIAL", arquivos.map((a) => a.id), (n) => `${n} arquivo(s) oficial(is) anexado(s) aos documentos`)

    const protDocs = await db.protocoloDocumento.findMany({
      where: { documentoId: { in: ctx.documentoIds } },
      select: { id: true },
    })
    registrar("PROTOCOLO_DE_DOCUMENTO", protDocs.map((p) => p.id), (n) => `${n} documento(s) já protocolado(s)`)

    const solicitacoes = await db.solicitacaoDocumento.findMany({
      where: { documentoId: { in: ctx.documentoIds } },
      select: { id: true },
    })
    registrar("SOLICITACAO_ENVIADA", solicitacoes.map((s) => s.id), (n) => `${n} solicitação(ões) de certidão já enviada(s)`)
  }

  // Documento gerado a partir de Modelo: a FK é `Restrict` — apagar é impossível
  // no banco, então é fato protegido por construção, não por política.
  const gerados = await db.documentoGerado.findMany({
    where: {
      OR: [
        { pessoaId: ctx.pessoa.id },
        ...(ctx.requerenteId != null ? [{ requerenteId: ctx.requerenteId }] : []),
      ],
    },
    select: { id: true },
  })
  registrar("DOCUMENTO_GERADO", gerados.map((g) => g.id), (n) => `${n} documento(s) gerado(s) a partir de modelo (procuração, contrato…)`)

  return fatos
}

// ═══════════════════════════════════════════════════════════════════════════
// PLANO — análise prévia. Somente leitura; é o que a UI mostra antes de agir.
// ═══════════════════════════════════════════════════════════════════════════

export async function analisarRemocaoPessoa(
  pessoaId: number,
  db: DB = prisma,
): Promise<PlanoRemocaoPessoa | null> {
  const ctx = await carregarContexto(pessoaId, db)
  if (!ctx) return null

  const fatosProtegidos = await levantarFatosProtegidos(ctx, db)

  // Obrigações/receitas/custos que JÁ têm fato não entram na lista de removíveis:
  // o plano precisa ser honesto sobre o que sai, não otimista.
  const semFato = fatosProtegidos.length === 0

  const removiveis: RemoviveisPessoa = {
    vinculoArvore: ctx.pessoa.arvoreId != null ? 1 : 0,
    vinculoProcesso: ctx.requerenteId != null ? ctx.processoIds.length : 0,
    unioes: ctx.uniaoIds.length,
    necessidades: ctx.necessidadeIds.length,
    documentos: ctx.documentoIds.length,
    passos: ctx.passoIds.length,
    tarefas: ctx.tarefaIds.length,
    participantesFinanceiros: ctx.participanteIds.length,
    receitasPrevistas: semFato ? ctx.receitaIds.length : 0,
    custosPrevistos: semFato ? ctx.custoIds.length : 0,
    obrigacoesPrevistas: semFato ? ctx.obrigacaoIds.length : 0,
    distribuicoes: semFato
      ? await db.distribuicaoEconomica.count({ where: { obrigacaoId: { in: ctx.obrigacaoIds } } })
      : 0,
  }

  const bloqueios: string[] = []
  // Pessoa que é pai/mãe de outro nó: a árvore perderia a ligação sem aviso.
  // Não é impedimento — é informação que a exclusão trata (desliga o vínculo).
  // Bloqueio real só existe para o que o banco recusa: DocumentoGerado (Restrict).

  return {
    pessoaId,
    pessoaNome: [ctx.pessoa.nome, ctx.pessoa.sobrenome].filter(Boolean).join(" "),
    arvoreId: ctx.pessoa.arvoreId,
    processoIds: ctx.processoIds,
    requerenteId: ctx.requerenteId,
    requerenteNome: ctx.requerenteNome,
    removiveis,
    fatosProtegidos,
    bloqueios,
    podeHardDelete: fatosProtegidos.length === 0 && bloqueios.length === 0,
    podeDesativar: bloqueios.length === 0,
    modoSugerido: fatosProtegidos.length === 0 ? "HARD" : "DESATIVAR",
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUÇÃO — transacional. Não existe meia exclusão.
// ═══════════════════════════════════════════════════════════════════════════

export async function removerPessoaDaArvore(input: RemocaoInput): Promise<ResultadoRemocao> {
  const modo = input.modo ?? "AUTO"
  // A árvore de origem é lida ANTES: depois do commit a Pessoa pode não existir.
  const arvoreOrigem = (await prisma.pessoa.findUnique({
    where: { id: input.pessoaId }, select: { arvoreId: true },
  }))?.arvoreId ?? null

  // TIMEOUT EXPLÍCITO. A remoção é uma transação LONGA por natureza: o plano
  // levanta onze tipos de fato protegido, o contexto resolve doze conjuntos de
  // IDs e a cascata executa cerca de vinte comandos — tudo sequencial, porque
  // cada passo depende do anterior. São ~45 idas ao banco.
  //
  // Com o banco local isso cabe folgado nos 5s padrão do Prisma. Contra o banco
  // de produção (pooled, remoto) não cabe: o smoke reprovou com P2028
  // "Transaction not found" no meio da cascata. O rollback funcionou — nada
  // ficou pela metade —, mas a exclusão não completava.
  //
  // Encurtar a transação não é opção: meia exclusão é o defeito que este
  // serviço existe para impedir. O que se ajusta é o tempo.
  const resultado: ResultadoRemocao = await prisma.$transaction(async (tx) => {
    // LOCK: a linha da Pessoa é reservada antes de qualquer leitura de plano.
    // Duas remoções concorrentes serializam aqui; a segunda encontra o contexto
    // já vazio e sai idempotente, sem apagar nada de ninguém.
    const travada = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "Pessoa" WHERE id = ${input.pessoaId} FOR UPDATE
    `
    if (travada.length === 0) {
      return {
        ok: false, modoExecutado: null, removidos: vazio(), processosAfetados: [],
        plano: null as unknown as PlanoRemocaoPessoa,
        erro: "Pessoa não encontrada", code: "PESSOA_NAO_ENCONTRADA" as const,
      }
    }

    // O plano é RECALCULADO dentro da transação, com o lock em mãos. O plano que
    // a tela mostrou é preview; o que decide é este.
    const plano = await analisarRemocaoPessoa(input.pessoaId, tx)
    if (!plano) {
      return {
        ok: false, modoExecutado: null, removidos: vazio(), processosAfetados: [],
        plano: null as unknown as PlanoRemocaoPessoa,
        erro: "Pessoa não encontrada", code: "PESSOA_NAO_ENCONTRADA" as const,
      }
    }

    if (plano.bloqueios.length > 0) {
      return {
        ok: false, modoExecutado: null, plano, removidos: vazio(), processosAfetados: [],
        erro: plano.bloqueios.join(" · "), code: "BLOQUEIO" as const,
      }
    }

    const efetivo: Exclude<ModoRemocao, "AUTO"> =
      modo === "AUTO" ? plano.modoSugerido : modo

    // Hard delete pedido explicitamente contra fato protegido: recusa, não degrada
    // em silêncio. Quem pediu hard delete precisa saber que não foi hard delete.
    if (efetivo === "HARD" && !plano.podeHardDelete) {
      return {
        ok: false, modoExecutado: null, plano, removidos: vazio(), processosAfetados: [],
        erro: "Há fatos históricos protegidos — a exclusão definitiva não é permitida.",
        code: "FATO_PROTEGIDO_IMPEDE_HARD_DELETE" as const,
      }
    }

    const ctx = (await carregarContexto(input.pessoaId, tx))!
    const removidos = efetivo === "HARD"
      ? await executarHard(ctx, tx)
      : await executarDesativacao(ctx, tx, input)

    await tx.logAuditoria.create({
      data: {
        acao: efetivo === "HARD" ? "pessoa_removida_definitivo" : "pessoa_removida_historico",
        entidade: "Pessoa",
        entidadeId: input.pessoaId,
        usuarioId: input.actorUserId ?? null,
        descricao:
          efetivo === "HARD"
            ? `Pessoa "${plano.pessoaNome}" e toda a cadeia derivada foram removidas do processo`
            : `Pessoa "${plano.pessoaNome}" saiu da árvore ativa; ${plano.fatosProtegidos.length} fato(s) histórico(s) preservado(s)`,
        detalhes: JSON.parse(JSON.stringify({
          modo: efetivo,
          motivo: input.motivo ?? null,
          processoIds: plano.processoIds,
          requerenteId: plano.requerenteId,
          removidos,
          fatosProtegidos: plano.fatosProtegidos.map((f) => ({ tipo: f.tipo, quantidade: f.quantidade })),
        })) as Prisma.InputJsonValue,
      },
    })

    return { ok: true, modoExecutado: efetivo, plano, removidos, processosAfetados: plano.processoIds }
  }, { timeout: 60_000, maxWait: 15_000 })

  // RECONCILIAÇÃO PÓS-COMMIT — parte do ato, não da rota.
  //
  // Ela vivia na rota `DELETE /api/pessoas/[id]`. A rota `DELETE /api/arvore/[id]`
  // chamava o mesmo serviço e NÃO reconciliava: duas portas de entrada, dois
  // estados finais. A origem da ação não pode mudar o estado final do domínio,
  // então a reconciliação desceu para cá — onde toda porta a herda.
  //
  // Fora da transação porque materialização e reconciliação abrem as suas
  // próprias; dentro, o `tx` já estaria fechado quando elas commitassem.
  if (resultado.ok) {
    await reconciliarAposRemocao({ arvoreId: arvoreOrigem, processoIds: resultado.processosAfetados })
  }
  return resultado
}

/**
 * O estado final do processo depois que alguém sai. IDEMPOTENTE: rodar de novo
 * não recria pessoa, participante, documento, tarefa, custo nem receita —
 * os dois serviços chamados aqui convergem, não somam.
 *
 * Reutiliza os serviços canônicos existentes; não há versão alternativa deles.
 */
export async function reconciliarAposRemocao(
  args: { arvoreId: number | null; processoIds: number[] },
): Promise<{ arvore: boolean; processos: number[]; erros: string[] }> {
  const erros: string[] = []

  // (1) Documental: reavalia as Regras Documentais publicadas contra quem SOBROU
  //     na árvore. É o mesmo serviço que a criação e a edição de pessoa chamam.
  //     Pessoa removida não volta: a leitura já é escopada por `pessoasAtivasDaArvore`.
  if (args.arvoreId != null) {
    try {
      await dispararMaterializacaoPorArvore(args.arvoreId)
    } catch (e) {
      erros.push(`materialização da árvore ${args.arvoreId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // (2) Econômico: recria o que falta e REMOVE os órfãos do processo — custo,
  //     receita e obrigação que dependiam de documento/pessoa que saiu. É o que
  //     mantém Central, Planilha e indicadores corretos, porque todos derivam
  //     dessas mesmas linhas (nenhum tem estado próprio a atualizar).
  const reconciliados: number[] = []
  for (const processoId of args.processoIds) {
    try {
      await reconciliarEconomicoDoProcesso(processoId)
      reconciliados.push(processoId)
    } catch (e) {
      erros.push(`reconcile econômico do processo ${processoId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (erros.length) console.error("[pessoa removida → reconciliação]", erros.join(" ; "))
  return { arvore: args.arvoreId != null, processos: reconciliados, erros }
}

/**
 * HARD — a cadeia derivada inteira sai, das folhas para a raiz.
 * A ordem não é estética: cada passo remove quem aponta para o próximo.
 */
async function executarHard(ctx: ContextoPessoa, tx: Prisma.TransactionClient): Promise<RemoviveisPessoa> {
  const out = vazio()

  // 1) Financeiro — participante, distribuição, projeção, obrigação, lançamento.
  if (ctx.participanteIds.length) {
    out.participantesFinanceiros = (await tx.receitaRequerente.deleteMany({
      where: { id: { in: ctx.participanteIds } },
    })).count
  }
  if (ctx.obrigacaoIds.length) {
    out.distribuicoes = (await tx.distribuicaoEconomica.deleteMany({
      where: { obrigacaoId: { in: ctx.obrigacaoIds } },
    })).count
    await tx.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: ctx.obrigacaoIds } } })
    // OBRIGACAO_CRIADA é registro de nascimento, não movimento: sai com a obrigação.
    await tx.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: ctx.obrigacaoIds } } })
    await tx.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: ctx.obrigacaoIds } } })
    out.obrigacoesPrevistas = (await tx.obrigacaoEconomica.deleteMany({
      where: { id: { in: ctx.obrigacaoIds } },
    })).count
  }
  if (ctx.receitaIds.length) {
    await tx.receitaRequerente.deleteMany({ where: { receitaId: { in: ctx.receitaIds } } })
    await tx.parcelaFinanceira.deleteMany({ where: { receitaId: { in: ctx.receitaIds } } })
    await tx.eventoFinanceiro.deleteMany({ where: { receitaId: { in: ctx.receitaIds } } })
    out.receitasPrevistas = (await tx.receita.deleteMany({ where: { id: { in: ctx.receitaIds } } })).count
  }
  if (ctx.custoIds.length) {
    await tx.parcelaFinanceira.deleteMany({ where: { custoId: { in: ctx.custoIds } } })
    await tx.eventoFinanceiro.deleteMany({ where: { custoId: { in: ctx.custoIds } } })
    out.custosPrevistos = (await tx.custo.deleteMany({ where: { id: { in: ctx.custoIds } } })).count
  }

  // 2) Operacional — tarefa antes do passo (a tarefa é a projeção do passo).
  if (ctx.tarefaIds.length) {
    await tx.tarefa.deleteMany({ where: { tarefaPaiId: { in: ctx.tarefaIds } } })
    out.tarefas = (await tx.tarefa.deleteMany({ where: { id: { in: ctx.tarefaIds } } })).count
  }
  if (ctx.passoIds.length) {
    out.passos = (await tx.phaseWorkflowStepInstance.deleteMany({
      where: { id: { in: ctx.passoIds } },
    })).count
  }

  // 3) Documental — pelos serviços canônicos, que respondem pelos guards.
  const doc = await removerDocumentosDoSujeito({ pessoaId: ctx.pessoa.id }, tx)
  out.documentos = doc.documentos
  const nec = await removerNecessidadesDoSujeito({ pessoaId: ctx.pessoa.id, uniaoIds: ctx.uniaoIds }, tx)
  out.necessidades = nec.necessidades
  out.passos += nec.passos

  // 4) Árvore — uniões e as referências de parentesco dos filhos.
  if (ctx.uniaoIds.length) {
    out.unioes = (await tx.uniao.deleteMany({ where: { id: { in: ctx.uniaoIds } } })).count
  }
  await tx.pessoa.updateMany({ where: { paiId: ctx.pessoa.id }, data: { paiId: null } })
  await tx.pessoa.updateMany({ where: { maeId: ctx.pessoa.id }, data: { maeId: null } })
  await tx.arvore.updateMany({
    where: { pessoaPrincipalId: ctx.pessoa.id },
    data: { pessoaPrincipalId: null },
  })

  // 5) Vínculo pessoa↔processo. É ESTE passo que a exclusão antiga não tinha —
  //    e por isso o requerente sobrevivia à pessoa e duplicava na reinserção.
  if (ctx.requerenteId != null && ctx.processoIds.length) {
    out.vinculoProcesso = (await tx.processoRequerente.deleteMany({
      where: { requerenteId: ctx.requerenteId, processoId: { in: ctx.processoIds } },
    })).count
    // O CADASTRO do requerente permanece: ele pode existir em outro processo, no
    // histórico ou como cliente. Só o PONTEIRO para o nó da árvore é desfeito.
    await tx.requerente.update({ where: { id: ctx.requerenteId }, data: { personId: null } })
  }

  // 6) O nó da árvore.
  await tx.pessoa.delete({ where: { id: ctx.pessoa.id } })
  out.vinculoArvore = 1

  return out
}

/**
 * DESATIVAR — o fato fica, a operação sai.
 * Remove só o que é projeção ativa e descartável; marca os vínculos como removidos.
 */
async function executarDesativacao(
  ctx: ContextoPessoa,
  tx: Prisma.TransactionClient,
  input: RemocaoInput,
): Promise<RemoviveisPessoa> {
  const out = vazio()
  const agora = new Date()
  const motivo = input.motivo?.slice(0, 300) ?? null

  // Tarefa ainda não iniciada é fila ativa, não histórico: sai.
  // Tarefa que já andou permanece — como histórico, fora da fila.
  if (ctx.tarefaIds.length) {
    out.tarefas = (await tx.tarefa.deleteMany({
      where: { id: { in: ctx.tarefaIds }, statusTarefa: "NAO_INICIADA", concluida: false },
    })).count
  }
  if (ctx.passoIds.length) {
    out.passos = (await tx.phaseWorkflowStepInstance.deleteMany({
      where: { id: { in: ctx.passoIds }, status: { in: ["PENDENTE", "DISPONIVEL"] } },
    })).count
  }

  // Participante financeiro sai da distribuição ATIVA; a receita e seus fatos ficam.
  if (ctx.participanteIds.length) {
    out.participantesFinanceiros = (await tx.receitaRequerente.deleteMany({
      where: { id: { in: ctx.participanteIds } },
    })).count
  }

  // Vínculo pessoa↔processo: marcado como removido, nunca apagado — é ele que
  // amarra o fato financeiro preservado ao processo.
  if (ctx.requerenteId != null && ctx.processoIds.length) {
    out.vinculoProcesso = (await tx.processoRequerente.updateMany({
      where: { requerenteId: ctx.requerenteId, processoId: { in: ctx.processoIds }, removidoEm: null },
      data: { removidoEm: agora, removidoPorId: input.actorUserId ?? null, motivoRemocao: motivo },
    })).count
  }

  // O nó sai da árvore ATIVA. A linha permanece porque os fatos apontam para ela.
  await tx.pessoa.update({
    where: { id: ctx.pessoa.id },
    data: {
      removidaEm: agora,
      removidaPorId: input.actorUserId ?? null,
      motivoRemocao: motivo,
      requerente: "nao",
    },
  })
  await tx.arvore.updateMany({
    where: { pessoaPrincipalId: ctx.pessoa.id },
    data: { pessoaPrincipalId: null },
  })
  out.vinculoArvore = 1

  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// REINSERÇÃO — criar → excluir → recriar é cenário oficialmente suportado.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reativa o vínculo pessoa↔processo desativado, em vez de criar um segundo.
 * Idempotente: chamada sobre vínculo já ativo é no-op.
 *
 * Não decide identidade por nome, CPF ou rótulo — só por `personId`/`requerenteId`.
 */
export async function reativarVinculoDaPessoa(
  args: { pessoaId: number; processoId: number },
  db: DB = prisma,
): Promise<{ reativado: boolean; requerenteId: number | null }> {
  const requerente = await db.requerente.findFirst({
    where: { personId: args.pessoaId },
    select: { id: true },
  })
  if (!requerente) return { reativado: false, requerenteId: null }

  const r = await db.processoRequerente.updateMany({
    where: { processoId: args.processoId, requerenteId: requerente.id, removidoEm: { not: null } },
    data: { removidoEm: null, removidoPorId: null, motivoRemocao: null },
  })

  await db.pessoa.updateMany({
    where: { id: args.pessoaId, removidaEm: { not: null } },
    data: { removidaEm: null, removidaPorId: null, motivoRemocao: null },
  })

  return { reativado: r.count > 0, requerenteId: requerente.id }
}
