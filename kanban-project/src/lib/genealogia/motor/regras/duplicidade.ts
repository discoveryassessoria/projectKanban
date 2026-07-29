// src/lib/genealogia/motor/regras/duplicidade.ts
//
// Detecção de pessoas cadastradas duas vezes.
//
// REGRA PERMANENTE (herdada de [[dedup-identidade-participantes]]): o motor
// NUNCA funde pessoas automaticamente e NUNCA aplica heurística silenciosa.
// Ele só APONTA a suspeita, com evidência explícita, e deixa a decisão com o
// operador. Duplicidade é dado; fusão é ato humano.
//
// Custo: bucketizado por chave fonética de sobrenome + década de nascimento.
// Isso mantém o comparador em O(n · k) com k pequeno, em vez de O(n²).

import type { GrafoGenealogico } from "../grafo"
import type { Insight } from "../tipos"
import { anoDe, nomeCompleto, similaridadeLocal, similaridadeNome, chaveFonetica } from "../texto"

const LIMIAR_SUSPEITA = 0.82
const LIMIAR_FORTE = 0.93

/** Janela de anos em que duas fichas ainda podem ser a mesma pessoa. */
const JANELA_ANOS = 3
/** Teto de comparações — protege contra sobrenome comuníssimo (Silva, Rossi). */
const MAX_COMPARACOES = 250_000
/** Teto de suspeitas devolvidas. Acima disso o painel deixa de ser útil. */
const MAX_SUSPEITAS = 150

export interface ResultadoDuplicidade {
  insights: Insight[]
  /** true quando o teto foi atingido — a UI avisa em vez de mentir cobertura. */
  truncado: boolean
}

export function analisarDuplicidadeDetalhado(g: GrafoGenealogico): ResultadoDuplicidade {
  const achados: Insight[] = []
  const jaComparado = new Set<string>()
  let comparacoes = 0
  let truncado = false

  for (const [, ids] of g.bucketsFoneticos()) {
    if (ids.length < 2) continue

    // Índice por ano dentro do bucket: só comparamos quem pode coexistir.
    // Sem isso, um sobrenome com 500 pessoas custaria 125 mil comparações.
    const porAno = new Map<number, number[]>()
    const semAno: number[] = []
    for (const id of ids) {
      const ano = anoDe(g.pessoa(id)?.data_nasc)
      if (ano == null) semAno.push(id)
      else {
        const arr = porAno.get(ano) || []
        arr.push(id)
        porAno.set(ano, arr)
      }
    }

    const comparar = (a: number, b: number) => {
      if (a === b) return
      const chave = a < b ? `${a}:${b}` : `${b}:${a}`
      if (jaComparado.has(chave)) return
      jaComparado.add(chave)
      if (comparacoes++ > MAX_COMPARACOES) {
        truncado = true
        return
      }
      const insight = compararPar(g, a, b)
      if (insight) achados.push(insight)
    }

    for (const [ano, arr] of porAno) {
      // mesmo ano
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) comparar(arr[i], arr[j])
      }
      // anos vizinhos (grafia de data também erra)
      for (let d = 1; d <= JANELA_ANOS; d++) {
        const vizinho = porAno.get(ano + d)
        if (!vizinho) continue
        for (const a of arr) for (const b of vizinho) comparar(a, b)
      }
      // contra quem não tem data
      for (const a of arr) for (const b of semAno) comparar(a, b)
    }
    for (let i = 0; i < semAno.length; i++) {
      for (let j = i + 1; j < semAno.length; j++) comparar(semAno[i], semAno[j])
    }
    if (truncado) break
  }

  achados.sort((a, b) => (b.confianca ?? 0) - (a.confianca ?? 0) || a.id.localeCompare(b.id))
  if (achados.length > MAX_SUSPEITAS) truncado = true

  return { insights: achados.slice(0, MAX_SUSPEITAS), truncado }
}

export function analisarDuplicidade(g: GrafoGenealogico): Insight[] {
  return analisarDuplicidadeDetalhado(g).insights
}

