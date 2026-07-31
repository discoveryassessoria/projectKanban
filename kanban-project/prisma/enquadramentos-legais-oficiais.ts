// prisma/enquadramentos-legais-oficiais.ts
// ============================================================================
// CADASTRO CURADO da modalidade legal e dos enquadramentos oficiais.
//
// Só entra aqui o que está COMPROVADO pela operação real da Discovery. Anexo II
// não é presumido; "menores vinculados" não é enquadramento. Nenhuma descrição
// jurídica é inventada: `descricao` fica nula até existir fonte oficial.
//
// O `code` é identidade imutável do registro — o vínculo com o processo é
// sempre por id (`Processo.enquadramentoLegalId`).
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

/** Modalidade legal e seus enquadramentos, resolvidos pelo país oficial. */
export const MODALIDADES_LEGAIS = [
  {
    code: 'ES_LMD',
    nome: 'Lei da Memória Democrática',
    paisCountryKey: 'espanha',
    ordem: 1,
    enquadramentos: [
      { code: 'ES_LMD_ANEXO_I', nome: 'Anexo I', ordem: 1 },
      { code: 'ES_LMD_ANEXO_III', nome: 'Anexo III', ordem: 3 },
    ],
  },
] as const

/**
 * Garante modalidade legal e enquadramentos (idempotente por `code`).
 * Atualiza nome e ordem — conteúdo próprio — e nunca toca no `code`.
 * País inexistente é erro de curadoria: falha alto em vez de criar país.
 */
export async function garantirEnquadramentosLegais(db: DB): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  for (const m of MODALIDADES_LEGAIS) {
    const pais = await db.catalogoPais.findUnique({ where: { countryKey: m.paisCountryKey }, select: { id: true } })
    if (!pais) throw new Error(`País "${m.paisCountryKey}" não está em CatalogoPais. Cadastre-o antes.`)
    const modalidade = await db.modalidadeLegal.upsert({
      where: { code: m.code },
      create: { code: m.code, nome: m.nome, ordem: m.ordem, paisId: pais.id, ativo: true },
      update: { nome: m.nome, ordem: m.ordem, paisId: pais.id },
      select: { id: true },
    })
    mapa.set(m.code, modalidade.id)
    for (const e of m.enquadramentos) {
      const reg = await db.enquadramentoLegal.upsert({
        where: { code: e.code },
        create: { code: e.code, nome: e.nome, ordem: e.ordem, modalidadeLegalId: modalidade.id, ativo: true },
        update: { nome: e.nome, ordem: e.ordem, modalidadeLegalId: modalidade.id },
        select: { id: true },
      })
      mapa.set(e.code, reg.id)
    }
  }
  return mapa
}
