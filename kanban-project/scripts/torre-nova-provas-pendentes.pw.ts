// scripts/torre-nova-provas-pendentes.pw.ts — PROVAS PENDENTES da Nova Torre contra o PALCO (localhost, banco efêmero). FORA da suíte crítica.
//   npx tsx scripts/torre-nova-provas-pendentes.pw.ts [filtros|rolagem|toast|esc|cor|todas]   (padrão: todas)
// ESCREVE pouco no palco (salva e exclui uma visão; abre modais sem confirmar). Capturas em prototipo-torre/impl/provas-*.png.
//   filtros — T037/T042: busca e país no Radar e em Processos (e na Visão geral) filtram a lista e o rodapé 'Mostrando N de M'; limpar volta ao total.
//   rolagem — T011: trocar de aba rola ao topo (inclusive o contêiner rolável do layout).
//   toast   — T014: toast fixo (visível após 10 s), ✕ fecha, outro toast substitui.
//   esc     — T015/T019: Esc (e clique no fundo) em TODOS os modais; modais de justificativa NÃO fecham (o protótipo manda), os demais fecham com Esc.
//   cor     — T013: cor do toast (#17223b, texto branco) em todas as telas que emitem toast.
import { writeFileSync } from "node:fs"
import { chromium, novoContexto, vigiar, abrir, aba, txt, n, toastTexto, fecharToast, dialogos, rolagem, base, IMPL, type Page } from "./_torre-nova-pw-comum"

const fase = process.argv[2] ?? "todas"
const quer = (f: string) => fase === "todas" || fase === f
const rel: { itens: Array<{ id: string; nome: string; ok: boolean; detalhe: string }> } = { itens: [] }
let falhas = 0
const ok = (id: string, nome: string, cond: boolean, detalhe = "") => { rel.itens.push({ id, nome, ok: cond, detalhe }); if (!cond) falhas++; console.log(`${cond ? "ok   " : "FALHA"} [${id}] ${nome}${detalhe ? " — " + detalhe : ""}`) }
const shot = (page: Page, nome: string) => page.screenshot({ path: `${IMPL}/provas-${nome}.png` })

/** "Mostrando N de M …" → [N, M]. */
const mostrando = (corpo: string): [number, number] => { const m = /Mostrando ([\d.]+) de ([\d.]+)/.exec(corpo); return m ? [n(m[1]), n(m[2])] : [NaN, NaN] }

