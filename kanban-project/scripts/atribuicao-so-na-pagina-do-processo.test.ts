// scripts/atribuicao-so-na-pagina-do-processo.test.ts
// ============================================================================
// ATRIBUIÇÃO DE RESPONSÁVEL SÓ NA PÁGINA DO PROCESSO (07/10/2026). Fechadas as portas que duplicavam a página; o SERVIDOR também recusa (422, português):
//   /api/tarefas/:id/comando (atribuir · transferir · devolver_a_fila), /api/tarefas/:id/atribuir, /api/tarefas/redistribuir (exceto sucessão em massa),
//   /api/torre/tarefas/:id/remover-responsavel, /api/torre/tarefas/:id/atribuir-sugerido, /api/torre/precisa-de-voce/acao (ATRIBUIR_SUGERIDO · ATRIBUIR_ESCOLHIDO).
// MANTIDOS: o lote da Torre (/api/torre/tarefas/lote), «Distribuir» do processo, a equipe da Torre, a sucessão em massa e a criação de tarefa com responsável.
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { criarPalco } from "./_fixture-arvore-fonte"
import { MENSAGEM_ATRIBUICAO_SO_NA_PAGINA, CODIGO_ATRIBUICAO_SO_NA_PAGINA, veioDaPaginaDoProcesso, veioDaSucessaoEmMassa } from "../lib/operacional/atribuicao-origem"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (f: string) => readFileSync(f, "utf8")

