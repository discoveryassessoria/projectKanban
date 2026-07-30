/**
 * MRG — IMPORTAÇÃO DE CERTIDÕES PELA ÁRVORE (ponta a ponta, banco real).
 *
 * Rodar (banco de teste local, NUNCA produção):
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
 *   npx tsx scripts/mrg-importacao.test.ts
 *
 * O que este arquivo prova, com PDFs de verdade servidos por HTTP de verdade:
 *
 *  1. ANALISAR NÃO GRAVA. Nenhum Documento, nenhuma Pessoa, nenhum Fato nasce da
 *     análise — a contagem do banco é idêntica antes e depois.
 *  2. A análise LÊ o PDF (camada de texto), classifica a natureza, extrai os
 *     campos pelas DUAS leituras e resolve identidade contra a árvore existente:
 *     quem já existe é reconhecido, quem não existe entra como pessoa nova.
 *  3. A PRÉVIA da árvore é montada com a filiação que o documento afirma.
 *  4. CONFIRMAR grava na PASTA DOCUMENTAL EXISTENTE — `Documento`, com o
 *     `pessoaId` que o operador aprovou, e com a transcrição JÁ PRONTA (o OCR não
 *     roda duas vezes pelo mesmo arquivo).
 *  5. Não há armazenamento paralelo: a URL gravada é a mesma do upload.
 *  6. Descartar na revisão significa não gravar nada daquele arquivo.
 *  7. Depois de gravar, o motor registral roda e produz evidência e proposta.
 *
 * TRAVA DE SEGURANÇA: aborta se o banco não for local. Este teste ESCREVE.
 */

export {} // módulo (evita colisão de globais entre scripts de teste)

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { deflateSync } from "node:zlib"

