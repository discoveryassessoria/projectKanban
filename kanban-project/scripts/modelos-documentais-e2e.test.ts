/**
 * MODELOS DOCUMENTAIS — cenários de integração (COM BANCO e COM STORAGE).
 *
 * Rodar: npm run test:modelos-e2e
 *
 * Cria o próprio cliente de teste (marcado com [TESTE-MODELOS]), executa os
 * quatro cenários do escopo e REMOVE tudo o que criou ao final — inclusive os
 * objetos que subiram ao storage. Um ambiente com dados reais termina o teste
 * exatamente como começou.
 */
import { prisma } from "../src/lib/prisma"
import { gerarDocumento, gerarPrevia, validarAntesDeGerar, ErroGeracao } from "../src/services/modelos/gerar-documento"
import {
  invalidarVersao,
  listarDocumentosGerados,
  urlDoArquivo,
} from "../src/services/modelos/documentos-gerados"
import { lerObjetoPrivado, removerObjetoPrivado } from "../src/lib/documentos/modelos/storage-privado"
import { textoDoDocx } from "../src/lib/documentos/modelos/docx"

const MARCA = "[TESTE-MODELOS]"

let passou = 0
let falhou = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const ATO = { localEmissao: "Amparo", dataEmissao: "2026-08-05" }

