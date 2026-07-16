/**
 * Sidebar do Gerenciamento — testes estruturais da config declarativa.
 * Rodar: npm run test:nav
 */
import { MANAGEMENT_NAVIGATION } from "../src/components/gerenciamentoComponents/managementNavigation"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("Sidebar do Gerenciamento — config declarativa\n")

// 1) chaves de grupo únicas
const gkeys = MANAGEMENT_NAVIGATION.map((g) => g.key)
ok(new Set(gkeys).size === gkeys.length, "chaves de grupo únicas")

// 2) sem chave de item duplicada DENTRO de cada grupo (evita key duplicada no React)
let dupDentroGrupo = false
for (const g of MANAGEMENT_NAVIGATION) {
  const ks = (g.children ?? []).map((c) => c.key)
  if (new Set(ks).size !== ks.length) dupDentroGrupo = true
}
ok(!dupDentroGrupo, "sem item duplicado dentro do mesmo grupo")

// 3) todo item tem status válido e order numérico
const todosItens = MANAGEMENT_NAVIGATION.flatMap((g) => g.children ?? [])
ok(todosItens.every((i) => ["active", "coming_soon", "hidden"].includes(i.status)), "todo item tem status válido")
ok(todosItens.every((i) => typeof i.order === "number"), "todo item tem order numérico")

// 4) rename obrigatório (F3): catalog = "Configurações Financeiras" (não "Produtos"/"Produtos Financeiros")
const catalog = todosItens.find((i) => i.key === "catalog")
ok(catalog?.label === "Configurações Financeiras", 'catalog renomeado para "Configurações Financeiras" (F3)')
ok(!todosItens.some((i) => i.label === "Produtos Financeiros"), 'nenhum item "Produtos Financeiros" restante')

// 5) Motor Técnico foi REMOVIDO da navegação (escopo definitivo 16/07) — ver bloco 15.

// 6) busca por keywords cobre os exemplos da spec
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const matchesKeyword = (kw: string) =>
  todosItens.filter((i) => i.status !== "hidden" && norm([i.label, ...(i.keywords ?? [])].join(" ")).includes(norm(kw)))
ok(matchesKeyword("preço").length >= 2, 'busca "preço" retorna itens de precificação')
ok(matchesKeyword("certidão").some((i) => i.key === "doctypes"), 'busca "certidão" alcança Tipos de Documento')
ok(matchesKeyword("tradutor").some((i) => i.key === "suppliers"), 'busca "tradutor" alcança Fornecedores')
ok(matchesKeyword("workflow").length >= 2, 'busca "workflow" retorna itens de workflow')
ok(matchesKeyword("permiss").some((i) => i.key === "roles"), 'busca "permissão" alcança Perfis e Permissões')
// normalização sem acento
ok(matchesKeyword("certidao").length >= 1 && matchesKeyword("certidão").length === matchesKeyword("certidao").length, 'busca normaliza acento: "certidao" == "certidão"')
ok(matchesKeyword("preco").length >= 2, 'busca "preco" (sem acento) encontra precificação')
ok(matchesKeyword("permissao").some((i) => i.key === "roles"), 'busca "permissao" (sem acento) alcança Perfis e Permissões')

// 7) itens active possuem key não vazia (viram deep-link ?screen=)
ok(todosItens.filter((i) => i.status === "active").every((i) => !!i.key), "itens active têm key para deep-link")

