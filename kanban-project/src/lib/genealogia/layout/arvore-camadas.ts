// src/lib/genealogia/layout/arvore-camadas.ts
// ============================================================================
// O DESENHO DA ÁRVORE GENEALÓGICA — algoritmo em camadas para CASAIS (Reingold–Tilford adaptado), 06/10/2026.
// PURO: sem React, sem reactflow, sem rede. A tela (`react-flow-tree.tsx`) e o teste leem o MESMO motor.
//
// REGRAS (valem para retrato e paisagem; na paisagem o eixo da geração é o horizontal — "linha" vira "coluna"):
//  1. Geração = linha: toda pessoa da mesma geração fica na mesma altura. Cônjuge fica na geração do parceiro.
//  2. Casal encostado, lado a lado. A linha de casamento é decidida pela POSIÇÃO REAL dos cartões (`ladosDoCasal`), nunca por regra fixa.
//  3. Pessoa com mais de uma união fica no meio, um cônjuge de cada lado, em ordem cronológica (1º à esquerda, 2º à direita; do 3º em diante
//     seguem à direita). Os filhos de cada união ficam sob o ponto médio daquele casal.
//  4. Cônjuge sem pais na árvore nunca vira coluna própria: fica colado ao parceiro.
//  5. Filhos sob o casal, centralizados, em ordem de nascimento; irmãos juntos; ramo colateral na mesma linha dos irmãos.
//  6. Subárvores não se sobrepõem: a largura de cada ramo é calculada de baixo para cima por CONTORNOS (um intervalo por geração), e os
//     ramos se afastam só o necessário — um ramo raso encaixa-se sob a folga de um ramo fundo.
//  7. A filiação é desenhada como sempre foi: do cartão do filho a CADA genitor (sai de baixo de cada um). O fio NÃO sai do meio do casal.
//
// COMO FUNCIONA
//  • CLUSTER = pessoas ligadas por união (ou por filhos em comum): uma sequência rígida na mesma geração.
//  • ÁRVORE DE CLUSTERS: cada cluster pendura-se no casal/genitor de UM de seus membros (o "vínculo primário": o da linhagem com mais
//    ancestrais). Os demais vínculos (a família do cônjuge) são "ligações": a árvore deles é um ramo à parte, alinhado por geração e
//    colocado ao lado do ramo que ele alimenta.
//  • Posição: u = eixo transversal (esquerda→direita no retrato; cima→baixo na paisagem), geração = eixo da linha.
// ============================================================================

export type Disposicao = "retrato" | "paisagem"

export interface PessoaDoDesenho {
  id: number
  paiId?: number | null
  maeId?: number | null
  sexo?: string | null
  data_nasc?: Date | string | null
}
export interface UniaoDoDesenho {
  id: number
  pessoa1Id?: number | null
  pessoa2Id?: number | null
  data_inicio?: Date | string | null
}

export interface OpcoesDoDesenho {
  disposicao: Disposicao
  /** Medidas do cartão na disposição (as MESMAS do canvas). */
  largura: number
  altura: number
  /** A pessoa principal: a árvore que a contém é o ramo principal. */
  principalId?: number | null
  /** Margem em volta do desenho. */
  margem?: number
}

export interface Casal { a: number; b: number; uniaoId: number | null }

export interface ResultadoDoDesenho {
  /** Canto superior esquerdo de cada cartão. */
  posicoes: Map<number, { x: number; y: number }>
  /** Geração de cada pessoa (0 = a mais antiga do desenho). */
  geracao: Map<number, number>
  casais: Casal[]
  /** Ordem dos cartões de cada cluster (esquerda→direita), na ordem do desenho. */
  clusters: number[][]
}

/** Folgas por disposição: entre cônjuges, entre cartões vizinhos, entre gerações. */
export const FOLGAS: Record<Disposicao, { casal: number; cartao: number; geracao: number }> = {
  retrato: { casal: 20, cartao: 50, geracao: 100 },
  paisagem: { casal: 15, cartao: 30, geracao: 120 },
}

// ─── utilidades ────────────────────────────────────────────────────────────
const tempo = (v: Date | string | null | undefined): number | null => {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}
const chaveDoCasal = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)
const ehMasculino = (s: string | null | undefined): boolean => {
  const v = (s ?? "").trim().toLowerCase()
  return v === "m" || v.startsWith("masc")
}

