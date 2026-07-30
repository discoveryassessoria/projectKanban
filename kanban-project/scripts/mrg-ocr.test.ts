/**
 * MRG — TRANSCRIÇÃO (o "OCR" do motor) e a INTERFACE operacional.
 * Rodar: npx tsx scripts/mrg-ocr.test.ts
 *
 * O que este arquivo protege:
 *  · a camada de texto do PDF é lida DE VERDADE (um PDF é gerado aqui, com texto
 *    real, e o provedor tem de devolver o texto — sem serviço externo, sem mock);
 *  · o provedor externo se declara INDISPONÍVEL quando não há credencial, em vez
 *    de devolver vazio fingindo sucesso;
 *  · a resposta do OCR externo é normalizada nos três formatos usados na prática;
 *  · a transcrição pertence ao Documento, e o motor só lê;
 *  · a interface não reimplementa regra: a permissão exibida vem da mesma matriz
 *    que o servidor aplica.
 */
export {}

import { deflateSync } from "node:zlib"
import {
  ehImagem,
  ehPdf,
  extensaoDe,
  textoUtil,
  type PaginaTranscrita,
} from "../src/services/registral/ocr/tipos"
import { provedorPdfCamadaTexto } from "../src/services/registral/ocr/pdf-camada-texto"
import { normalizarResposta, provedorOcrExterno } from "../src/services/registral/ocr/http-externo"
import { PROVEDORES, situacaoDosProvedores } from "../src/services/registral/ocr"
import { permissaoExigida } from "../src/components/registral/painel-proposta"
import { permissaoDaProposta } from "../src/lib/genealogia/registral/campos"
import { evidenciasDe, idsDe, tomDaCriticidade, tomDaSeveridade, tomDoStatus } from "../src/components/registral/tipos-ui"

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
 * Gera um PDF REAL, mínimo e válido, com uma camada de texto conhecida.
 * Não é um fixture opaco: o conteúdo é montado aqui, então o teste prova que o
 * provedor lê a camada de texto de um PDF de verdade.
 */
function pdfComTexto(linhas: string[]): Uint8Array {
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
  let offset = cabecalho.length
  const posicoes: number[] = []
  for (const o of objetos) {
    posicoes.push(offset)
    offset += o.length
  }

  const xrefPos = offset
  const xref = [
    "xref",
    `0 ${objetos.length + 1}`,
    "0000000000 65535 f ",
    ...posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objetos.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefPos),
    "%%EOF\n",
  ].join("\n")

  return new Uint8Array(Buffer.concat([cabecalho, ...objetos, Buffer.from(xref, "latin1")]))
}

