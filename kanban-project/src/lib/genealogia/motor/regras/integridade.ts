// src/lib/genealogia/motor/regras/integridade.ts
//
// INTEGRIDADE ESTRUTURAL DO GRAFO — o que a cronologia não vê.
//
// `regras/cronologia.ts` já cobre o tempo (óbito antes do nascimento, casamento
// antes de nascer, pai mais novo que o filho). O que faltava é a FORMA do grafo:
// uma pessoa que é pai de si mesma, um ciclo de filiação, dois vínculos
// equivalentes ativos, um ramo que não se conecta a nada, um requerente sem
// caminho até ascendente nenhum.
//
// REGRA QUE MANDA AQUI: só se sinaliza o que é PROVÁVEL a partir dos dados.
// Uma pessoa sem pai cadastrado não é "ramo desconectado" — é cadastro
// incompleto, e já existe regra de lacuna para isso. Sinalizar suspeita como
// erro treina o operador a ignorar alerta, que é pior do que não ter alerta.
//
// Nada aqui corrige: cada achado descreve o problema, o impacto e a ação.

import type { GrafoGenealogico } from "../grafo"
import type { Insight } from "../tipos"
import { nomeCompleto } from "../texto"

export interface OpcoesIntegridade {
  /** Requerentes do processo — para provar "requerente sem caminho". */
  requerenteIds?: readonly number[]
}

export function analisarIntegridade(
  g: GrafoGenealogico,
  opcoes: OpcoesIntegridade = {},
): Insight[] {
  const insights: Insight[] = []

  // ── 1. Pessoa ligada a si mesma ───────────────────────────────────────────
  // É impossível por domínio, não por probabilidade: ninguém é o próprio pai.
  for (const p of g.pessoas) {
    const papeis: string[] = []
    if (p.paiId === p.id) papeis.push("pai")
    if (p.maeId === p.id) papeis.push("mãe")
    if (papeis.length === 0) continue
    insights.push({
      id: `int-auto-vinculo-${p.id}`,
      categoria: "conflito",
      severidade: "critico",
      titulo: `${nomeCompleto(p)} está cadastrada como ${papeis.join(" e ")} de si mesma`,
      explicacao:
        "Um vínculo de filiação apontando para a própria pessoa é impossível. Enquanto existir, qualquer cálculo de linhagem que passe por ela fica indefinido.",
      acao: "Corrigir a filiação desta pessoa no cadastro.",
      pessoaIds: [p.id],
      confianca: 1,
      peso: 140,
    })
  }

  // ── 2. Ciclo genealógico ──────────────────────────────────────────────────
  // A → pai B → pai C → pai A. Também impossível, e é o que trava um percurso
  // ascendente ingênuo. O motor de linhagem já se defende com `visitando`, mas
  // defender-se não é o mesmo que avisar que o dado está quebrado.
  for (const ciclo of detectarCiclos(g)) {
    const nomes = ciclo.map((id) => nomeCompleto(g.pessoa(id)!)).join(" → ")
    insights.push({
      id: `int-ciclo-${[...ciclo].sort((a, b) => a - b).join("-")}`,
      categoria: "conflito",
      severidade: "critico",
      titulo: "Ciclo na filiação",
      explicacao: `A cadeia ${nomes} → ${nomeCompleto(g.pessoa(ciclo[0])!)} volta ao início. Uma pessoa acaba sendo ascendente de si mesma, o que não pode existir.`,
      acao: "Conferir qual dos vínculos de filiação da cadeia está invertido ou aponta para a pessoa errada.",
      pessoaIds: ciclo,
      confianca: 1,
      peso: 145,
    })
  }

  // ── 3. Dois vínculos ativos equivalentes ──────────────────────────────────
  // Duas Uniões entre o MESMO par. Não é o mesmo que casar duas vezes com
  // pessoas diferentes (legítimo) nem que recasar após divórcio — por isso só
  // se sinaliza quando ambas estão ABERTAS (sem data de fim).
  for (const casal of g.todosCasais()) {
    const abertas = g
      .unioesDe(casal.a)
      .filter((u) => (u.pessoa1Id === casal.b || u.pessoa2Id === casal.b) && !u.data_fim)
    if (abertas.length < 2) continue
    const a = g.pessoa(casal.a)
    const b = g.pessoa(casal.b)
    if (!a || !b) continue
    insights.push({
      id: `int-uniao-duplicada-${casal.chave}`,
      categoria: "duplicidade",
      severidade: "alto",
      titulo: `${abertas.length} uniões abertas entre ${nomeCompleto(a)} e ${nomeCompleto(b)}`,
      explicacao:
        "O mesmo casal aparece com mais de uma união sem data de término. A exigência da certidão de casamento é por união — duas uniões abertas geram exigência duplicada para o mesmo fato.",
      acao: "Manter a união correta e encerrar ou excluir a repetida.",
      pessoaIds: [casal.a, casal.b],
      uniaoIds: abertas.map((u) => u.id),
      confianca: 0.95,
      peso: 90,
    })
  }

  // ── 4. Ramo desconectado ──────────────────────────────────────────────────
  // Componente do grafo que não alcança o componente principal. Só se afirma
  // quando há MAIS DE UM componente e o secundário tem pelo menos duas pessoas:
  // uma pessoa isolada é cadastro em andamento, não ramo órfão.
  const componentes = componentesConexos(g)
  if (componentes.length > 1) {
    const ordenados = [...componentes].sort((x, y) => y.length - x.length)
    for (const comp of ordenados.slice(1)) {
      if (comp.length < 2) continue
      const amostra = comp.slice(0, 3).map((id) => nomeCompleto(g.pessoa(id)!))
      insights.push({
        id: `int-ramo-solto-${Math.min(...comp)}`,
        categoria: "relacao",
        severidade: "medio",
        titulo: `Ramo de ${comp.length} pessoas sem ligação com o restante da árvore`,
        explicacao: `${amostra.join(", ")}${comp.length > 3 ? " e outros" : ""} formam um grupo que não se conecta a nenhuma outra pessoa da árvore. Se pertencem ao processo, falta o vínculo que os liga.`,
        acao: "Ligar este ramo à árvore pela filiação ou pelo casamento que falta, ou confirmar que ele não pertence a este processo.",
        pessoaIds: comp.slice(0, 8),
        confianca: 0.8,
        peso: 55,
      })
    }
  }

  // ── 5. Requerente sem caminho ascendente ──────────────────────────────────
  // O caso que faz o processo não existir: alguém marcado como requerente e sem
  // um único ascendente cadastrado. Só se afirma sobre quem o processo declarou
  // requerente — inferir requerente seria inventar fato.
  for (const id of opcoes.requerenteIds ?? []) {
    const p = g.pessoa(id)
    if (!p) continue
    if (p.paiId != null && g.existe(p.paiId)) continue
    if (p.maeId != null && g.existe(p.maeId)) continue
    insights.push({
      id: `int-requerente-sem-linha-${id}`,
      categoria: "risco",
      severidade: "critico",
      titulo: `${nomeCompleto(p)} é requerente e não tem nenhum ascendente na árvore`,
      explicacao:
        "Sem pai nem mãe cadastrados não há linha de transmissão a partir desta pessoa — e é a linha que fundamenta o pedido de cidadania.",
      acao: "Cadastrar a filiação do requerente a partir da certidão de nascimento dele.",
      pessoaIds: [id],
      confianca: 1,
      peso: 150,
    })
  }

  return insights
}

