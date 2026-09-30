// scripts/prazo-solicitacao-documento.test.ts
//
// REGIME DE PRAZO DAS CERTIDÕES — rodada 28/09/2026.
//
// Achado real: Tarefa.dataPrazo e Documento.dataPrazoOperacao estão os dois
// vazios em produção pro fluxo "Solicitar certidão" — não é bug de gatilho
// errado (cartório confirma vs Daniela envia), é campo morto, não usado. A
// fonte que já nasce certa é SolicitacaoDocumento.previsaoRetorno, ancorada em
// `dataEnvio` (o momento real do ENVIO do requerimento — bate, no milissegundo,
// com o completedAt da subtarefa "Enviar requerimento ao cartório").
//
// Esta rodada faz as telas que mostravam prazo vazio (fila da Central
// Operacional, colunas "Prazo"/"Situação do prazo" do Relatório de Certidões)
// passarem a ler essa fonte — SEM mexer em cadastro de workflow/step/subtarefa.
//
// Monta o PRÓPRIO cenário (processo/pessoa/certidão/solicitação marcados com
// MARCA) num banco de teste e o remove no fim — nunca depende de dado de
// produção (o antigo processo 651 / Documento 2260 não existe no banco do gate).
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prazo-solicitacao-documento")

import { prisma } from "@/lib/prisma"
import { estadoTemporalSolicitacao } from "@/lib/operacional/tempo-operacional"
import { situacaoDoPrazoSolicitacao, DOMINIO_CERTIDOES, CATEGORIA_CERTIDAO } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "@/src/lib/relatorios/motor/executar"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const MARCA = "PRAZOSOLDOC"
const PRAZO_DIAS = 15

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (procIds.length) {
    await prisma.solicitacaoDocumento.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvIds } } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  }
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.categoriaDocumental.deleteMany({ where: { name: { startsWith: MARCA } } })
}

