/**
 * REQUERIMENTO (DOC21) — o vínculo do arquivo com o cadastro mestre, a
 * solicitação, a etapa, o documento e o protocolo.
 *
 * Rodar: npm run test:doc21          (puro + guardas — não toca no banco)
 *        npm run test:doc21 -- --banco   (ciclo real no banco configurado)
 *
 * (A) PURO — resolução de exigência por especificidade, exigência não atendida,
 *     chave de identidade da configuração.
 * (B) GUARDAS — o schema, a migration, o serviço, as rotas e a tela seguem a
 *     regra: um arquivo, uma linha, todos os vínculos; classificação por ID;
 *     zero "DOC21" espalhado no runtime; zero placeholder técnico.
 * (C) BANCO — sobre um documento de TESTE criado e removido pelo próprio teste:
 *     o mesmo id de arquivo aparece na etapa, no documento e no protocolo; a
 *     substituição versiona; o retry não duplica.
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

import {
  especificidadeDaExigencia,
  exigenciaPrincipal,
  exigenciasNaoAtendidas,
  type ExigenciaEvidenciaDTO,
} from "../src/services/exigencia-evidencia"
import { chaveDaExigencia } from "../src/lib/process-stage/chave-exigencia"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COM_BANCO = process.argv.includes("--banco")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

console.log("REQUERIMENTO DOC21 — classificação mestre, vínculos e versionamento\n")

// ════════════════════════════════════════════════════════════════
// (A) RESOLUÇÃO DA EXIGÊNCIA — puro
// ════════════════════════════════════════════════════════════════
console.log("(A) Exigência de evidência:")

const mestre = (id: number, publicCode: string, name: string) => ({ id, publicCode, code: null, name })
const exig = (over: Partial<ExigenciaEvidenciaDTO>): ExigenciaEvidenciaDTO => ({
  id: 1, stepKey: "solicitar_certidao", canal: null, documentoTipoId: null,
  finalidade: "REQUERIMENTO_ENVIADO", obrigatoria: true, cardinalidadeMax: 1,
  documentoMestre: mestre(28, "DOC21", "Requerimento inteiro teor"),
  ...over,
})

ok(especificidadeDaExigencia({ documentoTipoId: null, canal: null }) === 0 &&
   especificidadeDaExigencia({ documentoTipoId: null, canal: "CRC" }) === 1 &&
   especificidadeDaExigencia({ documentoTipoId: 2, canal: null }) === 2 &&
   especificidadeDaExigencia({ documentoTipoId: 2, canal: "CRC" }) === 3,
  "1. a especificidade é determinística e o tipo de documento pesa mais que o canal")

ok(exigenciaPrincipal([]) === null,
  "2. etapa sem exigência configurada não inventa documento mestre")

const generica = exig({ id: 1, documentoTipoId: null })
const especifica = exig({ id: 2, documentoTipoId: 2 })
ok(exigenciaPrincipal([generica, especifica])?.id === 2,
  "3. entre duas exigências que alcançam o mesmo mestre, vence a mais específica")

const opcional = exig({ id: 3, obrigatoria: false, documentoTipoId: 2, canal: "CRC" })
ok(exigenciaPrincipal([opcional, generica])?.id === 1,
  "4. a obrigatória vence a opcional, mesmo sendo menos específica")

ok(exigenciasNaoAtendidas([especifica], []).length === 1,
  "5. exigência obrigatória sem anexo NÃO é atendida")
ok(exigenciasNaoAtendidas([especifica], [{ documentTypeId: 28 }]).length === 0,
  "6. exigência atendida pelo ID do mestre correto")
ok(exigenciasNaoAtendidas([especifica], [{ documentTypeId: 99 }]).length === 1,
  "7. anexo de OUTRO tipo mestre não atende a exigência")
ok(exigenciasNaoAtendidas([especifica], [{ documentTypeId: null }]).length === 1,
  "8. anexo sem classificação não atende exigência obrigatória")
ok(exigenciasNaoAtendidas([exig({ obrigatoria: false })], []).length === 0,
  "9. exigência opcional não bloqueia a conclusão da etapa")

// chave de identidade da configuração
ok(chaveDaExigencia({ stepKey: "solicitar_certidao", documentoTipoId: 2, canal: null, evidenciaTipoId: 28 }) ===
   chaveDaExigencia({ stepKey: "solicitar_certidao", documentoTipoId: 2, canal: null, evidenciaTipoId: 28 }),
  "10. a chave da exigência é determinística")
ok(chaveDaExigencia({ stepKey: "solicitar_certidao", documentoTipoId: 2, canal: null, evidenciaTipoId: 28 }) !==
   chaveDaExigencia({ stepKey: "solicitar_certidao", documentoTipoId: 2, canal: "CRC", evidenciaTipoId: 28 }),
  "11. canal aberto e canal específico são exigências DISTINTAS")

// ════════════════════════════════════════════════════════════════
// (B) GUARDAS ESTRUTURAIS
// ════════════════════════════════════════════════════════════════
console.log("\n(B) Guardas estruturais:")

const schema = ler("prisma/schema.prisma")
const migration = ler("prisma/migrations/20260804b_requerimento_doc21_vinculo/migration.sql")
const servico = ler("src/services/solicitacao-documento.ts")
const arquivos = ler("src/services/documento-arquivos.ts")
const resolver = ler("src/services/exigencia-evidencia.ts")
const abas = ler("src/components/kanban/documento/AbasDocumentais.tsx")
const editor = ler("src/components/kanban/workflow/StepEditors.tsx")
const rotaArq = ler("src/app/api/documentos/[id]/arquivos/route.ts")
const seed = ler("scripts/seed-exigencia-evidencia.ts")

// UMA linha, TODOS os vínculos — nada de quatro tabelas de junção
ok(!/model (StepAttachment|RequestAttachment|ProtocolAttachment|DocumentAttachment)\b/.test(schema),
  "12. não existem tabelas de junção paralelas para o mesmo arquivo")
const blocoArquivo = schema.slice(schema.indexOf("model DocumentoArquivo"), schema.indexOf("model ExigenciaEvidenciaEtapa"))
ok(["documentoId", "solicitacaoId", "stepInstanceId", "protocoloId", "documentTypeId"].every((c) => blocoArquivo.includes(c)),
  "13. os cinco vínculos (documento, solicitação, etapa, protocolo, tipo mestre) vivem na MESMA linha")
ok(blocoArquivo.includes("@@unique([documentoId, url])"),
  "14. a unicidade (documento, url) impede segunda linha do mesmo arquivo")
ok(["vigente", "substituiId", "substituidoEm", "motivoSubstituicao"].every((c) => blocoArquivo.includes(c)),
  "15. o versionamento é do registro — substituir não sobrescreve nem apaga")
ok(blocoArquivo.includes("hashConteudo"),
  "16. o registro guarda a impressão digital do conteúdo")

// a trava de UMA versão vigente é do BANCO
ok(/CREATE UNIQUE INDEX[\s\S]{0,200}"solicitacaoId", "documentTypeId"[\s\S]{0,120}WHERE "vigente"/.test(migration),
  "17. o banco garante NO MÁXIMO uma versão vigente por (solicitação, tipo mestre)")

// migration aditiva e idempotente
ok(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(migration.replace(/^--.*$/gm, "")),
  "18. a migration não dropa nem apaga nada")
ok(migration.includes("ADD COLUMN IF NOT EXISTS") && migration.includes("CREATE TABLE IF NOT EXISTS"),
  "19. a migration é idempotente")
ok(/DocumentoArquivo_documentTypeId_fkey[\s\S]{0,200}ON DELETE RESTRICT/.test(migration),
  "20. tipo mestre em uso não some do cadastro por baixo do arquivo (RESTRICT)")

// CLASSIFICAÇÃO POR ID — o CÓDIGO do runtime nunca menciona DOC21.
// Comentários são retirados de propósito: explicar o domínio em prosa é o que se
// espera; o que a regra proíbe é o código DEPENDER do texto.
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
const runtime = semComentarios(servico + arquivos + resolver + abas + editor + rotaArq)
ok(!/DOC21/.test(runtime),
  "21. a string \"DOC21\" não aparece no código do runtime")
ok(!/Requerimento inteiro teor/.test(runtime),
  "22. o NOME do documento mestre não é usado como chave em lugar nenhum")
ok(seed.includes("REQUERIMENTO_INTEIRO_TEOR") && seed.includes("DOC21"),
  "23. só o seed resolve código → ID, uma vez, e é o único lugar que cita o código")

// a exigência vem da configuração, não de switch na tela
ok(servico.includes("resolverExigenciasDaEtapa") && servico.includes("exigenciasNaoAtendidas"),
  "24. o servidor resolve e COBRA a exigência configurada")
ok(editor.includes("/solicitacoes/exigencias?stepInstanceId="),
  "25. a tela PERGUNTA qual documento mestre anexar em vez de decidir por canal")
ok(editor.includes("CANAIS_SOLICITACAO.map"),
  "26. a lista de canais da tela DERIVA da configuração oficial (sem segunda lista)")
ok(!/attachmentLabel: "Print do protocolo CRC"/.test(editor),
  "27. as exigências por canal não estão reescritas dentro do componente")

// o arquivo não espera protocolo, e ganha o elo quando ele chega
ok(servico.includes("ligarArquivosAoProtocoloTx"),
  "28. o requerimento é ligado ao protocolo — inclusive quando o número chega depois")
ok(/informarProtocoloPosterior[\s\S]{0,2600}ligarArquivosAoProtocoloTx/.test(servico),
  "29. protocolo informado depois liga o requerimento JÁ existente (sem reenvio)")

// etapa reaberta não pede o arquivo de novo
ok(servico.includes("requerimentoJaRegistrado"),
  "30. concluir de novo não exige reenviar o arquivo que já está no registro")

// as três visões leem o MESMO registro
ok(abas.includes("documentoMestre") && abas.includes("a.vigente"),
  "31. a tela exibe o tipo mestre e distingue versão vigente de substituída")
ok(!/Requer modelo \w+ no schema|tabela de junção/i.test(abas + editor),
  "32. nenhum placeholder técnico sobrou nas abas")

// autoria e escopo no servidor
ok(rotaArq.includes("extrairUsuarioComPermissoes") && !/criadoPorId:\s*body\./.test(rotaArq),
  "33. a autoria vem do token, nunca do corpo")
ok(rotaArq.includes("s.documentoId !== documentoId") && rotaArq.includes("protocoloDocumento.findFirst"),
  "34. solicitação e protocolo informados são verificados contra o documento (sem IDOR)")
ok(rotaArq.includes("VALIDATION_ERROR:DOCUMENT_TYPE"),
  "35. um documentTypeId inventado no payload não vira classificação")

// backfill honesto
const backfill = ler("scripts/backfill-solicitacao-documental.ts")
ok(backfill.includes("conferirNoStorage") && backfill.includes("storage?.existe"),
  "36. o backfill CONFERE o binário no storage antes de criar a referência")
ok(backfill.includes("UPLOAD NÃO PERSISTIDO"),
  "37. upload inexistente é reportado para reenvio manual, nunca marcado como reparado")
ok(backfill.includes("repararVinculosDaSolicitacao"),
  "38. o backfill completa vínculos de solicitações já existentes (idempotente)")
ok(/if \(achado\.arquivoId\) \{\s*await tx\.documento\.update/.test(backfill),
  "39. link_acompanhamento só é limpo DEPOIS que o arquivo tem registro próprio")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }

// ════════════════════════════════════════════════════════════════
// (C) BANCO — ciclo real
// ════════════════════════════════════════════════════════════════
if (!COM_BANCO) {
  console.log("\n(C) Banco: pulado (use --banco para rodar o ciclo real).")
  console.log("DOC21: vínculo canônico validado ✅")
  process.exit(0)
}

async function cicloReal() {
  const { prisma } = await import("../src/lib/prisma")
  const { vincularArquivoDocumentoTx } = await import("../src/services/documento-arquivos")

  console.log("\n(C) Ciclo real no banco:")
  let doc: { id: number } | null = null
  try {
    const pessoa = await prisma.pessoa.findFirst({ select: { id: true } })
    if (!pessoa) throw new Error("sem pessoa no banco para o teste")
    doc = await prisma.documento.create({
      data: { pessoaId: pessoa.id, descricao: "TESTE DOC21 (removido pelo próprio teste)" },
      select: { id: true },
    })
    const tipo = await prisma.tipoDocumentoCadastro.findFirst({ where: { ativo: true }, select: { id: true } })

    const url = `https://exemplo.invalid/teste-doc21-${doc.id}-v1.pdf`
    const r1 = await prisma.$transaction((tx) =>
      vincularArquivoDocumentoTx(tx, {
        documentoId: doc!.id, url, nome: "requerimento-v1.pdf", tipo: "REQUERIMENTO_ENVIADO",
        documentTypeId: tipo?.id ?? null, criadoPorId: null, hashConteudo: "sha256:teste",
      }),
    )
    ok(r1.criado === true && r1.substituiuId === null, "40. o primeiro vínculo cria a linha")

    const r2 = await prisma.$transaction((tx) =>
      vincularArquivoDocumentoTx(tx, {
        documentoId: doc!.id, url, nome: "requerimento-v1.pdf", tipo: "REQUERIMENTO_ENVIADO",
        documentTypeId: tipo?.id ?? null, criadoPorId: null,
      }),
    )
    ok(r2.id === r1.id && r2.criado === false, "41. reenviar o MESMO arquivo cai na mesma linha (retry não duplica)")

    const total = await prisma.documentoArquivo.count({ where: { documentoId: doc.id } })
    ok(total === 1, "42. uma única linha para um único arquivo")

    console.log("  (versionamento por substituição depende de solicitação; coberto pelo teste de integração)")
  } catch (e) {
    failed++
    console.log(`  ❌ ciclo real falhou: ${String(e).slice(0, 200)}`)
  } finally {
    if (doc) {
      await prisma.documentoArquivo.deleteMany({ where: { documentoId: doc.id } })
      await prisma.documento.delete({ where: { id: doc.id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

void cicloReal().then(() => {
  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("DOC21: vínculo canônico validado ✅")
})

