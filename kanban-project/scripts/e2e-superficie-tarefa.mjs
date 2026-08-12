// scripts/e2e-superficie-tarefa.mjs
// ============================================================================
// A SUPERFÍCIE OPERACIONAL DA TAREFA — anexos, protocolo, observações, história.
//
//   node scripts/e2e-superficie-tarefa.mjs <base> <saida> <token> <taskId>
//
// Nada disto é guardado pela Tarefa: anexo é `DocumentoArquivo`, protocolo é
// `Protocolo`, observação é `DocumentoObservacao`, e a história é a leitura
// conjunta desses três com a auditoria e os eventos do workflow.
//
// O teste prova a PROJEÇÃO: o que o operador produziu executando a etapa
// aparece na tarefa, sem cópia e sem segunda fonte — e a execução especializada
// continua funcionando com tudo isso na tela.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [BASE, OUT, TOK, TASK_ID] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const token = readFileSync(TOK, "utf8").trim()
const user = readFileSync(TOK + ".user", "utf8").trim()

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

function pdf(nome) {
  const p = join(OUT, nome)
  writeFileSync(p, Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "utf8"))
  return p
}

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } })
const page = await ctx.newPage()
await page.route(/r2\.cloudflarestorage\.com/, (r) => r.fulfill({ status: 200, body: "" }))
await page.addInitScript(([t, u]) => {
  localStorage.setItem("authToken", t); localStorage.setItem("user", u)
}, [token, user])

