/**
 * Sidebar do Gerenciamento — testes estruturais da config declarativa.
 * Rodar: npm run test:nav
 */
import { MANAGEMENT_NAVIGATION, TECH_PERMISSION } from "../src/components/gerenciamentoComponents/managementNavigation"

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

// 4) rename obrigatório aplicado: catalog = "Produtos" (não "Produtos Financeiros")
const catalog = todosItens.find((i) => i.key === "catalog")
ok(catalog?.label === "Produtos", 'catalog renomeado para "Produtos"')
ok(!todosItens.some((i) => i.label === "Produtos Financeiros"), 'nenhum item "Produtos Financeiros" restante')

// 5) grupo técnico (16) exige permissão técnica (não exposto sem permissão)
const motor = MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_motor")
ok(motor?.technicalOnly === true && motor?.permission === TECH_PERMISSION, "grupo Motor Técnico gated por permissão técnica")

// 6) busca por keywords cobre os exemplos da spec
const matchesKeyword = (kw: string) =>
  todosItens.filter((i) => i.status !== "hidden" && [i.label, ...(i.keywords ?? [])].join(" ").toLowerCase().includes(kw))
ok(matchesKeyword("preço").length >= 2, 'busca "preço" retorna itens de precificação')
ok(matchesKeyword("certidão").some((i) => i.key === "doctypes"), 'busca "certidão" alcança Tipos de Documento')
ok(matchesKeyword("tradutor").some((i) => i.key === "suppliers"), 'busca "tradutor" alcança Fornecedores')
ok(matchesKeyword("workflow").length >= 2, 'busca "workflow" retorna itens de workflow')
ok(matchesKeyword("permiss").some((i) => i.key === "roles"), 'busca "permissão" alcança Perfis e Permissões')

// 7) itens active possuem key não vazia (viram deep-link ?screen=)
ok(todosItens.filter((i) => i.status === "active").every((i) => !!i.key), "itens active têm key para deep-link")

// 8) Decisões aprovadas (1–9)
const grupoDe = (key: string) => MANAGEMENT_NAVIGATION.find((g) => (g.children ?? []).some((c) => c.key === key))?.key
const itemDe = (key: string) => todosItens.find((i) => i.key === key)
const emProcessos = (key: string) => !!MANAGEMENT_NAVIGATION.find((g) => g.key === "grp_processos")?.children?.some((c) => c.key === key)
console.log("\nDecisões aprovadas:")
ok(grupoDe("phasemap") === "grp_automacoes" && itemDe("phasemap")?.label === "Regras por Fase", "D1: phasemap em Automações como 'Regras por Fase'")
ok(!emProcessos("phasemap"), "D1: phasemap removido de Processos")
ok(grupoDe("simfase") === "grp_automacoes" && itemDe("simfase")?.label === "Simulação", "D2: simfase em Automações como 'Simulação'")
ok(!emProcessos("simfase"), "D2: simfase removido de Processos")
ok(grupoDe("execmatrix") === "grp_automacoes", "D3: execmatrix só em Automações (não no Motor Técnico)")
ok(itemDe("syshealth")?.label === "Saúde do Sistema", "D4: syshealth = 'Saúde do Sistema'")
ok(todosItens.filter((i) => i.key === "suppliers").some((i) => i.label === "Fornecedores"), "D5: suppliers = 'Fornecedores' (cadastro mestre)")
ok(itemDe("fornecedoresconc")?.label === "Concentradoras e Adquirentes", "D5: fornecedoresconc = 'Concentradoras e Adquirentes'")
ok(itemDe("roles")?.label === "Perfis e Permissões" && !itemDe("permprofiles"), "D6: item único 'Perfis e Permissões' (permprofiles vira alias)")
ok(motor?.technicalOnly === true && motor?.permission === TECH_PERMISSION && TECH_PERMISSION === "sistema", "D7: Motor Técnico gated pela permissão existente 'sistema'")
ok(grupoDe("crossrules") === "grp_workflow", "D8: Tarefas Transversais em Workflow")
ok(grupoDe("imtemplates") === "grp_biblioteca", "D8: Modelos de Passos em Biblioteca Operacional")
ok(grupoDe("prottypes") === "grp_workflow" && itemDe("prottypes")?.label === "Tipos de Protocolo", "D9: prottypes em Workflow como 'Tipos de Protocolo'")
ok(!itemDe("protocols"), "D9: protocols NÃO está na sidebar do Gerenciamento")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Sidebar: config declarativa validada ✅")
