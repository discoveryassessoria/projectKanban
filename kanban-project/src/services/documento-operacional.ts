// src/services/documento-operacional.ts
// ============================================================================
// DOCUMENTO OPERACIONAL — dono ÚNICO da remoção.
//
// Antes deste serviço havia dois pontos de escrita, e os dois estavam errados
// de formas diferentes:
//
//   · `DELETE /api/pessoas/[id]` apagava `Documento` direto, sem tocar em nada
//     que dependesse dele (tarefa, passo, lançamento);
//   · `DELETE /api/documentos/[id]` procurava as tarefas do documento por
//     IGUALDADE DE TÍTULO (`"${tipoLabel} - ${nomePessoa}"`). Título é
//     apresentação: se o rótulo do tipo muda, se o nome da pessoa é editado, ou
//     se a tarefa nasceu por outro caminho, a busca não acha e a tarefa fica
//     órfã. Foi assim que sobraram 16 tarefas "Localizar registro da certidão"
//     no processo 513, sem passo, sem necessidade e sem documento.
//
// Aqui a remoção é por ID, sempre. Nenhuma relação é resolvida por texto.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = Prisma.TransactionClient | typeof prisma

export interface ResultadoRemocaoDocumento {
  documentos: number
  tarefas: number
  passos: number
  solicitacoes: number
  arquivos: number
}

const zero = (): ResultadoRemocaoDocumento => ({ documentos: 0, tarefas: 0, passos: 0, solicitacoes: 0, arquivos: 0 })

/**
 * Remove documentos POR ID e tudo que depende deles, na ordem em que as
 * dependências existem. Base comum das duas portas de entrada.
 *
 * Não decide política: quem chama já decidiu que estes documentos saem. As
 * proteções de fato histórico vivem em `pessoa-ciclo-vida` (análise prévia) e
 * na rota de documento (que recusa documento com arquivo/protocolo).
 */
export async function removerDocumentosPorId(
  documentoIds: number[],
  db: DB = prisma,
): Promise<ResultadoRemocaoDocumento> {
  const out = zero()
  if (documentoIds.length === 0) return out

  // 1) Tarefas do documento — por vínculo de ID.
  const tarefas = await db.tarefa.findMany({
    where: { documentoId: { in: documentoIds } },
    select: { id: true },
  })
  const tarefaIds = tarefas.map((t) => t.id)
  if (tarefaIds.length) {
    out.tarefas = (await db.tarefa.deleteMany({ where: { id: { in: tarefaIds } } })).count
  }

  // 2) Passos de escopo DOCUMENTO.
  out.passos = (await db.phaseWorkflowStepInstance.deleteMany({
    where: { documentoId: { in: documentoIds } },
  })).count

  // 3) Financeiro que nasceu DESTE documento perde o vínculo explicitamente.
  //    `ObrigacaoEconomica.documentoId` é coluna solta (sem FK): se não for
  //    limpa aqui, aponta para um documento que não existe mais.
  await db.obrigacaoEconomica.updateMany({
    where: { documentoId: { in: documentoIds } },
    data: { documentoId: null },
  })

  // 4) Contagem do que a cascata do banco vai levar junto (Cascade em
  //    SolicitacaoDocumento, DocumentoArquivo e ProtocoloDocumento) — contado
  //    ANTES para o relatório não mentir sobre o que saiu.
  out.solicitacoes = await db.solicitacaoDocumento.count({ where: { documentoId: { in: documentoIds } } })
  out.arquivos = await db.documentoArquivo.count({ where: { documentoId: { in: documentoIds } } })

  out.documentos = (await db.documento.deleteMany({ where: { id: { in: documentoIds } } })).count
  return out
}

/**
 * Cascata da exclusão do SUJEITO: todos os documentos de uma pessoa.
 * Usado por `pessoa-ciclo-vida`. Simétrico a `removerNecessidadesDoSujeito`.
 */
export async function removerDocumentosDoSujeito(
  args: { pessoaId: number },
  db: DB = prisma,
): Promise<ResultadoRemocaoDocumento> {
  const docs = await db.documento.findMany({ where: { pessoaId: args.pessoaId }, select: { id: true } })
  return removerDocumentosPorId(docs.map((d) => d.id), db)
}

/** Remoção de UM documento (porta da rota `DELETE /api/documentos/[id]`). */
export async function removerDocumento(
  documentoId: number,
  db: DB = prisma,
): Promise<ResultadoRemocaoDocumento> {
  return removerDocumentosPorId([documentoId], db)
}