async function main() {
  exigirBancoDeTeste("atribuicao-so-na-pagina-do-processo.test.ts")

  secao("A) O marcador (puro)")
  ok("só «pagina-do-processo» vale como página; «sucessao-em-massa» só vale para a sucessão", veioDaPaginaDoProcesso({ origem: "pagina-do-processo" }) && !veioDaPaginaDoProcesso({}) && !veioDaPaginaDoProcesso({ origem: "sucessao-em-massa" }) && veioDaSucessaoEmMassa({ origem: "sucessao-em-massa" }) && !veioDaPaginaDoProcesso(null))
  ok("a mensagem é em português e diz o que fazer", /página do processo/.test(MENSAGEM_ATRIBUICAO_SO_NA_PAGINA) && /Abra o processo/.test(MENSAGEM_ATRIBUICAO_SO_NA_PAGINA))

  secao("B) O servidor recusa — banco de teste")
  const P = criarPalco("ATRSP")
  await P.montar()
  const c = await montarCenario("ATRSPC", {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [{ key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] }],
  })
  try {
    const o = await c.novaObrigacao({ responsavelId: null })
    const admin = P.adminId
    const { POST: comando } = await import("../src/app/api/tarefas/[tarefaId]/comando/route")
    const { POST: atribuir } = await import("../src/app/api/tarefas/[tarefaId]/atribuir/route")
    const { POST: redistribuir } = await import("../src/app/api/tarefas/redistribuir/route")
    const { POST: remover } = await import("../src/app/api/torre/tarefas/[tarefaId]/remover-responsavel/route")
    const { POST: sugerido } = await import("../src/app/api/torre/tarefas/[tarefaId]/atribuir-sugerido/route")
    const { POST: acao } = await import("../src/app/api/torre/precisa-de-voce/acao/route")
    const ctx = (id: number) => ({ params: Promise.resolve({ tarefaId: String(id) }) })
    const dono = async () => (await prisma.tarefa.findUniqueOrThrow({ where: { id: o.tarefaId }, select: { responsavelId: true } })).responsavelId
    const j = async (r: Response) => ({ status: r.status, corpo: await r.json().catch(() => ({})) as { error?: string; codigo?: string } })
    const recusou = (x: { status: number; corpo: { error?: string; codigo?: string } }) => x.status === 422 && x.corpo.codigo === CODIGO_ATRIBUICAO_SO_NA_PAGINA && x.corpo.error === MENSAGEM_ATRIBUICAO_SO_NA_PAGINA

    ok("/comando atribuir SEM a origem da página: recusado (422, português) e nada gravado", recusou(await j(await comando(P.req(`/api/tarefas/${o.tarefaId}/comando`, "POST", { acao: "atribuir", responsavelId: admin }), ctx(o.tarefaId)))) && (await dono()) == null)
    ok("/comando transferir e devolver_a_fila SEM a origem: recusados", recusou(await j(await comando(P.req(`/api/tarefas/${o.tarefaId}/comando`, "POST", { acao: "transferir", responsavelId: admin }), ctx(o.tarefaId)))) && recusou(await j(await comando(P.req(`/api/tarefas/${o.tarefaId}/comando`, "POST", { acao: "devolver_a_fila" }), ctx(o.tarefaId)))))
    ok("/atribuir SEM a origem: recusado", recusou(await j(await atribuir(P.req(`/api/tarefas/${o.tarefaId}/atribuir`, "POST", { responsavelId: admin }), ctx(o.tarefaId)))) && (await dono()) == null)
    ok("/redistribuir SEM origem: recusado", recusou(await j(await redistribuir(P.req(`/api/tarefas/redistribuir`, "POST", { tarefaIds: [o.tarefaId], novoResponsavelId: admin })))) && (await dono()) == null)
    ok("/remover-responsavel e /atribuir-sugerido SEM origem: recusados", recusou(await j(await remover(P.req(`/api/torre/tarefas/${o.tarefaId}/remover-responsavel`, "POST", {}), ctx(o.tarefaId)))) && recusou(await j(await sugerido(P.req(`/api/torre/tarefas/${o.tarefaId}/atribuir-sugerido`, "POST", {}), ctx(o.tarefaId)))))
    ok("/precisa-de-voce/acao ATRIBUIR_SUGERIDO e ATRIBUIR_ESCOLHIDO SEM origem: recusados", recusou(await j(await acao(P.req(`/api/torre/precisa-de-voce/acao`, "POST", { acao: "ATRIBUIR_SUGERIDO", tarefaId: o.tarefaId })))) && recusou(await j(await acao(P.req(`/api/torre/precisa-de-voce/acao`, "POST", { acao: "ATRIBUIR_ESCOLHIDO", tarefaId: o.tarefaId, responsavelId: admin })))))

    ok("a PÁGINA DO PROCESSO continua atribuindo pelo /comando (origem informada)", (await comando(P.req(`/api/tarefas/${o.tarefaId}/comando`, "POST", { acao: "atribuir", responsavelId: admin, origem: "pagina-do-processo" }), ctx(o.tarefaId))).status === 200 && (await dono()) === admin)
    ok("a SUCESSÃO EM MASSA continua passando pelo /redistribuir", (await redistribuir(P.req(`/api/tarefas/redistribuir`, "POST", { tarefaIds: [o.tarefaId], novoResponsavelId: admin, origem: "sucessao-em-massa" }))).status < 500)
    ok("ações que não são atribuição (alterar_prioridade) não exigem a origem", (await comando(P.req(`/api/tarefas/${o.tarefaId}/comando`, "POST", { acao: "alterar_prioridade", prioridade: "ALTA" }), ctx(o.tarefaId))).status !== 422)
  } finally {
    await c.limpar()
    await P.limpar()
  }

  secao("C) As telas")
  const sem = (f: string) => ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  ok("a página do processo manda a origem; o lote da Torre continua (rota própria)", /origem: "pagina-do-processo"/.test(ler("src/components/torre/TorreProcessoPagina.tsx")) && /\/api\/torre\/tarefas\/lote/.test(ler("src/components/torre/lote-atribuicao.tsx")))
  const FECHADAS = ["src/components/kanban/DocumentoOperationalDrawer.tsx", "src/components/kanban/ProcessoCentralOperacional.tsx", "src/components/kanban/PainelDaFase.tsx", "src/components/operacao/processo-expandido.tsx", "src/components/operacao/visao-global.tsx", "src/components/operacao/operacao-v3.tsx", "src/components/torre/TorreTarefas.tsx", "src/components/torre/acoes-do-item.tsx", "src/components/torre/PainelTorreTarefa.tsx"]
  for (const f of FECHADAS) {
    const t = sem(f)
    ok(`${f.split("/").pop()}: não chama mais as rotas de atribuição fechadas`, !/acao:\s*["']atribuir["']/.test(t) && !/acao:\s*["']transferir["']/.test(t) && !/devolver_a_fila/.test(t.replace(/ARRASTOS[\s\S]*?\n\}/, "")) && !/\/api\/tarefas\/redistribuir/.test(t) && !/\/atribuir-sugerido/.test(t) && !/\/remover-responsavel/.test(t) && !/\/api\/tarefas\/\$\{[^}]+\}\/atribuir/.test(t))
  }
  ok("a distribuição mantém SÓ a sucessão em massa (origem informada) e leva o resto ao processo", /origem: "sucessao-em-massa"/.test(ler("src/components/operacao/distribuicao-tarefas.tsx")) && /Atribuir no processo/.test(ler("src/components/operacao/distribuicao-tarefas.tsx")))
  ok("o atalho «Abrir processo para atribuir» existe e leva a /torre/processo/[id]", /Abrir processo para atribuir/.test(ler("src/components/torre/AtalhoAbrirProcessoParaAtribuir.tsx")) && /\/torre\/processo\/\$\{processoId\}/.test(ler("src/components/torre/AtalhoAbrirProcessoParaAtribuir.tsx")))
  ok("gaveta, Central e painel da fase mostram o responsável atual com o atalho", ["src/components/kanban/DocumentoOperationalDrawer.tsx", "src/components/kanban/PainelDaFase.tsx", "src/components/torre/PainelTorreTarefa.tsx", "src/components/operacao/processo-expandido.tsx"].every((f) => /AtalhoAbrirProcessoParaAtribuir/.test(ler(f))))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} ATRIBUIÇÃO SÓ NA PÁGINA DO PROCESSO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
