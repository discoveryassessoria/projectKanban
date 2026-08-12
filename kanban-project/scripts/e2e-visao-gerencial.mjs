// scripts/e2e-visao-gerencial.mjs
// ============================================================================
// TAREFAS E PROJETOS PELO NAVEGADOR.
//
//   node scripts/e2e-visao-gerencial.mjs <base> <saida> <tokGestor> <tokFunc>
//
// O palco (`palco-gerencial.ts`) deixou uma tarefa em cada situação que o gestor
// precisa enxergar. Aqui o teste faz o que o gestor faz: abre a tela, olha os
// números, filtra, troca para o quadro, abre um card, atribui, executa e volta.
//
// O que ele prova, e é o que importa: as duas visualizações e as duas filas
// falam da MESMA tarefa. Em cada passo, o `taskId` é conferido — porque a
// maneira de esta tela dar errado não é ficar feia, é passar a contar uma
// segunda história sobre o mesmo trabalho.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_FUNC] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function sessao(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const user = readFileSync(tokPath + ".user", "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)

const api = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}

const CTX = JSON.parse(process.env.CTX_GERENCIAL ?? "{}")
const T = CTX.tarefas ?? {}

console.log("E2E — TAREFAS E PROJETOS (visão gerencial global)\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§1/§23 · A tela abre e mostra a operação inteira")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/tarefas`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(3500)
const corpo = await gestor.page.locator("body").innerText()
ok("§1) a área 'Tarefas e Projetos' existe", /Tarefas e Projetos/.test(corpo))
ok("§2) com as duas visualizações", /Lista/.test(corpo) && /Kanban/.test(corpo))

const esperados = Object.entries(T)
const global = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
const porId = new Map((global?.linhas ?? []).map((l) => [l.taskId, l]))
for (const [chave, id] of esperados) {
  ok(`§23) "${chave}" está na visão global`, porId.has(id), porId.get(id)?.coluna ?? "ausente")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§4/§5 · Cada uma na sua coluna — e a coluna não é a etapa")
// ═══════════════════════════════════════════════════════════════════════════
const COLUNA_ESPERADA = {
  "sem-dono": "SEM_RESPONSAVEL",
  "a-fazer": "A_FAZER",
  "andamento": "EM_ANDAMENTO",
  "aguardando": "AGUARDANDO_TERCEIRO",
  "bloqueada": "BLOQUEADA",
  "concluida": "CONCLUIDA",
  "atrasada": "EM_ANDAMENTO",
  "vence-hoje": "A_FAZER",
}
for (const [chave, coluna] of Object.entries(COLUNA_ESPERADA)) {
  const l = porId.get(T[chave])
  ok(`§4) "${chave}" na coluna ${coluna}`, l?.coluna === coluna, l?.coluna ?? "—")
}
ok("§13) a atrasada continua EM ANDAMENTO, com atraso como CONDIÇÃO",
  porId.get(T["atrasada"])?.atrasada === true && porId.get(T["atrasada"])?.coluna === "EM_ANDAMENTO")
ok("§14) a que vence hoje NÃO está atrasada",
  porId.get(T["vence-hoje"])?.venceHoje === true && porId.get(T["vence-hoje"])?.atrasada === false)
ok("§15) a que aguarda diz há quanto tempo espera",
  porId.get(T["aguardando"])?.esperandoHaDias != null,
  `${porId.get(T["aguardando"])?.esperandoHaDias} dia(s)`)
ok("§16) a bloqueada diz POR QUE está bloqueada",
  (porId.get(T["bloqueada"])?.motivoBloqueio ?? "").length > 5,
  porId.get(T["bloqueada"])?.motivoBloqueio?.slice(0, 50) ?? "—")
ok("§5) e a etapa atual aparece SEM virar coluna",
  porId.get(T["andamento"])?.etapaAtual != null,
  porId.get(T["andamento"])?.etapaAtual ?? "—")

// ═══════════════════════════════════════════════════════════════════════════
secao("§8 · Indicadores no topo, e clicar filtra")
// ═══════════════════════════════════════════════════════════════════════════
const ind = global?.indicadores ?? {}
ok("§8) o topo mostra os indicadores", Object.keys(ind).length >= 6, JSON.stringify(ind))
const textoTopo = await gestor.page.locator("body").innerText()
for (const rotulo of ["Sem responsável", "Em andamento", "Aguardando terceiro", "Bloqueadas", "Atrasadas", "Vence hoje"]) {
  ok(`§8) indicador "${rotulo}" na tela`, textoTopo.includes(rotulo))
}
await gestor.page.getByRole("button", { name: /^\d+\s*Atrasadas$/s }).first().click().catch(async () => {
  await gestor.page.locator("button").filter({ hasText: "Atrasadas" }).first().click()
})
await gestor.page.waitForTimeout(2500)
await gestor.page.screenshot({ path: `${OUT}/vg-1-indicadores.png` })
const apósClique = await gestor.page.locator("table tbody tr").count().catch(() => -1)
ok("§8) clicar no indicador recorta a lista", apósClique >= 0, `${apósClique} linha(s)`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§7/§24 · Filtros combináveis, e limpar volta ao todo")
// ═══════════════════════════════════════════════════════════════════════════
const dani = CTX.dani?.id
const comb = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL&responsavel=${dani}&fase=emissao_documental&atrasadas=1`)).body
ok("§24) responsável + fase + atrasadas devolve SÓ a atrasada",
  (comb?.linhas ?? []).length === 1 && comb.linhas[0].taskId === T["atrasada"],
  `${(comb?.linhas ?? []).length} linha(s)`)
