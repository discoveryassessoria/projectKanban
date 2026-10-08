// scripts/torre-fases-fonte-unica.test.ts
// ============================================================================
// UMA LISTA DE FASES (07/10/2026). Ordem real: Genealogia → Emissão → Análise → Retificação → Emissão retificada → Tradução → Apostilamento → Aguardando protocolo →
// Protocolado; «Aguardando fechamento» é a antessala (fora da Torre) e «Finalizado» o terminal (não é coluna). Tradução juramentada é FASE (condicional por país).
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarFasesDaTorre, ordemRealDaFase, ehFaseTerminal, ordenarPelaOrdemReal, textoDasFasesNasPalavras } from "../lib/operacional/torre-fases"
import { compararFases } from "../lib/operacional/torre-coerencia-abas"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (f: string) => readFileSync(f, "utf8")

const CATALOGO = [
  { phaseKey: "a_iniciar", label: "Aguardando fechamento", conditionalPadrao: false }, { phaseKey: "emissao_documental", label: "Emissão documental", conditionalPadrao: false },
  { phaseKey: "analise_documental", label: "Análise Documental", conditionalPadrao: false }, { phaseKey: "genealogia", label: "Genealogia", conditionalPadrao: false },
  { phaseKey: "retificacao_registros", label: "Retificação de registros", conditionalPadrao: true }, { phaseKey: "emissao_documental_retificada", label: "Emissão documental retificada", conditionalPadrao: true },
  { phaseKey: "apostilamento", label: "Apostilamento", conditionalPadrao: false }, { phaseKey: "aguardando_protocolo", label: "Aguardando protocolo", conditionalPadrao: false },
  { phaseKey: "protocolado", label: "Protocolado", conditionalPadrao: false }, { phaseKey: "finalizado", label: "Finalizado", conditionalPadrao: false },
  { phaseKey: "traducao_juramentada", label: "Tradução juramentada", conditionalPadrao: false },
]
const ESP = ["genealogia", "emissao_documental", "analise_documental", "retificacao_registros", "emissao_documental_retificada", "apostilamento", "aguardando_protocolo", "protocolado", "finalizado"]
const ITA = ["genealogia", "emissao_documental", "analise_documental", "retificacao_registros", "emissao_documental_retificada", "traducao_juramentada", "apostilamento", "finalizado", "aguardando_protocolo", "protocolado"]

