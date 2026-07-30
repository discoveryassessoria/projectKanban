/**
 * MRG — LEITURA VISUAL CONTRA A API DE VERDADE.
 *
 * Rodar (gasta dinheiro de verdade; exige ANTHROPIC_API_KEY):
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
 *   npx tsx scripts/mrg-visao-ao-vivo.test.ts
 *
 * A DIFERENÇA para `mrg-importacao.test.ts`: lá o transporte HTTP é injetado e a
 * resposta do modelo é conhecida. Aqui não há dublê nenhum — a chamada sai para
 * a Anthropic e o que volta é o que o modelo enxergou.
 *
 * OS DOCUMENTOS SÃO IMAGENS DE VERDADE. Cada certidão é composta em PDF e depois
 * RASTERIZADA para PNG (`sips`), o que joga fora a camada de texto: o que sobe
 * para a API é pixel, exatamente como uma foto de celular ou um escaneamento.
 * Duas delas ainda são inclinadas e reduzidas, para reproduzir foto torta e de
 * baixa resolução. Se o pipeline dependesse de extração de texto, nada disso
 * seria lido — e é justamente esse o ponto.
 *
 * O conteúdo das certidões é fictício (nomes inventados). Não se usa documento de
 * cliente para teste: mandar dado real de terceiro para fora por curiosidade de
 * verificação seria abuso, e o que se quer provar aqui é a leitura, não a pessoa.
 *
 * TRAVA DE SEGURANÇA: aborta se o banco não for local. Este teste ESCREVE.
 */

export {}

import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import type { AddressInfo } from "node:net"

// ---------------------------------------------------------------- travas
const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
const HOST = (() => {
  try {
    return new URL(URL_DB).hostname.toLowerCase()
  } catch {
    return ""
  }
})()
if (!new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]).has(HOST)) {
  console.error(`\n❌ ABORTADO: banco "${HOST}" não é local. Este teste ESCREVE.\n`)
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY ausente — este teste chama a API de verdade.\n")
  process.exit(1)
}

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

// ---------------------------------------------------------------- composição

