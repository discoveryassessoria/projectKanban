// src/lib/genealogia/motor/regras/linhagem.ts
//
// Linha de cidadania, migração e variação de sobrenome.
//
// Esta é a regra que diferencia um escritório de cidadania de um hobby de
// genealogia: o que importa não é a árvore inteira, é o CAMINHO do requerente
// até o ascendente estrangeiro (dante causa). Tudo que está fora desse caminho
// é secundário — e o motor precisa saber disso para priorizar.

import type { GrafoGenealogico } from "../grafo"
import type { Insight, PaisAlvo, PessoaEntrada } from "../tipos"
import { anoDe, chaveFonetica, formatarData, nomeCompleto, normalizar } from "../texto"

const SINONIMOS_PAIS: Record<PaisAlvo, string[]> = {
  ITALIA: ["ITALIA", "ITALY", "ITALIANA", "ITALIANO", "REINO DA ITALIA", "REGNO D ITALIA"],
  PORTUGAL: ["PORTUGAL", "PORTUGUESA", "PORTUGUES", "PORTUGUESE"],
  ESPANHA: ["ESPANHA", "ESPANA", "SPAIN", "ESPANHOLA", "ESPANHOL", "ESPANOLA"],
  ALEMANHA: ["ALEMANHA", "GERMANY", "DEUTSCHLAND", "ALEMA", "ALEMAO", "PRUSSIA", "IMPERIO ALEMAO"],
}

export interface ResultadoLinhagem {
  linha: number[]            // requerente → dante causa (inclusive)
  danteCausaId: number | null
  requerenteId: number | null
  naLinha: Set<number>
  insights: Insight[]
}

/** É desta nacionalidade/país-alvo? Aceita país de nascimento OU nacionalidade. */
export function ehDoPais(p: PessoaEntrada, alvo: PaisAlvo): boolean {
  const termos = SINONIMOS_PAIS[alvo]
  const campos = [p.pais_nasc, p.nacionalidade].map((v) => normalizar(v)).filter(Boolean)
  return campos.some((c) => termos.some((t) => c === t || c.includes(t)))
}

/** Requerente principal: o marcado no processo; senão, a raiz da árvore. */
export function acharRequerente(g: GrafoGenealogico, raizId: number | null): number | null {
  const marcados = g.pessoas.filter((p) => {
    const r = (p.requerente || "").toLowerCase()
    return r === "sim" || r === "maior" || r === "menor"
  })
  if (marcados.length === 1) return marcados[0].id
  if (marcados.length > 1) {
    // O requerente da linha é o de menor geração (mais novo) com mais ascendentes.
    return marcados
      .map((p) => ({ id: p.id, anc: g.ancestrais(p.id).size }))
      .sort((a, b) => b.anc - a.anc || a.id - b.id)[0].id
  }
  return raizId
}