async function main() {
  exigirBancoDeTeste("torre-fases-fonte-unica.test.ts")

  secao("A) A lista única (pura) com o catálogo e os macros reais de produção")
  const fases = montarFasesDaTorre(CATALOGO, [ESP, ITA])
  const chaves = fases.map((f) => f.key)
  ok("começa em Genealogia e segue a ordem REAL (Tradução entre Emissão retificada e Apostilamento), mesmo com o macro da Itália trazendo Finalizado antes de Protocolo", chaves.join(">") === "genealogia>emissao_documental>analise_documental>retificacao_registros>emissao_documental_retificada>traducao_juramentada>apostilamento>aguardando_protocolo>protocolado", chaves.join(">"))
  ok("sem a antessala «Aguardando fechamento» e sem o terminal «Finalizado»", !chaves.includes("a_iniciar") && !chaves.includes("finalizado"))
  ok("condicional: as duas retificações (cadastro) e a Tradução (só vale em alguns países); as demais não", fases.filter((f) => f.condicional).map((f) => f.key).join(",") === "retificacao_registros,emissao_documental_retificada,traducao_juramentada")
  ok("Tradução juramentada é FASE do processo (tem posição própria), não passo", ordemRealDaFase("traducao_juramentada") > ordemRealDaFase("emissao_documental_retificada") && ordemRealDaFase("traducao_juramentada") < ordemRealDaFase("apostilamento"))
  ok("a antessala vem antes de Genealogia e o terminal é o último; fase desconhecida vai para o fim", ordemRealDaFase("a_iniciar") < ordemRealDaFase("genealogia") && ehFaseTerminal("finalizado") && !ehFaseTerminal("protocolado") && ordemRealDaFase("inventada") > ordemRealDaFase("finalizado"))
  ok("ordenarPelaOrdemReal ordena qualquer lista (a do Kanban e a do filtro de Tarefas) do mesmo jeito", ordenarPelaOrdemReal(["protocolado", "a_iniciar", "genealogia", "finalizado"], (k) => k).join(">") === "a_iniciar>genealogia>protocolado>finalizado")
  ok("o rodapé «As 5 palavras» diz o intervalo da lista única: «Genealogia → Protocolado»", textoDasFasesNasPalavras(fases) === "etapa do processo (Genealogia → Protocolado)")

  secao("B) O comparador reprova listas diferentes")
  ok("lista igual: nada a acusar; subconjunto na ordem: ok", compararFases(chaves, [{ aba: "Radar", chaves, completa: true }, { aba: "Tarefas", chaves: ["genealogia", "protocolado"], completa: false }]).length === 0)
  ok("Finalizado a mais, ordem trocada ou fase a menos é acusado", compararFases(chaves, [{ aba: "Radar", chaves: [...chaves, "finalizado"], completa: true }]).length === 1 && compararFases(chaves, [{ aba: "Processos", chaves: [...chaves].reverse(), completa: true }]).length === 1 && compararFases(chaves, [{ aba: "Visão geral", chaves: chaves.slice(1), completa: true }]).length === 1)
  ok("filtro de Tarefas fora da ordem real é acusado", compararFases(chaves, [{ aba: "Tarefas", chaves: ["protocolado", "genealogia"], completa: false }]).length === 1)

  secao("C) No banco de teste — todas as abas leem a mesma lista")
  const { lerFasesDaTorre } = await import("../lib/operacional/torre-fases-leitura")
  const { fasesDoRadar, colunasVisiveisDaTorre } = await import("../lib/operacional/torre-processos")
  const { funilDaTorre } = await import("../lib/operacional/torre-funil")
  const unica = (await lerFasesDaTorre()).map((f) => f.key)
  const radar = (await fasesDoRadar()).map((f) => f.key), botoes = (await colunasVisiveisDaTorre()).map((f) => f.key), funil = (await funilDaTorre()).fases.map((f) => f.key)
  ok("Radar, botões de Processos e funil da Visão geral = a lista única, na mesma ordem", radar.join() === unica.join() && botoes.join() === unica.join() && funil.join() === unica.join(), unica.join(">"))
  ok("a lista do banco de teste nunca traz Finalizado nem Aguardando fechamento", !unica.includes("finalizado") && !unica.includes("a_iniciar") && unica[0] === "genealogia", unica.join(">"))

  secao("D) Código — ninguém monta a sua lista")
  ok("fasesDoRadar lê lerFasesDaTorre (e não o catálogo por ordemPadrao)", /lerFasesDaTorre\(\)/.test(ler("lib/operacional/torre-processos.ts")) && !/ordemPadrao: 'asc'/.test(ler("lib/operacional/torre-processos.ts")))
  ok("a poda por aba (colunasDoRadar «terminal em todo macro») acabou: sem poda", /return todas/.test(ler("lib/operacional/torre-processos.ts")))
  ok("o funil usa a terminal da lista única (ehFaseTerminal), sem a sua constante", /ehFaseTerminal/.test(ler("lib/operacional/torre-funil.ts")) && !/ORDEM_DA_ULTIMA_FASE/.test(ler("lib/operacional/torre-funil.ts")))
  ok("Kanban, filtro de Tarefas, metas e Terceiros ordenam pela ordem real", /ordenarPelaOrdemReal/.test(ler("src/app/api/kanban-config/route.ts")) && /ordenarPelaOrdemReal/.test(ler("lib/operacional/torre-filtros.ts")) && /ordenarPelaOrdemReal/.test(ler("src/app/api/torre/metas/route.ts")) && /ordenarPelaOrdemReal/.test(ler("src/components/torre/TerceirosRegua.tsx")))
  ok("o rodapé «As 5 palavras» usa a lista única", /textoDasFasesNasPalavras/.test(ler("lib/operacional/torre-funil-puro.ts")))
  ok("o vigia compara as fases das abas (regra n)", /compararFases/.test(ler("lib/operacional/torre-coerencia-abas.ts")))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} FASES — FONTE ÚNICA — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
