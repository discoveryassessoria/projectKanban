// scripts/lote-atribuir-na-pagina-do-processo.test.ts
// ============================================================================
// PÁGINA DO PROCESSO (06/10/2026) — a barra de seleção da tabela "Certidões abertas" usa as MESMAS ações em lote da aba Tarefas:
// «Atribuir a…», «Remover responsável», «Atribuir às sugeridas» — sempre com PRÉVIA (certidão · pessoa · família) e só grava depois do «Confirmar»;
// tarefa já iniciada pede confirmação extra.   npx tsx scripts/lote-atribuir-na-pagina-do-processo.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("lote-atribuir-na-pagina-do-processo.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { previaDeAtribuir, previaDeRemoverResponsavel, previaDasSugeridas, atribuirEmLote, removerResponsavelEmLote } from "../src/services/torre-acoes-lote"
import { quadroDaEquipe } from "../lib/operacional/torre-equipe"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const sem = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const MARCA = "LOTEPG"

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const dani = await prisma.usuario.create({ data: { nome: `${MARCA} Daniela`, email: `${MARCA.toLowerCase()}-dani@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
    const t = []
    for (let i = 0; i < 3; i++) t.push(await c.novaObrigacao({}))
    const ids = t.map((x) => x.tarefaId)

    secao("1) PRÉVIA antes de gravar — certidão · pessoa · família")
    const previa = await previaDeAtribuir(ids, dani.id)
    ok("a prévia existe e diz «Atribuir 3 tarefas a <pessoa>»", !!previa && new RegExp(`^Atribuir 3 tarefas a ${MARCA} Daniela`).test(previa.pergunta), previa?.pergunta.slice(0, 120))
    ok("lista UMA linha por tarefa, no formato «título · família»", !!previa && previa.itens[0].tarefas.length === 3 && previa.itens[0].tarefas.every((l) => l.includes(" · ")))
    ok("sem tarefa iniciada: não exige confirmação extra", !!previa && !previa.exigeConfirmacaoDeAndamento)
    const nada = await prisma.tarefa.count({ where: { id: { in: ids }, responsavelId: { not: null } } })
    ok("pedir a prévia NÃO grava nada", nada === 0)

    secao("2) Confirmar → grava responsável, histórico e carga")
    const r = await atribuirEmLote({ tarefaIds: ids, responsavelId: dani.id, autorId: admin.id, motivo: "manual" })
    ok("3 atribuídas", r.sucesso === 3)
    ok("responsável gravado nas 3", (await prisma.tarefa.count({ where: { id: { in: ids }, responsavelId: dani.id } })) === 3)
    ok("histórico: uma linha TAREFA_ATRIBUIDA por tarefa, com o autor", (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: ids }, acao: "TAREFA_ATRIBUIDA", usuarioId: admin.id } })) === 3)
    const q = await quadroDaEquipe()
    const linhaDani = q.pessoas.find((p) => p.usuarioId === dani.id)
    ok("carga da Equipe: a pessoa aparece com 3 abertas", !!linhaDani && (linhaDani.ativas === 3), JSON.stringify(linhaDani ? { ativas: linhaDani.ativas } : null))

    secao("3) Tarefa já INICIADA pede confirmação extra")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: t[0].stepInstanceId }, data: { status: "EM_ANDAMENTO", startedAt: new Date() } })
    const pi = await previaDeAtribuir(ids, admin.id)
    ok("prévia de transferência marca exigeConfirmacaoDeAndamento + alerta", !!pi && pi.exigeConfirmacaoDeAndamento === true && /iniciad/.test(pi.alerta ?? ""))
    ok("a prévia diz «Transferir … (hoje de <pessoa>)»", !!pi && /^Transferir 3 tarefas/.test(pi.pergunta) && pi.pergunta.includes(`${MARCA} Daniela`))
    const pr = await previaDeRemoverResponsavel(ids)
    ok("remover responsável também pede a extra quando há iniciada", !!pr && pr.exigeConfirmacaoDeAndamento === true)

    secao("4) Remover responsável (mesma ação da aba Tarefas)")
    const rem = await removerResponsavelEmLote({ tarefaIds: [ids[1], ids[2]], autorId: admin.id, motivo: "teste" })
    ok("2 devolvidas à fila", rem.sucesso === 2 && (await prisma.tarefa.count({ where: { id: { in: [ids[1], ids[2]] }, responsavelId: null } })) === 2)
    ok("histórico TAREFA_DEVOLVIDA_A_FILA por tarefa", (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: [ids[1], ids[2]] }, acao: "TAREFA_DEVOLVIDA_A_FILA" } })) === 2)
    const iniciadaSem = await removerResponsavelEmLote({ tarefaIds: [ids[0]], autorId: admin.id })
    ok("tarefa iniciada SEM a confirmação de andamento é recusada", iniciadaSem.sucesso === 0 && (await prisma.tarefa.findUnique({ where: { id: ids[0] } }))?.responsavelId === dani.id)

    secao("5) «Atribuir às sugeridas» (secundária)")
    const sug = await previaDasSugeridas([ids[1]])
    ok("sem aptidão comprovada no teste: não inventa sugestão (null)", sug === null)

    secao("6) As duas telas usam o MESMO código")
    const pagina = sem(readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8"))
    const certs = sem(readFileSync("src/components/torre/ProcessoCertidoes.tsx", "utf8"))
    const tarefas = sem(readFileSync("src/components/torre/TorreTarefas.tsx", "utf8"))
    const compartilhado = sem(readFileSync("src/components/torre/lote-atribuicao.tsx", "utf8"))
    ok("página e aba Tarefas chamam useLoteDeAtribuicao", /useLoteDeAtribuicao\(/.test(pagina) && /useLoteDeAtribuicao\(/.test(tarefas))
    ok("tabela e aba renderizam AcoesDeAtribuicaoEmLote", /<AcoesDeAtribuicaoEmLote/.test(certs) && /<AcoesDeAtribuicaoEmLote/.test(tarefas))
    ok("a barra mostra Atribuir a…, Remover responsável e Atribuir às sugeridas", /Atribuir a/.test(compartilhado) && /Remover responsável/.test(compartilhado) && /Atribuir às sugeridas/.test(compartilhado))
    ok("a tabela do processo mantém «Limpar seleção»", /Limpar seleção/.test(certs) && /comSugeridas/.test(certs))
    ok("nenhuma das duas telas grava atribuição em loop próprio", !/acao: "atribuir", responsavelId[\s\S]{0,40}for/.test(tarefas) && !/atribuirVarias/.test(pagina))
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
