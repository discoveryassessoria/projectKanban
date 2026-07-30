// src/lib/genealogia/motor/regras/sugestoes.ts
//
// Sugestões de vínculo: possíveis pais, mães, irmãos, cônjuges e filhos.
//
// Toda sugestão é uma HIPÓTESE com probabilidade explícita e evidência listada.
// O motor jamais cria o vínculo — ele propõe, o operador confirma. Sugestão sem
// evidência visível é ruído; por isso cada uma carrega o "porquê".

import type { GrafoGenealogico } from "../grafo"
import type { Insight, PessoaEntrada } from "../tipos"
import { anoDe, chaveFonetica, nomeCompleto, similaridadeLocal, similaridadeNome } from "../texto"

const LIMIAR = 0.55
const MAX_POR_PESSOA = 3

interface Candidato {
  id: number
  score: number
  evidencias: string[]
}

/** Teto de sugestões devolvidas — lista infinita é o mesmo que lista nenhuma. */
const MAX_SUGESTOES = 200

export function analisarSugestoes(g: GrafoGenealogico, naLinha: Set<number>): Insight[] {
  const out: Insight[] = []

  // Índice por chave fonética de sobrenome — evita varrer todo mundo.
  const porSobrenome = g.bucketsFoneticos()

  // Índice ano → ids dentro de cada bucket. Sem isso, um sobrenome com 500
  // pessoas geraria 250 mil comparações; com ele, só a janela etária plausível
  // é visitada. É o que mantém a sugestão instantânea numa árvore grande.
  const indicePorBucket = new Map<string, { porAno: Map<number, number[]>; semAno: number[] }>()
  const indiceDe = (chave: string) => {
    let idx = indicePorBucket.get(chave)
    if (idx) return idx
    idx = { porAno: new Map<number, number[]>(), semAno: [] }
    for (const id of porSobrenome.get(chave) || []) {
      const ano = anoDe(g.pessoa(id)?.data_nasc)
      if (ano == null) idx.semAno.push(id)
      else {
        const arr = idx.porAno.get(ano) || []
        arr.push(id)
        idx.porAno.set(ano, arr)
      }
    }
    indicePorBucket.set(chave, idx)
    return idx
  }
  const naJanela = (chave: string, de: number | null, ate: number | null): number[] => {
    const idx = indiceDe(chave)
    if (de == null || ate == null) return porSobrenome.get(chave) || []
    const r: number[] = [...idx.semAno]
    for (let ano = de; ano <= ate; ano++) {
      const arr = idx.porAno.get(ano)
      if (arr) r.push(...arr)
    }
    return r
  }

  for (const p of g.pessoas) {
    const chave = chaveFonetica(p.sobrenome || p.nome)
    const universo = chave ? porSobrenome.get(chave) || [] : []
    if (universo.length < 2) continue
    const anoP = anoDe(p.data_nasc)

    const prioridade = naLinha.has(p.id) ? 1.35 : 1

    // ---------- pai / mãe ----------
    for (const papel of ["pai", "mae"] as const) {
      const jaTem = papel === "pai" ? p.paiId != null : p.maeId != null
      if (jaTem) continue

      const candidatos: Candidato[] = []
      // Janela etária plausível para um ascendente deste papel.
      const de = anoP != null ? anoP - (papel === "mae" ? 50 : 70) : null
      const ate = anoP != null ? anoP - (papel === "mae" ? 14 : 15) : null
      for (const outroId of naJanela(chave, de, ate)) {
        if (outroId === p.id) continue
        const c = pontuarAscendente(g, p, outroId, papel)
        if (c && c.score >= LIMIAR) candidatos.push(c)
      }
      candidatos.sort((a, b) => b.score - a.score || a.id - b.id)

      for (const c of candidatos.slice(0, MAX_POR_PESSOA)) {
        const alvo = g.pessoa(c.id)!
        out.push({
          id: `sug-${papel}-${p.id}-${c.id}`,
          categoria: "relacao",
          severidade: c.score > 0.8 ? "medio" : "baixo",
          titulo: `${nomeCompleto(alvo)} pode ser ${papel === "pai" ? "o pai" : "a mãe"} de ${nomeCompleto(p)}`,
          explicacao: `${Math.round(c.score * 100)}% de compatibilidade — ${c.evidencias.join(", ")}.`,
          acao: `Confirmar na certidão de nascimento de ${nomeCompleto(p)} antes de criar o vínculo.`,
          pessoaIds: [p.id, c.id],
          confianca: c.score,
          peso: Math.round(c.score * 60 * prioridade),
        })
      }
    }

    // ---------- irmãos ----------
    if (p.paiId == null && p.maeId == null) {
      const candidatos: Candidato[] = []
      const janela = naJanela(
        chave,
        anoP != null ? anoP - 25 : null,
        anoP != null ? anoP + 25 : null,
      )
      for (const outroId of janela) {
        if (outroId === p.id || outroId < p.id) continue // par único
        const c = pontuarIrmao(g, p, outroId)
        if (c && c.score >= LIMIAR + 0.1) candidatos.push(c)
      }
      candidatos.sort((a, b) => b.score - a.score || a.id - b.id)
      for (const c of candidatos.slice(0, MAX_POR_PESSOA)) {
        const alvo = g.pessoa(c.id)!
        out.push({
          id: `sug-irmao-${p.id}-${c.id}`,
          categoria: "relacao",
          severidade: "baixo",
          titulo: `${nomeCompleto(p)} e ${nomeCompleto(alvo)} podem ser irmãos`,
          explicacao: `${Math.round(c.score * 100)}% de compatibilidade — ${c.evidencias.join(", ")}. Nenhum dos dois tem filiação cadastrada.`,
          acao: "Se forem irmãos, cadastrar os pais uma vez só e ligar os dois — economiza uma linha inteira de pesquisa.",
          pessoaIds: [p.id, c.id],
          confianca: c.score,
          peso: Math.round(c.score * 45 * prioridade),
        })
      }
    }

    // ---------- cônjuge ----------
    // Pessoa marcada como casada, mas sem união registrada: o casamento é a
    // certidão que mais frequentemente resolve filiação da geração acima.
    if (p.casado && g.unioesDe(p.id).length === 0) {
      out.push({
        id: `sug-conjuge-ausente-${p.id}`,
        categoria: "relacao",
        severidade: naLinha.has(p.id) ? "medio" : "baixo",
        titulo: `${nomeCompleto(p)} consta como casada, mas não tem cônjuge na árvore`,
        explicacao: "A certidão de casamento traz a filiação dos dois cônjuges — é o documento que mais desbloqueia a geração seguinte.",
        acao: "Cadastrar o cônjuge e a data do casamento.",
        pessoaIds: [p.id],
        confianca: 1,
        peso: naLinha.has(p.id) ? 55 : 30,
      })
    }
  }

  // ---------- casal implícito sem união registrada ----------
  for (const casal of g.todosCasais()) {
    if (casal.uniaoId != null || casal.filhos.length === 0) continue
    const a = g.pessoa(casal.a)
    const b = g.pessoa(casal.b)
    if (!a || !b) continue
    const relevante = naLinha.has(casal.a) || naLinha.has(casal.b)
    out.push({
      id: `sug-uniao-implicita-${casal.chave}`,
      categoria: "relacao",
      severidade: relevante ? "medio" : "baixo",
      titulo: `${nomeCompleto(a)} e ${nomeCompleto(b)} têm ${casal.filhos.length} ${casal.filhos.length === 1 ? "filho em comum" : "filhos em comum"}, mas nenhuma união registrada`,
      explicacao: "Os dois aparecem como pai e mãe das mesmas pessoas, porém sem casamento cadastrado — a data e o local do casamento ficam de fora do dossiê.",
      acao: "Registrar a união (data e local) para habilitar a certidão de casamento.",
      pessoaIds: [casal.a, casal.b],
      confianca: 0.95,
      peso: relevante ? 58 : 28,
    })
  }

  // Ordena por relevância e corta: o painel mostra o que importa, não tudo.
  out.sort((a, b) => b.peso - a.peso || (b.confianca ?? 0) - (a.confianca ?? 0) || a.id.localeCompare(b.id))
  return out.slice(0, MAX_SUGESTOES)
}

