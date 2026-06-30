// prisma/seed-motor-1a.ts
// Seed da Fase 1A do Motor: 4 países + modalidades por país.
// Rodar uma vez:  npx tsx prisma/seed-motor-1a.ts   (ou: npx ts-node prisma/seed-motor-1a.ts)
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const PAISES = [
  { countryKey: 'italia',   countryLabel: 'Itália',   nationalityKey: 'italiana',   nationalityLabel: 'Italiana',   flag: '🇮🇹', language: 'it', defaultCurrency: 'EUR', codePrefix: 'ITA' },
  { countryKey: 'espanha',  countryLabel: 'Espanha',  nationalityKey: 'espanhola',  nationalityLabel: 'Espanhola',  flag: '🇪🇸', language: 'es', defaultCurrency: 'EUR', codePrefix: 'ESP' },
  { countryKey: 'portugal', countryLabel: 'Portugal', nationalityKey: 'portuguesa', nationalityLabel: 'Portuguesa', flag: '🇵🇹', language: 'pt', defaultCurrency: 'EUR', codePrefix: 'POR' },
  { countryKey: 'alemanha', countryLabel: 'Alemanha', nationalityKey: 'alema',      nationalityLabel: 'Alemã',      flag: '🇩🇪', language: 'de', defaultCurrency: 'EUR', codePrefix: 'ALE' },
]

const MODALIDADES = [
  // Itália
  { countryKey: 'italia', modalityKey: 'judicial',         modalityLabel: 'Judicial',          codeSuffix: 'JUD',       ordem: 1 },
  { countryKey: 'italia', modalityKey: 'administrativa',   modalityLabel: 'Administrativa',    codeSuffix: 'ADM',       ordem: 2 },
  { countryKey: 'italia', modalityKey: 'consular_comune',  modalityLabel: 'Consular / Comune', codeSuffix: 'COMUNE',    ordem: 3 },
  // Espanha
  { countryKey: 'espanha', modalityKey: 'lmd',                modalityLabel: 'LMD',                codeSuffix: 'LMD',      ordem: 1 },
  { countryKey: 'espanha', modalityKey: 'consular',           modalityLabel: 'Consular',           codeSuffix: 'CONSULAR', ordem: 2 },
  { countryKey: 'espanha', modalityKey: 'recurso_exigencia',  modalityLabel: 'Recurso / Exigência', codeSuffix: 'REC',     ordem: 3 },
  // Portugal
  { countryKey: 'portugal', modalityKey: 'netos',     modalityLabel: 'Netos',     codeSuffix: 'NETOS',     ordem: 1 },
  { countryKey: 'portugal', modalityKey: 'filhos',    modalityLabel: 'Filhos',    codeSuffix: 'FILHOS',    ordem: 2 },
  { countryKey: 'portugal', modalityKey: 'casamento', modalityLabel: 'Casamento', codeSuffix: 'CASAMENTO', ordem: 3 },
  // Alemanha
  { countryKey: 'alemanha', modalityKey: 'cidadania',    modalityLabel: 'Cidadania',    codeSuffix: 'CID',  ordem: 1 },
  { countryKey: 'alemanha', modalityKey: 'descendencia', modalityLabel: 'Descendência', codeSuffix: 'DESC', ordem: 2 },
  { countryKey: 'alemanha', modalityKey: 'reaquisicao',  modalityLabel: 'Reaquisição',  codeSuffix: 'REAQ', ordem: 3 },
]

async function main() {
  for (const p of PAISES) {
    await prisma.catalogoPais.upsert({ where: { countryKey: p.countryKey }, update: p, create: p })
  }
  for (const m of MODALIDADES) {
    await prisma.modalidadePais.upsert({
      where: { countryKey_modalityKey: { countryKey: m.countryKey, modalityKey: m.modalityKey } },
      update: m,
      create: m,
    })
  }
  console.log(`Seed motor 1A OK — ${PAISES.length} países, ${MODALIDADES.length} modalidades.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())