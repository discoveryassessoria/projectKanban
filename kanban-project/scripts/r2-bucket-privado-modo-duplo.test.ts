// scripts/r2-bucket-privado-modo-duplo.test.ts
// ============================================================================
// BUCKET PRIVADO — MODO ÚNICO × MODO DUPLO (passo 1 do bloco P0; docs/coleta-de-dados-mandato.md §8b).
//
// PROVA, sem tocar em storage nenhum (o cliente S3 é substituído por um armazenamento em memória):
//   MODO ÚNICO (R2_BUCKET_PRIVADO ausente = produção até o OK do usuário): NADA muda — tudo no bucket de sempre,
//     nenhuma chamada extra ao storage (nenhum HEAD), as mesmas URLs/cópias de antes;
//   MODO DUPLO (variável presente): grava/apaga no privado; lê do privado e cai no antigo (plano B) sem ficar sem
//     acesso; erro que NÃO é "não existe" nunca vira plano B; chave que não é `privado/` nunca vai ao privado;
//     a cópia da conferência vai do privado para o público (com plano B de ler-e-gravar);
//   NENHUM fluxo apaga do bucket público o que o plano B deixou lá.
//
//   npx tsx scripts/r2-bucket-privado-modo-duplo.test.ts
// ============================================================================
import { readFileSync } from "node:fs"

// Ambiente do teste (nunca o real): valores fixos e o storage substituído abaixo.
process.env.R2_ACCOUNT_ID = "conta-teste"
process.env.R2_ACCESS_KEY_ID = "chave-teste"
process.env.R2_SECRET_ACCESS_KEY = "segredo-teste"
process.env.R2_BUCKET_NAME = "bucket-publico-teste"
process.env.R2_PUBLIC_URL = "https://pub.exemplo.test"
delete process.env.R2_BUCKET_PRIVADO

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra: unknown = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra === "" ? "" : ` — ${JSON.stringify(extra)}`}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const PUB = "bucket-publico-teste"
const PRIV = "bucket-privado-teste"

