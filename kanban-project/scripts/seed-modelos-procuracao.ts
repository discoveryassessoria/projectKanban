// scripts/seed-modelos-procuracao.ts
//
// PREPARAÇÃO E PUBLICAÇÃO DOS DOIS MODELOS OFICIAIS DE PROCURAÇÃO.
//
// Este script roda UMA VEZ por ambiente. Ele:
//   1. lê os dois DOCX oficiais (arquivos do escritório, fora do repositório);
//   2. converte os dados do cliente de exemplo em VARIÁVEIS canônicas;
//   3. sobe o template para o storage privado e cria a versão 1;
//   4. publica, declarando os dados fixos do outorgado.
//
// POR QUE A LISTA DE TRECHOS MORA AQUI, E NÃO NO RUNTIME
// ------------------------------------------------------
// Os pares abaixo são a RECEITA DA CONVERSÃO de um documento já redigido em
// template — um ato de preparação, feito com o documento na mão. Não é regra de
// negócio e não roda em produção: o runtime só conhece `{{CHAVE}}`. Se um dia o
// escritório reescrever a procuração, o caminho é enviar o DOCX novo pela tela
// de Modelos, e não editar este arquivo.
//
// Uso:
//   npx tsx scripts/seed-modelos-procuracao.ts --dry-run
//   npx tsx scripts/seed-modelos-procuracao.ts --execute
//   npx tsx scripts/seed-modelos-procuracao.ts --execute \
//     --judicial "/caminho/Procuração retificação judicial.docx" \
//     --administrativa "/caminho/Procuração administrativa.docx"

import { readFileSync, existsSync } from "node:fs"
import { prisma } from "../src/lib/prisma"
import { substituirLiteraisDocx, type ParLiteral } from "../src/lib/documentos/modelos/docx"
import { validarTemplate } from "../src/lib/documentos/modelos/validador"
import {
  criarVersao,
  publicarVersao,
  digitosDeClientesReais,
} from "../src/services/modelos/repositorio-modelos"

const EXECUTAR = process.argv.includes("--execute")

function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao
}

const ICLOUD =
  `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/ Discovery Assessoria /Modelos`

interface Definicao {
  codigo: string
  nome: string
  descricao: string
  /** publicCode do tipo no Cadastro Mestre de Documentos. */
  tipoPublicCode: string
  origem: string
  pares: ParLiteral[]
  /** Identificações do OUTORGADO que devem permanecer fixas no texto. */
  dadosFixos: string[]
}

const MODELOS: Definicao[] = [
  {
    codigo: "PROC-JUD",
    nome: "Procuração Judicial",
    descricao:
      "Instrumento ad judicia para atuação judicial, especialmente ação de retificação judicial de registros civis.",
    tipoPublicCode: "DOC19",
    origem: arg("judicial", `${ICLOUD}/Judicial/Procuração retificação judicial.docx`),
    pares: [
      { de: "EDISON NÁS ANTÃO JUNIOR", para: "{{OUTORGANTE_NOME_COMPLETO}}", limite: 1 },
      { de: "EDISON NÁS ANTÃO JUNIOR", para: "{{ASSINATURA_NOME}}" },
      {
        de: ", brasileiro, portador da cédula",
        para: ", {{OUTORGANTE_NACIONALIDADE}}, {{OUTORGANTE_PORTADOR}} da cédula",
      },
      { de: "34.025.063-X", para: "{{OUTORGANTE_RG}}" },
      { de: "218.673.738-82", para: "{{OUTORGANTE_CPF}}" },
      {
        de: "Rua Sete de abril, 154, Casa 3, Santo André – SP, CEP 09121-370",
        para: "{{OUTORGANTE_ENDERECO_LINHA}}",
      },
      { de: "Amparo, 29 de julho de 2026", para: "{{LOCAL_EMISSAO}}, {{DATA_EMISSAO_EXTENSO}}" },
    ],
    // A outorgada é identificada por OAB, não por CPF/RG: nada a declarar.
    dadosFixos: [],
  },
  {
    codigo: "PROC-ADM",
    nome: "Procuração Administrativa",
    descricao:
      "Instrumento de representação administrativa para cidadania italiana: consulados, registros civis, cartórios, CRC, certidões, traduções, transcrições e retificações.",
    tipoPublicCode: "DOC20",
    origem: arg("administrativa", `${ICLOUD}/ Italia/Procurações/Brasil/Procuração administrativa.docx`),
    pares: [
      { de: "SYLVIA BONCI DE OLIVEIRA", para: "{{OUTORGANTE_NOME_COMPLETO}}", limite: 1 },
      { de: "SYLVIA BONCI DE OLIVEIRA", para: "{{ASSINATURA_NOME}}" },
      {
        de: ", brasileira, casada, portador da cédula",
        para:
          ", {{OUTORGANTE_NACIONALIDADE}}, {{OUTORGANTE_ESTADO_CIVIL}}, {{OUTORGANTE_PORTADOR}} da cédula",
      },
      { de: "20.410.278", para: "{{OUTORGANTE_RG}}" },
      { de: "256.516.318-52", para: "{{OUTORGANTE_CPF}}" },
      {
        // Corrige, de passagem, a duplicação de "na" que existe no modelo de
        // origem ("residente na na Rua"). É erro de digitação, não redação.
        de: "residente na na Rua Joaquim Valim, 139, Centro, São João da Boa Vista – SP, CEP 13870-399",
        para: "residente na {{OUTORGANTE_ENDERECO_LINHA}}",
      },
      { de: "São Paulo, 20 de março de 2026", para: "{{LOCAL_EMISSAO}}, {{DATA_EMISSAO_EXTENSO}}" },
    ],
    // Identificação do OUTORGADO — permanece no texto por ser dado fixo do
    // instrumento (RG, CPF e CEP da sede).
    dadosFixos: ["46133682-0", "336.287.958-69", "13900-480"],
  },
]

