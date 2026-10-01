// scripts/tarefa-texto-prazo.test.ts
// ============================================================================
// COLUNA PRAZO = SEMPRE O PRAZO DA TAREFA, UMA VEZ SÓ (Seção 3.17, 30/09/2026). Puro (sem banco).
//
//   npx tsx scripts/tarefa-texto-prazo.test.ts
//
// O defeito: "Iniciar até 10/10 · 10/10/2026" (o rótulo já trazia a data e a tabela acrescentava a data por extenso), e a mesma
// tarefa ora "Sem prazo", ora "Iniciar até …" conforme a tabela. Agora UMA função (src/lib/tarefa/texto-prazo.ts) é usada por
// TODA coluna de prazo da tarefa (Torre › Tarefas e as tabelas da Operação); o prazo do passo só aparece no painel da tarefa.
// ============================================================================
import { readFileSync } from "node:fs"
import { textoPrazoDaTarefa, diaMesDoPrazo } from "../src/lib/tarefa/texto-prazo"
import { estadoTemporal } from "../lib/operacional/tempo-operacional"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")

const AGORA = new Date("2026-10-05T15:00:00.000Z") // segunda 05/10/2026, 12:00 em SP
/** A linha como a projeção a entrega: dataPrazo + o rótulo da régua canônica (`estadoTemporal`). */
const daRegua = (dataPrazo: string | null, statusTarefa: string) => ({
  dataPrazo,
  rotuloDoPrazo: estadoTemporal({ dataPrazo, statusTarefa, agora: AGORA }).rotulo,
})
const datas = (t: string) => t.match(/\d{2}\/\d{2}(\/\d{4})?/g) ?? []

secao("O texto (rótulo da régua canônica + a função única)")
{
  const semPrazo = textoPrazoDaTarefa(daRegua(null, "NAO_INICIADA"))
  ok("sem prazo → 'Sem prazo'", semPrazo === "Sem prazo", semPrazo)
  const iniciar = textoPrazoDaTarefa(daRegua("2026-10-10T12:00:00.000Z", "NAO_INICIADA"))
  ok("a iniciar: 'Iniciar até 10/10' — a data UMA vez, sem ano (o defeito era 'Iniciar até 10/10 · 10/10/2026')", iniciar === "Iniciar até 10/10" && datas(iniciar).length === 1 && !/2026/.test(iniciar), iniciar)
  const hoje = textoPrazoDaTarefa(daRegua("2026-10-05T12:00:00.000Z", "EM_ANDAMENTO"))
  ok("vence hoje (em andamento) → 'Vence hoje · 05/10'", hoje === "Vence hoje · 05/10", hoje)
  const amanha = textoPrazoDaTarefa(daRegua("2026-10-06T12:00:00.000Z", "EM_ANDAMENTO"))
  ok("vence amanhã → 'Vence amanhã · 06/10'", amanha === "Vence amanhã · 06/10", amanha)
  const atrasada = textoPrazoDaTarefa(daRegua("2026-10-03T12:00:00.000Z", "EM_ANDAMENTO"))
  ok("atrasada → 'Atrasada há 2 dias · 03/10'", atrasada === "Atrasada há 2 dias · 03/10", atrasada)
  const futura = textoPrazoDaTarefa(daRegua("2026-10-10T12:00:00.000Z", "EM_ANDAMENTO"))
  ok("futura → 'Vence em 5 dias · 10/10'", futura === "Vence em 5 dias · 10/10", futura)
  const naoIniciadaAtrasada = textoPrazoDaTarefa(daRegua("2026-10-02T12:00:00.000Z", "NAO_INICIADA"))
  ok("a iniciar e já vencida → 'Deveria ter iniciado há 3 dias · 02/10'", naoIniciadaAtrasada === "Deveria ter iniciado há 3 dias · 02/10", naoIniciadaAtrasada)
  const aguardando = textoPrazoDaTarefa(daRegua("2026-10-10T12:00:00.000Z", "AGUARDANDO_TERCEIRO"))
  ok("aguardando terceiro: o prazo NÃO pausa e o texto é o mesmo de uma tarefa comum", aguardando === futura, aguardando)
  ok("nenhuma saída repete a data nem traz o ano", [semPrazo, iniciar, hoje, amanha, atrasada, futura, naoIniciadaAtrasada, aguardando].every((t) => datas(t).length <= 1 && !/\/\d{4}/.test(t)))
  const sp = textoPrazoDaTarefa(daRegua("2026-10-11T02:00:00.000Z", "NAO_INICIADA"))
  ok("a data é a de SÃO PAULO, não a do navegador/UTC (11/10 02:00Z = 10/10 23:00 em SP)", sp === "Iniciar até 10/10" && diaMesDoPrazo("2026-10-11T02:00:00.000Z") === "10/10", sp)
}

