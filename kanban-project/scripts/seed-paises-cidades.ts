// scripts/seed-paises-cidades.ts
// ============================================================================
// SEED DA BASE MUNDIAL DE PAÍSES E CIDADES — fonte pública gratuita GeoNames
// (download.geonames.org/export/dump/). Um-off: geografia mundial não muda
// como cartório muda toda semana, então isto não é um cron — é rodado à mão
// quando a base precisar de atualização (novo país reconhecido, etc.).
//
// Fontes:
//   countryInfo.txt      — todos os países (ISO alpha-2 + nome)
//   admin1CodesASCII.txt — nome da região/estado/província por código
//   cities5000.zip       — cidades com população ≥ 5000 (piso que cobre
//                          comuni pequenos de cidadania italiana/espanhola
//                          sem inflar a base com todo povoado do mundo)
//
// Dry-run por padrão. `--aplicar --prod` + confirmação escrevem de verdade.
// Idempotente: upsert por `codigo` (Pais) / `sourceId` (Cidade, = geonameid).
// ============================================================================
import { execSync } from "node:child_process"
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import countriesI18n from "i18n-iso-countries"
import ptLocale from "i18n-iso-countries/langs/pt.json" with { type: "json" }

countriesI18n.registerLocale(ptLocale)

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
// Refaz só os países (nome/tradução) — pula a releitura das ~70 mil cidades
// quando só o nome do país mudou (achado real: GeoNames devolve em inglês;
// o sistema é em português — ex.: "Spain" → "Espanha").
const SOMENTE_PAISES = process.argv.includes("--somente-paises")

const BASE = "https://download.geonames.org/export/dump"

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

async function baixarTexto(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`falha ao baixar ${url}: HTTP ${r.status}`)
  return r.text()
}

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR && PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error("--prod pedido mas o banco não classifica como PRODUÇÃO. Abortando.")
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Abortando.")
      process.exit(1)
    }
  }

  // ---- 1) PAÍSES ----------------------------------------------------------
  console.log("\nBaixando countryInfo.txt…")
  const countryInfo = await baixarTexto(`${BASE}/countryInfo.txt`)
  const paisesPorCodigo = new Map<string, string>() // ISO2 -> nome (em português quando a tradução existe)
  for (const linha of countryInfo.split("\n")) {
    if (!linha.trim() || linha.startsWith("#")) continue
    const col = linha.split("\t")
    const codigo = col[0]?.trim()
    const nomeFonte = col[4]?.trim()
    if (!codigo || !nomeFonte || codigo.length !== 2) continue
    const nome = countriesI18n.getName(codigo, "pt") ?? nomeFonte
    paisesPorCodigo.set(codigo, nome)
  }
  console.log(`  ${paisesPorCodigo.size} países`)

  // ---- 2) REGIÕES (admin1) -------------------------------------------------
  console.log("Baixando admin1CodesASCII.txt…")
  const admin1Raw = await baixarTexto(`${BASE}/admin1CodesASCII.txt`)
  const regiaoPorCodigo = new Map<string, string>() // "ES.29" -> "Andaluzia"
  for (const linha of admin1Raw.split("\n")) {
    if (!linha.trim()) continue
    const col = linha.split("\t")
    const codigo = col[0]?.trim()
    const nome = col[1]?.trim()
    if (codigo && nome) regiaoPorCodigo.set(codigo, nome)
  }
  console.log(`  ${regiaoPorCodigo.size} regiões`)

  // ---- 3) CIDADES (cities5000.zip) -----------------------------------------
  interface CidadeRow { sourceId: string; nome: string; nomeNormalizado: string; regiao: string | null; paisCodigo: string }
  const cidades: CidadeRow[] = []
  if (SOMENTE_PAISES) {
    console.log("--somente-paises: pulando cidades (não mudaram).")
  } else {
    console.log("Baixando cities5000.zip…")
    const zipResp = await fetch(`${BASE}/cities5000.zip`)
    if (!zipResp.ok) throw new Error(`falha ao baixar cities5000.zip: HTTP ${zipResp.status}`)
    const zipBuf = Buffer.from(await zipResp.arrayBuffer())
    const dirTmp = mkdtempSync(path.join(tmpdir(), "geonames-"))
    const zipPath = path.join(dirTmp, "cities5000.zip")
    writeFileSync(zipPath, zipBuf)
    execSync(`unzip -o -q "${zipPath}" -d "${dirTmp}"`)
    const citiesTxt = readFileSync(path.join(dirTmp, "cities5000.txt"), "utf-8")
    rmSync(dirTmp, { recursive: true, force: true })

    for (const linha of citiesTxt.split("\n")) {
      if (!linha.trim()) continue
      const col = linha.split("\t")
      const geonameid = col[0]?.trim()
      const nome = col[1]?.trim()
      const paisCodigo = col[8]?.trim()
      const admin1 = col[10]?.trim()
      if (!geonameid || !nome || !paisCodigo) continue
      const regiao = admin1 ? (regiaoPorCodigo.get(`${paisCodigo}.${admin1}`) ?? null) : null
      cidades.push({ sourceId: geonameid, nome, nomeNormalizado: normalizar(nome), regiao, paisCodigo })
    }
    console.log(`  ${cidades.length} cidades`)
  }

  console.log(`\n${APLICAR ? "Aplicando" : "Simulando (dry-run)"}…`)
  if (!APLICAR) {
    console.log(`Escreveria ${paisesPorCodigo.size} país(es) e ${cidades.length} cidade(s).`)
    await prisma.$disconnect()
    return
  }

  // ---- ESCRITA --------------------------------------------------------------
  const paisIdPorCodigo = new Map<string, number>()
  let paisesCriados = 0
  for (const [codigo, nome] of paisesPorCodigo) {
    const p = await prisma.pais.upsert({
      where: { codigo },
      update: { nome, nomeNormalizado: normalizar(nome) },
      create: { codigo, nome, nomeNormalizado: normalizar(nome) },
      select: { id: true },
    })
    paisIdPorCodigo.set(codigo, p.id)
    paisesCriados++
  }
  console.log(`  ${paisesCriados} país(es) upsertado(s).`)

  let cidadesCriadas = 0
  // Pool de conexão de produção tem teto 21 — 500 upserts concorrentes
  // (achado real, 24/09/2026) estourava o pool e derrubava o lote inteiro. 15
  // fica bem abaixo do teto, com folga pra outras conexões do mesmo processo.
  const LOTE = 15
  for (let i = 0; i < cidades.length; i += LOTE) {
    const lote = cidades.slice(i, i + LOTE)
    await Promise.all(lote.map(async (c) => {
      const paisId = paisIdPorCodigo.get(c.paisCodigo)
      if (!paisId) return
      await prisma.cidade.upsert({
        where: { sourceId: c.sourceId },
        update: { nome: c.nome, nomeNormalizado: c.nomeNormalizado, regiao: c.regiao, paisId },
        create: { sourceId: c.sourceId, nome: c.nome, nomeNormalizado: c.nomeNormalizado, regiao: c.regiao, paisId },
      })
      cidadesCriadas++
    }))
    console.log(`  ${Math.min(i + LOTE, cidades.length)}/${cidades.length} cidades…`)
  }
  console.log(`  ${cidadesCriadas} cidade(s) upsertada(s).`)

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
