// ESTE ARQUIVO VAI EM: scripts/reset-modalidades.ts
//
// RODA UMA VEZ:  npx tsx scripts/reset-modalidades.ts
//
// O que faz:
// 1. Em TODOS os países do catálogo: apaga as modalidades que não sejam
//    "judicial"/"administrativa" e garante as duas (upsert, ativo=true).
// 2. (Opcional) Remapeia tipos existentes pra nova modalidade — preencha o
//    REMAP abaixo quando o Marco decidir. Vazio = tipos ficam como estão.
// 3. Avisa quais tipos ficaram com modalidade "órfã" (fora das duas).

import fs from 'fs'
import path from 'path'

// carrega .env / .env.local (tsx não carrega sozinho)
for (const nome of ['.env', '.env.local']) {
  const p = path.join(process.cwd(), nome)
  if (!fs.existsSync(p)) continue
  for (const linha of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const PADRAO = [
  { modalityKey: 'judicial', modalityLabel: 'Judicial', codeSuffix: 'JUD', ordem: 0 },
  { modalityKey: 'administrativa', modalityLabel: 'Administrativa', codeSuffix: 'ADM', ordem: 1 },
] as const

// ⬇️ PREENCHER QUANDO O MARCO DECIDIR (code do tipo -> nova modalidade).
// Exemplo:
//   'ALE-DESC': 'judicial',
//   'ESP-LMD': 'administrativa',
const REMAP: Record<string, 'judicial' | 'administrativa'> = {
}

async function main() {
  const paises = await prisma.catalogoPais.findMany({ orderBy: { countryLabel: 'asc' } })
  console.log(`Países no catálogo: ${paises.length}\n`)

  for (const p of paises) {
    const removidas = await prisma.modalidadePais.deleteMany({
      where: { paisId: p.id, modalityKey: { notIn: ['judicial', 'administrativa'] } },
    })
    for (const m of PADRAO) {
      await prisma.modalidadePais.upsert({
        where: { paisId_modalityKey: { paisId: p.id, modalityKey: m.modalityKey } },
        update: { modalityLabel: m.modalityLabel, codeSuffix: m.codeSuffix, ordem: m.ordem, ativo: true },
        create: { paisId: p.id, ...m, ativo: true },
      })
    }
    console.log(`✔ ${p.countryLabel}: ${removidas.count} modalidade(s) antiga(s) removida(s); Judicial + Administrativa garantidas.`)
  }

  // remapeia tipos existentes (se REMAP preenchido)
  for (const [code, novaKey] of Object.entries(REMAP)) {
    const nova = PADRAO.find((m) => m.modalityKey === novaKey)!
    // Remapear é REAPONTAR o vínculo — antes era reescrever a cópia do rótulo.
    const alvo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code }, select: { id: true, paisId: true } })
    if (!alvo) { console.log(`⚠ Tipo ${code} não encontrado (REMAP ignorado)`); continue }
    const modalidade = await prisma.modalidadePais.findUnique({
      where: { paisId_modalityKey: { paisId: alvo.paisId, modalityKey: nova.modalityKey } },
      select: { id: true, modalityLabel: true },
    })
    if (!modalidade) { console.log(`⚠ Tipo ${code}: país não tem a modalidade "${nova.modalityKey}"`); continue }
    await prisma.tipoProcessoNacionalidade.update({ where: { id: alvo.id }, data: { modalidadeId: modalidade.id } })
    console.log(`✔ Tipo ${code} → ${modalidade.modalityLabel}`)
  }

  // avisa tipos órfãos
  const orfaos = await prisma.tipoProcessoNacionalidade.findMany({
    where: { modalidade: { modalityKey: { notIn: ['judicial', 'administrativa'] } } },
    select: { code: true, name: true, modalidade: { select: { modalityLabel: true } } },
  })
  if (orfaos.length > 0) {
    console.log('\n⚠ Tipos ainda apontando para modalidade antiga.')
    console.log('  Edite pelo sistema ou preencha o REMAP e rode de novo:')
    for (const t of orfaos) console.log(`  - ${t.code} · ${t.name} (${t.modalidade.modalityLabel})`)
  } else {
    console.log('\n✔ Nenhum tipo com modalidade antiga.')
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())