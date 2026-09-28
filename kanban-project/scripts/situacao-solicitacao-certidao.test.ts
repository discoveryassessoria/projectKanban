// scripts/situacao-solicitacao-certidao.test.ts
//
// REFORMULAÇÃO DA "SITUAÇÃO" NO RELATÓRIO DE CERTIDÕES — rodada 28/09/2026.
//
// Achado real (processo 651, Cibils): a coluna "Situação" mostrava o status
// bruto de NecessidadeDocumental (ATENDIDA) como se fosse "certidão recebida"
// — na prática ATENDIDA só significa "localizei o registro na Genealogia"
// (SATISFAZER_NECESSIDADE, motor registral). As 14 necessidades ATENDIDA do
// Cibils tinham Documento.status ainda em SOLICITAR/SOLICITADO — nenhuma
// certidão física tinha chegado. Caso nomeado pelo usuário: necessidade #620
// (Ruben Cibils, Nascimento, Documento #2263) — ATENDIDA, mas ZERO
// solicitações, ZERO subtarefas concluídas.
//
// Novo mapeamento (decidido pelo usuário, 6 estados):
//   NAO_LOCALIZADA — Genealogia não achou o registro (NecessidadeDocumental,
//     0 casos reais em produção — verificado, nunca confundido com PENDENTE).
//   NAO_SOLICITADA — nada enviado ao cartório ainda.
//   PENDENTE       — enviei, aguardando confirmação.
//   SOLICITADO     — cartório confirmou o recebimento do pedido.
//   RECEBIDA       — a certidão (documento) chegou de fato.
//   DISPENSADA     — necessidade não se aplica.
//
// SOMENTE LEITURA contra o banco real — nenhum teste aqui escreve.
import { prisma } from "@/lib/prisma"
import {
  situacaoDaSolicitacaoCertidao, ROTULO_SITUACAO_SOLICITACAO,
} from "@/src/lib/process-stage/situacao-solicitacao-certidao"
import { DOMINIO_CERTIDOES } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "@/src/lib/relatorios/motor/executar"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const PROCESSO_CIBILS = 651

