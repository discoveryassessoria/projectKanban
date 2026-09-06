// src/services/necessidade-documental.ts
// CP-3 — service da NecessidadeDocumental (idempotente, dual-read, append-only).
//
// Cadeia: Documento Mestre (ItemCatalogo) -> NecessidadeDocumental ->
// Documento Operacional -> ... Geração idempotente pela Árvore e pela Matriz.
// Sem dual-write: grava só nos models novos. Nada legado é removido.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { montarChaveIdempotencia } from "@/src/services/necessidade-documental-helpers"
import { codeDocumentoMestre } from "@/src/services/catalogo-helpers"
import { transicionarPassoTx } from "@/src/services/task-step-sync"
import { randomUUID } from "crypto"

export { montarChaveIdempotencia, sujeitoValido } from "@/src/services/necessidade-documental-helpers"

type DB = typeof prisma | Prisma.TransactionClient

export interface GarantirNecessidadeInput {
  processoId: number
  itemCatalogoId: number
  pessoaId?: number | null
  uniaoId?: number | null
  varianteKey?: string
  ciclo?: number
  origem?: "ARVORE" | "MATRIZ" | "MANUAL" | "MIGRACAO"
  obrigatoriedade?: "OBRIGATORIA" | "OPCIONAL"
  matrizRegraId?: number | null
  matrizRegraVersao?: number | null
  matrizSnapshot?: Prisma.InputJsonValue | null
  motivoAplicabilidade?: string | null
  arvoreId?: number | null
  ruleCode?: string | null
}

/** Cria a necessidade se não existir (idempotente por chaveIdempotencia). */
export async function garantirNecessidade(input: GarantirNecessidadeInput, db: DB = prisma) {
  const chaveIdempotencia = montarChaveIdempotencia(input) // lança se XOR inválido

  const existente = await db.necessidadeDocumental.findUnique({ where: { chaveIdempotencia } })
  if (existente) return { necessidade: existente, criada: false }

  try {
    const necessidade = await db.necessidadeDocumental.create({
      data: {
        processoId: input.processoId,
        itemCatalogoId: input.itemCatalogoId,
        pessoaId: input.pessoaId ?? null,
        uniaoId: input.uniaoId ?? null,
        varianteKey: input.varianteKey || "padrao",
        ciclo: input.ciclo && input.ciclo > 0 ? input.ciclo : 1,
        chaveIdempotencia,
        origem: input.origem || "MANUAL",
        obrigatoriedade: input.obrigatoriedade || "OBRIGATORIA",
        status: "PENDENTE",
        matrizRegraId: input.matrizRegraId ?? null,
        matrizRegraVersao: input.matrizRegraVersao ?? null,
        matrizSnapshot: input.matrizSnapshot ?? undefined,
        avaliadaEm: input.matrizRegraId != null ? new Date() : null,
        motivoAplicabilidade: input.motivoAplicabilidade ?? null,
        arvoreId: input.arvoreId ?? null,
        ruleCode: input.ruleCode ?? null,
      },
    })
    await db.necessidadeDocumentalEvento.create({
      data: { necessidadeId: necessidade.id, tipo: "CRIADA", dados: { origem: necessidade.origem } },
    })
    return { necessidade, criada: true }
  } catch (e) {
    // Corrida: outra transação criou a mesma chave.
    if ((e as { code?: string })?.code === "P2002") {
      const necessidade = await db.necessidadeDocumental.findUnique({ where: { chaveIdempotencia } })
      if (necessidade) return { necessidade, criada: false }
    }
    throw e
  }
}

/** DUAL-READ: necessidade de um documento (necessidadeId direto ou derivada). */
export async function resolverNecessidadeDeDocumento(
  doc: { necessidadeId?: number | null; pessoaId?: number | null; documentTypeId?: number | null },
  db: DB = prisma
) {
  if (doc.necessidadeId != null) {
    return db.necessidadeDocumental.findUnique({ where: { id: doc.necessidadeId } })
  }
  // Fallback legado: casar por pessoa + itemCatalogo do tipo do documento.
  if (doc.pessoaId != null && doc.documentTypeId != null) {
    const cad = await db.tipoDocumentoCadastro.findUnique({
      where: { id: doc.documentTypeId },
      select: { itemCatalogoId: true },
    })
    if (cad?.itemCatalogoId) {
      const cands = await db.necessidadeDocumental.findMany({
        where: { pessoaId: doc.pessoaId, itemCatalogoId: cad.itemCatalogoId },
        orderBy: { ciclo: "desc" },
        take: 2,
      })
      if (cands.length === 1) return cands[0]
    }
  }
  return null
}