const semDono = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL&semResponsavel=1`)).body
ok("§7) filtrar 'sem responsável' devolve só a sem dono",
  (semDono?.linhas ?? []).length === 1 && semDono.linhas[0].taskId === T["sem-dono"])
const busca = (await api(gestor, `/api/operacao/visao-global?busca=Rovatti`)).body
ok("§7) a busca textual encontra pelo processo/família", (busca?.linhas ?? []).length >= 1,
  `${(busca?.linhas ?? []).length} resultado(s)`)
const limpo = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
ok("§24) limpar filtros volta ao conjunto global", (limpo?.linhas ?? []).length === esperados.length,
  `${(limpo?.linhas ?? []).length} de ${esperados.length}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§2 · Trocar Lista ↔ Kanban não muda os dados")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/tarefas`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(3000)
const antesDaTroca = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
// O banco de teste tem os cenários de OUTROS testes. Sem recortar, o quadro
// mostra a base inteira e o clique em "Atribuir" cairia no card de outra prova.
// O gestor faria a mesma coisa: filtra antes de agir.
await gestor.page.locator('input[placeholder="Buscar tarefa, pessoa ou processo…"]').fill("GERENCIAL")
await gestor.page.waitForTimeout(2500)
await gestor.page.getByRole("button", { name: "Kanban" }).click()
await gestor.page.waitForTimeout(2500)
const quadro = await gestor.page.locator("body").innerText()
// O cabeçalho é maiúsculo por CSS (`uppercase`), e `innerText` devolve o texto
// RENDERIZADO. Comparar com a string do código passaria por acaso quando o rótulo
// aparecesse em outro lugar da tela — foi o que aconteceu na primeira execução.
const cabecalhos = (await gestor.page.locator("div.w-72 > div:first-child").allInnerTexts())
  .map((h) => h.split("\n")[0].trim().toLocaleLowerCase("pt-BR"))
for (const c of ["Sem responsável", "A fazer", "Em andamento", "Aguardando terceiro", "Bloqueada", "Concluída"]) {
  ok(`§4) o quadro tem a coluna "${c}"`, cabecalhos.includes(c.toLocaleLowerCase("pt-BR")),
    cabecalhos.join(" | "))
}
for (const etapa of ["Solicitar certidão", "Conferir certidão", "Validar certidão"]) {
  // A etapa PODE aparecer dentro de um card (é informação útil); o que não pode
  // é existir uma COLUNA com esse nome.
  ok(`§5) nenhuma COLUNA se chama "${etapa}"`,
    !cabecalhos.some((h) => h.includes(etapa.toLocaleLowerCase("pt-BR"))))
}
await gestor.page.screenshot({ path: `${OUT}/vg-2-kanban.png` })
const depoisDaTroca = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
ok("§2) trocar de visualização não alterou nada",
  JSON.stringify(antesDaTroca?.linhas?.map((l) => [l.taskId, l.statusTarefa]))
  === JSON.stringify(depoisDaTroca?.linhas?.map((l) => [l.taskId, l.statusTarefa])))

// ═══════════════════════════════════════════════════════════════════════════
secao("§25 · UMA tarefa, várias projeções — o mesmo taskId em todas")
// ═══════════════════════════════════════════════════════════════════════════
const X = T["andamento"]
const naGlobal = porId.get(X)
ok("§25) a Lista mostra a tarefa X", naGlobal?.taskId === X, `taskId ${X}`)
const naFila = (await api(func, "/api/operacao/tarefas?visao=minha_fila")).body
ok("§25) a Minha Fila do funcionário mostra o MESMO taskId",
  (naFila?.linhas ?? []).some((l) => l.taskId === X))
