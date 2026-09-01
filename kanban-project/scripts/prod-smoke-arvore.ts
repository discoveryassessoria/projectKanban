// scripts/prod-smoke-arvore.ts
// ============================================================================
// SMOKE DE PRODUÇÃO — Árvore Genealógica (linhagem, diagnóstico, próxima ação).
//
// SOMENTE LEITURA, por decisão. Produção é patrimônio.
//
// O que ele NÃO faz, de propósito: não roda `simularImpactoPessoa`. A simulação
// é segura por construção (termina em rollback), mas ainda assim ABRE uma
// transação de escrita — e um smoke não é o lugar para exercitar isso contra
// dado real de cliente. O contrato de rollback é provado em `kanban_test`, por
// `scripts/arvore-preview-impacto.test.ts`, medindo o banco inteiro.
//
// Cobre, sobre PROCESSO REAL:
//   1. a leitura operacional (necessidades, tarefas, lançamentos, SLA);
//   2. o mapa de linhagens e a cadeia de cada requerente;
//   3. o dossiê por pessoa e o resumo da linhagem;
//   4. o diagnóstico e a próxima melhor ação;
//   5. o tempo de cada etapa — o requisito de desempenho medido em dado real.
//
// Roda: npm run smoke:prod-arvore
// ============================================================================

import { prisma } from "@/lib/prisma"
import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import { mapaDeLinhagens, trilhaDaLinhagem } from "@/src/lib/genealogia/motor/linhagens"
import { calcularFoco, preferenciasPadrao } from "@/src/lib/genealogia/navegacao/foco"
import { projetarDossies, resumirLinhagem, type FatosOperacionais } from "@/src/lib/genealogia/operacional/dossie"
import { diagnosticar, resolveNextGenealogyAction } from "@/src/lib/genealogia/operacional/diagnostico"
import type { PaisAlvo } from "@/src/lib/genealogia/motor/tipos"

let passou = 0
let falhou = 0
const falhas: string[] = []

