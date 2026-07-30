/**
 * B1 — parentesco, histórico de navegação e indicador documental consumido.
 * Rodar: tsx scripts/genealogia-b1.test.ts
 *
 * Os três módulos são puros de propósito: parentesco e histórico são a lógica
 * que mais apodrece escondida em componente, e o indicador documental é a
 * fronteira com o Sistema Documental — se ela vazar, vaza aqui primeiro.
 */
import { construirGrafo } from "../src/lib/genealogia/motor/grafo"
import { calcularParentesco, caminhoGenealogico } from "../src/lib/genealogia/motor/parentesco"
import {
  estadoInicial,
  navegar,
  voltar,
  avancar,
  podeVoltar,
  podeAvancar,
  atual,
  registrarZoom,
  anteriores,
  type PontoNavegacao,
} from "../src/lib/genealogia/navegacao/historico"
import {
  projetarIndicadores,
  indicadorDaPessoa,
  type NecessidadeOficial,
} from "../src/lib/genealogia/documental/indicadores"
import { calcularVisiveis } from "../src/lib/genealogia/layout/layout-familiar"
import { analisarArvore } from "../src/lib/genealogia/motor/analisar"
import {
  detectarLacunas,
  eventosDaPessoa,
  eventosDeVarios,
  filtrarEventos,
  marcarConflitos,
} from "../src/lib/genealogia/motor/eventos"
import {
  alternarFiltro,
  aplicarFiltros,
  contarAtivos,
  filtrosVazios,
  temFiltroAtivo,
} from "../src/lib/genealogia/navegacao/filtros"
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
// Família de referência
//   40 Giovanni ── 41 Antonietta      (bisavós)
//        ├── 20 Giuseppe ── 21 Rosa   (avós)
//        │      ├── 10 Paulo ── 11 Ana
//        │      │      ├── 1 Marco (requerente)
//        │      │      └── 2 Luiza
//        │      └── 60 Carlo
//        └── 50 Alberto ── 51 Ines
//               └── 70 Bruno
// ============================================================
const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Marco", sexo: "Masculino", paiId: 10, maeId: 11, requerente: "maior" },
  { id: 2, nome: "Luiza", sexo: "Feminino", paiId: 10, maeId: 11 },
  { id: 10, nome: "Paulo", sexo: "Masculino", paiId: 20, maeId: 21 },
  { id: 11, nome: "Ana", sexo: "Feminino" },
  { id: 20, nome: "Giuseppe", sexo: "Masculino", paiId: 40, maeId: 41 },
  { id: 21, nome: "Rosa", sexo: "Feminino" },
  { id: 40, nome: "Giovanni", sexo: "Masculino" },
  { id: 41, nome: "Antonietta", sexo: "Feminino" },
  { id: 50, nome: "Alberto", sexo: "Masculino", paiId: 40, maeId: 41 },
  { id: 51, nome: "Ines", sexo: "Feminino" },
  { id: 60, nome: "Carlo", sexo: "Masculino", paiId: 20, maeId: 21 },
  { id: 70, nome: "Bruno", sexo: "Masculino", paiId: 50, maeId: 51 },
]
const UNIOES: UniaoEntrada[] = [
  { id: 1, pessoa1Id: 10, pessoa2Id: 11 },
  { id: 2, pessoa1Id: 20, pessoa2Id: 21 },
  { id: 3, pessoa1Id: 40, pessoa2Id: 41 },
  { id: 4, pessoa1Id: 50, pessoa2Id: 51 },
]
const g = construirGrafo(PESSOAS, UNIOES)
const rot = (de: number, para: number) => calcularParentesco(g, de, para)?.rotulo ?? null

// ============================================================
console.log("\n1) Parentesco — linha reta")
ok(rot(1, 10) === "pai", "10 é pai de Marco")
ok(rot(1, 11) === "mãe", "11 é mãe de Marco")
ok(rot(1, 20) === "avô", "20 é avô de Marco")
ok(rot(1, 21) === "avó", "21 é avó de Marco")
ok(rot(1, 40) === "bisavô", "40 é bisavô de Marco")
ok(rot(1, 41) === "bisavó", "41 é bisavó de Marco")
ok(rot(40, 1) === "bisneto", "Marco é bisneto de Giovanni")
ok(rot(20, 1) === "neto", "Marco é neto de Giuseppe")
ok(rot(10, 2) === "filha", "Luiza é filha de Paulo")
ok(rot(1, 1) === "esta pessoa", "a própria pessoa é identificada")