async function main() {
  const { configDosBuckets, bucketDeEscrita, bucketsDeLeitura, ehChavePrivada, modoDuploParaChave } = await import("../src/lib/r2-buckets")
  const { r2 } = await import("../src/lib/r2")
  const sp = await import("../src/lib/documentos/modelos/storage-privado")
  const sc = await import("../src/services/coleta/storage-coleta")

  // ── armazenamento em memória no lugar do S3 ────────────────────────────────
  type Obj = { corpo: Buffer; mime?: string }
  const store = new Map<string, Obj>() // "bucket/chave"
  const chamadas: string[] = []
  let copiaEntreBucketsFalha = false
  let erroNoHeadDoPrivado: { name: string; status: number } | null = null
  const k = (b: string, key: string) => `${b}/${key}`
  const naoExiste = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })
  ;(r2 as unknown as { send: (c: { constructor: { name: string }; input: Record<string, any> }) => Promise<unknown> }).send = async (cmd) => {
    const nome = cmd.constructor.name
    const i = cmd.input
    chamadas.push(`${nome} ${i.Bucket}/${i.Key}`)
    if (nome === "PutObjectCommand") { store.set(k(i.Bucket, i.Key), { corpo: Buffer.from(i.Body ?? ""), mime: i.ContentType }); return {} }
    if (nome === "GetObjectCommand") {
      const o = store.get(k(i.Bucket, i.Key)); if (!o) throw naoExiste()
      return { Body: { transformToByteArray: async () => new Uint8Array(o.corpo) }, ContentType: o.mime }
    }
    if (nome === "HeadObjectCommand") {
      if (erroNoHeadDoPrivado && i.Bucket === PRIV) throw Object.assign(new Error(erroNoHeadDoPrivado.name), { name: erroNoHeadDoPrivado.name, $metadata: { httpStatusCode: erroNoHeadDoPrivado.status } })
      const o = store.get(k(i.Bucket, i.Key)); if (!o) throw naoExiste()
      return { ContentLength: o.corpo.length, ContentType: o.mime }
    }
    if (nome === "CopyObjectCommand") {
      const [bOrigem, ...resto] = String(i.CopySource).split("/")
      if (copiaEntreBucketsFalha && bOrigem !== i.Bucket) throw Object.assign(new Error("NotImplemented"), { name: "NotImplemented", $metadata: { httpStatusCode: 501 } })
      const o = store.get(k(bOrigem, resto.join("/"))); if (!o) throw naoExiste()
      store.set(k(i.Bucket, i.Key), { ...o }); return {}
    }
    if (nome === "DeleteObjectCommand") { store.delete(k(i.Bucket, i.Key)); return {} }
    throw new Error(`comando não esperado: ${nome}`)
  }
  const avisos: string[] = []
  const warnOriginal = console.warn
  console.warn = (...a: unknown[]) => { avisos.push(a.join(" ")) }
  const zerar = () => { chamadas.length = 0; avisos.length = 0 }
  const so = (prefixo: string) => chamadas.filter((c) => c.startsWith(prefixo))

  secao("A) Regra pura: qual bucket guarda o quê")
  const unico = configDosBuckets({ R2_BUCKET_NAME: PUB })
  const duplo = configDosBuckets({ R2_BUCKET_NAME: PUB, R2_BUCKET_PRIVADO: PRIV })
  ok("sem a variável: privado = null (modo único)", unico.privado === null && unico.publico === PUB)
  ok("variável vazia ou só espaços: modo único", configDosBuckets({ R2_BUCKET_NAME: PUB, R2_BUCKET_PRIVADO: "  " }).privado === null)
  ok("variável igual ao bucket público: modo único (não há segundo bucket)", configDosBuckets({ R2_BUCKET_NAME: PUB, R2_BUCKET_PRIVADO: PUB }).privado === null)
  ok("chave privada reconhecida só pelo prefixo `privado/`", ehChavePrivada("privado/documentos/x") && !ehChavePrivada("documentos/x") && !ehChavePrivada("contratantes/privado/x"))
  ok("modo único: escrita e leitura no público, nenhuma volta", bucketDeEscrita("privado/a", unico) === PUB && bucketsDeLeitura("privado/a", unico).join() === PUB)
  ok("modo duplo, chave privada: escreve no privado; lê privado e depois público", bucketDeEscrita("privado/a", duplo) === PRIV && bucketsDeLeitura("privado/a", duplo).join() === `${PRIV},${PUB}`)
  ok("modo duplo, chave NÃO privada (anexo de cliente): sempre o público", bucketDeEscrita("documentos/a", duplo) === PUB && bucketsDeLeitura("documentos/a", duplo).join() === PUB && !modoDuploParaChave("documentos/a", duplo))

  secao("B) MODO ÚNICO — produção hoje: nada muda")
  zerar()
  const g = await sp.gravarObjetoPrivado({ buffer: Buffer.from("conteudo"), nomeVisivel: "Doc Teste.docx", mime: sp.MIME_DOCX, pasta: "gerados" })
  ok("grava no bucket de sempre (público) e em nenhum outro", store.has(k(PUB, g.chave)) && ![...store.keys()].some((x) => x.startsWith(PRIV)), [...store.keys()])
  ok("a chave continua em `privado/documentos/…`", g.chave.startsWith("privado/documentos/gerados/"))
  zerar()
  ok("lê do bucket de sempre", (await sp.lerObjetoPrivado(g.chave)).toString() === "conteudo" && so("GetObjectCommand").every((c) => c.includes(`${PUB}/`)))
  const url1 = await sp.urlAssinadaDeLeitura({ chave: g.chave, nomeParaDownload: "x.docx", mime: sp.MIME_DOCX, download: true })
  ok("URL assinada aponta para o bucket de sempre", url1.startsWith(`https://${PUB}.`), url1.slice(0, 120))
  ok("NENHUMA chamada extra ao storage para assinar (zero HEAD) — o custo e o comportamento são os de hoje", so("HeadObjectCommand").length === 0, chamadas)
  const up = await sc.urlDeEnvioColeta({ linkId: 7, nome: "rg.pdf", mime: "application/pdf", tamanho: 4 })
  ok("envio da coleta: URL assinada para o bucket de sempre", up.url.startsWith(`https://${PUB}.`) && up.url.includes("/privado/coleta/7/") && up.chave.startsWith("privado/coleta/7/"))
  store.set(k(PUB, up.chave), { corpo: Buffer.from("%PDF"), mime: "application/pdf" })
  ok("conferirObjetoColeta confere tamanho e tipo", (await sc.conferirObjetoColeta(up.chave, 4, "application/pdf")) === true && (await sc.conferirObjetoColeta(up.chave, 5, "application/pdf")) === false && (await sc.conferirObjetoColeta(up.chave, 4, "image/png")) === false)
  zerar()
  let recusou = false
  try { await sc.copiarParaAnexoDeCliente(up.chave, "TESTE rg.pdf", { dominio: "contratante", id: 5 }) } catch (e) { recusou = (e as Error).constructor.name === "BucketPrivadoNaoConfigurado" }
  ok("modo único: a confirmação da coleta RECUSA gravar o anexo (nunca cai no bucket público)", recusou && !chamadas.some((c) => c.startsWith("CopyObjectCommand")))
  await sp.removerObjetoPrivado(g.chave)
  ok("remover apaga no bucket de sempre", !store.has(k(PUB, g.chave)))

  secao("C) MODO DUPLO — variável presente")
  process.env.R2_BUCKET_PRIVADO = PRIV
  store.clear(); zerar()
  const g2 = await sp.gravarObjetoPrivado({ buffer: Buffer.from("novo"), nomeVisivel: "Novo.docx", mime: sp.MIME_DOCX, pasta: "gerados" })
  ok("grava SÓ no bucket privado — o público não recebe nada novo", store.has(k(PRIV, g2.chave)) && ![...store.keys()].some((x) => x.startsWith(`${PUB}/`)))
  zerar()
  ok("lê do privado, sem plano B e sem aviso", (await sp.lerObjetoPrivado(g2.chave)).toString() === "novo" && avisos.length === 0 && so("GetObjectCommand").length === 1)
  const urlNovo = await sp.urlAssinadaDeLeitura({ chave: g2.chave, nomeParaDownload: "n.docx", mime: sp.MIME_DOCX, download: false })
  ok("URL assinada do objeto novo aponta para o bucket PRIVADO", urlNovo.startsWith(`https://${PRIV}.`) && urlNovo.includes("/privado/"), urlNovo.slice(0, 120))

  // objeto antigo: existe só no público (como os 43 de hoje, antes da cópia)
  const chaveAntiga = "privado/documentos/gerados/uuid-antigo/Antigo.docx"
  store.set(k(PUB, chaveAntiga), { corpo: Buffer.from("antigo"), mime: sp.MIME_DOCX })
  zerar()
  ok("objeto SÓ no antigo: a leitura pelo servidor cai no plano B e funciona", (await sp.lerObjetoPrivado(chaveAntiga)).toString() === "antigo")
  ok("…e registra a leitura no bucket antigo (sem nome de arquivo no log)", avisos.some((a) => a.includes("LEITURA_NO_BUCKET_ANTIGO") && a.includes("privado/documentos/gerados")) && !avisos.some((a) => a.includes("Antigo.docx")), avisos)
  zerar()
  const urlAntiga = await sp.urlAssinadaDeLeitura({ chave: chaveAntiga, nomeParaDownload: "a.docx", mime: sp.MIME_DOCX, download: true })
  ok("URL assinada do objeto antigo aponta para o bucket onde ele está (público) — nunca fica sem acesso", urlAntiga.startsWith(`https://${PUB}.`) && urlAntiga.includes("/privado/documentos/gerados/uuid-antigo") && avisos.length === 1, urlAntiga.slice(0, 140))
  // depois da cópia verificada, o novo passa a valer
  store.set(k(PRIV, chaveAntiga), { corpo: Buffer.from("antigo"), mime: sp.MIME_DOCX })
  zerar()
  const urlCopiada = await sp.urlAssinadaDeLeitura({ chave: chaveAntiga, nomeParaDownload: "a.docx", mime: sp.MIME_DOCX, download: true })
  ok("objeto nos DOIS buckets: usa o privado e não registra plano B", urlCopiada.startsWith(`https://${PRIV}.`) && avisos.length === 0)
  store.delete(k(PRIV, chaveAntiga))
  const chaveFantasma = "privado/documentos/gerados/nao-existe/x.docx"
  const urlFantasma = await sp.urlAssinadaDeLeitura({ chave: chaveFantasma, nomeParaDownload: "x.docx", mime: sp.MIME_DOCX, download: true })
  ok("objeto em nenhum bucket: assina contra o novo (o storage responde 404, como antes)", urlFantasma.startsWith(`https://${PRIV}.`))

  secao("C2) Erro que NÃO é 'não existe' nunca vira plano B (não esconde problema de acesso)")
  erroNoHeadDoPrivado = { name: "AccessDenied", status: 403 }
  let falhouAcesso = false
  try { await sp.urlAssinadaDeLeitura({ chave: chaveAntiga, nomeParaDownload: "a.docx", mime: sp.MIME_DOCX, download: true }) } catch { falhouAcesso = true }
  ok("acesso negado ao bucket novo: a assinatura FALHA (alto), não cai no antigo em silêncio", falhouAcesso)
  ok("conferirObjetoColeta com acesso negado: false (nunca aceita o arquivo)", (await sc.conferirObjetoColeta(chaveAntiga, 6, sp.MIME_DOCX)) === false)
  erroNoHeadDoPrivado = null

  secao("C3) Apagar: só no bucket de escrita — nada some do público")
  store.set(k(PUB, "privado/coleta/9/uuid/legado.pdf"), { corpo: Buffer.from("l"), mime: "application/pdf" })
  zerar()
  await sp.removerObjetoPrivado("privado/coleta/9/uuid/legado.pdf")
  ok("remover manda o DeleteObject ao bucket PRIVADO, nunca ao público", so("DeleteObjectCommand").length === 1 && so("DeleteObjectCommand")[0].includes(`${PRIV}/`))
  ok("o objeto legado no público continua lá (apagar do público é ato separado, com autorização)", store.has(k(PUB, "privado/coleta/9/uuid/legado.pdf")))

  secao("C4) Coleta em modo duplo")
  const up2 = await sc.urlDeEnvioColeta({ linkId: 7, nome: "comprovante.pdf", mime: "application/pdf", tamanho: 4 })
  ok("envio do cliente: URL assinada de escrita para o bucket PRIVADO", up2.url.startsWith(`https://${PRIV}.`) && up2.url.includes("/privado/coleta/7/"))
  store.set(k(PRIV, up2.chave), { corpo: Buffer.from("%PDF"), mime: "application/pdf" })
  ok("conferência do arquivo enviado lê do privado", (await sc.conferirObjetoColeta(up2.chave, 4, "application/pdf")) === true)
  zerar()
  const a1 = await sc.copiarParaAnexoDeCliente(up2.chave, "TESTE comprovante.pdf", { dominio: "contratante", id: 5 })
  ok("confirmação: cópia DENTRO do bucket PRIVADO (privado/anexos/contratante/5/…), o banco recebe só a CHAVE, nada vai ao público",
    chamadas.some((c) => c.startsWith(`CopyObjectCommand ${PRIV}/privado/anexos/contratante/5/`)) && store.has(k(PRIV, a1.key)) && a1.url === a1.key && a1.key.startsWith("privado/anexos/contratante/5/") && ![...store.keys()].some((x) => x.startsWith(`${PUB}/privado/anexos`)))
  copiaEntreBucketsFalha = true
  zerar()
  const a2 = await sc.copiarParaAnexoDeCliente(up2.chave, "TESTE comprovante 2.pdf", { dominio: "requerente", id: 6 })
  ok("origem e destino no MESMO bucket privado: a cópia direta basta e o anexo fica no privado", store.has(k(PRIV, a2.key)) && a2.key.startsWith("privado/anexos/requerente/6/") && !store.has(k(PUB, a2.key)))
  copiaEntreBucketsFalha = false
  // arquivo da coleta que só está no antigo (enviado antes da troca)
  const chaveColetaAntiga = "privado/coleta/3/uuid/antigo.pdf"
  store.set(k(PUB, chaveColetaAntiga), { corpo: Buffer.from("%PDF"), mime: "application/pdf" })
  zerar()
  copiaEntreBucketsFalha = true
  const a3 = await sc.copiarParaAnexoDeCliente(chaveColetaAntiga, "TESTE antigo.pdf", { dominio: "contratante", id: 5 })
  copiaEntreBucketsFalha = false
  ok("arquivo da coleta só no bucket antigo: copia dele para o PRIVADO (lendo e gravando pelo servidor se o storage não aceitar a cópia entre buckets)", store.get(k(PRIV, a3.key))?.corpo.toString() === "%PDF" && !store.has(k(PUB, a3.key)))

  secao("D) Chave que NÃO é `privado/` (anexos de cliente) nunca vai ao bucket privado")
  zerar()
  ok("escrita e leitura no público, com a variável ligada", bucketDeEscrita("documentos/x.pdf", configDosBuckets()) === PUB && bucketsDeLeitura("documentos/x.pdf", configDosBuckets()).join() === PUB)

  console.warn = warnOriginal

  secao("E) Varredura de fonte")
  const sem = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const fonteP = sem(readFileSync("src/lib/documentos/modelos/storage-privado.ts", "utf8"))
  const fonteC = sem(readFileSync("src/services/coleta/storage-coleta.ts", "utf8"))
  ok("storage-privado: nenhum comando de storage usa o bucket único direto (tudo passa pelo resolvedor)", !/Bucket:\s*R2_BUCKET\b/.test(fonteP))
  ok("storage-privado: não monta URL pública", !/R2_PUBLIC_URL/.test(fonteP))
  ok("storage-coleta: nenhum uso do bucket público nem de URL pública (a confirmação move dentro do PRIVADO)", !/\bR2_BUCKET\b/.test(fonteC) && !/R2_PUBLIC_URL/.test(fonteC) && !/DeleteObjectCommand/.test(fonteC))
  const todos = ["src/app/api/storage/presign/route.ts", "src/app/api/app/upload/presign/route.ts"].map((f) => readFileSync(f, "utf8")).join("\n")
  ok("rotas de upload: a CHAVE nasce no servidor (prepararEnvioDeAnexo, sempre no bucket privado); o navegador não escolhe pasta nem bucket e nenhuma monta endereço público", /prepararEnvioDeAnexo/.test(todos) && !/\bprefix\b/.test(todos.replace(/\/\/.*$/gm, "")) && !/R2_PUBLIC_URL|R2_BUCKET\b/.test(todos))
  ok("o comentário falso ('nunca servido pelo domínio público') saiu do código", !/nunca servido pelo dom[ií]nio p[uú]blico|Nada aqui [ée] servido pelo dom[ií]nio p[uú]blico/i.test(readFileSync("src/lib/documentos/modelos/storage-privado.ts", "utf8") + readFileSync("src/services/coleta/storage-coleta.ts", "utf8")))

  console.log(`\n${passou + falhou} verificações · ${falhou === 0 ? "BUCKET PRIVADO (passo 1) OK ✅" : "FALHOU ❌"}`)
  process.exit(falhou === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
