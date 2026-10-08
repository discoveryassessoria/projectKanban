// src/services/localidade/cartorio-vinculado.ts
// O documento PRECISA do cartório vinculado ao cadastro de órgãos para concluir «Localizar registro»? Só no BRASIL (regra única `lib/localidade/regra-localidade.ts`):
// fora dele o cartório é texto livre e não se obriga cadastro. SOMENTE LEITURA.
import { prisma } from '@/lib/prisma'
import { exigeCartorioVinculado } from '@/lib/localidade/regra-localidade'

/** `true` quando o documento é do Brasil (ou legado sem país) e ainda não tem cartório vinculado. */
export async function faltaCartorioVinculado(documentoId: number): Promise<boolean> {
  const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: { orgaoId: true, pais_registro: true } })
  return !!doc && doc.orgaoId == null && exigeCartorioVinculado(doc.pais_registro)
}
