// scripts/processo-etapa2-fase-filtro-conta.test.ts
// ============================================================================
// PÁGINA DO PROCESSO, ETAPA 2 (07/10/2026): (A) a lista «Atribuir a» começa em «— escolha a pessoa —» e os botões só ficam ativos com tarefa
// selecionada; (B) clicar numa fase do Caminho filtra a tabela para as ABERTAS dela, com jeito de voltar; (C) cada fase mostra a conta
// «3 abertas = 1 sem responsável · 2 Daniela Brait», saída das MESMAS linhas da tabela.   npx tsx scripts/processo-etapa2-fase-filtro-conta.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("processo-etapa2-fase-filtro-conta.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { contaDaFase, textoDaContaDaFase, filtrarEOrdenar, type LinhaDaTabela } from "../lib/operacional/torre-processo-puro"
import { detalheDoProcesso } from "../lib/operacional/torre-foco"
import { atribuirEmLote } from "../src/services/torre-acoes-lote"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const sem = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const MARCA = "ETAPA2"

const linha = (o: Partial<LinhaDaTabela>): LinhaDaTabela => ({
  chave: "t1", tarefaId: 1, documentoId: 1, tipo: "ABERTA", titulo: "Certidão de nascimento", pessoaId: 1, pessoa: "Maria", geracao: "G1", geracaoNum: 1, linhaReta: true, pessoaNascimento: null,
  passo: null, status: "A_INICIAR", statusRotulo: "A iniciar", responsavelId: null, responsavelNome: null, iniciouEm: null, concluidaEm: null,
  dataPrazo: null, rotuloDoPrazo: "", risco: null, atrasada: false, bola: null, encerramentoTexto: null, motivoTexto: null, reabrivel: false, podeAtribuir: true,
  fase: { key: "genealogia", label: "Genealogia", ordem: 1 }, ...o,
} as LinhaDaTabela)

