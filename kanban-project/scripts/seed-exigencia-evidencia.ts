// scripts/seed-exigencia-evidencia.ts
//
// CONFIGURAÇÃO OFICIAL DE EVIDÊNCIA DA ETAPA "Solicitar certidão".
//
// Este é o ÚNICO lugar do sistema que resolve código do cadastro mestre → ID.
// Daqui para a frente tudo trabalha por ID: o runtime lê `ExigenciaEvidenciaEtapa`
// e nunca menciona "DOC21", nome de documento nem rótulo de campo.
//
// O QUE ELE DECLARA
// -----------------
//   Passo `solicitar_certidao`, para documento operacional em INTEIRO TEOR,
//   qualquer canal → exige o documento mestre "Requerimento inteiro teor"
//   (code REQUERIMENTO_INTEIRO_TEOR / DOC21) com finalidade REQUERIMENTO_ENVIADO,
//   obrigatório, cardinalidade 1.
//
// Os tipos operacionais que disparam a exigência são identificados pelo
// `legacyEnumKey` — o valor do enum `TipoDocumento`, que é a ponte ESTRUTURAL do
// cadastro (documentada no schema), não o nome exibido.
//
// NÃO INVENTA CADASTRO: se o documento mestre não existir, o script PARA e diz o
// que falta. Criar tipo documental é ato do Cadastro Mestre, não de um seed.
//
// Rodar:
//   npx tsx scripts/seed-exigencia-evidencia.ts            # diagnóstico (não escreve)
//   npx tsx scripts/seed-exigencia-evidencia.ts --execute  # aplica
//
// IDEMPOTENTE: upsert pela chave derivada dos IDs. Reexecutar não duplica linha
// nem altera linha de outro domínio.

import { prisma } from "@/lib/prisma"
import { chaveDaExigencia } from "@/src/lib/process-stage/chave-exigencia"

const EXECUTAR = process.argv.includes("--execute")

/** Código TÉCNICO do documento mestre exigido (TipoDocumentoCadastro.code). */
const CODE_REQUERIMENTO = "REQUERIMENTO_INTEIRO_TEOR"
/** Código público do mesmo cadastro — usado só como segunda via de resolução. */
const PUBLIC_CODE_REQUERIMENTO = "DOC21"

/** Tipos operacionais em inteiro teor, pela ponte estrutural do enum TipoDocumento. */
const ENUM_KEYS_INTEIRO_TEOR = [
  "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
  "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
  "CERTIDAO_OBITO_INTEIRO_TEOR",
]

const STEP_KEY = "solicitar_certidao"

async function main() {
  console.log(`SEED exigência de evidência — ${EXECUTAR ? "EXECUTANDO" : "DIAGNÓSTICO (sem escrita)"}\n`)

  const fingerprint = await prisma.$queryRawUnsafe<Array<{ db: string; usr: string }>>(
    "select current_database() as db, current_user as usr",
  )
  console.log(`  banco: ${JSON.stringify(fingerprint[0])}\n`)

  // ── 1. o documento MESTRE exigido ────────────────────────────────────────
  const mestre =
    (await prisma.tipoDocumentoCadastro.findFirst({
      where: { code: CODE_REQUERIMENTO },
      select: { id: true, code: true, publicCode: true, name: true, ativo: true },
    })) ??
    (await prisma.tipoDocumentoCadastro.findFirst({
      where: { publicCode: PUBLIC_CODE_REQUERIMENTO },
      select: { id: true, code: true, publicCode: true, name: true, ativo: true },
    }))

  if (!mestre) {
    console.error(
      `  ABORTADO: documento mestre "${CODE_REQUERIMENTO}" (${PUBLIC_CODE_REQUERIMENTO}) não existe no Cadastro Mestre de Documentos.`,
    )
    console.error("  Cadastre-o na tela de Tipos de Documento. Este script não cria cadastro.")
    process.exitCode = 1
    return
  }
  if (!mestre.ativo) {
    console.error(`  ABORTADO: documento mestre ${mestre.publicCode} está INATIVO. Reative-o antes de exigi-lo.`)
    process.exitCode = 1
    return
  }
  console.log(`  documento mestre exigido: id=${mestre.id} · ${mestre.publicCode} · ${mestre.code} · "${mestre.name}"`)

  // ── 2. os tipos operacionais que disparam a exigência ────────────────────
  const alvos = await prisma.tipoDocumentoCadastro.findMany({
    where: { legacyEnumKey: { in: ENUM_KEYS_INTEIRO_TEOR } },
    select: { id: true, publicCode: true, name: true, legacyEnumKey: true },
    orderBy: { id: "asc" },
  })
  const faltando = ENUM_KEYS_INTEIRO_TEOR.filter((k) => !alvos.some((a) => a.legacyEnumKey === k))
  for (const k of faltando) console.log(`  ! sem tipo operacional para ${k} — nenhuma exigência será criada para ele.`)
  if (alvos.length === 0) {
    console.error("  ABORTADO: nenhum tipo documental em inteiro teor encontrado.")
    process.exitCode = 1
    return
  }

  // ── 3. as linhas de exigência ────────────────────────────────────────────
  let criadas = 0
  let mantidas = 0
  for (const alvo of alvos) {
    const chave = chaveDaExigencia({
      stepKey: STEP_KEY,
      documentoTipoId: alvo.id,
      canal: null,
      evidenciaTipoId: mestre.id,
    })
    const existente = await prisma.exigenciaEvidenciaEtapa.findUnique({
      where: { chaveExigencia: chave },
      select: { id: true },
    })
    console.log(
      `  ${existente ? "=" : "+"} ${STEP_KEY} · ${alvo.publicCode} "${alvo.name}" (qualquer canal) → exige ${mestre.publicCode}`,
    )
    if (existente) {
      mantidas++
      continue
    }
    criadas++
    if (!EXECUTAR) continue
    await prisma.exigenciaEvidenciaEtapa.create({
      data: {
        stepKey: STEP_KEY,
        documentoTipoId: alvo.id,
        canal: null,
        evidenciaTipoId: mestre.id,
        finalidade: "REQUERIMENTO_ENVIADO",
        obrigatoria: true,
        cardinalidadeMax: 1,
        ativo: true,
        chaveExigencia: chave,
      },
    })
  }

  console.log(
    `\n  ${criadas} exigência(s) ${EXECUTAR ? "criada(s)" : "a criar"} · ${mantidas} já existente(s) (inalterada(s)).`,
  )
  if (!EXECUTAR && criadas > 0) console.log("  Rode com --execute para aplicar.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
