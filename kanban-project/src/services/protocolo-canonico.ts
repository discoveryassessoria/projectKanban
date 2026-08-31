// src/services/protocolo-canonico.ts
//
// A ÚNICA PORTA que escreve `Protocolo`.
//
// ─── O QUE ESTAVA ACONTECENDO ───────────────────────────────────────────────
// O protocolo é um fato com dono: `Protocolo` guarda número, data, órgão,
// responsável, comprovantes e o vínculo com os documentos. Ao lado dele, a execução
// declarativa começou a guardar `numero_protocolo` e `data_protocolo` dentro do
// payload. Dois lugares afirmando o mesmo fato, os dois editáveis, divergindo no
// primeiro dia em que alguém corrigisse um só — e sem ninguém para dizer qual está
// certo.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────
// PROTOCOLO É O DONO DO FATO "PROTOCOLO". A execução guarda o `protocoloId` e mais
// nada; quem quer o número lê daqui.
//
// ─── IDEMPOTÊNCIA ───────────────────────────────────────────────────────────
// Mesmo processo, mesmo número, mesma origem = mesmo protocolo. Um retry de HTTP, um
// duplo-clique ou uma reexecução do mesmo comando encontram o que já existe em vez de
// criar o segundo. Não é otimização: sem isso, protocolar duas vezes produziria dois
// fatos onde houve um.

import { Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"

export const ORIGENS_DE_PROTOCOLO = {
  /** Protocolização do dossiê no órgão, pelas telas do processo. */
  PROCESSO: "PROCESSO",
  /** Número devolvido ao solicitar uma certidão. */
  SOLICITACAO_DOCUMENTO: "SOLICITACAO_DOCUMENTO",
  /** Registrado por uma etapa do workflow interno, pelo efeito declarativo. */
  ETAPA: "ETAPA",
} as const
export type OrigemDeProtocolo = (typeof ORIGENS_DE_PROTOCOLO)[keyof typeof ORIGENS_DE_PROTOCOLO]

/**
 * PARA QUE o ato serve. Catálogo FECHADO, espelhado no CHECK do banco.
 *
 * `tipoProtocolo` diz ONDE (consular, judicial, comune). `origem` diz QUEM criou
 * (tela do processo, solicitação de certidão, etapa do workflow). Faltava o para
 * quê: sem ele, um relatório do tribunal de Veneza mistura o ricorso de cidadania
 * com o protocolo de uma retificação — dois fatos que não se somam.
 */
export const FINALIDADES_DE_PROTOCOLO = {
  /** O PEDIDO em si: a cidadania requerida. É este que carrega numeroProcesso. */
  REQUERIMENTO: "REQUERIMENTO",
  /** Retificação de registro (judicial ou administrativa). */
  RETIFICACAO: "RETIFICACAO",
  /** Solicitação de certidão a um órgão emissor. */
  CERTIDAO: "CERTIDAO",
  /** Resposta a uma exigência do órgão. */
  COMPLEMENTACAO: "COMPLEMENTACAO",
  /** Recurso contra decisão. */
  RECURSO: "RECURSO",
  OUTRO: "OUTRO",
} as const
export type FinalidadeDeProtocolo = (typeof FINALIDADES_DE_PROTOCOLO)[keyof typeof FINALIDADES_DE_PROTOCOLO]

/**
 * O QUE O ÓRGÃO RESPONDEU. Não é fase do nosso workflow — o motor sabe em que
 * etapa NÓS estamos; só o órgão sabe se deferiu, exigiu ou arquivou. Misturar as
 * duas coisas foi o que produziu, em outros domínios, workflow escrito duas vezes.
 */
export const SITUACOES_DE_PROTOCOLO = {
  PROTOCOLADO: "PROTOCOLADO",
  EM_ANALISE: "EM_ANALISE",
  EXIGENCIA: "EXIGENCIA",
  DEFERIDO: "DEFERIDO",
  INDEFERIDO: "INDEFERIDO",
  ARQUIVADO: "ARQUIVADO",
} as const
export type SituacaoDeProtocolo = (typeof SITUACOES_DE_PROTOCOLO)[keyof typeof SITUACOES_DE_PROTOCOLO]

/**
 * Quantos requerentes cabem em UM requerimento. Vem do CADASTRO (Modalidade
 * Legal), nunca do país: é a base jurídica que decide.
 *
 *   INDIVIDUAL — Espanha/LMD, via consular: um expediente por pessoa, no
 *                consulado do domicílio dela.
 *   COLETIVO   — Itália, via judicial: um ricorso, um R.G., a família inteira.
 */
export const CARDINALIDADES = { INDIVIDUAL: "INDIVIDUAL", COLETIVO: "COLETIVO" } as const
export type Cardinalidade = (typeof CARDINALIDADES)[keyof typeof CARDINALIDADES]

export interface DadosDoProtocolo {
  processoId: number
  numeroProtocolo: string
  dataProtocolo: Date
  origem: OrigemDeProtocolo
  orgaoId?: number | null
  responsavelId?: number | null
  observacoes?: string | null
  solicitacaoId?: number | null
  /** Classificação do ato pelo CADASTRO (Tipos de Protocolo). */
  tipoProtocoloId?: number | null
  /** @deprecated Enum legado; sai na migration de remoção. */
  tipoProtocolo?: unknown
  formaEnvio?: unknown
  contratanteId?: number | null
  /**
   * ESCOPO — quais requerentes este ato cobre. FONTE ÚNICA.
   *
   * Espanha manda um; Itália manda a família. O serviço não pergunta o país: ele
   * lê a cardinalidade da Modalidade Legal do processo e recusa o que não bate.
   */
  requerenteIds?: number[]
  /** @deprecated Escopo mora em `requerenteIds`. Mantido só até a migration de remoção. */
  requerenteId?: number | null
  /** Número que o ÓRGÃO deu ao dossiê (ruolo generale / expediente). */
  numeroProcesso?: string | null
  finalidade?: FinalidadeDeProtocolo
  situacao?: SituacaoDeProtocolo
  situacaoEm?: Date | null
  setor?: string | null
  /** Documentos que este protocolo cobre — vínculo canônico, não cópia. */
  documentoIds?: number[]
}

export interface ProtocoloRegistrado {
  protocoloId: number
  /** `true` quando o protocolo já existia e foi reaproveitado. */
  jaExistia: boolean
}

/**
 * Cria ou reaproveita o protocolo canônico. Recebe a transação porque protocolar
 * acontece junto do que o motivou — a etapa que fecha, a solicitação que sai.
 */
export async function registrarProtocoloTx(
  tx: Prisma.TransactionClient, dados: DadosDoProtocolo,
): Promise<ProtocoloRegistrado> {
  const numero = dados.numeroProtocolo.trim()
  if (numero === "") throw new Error("PROTOCOLO_SEM_NUMERO")

  const finalidade = dados.finalidade ?? FINALIDADES_DE_PROTOCOLO.REQUERIMENTO
  // O escopo aceita a forma antiga (um id) enquanto a coluna existir, mas a
  // VERDADE gravada é sempre a lista — uma fonte só, desde já.
  const escopo = [...new Set(
    (dados.requerenteIds ?? (dados.requerenteId != null ? [dados.requerenteId] : [])).filter((n) => Number.isInteger(n)),
  )]

  if (escopo.length > 0) await validarEscopo(tx, dados.processoId, escopo, finalidade)

  // A CHAVE DA IDEMPOTÊNCIA. Inclui a origem porque o mesmo número pode chegar por
  // dois caminhos legítimos — o dossiê protocolado e a certidão solicitada — e são
  // fatos diferentes.
  const existente = await tx.protocolo.findFirst({
    where: {
      processoId: dados.processoId, numeroProtocolo: numero, origem: dados.origem,
      ...(dados.solicitacaoId != null ? { solicitacaoId: dados.solicitacaoId } : {}),
    },
    select: { id: true },
  })

  const id = existente?.id ?? (await tx.protocolo.create({
    data: {
      processoId: dados.processoId,
      numeroProtocolo: numero,
      dataProtocolo: dados.dataProtocolo,
      origem: dados.origem,
      orgaoId: dados.orgaoId ?? null,
      responsavelId: dados.responsavelId ?? null,
      observacoes: dados.observacoes ?? null,
      solicitacaoId: dados.solicitacaoId ?? null,
      ...(dados.tipoProtocolo != null ? { tipoProtocolo: dados.tipoProtocolo as never } : {}),
      ...(dados.tipoProtocoloId != null ? { tipoProtocoloId: dados.tipoProtocoloId } : {}),
      ...(dados.formaEnvio != null ? { formaEnvio: dados.formaEnvio as never } : {}),
      contratanteId: dados.contratanteId ?? null,
      requerenteId: escopo.length === 1 ? escopo[0] : null,
      numeroProcesso: dados.numeroProcesso?.trim() || null,
      finalidade,
      ...(dados.situacao != null ? { situacao: dados.situacao } : {}),
      situacaoEm: dados.situacaoEm ?? null,
      setor: dados.setor ?? null,
    },
    select: { id: true },
  })).id

  // O ESCOPO. `createMany` com skipDuplicates torna o reenvio inofensivo; o
  // trigger do banco continua sendo quem recusa o requerimento em duplicidade.
  if (escopo.length > 0) {
    await tx.protocoloRequerente.createMany({
      data: escopo.map((requerenteId) => ({ protocoloId: id, requerenteId })),
      skipDuplicates: true,
    })
  }

  // O VÍNCULO COM O DOCUMENTO é a junção que já existia. Um protocolo pode cobrir
  // vários documentos, e é por isso que ele não é uma coluna no documento.
  for (const documentoId of dados.documentoIds ?? []) {
    await tx.protocoloDocumento.upsert({
      where: { protocoloId_documentoId: { protocoloId: id, documentoId } },
      create: { protocoloId: id, documentoId },
      update: {},
    })
  }

  return { protocoloId: id, jaExistia: !!existente }
}

/**
 * A REGRA DE ESCOPO, num lugar só.
 *
 * Duas coisas que um FK sozinho não garante:
 *
 *  1. O requerente PERTENCE ao processo. `requerenteId` aponta para a tabela de
 *     clientes inteira — sem esta checagem, o protocolo do processo 10 aceitaria
 *     o requerente do processo 20 e o relatório por família ficaria errado sem
 *     ninguém perceber.
 *  2. A CONTAGEM bate com a cardinalidade da rota. Espanha consular é um
 *     expediente por pessoa; Itália judicial é um ricorso para a família. A regra
 *     vem do cadastro (Modalidade Legal), então uma rota nova declara a sua sem
 *     tocar em código — e não existe `if (pais === "Itália")` em lugar nenhum.
 */
async function validarEscopo(
  tx: Prisma.TransactionClient, processoId: number, escopo: number[], finalidade: string,
): Promise<void> {
  const doProcesso = await tx.processoRequerente.findMany({
    where: { processoId, requerenteId: { in: escopo } },
    select: { requerenteId: true },
  })
  const conhecidos = new Set(doProcesso.map((r) => r.requerenteId))
  const intrusos = escopo.filter((id) => !conhecidos.has(id))
  if (intrusos.length > 0) {
    throw new Error(`REQUERENTE_FORA_DO_PROCESSO: ${intrusos.join(", ")}`)
  }

  // Só o REQUERIMENTO tem cardinalidade: retificação, certidão e complementação
  // são atos avulsos e podem cobrir quem a operação precisar.
  if (finalidade !== FINALIDADES_DE_PROTOCOLO.REQUERIMENTO) return

  const cardinalidade = await cardinalidadeDoProcesso(tx, processoId)
  if (cardinalidade === CARDINALIDADES.INDIVIDUAL && escopo.length !== 1) {
    throw new Error(`REQUERIMENTO_INDIVIDUAL_ACEITA_UM_REQUERENTE: recebidos ${escopo.length}`)
  }
}

/**
 * A cardinalidade da rota do processo: enquadramento → modalidade legal.
 *
 * Sem enquadramento declarado o sistema NÃO CHUTA: cai em INDIVIDUAL, que é a
 * regra mais restritiva. Preferir a restritiva é deliberado — um requerimento
 * coletivo criado por engano espalha o erro por N pessoas de uma vez.
 */
export async function cardinalidadeDoProcesso(
  tx: Prisma.TransactionClient, processoId: number,
): Promise<Cardinalidade> {
  const p = await tx.processo.findUnique({
    where: { id: processoId },
    select: { enquadramentoLegal: { select: { modalidadeLegal: { select: { cardinalidadeRequerimento: true } } } } },
  })
  const declarada = p?.enquadramentoLegal?.modalidadeLegal?.cardinalidadeRequerimento
  return declarada === CARDINALIDADES.COLETIVO ? CARDINALIDADES.COLETIVO : CARDINALIDADES.INDIVIDUAL
}

/** Fora de transação, para quem só precisa registrar. */
export async function registrarProtocolo(dados: DadosDoProtocolo): Promise<ProtocoloRegistrado> {
  return prisma.$transaction((tx) => registrarProtocoloTx(tx, dados))
}

/** O protocolo de uma tentativa, resolvido do dono — nunca do payload. */
export async function protocoloDaTentativa(stepExecutionId: number) {
  const t = await prisma.stepExecution.findUnique({
    where: { id: stepExecutionId },
    select: {
      protocolo: {
        select: {
          id: true, numeroProtocolo: true, dataProtocolo: true, observacoes: true, origem: true,
          orgao: { select: { id: true, name: true, nomeFantasia: true, ativo: true } },
          responsavel: { select: { id: true, nome: true } },
        },
      },
    },
  })
  return t?.protocolo ?? null
}
