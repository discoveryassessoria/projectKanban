// scripts/cobranca-so-com-pedido-enviado.test.ts
// Passo 2 (08/10/2026): «cobrar» pressupõe pedido enviado ao terceiro e sem resposta. Caso real: 32 certidões de Salvarani (15) e Fogli (17) na Emissão, NÃO iniciadas,
// com o passo «Enviar requerimento» por fazer, contavam como «Cobranças a fazer» (acompanhamento vencido) — e a aba Terceiros dizia 0. PURO.
import { readFileSync } from "node:fs"
import { ehCobravelVencido } from "../lib/operacional/torre-predicados"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const agora = new Date("2026-10-08T15:00:00Z")
const L = (o: Partial<Parameters<typeof ehCobravelVencido>[0]>) => ({ acompanhamentoVencido: false, faseMacroKey: "emissao_documental", estadoOperacao: "AGUARDANDO" as const, cobrarEm: null, ...o })

console.log("\n1) A regra única")
ok("certidão NÃO solicitada (FILA) com acompanhamento vencido NÃO é cobrança", !ehCobravelVencido(L({ estadoOperacao: "FILA", acompanhamentoVencido: true }), agora))
ok("FILA com data de cobrança vencida também não (sem pedido não há o que cobrar)", !ehCobravelVencido(L({ estadoOperacao: "FILA", cobrarEm: "2026-10-01T12:00:00Z" }), agora))
ok("pedido enviado (AGUARDANDO) com acompanhamento vencido É cobrança", ehCobravelVencido(L({ acompanhamentoVencido: true }), agora))
ok("pedido enviado com data de cobrança de ontem/hoje É cobrança", ehCobravelVencido(L({ cobrarEm: "2026-10-07T12:00:00Z" }), agora) && ehCobravelVencido(L({ cobrarEm: "2026-10-08T12:00:00Z" }), agora))
ok("pedido enviado com cobrança futura NÃO é", !ehCobravelVencido(L({ cobrarEm: "2026-10-12T12:00:00Z" }), agora))
ok("Genealogia e tarefa encerrada nunca", !ehCobravelVencido(L({ faseMacroKey: "genealogia", acompanhamentoVencido: true }), agora) && !ehCobravelVencido(L({ estadoOperacao: "CONCLUIDA", acompanhamentoVencido: true }), agora))

console.log("\n2) Todas as telas leem o mesmo predicado")
const ler = (f: string) => readFileSync(f, "utf8")
ok("Terceiros (precisaCobrar) usa ehCobravelVencido", /ehCobravelVencido\(\{ \.\.\.l, acompanhamentoVencido: l\.cobravelVencida \}/.test(ler("lib/operacional/terceiros-pedidos.ts")))
ok("Tarefas: cobravelVencida vem de ehCobravelVencido", /cobravelVencida: ehCobravelVencido/.test(ler("src/services/torre-tarefas.ts")))
ok("Visão geral (cartão 'cob') usa ehCobravelVencido", /cob: \(l, agora\) => ehCobravelVencido\(l, agora\)/.test(ler("lib/operacional/torre-kpis.ts")))
ok("o vigia compara cartão × aba × Tarefas × Terceiros × botão", /compararCobrancas\(linhas, agora\)/.test(ler("lib/operacional/torre-coerencia-abas.ts")))

console.log("\n3) O motivo do risco não chama de «cobrança» o que é acompanhamento vencido")
const risco = readFileSync("lib/operacional/torre-risco.ts", "utf8")
ok("torre-risco: motivo diz «acompanhamento(s) vencido(s)»", /'acompanhamento vencido', 'acompanhamentos vencidos'/.test(risco) && !/'cobrança vencida', 'cobranças vencidas'/.test(risco))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
