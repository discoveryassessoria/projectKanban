// scripts/reabrir-tarefa-fase-passada-e-sino.test.ts
//
// REABRIR UMA TAREFA DE FASE PASSADA (09/10/2026, Ageitos Brion): (1) a trilha do processo continuava «Concluída 100%» — a instância da fase segue CONCLUIDO, mas a projeção
// mede 86%; (2) a Daniela, dona da tarefa, não recebeu aviso no sino (só a tela de Operação mudou). Puro + estático: sem banco.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { fechouDeVerdade } from "../lib/operacional/fase-fechou-de-verdade"
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }

console.log("\n1) A trilha só diz «concluída» se o trabalho continua inteiro")
ok("instância fechada e 100% medido: concluída", fechouDeVerdade({ statusDaInstancia: "CONCLUIDO", progressoMedido: 100 }))
ok("instância fechada mas uma tarefa reaberta (86%): NÃO é concluída", !fechouDeVerdade({ statusDaInstancia: "CONCLUIDO", progressoMedido: 86 }))
ok("instância ainda aberta: não é concluída, mesmo com 100%", !fechouDeVerdade({ statusDaInstancia: "EM_ANDAMENTO", progressoMedido: 100 }) && !fechouDeVerdade({ statusDaInstancia: null, progressoMedido: 100 }))
const rota = ler("src/app/api/processos/[processoId]/phases/route.ts")
ok("a rota da trilha usa a função (e o 100% fixo só vale quando ela diz que fechou)", /fechouDeVerdade\(\{ statusDaInstancia: latest\?\.status, progressoMedido: progressos\[i\] \}\)/.test(rota) && /progress: state === "COMPLETED" \? 100 : progressos\[i\]/.test(rota))

console.log("\n2) Reabrir avisa o dono da tarefa no sino")
const reab = ler("src/services/reabertura-de-execucao.ts")
ok("a reabertura chama o aviso «chegou trabalho» do sino, na mesma transação", /avisarChegouTrabalho\(tx,/.test(reab) && /import \{ avisarChegouTrabalho \} from "@\/lib\/operacional\/avisos-fatos"/.test(reab))
ok("só avisa o dono quando ele não é quem reabriu", /responsavelId !== p\.actorId/.test(reab) && /responsavelId != null/.test(reab))
ok("avisa a tarefa DA UNIDADE reaberta (não as outras certidões)", /tarefaDaUnidade\.id/.test(reab))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)