type Faixa = { lo: number; hi: number }
type Contorno = Map<number, Faixa>

const deslocar = (c: Contorno, dx: number): Contorno => {
  const r: Contorno = new Map()
  for (const [g, f] of c) r.set(g, { lo: f.lo + dx, hi: f.hi + dx })
  return r
}
const fundir = (a: Contorno, b: Contorno): Contorno => {
  const r: Contorno = new Map(a)
  for (const [g, f] of b) {
    const x = r.get(g)
    r.set(g, x ? { lo: Math.min(x.lo, f.lo), hi: Math.max(x.hi, f.hi) } : { ...f })
  }
  return r
}
/** Quanto `b` precisa andar para a direita para ficar a `gap` de `a` em TODA geração que os dois ocupam. `-Infinity` se não dividem geração. */
const folgaEntre = (a: Contorno, b: Contorno, gap: number): number => {
  let m = -Infinity
  for (const [g, fb] of b) {
    const fa = a.get(g)
    if (fa) m = Math.max(m, fa.hi + gap - fb.lo)
  }
  return m
}

interface Cluster {
  id: number
  membros: number[] // sequência esquerda→direita
  desloc: Map<number, number> // deslocamento de cada membro desde a borda esquerda do cluster
  largura: number
  geracao: number
}
interface Vinculo {
  /** Cluster do filho. */
  filho: Cluster
  /** Quem, dentro do filho, tem este vínculo. */
  membro: number
  /** Cluster do genitor/casal. */
  pai: Cluster
  chave: string
  /** Onde o vínculo pende no cluster do genitor (deslocamento desde a borda esquerda). */
  ancora: number
}

