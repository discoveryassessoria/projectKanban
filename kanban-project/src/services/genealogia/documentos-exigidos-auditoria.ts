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
  args: { pessoaId: number; antes: unknown; depois: CodigoDocumentoExigivel[] | null; usuarioId: number | null; decisaoHumana?: boolean; motivo?: string | null },
): Promise<void> {
  const descricao = descreverMudancaDocumentosExigidos(args.antes, args.depois)
  if (!descricao) return
  const autor = await autorLegivel(tx, args.usuarioId)
  await tx.logAuditoria.create({
    data: {
      acao: ACAO_DOCUMENTOS_EXIGIDOS_ALTERADOS, entidade: "Pessoa", entidadeId: args.pessoaId, usuarioId: args.usuarioId,
      descricao: `Pessoa #${args.pessoaId}: ${descricao}${autor.nome ? ` (alterado por ${autor.nome})` : ""}${args.motivo ? ` — motivo: ${args.motivo}` : ""}`,
      detalhes: { pessoaId: args.pessoaId, antes: args.antes ?? null, depois: args.depois, ...(args.decisaoHumana ? { decisaoHumana: true, motivo: args.motivo ?? null } : {}) } as Prisma.InputJsonValue,
    },
  })
}

/**
 * REGRA FIXA (06/10/2026, caso Attilio Fogli): tirar da lista uma certidão cuja necessidade JÁ ANDOU (em atendimento, atendida ou não localizada)
 * é decisão humana EXPLÍCITA — nunca efeito colateral de editar a pessoa. Devolve as certidões que a edição tiraria nessa situação.
 */
export async function certidoesJaAndadasQueSairiam(
  db: Pick<Prisma.TransactionClient, "necessidadeDocumental">,
  args: { pessoaId: number; antes: unknown; depois: CodigoDocumentoExigivel[] | null },
): Promise<string[]> {
  const { marcadosParaTela } = await import("@/src/lib/genealogia/documentos-exigidos")
  const antes = marcadosParaTela(args.antes), depois = marcadosParaTela(args.depois)
  const tiradas = antes.filter((c) => !depois.includes(c))
  if (tiradas.length === 0) return []
  const necs = await db.necessidadeDocumental.findMany({
    where: {
      supersedePorId: null, status: { in: ["EM_ATENDIMENTO", "ATENDIDA", "NAO_LOCALIZADA"] },
      OR: [{ pessoaId: args.pessoaId }, { uniao: { OR: [{ pessoa1Id: args.pessoaId }, { pessoa2Id: args.pessoaId }] } }],
    },
    select: { itemCatalogo: { select: { name: true } } },
  })
  const rotulo = (n: string) => (/nasc/i.test(n) ? "NAS" : /casam/i.test(n) ? "CAS" : /[óo]bito/i.test(n) ? "OBI" : null)
  return necs.filter((n) => { const c = rotulo(n.itemCatalogo?.name ?? ""); return c != null && tiradas.includes(c as CodigoDocumentoExigivel) }).map((n) => n.itemCatalogo?.name ?? "certidão")
}
