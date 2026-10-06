// src/lib/genealogia/geracao.ts
// ============================================================================
// GERAÇÃO DE VERDADE (06/10/2026) — o "G" que a tela mostra. Calculada AGORA, a partir da filiação; nunca lida de `Pessoa.numeroLinhagem`.
//
//   G1 = o ancestral que origina o direito; os filhos dele G2; os filhos deles G3…  O cônjuge tem a geração do parceiro.
//   Irmãos têm a MESMA geração.
//
// `numeroLinhagem` é OUTRA coisa: um número de SEQUÊNCIA (percurso em profundidade da linha de sangue, que ordena a pasta documental) — irmãos
// recebem números diferentes. Ele continua existindo, com o mesmo significado, para a pasta documental; só deixou de ser exibido como "G".
//
// PURO: sem banco, sem tela. A origem é a(s) pessoa(s) marcada(s) na linha reta que não tem pai/mãe também marcado na linha reta; sem nenhuma
// marcação, o(s) ancestral(is) mais alto(s) de algum requerente.
// ============================================================================

export interface PessoaParaGeracao {
  id: number
  paiId?: number | null
  maeId?: number | null
  linhaReta?: boolean | null
  /** Marcador `Pessoa.requerente` ("sim" | "maior" | "menor" | "nao"). */
  requerente?: string | null
}
export interface UniaoParaGeracao { pessoa1Id?: number | null; pessoa2Id?: number | null }

const ehRequerenteMarcador = (m: string | null | undefined): boolean => {
  const v = String(m ?? 'nao').trim().toLowerCase()
  return v === 'sim' || v === 'maior' || v === 'menor'
}

/** `pessoaId → geração` (1 = o ancestral de origem). `null` = sem geração derivável (fora da árvore de descendência da origem e sem filho com geração). */
export function calcularGeracoes(pessoas: readonly PessoaParaGeracao[], unioes: readonly UniaoParaGeracao[]): Map<number, number | null> {
  const porId = new Map(pessoas.map((p) => [p.id, p]))
  const paisDe = (p: PessoaParaGeracao): number[] => [p.paiId, p.maeId].filter((x): x is number => x != null && porId.has(x) && x !== p.id)
  const filhosDe = new Map<number, number[]>()
  for (const p of pessoas) for (const pai of paisDe(p)) { if (!filhosDe.has(pai)) filhosDe.set(pai, []); filhosDe.get(pai)!.push(p.id) }
  const conjuges = new Map<number, number[]>()
  for (const u of unioes) {
    const a = u.pessoa1Id, b = u.pessoa2Id
    if (a == null || b == null || a === b || !porId.has(a) || !porId.has(b)) continue
    if (!conjuges.has(a)) conjuges.set(a, [])
    if (!conjuges.has(b)) conjuges.set(b, [])
    conjuges.get(a)!.push(b); conjuges.get(b)!.push(a)
  }
  for (const p of pessoas) {
    if (p.paiId != null && p.maeId != null && porId.has(p.paiId) && porId.has(p.maeId)) { // pais em comum também formam casal
      if (!conjuges.has(p.paiId)) conjuges.set(p.paiId, [])
      if (!conjuges.has(p.maeId)) conjuges.set(p.maeId, [])
      if (!conjuges.get(p.paiId)!.includes(p.maeId)) conjuges.get(p.paiId)!.push(p.maeId)
      if (!conjuges.get(p.maeId)!.includes(p.paiId)) conjuges.get(p.maeId)!.push(p.paiId)
    }
  }

  // ORIGEM: marcado na linha reta e sem pai/mãe também marcado na linha reta.
  const naLinha = new Set(pessoas.filter((p) => p.linhaReta === true).map((p) => p.id))
  let origens = pessoas.filter((p) => naLinha.has(p.id) && !paisDe(p).some((x) => naLinha.has(x))).map((p) => p.id)
  if (origens.length === 0) {
    // Sem marcação de linha reta: os ancestrais mais altos de algum requerente.
    const reqs = pessoas.filter((p) => ehRequerenteMarcador(p.requerente)).map((p) => p.id)
    const acima = new Set<number>(), fila = [...reqs]
    while (fila.length) { const x = fila.pop()!; for (const pai of paisDe(porId.get(x)!)) if (!acima.has(pai)) { acima.add(pai); fila.push(pai) } }
    const topos = [...acima].filter((id) => paisDe(porId.get(id)!).length === 0).sort((a, b) => a - b)
    // Entre os topos, a origem é quem tem a MAIOR cadeia até um requerente (o sogro que só entra por casamento tem cadeia menor).
    const reqSet = new Set(reqs)
    const alcance = (t: number): number => {
      let nivel = [t], d = 0, melhor = reqSet.has(t) ? 0 : -1
      const visto = new Set<number>([t])
      while (nivel.length) {
        const prox: number[] = []
        for (const x of nivel) for (const f of filhosDe.get(x) ?? []) if (!visto.has(f)) { visto.add(f); prox.push(f) }
        d++
        if (prox.some((f) => reqSet.has(f))) melhor = d
        nivel = prox
      }
      return melhor
    }
    const alcances = new Map(topos.map((t) => [t, alcance(t)]))
    const maior = Math.max(-1, ...alcances.values())
    origens = topos.filter((t) => alcances.get(t) === maior)
  }

  const gen = new Map<number, number>()
  // Descendo (largura) + cônjuge na geração do parceiro. A origem e o parceiro dela são G1.
  let fronteira = origens.slice()
  for (const o of origens) gen.set(o, 1)
  const entrarComConjuges = (ids: number[]): number[] => {
    const extra: number[] = []
    for (const id of ids) for (const c of conjuges.get(id) ?? []) if (!gen.has(c)) { gen.set(c, gen.get(id)!); extra.push(c) }
    return extra
  }
  fronteira = [...fronteira, ...entrarComConjuges(fronteira)]
  for (let guarda = 0; fronteira.length && guarda < pessoas.length + 5; guarda++) {
    const proximos: number[] = []
    for (const id of fronteira) for (const f of filhosDe.get(id) ?? []) if (!gen.has(f)) { gen.set(f, gen.get(id)! + 1); proximos.push(f) }
    fronteira = [...proximos, ...entrarComConjuges(proximos)]
  }
  // Subindo: quem sobrou mas tem filho com geração (ex.: pais do cônjuge) fica uma geração acima do filho — só se isso ainda for G1 ou mais.
  for (let mudou = true, guarda = 0; mudou && guarda < pessoas.length + 5; guarda++) {
    mudou = false
    for (const p of pessoas) {
      if (gen.has(p.id)) continue
      const doFilhos = (filhosDe.get(p.id) ?? []).map((f) => gen.get(f)).filter((g): g is number => g != null)
      if (doFilhos.length === 0) continue
      const g = Math.min(...doFilhos) - 1
      if (g >= 1) { gen.set(p.id, g); mudou = true; for (const c of conjuges.get(p.id) ?? []) if (!gen.has(c)) { gen.set(c, g); } }
    }
  }
  return new Map(pessoas.map((p) => [p.id, gen.get(p.id) ?? null]))
}

/** O rótulo exibido: "G3". `null` quando não há geração. */
export const rotuloDaGeracao = (g: number | null | undefined): string | null => (g != null ? `G${g}` : null)