// ---------------------------------------------------------------- trava de segurança
const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
function hostDe(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ""
  }
}
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])
if (!URL_DB) {
  console.error("\n❌ PRISMA_DATABASE_URL não definida. Este teste precisa de um banco de TESTE local.\n")
  process.exit(1)
}
if (!LOCAIS.has(hostDe(URL_DB))) {
  console.error(`\n❌ ABORTADO: host do banco é "${hostDe(URL_DB)}", que não é local. Este teste ESCREVE.\n`)
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

/**
 * PDF REAL, mínimo e válido, com camada de texto conhecida. O conteúdo é montado
 * aqui — nada de fixture opaco: o teste prova que a importação lê um PDF de
 * verdade, pelo mesmo caminho que a produção usa.
 */
function pdfComTexto(linhas: string[]): Buffer {
  const escapar = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  const conteudo = [
    "BT",
    "/F1 12 Tf",
    ...linhas.map((l, i) => `1 0 0 1 40 ${760 - i * 18} Tm (${escapar(l)}) Tj`),
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
  push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
  push(
    Buffer.concat([
      Buffer.from(`5 0 obj\n<< /Length ${fluxo.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
      fluxo,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]),
  )

  const cabecalho = Buffer.from("%PDF-1.4\n", "latin1")
  const posicoes: number[] = []
  let deslocamento = cabecalho.length
  for (const o of objetos) {
    posicoes.push(deslocamento)
    deslocamento += o.length
  }
  const corpo = Buffer.concat([cabecalho, ...objetos])
  const xrefPos = corpo.length
  const xref = [
    `xref\n0 ${objetos.length + 1}\n`,
    "0000000000 65535 f \n",
    ...posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
  ].join("")
  return Buffer.concat([corpo, Buffer.from(xref, "latin1")])
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { analisarImportacao, confirmarImportacao } = await import("@/src/services/registral/importacao")

  const SUFIXO = `mrg-imp-${process.pid}`

  // ==========================================================================
  console.log("\n0) SERVIDOR LOCAL DE ARQUIVOS — o upload já aconteceu; a análise baixa daqui")

  const arquivosServidos = new Map<string, Buffer>()
  const servidor = createServer((req, res) => {
    const chave = (req.url ?? "").replace(/^\//, "")
    const dados = arquivosServidos.get(decodeURIComponent(chave))
    if (!dados) {
      res.writeHead(404).end("nao encontrado")
      return
    }
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(dados.length) })
    res.end(dados)
  })
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve))
  const porta = (servidor.address() as AddressInfo).port
  const base = `http://127.0.0.1:${porta}`
  ok(porta > 0, `servidor de arquivos no ar (${base})`)

  function publicar(nome: string, linhas: string[]): { url: string; nome: string; mimeType: string } {
    arquivosServidos.set(nome, pdfComTexto(linhas))
    return { url: `${base}/${encodeURIComponent(nome)}`, nome, mimeType: "application/pdf" }
  }

  try {
    // ========================================================================
    console.log("\n1) LIMPEZA do cenário anterior deste teste")
    await prisma.$transaction(async (tx) => {
      const procs = await tx.processo.findMany({
        where: { nome: { startsWith: SUFIXO } },
        select: { id: true, arvoreId: true },
      })
      for (const p of procs) {
        await tx.decisaoRevisaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
        await tx.impactoAplicacaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
        await tx.conflitoRegistral.deleteMany({ where: { processoId: p.id } })
        await tx.propostaReconciliacao.deleteMany({ where: { processoId: p.id } })
        await tx.evidenciaRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.etapaExecucaoRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.correspondenciaIdentidade.deleteMany({
          where: { ocorrencia: { execucao: { lote: { processoId: p.id } } } },
        })
        await tx.ocorrenciaDocumental.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.execucaoRegistral.deleteMany({ where: { lote: { processoId: p.id } } })
        await tx.loteRegistral.deleteMany({ where: { processoId: p.id } })
        if (p.arvoreId != null) {
          const ids = (await tx.pessoa.findMany({ where: { arvoreId: p.arvoreId }, select: { id: true } })).map((x) => x.id)
          await tx.fatoRegistral.deleteMany({ where: { pessoaId: { in: ids } } })
          await tx.documento.deleteMany({ where: { pessoaId: { in: ids } } })
          await tx.uniao.deleteMany({ where: { OR: [{ pessoa1Id: { in: ids } }, { pessoa2Id: { in: ids } }] } })
          await tx.pessoa.updateMany({ where: { id: { in: ids } }, data: { paiId: null, maeId: null } })
          await tx.arvore.update({ where: { id: p.arvoreId }, data: { pessoaPrincipalId: null } })
          await tx.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
        }
        await tx.processo.delete({ where: { id: p.id } })
        if (p.arvoreId != null) await tx.arvore.delete({ where: { id: p.arvoreId } }).catch(() => undefined)
      }
    })
    ok(true, "cenário anterior removido")

    // ========================================================================
    console.log("\n2) SEED — catálogo, árvore com o requerente já cadastrado")

    const itNasc = await prisma.itemCatalogo.upsert({
      where: { code: "CERT_NASCIMENTO" },
      update: { ativo: true },
      create: { code: "CERT_NASCIMENTO", name: "Certidão de Nascimento", natureza: "DOCUMENTO", categoria: "Registro civil", ativo: true },
      select: { id: true },
    })
    const tdNasc = await prisma.tipoDocumentoCadastro.upsert({
      where: { legacyEnumKey: "CERTIDAO_NASCIMENTO" },
      update: { ativo: true, itemCatalogoId: itNasc.id },
      create: {
        legacyEnumKey: "CERTIDAO_NASCIMENTO",
        code: "CERT_NASCIMENTO",
        name: "Certidão de Nascimento",
        nature: "certidao",
        itemCatalogoId: itNasc.id,
        ativo: true,
      },
      select: { id: true },
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
        local_nasc: "Bento Goncalves",
        pais_nasc: "Brasil",
        arvoreId: arvore.id,
        requerente: "sim",
        linhaReta: true,
      },
      select: { id: true },
    })
    ok(!!tdNasc.id && !!requerente.id, "árvore semeada com o requerente já cadastrado")

    // ========================================================================
    console.log("\n3) ANÁLISE — lê os PDFs e monta a prévia SEM gravar nada")

    const a1 = publicar("nascimento-joao.pdf", [
      "REGISTRO DE NASCIMENTO DE JOAO BATISTA BIANCHI, filho de ANTONIO BIANCHI e de MARIA SOUZA,",
      "nasceu em BENTO GONCALVES aos 10 de maio de 1990.",
      "Nome: JOAO BATISTA BIANCHI ; Pai: ANTONIO BIANCHI ; Mae: MARIA SOUZA ;",
      "Data de nascimento: 10/05/1990 ; Local de nascimento: BENTO GONCALVES",
    ])
    const a2 = publicar("nascimento-antonio.pdf", [
      "REGISTRO DE NASCIMENTO DE ANTONIO BIANCHI, filho de GIUSEPPE BIANCHI e de ROSA FERRARI,",
      "nasceu em BENTO GONCALVES aos 20 de fevereiro de 1960.",
      "Nome: ANTONIO BIANCHI ; Pai: GIUSEPPE BIANCHI ; Mae: ROSA FERRARI ;",
      "Data de nascimento: 20/02/1960",
    ])
    // Arquivo que o operador vai DESCARTAR na revisão.
    const a3 = publicar("rascunho-ilegivel.pdf", ["   "])

    const antesDocs = await prisma.documento.count()
    const antesPessoas = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
    const antesFatos = await prisma.fatoRegistral.count()

    const analise = await analisarImportacao({ processoId: processo.id, arquivos: [a1, a2, a3] })

    const depoisDocs = await prisma.documento.count()
    const depoisPessoas = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
    const depoisFatos = await prisma.fatoRegistral.count()

    ok(depoisDocs === antesDocs, "a análise NÃO criou documento", { antesDocs, depoisDocs })
    ok(depoisPessoas === antesPessoas, "a análise NÃO criou pessoa", { antesPessoas, depoisPessoas })
    ok(depoisFatos === antesFatos, "a análise NÃO criou fato registral", { antesFatos, depoisFatos })

    const an1 = analise.arquivos.find((x) => x.nome === a1.nome)!
    const an2 = analise.arquivos.find((x) => x.nome === a2.nome)!
    const an3 = analise.arquivos.find((x) => x.nome === a3.nome)!

    ok(an1.tipo === "NASCIMENTO", "certidão de nascimento classificada pelo texto do PDF", an1.tipo)
    ok(an1.legivel && (an1.transcricao?.paginas.length ?? 0) > 0, "camada de texto do PDF lida de verdade", an1.motivoIlegivel)
    ok(an1.fonteTexto === "pdf_camada_texto", "leitura veio do provedor gratuito (sem custo, sem credencial)", an1.fonteTexto)

    ok(
      an1.sujeito?.pessoaId === requerente.id && an1.sujeito?.nova === false,
      "quem JÁ EXISTE na árvore é reconhecido, não duplicado",
      an1.sujeito,
    )
    ok(an2.sujeito?.nova === true, "quem NÃO existe entra como pessoa nova (a criar)", an2.sujeito)
    ok(
      an1.participantes.some((p) => p.papel === "PAI" && p.nome.includes("ANTONIO")) &&
        an1.participantes.some((p) => p.papel === "MAE" && p.nome.includes("MARIA")),
      "pai e mãe do documento aparecem como participantes",
      an1.participantes.map((p) => `${p.papel}:${p.nome}`),
    )
    ok(an1.campos.length > 0, "campos extraídos e conferidos pelas duas leituras", an1.campos.length)
    ok(!an3.legivel && !!an3.motivoIlegivel, "PDF sem texto útil é declarado ILEGÍVEL, não inventado", an3.motivoIlegivel)

    const noJoao = analise.previa.find((n) => n.pessoaId === requerente.id)
    ok(!!noJoao, "prévia contém o requerente")
    ok(!!noJoao?.paiChave && !!noJoao?.maeChave, "prévia liga o requerente ao pai e à mãe que o documento afirma", noJoao)
    ok(
      analise.previa.some((n) => n.nova && n.nome.includes("GIUSEPPE")),
      "prévia mostra o avô como pessoa NOVA, vinda do segundo documento",
      analise.previa.map((n) => `${n.nome}:${n.nova}`),
    )
    ok(analise.resumo.total === 3 && analise.resumo.legiveis === 2, "resumo bate com o lote", analise.resumo)

    // ========================================================================
    console.log("\n4) CONFIRMAÇÃO — grava na Pasta Documental existente")

    const confirmacao = await confirmarImportacao({
      processoId: processo.id,
      arquivos: [a1, a2, a3],
      analise: analise.arquivos,
      decisoes: [
        { indice: an1.indice, pessoaId: requerente.id },
        { indice: an2.indice, pessoaId: null, nomeNovaPessoa: an2.sujeito?.nome ?? "ANTONIO BIANCHI" },
        { indice: an3.indice, pessoaId: null, descartar: true },
      ],
    })

    ok(confirmacao.documentosCriados.length === 2, "só os documentos aprovados foram gravados", confirmacao)
    ok(confirmacao.descartados === 1, "o arquivo descartado não virou documento", confirmacao.descartados)
    ok(confirmacao.pessoasCriadas.length === 1, "a pessoa nova foi criada uma única vez", confirmacao.pessoasCriadas)
    ok(confirmacao.erros.length === 0, "nenhum erro na gravação", confirmacao.erros)

    const docs = await prisma.documento.findMany({
      where: { id: { in: confirmacao.documentosCriados } },
      select: {
        id: true,
        pessoaId: true,
        arquivo_url: true,
        arquivo_nome: true,
        documentTypeId: true,
        transcricaoTexto: true,
        transcricaoFonte: true,
        origem: true,
      },
      orderBy: { id: "asc" },
    })

    const docJoao = docs.find((d) => d.pessoaId === requerente.id)
    ok(!!docJoao, "o documento nasceu com a PESSOA APROVADA pelo operador")
    ok(docJoao?.arquivo_url === a1.url, "sem armazenamento paralelo: a URL gravada é a mesma do upload", docJoao?.arquivo_url)
    ok(docJoao?.documentTypeId === tdNasc.id, "o tipo documental é o oficial do Sistema Documental", docJoao?.documentTypeId)
    ok(
      !!docJoao?.transcricaoTexto?.includes("JOAO BATISTA BIANCHI") && docJoao?.transcricaoFonte === "pdf_camada_texto",
      "a transcrição da análise foi reaproveitada (OCR não roda duas vezes)",
      docJoao?.transcricaoFonte,
    )

    const novaPessoa = await prisma.pessoa.findUnique({
      where: { id: confirmacao.pessoasCriadas[0] },
      select: { id: true, nome: true, sobrenome: true, arvoreId: true },
    })
    ok(novaPessoa?.arvoreId === arvore.id, "a pessoa nova nasceu NA ÁRVORE do processo", novaPessoa)
    ok(
      docs.some((d) => d.pessoaId === novaPessoa?.id),
      "o segundo documento ficou com a pessoa recém-criada",
    )

    const descartado = await prisma.documento.findFirst({ where: { arquivo_url: a3.url }, select: { id: true } })
    ok(descartado === null, "o arquivo descartado NÃO existe na Pasta Documental")

    // ========================================================================
    console.log("\n5) MOTOR — depois de gravar, a leitura registral roda sozinha")

    ok(confirmacao.loteId != null, "um lote registral foi disparado", confirmacao.loteId)
    const evidencias = await prisma.evidenciaRegistral.count({
      where: { execucao: { lote: { id: confirmacao.loteId ?? -1 } } },
    })
    ok(evidencias > 0, "os documentos importados produziram evidência rastreável", evidencias)
    ok(
      confirmacao.propostas + confirmacao.conflitos > 0,
      "a importação gerou trabalho para a revisão (proposta ou conflito)",
      { propostas: confirmacao.propostas, conflitos: confirmacao.conflitos },
    )

    const auditoria = await prisma.logAuditoria.count({
      where: { acao: { in: ["registral_importacao_analisada", "registral_importacao_confirmada"] }, entidadeId: processo.id },
    })
    ok(auditoria >= 2, "análise e confirmação ficaram na auditoria", auditoria)

    await prisma.$disconnect()
  } finally {
    servidor.close()
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`)
  if (failed > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("✅ Importação pela Árvore: analisa sem gravar, grava onde deve, e só o que foi aprovado.\n")
}

main().catch((e) => {
  console.error("\n❌ ERRO FATAL:", e)
  process.exit(1)
})
