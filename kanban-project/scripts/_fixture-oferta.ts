// scripts/_fixture-oferta.ts
//
// FIXTURE DA OFERTA — garante país e modalidade no Cadastro Mestre e devolve as
// IDENTIDADES que `TipoProcessoNacionalidade` precisa.
//
// Antes, cada teste escrevia o país e a modalidade DENTRO do tipo de processo
// (countryKey, countryLabel, modalityKey, modalityLabel). Era a mesma cópia que
// existia em produção, replicada em quarenta arquivos — e por isso o cenário de
// teste conseguia montar uma oferta de um país que não existia em lugar nenhum.
//
// Aqui o cenário é montado como a aplicação monta: o país existe, a modalidade
// existe naquele país, e a oferta APONTA para as duas.

import type { PrismaClient } from "@prisma/client"

export interface OfertaFixture {
  countryKey: string
  countryLabel?: string
  nationalityKey?: string
  nationalityLabel?: string
  modalityKey: string
  modalityLabel?: string
}

/** `{ paisId, modalidadeId }` prontos para o create do tipo de processo. */
export async function garantirOferta(
  db: Pick<PrismaClient, "catalogoPais" | "modalidadePais">,
  o: OfertaFixture,
): Promise<{ paisId: number; modalidadeId: number }> {
  const label = o.countryLabel ?? o.countryKey
  const pais = await db.catalogoPais.upsert({
    where: { countryKey: o.countryKey },
    update: {},
    create: {
      countryKey: o.countryKey,
      countryLabel: label,
      nationalityKey: o.nationalityKey ?? o.countryKey,
      nationalityLabel: o.nationalityLabel ?? label,
    },
    select: { id: true },
  })
  const modalidade = await db.modalidadePais.upsert({
    where: { paisId_modalityKey: { paisId: pais.id, modalityKey: o.modalityKey } },
    update: {},
    create: {
      paisId: pais.id,
      modalityKey: o.modalityKey,
      modalityLabel: o.modalityLabel ?? o.modalityKey,
    },
    select: { id: true },
  })
  return { paisId: pais.id, modalidadeId: modalidade.id }
}
