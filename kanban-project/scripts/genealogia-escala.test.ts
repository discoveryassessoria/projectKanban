/**
 * Árvore Genealógica — escala e memória. Rodar: tsx scripts/genealogia-escala.test.ts
 *
 * Mede o que decide se a árvore aguenta um acervo real de escritório:
 * custo do índice, da análise e do layout em 5.000 e 10.000 pessoas, memória
 * retida, e — o item que mais importa — quantos cartões a VIRTUALIZAÇÃO
 * realmente monta numa viewport de trabalho.
 *
 * Executar com --expose-gc dá números de memória confiáveis:
 *   npx tsx --expose-gc scripts/genealogia-escala.test.ts
 */
import { construirGrafo } from "../src/lib/genealogia/motor/grafo"
import { analisarArvore } from "../src/lib/genealogia/motor/analisar"
import { montarIndice, buscar } from "../src/lib/genealogia/motor/busca"
import { calcularLayout } from "../src/lib/genealogia/layout/layout-familiar"
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

const SOBRENOMES = [
  "Bianchi", "Rossi", "Ferrari", "Esposito", "Romano", "Silva", "Souza", "Costa",
  "Oliveira", "Pereira", "Schmidt", "Müller", "Fernández", "García", "Almeida",
  "Conti", "Greco", "Lombardi", "Moretti", "Barbosa",
]
const NOMES = [
  "Giovanni", "Giuseppe", "Antonio", "Maria", "Anna", "Francesco", "Luigi",
  "Rosa", "Carmela", "Paulo", "João", "Ana", "Teresa", "Vincenzo", "Domenico",
]

/**
 * Gera uma árvore realista: linhagem profunda + irmandades largas + colaterais
 * com descendência própria. Nada de árvore binária perfeita, que é o caso fácil.
 */
