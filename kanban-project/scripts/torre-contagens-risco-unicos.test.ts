// scripts/torre-contagens-risco-unicos.test.ts
// Item 3 (07/10/2026): risco e contagens da Torre vêm de UMA função (`torre-contagens.ts` + `torre-risco.ts`). PURO — sem banco.
import { readFileSync } from "node:fs"
import { contarPorFase, contarTotais, contarPorResponsavel, contarSemResponsavel, contarDecisoes, textoDasDecisoes, textoDasPermanencias } from "../lib/operacional/torre-contagens"
import { compararContagens } from "../lib/operacional/torre-coerencia-abas"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")

type N = "no_ritmo" | "atencao" | "parado" | "critico"
const P = (id: number, fase: string, nivel: N, semDono = false): { processoId: number; faseAtualKey: string | null; nivelDeRisco: N; semDono: boolean } => ({ processoId: id, faseAtualKey: fase, nivelDeRisco: nivel, semDono })
const fases = [{ key: "emissao" }, { key: "analise" }, { key: "traducao" }]
const ps = [P(1, "emissao", "no_ritmo"), P(2, "emissao", "atencao", true), P(3, "emissao", "parado", true), P(4, "analise", "critico"), P(5, "analise", "no_ritmo")]

console.log("\n1) Contagem única por fase e total")
const { linhas, foraDaLista } = contarPorFase(ps, fases)
const em = linhas.find((l) => l.key === "emissao")!
ok("Emissão: 3 processos · 1 no ritmo · 1 atenção · 1 parado", em.total === 3 && em.noRitmo === 1 && em.atencao === 1 && em.parados === 1)
ok("«sem dono» é atributo, não muda o nível", em.semDono === 2 && em.noRitmo === 1)
ok("fase vazia aparece com zero", linhas.find((l) => l.key === "traducao")!.total === 0 && foraDaLista === 0)
const t = contarTotais(ps)
ok("totais: 5 · graves 2 (parado+crítico) · precisam 3", t.total === 5 && t.graves === 2 && t.precisam === 3)
ok("soma das fases = total", linhas.reduce((a, l) => a + l.total, 0) === t.total)
ok("fase fora da lista não some: é contada à parte", contarPorFase([P(9, "xyz", "no_ritmo")], fases).foraDaLista === 1)

console.log("\n2) Responsável e decisões")
const R = (donos: Array<[number, string, number]>, semDono = 0) => ({ responsaveis: { donos: donos.map(([id, nome, k]) => ({ id, nome, n: k })), semDono } })
const rs = [R([[12, "Daniela", 17], [3, "Marco", 3]]), R([[3, "Marco", 2]], 1), R([], 4)]
const porR = contarPorResponsavel(rs)
ok("Daniela 17 tarefas/1 processo; Marco 5/2", porR[0].nome === "Daniela" && porR[0].tarefas === 17 && porR[1].tarefas === 5 && porR[1].processos === 2)
const sr = contarSemResponsavel(rs)
ok("sem responsável: 5 tarefas em 2 processos", sr.tarefas === 5 && sr.processos === 2)
const dc = contarDecisoes([{ processoId: 1 }, { processoId: 1 }, { processoId: 2 }])
ok("decisões ≠ processos: «3 decisões em 2 processos»", textoDasDecisoes(dc) === "3 decisões em 2 processos")
ok("tempo médio chama permanência de permanência", textoDasPermanencias("12 dias", 6, 5) === "12 dias · 6 permanências de 5 processos concluídos")

console.log("\n3) O vigia reprova divergência entre abas")
const unica = (ps2: typeof ps, fs: typeof fases) => contarPorFase(ps2, fs)
const tot = (ps2: typeof ps) => { const c = contarTotais(ps2); return { total: c.total, precisam: c.precisam, graves: c.graves } }
const base = {
  fases, processos: ps,
  funil: linhas.map((l) => ({ key: l.key, total: l.total, ritmo: l.noRitmo, atencao: l.atencao, parados: l.graves })),
  botoes: linhas.map((l) => ({ key: l.key, n: l.total })),
  filtrosPorFase: linhas.map((l) => ({ key: l.key, todos: l.total, precisam: l.precisam, atencao: l.atencao, parados: l.graves })),
  radar: { todas: 5, precisam: 3, criticas: 2 }, emRiscoDoCartao: 2, emRiscoDaTarefas: 2,
}
ok("abas coerentes → 0 divergências", compararContagens(base, unica, tot).length === 0)
ok("funil dizendo 1·1·1 (ignora o parado) é pego", compararContagens({ ...base, funil: base.funil.map((f) => f.key === "emissao" ? { ...f, parados: 0 } : f) }, unica, tot).length === 1)
ok("Visão geral «1 em risco» × Tarefas 2 é pego", compararContagens({ ...base, emRiscoDoCartao: 1 }, unica, tot).length === 1)
ok("botão da fase com número diferente é pego", compararContagens({ ...base, botoes: base.botoes.map((b) => b.key === "analise" ? { ...b, n: 5 } : b) }, unica, tot).length === 1)

console.log("\n4) Nenhuma aba reconta por conta própria")
ok("botoesDeFase usa contarPorFase", /contarPorFase/.test(ler("lib/operacional/torre-fase.ts")))
ok("vigia registrado na suíte crítica", /torre-contagens-risco-unicos/.test(ler("scripts/ci/suite-critica.json")))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
