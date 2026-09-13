// scripts/invalidacao-downstream.test.ts
// ============================================================================
// CADEIA DE IMPACTO DOWNSTREAM DE INVALIDAÇÃO PÓS-VALIDAÇÃO (mandato Emissão
// Documental, doc 20 §§43/79 — pendência explícita registrada em doc 27).
//
// Prova, com dados reais (não mock):
//   1. Documento validado satisfaz a NecessidadeDocumental dele (ATENDIDA).
//   2. `invalidarDocumento` (efeito INVALIDATE_DOCUMENT) muda o Documento para
//      INVALIDO E regride a necessidade — ela NÃO fica travada em ATENDIDA
//      apontando para um documento que não vale mais.
//   3. O histórico da validação anterior (evento ATENDIDA) permanece íntegro
//      (append-only) — a regressão não apaga o que aconteceu, só reabre.
//   4. `identificarImpactoDownstream` lista corretamente um registro downstream
//      fabricado (PastaApostilamentoDocumento) que aponta para o documento —
//      a parte de IDENTIFICAÇÃO (read-only) que o mandato pede.
//   5. Idempotência: invalidar de novo não duplica evento de reabertura.
//
//   npx tsx scripts/invalidacao-downstream.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { invalidarDocumento } from "@/src/services/efeitos-de-dominio"
import { identificarImpactoDownstream } from "@/src/services/documento-operacao"
import { randomUUID } from "crypto"

const MARCA = "INVDOWN"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const docs = await prisma.documento.findMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } }, select: { id: true } })
  const docIds = docs.map((d) => d.id)
  if (docIds.length) await prisma.documentoObservacao.deleteMany({ where: { documentoId: { in: docIds } } })
  if (ids.length) {
    // PastaApostilamento/PastaApostilamentoDocumento cascateiam pelo próprio banco
    // (onDelete: Cascade em ambos os sentidos) — não precisam de limpeza manual.
    await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
    await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("prova a cadeia de impacto downstream de invalidação pós-validação")
  await limpar()

  console.log("CADEIA DE IMPACTO DOWNSTREAM DE INVALIDAÇÃO PÓS-VALIDAÇÃO\n")

  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_C1`, name: "Certidão de nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} C1` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} C1`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Pessoa", sobrenome: "Teste" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-C1-${proc.id}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pes.id, status: "RECEBIDO", necessidadeId: nec.id },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) Documento validado satisfaz a necessidade (ATENDIDA)")
  // ══════════════════════════════════════════════════════════════════════════
  await atenderNecessidade(nec.id)
  const nec1 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: nec.id }, select: { status: true } })
  ok("1a) necessidade está ATENDIDA", nec1.status === "ATENDIDA", nec1.status)
  const eventosAntes = await prisma.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: nec.id }, orderBy: { id: "asc" }, select: { tipo: true } })
  ok("1b) histórico registrou o evento ATENDIDA", eventosAntes.some((e) => e.tipo === "ATENDIDA"), eventosAntes.map((e) => e.tipo).join(","))

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) Documento é invalidado (efeito INVALIDATE_DOCUMENT)")
  // ══════════════════════════════════════════════════════════════════════════
  const resultadoEfeito = await invalidarDocumento({
    stepInstanceId: 0,
    documentoId: doc.id,
    processoId: proc.id,
    valores: { motivo: "teste: documento com erro de escrita descoberto após validação" },
    usuarioId: null,
    sync: { origem: "USER", correlationId: randomUUID() },
  })
  ok("2a) efeito reporta status alterado para INVALIDO", resultadoEfeito.statusAlterado === true && resultadoEfeito.novoStatus === "INVALIDO")
  const docDepois = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id }, select: { status: true } })
  ok("2b) Documento.status é INVALIDO", docDepois.status === "INVALIDO", docDepois.status)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) A necessidade REGRIDE — não fica travada em ATENDIDA apontando para documento que não vale mais")
  // ══════════════════════════════════════════════════════════════════════════
  const nec2 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: nec.id }, select: { status: true } })
  ok("3a) necessidade voltou para EM_ATENDIMENTO (GAP REAL corrigido nesta rodada)", nec2.status === "EM_ATENDIMENTO", nec2.status)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) O histórico da validação anterior permanece íntegro (append-only)")
  // ══════════════════════════════════════════════════════════════════════════
  const eventosDepois = await prisma.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: nec.id }, orderBy: { id: "asc" }, select: { tipo: true } })
  ok("4a) o evento ATENDIDA original NÃO foi apagado", eventosDepois.some((e) => e.tipo === "ATENDIDA"))
  ok("4b) um novo evento REABERTA foi acrescentado (histórico cresce, nunca reescreve)", eventosDepois.some((e) => e.tipo === "REABERTA"))
  ok("4c) contagem de eventos aumentou (nada foi sobrescrito)", eventosDepois.length > eventosAntes.length, `${eventosAntes.length} → ${eventosDepois.length}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) identificarImpactoDownstream (read-only): encontra um dependente real fabricado")
  // ══════════════════════════════════════════════════════════════════════════
  const semImpacto = await identificarImpactoDownstream(doc.id)
  ok("5a) sem dependente cadastrado ainda, a lista vem vazia", semImpacto.length === 0, String(semImpacto.length))

  const pasta = await prisma.pastaApostilamento.create({ data: { processoId: proc.id }, select: { id: true } })
  await prisma.pastaApostilamentoDocumento.create({
    data: { pastaApostilamentoId: pasta.id, documentoId: doc.id, pessoaNome: "Pessoa Teste", documentoTitulo: "Certidão de nascimento", status: "incluido_na_pasta" },
  })
  const comImpacto = await identificarImpactoDownstream(doc.id)
  ok("5b) o apostilamento fabricado aparece no impacto downstream", comImpacto.length === 1, String(comImpacto.length))
  ok("5c) domínio identificado corretamente", comImpacto[0]?.dominio === "PASTA_APOSTILAMENTO", comImpacto[0]?.dominio)
  ok("5d) status do dependente é reportado (para decisão humana, não reversão automática)", comImpacto[0]?.status === "incluido_na_pasta", comImpacto[0]?.status ?? "null")

  // ══════════════════════════════════════════════════════════════════════════
  secao("6) Idempotência: invalidar de novo não duplica a reabertura")
  // ══════════════════════════════════════════════════════════════════════════
  await invalidarDocumento({
    stepInstanceId: 0, documentoId: doc.id, processoId: proc.id,
    valores: { motivo: "segunda invalidação (idempotência)" }, usuarioId: null,
    sync: { origem: "USER", correlationId: randomUUID() },
  })
  const eventosFinal = await prisma.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: nec.id, tipo: "REABERTA" } })
  ok("6a) ainda exatamente 1 evento REABERTA (necessidade já estava EM_ATENDIMENTO, guard idempotente não regride de novo)", eventosFinal.length === 1, String(eventosFinal.length))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