async function main() {
  const usuario = await prisma.usuario.findFirst({
    where: { tipo: "admin" },
    orderBy: { id: "asc" },
    select: { id: true, nome: true },
  })
  if (!usuario) throw new Error("Nenhum usuário admin para assinar a publicação.")
  console.log(`Publicador: ${usuario.nome} (#${usuario.id})\n`)

  for (const def of MODELOS) {
    console.log(`══ ${def.codigo} — ${def.nome}`)

    if (!existsSync(def.origem)) {
      console.log(`   ✗ DOCX oficial não encontrado: ${def.origem}`)
      continue
    }

    const tipo = await prisma.tipoDocumentoCadastro.findFirst({
      where: { publicCode: def.tipoPublicCode },
      select: { id: true, name: true, publicCode: true, familiaDocumentalId: true },
    })
    if (!tipo) {
      console.log(`   ✗ Tipo documental ${def.tipoPublicCode} não existe no Cadastro Mestre.`)
      continue
    }
    console.log(`   tipo documental: ${tipo.publicCode} — ${tipo.name} (id ${tipo.id})`)

    // ── Preparação do template ────────────────────────────────────────────
    const original = readFileSync(def.origem)
    const preparado = await substituirLiteraisDocx(original, def.pares)
    if (preparado.naoEncontrados.length > 0) {
      console.log(`   ✗ Trechos não encontrados no DOCX: ${preparado.naoEncontrados.join(" | ")}`)
      console.log("     O arquivo de origem mudou. Ajuste a receita antes de publicar.")
      continue
    }

    const digitosNoTemplate = (await validarTemplate(preparado.buffer)).literais.map((l) => l.digitos)
    const reais = await digitosDeClientesReais(digitosNoTemplate)
    const validacao = await validarTemplate(preparado.buffer, {
      dadosFixosDeclarados: def.dadosFixos,
      digitosDeClientesReais: reais,
    })

    console.log(`   placeholders: ${validacao.placeholders.join(", ")}`)
    console.log(`   obrigatórios: ${validacao.obrigatorios.join(", ") || "—"}`)
    console.log(`   opcionais:    ${validacao.opcionais.join(", ") || "—"}`)
    console.log(
      `   literais fixos: ${validacao.literais.map((l) => `${l.tipo}:${l.valor}`).join(", ") || "nenhum"}`,
    )
    for (const a of validacao.achados) console.log(`   ${a.severidade === "erro" ? "✗" : "!"} ${a.mensagem}`)
    if (!validacao.ok) {
      console.log("   ✗ Validação reprovada — nada publicado.")
      continue
    }
    console.log("   ✓ validação aprovada")

    if (!EXECUTAR) {
      console.log("   (dry-run — nada gravado)\n")
      continue
    }

    // ── Modelo ────────────────────────────────────────────────────────────
    const modelo = await prisma.modeloDocumental.upsert({
      where: { codigo: def.codigo },
      create: {
        codigo: def.codigo,
        nome: def.nome,
        descricao: def.descricao,
        categoria: "PROCURACAO",
        documentTypeId: tipo.id,
        ativo: true,
        criadoPorId: usuario.id,
      },
      update: { nome: def.nome, descricao: def.descricao, documentTypeId: tipo.id, ativo: true },
      select: { id: true, codigo: true },
    })

    // Família documental "Procuração" já existe no cadastro e descreve exatamente
    // estes tipos. Classificar é aditivo e deixa o domínio coerente.
    const familia = await prisma.familiaDocumental.findFirst({
      where: { code: "PROCURACAO" },
      select: { id: true },
    })
    if (familia && tipo.familiaDocumentalId == null) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: tipo.id },
        data: { familiaDocumentalId: familia.id },
      })
      console.log(`   família documental do tipo definida como Procuração`)
    }

    // ── Versão ────────────────────────────────────────────────────────────
    const publicadaAtual = await prisma.modeloDocumentalVersao.findFirst({
      where: { modeloId: modelo.id, status: "PUBLICADA" },
      select: { id: true, numero: true, checksum: true },
    })
    if (publicadaAtual) {
      console.log(`   • já existe versão publicada v${publicadaAtual.numero} — nada a fazer\n`)
      continue
    }

    const versao = await criarVersao({
      modeloId: modelo.id,
      docx: preparado.buffer,
      nomeArquivo: `${def.codigo}-template.docx`,
      observacao: `Preparada a partir do modelo oficial do escritório em ${new Date().toISOString().slice(0, 10)}.`,
      usuarioId: usuario.id,
    })
    console.log(`   versão ${versao.numero} criada (checksum ${versao.checksum})`)

    await publicarVersao({
      versaoId: versao.id,
      dadosFixosDeclarados: def.dadosFixos,
      usuarioId: usuario.id,
    })
    console.log(`   ✓ versão ${versao.numero} PUBLICADA\n`)
  }

  const total = await prisma.modeloDocumental.count()
  const publicadas = await prisma.modeloDocumentalVersao.count({ where: { status: "PUBLICADA" } })
  console.log(`Modelos no repositório: ${total} · versões publicadas: ${publicadas}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