export function analisarLinhagem(
  g: GrafoGenealogico,
  paisAlvo: PaisAlvo | null,
  raizId: number | null,
): ResultadoLinhagem {
  const insights: Insight[] = []
  const requerenteId = acharRequerente(g, raizId)
  const vazio: ResultadoLinhagem = {
    linha: [],
    danteCausaId: null,
    requerenteId,
    naLinha: new Set(),
    insights,
  }
  if (requerenteId == null) return vazio

  // 1. Candidatos a dante causa: ascendentes nascidos no país-alvo.
  const ancestrais = g.ancestrais(requerenteId)
  const candidatos: number[] = []
  if (paisAlvo) {
    for (const id of ancestrais) {
      const p = g.pessoa(id)
      if (p && ehDoPais(p, paisAlvo)) candidatos.push(id)
    }
  }

  // 2. O dante causa é o candidato MAIS PRÓXIMO do requerente (menor caminho):
  //    é ele que define quantas gerações de documentos serão necessárias.
  let danteCausaId: number | null = null
  let linha: number[] = []
  let melhorTamanho = Infinity
  for (const c of candidatos) {
    const caminho = g.caminhoAscendente(requerenteId, c)
    if (caminho && caminho.length < melhorTamanho) {
      melhorTamanho = caminho.length
      danteCausaId = c
      linha = caminho
    }
  }

  // 3. Sem candidato: a linha é a cadeia marcada como linhaReta, ou a mais longa.
  if (!danteCausaId) {
    linha = cadeiaMaisProfunda(g, requerenteId)
    danteCausaId = linha.length > 1 ? linha[linha.length - 1] : null

    if (paisAlvo) {
      const topo = danteCausaId ? g.pessoa(danteCausaId) : null
      insights.push({
        id: "linha-sem-dante-causa",
        categoria: "risco",
        severidade: "critico",
        titulo: "Nenhum ascendente registrado como nascido no país de origem",
        explicacao: `Não há, na linha do requerente, ninguém com país de nascimento ou nacionalidade correspondente a ${rotuloPais(paisAlvo)}. Sem o dante causa identificado o processo não tem fundamento documental.${topo ? ` O ascendente mais distante mapeado é ${nomeCompleto(topo)}.` : ""}`,
        acao: topo
          ? `Preencher o país de nascimento de ${nomeCompleto(topo)} ou continuar subindo a linha até encontrar o ascendente estrangeiro.`
          : "Cadastrar os ascendentes até chegar ao estrangeiro que origina o direito.",
        pessoaIds: topo ? [topo.id] : [],
        confianca: 0.95,
        peso: 120,
      })
    }
  }

  const naLinha = new Set(linha)

  // 4. Lacunas na linha: qualquer pessoa da linha sem pai/mãe é o gargalo real.
  for (let i = 0; i < linha.length; i++) {
    const id = linha[i]
    const p = g.pessoa(id)
    if (!p) continue
    const ehTopo = id === danteCausaId
    if (!ehTopo && p.paiId == null && p.maeId == null) {
      insights.push({
        id: `linha-quebrada-${id}`,
        categoria: "risco",
        severidade: "critico",
        titulo: `Linha interrompida em ${nomeCompleto(p)}`,
        explicacao: "Esta pessoa está na linha de transmissão e não tem pai nem mãe cadastrados — a partir daqui a linha simplesmente para.",
        acao: "Localizar a certidão de nascimento ou casamento desta pessoa para descobrir a filiação.",
        pessoaIds: [id],
        confianca: 1,
        peso: 115,
      })
    }
  }

  // 5. Migração e variação de sobrenome ao longo da linha
  for (let i = 0; i < linha.length - 1; i++) {
    const filho = g.pessoa(linha[i])
    const ascendente = g.pessoa(linha[i + 1])
    if (!filho || !ascendente) continue

    // Migração: país de nascimento diferente entre gerações consecutivas
    const paisFilho = normalizar(filho.pais_nasc)
    const paisAsc = normalizar(ascendente.pais_nasc)
    if (paisFilho && paisAsc && paisFilho !== paisAsc) {
      insights.push({
        id: `migracao-${ascendente.id}-${filho.id}`,
        categoria: "migracao",
        severidade: "info",
        titulo: `Migração entre ${nomeCompleto(ascendente)} e ${nomeCompleto(filho)}`,
        explicacao: `${nomeCompleto(ascendente)} nasceu em ${ascendente.pais_nasc} e ${nomeCompleto(filho)} em ${filho.pais_nasc}. É neste ponto da linha que existe registro de entrada no país de destino.`,
        acao: `Buscar a lista de desembarque / registro de imigração de ${nomeCompleto(ascendente)}${ascendente.porto_chegada ? ` (porto: ${ascendente.porto_chegada})` : ""}.`,
        pessoaIds: [ascendente.id, filho.id],
        confianca: 0.9,
        peso: 60,
      })
    }

    // Sobrenome: comparação fonética entre gerações (aportuguesamento)
    const sobFilho = filho.sobrenome
    const sobAsc = ascendente.sobrenome
    if (sobFilho && sobAsc) {
      const kf = chaveFonetica(sobFilho)
      const ka = chaveFonetica(sobAsc)
      const igualCru = normalizar(sobFilho) === normalizar(sobAsc)
      if (!igualCru && kf && ka) {
        if (kf === ka) {
          insights.push({
            id: `sobrenome-variacao-${ascendente.id}-${filho.id}`,
            categoria: "sobrenome",
            severidade: "baixo",
            titulo: `Sobrenome grafado de duas formas: “${sobAsc}” → “${sobFilho}”`,
            explicacao: "As duas grafias são foneticamente equivalentes — típico de aportuguesamento no registro brasileiro. Não é erro, mas precisa constar no processo.",
            acao: "Verificar se será exigida retificação ou declaração de identidade de nome.",
            pessoaIds: [ascendente.id, filho.id],
            confianca: 0.85,
            peso: 40,
          })
        } else if (ascendente.sexo?.toUpperCase().startsWith("M") || !ascendente.sexo) {
          // Só alerta divergência real quando a transmissão é pelo sobrenome paterno
          insights.push({
            id: `sobrenome-divergente-${ascendente.id}-${filho.id}`,
            categoria: "sobrenome",
            severidade: "medio",
            titulo: `Sobrenome divergente entre gerações: “${sobAsc}” e “${sobFilho}”`,
            explicacao: `${nomeCompleto(filho)} não carrega o sobrenome de ${nomeCompleto(ascendente)}, e as grafias não são equivalentes. Ou há uma geração faltando, ou o vínculo está incorreto, ou houve mudança formal de nome.`,
            acao: "Confirmar a filiação na certidão de nascimento antes de seguir a linha.",
            pessoaIds: [ascendente.id, filho.id],
            confianca: 0.6,
            peso: 55,
          })
        }
      }
    }
  }

  // 6. Naturalização do dante causa — o ponto que mais derruba processo italiano
  if (danteCausaId && paisAlvo) {
    const dc = g.pessoa(danteCausaId)
    const filhoNaLinha = linha.length >= 2 ? g.pessoa(linha[linha.length - 2]) : null
    if (dc) {
      if (dc.naturalizado && dc.data_naturalizacao && filhoNaLinha?.data_nasc) {
        const anoNat = anoDe(dc.data_naturalizacao)
        const anoFilho = anoDe(filhoNaLinha.data_nasc)
        if (anoNat != null && anoFilho != null && anoNat < anoFilho) {
          insights.push({
            id: `natz-antes-filho-${dc.id}`,
            categoria: "risco",
            severidade: "critico",
            titulo: `${nomeCompleto(dc)} naturalizou-se ANTES do nascimento de ${nomeCompleto(filhoNaLinha)}`,
            explicacao: `Naturalização em ${formatarData(dc.data_naturalizacao)} e nascimento do descendente em ${formatarData(filhoNaLinha.data_nasc)}. Se confirmado, a transmissão da cidadania foi interrompida neste ponto.`,
            acao: "Confirmar a data com certidão do órgão competente antes de prosseguir — este é o ponto que decide a viabilidade do processo.",
            pessoaIds: [dc.id, filhoNaLinha.id],
            confianca: 0.9,
            peso: 130,
          })
        }
      } else if (!dc.naturalizado && dc.data_naturalizacao == null) {
        insights.push({
          id: `natz-nao-verificada-${dc.id}`,
          categoria: "risco",
          severidade: "alto",
          titulo: `Naturalização de ${nomeCompleto(dc)} ainda não verificada`,
          explicacao: "A situação de naturalização do dante causa não está registrada. É o documento que define se o direito foi transmitido — sem ele o processo fica em aberto.",
          acao: "Solicitar a certidão negativa de naturalização do dante causa.",
          pessoaIds: [dc.id],
          confianca: 0.8,
          peso: 95,
        })
      }
    }
  }

  return { linha, danteCausaId, requerenteId, naLinha, insights }
}

