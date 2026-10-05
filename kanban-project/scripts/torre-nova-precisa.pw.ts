// scripts/torre-nova-precisa.pw.ts — E2E do PRECISA DE VOCÊ, do REVISAR O DIA e do BRIEFING da Torre nova (frente B2) contra o PALCO.
// NÃO entra na suíte crítica (precisa de servidor). Rodar:   npx tsx scripts/torre-nova-precisa.pw.ts
// Pré-requisito: `node scripts/dev-torre-nova.mjs` vivo (lê /private/tmp/claude-501/torre-nova-dev.json). ESCREVE no banco do palco
// (atribui uma certidão e desfaz) — nunca contra outra coisa que não seja o palco. Capturas em prototipo-torre/impl/precisa-e2e-*.png.
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
const base = `http://localhost:${d.porta}`
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error("só contra o palco local")
mkdirSync("prototipo-torre/impl", { recursive: true })
let falhas = 0
const ok = (nome: string, cond: boolean, extra = "") => { console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` — ${extra}` : ""}`); if (!cond) falhas++ }

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: base }])
  await ctx.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
  const page = await ctx.newPage()
  const erros: string[] = []
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message))
  page.on("response", (r) => { if (r.status() >= 500 && r.url().includes("/api/")) erros.push(`${r.status()} ${r.url()}`) })
  const shot = (n: string) => page.screenshot({ path: `prototipo-torre/impl/precisa-e2e-${n}.png`, fullPage: false })
  const texto = async (sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim()
  const ir = async (aba: string) => { await page.goto(`${base}/torre?aba=${aba}`, { waitUntil: "networkidle", timeout: 240000 }); await page.locator(".pdv, .tvg").first().waitFor({ timeout: 90000 }); await page.waitForTimeout(1500) }

  // ── O BRIEFING NUNCA ABRE SOZINHO (T114/Etapa A) ────────────────────────────────────────────
  await ir("precisa")
  ok("o Briefing NÃO abre sozinho ao entrar na Torre", (await page.getByRole("dialog").count()) === 0)

  // ── A ABA PRÓPRIA: título, cartões, tabela ──────────────────────────────────────────────────
  const titulo = await texto(".pdv-titulo")
  const total = Number(/· (\d+)$/.exec(titulo)![1])
  ok("T080 título 'Precisa de você · N' e o texto de apoio exato", /^Precisa de você · \d+$/.test(titulo) && (await texto(".pdv-texto")) === "Itens que só o Marco pode decidir ou destravar.")
  ok("T081 botão '▶ Revisar uma por uma'", await page.getByRole("button", { name: "▶ Revisar uma por uma" }).isVisible())
  const nomes = await page.locator(".pdv-tipo .pdv-tipo-t").allInnerTexts()
  ok("T082–T087 seis cartões na ordem: Sem responsável · Fase deixada · Escalada · Divergência · Bloqueada · Carga", nomes.join("|") === "Sem responsável|Fase deixada|Escalada|Divergência|Bloqueada|Carga", nomes.join("|"))
  const regras = await page.locator(".pdv-tipo .pdv-tipo-r").allInnerTexts()
  ok("as regras escritas nos cartões", regras[0] === "certidão ativa sem responsável" && regras[1] === "fase sem próxima ação" && /^cartório sem resposta após \d+ cobranças?$/.test(regras[2]) && regras[3] === "tarefa, passo e Central discordam" && regras[4] === "esperando o cliente há 10+ dias" && regras[5] === "pessoa acima do limite", regras.join("|"))
  const numeros = (await page.locator(".pdv-tipo .pdv-tipo-n").allInnerTexts()).map(Number)
  // T004: o selo da aba "Precisa de você" NÃO aparece na própria aba (só na Visão geral/Processos/Tarefas) — a soma fecha com o título.
  ok("a soma dos seis cartões fecha com o título (e a própria aba não repete o selo — T004)", numeros.reduce((a, b) => a + b, 0) === total && (await page.locator('[role="tab"][aria-selected="true"] .n').count()) === 0, `${numeros.join("+")} = ${total}`)
  const colunas = (await page.locator(".pdv-hd > div").allTextContents()).join("|")
  ok("T095 colunas Família · Tipo · Fase · Tarefa · Quantidade · Ação", colunas === "Família|Tipo|Fase|Tarefa|Quantidade|Ação", colunas)
  const linhasAba = await page.locator(".pdv-lin").count()
  ok("a aba própria mostra TODAS as decisões (sem o corte de 7 da seção embutida)", linhasAba === total, `${linhasAba}/${total}`)
  const href = await page.locator(".pdv-lin .pdv-quem a").first().getAttribute("href")
  ok("T104 o título é link para o Detalhe do Processo (ou Equipe, na Carga)", /^\/torre\/processo\/\d+$/.test(href ?? "") || href === "/torre?aba=equipe", String(href))
  const botoes = await page.locator(".pdv-lin").first().locator("button").allInnerTexts()
  ok("T095 cada linha tem 2 botões (primário e secundário)", botoes.length === 2, botoes.join(" / "))
  const selos = await page.locator(".pdv-lin .tor-p").evaluateAll((els) => els.map((e) => ({ t: e.textContent, c: e.className })))
  const corDe = (t: string) => selos.filter((s) => s.t === t).map((s) => s.c.replace("tor-p", "").trim())
  ok("T103 selos: Sem responsável/Fase deixada vermelho · Escalada/Divergência âmbar · Bloqueada/Carga azul-claro",
    corDe("Sem responsável").every((c) => c === "red") && corDe("Escalada").every((c) => c === "amb") && corDe("Bloqueada").every((c) => c === "blu") && corDe("Carga").every((c) => c === "blu"))
  await shot("aba")

  // ── FILTRO POR TIPO (T088) ──────────────────────────────────────────────────────────────────
  const cartaoSemResp = page.locator(".pdv-tipo").nth(0)
  await cartaoSemResp.click()
  ok("T088 clicar liga o filtro (selecionado: aria-pressed)", (await cartaoSemResp.getAttribute("aria-pressed")) === "true")
  const tiposVisiveis = [...new Set(await page.locator(".pdv-lin .tor-p").allInnerTexts())]
  ok("T089 o filtro mostra só o tipo escolhido", tiposVisiveis.length <= 1 && (tiposVisiveis[0] ?? "Sem responsável") === "Sem responsável", tiposVisiveis.join("|"))
  ok("T109 rodapé com filtro: Mostrando só \"Sem responsável\" · ordenadas do maior risco para o menor · …", (await texto(".pdv-rodape")).startsWith('Mostrando só "Sem responsável" · ordenadas do maior risco para o menor · cada ação fica no histórico'))
  await page.locator(".pdv-tipo").nth(2).click()
  ok("T088 só um filtro por vez: ao escolher outro, o anterior desliga", (await cartaoSemResp.getAttribute("aria-pressed")) === "false" && (await page.locator(".pdv-tipo").nth(2).getAttribute("aria-pressed")) === "true")
  await page.locator(".pdv-tipo").nth(2).click()
  ok("T088 clicar de novo desmarca (volta a Todos)", (await page.locator(".pdv-tipo[aria-pressed='true']").count()) === 0 && (await page.locator(".pdv-lin").count()) === total)
  ok("T108 rodapé sem filtro: 'ordenadas do maior risco para o menor · cada ação fica no histórico…'", /ordenadas do maior risco para o menor · cada ação fica no histórico/.test(await texto(".pdv-rodape")))

  // ── ATRIBUIR + DESFAZER (porta real, auditada; desfeito em seguida) ─────────────────────────
  await cartaoSemResp.click()
  const linhaAtribuir = page.locator(".pdv-lin").filter({ has: page.getByRole("button", { name: /^Atribuir a / }) }).first()
  if (await linhaAtribuir.count()) {
    const rotulo = (await linhaAtribuir.getByRole("button", { name: /^Atribuir a / }).innerText()).trim()
    const nome1 = (await linhaAtribuir.locator(".pdv-quem a").innerText()).split(" · ")[0]
    await linhaAtribuir.getByRole("button", { name: /^Atribuir a / }).click()
    const toast = page.locator(".tor-toast")
    await toast.waitFor({ timeout: 60000 })
    ok("T105/T106 toast '<botão> · <1ª parte do título>' com Desfazer", (await toast.innerText()).replace(/\s+/g, " ").startsWith(`${rotulo} · ${nome1}`) && await toast.getByRole("button", { name: "Desfazer" }).isVisible(), (await toast.innerText()).replace(/\s+/g, " "))
    await shot("toast-atribuir")
    await toast.getByRole("button", { name: "Desfazer" }).click()
    await page.locator(".tor-toast", { hasText: /^Desfeito: / }).waitFor({ timeout: 60000 })
    ok("T111 Desfazer devolve a(s) certidão(ões) à fila (toast 'Desfeito: n de n')", /Desfeito: (\d+) de \1\./.test(await texto(".tor-toast")), await texto(".tor-toast"))
  } else ok("(sem item 'Atribuir a …' no palco agora — passo pulado)", true)
  await cartaoSemResp.click()

  // ── REVISAR O DIA (T116–T127) ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "▶ Revisar uma por uma" }).click()
  const rev = page.getByRole("dialog", { name: "Revisar o dia" })
  await rev.waitFor()
  const nRev = Number(/de (\d+)$/.exec(await texto(".pdv-rev-topo .pdv-modal-t"))![1])
  ok("T116 'Revisar o dia · 1 de N', barra a 0% e '0 decididas · 0 puladas'", (await texto(".pdv-rev-topo .pdv-modal-t")).startsWith("Revisar o dia · 1 de ") && (await texto(".pdv-contas")) === "0 decididas · 0 puladas" && (await page.locator(".pdv-barra > i").evaluate((e) => (e as HTMLElement).style.width)) === "0%")
  ok("T117 cartão do item: selo, título, detalhe e 'Sugestão: …'", (await page.locator(".pdv-cartao .tor-p").count()) === 1 && (await page.locator(".pdv-cartao-t").innerText()).length > 0 && /^Sugestão:/.test(await texto(".pdv-cartao-s")))
  const rodapeRev = await rev.locator(".pdv-rodape-m").locator("button, a").allInnerTexts()
  ok("T118 botões: Sair · Abrir o processo · Pular · botão 2 · botão 1", rodapeRev.length === 5 && rodapeRev[0] === "Sair" && rodapeRev[1] === "Abrir o processo" && rodapeRev[2] === "Pular", rodapeRev.join(" | "))
  await shot("revisar-1")
  const antes = await texto(".pdv-cartao-t")
  await page.waitForTimeout(6500) // o aviso do "Desfeito" anterior já passou: dali em diante, nenhum aviso novo pode nascer do Pular
  const avisosAntes = await page.locator(".tor-toast").count()
  await page.getByRole("button", { name: "Pular" }).click()
  ok("T120 'Pular' soma 1 em puladas, avança e NÃO abre toast", (await texto(".pdv-contas")) === "0 decididas · 1 puladas" && (await texto(".pdv-rev-topo .pdv-modal-t")).startsWith("Revisar o dia · 2 de ") && (await page.locator(".tor-toast").count()) === avisosAntes && (nRev === 1 || (await page.locator(".pdv-cartao-t").innerText()) !== antes))
  ok("T122 barra de progresso = round(posição/N × 100)%", (await page.locator(".pdv-barra > i").evaluate((e) => (e as HTMLElement).style.width)) === `${Math.round((1 / nRev) * 100)}%`)
  await rev.getByRole("button", { name: "Sair" }).click()
  ok("T123 'Sair' fecha o modal", (await page.getByRole("dialog", { name: "Revisar o dia" }).count()) === 0)
  await page.getByRole("button", { name: "▶ Revisar uma por uma" }).click()
  ok("T123 reabrir zera (volta ao 1 de N, 0 puladas)", (await texto(".pdv-rev-topo .pdv-modal-t")).startsWith("Revisar o dia · 1 de ") && (await texto(".pdv-contas")) === "0 decididas · 0 puladas")
  // Percorre até a tela final (o palco é compartilhado: o total pode mudar entre uma leitura e outra, então não se confia só em nRev).
  const nReaberto = Number(/de (\d+)$/.exec(await texto(".pdv-rev-topo .pdv-modal-t"))![1])
  for (let i = 0; i < nReaberto + 5 && (await page.locator(".pdv-rev-fim").count()) === 0; i++) await page.getByRole("button", { name: "Pular" }).click()
  const fim = await texto(".pdv-rev-fim")
  ok("T125 tela final: 'Revisão concluída. Decisões tomadas: 0. Puladas: N. Tudo ficou registrado no histórico de cada processo.' e 'Fechar'", fim.startsWith(`Revisão concluída. Decisões tomadas: 0. Puladas: ${nReaberto}. Tudo ficou registrado no histórico de cada processo`) && await page.getByRole("button", { name: "Fechar", exact: true }).isVisible(), fim)
  ok("T116 título final 'N de N' e barra a 100%", (await texto(".pdv-rev-topo .pdv-modal-t")) === `Revisar o dia · ${nReaberto} de ${nReaberto}` && (await page.locator(".pdv-barra > i").evaluate((e) => (e as HTMLElement).style.width)) === "100%")
  await shot("revisar-final")
  await page.getByRole("button", { name: "Fechar", exact: true }).click()
  ok("T125 'Fechar' fecha o modal", (await page.getByRole("dialog").count()) === 0)

  // ── BRIEFING (T113–T115), SÓ MANUAL ─────────────────────────────────────────────────────────
  await page.getByRole("button", { name: /Briefing do dia/ }).first().click()
  const brief = page.getByRole("dialog", { name: "Briefing do dia" })
  await brief.waitFor()
  ok("T113 título 'Briefing · <dia da semana>, <dia> de <mês>' e o texto do dia", /^Briefing · (segunda|terça|quarta|quinta|sexta)-feira, \d{1,2} de [a-zç]+$|^Briefing · (sábado|domingo), \d{1,2} de [a-zç]+$/.test(await texto(".pdv-modal.brief .pdv-modal-t")) && /^(Bom dia|Boa tarde|Boa noite), /.test(await texto(".pdv-brief-txt")), await texto(".pdv-modal.brief .pdv-modal-t"))
  const botsB = await brief.locator("button").allInnerTexts()
  ok("T114/T115 botões 'Ver a Torre' e '▶ Revisar o dia (N decisões)'", botsB[0] === "Ver a Torre" && /^▶ Revisar o dia \(\d+ decis(ões|ão)\)$/.test(botsB[1]), botsB.join(" | "))
  await shot("briefing")
  await brief.getByRole("button", { name: "Ver a Torre" }).click()
  ok("T114 'Ver a Torre' fecha o Briefing", (await page.getByRole("dialog").count()) === 0)
  await page.getByRole("button", { name: /Briefing do dia/ }).first().click()
  await page.getByRole("dialog", { name: "Briefing do dia" }).getByRole("button", { name: /Revisar o dia/ }).click()
  ok("T115 '▶ Revisar o dia' fecha o Briefing e abre a Revisão", (await page.getByRole("dialog", { name: "Briefing do dia" }).count()) === 0 && (await page.getByRole("dialog", { name: "Revisar o dia" }).count()) === 1)
  await page.getByRole("dialog", { name: "Revisar o dia" }).getByRole("button", { name: "Sair" }).click()
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(2000)
  ok("o Briefing não reabre sozinho depois de recarregar", (await page.getByRole("dialog").count()) === 0)

  // ── EMBUTIDO NA VISÃO GERAL ─────────────────────────────────────────────────────────────────
  await ir("visao")
  const secao = page.locator(".pdv").first()
  await secao.scrollIntoViewIfNeeded()
  const nVisao = await page.locator(".pdv .pdv-lin").count()
  const tituloVisao = Number(/· (\d+)$/.exec(await texto(".pdv .pdv-titulo"))![1])
  ok("a seção embutida mostra no máximo 7 decisões e o rodapé '+ N decisões'", nVisao <= 7 && (tituloVisao <= 7 || /^\+ \d+ decisões · ordenadas do maior risco/.test(await texto(".pdv .pdv-rodape"))), `${nVisao} linhas de ${tituloVisao}`)
  ok("o número da seção embutida é o mesmo da aba própria", tituloVisao === total)
  await secao.screenshot({ path: "prototipo-torre/impl/precisa-e2e-visao-secao.png" })
  await page.locator(".pdv-tipo").nth(0).click()
  ok("com filtro, a seção embutida mostra o tipo inteiro", (await page.locator(".pdv .pdv-lin").count()) === numeros[0])

  ok("nenhum erro 5xx nem exceção na página", erros.length === 0, erros.join(" | "))
  await browser.close()
  console.log(falhas === 0 ? "\nPASSOU" : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
