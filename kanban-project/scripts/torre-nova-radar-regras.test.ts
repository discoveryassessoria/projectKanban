// scripts/torre-nova-radar-regras.test.ts
// ============================================================================
// TORRE NOVA — RADAR: as regras PURAS (`lib/operacional/torre-radar.ts`), sobre a lista consolidada. Sem banco.
//
//   npx tsx scripts/torre-nova-radar-regras.test.ts
//
// PROVA (CHECKLIST T130–T142, T164–T166): cada filtro (Todas · Precisam de alguém · Aguardando a equipe · Aguardando terceiros · Críticas) e as
// contagens dos botões; o filtro padrão; busca por família sem acento/maiúsculas; País; as três ordens (mais grave com desempate por
// MAIOR tempo na fase, mais tempo com h/24, A–Z pt-BR); paginação REAL; rodapé e texto da célula; textos fixos do protótipo.
// ============================================================================
import { readFileSync } from "node:fs"
import {
  FILTROS_DO_RADAR, ORDENS_DO_RADAR, FILTRO_INICIAL_DO_RADAR, TODOS_OS_PAISES, passaNoFiltroDoRadar, baseDoRadar, contagensDoRadar, ordenarRadar,
  visaoDoRadar, textoDaCelulaAtual, rodapeDoRadar,
} from "../lib/operacional/torre-radar"
import { paginar, paginasVisiveis, textoDuracao } from "../lib/operacional/torre-fase"
import { processo } from "./_torre-nova-fabrica"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const dias = (d: number | null, h = d == null ? null : d * 24) => ({ desde: null, origem: null, dias: d, horas: h })
// As 14 famílias do protótipo (inventário §1.3), com o risco e a bola de lá.
const P = [
  processo({ id: 1, nome: "Bertolucci", pais: "Itália", nivel: "critico", bola: { rotulo: "Cartório", dias: 52 }, naFase: dias(52) }),
  processo({ id: 2, nome: "Salvarani", pais: "Itália", nivel: "critico", bola: { rotulo: "Equipe", dias: null }, naFase: dias(1) }),
  processo({ id: 3, nome: "Antão (real)", pais: "Espanha", nivel: "atencao", bola: { rotulo: "Equipe", dias: null }, naFase: dias(0, 8) }),
  processo({ id: 4, nome: "Martín Manzano", pais: "Espanha", nivel: "parado", bola: { rotulo: "Juízo", dias: 64 }, naFase: dias(64) }),
  processo({ id: 5, nome: "Ferreira Lopes", pais: "Portugal", nivel: "atencao", bola: { rotulo: "Cartório", dias: 42 }, naFase: dias(42) }),
  processo({ id: 6, nome: "Fogli", pais: "Itália", nivel: "atencao", bola: { rotulo: "Equipe", dias: null }, naFase: dias(5) }),
  processo({ id: 7, nome: "Gallo Pereira", pais: "Itália", nivel: "atencao", bola: { rotulo: "Cartório", dias: 33 }, naFase: dias(33) }),
  processo({ id: 8, nome: "Panza", pais: "Itália", nivel: "atencao", bola: { rotulo: "Equipe", dias: null }, naFase: dias(17) }),
  processo({ id: 9, nome: "Rossetto", pais: "Itália", nivel: "atencao", bola: { rotulo: "Equipe", dias: null }, naFase: dias(31) }),
  processo({ id: 10, nome: "Navarro Ruiz", pais: "Espanha", nivel: "no_ritmo", bola: { rotulo: "Tradutor", dias: 6 }, naFase: dias(6) }),
  processo({ id: 11, nome: "Zanella", pais: "Itália", nivel: "no_ritmo", bola: { rotulo: "Cartório", dias: 24 }, naFase: dias(24) }),
  processo({ id: 12, nome: "Schneider", pais: "Alemanha", nivel: "no_ritmo", bola: { rotulo: "Cliente", dias: 9 }, naFase: dias(9) }),
  processo({ id: 13, nome: "Albuquerque Dias", pais: "Portugal", nivel: "no_ritmo", bola: { rotulo: "Consulado", dias: 12 }, naFase: dias(12) }),
  processo({ id: 14, nome: "Lombardi", pais: "Itália", nivel: "no_ritmo", bola: { rotulo: "Consulado", dias: 123 }, naFase: dias(123) }),
]
const nomes = (xs: typeof P) => xs.map((p) => p.familiaNome)

secao("OS BOTÕES — vocabulário, padrão e contagens (T130, T131)")
ok("rótulos, na ordem: Todas · Precisam de alguém · Aguardando a equipe · Aguardando terceiros · Críticas", FILTROS_DO_RADAR.map((f) => f.rotulo).join(" · ") === "Todas · Precisam de alguém · Aguardando a equipe · Aguardando terceiros · Críticas")
ok("o filtro padrão é 'Precisam de alguém'", FILTRO_INICIAL_DO_RADAR === "precisam")
const c = contagensDoRadar(P)
ok("contagens: todas 14 · precisam 9 · aguardando a equipe 5 · bola com terceiro 9 · críticas 3", c.todas === 14 && c.precisam === 9 && c.nossa === 5 && c.terceiro === 9 && c.criticas === 3, JSON.stringify(c))
// Antão, Rossetto, Fogli, Panza, Salvarani = Nossa (5) — Cliente/Tradutor/Juízo/Consulado/Cartório = terceiro (9)

