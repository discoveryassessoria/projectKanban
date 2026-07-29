// src/lib/genealogia/motor/grafo.ts
//
// Índice da árvore. Construído UMA vez, O(n+u), e depois toda consulta é O(1).
//
// Motivo: a implementação anterior fazia `pessoas.find(...)` dentro de laços
// aninhados (pai, mãe, irmãos, cônjuges, filhos) e dentro do layout — isso é o
// N+1 clássico do lado do cliente. Com 2.000 pessoas eram milhões de varreduras
// por render. Aqui nada varre: tudo é Map.

import type { PessoaEntrada, UniaoEntrada } from "./tipos"
import { chaveFonetica, tsDe } from "./texto"

export interface Casal {
  chave: string
  a: number
  b: number
  uniaoId: number | null
  filhos: number[]
}

/**
 * Grau de irmandade — DERIVADO, nunca declarado.
 *
 * Genealogia de cidadania trata meio-irmão de forma diferente do irmão inteiro
 * (linha de transmissão, direito de terceiros, escopo de certidão), então a
 * árvore não pode desenhar os dois iguais. Mas também não pode AFIRMAR o que o
 * dado não sustenta: quando o segundo genitor é desconhecido num dos dois, o
 * correto é `indeterminado` — provável meio-irmão, ainda não comprovado. Chamar
 * isso de "meio-irmão" seria o motor inventando conclusão a partir de lacuna.
 */
export type TipoIrmandade = "inteiro" | "meio_paterno" | "meio_materno" | "indeterminado"

export interface Irmandade {
  id: number
  tipo: TipoIrmandade
  /** Genitor(es) em comum — a explicação do porquê. */
  viaPaiId: number | null
  viaMaeId: number | null
}

export const ROTULO_IRMANDADE: Record<TipoIrmandade, string> = {
  inteiro: "Irmão(ã)",
  meio_paterno: "Meio-irmão(ã) por parte de pai",
  meio_materno: "Meio-irmão(ã) por parte de mãe",
  indeterminado: "Irmandade a confirmar",
}

export class GrafoGenealogico {
  readonly pessoas: PessoaEntrada[]
  readonly unioes: UniaoEntrada[]

  private readonly _porId = new Map<number, PessoaEntrada>()
  private readonly _filhos = new Map<number, number[]>()
  private readonly _unioesDe = new Map<number, UniaoEntrada[]>()
  private readonly _conjuges = new Map<number, number[]>()
  private readonly _casais = new Map<string, Casal>()
  private readonly _casaisDe = new Map<number, Casal[]>()
  private readonly _irmaos = new Map<number, number[]>()
  private readonly _porFonetica = new Map<string, number[]>()
  private readonly _irmandade = new Map<number, Irmandade[]>()
  private readonly _conjugesOrd = new Map<number, number[]>()

  constructor(pessoas: PessoaEntrada[], unioes: UniaoEntrada[]) {
    // Defensivo: uniões órfãs (pessoa apagada) não podem quebrar a árvore.
    this.pessoas = pessoas
    for (const p of pessoas) this._porId.set(p.id, p)

    this.unioes = unioes.filter(
      (u) =>
        u.pessoa1Id != null &&
        u.pessoa2Id != null &&
        this._porId.has(u.pessoa1Id) &&
        this._porId.has(u.pessoa2Id),
    )

    for (const p of pessoas) {
      if (p.paiId != null && this._porId.has(p.paiId)) push(this._filhos, p.paiId, p.id)
      if (p.maeId != null && this._porId.has(p.maeId)) push(this._filhos, p.maeId, p.id)

      const chave = chaveFonetica(p.sobrenome || p.nome)
      if (chave) push(this._porFonetica, chave, p.id)
    }

    // Casais por união declarada
    for (const u of this.unioes) {
      const a = u.pessoa1Id as number
      const b = u.pessoa2Id as number
      push(this._unioesDe, a, u)
      push(this._unioesDe, b, u)
      push(this._conjuges, a, b)
      push(this._conjuges, b, a)
      this.garantirCasal(a, b, u.id)
    }

    // Casais implícitos por filho em comum (pai + mãe do mesmo filho)
    for (const p of pessoas) {
      if (p.paiId != null && p.maeId != null && this._porId.has(p.paiId) && this._porId.has(p.maeId)) {
        this.garantirCasal(p.paiId, p.maeId, null)
      }
    }

    // Filhos de cada casal + irmandade
    for (const p of pessoas) {
      if (p.paiId != null && p.maeId != null) {
        const c = this._casais.get(chaveCasal(p.paiId, p.maeId))
        if (c) c.filhos.push(p.id)
      }
    }

    for (const [, ids] of this._filhos) {
      // irmandade derivada é feita abaixo, com meio-irmãos incluídos
      void ids
    }
    this.montarIrmaos()
  }

