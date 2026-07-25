/**
 * Accordion da sidebar do Gerenciamento — regra pura (sem DOM). Rodar: tsx scripts/accordion-logic.test.ts
 * Cobre a regra do accordion (1 aberto por vez, reclicar fecha, trocar troca) e a
 * 1ª tela padrão de entrada (Processos), sem home de cards.
 */
import {
  MANAGEMENT_NAVIGATION,
  toggleAccordion,
  itensVisiveisDoModulo,
  primeiraTelaDoModulo,
  moduloEhDireto,
} from "../src/components/gerenciamentoComponents/managementNavigation"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("\nAccordion — regra única (openGroupId)")
// 1) grupo fechado abre ao clicar
ok(toggleAccordion(null, "grp_processos") === "grp_processos", "1) fechado → abre ao clicar")
// 2) grupo aberto fecha ao clicar novamente (O BUG reportado)
ok(toggleAccordion("grp_processos", "grp_processos") === null, "2) aberto → FECHA ao clicar novamente")
// 3) clicar em outro grupo fecha o anterior e abre o novo
ok(toggleAccordion("grp_processos", "grp_workflow") === "grp_workflow", "3) outro grupo → fecha anterior, abre novo")
// 4) no máximo um grupo aberto (o estado é um único id — nunca uma lista)
{
  let estado: string | null = null
  estado = toggleAccordion(estado, "grp_workflow")     // abre workflow
  estado = toggleAccordion(estado, "grp_financeiro")   // troca p/ financeiro (workflow fecha)
  ok(estado === "grp_financeiro", "4) no máx. 1 aberto (trocar mantém só o novo)")
}
// 5) todos podem ficar fechados (é possível chegar a null)
ok(toggleAccordion("grp_documentos", "grp_documentos") === null, "5) todos podem ficar fechados (chega a null)")
// idempotência da troca: reabrir o mesmo é estável
ok(toggleAccordion(toggleAccordion(null, "grp_pessoas") as string, "grp_pessoas") === null, "abre→fecha o mesmo grupo (ciclo consistente)")

console.log("\nEntrada — 1ª tela padrão (sem home de cards)")
// O 1º módulo VISÍVEL (mesma lógica do page: !hiddenAsModule + tem item renderizável
// OU é módulo direto com screen própria) é Visão Geral, na ordem oficial.
const primeiroVisivel = MANAGEMENT_NAVIGATION
  .filter((g) => !g.hiddenAsModule && (!!g.screen || itensVisiveisDoModulo(g).length > 0))
  .sort((a, b) => a.order - b.order)[0]
ok(primeiroVisivel?.key === "grp_visao", "1º módulo visível = Visão Geral (ordem oficial)")
ok(primeiraTelaDoModulo(primeiroVisivel!) === "overview", "Visão Geral abre direto o painel geral (sem submenu)")
ok(moduloEhDireto(primeiroVisivel!), "Visão Geral não expande (sem seta) — navega direto")

// Todo módulo COM submenu abre em uma 1ª tela útil (defaultRoute)
const comSubmenu = MANAGEMENT_NAVIGATION.filter((g) => !moduloEhDireto(g) && itensVisiveisDoModulo(g).length > 0)
ok(comSubmenu.length === 10, "10 módulos com submenu (os 11 oficiais menos Visão Geral)")
ok(comSubmenu.every((g) => !!primeiraTelaDoModulo(g)), "todo módulo com submenu tem 1ª tela útil para abrir")

console.log(`\n${failed === 0 ? "✅" : "❌"} ACCORDION — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
