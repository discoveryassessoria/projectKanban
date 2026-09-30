/**
 * A8 — os TRÊS números da documentação (requeridos/recebidos/pendentes) vêm de UMA função.
 * Sem banco. Rodar: node scripts/ci/gate-build.mjs --so documentacao-requerida-fonte-unica
 * Achado real: processo 675 mostrava "0 de 14" (Geral), "14/12/2" (Documentos) e "12 de 13 (92%)" (Central/Home/Torre).
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { resumirDocumentacao } from "../src/lib/process-stage/documentacao-requerida"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
let falhas = 0
function ok(c: boolean, n: string) { if (c) console.log(`  ✅ ${n}`); else { falhas++; console.log(`  ❌ ${n}`) } }

// Comportamento: o caso do 675 (13 certidões obrigatórias, 12 cumpridas)
const r = resumirDocumentacao({ aplicavel: true, required: 13, completed: 12, percentage: 92 })
ok(r.requeridos === 13 && r.recebidos === 12 && r.pendentes === 1 && r.percentual === 92, "675: 13 requeridos / 12 recebidos / 1 pendente / 92%")
ok(r.requeridos === r.recebidos + r.pendentes, "requeridos = recebidos + pendentes (fecha matematicamente)")
ok(r.grain === "NECESSIDADE_CERTIDAO_OBRIGATORIA", "grain declarado")
ok(resumirDocumentacao({ aplicavel: true, required: 2, completed: 5, percentage: 100 }).pendentes === 0, "pendentes nunca negativo")
ok(resumirDocumentacao({ aplicavel: false, required: 0, completed: 0, percentage: 0 }).aplicavel === false, "fase sem certidões: aplicavel=false")

// Fiação: cada tela lê da fonte única
const est = ler("src/app/api/processos/[processoId]/estatisticas/route.ts")
ok(/documentacaoRequeridaDoProcesso\(id\)/.test(est), "Geral (/estatisticas) usa a fonte única")
ok(!/whereSituacaoSolicitacao|documento\.findMany/.test(est), "Geral não conta Documento nem usa o filtro de SolicitacaoDocumento")
const docsRoute = ler("src/app/api/processos/[processoId]/documentos/route.ts")
ok(/documentacao: await documentacaoRequeridaDoProcesso\(id\)/.test(docsRoute), "rota /documentos devolve a documentação da fonte única")
const docsTab = ler("src/components/kanban/ProcessoDocumentos.tsx")
ok(/obrig: data\.documentacao\.requeridos/.test(docsTab) && /certRec: data\.documentacao\.recebidos/.test(docsTab) && /pend: data\.documentacao\.pendentes/.test(docsTab), "aba Documentos: obrigatórias/recebidas/pendentes vêm da fonte única")
ok(!/obrig: allDocs\.length/.test(docsTab), "aba Documentos não conta linhas de Documento como obrigatórias")
const met = ler("lib/operacional/metricas-processo.ts")
ok(/documentacaoRequeridaDoProcesso/.test(met), "Torre (progressoRealDoProcesso) usa a fonte única")
const svc = ler("src/lib/process-stage/documentacao-requerida.ts")
ok(/resolverCompletudeDocumental/.test(svc), "a fonte única reembala a completude da Central (sem conta própria)")
const central = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")
ok(/resolverCompletudeDocumental/.test(central), "Central lê a mesma completude")

console.log(falhas === 0 ? "\n✅ PASSOU" : `\n❌ FALHOU (${falhas})`)
if (falhas) process.exit(1)
