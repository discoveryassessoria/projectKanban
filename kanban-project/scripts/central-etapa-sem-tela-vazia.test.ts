// scripts/central-etapa-sem-tela-vazia.test.ts
// ============================================================================
// A "TELA DE TRÁS" DA CENTRAL DA ETAPA SÓ APARECE QUANDO TEM ALGO NELA.
//
// Achado real (11/09/2026, relato da Daniela — ASSISTENTE): abrir uma etapa
// em andamento levava direto ao editor específico do passo (comportamento
// correto), mas fechar o editor revelava um painel "de trás" — status,
// Anexos/Observações/Timeline — quase sempre vazio, num container de altura
// cheia. Para quem só tem permissão de EXECUTAR a etapa (sem bloquear,
// transferir, forçar ou reabrir), esse painel nunca tinha nada além de "Abrir
// editor"/"Fechar": um clique a mais para ver uma tela sem ação nenhuma.
//
// CORREÇÃO: CentralDaEtapaDrawer.tsx calcula `temAcoesExtras` (a partir das
// MESMAS `acoesPermitidas` que o servidor já calcula por permissão efetiva —
// src/lib/process-stage/acoes-etapa.ts). Sem nenhuma das ações de gestão
// (bloquear/desbloquear/transferir/forçar) e sem reabrir disponível numa
// etapa concluída, fechar o editor fecha a Central da Etapa inteira — nunca
// revela o painel. Quem TEM essas ações continua vendo tudo como antes.
//
//   npx tsx scripts/central-etapa-sem-tela-vazia.test.ts
// ============================================================================
import { readFileSync } from "fs"
import { calcularPermissoes } from "../src/lib/permissoes"
import { acoesPermitidasDaEtapa } from "../src/lib/process-stage/acoes-etapa"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const read = (p: string) => readFileSync(p, "utf8")

console.log("CENTRAL DA ETAPA — sem tela de trás quando não há nada nela\n")

secao("1) A LÓGICA — mesma régua de permissão do servidor, para quem tem e para quem não tem")
const ACOES_DE_GESTAO = ["bloquear", "desbloquear", "transferir", "forcar"] as const
const temAcoesExtras = (permissoes: Record<string, boolean>, status: "EM_ANDAMENTO" | "CONCLUIDO") => {
  const acoes = acoesPermitidasDaEtapa({ status: status as never, permissoes })
  if (status === "CONCLUIDO") return acoes.includes("reabrir")
  return acoes.some((a) => (ACOES_DE_GESTAO as readonly string[]).includes(a))
}

const assistente = calcularPermissoes("assistente", null, null) // sem perfil = base zerada; o ponto é a AUSÊNCIA de gestão
const admin = calcularPermissoes("admin", null, null)

check("1a) usuário SEM permissão de gestão numa etapa em andamento: temAcoesExtras = false (some a tela)",
  temAcoesExtras(assistente, "EM_ANDAMENTO") === false)
check("1b) admin (tem bloquear/transferir/forçar) numa etapa em andamento: temAcoesExtras = true (a tela continua existindo)",
  temAcoesExtras(admin, "EM_ANDAMENTO") === true)
check("1c) admin numa etapa concluída COM permissão de reabrir: temAcoesExtras = true",
  temAcoesExtras(admin, "CONCLUIDO") === true)
check("1d) usuário sem permissão de reabrir numa etapa concluída: temAcoesExtras = false",
  temAcoesExtras(assistente, "CONCLUIDO") === false)

secao("2) O COMPONENTE — calcula temAcoesExtras e nunca deixa a tela vazia escapar")
const drawer = read("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
check("2a) temAcoesExtras existe e considera cancelada/reabrir/bloquear/desbloquear/transferir/forcar",
  /const temAcoesExtras = !!step && \(/.test(drawer) &&
  drawer.includes('step.status === "cancelada"') &&
  drawer.includes('permite(step, "reabrir")') &&
  drawer.includes('permite(step, "bloquear")') &&
  drawer.includes('permite(step, "desbloquear")') &&
  drawer.includes('permite(step, "transferir")') &&
  drawer.includes('permite(step, "forcar")'))
check("2b) o painel de status/abas só renderiza com temAcoesExtras", /\{step && temAcoesExtras && \(/.test(drawer))
check("2c) sem temAcoesExtras, fechar o editor fecha a Central inteira (fecharEditor chama onClose)",
  /if \(!temAcoesExtras\) onClose\(\)/.test(drawer))
check("2d) rede de segurança: qualquer caminho (inclusive onSaved) que zere editorAberto sem temAcoesExtras também fecha",
  /if \(isOpen && step && !editorAberto && !temAcoesExtras\) onClose\(\)/.test(drawer))
check("2e) os editores (registral e StepEditorRouter) usam fecharEditor, não um setEditorAberto(false) cru",
  (drawer.match(/onClose=\{fecharEditor\}/g) ?? []).length === 2)

console.log(`\n${ok} passaram, ${falhas.length} falharam`)
if (falhas.length) console.log("Falhas:", falhas.join(", "))
process.exit(falhas.length > 0 ? 1 : 0)