async function evento(
  db: DB,
  necessidadeId: number,
  tipo: "CRIADA" | "EM_ATENDIMENTO" | "ATENDIDA" | "NAO_LOCALIZADA" | "REABERTA" | "DISPENSADA" | "SUPERSEDIDA" | "RETORNO_GENEALOGIA",
  dados?: Prisma.InputJsonValue
) {
  await db.necessidadeDocumentalEvento.create({ data: { necessidadeId, tipo, dados: dados ?? undefined } })
}

/**
 * Documento não localizado: preserva histórico, marca a necessidade.
 *
 * NÃO é dispensa e NÃO libera o gate. Uma necessidade OBRIGATÓRIA marcada como
 * NAO_LOCALIZADA continua bloqueando a fase (`blocking-helpers`), com o hint de
 * retorno controlado ao domínio genealógico. Dispensar é outra decisão, de
 * outra pessoa, por outra porta.
 *
 * `motivo` entra no evento append-only: "não localizado" sem explicação obriga
 * quem vier depois a adivinhar se o cartório não tem, se o cliente não tem, ou
 * se ninguém procurou.
 */
export async function marcarNaoLocalizada(necessidadeId: number, db: DB = prisma, motivo?: string | null) {
  const n = await db.necessidadeDocumental.update({
    where: { id: necessidadeId },
    data: { status: "NAO_LOCALIZADA" },
  })
  await evento(db, necessidadeId, "NAO_LOCALIZADA", motivo ? { motivo } : undefined)
  return n
}

/** Retorno controlado à Genealogia (append-only; não apaga histórico). */
export async function retornoGenealogia(necessidadeId: number, motivo?: string, db: DB = prisma) {
  await evento(db, necessidadeId, "RETORNO_GENEALOGIA", motivo ? { motivo } : undefined)
  return db.necessidadeDocumental.findUnique({ where: { id: necessidadeId } })
}

/**
 * Reabre: cria uma NOVA necessidade (ciclo+1, nova chave) e preserva a anterior
 * marcando-a como superseded. Histórico append-only.
 */
export async function reabrir(necessidadeId: number, db: DB = prisma) {
  const atual = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId } })
  if (!atual) throw new Error(`Necessidade ${necessidadeId} não encontrada`)

  const { necessidade: nova } = await garantirNecessidade(
    {
      processoId: atual.processoId,
      itemCatalogoId: atual.itemCatalogoId,
      pessoaId: atual.pessoaId,
      uniaoId: atual.uniaoId,
      varianteKey: atual.varianteKey,
      ciclo: atual.ciclo + 1,
      origem: atual.origem,
      obrigatoriedade: atual.obrigatoriedade,
      matrizRegraId: atual.matrizRegraId,
      matrizRegraVersao: atual.matrizRegraVersao,
      arvoreId: atual.arvoreId,
      ruleCode: atual.ruleCode,
    },
    db
  )

  await db.necessidadeDocumental.update({ where: { id: atual.id }, data: { supersedePorId: nova.id } })
  await evento(db, atual.id, "REABERTA", { novaId: nova.id, ciclo: nova.ciclo })
  await evento(db, atual.id, "SUPERSEDIDA", { novaId: nova.id })
  return nova
}

// ============================================================
// CICLO DE VIDA CANÔNICO da NecessidadeDocumental (serviço ÚNICO do domínio)
// ------------------------------------------------------------
// Estados: PENDENTE → EM_ATENDIMENTO → ATENDIDA. DISPENSADA e NAO_LOCALIZADA são
// desvios explícitos. A evolução ocorre EXCLUSIVAMENTE por aqui (nenhum componente
// escreve o status direto) e é disparada por EVENTOS do Workflow (conclusão/início do
// passo operacional vinculado à necessidade), nunca por cálculo de tela. Idempotente,
// append-only (emite NecessidadeDocumentalEvento), sem regressão silenciosa.
// ============================================================

const passoConcluido = (statusPasso: string) => /^(CONCLUIDO|DISPENSADO|SUPERSEDIDO)$/i.test(statusPasso) || /conclu|finaliz/i.test(statusPasso)
const passoAtivo = (statusPasso: string) => /^(EM_ANDAMENTO|DISPONIVEL|AGUARDANDO)$/i.test(statusPasso) || /andamento|execu/i.test(statusPasso)