// 8) Decisões aprovadas (1–9)
const grupoDe = (key: string) => MANAGEMENT_NAVIGATION.find((g) => (g.children ?? []).some((c) => c.key === key))?.key
const itemDe = (key: string) => todosItens.find((i) => i.key === key)
const emProcessos = (key: string) => !!MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_processos")?.children?.some((c) => c.key === key)
console.log("\nDecisões aprovadas:")
ok(grupoDe("phasemap") === "grp_financeiro" && itemDe("phasemap")?.label === "Regras Financeiras por Fase", "D1: phasemap em Financeiro como 'Regras Financeiras por Fase' (reusa motor do Workflow)")
ok(!emProcessos("phasemap"), "D1: phasemap removido de Processos")
ok(grupoDe("simfase") === "grp_workflow" && itemDe("simfase")?.label === "Simulação", "D2: simfase em Workflow como 'Simulação'")
ok(!emProcessos("simfase"), "D2: simfase removido de Processos")
ok(grupoDe("execmatrix") === "grp_workflow", "D3: execmatrix em Workflow (não no Motor Técnico)")
ok(todosItens.filter((i) => i.key === "suppliers").some((i) => i.label === "Fornecedores"), "D5: suppliers = 'Fornecedores' (cadastro mestre)")
ok(itemDe("fornecedoresconc")?.label === "Concentradoras e Adquirentes", "D5: fornecedoresconc = 'Concentradoras e Adquirentes'")
ok(itemDe("roles")?.label === "Perfis e Permissões" && !itemDe("permprofiles"), "D6: item único 'Perfis e Permissões' (permprofiles vira alias)")
ok(grupoDe("crossrules") === "grp_workflow" && itemDe("crossrules")?.label === "Regras Transversais", "D8: Regras Transversais em Workflow")
ok(grupoDe("imtemplates") === "grp_workflow", "D8: Modelos de Variações da Fase em Workflow → Biblioteca de Modelos")
ok(grupoDe("prottypes") === "grp_documentos" && itemDe("prottypes")?.status === "active" && itemDe("prottypes")?.label === "Tipos de Protocolo", "D9: 'Tipos de Protocolo' ATIVO em Documentos e Protocolos")
ok(grupoDe("prottypes") !== "grp_workflow", "D9: 'Tipos de Protocolo' NÃO está em Workflow")
ok(!itemDe("protocols"), "D9: protocols NÃO está na sidebar do Gerenciamento")

// 9) Refinamento visual 10/10 (labels curtos + fullLabel + ordem + a11y)
console.log("\nRefinamento visual:")
const gLabel = (k: string) => MANAGEMENT_NAVIGATION.find((g) => g.key === k)
const curtos: Array<[string, string, string]> = [
  ["grp_visao", "Painel", "Visão Geral"],
  ["grp_documentos", "Documentos", "Documentos e Protocolos"],
  ["grp_pessoas", "Pessoas", "Pessoas e Organizações"],
  ["grp_relatorios", "Relatórios", "Relatórios e Indicadores"],
  ["grp_usuarios", "Usuários", "Usuários e Acessos"],
]
ok(curtos.every(([k, short, full]) => gLabel(k)?.label === short && gLabel(k)?.fullLabel === full), "labels curtos aplicados com fullLabel completo")
ok(["grp_processos", "grp_workflow", "grp_financeiro"].every((k) => !gLabel(k)?.fullLabel), "grupos mantidos ficaram com label inalterado")
// só os grupos que RENDERIZAM (têm ≥1 item active) — Agenda/IA ficam ocultos e não aparecem
const gruposVisiveis = MANAGEMENT_NAVIGATION.filter((g) => (g.children ?? []).some((c) => c.status === "active"))
ok(gruposVisiveis.every((g) => g.label.length <= 12), "labels de grupo VISÍVEIS curtos (sem risco de ellipsis)")
const orders = MANAGEMENT_NAVIGATION.map((g) => g.order)
ok(orders.every((o, i) => i === 0 || o > orders[i - 1]), "ordem dos grupos preservada (ascendente)")
// a11y + normalização + deep-link no componente (source check)
const pageSrc = readFileSync(join(ROOT, "src/app/administrator/page.tsx"), "utf8")
ok(/aria-expanded=\{moduloAberto\}/.test(pageSrc) && /aria-controls=/.test(pageSrc), "linha do módulo (árvore) tem aria-expanded + aria-controls")
ok(/normalize\("NFD"\)/.test(pageSrc), "busca normaliza acentos (NFD) no componente")
ok(/\?screen=/.test(pageSrc), "deep-link ?screen= preservado no componente (rotas intactas)")
// árvore lateral única: lista TODOS os módulos; sem página intermediária de cards por módulo
ok(/aria-label="Módulos do Gerenciamento"/.test(pageSrc), "árvore lateral lista todos os módulos")
ok(!/view === "module"/.test(pageSrc), "sem view intermediária de cards por módulo (navegação duplicada removida)")
ok(/primeiraTelaDoModulo/.test(pageSrc), "módulo abre direto na 1ª tela útil (defaultRoute)")

