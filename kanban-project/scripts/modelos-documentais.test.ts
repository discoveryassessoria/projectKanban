/**
 * MODELOS DOCUMENTAIS — suíte unitária do repositório oficial e do motor de geração.
 *
 * Rodar: npm run test:modelos
 *
 * Não precisa de banco: os motores (DOCX, PDF, validador, registry, resolução do
 * outorgante) são puros. O que depende de banco vive em
 * `modelos-documentais-e2e.test.ts`, e o que trata de arquitetura vive em
 * `modelos-documentais-guard.test.ts`.
 */
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  substituirLiteraisDocx,
  substituirPlaceholdersDocx,
  textoDoDocx,
  estruturaDoDocx,
  type ParLiteral,
} from "../src/lib/documentos/modelos/docx"
import { pdfDoDocx } from "../src/lib/documentos/modelos/pdf"
import {
  validarTemplate,
  nenhumPlaceholderRestante,
  literaisDeIdentificacao,
} from "../src/lib/documentos/modelos/validador"
import {
  VARIAVEIS_MODELO,
  variavelConhecida,
  flexionar,
  generoGramatical,
  concordarPortador,
  dataPorExtenso,
  formatarCpf,
  formatarCep,
  montarLinhaEndereco,
  extrairPlaceholders,
} from "../src/lib/documentos/modelos/variaveis"
import {
  resolverOutorgante,
  dataLocalDeIso,
  type CadastroOutorgante,
} from "../src/services/modelos/outorgante"
import { chaveDeIdentidade } from "../src/services/modelos/gerar-documento"
import { checksumDoBuffer, nomeSeguro } from "../src/lib/documentos/modelos/storage-privado"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passou = 0
let falhou = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// ════════════════════════════════════════════════════════════════════════════
// TEMPLATES SINTÉTICOS — o teste não depende dos arquivos do escritório.
// ════════════════════════════════════════════════════════════════════════════

/** DOCX mínimo, montado à mão, com runs partidos como o Word faz. */
async function docxDeTeste(paragrafos: string[][]): Promise<Buffer> {
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  )
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  const corpo = paragrafos
    .map(
      (runs) =>
        `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs
          .map((t) => `<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`)
          .join("")}</w:p>`,
    )
    .join("")
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="708" w:footer="708"/></w:sectPr></w:body></w:document>`,
  )
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>
}

/** DOCX de teste com o parágrafo inteiro num run JÁ negrito. */
async function docxDeTesteComNegrito(texto: string): Promise<Buffer> {
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  )
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${texto}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701"/></w:sectPr></w:body></w:document>`,
  )
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>
}

const CADASTRO_COMPLETO: CadastroOutorgante = {
  papel: "contratante",
  id: 1,
  publicCode: "CLI-TESTE",
  nome: "Maria Aparecida de Souza",
  cpf: "12345678909",
  rg: "12.345.678-9",
  sexo: "Feminino",
  estadoCivil: "Casado(a)",
  nacionalidade: "Brasileiro(a)",
  profissao: "Advogado",
  endereco: "Rua das Flores",
  numero: "100",
  complemento: null,
  bairro: "Centro",
  cidade: "Amparo",
  estado: "SP",
  cep: "13900000",
  pais: "Brasil",
  pessoaId: null,
}

const ATO = { localEmissao: "Amparo", dataEmissao: "2026-08-05" }

