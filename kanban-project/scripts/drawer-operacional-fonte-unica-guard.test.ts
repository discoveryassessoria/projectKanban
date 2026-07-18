/**
 * GUARDA — Drawer operacional: FONTE ÚNICA + máquina de estados (fim do flicker
 * "Sem operação ativa"). Rodar: tsx scripts/drawer-operacional-fonte-unica-guard.test.ts
 *
 * BUG (prod): ao clicar num documento na Emissão, o Drawer pintava assim que o 1º fetch
 * (/api/documentos/[id]) chegava, com workflow=null → "Sem operação ativa" + "Iniciar
 * operação", e só depois o 2º fetch (/workflow, que materializa no banco) trocava para a
 * operação correta. Duas fontes/dois momentos.
 *
 * FIX: uma ÚNICA projeção agregada (/operational-projection) + máquina de estados explícita
 * (LOADING/OPERATIONAL/NOT_MATERIALIZED) + AbortController. Teste ESTÁTICO (source-scan).
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const drawer = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
const cockpit = ler("src/components/kanban/TabOperationCockpit.tsx")
const resolver = ler("src/lib/process-stage/document-operational-projection.ts")
const endpoint = ler("src/app/api/documentos/[id]/operational-projection/route.ts")

console.log("\n1) Backend: projeção ÚNICA por documento (agregada) reusa a materialização oficial")
ok(/export async function resolveDocumentOperationalProjection/.test(resolver), "resolveDocumentOperationalProjection existe")
ok(/garantirOperacaoDocumentoV2/.test(resolver), "reusa garantirOperacaoDocumentoV2 (idempotente, escopado à fase) — não duplica materialização")
ok(/"OPERATIONAL"/.test(resolver) && /"NOT_MATERIALIZED"/.test(resolver), "estados explícitos OPERATIONAL/NOT_MATERIALIZED")
ok(/nextAction/.test(resolver) && /currentStep/.test(resolver) && /permissions/.test(resolver), "contrato com nextAction/currentStep/permissions")
ok(/document:\s*res\.document/.test(endpoint) && /projection:\s*res\.projection/.test(endpoint) && /workflow:\s*res\.workflow/.test(endpoint), "endpoint devolve UMA resposta agregada (document+projection+workflow)")

console.log("\n2) Frontend: fonte ÚNICA — sem o duplo fetch concorrente")
ok(/\/operational-projection`/.test(drawer), "drawer consome /operational-projection (fonte única)")
// o carregamento antigo lia o documento básico (const data: Documento = await res.json())
// antes do workflow — origem do flicker. Esse GET saiu do carregar (o PUT de salvar permanece).
ok(!/const data: Documento = await res\.json\(\)/.test(drawer), "drawer NÃO faz mais o GET básico /api/documentos/[id] no carregamento")
ok(!/fetch\(`\/api\/documentos\/\$\{documentoId\}\/workflow`/.test(drawer), "drawer NÃO faz mais o 2º fetch /workflow concorrente no carregamento")

console.log("\n3) Máquina de estados explícita + LOADING nunca mostra 'Sem operação ativa'")
ok(/"LOADING"\s*\|\s*"OPERATIONAL"\s*\|\s*"NOT_MATERIALIZED"\s*\|\s*"ERROR"/.test(drawer), "opState: LOADING|OPERATIONAL|NOT_MATERIALIZED|ERROR")
ok(/opState === "LOADING"[\s\S]{0,400}animate-pulse/.test(drawer), "LOADING renderiza skeleton")
ok(/opState === "OPERATIONAL" \|\| opState === "NOT_MATERIALIZED"/.test(drawer), "corpo/cockpit só monta após a projeção resolver (nunca em LOADING)")

console.log("\n4) Cancelamento de respostas antigas (troca rápida / fechar)")
ok(/new AbortController\(\)/.test(drawer), "usa AbortController")
ok(/abortRef\.current\?\.abort\(\)/.test(drawer), "cancela a requisição anterior / ao fechar")
ok(/controller\.signal\.aborted/.test(drawer), "descarta resposta cancelada (não aplica sobre seleção mais recente)")
ok(/meuDoc === documentoId/.test(drawer), "resposta amarrada ao documentId — nunca aplica resposta de outro documento")

console.log("\n5) Início usa a AÇÃO INICIAL do Workflow Interno, gated por canStart (sem fallback por status)")
ok(/canStart\s*&&\s*\(/.test(cockpit), "botão de início só aparece quando canStart")
ok(/nextActionLabel/.test(cockpit), "rótulo da ação vem de nextAction (Workflow Interno), não da UI")
ok(!/doc\.status\s*===\s*"PENDENTE"[\s\S]{0,120}Iniciar/.test(cockpit), "não escolhe fluxo por Documento.status")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA DRAWER FONTE ÚNICA — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
