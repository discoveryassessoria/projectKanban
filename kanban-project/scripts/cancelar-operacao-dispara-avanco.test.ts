// scripts/cancelar-operacao-dispara-avanco.test.ts
// Achado real 30/09/2026 (processo 675 Antão): a certidão de casamento que travava Genealogia foi cancelada pelo
// "Cancelar operação"; todas as tarefas/passos da fase ficaram encerrados e o gate ficou LIBERADO (canAdvance=true,
// nenhuma pendência), mas o processo NÃO avançou — `controlarOperacaoV2("cancelar")` mudava a entrada do gate sem
// chamar o gancho de auto-avanço (só o cron horário recuperaria, até 1 h depois).
// Contrato: cancelar a operação aciona o auto-avanço (escopado à fase atual, best-effort, só no cancelar).
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const src = readFileSync("src/services/documento-operacao.ts", "utf8")
const i = src.indexOf("export async function controlarOperacaoV2")
const corpo = src.slice(i, src.indexOf("\nexport ", i + 10) > 0 ? src.indexOf("\nexport ", i + 10) : undefined)
ok("controlarOperacaoV2 chama o auto-avanço escopado à fase atual", /tentarAvancoAutomaticoSeFaseAtual\(p0\.processoId, p0\.faseMacroKey, "documento-cancelar-operacao"\)/.test(corpo))
ok("só quando a ação é 'cancelar' (invalidar/pausar/retomar não liberam pendência)", /if \(action === "cancelar"\) \{\s*try \{[\s\S]{0,400}tentarAvancoAutomaticoSeFaseAtual/.test(corpo))
ok("é best-effort: falha do avanço nunca derruba o comando (o cron horário recupera)", /catch \(e\) \{\s*console\.error\("\[documento-operacao\] auto-avanço após cancelar falhou/.test(corpo))
ok("import dinâmico (evita ciclo com o reconciliador)", /await import\("@\/src\/lib\/motor\/auto-avanco"\)/.test(corpo))
const gancho = readFileSync("src/lib/motor/auto-avanco.ts", "utf8")
ok("o gancho escopado existe e só avança se a unidade é da fase ATUAL", /export async function tentarAvancoAutomaticoSeFaseAtual/.test(gancho) && /faseAtualKey/.test(gancho))
console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
