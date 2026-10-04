// scripts/r2-migrar-privado.ts
// ============================================================================
// MIGRAÇÃO DOS ARQUIVOS `privado/` DO BUCKET PÚBLICO PARA O BUCKET PRIVADO (bloco P0 — mandato §8b).
//
//   npx tsx scripts/r2-migrar-privado.ts copiar            copia o que falta (cópia no próprio storage; não lê conteúdo)
//   npx tsx scripts/r2-migrar-privado.ts verificar         confere CADA objeto (tamanho + ETag + tipo) e grava o manifesto
//   EU_CONFIRMO_APAGAR_DO_PUBLICO=sim npx tsx scripts/r2-migrar-privado.ts apagar-do-publico
//                                                          apaga do PÚBLICO, chave a chave, SÓ o que o manifesto garante
//
// Nada daqui lê o CONTEÚDO dos arquivos (procurações têm CPF/RG): a prova de igualdade é tamanho + ETag (a
// impressão digital que o storage calcula) + tipo. O apagamento exige: manifesto 100% ok, verificado há ≥ 24 h
// (a observação combinada), a variável de confirmação, e re-confere cada objeto no destino ANTES de apagar.
// ============================================================================
process.loadEnvFile(".env")
import { writeFileSync, readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const MANIFESTO = process.env.MANIFESTO ?? join(homedir(), "r2-manifesto-privado.json")
const HORAS_OBSERVACAO = 24

interface Linha { chave: string; tamanho: number; etag: string; tipo: string; ok: boolean }

async function main() {
  const modo = process.argv[2]
  const { r2 } = await import("../src/lib/r2")
  const { ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3")
  const PUB = process.env.R2_BUCKET_NAME!
  const PRIV = (process.env.R2_BUCKET_PRIVADO ?? "discovery-privado").trim()
  if (!PUB || !PRIV || PUB === PRIV) throw new Error("buckets mal configurados")
  console.log(`origem (público): ${PUB} · destino (privado): ${PRIV}`)

  const head = async (bucket: string, key: string) => r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then((h) => ({ tamanho: h.ContentLength ?? -1, etag: String(h.ETag ?? ""), tipo: String(h.ContentType ?? "") })).catch((e: any) => (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" ? null : Promise.reject(e)))
  async function listarPublico(): Promise<string[]> {
    const out: string[] = []; let token: string | undefined
    do { const r = await r2.send(new ListObjectsV2Command({ Bucket: PUB, Prefix: "privado/", ContinuationToken: token, MaxKeys: 1000 })); for (const o of r.Contents ?? []) out.push(o.Key!); token = r.IsTruncated ? r.NextContinuationToken : undefined } while (token)
    return out.sort()
  }

  if (modo === "copiar") {
    const chaves = await listarPublico()
    let copiados = 0, jaTinham = 0
    for (const k of chaves) {
      if (await head(PRIV, k)) { jaTinham++; continue }
      await r2.send(new CopyObjectCommand({ Bucket: PRIV, Key: k, CopySource: `${PUB}/${k}` }))
      copiados++
    }
    console.log(`copiar: ${chaves.length} no público · ${copiados} copiados agora · ${jaTinham} já estavam no privado`)
  } else if (modo === "verificar") {
    const chaves = await listarPublico()
    const linhas: Linha[] = []
    for (const k of chaves) {
      const a = await head(PUB, k), b = await head(PRIV, k)
      const ok = !!a && !!b && a.tamanho === b.tamanho && a.etag === b.etag && a.tipo === b.tipo
      linhas.push({ chave: k, tamanho: a?.tamanho ?? -1, etag: a?.etag ?? "", tipo: a?.tipo ?? "", ok })
      if (!ok) console.log(`  ✗ DIVERGE/AUSENTE: ${k.split("/").slice(0, 3).join("/")}/… origem=${JSON.stringify(a)} destino=${JSON.stringify(b)}`)
    }
    const todosOk = linhas.length > 0 && linhas.every((l) => l.ok)
    writeFileSync(MANIFESTO, JSON.stringify({ verificadoEm: new Date().toISOString(), publico: PUB, privado: PRIV, todosOk, total: linhas.length, bytes: linhas.reduce((s, l) => s + l.tamanho, 0), linhas }, null, 2))
    console.log(`verificar: ${linhas.filter((l) => l.ok).length}/${linhas.length} idênticos (tamanho + ETag + tipo) · manifesto: ${MANIFESTO}`)
    if (!todosOk) process.exit(1)
  } else if (modo === "apagar-do-publico") {
    if (process.env.EU_CONFIRMO_APAGAR_DO_PUBLICO !== "sim") throw new Error("falta EU_CONFIRMO_APAGAR_DO_PUBLICO=sim")
    if (!existsSync(MANIFESTO)) throw new Error("manifesto não existe — rode `verificar` antes")
    const m = JSON.parse(readFileSync(MANIFESTO, "utf8")) as { verificadoEm: string; todosOk: boolean; linhas: Linha[]; publico: string; privado: string }
    if (!m.todosOk || m.publico !== PUB || m.privado !== PRIV) throw new Error("manifesto não está 100% ok ou é de outros buckets")
    const horas = (Date.now() - new Date(m.verificadoEm).getTime()) / 3600000
    if (horas < HORAS_OBSERVACAO) throw new Error(`observação de ${HORAS_OBSERVACAO} h não cumprida: manifesto verificado há ${horas.toFixed(1)} h`)
    // o que existe hoje no público tem que ser EXATAMENTE o que o manifesto cobre (nada novo, nada fora)
    const hoje = await listarPublico()
    const noManifesto = new Set(m.linhas.map((l) => l.chave))
    const extras = hoje.filter((k) => !noManifesto.has(k))
    if (extras.length) throw new Error(`há ${extras.length} objeto(s) em privado/ no público fora do manifesto — rode copiar + verificar de novo`)
    let apagados = 0
    for (const l of m.linhas) {
      const dest = await head(PRIV, l.chave)
      if (!dest || dest.tamanho !== l.tamanho || dest.etag !== l.etag) throw new Error(`destino não confere para ${l.chave.split("/").slice(0, 3).join("/")}/… — ABORTADO (apagados até aqui: ${apagados})`)
      if (!l.chave.startsWith("privado/")) throw new Error("chave fora de privado/ — ABORTADO")
      await r2.send(new DeleteObjectCommand({ Bucket: PUB, Key: l.chave }))
      apagados++
    }
    console.log(`apagar-do-publico: ${apagados} apagados do público (cada um re-conferido no privado antes)`)
    const R2URL = process.env.R2_PUBLIC_URL!
    let abrem = 0
    for (const l of m.linhas) { const s = (await fetch(`${R2URL}/${l.chave}`, { method: "HEAD" })).status; if (s !== 404) abrem++ }
    console.log(`depois: ${m.linhas.length - abrem}/${m.linhas.length} respondem 404 no endereço público · ainda abrem: ${abrem}`)
    if (abrem) process.exit(1)
  } else {
    throw new Error("uso: copiar | verificar | apagar-do-publico")
  }
  process.exit(0)
}
main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1) })