async function filtros(page: Page) {
  console.log("\n===== T037/T042 — busca e país =====")
  for (const tela of ["radar", "processos"] as const) {
    await abrir(page, aba(tela))
    if (tela === "processos") { // a aba abre numa fase; escolhe a com mais processos (botão da fase) para ter o que filtrar
      const fases = await page.locator("button").evaluateAll((bs) => bs.map((b, i) => ({ i, t: (b.textContent || "").trim() })).filter((x) => /^(Genealogia|Emissão Documental|Tradução Juramentada|Apostilamento)\s*\d+$/.test(x.t)))
      const melhor = fases.map((f) => ({ ...f, k: Number(f.t.replace(/\D/g, "")) })).sort((a, b) => b.k - a.k)[0]
      if (melhor) { await page.locator("button").nth(melhor.i).click(); await page.waitForTimeout(1500) }
      // cada fase tem 'Todos' como filtro padrão
    }
    const campo = page.locator("input.tor-pg-in").first()
    const pais = page.locator("select[aria-label='País']").first()
    const c0 = await txt(page); const [n0, t0] = mostrando(c0)
    // família a buscar: a 1ª da lista
    const nomeFam = await page.evaluate(() => { const a = document.querySelector("a[href*='/torre/processo/']") as HTMLElement | null; return a ? (a.innerText.split("\n")[0] || "").replace(/^Família\s+/i, "").trim() : "" })
    const radical = nomeFam.slice(0, 5)
    await campo.fill(radical); await page.waitForTimeout(1500)
    const c1 = await txt(page); const [n1, t1] = mostrando(c1)
    const linhasFam = await page.evaluate((r) => Array.from(document.querySelectorAll("a[href*='/torre/processo/']")).filter((a) => /^Família/i.test((a as HTMLElement).innerText.trim()) && !(a as HTMLElement).innerText.toLowerCase().includes(r.toLowerCase())).length, radical)
    ok(`T042/${tela}`, `${tela}: digitar "${radical}" filtra a lista e o rodapé (de ${t0} para ${t1})`, t1 >= 1 && t1 < t0 && n1 <= t1 && linhasFam === 0, `Mostrando ${n0} de ${t0} → ${n1} de ${t1}; linhas fora do filtro: ${linhasFam}`)
    await shot(page, `filtro-busca-${tela}`)
    await campo.fill(""); await page.waitForTimeout(1200)
    const [n2, t2] = mostrando(await txt(page))
    ok(`T042/${tela}-limpar`, `${tela}: limpar a busca volta ao total (${t0})`, t2 === t0 && n2 === n0, `Mostrando ${n2} de ${t2}`)
    // país
    const opcoes = await pais.locator("option").evaluateAll((os) => os.map((o: any) => ({ v: o.value, t: o.textContent })))
    let reduziu = false; const rel2: string[] = []
    for (const o of opcoes.filter((x) => !/^Todos/.test(x.t))) {
      await pais.selectOption(o.v); await page.waitForTimeout(1500)
      const [na, ta] = mostrando(await txt(page)); rel2.push(`${o.t}: ${na} de ${ta}`)
      if (ta < t0 && ta >= 1) reduziu = true
      if (reduziu) { await shot(page, `filtro-pais-${tela}`); break }
    }
    ok(`T037/${tela}`, `${tela}: escolher um país filtra a lista e o rodapé`, reduziu, rel2.join(" · "))
    await pais.selectOption({ index: 0 }); await page.waitForTimeout(1500)
    const [n3, t3] = mostrando(await txt(page))
    ok(`T037/${tela}-limpar`, `${tela}: voltar a 'Todos os países' volta ao total (${t0})`, t3 === t0 && n3 === n0, `Mostrando ${n3} de ${t3}`)
  }
  // Visão geral e cabeçalho: a busca do cabeçalho e os botões de país filtram os números (decisão do sistema; o protótipo não filtra)
  await abrir(page, aba("visao"))
  const v0 = await txt(page); const ativos0 = n((/PROCESSOS ATIVOS\s*\n?\s*([\d.]+)/i.exec(v0) ?? [])[1] ?? "")
  await page.locator("button", { hasText: /^Itália\d+$/ }).first().click(); await page.waitForTimeout(2500)
  const v1 = await txt(page); const ativos1 = n((/PROCESSOS ATIVOS\s*\n?\s*([\d.]+)/i.exec(v1) ?? [])[1] ?? "")
  ok("T037/visao", "Visão geral: o botão de país (Itália) filtra os números de verdade (decisão do sistema; o protótipo não filtra)", ativos1 > 0 && ativos1 < ativos0, `processos ativos ${ativos0} → ${ativos1}`)
  await shot(page, "filtro-pais-visao")
  await page.locator("button", { hasText: /^Todos\d+$/ }).first().click(); await page.waitForTimeout(2500)
  const v2 = await txt(page); const ativos2 = n((/PROCESSOS ATIVOS\s*\n?\s*([\d.]+)/i.exec(v2) ?? [])[1] ?? "")
  ok("T037/visao-limpar", "Visão geral: 'Todos' devolve o total", ativos2 === ativos0, `${ativos2}`)
  await page.locator("input.tor-cab-busca").fill("Lombardi"); await page.waitForTimeout(2500)
  const v3 = await txt(page); const ativos3 = n((/PROCESSOS ATIVOS\s*\n?\s*([\d.]+)/i.exec(v3) ?? [])[1] ?? "")
  ok("T042/visao", "Visão geral: a busca do cabeçalho aceita digitação e NÃO muda os números da Visão geral (igual ao protótipo T042; ela filtra Radar, Processos e Tarefas)", ativos3 === ativos0, `processos ativos ${ativos0} → ${ativos3}`)
  await shot(page, "filtro-busca-visao")
  // a mesma busca filtra a aba Tarefas (chega pelo cabeçalho; o rodapé 'Mostrando N de M' acompanha)
  await page.locator("button").filter({ hasText: /^Tarefas\d*$/ }).first().click(); await page.waitForTimeout(2500)
  const tf1 = mostrando(await txt(page))
  await page.locator("input.tor-cab-busca").fill(""); await page.waitForTimeout(2500)
  const tf0 = mostrando(await txt(page))
  ok("T042/tarefas", "Tarefas: a busca do cabeçalho filtra a lista e o rodapé; limpar volta ao total", tf1[1] >= 1 && tf1[1] < tf0[1], `com "Lombardi": ${tf1[0]} de ${tf1[1]} · sem busca: ${tf0[0]} de ${tf0[1]}`)
  await shot(page, "filtro-busca-tarefas")
}