console.log("\n2) Parentesco — colaterais")
ok(rot(1, 2) === "irmã", "Luiza é irmã de Marco")
ok(rot(1, 60) === "tio", "Carlo é tio de Marco")
ok(rot(1, 50) === "tio-avô", "Alberto é tio-avô de Marco")
ok(rot(60, 1) === "sobrinho", "Marco é sobrinho de Carlo")
ok(rot(50, 1) === "sobrinho-neto", "Marco é sobrinho-neto de Alberto")
{
  // Alberto e Giuseppe são irmãos ⇒ Paulo e Bruno são primos em 1º grau.
  // Marco é filho de Paulo, então Marco e Bruno são primos em 1º grau com uma
  // geração de diferença ("once removed"). O rótulo precisa dizer as duas coisas.
  const p = calcularParentesco(g, 1, 70)!
  ok(p.acima === 3 && p.abaixo === 2, `distâncias corretas (↑${p.acima} ↓${p.abaixo})`)
  ok(p.rotulo.startsWith("primo em 1º grau"), `grau correto: "${p.rotulo}"`)
  ok(p.rotulo.includes("1ª geração de diferença"), "a diferença de geração é explicitada")
  ok(p.ancestralComumId === 40 || p.ancestralComumId === 41, "ancestral comum é o bisavô")
}

console.log("\n3) Parentesco — cônjuge e afinidade")
ok(rot(10, 11) === "esposa", "11 é esposa de Paulo")
ok(rot(11, 10) === "marido", "10 é marido de Ana")
ok(rot(1, 51) === "cônjuge de tio-avô", "Ines é cônjuge do tio-avô")
{
  const p = calcularParentesco(g, 1, 51)!
  ok(p.porAfinidade === true, "afinidade é sinalizada, não vira sangue")
}
ok(calcularParentesco(g, 1, 999) === null, "pessoa inexistente devolve null")
{
  const solto = construirGrafo([...PESSOAS, { id: 900, nome: "Solto" }], UNIOES)
  ok(calcularParentesco(solto, 1, 900) === null, "sem relação devolve null (não inventa)")
}

console.log("\n4) Parentesco — gênero desconhecido não vira masculino")
{
  const semSexo = construirGrafo(
    [
      { id: 1, nome: "A", paiId: 2 },
      { id: 2, nome: "B" },
    ],
    [],
  )
  const r = calcularParentesco(semSexo, 1, 2)!.rotulo
  ok(r === "pai/mãe", `sem sexo usa forma neutra ("${r}")`)
}

console.log("\n5) Caminho genealógico")
{
  const c = caminhoGenealogico(g, 1, 40)
  ok(c?.join("-") === "1-10-20-40", `caminho até o bisavô: ${c?.join(" → ")}`)
  const lateral = caminhoGenealogico(g, 1, 70)
  ok(!!lateral && lateral[0] === 1 && lateral[lateral.length - 1] === 70, "caminho lateral começa e termina certo")
  ok(!!lateral && lateral.includes(40), "caminho lateral passa pelo ancestral comum")
  ok(caminhoGenealogico(g, 1, 1)?.length === 1, "caminho para si mesmo é trivial")
}

// ============================================================
console.log("\n6) Histórico de navegação")
const ponto = (m: PontoNavegacao["modo"], foco: number | null, sel: number | null, zoom = 1): PontoNavegacao => ({
  modo: m,
  focoId: foco,
  selecionadaId: sel,
  zoom,
  rotulo: `${m}:${foco ?? "-"}:${sel ?? "-"}`,
})

{
  let h = estadoInicial(ponto("completa", null, null))
  ok(!podeVoltar(h) && !podeAvancar(h), "estado inicial não volta nem avança")

  h = navegar(h, ponto("ascendentes", 1, 1))
  h = navegar(h, ponto("familia", 20, 20))
  ok(h.pilha.length === 3 && podeVoltar(h), "três paradas empilhadas")
  ok(!podeAvancar(h), "no fim da pilha não há avanço")

  h = voltar(h)
  ok(atual(h).modo === "ascendentes", "voltar leva à parada anterior")
  ok(podeAvancar(h), "depois de voltar dá para avançar")

  h = avancar(h)
  ok(atual(h).modo === "familia", "avançar retoma a parada seguinte")

  // navegar depois de voltar descarta o futuro
  h = voltar(h)
  h = navegar(h, ponto("descendentes", 40, 40))
  ok(!podeAvancar(h), "navegar após voltar descarta o futuro")
  ok(h.pilha.length === 3, "pilha reescrita a partir do ponto atual")
}

{
  // repetir a mesma parada não duplica entrada
  let h = estadoInicial(ponto("completa", null, null))
  h = navegar(h, ponto("familia", 10, 10))
  h = navegar(h, ponto("familia", 10, 10, 1.8))
  ok(h.pilha.length === 2, "mesma parada não vira entrada nova")
  ok(atual(h).zoom === 1.8, "mas o zoom da parada é atualizado")
}