/** PDF com texto, só como passo intermediário — ele NÃO chega à API. */
function pdfComTexto(linhas: string[], tamanho = 13): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  const conteudo = [
    "BT",
    `/F1 ${tamanho} Tf`,
    ...linhas.map((l, i) => `1 0 0 1 45 ${790 - i * 24} Tm (${esc(l)}) Tj`),
    "ET",
  ].join("\n")
  const fluxo = deflateSync(Buffer.from(conteudo, "latin1"))
  const objetos: Buffer[] = []
  const push = (s: string | Buffer) => objetos.push(Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"))
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
  )
  push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\nendobj\n")
  push(
    Buffer.concat([
      Buffer.from(`5 0 obj\n<< /Length ${fluxo.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
      fluxo,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]),
  )
  const cab = Buffer.from("%PDF-1.4\n", "latin1")
  const pos: number[] = []
  let off = cab.length
  for (const o of objetos) {
    pos.push(off)
    off += o.length
  }
  const corpo = Buffer.concat([cab, ...objetos])
  const x = corpo.length
  const xref = [
    `xref\n0 ${objetos.length + 1}\n`,
    "0000000000 65535 f \n",
    ...pos.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`,
  ].join("")
  return Buffer.concat([corpo, Buffer.from(xref, "latin1")])
}

const DIR = mkdtempSync(join(tmpdir(), "mrg-visao-"))

/**
 * Compõe a certidão e a RASTERIZA. O PNG resultante não tem camada de texto —
 * é imagem, e só a visão a lê.
 */
function certidaoEscaneada(
  nome: string,
  linhas: string[],
  opcoes: { inclinar?: number; largura?: number } = {},
): Buffer {
  const pdf = join(DIR, `${nome}.pdf`)
  const png = join(DIR, `${nome}.png`)
  writeFileSync(pdf, pdfComTexto(linhas))
  execFileSync("sips", ["-s", "format", "png", pdf, "--out", png], { stdio: "pipe" })
  if (opcoes.largura) execFileSync("sips", ["-Z", String(opcoes.largura), png], { stdio: "pipe" })
  // `sips -r` só aceita graus positivos; inclinação para o outro lado é 360 - x.
  if (opcoes.inclinar) {
    const graus = opcoes.inclinar < 0 ? 360 + opcoes.inclinar : opcoes.inclinar
    execFileSync("sips", ["-r", String(graus), png], { stdio: "pipe" })
  }
  return readFileSync(png)
}

// ---------------------------------------------------------------- o acervo

const CERTIDOES = [
  {
    nome: "nascimento-joao.png",
    // Foto reta, boa qualidade.
    opcoes: {},
    linhas: [
      "REPUBLICA FEDERATIVA DO BRASIL",
      "REGISTRO CIVIL DAS PESSOAS NATURAIS",
      "CERTIDAO DE NASCIMENTO",
      "",
      "Nome: JOAO BATISTA BIANCHI",
      "Data de nascimento: 10 de maio de 1990",
      "Local de nascimento: Bento Goncalves - RS",
      "Sexo: masculino",
      "",
      "Filiacao:",
      "Pai: ANTONIO BIANCHI",
      "Mae: MARIA SOUZA",
      "",
      "Aos dez dias do mes de maio de mil novecentos e noventa, nesta cidade",
      "de Bento Goncalves, nasceu JOAO BATISTA BIANCHI, do sexo masculino,",
      "filho de ANTONIO BIANCHI e de MARIA SOUZA.",
      "",
      "Livro: A-42   Folha: 018   Termo: 9911",
      "1o Oficio de Registro Civil de Bento Goncalves",
    ],
  },
  {
    nome: "nascimento-antonio.png",
    // Foto torta e reduzida — o caso difícil.
    opcoes: { inclinar: 3, largura: 1000 },
    linhas: [
      "REGISTRO CIVIL DAS PESSOAS NATURAIS",
      "CERTIDAO DE NASCIMENTO",
      "",
      "Nome: ANTONIO BIANCHI",
      "Data de nascimento: 20 de fevereiro de 1960",
      "Local de nascimento: Bento Goncalves - RS",
      "Profissao do pai: lavrador",
      "",
      "Filiacao:",
      "Pai: GIUSEPPE BIANCHI",
      "Mae: ROSA FERRARI",
      "",
      "Aos vinte dias do mes de fevereiro de mil novecentos e sessenta,",
      "nesta cidade, nasceu ANTONIO BIANCHI, filho de GIUSEPPE BIANCHI,",
      "de nacionalidade italiana, e de ROSA FERRARI.",
      "",
      "Livro: A-11   Folha: 233",
    ],
  },
  {
    nome: "atto-nascita-giuseppe.png",
    // Certidão italiana, papel envelhecido simulado por redução forte.
    opcoes: { inclinar: -2, largura: 900 },
    linhas: [
      "COMUNE DI VICENZA",
      "UFFICIO DELLO STATO CIVILE",
      "ESTRATTO DELL'ATTO DI NASCITA",
      "",
      "Cognome e nome: BIANCHI GIUSEPPE",
      "Data di nascita: 12 gennaio 1923",
      "Luogo di nascita: Vicenza",
      "",
      "Paternita: PIETRO BIANCHI",
      "Maternita: ANNA MARIA ROSSI",
      "",
      "L'anno millenovecentoventitre, addi dodici del mese di gennaio,",
      "in questo Comune di Vicenza e nato BIANCHI GIUSEPPE,",
      "figlio di PIETRO BIANCHI e di ANNA MARIA ROSSI.",
      "",
      "Numero: 144   Parte I   Serie A",
    ],
  },
]

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { analisarImportacao } = await import("@/src/services/registral/importacao")
  const { situacaoDaVisao } = await import("@/src/services/registral/visao/cliente")

  const SUFIXO = `mrg-vivo-${process.pid}`

  console.log("\n0) OS DOCUMENTOS — compostos, rasterizados e servidos como imagem")
  const arquivosServidos = new Map<string, Buffer>()
  for (const c of CERTIDOES) {
    const png = certidaoEscaneada(c.nome.replace(/\.png$/, ""), c.linhas, c.opcoes)
    arquivosServidos.set(c.nome, png)
    console.log(`  · ${c.nome} — ${(png.length / 1024).toFixed(0)} KB de imagem`)
  }
  ok(
    [...arquivosServidos.values()].every((b) => b[0] === 0x89 && b[1] === 0x50),
    "as três certidões são PNG de verdade (sem camada de texto)",
  )

  const servidor = createServer((req, res) => {
    const dados = arquivosServidos.get(decodeURIComponent((req.url ?? "").replace(/^\//, "")))
    if (!dados) {
      res.writeHead(404).end("nao encontrado")
      return
    }
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(dados.length) })
    res.end(dados)
  })
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  const arquivos = CERTIDOES.map((c) => ({
    url: `${base}/${encodeURIComponent(c.nome)}`,
    nome: c.nome,
    mimeType: "image/png",
    tamanho: arquivosServidos.get(c.nome)?.length ?? 0,
  }))

  ok(situacaoDaVisao().disponivel, "a leitura visual está ligada", { modelo: situacaoDaVisao().modelo })

  try {
    console.log("\n1) SEED — árvore só com o requerente")
    await prisma.$transaction(async (tx) => {
      const procs = await tx.processo.findMany({ where: { nome: { startsWith: SUFIXO } }, select: { id: true, arvoreId: true } })
      for (const p of procs) {
        if (p.arvoreId != null) {
          await tx.pessoa.updateMany({ where: { arvoreId: p.arvoreId }, data: { paiId: null, maeId: null } })
          await tx.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
        }
        await tx.processo.delete({ where: { id: p.id } })
        if (p.arvoreId != null) await tx.arvore.delete({ where: { id: p.arvoreId } }).catch(() => undefined)
      }
    })
    const arvore = await prisma.arvore.create({ data: { nome: `${SUFIXO}-arvore` }, select: { id: true } })
    const processo = await prisma.processo.create({
      data: { nome: `${SUFIXO}-processo`, pais: "Italia", arvoreId: arvore.id, workflowRuntime: "v2" },
      select: { id: true },
    })
    const requerente = await prisma.pessoa.create({
      data: {
        nome: "Joao Batista",
        sobrenome: "Bianchi",
        sexo: "M",
        data_nasc: new Date("1990-05-10T12:00:00Z"),
        arvoreId: arvore.id,
        requerente: "sim",
        linhaReta: true,
      },
      select: { id: true },
    })
    ok(!!requerente.id, "requerente cadastrado; o resto tem de vir das imagens")

    console.log("\n2) LEITURA AO VIVO — 3 imagens × 2 leituras independentes")
    const t0 = Date.now()
    const analise = await analisarImportacao({ processoId: processo.id, arquivos })
    const segundos = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  · ${segundos}s · US$ ${analise.leitura.custo?.custoUsd.toFixed(4) ?? "?"} · ${analise.leitura.modelo}`)

    ok(analise.leitura.provedor === "anthropic_visao", "a leitura veio da visão, não de camada de texto")
    ok(analise.resumo.legiveis === 3, "as três imagens foram lidas", analise.resumo)

    const porNome = new Map(analise.arquivos.map((a) => [a.nome, a]))
    ok(porNome.get("nascimento-joao.png")?.tipo === "NASCIMENTO", "certidão de nascimento classificada", porNome.get("nascimento-joao.png")?.tipo)
    ok(porNome.get("nascimento-antonio.png")?.tipo === "NASCIMENTO", "foto TORTA e reduzida também foi classificada", porNome.get("nascimento-antonio.png")?.tipo)
    ok(porNome.get("atto-nascita-giuseppe.png")?.tipo === "NASCIMENTO", "certidão ITALIANA classificada", porNome.get("atto-nascita-giuseppe.png")?.tipo)

    console.log("\n3) A ÁRVORE QUE SAIU DAS IMAGENS")
    const nome = (chave: string) => {
      const n = analise.nos.find((x) => x.chave === chave)
      return n ? [n.nome, n.sobrenome].filter(Boolean).join(" ") : chave
    }
    for (const n of analise.nos) {
      const marca = n.nova ? "novo" : `existente #${n.pessoaId}`
      console.log(`  · ${[n.nome, n.sobrenome].filter(Boolean).join(" ")} (${marca}) — ${n.dados.length} dado(s), ${n.documentos.length} certidão(ões)`)
    }
    for (const v of analise.vinculos) {
      console.log(`  → ${nome(v.paraChave)} é ${v.tipo === "FILIACAO_PAI" ? "pai" : v.tipo === "FILIACAO_MAE" ? "mãe" : "cônjuge"} de ${nome(v.deChave)}`)
    }

    const acha = (alvo: string) =>
      analise.nos.find((n) => [n.nome, n.sobrenome].filter(Boolean).join(" ").toUpperCase().includes(alvo))
    const joao = acha("JOAO BATISTA")
    const antonio = acha("ANTONIO")
    const giuseppe = acha("GIUSEPPE")
    const pietro = acha("PIETRO")
    const maria = acha("MARIA SOUZA")
    const rosa = acha("ROSA")

    ok(!!joao && joao.pessoaId === requerente.id, "o requerente foi reconhecido pela foto, não duplicado", joao?.pessoaId)
    ok(!!antonio, "o pai apareceu")
    ok(!!maria, "a mãe apareceu")
    ok(!!giuseppe, "o avô apareceu (veio da segunda certidão)")
    ok(!!pietro, "o bisavô apareceu (veio da certidão italiana)")
    ok(!!rosa, "a avó apareceu")

    const temVinculo = (tipo: string, de?: { chave: string }, para?: { chave: string }) =>
      !!de && !!para && analise.vinculos.some((v) => v.tipo === tipo && v.deChave === de.chave && v.paraChave === para.chave)
    ok(temVinculo("FILIACAO_PAI", joao, antonio), "João → pai Antonio")
    ok(temVinculo("FILIACAO_MAE", joao, maria), "João → mãe Maria")
    ok(temVinculo("FILIACAO_PAI", antonio, giuseppe), "Antonio → pai Giuseppe")
    ok(temVinculo("FILIACAO_PAI", giuseppe, pietro), "Giuseppe → pai Pietro")
    ok(analise.resumo.geracoes >= 4, "quatro gerações saíram de três fotografias", analise.resumo.geracoes)

    console.log("\n4) OS DADOS LIDOS, COM A EVIDÊNCIA")
    const dataJoao = joao?.dados.find((d) => d.campo === "DATA_NASCIMENTO")
    ok(dataJoao?.valor === "1990-05-10", "a data do requerente foi lida da imagem e normalizada", dataJoao?.valor)
    ok((dataJoao?.evidencias[0]?.trecho ?? "").length > 0, "com o trecho transcrito", dataJoao?.evidencias[0]?.trecho)

    const dataGiuseppe = giuseppe?.dados.find((d) => d.campo === "DATA_NASCIMENTO")
    ok(
      dataGiuseppe?.valor === "1923-01-12",
      "a data em italiano por extenso virou data ISO",
      dataGiuseppe?.valor,
    )

    const localAntonio = antonio?.dados.find((d) => d.campo === "LOCAL_NASCIMENTO")
    ok(
      (localAntonio?.valor ?? "").toUpperCase().includes("BENTO"),
      "o local foi lido mesmo na foto torta",
      localAntonio?.valor,
    )

    ok(
      analise.nos.every((n) => n.documentos.length > 0) && analise.vinculos.every((v) => v.evidencias.length > 0),
      "toda pessoa e todo vínculo apontam para a certidão que os sustenta",
    )

    // ---- nada foi gravado
    const docs = await prisma.documento.count({ where: { pessoa: { arvoreId: arvore.id } } })
    const pessoas = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
    ok(docs === 0 && pessoas === 1, "e a análise continua não gravando nada", { docs, pessoas })

    await prisma.$disconnect()
  } finally {
    servidor.close()
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`MRG visão ao vivo: ${passed} passou, ${failed} falhou`)
  if (failed > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("✅ Imagens escaneadas viraram árvore de 4 gerações, com evidência, pela API de verdade.\n")
}

main().catch((e) => {
  console.error("\n❌ ERRO FATAL:", e)
  process.exit(1)
})
