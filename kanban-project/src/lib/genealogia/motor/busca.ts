// src/lib/genealogia/motor/busca.ts
//
// Busca instantânea, difusa e CONTEXTUAL.
//
// Diferença para um filtro comum: aqui se busca por qualquer coisa que o
// operador lembre — nome, apelido, cidade, cartório, ano, profissão, navio,
// geração, "filho de X", "casado com Y" — e com erro de digitação. Um índice
// achatado é montado uma vez por árvore; a consulta é linear sobre ele.

import type { GrafoGenealogico } from "./grafo"
import type { AnaliseArvore } from "./tipos"
import { anoDe, normalizar, nomeCompleto, pontuarBusca } from "./texto"

export interface ItemIndice {
  pessoaId: number
  nome: string
  subtitulo: string
  /** Campos pesquisáveis com peso — ordem importa para o ranking. */
  campos: Array<{ valor: string; peso: number; rotulo: string }>
  geracao: number
  naLinha: boolean
  completude: number
}

export interface ResultadoBusca {
  pessoaId: number
  score: number
  nome: string
  subtitulo: string
  /** Qual campo casou — mostrado no resultado ("Cartório: Bianchi"). */
  motivo: string
  naLinha: boolean
}

export function montarIndice(g: GrafoGenealogico, analise: AnaliseArvore): ItemIndice[] {
  const itens: ItemIndice[] = []

  for (const p of g.pessoas) {
    const a = analise.porPessoa.get(p.id)
    const campos: ItemIndice["campos"] = []
    const add = (valor: string | null | undefined, peso: number, rotulo: string) => {
      if (valor && String(valor).trim()) campos.push({ valor: String(valor), peso, rotulo })
    }

    add(nomeCompleto(p), 10, "Nome")
    add(p.nome, 9, "Nome")
    add(p.sobrenome, 8, "Sobrenome")
    add(p.local_nasc, 5, "Cidade")
    add(p.estado_nasc, 4, "Estado")
    add(p.pais_nasc, 4, "País")
    add(p.nacionalidade, 4, "Nacionalidade")
    add(p.profissao, 4, "Profissão")
    add(p.navio, 4, "Navio")
    add(p.porto_chegada, 3, "Porto de chegada")
    add(p.porto_embarque, 3, "Porto de embarque")
    add(p.local_emigracao, 3, "Local de emigração")
    add(p.comentario, 2, "Observação")

    const anoN = anoDe(p.data_nasc)
    const anoO = anoDe(p.data_obito)
    if (anoN) add(String(anoN), 6, "Ano de nascimento")
    if (anoO) add(String(anoO), 5, "Ano de óbito")

    // Relacionamentos: buscar "filho de Giovanni" tem de funcionar.
    for (const parente of g.paisDe(p.id)) add(nomeCompleto(parente), 3, "Filho(a) de")
    for (const c of g.conjuges(p.id)) add(nomeCompleto(c), 3, "Cônjuge")
    for (const f of g.filhos(p.id)) add(nomeCompleto(f), 2, "Pai/mãe de")

    for (const u of g.unioesDe(p.id)) {
      add(u.local, 3, "Local do casamento")
      add(u.cartorio, 4, "Cartório")
      const anoC = anoDe(u.data_inicio)
      if (anoC) add(String(anoC), 4, "Ano do casamento")
    }

    itens.push({
      pessoaId: p.id,
      nome: nomeCompleto(p),
      subtitulo: a?.resumo || "",
      campos,
      geracao: a?.geracao ?? 0,
      naLinha: a?.naLinhaCidadania ?? false,
      completude: a?.completude ?? 0,
    })
  }

  return itens
}

export function buscar(indice: ItemIndice[], termo: string, limite = 12): ResultadoBusca[] {
  const t = normalizar(termo)
  if (!t) return []

  // Multi-termo: "giovanni 1890 napoli" precisa casar os três.
  const termos = t.split(" ").filter(Boolean)
  const resultados: ResultadoBusca[] = []

  for (const item of indice) {
    let scoreTotal = 0
    let motivo = ""
    let melhorPeso = 0
    let casaramTodos = true

    for (const termoAtual of termos) {
      let melhorDoTermo = 0
      let melhorCampo: ItemIndice["campos"][number] | null = null

      for (const campo of item.campos) {
        const s = pontuarBusca(termoAtual, campo.valor)
        if (s === 0) continue
        const ponderado = s * (campo.peso / 10)
        if (ponderado > melhorDoTermo) {
          melhorDoTermo = ponderado
          melhorCampo = campo
        }
      }

      if (melhorDoTermo === 0) {
        casaramTodos = false
        break
      }
      scoreTotal += melhorDoTermo
      if (melhorCampo && melhorCampo.peso > melhorPeso) {
        melhorPeso = melhorCampo.peso
        motivo = melhorCampo.rotulo === "Nome" ? "" : `${melhorCampo.rotulo}: ${melhorCampo.valor}`
      }
    }

    if (!casaramTodos) continue

    // Linha de cidadania sobe no ranking: é quase sempre o que se procura.
    const bonus = item.naLinha ? 0.18 : 0
    resultados.push({
      pessoaId: item.pessoaId,
      score: scoreTotal / termos.length + bonus,
      nome: item.nome,
      subtitulo: item.subtitulo,
      motivo,
      naLinha: item.naLinha,
    })
  }

  return resultados.sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome)).slice(0, limite)
}
