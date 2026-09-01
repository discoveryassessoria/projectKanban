/**
 * PROVA EXECUTADA — materialização repetida 20× não cria uma linha a mais.
 * Rodar:
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/motor-documental-idempotencia.test.ts
 *
 * Monta um processo do zero com requerente, pai, mãe, avô e avó; materializa; e
 * repete a materialização 20 vezes conferindo a contagem a cada rodada.
 *
 * É esta prova que o guard estático não dá: com DOIS motores, a contagem subia na
 * primeira repetição — cada um gravava um `varianteKey` diferente para a mesma
 * obrigação e a chave de idempotência não os reconhecia como iguais.
 *
 * Recusa rodar fora do banco de teste local.
 */
import { PrismaClient, NaturezaItem } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { materializarGenealogia } from "../src/services/genealogia/materializar-genealogia"

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.\n")
  process.exit(1)
}

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const MARCA = "ZZMOTOR"
const criado = { processoId: 0, arvoreId: 0, tipoProcessoId: 0, pessoaIds: [] as number[] }

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { codigo: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  if (ids.length) {
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arv = await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  if (arv.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arv.map((a) => a.id) } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arv.map((a) => a.id) } } })
  }
  await prisma.matrizDocumental.deleteMany({ where: { codigo: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Cadastro mínimo: naturezas/família já existentes ou criadas sob a marca. */
async function montarCenario() {
  // natureza operacional + família (reaproveita a primeira existente, senão cria)
  const nat = (await prisma.naturezaOperacionalDocumento.findFirst({ select: { id: true } }))
    ?? (await prisma.naturezaOperacionalDocumento.create({ data: { code: `${MARCA}_NAT`, name: "Registro civil" }, select: { id: true } }))
  const fam = (await prisma.familiaDocumental.findFirst({ select: { id: true } }))
    ?? (await prisma.familiaDocumental.create({ data: { code: `${MARCA}_FAM`, name: "Certidões" }, select: { id: true } }))

  const tipoProcesso = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipoProcesso) throw new Error("banco de teste sem TipoProcessoNacionalidade")
  criado.tipoProcessoId = tipoProcesso.id

  // fase genealogia precisa aceitar a natureza
  const fase = await prisma.catalogoFase.upsert({
    where: { phaseKey: "genealogia" },
    create: { phaseKey: "genealogia", label: "Genealogia", ordemPadrao: 1 },
    update: {},
    select: { id: true },
  })
  await prisma.faseNaturezaPermitida.upsert({
    where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: fase.id, naturezaOperacionalId: nat.id } },
    create: { catalogoFaseId: fase.id, naturezaOperacionalId: nat.id, ativo: true },
    update: { ativo: true },
  })

  // 3 tipos documentais canônicos, cada um com seu ItemCatalogo
  const tipos: Record<string, number> = {}
  for (const [sufixo, nome] of [["NAS", "Certidão de nascimento - Inteiro Teor"], ["CAS", "Certidão de casamento - Inteiro Teor"], ["OBI", "Certidão de óbito - Inteiro Teor"]] as const) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: nome, natureza: NaturezaItem.DOCUMENTO }, select: { id: true } })
    const t = await prisma.tipoDocumentoCadastro.create({
      data: { code: `${MARCA}-${sufixo}`, name: nome, ativo: true, itemCatalogoId: item.id, naturezaOperacionalId: nat.id, familiaDocumentalId: fam.id },
      select: { id: true },
    })
    tipos[sufixo] = t.id
  }

  // 3 regras publicadas — nascimento (todos), casamento (casado), óbito (falecido)
  const regras = [
    { sufixo: "NAS", nome: "Certidão de nascimento de toda pessoa da árvore", requisito: "Certidão de Nascimento", cond: null as unknown },
    { sufixo: "CAS", nome: "Certidão de casamento quando aplicável", requisito: "Certidão de Casamento", cond: { combinador: "TODAS", regras: [{ campo: "casado", operador: "igual", valor: true }] } },
    { sufixo: "OBI", nome: "Certidão de óbito de pessoa falecida", requisito: "Certidão de Óbito", cond: { combinador: "TODAS", regras: [{ campo: "falecido", operador: "igual", valor: true }] } },
  ]
  for (const r of regras) {
    await prisma.matrizDocumental.create({
      data: {
        codigo: `${MARCA}-${r.sufixo}`, nome: r.nome, status: "PUBLICADA", arquivado: false,
        phaseKey: "genealogia", tipoProcessoId: criado.tipoProcessoId, versao: 1,
        documentTypeCode: `${MARCA}-${r.sufixo}`, documentosAceitos: [`${MARCA}-${r.sufixo}`],
        requisitoNome: r.requisito, modoSatisfacao: "TODOS_SAO_EXIGIDOS",
        publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE", obrigatoriedade: "OBRIGATORIA",
        ...(r.cond ? { condicoes: r.cond as never } : {}),
      },
    })
  }

  // árvore: requerente, pai, mãe, avô, avó
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  criado.arvoreId = arvore.id
  const pessoas = [
    { nome: "Requerente", requerente: "maior", casado: false, vivo: true },
    { nome: "Pai", requerente: "nao", casado: true, vivo: true },
    { nome: "Mae", requerente: "nao", casado: true, vivo: true },
    { nome: "Avo", requerente: "nao", casado: true, vivo: false },
    { nome: "Avoh", requerente: "nao", casado: true, vivo: false },
  ]
  for (const p of pessoas) {
    const criada = await prisma.pessoa.create({
      data: { nome: `${MARCA} ${p.nome}`, sobrenome: "Teste", arvoreId: arvore.id, linhaReta: true, documentacao: false, casado: p.casado, vivo: p.vivo, requerente: p.requerente },
      select: { id: true },
    })
    criado.pessoaIds.push(criada.id)
  }

  const proc = await prisma.processo.create({
    data: { codigo: `${MARCA}-1`, nome: `${MARCA} processo`, arvoreId: arvore.id, tipoProcessoMotorId: criado.tipoProcessoId, faseAtualKey: "genealogia" },
    select: { id: true },
  })
  criado.processoId = proc.id
}