function pontuarAscendente(
  g: GrafoGenealogico,
  filho: PessoaEntrada,
  candidatoId: number,
  papel: "pai" | "mae",
): Candidato | null {
  const c = g.pessoa(candidatoId)
  if (!c) return null

  // Sexo tem de bater com o papel
  const sexo = (c.sexo || "").charAt(0).toUpperCase()
  if (papel === "pai" && sexo === "F") return null
  if (papel === "mae" && sexo === "M") return null
  if (!sexo) return null // sem sexo definido não sugerimos papel

  // Não pode ser descendente do próprio filho (ciclo)
  if (g.descendentes(filho.id).has(candidatoId)) return null
  if (candidatoId === filho.paiId || candidatoId === filho.maeId) return null
  if (g.irmaosIds(filho.id).includes(candidatoId)) return null
  if (g.conjugesIds(filho.id).includes(candidatoId)) return null

  const evidencias: string[] = []
  let score = 0

  // Idade — condição necessária, não apenas pontuação
  const anoF = anoDe(filho.data_nasc)
  const anoC = anoDe(c.data_nasc)
  if (anoF != null && anoC != null) {
    const dif = anoF - anoC
    const min = papel === "mae" ? 14 : 15
    const max = papel === "mae" ? 50 : 70
    if (dif < min || dif > max) return null
    // ideal entre 20 e 35
    const ideal = 1 - Math.min(1, Math.abs(dif - 27) / 30)
    score += 0.35 * ideal
    evidencias.push(`${dif} anos mais velho(a)`)
  } else {
    score += 0.1
  }

  // Óbito antes do nascimento do filho derruba
  const anoObito = anoDe(c.data_obito)
  if (anoObito != null && anoF != null && anoObito < anoF - (papel === "pai" ? 1 : 0)) return null

  // Sobrenome
  const sim = similaridadeNome(filho.sobrenome, c.sobrenome)
  if (filho.sobrenome && c.sobrenome) {
    if (sim > 0.9) {
      score += 0.4
      evidencias.push("mesmo sobrenome")
    } else if (sim > 0.75) {
      score += 0.25
      evidencias.push("sobrenome equivalente")
    } else if (papel === "pai") {
      return null // pai com sobrenome diferente não é hipótese útil
    }
  }

  // Local
  const simLocal = similaridadeLocal(filho.local_nasc, c.local_nasc)
  if (simLocal > 0.7) {
    score += 0.15
    evidencias.push("mesma localidade")
  }

  // Cônjuge do candidato já é o outro genitor → sinal muito forte
  const outroGenitorId = papel === "pai" ? filho.maeId : filho.paiId
  if (outroGenitorId != null && g.conjugesIds(candidatoId).includes(outroGenitorId)) {
    score += 0.4
    evidencias.push(`já é cônjuge ${papel === "pai" ? "da mãe" : "do pai"} cadastrado(a)`)
  }

  // Um irmão já confirmado aponta para o mesmo candidato
  for (const irmaoId of g.irmaosIds(filho.id)) {
    const irmao = g.pessoa(irmaoId)
    if (!irmao) continue
    if ((papel === "pai" ? irmao.paiId : irmao.maeId) === candidatoId) {
      score += 0.35
      evidencias.push(`já é ${papel} de ${nomeCompleto(irmao)}, irmão(ã) confirmado(a)`)
      break
    }
  }

  if (evidencias.length === 0) return null
  return { id: candidatoId, score: Math.min(1, score), evidencias }
}

