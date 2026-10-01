// src/services/genealogia/documentos-exigidos-auditoria.ts
// UMA linha de LogAuditoria (quem / o quê / quando) por mudança do filtro `Pessoa.documentosExigidos`, na MESMA transação da
// mudança. A propagação para necessidade/documento/tarefa audita os FATOS que ela produz; esta linha audita a DECISÃO humana
// (inclusive quando ela não produz fato nenhum, p.ex. enquanto o processo espera em "Aguardando fechamento").

import type { Prisma } from "@prisma/client"
import { descreverMudancaDocumentosExigidos, type CodigoDocumentoExigivel } from "@/src/lib/genealogia/documentos-exigidos"
import { autorLegivel } from "@/src/services/genealogia/propagar-arvore"

export const ACAO_DOCUMENTOS_EXIGIDOS_ALTERADOS = "PESSOA_DOCUMENTOS_EXIGIDOS_ALTERADOS"

export async function auditarDocumentosExigidos(
  tx: Prisma.TransactionClient,
  args: { pessoaId: number; antes: unknown; depois: CodigoDocumentoExigivel[] | null; usuarioId: number | null },
): Promise<void> {
  const descricao = descreverMudancaDocumentosExigidos(args.antes, args.depois)
  if (!descricao) return
  const autor = await autorLegivel(tx, args.usuarioId)
  await tx.logAuditoria.create({
    data: {
      acao: ACAO_DOCUMENTOS_EXIGIDOS_ALTERADOS, entidade: "Pessoa", entidadeId: args.pessoaId, usuarioId: args.usuarioId,
      descricao: `Pessoa #${args.pessoaId}: ${descricao}${autor.nome ? ` (alterado por ${autor.nome})` : ""}`,
      detalhes: { pessoaId: args.pessoaId, antes: args.antes ?? null, depois: args.depois } as Prisma.InputJsonValue,
    },
  })
}