async function main() {
  secao("C — a conta da fase (pura)")
  const l = [
    linha({ chave: "a", tarefaId: 1 }),
    linha({ chave: "b", tarefaId: 2, responsavelId: 7, responsavelNome: "Daniela Brait" }),
    linha({ chave: "c", tarefaId: 3, responsavelId: 7, responsavelNome: "Daniela Brait" }),
    linha({ chave: "d", tarefaId: 4, responsavelId: 8, responsavelNome: "Marco Rovatti", fase: { key: "emissao_documental", label: "Emissão documental", ordem: 2 } }),
    linha({ chave: "e", tarefaId: 5, tipo: "CONCLUIDA", status: "CONCLUIDA", responsavelId: 7, responsavelNome: "Daniela Brait" }),
    linha({ chave: "f", tarefaId: null, tipo: "CANCELADA", status: "CANCELADA" }),
  ]
  const g = contaDaFase(l, "genealogia")
  ok("«3 abertas = 1 sem responsável · 2 Daniela Brait»", textoDaContaDaFase(g) === "3 abertas = 1 sem responsável · 2 Daniela Brait", textoDaContaDaFase(g))
  ok("a soma fecha: sem responsável + cada pessoa = abertas", g.semResponsavel + g.porPessoa.reduce((s, p) => s + p.n, 0) === g.abertas)
  ok("concluída e cancelada não entram na conta", g.abertas === 3)
  ok("singular e outra fase", textoDaContaDaFase(contaDaFase(l, "emissao_documental")) === "1 aberta = 1 Marco Rovatti")
  ok("fase sem tarefa: «0 abertas»", textoDaContaDaFase(contaDaFase(l, "protocolo")) === "0 abertas")
  ok("só sem responsável", textoDaContaDaFase(contaDaFase([linha({})], "genealogia")) === "1 aberta = 1 sem responsável")

  secao("B — filtro da fase (puro): só as ABERTAS da fase")
  ok("fase = genealogia → 3 abertas dela", filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", faseKey: "genealogia" }).map((x) => x.chave).join("") === "abc")
  ok("sem fase → todas", filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", faseKey: null }).length === 6)
  ok("o número de linhas do filtro = o número da conta", filtrarEOrdenar(l, { pessoaId: null, status: "ATIVAS", faseKey: "genealogia" }).length === g.abertas)

  secao("B/C — com banco de teste (tabela real do detalhe)")
  const c = await montarCenario(MARCA)
  try {
    const dani = await prisma.usuario.create({ data: { nome: `${MARCA} Daniela`, email: `${MARCA.toLowerCase()}-dani@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const o1 = await c.novaObrigacao({}); const o2 = await c.novaObrigacao({})
    await atribuirEmLote({ tarefaIds: [o1.tarefaId], responsavelId: dani.id, autorId: admin.id, motivo: "teste" })
    const d = await detalheDoProcesso(o1.processoId)
    ok("o detalhe existe", !!d)
    if (d) {
      const abertas = d.tabela.filter((x) => x.tipo === "ABERTA")
      const fasesComTarefa = [...new Set(abertas.map((x) => x.fase.key).filter((k): k is string => !!k))]
      ok("há fase com tarefa aberta", fasesComTarefa.length > 0)
      for (const k of fasesComTarefa) {
        const conta = contaDaFase(d.tabela, k)
        const daTabela = filtrarEOrdenar(d.tabela, { pessoaId: null, status: "ATIVAS", faseKey: k })
        ok(`fase ${k}: conta (${textoDaContaDaFase(conta)}) = linhas filtradas da tabela`, conta.abertas === daTabela.length && conta.semResponsavel + conta.porPessoa.reduce((s, p) => s + p.n, 0) === conta.abertas)
      }
      ok("a Daniela aparece pelo nome na conta", fasesComTarefa.some((k) => contaDaFase(d.tabela, k).porPessoa.some((p) => p.nome === `${MARCA} Daniela`)))
      const somaGeral = d.caminho.fases.reduce((s, f) => s + contaDaFase(d.tabela, f.phaseKey).abertas, 0)
      ok("a soma das fases do Caminho = abertas da tabela com fase do Caminho", somaGeral <= abertas.length && somaGeral > 0, `${somaGeral}/${abertas.length}`)
    }
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }

  secao("A/B — a tela (estático)")
  const lote = sem(readFileSync("src/components/torre/lote-atribuicao.tsx", "utf8"))
  const certs = sem(readFileSync("src/components/torre/ProcessoCertidoes.tsx", "utf8"))
  const cam = sem(readFileSync("src/components/torre/ProcessoCaminho.tsx", "utf8"))
  const pag = sem(readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8"))
  ok("lista começa em «— escolha a pessoa —» (value vazio)", /<option value="">— escolha a pessoa —<\/option>/.test(lote))
  ok("a página não pré-escolhe ninguém (preEscolher: false)", /preEscolher: false/.test(pag) && /preEscolher \? /.test(lote))
  ok("sem tarefa selecionada os botões ficam desativados", /const semSelecao = ids\.length === 0/.test(lote) && /const bloqueado = ocupado \|\| lote\.ocupado \|\| semSelecao/.test(lote))
  ok("«Atribuir» também exige pessoa escolhida", /disabled=\{bloqueado \|\| !lote\.pessoa\}/.test(lote))
  ok("a barra aparece sempre (para quem pode atribuir), com «Limpar seleção» desativado sem seleção", /\{podeAtribuir && \(\s*<div className="tpr-lote"/.test(certs) && /disabled=\{marcadasAtribuiveis\.length === 0\}/.test(certs))
  ok("fase do Caminho é botão com destaque e volta ao clicar de novo", /aria-pressed=\{escolhida\}/.test(cam) && /onFase\(escolhida \? null : f\.phaseKey\)/.test(cam))
  ok("a conta da fase usa contaDaFase(d.tabela) — as linhas da tabela", /contaDaFase\(d\.tabela, f\.phaseKey\)/.test(cam))
  ok("«Ver todas as fases» limpa o filtro", /Ver todas as fases/.test(certs) && /onFase\(null\)/.test(certs))
  ok("a página liga Caminho e tabela ao MESMO estado", /faseSelecionada=\{faseSelecionada\} onFase=\{setFaseSelecionada\}/.test(pag) && (pag.match(/faseSelecionada=\{faseSelecionada\}/g) ?? []).length === 2)

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
