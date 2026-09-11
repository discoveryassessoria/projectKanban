// scripts/casamento-por-uniao.test.ts
// ============================================================================
// CASAMENTO É DOCUMENTO DA UNIÃO — decisão do usuário em 10/09/2026, depois de
// achar "Lorenzo → Certidão de casamento" e "Mafalda → Certidão de casamento"
// como DUAS necessidades pro MESMO casamento (achado real: família Santin,
// processo 589). Nascimento/óbito continuam por PESSOA; casamento passa a
// materializar por UNIÃO — uma única NecessidadeDocumental serve os dois
// cônjuges, nunca uma por pessoa.
//
//   npx tsx scripts/casamento-por-uniao.test.ts
//
// Cobre os 9 casos exigidos (1-8 aqui, com dado sintético; 9 — "1 necessidade
// de casamento = 1 fluxo operacional" — depende de PerfilOperacionalDocumento
// + Workflow Interno PUBLICADO, cadastro pesado demais pra recriar aqui; foi
// validado com dado REAL de produção na remediação da Santin — o passo
// "localizar_registro" já materializa 1:1 por `necessidade.id`, nunca por
// pessoa, e o código dessa etapa (materializar-genealogia.ts) nem lê pessoaId
// pra decidir a chave do passo — só `chaveStep(necessidade.id, ciclo)`).
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"
import { NaturezaItem } from "@prisma/client"

