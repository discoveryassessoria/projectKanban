// src/lib/documentos/natureza-certidao.ts
//
// Elegibilidade da Genealogia por CLASSIFICAÇÃO ESTRUTURADA do TipoDocumental.
// A Genealogia trabalha EXCLUSIVAMENTE com CERTIDÕES (registros civis que originam
// certidão). O critério é a NATUREZA estruturada (TipoDocumentoCadastro.nature ===
// "certidao") — NUNCA o nome textual do documento. Vale para qualquer nacionalidade.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = typeof prisma | Prisma.TransactionClient

// valor estruturado (não é "texto do documento"): é o vocabulário fixo do campo
// nature (certidao | identidade | documento | apostila | traducao | ...).
export const NATUREZA_CERTIDAO = "certidao"

/** É CERTIDÃO? Estritamente pela natureza estruturada — sem fallback por nome. */
export function ehNaturezaCertidao(nature: string | null | undefined): boolean {
  return String(nature ?? "").trim().toLowerCase() === NATUREZA_CERTIDAO
}

/** Conjunto de itemCatalogoId dos TiposDocumentais cuja natureza é CERTIDÃO. */
export async function itemCatalogosDeCertidao(db: DB = prisma): Promise<Set<number>> {
  const tipos = await db.tipoDocumentoCadastro.findMany({
    where: { itemCatalogoId: { not: null } },
    select: { itemCatalogoId: true, nature: true },
  })
  return new Set(
    tipos.filter((t) => ehNaturezaCertidao(t.nature)).map((t) => t.itemCatalogoId).filter((x): x is number => x != null),
  )
}

/** Conjunto de codes (TipoDocumentoCadastro.code) cuja natureza é CERTIDÃO. */
export async function codesDeCertidao(db: DB = prisma): Promise<Set<string>> {
  const tipos = await db.tipoDocumentoCadastro.findMany({ select: { code: true, nature: true } })
  return new Set(tipos.filter((t) => ehNaturezaCertidao(t.nature) && t.code).map((t) => t.code as string))
}