// 10) Consolidação Tipos de Documento x Tipos de Certidão
console.log("\nConsolidação Documentos/Certidões:")
ok(itemDe("certtypes")?.status === "hidden", "Tipos de Certidão removido da sidebar (status hidden)")
ok(itemDe("doctypes")?.status === "active", "Tipos de Documento (mestre) permanece ativo")
ok(!MANAGEMENT_NAVIGATION.some((g) => (g.children ?? []).some((c) => c.key === "certtypes" && c.status === "active")), "nenhum item ativo 'Tipos de Certidão'")
ok(/certtypes:\s*"doctypes"/.test(pageSrc), "?screen=certtypes redireciona (alias) para doctypes")
const tdTab = readFileSync(join(ROOT, "src/components/gerenciamentoComponents/TiposDocumentoTab.tsx"), "utf8")
ok(/setFiltro/.test(tdTab) && /certid/i.test(tdTab), "Tipos de Documento tem filtro 'Certidões' client-side")
ok(/mestre/i.test(tdTab), "Tipos de Documento marcado como cadastro mestre")
// LOTE A — cadastro mestre de Categorias Documentais aparece em Documentos
ok(itemDe("doccats")?.status === "active" && grupoDe("doccats") === "grp_documentos", "LOTE A: 'Categorias Documentais' (doccats) ativo em Documentos")

// 11) Cleanups de dedup (reorg 16/07) — sem reverter D1-D9
console.log("\nCleanups de dedup:")
ok(itemDe("workflowsphases")?.status === "hidden", "Hub de Workflows (workflowsphases) oculto — item redundante c/ Macro/Interno/Modos")
ok(!itemDe("finauto"), "'Automações Financeiras' (finauto, scaffold vazio) REMOVIDO")
ok(itemDe("docrules")?.label === "Regras Documentais", "docrules renomeado 'Aplicabilidade' → 'Regras Documentais' (sem colidir c/ Aplicabilidade Econômica)")
ok(matchesKeyword("workflow").length >= 2, "busca 'workflow' segue com ≥2 itens")