const MARCA = "UNIAOCAS"

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
  if (ids.length) {
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvs = await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const arvIds = arvs.map((a) => a.id)
  if (arvIds.length) {
    await prisma.uniao.deleteMany({ where: { pessoa1: { arvoreId: { in: arvIds } } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.matrizDocumental.deleteMany({ where: { codigo: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Cadastro mínimo, reaproveitável (find-or-create em tabelas compartilhadas). */
async function cadastroBase() {
  const nat = (await prisma.naturezaOperacionalDocumento.findFirst({ select: { id: true } }))
    ?? (await prisma.naturezaOperacionalDocumento.create({ data: { code: `${MARCA}_NAT`, name: "Registro civil" }, select: { id: true } }))
  // reaproveita QUALQUER TipoProcessoNacionalidade já existente — as regras são
  // `aplicaTodosProcessos: true`, então o valor real é irrelevante pro teste;
  // só precisa satisfazer a FK (cadastro completo de um tipo — code,
  // modalidadeId, país com nacionalidade — é grande demais pra recriar aqui só
  // por causa dessa FK).
  const tp0 = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tp0) throw new Error("banco de teste sem NENHUM TipoProcessoNacionalidade — rode um teste de integração de processo primeiro (ex.: motor-documental-idempotencia) pra semear, ou semeie manualmente")
  const fam = (await prisma.familiaDocumental.findFirst({ select: { id: true } }))
    ?? (await prisma.familiaDocumental.create({ data: { code: `${MARCA}_FAM`, name: "Certidões" }, select: { id: true } }))
  const fase = await prisma.catalogoFase.upsert({
    where: { phaseKey: "genealogia" }, create: { phaseKey: "genealogia", label: "Genealogia", ordemPadrao: 1 }, update: {}, select: { id: true },
  })
  await prisma.faseNaturezaPermitida.upsert({
    where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: fase.id, naturezaOperacionalId: nat.id } },
    create: { catalogoFaseId: fase.id, naturezaOperacionalId: nat.id, ativo: true }, update: { ativo: true },
  })

  const tipoDoc = async (sufixo: string, nome: string) => {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: nome, natureza: NaturezaItem.DOCUMENTO }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({
      data: { code: `${MARCA}-${sufixo}`, name: nome, ativo: true, itemCatalogoId: item.id, naturezaOperacionalId: nat.id, familiaDocumentalId: fam.id },
      select: { id: true },
    })
  }
  await tipoDoc("NAS", "Certidão de nascimento - Inteiro Teor")
  await tipoDoc("CAS", "Certidão de casamento - Inteiro Teor")
  await tipoDoc("OBI", "Certidão de óbito - Inteiro Teor")

  // NASCIMENTO — grão PESSOA, incondicional (todo mundo). ÓBITO — grão PESSOA,
  // condição falecido=true. CASAMENTO — grão UNIÃO, condição casado=true. Todas
  // `aplicaTodosProcessos: true` — sem depender de nenhum TipoProcessoNacionalidade
  // seedado (o processo de teste nasce sem `tipoProcessoMotorId`).
  await prisma.matrizDocumental.create({
    data: {
      codigo: `${MARCA}-NAS`, nome: "Nascimento", status: "PUBLICADA", arquivado: false, aplicaTodosProcessos: true,
      tipoProcessoId: tp0.id, versao: 1, documentTypeCode: `${MARCA}-NAS`, documentosAceitos: [`${MARCA}-NAS`],
      requisitoNome: "Certidão de Nascimento", modoSatisfacao: "TODOS_SAO_EXIGIDOS",
      publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE", obrigatoriedade: "OBRIGATORIA",
      faseExigencia: "genealogia", alvoNecessidade: "PESSOA",
    },
  })
  await prisma.matrizDocumental.create({
    data: {
      codigo: `${MARCA}-OBI`, nome: "Óbito", status: "PUBLICADA", arquivado: false, aplicaTodosProcessos: true,
      tipoProcessoId: tp0.id, versao: 1, documentTypeCode: `${MARCA}-OBI`, documentosAceitos: [`${MARCA}-OBI`],
      requisitoNome: "Certidão de Óbito", modoSatisfacao: "TODOS_SAO_EXIGIDOS",
      publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE", obrigatoriedade: "OBRIGATORIA",
      faseExigencia: "genealogia", alvoNecessidade: "PESSOA",
      condicoes: { combinador: "TODAS", regras: [{ campo: "falecido", operador: "igual", valor: true }] } as never,
    },
  })
  await prisma.matrizDocumental.create({
    data: {
      codigo: `${MARCA}-CAS`, nome: "Casamento", status: "PUBLICADA", arquivado: false, aplicaTodosProcessos: true,
      tipoProcessoId: tp0.id, versao: 1, documentTypeCode: `${MARCA}-CAS`, documentosAceitos: [`${MARCA}-CAS`],
      requisitoNome: "Certidão de Casamento", modoSatisfacao: "TODOS_SAO_EXIGIDOS",
      publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE", obrigatoriedade: "OBRIGATORIA",
      faseExigencia: "genealogia", alvoNecessidade: "UNIAO",
      condicoes: { combinador: "TODAS", regras: [{ campo: "casado", operador: "igual", valor: true }] } as never,
    },
  })
}

async function novaArvoreEProcesso(sufixo: string) {
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, arvoreId: arvore.id }, select: { id: true } })
  return { arvoreId: arvore.id, processoId: proc.id }
}
const pessoa = (arvoreId: number, nome: string, extra: Partial<{ casado: boolean; vivo: boolean; documentacao: boolean }> = {}) =>
  prisma.pessoa.create({
    data: { nome: `${MARCA} ${nome}`, arvoreId, linhaReta: true, documentacao: true, casado: false, vivo: true, ...extra },
    select: { id: true },
  })

const necessidadesDoProcesso = (processoId: number, sufixo: string) =>
  prisma.necessidadeDocumental.findMany({
    where: { processoId, itemCatalogo: { code: `${MARCA}_${sufixo}` } },
    select: { id: true, pessoaId: true, uniaoId: true, status: true },
  })

async function main() {
  exigirBancoDeTeste("prova casamento materializado por UNIÃO, não por pessoa")
  await limpar()
  await cadastroBase()

  console.log("CASAMENTO É DOCUMENTO DA UNIÃO\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) casal com os dois cônjuges na árvore → 1 casamento")
  // ══════════════════════════════════════════════════════════════════════════
  const cen1 = await novaArvoreEProcesso("C1")
  const lorenzo = await pessoa(cen1.arvoreId, "Lorenzo", { casado: true })
  const mafalda = await pessoa(cen1.arvoreId, "Mafalda", { casado: true })
  const uniao1 = await prisma.uniao.create({ data: { pessoa1Id: lorenzo.id, pessoa2Id: mafalda.id }, select: { id: true } })

  await materializarGenealogia(cen1.processoId)
  const nasc1 = await necessidadesDoProcesso(cen1.processoId, "NAS")
  const cas1 = await necessidadesDoProcesso(cen1.processoId, "CAS")
  ok("1a) nascimento: 2 necessidades (uma por pessoa)", nasc1.length === 2, String(nasc1.length))
  ok("1b) casamento: 1 ÚNICA necessidade pro casal", cas1.length === 1, String(cas1.length))
  ok("1c) a necessidade de casamento aponta pra UNIÃO, não pra pessoa", cas1[0]?.uniaoId === uniao1.id && cas1[0]?.pessoaId === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) materialização executada duas vezes → continua 1")
  // ══════════════════════════════════════════════════════════════════════════
  await materializarGenealogia(cen1.processoId)
  await materializarGenealogia(cen1.processoId)
  const cas1b = await necessidadesDoProcesso(cen1.processoId, "CAS")
  ok("2a) 3 materializações seguidas — continua exatamente 1 necessidade de casamento", cas1b.length === 1, String(cas1b.length))
  ok("2b) é a MESMA linha (mesmo id), não uma nova por rodada", cas1b[0]?.id === cas1[0]?.id)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) pessoa com duas uniões diferentes → 2 casamentos")
  // ══════════════════════════════════════════════════════════════════════════
  const cen3 = await novaArvoreEProcesso("C3")
  const joao = await pessoa(cen3.arvoreId, "Joao", { casado: true })
  const maria = await pessoa(cen3.arvoreId, "Maria", { casado: true })
  const ana = await pessoa(cen3.arvoreId, "Ana", { casado: true })
  await prisma.uniao.create({ data: { pessoa1Id: joao.id, pessoa2Id: maria.id } })
  await prisma.uniao.create({ data: { pessoa1Id: joao.id, pessoa2Id: ana.id } })
  await materializarGenealogia(cen3.processoId)
  const cas3 = await necessidadesDoProcesso(cen3.processoId, "CAS")
  ok("3a) João com 2 uniões distintas → 2 necessidades de casamento", cas3.length === 2, String(cas3.length))
  ok("3b) as duas apontam pra uniões DIFERENTES", new Set(cas3.map((c) => c.uniaoId)).size === 2)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) duas pessoas casadas sem união entre si → não deduplicar incorretamente")
  // ══════════════════════════════════════════════════════════════════════════
  const cen4 = await novaArvoreEProcesso("C4")
  await pessoa(cen4.arvoreId, "Pedro", { casado: true }) // casado=true mas SEM nenhuma Uniao cadastrada
  await pessoa(cen4.arvoreId, "Paula", { casado: true }) // idem — não são casados ENTRE SI, nem têm união com ninguém
  const r4 = await materializarGenealogia(cen4.processoId)
  const cas4 = await necessidadesDoProcesso(cen4.processoId, "CAS")
  ok("4a) ninguém tem União cadastrada → 0 necessidades de casamento (nunca inventa/funde as duas pessoas)", cas4.length === 0, String(cas4.length))
  ok("4b) a ausência de União fica registrada como pendência (não falha silenciosa)", r4.pendencias.some((p) => p.includes("não tem nenhuma União")))

  // ══════════════════════════════════════════════════════════════════════════
  secao("5/6) nascimento e óbito continuam por PESSOA")
  // ══════════════════════════════════════════════════════════════════════════
  const cen6 = await novaArvoreEProcesso("C6")
  const vivo = await pessoa(cen6.arvoreId, "Vivo")
  const falecido = await pessoa(cen6.arvoreId, "Falecido", { vivo: false })
  await materializarGenealogia(cen6.processoId)
  const nasc6 = await necessidadesDoProcesso(cen6.processoId, "NAS")
  const obi6 = await necessidadesDoProcesso(cen6.processoId, "OBI")
  ok("5a) nascimento: 1 necessidade POR PESSOA (2 pessoas → 2 necessidades)", nasc6.length === 2, String(nasc6.length))
  ok("5b) cada necessidade de nascimento aponta pra sua PRÓPRIA pessoa (pessoaId, não uniaoId)",
    nasc6.every((n) => n.pessoaId != null && n.uniaoId == null))
  ok("6a) óbito: só o falecido tem necessidade (1, não 2)", obi6.length === 1, String(obi6.length))
  ok("6b) óbito é da pessoa falecida, por PESSOA", obi6[0]?.pessoaId === falecido.id && obi6[0]?.uniaoId === null)
  void vivo

  // ══════════════════════════════════════════════════════════════════════════
  secao("7) desligar 'documentação' de UM cônjuge não quebra a união se o outro ainda precisa")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.pessoa.update({ where: { id: mafalda.id }, data: { documentacao: false } })
  await materializarGenealogia(cen1.processoId)
  const nasc1depois = await necessidadesDoProcesso(cen1.processoId, "NAS")
  const cas1depois = await necessidadesDoProcesso(cen1.processoId, "CAS")
  const nascMafalda = nasc1depois.find((n) => n.pessoaId === mafalda.id)
  const nascLorenzo = nasc1depois.find((n) => n.pessoaId === lorenzo.id)
  ok("7a) nascimento da Mafalda (documentacao=false) foi DISPENSADO", nascMafalda?.status === "DISPENSADA")
  ok("7b) nascimento do Lorenzo continua PENDENTE (ele não mudou)", nascLorenzo?.status === "PENDENTE")
  ok("7c) a necessidade de casamento da UNIÃO continua PENDENTE — Lorenzo sozinho ainda sustenta a regra",
    cas1depois.length === 1 && cas1depois[0].status === "PENDENTE")

  // ══════════════════════════════════════════════════════════════════════════
  secao("8) documento existente da união satisfaz a necessidade única")
  // ══════════════════════════════════════════════════════════════════════════
  // Documento.pessoaId é obrigatório no schema (é o "onde fica arquivado"), mas
  // quem representa a OBRIGAÇÃO é `necessidadeId` — aponta pra necessidade da
  // UNIÃO, não recria uma necessidade por cônjuge.
  const docCasamento = await prisma.documento.create({
    data: { pessoaId: lorenzo.id, necessidadeId: cas1depois[0].id, status: "RECEBIDO" }, select: { id: true, necessidadeId: true },
  })
  const necComDoc = await prisma.necessidadeDocumental.findUnique({
    where: { id: cas1depois[0].id }, select: { documentos: { select: { id: true } } },
  })
  ok("8a) o documento se vincula à necessidade da união", docCasamento.necessidadeId === cas1depois[0].id)
  ok("8b) a necessidade da união enxerga o documento (1, não 2 — não duplica arquivo)", necComDoc?.documentos.length === 1)

  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