/**
 * Ciclos de filiação. DFS com pilha explícita e três cores — recursão numa
 * árvore de milhares de pessoas estoura a pilha do nó.
 * Devolve cada ciclo uma única vez, na ordem em que foi encontrado.
 */
function detectarCiclos(g: GrafoGenealogico): number[][] {
  const BRANCO = 0
  const CINZA = 1
  const PRETO = 2
  const cor = new Map<number, number>()
  const ciclos: number[][] = []
  const vistos = new Set<string>()

  for (const p of g.pessoas) cor.set(p.id, BRANCO)

  // Ordem estável por id: a mesma árvore reporta os mesmos ciclos na mesma ordem.
  for (const raiz of [...cor.keys()].sort((a, b) => a - b)) {
    if (cor.get(raiz) !== BRANCO) continue

    const caminho: number[] = []
    const pilha: Array<{ id: number; ascendentes: number[]; i: number }> = [
      { id: raiz, ascendentes: ascendentesDiretos(g, raiz), i: 0 },
    ]
    cor.set(raiz, CINZA)
    caminho.push(raiz)

    while (pilha.length) {
      const topo = pilha[pilha.length - 1]
      if (topo.i >= topo.ascendentes.length) {
        cor.set(topo.id, PRETO)
        pilha.pop()
        caminho.pop()
        continue
      }
      const proximo = topo.ascendentes[topo.i++]
      const c = cor.get(proximo)
      if (c === CINZA) {
        // Fechou ciclo: o trecho do caminho a partir de `proximo`.
        const inicio = caminho.indexOf(proximo)
        if (inicio >= 0) {
          const ciclo = caminho.slice(inicio)
          // Auto-vínculo já tem regra própria; não reportar duas vezes.
          if (ciclo.length > 1) {
            const chave = [...ciclo].sort((a, b) => a - b).join("-")
            if (!vistos.has(chave)) {
              vistos.add(chave)
              ciclos.push(ciclo)
            }
          }
        }
        continue
      }
      if (c === BRANCO) {
        cor.set(proximo, CINZA)
        caminho.push(proximo)
        pilha.push({ id: proximo, ascendentes: ascendentesDiretos(g, proximo), i: 0 })
      }
    }
  }

  return ciclos
}

function ascendentesDiretos(g: GrafoGenealogico, id: number): number[] {
  const p = g.pessoa(id)
  if (!p) return []
  const r: number[] = []
  // Auto-vínculo é excluído aqui: ele tem regra própria e, deixado passar,
  // apareceria de novo como "ciclo de uma pessoa".
  if (p.paiId != null && p.paiId !== id && g.existe(p.paiId)) r.push(p.paiId)
  if (p.maeId != null && p.maeId !== id && g.existe(p.maeId)) r.push(p.maeId)
  return r
}

/** Componentes conexos considerando filiação E casamento (grafo não-direcionado). */
function componentesConexos(g: GrafoGenealogico): number[][] {
  const visto = new Set<number>()
  const componentes: number[][] = []

  for (const p of [...g.pessoas].sort((a, b) => a.id - b.id)) {
    if (visto.has(p.id)) continue
    const comp: number[] = []
    const fila = [p.id]
    visto.add(p.id)
    while (fila.length) {
      const atual = fila.shift()!
      comp.push(atual)
      const a = g.pessoa(atual)
      if (!a) continue
      const vizinhos = [
        ...(a.paiId != null && g.existe(a.paiId) ? [a.paiId] : []),
        ...(a.maeId != null && g.existe(a.maeId) ? [a.maeId] : []),
        ...g.filhosIds(atual),
        ...g.conjugesIds(atual),
      ]
      for (const v of vizinhos) {
        if (v === atual || visto.has(v)) continue
        visto.add(v)
        fila.push(v)
      }
    }
    componentes.push(comp)
  }

  return componentes
}
