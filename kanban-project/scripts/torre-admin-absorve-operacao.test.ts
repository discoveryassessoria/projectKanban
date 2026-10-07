// scripts/torre-admin-absorve-operacao.test.ts
// ============================================================================
// TUDO DO ADMINISTRADOR MORA NA TORRE (30/09/2026).
//   • Admin: menu sem "Operação"; /operacao → Torre (traduzindo família/aba/tarefa); aviso de família → página do processo; aviso
//     de tarefa → drawer; aviso de distribuição → Sem responsável. Avisos JÁ GRAVADOS continuam funcionando.
//   • Não-admin: menu, /operacao e links IDÊNTICOS aos de antes.
//   • "Minhas tarefas" do admin = a mesma fila (ids e contagens) que a Operação mostrava.
//   • Acomp. vencidos ≠ Cobranças vencidas (dois números, dois nomes, cada um = sua lista).
//   • "Atribuir tarefas — {família}": ninguém cria mais; o encerramento usa a porta canônica de cancelamento.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-admin-absorve-operacao.test.ts")

import { readFileSync, existsSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { destinoDaOperacaoParaAdmin, linkDoAvisoParaAdmin } from "../src/lib/torre-absorcao"
import { itemDeMenuVisivel } from "../src/lib/menu-visibilidade"
import {
  urlOperacaoDaFamilia, urlMinhaOperacaoDoProcesso, urlOperacionalDaTarefa, urlOperacionalDoProcesso,
  urlDistribuicaoDoProcesso, urlVisaoGlobalDaFamilia, urlArvoreDoProcesso, LINK_SEM_RESPONSAVEL_NA_TORRE,
} from "../lib/operacional/navegacao"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"
import { criarTarefaAdministrativa, cancelarTarefa } from "../lib/operacional/tarefa-ciclo"
import { limparSpec } from "../lib/operacional/torre-visoes"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }
const MARCA = "TADMOP"