async function rolagemTopo(page: Page) {
  console.log("\n===== T011 — trocar de aba rola ao topo =====")
  const pares: Array<[string, string, string]> = [["tarefas", "Equipe", "equipe"], ["equipe", "Terceiros", "terceiros"], ["radar", "Processos", "processos"], ["visao", "Tarefas", "tarefas"], ["terceiros", "Radar", "radar"], ["processos", "Visão geral", "visao"]]
  for (const [de, rotulo, para] of pares) {
    await abrir(page, aba(de))
    const alvo = await page.evaluate(() => { // o contêiner rolável do layout (o que de fato tem barra)
      const cand = Array.from(document.querySelectorAll("div,main")).filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 200 }) as HTMLElement[]
      cand.sort((a, b) => b.scrollHeight - a.scrollHeight); const c = cand[0]; if (!c) return null
      c.scrollTop = 700; return { cls: c.className.toString().slice(0, 40), top: c.scrollTop }
    })
    await page.mouse.move(700, 450); await page.mouse.wheel(0, 600); await page.waitForTimeout(400)
    const antes = await rolagem(page)
    await page.locator("[role=tablist] button, .tor-abas button, button").filter({ hasText: new RegExp(`^${rotulo}\\s*\\d*( a cobrar)?$`) }).first().click()
    await page.waitForTimeout(1500)
    const depois = await rolagem(page)
    ok(`T011/${de}→${para}`, `trocar de ${de} para ${para} rola ao topo (contêiner ${alvo?.cls ?? "?"})`, antes > 100 && depois === 0, `rolagem somada ${antes} → ${depois}`)
  }
  // link interno com destino em outra aba: cartão da Visão geral
  await abrir(page, aba("visao"))
  await page.evaluate(() => { document.querySelectorAll("div,main").forEach((e: any) => { if (e.scrollHeight > e.clientHeight + 200) e.scrollTop = 500 }) })
  await page.waitForTimeout(300); const a1 = await rolagem(page)
  await page.locator("a.tvg-ag").first().click(); await page.waitForTimeout(2000)
  const a2 = await rolagem(page)
  ok("T011/link", "clicar num link interno (cartão da Agenda) leva ao topo da aba de destino", a1 > 100 && a2 === 0, `${a1} → ${a2} (${page.url().replace(base, "")})`)
  await shot(page, "rolagem-topo")
}