{
  // zoom sozinho nunca cria parada — senão o voltar vira desfazer de scroll
  let h = estadoInicial(ponto("completa", null, null, 1))
  h = registrarZoom(h, 2.1)
  h = registrarZoom(h, 0.4)
  ok(h.pilha.length === 1, "ajustar zoom não empilha navegação")
  ok(atual(h).zoom === 0.4, "zoom corrente é preservado na parada")
}

{
  // teto da pilha
  let h = estadoInicial(ponto("completa", null, null))
  for (let i = 1; i <= 80; i++) h = navegar(h, ponto("familia", i, i))
  ok(h.pilha.length <= 50, `pilha limitada a 50 (ficou ${h.pilha.length})`)
  ok(atual(h).focoId === 80, "a parada corrente é sempre a última navegada")
  ok(anteriores(h, 5).length === 5, "menu de anteriores devolve o limite pedido")
}

// ============================================================
console.log("\n7) Isolar ramo")
{
  const ramo = calcularVisiveis(g, "ramo", 20, [])!
  ok(ramo.has(20), "ramo inclui a raiz do ramo")
  ok(ramo.has(1) && ramo.has(2) && ramo.has(60), "ramo inclui toda a descendência")
  ok(ramo.has(40) && ramo.has(41), "ramo mantém a subida até a origem (contexto)")
  ok(!ramo.has(70), "ramo NÃO inclui o primo de outro ramo")
  ok(ramo.has(21), "cônjuge da raiz do ramo entra junto")
}