function pontuarIrmao(
  g: GrafoGenealogico,
  a: PessoaEntrada,
  candidatoId: number,
): Candidato | null {
  const b = g.pessoa(candidatoId)
  if (!b) return null
  if (b.paiId != null || b.maeId != null) return null
  if (g.conjugesIds(a.id).includes(candidatoId)) return null

  const evidencias: string[] = []
  let score = 0

  const sim = similaridadeNome(a.sobrenome, b.sobrenome)
  if (!a.sobrenome || !b.sobrenome || sim < 0.85) return null
  score += 0.4
  evidencias.push("mesmo sobrenome")

  const anoA = anoDe(a.data_nasc)
  const anoB = anoDe(b.data_nasc)
  if (anoA != null && anoB != null) {
    const dif = Math.abs(anoA - anoB)
    if (dif > 25) return null
    score += 0.3 * (1 - dif / 25)
    evidencias.push(`nascimentos a ${dif} ano(s) de distância`)
  }

  const simLocal = similaridadeLocal(a.local_nasc, b.local_nasc)
  if (simLocal > 0.7) {
    score += 0.3
    evidencias.push("mesma localidade de nascimento")
  } else if (a.local_nasc && b.local_nasc) {
    return null // sobrenome igual + cidades diferentes = coincidência comum
  }

  // Nomes próprios idênticos = mais provável duplicidade que irmandade
  if (similaridadeNome(a.nome, b.nome) > 0.92) return null

  return { id: candidatoId, score: Math.min(1, score), evidencias }
}