function compararPar(g: GrafoGenealogico, idA: number, idB: number): Insight | null {
  const A = g.pessoa(idA)
  const B = g.pessoa(idB)
  if (!A || !B) return null

  // Nunca acusar duplicidade entre pessoas com relação estrutural declarada:
  // pai/filho, irmãos e cônjuges são pessoas distintas por definição.
  if (A.paiId === idB || A.maeId === idB || B.paiId === idA || B.maeId === idA) return null
  if (g.irmaosIds(idA).includes(idB)) return null
  if (g.conjugesIds(idA).includes(idB)) return null

  const evidencias: string[] = []
  let pontos = 0
  let pesoTotal = 0

  const marcar = (valor: number, peso: number, evidencia?: string) => {
    pontos += valor * peso
    pesoTotal += peso
    if (evidencia && valor > 0.8) evidencias.push(evidencia)
  }

  // Nome próprio — o sinal mais forte
  const simNome = similaridadeNome(A.nome, B.nome)
  marcar(simNome, 3, simNome > 0.95 ? `mesmo nome “${A.nome}”` : `nomes muito parecidos (“${A.nome}” / “${B.nome}”)`)

  // Sobrenome
  const simSobrenome = similaridadeNome(A.sobrenome, B.sobrenome)
  if (A.sobrenome && B.sobrenome) {
    marcar(simSobrenome, 2.5, simSobrenome > 0.95 ? `mesmo sobrenome “${A.sobrenome}”` : `sobrenome equivalente (“${A.sobrenome}” / “${B.sobrenome}”)`)
  }

  // Data de nascimento — quando as duas existem, é quase decisivo
  const anoA = anoDe(A.data_nasc)
  const anoB = anoDe(B.data_nasc)
  if (anoA != null && anoB != null) {
    const diff = Math.abs(anoA - anoB)
    const valor = diff === 0 ? 1 : diff <= 1 ? 0.8 : diff <= 3 ? 0.4 : 0
    marcar(valor, 3, diff === 0 ? `mesmo ano de nascimento (${anoA})` : undefined)
    if (diff > 5) return null // datas incompatíveis derrubam a hipótese
  }

  // Sexo divergente derruba
  const sexoA = (A.sexo || "").charAt(0).toUpperCase()
  const sexoB = (B.sexo || "").charAt(0).toUpperCase()
  if (sexoA && sexoB && sexoA !== sexoB) return null

  // Local de nascimento
  const simLocal = similaridadeLocal(A.local_nasc, B.local_nasc)
  if (A.local_nasc && B.local_nasc) {
    marcar(simLocal, 1.5, simLocal > 0.9 ? `mesmo local de nascimento (${A.local_nasc})` : undefined)
  }

  // Pais em comum reforça muito
  const paisA = [A.paiId, A.maeId].filter(Boolean) as number[]
  const paisB = [B.paiId, B.maeId].filter(Boolean) as number[]
  if (paisA.length && paisB.length) {
    const comum = paisA.filter((x) => paisB.includes(x)).length
    if (comum > 0) {
      marcar(1, 2, `${comum === 2 ? "mesmos pais" : "mesmo ascendente"} cadastrado(s)`)
    } else {
      // Pais totalmente diferentes e ambos conhecidos: sinal contrário forte.
      marcar(0, 2.5)
    }
  }

  if (pesoTotal === 0) return null
  const score = pontos / pesoTotal
  if (score < LIMIAR_SUSPEITA) return null

  const forte = score >= LIMIAR_FORTE
  return {
    id: `dup-${Math.min(idA, idB)}-${Math.max(idA, idB)}`,
    categoria: "duplicidade",
    severidade: forte ? "alto" : "medio",
    titulo: `Possível duplicidade: ${nomeCompleto(A)} e ${nomeCompleto(B)}`,
    explicacao: `${forte ? "Forte indício" : "Indício"} de que são a mesma pessoa — ${evidencias.join(", ") || "dados muito próximos"}. Confiança ${Math.round(score * 100)}%.`,
    acao: "Comparar as duas fichas e, se for a mesma pessoa, transferir os vínculos e excluir a repetida. A árvore nunca funde sozinha.",
    pessoaIds: [idA, idB],
    confianca: score,
    peso: forte ? 78 : 50,
  }
}

/** Exposto para a UI: pares suspeitos de uma pessoa específica. */
export function duplicatasDe(insights: Insight[], pessoaId: number): Insight[] {
  return insights.filter((i) => i.categoria === "duplicidade" && i.pessoaIds.includes(pessoaId))
}

export { chaveFonetica }
