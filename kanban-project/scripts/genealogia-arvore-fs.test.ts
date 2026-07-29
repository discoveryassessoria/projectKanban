/**
 * Árvore — capacidades de navegação e leitura (fidelidade funcional).
 * Rodar: tsx scripts/genealogia-arvore-fs.test.ts
 *
 * Cobre o que foi acrescentado ao motor para a árvore trabalhar como ferramenta
 * genealógica profissional, e não como diagrama:
 *   · colapso/expansão de ramos por ALCANÇABILIDADE (o caso do primo em comum);
 *   · cadeia conjugal com múltiplos casamentos no mesmo slot;
 *   · irmandade classificada (inteiro / meio / a confirmar);
 *   · facetas de sobrenome (agrupadas por fonética) e de localidade.
 */
import { construirGrafo } from "../src/lib/genealogia/motor/grafo"
import { calcularLayout } from "../src/lib/genealogia/layout/layout-familiar"
import { montarFacetas, filtrarFacetas } from "../src/lib/genealogia/motor/facetas"
import { calcularFantasmas, candidatosAFantasma } from "../src/lib/genealogia/layout/fantasmas"
import { montarLinhas } from "../src/components/arvore/motor/vista-descendencia"
import {
  alternarAscendentes,
  alternarRamo,
  aplicarRamos,
  comFronteira,
  fronteiraGeracional,
  PASSO_EXPANSAO,
  contarRecolhidos,
  desserializarRamos,
  expandirAte,
  podeRecolher,
  ramosVazios,
  recolherColaterais,
  serializarRamos,
  temRamoRecolhido,
} from "../src/lib/genealogia/navegacao/ramos"
import type { PessoaEntrada, UniaoEntrada } from "../src/lib/genealogia/motor/tipos"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

function p(
  id: number,
  nome: string,
  extra: Partial<PessoaEntrada> = {},
): PessoaEntrada {
  return { id, nome, ...extra }
}