  private garantirCasal(a: number, b: number, uniaoId: number | null) {
    const chave = chaveCasal(a, b)
    let c = this._casais.get(chave)
    if (!c) {
      c = { chave, a: Math.min(a, b), b: Math.max(a, b), uniaoId, filhos: [] }
      this._casais.set(chave, c)
      push(this._casaisDe, a, c)
      push(this._casaisDe, b, c)
    } else if (uniaoId != null && c.uniaoId == null) {
      c.uniaoId = uniaoId
    }
  }

  private montarIrmaos() {
    const porPai = new Map<number, number[]>()
    for (const p of this.pessoas) {
      if (p.paiId != null) push(porPai, p.paiId, p.id)
      if (p.maeId != null) push(porPai, p.maeId, p.id)
    }
    for (const p of this.pessoas) {
      const set = new Set<number>()
      for (const parenteId of [p.paiId, p.maeId]) {
        if (parenteId == null) continue
        for (const irmaoId of porPai.get(parenteId) || []) {
          if (irmaoId !== p.id) set.add(irmaoId)
        }
      }
      if (set.size) this._irmaos.set(p.id, [...set])
    }
  }

  // ---------- consultas O(1) ----------

  pessoa(id: number | null | undefined): PessoaEntrada | null {
    if (id == null) return null
    return this._porId.get(id) || null
  }
  existe(id: number | null | undefined): boolean {
    return id != null && this._porId.has(id)
  }
  pai(id: number): PessoaEntrada | null {
    return this.pessoa(this._porId.get(id)?.paiId ?? null)
  }
  mae(id: number): PessoaEntrada | null {
    return this.pessoa(this._porId.get(id)?.maeId ?? null)
  }
  paisDe(id: number): PessoaEntrada[] {
    return [this.pai(id), this.mae(id)].filter(Boolean) as PessoaEntrada[]
  }
  filhosIds(id: number): number[] {
    return this._filhos.get(id) || []
  }
  filhos(id: number): PessoaEntrada[] {
    return this.filhosIds(id).map((i) => this._porId.get(i)!).filter(Boolean)
  }
  irmaosIds(id: number): number[] {
    return this._irmaos.get(id) || []
  }
  /**
   * Irmandade classificada e ordenada por nascimento. Calculada sob demanda
   * (a UI pede de uma pessoa por vez) e memoizada — montar isso para a árvore
   * inteira no construtor custaria memória que quase nunca é lida.
   */
  irmandade(id: number): Irmandade[] {
    const cached = this._irmandade.get(id)
    if (cached) return cached

    const eu = this._porId.get(id)
    if (!eu) return []

    const lista: Irmandade[] = this.irmaosIds(id).map((outroId) => {
      const outro = this._porId.get(outroId)!
      const mesmoPai = eu.paiId != null && outro.paiId === eu.paiId
      const mesmaMae = eu.maeId != null && outro.maeId === eu.maeId
      const viaPaiId = mesmoPai ? eu.paiId! : null
      const viaMaeId = mesmaMae ? eu.maeId! : null

      let tipo: TipoIrmandade
      if (mesmoPai && mesmaMae) {
        tipo = "inteiro"
      } else if (mesmoPai) {
        // Só é meio-irmão quando as DUAS mães são conhecidas e diferentes.
        tipo = eu.maeId != null && outro.maeId != null ? "meio_paterno" : "indeterminado"
      } else if (mesmaMae) {
        tipo = eu.paiId != null && outro.paiId != null ? "meio_materno" : "indeterminado"
      } else {
        tipo = "indeterminado"
      }

      return { id: outroId, tipo, viaPaiId, viaMaeId }
    })

    const ordenados = this.filhosOrdenados(lista.map((i) => i.id))
    const porId = new Map(lista.map((i) => [i.id, i]))
    const resultado = ordenados.map((i) => porId.get(i)!).filter(Boolean)
    this._irmandade.set(id, resultado)
    return resultado
  }
  conjugesIds(id: number): number[] {
    return this._conjuges.get(id) || []
  }
  /**
   * Cônjuges na ordem cronológica da união (1º casamento, 2º casamento...).
   * É essa ordem que o layout usa para encadear múltiplos cônjuges — desenhar
   * a segunda esposa antes da primeira faz o operador ler a família ao contrário.
   */
  conjugesOrdenados(id: number): number[] {
    const cached = this._conjugesOrd.get(id)
    if (cached) return cached

    const ids = this.conjugesIds(id)
    const inicioDe = new Map<number, number | null>()
    for (const outroId of ids) {
      const uniao = this.unioesDe(id).find(
        (u) => u.pessoa1Id === outroId || u.pessoa2Id === outroId,
      )
      inicioDe.set(outroId, tsDe(uniao?.data_inicio))
    }

    const ordenados = [...ids].sort((x, y) => {
      const a = inicioDe.get(x) ?? null
      const b = inicioDe.get(y) ?? null
      if (a != null && b != null && a !== b) return a - b
      if (a != null && b == null) return -1
      if (a == null && b != null) return 1
      // Sem data: quem tem mais filhos em comum vem primeiro (união principal).
      const fa = this.casal(id, x)?.filhos.length ?? 0
      const fb = this.casal(id, y)?.filhos.length ?? 0
      if (fa !== fb) return fb - fa
      return x - y
    })

    this._conjugesOrd.set(id, ordenados)
    return ordenados
  }
  conjuges(id: number): PessoaEntrada[] {
    return this.conjugesIds(id).map((i) => this._porId.get(i)!).filter(Boolean)
  }
  unioesDe(id: number): UniaoEntrada[] {
    return this._unioesDe.get(id) || []
  }
  casaisDe(id: number): Casal[] {
    return this._casaisDe.get(id) || []
  }
  casal(a: number, b: number): Casal | null {
    return this._casais.get(chaveCasal(a, b)) || null
  }
  todosCasais(): Casal[] {
    return [...this._casais.values()]
  }
  /** Bucket fonético — base da detecção de duplicidade sem varrer O(n²). */
  bucketFonetico(chave: string): number[] {
    return this._porFonetica.get(chave) || []
  }
  bucketsFoneticos(): Map<string, number[]> {
    return this._porFonetica
  }