export function desenharArvore(
  pessoas: readonly PessoaDoDesenho[],
  unioes: readonly UniaoDoDesenho[],
  opcoes: OpcoesDoDesenho,
): ResultadoDoDesenho {
  const { disposicao } = opcoes
  const folga = FOLGAS[disposicao]
  const S = disposicao === "retrato" ? opcoes.largura : opcoes.altura // medida transversal do cartão
  const A = disposicao === "retrato" ? opcoes.altura : opcoes.largura // medida na direção da geração
  const margem = opcoes.margem ?? 50

  const porId = new Map(pessoas.map((p) => [p.id, p]))
  const noDesenho = (id: number | null | undefined): id is number => id != null && porId.has(id)
  const nasc = (id: number): number | null => tempo(porId.get(id)?.data_nasc)
  const paisDe = (id: number): number[] => {
    const p = porId.get(id)!
    const r: number[] = []
    for (const x of [p.paiId, p.maeId]) if (noDesenho(x) && x !== id && !r.includes(x)) r.push(x)
    return r
  }

  // ── 1) CASAIS: uniões + pares de pais em comum (casal sem registro de união também fica encostado) ──
  interface CasalInterno extends Casal { inicio: number | null; ordem: number }
  const casaisMap = new Map<string, CasalInterno>()
  for (const u of unioes) {
    const a = u.pessoa1Id, b = u.pessoa2Id
    if (!noDesenho(a) || !noDesenho(b) || a === b) continue
    const k = chaveDoCasal(a, b)
    if (!casaisMap.has(k)) casaisMap.set(k, { a, b, uniaoId: u.id, inicio: tempo(u.data_inicio), ordem: u.id })
  }
  for (const p of pessoas) {
    if (noDesenho(p.paiId) && noDesenho(p.maeId) && p.paiId !== p.maeId) {
      const k = chaveDoCasal(p.paiId, p.maeId)
      if (!casaisMap.has(k)) casaisMap.set(k, { a: p.paiId, b: p.maeId, uniaoId: null, inicio: null, ordem: Number.MAX_SAFE_INTEGER })
    }
  }
  // Data de referência de um casal sem data de união: o nascimento do primeiro filho em comum.
  const primeiroFilho = new Map<string, number>()
  for (const p of pessoas) {
    if (noDesenho(p.paiId) && noDesenho(p.maeId)) {
      const t = nasc(p.id)
      if (t == null) continue
      const k = chaveDoCasal(p.paiId, p.maeId)
      primeiroFilho.set(k, Math.min(primeiroFilho.get(k) ?? Infinity, t))
    }
  }
  const chaveCronologica = (k: string, c: CasalInterno): number => c.inicio ?? primeiroFilho.get(k) ?? Number.MAX_SAFE_INTEGER
  const casaisDe = new Map<number, Array<{ k: string; c: CasalInterno }>>()
  for (const [k, c] of casaisMap) {
    for (const id of [c.a, c.b]) {
      if (!casaisDe.has(id)) casaisDe.set(id, [])
      casaisDe.get(id)!.push({ k, c })
    }
  }
  for (const lista of casaisDe.values()) {
    lista.sort((x, y) => chaveCronologica(x.k, x.c) - chaveCronologica(y.k, y.c) || x.c.ordem - y.c.ordem || x.k.localeCompare(y.k))
  }
  const parceiros = (id: number): number[] => (casaisDe.get(id) ?? []).map(({ c }) => (c.a === id ? c.b : c.a))

  // ── 2) CLUSTERS (união-busca sobre os casais) ──
  const pai = new Map<number, number>()
  const raiz = (x: number): number => { let r = x; while (pai.get(r) !== r) r = pai.get(r)!; let c = x; while (pai.get(c) !== r) { const n = pai.get(c)!; pai.set(c, r); c = n } return r }
  for (const p of pessoas) pai.set(p.id, p.id)
  for (const c of casaisMap.values()) { const ra = raiz(c.a), rb = raiz(c.b); if (ra !== rb) pai.set(Math.max(ra, rb), Math.min(ra, rb)) }
  const membrosPorRaiz = new Map<number, number[]>()
  for (const p of pessoas) {
    const r = raiz(p.id)
    if (!membrosPorRaiz.has(r)) membrosPorRaiz.set(r, [])
    membrosPorRaiz.get(r)!.push(p.id)
  }

  /** Ordem dos membros: pivô (mais uniões) no meio; 1º cônjuge à esquerda, 2º e seguintes à direita; casal simples: homem à esquerda. */
  const ordenar = (membros: number[]): number[] => {
    if (membros.length === 1) return membros
    const pivo = [...membros].sort((x, y) => (casaisDe.get(y)?.length ?? 0) - (casaisDe.get(x)?.length ?? 0) || x - y)[0]
    const colocado = new Set<number>([pivo])
    const esq: number[] = [], dir: number[] = []
    const estender = (ponta: number, lado: number[]) => {
      for (const o of parceiros(ponta)) {
        if (colocado.has(o)) continue
        colocado.add(o); lado.push(o); estender(o, lado)
      }
    }
    const conjuges = [...new Set(parceiros(pivo))].filter((x) => !colocado.has(x))
    if (conjuges.length === 1) {
      const so = conjuges[0]
      colocado.add(so)
      const lado = ehMasculino(porId.get(pivo)?.sexo) ? dir : esq
      lado.push(so); estender(so, lado)
    } else {
      const [primeiro, ...resto] = conjuges
      colocado.add(primeiro); esq.push(primeiro); estender(primeiro, esq)
      for (const s of resto) { if (colocado.has(s)) continue; colocado.add(s); dir.push(s); estender(s, dir) }
    }
    const sobra = membros.filter((m) => !colocado.has(m)).sort((x, y) => x - y)
    return [...esq.reverse(), pivo, ...dir, ...sobra]
  }

  const clusters = new Map<number, Cluster>()
  const clusterDe = new Map<number, Cluster>()
  for (const [r, m] of membrosPorRaiz) {
    const membros = ordenar(m)
    const desloc = new Map<number, number>()
    membros.forEach((id, i) => desloc.set(id, i * (S + folga.casal)))
    const c: Cluster = { id: r, membros, desloc, largura: membros.length * S + (membros.length - 1) * folga.casal, geracao: 0 }
    clusters.set(r, c)
    for (const id of membros) clusterDe.set(id, c)
  }
  const centro = (c: Cluster, id: number): number => c.desloc.get(id)! + S / 2

  // ── 3) VÍNCULOS de filiação (cluster do filho → cluster do genitor/casal) ──
  const vinculosDe = new Map<Cluster, Vinculo[]>()
  for (const p of pessoas) {
    const ps = paisDe(p.id)
    if (ps.length === 0) continue
    const filho = clusterDe.get(p.id)!
    const pc = clusterDe.get(ps[0])!
    if (pc === filho) continue // filho do próprio cônjuge: dado inconsistente, não vira ramo
    const chave = ps.length === 2 ? chaveDoCasal(ps[0], ps[1]) : `s${ps[0]}`
    const ancora = ps.length === 2 ? (centro(pc, ps[0]) + centro(pc, ps[1])) / 2 : centro(pc, ps[0])
    if (!vinculosDe.has(filho)) vinculosDe.set(filho, [])
    vinculosDe.get(filho)!.push({ filho, membro: p.id, pai: pc, chave, ancora })
  }

  // Quantos ancestrais (pessoas) tem um cluster — decide qual vínculo é o primário.
  const memoAnc = new Map<Cluster, number>()
  const ancestrais = (c: Cluster): number => {
    if (memoAnc.has(c)) return memoAnc.get(c)!
    const visto = new Set<Cluster>(), fila: Cluster[] = [c]
    let n = 0
    while (fila.length) {
      const x = fila.pop()!
      for (const v of vinculosDe.get(x) ?? []) {
        if (visto.has(v.pai) || v.pai === c) continue
        visto.add(v.pai); n += v.pai.membros.length; fila.push(v.pai)
      }
    }
    memoAnc.set(c, n)
    return n
  }
  const primario = new Map<Cluster, Vinculo>()
  for (const [c, vs] of vinculosDe) {
    const ordenados = [...vs].sort((x, y) => ancestrais(y.pai) - ancestrais(x.pai) || x.pai.id - y.pai.id || x.membro - y.membro)
    primario.set(c, ordenados[0])
  }
  // Sem ciclos: seguir o primário para cima; ao fechar um laço, o cluster atual vira raiz.
  for (const c of clusters.values()) {
    const trilha = new Set<Cluster>([c])
    let x = c
    for (;;) {
      const v = primario.get(x)
      if (!v) break
      if (trilha.has(v.pai)) { primario.delete(x); break }
      trilha.add(v.pai); x = v.pai
    }
  }
  const filhosDe = new Map<Cluster, Vinculo[]>()
  for (const v of primario.values()) {
    if (!filhosDe.has(v.pai)) filhosDe.set(v.pai, [])
    filhosDe.get(v.pai)!.push(v)
  }

  // ── 4) ÁRVORES e GERAÇÕES ──
  const raizDaArvore = new Map<Cluster, Cluster>()
  const profundidade = new Map<Cluster, number>()
  const subir = (c: Cluster): Cluster => {
    if (raizDaArvore.has(c)) return raizDaArvore.get(c)!
    const v = primario.get(c)
    if (!v) { raizDaArvore.set(c, c); profundidade.set(c, 0); return c }
    const r = subir(v.pai)
    raizDaArvore.set(c, r); profundidade.set(c, (profundidade.get(v.pai) ?? 0) + 1)
    return r
  }
  for (const c of clusters.values()) subir(c)
  const tamanhoArvore = new Map<Cluster, number>()
  for (const [c, r] of raizDaArvore) tamanhoArvore.set(r, (tamanhoArvore.get(r) ?? 0) + c.membros.length)
  const raizes = [...new Set(raizDaArvore.values())]

  // Ligações: os vínculos NÃO primários (a família do cônjuge). Exigem geração(filho) = geração(genitor)+1.
  const ligacoes: Array<{ filho: Cluster; pai: Cluster }> = []
  for (const [c, vs] of vinculosDe) {
    const prim = primario.get(c)
    for (const v of vs) {
      if (prim && v.pai === prim.pai) continue
      if (raizDaArvore.get(v.pai) === raizDaArvore.get(c)) continue // mesma árvore: não alinha nada novo
      ligacoes.push({ filho: c, pai: v.pai })
    }
  }
  ligacoes.sort((x, y) => x.filho.id - y.filho.id || x.pai.id - y.pai.id)

  const principalCluster = opcoes.principalId != null ? clusterDe.get(opcoes.principalId) : undefined
  const principalRaiz = principalCluster ? raizDaArvore.get(principalCluster)! : [...raizes].sort((x, y) => (tamanhoArvore.get(y) ?? 0) - (tamanhoArvore.get(x) ?? 0) || x.id - y.id)[0]

  const base = new Map<Cluster, number>() // linha da raiz de cada árvore
  if (principalRaiz) base.set(principalRaiz, 0)
  for (let passada = 0; passada < raizes.length + 2; passada++) {
    let mudou = false
    for (const l of ligacoes) {
      const rf = raizDaArvore.get(l.filho)!, rp = raizDaArvore.get(l.pai)!
      if (base.has(rf) && !base.has(rp)) {
        base.set(rp, base.get(rf)! + profundidade.get(l.filho)! - 1 - profundidade.get(l.pai)!); mudou = true
      } else if (base.has(rp) && !base.has(rf)) {
        base.set(rf, base.get(rp)! + profundidade.get(l.pai)! + 1 - profundidade.get(l.filho)!); mudou = true
      }
    }
    if (!mudou) break
  }
  for (const r of raizes) if (!base.has(r)) base.set(r, 0)
  let menor = Infinity
  for (const c of clusters.values()) { c.geracao = base.get(raizDaArvore.get(c)!)! + profundidade.get(c)!; menor = Math.min(menor, c.geracao) }
  if (Number.isFinite(menor)) for (const c of clusters.values()) c.geracao -= menor

  // ── 5) CONTORNOS, de baixo para cima ──
  const relX = new Map<Cluster, number>() // posição do cluster-filho relativa à borda esquerda do cluster-pai
  const contornoDe = new Map<Cluster, Contorno>()

  const ordemNasc = (v: Vinculo): number => nasc(v.membro) ?? Number.MAX_SAFE_INTEGER
  const dispor = (K: Cluster, ancestrais_: Set<Cluster>): Contorno => {
    if (contornoDe.has(K)) return contornoDe.get(K)!
    let c0: Contorno = new Map([[K.geracao, { lo: 0, hi: K.largura }]])
    const pend = (filhosDe.get(K) ?? []).filter((v) => !ancestrais_.has(v.filho))
    // grupos por âncora (casal ou genitor único), da esquerda para a direita
    const grupos = new Map<string, Vinculo[]>()
    for (const v of pend) {
      if (!grupos.has(v.chave)) grupos.set(v.chave, [])
      grupos.get(v.chave)!.push(v)
    }
    const listaGrupos = [...grupos.values()].map((vs) => ({ vs, ancora: vs[0].ancora })).sort((x, y) => x.ancora - y.ancora || x.vs[0].chave.localeCompare(y.vs[0].chave))
    const proximos = new Set(ancestrais_); proximos.add(K)
    const blocos: Array<{ itens: Array<{ v: Vinculo; x: number }>; contorno: Contorno; centro: number; ancora: number; p: number }> = []
    for (const g of listaGrupos) {
      // todos os membros do filho com este mesmo vínculo (mesma âncora) contam para o centro dos irmãos
      const filhos = new Map<Cluster, Vinculo[]>()
      for (const v of g.vs) { if (!filhos.has(v.filho)) filhos.set(v.filho, []); filhos.get(v.filho)!.push(v) }
      const ordenados = [...filhos.entries()].sort((x, y) => Math.min(...x[1].map(ordemNasc)) - Math.min(...y[1].map(ordemNasc)) || x[0].id - y[0].id)
      let acum: Contorno | null = null
      const itens: Array<{ v: Vinculo; x: number }> = []
      let minC = Infinity, maxC = -Infinity
      let fim = 0
      for (const [fc, vs] of ordenados) {
        const cf = dispor(fc, proximos)
        let x = 0
        if (acum) {
          const f = folgaEntre(acum, cf, folga.cartao)
          x = Number.isFinite(f) ? f : fim + folga.cartao
        }
        acum = acum ? fundir(acum, deslocar(cf, x)) : cf
        fim = x + fc.largura
        itens.push({ v: vs[0], x })
        for (const v of vs) {
          minC = Math.min(minC, x + fc.desloc.get(v.membro)!)
          maxC = Math.max(maxC, x + fc.desloc.get(v.membro)! + S)
        }
      }
      blocos.push({ itens, contorno: acum!, centro: (minC + maxC) / 2, ancora: g.ancora, p: g.ancora - (minC + maxC) / 2 })
    }
    // Separação entre blocos vizinhos (filhos de uniões diferentes): afastam-se simetricamente, só o necessário.
    for (let j = 1; j < blocos.length; j++) {
      const f = folgaEntre(deslocar(blocos[j - 1].contorno, blocos[j - 1].p), deslocar(blocos[j].contorno, blocos[j].p), folga.cartao)
      if (Number.isFinite(f) && f > 0) {
        for (let k = 0; k < j; k++) blocos[k].p -= f / 2
        for (let k = j; k < blocos.length; k++) blocos[k].p += f / 2
      }
    }
    for (const b of blocos) {
      for (const it of b.itens) relX.set(it.v.filho, b.p + it.x)
      c0 = fundir(c0, deslocar(b.contorno, b.p))
    }
    contornoDe.set(K, c0)
    return c0
  }

  // ── 6) FLORESTA: o ramo principal e, ao lado do que eles alimentam, as famílias dos cônjuges ──
  const ordemRaizes: Cluster[] = []
  if (principalRaiz) ordemRaizes.push(principalRaiz)
  for (let i = 0; i < ordemRaizes.length; i++) {
    const atual = ordemRaizes[i]
    const achadas: Cluster[] = []
    for (const l of ligacoes) {
      const rf = raizDaArvore.get(l.filho)!, rp = raizDaArvore.get(l.pai)!
      for (const alvo of rf === atual ? [rp] : rp === atual ? [rf] : []) {
        if (!ordemRaizes.includes(alvo) && !achadas.includes(alvo)) achadas.push(alvo)
      }
    }
    ordemRaizes.splice(i + 1, 0, ...achadas)
  }
  const soltas = raizes.filter((r) => !ordemRaizes.includes(r)).sort((x, y) => (tamanhoArvore.get(y) ?? 0) - (tamanhoArvore.get(x) ?? 0) || x.id - y.id)
  ordemRaizes.push(...soltas)

  const absoluto = new Map<Cluster, number>()
  let acumulado: Contorno | null = null
  for (const r of ordemRaizes) {
    const cr = dispor(r, new Set())
    let x = 0
    if (acumulado) {
      const f = folgaEntre(acumulado, cr, folga.cartao * 2)
      x = Number.isFinite(f) ? f : Math.max(...[...acumulado.values()].map((q) => q.hi)) + folga.cartao * 2
    }
    absoluto.set(r, x)
    acumulado = acumulado ? fundir(acumulado, deslocar(cr, x)) : cr
  }
  const descer = (K: Cluster) => {
    for (const v of filhosDe.get(K) ?? []) {
      if (!relX.has(v.filho) || absoluto.has(v.filho)) continue
      absoluto.set(v.filho, absoluto.get(K)! + relX.get(v.filho)!)
      descer(v.filho)
    }
  }
  for (const r of ordemRaizes) descer(r)

  // ── 7) COORDENADAS FINAIS ──
  let minU = Infinity
  for (const c of clusters.values()) if (absoluto.has(c)) minU = Math.min(minU, absoluto.get(c)!)
  if (!Number.isFinite(minU)) minU = 0
  const linhas = Math.max(0, ...[...clusters.values()].map((c) => c.geracao))
  const posicoes = new Map<number, { x: number; y: number }>()
  const geracao = new Map<number, number>()
  for (const c of clusters.values()) {
    const u0 = (absoluto.get(c) ?? 0) - minU
    for (const id of c.membros) {
      const u = u0 + c.desloc.get(id)! + margem
      const v = c.geracao * (A + folga.geracao) + margem
      geracao.set(id, c.geracao)
      // Retrato: ancestrais em cima. Paisagem: ancestrais à direita, descendentes à esquerda.
      posicoes.set(id, disposicao === "retrato" ? { x: u, y: v } : { x: (linhas - c.geracao) * (A + folga.geracao) + margem, y: u })
    }
  }
  return {
    posicoes,
    geracao,
    casais: [...casaisMap.values()].map(({ a, b, uniaoId }) => ({ a, b, uniaoId })),
    clusters: [...clusters.values()].map((c) => c.membros),
  }
}

// ─── GEOMETRIA DAS LINHAS ───────────────────────────────────────────────────
export interface Retangulo { x: number; y: number; w: number; h: number }
export type Lado = "top" | "right" | "bottom" | "left"

/**
 * A linha de casamento: os lados que SE TOCAM, escolhidos pela posição real dos dois cartões (nunca por "homem sai pela direita").
 * O eixo é o de maior distância entre os centros; arrastar o cônjuge para o outro lado troca os lados.
 */
export function ladosDoCasal(a: Retangulo, b: Retangulo): { a: Lado; b: Lado } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { a: "right", b: "left" } : { a: "left", b: "right" }
  return dy >= 0 ? { a: "bottom", b: "top" } : { a: "top", b: "bottom" }
}