// ============================================================
// Família base:
//   1 Giovanni ⚭ 2 Maria  →  4 Paulo, 5 Carlo
//   4 Paulo   ⚭ 6 Ana     →  7 Marco
//   Giovanni casa de novo com 3 Rosa → 8 Elena (meio-irmã de Paulo/Carlo)
// ============================================================
const PESSOAS: PessoaEntrada[] = [
  p(1, "Giovanni", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1900-01-01", local_nasc: "Vittorio Veneto", pais_nasc: "Itália" }),
  p(2, "Maria", { sobrenome: "Rossi", sexo: "F", data_nasc: "1902-01-01", local_nasc: "Vittorio Veneto" }),
  p(3, "Rosa", { sobrenome: "Bianqui", sexo: "F", data_nasc: "1910-01-01", local_nasc: "Conegliano" }),
  p(4, "Paulo", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1930-01-01", paiId: 1, maeId: 2, local_nasc: "Caxias do Sul" }),
  p(5, "Carlo", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1932-01-01", paiId: 1, maeId: 2 }),
  p(6, "Ana", { sobrenome: "Souza", sexo: "F", data_nasc: "1934-01-01" }),
  p(7, "Marco", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1960-01-01", paiId: 4, maeId: 6 }),
  p(8, "Elena", { sobrenome: "Bianchy", sexo: "F", data_nasc: "1940-01-01", paiId: 1, maeId: 3 }),
]
const UNIOES: UniaoEntrada[] = [
  { id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1928-05-01", local: "Vittorio Veneto" },
  { id: 2, pessoa1Id: 1, pessoa2Id: 3, data_inicio: "1938-06-01", local: "Conegliano" },
  { id: 3, pessoa1Id: 4, pessoa2Id: 6, data_inicio: "1958-01-01", local: "Caxias do Sul" },
]
const g = construirGrafo(PESSOAS, UNIOES)

// ============================================================
console.log("\n1) Irmandade classificada — meio-irmão não é irmão")
{
  const dePaulo = g.irmandade(4)
  const carlo = dePaulo.find((i) => i.id === 5)
  const elena = dePaulo.find((i) => i.id === 8)

  ok(dePaulo.length === 2, "Paulo tem 2 irmãos derivados da filiação")
  ok(carlo?.tipo === "inteiro", "Carlo é irmão inteiro (mesmo pai e mesma mãe)")
  ok(elena?.tipo === "meio_paterno", "Elena é meia-irmã por parte de pai")
  ok(elena?.viaPaiId === 1 && elena?.viaMaeId === null, "a explicação aponta o genitor em comum")

  // Segundo genitor desconhecido: NÃO se afirma meio-irmão.
  const gDuvida = construirGrafo(
    [p(1, "Pai"), p(2, "A", { paiId: 1, maeId: 9 }), p(3, "B", { paiId: 1 }), p(9, "Mãe A")],
    [],
  )
  const irmandadeDuvida = gDuvida.irmandade(2).find((i) => i.id === 3)
  ok(
    irmandadeDuvida?.tipo === "indeterminado",
    "mãe desconhecida em um dos lados vira 'a confirmar', não 'meio-irmão'",
  )

  ok(
    g.irmandade(4).map((i) => i.id).join(",") === g.irmandade(4).map((i) => i.id).join(","),
    "irmandade é estável entre chamadas (memoizada)",
  )
}

// ============================================================
console.log("\n2) Cadeia conjugal — segundo casamento no mesmo slot")
{
  const ordenados = g.conjugesOrdenados(1)
  ok(ordenados[0] === 2 && ordenados[1] === 3, "cônjuges saem em ordem cronológica de união")

  const layout = calcularLayout(g, {
    orientacao: "vertical",
    densidade: "confortavel",
    larguraNo: 244,
    alturaNo: 76,
  })

  const giovanni = layout.nos.get(1)!
  const maria = layout.nos.get(2)!
  const rosa = layout.nos.get(3)!

  ok(giovanni.camada === maria.camada && maria.camada === rosa.camada, "as três pessoas na mesma camada")

  // Giovanni é o eixo: fica ENTRE as duas esposas.
  const entre =
    (maria.x < giovanni.x && giovanni.x < rosa.x) || (rosa.x < giovanni.x && giovanni.x < maria.x)
  ok(entre, "quem casou duas vezes fica entre as duas famílias")

  // Adjacência real: sem card de outra pessoa no meio do slot.
  const larguraSlot = Math.max(giovanni.x, maria.x, rosa.x) - Math.min(giovanni.x, maria.x, rosa.x)
  ok(larguraSlot < 244 * 3, "a cadeia ocupa um slot contíguo, não se espalha pela camada")

  // Nenhuma sobreposição na camada.
  const naCamada = [...layout.nos.values()].filter((n) => n.camada === giovanni.camada).sort((a, b) => a.x - b.x)
  let sobrepoe = false
  for (let i = 1; i < naCamada.length; i++) {
    if (naCamada[i].x < naCamada[i - 1].x + naCamada[i - 1].largura - 0.01) sobrepoe = true
  }
  ok(!sobrepoe, "cadeia de 3 pessoas sem sobreposição")

  ok(
    layout.barras.length >= 3,
    "as três uniões têm barra desenhada (nenhuma união some no layout)",
  )
  ok(
    layout.barras.every((b) => typeof b.desviada === "boolean"),
    "toda barra declara se precisa contornar cards do meio",
  )
}

// ============================================================
console.log("\n3) Colapso de ramos")
{
  const vazio = ramosVazios()
  ok(!temRamoRecolhido(vazio), "estado inicial não tem ramo recolhido")
  ok(aplicarRamos(g, null, vazio, [7]).visiveis === null, "sem dobra, o conjunto visível não é tocado")

  // Recolher os descendentes de Paulo esconde Marco — visto do topo da árvore.
  const comPaulo = alternarRamo(vazio, 4, "descendentes")
  ok(contarRecolhidos(comPaulo) === 1, "alternar registra o ponto de dobra")
  const r1 = aplicarRamos(g, null, comPaulo, [1])
  ok(r1.visiveis != null && !r1.visiveis.has(7), "Marco fica escondido atrás da dobra de Paulo")
  ok(r1.visiveis != null && r1.visiveis.has(4), "Paulo continua na tela")
  ok(r1.escondidosPorPessoa.get(4)?.descendentes === 1, "a contagem do '+N' bate com o escondido")
  ok(r1.totalEscondidos === 1, "o total escondido é reportado")

  // INVARIANTE: a âncora nunca é escondida por uma dobra. Sumir com a pessoa
  // que está em foco (o requerente, na prática) seria a árvore se apagando
  // debaixo do operador.
  const r1b = aplicarRamos(g, null, comPaulo, [7])
  ok(r1b.visiveis != null && r1b.visiveis.has(7), "a pessoa em foco nunca é escondida por uma dobra")

  // Alternar de volta devolve todo mundo.
  const semPaulo = alternarRamo(comPaulo, 4, "descendentes")
  ok(!temRamoRecolhido(semPaulo), "alternar de novo desfaz a dobra")

  // Recolher os ascendentes de Paulo esconde Giovanni/Maria/Rosa/Elena.
  const asc = alternarRamo(vazio, 4, "ascendentes")
  const r2 = aplicarRamos(g, null, asc, [4])
  ok(r2.visiveis != null && !r2.visiveis.has(1), "dobrar ascendentes esconde o pai")
  ok(r2.visiveis != null && r2.visiveis.has(7), "o descendente continua visível")

  // Ir para alguém escondido reabre SÓ o que atrapalha.
  const reaberto = expandirAte(g, asc, 1)
  ok(!reaberto.ascendentes.has(4), "expandirAte remove a fronteira que escondia o alvo")
  const r3 = aplicarRamos(g, null, reaberto, [4])
  ok(r3.visiveis == null || r3.visiveis.has(1), "depois de expandir, o alvo está na tela")

  ok(podeRecolher(g, 4, "descendentes", null), "Paulo pode ter descendentes recolhidos")
  ok(!podeRecolher(g, 7, "descendentes", null), "Marco (sem filhos) não oferece a dobra")
  ok(podeRecolher(g, 7, "ascendentes", null), "Marco pode ter ascendentes recolhidos")
}

// ============================================================
console.log("\n4) Colapso por alcançabilidade — sem buraco e sem linha solta")
{
  // Primos que se casam (corriqueiro em comune pequena): o Neto desce de
  // Filho A pelo pai e de Filho B pela mãe. Dobrar UM dos ramos não pode
  // sumir com ele — o outro ramo continua aberto e o desenho ficaria com um
  // buraco no meio da família.
  //
  //        Raiz
  //       ╱    ╲
  //   Filho A   Filho B
  //      │         │
  //      └── Neto ─┘   (pai = Filho A, mãe = Nora, filha de Filho B)
  const pessoas: PessoaEntrada[] = [
    p(1, "Raiz"),
    p(2, "Filho A", { paiId: 1 }),
    p(3, "Filho B", { paiId: 1 }),
    p(4, "Neto", { paiId: 2, maeId: 5 }),
    p(5, "Nora", { paiId: 3 }),
  ]
  const gg = construirGrafo(pessoas, [])

  const dobraB = { ascendentes: new Set<number>(), descendentes: new Set<number>([3]), expandidos: new Set<number>() }
  const r = aplicarRamos(gg, null, dobraB, [1])
  ok(
    r.visiveis != null && r.visiveis.has(4),
    "quem tem outro caminho aberto NÃO some ao dobrar um dos ramos",
  )
  // INVARIANTE "sem linha solta": o Neto está na tela, então a MÃE dele
  // também precisa estar — senão o card do filho fica com um conector
  // apontando para o vazio. É por isso que o alcance sobe do filho para o
  // genitor mesmo quando o genitor pertence a um ramo dobrado.
  ok(
    r.visiveis != null && r.visiveis.has(5),
    "o genitor de quem está na tela nunca é escondido (sem conector para o vazio)",
  )

  // Sem caminho alternativo, a dobra esconde de fato.
  const simples = construirGrafo(
    [p(1, "Raiz"), p(2, "Filho", { paiId: 1 }), p(3, "Neto", { paiId: 2 })],
    [],
  )
  const rSimples = aplicarRamos(
    simples,
    null,
    { ascendentes: new Set<number>(), descendentes: new Set<number>([2]), expandidos: new Set<number>() },
    [1],
  )
  ok(rSimples.visiveis != null && !rSimples.visiveis.has(3), "sem caminho alternativo, a dobra esconde")
}

// ============================================================
console.log("\n5) Recolher colaterais preserva a linha")
{
  const linha = [7, 4, 1]
  const sugerido = recolherColaterais(g, linha, 7)
  const r = aplicarRamos(g, null, sugerido, [7, 1])
  for (const id of linha) {
    ok(r.visiveis == null || r.visiveis.has(id), `a linha de cidadania continua visível (#${id})`)
  }
}

// ============================================================
console.log("\n6) Persistência das dobras")
{
  const estado = { ascendentes: new Set([3, 1]), descendentes: new Set([7]), expandidos: new Set<number>() }
  const serial = serializarRamos(estado)
  ok(serial.ascendentes.join(",") === "1,3", "serialização é ordenada (chave estável)")
  const volta = desserializarRamos(JSON.parse(JSON.stringify(serial)))
  ok(volta.ascendentes.has(1) && volta.descendentes.has(7), "desserialização recupera o estado")
  ok(desserializarRamos(null).ascendentes.size === 0, "entrada inválida vira estado vazio, não quebra")
  ok(desserializarRamos({ ascendentes: ["x", 2] }).ascendentes.size === 1, "descarta id não numérico")
}

// ============================================================
console.log("\n7) Facetas — sobrenomes e localidades")
{
  const f = montarFacetas(g, { linhaCidadania: [7, 4, 1] })

  const bianchi = f.sobrenomes.find((s) => s.variantes.some((v) => v.grafia === "Bianchi"))
  ok(!!bianchi, "o sobrenome principal aparece no índice")
  ok(
    !!bianchi && bianchi.variantes.length >= 3,
    "Bianchi/Bianqui/Bianchy caem no MESMO grupo (agrupamento fonético)",
  )
  ok(
    f.sobrenomesComVariacao.some((s) => s.chave === bianchi!.chave),
    "o grupo com mais de uma grafia é sinalizado para conferência",
  )
  ok(bianchi!.naLinha >= 2, "conta quantos do sobrenome estão na linha de cidadania")
  ok(bianchi!.anoDe === 1900 && bianchi!.anoAte === 1960, "o período do sobrenome é o intervalo real")

  const vittorio = f.localidades.find((l) => l.rotulo === "Vittorio Veneto")
  ok(!!vittorio, "localidade de nascimento entra no índice")
  ok(vittorio!.papeis.includes("nascimento"), "o papel do lugar é registrado")
  ok(vittorio!.papeis.includes("casamento"), "um mesmo lugar acumula papéis (nascimento e casamento)")
  ok(vittorio!.total === 2, "conta pessoas distintas, não ocorrências")

  ok(filtrarFacetas(f.sobrenomes, "bianqui").length >= 1, "o filtro do índice acha pela fonética")
  ok(filtrarFacetas(f.localidades, "coneg").length === 1, "o filtro do índice acha por prefixo")
  ok(filtrarFacetas(f.sobrenomes, "").length === f.sobrenomes.length, "filtro vazio devolve tudo")
}

// ============================================================
console.log("\n8) Escala — dobra e facetas continuam baratas")
{
  const N = 2000
  const pessoas: PessoaEntrada[] = []
  for (let i = 1; i <= N; i++) {
    pessoas.push(
      p(i, `Pessoa${i}`, {
        sobrenome: i % 3 === 0 ? "Bianchi" : i % 3 === 1 ? "Rossi" : "Ferrari",
        local_nasc: i % 5 === 0 ? "Napoli" : "Roma",
        paiId: i > 2 ? Math.floor(i / 2) : null,
        data_nasc: `${1800 + Math.floor(i / 20)}-01-01`,
      }),
    )
  }
  const grande = construirGrafo(pessoas, [])

  const t0 = Date.now()
  const facetas = montarFacetas(grande)
  const tFacetas = Date.now() - t0

  const t1 = Date.now()
  const dobra = { ascendentes: new Set<number>(), descendentes: new Set<number>([2, 3, 5, 7, 11]), expandidos: new Set<number>() }
  const res = aplicarRamos(grande, null, dobra, [N])
  const tRamos = Date.now() - t1

  ok(tFacetas < 400, `facetas de ${N} pessoas em ${tFacetas}ms (< 400ms)`)
  ok(tRamos < 400, `colapso em ${N} pessoas em ${tRamos}ms (< 400ms)`)
  ok(facetas.sobrenomes.length === 3, "os 3 sobrenomes distintos são agrupados corretamente")
  ok(res.visiveis != null && res.visiveis.size > 0, "o colapso nunca esvazia a tela")
}

// ============================================================
console.log("\n9) Descendência como sumário (outline)")
{
  const linhas = montarLinhas(g, 1, new Set())
  ok(linhas.length > 0, "a raiz gera a lista")
  ok(linhas[0].pessoaId === 1 && linhas[0].nivel === 0, "a raiz é a primeira linha, no nível 0")

  const paulo = linhas.find((l) => l.pessoaId === 4)!
  const marco = linhas.find((l) => l.pessoaId === 7)!
  // O CÔNJUGE OCUPA LINHA PRÓPRIA e os filhos descem do CASAL — é a leitura da
  // referência (raiz → cônjuge indentado → filhos). O teste antes fixava a
  // indentação anterior, em que o cônjuge era espremido no fim da linha da
  // pessoa e escondia de quem os filhos desciam quando havia mais de uma união.
  const conjugeRaiz = linhas.find((l) => l.tipo === "conjuge")
  ok(!!conjugeRaiz && conjugeRaiz.nivel === 1, "o cônjuge tem linha própria, indentada")
  ok(paulo.nivel === 2, "o filho desce do casal (um nível abaixo do cônjuge)")
  ok(marco.nivel === 4, "o neto acompanha a mesma regra na geração seguinte")
  ok(paulo.temFilhos && paulo.quantosFilhos === 1, "a linha sabe quantos filhos tem")
  ok(paulo.conjugeId === 6, "o cônjuge aparece na mesma linha")
  ok(!marco.temFilhos, "quem não tem filhos não oferece o triângulo")

  // Ordem: a lista tem de sair em pré-ordem (pai antes dos filhos dele).
  const iPaulo = linhas.findIndex((l) => l.pessoaId === 4)
  const iMarco = linhas.findIndex((l) => l.pessoaId === 7)
  ok(iPaulo < iMarco, "pré-ordem: o pai vem antes do próprio filho")

  // Irmãos ordenados por nascimento (Paulo 1930 antes de Carlo 1932).
  const iCarlo = linhas.findIndex((l) => l.pessoaId === 5)
  ok(iPaulo < iCarlo, "irmãos saem em ordem de nascimento")

  // Recolher some com a subárvore, não com a pessoa.
  const recolhido = montarLinhas(g, 1, new Set([4]))
  ok(recolhido.some((l) => l.pessoaId === 4), "a pessoa recolhida continua na lista")
  ok(!recolhido.some((l) => l.pessoaId === 7), "a descendência dela sai da lista")
  ok(
    recolhido.find((l) => l.pessoaId === 4)!.expandida === false,
    "a linha se declara recolhida (para o triângulo virar)",
  )

  ok(montarLinhas(g, null, new Set()).length === 0, "sem raiz, lista vazia (não quebra)")
  ok(montarLinhas(g, 99999, new Set()).length === 0, "raiz inexistente não quebra")

  // Filiação circular não pode virar laço infinito.
  const circular = construirGrafo(
    [p(1, "A", { paiId: 2 }), p(2, "B", { paiId: 1 })],
    [],
  )
  const linhasCirc = montarLinhas(circular, 1, new Set())
  ok(linhasCirc.length <= 2, "filiação em ciclo não gera lista infinita")
}

// ============================================================
console.log("\n10) Slots vagos de ascendente")
{
  const layout = calcularLayout(g, {
    orientacao: "vertical",
    densidade: "confortavel",
    larguraNo: 244,
    alturaNo: 76,
  })

  // Marco (7) tem pai e mãe; Ana (6) não tem nenhum dos dois.
  const candidatos = candidatosAFantasma(g, 7, [7, 4, 1], null)
  ok(candidatos.includes(7), "a pessoa em foco entra como candidata")
  ok(candidatos.includes(1), "os ascendentes do foco entram como candidatos")

  const fantasmas = calcularFantasmas(g, layout, {
    orientacao: "vertical",
    largura: 244,
    altura: 76,
    candidatos: [1],
  })
  ok(fantasmas.length === 2, "quem não tem pai nem mãe ganha os dois slots vagos")
  ok(
    fantasmas.some((f) => f.papel === "pai") && fantasmas.some((f) => f.papel === "mae"),
    "um slot para o pai e um para a mãe",
  )
  const [a, b] = fantasmas.sort((x, y) => x.x - y.x)
  ok(a.papel === "pai" && b.papel === "mae", "convenção: pai à esquerda da mãe")
  ok(b.x - a.x >= 244, "os dois slots não se sobrepõem entre si")

  // Nenhum fantasma pode cair em cima de card real.
  for (const f of fantasmas) {
    let colide = false
    layout.nos.forEach((n) => {
      if (f.x + f.largura <= n.x + 1 || n.x + n.largura <= f.x + 1) return
      if (f.y + f.altura <= n.y + 1 || n.y + n.altura <= f.y + 1) return
      colide = true
    })
    ok(!colide, `slot vago de ${f.papel} não invade card real`)
  }

  // Quem tem os dois genitores não ganha slot nenhum.
  const semLacuna = calcularFantasmas(g, layout, {
    orientacao: "vertical",
    largura: 244,
    altura: 76,
    candidatos: [7],
  })
  ok(semLacuna.length === 0, "quem já tem pai e mãe não recebe '+'")

  // O teto existe para a árvore não virar um campo de "+".
  const muitos = candidatosAFantasma(g, 7, [7, 4, 1], null, 2)
  ok(muitos.length <= 2, "o teto de candidatos é respeitado")
}

// ============================================================
console.log("\n11) Fronteira geracional — a árvore abre legível e cresce a pedido")
{
  // Linha reta de 8 gerações a partir de 1 (1 é filho de 2, 2 de 3, ...).
  const pessoas: PessoaEntrada[] = []
  for (let i = 1; i <= 8; i++) pessoas.push(p(i, `G${i}`, { paiId: i < 8 ? i + 1 : null }))
  const gg = construirGrafo(pessoas, [])

  const semAbrir = new Set<number>()
  const f4 = fronteiraGeracional(gg, 1, 4, semAbrir)
  ok(f4.has(5), "com limite 4, a 5ª pessoa da linha vira a fronteira")
  ok(f4.size === 1, "só a ponta da leitura entra na fronteira")

  const r = aplicarRamos(gg, null, comFronteira(ramosVazios(), f4), [1])
  ok(r.visiveis != null && r.visiveis.has(5), "a pessoa da fronteira aparece (é ela que tem o '+')")
  ok(r.visiveis != null && !r.visiveis.has(6), "o que está além do limite não é desenhado")
  ok(r.escondidosPorPessoa.get(5)?.ascendentes === 3, "o '+N' conta quantos estão além")

  // Clicar no "+" abre mais um bloco a partir dali, não a árvore inteira.
  const aberto = alternarAscendentes(ramosVazios(), 5, f4)
  ok(aberto.expandidos.has(5), "o clique registra a porta aberta")
  const f4b = fronteiraGeracional(gg, 1, 4, aberto.expandidos)
  ok(!f4b.has(5), "quem foi aberto deixa de ser fronteira")
  const r2 = aplicarRamos(gg, null, comFronteira(aberto, f4b), [1])
  // Expandir revela DUAS gerações (a 6ª e a 7ª), não a linha inteira.
  ok(r2.visiveis != null && r2.visiveis.has(7), "o bloco seguinte (2 gerações) entra na tela")
  ok(r2.visiveis != null && !r2.visiveis.has(8), "e para ali — expandir não abre tudo")

  // Fechar de novo devolve ao estado anterior.
  const fechado = alternarAscendentes(aberto, 5, f4b)
  ok(!fechado.expandidos.has(5), "clicar de novo fecha a porta")

  // Sem limite, nada é fronteira.
  ok(fronteiraGeracional(gg, 1, 0, semAbrir).size === 0, "limite 0 = sem fronteira")
  ok(fronteiraGeracional(gg, null, 4, semAbrir).size === 0, "sem foco, sem fronteira")
  ok(fronteiraGeracional(gg, 99999, 4, semAbrir).size === 0, "foco inexistente não quebra")

  // Quem não tem ascendente não vira fronteira (não haveria o que revelar).
  const f8 = fronteiraGeracional(gg, 1, 8, semAbrir)
  ok(!f8.has(8), "quem não tem pai nem mãe nunca ganha '+'")

  // Buscar alguém além do limite tem de trazê-lo para a tela.
  const reaberto = expandirAte(gg, ramosVazios(), 8)
  const f4c = fronteiraGeracional(gg, 1, 4, reaberto.expandidos)
  const r3 = aplicarRamos(gg, null, comFronteira(reaberto, f4c), [1])
  ok(r3.visiveis != null && r3.visiveis.has(8), "ir para alguém além do limite o revela")

  // Persistência guarda as portas abertas.
  const volta = desserializarRamos(JSON.parse(JSON.stringify(serializarRamos(aberto))))
  ok(volta.expandidos.has(5), "as portas abertas sobrevivem ao recarregar")
}

// ============================================================
console.log("\n12) Conformidade com a referência (comportamentos verificados na doc)")
{
  const pessoas: PessoaEntrada[] = []
  for (let i = 1; i <= 12; i++) pessoas.push(p(i, `G${i}`, { paiId: i < 12 ? i + 1 : null }))
  const gg = construirGrafo(pessoas, [])

  // "expand one family line another 2 generations" — o clique revela DUAS,
  // não o bloco inteiro.
  ok(PASSO_EXPANSAO === 2, "o passo de expansão é de 2 gerações")

  const f = fronteiraGeracional(gg, 1, 4, new Set())
  const abriu = alternarAscendentes(ramosVazios(), 5, f)
  const f2 = fronteiraGeracional(gg, 1, 4, abriu.expandidos)
  const r = aplicarRamos(gg, null, comFronteira(abriu, f2), [1])
  ok(r.visiveis != null && r.visiveis.has(7), "após expandir, revela 2 gerações a mais")
  ok(r.visiveis != null && !r.visiveis.has(8), "e para exatamente ali — não abre a árvore toda")
  ok(f2.has(7), "a nova ponta vira a próxima fronteira")

  // Descendência: até 4 gerações, e o limite não mente dizendo "sem filhos".
  const familia: PessoaEntrada[] = [p(1, "Raiz")]
  for (let i = 2; i <= 7; i++) familia.push(p(i, `D${i}`, { paiId: i - 1 }))
  const gd = construirGrafo(familia, [])

  const l4 = montarLinhas(gd, 1, new Set(), 4)
  ok(l4.length === 5, "com 4 gerações, a lista tem raiz + 4 níveis")
  ok(Math.max(...l4.map((l) => l.nivel)) === 4, "nenhuma linha passa do limite")
  const ultima = l4[l4.length - 1]
  ok(ultima.temFilhos, "a última linha admite que tem filhos")
  ok(!ultima.expandida, "e se declara recolhida, para o triângulo continuar servindo")

  const l2 = montarLinhas(gd, 1, new Set(), 2)
  ok(l2.length === 3, "o limite de gerações é respeitado (2 → raiz + 2)")
  ok(montarLinhas(gd, 1, new Set(), 1).length === 2, "limite 1 mostra só os filhos diretos")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ÁRVORE — NAVEGAÇÃO E LEITURA — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
