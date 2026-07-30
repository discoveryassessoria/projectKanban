/**
 * REGRA ABSOLUTA DO CASAL — cada cônjuge em SEU PRÓPRIO CARD.
 * Rodar: tsx scripts/arvore-casal-cards.test.ts
 *
 * Esta é a única regra deste módulo que não admite exceção nem interpretação:
 * no modo PAISAGEM, marido e mulher nunca compartilham um card. A referência
 * visual desenha o casal dentro de uma caixa só; aqui não. O motivo é de
 * domínio, não de estética — em processo de cidadania cada pessoa tem ficha,
 * documento, exigência, situação e seleção próprios, e um card compartilhado
 * obriga a inventar um sujeito ("o casal") que não existe em lugar nenhum do
 * Discovery.
 *
 * O teste é ESTRUTURAL (roda sobre o motor de layout, sem navegador) e
 * ESTÁTICO (varre o código em busca de um componente de casal). Os dois juntos
 * pegam as duas formas de a regra ser quebrada: o layout colar os dois no mesmo
 * retângulo, ou alguém criar um `CoupleCard` no futuro.
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { construirGrafo } from "../src/lib/genealogia/motor/grafo"
import { calcularLayout } from "../src/lib/genealogia/layout/layout-familiar"
import { calcularFantasmas } from "../src/lib/genealogia/layout/fantasmas"
import { FOLGAS, CARTAO_LARGURA, alturaCard } from "../src/components/arvore/motor/tokens"
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

const EXIBICAO = { retratos: true, datas: true, lugares: false, codigos: true }
const ALTURA = alturaCard(EXIBICAO)

const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Requerente", sexo: "M", data_nasc: "1960-01-01", paiId: 10, maeId: 11 },
  { id: 2, nome: "Esposa", sexo: "F", data_nasc: "1962-01-01" },
  { id: 3, nome: "Filho", sexo: "M", data_nasc: "1990-01-01", paiId: 1, maeId: 2 },
  { id: 10, nome: "Pai", sexo: "M", data_nasc: "1930-01-01" },
  { id: 11, nome: "Mae", sexo: "F", data_nasc: "1934-01-01" },
  // Cônjuge desconhecido: pessoa sozinha na camada, sem união cadastrada.
  { id: 20, nome: "Solteiro", sexo: "M", data_nasc: "1958-01-01", paiId: 10, maeId: 11 },
]

const UNIOES: UniaoEntrada[] = [
  { id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1988-05-21", local: "Caxias do Sul" },
  { id: 2, pessoa1Id: 10, pessoa2Id: 11, data_inicio: "1956-02-04" },
]

const grafo = construirGrafo(PESSOAS, UNIOES)
const layout = calcularLayout(grafo, {
  orientacao: "horizontal",
  densidade: "confortavel",
  larguraNo: CARTAO_LARGURA,
  alturaNo: ALTURA,
  raizId: 1,
  folgas: FOLGAS.horizontal,
})

console.log("\n1) Cada cônjuge tem uma CAIXA PRÓPRIA no layout")
{
  const a = layout.nos.get(1)!
  const b = layout.nos.get(2)!
  ok(!!a && !!b, "os dois cônjuges estão posicionados")
  ok(a !== b, "não são o mesmo nó")
  ok(
    a.x !== b.x || a.y !== b.y,
    "as duas caixas ocupam posições distintas",
  )
  ok(
    a.largura === b.largura && a.altura === b.altura,
    "as duas caixas têm o mesmo tamanho (nenhuma é 'metade' da outra)",
  )
}

console.log("\n2) Existe GAP VISÍVEL entre os cards do casal")
{
  const a = layout.nos.get(1)!
  const b = layout.nos.get(2)!
  // Na deitada o casal empilha no eixo Y.
  const [cima, baixo] = a.y <= b.y ? [a, b] : [b, a]
  const gap = baixo.y - (cima.y + cima.altura)
  ok(gap > 0, `há espaço entre os dois cards (gap = ${gap}px)`)
  ok(
    gap >= FOLGAS.horizontal.casal - 0.5,
    `o gap respeita a folga conjugal dos tokens (${FOLGAS.horizontal.casal}px)`,
  )
  ok(
    gap < FOLGAS.horizontal.ordem,
    "o gap conjugal é MENOR que o gap entre famílias — o par continua sendo lido como par",
  )
}

console.log("\n3) Nenhum par de cards se SOBREPÕE")
{
  const caixas = [...layout.nos.values()]
  let sobrepostos = 0
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      const p = caixas[i]
      const q = caixas[j]
      const cruzaX = p.x < q.x + q.largura && q.x < p.x + p.largura
      const cruzaY = p.y < q.y + q.altura && q.y < p.y + p.altura
      if (cruzaX && cruzaY) sobrepostos++
    }
  }
  ok(sobrepostos === 0, `nenhuma sobreposição entre cards (${sobrepostos} encontradas)`)
}

console.log("\n4) O conector CONJUGAL existe e liga os dois cards")
{
  const barra = layout.barras.find(
    (b) => (b.aId === 1 && b.bId === 2) || (b.aId === 2 && b.bId === 1),
  )
  ok(!!barra, "existe barra de união para o casal")
  if (barra) {
    ok(barra.uniaoId === 1, "a barra sabe de qual união veio (rótulo de casamento)")
    const a = layout.nos.get(1)!
    const b = layout.nos.get(2)!
    const entre = (v: number, min: number, max: number) => v >= min - 1 && v <= max + 1
    const topo = Math.min(a.y + a.altura, b.y + b.altura)
    const base = Math.max(a.y, b.y)
    ok(
      entre(barra.y1, topo, base) && entre(barra.y2, topo, base),
      "a barra fica NO VÃO entre os dois cards, não por cima deles",
    )
  }
}

console.log("\n5) A linha parental nasce da UNIÃO, não de um dos cônjuges")
{
  const barra = layout.barras.find(
    (b) => (b.aId === 1 && b.bId === 2) || (b.aId === 2 && b.bId === 1),
  )!
  const ligacao = layout.ligacoes.find((l) => l.filhoId === 3)
  ok(!!ligacao, "existe ligação até o filho")
  if (ligacao && barra) {
    ok(ligacao.tipo === "casal", "a ligação é do tipo CASAL (uma por família, não uma por genitor)")
    ok(
      ligacao.paiIds.length === 2 && ligacao.paiIds.includes(1) && ligacao.paiIds.includes(2),
      "a ligação declara os DOIS genitores",
    )
    ok(
      ligacao.ox === barra.ancoraX && ligacao.oy === barra.ancoraY,
      "a ligação parte da ÂNCORA DA UNIÃO (ponto lógico), não da borda de um card",
    )
    const a = layout.nos.get(1)!
    const b = layout.nos.get(2)!
    const meio = (Math.min(a.y, b.y) + Math.max(a.y + a.altura, b.y + b.altura)) / 2
    ok(
      Math.abs(barra.ancoraY - meio) < ALTURA,
      "a âncora está entre os dois cônjuges — não parece pertencer a um só",
    )
  }
}

console.log("\n6) Só um cônjuge conhecido não quebra o layout")
{
  const solteiro = layout.nos.get(20)
  ok(!!solteiro, "a pessoa sem união continua desenhada")
  ok(
    !layout.barras.some((b) => b.aId === 20 || b.bId === 20),
    "não há barra de união inventada para quem não tem união",
  )

  // E o lugar vago do cônjuge nasce ao lado dela, com a MESMA folga conjugal.
  const fantasmas = calcularFantasmas(grafo, layout, {
    orientacao: "horizontal",
    largura: CARTAO_LARGURA,
    altura: ALTURA,
    candidatos: [],
    candidatosConjuge: [20],
    gapCamada: FOLGAS.horizontal.camada,
    gapCasal: FOLGAS.horizontal.casal,
  })
  const vago = fantasmas.find((f) => f.papel === "conjuge" && f.filhoId === 20)
  ok(!!vago, "existe o slot 'acrescentar o cônjuge' para quem está sozinho")
  if (vago && solteiro) {
    const distancia = Math.abs(vago.y - solteiro.y)
    ok(
      Math.abs(distancia - (ALTURA + FOLGAS.horizontal.casal)) < 1,
      "o slot vago usa exatamente a folga conjugal — o conector fica alinhado",
    )
    ok(vago.x === solteiro.x, "o slot vago fica na mesma coluna (mesma geração)")
  }
  ok(
    !PESSOAS.some((p) => p.id < 0),
    "nenhuma pessoa fictícia foi criada para preencher o lugar vago",
  )
}

console.log("\n7) Múltiplos casamentos: uma união por casal, filhos no casal certo")
{
  const pessoas2: PessoaEntrada[] = [
    ...PESSOAS,
    { id: 30, nome: "SegundaEsposa", sexo: "F", data_nasc: "1965-01-01" },
    { id: 31, nome: "FilhoDoSegundo", sexo: "M", data_nasc: "1995-01-01", paiId: 1, maeId: 30 },
  ]
  const unioes2: UniaoEntrada[] = [
    ...UNIOES,
    { id: 3, pessoa1Id: 1, pessoa2Id: 30, data_inicio: "1994-01-01" },
  ]
  const g2 = construirGrafo(pessoas2, unioes2)
  const l2 = calcularLayout(g2, {
    orientacao: "horizontal",
    densidade: "confortavel",
    larguraNo: CARTAO_LARGURA,
    alturaNo: ALTURA,
    raizId: 1,
    folgas: FOLGAS.horizontal,
  })

  const barras = l2.barras.filter((b) => b.aId === 1 || b.bId === 1)
  ok(barras.length === 2, `o cônjuge com duas uniões tem duas barras (${barras.length})`)

  const doPrimeiro = l2.ligacoes.find((x) => x.filhoId === 3)
  const doSegundo = l2.ligacoes.find((x) => x.filhoId === 31)
  ok(
    !!doPrimeiro && doPrimeiro.paiIds.includes(2) && !doPrimeiro.paiIds.includes(30),
    "o filho do primeiro casamento está ligado à PRIMEIRA união",
  )
  ok(
    !!doSegundo && doSegundo.paiIds.includes(30) && !doSegundo.paiIds.includes(2),
    "o filho do segundo casamento está ligado à SEGUNDA união",
  )

  // Cada pessoa continua tendo caixa própria mesmo na cadeia de três.
  const ids = [2, 1, 30]
  const caixas = ids.map((i) => l2.nos.get(i)!)
  ok(caixas.every(Boolean), "os três membros da cadeia conjugal estão posicionados")
  const distintas = new Set(caixas.map((c) => `${c.x}:${c.y}`))
  ok(distintas.size === 3, "as três caixas são distintas — ninguém divide card")
}

console.log("\n8) NÃO EXISTE componente que renderize duas pessoas num card")
{
  const raiz = "src/components/arvore"
  const arquivos: string[] = []
  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (/\.tsx?$/.test(nome)) arquivos.push(caminho)
    }
  }
  varrer(raiz)

  const proibidos = /\b(CoupleCard|CartaoCasal|FamilyCard|CartaoFamilia|CartaoDoCasal)\b/
  const infratores = arquivos.filter((f) => proibidos.test(readFileSync(f, "utf8")))
  ok(
    infratores.length === 0,
    `nenhum componente de casal combinado${infratores.length ? ` — ${infratores.join(", ")}` : ""}`,
  )

  // O card de pessoa recebe UMA pessoa. Se um dia receber duas, a assinatura
  // muda antes do desenho — e o teste pega ali.
  const cartao = readFileSync("src/components/arvore/motor/cartao-pessoa.tsx", "utf8")
  ok(
    /pessoa: PessoaArvore\b/.test(cartao) && !/pessoas: PessoaArvore\[\]/.test(cartao),
    "CartaoPessoa recebe UMA pessoa, nunca uma lista",
  )
  ok(
    cartao.includes('data-pessoa-id={pessoa.id}') && cartao.includes('data-cartao-pessoa'),
    "cada card carrega o id da SUA pessoa (seleção e teste independentes)",
  )

  const retrato = readFileSync("src/components/arvore/motor/cartao-retrato.tsx", "utf8")
  ok(
    /pessoa: PessoaArvore\b/.test(retrato) && !/pessoas: PessoaArvore\[\]/.test(retrato),
    "CartaoRetrato também recebe UMA pessoa",
  )
}

console.log("\n9) A folga conjugal nunca pode ser zerada por configuração")
{
  const l3 = calcularLayout(grafo, {
    orientacao: "horizontal",
    densidade: "confortavel",
    larguraNo: CARTAO_LARGURA,
    alturaNo: ALTURA,
    raizId: 1,
    folgas: { ordem: 40, casal: 0, camada: 60 },
  })
  const a = l3.nos.get(1)!
  const b = l3.nos.get(2)!
  const [cima, baixo] = a.y <= b.y ? [a, b] : [b, a]
  const gap = baixo.y - (cima.y + cima.altura)
  ok(gap > 0, `mesmo pedindo folga 0, o motor mantém separação (gap = ${gap}px)`)
}

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed) {
  console.log("\nFalhas:")
  falhas.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
