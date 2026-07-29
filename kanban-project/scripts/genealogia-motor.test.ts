/**
 * Motor Genealógico — testes de regra pura (sem DOM, sem banco).
 * Rodar: tsx scripts/genealogia-motor.test.ts
 *
 * Cobre: normalização/fonética, índice do grafo, conflitos cronológicos,
 * duplicidade (inclusive os falsos positivos que NÃO podem acontecer),
 * linha de cidadania, completude, busca difusa e o layout (não-sobreposição,
 * ordem de gerações, determinismo e custo com árvore grande).
 */
import {
  chaveFonetica,
  jaroWinkler,
  levenshtein,
  normalizar,
  pontuarBusca,
  similaridadeNome,
  anosEntre,
} from "../src/lib/genealogia/motor/texto"
import { construirGrafo } from "../src/lib/genealogia/motor/grafo"
import { analisarArvore } from "../src/lib/genealogia/motor/analisar"
import { buscar, montarIndice } from "../src/lib/genealogia/motor/busca"
import { calcularLayout, calcularVisiveis } from "../src/lib/genealogia/layout/layout-familiar"
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

// ============================================================
// 1. TEXTO — a base de toda comparação
// ============================================================
console.log("\n1) Texto, fonética e distância")
ok(normalizar("São Gonçalo—RJ") === "SAO GONCALO RJ", "normalizar remove acento e pontuação")
ok(chaveFonetica("Bianchi") === chaveFonetica("Bianqui"), "Bianchi ≡ Bianqui (fonética)")
ok(chaveFonetica("Sousa") === chaveFonetica("Souza"), "Sousa ≡ Souza")
ok(chaveFonetica("Schmidt") === chaveFonetica("Schmitt"), "Schmidt ≡ Schmitt")
ok(chaveFonetica("Rossi") === chaveFonetica("Rosi"), "Rossi ≡ Rosi (letra dobrada)")
ok(chaveFonetica("Ferrari") !== chaveFonetica("Bianchi"), "sobrenomes distintos não colidem")
ok(levenshtein("giovanni", "giovani") === 1, "levenshtein conta 1 edição")
ok(levenshtein("abc", "xyz", 1) > 1, "levenshtein corta cedo acima do limite")
ok(jaroWinkler("marco", "marcos") > 0.9, "jaro-winkler premia prefixo comum")
ok(similaridadeNome("Giuseppe", "Jusepe") > 0.6, "similaridade combina orto+fonética")
ok(pontuarBusca("gio", "Maria Giovanna") > 0, "busca acha prefixo de palavra interna")
ok(pontuarBusca("giovani", "Giovanni") > 0.6, "busca tolera erro de digitação")
ok(pontuarBusca("xyzw", "Giovanni") === 0, "busca não inventa correspondência")
ok(Math.round(anosEntre("1900-01-01", "1930-01-01")!) === 30, "anosEntre calcula 30 anos")

