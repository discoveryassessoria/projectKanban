// scripts/rotulo-status-tarefa-fonte-unica.test.ts
// ============================================================================
// UM SÓ MAPA statusTarefa -> RÓTULO (item B8, 30/09/2026). NAO_INICIADA = "A iniciar".
//
//   npx tsx scripts/rotulo-status-tarefa-fonte-unica.test.ts   (sem banco)
//
// A Operação dizia "A iniciar"; a Home/fila, o drawer do documento e a Central da fase diziam "A fazer"
// para a MESMA tarefa. Agora há UMA fonte (src/lib/home/rotulo-status-tarefa.ts, módulo puro) e a
// varredura abaixo falha se alguém criar um dicionário paralelo. "A fazer" continua sendo o NOME DA ABA.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ROTULO_STATUS, rotuloStatusTarefa } from "../src/lib/home/rotulo-status-tarefa"
import { ROTULO_STATUS_TAREFA, statusTarefaTxt } from "../src/components/operacao/operacao-v3-derivacoes"

let falhas = 0
function ok(n: string, c: boolean, extra = "") { if (c) console.log(`  ✅ ${n}`); else { falhas++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

secao("OS 9 VALORES do enum StatusTarefa (prisma/schema.prisma)")
const enumSchema = /enum StatusTarefa \{([^}]*)\}/.exec(ler("prisma/schema.prisma"))![1]
  .split("\n").map((x) => x.replace(/\/\/.*/, "").trim()).filter(Boolean)
ok("o enum tem 9 valores", enumSchema.length === 9, enumSchema.join(","))
ok("o mapa cobre exatamente o enum (nem a mais, nem a menos)", enumSchema.length === Object.keys(ROTULO_STATUS).length && enumSchema.every((s) => s in ROTULO_STATUS))
const esperado: Record<string, string> = {
  NAO_INICIADA: "A iniciar", EM_ANDAMENTO: "Em andamento", AGUARDANDO_TERCEIRO: "Aguardando cartório", AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada", CONCLUIDO_RECEBIDO: "Concluída", CONCLUIDO_NAO_POSSUI: "Concluída", CANCELADA: "Cancelada", SUPERSEDIDA: "Substituída",
}
for (const s of enumSchema) ok(`${s} -> '${esperado[s]}'`, ROTULO_STATUS[s] === esperado[s] && rotuloStatusTarefa(s) === esperado[s], ROTULO_STATUS[s])
ok("CANCELADA != Concluída", ROTULO_STATUS.CANCELADA !== ROTULO_STATUS.CONCLUIDO_RECEBIDO)

secao("A MESMA FONTE, não cópia")
ok("operacao-v3-derivacoes reexporta o MESMO objeto", ROTULO_STATUS_TAREFA === ROTULO_STATUS)
ok("a coluna Status da Operação (statusTarefaTxt) lê a fonte", statusTarefaTxt({ statusTarefa: "NAO_INICIADA" }) === "A iniciar")
const kit = ler("src/components/operacao/kit-operacional.tsx")
ok("kit-operacional reexporta ROTULO_STATUS da fonte", /export \{ ROTULO_STATUS \} from "@\/src\/lib\/home\/rotulo-status-tarefa"/.test(kit))
ok("ROTULO_COLUNA (estado de UMA tarefa) deriva da fonte, sem literais de status", /A_FAZER: ROTULO_STATUS_FONTE\.NAO_INICIADA/.test(kit) && !/A_FAZER: "A fazer"/.test(kit))
const drawer = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
ok("drawer do documento usa rotuloStatusTarefa da fonte e não tem mapa próprio", /import \{ rotuloStatusTarefa \} from "@\/src\/lib\/home\/rotulo-status-tarefa"/.test(drawer) && /rotuloStatusTarefa\(tarefa\.statusTarefa\)/.test(drawer) && !/const ROTULO_STATUS_TAREFA/.test(drawer))
const estrutura = ler("src/lib/process-stage/estrutura-operacional-core.ts")
ok("Central da fase (ROTULO_ESTADO_LINHA) deriva da fonte: NAO_INICIADA não é mais 'A fazer'", /A_FAZER: ROTULO_STATUS_TAREFA_FONTE\.NAO_INICIADA/.test(estrutura) && !/A_FAZER: "A fazer"/.test(estrutura))
const coleta = ler("src/lib/home/coleta.ts")
ok("a fila da Home (/dashboard/fila) usa a fonte", /rotuloStatusTarefa\(t\.statusTarefa\)/.test(coleta))

secao("VARREDURA: nenhum mapa paralelo statusTarefa -> rótulo em src/ e lib/")
function walk(d: string): string[] {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    if (f === "node_modules" || f === ".next") return []
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}
const raiz = process.cwd()
const arquivos = [...walk(join(raiz, "src")), ...walk(join(raiz, "lib"))]
const FONTE = join(raiz, "src/lib/home/rotulo-status-tarefa.ts")
// Um dicionário de statusTarefa tem chaves do enum apontando para TEXTO em português (com letra minúscula/espaço).
// Mapas que apontam para outro enum (ex.: NAO_INICIADA: "A_FAZER" — TODO EM MAIÚSCULAS) e o status de ETAPA do
// Assistente de Parametrização (outro enum, mesmo nome de chave) não são rótulo de statusTarefa.
const PARALELOS: string[] = []
for (const arq of arquivos) {
  if (arq === FONTE) continue
  const codigo = semComentarios(readFileSync(arq, "utf8"))
  const m = /\bNAO_INICIADA\s*:\s*["'`]([^"'`]*[a-zà-ú ][^"'`]*)["'`]/.exec(codigo)
  if (m) PARALELOS.push(`${arq.replace(raiz + "/", "")} (${m[0]})`)
  // "A fazer" com o sentido de NAO_INICIADA, escrito ao lado da chave do enum ou da coluna A_FAZER de rótulo de estado.
  if (/NAO_INICIADA[\s\S]{0,40}?["'`]A fazer["'`]/.test(codigo) || /\bA_FAZER\s*:\s*["'`]A fazer["'`]/.test(codigo)) PARALELOS.push(`${arq.replace(raiz + "/", "")} ('A fazer' como estado)`)
}
// Exceção declarada: o status de ETAPA do Assistente de Parametrização é OUTRO enum (StatusEtapa), não StatusTarefa.
const permitidos = ["src/components/gerenciamentoComponents/AssistenteParametrizacaoTab.tsx"]
const indevidos = PARALELOS.filter((p) => !permitidos.some((a) => p.startsWith(a)))
ok("nenhum arquivo define outro mapa statusTarefa -> rótulo", indevidos.length === 0, indevidos.join(" | "))
ok("a varredura leu o repositório de verdade (>500 arquivos)", arquivos.length > 500, String(arquivos.length))

// A aba continua "A fazer": o nome da aba/seletor da Operação não é rótulo de status.
const v3 = ler("src/components/operacao/operacao-v3.tsx")
ok("'A fazer' segue como NOME DA ABA da Operação", /A fazer <span className="opv3-n">/.test(v3))

console.log(`\n${falhas === 0 ? "✅ PASSOU" : "❌ FALHOU"}`)
if (falhas > 0) process.exit(1)