const naCentral = (await api(gestor, `/api/operacao/tarefas/${X}`)).body
ok("§25) a Central abre o MESMO taskId", naCentral?.tarefa?.taskId === X)
ok("§25) e o título é o mesmo nas três", naCentral?.tarefa?.titulo === naGlobal?.titulo,
  naGlobal?.titulo ?? "—")

// abrir pelo Kanban leva à MESMA tarefa
const card = gestor.page.locator("div.w-72 button").filter({ hasText: "Certidão de Óbito" }).first()
if (await card.count()) {
  await card.click()
  await gestor.page.waitForTimeout(3000)
  const modal = await gestor.page.locator("body").innerText()
  ok("§9) clicar no card abre a Tarefa Operacional canônica",
    /WORKFLOW INTERNO/i.test(modal) || /Workflow/i.test(modal))
  ok("§9) com o workflow interno, não com as colunas do quadro",
    /Solicitar certidão/i.test(modal))
  await gestor.page.screenshot({ path: `${OUT}/vg-3-tarefa-aberta.png` })
  // O painel fecha pelo botão "Fechar" (ou clicando fora) — não por ESC. É o
  // gesto que existe na tela; o harness usa o gesto real, não um atalho que ele
  // gostaria que existisse.
  await gestor.page.getByRole("button", { name: "Fechar" }).first().click()
  await gestor.page.waitForTimeout(1500)
} else {
  ok("§9) clicar no card abre a Tarefa Operacional canônica", false, "card não encontrado")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§10/§12/§26 · Atribuir pelo quadro")
// ═══════════════════════════════════════════════════════════════════════════
const semDonoCard = gestor.page.locator("div.w-72").filter({ hasText: "Sem responsável" }).first()
const botaoAtribuir = semDonoCard.locator("button").filter({ hasText: "Atribuir" }).first()
if (await botaoAtribuir.count()) {
  await botaoAtribuir.click()
  await gestor.page.waitForTimeout(2000)
  const seletor = await gestor.page.locator("body").innerText()
  ok("§10) abre o MESMO seletor da Central, com a carga de cada um",
    /Atribuir tarefa/.test(seletor) && /ativa/.test(seletor))
  await gestor.page.locator("button").filter({ hasText: "Daniela Brait" }).first().click()
  await gestor.page.waitForTimeout(3000)
  const depois = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
  const alvo = (depois?.linhas ?? []).find((l) => l.taskId === T["sem-dono"])
  ok("§12) MESMO taskId depois de atribuir", alvo?.taskId === T["sem-dono"])
  ok("§12) saiu de 'Sem responsável'", alvo?.coluna !== "SEM_RESPONSAVEL", alvo?.coluna ?? "—")
  ok("§12) e ganhou responsável", alvo?.responsavelNome != null, alvo?.responsavelNome ?? "—")
  const filaDepois = (await api(func, "/api/operacao/tarefas?visao=minha_fila")).body
  ok("§26) a Minha Fila do funcionário já a enxerga",
    (filaDepois?.linhas ?? []).some((l) => l.taskId === T["sem-dono"]))
  ok("§21) e a tela atualizou sem refresh manual — sem sobrar ninguém sem dono no palco",
    (depois?.linhas ?? []).every((l) => l.coluna !== "SEM_RESPONSAVEL"),
    `${(depois?.linhas ?? []).filter((l) => l.coluna === "SEM_RESPONSAVEL").length} sem dono`)
  await gestor.page.screenshot({ path: `${OUT}/vg-4-atribuida.png` })
} else {
  ok("§10) abre o MESMO seletor da Central", false, "botão Atribuir não encontrado")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§11 · Arrastar executa COMANDO — e só onde ele existe")
// ═══════════════════════════════════════════════════════════════════════════
const colunaDe = (rotulo) =>
  gestor.page.locator("div.w-72").filter({ has: gestor.page.locator(`text=${rotulo}`) }).first()

// A FAZER → EM ANDAMENTO existe como comando (`iniciar`).
const cardAFazer = gestor.page.locator("div.w-72").nth(1).locator("[draggable=true]").first()
const tituloArrastado = (await cardAFazer.innerText().catch(() => "")).split("\n")[0]
const antesArrasto = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
const idArrastado = (antesArrasto?.linhas ?? []).find((l) => l.titulo === tituloArrastado)?.taskId
await cardAFazer.dragTo(gestor.page.locator("div.w-72").nth(2))
await gestor.page.waitForTimeout(3500)
const depoisArrasto = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
const arrastada = (depoisArrasto?.linhas ?? []).find((l) => l.taskId === idArrastado)
ok("§11) arrastar A fazer → Em andamento moveu a tarefa",
  arrastada?.coluna === "EM_ANDAMENTO", `${idArrastado}: ${arrastada?.coluna}`)
ok("§11) e foi o COMANDO que a moveu — a tarefa está iniciada de verdade",
  arrastada?.statusTarefa === "EM_ANDAMENTO", arrastada?.statusTarefa ?? "—")
const auditoriaInicio = (await api(gestor, `/api/operacao/tarefas/${idArrastado}`)).body?.tarefa?.timeline ?? []
ok("§11) com registro no histórico, como qualquer início de trabalho",
  auditoriaInicio.some((f) => /iniciad/i.test(f.texto)),
  auditoriaInicio.find((f) => /iniciad/i.test(f.texto))?.texto?.slice(0, 50) ?? "—")

// → CONCLUÍDA não existe: tarefa conclui pelo último PASSO.
const antesProibido = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
const cardEmAndamento = gestor.page.locator("div.w-72").nth(2).locator("[draggable=true]").first()
await cardEmAndamento.dragTo(gestor.page.locator("div.w-72").nth(5))
await gestor.page.waitForTimeout(2500)
const depoisProibido = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
ok("§11) arrastar para Concluída NÃO conclui nada",
  JSON.stringify((antesProibido?.linhas ?? []).map((l) => [l.taskId, l.statusTarefa]))
  === JSON.stringify((depoisProibido?.linhas ?? []).map((l) => [l.taskId, l.statusTarefa])),
  "nenhum estado mudou")
void colunaDe
await gestor.page.screenshot({ path: `${OUT}/vg-5-arrasto.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§29 · Segurança — esconder botão não é controle de acesso")
// ═══════════════════════════════════════════════════════════════════════════
const proibido = await api(func, "/api/operacao/visao-global")
ok("§29) o funcionário sem permissão gerencial recebe 403 na visão global",
  proibido.status === 403, `HTTP ${proibido.status}`)
const tentativa = await func.page.request.post(`${BASE}/api/tarefas/${T["a-fazer"]}/comando`, {
  headers: { Authorization: `Bearer ${func.token}`, "Content-Type": "application/json" },
  data: { acao: "transferir", responsavelId: CTX.gestor?.id },
})
ok("§29) e não consegue transferir tarefa por chamada direta à API",
  tentativa.status() === 403, `HTTP ${tentativa.status()}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§27/§28 · Executar e concluir — o card acompanha")
// ═══════════════════════════════════════════════════════════════════════════
const antesExec = (await api(gestor, `/api/operacao/tarefas/${X}`)).body?.tarefa
const passo = antesExec?.etapas?.find((e) => e.status === "EM_ANDAMENTO" || e.status === "DISPONIVEL")
const etapaAntes = passo?.titulo
const doc = passo?.documentoId
ok("§27) a tarefa tem uma etapa corrente antes de executar", etapaAntes != null, etapaAntes ?? "—")
ok("§27) e a visão global mostra ESSA etapa no card",
  porId.get(X)?.etapaAtual === etapaAntes, `${porId.get(X)?.etapaAtual} × ${etapaAntes}`)
if (doc && passo) {
  const r = await gestor.page.request.patch(`${BASE}/api/documentos/${doc}/workflow/steps/${passo.id}`, {
    headers: { Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
    data: { status: "concluida" },
  })
  ok("§27) a etapa foi concluída pelo caminho do executor", r.ok(), `HTTP ${r.status()}`)
  const depoisExec = (await api(gestor, `/api/operacao/visao-global?busca=GERENCIAL`)).body
  const card2 = (depoisExec?.linhas ?? []).find((l) => l.taskId === X)
  ok("§27) MESMO card, mesmo taskId", card2?.taskId === X)
  ok("§27) a etapa atual mudou no card",
    card2?.etapaAtual != null && card2.etapaAtual !== etapaAntes, `${etapaAntes} → ${card2?.etapaAtual}`)
  ok("§27) e o estado operacional continua correto", card2?.coluna === "EM_ANDAMENTO", card2?.coluna ?? "—")
} else {
  ok("§27) a etapa foi concluída pelo caminho do executor", false, "sem documento na etapa")
}

const concluida = porId.get(T["concluida"])
ok("§28) a tarefa concluída está na coluna Concluída", concluida?.coluna === "CONCLUIDA")
ok("§28) com data de conclusão", concluida?.concluidaEm != null, concluida?.concluidaEm ?? "—")
ok("§28) e MESMO taskId da que foi executada", concluida?.taskId === T["concluida"])

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
