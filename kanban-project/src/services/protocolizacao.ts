// src/services/protocolizacao.ts
//
// PROTOCOLIZAÇÃO — ato operacional registrado DENTRO do processo.
//
// Não existe cadastro mestre de protocolos: o registro nasce no processo, com
// órgão, setor, data/hora, número, tipo, forma de envio, responsável,
// comprovante, observações e documentos enviados. Toda protocolização alimenta
// a ÚNICA fonte cronológica oficial — a Timeline/Histórico do Processo:
//   • Evento do processo (tipo PROTOCOLO) → Timeline/agenda;
//   • LogAuditoria (entidade PROCESSO)    → Histórico/Diário Operacional.
//
// Tudo dentro da MESMA transação do registro: ou o protocolo e sua marca
// cronológica existem juntos, ou nenhum dos dois existe.
import type { Prisma, PrismaClient, TipoProtocolo, FormaEnvioProtocolo } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/** Rótulos oficiais — fonte única para a UI, a Timeline e o Histórico. */
export const TIPO_PROTOCOLO_LABEL: Record<TipoProtocolo, string> = {
  CONSULAR: "Consular",
  JUDICIAL: "Judicial",
  ADMINISTRATIVO: "Administrativo",
  COMUNE: "Comune",
  CARTORIO: "Cartório",
  TRIBUNAL: "Tribunal",
  OUTRO: "Outro",
}

export const FORMA_ENVIO_LABEL: Record<FormaEnvioProtocolo, string> = {
  PRESENCIAL: "Presencial",
  CORREIO: "Correio",
  EMAIL: "E-mail",
  PORTAL_ONLINE: "Portal online",
  TERCEIRO: "Terceiro / despachante",
}

export const TIPOS_PROTOCOLO = Object.entries(TIPO_PROTOCOLO_LABEL).map(([valor, label]) => ({ valor, label }))
export const FORMAS_ENVIO = Object.entries(FORMA_ENVIO_LABEL).map(([valor, label]) => ({ valor, label }))

/** Dados de uma protocolização, do jeito que a tela do processo envia. */
export interface DadosProtocolizacao {
  orgaoId?: number | null
  setor?: string | null
  dataProtocolo?: Date | null
  numeroProtocolo?: string | null
  tipoProtocolo?: TipoProtocolo | null
  formaEnvio?: FormaEnvioProtocolo | null
  responsavelId?: number | null
  observacoes?: string | null
  documentoIds?: number[]
}

/** Título humano do ato — usado no Evento e no Histórico. */
export function descreverProtocolizacao(p: {
  numeroProtocolo?: string | null
  tipoProtocolo?: TipoProtocolo | null
  orgaoNome?: string | null
}): string {
  const tipo = p.tipoProtocolo ? TIPO_PROTOCOLO_LABEL[p.tipoProtocolo] : null
  const partes = [
    `Protocolo${tipo ? ` ${tipo.toLowerCase()}` : ""}`,
    p.numeroProtocolo ? `nº ${p.numeroProtocolo}` : null,
    p.orgaoNome ? `— ${p.orgaoNome}` : null,
  ].filter(Boolean)
  return partes.join(" ")
}

/**
 * Registra o ato na única fonte cronológica: Evento (Timeline) + LogAuditoria
 * (Histórico). Chamado SEMPRE dentro da transação que grava o protocolo.
 */
export async function registrarNaTimelineTx(
  tx: Tx,
  args: {
    acao: "PROTOCOLO_REGISTRADO" | "PROTOCOLO_ATUALIZADO" | "PROTOCOLO_EXCLUIDO"
    processoId: number
    protocoloId: number
    titulo: string
    quando: Date
    usuarioId?: number | null
    responsavelId?: number | null
    detalhes?: Prisma.InputJsonValue
    /** só o registro do ato cria Evento de agenda; edição/exclusão só historiam */
    criarEvento?: boolean
  },
): Promise<void> {
  if (args.criarEvento) {
    await tx.evento.create({
      data: {
        processoId: args.processoId,
        titulo: args.titulo,
        descricao: "Protocolização registrada no processo.",
        tipo: "PROTOCOLO",
        dataInicio: args.quando,
        diaInteiro: false,
        status: "CONFIRMADO",
        responsavelId: args.responsavelId ?? null,
      },
    })
  }

  await tx.logAuditoria.create({
    data: {
      acao: args.acao,
      entidade: "PROCESSO",
      entidadeId: args.processoId,
      descricao: args.titulo,
      detalhes: args.detalhes ?? { protocoloId: args.protocoloId },
      usuarioId: args.usuarioId ?? null,
    },
  })
}

/** include padrão de leitura — a tela do processo consome esta forma. */
export const INCLUDE_PROTOCOLO = {
  contratante: { select: { id: true, publicCode: true, nome: true, email: true, telefone: true } },
  requerente: { select: { id: true, publicCode: true, nome: true, email: true, telefone: true } },
  orgao: { select: { id: true, name: true, type: true, city: true } },
  responsavel: { select: { id: true, nome: true } },
  anexos: true,
  documentos: {
    include: {
      documento: {
        select: {
          id: true, publicCode: true, tipo: true, descricao: true, status: true,
          pessoa: { select: { id: true, nome: true } },
        },
      },
    },
  },
} satisfies Prisma.ProtocoloInclude