// ============================================================
console.log("\n8) Indicador documental — consumido, não recalculado")
const necessidades: NecessidadeOficial[] = [
  { id: 1, pessoaId: 1, status: "ATENDIDA", obrigatoriedade: "OBRIGATORIA" },
  { id: 2, pessoaId: 1, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA" },
  { id: 3, pessoaId: 1, status: "OPCIONAL" as never, obrigatoriedade: "OPCIONAL" },
  { id: 4, pessoaId: 10, status: "NAO_LOCALIZADA", obrigatoriedade: "OBRIGATORIA" },
  { id: 5, pessoaId: 20, status: "ATENDIDA", obrigatoriedade: "OBRIGATORIA" },
  { id: 6, pessoaId: 20, status: "DISPENSADA", obrigatoriedade: "OBRIGATORIA" },
  { id: 7, uniaoId: 1, status: "EM_ATENDIMENTO", obrigatoriedade: "OBRIGATORIA" },
  { id: 8, pessoaId: null, uniaoId: null, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA" },
]
const proj = projetarIndicadores(necessidades)
{
  const p1 = proj.porPessoa.get(1)!
  ok(p1.necessarias === 2, "conta só obrigatórias no denominador")
  ok(p1.opcionais === 1, "opcional é contada à parte")
  ok(p1.progresso === 50, "progresso 50% (1 de 2)")
  ok(p1.situacao === "pendente", "situação pendente")

  const p10 = proj.porPessoa.get(10)!
  ok(p10.situacao === "bloqueado", "não localizada bloqueia a situação")

  const p20 = proj.porPessoa.get(20)!
  ok(p20.progresso === 100 && p20.situacao === "completo", "dispensada conta como resolvida")

  ok(proj.porUniao.get(1)!.situacao === "em_andamento", "união tem indicador próprio")
  // obrigatórias: 1,2,4,5,6,7,8 = 7 (a 3 é opcional)
  ok(proj.total.necessarias === 7, "consolidado inclui necessidade sem sujeito")
  ok(proj.total.opcionais === 1, "consolidado separa a opcional")
  ok(!proj.porPessoa.has(999), "não inventa sujeito inexistente")
}
{
  // pendência da união aparece nas duas pessoas do casal
  const doPaulo = indicadorDaPessoa(proj, 10, [1])
  ok(doPaulo.necessarias === 2, "indicador da pessoa soma a exigência da união")
  ok(doPaulo.situacao === "bloqueado", "pior situação prevalece no resumo")
  const semNada = indicadorDaPessoa(proj, 777, [])
  ok(semNada.situacao === "sem_exigencia" && semNada.progresso === null, "sujeito sem exigência é neutro")
}
{
  ok(projetarIndicadores(null).total.necessarias === 0, "entrada nula não quebra")
  ok(projetarIndicadores([{ id: 1 } as never]).total.necessarias === 0, "registro malformado é ignorado")
}


// ============================================================
console.log("\n9) Timeline projetada (B4)")
{
  const comEventos = construirGrafo(
    [
      {
        id: 1,
        nome: "Giovanni",
        sexo: "Masculino",
        data_nasc: "1898-03-22",
        local_nasc: "Vicenza",
        pais_nasc: "Itália",
        data_emigracao: "1921-04-01",
        porto_embarque: "Genova",
        data_chegada: "1921-06-14",
        porto_chegada: "Santos",
        navio: "Principessa Mafalda",
        data_naturalizacao: "1955-02-01",
        vivo: false,
        data_obito: "1971-11-04",
      },
      { id: 2, nome: "Antonietta", sexo: "Feminino", data_nasc: "1902-07-08", vivo: false },
      { id: 3, nome: "SemDados", sexo: "Masculino", vivo: false },
    ],
    [{ id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1922-04-30", local: "Sorocaba", cartorio: "1º Ofício" }],
  )
  const ev = eventosDaPessoa(comEventos, 1)
  const tipos = ev.map((e) => e.tipo)
  ok(tipos.includes("nascimento"), "projeta nascimento")
  ok(tipos.includes("emigracao") && tipos.includes("chegada"), "projeta migração")
  ok(tipos.includes("casamento"), "projeta casamento da união")
  ok(tipos.includes("naturalizacao"), "projeta naturalização")
  ok(tipos.includes("obito"), "projeta falecimento")
  ok(ev[0].tipo === "nascimento", "eventos vêm em ordem cronológica")
  ok(ev.every((e) => e.origem.length > 0), "todo evento declara a coluna de origem")
  ok(ev.find((e) => e.tipo === "chegada")?.detalhe?.includes("Mafalda") === true, "navio entra no detalhe")

  // falecida sem data = pendência de pesquisa, não vazio
  const semData = eventosDaPessoa(comEventos, 3)
  const obito = semData.find((e) => e.tipo === "obito")!
  ok(obito.precisao === "ausente", "óbito sem data é 'ausente', não sumido")

  // evento de casal não duplica ao juntar as duas pessoas
  const doCasal = eventosDeVarios(comEventos, [1, 2])
  ok(doCasal.filter((e) => e.tipo === "casamento").length === 1, "casamento aparece uma vez no conjunto")

  // filtros
  ok(filtrarEventos(ev, { tipos: new Set(["obito"] as const) }).length === 1, "filtro por tipo")
  ok(filtrarEventos(ev, { anoDe: 1950 }).every((e) => (e.ano ?? 9999) >= 1950), "filtro por período")
  ok(filtrarEventos(semData, { incluirSemData: false }).length === 0, "pode esconder eventos sem data")

  // lacunas
  const lac = detectarLacunas(ev, 25)
  ok(lac.some((l) => l.anos >= 25), "detecta lacuna cronológica longa")

  // conflito é marcado, não corrigido
  const marcados = marcarConflitos(ev, new Set([1]))
  ok(marcados.some((e) => e.precisao === "conflito"), "conflito é sinalizado no evento")
  ok(marcados.length === ev.length, "marcar conflito não cria nem remove evento")
}

// ============================================================
console.log("\n10) Filtros avançados (B6)")
{
  const ctxAnalise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 1 })
  const ctx = {
    grafo: ctxAnalise.grafo,
    analise: ctxAnalise,
    documental: projetarIndicadores([
      { id: 1, pessoaId: 20, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA" },
    ]),
  }
  const base = { ...filtrosVazios(), referenciaId: 1 }

  ok(aplicarFiltros(ctx, base).size === PESSOAS.length, "sem filtro, todos casam")

  const soRequerentes = aplicarFiltros(ctx, alternarFiltro(base, "requerentes"))
  ok(soRequerentes.size === 1 && soRequerentes.has(1), "filtro de requerentes")

  const ascend = aplicarFiltros(ctx, alternarFiltro(base, "ascendentes"))
  ok(ascend.has(40) && !ascend.has(2), "ascendentes do requerente (irmã fora)")

  const pend = aplicarFiltros(ctx, alternarFiltro(base, "pendencia_documental"))
  ok(pend.size === 1 && pend.has(20), "pendência documental vem do Sistema Documental")

  const ramo = aplicarFiltros(ctx, { ...base, ramoId: 50 })
  ok(ramo.has(50) && ramo.has(70) && !ramo.has(1), "filtro por ramo")

  const ger = aplicarFiltros(ctx, { ...base, geracao: 1 })
  ok(ger.size > 0 && [...ger].every((id) => ctxAnalise.porPessoa.get(id)?.geracao === 1), "filtro por geração")

  // opostos se anulam
  const vivas = alternarFiltro(base, "vivas")
  const depois = alternarFiltro(vivas, "falecidas")
  ok(!depois.chaves.has("vivas") && depois.chaves.has("falecidas"), "ligar o oposto desliga o anterior")
  ok(contarAtivos(depois) === 1, "contagem de filtros ativos")
  ok(temFiltroAtivo(base) === false, "estado vazio não é filtro ativo")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} B1+B2+B4+B6 — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