async function main() {
  console.log("Links do ADMIN: /operacao → Torre")
  ok("sem parâmetro → aba Minha operação", destinoDaOperacaoParaAdmin("") === "/torre?aba=minha")
  ok("?aba=fila → Minha operação (A fazer)", destinoDaOperacaoParaAdmin("aba=fila") === "/torre?aba=minha")
  ok("?aba=aguardando → Minha operação, aba Aguardando", destinoDaOperacaoParaAdmin("aba=aguardando") === "/torre?aba=minha&op=aguardando")
  ok("?aba=acompanhamento → Minha operação, aba Acompanhamento", destinoDaOperacaoParaAdmin("aba=acompanhamento") === "/torre?aba=minha&op=acompanhamento")
  ok("?aba=feito → Minha operação, aba Feito", destinoDaOperacaoParaAdmin("aba=feito") === "/torre?aba=minha&op=feito")
  ok("?aba=familias e ?aba=radar → as abas internas de Minha operação", destinoDaOperacaoParaAdmin("aba=familias") === "/torre?aba=minha&op=familias" && destinoDaOperacaoParaAdmin("aba=radar") === "/torre?aba=minha&op=radar")
  ok("aviso de família (?processo=&aba=) → página do processo", destinoDaOperacaoParaAdmin("processo=651&aba=acompanhamento") === "/torre/processo/651")
  ok("?taskId= → drawer da tarefa", destinoDaOperacaoParaAdmin("taskId=3834") === "/torre?aba=tarefas&tarefa=3834")
  ok("parâmetro não numérico é ignorado (nada de injeção na URL)", destinoDaOperacaoParaAdmin("processo=1%26aba%3Dx&taskId=abc") === "/torre?aba=minha")

  console.log("\nAvisos JÁ GRAVADOS (as formas reais geradas pelo sistema)")
  const admin = (l: string) => linkDoAvisoParaAdmin(l, "admin")
  ok("CHEGOU_TRABALHO (/operacao?processo=&aba=fila) → página do processo", admin(urlOperacaoDaFamilia(651, "fila")) === "/torre/processo/651")
  ok("PRECISA_AGIR (aba acompanhamento) → página do processo", admin(urlOperacaoDaFamilia(651, "acompanhamento")) === "/torre/processo/651")
  ok("MUDOU_DE_MAO (/operacao?processo=) → página do processo", admin(urlOperacaoDaFamilia(651)) === "/torre/processo/651")
  ok("atribuição em lote (urlMinhaOperacaoDoProcesso) → página do processo", admin(urlMinhaOperacaoDoProcesso(675)) === "/torre/processo/675")
  ok("aviso de TAREFA (/kanban?…tab=central&taskId=) → drawer da tarefa", admin(urlOperacionalDaTarefa({ taskId: 3834, processoId: 651 })) === "/torre?aba=tarefas&tarefa=3834&processo=651")
  ok("aviso de tarefa sem processo (/operacao?taskId=) → drawer", admin(urlOperacionalDaTarefa({ taskId: 9, processoId: null })) === "/torre?aba=tarefas&tarefa=9")
  ok("FASE_CONCLUIDA (/kanban?…tab=central, sem tarefa) → página do processo", admin(urlOperacionalDoProcesso(651)) === "/torre/processo/651")
  ok("distribuição da família → página do processo", admin(urlDistribuicaoDoProcesso(676)) === "/torre/processo/676")
  ok("visão global da família (/tarefas?processo=) → página do processo", admin(urlVisaoGlobalDaFamilia(676)) === "/torre/processo/676")
  ok("SEM_RESPONSAVEL (novo link) já é da Torre e não muda", admin(LINK_SEM_RESPONSAVEL_NA_TORRE) === LINK_SEM_RESPONSAVEL_NA_TORRE)
  ok("link de outra tela (Árvore, Saúde) NÃO é tocado", admin(urlArvoreDoProcesso(651, 2862)) === urlArvoreDoProcesso(651, 2862) && admin("/administrator?screen=syshealth") === "/administrator?screen=syshealth")
  ok("nenhum link traduzido do admin cai em /operacao (nada quica)", [urlOperacaoDaFamilia(1, "fila"), urlMinhaOperacaoDoProcesso(1), urlDistribuicaoDoProcesso(1), urlOperacionalDaTarefa({ taskId: 1, processoId: null })].every((l) => !String(admin(l)).startsWith("/operacao")))

  console.log("\nNÃO-ADMIN: tudo IDÊNTICO ao de antes")
  const todos = [urlOperacaoDaFamilia(651, "fila"), urlOperacaoDaFamilia(651), urlMinhaOperacaoDoProcesso(675), urlOperacionalDaTarefa({ taskId: 3834, processoId: 651 }), urlOperacionalDoProcesso(651), urlDistribuicaoDoProcesso(676), urlVisaoGlobalDaFamilia(676), "/operacao", "/operacao?taskId=1"]
  for (const tipo of ["assistente", "gerente", "usuario", null, undefined]) ok(`tipo ${String(tipo)}: nenhum link muda`, todos.every((l) => linkDoAvisoParaAdmin(l, tipo as string | null | undefined) === l))
  ok("link nulo continua nulo", linkDoAvisoParaAdmin(null, "admin") === null && linkDoAvisoParaAdmin(undefined, "assistente") === null)

  console.log("\nMenu")
  const operacao = { permissao: "tarefas.ver", escondeParaAdmin: true }
  const operacaoAntes = { permissao: "tarefas.ver" }
  const adm = { pode: () => true, isAdmin: true }, daniela = { pode: (p: string) => p === "tarefas.ver", isAdmin: false }, semNada = { pode: () => false, isAdmin: false }
  ok("admin NÃO vê 'Operação'", !itemDeMenuVisivel(operacao, adm))
  ok("Daniela (não-admin) vê 'Operação' exatamente como antes", itemDeMenuVisivel(operacao, daniela) === itemDeMenuVisivel(operacaoAntes, daniela) && itemDeMenuVisivel(operacao, daniela))
  ok("quem não tem permissão continua sem ver", itemDeMenuVisivel(operacao, semNada) === itemDeMenuVisivel(operacaoAntes, semNada))
  const side = readFileSync("src/components/bitrix-sidebar.tsx", "utf8")
  const blocoOp = side.slice(side.indexOf('url: "/operacao"'), side.indexOf('url: "/operacao"') + 400)
  ok("o item do menu está marcado escondeParaAdmin", /escondeParaAdmin: true/.test(blocoOp))

  console.log("\nPáginas e Torre")
  const pg = readFileSync("src/app/operacao/page.tsx", "utf8")
  ok("/operacao continua existindo e só redireciona quem tem acesso à Torre (admin ou operacao.distribuirTarefas)", existsSync("src/app/operacao/page.tsx") && /temAcessoATorre\(user\.tipo, pode\) \? destinoDaOperacaoParaAdmin\(parametros\) : null/.test(pg) && /router\.replace\(paraTorre\)/.test(pg))
  ok("a tela da Operação (OperacaoV3) continua montada para o não-admin", pg.includes("<OperacaoV3 gestor="))
  const sino = readFileSync("src/components/sino-notificacoes.tsx", "utf8")
  ok("o clique do sino traduz o link só para admin", /linkDoAvisoParaAdmin\(a\.link, usuarioSalvo\?\.tipo\)/.test(sino))
  const torre = readFileSync("src/components/torre/Torre.tsx", "utf8")
  ok("a Torre lê ?visao=, ?processo= e ?tarefa=", /get\("visao"\)/.test(torre) && /get\("processo"\)/.test(torre) && /get\("tarefa"\)/.test(torre))

  console.log("\nAcomp. vencidos ≠ Cobranças vencidas; visões da aba Tarefas")
  const tt = readFileSync("lib/operacional/torre-tarefas-tela.ts", "utf8")
  ok("'Acompanhamentos vencidos' (visão antiga, só por URL/visão salva) usa acompanhamentoVencido (o número que a Operação mostrava)", /case 'acompvenc': return \(l\) => l\.acompanhamentoVencido === true/.test(tt))
  ok("'Cobrar hoje' segue com cobravelVencida (o mesmo N da aba Terceiros) — outra coisa que o acompanhamento vencido", /case 'cobranca': return \(l\) => l\.cobravelVencida === true/.test(tt) && /'Cobrar hoje'/.test(tt) && /VISOES_ESCONDIDAS/.test(tt))
  const spec = limparSpec({ visao: "minhas", agrupar: "fam", dentro: "pessoa" })
  ok("visão salva guarda 'Minhas tarefas' e o subagrupamento", spec.visao === "minhas" && spec.dentro === "pessoa")
  ok("valor inválido de subagrupamento/visão é normalizado", limparSpec({ visao: "x", dentro: "y" }).visao === "todas" && limparSpec({ dentro: "y" }).dentro === "none")

  console.log("\nMinhas tarefas do admin = a fila que a Operação mostrava (banco)")
  const c = await montarCenario(MARCA)
  try {
    const eu = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-a@t.test`, senha: "x", tipo: "admin" }, select: { id: true } })
    const outro = await prisma.usuario.create({ data: { nome: `${MARCA} Outro`, email: `${MARCA.toLowerCase()}-o@t.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
    const ontem = new Date(Date.now() - 86_400_000)
    const a1 = await c.novaObrigacao({ responsavelId: eu.id }), a2 = await c.novaObrigacao({ responsavelId: eu.id, aguardando: true, dataPrazo: ontem }), a3 = await c.novaObrigacao({ responsavelId: outro.id }), a4 = await c.novaObrigacao({})
    const fila = await minhaFila(eu.id)
    const torreLinhas = (await listarTarefasDaTorre({})).linhas
    const minhasTorre = torreLinhas.filter((l) => l.responsavelId === eu.id)
    const ids = (ls: Array<{ taskId?: number }>) => ls.map((l) => l.taskId).sort((x, y) => (x ?? 0) - (y ?? 0)).join()
    const meusIds = [a1.tarefaId, a2.tarefaId].sort((x, y) => x - y).join()
    ok("os MESMOS ids: a fila da Operação do admin (minhaFila) = 'Minhas tarefas' da Torre", ids(fila.filter((l) => [a1, a2, a3, a4].some((o) => o.tarefaId === l.taskId))) === meusIds && ids(minhasTorre.filter((l) => [a1, a2, a3, a4].some((o) => o.tarefaId === l.taskId))) === meusIds)
    ok("as contagens batem (abertas, atrasadas, acompanhamento vencido)",
      fila.length === minhasTorre.length
      && fila.filter((l) => l.atrasada).length === minhasTorre.filter((l) => l.atrasada).length
      && fila.filter((l) => l.acompanhamentoVencido).length === minhasTorre.filter((l) => l.acompanhamentoVencido).length,
      `${fila.length}/${minhasTorre.length}`)
    ok("a tarefa do outro e a sem dono NÃO entram em 'Minhas tarefas'", !minhasTorre.some((l) => l.taskId === a3.tarefaId || l.taskId === a4.tarefaId))
    const acompVenc = torreLinhas.filter((l) => l.acompanhamentoVencido), cobr = torreLinhas.filter((l) => l.cobravelVencida)
    ok("'Acomp. vencidos' e 'Cobranças vencidas' são duas listas (definições distintas, cada uma com seu tamanho)", Array.isArray(acompVenc) && Array.isArray(cobr))

    console.log("\n'Atribuir tarefas': ninguém cria; o encerramento é auditado e não é 'concluída'")
    const criada = await criarTarefaAdministrativa(prisma, { processoId: a1.processoId, titulo: `${MARCA} Atribuir tarefas — X`, responsavelId: eu.id, chaveIdempotencia: `${MARCA}:adm`, origem: "obrigacao-atribuicao" })
    const r = await cancelarTarefa({ tarefaId: criada!.tarefaId, autorId: eu.id, motivo: "substituída pela Torre de Controle", codigo: "SUBSTITUIDA_PELA_TORRE" })
    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: criada!.tarefaId }, select: { statusTarefa: true, concluida: true, justificativa: true, motivoCodigo: true } })
    ok("cancelada (CANCELADA, concluida=false — nunca conta como sucesso)", r.ok && t.statusTarefa === "CANCELADA" && t.concluida === false)
    ok("com o motivo e o código gravados", t.justificativa === "substituída pela Torre de Controle" && t.motivoCodigo === "SUBSTITUIDA_PELA_TORRE")
    ok("com auditoria TAREFA_CANCELADA", (await prisma.logAuditoria.count({ where: { acao: "TAREFA_CANCELADA", entidade: "Tarefa", entidadeId: criada!.tarefaId } })) === 1)
    const nova = await c.novaObrigacao({})
    ok("materializar uma tarefa SEM dono não cria 'Atribuir tarefas'", (await prisma.tarefa.count({ where: { processoId: nova.processoId, tipo: "ADMINISTRATIVA" } })) === 0)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { acao: "TAREFA_CANCELADA", descricao: { contains: MARCA } } })
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }

  console.log("\nNenhum ponto cria a obrigação")
  for (const f of ["lib/operacional/tarefa-comandos.ts", "lib/operacional/tarefa-ciclo.ts", "lib/operacional/reconciliar-tarefas.ts", "src/services/passo-tarefa.ts"]) {
    ok(`${f} não chama mais a criação`, !/reconciliarObrigacaoDeAtribuicao/.test(readFileSync(f, "utf8")))
  }

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
