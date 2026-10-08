// scripts/torre-abas-coerentes.test.ts
// ============================================================================
// AS ABAS DA TORRE DIZEM A MESMA COISA (07/10/2026). Item 1 — RESPONSÁVEL: a aba Processos mostrava o nome de UMA tarefa como responsável das 20 certidões do Abellan
// (17 Daniela + 3 Marco). Agora `responsaveisDoProcesso` agrega os donos; Processos, filtros e vigia leem dela; Equipe e Tarefas contam por `Tarefa.responsavelId`.
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { responsaveisDoProcesso, processoTemDono, processoTemSemDono, responsavelDaTarefa } from "../lib/operacional/responsavel-canonico"
import { compararResponsaveis, compararAbasDaTorre } from "../lib/operacional/torre-coerencia-abas"
import { proximaAcaoDoProcesso } from "../lib/operacional/torre-proxima-acao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (f: string) => readFileSync(f, "utf8")
const L = (id: number | null, nome: string | null, estado: "FILA" | "AGUARDANDO" | "CONCLUIDA" = "FILA") => ({ responsavelId: id, responsavelNome: nome, estadoOperacao: estado })

async function main() {
  exigirBancoDeTeste("torre-abas-coerentes.test.ts")

  secao("A) Responsável do processo (puro) — o caso Abellan")
  const abellan = [...Array.from({ length: 17 }, () => L(12, "Daniela Brait")), ...Array.from({ length: 3 }, () => L(3, "Marco Rovatti"))]
  const r = responsaveisDoProcesso(abellan)
  ok("17 da Daniela + 3 do Marco: a célula diz os DOIS, não um nome só", r.texto === "Daniela Brait (17) · Marco Rovatti (3)" && r.donos.length === 2 && r.semDono === 0, r.texto)
  ok("um dono só: o nome; ninguém: «Sem responsável»; dono + sem dono: os dois", responsaveisDoProcesso([L(12, "Daniela Brait"), L(12, "Daniela Brait")]).texto === "Daniela Brait" && responsaveisDoProcesso([L(null, null)]).texto === "Sem responsável" && /Daniela Brait \(1\) · sem responsável \(1\)/.test(responsaveisDoProcesso([L(12, "Daniela Brait"), L(null, null)]).texto))
  ok("tarefa concluída não conta; aberta, vencida ou sem dono nunca é erro (só estado)", responsaveisDoProcesso([L(12, "Daniela Brait", "CONCLUIDA"), L(null, null)]).abertas === 1)
  ok("o filtro «Responsável» casa por QUALQUER dono do processo (Marco acha o Abellan) e «Sem responsável» só com tarefa sem dono", processoTemDono(r, "Marco Rovatti") && processoTemDono(r, "Daniela Brait") && !processoTemSemDono(r) && processoTemSemDono(responsaveisDoProcesso([L(null, null)])))
  ok("o dono de UMA tarefa vem de responsavelId (única leitura)", responsavelDaTarefa({ responsavelId: 3, responsavelNome: "Marco Rovatti" })?.id === 3 && responsavelDaTarefa({ responsavelId: null, responsavelNome: null }) == null)
  const mk = (id: number, resp: number | null, nome: string | null) => ({ taskId: id, titulo: `Certidão ${id}`, statusTarefa: "NAO_INICIADA", faseMacroKey: "emissao_documental", responsavelId: resp, responsavelNome: nome, dataPrazo: null, atrasada: false, diasParaPrazo: null, estadoOperacao: "FILA" as const, esperandoDe: null, acompanhamentoVencido: false, terceiroNome: null, documentoId: id })
  const prox = proximaAcaoDoProcesso([mk(1, 12, "Daniela Brait"), mk(2, 3, "Marco Rovatti")], null)
  ok("a próxima ação carrega os responsáveis do processo", prox?.responsaveis.donos.length === 2)

  secao("B) O comparador (puro) — reprova divergência entre abas")
  const procs = [{ processoId: 1, familiaNome: "Abellan", proximaAcao: { responsaveis: { donos: [{ id: 12, nome: "Daniela Brait", n: 17 }, { id: 3, nome: "Marco Rovatti", n: 3 }], semDono: 0, abertas: 20 } } }]
  const linhas = [...Array.from({ length: 17 }, () => ({ processoId: 1, ...L(12, "Daniela Brait") })), ...Array.from({ length: 3 }, () => ({ processoId: 1, ...L(3, "Marco Rovatti") }))]
  const equipe = [{ usuarioId: 12, nome: "Daniela Brait", ativas: 17 }, { usuarioId: 3, nome: "Marco Rovatti", ativas: 3 }]
  ok("abas coerentes: nenhuma divergência", compararResponsaveis({ processos: procs, linhas, equipe, semResponsavelDaEquipe: 0 }).length === 0)
  ok("Equipe dizendo Daniela 16 é acusada (Equipe × Tarefas)", compararResponsaveis({ processos: procs, linhas, equipe: [{ usuarioId: 12, nome: "Daniela Brait", ativas: 16 }, equipe[1]], semResponsavelDaEquipe: 0 }).some((d) => d.abas === "Equipe × Tarefas" && d.chave === "Daniela Brait"))
  ok("Processos mostrando um nome só (Daniela 20) é acusado (Processos × Tarefas)", compararResponsaveis({ processos: [{ ...procs[0], proximaAcao: { responsaveis: { donos: [{ id: 12, nome: "Daniela Brait", n: 20 }], semDono: 0, abertas: 20 } } }], linhas, equipe, semResponsavelDaEquipe: 0 }).some((d) => d.abas === "Processos × Tarefas"))
  ok("«sem responsável» divergente é acusado", compararResponsaveis({ processos: procs, linhas: [...linhas, { processoId: 1, ...L(null, null) }], equipe, semResponsavelDaEquipe: 0 }).some((d) => d.chave === "Sem responsável"))

  secao("C) No banco de teste — as abas leem as MESMAS linhas")
  const c = await montarCenario("TORABAS", {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [{ key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] }],
  })
  try {
    const dani = await prisma.usuario.create({ data: { nome: "TORABAS Dani", email: "torabas-dani@t.com", senha: "x", tipo: "assistente" } as never, select: { id: true } })
    const a = await c.novaObrigacao({ responsavelId: dani.id })
    await c.novaObrigacao({ responsavelId: null })
    void a
    const divs = await compararAbasDaTorre()
    ok("Processos × Equipe × Tarefas coerentes no banco de teste (responsável)", divs.filter((d) => d.assunto === "responsavel").length === 0, divs.map((d) => d.detalhe).join(" | "))
    await prisma.tarefa.updateMany({ where: { processoId: a.processoId }, data: { responsavelId: dani.id } })
  } finally { await c.limpar() }

  secao("D) Código — uma leitura só")
  ok("a célula Responsável de Processos desenha responsaveis.texto (não o nome de uma tarefa)", /acao\.responsaveis\.texto/.test(ler("src/components/torre/TorreProcessos.tsx")) && !/acao\.responsavelNome \?\? SEM_RESPONSAVEL/.test(ler("src/components/torre/TorreProcessos.tsx")))
  ok("os filtros de Processos leem responsaveisDaLinha (donos do processo), não responsavelNome da tarefa representativa", /responsaveisDaLinha/.test(ler("lib/operacional/torre-fase.ts")) && !/p\.proximaAcao \? p\.proximaAcao\.responsavelNome/.test(ler("lib/operacional/torre-fase.ts")))
  ok("o vigia roda na Saúde (regra n do INT-003)", /detectarRegraN/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")) && /n: 'Abas da Torre/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} ABAS DA TORRE — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