const estado = async () => {
  const r = await page.request.get(`${BASE}/api/operacao/tarefas/${TASK_ID}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await r.json()).tarefa
}

async function abrirTarefa() {
  await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(3000)
  const aba = page.getByRole("button", { name: /^Minha fila$/ }).first()
  if (await aba.count()) { await aba.click(); await page.waitForTimeout(2200) }
  await page.locator("button.cursor-pointer").filter({ hasText: "Inteiro Teor" }).first().click()
  await page.waitForTimeout(2800)
}

console.log("E2E — SUPERFÍCIE OPERACIONAL DA TAREFA\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("Antes de operar: a tarefa não inventa conteúdo")
// ═══════════════════════════════════════════════════════════════════════════
await abrirTarefa()
const antes = await estado()
ok("a tarefa abriu pela fila", antes?.taskId === Number(TASK_ID), `taskId ${antes?.taskId}`)
ok("§5) o Workflow Interno segue no centro", (antes?.etapas?.length ?? 0) === 5, `${antes?.etapas?.length} etapas`)
ok("sem anexo antes de anexar", (antes?.anexos?.length ?? 0) === 0)
ok("sem protocolo antes de protocolar", (antes?.protocolos?.length ?? 0) === 0)
const painelAntes = await page.locator("aside").last().innerText()
ok("a seção de observações existe", /OBSERVA/i.test(painelAntes))
ok("e a história já mostra o que aconteceu com a tarefa", /HISTÓRICO/i.test(painelAntes))

// ═══════════════════════════════════════════════════════════════════════════
secao("§3 · Observação: append-only, com autor e hora")
// ═══════════════════════════════════════════════════════════════════════════
const iniciar = page.getByRole("button", { name: /^Iniciar tarefa$/ })
if (await iniciar.count()) { await iniciar.click(); await page.waitForTimeout(2500) }

await page.locator('input[placeholder="Anotar algo sobre este trabalho…"]').fill("Cliente pediu prioridade — cartório fecha às 16h.")
await page.getByRole("button", { name: /^Anotar$/ }).click()
await page.waitForTimeout(3000)
const com1 = await estado()
ok("§3) a observação foi registrada", com1.observacoes.length === 1, `${com1.observacoes.length}`)
ok("§3) com autor", !!com1.observacoes[0]?.autor, com1.observacoes[0]?.autor ?? "—")
ok("§3) e data/hora", !!com1.observacoes[0]?.em)

await page.locator('input[placeholder="Anotar algo sobre este trabalho…"]').fill("Segunda anotação — confirmar taxa antes de enviar.")
await page.getByRole("button", { name: /^Anotar$/ }).click()
await page.waitForTimeout(3000)
const com2 = await estado()
ok("§3) a segunda NÃO sobrescreveu a primeira", com2.observacoes.length === 2, `${com2.observacoes.length}`)
ok("§3) a anterior continua íntegra",
  com2.observacoes.some((o) => o.texto.includes("cartório fecha às 16h")))
await page.screenshot({ path: `${OUT}/sup-1-observacoes.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§1/§2 · Executar a etapa produz anexo e protocolo — e eles aparecem aqui")
// ═══════════════════════════════════════════════════════════════════════════
await page.getByRole("button", { name: /^(Abrir etapa|Continuar etapa)$/ }).first().click()
await page.waitForTimeout(3500)
// CRC NACIONAL: canal eletrônico que devolve número de protocolo — é o que
// permite provar que o protocolo registrado na ETAPA aparece na TAREFA. O
// canal recomendado (e-mail) não exige protocolo, e o campo nem é renderizado:
// comportamento correto do modal, que ajusta as exigências ao canal.
await page.locator("button").filter({ hasText: "CRC Nacional" }).first().click()
await page.waitForTimeout(1500)
const inputs = page.locator('input[type="file"]')
if (await inputs.count()) { await inputs.first().setInputFiles(pdf("requerimento.pdf")); await page.waitForTimeout(3500) }
await page.locator('input[placeholder="ex: 2º Registro Civil de São Paulo"]').fill("1º Ofício de Registro Civil")
await page.locator('input[placeholder="ex: João Silva"]').fill("Sr. Almeida")
// O NÚMERO DO PROTOCOLO é opcional no canal E-mail — o cartório pode não
// devolver um. Informá-lo aqui é o que faz o serviço criar o `Protocolo` e
// ligá-lo ao documento, e é isso que a Tarefa precisa projetar.
await page.locator('input[placeholder="Número retornado pelo canal"]').fill("PROT-2026-8891")
await page.waitForTimeout(800)
await page.locator("button").filter({ hasText: "Confirmar envio" }).first().click()
await page.waitForTimeout(6000)

await abrirTarefa()
const depois = await estado()
ok("a etapa concluiu", depois.etapas[0].status === "CONCLUIDO", depois.etapas[0].status)
ok("§4) MESMO taskId", depois.taskId === Number(TASK_ID))
ok("§1) o anexo do executor aparece na Tarefa", depois.anexos.length >= 1, `${depois.anexos.length} anexo(s)`)
// O arquivo é identificado pelo PAPEL que cumpre: a classificação do cadastro
// mestre quando ela resolve, e a finalidade operacional quando não — nunca
// apenas o nome do arquivo, que é o que o usuário digitou no computador dele.
ok("§1) o anexo é identificado pelo papel, não pelo nome do arquivo",
  !!(depois.anexos[0]?.classificacao || depois.anexos[0]?.finalidade),
  depois.anexos[0]?.classificacao ?? depois.anexos[0]?.finalidade ?? "—")
ok("§1) e sem duplicar — um arquivo, uma linha",
  new Set(depois.anexos.map((a) => a.url)).size === depois.anexos.length)
ok("§3) as observações sobreviveram à execução", depois.observacoes.length === 2)

const painel = await page.locator("aside").last().innerText()
ok("§1) a tela mostra os anexos", /ANEXOS · \d/.test(painel))
ok("§2) o protocolo registrado na etapa aparece na Tarefa",
  depois.protocolos.some((p) => p.numero === "PROT-2026-8891"),
  depois.protocolos.map((p) => p.numero).join(", ") || "nenhum")
ok("§2) sem duplicar — um número, uma linha",
  depois.protocolos.filter((p) => p.numero === "PROT-2026-8891").length === 1)
ok("§2) e a tela o mostra", /PROT-2026-8891/.test(painel))
await page.screenshot({ path: `${OUT}/sup-2-anexos-protocolo.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§4 · A história é projeção — e conta o trabalho inteiro")
// ═══════════════════════════════════════════════════════════════════════════
const tl = depois.timeline ?? []
ok("§4) a timeline existe", tl.length > 0, `${tl.length} fatos`)
ok("§4) em ordem decrescente", tl.every((f, i) => i === 0 || Date.parse(tl[i - 1].em) >= Date.parse(f.em)))
for (const [rotulo, teste] of [
  ["a criação da tarefa", (f) => /criada/i.test(f.texto)],
  ["a atribuição", (f) => /atribu/i.test(f.texto)],
  ["o início do trabalho", (f) => /iniciad/i.test(f.texto)],
  ["a conclusão da etapa", (f) => /Etapa concluída/i.test(f.texto)],
  ["a liberação da seguinte", (f) => /Etapa liberada|Etapa iniciada/i.test(f.texto)],
  ["o anexo", (f) => f.tipo === "anexo"],
  ["o protocolo", (f) => f.tipo === "protocolo"],
  ["as observações", (f) => f.tipo === "observacao"],
]) {
  ok(`§4) registra ${rotulo}`, tl.some(teste), tl.find(teste)?.texto?.slice(0, 60) ?? "não encontrado")
}
ok("§4) a etapa aparece pelo NOME publicado, não pela chave técnica",
  tl.some((f) => /Solicitar certidão/.test(f.texto)),
  tl.find((f) => f.tipo === "etapa")?.texto ?? "—")
ok("§4) e nenhum evento técnico cru vazou para a tela",
  !tl.some((f) => /^PASSO_|^TAREFA_[A-Z]/.test(f.texto)))
await page.screenshot({ path: `${OUT}/sup-3-timeline.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("§5 · A execução especializada continua funcionando")
// ═══════════════════════════════════════════════════════════════════════════
const abriu = page.getByRole("button", { name: /^(Abrir etapa|Continuar etapa)$/ }).first()
ok("§5) a etapa corrente segue executável", await abriu.count() > 0)
await abriu.click()
await page.waitForTimeout(3500)
const modal = await page.locator("body").innerText()
ok("§5) e abre o executor especializado, não um botão genérico",
  /retorno|protocolo|rastrei/i.test(modal))
ok("§5) com a tarefa ainda aberta", !["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(depois.statusTarefa), depois.statusTarefa)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
