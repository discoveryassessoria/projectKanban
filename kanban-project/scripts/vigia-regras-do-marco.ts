// scripts/vigia-regras-do-marco.ts
// ============================================================================
// VIGIA DAS «REGRAS INEGOCIÁVEIS DO MARCO» — lista as violações que existem HOJE no banco que o .env aponta (a PRODUÇÃO, quando é ela).
//   npx tsx scripts/vigia-regras-do-marco.ts            (rápido)
//   npx tsx scripts/vigia-regras-do-marco.ts --profundo (confere também a tabela de cada processo e os contadores — mais lento)
//
// SOMENTE LEITURA: usa só detectores com SELECT (`lib/saude/verificacoes/regras-do-marco.ts`, que o teste da suíte prova que não tem nenhuma
// escrita) e nunca corrige nada. Cada linha nomeia certidão + pessoa + família. Regras de TELA/CÓDIGO (b, d, h) saem da varredura do código.
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../lib/prisma"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { detectarRegrasDoMarco, detalheMemo, TITULO_DA_REGRA, type RegraDoMarco } from "../lib/saude/verificacoes/regras-do-marco"
import { acharContadoresRepetidos, textoVisivel } from "../lib/operacional/contadores-repetidos"
import { portasDeAtribuicaoForaDoProcesso } from "./_regras-do-marco-codigo"

const profundo = process.argv.includes("--profundo")
;(async () => {
  const { violacoes, porRegra } = await detectarRegrasDoMarco({ profundo })
  console.log(`VIGIA DAS REGRAS DO MARCO — ${new Date().toISOString()} — modo ${profundo ? "profundo" : "rápido"}\n`)
  for (const r of ["a", "c", "e", "f", "g", "i", "j", "l", "m", "n", "o", "p", "q"] as RegraDoMarco[]) {
    if (r === "i" && !profundo) { console.log(`(${r}) ${TITULO_DA_REGRA[r]}: não conferida no modo rápido (use --profundo)\n`); continue }
    const v = violacoes.filter((x) => x.regra === r)
    console.log(`(${r}) ${TITULO_DA_REGRA[r]}: ${v.length}`)
    for (const x of v) console.log(`   - ${x.certidao ?? "—"} · ${x.pessoa ?? "—"} · família ${x.familia}${x.processoId ? ` (processo ${x.processoId})` : ""} — ${x.detalhe}`)
    console.log()
  }
  const portas = portasDeAtribuicaoForaDoProcesso()
  console.log(`(d) Atribuição só na página do processo — portas de atribuição FORA dela hoje: ${portas.length}`)
  for (const p of portas) console.log(`   - ${p}`)
  if (profundo) {
    // (h) contador repetido na MESMA tela: renderiza as peças reais da página do processo com os dados de cada processo ativo.
    const { ProcessoCabecalho } = await import("../src/components/torre/ProcessoCabecalho")
    const { ProcessoCaminho } = await import("../src/components/torre/ProcessoCaminho")
    const ids = (await prisma.processo.findMany({ where: { dataConclusao: null, faseAtualKey: { not: "finalizado" } }, select: { id: true, nome: true } }))
    const noop = () => {}
    let total = 0
    const linhas: string[] = []
    for (const p of ids) {
      const d = await detalheMemo(p.id)
      if (!d) continue
      const html = renderToStaticMarkup(createElement(ProcessoCabecalho, { d, agora: new Date(), perm: { editar: true, bloquear: true, relatorio: true, forcarAvanco: false }, ocupado: false, onDistribuir: noop, onRelatorio: noop, onHistorico: noop, onPausar: noop, onReativar: noop, onForcar: noop }))
        + " " + renderToStaticMarkup(createElement(ProcessoCaminho, { d, agora: new Date(), encerradasNaLista: false, onAlternarEncerradas: noop, faseSelecionada: null, onFase: noop }))
      const rep = acharContadoresRepetidos(textoVisivel(html))
      if (rep.length) { total++; linhas.push(`   - família ${d.familiaNome} (processo ${p.id}): ${rep.map((r) => `«${r.chave}» ×${r.vezes}`).join(", ")}`) }
    }
    console.log(`\n(h) Contador repetido na mesma tela (cabeçalho + Caminho da página do processo): ${total} processo(s) de ${ids.length}`)
    linhas.forEach((l) => console.log(l))
  }
  await prisma.$disconnect()
})().catch((e) => { console.error(e); process.exit(1) })
void readdirSync; void readFileSync; void statSync; void join