function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) {
    passou++
    console.log(`  ✅ ${nome}`)
  } else {
    falhou++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`)
  }
}

function paisAlvoDe(p: string | null | undefined): PaisAlvo | null {
  const k = (p ?? "").toUpperCase()
  return k === "ITALIA" || k === "PORTUGAL" || k === "ESPANHA" || k === "ALEMANHA" ? (k as PaisAlvo) : null
}

async function main() {
  console.log("\n══ SMOKE PROD — ÁRVORE GENEALÓGICA (somente leitura) ══\n")

  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`
  console.log(`  banco: ${db}`)

  // O processo com mais pessoas na árvore: é onde a árvore custa mais e onde um
  // defeito de desempenho aparece primeiro.
  const candidatos = await prisma.processo.findMany({
    where: { arvoreId: { not: null } },
    select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, arvoreId: true },
    take: 200,
    orderBy: { id: "desc" },
  })
  ok(candidatos.length > 0, `processos com árvore encontrados (${candidatos.length})`)
  if (candidatos.length === 0) {
    console.log("\n  ⚠️  Sem processo com árvore em produção — nada a exercitar.\n")
    await prisma.$disconnect()
    process.exit(falhou === 0 ? 0 : 1)
  }

  const contagens = await prisma.pessoa.groupBy({
    by: ["arvoreId"],
    where: { arvoreId: { in: candidatos.map((c) => c.arvoreId!) } },
    _count: { _all: true },
  })
  const porArvore = new Map(contagens.map((c) => [c.arvoreId!, c._count._all]))
  const alvo = [...candidatos].sort(
    (a, b) => (porArvore.get(b.arvoreId!) ?? 0) - (porArvore.get(a.arvoreId!) ?? 0),
  )[0]
  const totalPessoas = porArvore.get(alvo.arvoreId!) ?? 0
  console.log(`  processo #${alvo.id} — "${alvo.nome}" · ${totalPessoas} pessoa(s) na árvore\n`)

  // ── 1. Leitura operacional ────────────────────────────────────────────────
  console.log("1) leitura das fontes canônicas")
  const t0 = Date.now()
  const [pessoasDb, necessidades, tarefas, lancamentos] = await Promise.all([
    prisma.pessoa.findMany({
      where: { arvoreId: alvo.arvoreId! },
      include: { unioesComoPessoa1: true, unioesComoPessoa2: true },
    }),
    prisma.necessidadeDocumental.findMany({
      where: { processoId: alvo.id },
      select: { id: true, pessoaId: true, uniaoId: true, status: true, obrigatoriedade: true },
    }),
    prisma.tarefa.findMany({
      where: { processoId: alvo.id },
      select: {
        id: true, titulo: true, concluida: true, statusTarefa: true,
        dataPrazo: true, necessidadeId: true, necessidade: { select: { pessoaId: true } },
      },
    }),
    prisma.obrigacaoEconomica.findMany({
      where: { processoId: alvo.id, personId: { not: null }, arquivadaEm: null },
      select: { id: true, natureza: true, moedaContratual: true, valorContratado: true, personId: true, codigoOperacional: true },
    }),
  ])
  const msLeitura = Date.now() - t0
  ok(pessoasDb.length === totalPessoas, `leu ${pessoasDb.length} pessoas em ${msLeitura}ms`)
  console.log(
    `     necessidades: ${necessidades.length} · tarefas: ${tarefas.length} · lançamentos: ${lancamentos.length}`,
  )

  const unioesMap = new Map<number, { id: number; pessoa1Id: number | null; pessoa2Id: number | null; data_inicio: Date | null; data_fim: Date | null }>()
  for (const p of pessoasDb) {
    for (const u of [...p.unioesComoPessoa1, ...p.unioesComoPessoa2]) {
      unioesMap.set(u.id, { id: u.id, pessoa1Id: u.pessoa1Id, pessoa2Id: u.pessoa2Id, data_inicio: u.data_inicio, data_fim: u.data_fim })
    }
  }
  const unioes = [...unioesMap.values()]

  const fatos: FatosOperacionais = {
    necessidades: necessidades.map((n) => ({
      id: n.id, pessoaId: n.pessoaId, uniaoId: n.uniaoId,
      status: n.status, obrigatoriedade: n.obrigatoriedade,
    })),
    tarefas: tarefas.map((t) => ({
      id: t.id, titulo: t.titulo, concluida: t.concluida, statusTarefa: t.statusTarefa,
      dataPrazo: t.dataPrazo ? t.dataPrazo.toISOString() : null,
      necessidadeId: t.necessidadeId, pessoaId: t.necessidade?.pessoaId ?? null,
    })),
    lancamentos: lancamentos.map((o) => ({
      id: o.id, natureza: o.natureza, descricao: o.codigoOperacional ?? `#${o.id}`,
      moeda: String(o.moedaContratual), valor: Number(o.valorContratado), pessoaId: o.personId,
    })),
    financeiroVisivel: true,
  }

  // ── 2. Motores puros ──────────────────────────────────────────────────────
  console.log("\n2) motores puros sobre dado real")
  const t1 = Date.now()
  const grafo = construirGrafo(pessoasDb, unioes)
  const analise = analisarArvore(pessoasDb, unioes, {
    paisAlvo: paisAlvoDe(alvo.paisCanonico?.countryKey),
    raizId: pessoasDb[0]?.id ?? null,
  })
  const msAnalise = Date.now() - t1
  ok(analise.qualidade.totalPessoas === pessoasDb.length, `análise completa em ${msAnalise}ms`)

  const t2 = Date.now()
  const mapa = mapaDeLinhagens(grafo, analise.paisAlvo, analise.linhaCidadania[0] ?? null)
  const msLinhagens = Date.now() - t2
  ok(true, `${mapa.linhagens.length} linhagem(ns) calculada(s) em ${msLinhagens}ms`)

  const t3 = Date.now()
  const dossies = projetarDossies({ grafo, analise, mapa, fatos })
  const msDossies = Date.now() - t3
  ok(dossies.size === pessoasDb.length, `dossiê de ${dossies.size} pessoas em ${msDossies}ms`)

  // Troca de requerente: é o número que o critério de aceite cobra (< 1s).
  if (mapa.linhagens.length > 0) {
    const t4 = Date.now()
    for (const l of mapa.linhagens) {
      calcularFoco(grafo, l, { ...preferenciasPadrao(), modo: "linhagem", estilo: "esmaecer" })
    }
    const msFoco = Date.now() - t4
    const porTroca = mapa.linhagens.length ? msFoco / mapa.linhagens.length : 0
    ok(porTroca < 1000, `troca de requerente: ${porTroca.toFixed(1)}ms por linhagem (teto 1000ms)`)
  }

  // ── 3. Diagnóstico e próxima ação ─────────────────────────────────────────
  console.log("\n3) diagnóstico e próxima ação")
  const agora = new Date()
  const linhagem = mapa.linhagens[0] ?? null
  const t5 = Date.now()
  const diag = diagnosticar({ grafo, analise, mapa, dossies, linhagem, prazo: null, agora })
  const msDiag = Date.now() - t5
  ok(["saudavel", "atencao", "critico"].includes(diag.saude), `saúde: ${diag.rotuloSaude} (${msDiag}ms)`)
  console.log(`     ${diag.resumo} · ${diag.criticos} impeditivo(s) · ${diag.atencao} de atenção`)
  ok(
    diag.problemas.every((p) => p.fonte.length > 0 && p.acao.length > 0),
    "todo problema traz FONTE e AÇÃO",
  )

  const acao = resolveNextGenealogyAction(diag)
  ok(acao.prioridade >= 1 && acao.prioridade <= 7, `próxima ação: prioridade ${acao.prioridade}`)
  console.log(`     → ${acao.pessoaNome ? `${acao.pessoaNome}: ` : ""}${acao.acao}`)
  console.log(`       fonte: ${acao.fonte}`)

  if (linhagem) {
    const resumo = resumirLinhagem(linhagem, dossies, null, agora)
    const trilha = trilhaDaLinhagem(grafo, linhagem, mapa)
    ok(trilha.length === linhagem.cadeia.length, "trilha da linhagem coerente com a cadeia")
    console.log(
      `     linhagem de ${resumo.nome}: ${resumo.pessoas} pessoa(s), ` +
        `${resumo.documental.atendidas + resumo.documental.dispensadas}/${resumo.documental.necessarias} documentos, ` +
        `${resumo.bloqueios} bloqueio(s)`,
    )
    console.log(`     transmissor: ${resumo.danteCausaNome ?? "não identificado"}`)
    console.log(`     caminho: ${trilha.map((d) => `${d.rotulo}=${d.nome}`).join(" → ")}`)
  }

  // ── 4. Nada foi escrito ───────────────────────────────────────────────────
  console.log("\n4) o smoke não escreveu")
  const [nDepois, tDepois] = await Promise.all([
    prisma.necessidadeDocumental.count({ where: { processoId: alvo.id } }),
    prisma.tarefa.count({ where: { processoId: alvo.id } }),
  ])
  ok(nDepois === necessidades.length, "contagem de necessidades inalterada", { antes: necessidades.length, depois: nDepois })
  ok(tDepois === tarefas.length, "contagem de tarefas inalterada", { antes: tarefas.length, depois: tDepois })

  console.log("\n" + "─".repeat(60))
  if (falhou === 0) {
    console.log(`${passou} verificações · Árvore em produção ÍNTEGRA ✅\n`)
    await prisma.$disconnect()
    process.exit(0)
  }
  console.log(`${passou} passaram, ${falhou} falharam:`)
  for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(1)
}

main().catch(async (e) => {
  console.error("ERRO FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
