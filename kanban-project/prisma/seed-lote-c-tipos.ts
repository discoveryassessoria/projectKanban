// prisma/seed-lote-c-tipos.ts
// LOTE C · FASE 4 — Backfill de TODOS os 24 valores do enum TipoDocumento
// para TipoDocumentoCadastro, cada um com legacyEnumKey (a ponte enum→config).
// Idempotente (upsert por legacyEnumKey). NÃO apaga nada. NÃO inventa mapping.
// Rodar DEPOIS do db push: npx tsx prisma/seed-lote-c-tipos.ts
import { prisma } from '@/lib/prisma'

// enumKey → { code, name, category, nature }. code casa com o que a tela já usa (IT-*).
// name/category = padrão do projeto; Marco ajusta na tela depois.
const TIPOS: { key: string; code: string; name: string; category: string; nature: string }[] = [
  { key: 'CERTIDAO_NASCIMENTO',              code: 'NAS',      name: 'Certidão de nascimento',                 category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR', code: 'IT - NAS', name: 'Certidão de nascimento - Inteiro Teor',   category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_CASAMENTO',               code: 'CAS',      name: 'Certidão de casamento',                  category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_CASAMENTO_INTEIRO_TEOR',  code: 'IT - CAS', name: 'Certidão de casamento - Inteiro Teor',   category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_OBITO',                   code: 'OBI',      name: 'Certidão de óbito',                      category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_OBITO_INTEIRO_TEOR',      code: 'IT - OBI', name: 'Certidão de óbito - Inteiro Teor',       category: 'civil_registry', nature: 'certidao' },
  { key: 'CERTIDAO_BATISMO',                 code: 'BAT',      name: 'Certidão de batismo',                    category: 'civil_registry', nature: 'certidao' },
  { key: 'CNN',                              code: 'CNN',      name: 'Certidão de Não Naturalização',          category: 'consular',       nature: 'certidao' },
  { key: 'CARTA_NATURALIZACAO',              code: 'CNAT',     name: 'Carta de Naturalização',                 category: 'consular',       nature: 'documento' },
  { key: 'RG',                               code: 'RG',       name: 'RG',                                     category: 'identity',       nature: 'identidade' },
  { key: 'CPF',                              code: 'CPF',      name: 'CPF',                                     category: 'identity',       nature: 'identidade' },
  { key: 'CNH',                              code: 'CNH',      name: 'CNH',                                     category: 'identity',       nature: 'identidade' },
  { key: 'PASSAPORTE_BRASILEIRO',            code: 'PASS-BR',  name: 'Passaporte Brasileiro',                  category: 'identity',       nature: 'identidade' },
  { key: 'TITULO_ELEITOR',                   code: 'TIT-ELE',  name: 'Título de Eleitor',                      category: 'identity',       nature: 'identidade' },
  { key: 'RESERVISTA',                       code: 'RESERV',   name: 'Certificado de Reservista',              category: 'identity',       nature: 'identidade' },
  { key: 'PASSAPORTE_ESTRANGEIRO',           code: 'PASS-EX',  name: 'Passaporte Estrangeiro',                 category: 'identity',       nature: 'identidade' },
  { key: 'CERTIDAO_CIDADANIA_ESTRANGEIRA',   code: 'CID-EX',   name: 'Certidão de Cidadania Estrangeira',      category: 'consular',       nature: 'certidao' },
  { key: 'COMPROVANTE_RESIDENCIA',           code: 'COMP-RES', name: 'Comprovante de Residência',              category: 'other',          nature: 'documento' },
  { key: 'TRADUCAO_JURAMENTADA',             code: 'TRAD',     name: 'Tradução Juramentada',                   category: 'translation',    nature: 'traducao' },
  { key: 'APOSTILA_HAIA',                    code: 'APOST',    name: 'Apostila de Haia',                       category: 'apostille',      nature: 'apostila' },
  { key: 'FOTO_3X4',                         code: 'FOTO',     name: 'Foto 3x4',                               category: 'other',          nature: 'documento' },
  { key: 'PROCURACAO',                       code: 'PROC',     name: 'Procuração',                             category: 'judicial',       nature: 'documento' },
  { key: 'ARVORE_GENEALOGICA_DOC',           code: 'ARV-GEN',  name: 'Árvore Genealógica (documento)',         category: 'other',          nature: 'documento' },
  { key: 'OUTRO',                            code: 'OUTRO',    name: 'Outro',                                  category: 'other',          nature: 'documento' },
]

async function main() {
  console.log(`📇 LOTE C · Fase 4 — backfill de ${TIPOS.length} tipos de documento (enum → TipoDocumentoCadastro)\n`)
  let criados = 0, atualizados = 0
  for (const t of TIPOS) {
    const existe = await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: t.key } })
    if (existe) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: existe.id },
        data: { code: t.code, name: t.name, category: t.category, nature: t.nature, ativo: true },
      })
      atualizados++
    } else {
      // se já existe um cadastro com esse code mas SEM legacyEnumKey (ex.: os 3 antigos), liga a ponte
      const porCode = await prisma.tipoDocumentoCadastro.findFirst({ where: { code: t.code, legacyEnumKey: null } })
      if (porCode) {
        await prisma.tipoDocumentoCadastro.update({ where: { id: porCode.id }, data: { legacyEnumKey: t.key, name: t.name, category: t.category, nature: t.nature } })
        atualizados++
      } else {
        await prisma.tipoDocumentoCadastro.create({ data: { code: t.code, name: t.name, category: t.category, nature: t.nature, legacyEnumKey: t.key, ativo: true } })
        criados++
      }
    }
  }
  const total = await prisma.tipoDocumentoCadastro.count()
  const comPonte = await prisma.tipoDocumentoCadastro.count({ where: { legacyEnumKey: { not: null } } })
  console.log(`\n─── resultado ───`)
  console.log(`  criados:      ${criados}`)
  console.log(`  atualizados:  ${atualizados}`)
  console.log(`  total de tipos no cadastro:        ${total}`)
  console.log(`  com legacyEnumKey (ponte pronta):  ${comPonte} / ${TIPOS.length} valores do enum`)
  console.log(`\n✅ Todos os 24 valores do enum agora existem como TipoDocumentoCadastro configurável.`)
}
main().catch(console.error).finally(() => prisma.$disconnect())