function gerarArvore(alvo: number): { pessoas: PessoaEntrada[]; unioes: UniaoEntrada[] } {
  const pessoas: PessoaEntrada[] = []
  const unioes: UniaoEntrada[] = []
  let id = 1
  // gerador determinístico — o teste não pode variar entre execuções
  let semente = 42
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff
    return semente / 0x7fffffff
  }

  interface Casal { paiId: number; maeId: number; anoBase: number }
  let geracaoAtual: Casal[] = []

  const criarPessoa = (sexo: string, ano: number, ger: number, paiId?: number, maeId?: number) => {
    const p: PessoaEntrada = {
      id: id++,
      nome: NOMES[Math.floor(rnd() * NOMES.length)],
      sobrenome: SOBRENOMES[Math.floor(rnd() * SOBRENOMES.length)],
      sexo,
      data_nasc: `${ano}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
      local_nasc: rnd() > 0.3 ? ["Vicenza", "Napoli", "São Paulo", "Santos", "Porto"][Math.floor(rnd() * 5)] : null,
      pais_nasc: ger > 4 ? "Itália" : "Brasil",
      vivo: ger > 1 ? false : true,
      paiId: paiId ?? null,
      maeId: maeId ?? null,
    }
    if (p.vivo === false) p.data_obito = `${ano + 60 + Math.floor(rnd() * 25)}-01-01`
    pessoas.push(p)
    return p.id
  }

  // raiz: 3 casais fundadores
  for (let i = 0; i < 3; i++) {
    const paiId = criarPessoa("Masculino", 1840 + Math.floor(rnd() * 10), 8)
    const maeId = criarPessoa("Feminino", 1845 + Math.floor(rnd() * 10), 8)
    unioes.push({ id: unioes.length + 1, pessoa1Id: paiId, pessoa2Id: maeId, data_inicio: `1868-01-01`, local: "Vicenza" })
    geracaoAtual.push({ paiId, maeId, anoBase: 1870 })
  }

  let ger = 7
  let rodadas = 0
  while (pessoas.length < alvo && rodadas < 40) {
    rodadas++
    const proxima: Casal[] = []
    for (const casal of geracaoAtual) {
      if (pessoas.length >= alvo) break
      const nFilhos = 2 + Math.floor(rnd() * 4) // 2 a 5 filhos
      for (let f = 0; f < nFilhos && pessoas.length < alvo; f++) {
        const sexo = rnd() > 0.5 ? "Masculino" : "Feminino"
        const ano = casal.anoBase + 25 + Math.floor(rnd() * 8)
        const filhoId = criarPessoa(sexo, ano, ger, casal.paiId, casal.maeId)

        // ~65% casam e continuam a linha
        if (rnd() < 0.65 && pessoas.length < alvo) {
          const conjugeId = criarPessoa(sexo === "Masculino" ? "Feminino" : "Masculino", ano + 2, ger)
          unioes.push({
            id: unioes.length + 1,
            pessoa1Id: sexo === "Masculino" ? filhoId : conjugeId,
            pessoa2Id: sexo === "Masculino" ? conjugeId : filhoId,
            data_inicio: `${ano + 24}-01-01`,
            local: "São Paulo",
          })
          proxima.push({
            paiId: sexo === "Masculino" ? filhoId : conjugeId,
            maeId: sexo === "Masculino" ? conjugeId : filhoId,
            anoBase: ano + 25,
          })
        }
      }
    }
    geracaoAtual = proxima
    ger = Math.max(1, ger - 1)
    if (proxima.length === 0) {
      // linhagem esgotou antes do alvo: abre uma nova frente a partir de um
      // casal já existente, que é o que acontece numa família real grande.
      const base = pessoas.find((p) => p.sexo === "Masculino" && !!p.data_nasc)
      if (!base) break
      const paiId = criarPessoa("Masculino", 1900, 3)
      const maeId = criarPessoa("Feminino", 1902, 3)
      unioes.push({ id: unioes.length + 1, pessoa1Id: paiId, pessoa2Id: maeId, data_inicio: "1925-01-01" })
      geracaoAtual = [{ paiId, maeId, anoBase: 1926 }]
    }
  }

  // requerente = a pessoa mais nova
  const maisNova = pessoas[pessoas.length - 1]
  maisNova.requerente = "maior"
  return { pessoas, unioes }
}

const gc = (globalThis as { gc?: () => void }).gc
function memoriaMB(): number {
  gc?.()
  return process.memoryUsage().heapUsed / 1024 / 1024
}

function medir<T>(rotulo: string, f: () => T): { valor: T; ms: number } {
  const t0 = Date.now()
  const valor = f()
  const ms = Date.now() - t0
  console.log(`     ${rotulo}: ${ms}ms`)
  return { valor, ms }
}

/** Réplica da virtualização do canvas: quantos cartões entram na viewport. */
function contarVirtualizados(
  nos: Map<number, { x: number; y: number; largura: number; altura: number }>,
  viewport: { largura: number; altura: number },
  k: number,
  margem = 320,
): number {
  // Centraliza sobre um NÓ real. Usar o centro geométrico da árvore mede um
  // vão vazio e devolve "0 cartões" — número bonito e mentiroso.
  const lista = [...nos.values()].sort((a, b) => a.y - b.y || a.x - b.x)
  const alvo = lista[Math.floor(lista.length / 2)]
  const area = {
    x: alvo.x - (viewport.largura / 2 + margem) / k,
    y: alvo.y - (viewport.altura / 2 + margem) / k,
    largura: (viewport.largura + margem * 2) / k,
    altura: (viewport.altura + margem * 2) / k,
  }
  let n = 0
  nos.forEach((no) => {
    if (
      no.x + no.largura >= area.x &&
      no.x <= area.x + area.largura &&
      no.y + no.altura >= area.y &&
      no.y <= area.y + area.altura
    ) {
      n++
    }
  })
  return n
}

const OPTS = {
  orientacao: "vertical" as const,
  densidade: "confortavel" as const,
  larguraNo: 232,
  alturaNo: 96,
}

for (const alvo of [5000, 10000]) {
  console.log(`\n=== ${alvo} pessoas ===`)
  const memInicial = memoriaMB()
  const { pessoas, unioes } = gerarArvore(alvo)
  console.log(`     geradas ${pessoas.length} pessoas, ${unioes.length} uniões`)
  ok(pessoas.length >= alvo * 0.95, `árvore com ${pessoas.length} pessoas (alvo ${alvo})`)

  const { valor: grafo, ms: msGrafo } = medir("índice do grafo", () => construirGrafo(pessoas, unioes))
  const { valor: analise, ms: msAnalise } = medir("análise completa", () =>
    analisarArvore(pessoas, unioes, { paisAlvo: "ITALIA", raizId: pessoas[pessoas.length - 1].id }),
  )
  const { valor: layout, ms: msLayout } = medir("layout", () =>
    calcularLayout(grafo, { ...OPTS, raizId: pessoas[pessoas.length - 1].id }),
  )
  const { valor: indice, ms: msIndice } = medir("índice de busca", () => montarIndice(grafo, analise))
  const { ms: msBusca } = medir("busca difusa", () => buscar(indice, "giovani rossi"))

  const memFinal = memoriaMB()
  const retido = memFinal - memInicial
  console.log(`     memória retida: ${retido.toFixed(1)} MB (heap ${memFinal.toFixed(1)} MB)`)

  // Orçamento: a análise roda UMA vez por carga de dados, não por render.
  ok(msGrafo < 400, `índice em ${msGrafo}ms (< 400ms)`)
  ok(msAnalise < 8000, `análise em ${msAnalise}ms (< 8s, roda 1× por carga)`)
  ok(msLayout < 1200, `layout em ${msLayout}ms (< 1,2s — recalcula ao trocar de modo)`)
  ok(msIndice < 2000, `índice de busca em ${msIndice}ms (< 2s)`)
  ok(msBusca < 250, `busca difusa em ${msBusca}ms (< 250ms — é por tecla digitada)`)
  ok(layout.nos.size === pessoas.length, "todas as pessoas posicionadas")
  ok(retido < alvo * 0.09, `memória retida ${retido.toFixed(1)}MB (< ${(alvo * 0.09).toFixed(0)}MB)`)

  // ---- virtualização: o número que decide o FPS ----
  for (const [rotulo, k] of [
    ["100%", 1],
    ["50%", 0.5],
    ["25%", 0.25],
  ] as const) {
    const montados = contarVirtualizados(layout.nos, { largura: 1600, altura: 900 }, k)
    const pct = ((montados / layout.nos.size) * 100).toFixed(1)
    console.log(`     zoom ${rotulo}: ${montados} cartões montados (${pct}% do total)`)
    ok(
      montados < 900,
      `zoom ${rotulo}: ${montados} cartões no DOM (< 900; sem virtualização seriam ${layout.nos.size})`,
    )
  }

  // ---- pan: mover a câmera não pode recalcular layout nem análise ----
  const t0 = Date.now()
  for (let i = 0; i < 240; i++) {
    contarVirtualizados(layout.nos, { largura: 1600, altura: 900 }, 1)
  }
  const msPan = (Date.now() - t0) / 240
  console.log(`     recálculo de visíveis: ${msPan.toFixed(2)}ms por publicação`)
  ok(msPan < 8, `varredura de visíveis em ${msPan.toFixed(2)}ms (< 8ms por publicação de câmera)`)

  // ---- não-sobreposição por camada ----
  const porCamada = new Map<number, Array<{ x: number; largura: number }>>()
  layout.nos.forEach((n) => {
    const arr = porCamada.get(n.camada) || []
    arr.push({ x: n.x, largura: n.largura })
    porCamada.set(n.camada, arr)
  })
  let colisoes = 0
  porCamada.forEach((arr) => {
    arr.sort((a, b) => a.x - b.x)
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].x < arr[i - 1].x + arr[i - 1].largura - 0.01) colisoes++
    }
  })
  ok(colisoes === 0, `zero sobreposição em ${layout.nos.size} pessoas`)

  // ---- tetos de saída respeitados ----
  const totalReal = Object.values(analise.totais).reduce((a, b) => a + b, 0)
  console.log(`     achados: ${analise.insights.length} exibidos de ${totalReal} reais`)
  ok(analise.insights.length <= 1200, `lista de exibição limitada (${analise.insights.length} de ${totalReal})`)
  ok(totalReal >= analise.insights.length, "totais refletem o que existe antes do corte")
  ok(analise.truncado === analise.insights.length < totalReal, "flag de truncamento coerente")
  // O corte não pode apagar categoria inteira: risco/conflito precisam sobreviver
  const categoriasExibidas = new Set(analise.insights.map((i) => i.categoria))
  const categoriasReais = Object.entries(analise.totais).filter(([, n]) => n > 0).map(([c]) => c)
  ok(
    categoriasReais.every((c) => categoriasExibidas.has(c as never)),
    "nenhuma categoria some por causa do corte",
  )
  ok(analise.proximosPassos.length <= 8, "próximos passos ≤ 8")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ESCALA DA ÁRVORE — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
