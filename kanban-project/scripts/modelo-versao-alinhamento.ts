// scripts/modelo-versao-alinhamento.ts
//
// NOVA VERSÃO DE TEMPLATE — corpo justificado.
//
// O motor NÃO ajusta alinhamento na geração: ele preserva o `w:pPr` do template
// integralmente, e é isso que garante que o documento gerado é o documento
// aprovado. Quando o alinhamento de um modelo precisa mudar, o caminho é o
// previsto pelo módulo congelado: uma VERSÃO NOVA, que preserva a anterior e
// passa pela publicação auditada.
//
// Este script faz exatamente isso: parte da versão PUBLICADA, aplica
// `w:jc="both"` nos parágrafos do CORPO que ainda não estão justificados
// (preservando título e assinatura, que são centralizados por decisão de
// redação), e publica como versão seguinte. Nada além do alinhamento é tocado —
// margens, recuos, entrelinha, espaçamento, fonte, tamanho, cabeçalho e rodapé
// saem byte a byte como entraram.
//
// Uso:
//   npx tsx scripts/modelo-versao-alinhamento.ts            (dry-run)
//   npx tsx scripts/modelo-versao-alinhamento.ts --execute
//   npx tsx scripts/modelo-versao-alinhamento.ts --execute --modelo PROC-JUD

import { prisma } from "../src/lib/prisma"
import {
  abrirDocx,
  definirAlinhamentoDoCorpo,
  segmentosDeTexto,
} from "../src/lib/documentos/modelos/docx"
import { lerObjetoPrivado } from "../src/lib/documentos/modelos/storage-privado"
import { criarVersao, publicarVersao } from "../src/services/modelos/repositorio-modelos"

const EXECUTAR = process.argv.includes("--execute")
const i = process.argv.indexOf("--modelo")
const FILTRO = i >= 0 ? process.argv[i + 1] : null

/** Alinhamento de cada parágrafo com texto, para o antes/depois. */
async function alinhamentos(buffer: Buffer | Uint8Array) {
  const zip = await abrirDocx(buffer)
  const xml = await zip.file("word/document.xml")!.async("string")
  const saida: Array<{ jc: string; texto: string }> = []
  for (const p of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    const texto = segmentosDeTexto(p[0]).map((s) => s.texto).join("").trim()
    if (!texto) continue
    const pPr = p[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ""
    saida.push({ jc: pPr.match(/<w:jc\b[^>]*w:val="([^"]*)"/)?.[1] ?? "(herdado)", texto: texto.slice(0, 46) })
  }
  return saida
}

async function main() {
  const usuario = await prisma.usuario.findFirst({
    where: { tipo: "admin" },
    orderBy: { id: "asc" },
    select: { id: true, nome: true },
  })
  if (!usuario) throw new Error("Nenhum usuário admin para assinar a publicação.")

  const modelos = await prisma.modeloDocumental.findMany({
    where: FILTRO ? { codigo: FILTRO } : { ativo: true },
    select: { id: true, codigo: true, nome: true },
    orderBy: { codigo: "asc" },
  })

  for (const modelo of modelos) {
    const publicada = await prisma.modeloDocumentalVersao.findFirst({
      where: { modeloId: modelo.id, status: "PUBLICADA" },
    })
    console.log(`\n══ ${modelo.codigo} — ${modelo.nome}`)
    if (!publicada) {
      console.log("   sem versão publicada — nada a fazer")
      continue
    }

    const original = await lerObjetoPrivado(publicada.arquivoChave)
    const resultado = await definirAlinhamentoDoCorpo(original, { alinhamento: "both" })

    const antes = await alinhamentos(original)
    const depois = await alinhamentos(resultado.buffer)

    console.log(`   versão publicada: v${publicada.numero}`)
    for (let k = 0; k < antes.length; k++) {
      const mudou = antes[k].jc !== depois[k].jc
      console.log(
        `   ${mudou ? "→" : " "} ${antes[k].jc.padEnd(9)}${mudou ? ` ⇒ ${depois[k].jc.padEnd(6)}` : "        "} | ${antes[k].texto}`,
      )
    }
    console.log(`   ajustados: ${resultado.ajustados} · preservados: ${resultado.preservados}`)

    if (resultado.ajustados === 0) {
      console.log("   ✓ o corpo já está justificado — versão nova seria idêntica, nada a publicar")
      continue
    }
    if (!EXECUTAR) {
      console.log("   (dry-run — nada gravado)")
      continue
    }

    const versao = await criarVersao({
      modeloId: modelo.id,
      docx: resultado.buffer,
      nomeArquivo: `${modelo.codigo}-template.docx`,
      observacao:
        "Corpo do instrumento justificado. Alteração exclusiva de alinhamento: margens, recuos, entrelinha, espaçamento, fonte, tamanho, cabeçalho e rodapé preservados.",
      usuarioId: usuario.id,
    })
    await publicarVersao({
      versaoId: versao.id,
      dadosFixosDeclarados: (publicada.dadosFixosDeclarados as string[] | null) ?? [],
      usuarioId: usuario.id,
    })
    console.log(`   ✓ versão ${versao.numero} PUBLICADA (v${publicada.numero} preservada como REVOGADA)`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