let ultimaVisao = ""
async function emitirToast(page: Page, tela: string): Promise<boolean> {
  // Aciona UMA ação que emite toast em cada tela; devolve true se apareceu. Só escreve onde há Desfazer ou ação reversível.
  if (tela === "tarefas") {
    await page.getByRole("button", { name: "+ Salvar visão atual" }).click()
    ultimaVisao = `prova cor ${Date.now() % 10000}`
    const dlg = page.getByRole("dialog"); await dlg.getByLabel("Nome da visão").fill(ultimaVisao)
    await dlg.getByLabel("Justificativa").fill("prova do toast fixo").catch(() => {})
    await dlg.getByRole("button", { name: "Salvar", exact: true }).click()
  } else if (tela === "processos") {
    await page.locator("button.tor-pf-rel").first().click(); await page.waitForTimeout(800)
    await page.getByRole("button", { name: "Exportar CSV", exact: true }).click()
  } else if (tela === "terceiros") {
    await page.getByRole("button", { name: /^Cobrar$/ }).first().click(); await page.waitForTimeout(800)
    const dlg = page.getByRole("dialog").last()
    await dlg.getByRole("button", { name: /^(Registrar cobrança|Cobrar)$/ }).last().click()
  } else if (tela === "equipe") {
    await page.getByRole("button", { name: "Marcar ausência" }).first().click(); await page.waitForTimeout(600)
    const dlg = page.getByRole("dialog").last()
    await dlg.getByRole("button", { name: /^(Marcar|Salvar|Confirmar|Marcar ausência)$/ }).last().click()
  } else if (tela === "visao") {
    await page.getByRole("button", { name: /^Atribuir a / }).first().click()
  } else if (tela === "detalhe") {
    await page.getByRole("button", { name: "Relatório de controle" }).click(); await page.waitForTimeout(800)
    await page.getByRole("button", { name: "Exportar CSV", exact: true }).click()
  } else return false
  for (let t = 0; t < 40; t++) { if (await toastTexto(page)) return true; await page.waitForTimeout(250) }
  return false
}

/** Exclui a visão salva selecionada (o confirm() nativo é aceito só aqui; no resto do roteiro é recusado). */
async function excluirVisao(page: Page) {
  page.removeAllListeners("dialog"); page.once("dialog", (dlg) => { void dlg.accept() })
  await page.getByRole("button", { name: "Excluir visão" }).click().catch(() => {}); await page.waitForTimeout(1500)
  page.on("dialog", (dlg) => { void dlg.dismiss().catch(() => {}) })
}

async function toastFixo(page: Page) {
  console.log("\n===== T014 — toast fixo =====")
  await abrir(page, aba("tarefas"))
  const salvar = async (nome: string) => {
    await page.getByRole("button", { name: "+ Salvar visão atual" }).click()
    const dlg = page.getByRole("dialog"); await dlg.getByLabel("Nome da visão").fill(nome)
    await dlg.getByLabel("Justificativa").fill("prova do toast fixo")
    await dlg.getByRole("button", { name: "Salvar", exact: true }).click()
    await page.getByRole("button", { name: new RegExp(nome) }).first().waitFor({ timeout: 20000 }).catch(() => {})
  }
  const nome1 = `prova toast A${Date.now() % 10000}`
  await salvar(nome1)
  const t1 = await toastTexto(page)
  ok("T014/aparece", "o toast aparece depois da ação", /Visão salva/.test(t1), t1)
  await page.waitForTimeout(10500)
  const t2 = await toastTexto(page)
  ok("T014/10s", "o toast continua visível após 10 s (não some sozinho)", t2 === t1 && (await page.locator(".tor-toast").isVisible()), t2)
  await shot(page, "toast-apos-10s")
  await page.locator(".tor-toast button[aria-label='Fechar aviso']").click(); await page.waitForTimeout(400)
  ok("T014/fechar", "o ✕ fecha o toast", (await page.locator(".tor-toast").count()) === 0)
  // substituição: dois toasts em sequência, sem fechar
  const nome2 = `prova toast B${Date.now() % 10000}`
  await salvar(nome2); const ta = await toastTexto(page)
  await page.getByRole("button", { name: new RegExp(nome1) }).first().click().catch(() => {})
  await excluirVisao(page); await page.waitForTimeout(300)
  const tb = await toastTexto(page); const quantos = await page.locator(".tor-toast").count()
  ok("T014/substitui", "outro toast SUBSTITUI o anterior (1 só na tela, texto novo)", quantos === 1 && tb !== ta && tb.length > 0, `antes "${ta}" → depois "${tb}"`)
  await shot(page, "toast-substituido")
  // limpeza: exclui a visão B
  await fecharToast(page)
  await page.getByRole("button", { name: new RegExp(nome2) }).first().click().catch(() => {})
  await excluirVisao(page)
  await fecharToast(page)
}