secao("OS FILTROS (T132–T136)")
const por = (f: Parameters<typeof passaNoFiltroDoRadar>[1]) => P.filter((p) => passaNoFiltroDoRadar(p, f))
ok("Todas → 14 linhas", por("todas").length === 14)
ok("Precisam de alguém → risco ≠ no ritmo (9)", por("precisam").length === 9 && por("precisam").every((p) => p.nivelDeRisco !== "no_ritmo"))
ok("Aguardando a equipe → bola = Nossa (5)", por("nossa").length === 5 && por("nossa").every((p) => p.bola.rotulo === "Equipe"))
ok("Aguardando terceiros → bola ≠ Nossa (9) — o Cliente conta como terceiro", por("terceiro").length === 9 && por("terceiro").some((p) => p.bola.rotulo === "Cliente"))
ok("Críticas → o balde vermelho: crítico E parado (3)", nomes(por("criticas")).sort().join(",") === "Bertolucci,Martín Manzano,Salvarani")

secao("A BUSCA e o PAÍS (T137, T138)")
ok("busca por família sem acento/maiúsculas: 'martin' acha 'Martín Manzano'", nomes(baseDoRadar(P, TODOS_OS_PAISES, "martin")).join() === "Martín Manzano" && nomes(baseDoRadar(P, TODOS_OS_PAISES, "  ALBUQUERQUE ")).join() === "Albuquerque Dias")
ok("a busca é só no nome da família (não acha pelo código/país)", baseDoRadar(P, TODOS_OS_PAISES, "IT-3").length === 0 && baseDoRadar(P, TODOS_OS_PAISES, "Espanha").length === 0)
ok("País filtra por igualdade: Espanha = 3, Portugal = 2, Alemanha = 1", baseDoRadar(P, "Espanha", "").length === 3 && baseDoRadar(P, "Portugal", "").length === 2 && baseDoRadar(P, "Alemanha", "").length === 1)
ok("País E busca combinam", nomes(baseDoRadar(P, "Itália", "a")).every((n) => /a/i.test(n)) && baseDoRadar(P, "Espanha", "lombardi").length === 0)
ok("as contagens dos botões NÃO mexem com país/busca (como no protótipo); o rodapé é que diz o recorte", JSON.stringify(visaoDoRadar(P, { filtro: "todas", pais: "Espanha", busca: "", ordem: "grave", pagina: 1 }).contagens) === JSON.stringify(contagensDoRadar(P)) && visaoDoRadar(P, { filtro: "todas", pais: "Espanha", busca: "", ordem: "grave", pagina: 1 }).pagina.total === 3)

secao("AS ORDENS (T139–T142)")
ok("as três opções: Mais grave primeiro · Mais tempo na fase · Família A–Z", ORDENS_DO_RADAR.map((o) => o.rotulo).join(" · ") === "Mais grave primeiro · Mais tempo na fase · Família A–Z")
const grave = ordenarRadar(P, "grave")
ok("mais grave: vermelho (crítico/parado) → atenção → no ritmo, e no empate o MAIOR tempo primeiro", nomes(grave.slice(0, 3)).join() === "Martín Manzano,Bertolucci,Salvarani" && nomes(grave.slice(3, 9)).join() === "Ferreira Lopes,Gallo Pereira,Rossetto,Panza,Fogli,Antão (real)", nomes(grave).join(", "))
ok("…e os no ritmo ao fim, também por tempo (Lombardi 123 d antes de Zanella 24 d)", nomes(grave.slice(9)).join() === "Lombardi,Zanella,Albuquerque Dias,Schneider,Navarro Ruiz")
const tempo = ordenarRadar(P, "tempo")
ok("mais tempo na fase: 123 d → 64 d → 52 d … e 8 h (0,33 d) por último, depois de 1 d (h/24)", nomes(tempo).slice(0, 3).join() === "Lombardi,Martín Manzano,Bertolucci" && nomes(tempo).at(-1) === "Antão (real)" && nomes(tempo).at(-2) === "Salvarani")
ok("sem registro de entrada (dias null) vai para o fim", nomes(ordenarRadar([...P, processo({ id: 99, nome: "Sem Registro", naFase: dias(null, null) })], "tempo")).at(-1) === "Sem Registro")
ok("A–Z em pt-BR (acento não desloca: 'Antão' antes de 'Bertolucci', 'Martín' depois de 'Lombardi')", nomes(ordenarRadar(P, "az")).join() === "Albuquerque Dias,Antão (real),Bertolucci,Ferreira Lopes,Fogli,Gallo Pereira,Lombardi,Martín Manzano,Navarro Ruiz,Panza,Rossetto,Salvarani,Schneider,Zanella")
ok("ordenar não muda a lista de entrada", P[0].familiaNome === "Bertolucci")

