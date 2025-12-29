// lib/auditoria.ts

import { prisma } from "@/lib/prisma"

type TipoAcao = "criou" | "editou" | "excluiu" | "moveu" | "concluiu" | "reabriu"
type Entidade = "PROCESSO" | "TAREFA" | "CONTRATANTE" | "REQUERENTE" | "PESSOA" | "DOCUMENTO" | "PROTOCOLO"

interface RegistrarLogParams {
  acao: TipoAcao
  entidade: Entidade
  entidadeId?: number | null
  descricao: string
  detalhes?: Record<string, any>
  usuarioId?: number | null
}

/**
 * Registra uma ação no log de auditoria
 */
export async function registrarLog({
  acao,
  entidade,
  entidadeId,
  descricao,
  detalhes,
  usuarioId
}: RegistrarLogParams) {
  try {
    return await prisma.logAuditoria.create({
      data: {
        acao,
        entidade,
        entidadeId: entidadeId ?? null,
        descricao,
        detalhes: detalhes || undefined,
        usuarioId: usuarioId ?? null
      }
    })
  } catch (error) {
    // Não quebrar a operação principal se o log falhar
    console.error("Erro ao registrar log:", error)
    return null
  }
}

// ============================================
// HELPERS PARA PROCESSOS
// ============================================
export const logProcesso = {
  criar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "criou",
      entidade: "PROCESSO",
      entidadeId: id,
      descricao: `Processo "${nome}" foi criado`,
      usuarioId
    }),

  editar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "editou",
      entidade: "PROCESSO",
      entidadeId: id,
      descricao: `Processo "${nome}" foi editado`,
      usuarioId
    }),

  excluir: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "excluiu",
      entidade: "PROCESSO",
      entidadeId: id,
      descricao: `Processo "${nome}" foi excluído`,
      usuarioId
    }),

  mover: (nome: string, id: number, statusAnterior: string, statusNovo: string, usuarioId?: number) =>
    registrarLog({
      acao: "moveu",
      entidade: "PROCESSO",
      entidadeId: id,
      descricao: `Processo "${nome}" movido de "${statusAnterior}" para "${statusNovo}"`,
      detalhes: { statusAnterior, statusNovo },
      usuarioId
    }),
}

// ============================================
// HELPERS PARA TAREFAS
// ============================================
export const logTarefa = {
  criar: (titulo: string, id: number, processoNome?: string, usuarioId?: number) =>
    registrarLog({
      acao: "criou",
      entidade: "TAREFA",
      entidadeId: id,
      descricao: processoNome 
        ? `Tarefa "${titulo}" criada em "${processoNome}"`
        : `Tarefa "${titulo}" foi criada`,
      usuarioId
    }),

  editar: (titulo: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "editou",
      entidade: "TAREFA",
      entidadeId: id,
      descricao: `Tarefa "${titulo}" foi editada`,
      usuarioId
    }),

  excluir: (titulo: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "excluiu",
      entidade: "TAREFA",
      entidadeId: id,
      descricao: `Tarefa "${titulo}" foi excluída`,
      usuarioId
    }),

  concluir: (titulo: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "concluiu",
      entidade: "TAREFA",
      entidadeId: id,
      descricao: `Tarefa "${titulo}" foi concluída`,
      usuarioId
    }),

  reabrir: (titulo: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "reabriu",
      entidade: "TAREFA",
      entidadeId: id,
      descricao: `Tarefa "${titulo}" foi reaberta`,
      usuarioId
    }),
}

// ============================================
// HELPERS PARA CONTRATANTES
// ============================================
export const logContratante = {
  criar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "criou",
      entidade: "CONTRATANTE",
      entidadeId: id,
      descricao: `Contratante "${nome}" foi cadastrado`,
      usuarioId
    }),

  editar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "editou",
      entidade: "CONTRATANTE",
      entidadeId: id,
      descricao: `Contratante "${nome}" foi editado`,
      usuarioId
    }),

  excluir: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "excluiu",
      entidade: "CONTRATANTE",
      entidadeId: id,
      descricao: `Contratante "${nome}" foi excluído`,
      usuarioId
    }),
}

// ============================================
// HELPERS PARA REQUERENTES
// ============================================
export const logRequerente = {
  criar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "criou",
      entidade: "REQUERENTE",
      entidadeId: id,
      descricao: `Requerente "${nome}" foi cadastrado`,
      usuarioId
    }),

  editar: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "editou",
      entidade: "REQUERENTE",
      entidadeId: id,
      descricao: `Requerente "${nome}" foi editado`,
      usuarioId
    }),

  excluir: (nome: string, id: number, usuarioId?: number) =>
    registrarLog({
      acao: "excluiu",
      entidade: "REQUERENTE",
      entidadeId: id,
      descricao: `Requerente "${nome}" foi excluído`,
      usuarioId
    }),
}