/** PENDENTE → EM_ATENDIMENTO (só a partir de PENDENTE; idempotente). */
export async function iniciarAtendimentoNecessidade(necessidadeId: number, db: DB = prisma) {
  const n = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { status: true } })
  if (!n || n.status !== "PENDENTE") return
  await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { status: "EM_ATENDIMENTO" } })
  await evento(db, necessidadeId, "EM_ATENDIMENTO")
}

/** → ATENDIDA (de PENDENTE/EM_ATENDIMENTO; DISPENSADA não é sobrescrita por passo). */
export async function atenderNecessidade(necessidadeId: number, db: DB = prisma) {
  const n = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { status: true } })
  if (!n || n.status === "ATENDIDA" || n.status === "DISPENSADA") return
  await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { status: "ATENDIDA" } })
  await evento(db, necessidadeId, "ATENDIDA")
}

/** → DISPENSADA (requisito deixou de ser exigido). Idempotente. */
export async function dispensarNecessidade(necessidadeId: number, motivo?: string, db: DB = prisma, manual = false) {
  const n = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { status: true, dispensaManual: true } })
  if (!n) return
  if (n.status === "DISPENSADA") {
    // Já dispensada — se a chamada é MANUAL e ela ainda não carrega a marca, sobe a
    // marca agora (dispensa que era automática vira sticky por decisão de operador).
    if (manual && !n.dispensaManual) {
      await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { dispensaManual: true } })
    }
    return
  }
  await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { status: "DISPENSADA", dispensaManual: manual } })
  await evento(db, necessidadeId, "DISPENSADA", motivo ? { motivo } : undefined)

  // A NECESSIDADE E A ETAPA SÃO DUAS LINHAS — dispensar só a necessidade deixava a
  // etapa operacional ("Localizar registro da certidão") viva, contando pendente na
  // tabela por pessoa mesmo depois de a pessoa deixar de precisar do documento
  // (achado real: pessoa marcada "fora da linha reta" continuava com o documento
  // pendente na Central Operacional). Cancela pelo motor canônico — mesma
  // transição usada em qualquer cancelamento de etapa — nunca um update direto.
  const passosAtivos = await db.phaseWorkflowStepInstance.findMany({
    where: { necessidadeId, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO", "DISPENSADO"] } },
    select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true },
  })
  if (passosAtivos.length) {
    const correlationId = randomUUID()
    for (const p of passosAtivos) {
      await transicionarPassoTx(db as Prisma.TransactionClient, p.id, "CANCELADO", {
        correlationId, operacao: "necessidade-dispensada", ciclo: p.ciclo,
        processoId: p.processoId, workflowInstanceId: p.workflowInstanceId,
        extra: { cancelledAt: new Date(), motivo: motivo ?? "Necessidade dispensada" },
      })
    }
  }

  // NÃO SE APLICA NA GENEALOGIA ⇒ NÃO SE APLICA EM NENHUMA FASE. A etapa é da
  // fase que materializou (acima); o Documento é da OBRIGAÇÃO inteira, e outras
  // fases (Emissão Documental, Análise, ...) leem o Documento direto — nunca
  // consultam o status da necessidade. Sem isto, dispensar em Genealogia
  // cancelava a etapa de lá e a necessidade, mas o Documento ficava PENDENTE
  // pra sempre, e a próxima fase o lia como pendência real, achando que a
  // pessoa ainda precisava do documento que a Genealogia já disse que não
  // precisa (achado real: Edithe, processo "Teste", reaparecia em Emissão
  // Documental depois de dispensada em Genealogia).
  const docsParaCancelar = await db.documento.findMany({
    where: { necessidadeId, status: { notIn: ["ENTREGUE", "INVALIDO", "CANCELADO"] } },
    select: { id: true },
  })
  if (docsParaCancelar.length === 0) return
  const documentoIds = docsParaCancelar.map((d) => d.id)
  await db.documento.updateMany({
    where: { id: { in: documentoIds } },
    data: { status: "CANCELADO", motivoBloqueio: MOTIVO_DOCUMENTO_DISPENSADO, ultimaMovimentacao: new Date() },
  })

  // REGRA DO SISTEMA, NÃO CONSERTO PONTUAL: um Documento CANCELADO nunca tem
  // passo ativo em NENHUMA fase — não só na fase que o cancelou. Achado real:
  // outras fases (Emissão Documental) já tinham materializado os PRÓPRIOS passos
  // pra este documento (solicitar/aguardar/receber/conferir/validar certidão,
  // ligados por documentoId, sem necessidadeId) ANTES desta dispensa — o
  // materializador delas já exclui CANCELADO ao decidir o que criar
  // (carregarContextoEscopo, phase-workflow.ts), mas isso só evita passo NOVO;
  // não cancela o que outra fase já tinha criado enquanto o documento ainda
  // valia. Cancela pelo motor canônico, todas as fases, de uma vez.
  const passosDeOutrasFases = await db.phaseWorkflowStepInstance.findMany({
    where: { documentoId: { in: documentoIds }, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO", "DISPENSADO"] } },
    select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true },
  })
  if (passosDeOutrasFases.length) {
    const correlationId = randomUUID()
    for (const p of passosDeOutrasFases) {
      await transicionarPassoTx(db as Prisma.TransactionClient, p.id, "CANCELADO", {
        correlationId, operacao: "documento-cancelado-por-dispensa", ciclo: p.ciclo,
        processoId: p.processoId, workflowInstanceId: p.workflowInstanceId,
        extra: { cancelledAt: new Date(), motivo: MOTIVO_DOCUMENTO_DISPENSADO },
      })
    }
  }
}