secao("O RECORTE COMPLETO + PAGINAÇÃO REAL (T164, T167)")
const v = visaoDoRadar(P, { filtro: "precisam", pais: TODOS_OS_PAISES, busca: "", ordem: "grave", pagina: 1 })
ok("padrão: 9 linhas de 9 (precisam de alguém)", v.pagina.itens.length === 9 && v.pagina.total === 9 && v.filtradas.length === 9)
ok("rodapé: 'Mostrando 9 de 9 famílias · ordem: mais grave primeiro'", rodapeDoRadar(v.pagina.itens.length, v.pagina.total, "grave") === "Mostrando 9 de 9 famílias · ordem: mais grave primeiro")
ok("rodapé varia com a ordem e com o filtro", rodapeDoRadar(5, 5, "az") === "Mostrando 5 de 5 famílias · ordem: família a–z" && rodapeDoRadar(1, 1, "tempo") === "Mostrando 1 de 1 família · ordem: mais tempo na fase")
ok("sem resultado: 'Nenhuma família encontrada com esses filtros.' (T166)", rodapeDoRadar(0, 0, "grave") === "Nenhuma família encontrada com esses filtros." && visaoDoRadar(P, { filtro: "criticas", pais: "Alemanha", busca: "", ordem: "grave", pagina: 1 }).pagina.total === 0)
const muitas = Array.from({ length: 30 }, (_, i) => processo({ id: 100 + i, nome: `Fam ${String(i).padStart(2, "0")}`, nivel: "atencao" }))
const p2 = visaoDoRadar(muitas, { filtro: "todas", pais: TODOS_OS_PAISES, busca: "", ordem: "az", pagina: 2 })
ok("paginação real: 30 famílias, 12 por página → página 2 mostra 12, a 3 mostra 6", p2.pagina.itens.length === 12 && p2.pagina.pagina === 2 && p2.pagina.totalPaginas === 3 && visaoDoRadar(muitas, { filtro: "todas", pais: TODOS_OS_PAISES, busca: "", ordem: "az", pagina: 3 }).pagina.itens.length === 6)
ok("a página 2 começa onde a 1 terminou (Fam 12)", p2.pagina.itens[0].familiaNome === "Fam 12" && p2.pagina.de === 13 && p2.pagina.ate === 24)
ok("página fora do intervalo é travada", paginar(muitas, 99).pagina === 3 && paginar(muitas, -4).pagina === 1 && paginar([], 5).totalPaginas === 1)
ok("números de página: até 7 todos; acima, 1 2 … vizinhas … n-1 n", paginasVisiveis(1, 5).join() === "1,2,3,4,5" && paginasVisiveis(1, 36).join() === "1,2,…,35,36" && paginasVisiveis(18, 36).join() === "1,2,…,17,18,19,…,35,36")

secao("A CÉLULA (T147)")
ok("'<bola> · <tempo>' em dias, horas (<1 dia), '—' sem registro e meses a partir de 100 d", textoDaCelulaAtual("Cartório", 52, 1248) === "Cartório · 52 d" && textoDaCelulaAtual("Equipe", 0, 8) === "Equipe · 8 h" && textoDaCelulaAtual("Equipe", null, null) === "Equipe · —" && textoDaCelulaAtual("Consulado", 123, 2952) === "Consulado · 4,1 m")
ok("duração longa por extenso: '4,1 meses'", textoDuracao(123, null) === "4,1 meses" && textoDuracao(99, null) === "99 dias" && textoDuracao(0, 0) === "menos de 1 hora" && textoDuracao(99, null, true) === "99 d" && textoDuracao(0, 0, true) === "< 1 h")

secao("TEXTOS FIXOS DO PROTÓTIPO NA TELA (T128, T143, T144, T166, T168)")
const tela = readFileSync("src/components/torre/TorreRadar.tsx", "utf8")
for (const t of ["Radar · cada família em cada fase", "Torre de Controle", "Buscar família…", "Todos os países", "quem é aguardado", "(Equipe, Cartório, Cliente, Tradutor, Juízo, Consulado) e há quanto tempo. Cor = risco. Clique na família para abrir o processo.", "✓ fase concluída", "no ritmo", "atenção: sem responsável, acompanhamento vencido, perto do prazo", "crítico: atraso nosso + sem dono, divergência, parado 15+ dias", "n/a: fase que essa família não precisa", "(cond.)", "Nenhuma família encontrada com esses filtros."])
  ok(`a tela tem o texto "${t}"`, tela.includes(t) || readFileSync("lib/operacional/torre-radar.ts", "utf8").includes(t))
ok("sem 'exemplo do protótipo' e sem 'Com o cartório'", !/exemplo do prot|Com o cart[oó]rio|Sem ninguém/.test(tela + readFileSync("lib/operacional/torre-radar.ts", "utf8")))
ok("o nome da família é um link para /torre/processo/[id]", /href=\{`\/torre\/processo\/\$\{p\.processoId\}`\}/.test(tela))
ok("todo botão do Radar tem handler", [...tela.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])))

console.log(`\n${passou} verificações ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