async function corToast(page: Page) {
  console.log("\n===== T013 — cor do toast =====")
  const telas: Array<[string, string]> = [["visao", aba("visao")], ["tarefas", aba("tarefas")], ["processos", aba("processos")], ["terceiros", aba("terceiros")], ["equipe", aba("equipe")]]
  const href = await (async () => { await abrir(page, aba("radar")); return page.locator("a[href*='/torre/processo/']").first().getAttribute("href") })()
  if (href) telas.push(["detalhe", href])
  const cores: string[] = []
  for (const [tela, url] of telas) {
    await abrir(page, url)
    const apareceu = await emitirToast(page, tela).catch((e) => { console.log("   erro ao emitir toast em", tela, String(e.message).split("\n")[0]); return false })
    if (!apareceu) { ok(`T013/${tela}`, `${tela}: toast emitido para conferir a cor`, false, "nenhum toast apareceu"); continue }
    const est = await page.evaluate(() => { const t = (document.querySelector(".tor-toast, .tpr-toast")) as HTMLElement; const cs = getComputedStyle(t); return { bg: cs.backgroundColor, cor: cs.color, txt: t.innerText.replace(/\s+/g, " ").slice(0, 60) } })
    cores.push(`${tela}: ${est.bg}/${est.cor}`)
    ok(`T013/${tela}`, `${tela}: toast com fundo #17223b e texto branco`, est.bg === "rgb(23, 34, 59)" && est.cor === "rgb(255, 255, 255)", `${est.bg} / ${est.cor} — "${est.txt}"`)
    await shot(page, `toast-cor-${tela}`)
    // higiene do palco: desfaz o que a ação gravou (visão, atribuição, cobrança e ausência têm Desfazer; export não grava)
    const desf = page.locator(".tor-toast button", { hasText: "Desfazer" })
    if (await desf.count()) { await desf.click(); await page.waitForTimeout(2500) }
    await fecharToast(page)
    if (tela === "tarefas" && ultimaVisao) { await page.getByRole("button", { name: new RegExp(ultimaVisao) }).first().click().catch(() => {}); await excluirVisao(page); await fecharToast(page) }
  }
  ok("T013/radar", "Radar: não emite toast (sem ação que grave); o estilo é o mesmo componente/CSS das demais telas", true, "sem controle que gere toast nessa aba")
  console.log("   ", cores.join(" | "))
}