const MOTIVO_DOCUMENTO_DISPENSADO = "Necessidade dispensada — não se aplica em nenhuma fase"

/** Reativa uma necessidade DISPENSADA (voltou a ser aplicável) → PENDENTE. */
export async function reativarNecessidade(necessidadeId: number, db: DB = prisma) {
  const n = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { status: true } })
  if (!n || n.status !== "DISPENSADA") return
  await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { status: "PENDENTE" } })
  await evento(db, necessidadeId, "CRIADA", { reativada: true })

  // Espelho da dispensa: só reabre o Documento que ESTE serviço cancelou por
  // "não se aplica" (motivo próprio) — nunca um documento que um operador
  // invalidou por outro motivo real (documento errado, ilegível). A regra
  // voltou a valer; a decisão humana sobre um documento específico não se
  // desfaz sozinha.
  await db.documento.updateMany({
    where: { necessidadeId, status: "CANCELADO", motivoBloqueio: MOTIVO_DOCUMENTO_DISPENSADO },
    data: { status: "PENDENTE", motivoBloqueio: null, ultimaMovimentacao: new Date() },
  })
}

/**
 * DRIVER OFICIAL — evolui a necessidade a partir do estado do PASSO operacional vinculado.
 * Chamado pelo fluxo do Workflow (ex.: atualizarPassoV2). Escopo NECESSIDADE:
 *   passo concluído → ATENDIDA; passo ativo → EM_ATENDIMENTO. Sem exceção por fase.
 */
export async function evoluirNecessidadePorPasso(necessidadeId: number, statusPasso: string, db: DB = prisma) {
  if (passoConcluido(statusPasso)) return atenderNecessidade(necessidadeId, db)
  if (passoAtivo(statusPasso)) return iniciarAtendimentoNecessidade(necessidadeId, db)
}

/**
 * REGRESSÃO por REABERTURA de passo (P3): a necessidade cuja condição dependia do passo
 * reaberto DEIXA de estar concluída → ATENDIDA/NAO_LOCALIZADA volta a EM_ATENDIMENTO. A
 * conclusão anterior PERMANECE no histórico (eventos append-only). Idempotente.
 */
export async function reabrirAtendimentoNecessidade(necessidadeId: number, db: DB = prisma) {
  const n = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { status: true } })
  if (!n || (n.status !== "ATENDIDA" && n.status !== "NAO_LOCALIZADA")) return
  await db.necessidadeDocumental.update({ where: { id: necessidadeId }, data: { status: "EM_ATENDIMENTO" } })
  await evento(db, necessidadeId, "REABERTA", { origem: "reabertura_passo" })
}

/**
 * RECONCILIAÇÃO (compatibilidade, idempotente, append-only, NÃO destrutiva): evolui as
 * necessidades cujo passo operacional já está CONCLUIDO mas cujo status ficou defasado em
 * PENDENTE/EM_ATENDIMENTO — trazendo o estado oficial ao mesmo ponto do fluxo de eventos.
 * Preserva histórico (só emite eventos + atualiza status pelo serviço). Reprocessar é seguro.
 */
