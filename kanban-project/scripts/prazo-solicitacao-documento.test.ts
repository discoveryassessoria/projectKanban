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
// SOMENTE LEITURA contra o banco real — nenhum teste aqui escreve.
import { prisma } from "@/lib/prisma"
import { estadoTemporalSolicitacao } from "@/lib/operacional/tempo-operacional"
import { situacaoDoPrazoSolicitacao, DOMINIO_CERTIDOES } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "@/src/lib/relatorios/motor/executar"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const PROCESSO_CIBILS = 651
const DOC_COM_ENVIO = 2260 // Atahualpa Irineo Cibils Revello, Óbito — já enviado
const DOC_SEM_ENVIO = 2263 // Ruben Cibils, Nascimento — ainda sem solicitação

async function main() {
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

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
