// scripts/backup-registrar.ts
//
// REGISTRA A EVIDÊNCIA DE UM BACKUP QUE REALMENTE EXISTE.
//
// Uso:  npx tsx scripts/backup-registrar.ts <caminho-do-dump> [--origem "pg_dump manual"]
//
// ─── POR QUE ISTO NÃO É UM CAMPO DE TEXTO ───────────────────────────────────
// A verificação BKP-001 existe porque "o provedor faz backup automático" não é
// verificável de dentro do sistema, e o que não é verificável não pode ser
// afirmado. Um registro que aceitasse qualquer frase teria o mesmo problema um
// nível acima: viraria a afirmação de que existe backup, sem prova nenhuma.
//
// Este script SÓ registra o que ele mesmo conseguiu conferir no arquivo:
//   — que o arquivo existe e não está vazio;
//   — que ele é mesmo um dump do PostgreSQL (assinatura do formato custom, ou
//     o cabeçalho que o pg_dump em texto sempre escreve);
//   — o tamanho em bytes e o sha256 do conteúdo.
// Se qualquer uma dessas conferências falhar, ele RECUSA e não escreve nada.
//
// O que ele NÃO prova é que o dump restaura — isso é a BKP-002, e continua
// aberta até alguém restaurar de verdade.

import { createHash } from "node:crypto"
import { readFileSync, statSync, existsSync } from "node:fs"
import { basename, resolve } from "node:path"
import { prisma } from "@/lib/prisma"

const ASSINATURA_CUSTOM = Buffer.from("PGDMP")
const CABECALHO_TEXTO = /^--\s*\n--\s*PostgreSQL database (dump|cluster dump)/m

function conferirDump(caminho: string): { formato: string; tamanho: number; sha256: string } {
  if (!existsSync(caminho)) throw new Error(`arquivo não encontrado: ${caminho}`)
  const info = statSync(caminho)
  if (!info.isFile()) throw new Error(`não é um arquivo: ${caminho}`)
  if (info.size === 0) throw new Error("o arquivo está vazio — isso não é um backup")

  const conteudo = readFileSync(caminho)

  let formato: string
  if (conteudo.subarray(0, 5).equals(ASSINATURA_CUSTOM)) {
    formato = "pg_dump custom"
  } else if (CABECALHO_TEXTO.test(conteudo.subarray(0, 4096).toString("utf8"))) {
    formato = "pg_dump texto"
  } else {
    throw new Error(
      "o arquivo não tem assinatura de dump do PostgreSQL — recusado. " +
      "Um backup que o sistema não consegue reconhecer não é evidência de nada.",
    )
  }

  return { formato, tamanho: info.size, sha256: createHash("sha256").update(conteudo).digest("hex") }
}

async function main() {
  const args = process.argv.slice(2)
  const caminho = args.find((a) => !a.startsWith("--"))
  if (!caminho) {
    console.error("uso: npx tsx scripts/backup-registrar.ts <caminho-do-dump> [--origem \"...\"]")
    process.exit(1)
  }
  const i = args.indexOf("--origem")
  const origem = i >= 0 ? args[i + 1] : "pg_dump manual"

  const absoluto = resolve(caminho)
  const prova = conferirDump(absoluto)

  const evidencia = {
    registradoEm: new Date().toISOString(),
    arquivo: basename(absoluto),
    formato: prova.formato,
    tamanhoBytes: prova.tamanho,
    sha256: prova.sha256,
    origem,
  }

  await prisma.configuracaoSistema.upsert({
    where: { chave: "backup.ultimo" },
    create: { chave: "backup.ultimo", valor: JSON.stringify(evidencia), grupo: "geral" },
    update: { valor: JSON.stringify(evidencia) },
  })

  console.log("Evidência registrada:")
  console.log(`  arquivo:  ${evidencia.arquivo}`)
  console.log(`  formato:  ${evidencia.formato}`)
  console.log(`  tamanho:  ${(prova.tamanho / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  sha256:   ${prova.sha256}`)
  console.log(`  origem:   ${origem}`)
  console.log("\nBKP-002 (restauração testada) continua aberta até alguém restaurar de verdade.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(`RECUSADO: ${e instanceof Error ? e.message : e}`); process.exit(1) })
