// src/lib/genealogia/motor/linhagens.ts
//
// LINHAGENS — a cadeia de transmissão de CADA requerente, não só do principal.
//
// Por que este módulo existe separado de `regras/linhagem.ts`: aquele resolve UMA
// linha (a do requerente principal) porque é o que a análise geral precisa para
// priorizar. Um processo real tem vários requerentes — irmãos, primos, filhos —
// e cada um tem a sua cadeia até o dante causa. Boa parte dessa cadeia é
// COMPARTILHADA: o mesmo bisavô transmite para os cinco. Quem opera precisa ver
// uma linha por vez sem perder de vista que resolver o bisavô resolve os cinco.
//
// Regras que este módulo respeita e que valem registro:
//
//  • Ele NÃO decide quem é requerente. Lê `Pessoa.requerente`, que é dado do
//    Cadastro Mestre, e o vínculo já materializado. Não infere por idade, nome
//    ou posição na árvore — inferir requerente seria inventar fato.
//
//  • Ele NÃO cria papel novo: reusa `PapelLinha` do motor e a definição de
//    dante causa de `regras/linhagem.ts` (mesmo `ehDoPais`, mesmo critério de
//    "candidato mais próximo"). Duas definições de dante causa seriam duas
//    verdades.
//
//  • Determinístico: mesma árvore → mesmas linhagens, na mesma ordem. Sem rede,
//    sem relógio, sem aleatoriedade. É o que permite testar e memoizar.

import type { GrafoGenealogico } from "./grafo"
import type { PaisAlvo, PapelLinha, PessoaEntrada } from "./tipos"
import { ehDoPais } from "./regras/linhagem"
import { calcularParentesco } from "./parentesco"
import { nomeCompleto } from "./texto"

/** Valores de `Pessoa.requerente` que significam "é requerente deste processo". */
const MARCAS_REQUERENTE = new Set(["sim", "maior", "menor"])

export function ehRequerente(p: PessoaEntrada): boolean {
  return MARCAS_REQUERENTE.has((p.requerente || "").toLowerCase())
}

export interface Linhagem {
  requerenteId: number
  /** Nome já formatado — a UI não precisa reconsultar o grafo para rotular. */
  nome: string
  /** Rótulo do vínculo, como o cadastro o declara ("maior" | "menor" | "sim"). */
  marca: string
  /** Requerente → dante causa, inclusive. Vazia quando não há cadeia. */
  cadeia: number[]
  danteCausaId: number | null
  /** Todos os ids da cadeia — consulta O(1) para o foco. */
  naLinha: Set<number>
  /**
   * Cônjuges de quem está na cadeia. NÃO transmitem, mas a certidão de
   * casamento deles é exigida — esconder o cônjuge esconde metade do dossiê.
   */
  conjugesDaLinha: Set<number>
  /** naLinha ∪ conjugesDaLinha — o que a vista de linhagem mostra em pleno. */
  visivel: Set<number>
  /** Quantas gerações separam o requerente do dante causa. */
  geracoes: number
}

export interface MapaLinhagens {
  /** Uma por requerente, na ordem em que devem aparecer no seletor. */
  linhagens: Linhagem[]
  porRequerente: Map<number, Linhagem>
  /** Pessoa → requerentes que dependem dela. Chave da priorização real. */
  compartilhadas: Map<number, number[]>
  /** União de todas as linhas: quem participa de alguma transmissão. */
  emAlgumaLinha: Set<number>
  /**
   * Quem não influencia nenhuma cidadania: nem na cadeia, nem cônjuge de quem
   * está nela. São os colaterais que poluem a tela sem carregar processo.
   */
  semInfluencia: Set<number>
  /** Papel de cada pessoa considerando TODAS as linhagens (não só a principal). */
  papeis: Map<number, PapelLinha>
}

/**
 * Requerentes da árvore, ordenados de forma estável: primeiro os que têm cadeia
 * mais longa (o caso principal costuma ser o mais mapeado), depois por id.
 * A ordem não pode depender de iteração de Map nem de inserção no banco — o
 * seletor mudaria de ordem entre dois carregamentos da mesma árvore.
 */
export function requerentesDaArvore(g: GrafoGenealogico): PessoaEntrada[] {
  return g.pessoas.filter(ehRequerente)
}