// ============================================================
// 2. GRAFO — índice O(1) e travessias
// ============================================================
console.log("\n2) Grafo indexado")
const familia: PessoaEntrada[] = [
  { id: 1, nome: "Marco", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1990-05-10", paiId: 2, maeId: 3, pais_nasc: "Brasil", requerente: "maior" },
  { id: 2, nome: "Paulo", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1960-03-02", paiId: 4, maeId: 5, pais_nasc: "Brasil" },
  { id: 3, nome: "Ana", sobrenome: "Souza", sexo: "Feminino", data_nasc: "1962-07-20", pais_nasc: "Brasil" },
  { id: 4, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1925-01-15", pais_nasc: "Itália", nacionalidade: "Italiana", vivo: false, data_obito: "1998-02-01" },
  { id: 5, nome: "Maria", sobrenome: "Rossi", sexo: "Feminino", data_nasc: "1930-09-09", pais_nasc: "Itália" },
  { id: 6, nome: "Julia", sobrenome: "Bianchi", sexo: "Feminino", data_nasc: "1993-11-01", paiId: 2, maeId: 3, pais_nasc: "Brasil" },
]
const unioes: UniaoEntrada[] = [
  { id: 10, pessoa1Id: 2, pessoa2Id: 3, data_inicio: "1988-06-01", local: "São Paulo", tipo: "casamento" },
  { id: 11, pessoa1Id: 4, pessoa2Id: 5, data_inicio: "1955-04-10", local: "Napoli", tipo: "casamento" },
]
const g = construirGrafo(familia, unioes)

ok(g.pai(1)?.id === 2 && g.mae(1)?.id === 3, "pai/mãe resolvidos em O(1)")
ok(g.filhosIds(2).sort().join(",") === "1,6", "filhos indexados")
ok(g.irmaosIds(1).includes(6), "irmandade derivada dos pais")
ok(g.conjugesIds(2).includes(3), "cônjuge pela união")
ok(g.casal(4, 5)?.filhos.includes(2) === true, "casal conhece os próprios filhos")
ok(g.ancestrais(1).size === 4, "4 ascendentes de Marco")
ok(g.descendentes(4).size === 3, "Giovanni tem 3 descendentes (Paulo, Marco, Julia)")
ok(g.caminhoAscendente(1, 4)?.join("-") === "1-2-4", "caminho ascendente mais curto")
ok(g.caminhoAscendente(4, 1) === null, "não existe caminho ascendente invertido")

// união órfã não pode quebrar nada
const gOrfao = construirGrafo(familia, [...unioes, { id: 99, pessoa1Id: 4, pessoa2Id: 777 }])
ok(gOrfao.unioes.length === 2, "união apontando para pessoa inexistente é descartada")

// ============================================================
// 3. CRONOLOGIA — cada conflito precisa disparar
// ============================================================
console.log("\n3) Conflitos cronológicos")
function conflitos(pessoas: PessoaEntrada[], us: UniaoEntrada[] = []) {
  return analisarArvore(pessoas, us, { raizId: pessoas[0]?.id }).insights.filter(
    (i) => i.categoria === "conflito",
  )
}

ok(
  conflitos([
    { id: 1, nome: "X", data_nasc: "1950-01-01", data_obito: "1940-01-01" },
  ]).some((i) => i.id.startsWith("cron-obito-antes")),
  "óbito anterior ao nascimento",
)
ok(
  conflitos([
    { id: 1, nome: "Filho", data_nasc: "1900-01-01", paiId: 2 },
    { id: 2, nome: "Pai", sexo: "Masculino", data_nasc: "1910-01-01" },
  ]).some((i) => i.id.startsWith("cron-parente-mais-novo")),
  "pai mais novo que o filho",
)
ok(
  conflitos([
    { id: 1, nome: "Filho", data_nasc: "1900-01-01", maeId: 2 },
    { id: 2, nome: "Mae", sexo: "Feminino", data_nasc: "1893-01-01" },
  ]).some((i) => i.id.startsWith("cron-parente-jovem")),
  "mãe com 7 anos no parto",
)
ok(
  conflitos([
    { id: 1, nome: "Filho", data_nasc: "1900-01-01", maeId: 2 },
    { id: 2, nome: "Mae", sexo: "Feminino", data_nasc: "1840-01-01" },
  ]).some((i) => i.id.startsWith("cron-parente-velho")),
  "mãe com 60 anos no parto",
)
ok(
  conflitos([
    { id: 1, nome: "Filho", data_nasc: "1902-01-01", maeId: 2 },
    { id: 2, nome: "Mae", sexo: "Feminino", data_nasc: "1870-01-01", data_obito: "1901-01-01" },
  ]).some((i) => i.id.startsWith("cron-postumo")),
  "filho nascido depois do óbito da mãe",
)
ok(
  conflitos([
    { id: 1, nome: "Filho", data_nasc: "1901-03-01", vivo: false, paiId: 2 },
    { id: 2, nome: "Pai", sexo: "Masculino", data_nasc: "1870-01-01", data_obito: "1901-01-01" },
  ]).length === 0,
  "filho póstumo dentro da gestação NÃO é conflito",
)
ok(
  conflitos([{ id: 1, nome: "X", data_nasc: "1870-01-01" }]).some((i) =>
    i.id.startsWith("cron-vivo-improvavel"),
  ),
  "pessoa de 1870 ainda marcada como viva",
)
ok(
  conflitos([{ id: 1, nome: "X", data_nasc: "1800-01-01", data_obito: "1930-01-01" }]).some((i) =>
    i.id.startsWith("cron-longevidade"),
  ),
  "130 anos de vida acusa erro de século",
)
ok(
  conflitos(
    [
      { id: 1, nome: "A", sexo: "Masculino", data_nasc: "1900-01-01", data_obito: "1950-01-01" },
      { id: 2, nome: "B", sexo: "Feminino", data_nasc: "1905-01-01" },
    ],
    [{ id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1960-01-01" }],
  ).some((i) => i.id.startsWith("cron-casou-morto")),
  "casamento depois do óbito",
)
ok(
  conflitos([
    { id: 1, nome: "A", data_nasc: "1900-01-01", data_naturalizacao: "1899-01-01" },
  ]).some((i) => i.id.startsWith("cron-ordem-nascimento-naturalização")),
  "naturalização antes do nascimento",
)
ok(
  conflitos([
    { id: 1, nome: "A", data_nasc: "1900-01-01", data_obito: "1950-01-01", data_naturalizacao: "1960-01-01" },
  ]).some((i) => i.id.startsWith("cron-natz-pos-obito")),
  "naturalização depois do óbito (decide transmissão)",
)
ok(
  conflitos([
    { id: 1, nome: "F1", data_nasc: "1900-01-01", maeId: 3 },
    { id: 2, nome: "F2", data_nasc: "1900-04-01", maeId: 3 },
    { id: 3, nome: "Mae", sexo: "Feminino", data_nasc: "1875-01-01" },
  ]).some((i) => i.id.startsWith("cron-irmaos-proximos")),
  "irmãos com 90 dias de diferença",
)
ok(
  conflitos([
    { id: 1, nome: "G1", data_nasc: "1900-01-01", vivo: false, maeId: 3 },
    { id: 2, nome: "G2", data_nasc: "1900-01-01", vivo: false, maeId: 3 },
    { id: 3, nome: "Mae", sexo: "Feminino", data_nasc: "1875-01-01", vivo: false },
  ]).length === 0,
  "gêmeos (mesma data) NÃO são conflito",
)
ok(conflitos(familia, unioes).length === 0, "árvore consistente não gera falso conflito")

// ============================================================
// 4. DUPLICIDADE — e os falsos positivos proibidos
// ============================================================
console.log("\n4) Duplicidade")
function dups(pessoas: PessoaEntrada[], us: UniaoEntrada[] = []) {
  return analisarArvore(pessoas, us, { raizId: pessoas[0].id }).insights.filter(
    (i) => i.categoria === "duplicidade",
  )
}
ok(
  dups([
    { id: 1, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1900-05-01", local_nasc: "Napoli" },
    { id: 2, nome: "Giovani", sobrenome: "Bianqui", sexo: "Masculino", data_nasc: "1900-05-01", local_nasc: "Napoli" },
  ]).length === 1,
  "mesma pessoa com grafia diferente é apontada",
)
ok(
  dups([
    { id: 1, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1900-01-01" },
    { id: 2, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Feminino", data_nasc: "1900-01-01" },
  ]).length === 0,
  "sexos divergentes derrubam a hipótese",
)
ok(
  dups([
    { id: 1, nome: "Paulo", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1960-01-01", paiId: 2 },
    { id: 2, nome: "Paulo", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1930-01-01" },
  ]).length === 0,
  "pai e filho homônimos NÃO são duplicidade",
)
ok(
  dups([
    { id: 3, nome: "Pai", sexo: "Masculino", data_nasc: "1900-01-01" },
    { id: 1, nome: "Antonio", sobrenome: "Rossi", sexo: "Masculino", data_nasc: "1930-01-01", paiId: 3 },
    { id: 2, nome: "Antonio", sobrenome: "Rossi", sexo: "Masculino", data_nasc: "1932-01-01", paiId: 3 },
  ]).length === 0,
  "irmãos com o mesmo nome NÃO são duplicidade",
)
ok(
  dups([
    { id: 1, nome: "Maria", sobrenome: "Silva", sexo: "Feminino", data_nasc: "1900-01-01" },
    { id: 2, nome: "Maria", sobrenome: "Silva", sexo: "Feminino", data_nasc: "1935-01-01" },
  ]).length === 0,
  "35 anos de diferença derruba a hipótese",
)
ok(
  dups(familia, unioes).length === 0,
  "família consistente não acusa duplicidade",
)

// Sugestão de vínculo não pode brigar com suspeita de duplicidade
{
  const comFicha = analisarArvore(
    [
      { id: 1, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1898-03-22", local_nasc: "Vicenza", pais_nasc: "Itália" },
      { id: 2, nome: "Antonietta", sobrenome: "Bianqui", sexo: "Feminino", data_nasc: "1902-07-08", local_nasc: "Vicenza", pais_nasc: "Itália" },
      { id: 3, nome: "Giovani", sobrenome: "Bianqui", sexo: "Masculino", data_nasc: "1898-03-22", local_nasc: "Vicenza", pais_nasc: "Itália" },
    ],
    [{ id: 1, pessoa1Id: 1, pessoa2Id: 2, tipo: "casamento" }],
    { raizId: 1 },
  )
  ok(
    comFicha.insights.some((i) => i.categoria === "duplicidade" && i.pessoaIds.includes(3)),
    "duplicidade da ficha repetida é apontada",
  )
  ok(
    !comFicha.insights.some((i) => i.id.startsWith("sug-irmao-") && i.pessoaIds.includes(3)),
    "não sugere irmandade com a ficha suspeita de ser repetida do cônjuge",
  )
}

// ============================================================
// 5. LINHA DE CIDADANIA
// ============================================================
console.log("\n5) Linha de cidadania e risco")
const analiseIta = analisarArvore(familia, unioes, { paisAlvo: "ITALIA", raizId: 1 })
ok(analiseIta.danteCausaId === 4, "dante causa = Giovanni (nascido na Itália)")
ok(analiseIta.linhaCidadania.join("-") === "1-2-4", "linha requerente → dante causa")
ok(analiseIta.porPessoa.get(4)!.papel === "dante_causa", "papel dante_causa atribuído")
ok(analiseIta.porPessoa.get(1)!.papel === "requerente", "requerente identificado pelo processo")
ok(analiseIta.porPessoa.get(3)!.naLinhaCidadania === false, "mãe fora da linha italiana")
ok(
  analiseIta.insights.some((i) => i.id === "pesq-naturalizacao-4"),
  "certidão de naturalização do dante causa é exigida",
)

const semItaliano = analisarArvore(
  [{ id: 1, nome: "A", pais_nasc: "Brasil", requerente: "maior" }],
  [],
  { paisAlvo: "ITALIA", raizId: 1 },
)
ok(
  semItaliano.insights.some((i) => i.id === "linha-sem-dante-causa" && i.severidade === "critico"),
  "sem ascendente estrangeiro → risco crítico",
)

const naturalizadoAntes = analisarArvore(
  [
    { id: 1, nome: "Neto", pais_nasc: "Brasil", requerente: "maior", paiId: 2 },
    { id: 2, nome: "Filho", pais_nasc: "Brasil", data_nasc: "1930-01-01", paiId: 3 },
    {
      id: 3,
      nome: "Nono",
      pais_nasc: "Itália",
      data_nasc: "1890-01-01",
      naturalizado: true,
      data_naturalizacao: "1925-01-01",
    },
  ],
  [],
  { paisAlvo: "ITALIA", raizId: 1 },
)
ok(
  naturalizadoAntes.insights.some((i) => i.id === "natz-antes-filho-3" && i.severidade === "critico"),
  "naturalização antes do nascimento do descendente = risco crítico",
)

const linhaQuebrada = analisarArvore(
  [
    { id: 1, nome: "Neto", pais_nasc: "Brasil", requerente: "maior", paiId: 2 },
    { id: 2, nome: "Pai", pais_nasc: "Brasil" },
  ],
  [],
  { paisAlvo: "ITALIA", raizId: 1 },
)
ok(
  linhaQuebrada.insights.some((i) => i.categoria === "risco"),
  "linha sem continuidade vira risco",
)

// sobrenome aportuguesado ao longo da linha
const sobrenomes = analisarArvore(
  [
    { id: 1, nome: "Marco", sobrenome: "Bianqui", pais_nasc: "Brasil", requerente: "maior", paiId: 2 },
    { id: 2, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", pais_nasc: "Itália" },
  ],
  [],
  { paisAlvo: "ITALIA", raizId: 1 },
)
ok(
  sobrenomes.insights.some((i) => i.categoria === "sobrenome"),
  "variação de grafia entre gerações é sinalizada",
)

// ============================================================
// 6. PRIORIZAÇÃO — a linha pesa mais que o colateral
// ============================================================
console.log("\n6) Priorização por impacto na linha")
// Mesma carência exata em duas pessoas: uma na linha, outra colateral.
// O peso tem de ser diferente — senão a priorização é decorativa.
const mesmaCarencia = analisarArvore(
  [
    { id: 1, nome: "Req", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1990-01-01", pais_nasc: "Brasil", requerente: "maior", paiId: 2 },
    { id: 2, nome: "Paulo", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1960-01-01", paiId: 3 },
    { id: 3, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1925-01-01", pais_nasc: "Itália", nacionalidade: "Italiana" },
    { id: 20, nome: "Primo", sobrenome: "Bianchi", sexo: "Masculino", data_nasc: "1962-01-01", paiId: 3 },
  ],
  [],
  { paisAlvo: "ITALIA", raizId: 1 },
)
const semLocalLinha = mesmaCarencia.insights.find((i) => i.id === "pesq-sem-local-2")
const semLocalColateral = mesmaCarencia.insights.find((i) => i.id === "pesq-sem-local-20")
ok(
  !!semLocalLinha && !!semLocalColateral && semLocalLinha.peso > semLocalColateral.peso * 2,
  "mesma carência pesa muito mais na linha que em colateral",
)
ok(
  semLocalLinha!.severidade === "alto" && semLocalColateral!.severidade === "baixo",
  "severidade também acompanha o impacto na linha",
)

const comColateral = analisarArvore(
  [...familia, { id: 20, nome: "Primo", sobrenome: "Bianchi", sexo: "Masculino", paiId: 4 }],
  unioes,
  { paisAlvo: "ITALIA", raizId: 1 },
)
ok(comColateral.proximosPassos.length > 0, "motor entrega próximos passos ordenados")
ok(
  comColateral.proximosPassos.every((p) => !!p.titulo && !!p.motivo),
  "todo passo tem ação e justificativa (nada de item mudo)",
)
ok(
  comColateral.insights.every((i) => !!i.explicacao),
  "todo insight explica o porquê",
)
ok(
  comColateral.qualidade.score >= 0 && comColateral.qualidade.score <= 100,
  "score de qualidade dentro de 0..100",
)
ok(comColateral.gargalos.length > 0, "gargalos identificados")

// ============================================================
// 7. BUSCA
// ============================================================
console.log("\n7) Busca instantânea e difusa")
const indice = montarIndice(analiseIta.grafo, analiseIta)
ok(buscar(indice, "giovani")[0]?.pessoaId === 4, "acha Giovanni com erro de digitação")
ok(buscar(indice, "napoli")[0]?.pessoaId !== undefined, "acha por local de casamento")
ok(buscar(indice, "1925")[0]?.pessoaId === 4, "acha por ano de nascimento")
ok(buscar(indice, "bianchi 1990")[0]?.pessoaId === 1, "multi-termo exige os dois")
ok(buscar(indice, "zzzz").length === 0, "termo inexistente devolve vazio")
ok(buscar(indice, "rossi")[0]?.pessoaId === 5, "acha por sobrenome")
ok(buscar(indice, "").length === 0, "busca vazia não devolve tudo")

// ============================================================
// 8. LAYOUT — não-sobreposição por construção
// ============================================================
console.log("\n8) Layout familiar")
const opts = {
  orientacao: "vertical" as const,
  densidade: "confortavel" as const,
  larguraNo: 220,
  alturaNo: 92,
  raizId: 1,
}
const layout = calcularLayout(analiseIta.grafo, opts)
ok(layout.nos.size === familia.length, "todas as pessoas posicionadas")

function temSobreposicao(l: ReturnType<typeof calcularLayout>): boolean {
  const caixas = [...l.nos.values()]
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      const a = caixas[i]
      const b = caixas[j]
      const ox = Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y)
      if (ox > 0.01 && oy > 0.01) return true
    }
  }
  return false
}
ok(!temSobreposicao(layout), "nenhuma sobreposição de cards")

const yGiovanni = layout.nos.get(4)!.y
const yPaulo = layout.nos.get(2)!.y
const yMarco = layout.nos.get(1)!.y
ok(yGiovanni < yPaulo && yPaulo < yMarco, "ancestral estritamente acima do descendente")
ok(layout.nos.get(4)!.y === layout.nos.get(5)!.y, "cônjuges na mesma camada")
ok(
  Math.abs(layout.nos.get(4)!.x - layout.nos.get(5)!.x) < 320,
  "cônjuges lado a lado (slot único)",
)
ok(layout.barras.length === 2, "duas barras de união desenhadas")
ok(layout.ligacoes.length >= 3, "ligações pai→filho geradas")
ok(layout.ordemPorCamada.length === layout.camadas, "ordem por camada exposta")

// determinismo
const layout2 = calcularLayout(construirGrafo(familia, unioes), opts)
ok(
  JSON.stringify([...layout.nos.entries()]) === JSON.stringify([...layout2.nos.entries()]),
  "layout é determinístico (mesma entrada → mesma saída)",
)

// orientação horizontal
const horiz = calcularLayout(analiseIta.grafo, { ...opts, orientacao: "horizontal" })
ok(!temSobreposicao(horiz), "horizontal também sem sobreposição")
// SENTIDO DA LEITURA DEITADA — corrigido contra a experiência de referência,
// que posiciona os descendentes à ESQUERDA e os ascendentes à DIREITA
// (familysearch.org/en/help/helpcenter/article/what-does-the-landscape-view-do-in-family-tree:
// "You are in the center. Your descendants are to the left. Your ancestors are
// to the right."). O teste anterior fixava exatamente o espelho disso, e por
// isso o defeito passou despercebido até a tela ser fotografada.
ok(
  horiz.nos.get(4)!.x > horiz.nos.get(1)!.x,
  "horizontal: ancestral à DIREITA do descendente",
)

// modos de foco
const soLinha = calcularVisiveis(analiseIta.grafo, "linha", 1, analiseIta.linhaCidadania)!
ok(soLinha.has(1) && soLinha.has(4) && !soLinha.has(6), "modo linha esconde colaterais")
const ascendentes = calcularVisiveis(analiseIta.grafo, "ascendentes", 1, [])!
ok(ascendentes.has(4) && !ascendentes.has(6), "modo ascendentes exclui irmã")
const descendentes = calcularVisiveis(analiseIta.grafo, "descendentes", 4, [])!
ok(descendentes.has(1) && descendentes.has(6), "modo descendentes inclui netos")
const nucleo = calcularVisiveis(analiseIta.grafo, "familia", 1, [])!
ok(nucleo.has(2) && nucleo.has(6) && nucleo.has(4), "modo família traz pais, irmãos e avós")

// pessoa isolada (sem vínculo) não pode sumir nem quebrar
const comIsolada = calcularLayout(
  construirGrafo([...familia, { id: 50, nome: "Sozinha" }], unioes),
  opts,
)
ok(comIsolada.nos.has(50), "pessoa sem vínculo continua no layout")
ok(!temSobreposicao(comIsolada), "pessoa isolada não sobrepõe ninguém")

// ============================================================
// 9. ESCALA — árvore grande sem travar
// ============================================================
console.log("\n9) Escala")
function arvoreGrande(geracoes: number): { pessoas: PessoaEntrada[]; unioes: UniaoEntrada[] } {
  const pessoas: PessoaEntrada[] = []
  const us: UniaoEntrada[] = []
  let id = 1
  let anterior: number[] = []
  for (let ger = 0; ger < geracoes; ger++) {
    const atual: number[] = []
    const qtd = Math.pow(2, ger)
    for (let i = 0; i < qtd; i++) {
      const pai = id++
      const mae = id++
      pessoas.push({
        id: pai,
        nome: `P${pai}`,
        sobrenome: `Fam${ger}`,
        sexo: "Masculino",
        data_nasc: `${1900 - ger * 28}-01-01`,
      })
      pessoas.push({
        id: mae,
        nome: `M${mae}`,
        sobrenome: `Mat${ger}`,
        sexo: "Feminino",
        data_nasc: `${1902 - ger * 28}-01-01`,
      })
      us.push({ id: us.length + 1, pessoa1Id: pai, pessoa2Id: mae })
      if (anterior[i] != null) {
        const filho = pessoas.find((p) => p.id === anterior[i])!
        filho.paiId = pai
        filho.maeId = mae
      }
      atual.push(pai)
    }
    anterior = atual
  }
  return { pessoas, unioes: us }
}

const grande = arvoreGrande(10) // ~2046 pessoas
ok(grande.pessoas.length > 2000, `árvore de teste com ${grande.pessoas.length} pessoas`)

const t0 = Date.now()
const gGrande = construirGrafo(grande.pessoas, grande.unioes)
const tGrafo = Date.now() - t0

const t1 = Date.now()
const analiseGrande = analisarArvore(grande.pessoas, grande.unioes, { raizId: grande.pessoas[0].id })
const tAnalise = Date.now() - t1

const t2 = Date.now()
const layoutGrande = calcularLayout(gGrande, opts)
const tLayout = Date.now() - t2

console.log(`     grafo ${tGrafo}ms · análise ${tAnalise}ms · layout ${tLayout}ms`)
ok(tGrafo < 500, `índice do grafo em ${tGrafo}ms (< 500ms)`)
ok(tAnalise < 2000, `análise completa em ${tAnalise}ms (< 2s no pior caso sintético)`)
ok(tLayout < 300, `layout em ${tLayout}ms (< 300ms)`)
ok(
  analiseGrande.insights.filter((i) => i.categoria === "duplicidade").length <= 150,
  "duplicidades limitadas a 150 (painel útil, não despejo)",
)
ok(
  analiseGrande.insights.filter((i) => i.categoria === "relacao").length <= 200,
  "sugestões limitadas a 200",
)
ok(analiseGrande.proximosPassos.length <= 8, "próximos passos sempre ≤ 8")
ok(layoutGrande.nos.size === grande.pessoas.length, "todas as 2k pessoas posicionadas")
ok(analiseGrande.qualidade.totalPessoas === grande.pessoas.length, "qualidade contabiliza todos")

// amostragem de sobreposição (O(n²) completo em 2k seria o próprio vício que
// estamos removendo — aqui checamos vizinhança por camada, que é o que importa)
let sobrepostosAmostra = 0
const porCamadaCheck = new Map<number, typeof layoutGrande.nos extends Map<number, infer T> ? T[] : never>()
layoutGrande.nos.forEach((n) => {
  const arr = (porCamadaCheck.get(n.camada) || []) as any[]
  arr.push(n)
  porCamadaCheck.set(n.camada, arr as any)
})
porCamadaCheck.forEach((arr: any[]) => {
  arr.sort((a, b) => a.x - b.x)
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].x < arr[i - 1].x + arr[i - 1].largura - 0.01) sobrepostosAmostra++
  }
})
ok(sobrepostosAmostra === 0, "zero sobreposição em 2k pessoas (verificação por camada)")

console.log(`\n${failed === 0 ? "✅" : "❌"} MOTOR GENEALÓGICO — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