async function main() {
  // ============================================================
  console.log("\n1) Reconhecimento do tipo de arquivo")
  ok(extensaoDe("certidao.PDF") === "pdf", "extensão em maiúscula normaliza")
  ok(extensaoDe(null, "https://x/y/z.jpg?token=1") === "jpg", "extensão vem da URL, sem querystring")
  ok(ehPdf({ mimeType: "application/pdf", nome: null }), "PDF por mime")
  ok(ehPdf({ mimeType: null, nome: "a.pdf" }), "PDF por extensão")
  ok(ehImagem({ mimeType: "image/png", nome: null }), "imagem por mime")
  ok(ehImagem({ mimeType: null, nome: "scan.tiff" }), "imagem por extensão")
  ok(!ehImagem({ mimeType: null, nome: "a.pdf" }), "PDF não é imagem")

  // ============================================================
  console.log("\n2) PDF DIGITAL — a camada de texto é lida de verdade")
  const LINHAS = [
    "REGISTRO DE NASCIMENTO DE JOAO BATISTA BIANCHI",
    "Pai: GIUSEPPE BIANCHI",
    "Mae: ROSA FERRARI",
    "Data de nascimento: 20/02/1960",
  ]
  const pdf = pdfComTexto(LINHAS)
  ok(pdf.length > 300, "PDF de teste gerado", pdf.length)

  const r = await provedorPdfCamadaTexto.transcrever({
    documentoId: 1,
    url: "memoria://teste.pdf",
    nome: "teste.pdf",
    mimeType: "application/pdf",
    conteudo: pdf,
  })
  ok(r.ok, "provedor leu o PDF", r.motivo)
  ok(r.provedor === "pdf_camada_texto", "identifica-se corretamente")
  ok(r.paginas.length === 1, "uma página", r.paginas.length)
  const texto = r.paginas.map((p) => p.texto).join("\n")
  for (const esperado of ["JOAO BATISTA BIANCHI", "GIUSEPPE BIANCHI", "ROSA FERRARI", "20/02/1960"]) {
    ok(texto.includes(esperado), `texto contém “${esperado}”`, texto.slice(0, 120))
  }
  ok(r.caracteres > 60, "contagem de caracteres úteis", r.caracteres)

  console.log("\n3) O texto lido alimenta a extração do motor")
  const { extrairAncorado } = await import("../src/lib/genealogia/registral/extracao-ancorada")
  const campos = extrairAncorado(
    {
      documentoId: 1,
      pessoaId: null,
      necessidadeId: null,
      itemCatalogoId: null,
      tipoDeclarado: "CERTIDAO_NASCIMENTO",
      paginas: r.paginas,
      literais: {},
      registral: null,
      estruturado: null,
      fonte: r.provedor,
    },
    "NASCIMENTO",
  )
  ok(
    campos.campos.some((c) => c.campo === "FILIACAO_PAI" && c.valorNormalizado === "GIUSEPPE BIANCHI"),
    "o pai é extraído do PDF real",
    campos.campos.map((c) => `${c.campo}=${c.valorNormalizado}`),
  )
  ok(
    campos.campos.some((c) => c.campo === "DATA_NASCIMENTO" && c.valorData === "1960-02-20"),
    "a data é extraída do PDF real",
  )

  console.log("\n4) PDF sem camada de texto é REPROVADO, não inventado")
  const vazio = await provedorPdfCamadaTexto.transcrever({
    documentoId: 2,
    url: "memoria://vazio.pdf",
    nome: "vazio.pdf",
    mimeType: "application/pdf",
    conteudo: pdfComTexto([]),
  })
  ok(!vazio.ok, "PDF sem texto não devolve ok")
  ok(vazio.paginas.length === 0, "e não devolve página nenhuma")
  ok((vazio.motivo ?? "").toLowerCase().includes("ocr"), "o motivo aponta que precisa de OCR", vazio.motivo)

  const corrompido = await provedorPdfCamadaTexto.transcrever({
    documentoId: 3,
    url: "memoria://x.pdf",
    nome: "x.pdf",
    mimeType: "application/pdf",
    conteudo: new Uint8Array([1, 2, 3, 4]),
  })
  ok(!corrompido.ok && !!corrompido.motivo, "arquivo corrompido devolve motivo, não exceção", corrompido.motivo)

  // ============================================================
  console.log("\n5) OCR externo — indisponível sem credencial, e honesto sobre isso")
  const endpointOriginal = process.env.OCR_ENDPOINT
  delete process.env.OCR_ENDPOINT

  const disp = provedorOcrExterno.disponivel()
  ok(!disp.ok, "sem OCR_ENDPOINT o provedor se declara indisponível")
  ok(disp.ok === false && disp.motivo.includes("OCR_ENDPOINT"), "e diz exatamente o que falta", disp.ok === false ? disp.motivo : "")

  const semConfig = await provedorOcrExterno.transcrever({
    documentoId: 4,
    url: "x",
    nome: "a.png",
    mimeType: "image/png",
    conteudo: new Uint8Array([1]),
  })
  ok(!semConfig.ok && semConfig.paginas.length === 0, "e não devolve texto inventado")

  process.env.OCR_ENDPOINT = "https://ocr.exemplo.local/v1"
  ok(provedorOcrExterno.disponivel().ok, "com OCR_ENDPOINT o provedor fica disponível")
  if (endpointOriginal === undefined) delete process.env.OCR_ENDPOINT
  else process.env.OCR_ENDPOINT = endpointOriginal

  console.log("\n6) Normalização das três formas de resposta de OCR")
  const formaA = normalizarResposta({ paginas: [{ pagina: 2, texto: "b" }, { pagina: 1, texto: "a" }] })
  ok(formaA.length === 2 && formaA[0].pagina === 1, "formato {paginas:[{pagina,texto}]} ordena por página", formaA)
  const formaB = normalizarResposta({ pages: [{ page: 1, text: "x" }] })
  ok(formaB.length === 1 && formaB[0].texto === "x", "formato {pages:[{page,text}]}")
  const formaC = normalizarResposta({ texto: "documento inteiro" })
  ok(formaC.length === 1 && formaC[0].pagina === 1, "formato plano {texto}")
  ok(normalizarResposta({ texto: "   " }).length === 0, "texto em branco não vira página")
  ok(normalizarResposta(null).length === 0, "resposta nula não quebra")
  ok(normalizarResposta({ paginas: "nao-e-lista" }).length === 0, "formato inesperado não quebra")

  console.log("\n7) Ordem e situação dos provedores")
  ok(PROVEDORES[0].nome === "pdf_camada_texto", "camada de texto é tentada primeiro (não custa nada)")
  ok(PROVEDORES[1].nome === "ocr_externo", "OCR externo é o segundo (custa e precisa de credencial)")
  const situacao = situacaoDosProvedores()
  ok(situacao.length === 2, "a situação lista os dois provedores")
  ok(
    situacao.every((s) => typeof s.disponivel === "boolean" && (s.disponivel || !!s.motivo)),
    "indisponível sempre vem com motivo",
    situacao,
  )

  console.log("\n8) textoUtil ignora espaço")
  const paginas: PaginaTranscrita[] = [{ pagina: 1, texto: "  a  b  " }, { pagina: 2, texto: "\n\n" }]
  ok(textoUtil(paginas) === 3, "conta só o conteúdo", textoUtil(paginas))

  // ============================================================
  console.log("\n9) A INTERFACE não reimplementa a matriz de permissão")
  const CASOS: Array<[string, string]> = [
    ["MESCLAR_PESSOAS", "BLOQUEIO"],
    ["SEPARAR_PESSOAS", "BLOQUEIO"],
    ["CRIAR_RELACIONAMENTO", "APROVACAO_HUMANA"],
    ["CORRIGIR_RELACIONAMENTO", "BLOQUEIO"],
    ["REMOVER_RELACIONAMENTO", "BLOQUEIO"],
    ["CORRIGIR_DADO", "APROVACAO_HUMANA"],
    ["CONFIRMAR_DADO", "AUTOMATICA"],
    ["COMPLETAR_DADO", "AUTOMATICA"],
  ]
  const MAPA: Record<string, string> = {
    mesclarPessoas: "registral.mesclar_pessoas",
    alterarFiliacao: "registral.alterar_filiacao",
    aprovar: "registral.aprovar",
    revisar: "registral.revisar",
  }
  for (const [tipo, criticidade] of CASOS) {
    const daTela = MAPA[permissaoExigida(tipo, criticidade)]
    const doServidor = permissaoDaProposta(
      tipo as Parameters<typeof permissaoDaProposta>[0],
      criticidade as Parameters<typeof permissaoDaProposta>[1],
    )
    ok(daTela === doServidor, `${tipo}/${criticidade}: tela e servidor exigem a mesma permissão`, { daTela, doServidor })
  }

  console.log("\n10) Helpers da interface são tolerantes a JSON inesperado")
  ok(evidenciasDe(null).length === 0, "evidências de null")
  ok(evidenciasDe([{ campo: "x", descricao: "y" }])[0].favoravel === true, "favorável é o padrão")
  ok(evidenciasDe([{ campo: "x", descricao: "y", favoravel: false }])[0].favoravel === false, "contrária é respeitada")
  ok(evidenciasDe("texto").length === 0, "string não vira evidência")
  ok(idsDe([1, "2", null, 3]).length === 3, "ids tolera lista suja", idsDe([1, "2", null, 3]))
  ok(tomDaSeveridade("CRITICO") === "danger" && tomDaSeveridade("INFO") === "neutral", "tom por severidade")
  ok(tomDaCriticidade("BLOQUEIO") === "danger" && tomDaCriticidade("AUTOMATICA") === "success", "tom por criticidade")
  ok(tomDoStatus("APLICADA") === "success" && tomDoStatus("ABORTADA") === "danger", "tom por status")

  // ============================================================
  console.log(`\n${"=".repeat(60)}`)
  console.log(`MRG OCR + interface: ${passed} passou, ${failed} falhou`)
  if (failed) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("\n❌ exceção:", e)
  process.exit(1)
})
