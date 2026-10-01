// scripts/torre-revisao-final-textos.test.ts — REVISÃO FINAL da Nova Torre (01/10/2026): textos que a pessoa lê não mostram enum cru.
//   npx tsx scripts/torre-revisao-final-textos.test.ts   (sem banco)
// 1) o histórico da gaveta troca "estava NAO_INICIADA" pelo rótulo oficial (humanizarEstadosNoTexto), sem mexer no que está gravado;
// 2) o modal "Trocar canal" (Precisa de você / Visão geral) lista os canais pelo rótulo do cadastro oficial (CANAIS_SOLICITACAO),
//    não pelo código ("ECARTORIO", "BALCAO"); 3) a Régua de Terceiros mostra "E-mail" e não "EMAIL".
import { readFileSync } from "node:fs"
import { humanizarEstadosNoTexto, ROTULO_STATUS } from "../src/lib/home/rotulo-status-tarefa"
import { CANAIS_SOLICITACAO } from "../src/lib/process-stage/canais-solicitacao"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }

const t1 = humanizarEstadosNoTexto('Tarefa "Certidão de óbito" bloqueada (estava NAO_INICIADA). Motivo: aguardando procuração')
ok("'estava NAO_INICIADA' vira 'estava a iniciar'", t1 === 'Tarefa "Certidão de óbito" bloqueada (estava a iniciar). Motivo: aguardando procuração', t1)
const t2 = humanizarEstadosNoTexto("Status restaurado de SUPERSEDIDA (supersessão da instância de origem) para NAO_INICIADA.")
ok("SUPERSEDIDA → 'substituída' e NAO_INICIADA → 'a iniciar'", t2 === "Status restaurado de substituída (supersessão da instância de origem) para a iniciar.", t2)
ok("texto sem enum fica idêntico", humanizarEstadosNoTexto("Marco Rovatti abriu o processo") === "Marco Rovatti abriu o processo")
ok("palavra parecida dentro de outra não é trocada", humanizarEstadosNoTexto("XNAO_INICIADAX segue") === "XNAO_INICIADAX segue")
ok("todo valor do mapa oficial é coberto pela troca", Object.keys(ROTULO_STATUS).every((k) => !/[A-Z]_[A-Z]/.test(humanizarEstadosNoTexto(`estava ${k}`))))

const acoes = readFileSync("src/components/torre/acoes-do-item.tsx", "utf8")
ok("Trocar canal usa os rótulos de CANAIS_SOLICITACAO (não o código)", /CANAIS_SOLICITACAO\.map\(\(c\) => <option key=\{c\.canal\} value=\{c\.canal\}>\{c\.label\}<\/option>\)/.test(acoes) && !/const CANAIS = \[/.test(acoes))
ok("os 8 canais têm rótulo diferente do código", CANAIS_SOLICITACAO.length === 8 && CANAIS_SOLICITACAO.every((c) => c.label !== c.canal))
const regua = readFileSync("src/components/torre/TerceirosRegua.tsx", "utf8")
ok("a Régua mostra o rótulo do canal (E-mail), não EMAIL", /CANAIS_DE_CONTATO_UI\.find\(\(c\) => c\.v === o\.canal\)\?\.l/.test(regua))
const rota = readFileSync("src/app/api/torre/tarefas/[tarefaId]/gaveta/route.ts", "utf8")
ok("a rota da gaveta humaniza o texto do histórico", /texto: humanizarEstadosNoTexto\(f\.texto\)/.test(rota))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) process.exit(1)
