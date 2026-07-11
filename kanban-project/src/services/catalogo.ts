// src/services/catalogo.ts
// CP-2 — Catálogo Mestre: ItemCatalogo é a fonte única dos conceitos mestres.
//
// Cadeia do Documento Mestre (Regra 3):
//   ItemCatalogo (natureza DOCUMENTO)
//     -> TipoDocumentoCadastro (projeção/perfil compatível, com legacyEnumKey)
//       -> Documento operacional (documentTypeId)  [fallback: enum tipo legado]
//
// Este service resolve, por DUAL-READ, qual é o Documento Mestre de um
// documento — sempre preferindo o vínculo canônico (documentTypeId) e caindo
// no enum legado só como compatibilidade. Não escreve nada (sem dual-write).

import { prisma } from "@/lib/prisma"
import { resolveDocumentType, type TipoResolvido } from "@/src/lib/document-type-resolver"

export {
  codeDocumentoMestre,
  nomeDocumentoMestre,
  resolverItemCatalogoDeTipoServico,
} from "@/src/services/catalogo-helpers"

export interface DocumentoMestreResolvido {
  fonte: TipoResolvido["fonte"]
  tipoDocumentoCadastroId: number | null
  itemCatalogoId: number | null
}

/**
 * Resolve o Documento Mestre (ItemCatalogo) de um documento (DUAL-READ):
 *  1) documentTypeId -> TipoDocumentoCadastro.itemCatalogoId (preferido);
 *  2) enum tipo legado -> via legacyEnumKey -> itemCatalogoId (fallback);
 *  3) nenhum -> itemCatalogoId null.
 */
export async function resolverDocumentoMestre(doc: {
  documentTypeId?: number | null
  tipo?: string | null
  documentType?: {
    id: number
    code: string | null
    name: string
    category: string | null
    nature: string | null
    legacyEnumKey: string | null
  } | null
}): Promise<DocumentoMestreResolvido> {
  const t = await resolveDocumentType(doc)
  if (t.tipoDocumentoCadastroId == null) {
    return { fonte: t.fonte, tipoDocumentoCadastroId: null, itemCatalogoId: null }
  }
  const cad = await prisma.tipoDocumentoCadastro.findUnique({
    where: { id: t.tipoDocumentoCadastroId },
    select: { itemCatalogoId: true },
  })
  return {
    fonte: t.fonte,
    tipoDocumentoCadastroId: t.tipoDocumentoCadastroId,
    itemCatalogoId: cad?.itemCatalogoId ?? null,
  }
}