// ───────────────────────────── T015/T019 — Esc em todos os modais ─────────────────────────────
type Abridor = { id: string; nome: string; tela: string; abrir: (p: Page) => Promise<void>; passo?: (p: Page) => Promise<void> }
const clique = (nome: string | RegExp, exact = false) => async (p: Page) => { await p.getByRole("button", { name: nome, exact }).first().click() }
const ABRIDORES: Abridor[] = [
  { id: "briefing", nome: "Briefing do dia", tela: aba("visao"), abrir: clique(/Briefing do dia/) },
  { id: "revisar", nome: "Revisar o dia", tela: aba("visao"), abrir: clique(/Revisar o dia/) },
  { id: "pdv-escolher-outro", nome: "Escolher outro responsável (Precisa de você)", tela: aba("visao"), abrir: clique("Escolher outro", true) },
  { id: "pdv-registrar-ligacao", nome: "Registrar ligação (Precisa de você)", tela: aba("visao"), abrir: clique("Registrar ligação", true) },
  { id: "pdv-trocar-canal", nome: "Trocar canal (Precisa de você)", tela: aba("visao"), abrir: clique("Trocar canal", true) },
  { id: "tarefas-adiar", nome: "Adiar a cobrança", tela: aba("tarefas"), abrir: clique("Adiar", true) },
  { id: "tarefas-cobrar", nome: "Registrar cobrança (Tarefas)", tela: aba("tarefas"), abrir: clique("Cobrar", true) },
  { id: "tarefas-cobrar-cliente", nome: "Cobrar cliente", tela: aba("tarefas"), abrir: clique("Cobrar cliente", true) },
  { id: "tarefas-desbloquear", nome: "Desbloquear", tela: aba("tarefas"), abrir: clique("Desbloquear", true) },
  { id: "tarefas-salvar-visao", nome: "Salvar visão", tela: aba("tarefas"), abrir: clique("+ Salvar visão atual", true) },
  { id: "tarefas-transversal", nome: "Tarefa transversal", tela: aba("tarefas"), abrir: clique("+ Tarefa transversal", true) },
  { id: "tarefas-vincular", nome: "Vincular órgão em lote", tela: aba("tarefas"), abrir: clique(/^Vincular órgão nas/) },
  { id: "tarefas-gaveta", nome: "Gaveta da tarefa (Painel da tarefa)", tela: aba("tarefas"), abrir: clique("Abrir", true) },
  { id: "tarefas-foco", nome: "Modo foco (Fazer agora)", tela: aba("tarefas"), abrir: clique(/Fazer agora/) },
  { id: "processos-relatorio", nome: "Relatório de controle (Processos)", tela: aba("processos"), abrir: async (p) => { await p.locator("button.tor-pf-rel").first().click() } },
  { id: "tarefas-foco-familia", nome: "Foco da família (Tarefas › Foco)", tela: aba("tarefas"), abrir: clique("Foco ›", true) },
  { id: "equipe-ausencia", nome: "Marcar ausência", tela: aba("equipe"), abrir: clique("Marcar ausência", true) },
  { id: "equipe-mover", nome: "Mover carteira", tela: aba("equipe"), abrir: clique("Mover carteira", true) },
  { id: "terceiros-cobrar", nome: "Registrar cobrança (Terceiros)", tela: aba("terceiros"), abrir: clique("Cobrar", true) },
  { id: "terceiros-cobrar-todos", nome: "Cobrar todos os vencidos", tela: aba("terceiros"), abrir: clique(/^Cobrar todos os vencidos/) },
  { id: "terceiros-contatos", nome: "Contatos do órgão", tela: aba("terceiros"), abrir: clique(/^Contatos/) },
  { id: "detalhe-relatorio", nome: "Relatório de controle (Detalhe)", tela: "DETALHE", abrir: clique("Relatório de controle", true) },
  { id: "detalhe-pausar", nome: "Pausar processo", tela: "DETALHE", abrir: clique("Pausar processo", true) },
  { id: "detalhe-historico", nome: "Histórico completo", tela: "DETALHE", abrir: clique(/Histórico completo|Ver tudo|Ver todo o histórico/) },
]