// 12) Automações deixou de ser módulo → tudo dentro do Workflow (correção 16/07)
console.log("\nAutomações dentro do Workflow:")
ok(!MANAGEMENT_NAVIGATION.some((g) => g.key === "grp_automacoes"), "módulo 'Automações' NÃO existe mais")
ok(grupoDe("opauto") === "grp_workflow" && itemDe("opauto")?.label === "Automações por Fase", "opauto em Workflow como 'Automações por Fase'")
ok(grupoDe("amtemplates") === "grp_workflow" && itemDe("amtemplates")?.label === "Modelos de Automação", "amtemplates em Workflow → Biblioteca de Modelos ('Modelos de Automação')")
ok(grupoDe("crosstpl") === "grp_workflow", "crosstpl (Modelos de Regras Transversais) em Workflow → Biblioteca de Modelos")
ok(itemDe("phasemodes")?.label === "Variações da Fase", "phasemodes renomeado 'Modos Internos' → 'Variações da Fase'")
// Biblioteca de Modelos como sub-seção do Workflow (via section)
const bibWf = (MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_workflow")?.children ?? []).filter((c) => c.section === "Biblioteca de Modelos" && c.status === "active")
ok(bibWf.length === 4 && ["iwtemplates", "imtemplates", "amtemplates", "crosstpl"].every((k) => bibWf.some((c) => c.key === k)), "Workflow → 'Biblioteca de Modelos' tem os 4 modelos (IW, Variações, Automação, Transversais)")
// screen→component não deve mais mapear finauto (scaffold removido do menu)
ok(!/\bfinauto:\s*FinAutomationsTab/.test(pageSrc), "screen map não mapeia mais 'finauto'")

// 13) Workflow = árvore APROVADA exata (11 itens ativos, na ordem, sem extras)
console.log("\nWorkflow = árvore aprovada:")
const wfAtivos = (MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_workflow")?.children ?? []).filter((c) => c.status === "active").map((c) => c.label)
const wfAprovado = [
  "Workflow Macro", "Workflow Interno", "Variações da Fase",
  "Automações por Fase", "Regras Transversais", "Simulação", "Histórico de Execuções",
  "Modelos de Workflow Interno", "Modelos de Variações da Fase", "Modelos de Automação", "Modelos de Regras Transversais",
]
ok(JSON.stringify(wfAtivos) === JSON.stringify(wfAprovado), "Workflow: itens ativos batem EXATAMENTE a árvore aprovada (11, na ordem, sem extras)")

// 14) Tipos de Protocolo movido p/ Documentos e Protocolos (16/07)
console.log("\nTipos de Protocolo → Documentos e Protocolos:")
ok(gLabel("grp_documentos")?.fullLabel === "Documentos e Protocolos", "módulo renomeado p/ 'Documentos e Protocolos' (fullLabel; breadcrumb usa fullLabel)")
ok(/prottypes:\s*cat\(|prottypes:\s*\w+Tab/.test(pageSrc), "?screen=prottypes mapeia p/ tela (deep-link antigo funciona, sem duplicar componente)")
const docsAtivos = (MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_documentos")?.children ?? []).filter((c) => c.status === "active").map((c) => c.label)
ok(docsAtivos.indexOf("Tipos de Protocolo") === docsAtivos.indexOf("Regras Documentais") + 1, "'Tipos de Protocolo' logo após 'Regras Documentais' em Documentos e Protocolos")
ok(!(MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_workflow")?.children ?? []).some((c) => c.key === "prottypes"), "prottypes REMOVIDO do Workflow (nem oculto)")
// sem duplicação: prottypes aparece só uma vez em toda a navegação
ok(todosItens.filter((i) => i.key === "prottypes").length === 1, "prottypes sem duplicação no menu (1 ocorrência)")

// 15) ESCOPO DEFINITIVO — só 8 módulos visíveis; 7 grupos removidos (16/07)
console.log("\nEscopo definitivo — 8 módulos:")
for (const k of ["grp_comunicacao", "grp_integracoes", "grp_governanca", "grp_motor", "grp_biblioteca", "grp_agenda", "grp_ia"]) {
  ok(!MANAGEMENT_NAVIGATION.some((g) => g.key === k), `módulo ${k} REMOVIDO da navegação (não existe mais)`)
}
// árvore VISÍVEL = mesma lógica do page.tsx (!hiddenAsModule + tem item ativo)
const visiveis = MANAGEMENT_NAVIGATION
  .filter((g) => !g.hiddenAsModule && (g.children ?? []).some((c) => c.status === "active"))
  .sort((a, b) => a.order - b.order)
  .map((g) => g.key)
const ESPERADO_8 = ["grp_processos", "grp_workflow", "grp_documentos", "grp_servicos", "grp_financeiro", "grp_pessoas", "grp_relatorios", "grp_usuarios"]
ok(JSON.stringify(visiveis) === JSON.stringify(ESPERADO_8), `árvore visível = exatamente os 8 módulos aprovados, na ordem (got: ${visiveis.join(", ")})`)

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Sidebar: config declarativa validada ✅")
