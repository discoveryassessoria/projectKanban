/**
 * GUARDA — progresso/conclusão da fase documental vem da CONCLUSÃO REAL do Workflow
 * Interno (última etapa obrigatória concluída), não do status mestre do documento.
 * Rodar: tsx scripts/emissao-progresso-workflow-guard.test.ts
 *
 * BUG: matrix da Central usava STATUS_VALIDADOS = ["RECEBIDO",...] → documento RECEBIDO
 * contava como validado → falso 100% / "4 de 4 validados" / "fase concluída", enquanto
 * cards (faseProgress) e cabeçalho mostravam o correto. Fontes divergentes.
 * FIX: matrix e "próxima ação" derivam dos passos persistidos do Workflow Interno da
 * fase atual (mesma fonte do faseProgress). Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const route = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")

console.log("\n1) Conclusão da fase = última etapa do Workflow Interno concluída (não status)")
ok(/const docConcluiuFase = \(docId: number\): boolean =>/.test(route), "helper docConcluiuFase (fonte oficial)")
ok(/const ultima = steps\.reduce\(\(a, b\) => \(b\.ordem > a\.ordem \? b : a\)\)[\s\S]*?stepConcluidoRe\(ultima\.status\)/.test(route), "conclui pela ÚLTIMA etapa (maior ordem) concluída")
ok(/const concluiuFaseAtual = \(d: DocFull\): boolean => docConcluiuFase\(d\.id\)/.test(route), "concluiuFaseAtual usa o workflow, não STATUS_VALIDADOS")
ok(/if \(docConcluiuFase\(d\.id\)\) cur\.completed \+= 1/.test(route), "matrix byPerson conta pela conclusão do workflow")
ok(!/STATUS_VALIDADOS\.includes\(d\.status\)/.test(route), "nenhuma contagem de progresso usa mais STATUS_VALIDADOS(d.status)")

console.log("\n2) Próxima ação = 1ª etapa não concluída do workflow (não texto fixo)")
ok(/const proximaAcaoDoc = \(docId: number\): string \| null =>/.test(route), "helper proximaAcaoDoc")
ok(/const prox = steps\.find\(\(s\) => !stepConcluidoRe\(s\.status\)\)/.test(route), "acha a 1ª etapa ainda não concluída")
ok(/proximoPasso = proximaAcaoDoc\(d\.id\) \?\? "normal"/.test(route), "queue usa a próxima etapa real (não 'Solicitar' fixo)")

console.log("\n3) Passos lidos do cadastro (sem lista fixa como regra)")
ok(/getStepsForFase\(faseAtualCode\)/.test(route), "títulos/ordem vêm do catálogo da fase (persistido)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA PROGRESSO-WORKFLOW — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