/**
 * Cadeia de transmissão de UM requerente.
 *
 * O dante causa é o ascendente do país-alvo MAIS PRÓXIMO do requerente — é ele
 * que define quantas gerações de documento o processo exige. Sem país-alvo (ou
 * sem ascendente estrangeiro registrado), a cadeia é a ascendência mais profunda:
 * é o melhor que os dados permitem afirmar, e a análise geral já emite o alerta
 * crítico de "nenhum ascendente registrado como nascido no país de origem".
 */
export function calcularLinhagem(
  g: GrafoGenealogico,
  requerenteId: number,
  paisAlvo: PaisAlvo | null,
): Linhagem {
  const pessoa = g.pessoa(requerenteId)
  const base: Linhagem = {
    requerenteId,
    nome: pessoa ? nomeCompleto(pessoa) : `#${requerenteId}`,
    marca: (pessoa?.requerente || "").toLowerCase(),
    cadeia: [],
    danteCausaId: null,
    naLinha: new Set(),
    conjugesDaLinha: new Set(),
    visivel: new Set(),
    geracoes: 0,
  }
  if (!pessoa) return base

  let cadeia: number[] = [requerenteId]
  let danteCausaId: number | null = null

  if (paisAlvo) {
    let melhor = Infinity
    // Ordenar os candidatos por id antes de medir mantém o desempate estável
    // quando dois ascendentes estão à mesma distância.
    const candidatos = [...g.ancestrais(requerenteId)].sort((a, b) => a - b)
    for (const id of candidatos) {
      const cand = g.pessoa(id)
      if (!cand || !ehDoPais(cand, paisAlvo)) continue
      const caminho = g.caminhoAscendente(requerenteId, id)
      if (caminho && caminho.length < melhor) {
        melhor = caminho.length
        danteCausaId = id
        cadeia = caminho
      }
    }
  }

  if (!danteCausaId) {
    cadeia = ascendenciaMaisProfunda(g, requerenteId)
    danteCausaId = cadeia.length > 1 ? cadeia[cadeia.length - 1] : null
  }

  const naLinha = new Set(cadeia)
  const conjugesDaLinha = new Set<number>()
  for (const id of cadeia) {
    for (const c of g.conjugesIds(id)) {
      if (!naLinha.has(c)) conjugesDaLinha.add(c)
    }
  }

  return {
    ...base,
    cadeia,
    danteCausaId,
    naLinha,
    conjugesDaLinha,
    visivel: new Set([...naLinha, ...conjugesDaLinha]),
    geracoes: Math.max(0, cadeia.length - 1),
  }
}

/**
 * Todas as linhagens da árvore, mais o que só se enxerga olhando o conjunto:
 * quem é compartilhado entre requerentes e quem não influencia ninguém.
 *
 * Quando a árvore não tem NENHUM requerente marcado, cai numa linhagem só, a
 * partir da raiz informada — a árvore não fica sem linha por falta de cadastro.
 */
export function mapaDeLinhagens(
  g: GrafoGenealogico,
  paisAlvo: PaisAlvo | null,
  raizId: number | null = null,
): MapaLinhagens {
  const requerentes = requerentesDaArvore(g)
  const alvos = requerentes.length
    ? requerentes.map((p) => p.id)
    : raizId != null && g.existe(raizId)
      ? [raizId]
      : []

  const linhagens = alvos
    .map((id) => calcularLinhagem(g, id, paisAlvo))
    // Mais gerações primeiro (a linha mais mapeada abre por padrão); id desempata.
    .sort((a, b) => b.geracoes - a.geracoes || a.requerenteId - b.requerenteId)

  const porRequerente = new Map<number, Linhagem>()
  const compartilhadas = new Map<number, number[]>()
  const emAlgumaLinha = new Set<number>()

  for (const l of linhagens) {
    porRequerente.set(l.requerenteId, l)
    for (const id of l.cadeia) {
      emAlgumaLinha.add(id)
      const lista = compartilhadas.get(id)
      if (lista) lista.push(l.requerenteId)
      else compartilhadas.set(id, [l.requerenteId])
    }
  }

  const papeis = new Map<number, PapelLinha>()
  const danteCausas = new Set(
    linhagens.map((l) => l.danteCausaId).filter((x): x is number => x != null),
  )
  const requerenteIds = new Set(linhagens.map((l) => l.requerenteId))
  const semInfluencia = new Set<number>()

  for (const p of g.pessoas) {
    let papel: PapelLinha = "colateral"
    if (emAlgumaLinha.has(p.id)) papel = "linha"
    if (danteCausas.has(p.id)) papel = "dante_causa"
    if (requerenteIds.has(p.id)) papel = "requerente"
    if (papel === "colateral") {
      if (g.conjugesIds(p.id).some((c) => emAlgumaLinha.has(c))) papel = "conjuge"
      else semInfluencia.add(p.id)
    }
    papeis.set(p.id, papel)
  }

  return { linhagens, porRequerente, compartilhadas, emAlgumaLinha, semInfluencia, papeis }
}