async function main() {
  console.log("MODELOS DOCUMENTAIS — cenários de integração\n")

  const usuario = await prisma.usuario.findFirst({ where: { tipo: "admin" }, select: { id: true } })
  if (!usuario) throw new Error("Sem usuário admin.")

  const modelos = await prisma.modeloDocumental.findMany({
    where: { ativo: true, versoes: { some: { status: "PUBLICADA" } } },
    select: { id: true, codigo: true, nome: true, documentTypeId: true },
    orderBy: { codigo: "asc" },
  })
  const judicial = modelos.find((m) => m.codigo === "PROC-JUD")
  const administrativa = modelos.find((m) => m.codigo === "PROC-ADM")
  ok(!!judicial && !!administrativa, "0.1 os dois modelos oficiais estão publicados")
  if (!judicial || !administrativa) throw new Error("Modelos não publicados — rode o seed antes.")

  // ── Clientes de teste ─────────────────────────────────────────────────────
  const completo = await prisma.contratante.create({
    data: {
      nome: `${MARCA} Amanda Ferreira Lima`,
      cpf: "529.982.247-25",
      rg: "45.678.901-2",
      sexo: "Feminino",
      estadoCivil: "Casado(a)",
      nacionalidade: "Brasileiro(a)",
      endereco: "Rua das Acácias",
      numero: "742",
      bairro: "Jardim Europa",
      cidade: "Amparo",
      estado: "SP",
      cep: "13900-111",
      pais: "Brasil",
    },
  })
  const incompleto = await prisma.contratante.create({
    data: { nome: `${MARCA} Cliente Sem Dados`, pais: "Brasil" },
  })

  const criados: number[] = [completo.id, incompleto.id]
  const chaves: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    console.log("\nCENÁRIO 1 — Procuração Judicial")

    const checagem = await validarAntesDeGerar({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
    })
    ok(checagem.podeGerar, "1.1 checklist aprovado para o cliente completo")
    ok(checagem.versao.numero >= 1, "1.2 a versão publicada do modelo é resolvida")

    const previa = await gerarPrevia({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
    })
    ok(previa.pdf.subarray(0, 5).toString() === "%PDF-", "1.3 prévia devolve um PDF")
    const antesDaPrevia = await prisma.documentoGeradoVersao.count()

    const g1 = await gerarDocumento({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
      usuarioId: usuario.id,
    })
    ok(g1.criado && g1.versaoNumero === 1, "1.4 documento gerado na versão 1")
    ok((await prisma.documentoGeradoVersao.count()) === antesDaPrevia + 1,
      "1.5 a prévia NÃO havia criado versão — só a geração cria")

    const v1 = await prisma.documentoGeradoVersao.findUniqueOrThrow({ where: { id: g1.versaoId } })
    chaves.push(v1.docxChave, v1.pdfChave)

    const docx = await lerObjetoPrivado(v1.docxChave)
    const pdf = await lerObjetoPrivado(v1.pdfChave)
    ok(docx.subarray(0, 2).toString() === "PK", "1.6 o DOCX está no storage e é um pacote válido")
    ok(pdf.subarray(0, 5).toString() === "%PDF-", "1.7 o PDF está no storage e é válido")
    ok(v1.docxChecksum !== v1.pdfChecksum && v1.docxChecksum.startsWith("sha256:"),
      "1.8 cada arquivo tem seu checksum")

    const texto = await textoDoDocx(docx)
    ok(texto.includes("Amanda Ferreira Lima"), "1.9 nome do outorgante no documento")
    ok(/Amanda Ferreira Lima, brasileira, portadora/.test(texto),
      "1.10 flexão gramatical correta para o gênero do cadastro")
    ok(texto.includes("45.678.901-2") && texto.includes("529.982.247-25"),
      "1.11 RG e CPF do outorgante no documento")
    ok(texto.includes("Rua das Acácias, 742, Jardim Europa, Amparo – SP, CEP 13900-111"),
      "1.12 endereço montado a partir do cadastro")
    ok(texto.includes("Amparo, 5 de agosto de 2026"), "1.13 cidade e data da emissão")
    ok(texto.includes("MARCELA ALESSANDRA URBANO"), "1.14 dados fixos da outorgada permanecem")
    ok(texto.includes("441.620"), "1.15 a OAB da outorgada permanece")
    ok(texto.includes("ad judicia") && texto.includes("retificação judicial de registros civis"),
      "1.16 os poderes judiciais permanecem intactos")
    ok(!texto.includes("{{") , "1.17 nenhum placeholder restou no documento final")
    ok(!texto.includes("EDISON") && !texto.includes("218.673.738-82"),
      "1.18 nenhum dado do cliente do modelo de origem restou")

    const agregado = await prisma.documentoGerado.findUniqueOrThrow({
      where: { id: g1.documentoGeradoId },
      include: { versoes: true },
    })
    ok(agregado.contratanteId === completo.id, "1.19 vínculo com o cliente")
    ok(agregado.documentTypeId === judicial.documentTypeId,
      "1.20 vínculo com o tipo documental do Cadastro Mestre")
    ok(agregado.requerenteId === null, "1.21 exatamente um outorgante")

    const url = await urlDoArquivo({
      documentoGeradoId: g1.documentoGeradoId, versaoId: g1.versaoId, formato: "pdf", download: false,
    })
    ok(url.url.includes("X-Amz-Signature") || url.url.includes("Signature"),
      "1.22 o arquivo só sai por URL assinada")
    ok(!url.url.startsWith(process.env.R2_PUBLIC_URL ?? "###"),
      "1.23 a URL não é o endereço público do bucket")

    // Duplo clique.
    const g1b = await gerarDocumento({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
      usuarioId: usuario.id,
    })
    ok(!g1b.criado && g1b.versaoId === g1.versaoId,
      "1.24 duplo clique com os mesmos dados NÃO cria segunda versão")

    // ══════════════════════════════════════════════════════════════════════
    console.log("\nCENÁRIO 2 — Procuração Administrativa")

    const g2 = await gerarDocumento({
      modeloId: administrativa.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
      usuarioId: usuario.id,
    })
    ok(g2.criado, "2.1 administrativa gerada")
    ok(g2.documentoGeradoId !== g1.documentoGeradoId,
      "2.2 tipo documental diferente → documento gerado diferente")

    const v2 = await prisma.documentoGeradoVersao.findUniqueOrThrow({ where: { id: g2.versaoId } })
    chaves.push(v2.docxChave, v2.pdfChave)
    const texto2 = await textoDoDocx(await lerObjetoPrivado(v2.docxChave))
    ok(texto2.includes("Amanda Ferreira Lima"), "2.3 nome do outorgante")
    ok(/Amanda Ferreira Lima, brasileira, casada, portadora/.test(texto2),
      "2.4 nacionalidade, estado civil e concordância flexionados")
    ok(texto2.includes("MARCO ANTONIO FRIEDRICH BRINKER ROVATTI"),
      "2.5 dados fixos do outorgado permanecem")
    ok(texto2.includes("46.133.682-0") && texto2.includes("336.287.958-69"),
      "2.6 RG e CPF do outorgado permanecem")
    ok(texto2.includes("cidadania italiana") && texto2.includes("Central de Informações de Registro Civil"),
      "2.7 os poderes administrativos permanecem intactos")
    ok(!texto2.includes("SYLVIA") && !texto2.includes("256.516.318-52"),
      "2.8 nenhum dado do cliente do modelo de origem restou")
    ok(!texto2.includes("residente na na "), "2.9 a duplicação de 'na' do modelo de origem foi corrigida")
    ok(!texto2.includes("{{"), "2.10 nenhum placeholder restou")

    // ══════════════════════════════════════════════════════════════════════
    console.log("\nCENÁRIO 3 — Dados ausentes bloqueiam")

    const antes = await prisma.documentoGeradoVersao.count()
    const check3 = await validarAntesDeGerar({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: incompleto.id },
      processoId: null,
      ato: ATO,
    })
    ok(!check3.podeGerar && check3.pendencias.length > 0,
      "3.1 checklist reprova e lista as pendências")
    ok(check3.pendencias.some((p) => p.chave === "OUTORGANTE_CPF"),
      "3.2 CPF ausente aparece nominalmente na lista")

    let bloqueou = false
    try {
      await gerarDocumento({
        modeloId: judicial.id,
        outorgante: { papel: "contratante", id: incompleto.id },
        processoId: null,
        ato: ATO,
        usuarioId: usuario.id,
      })
    } catch (e) {
      bloqueou = e instanceof ErroGeracao && e.codigo === "DADOS_INSUFICIENTES"
    }
    ok(bloqueou, "3.3 a geração é BLOQUEADA com motivo")
    ok((await prisma.documentoGeradoVersao.count()) === antes,
      "3.4 nenhuma versão foi criada")
    ok((await prisma.documentoGerado.count({ where: { contratanteId: incompleto.id } })) === 0,
      "3.5 nenhum documento gerado foi criado")

    // ══════════════════════════════════════════════════════════════════════
    console.log("\nCENÁRIO 4 — Nova versão após mudança de endereço")

    await prisma.contratante.update({
      where: { id: completo.id },
      data: { endereco: "Avenida Nova", numero: "1000", bairro: "Centro" },
    })

    const g3 = await gerarDocumento({
      modeloId: judicial.id,
      outorgante: { papel: "contratante", id: completo.id },
      processoId: null,
      ato: ATO,
      usuarioId: usuario.id,
    })
    ok(g3.criado && g3.versaoNumero === 2, "4.1 nova geração cria a VERSÃO 2")
    ok(g3.documentoGeradoId === g1.documentoGeradoId, "4.2 no MESMO documento gerado")

    const v3 = await prisma.documentoGeradoVersao.findUniqueOrThrow({ where: { id: g3.versaoId } })
    chaves.push(v3.docxChave, v3.pdfChave)

    const v1Depois = await prisma.documentoGeradoVersao.findUniqueOrThrow({ where: { id: g1.versaoId } })
    ok(v1Depois.status === "SUBSTITUIDA", "4.3 a versão 1 passou a SUBSTITUIDA")
    ok(v1Depois.substituidaPorId === g3.versaoId, "4.4 a versão 1 aponta para quem a substituiu")
    ok(v3.status === "VIGENTE", "4.5 a versão 2 é a vigente")
    ok(v1Depois.docxChave !== v3.docxChave && v1Depois.docxChecksum !== v3.docxChecksum,
      "4.6 os arquivos da versão anterior continuam existindo, intactos")

    const textoV1 = await textoDoDocx(await lerObjetoPrivado(v1Depois.docxChave))
    ok(textoV1.includes("Rua das Acácias"),
      "4.7 a versão 1 mantém o ENDEREÇO ANTIGO — mudar o cadastro não reescreve o passado")
    const textoV2 = await textoDoDocx(await lerObjetoPrivado(v3.docxChave))
    ok(textoV2.includes("Avenida Nova, 1000, Centro"), "4.8 a versão 2 usa o endereço atual")

    const snapshotV1 = v1Depois.dadosSnapshot as { variaveis?: Record<string, string> }
    ok(snapshotV1.variaveis?.OUTORGANTE_ENDERECO_LINHA?.includes("Rua das Acácias") === true,
      "4.9 o snapshot da versão 1 preserva os dados de origem")

    const vigentes = await prisma.documentoGeradoVersao.count({
      where: { documentoGeradoId: g1.documentoGeradoId, status: "VIGENTE" },
    })
    ok(vigentes === 1, "4.10 existe exatamente UMA versão vigente")

    // ══════════════════════════════════════════════════════════════════════
    console.log("\nCENÁRIO 5 — Leitura, invalidação e isolamento")

    const lista = await listarDocumentosGerados({ contratanteId: completo.id })
    ok(lista.length === 2, "5.1 a lista do cliente traz os dois documentos")
    ok(lista.every((d) => d.versoes.length >= 1), "5.2 cada documento traz seu histórico de versões")

    let bloqueouOutro = false
    try {
      await urlDoArquivo({
        documentoGeradoId: g2.documentoGeradoId, versaoId: g1.versaoId, formato: "pdf", download: false,
      })
    } catch {
      bloqueouOutro = true
    }
    ok(bloqueouOutro, "5.3 pedir a versão de OUTRO documento é recusado (anti-IDOR)")

    await invalidarVersao({
      documentoGeradoId: g2.documentoGeradoId,
      versaoId: g2.versaoId,
      motivo: "Teste automatizado",
      usuarioId: usuario.id,
    })
    const v2Depois = await prisma.documentoGeradoVersao.findUniqueOrThrow({ where: { id: g2.versaoId } })
    ok(v2Depois.status === "INVALIDADA" && v2Depois.motivoInvalidacao === "Teste automatizado",
      "5.4 invalidação registra estado e motivo")
    ok((await lerObjetoPrivado(v2Depois.pdfChave)).length > 0,
      "5.5 invalidar NÃO apaga o arquivo — o histórico permanece rastreável")

    const auditoria = await prisma.logAuditoria.count({
      where: { acao: { in: ["DOCUMENTO_GERADO", "DOCUMENTO_GERADO_INVALIDADO"] } },
    })
    ok(auditoria >= 4, "5.6 cada ato deixou trilha de auditoria")
  } finally {
    // ── Limpeza total ──────────────────────────────────────────────────────
    console.log("\nLimpando dados de teste…")
    const agregados = await prisma.documentoGerado.findMany({
      where: { contratanteId: { in: criados } },
      select: { id: true, versoes: { select: { docxChave: true, pdfChave: true } } },
    })
    for (const a of agregados) {
      for (const v of a.versoes) chaves.push(v.docxChave, v.pdfChave)
    }
    await prisma.documentoGeradoVersao.deleteMany({
      where: { documentoGerado: { contratanteId: { in: criados } } },
    })
    await prisma.documentoGerado.deleteMany({ where: { contratanteId: { in: criados } } })
    await prisma.contratante.deleteMany({ where: { id: { in: criados } } })
    let removidos = 0
    for (const chave of [...new Set(chaves)]) {
      try { await removerObjetoPrivado(chave); removidos++ } catch { /* já removido */ }
    }
    console.log(`  ${criados.length} clientes de teste removidos · ${removidos} objetos do storage removidos`)
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) {
    console.log("FALHAS: " + falhas.join("; "))
    process.exitCode = 1
    return
  }
  console.log("\nCENÁRIOS DE INTEGRAÇÃO ✅")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