secao("Tarefas iguais → texto igual (uma regra, não uma por tabela)")
{
  const a = daRegua("2026-10-10T12:00:00.000Z", "NAO_INICIADA"), b = daRegua("2026-10-10T18:00:00.000Z", "NAO_INICIADA")
  ok("mesma data e mesmo status → o mesmo texto, em qualquer tabela", textoPrazoDaTarefa(a) === textoPrazoDaTarefa(b) && textoPrazoDaTarefa(a) === "Iniciar até 10/10")
  ok("sem prazo nunca vira data; com prazo nunca vira 'Sem prazo'", textoPrazoDaTarefa(daRegua(null, "EM_ANDAMENTO")) === "Sem prazo" && textoPrazoDaTarefa(a) !== "Sem prazo")
  ok("entrada sem rótulo mostra só a data; sem data e sem rótulo, 'Sem prazo'", textoPrazoDaTarefa({ dataPrazo: "2026-10-10T12:00:00.000Z", rotuloDoPrazo: "" }) === "10/10" && textoPrazoDaTarefa({ dataPrazo: null, rotuloDoPrazo: "" }) === "Sem prazo")
  ok("data inválida não quebra: cai no rótulo", textoPrazoDaTarefa({ dataPrazo: "lixo", rotuloDoPrazo: "Vence em 5 dias" }) === "Vence em 5 dias")
}

secao("O prazo do PASSO nunca entra na coluna")
{
  const tarefa = daRegua("2026-10-10T12:00:00.000Z", "EM_ANDAMENTO")
  // Uma linha cheia de datas de passo/acompanhamento/regra temporal: a função não as lê (a assinatura só tem dataPrazo e rotuloDoPrazo).
  const comPasso = { ...tarefa, acompanhamentoPasso: { dueAt: "2026-10-07T12:00:00.000Z", semPrazo: false }, regraTemporalPasso: { dueAt: "2026-10-08T12:00:00.000Z", semPrazo: false }, proximoAcontecimento: { tipo: "x", data: "2026-10-09T12:00:00.000Z", descricao: "" } }
  ok("com acompanhamento, regra temporal e próximo acontecimento na linha, o texto é o mesmo da tarefa", textoPrazoDaTarefa(comPasso) === textoPrazoDaTarefa(tarefa) && !/07\/10|08\/10|09\/10/.test(textoPrazoDaTarefa(comPasso)))
  const src = ler("src/lib/tarefa/texto-prazo.ts")
  ok("estático: o módulo é puro e só conhece dataPrazo/rotuloDoPrazo (sem passo, sem acompanhamento, sem Prisma)", !/regraTemporalPasso|acompanhamentoPasso|proximoAcontecimento|prisma|@prisma/i.test(src.replace(/\/\/.*$/gm, "")) && /export function textoPrazoDaTarefa\(l: PrazoDaTarefa\)/.test(src))
}

secao("Estático — toda tabela usa a função, nenhuma repete a data")
{
  const tt = ler("src/components/torre/TarefasTabela.tsx"), gaveta = ler("src/components/torre/TarefasGaveta.tsx"), tf = ler("src/components/operacao/tabela-familia.tsx"), ab = ler("src/components/operacao/operacao-v3-abas.tsx"), v3 = ler("src/components/operacao/operacao-v3.tsx"), painel = ler("src/components/torre/PainelTorreTarefa.tsx")
  const semComentario = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "")
  for (const [nome, src] of [["Torre › Tarefas", tt], ["Operação › tabela-familia", tf], ["Operação › abas", ab], ["Operação › tabela principal", v3], ["painel da tarefa", painel], ["gaveta da tarefa", gaveta]] as const) {
    ok(`${nome}: importa e usa textoPrazoDaTarefa`, /texto-prazo/.test(src) && /textoPrazoDaTarefa\(/.test(src))
    ok(`${nome}: nenhum rótulo de prazo é desenhado cru (sempre pela função)`, !/\{[a-z]+\.rotuloDoPrazo(\s*\|\|\s*"—")?\}/.test(semComentario(src)))
  }
  ok("Operação › tabela-familia: a coluna Prazo é UMA linha — sem a data por extenso (dataCurta) embaixo do rótulo", !/dataPrazo && <div[^>]*>\{dataCurta\(l\.dataPrazo\)\}/.test(tf) && /\{textoPrazoDaTarefa\(l\)\}/.test(tf))
  ok("Torre › Tarefas: a coluna Prazo (ao lado de Iniciou e Risco) é o prazo da TAREFA, uma vez só", /<div>Iniciou<\/div><div>Prazo<\/div><div>Risco<\/div>/.test(tt) && /textoPrazoDaTarefa\(l\) \|\| "—"/.test(tt) && !/acompTxtCompleto/.test(tt))
  const celulaPrazo = tt.split("\n").find((l) => /textoPrazoDaTarefa\(l\)/.test(l)) ?? ""
  ok("Torre › Tarefas: a célula do Prazo não lê nada do passo", !/regraTemporalPasso|acompanhamentoPasso|passoCorrente|passoAtual|etapaAtual/.test(celulaPrazo))
  ok("o prazo/regra do passo mora só no painel da tarefa (drawer)", /Espera do passo/.test(painel) && /regraTemporalPasso/.test(painel) && !/regraTemporalPasso/.test(tt))
  ok("o painel mostra o prazo da TAREFA pela mesma função", /Prazo da tarefa<\/b>\{textoPrazoDaTarefa\(linha\)/.test(painel))
}

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