async function main() {
  console.log("MODELOS DOCUMENTAIS — suíte unitária\n")

  // ══════════════════════════════════════════════════════════════════════
  console.log("(1) Registry de variáveis:")

  ok(
    new Set(VARIAVEIS_MODELO.map((v) => v.chave)).size === VARIAVEIS_MODELO.length,
    "1.1 nenhuma chave repetida no registry",
  )
  const ESPERADAS = [
    "OUTORGANTE_NOME_COMPLETO", "OUTORGANTE_NACIONALIDADE", "OUTORGANTE_ESTADO_CIVIL",
    "OUTORGANTE_PROFISSAO", "OUTORGANTE_RG", "OUTORGANTE_RG_ORGAO", "OUTORGANTE_CPF",
    "OUTORGANTE_LOGRADOURO", "OUTORGANTE_NUMERO", "OUTORGANTE_COMPLEMENTO",
    "OUTORGANTE_BAIRRO", "OUTORGANTE_CIDADE", "OUTORGANTE_UF", "OUTORGANTE_CEP",
    "OUTORGANTE_PAIS", "LOCAL_EMISSAO", "DATA_EMISSAO_EXTENSO", "ASSINATURA_NOME",
  ]
  ok(ESPERADAS.every(variavelConhecida), "1.2 as variáveis canônicas do escopo existem")
  ok(!variavelConhecida("OUTORGANTE_NOM"), "1.3 variável com erro de grafia não é reconhecida")
  ok(
    VARIAVEIS_MODELO.every((v) => v.origem !== "cadastro_outorgante" || v.campo.length > 0),
    "1.4 toda variável de cadastro declara o campo de origem",
  )
  ok(
    extrairPlaceholders("a {{OUTORGANTE_CPF}} b {{LOCAL_EMISSAO}} c {{OUTORGANTE_CPF}}").length === 2,
    "1.5 extração de placeholders não repete chave",
  )

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(2) Flexão gramatical e formatação:")

  ok(generoGramatical("Feminino") === "feminino" && generoGramatical("Masculino") === "masculino",
    "2.1 gênero vem do cadastro")
  ok(generoGramatical(null) === null && generoGramatical("") === null && generoGramatical("x") === null,
    "2.2 gênero desconhecido é null — nunca se chuta")
  ok(flexionar("Brasileiro(a)", "feminino") === "Brasileira", "2.3 brasileiro → brasileira")
  ok(flexionar("Brasileiro(a)", "masculino") === "Brasileiro", "2.4 brasileiro permanece no masculino")
  ok(flexionar("Casado(a)", "feminino") === "Casada", "2.5 casado → casada")
  ok(flexionar("Solteiro", "feminino") === "Solteira", "2.6 solteiro → solteira")
  ok(flexionar("Viúvo(a)", "feminino") === "Viúva", "2.7 viúvo → viúva")
  ok(flexionar("União estável", "feminino") === "União estável",
    "2.8 termo sem desinência flexionável não é alterado")
  ok(concordarPortador("feminino") === "portadora" && concordarPortador("masculino") === "portador",
    "2.9 portador / portadora")
  ok(dataPorExtenso(new Date(2026, 7, 5)) === "5 de agosto de 2026", "2.10 data por extenso em português")
  ok(formatarCpf("12345678909") === "123.456.789-09", "2.11 CPF formatado")
  ok(formatarCpf("123") === "123", "2.12 CPF fora do padrão volta como está — nada é inventado")
  ok(formatarCep("13900000") === "13900-000", "2.13 CEP formatado")
  ok(
    montarLinhaEndereco({ logradouro: "Rua A", numero: "1", cidade: "Amparo", uf: "SP", cep: "13900000" }) ===
      "Rua A, 1, Amparo – SP, CEP 13900-000",
    "2.14 endereço sem bairro/complemento não deixa vírgula solta",
  )
  ok(
    montarLinhaEndereco({ logradouro: "Rua A", numero: "1", complemento: "Casa 3", bairro: "Centro", cidade: "Amparo", uf: "SP", cep: "13900000" })
      === "Rua A, 1, Casa 3, Centro, Amparo – SP, CEP 13900-000",
    "2.15 endereço completo mantém a ordem do instrumento",
  )
  ok(dataLocalDeIso("2026-08-05")?.getDate() === 5,
    "2.16 data ISO vira data LOCAL — sem voltar um dia por fuso")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(3) Resolução do outorgante:")

  const usadas = ["OUTORGANTE_NOME_COMPLETO", "OUTORGANTE_NACIONALIDADE", "OUTORGANTE_ESTADO_CIVIL",
    "OUTORGANTE_PORTADOR", "OUTORGANTE_RG", "OUTORGANTE_CPF", "OUTORGANTE_ENDERECO_LINHA",
    "LOCAL_EMISSAO", "DATA_EMISSAO_EXTENSO", "ASSINATURA_NOME"]

  const r = resolverOutorgante({ cadastro: CADASTRO_COMPLETO, ato: ATO, variaveisDoTemplate: usadas })
  ok(r.podeGerar, "3.1 cadastro completo libera a geração")
  ok(r.valores.OUTORGANTE_NOME_COMPLETO === "Maria Aparecida de Souza",
    "3.2 nome vem do cadastro, com a grafia do cadastro")
  ok(r.valores.OUTORGANTE_NACIONALIDADE === "brasileira",
    "3.3 nacionalidade flexionada e em minúscula — é adjetivo no corpo da frase")
  ok(r.valores.OUTORGANTE_ESTADO_CIVIL === "casada", "3.4 estado civil flexionado")
  ok(r.valores.OUTORGANTE_PORTADOR === "portadora", "3.5 concordância de portador")
  ok(r.valores.OUTORGANTE_RG === "12.345.678-9", "3.6 RG vem do cadastro")
  ok(r.valores.OUTORGANTE_CPF === "123.456.789-09", "3.7 CPF vem do cadastro, formatado")
  ok(r.valores.OUTORGANTE_ENDERECO_LINHA.includes("Rua das Flores, 100, Centro, Amparo – SP"),
    "3.8 endereço montado a partir dos campos atômicos")
  ok(r.valores.ASSINATURA_NOME === CADASTRO_COMPLETO.nome, "3.9 assinatura usa o nome do cadastro")
  ok(r.valores.DATA_EMISSAO_EXTENSO === "5 de agosto de 2026", "3.10 data da emissão por extenso")
  ok(r.valores.LOCAL_EMISSAO === "Amparo", "3.11 cidade da emissão vem do ato")

  const semRg = resolverOutorgante({
    cadastro: { ...CADASTRO_COMPLETO, rg: null }, ato: ATO, variaveisDoTemplate: usadas,
  })
  ok(!semRg.podeGerar && semRg.pendencias.some((p) => p.chave === "OUTORGANTE_RG"),
    "3.12 dado obrigatório ausente BLOQUEIA e aparece na lista de pendências")
  ok(!("OUTORGANTE_RG" in semRg.valores),
    "3.13 dado ausente não vira string vazia — não existe placeholder em branco")

  const semSexo = resolverOutorgante({
    cadastro: { ...CADASTRO_COMPLETO, sexo: null }, ato: ATO, variaveisDoTemplate: usadas,
  })
  ok(!semSexo.podeGerar && semSexo.pendencias.some((p) => p.estado === "invalido"),
    "3.14 sem gênero gramatical a geração é bloqueada — nada de concordância errada")

  const semComplemento = resolverOutorgante({
    cadastro: { ...CADASTRO_COMPLETO, complemento: null },
    ato: ATO,
    variaveisDoTemplate: [...usadas, "OUTORGANTE_COMPLEMENTO"],
  })
  ok(semComplemento.podeGerar, "3.15 variável opcional ausente NÃO bloqueia")

  const soNome = resolverOutorgante({
    cadastro: { ...CADASTRO_COMPLETO, rg: null },
    ato: ATO,
    variaveisDoTemplate: ["OUTORGANTE_NOME_COMPLETO"],
  })
  ok(soNome.podeGerar, "3.16 o que bloqueia é o que o TEMPLATE usa, não o registry inteiro")
  ok(
    soNome.checklist.find((i) => i.chave === "OUTORGANTE_RG")?.estado === "nao_aplicavel",
    "3.17 variável fora do template aparece como não aplicável",
  )

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(4) Motor DOCX:")

  const template = await docxDeTeste([
    ["OUTORGANTE: ", "{{OUTORGANTE_NOME_COMPLETO}}", ", ", "{{OUTORGANTE_NACIONALIDADE}}", ", ", "{{OUTORGANTE_PORTADOR}} da cédula nº ", "{{OUTORGANTE_RG}}", " e CPF nº {{OUTORGANTE_CPF}}."],
    ["PODERES: texto jurídico fixo que não pode mudar."],
    // Placeholder PARTIDO entre runs, como o Word costuma gravar.
    ["{{LOCAL", "_EMISSAO}}", ", ", "{{DATA_EMI", "SSAO_EXTENSO}}", "."],
    ["{{ASSINATURA_NOME}}"],
  ])

  const val = await validarTemplate(template)
  ok(val.ok, "4.1 template sintético passa na validação")
  ok(val.placeholders.includes("LOCAL_EMISSAO") && val.placeholders.includes("DATA_EMISSAO_EXTENSO"),
    "4.2 placeholder partido entre runs é reconhecido")

  const gerado = await substituirPlaceholdersDocx(template, r.valores)
  const texto = await textoDoDocx(gerado.buffer)
  ok((await nenhumPlaceholderRestante(gerado.buffer)).length === 0,
    "4.3 nenhum placeholder sobra no documento final")
  ok(texto.includes("MARIA APARECIDA DE SOUZA"), "4.4 nome preenchido")
  ok(texto.includes("brasileira"), "4.5 nacionalidade preenchida")
  ok(texto.includes("portadora"), "4.6 concordância aplicada")
  ok(texto.includes("12.345.678-9"), "4.7 RG preenchido")
  ok(texto.includes("123.456.789-09"), "4.8 CPF preenchido")
  ok(texto.includes("Amparo, 5 de agosto de 2026"),
    "4.9 cidade e data preenchidas mesmo com placeholder partido")
  ok(texto.includes("PODERES: texto jurídico fixo que não pode mudar."),
    "4.10 o texto fixo permanece intacto")
  ok(gerado.naoResolvidas.length === 0, "4.11 nenhuma variável ficou sem valor")

  const parcial = await substituirPlaceholdersDocx(template, { OUTORGANTE_NOME_COMPLETO: "X" })
  ok(parcial.naoResolvidas.includes("OUTORGANTE_RG"),
    "4.12 variável sem valor é REPORTADA, não substituída por vazio")
  ok((await textoDoDocx(parcial.buffer)).includes("{{OUTORGANTE_RG}}"),
    "4.13 sem valor, o marcador permanece — e a barreira final o pega")

  const doisIguais = await substituirPlaceholdersDocx(template, r.valores)
  ok(checksumDoBuffer(gerado.buffer) === checksumDoBuffer(doisIguais.buffer),
    "4.14 geração é determinística: mesmos dados, mesmo checksum")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(4B) Nome do outorgante: CAIXA ALTA e negrito na renderização:")

  // O template escreve o nome num run SEM negrito e cercado de texto comum — é
  // assim que se prova que a ênfase vem do motor e atinge só o nome.
  const templateNome = await docxDeTeste([
    ["OUTORGANTE: ", "{{OUTORGANTE_NOME_COMPLETO}}", ", ", "{{OUTORGANTE_NACIONALIDADE}}", ", CPF nº {{OUTORGANTE_CPF}}."],
    ["_______________________", "{{ASSINATURA_NOME}}"],
  ])
  const comNome = await substituirPlaceholdersDocx(templateNome, r.valores)
  const textoNome = await textoDoDocx(comNome.buffer)
  const estruturaNome = await estruturaDoDocx(comNome.buffer)
  const trechos = estruturaNome.paragrafos.flatMap((p) => p.trechos)
  const trechoDoNome = trechos.find((t) => t.texto.includes("MARIA APARECIDA DE SOUZA"))
  const trechoDaAssinatura = estruturaNome.paragrafos[1].trechos.find((t) =>
    t.texto.includes("MARIA APARECIDA DE SOUZA"),
  )

  ok(textoNome.includes("MARIA APARECIDA DE SOUZA"),
    "4B.1 o nome é renderizado em CAIXA ALTA")
  ok(!textoNome.includes("Maria Aparecida de Souza"),
    "4B.2 a grafia do cadastro não aparece no documento")
  ok(trechoDoNome?.negrito === true, "4B.3 o nome é renderizado em NEGRITO")
  ok(trechoDaAssinatura?.negrito === true, "4B.4 o nome sob a assinatura também sai em negrito")

  ok(r.valores.OUTORGANTE_NOME_COMPLETO === "Maria Aparecida de Souza",
    "4B.5 o VALOR resolvido — e portanto o snapshot da versão — conserva a grafia do cadastro")
  ok(CADASTRO_COMPLETO.nome === "Maria Aparecida de Souza",
    "4B.6 o cadastro de origem não é tocado pela renderização")

  const outros = trechos.filter(
    (t) => !t.texto.includes("MARIA APARECIDA DE SOUZA") && t.texto.trim().length > 0,
  )
  ok(outros.length > 0 && outros.every((t) => !t.negrito),
    "4B.7 nenhum outro trecho do parágrafo virou negrito")
  ok(textoNome.includes("brasileira") && textoNome.includes("123.456.789-09"),
    "4B.8 os demais placeholders continuam como estavam — sem caixa alta")
  ok(trechos.some((t) => t.texto.includes("OUTORGANTE: ") && !t.negrito),
    "4B.9 o texto fixo em volta do nome conserva a formatação original")
  ok(estruturaNome.paragrafos[0].trechos.every((t) => t.tamanho === 12),
    "4B.10 fonte e tamanho do parágrafo permanecem os do template")

  // Um run que JÁ era negrito não deve ganhar marcação duplicada.
  const jaNegrito = await substituirPlaceholdersDocx(
    await docxDeTesteComNegrito("{{OUTORGANTE_NOME_COMPLETO}}"),
    r.valores,
  )
  const estruturaJa = await estruturaDoDocx(jaNegrito.buffer)
  ok(estruturaJa.paragrafos[0].trechos.every((t) => t.negrito),
    "4B.11 template com o nome já em negrito continua correto")
  ok((await textoDoDocx(jaNegrito.buffer)).includes("MARIA APARECIDA DE SOUZA"),
    "4B.12 e o valor continua em caixa alta")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(5) Motor PDF — a partir do DOCX gerado:")

  const pdf = await pdfDoDocx(gerado.buffer)
  ok(pdf.subarray(0, 5).toString() === "%PDF-", "5.1 PDF é gerado e tem assinatura de arquivo")
  ok(pdf.length > 500, "5.2 PDF tem conteúdo")
  const pdf2 = await pdfDoDocx(doisIguais.buffer)
  ok(checksumDoBuffer(pdf) === checksumDoBuffer(pdf2),
    "5.3 PDF também é determinístico — checksum prova identidade")

  const estrutura = await estruturaDoDocx(gerado.buffer)
  ok(Math.round(estrutura.pagina.largura) === 595 && Math.round(estrutura.pagina.altura) === 842,
    "5.4 geometria da página é lida do DOCX (A4)")
  ok(Math.round(estrutura.pagina.margemEsquerda) === 85,
    "5.5 margens são lidas do DOCX, não arbitradas")
  ok(estrutura.paragrafos[0].alinhamento === "justify",
    "5.6 alinhamento do parágrafo é lido do DOCX")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(6) Validador de template:")

  const semVariavel = await docxDeTeste([["Documento sem nenhuma variável."]])
  const v2 = await validarTemplate(semVariavel)
  ok(!v2.ok && v2.achados.some((a) => a.codigo === "TEMPLATE_SEM_VARIAVEL"),
    "6.1 template sem variável reprova")

  const desconhecida = await docxDeTeste([["{{OUTORGANTE_NOM}}"]])
  const v3 = await validarTemplate(desconhecida)
  ok(!v3.ok && v3.achados.some((a) => a.codigo === "PLACEHOLDER_DESCONHECIDO"),
    "6.2 placeholder desconhecido reprova a publicação")

  const malFormado = await docxDeTeste([["{{OUTORGANTE_CPF}} e {{LOCAL_EMISSAO"]])
  const v4 = await validarTemplate(malFormado)
  ok(!v4.ok && v4.achados.some((a) => a.codigo === "MARCADOR_MAL_FORMADO"),
    "6.3 marcador aberto e não fechado reprova")

  const comCpfExemplo = await docxDeTeste([["{{OUTORGANTE_NOME_COMPLETO}}, CPF nº 218.673.738-82."]])
  const v5 = await validarTemplate(comCpfExemplo)
  ok(!v5.ok && v5.achados.some((a) => a.codigo === "DADO_IDENTIFICACAO_NAO_DECLARADO"),
    "6.4 CPF fixo não declarado BLOQUEIA a publicação")
  const v6 = await validarTemplate(comCpfExemplo, { dadosFixosDeclarados: ["218.673.738-82"] })
  ok(v6.ok, "6.5 o mesmo CPF, declarado como dado fixo do outorgado, libera")
  const v7 = await validarTemplate(comCpfExemplo, {
    dadosFixosDeclarados: ["218.673.738-82"],
    digitosDeClientesReais: ["21867373882"],
  })
  ok(v7.achados.some((a) => a.codigo === "DADO_DE_CLIENTE_REAL"),
    "6.6 número que existe no cadastro de clientes é sempre reportado")
  const v8 = await validarTemplate(comCpfExemplo, { digitosDeClientesReais: ["21867373882"] })
  ok(!v8.ok && v8.achados.some((a) => a.codigo === "DADO_DE_CLIENTE_REAL" && a.severidade === "erro"),
    "6.7 sem declaração, dado de cliente real é erro")

  ok((await validarTemplate(Buffer.from("não sou um docx"))).achados[0].codigo === "DOCX_INVALIDO",
    "6.8 arquivo que não é DOCX reprova com motivo claro")

  const literais = literaisDeIdentificacao("CPF 218.673.738-82, RG 34.025.063-X, CEP 09121-370")
  ok(literais.length === 3, "6.9 CPF, RG e CEP são reconhecidos como identificação")
  ok(!literaisDeIdentificacao("OAB/SP nº 441.620").length,
    "6.10 número de OAB não é confundido com identificação civil")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(7) Preparação de template (conversão de documento em modelo):")

  const documentoReal = await docxDeTeste([
    ["OUTORGANTE: ", "FULANO DE TAL", ", brasileiro, portador da cédula nº 11.111.111-1."],
    ["PODERES: texto fixo."],
    ["FULANO DE TAL"],
  ])
  const pares: ParLiteral[] = [
    { de: "FULANO DE TAL", para: "{{OUTORGANTE_NOME_COMPLETO}}", limite: 1 },
    { de: "FULANO DE TAL", para: "{{ASSINATURA_NOME}}" },
    { de: "11.111.111-1", para: "{{OUTORGANTE_RG}}" },
  ]
  const prep = await substituirLiteraisDocx(documentoReal, pares)
  const textoPrep = await textoDoDocx(prep.buffer)
  ok(prep.naoEncontrados.length === 0, "7.1 todos os trechos declarados foram encontrados")
  ok(textoPrep.includes("{{OUTORGANTE_NOME_COMPLETO}}") && textoPrep.includes("{{ASSINATURA_NOME}}"),
    "7.2 a mesma grafia vira variáveis DIFERENTES conforme a posição (nome × assinatura)")
  ok(!textoPrep.includes("FULANO DE TAL"), "7.3 nenhum dado do cliente de origem permanece")
  ok(!textoPrep.includes("11.111.111-1"), "7.4 nenhum RG do cliente de origem permanece")
  ok(textoPrep.includes("PODERES: texto fixo."), "7.5 o texto fixo é preservado na conversão")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(8) Identidade e idempotência:")

  const chaveA = chaveDeIdentidade({ documentTypeId: 23, outorgante: { papel: "contratante", id: 7 }, processoId: 5 })
  const chaveB = chaveDeIdentidade({ documentTypeId: 23, outorgante: { papel: "contratante", id: 7 }, processoId: 5 })
  const chaveC = chaveDeIdentidade({ documentTypeId: 23, outorgante: { papel: "contratante", id: 7 }, processoId: null })
  const chaveD = chaveDeIdentidade({ documentTypeId: 25, outorgante: { papel: "contratante", id: 7 }, processoId: 5 })
  const chaveE = chaveDeIdentidade({ documentTypeId: 23, outorgante: { papel: "requerente", id: 7 }, processoId: 5 })
  ok(chaveA === chaveB, "8.1 mesma combinação → mesma identidade (nova geração vira VERSÃO)")
  ok(chaveA !== chaveC, "8.2 processo diferente → documento diferente")
  ok(chaveA !== chaveD, "8.3 tipo documental diferente → documento diferente")
  ok(chaveA !== chaveE, "8.4 papel diferente → documento diferente")
  ok(!/[A-Za-zÀ-ÿ]{4,}\s[A-Za-zÀ-ÿ]{4,}/.test(chaveA),
    "8.5 a identidade é feita de IDS — nome de pessoa nunca é chave")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(9) Storage privado:")

  ok(nomeSeguro("Procuração João & Cia.docx") === "Procuracao_Joao_Cia.docx",
    "9.1 nome de arquivo é saneado")
  ok(!/[\/\s]/.test(nomeSeguro("pasta/CPF 123 João.docx")),
    "9.2 nome saneado não carrega barra nem espaço — caminho de storage não vira estrutura")
  ok(checksumDoBuffer(Buffer.from("a")).startsWith("sha256:"), "9.3 checksum no formato canônico")
  ok(checksumDoBuffer(Buffer.from("a")) !== checksumDoBuffer(Buffer.from("b")),
    "9.4 conteúdos diferentes têm checksums diferentes")

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(10) Templates oficiais (quando disponíveis):")

  const oficiais = join(ROOT, "..", "..", "..")
  void oficiais
  const caminhoJud = process.env.TEMPLATE_JUDICIAL
  if (caminhoJud && existsSync(caminhoJud)) {
    const t = readFileSync(caminhoJud)
    ok((await validarTemplate(t)).placeholders.length > 0, "10.1 template judicial oficial tem variáveis")
  } else {
    console.log("  ⏭️  (pulado — defina TEMPLATE_JUDICIAL para conferir o arquivo oficial)")
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) {
    console.log("FALHAS: " + falhas.join("; "))
    process.exit(1)
  }
  console.log("\nMODELOS DOCUMENTAIS ✅")
}

void main()