const contar = () => prisma.necessidadeDocumental.count({ where: { processoId: criado.processoId } })

async function main() {
  console.log("Materialização repetida — a contagem não pode subir\n")
  await limpar()
  await montarCenario()
  console.log(`  cenário: processo #${criado.processoId}, ${criado.pessoaIds.length} pessoas (1 solteira viva, 2 casadas vivas, 2 casadas falecidas)\n`)

  // Esperado pelas regras: nascimento p/ 5, casamento p/ 4 casados, óbito p/ 2 falecidos = 11
  await materializarGenealogia(criado.processoId)
  const base = await contar()
  console.log(`  rodada  1: ${base} necessidades`)
  ok("a primeira materialização cria necessidades", base > 0, String(base))
  ok("a contagem bate com as regras (5 nasc + 4 cas + 2 óbito = 11)", base === 11, String(base))

  const historico: number[] = [base]
  let subiu = 0
  for (let i = 2; i <= 20; i++) {
    await materializarGenealogia(criado.processoId)
    const n = await contar()
    historico.push(n)
    if (n !== base) subiu++
    console.log(`  rodada ${String(i).padStart(2)}: ${n} necessidades${n === base ? "" : `  ← MUDOU (esperado ${base})`}`)
  }
  ok("20 materializações mantêm a contagem EXATAMENTE igual", subiu === 0, `variações: ${subiu} | série: ${[...new Set(historico)].join(",")}`)

  // nenhuma pessoa recebeu o mesmo item duas vezes
  const necs = await prisma.necessidadeDocumental.findMany({
    where: { processoId: criado.processoId },
    select: { pessoaId: true, itemCatalogoId: true, varianteKey: true },
  })
  const pares = necs.map((n) => `${n.pessoaId}:${n.itemCatalogoId}`)
  ok("nenhuma pessoa tem o mesmo documento duas vezes", new Set(pares).size === pares.length, `${pares.length} necessidades, ${new Set(pares).size} pares únicos`)
  const variantes = [...new Set(necs.map((n) => n.varianteKey))]
  ok("todas as necessidades vêm do motor de Regras Documentais (varianteKey rd:*)", variantes.every((v) => v.startsWith("rd:")), variantes.join(", "))
  ok("nenhuma necessidade com varianteKey 'padrao' (marca do motor legado)", !variantes.includes("padrao"))

  // pessoa solteira viva: exatamente 1 obrigação, e é a de nascimento
  const solteira = criado.pessoaIds[0]
  const daSolteira = necs.filter((n) => n.pessoaId === solteira)
  ok("pessoa solteira e viva ⇒ exatamente 1 obrigação", daSolteira.length === 1, `${daSolteira.length}`)
  ok("e é a certidão de nascimento", daSolteira[0]?.varianteKey.includes(`${MARCA}-NAS`), daSolteira[0]?.varianteKey)
}

main()
  .catch((e) => { console.error(e); falhou++; falhas.push(`exceção: ${e?.message}`) })
  .finally(async () => {
    await limpar()
    await prisma.$disconnect()
    console.log(`\n${"─".repeat(62)}`)
    console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
    if (falhou > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
    console.log("Materialização repetida é estável: um motor, uma obrigação.\n")
  })

void PrismaClient