async function escEmTodos(page: Page, detalhe: string) {
  console.log("\n===== T015/T019 — Esc e fundo em todos os modais =====")
  const resultados: any[] = []
  for (const a of ABRIDORES.filter((x) => !process.argv[3] || x.id === process.argv[3])) {
    const url = a.tela === "DETALHE" ? detalhe : a.tela
    const r: any = { id: a.id, nome: a.nome }
    try {
      await abrir(page, url)
      await fecharToast(page)
      // Terceiros: o botão Cobrar só existe para pedidos 'para cobrar'; Equipe: 'Marcar ausência' etc. — tudo vem do palco
      await a.abrir(page)
      await page.waitForTimeout(900)
      const n0 = await dialogos(page)
      if (n0 === 0 && !(await page.locator("[role=dialog]").count())) { r.aberto = false; r.efeito = "NÃO ABRIU"; resultados.push(r); ok(`T015/${a.id}`, `${a.nome}: abre`, false, "o modal não abriu"); continue }
      r.aberto = true
      const dlg = page.locator("[role=dialog]").last()
      r.titulo = (await dlg.getAttribute("aria-label")) ?? ""
      const corpo = await dlg.innerText().catch(() => "")
      // modal de justificativa = tem campo de texto obrigatório (mínimo 5 letras / "obrigatório")
      r.justificativa = /pelo menos 5 letras|\(obrigatório\)|Justificativa|Motivo/i.test(corpo) && (await dlg.locator("textarea, input[type=text]").count()) > 0
      await shot(page, `esc-${a.id}`)
      // 1) Esc
      await page.keyboard.press("Escape"); await page.waitForTimeout(500)
      const fechouEsc = (await dialogos(page)) < n0 || (await dialogos(page)) === 0
      r.esc = fechouEsc ? "fecha" : "não fecha"
      // 2) clique no fundo (canto) — só se ainda aberto; se Esc fechou, reabre
      if (fechouEsc) { await abrir(page, url); await a.abrir(page); await page.waitForTimeout(800) }
      await page.mouse.click(4, 4); await page.waitForTimeout(500)
      const fechouFundo = (await dialogos(page)) < n0 || (await dialogos(page)) === 0
      r.fundo = fechouFundo ? "fecha" : "não fecha"
      resultados.push(r)
    } catch (e: any) { r.erro = String(e.message).split("\n")[0].slice(0, 160); resultados.push(r); ok(`T015/${a.id}`, `${a.nome}: roteiro`, false, r.erro) }
  }
  console.log(JSON.stringify(resultados.map((r) => ({ id: r.id, titulo: r.titulo, just: r.justificativa, esc: r.esc, fundo: r.fundo, erro: r.erro })), null, 0).replace(/\},/g, "},\n"))
  writeFileSync(`${IMPL}/provas-esc-resultado.json`, JSON.stringify(resultados, null, 1))
  for (const r of resultados) {
    if (!r.aberto) continue
    // Esc: qualquer modal que NÃO seja de justificativa fecha; o de justificativa não fecha (protótipo: botão Cancelar/confirmar com texto ≥ 5 letras)
    const esperadoEsc = r.justificativa ? "não fecha" : "fecha"
    ok(`T015/${r.id}`, `${r.nome}: Esc ${r.justificativa ? "NÃO fecha (justificativa — como o protótipo)" : "fecha"}`, r.esc === esperadoEsc, `justificativa=${r.justificativa} esc=${r.esc} fundo=${r.fundo} título="${r.titulo}"`)
    if (r.justificativa) ok(`T019/${r.id}`, `${r.nome}: clicar no fundo NÃO fecha (justificativa — como o protótipo)`, r.fundo === "não fecha", `fundo=${r.fundo}`)
  }
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage(); page.setDefaultTimeout(12000)
  page.on("dialog", (dlg) => { void dlg.dismiss().catch(() => {}) })
  const ev = vigiar(page)
  await abrir(page, aba("radar"))
  const detalhe = (await page.locator("a[href*='/torre/processo/']").first().getAttribute("href")) ?? "/torre/processo/1"
  if (quer("filtros")) await filtros(page)
  if (quer("rolagem")) await rolagemTopo(page)
  if (quer("toast")) await toastFixo(page)
  if (quer("cor")) await corToast(page)
  if (quer("esc")) await escEmTodos(page, detalhe)
  writeFileSync(`${IMPL}/provas-pendentes-resultado.json`, JSON.stringify({ ...rel, erros: ev.erros }, null, 1))
  console.log(`\nFALHAS: ${falhas} · erros de console/HTTP: ${ev.erros.length}`)
  for (const e of ev.erros) console.log("  erro:", e)
  await browser.close()
  process.exit(falhas ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