/**
 * Quantos requerentes dependem de uma pessoa. É o número que decide a ordem de
 * trabalho: resolver o bisavô de cinco requerentes vale cinco vezes mais que
 * resolver o sogro de um.
 */
export function requerentesQueDependemDe(mapa: MapaLinhagens, pessoaId: number): number[] {
  return mapa.compartilhadas.get(pessoaId) ?? []
}

// ── BREADCRUMB ──────────────────────────────────────────────────────────────

export interface DegrauLinhagem {
  pessoaId: number
  nome: string
  /** "Requerente", "Pai", "Avó", "Bisavô"… — flexionado pelo gênero cadastrado. */
  rotulo: string
  /** Gerações acima do requerente. 0 = o próprio. */
  geracao: number
  ehDanteCausa: boolean
  /** Quantos requerentes passam por este degrau. */
  compartilhadoPor: number
}

/**
 * O caminho do requerente até o ascendente transmissor, pronto para a tela.
 *
 * É PROJEÇÃO: cada degrau é um id que já existe na árvore, com o rótulo de
 * parentesco vindo do módulo que já sabe flexioná-lo. Não há nó novo, não há
 * cópia de pessoa e não há segunda representação da estrutura — clicar num
 * degrau leva ao MESMO nó do canvas.
 */
export function trilhaDaLinhagem(
  g: GrafoGenealogico,
  linhagem: Linhagem,
  mapa?: MapaLinhagens,
): DegrauLinhagem[] {
  return linhagem.cadeia.map((id, i) => {
    const p = g.pessoa(id)
    let rotulo = "Requerente"
    if (i > 0) {
      // O rótulo sai do motor de parentesco (já flexionado por gênero); só cai
      // no genérico quando o grafo não consegue provar o vínculo.
      const par = calcularParentesco(g, linhagem.requerenteId, id)
      rotulo = par && !par.porAfinidade ? capitalizar(par.rotulo) : `${i}ª geração acima`
    }
    return {
      pessoaId: id,
      nome: p ? nomeCompleto(p) : `#${id}`,
      rotulo,
      geracao: i,
      ehDanteCausa: id === linhagem.danteCausaId,
      compartilhadoPor: mapa ? (mapa.compartilhadas.get(id)?.length ?? 1) : 1,
    }
  })
}

// ── RELACIONADOS ────────────────────────────────────────────────────────────

/**
 * Quem orbita a linhagem sem transmitir: irmãos, cônjuges e filhos de quem está
 * na cadeia.
 *
 * Existe porque a linha pura esconde gente que o operador precisa alcançar sem
 * sair do foco — o irmão que tem a certidão em casa, o cônjuge cuja certidão de
 * casamento é exigida, o filho que também vai entrar no processo. É um conjunto
 * ADICIONAL de ids; não muda a cadeia, não muda posição e não vira linhagem.
 */
export function relacionadosDaLinhagem(g: GrafoGenealogico, linhagem: Linhagem): Set<number> {
  const extras = new Set<number>()
  const jaVisivel = linhagem.visivel
  for (const id of linhagem.cadeia) {
    for (const irmao of g.irmaosIds(id)) if (!jaVisivel.has(irmao)) extras.add(irmao)
    for (const conjuge of g.conjugesIds(id)) if (!jaVisivel.has(conjuge)) extras.add(conjuge)
    for (const filho of g.filhosIds(id)) if (!jaVisivel.has(filho)) extras.add(filho)
  }
  // Cônjuge de quem está na cadeia já entra em `visivel`; aqui se acrescenta o
  // cônjuge dos RELACIONADOS (o marido da irmã), que é quem falta para a
  // certidão de casamento dela fazer sentido na tela.
  for (const id of [...extras]) {
    for (const conjuge of g.conjugesIds(id)) if (!jaVisivel.has(conjuge)) extras.add(conjuge)
  }
  return extras
}