/** Cadeia ascendente mais profunda a partir de uma pessoa (fallback sem país). */
function cadeiaMaisProfunda(g: GrafoGenealogico, id: number): number[] {
  const memo = new Map<number, number[]>()
  const visitando = new Set<number>()

  const dfs = (atual: number): number[] => {
    if (memo.has(atual)) return memo.get(atual)!
    if (visitando.has(atual)) return [atual] // ciclo defensivo
    visitando.add(atual)

    const p = g.pessoa(atual)
    let melhor: number[] = []
    if (p) {
      // Preferência: linha reta declarada > mais profunda > pai antes de mãe
      const candidatos = [p.paiId, p.maeId].filter((x): x is number => x != null && g.existe(x))
      const ordenados = candidatos.sort((a, b) => {
        const la = g.pessoa(a)?.linhaReta === false ? 1 : 0
        const lb = g.pessoa(b)?.linhaReta === false ? 1 : 0
        return la - lb
      })
      for (const c of ordenados) {
        const sub = dfs(c)
        if (sub.length > melhor.length) melhor = sub
      }
    }
    visitando.delete(atual)
    const r = [atual, ...melhor]
    memo.set(atual, r)
    return r
  }

  return dfs(id)
}

export function rotuloPais(p: PaisAlvo): string {
  return { ITALIA: "Itália", PORTUGAL: "Portugal", ESPANHA: "Espanha", ALEMANHA: "Alemanha" }[p]
}