async function montar() {
  // A categoria "REGISTRO_CIVIL" é a que DEFINE o domínio Certidões; no banco
  // de teste o cadastro vem vazio, então o teste garante a própria (reusa se já houver).
  const cat = (await prisma.categoriaDocumental.findUnique({ where: { code: CATEGORIA_CERTIDAO_CODE } }))
    ?? await prisma.categoriaDocumental.create({ data: { code: CATEGORIA_CERTIDAO_CODE, name: `${MARCA} Registro civil` } })
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}-ITEM`, name: `${MARCA} Certidão de óbito`, natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}-TIPO`, name: `${MARCA} tipo`, itemCatalogoId: item.id, categoriaDocumentalId: cat.id } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
  const mk = async (nome: string, tag: string, comEnvio: boolean) => {
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome, sobrenome: MARCA }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${tag}` }, select: { id: true },
    })
    const d = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id, tipo: "CERTIDAO_OBITO", status: "PENDENTE" }, select: { id: true } })
    if (comEnvio) {
      const dataEnvio = new Date(Date.now() - 2 * 86400000)
      await prisma.solicitacaoDocumento.create({
        data: {
          documentoId: d.id, processoId: proc.id, pessoaId: pes.id, faseMacroKey: "prazosoldoc_fase", canal: "EMAIL",
          dataEnvio, prazoEsperadoDias: PRAZO_DIAS, previsaoRetorno: new Date(dataEnvio.getTime() + PRAZO_DIAS * 86400000),
          status: "AGUARDANDO_PROTOCOLO", chaveIdempotencia: `${MARCA}-sol-${tag}`,
        },
      })
    }
    return d.id
  }
  return { processoId: proc.id, docComEnvio: await mk("Atahualpa", "a", true), docSemEnvio: await mk("Ruben", "b", false) }
}

const CATEGORIA_CERTIDAO_CODE = CATEGORIA_CERTIDAO

async function main() {
  await limpar()
  const { processoId: PROCESSO_CIBILS, docComEnvio: DOC_COM_ENVIO, docSemEnvio: DOC_SEM_ENVIO } = await montar()
  console.log("REGIME DE PRAZO DAS CERTIDÕES — SolicitacaoDocumento.previsaoRetorno\n")

  console.log("(1) estadoTemporalSolicitacao — função pura:")
  const agora = new Date("2026-09-28T12:00:00Z")
  const daqui5dias = new Date("2026-10-03T12:00:00Z")
  const ha3dias = new Date("2026-09-25T12:00:00Z")
  t(estadoTemporalSolicitacao({ dataPrazo: null, status: null, agora }).semPrazo, "sem previsaoRetorno → semPrazo")
  t(estadoTemporalSolicitacao({ dataPrazo: ha3dias, status: "AGUARDANDO_PROTOCOLO", agora }).atrasado, "previsão no passado, ainda aguardando → atrasado")
  t(!estadoTemporalSolicitacao({ dataPrazo: ha3dias, status: "RESPONDIDA", agora }).atrasado, "previsão no passado MAS já respondida → NÃO atrasado (relógio parado)")
  t(!estadoTemporalSolicitacao({ dataPrazo: daqui5dias, status: "PROTOCOLADA", agora }).atrasado, "previsão no futuro → não atrasado")

  console.log("\n(2) Documentos reais do processo 651 (prova ao vivo):")
  const docs = await prisma.documento.findMany({
    where: { id: { in: [DOC_COM_ENVIO, DOC_SEM_ENVIO] } },
    select: {
      id: true, pessoa: { select: { nome: true, sobrenome: true } },
      solicitacoes: { select: { dataEnvio: true, previsaoRetorno: true, status: true, prazoEsperadoDias: true }, orderBy: { id: "desc" }, take: 1 },
    },
  })
  const docComEnvio = docs.find((d) => d.id === DOC_COM_ENVIO)
  const docSemEnvio = docs.find((d) => d.id === DOC_SEM_ENVIO)
  const solComEnvio = docComEnvio?.solicitacoes[0] ?? null
  console.log(`  Documento #${DOC_COM_ENVIO} (${docComEnvio?.pessoa.nome} ${docComEnvio?.pessoa.sobrenome}): dataEnvio=${solComEnvio?.dataEnvio}, previsaoRetorno=${solComEnvio?.previsaoRetorno}, prazoEsperadoDias=${solComEnvio?.prazoEsperadoDias}`)
  t(solComEnvio?.previsaoRetorno != null, `Documento #${DOC_COM_ENVIO} tem previsaoRetorno preenchida`)
  if (solComEnvio?.dataEnvio && solComEnvio?.previsaoRetorno) {
    const diasReais = Math.round((solComEnvio.previsaoRetorno.getTime() - solComEnvio.dataEnvio.getTime()) / 86400000)
    t(diasReais === (solComEnvio.prazoEsperadoDias ?? -1), `previsaoRetorno = dataEnvio + prazoEsperadoDias (${diasReais} dias)`, `esperado ${solComEnvio.prazoEsperadoDias}`)
  }
  console.log(`  Documento #${DOC_SEM_ENVIO} (${docSemEnvio?.pessoa.nome} ${docSemEnvio?.pessoa.sobrenome}): solicitacoes=${JSON.stringify(docSemEnvio?.solicitacoes)}`)
  t((docSemEnvio?.solicitacoes.length ?? 0) === 0, `Documento #${DOC_SEM_ENVIO} continua SEM solicitação (sem prazo, coerente — ninguém enviou ainda)`)

  console.log("\n(3) Central Operacional — a fila reflete o mesmo prazo (mesma fonte, sem duplicar cálculo):")
  const fs = await import("node:fs")
  const route = fs.readFileSync("src/app/api/processos/[processoId]/central-operacional/route.ts", "utf8")
  t(!/dataPrazoOperacao:\s*true,/.test(route), "a rota não lê mais Documento.dataPrazoOperacao bruto")
  t(/dataPrazoOperacao:\s*d\.solicitacoes\?\.\[0\]\?\.previsaoRetorno/.test(route), "dataPrazoOperacao (nome interno) agora vem de solicitacoes[0].previsaoRetorno")
  t(/solicitacoes:\s*{\s*\n\s*select:\s*{\s*previsaoRetorno:\s*true,\s*status:\s*true\s*}/.test(route), "o select da rota busca previsaoRetorno + status da última solicitação")

  console.log("\n(4) Relatório de Certidões — colunas 'Prazo' e 'Situação do prazo':")
  t(/valor:\s*\(l\)\s*=>\s*dataBR\(sol\(l\)\?\.previsaoRetorno/.test(fs.readFileSync("src/lib/relatorios/motor/dominios/certidoes.ts", "utf8")),
    "coluna 'Prazo' lê sol(l)?.previsaoRetorno (mesma fonte de 'Previsão de retorno')")

  const r = await executar(DOMINIO_CERTIDOES, {
    dominio: "certidoes",
    filtros: [{ key: "processo", valor: { tipo: "entidade", id: PROCESSO_CIBILS } }],
    colunas: ["pessoa", "tipo", "previsao", "prazo", "situacao_prazo"],
    porPagina: 50,
  })
  const linhaComEnvio = r.linhas.find((l) => l.celulas.some((c) => c.key === "previsao" && c.valor != null) && l.celulas.some((c) => c.key === "pessoa" && String(c.valor).includes("Atahualpa")))
  if (linhaComEnvio) {
    const previsao = linhaComEnvio.celulas.find((c) => c.key === "previsao")?.valor
    const prazo = linhaComEnvio.celulas.find((c) => c.key === "prazo")?.valor
    const situacao = linhaComEnvio.celulas.find((c) => c.key === "situacao_prazo")?.valor
    t(previsao === prazo, "'Previsão de retorno' e 'Prazo' mostram o MESMO valor na mesma linha (mesma fonte)", `${previsao} vs ${prazo}`)
    t(situacao != null && situacao !== "Sem prazo", "'Situação do prazo' não é mais 'Sem prazo' para quem já foi enviado", String(situacao))
  } else {
    t(false, "achou uma linha do relatório com previsão preenchida pra comparar Prazo x Previsão")
  }
  t(Number.isFinite(r.total), "o relatório roda de ponta a ponta sem erro", `total=${r.total}`)
  t(r.total === 2, "o relatório vê exatamente as 2 certidões do cenário montado", `total=${r.total}`)

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  await limpar()
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); try { await limpar() } catch { /* melhor esforço */ } process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