// ── DELTA DE LINHAGEM ───────────────────────────────────────────────────────

export interface DeltaLinhagens {
  /** Requerentes cuja cadeia muda com a alteração proposta. */
  requerentesAfetados: Array<{ pessoaId: number; nome: string }>
  entramNaLinha: number[]
  saemDaLinha: number[]
  transmissorAlterado: boolean
  /** true quando alguma cadeia encurta para o próprio requerente. */
  caminhoInterrompido: boolean
}

/**
 * O que muda nas linhagens quando a filiação muda — calculado SEM banco.
 *
 * O delta documental exige rodar o materializador (só o banco sabe as regras
 * publicadas). O delta de LINHAGEM, não: linhagem é topologia, e a topologia já
 * está inteira na memória. Comparar dois mapas é mais rápido e mais confiável
 * do que perguntar ao banco duas vezes.
 *
 * `grafoDepois` deve ser um grafo construído a partir das pessoas com a mudança
 * já aplicada em memória — nunca a partir de escrita no banco.
 */
export function compararLinhagens(
  antes: MapaLinhagens,
  depois: MapaLinhagens,
  grafoDepois: GrafoGenealogico,
): DeltaLinhagens {
  const afetados: Array<{ pessoaId: number; nome: string }> = []
  const entram = new Set<number>()
  const saem = new Set<number>()
  let transmissorAlterado = false
  let caminhoInterrompido = false

  const requerentes = new Set([...antes.porRequerente.keys(), ...depois.porRequerente.keys()])

  for (const id of [...requerentes].sort((a, b) => a - b)) {
    const a = antes.porRequerente.get(id)
    const d = depois.porRequerente.get(id)
    const cadeiaA = a?.cadeia ?? []
    const cadeiaD = d?.cadeia ?? []

    if (JSON.stringify(cadeiaA) === JSON.stringify(cadeiaD)) continue

    const p = grafoDepois.pessoa(id)
    afetados.push({ pessoaId: id, nome: p ? nomeCompleto(p) : (d?.nome ?? a?.nome ?? `#${id}`) })

    const setA = new Set(cadeiaA)
    const setD = new Set(cadeiaD)
    for (const x of cadeiaD) if (!setA.has(x)) entram.add(x)
    for (const x of cadeiaA) if (!setD.has(x)) saem.add(x)

    if ((a?.danteCausaId ?? null) !== (d?.danteCausaId ?? null)) transmissorAlterado = true
    // Encurtar até sobrar só o requerente é a linha parando de existir.
    if (cadeiaA.length > 1 && cadeiaD.length <= 1) caminhoInterrompido = true
  }

  return {
    requerentesAfetados: afetados,
    entramNaLinha: [...entram].sort((x, y) => x - y),
    saemDaLinha: [...saem].sort((x, y) => x - y),
    transmissorAlterado,
    caminhoInterrompido,
  }
}

function capitalizar(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/** Ascendência mais profunda a partir de alguém (fallback sem país-alvo). */
function ascendenciaMaisProfunda(g: GrafoGenealogico, id: number): number[] {
  const memo = new Map<number, number[]>()
  const visitando = new Set<number>()

  const descer = (atual: number): number[] => {
    const pronto = memo.get(atual)
    if (pronto) return pronto
    if (visitando.has(atual)) return [] // ciclo defensivo: filiação circular existe em base suja
    visitando.add(atual)

    const p = g.pessoa(atual)
    let melhor: number[] = []
    if (p) {
      // Preferência: quem está marcado na linha reta primeiro; depois o ramo mais
      // profundo; pai antes de mãe só como desempate final (estabilidade).
      const candidatos = [p.paiId, p.maeId].filter((x): x is number => x != null && g.existe(x))
      const ordenados = candidatos.sort((a, b) => {
        const la = g.pessoa(a)?.linhaReta === false ? 1 : 0
        const lb = g.pessoa(b)?.linhaReta === false ? 1 : 0
        return la - lb
      })
      for (const c of ordenados) {
        const sub = descer(c)
        if (sub.length > melhor.length) melhor = sub
      }
    }
    visitando.delete(atual)
    const resultado = [atual, ...melhor]
    memo.set(atual, resultado)
    return resultado
  }

  return descer(id)
}