async function main() {
  console.log("SITUAÇÃO DA SOLICITAÇÃO DE CERTIDÃO — reformulação 28/09/2026\n")

  console.log("(1) situacaoDaSolicitacaoCertidao — função pura, precedência correta:")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "DISPENSADA", chavesConcluidas: ["receber_certidao"] }) === "DISPENSADA",
    "DISPENSADA sempre vence, mesmo com tudo concluído")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "PENDENTE", chavesConcluidas: [] }) === "NAO_SOLICITADA",
    "nada concluído → NAO_SOLICITADA (nunca herda o nome 'PENDENTE' do enum bruto)")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", chavesConcluidas: ["enviar_requerimento_cartorio"] }) === "PENDENTE",
    "só envio concluído → PENDENTE (mesmo com necessidade ATENDIDA)")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", chavesConcluidas: ["enviar_requerimento_cartorio", "receber_confirmacao_pedido"] }) === "SOLICITADO",
    "envio + confirmação → SOLICITADO")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", chavesConcluidas: ["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "receber_certidao"] }) === "RECEBIDA",
    "os 3 concluídos → RECEBIDA")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", chavesConcluidas: ["receber_certidao"] }) === "RECEBIDA",
    "recebimento sozinho (sem confirmação registrada) ainda vence → RECEBIDA")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "NAO_LOCALIZADA", chavesConcluidas: [] }) === "NAO_LOCALIZADA",
    "NAO_LOCALIZADA nunca cai em NAO_SOLICITADA por omissão")

  console.log("\n(2) Caso nomeado pelo usuário — necessidade #620 (Ruben Cibils, Nascimento, Documento #2263):")
  const doc2263 = await prisma.documento.findUnique({
    where: { id: 2263 },
    select: {
      necessidade: { select: { id: true, status: true } },
      stepInstances: {
        where: { stepKey: "solicitar_certidao", status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
        orderBy: { id: "desc" }, take: 1,
        select: { execucoesDeSubtarefa: { where: { status: "CONCLUIDO" }, select: { subtaskKey: true } } },
      },
    },
  })
  t(doc2263?.necessidade?.status === "ATENDIDA", "necessidade #620 tem status bruto ATENDIDA (a origem da confusão)", String(doc2263?.necessidade?.status))
  const chaves2263 = doc2263?.stepInstances[0]?.execucoesDeSubtarefa.map((e) => e.subtaskKey) ?? []
  t(chaves2263.length === 0, "e zero subtarefas concluídas — nenhuma solicitação foi feita")
  const situacao2263 = situacaoDaSolicitacaoCertidao({ necessidadeStatus: doc2263?.necessidade?.status ?? "", chavesConcluidas: chaves2263 })
  t(situacao2263 === "NAO_SOLICITADA", "situação calculada é NAO_SOLICITADA, não mais 'Atendida'", situacao2263)

  console.log("\n(3) NAO_LOCALIZADA e NAO_ENCONTRADO — 0 casos reais em toda a produção (verificado, não fabricado):")
  const necNaoLocalizada = await prisma.necessidadeDocumental.count({ where: { status: "NAO_LOCALIZADA" } })
  const docNaoEncontrado = await prisma.documento.count({ where: { status: "NAO_ENCONTRADO" } })
  t(necNaoLocalizada === 0, "NecessidadeDocumental.status=NAO_LOCALIZADA: 0 casos em produção", String(necNaoLocalizada))
  t(docNaoEncontrado === 0, "Documento.status=NAO_ENCONTRADO: 0 casos em produção", String(docNaoEncontrado))

  console.log("\n(4) Contra o processo real (Cibils, 20 necessidades REGISTRO_CIVIL) — filtro e coluna NUNCA divergem:")
  const rTodas = await executar(DOMINIO_CERTIDOES, {
    dominio: "certidoes",
    filtros: [{ key: "processo", valor: { tipo: "entidade", id: PROCESSO_CIBILS } }],
    colunas: ["status"],
    porPagina: 50,
  })
  t(rTodas.total === 20, "20 necessidades no total", String(rTodas.total))
  const porBucketNaColuna = new Map<string, number>()
  for (const l of rTodas.linhas) {
    const v = String(l.celulas.find((c) => c.key === "status")?.valor)
    porBucketNaColuna.set(v, (porBucketNaColuna.get(v) ?? 0) + 1)
  }
  let somaCruzada = 0
  for (const [bucket, rotulo] of Object.entries(ROTULO_SITUACAO_SOLICITACAO)) {
    const rFiltro = await executar(DOMINIO_CERTIDOES, {
      dominio: "certidoes",
      filtros: [
        { key: "processo", valor: { tipo: "entidade", id: PROCESSO_CIBILS } },
        { key: "status", valor: { tipo: "multi_selecao", valores: [bucket] } },
      ],
      porPagina: 50,
    })
    const naColuna = porBucketNaColuna.get(rotulo) ?? 0
    t(rFiltro.total === naColuna, `filtro status=${bucket} (${rFiltro.total}) bate com a coluna "${rotulo}" (${naColuna})`)
    somaCruzada += rFiltro.total
  }
  t(somaCruzada === 20, "a soma dos 6 buckets fecha nas 20 necessidades (nenhuma sobra, nenhuma duplicada)", String(somaCruzada))

  console.log("\n(5) A regressão do ciclo SUPERSEDIDO está corrigida (achado desta rodada):")
  // Sem excluir SUPERSEDIDO/CANCELADO e sem orderBy, `take:1` podia pegar uma
  // instância antiga (sem execução nenhuma) mesmo com o envio já concluído no
  // ciclo vigente — é por isso que ANTES da correção a coluna mostrava
  // "Não solicitada" pra tudo (17 de 17), mesmo com 5 envios reais concluídos.
  const rPendente = await executar(DOMINIO_CERTIDOES, {
    dominio: "certidoes",
    filtros: [
      { key: "processo", valor: { tipo: "entidade", id: PROCESSO_CIBILS } },
      { key: "status", valor: { tipo: "multi_selecao", valores: ["PENDENTE"] } },
    ],
    porPagina: 50,
  })
  t(rPendente.total === 5, "5 necessidades com envio real concluído aparecem como PENDENTE (não 'Não solicitada')", String(rPendente.total))

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
