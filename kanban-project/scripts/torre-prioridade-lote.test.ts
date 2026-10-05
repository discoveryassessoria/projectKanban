// scripts/torre-prioridade-lote.test.ts — prioridade em massa: todos os níveis do modelo + voltar ao normal (sem banco).
import { readFileSync } from "node:fs"
import { PRIORIDADES_DO_LOTE, PRIORIDADE_NORMAL, prioridadeValida, separarPrioridadeDoLote, textoDoLotePrioridade, rotuloDaPrioridade } from "../lib/operacional/torre-prioridade-lote"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }

const schema = readFileSync("prisma/schema.prisma", "utf8")
const enumModelo = [...schema.match(/enum PrioridadeTarefa \{([^}]*)\}/)![1].matchAll(/\b([A-Z]+)\b/g)].map((m) => m[1]).sort()
ok("a escolha tem exatamente os níveis do modelo (sem inventar nem esquecer)", JSON.stringify(PRIORIDADES_DO_LOTE.map((p) => p.valor).sort()) === JSON.stringify(enumModelo), enumModelo.join(","))
ok("normal = MEDIA e aparece como 'Normal'", PRIORIDADE_NORMAL === "MEDIA" && rotuloDaPrioridade("MEDIA") === "Normal")
ok("valida só valores do modelo (ignora caixa)", prioridadeValida("alta") === "ALTA" && prioridadeValida("urgente") === "URGENTE" && prioridadeValida("zzz") === null && prioridadeValida(undefined) === null)
const atuais = new Map([[1, "ALTA"], [2, "MEDIA"], [3, "URGENTE"]])
const r = separarPrioridadeDoLote([1, 2, 3, 99], atuais, "MEDIA")
ok("voltar ao normal: muda ALTA e URGENTE; pula a que já é normal e a inexistente", JSON.stringify(r.aMudar) === "[1,3]" && r.puladas.length === 2 && r.puladas.some((p) => p.mensagem.includes("normal")) && r.puladas.some((p) => p.mensagem.includes("não encontrada")))
ok("rebaixar é permitido (URGENTE → BAIXA)", separarPrioridadeDoLote([3], atuais, "BAIXA").aMudar.length === 1)
ok("texto do aviso: singular/plural e 'voltou ao normal'", textoDoLotePrioridade("ALTA", 3) === "Prioridade alta em 3 tarefas" && textoDoLotePrioridade("MEDIA", 1) === "Prioridade voltou ao normal em 1 tarefa")
const rota = readFileSync("src/app/api/torre/tarefas/lote/route.ts", "utf8")
ok("a rota aceita PRIORIDADE com a permissão de editar e valida o nível", rota.includes("PRIORIDADE: 'tarefas.editar'") && rota.includes("prioridadeValida(b?.prioridade)"))
const tela = readFileSync("src/components/torre/TorreTarefas.tsx", "utf8")
ok("a barra tem a escolha de prioridade e 'Voltar ao normal'", tela.includes("Escolher prioridade") && tela.includes("Voltar ao normal") && !tela.includes(">Prioridade alta</button>"))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