export async function reconciliarNecessidadesPorPassos(
  filtro: { processoId?: number } = {},
  db: DB = prisma,
): Promise<{ atendidas: number; avaliadas: number }> {
  const steps = await db.phaseWorkflowStepInstance.findMany({
    where: { necessidadeId: { not: null }, status: "CONCLUIDO", ...(filtro.processoId ? { processoId: filtro.processoId } : {}) },
    select: { necessidadeId: true },
  })
  const necIds = [...new Set(steps.map((s) => s.necessidadeId).filter((x): x is number => x != null))]
  let atendidas = 0
  for (const id of necIds) {
    const n = await db.necessidadeDocumental.findUnique({ where: { id }, select: { status: true } })
    if (n && n.status !== "ATENDIDA" && n.status !== "DISPENSADA") {
      await atenderNecessidade(id, db)
      atendidas++
    }
  }
  return { atendidas, avaliadas: necIds.length }
}

// ============================================================
// Geração idempotente — ÁRVORE e MATRIZ
// ============================================================

async function resolverItemCatalogoDeEnum(enumValue: string, db: DB): Promise<number | null> {
  const cad = await db.tipoDocumentoCadastro.findUnique({
    where: { legacyEnumKey: enumValue },
    select: { itemCatalogoId: true },
  })
  if (cad?.itemCatalogoId) return cad.itemCatalogoId
  const item = await db.itemCatalogo.findUnique({ where: { code: codeDocumentoMestre(enumValue) }, select: { id: true } })
  return item?.id ?? null
}

async function resolverItemCatalogoDeCode(code: string, db: DB): Promise<number | null> {
  const cad = await db.tipoDocumentoCadastro.findFirst({
    where: { code },
    select: { itemCatalogoId: true },
  })
  if (cad?.itemCatalogoId) return cad.itemCatalogoId
  const item = await db.itemCatalogo.findUnique({ where: { code }, select: { id: true } })
  return item?.id ?? null
}

async function resolverUniaoUnica(pessoaId: number, db: DB): Promise<number | null> {
  const unioes = await db.uniao.findMany({
    where: { OR: [{ pessoa1Id: pessoaId }, { pessoa2Id: pessoaId }] },
    select: { id: true },
  })
  return unioes.length === 1 ? unioes[0].id : null
}

// MOTORES LEGADOS ELIMINADOS (não desativados).
//
// `garantirNecessidadesArvoreDoProcesso` (regras hardcoded em DOCUMENT_RULES) e
// `garantirNecessidadesDaMatriz` (matriz sem filtro de PUBLICADA e sem avaliar
// condição) criavam NecessidadeDocumental por fora do motor oficial, cada um com
// seu `varianteKey`. Como a chave de idempotência inclui a variante, a mesma
// obrigação nascia duas vezes — uma por motor — e aparecia duplicada na Central.
//
// Existe UM materializador: materializarExecucaoDaFase → materializarGenealogia,
// sobre as Regras Documentais PUBLICADAS.


/**
 * Remove as necessidades de uma pessoa (e das uniões dela) ao EXCLUIR a pessoa.
 *
 * Não é materialização nem transição de estado: é a cascata da exclusão do
 * sujeito. Vive aqui porque `NecessidadeDocumental` tem UM dono de escrita — se
 * cada rota apagasse por conta própria, o guard arquitetural viraria letra morta
 * e a próxima escrita direta entraria sem ninguém notar.
 *
 * Apaga os passos vinculados antes: a necessidade é reproduzível pela
 * materialização, o passo órfão não.
 */
export async function removerNecessidadesDoSujeito(
  args: { pessoaId: number; uniaoIds?: number[] },
  db: DB = prisma,
): Promise<{ necessidades: number; passos: number }> {
  const uniaoIds = args.uniaoIds ?? []
  const alvos = await db.necessidadeDocumental.findMany({
    where: { OR: [{ pessoaId: args.pessoaId }, ...(uniaoIds.length ? [{ uniaoId: { in: uniaoIds } }] : [])] },
    select: { id: true },
  })
  if (alvos.length === 0) return { necessidades: 0, passos: 0 }
  const ids = alvos.map((n) => n.id)
  const passos = await db.phaseWorkflowStepInstance.deleteMany({ where: { necessidadeId: { in: ids } } })
  const necessidades = await db.necessidadeDocumental.deleteMany({ where: { id: { in: ids } } })
  return { necessidades: necessidades.count, passos: passos.count }
}
