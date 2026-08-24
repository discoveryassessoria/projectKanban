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

export interface DadosDoProtocolo {
  processoId: number
  numeroProtocolo: string
  dataProtocolo: Date
  origem: OrigemDeProtocolo
  orgaoId?: number | null
  responsavelId?: number | null
  observacoes?: string | null
  solicitacaoId?: number | null
  /** Classificação do ato, quando o caminho de origem a conhece. */
  tipoProtocolo?: unknown
  formaEnvio?: unknown
  contratanteId?: number | null
  requerenteId?: number | null
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
      ...(dados.formaEnvio != null ? { formaEnvio: dados.formaEnvio as never } : {}),
      contratanteId: dados.contratanteId ?? null,
      requerenteId: dados.requerenteId ?? null,
      setor: dados.setor ?? null,
    },
    select: { id: true },
  })).id

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