  /** Ancestrais (pais, avós...) até um limite de gerações. */
  ancestrais(id: number, maxGeracoes = 30): Set<number> {
    const vistos = new Set<number>()
    const fila: Array<[number, number]> = [[id, 0]]
    while (fila.length) {
      const [atual, g] = fila.shift()!
      if (g >= maxGeracoes) continue
      const p = this._porId.get(atual)
      if (!p) continue
      for (const pid of [p.paiId, p.maeId]) {
        if (pid == null || vistos.has(pid) || !this._porId.has(pid)) continue
        vistos.add(pid)
        fila.push([pid, g + 1])
      }
    }
    return vistos
  }

  /** Descendentes diretos e indiretos. */
  descendentes(id: number): Set<number> {
    const vistos = new Set<number>()
    const pilha = [id]
    while (pilha.length) {
      const atual = pilha.pop()!
      for (const f of this.filhosIds(atual)) {
        if (vistos.has(f)) continue
        vistos.add(f)
        pilha.push(f)
      }
    }
    return vistos
  }

  /** Caminho ascendente mais curto de `de` até `ate` (inclusive), ou null. */
  caminhoAscendente(de: number, ate: number): number[] | null {
    if (de === ate) return [de]
    const anterior = new Map<number, number>()
    const fila = [de]
    const vistos = new Set<number>([de])
    while (fila.length) {
      const atual = fila.shift()!
      const p = this._porId.get(atual)
      if (!p) continue
      for (const pid of [p.paiId, p.maeId]) {
        if (pid == null || vistos.has(pid) || !this._porId.has(pid)) continue
        vistos.add(pid)
        anterior.set(pid, atual)
        if (pid === ate) {
          const caminho = [ate]
          let cur = ate
          while (anterior.has(cur)) {
            cur = anterior.get(cur)!
            caminho.push(cur)
          }
          return caminho.reverse()
        }
        fila.push(pid)
      }
    }
    return null
  }

  /**
   * Geração de cada pessoa relativa à raiz (0 = raiz, +1 = pais, -1 = filhos).
   * BFS sobre o grafo não-direcionado com peso de aresta — determinístico.
   */
  geracoes(raizId: number): Map<number, number> {
    const g = new Map<number, number>([[raizId, 0]])
    const fila: number[] = [raizId]
    while (fila.length) {
      const atual = fila.shift()!
      const nivel = g.get(atual)!
      const p = this._porId.get(atual)
      if (!p) continue

      const vizinhos: Array<[number, number]> = []
      if (p.paiId != null && this._porId.has(p.paiId)) vizinhos.push([p.paiId, nivel + 1])
      if (p.maeId != null && this._porId.has(p.maeId)) vizinhos.push([p.maeId, nivel + 1])
      for (const f of this.filhosIds(atual)) vizinhos.push([f, nivel - 1])
      for (const c of this.conjugesIds(atual)) vizinhos.push([c, nivel])

      for (const [vid, vnivel] of vizinhos) {
        if (g.has(vid)) continue
        g.set(vid, vnivel)
        fila.push(vid)
      }
    }
    // componentes desconexos entram no nível de menor conflito (0)
    for (const p of this.pessoas) if (!g.has(p.id)) g.set(p.id, 0)
    return g
  }

  /** Ordena filhos por data de nascimento (sem data vai para o fim, estável). */
  filhosOrdenados(ids: number[]): number[] {
    return [...ids].sort((x, y) => {
      const a = tsDe(this._porId.get(x)?.data_nasc)
      const b = tsDe(this._porId.get(y)?.data_nasc)
      if (a == null && b == null) return x - y
      if (a == null) return 1
      if (b == null) return -1
      return a - b
    })
  }
}

function chaveCasal(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k)
  if (arr) arr.push(v)
  else m.set(k, [v])
}

export function construirGrafo(
  pessoas: PessoaEntrada[],
  unioes: UniaoEntrada[],
): GrafoGenealogico {
  return new GrafoGenealogico(pessoas, unioes)
}
