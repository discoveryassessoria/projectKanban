// src/lib/genealogia/registral/extracao-ancorada.ts
//
// MRG — etapa EXTRAINDO. Leitura A: ÂNCORA DE RÓTULO. Pura.
//
// Estratégia desta leitura: procurar o RÓTULO e pegar o valor à direita dele
// ("Nome:", "Filiação:", "Pai:", "Data de nascimento:"), além de consumir os
// campos literais já transcritos no cadastro do documento
// (`nome_registrado`, `pai_registrado`, `mae_registrada`, `conjuge_registrado`,
// datas, cartório/livro/folha/termo).
//
// Ela é DELIBERADAMENTE cega à prosa registral. A leitura B
// (`extracao-estrutural.ts`) faz o oposto: ignora rótulos e lê a fórmula do
// registro. Duas estratégias que não compartilham caminho de parsing é o que
// torna a conferência (etapa REEXTRAINDO/comparação) capaz de achar erro de OCR
// de verdade — duas execuções do mesmo parser sempre concordam, inclusive quando
// as duas estão erradas.

import type {
  CampoExtraido,
  CampoRegistral,
  LeituraDocumento,
  NaturezaRegistral,
  PapelOcorrencia,
  ResultadoExtracao,
} from "./tipos"
import { normalizar } from "@/src/lib/genealogia/motor/texto"
import {
  normalizarComMapa,
  normalizarData,
  normalizarIdade,
  normalizarLocal,
  normalizarNome,
  referenciaRegistral,
} from "./normalizacao"

export const EXTRATOR_A = "ancora_rotulo"
export const VERSAO_EXTRATOR_A = "1.0.0"

interface Ancora {
  campo: CampoRegistral
  papel: PapelOcorrencia
  /** Rótulos aceitos, do mais específico ao mais genérico. */
  rotulos: string[]
  /** Naturezas em que o rótulo é relevante (vazio = todas). */
  naturezas?: NaturezaRegistral[]
}

const ANCORAS: Ancora[] = [
  { campo: "NOME_REGISTRAL", papel: "REGISTRADO", rotulos: ["NOME COMPLETO", "NOME DO REGISTRADO", "NOME DA REGISTRADA", "NOME DO FALECIDO", "NOME DA FALECIDA", "NOME DO BATIZANDO", "NOME"] },
  { campo: "FILIACAO_PAI", papel: "PAI", rotulos: ["NOME DO PAI", "PAI", "GENITOR", "PADRE"] },
  { campo: "FILIACAO_MAE", papel: "MAE", rotulos: ["NOME DA MAE", "MAE", "GENITORA", "MADRE"] },
  { campo: "DATA_NASCIMENTO", papel: "REGISTRADO", rotulos: ["DATA DE NASCIMENTO", "DATA DO NASCIMENTO", "NASCIMENTO EM", "DATA NASC"] },
  { campo: "LOCAL_NASCIMENTO", papel: "REGISTRADO", rotulos: ["LOCAL DE NASCIMENTO", "LOCAL DO NASCIMENTO", "NATURALIDADE", "LUGAR DE NASCIMENTO"] },
  { campo: "PAIS_NASCIMENTO", papel: "REGISTRADO", rotulos: ["PAIS DE NASCIMENTO", "PAIS"] },
  { campo: "SEXO", papel: "REGISTRADO", rotulos: ["SEXO"] },
  { campo: "DATA_CASAMENTO", papel: "REGISTRADO", rotulos: ["DATA DO CASAMENTO", "DATA DE CASAMENTO", "DATA DO MATRIMONIO"] },
  { campo: "LOCAL_CASAMENTO", papel: "REGISTRADO", rotulos: ["LOCAL DO CASAMENTO", "LOCAL DE CASAMENTO"] },
  { campo: "CONJUGE", papel: "CONJUGE", rotulos: ["CONJUGE", "NOME DO CONJUGE", "NOME DO NOIVO", "NOME DA NOIVA", "ESPOSO", "ESPOSA"] },
  { campo: "DATA_OBITO", papel: "REGISTRADO", rotulos: ["DATA DO OBITO", "DATA DE OBITO", "DATA DO FALECIMENTO", "FALECIMENTO EM"] },
  { campo: "LOCAL_OBITO", papel: "REGISTRADO", rotulos: ["LOCAL DO OBITO", "LOCAL DO FALECIMENTO"] },
  { campo: "DATA_BATISMO", papel: "REGISTRADO", rotulos: ["DATA DO BATISMO", "DATA DE BATISMO"] },
  { campo: "LOCAL_BATISMO", papel: "REGISTRADO", rotulos: ["LOCAL DO BATISMO", "PAROQUIA", "IGREJA"] },
  { campo: "PROFISSAO", papel: "REGISTRADO", rotulos: ["PROFISSAO", "OCUPACAO"] },
  { campo: "NACIONALIDADE", papel: "REGISTRADO", rotulos: ["NACIONALIDADE"] },
  { campo: "IDADE_DECLARADA", papel: "REGISTRADO", rotulos: ["IDADE"] },
  { campo: "RESIDENCIA_HISTORICA", papel: "REGISTRADO", rotulos: ["RESIDENCIA", "DOMICILIO", "ENDERECO"] },
  { campo: "NATURALIZACAO", papel: "REGISTRADO", rotulos: ["DATA DA NATURALIZACAO", "NATURALIZACAO"] },
  { campo: "DATA_EMIGRACAO", papel: "REGISTRADO", rotulos: ["DATA DE EMBARQUE", "DATA DA EMIGRACAO", "DATA DE CHEGADA"] },
  { campo: "FILIACAO_PAI", papel: "AVO_PATERNO", rotulos: ["AVO PATERNO"] },
  { campo: "FILIACAO_MAE", papel: "AVOA_PATERNA", rotulos: ["AVO PATERNA", "AVOA PATERNA"] },
  { campo: "FILIACAO_PAI", papel: "AVO_MATERNO", rotulos: ["AVO MATERNO"] },
  { campo: "FILIACAO_MAE", papel: "AVOA_MATERNA", rotulos: ["AVO MATERNA", "AVOA MATERNA"] },
  { campo: "NOME_REGISTRAL", papel: "DECLARANTE", rotulos: ["DECLARANTE", "NOME DO DECLARANTE"] },
  { campo: "NOME_REGISTRAL", papel: "PADRINHO", rotulos: ["PADRINHO"] },
  { campo: "NOME_REGISTRAL", papel: "MADRINHA", rotulos: ["MADRINHA"] },
]

/** Máximo de caracteres que um valor de rótulo pode ter (evita capturar o texto todo). */
const TETO_VALOR = 140

export function extrairAncorado(
  leitura: LeituraDocumento,
  natureza: NaturezaRegistral,
): ResultadoExtracao {
  const campos: CampoExtraido[] = []
  const lacunas: string[] = []

  // ---- 1. Campos literais do cadastro do documento (transcrição já revisada).
  const L = leitura.literais
  literal(campos, "NOME_REGISTRAL", "REGISTRADO", L.nomeRegistrado, "nome_registrado")
  literal(campos, "FILIACAO_PAI", "PAI", L.paiRegistrado, "pai_registrado")
  literal(campos, "FILIACAO_MAE", "MAE", L.maeRegistrada, "mae_registrada")
  literal(campos, "CONJUGE", "CONJUGE", L.conjugeRegistrado, "conjuge_registrado")

  const campoDataEvento = dataEventoDaNatureza(natureza)
  if (campoDataEvento && L.dataEvento) {
    literalData(campos, campoDataEvento, "REGISTRADO", L.dataEvento, "data_evento")
  }
  const campoLocalEvento = localEventoDaNatureza(natureza)
  if (campoLocalEvento) {
    const local = [L.cidadeRegistro, L.estadoRegistro, L.paisRegistro].filter(Boolean).join(", ")
    if (local) literal(campos, campoLocalEvento, "REGISTRADO", local, "cidade_estado_pais_registro")
    if (L.comune) literal(campos, campoLocalEvento, "REGISTRADO", L.comune, "comune")
  }
  if (L.paisRegistro && natureza === "NASCIMENTO") {
    literal(campos, "PAIS_NASCIMENTO", "REGISTRADO", L.paisRegistro, "pais_registro")
  }

  const ref = referenciaRegistral({
    cartorio: L.cartorio,
    livro: L.livro,
    folha: L.folha,
    termo: L.termo,
    numeroRegistro: L.numeroRegistro,
    matricula: L.matricula,
  })
  if (ref) {
    campos.push({
      campo: "REFERENCIA_REGISTRAL",
      papel: "REGISTRADO",
      valorBruto: [L.cartorio, L.livro, L.folha, L.termo].filter(Boolean).join(" / "),
      valorNormalizado: ref,
      pagina: null,
      regiao: "literal:referencia_registral",
      trecho: null,
      metodo: `${EXTRATOR_A}:literal`,
      confianca: 0.97,
      regra: "A-REF-LITERAL",
    })
  }

  // ---- 2. Rótulos no texto transcrito.
  for (const pagina of leitura.paginas) {
    const bruto = pagina.texto || ""
    if (!bruto.trim()) continue
    // Normalização ALINHADA: cada posição do texto normalizado sabe de onde veio.
    // Sem isso, o offset do rótulo não corresponde ao offset do original e o valor
    // recortado sai deslocado (defeito real, coberto por scripts/mrg-leitura.test.ts).
    const { norm, mapa } = normalizarComMapa(bruto)

    for (const ancora of ANCORAS) {
      if (ancora.naturezas && !ancora.naturezas.includes(natureza)) continue
      const achado = valorDoRotulo(norm, ancora.rotulos)
      if (!achado) continue

      const iniOriginal = mapa[achado.inicio] ?? 0
      const fimOriginal = (mapa[achado.fim - 1] ?? iniOriginal) + 1
      const brutoOriginal = bruto.slice(iniOriginal, fimOriginal)

      const c = montarCampo(ancora.campo, ancora.papel, brutoOriginal || achado.valor, {
        pagina: pagina.pagina,
        regiao: `offset ${iniOriginal}-${fimOriginal}`,
        trecho: bruto.slice(Math.max(0, iniOriginal - 30), Math.min(bruto.length, fimOriginal + 20)),
        metodo: `${EXTRATOR_A}:rotulo:${achado.rotulo}`,
        confianca: achado.confianca,
        regra: `A-ROTULO-${ancora.campo}`,
      })
      if (c) campos.push(c)
    }
  }

  if (!campos.some((c) => c.campo === "NOME_REGISTRAL" && c.papel === "REGISTRADO")) {
    lacunas.push("Nome do registrado não localizado por rótulo nem no cadastro do documento.")
  }
  if (campoDataEvento && !campos.some((c) => c.campo === campoDataEvento)) {
    lacunas.push("Data do evento registral não localizada.")
  }

  return {
    extrator: EXTRATOR_A,
    versao: VERSAO_EXTRATOR_A,
    natureza,
    campos: dedup(campos),
    lacunas,
  }
}

// ---------------------------------------------------------------- internos

function dataEventoDaNatureza(n: NaturezaRegistral): CampoRegistral | null {
  switch (n) {
    case "NASCIMENTO":
      return "DATA_NASCIMENTO"
    case "CASAMENTO":
      return "DATA_CASAMENTO"
    case "OBITO":
      return "DATA_OBITO"
    case "BATISMO":
      return "DATA_BATISMO"
    case "NATURALIZACAO":
      return "NATURALIZACAO"
    case "IMIGRACAO":
      return "DATA_EMIGRACAO"
    default:
      return null
  }
}

function localEventoDaNatureza(n: NaturezaRegistral): CampoRegistral | null {
  switch (n) {
    case "NASCIMENTO":
      return "LOCAL_NASCIMENTO"
    case "CASAMENTO":
      return "LOCAL_CASAMENTO"
    case "OBITO":
      return "LOCAL_OBITO"
    case "BATISMO":
      return "LOCAL_BATISMO"
    default:
      return null
  }
}

interface AchadoRotulo {
  rotulo: string
  valor: string
  inicio: number
  fim: number
  confianca: number
}

/**
 * Encontra `ROTULO valor` no texto NORMALIZADO e devolve os offsets dentro dele.
 * A tradução para o texto original é feita pelo chamador, via mapa de posição —
 * é o que garante que o valor recortado é exatamente o que está no documento.
 *
 * O fim do valor é o próximo rótulo conhecido (é assim que "PAI X MAE Y" não
 * devolve "X MAE Y" no campo do pai) ou o teto de caracteres.
 */
function valorDoRotulo(norm: string, rotulos: string[]): AchadoRotulo | null {
  for (const rotulo of rotulos) {
    let idx = -1
    let de = 0
    // Procura uma ocorrência que esteja em INÍCIO DE PALAVRA (evita casar "PAI"
    // dentro de "PAIS" e "MAE" dentro de "MAERSK").
    while (de <= norm.length) {
      const achou = norm.indexOf(rotulo, de)
      if (achou < 0) break
      const antes = achou === 0 ? " " : norm[achou - 1]
      const depoisIdx = achou + rotulo.length
      const depois = depoisIdx >= norm.length ? " " : norm[depoisIdx]
      if (antes === " " && depois === " ") {
        idx = achou
        break
      }
      de = achou + 1
    }
    if (idx < 0) continue

    let pos = idx + rotulo.length
    while (pos < norm.length && norm[pos] === " ") pos++
    if (pos >= norm.length) continue

    const limite = Math.min(norm.length, pos + TETO_VALOR)
    let fim = limite
    for (const outro of ROTULOS_TODOS) {
      const i = indiceDePalavra(norm, outro, pos)
      if (i > pos && i < fim) fim = i
    }
    while (fim > pos && norm[fim - 1] === " ") fim--
    const valor = norm.slice(pos, fim).trim()
    if (!valor) continue

    // Rótulo genérico ("NOME", "PAI") vale menos que o específico.
    const confianca = rotulo.split(" ").length >= 3 ? 0.93 : rotulo.length <= 4 ? 0.8 : 0.88
    return { rotulo, valor, inicio: pos, fim: pos + valor.length, confianca }
  }
  return null
}

/** Índice do rótulo em início de palavra, a partir de `de`. -1 se não houver. */
function indiceDePalavra(norm: string, rotulo: string, de: number): number {
  let cursor = de
  while (cursor <= norm.length) {
    const i = norm.indexOf(rotulo, cursor)
    if (i < 0) return -1
    const antes = i === 0 ? " " : norm[i - 1]
    const depoisIdx = i + rotulo.length
    const depois = depoisIdx >= norm.length ? " " : norm[depoisIdx]
    if (antes === " " && depois === " ") return i
    cursor = i + 1
  }
  return -1
}

const ROTULOS_TODOS = [...new Set(ANCORAS.flatMap((a) => a.rotulos))].sort(
  (a, b) => b.length - a.length,
)

function literal(
  destino: CampoExtraido[],
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  valor: string | null | undefined,
  origem: string,
): void {
  if (!valor || !String(valor).trim()) return
  const c = montarCampo(campo, papel, String(valor), {
    pagina: null,
    regiao: `literal:${origem}`,
    trecho: String(valor).slice(0, 200),
    metodo: `${EXTRATOR_A}:literal`,
    confianca: 0.96,
    regra: `A-LITERAL-${campo}`,
  })
  if (c) destino.push(c)
}

function literalData(
  destino: CampoExtraido[],
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  valor: string,
  origem: string,
): void {
  const d = normalizarData(valor)
  if (!d) return
  destino.push({
    campo,
    papel,
    valorBruto: valor,
    valorNormalizado: d.iso,
    valorData: d.iso,
    pagina: null,
    regiao: `literal:${origem}`,
    trecho: valor.slice(0, 200),
    metodo: `${EXTRATOR_A}:literal`,
    confianca: d.precisao === "dia" ? 0.97 : 0.7,
    regra: `A-LITERAL-${campo}`,
  })
}

interface Meta {
  pagina: number | null
  regiao: string | null
  trecho: string | null
  metodo: string
  confianca: number
  regra: string
}

/** Normaliza o valor de acordo com o tipo do campo. Descarta o que não resolve. */
export function montarCampo(
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  bruto: string,
  meta: Meta,
): CampoExtraido | null {
  const cru = bruto.trim()
  if (!cru) return null

  const base = {
    campo,
    papel,
    valorBruto: cru.slice(0, 400),
    pagina: meta.pagina,
    regiao: meta.regiao,
    trecho: meta.trecho ? meta.trecho.slice(0, 600) : null,
    metodo: meta.metodo,
    regra: meta.regra,
  }

  if (
    campo === "DATA_NASCIMENTO" ||
    campo === "DATA_CASAMENTO" ||
    campo === "DATA_OBITO" ||
    campo === "DATA_BATISMO" ||
    campo === "DATA_EMIGRACAO" ||
    campo === "NATURALIZACAO"
  ) {
    const d = normalizarData(cru)
    if (!d) return null
    return {
      ...base,
      valorNormalizado: d.iso,
      valorData: d.iso,
      confianca: meta.confianca * (d.precisao === "dia" ? 1 : d.precisao === "mes" ? 0.75 : 0.55),
    }
  }

  if (
    campo === "NOME_REGISTRAL" ||
    campo === "NOME_CASADO" ||
    campo === "FILIACAO_PAI" ||
    campo === "FILIACAO_MAE" ||
    campo === "CONJUGE"
  ) {
    const n = normalizarNome(cru)
    if (!n || n.tokens.length === 0) return null
    return {
      ...base,
      valorNormalizado: n.completo,
      valorData: null,
      confianca: meta.confianca * (n.expandido ? 0.85 : 1) * (n.tokens.length === 1 ? 0.8 : 1),
    }
  }

  if (
    campo === "LOCAL_NASCIMENTO" ||
    campo === "LOCAL_CASAMENTO" ||
    campo === "LOCAL_OBITO" ||
    campo === "LOCAL_BATISMO" ||
    campo === "RESIDENCIA_HISTORICA" ||
    campo === "PAIS_NASCIMENTO"
  ) {
    const l = normalizarLocal(cru)
    if (!l) return null
    return { ...base, valorNormalizado: l, valorData: null, confianca: meta.confianca }
  }

  if (campo === "IDADE_DECLARADA") {
    const i = normalizarIdade(cru)
    if (i == null) return null
    return { ...base, valorNormalizado: String(i), valorData: null, confianca: meta.confianca }
  }

  if (campo === "SEXO") {
    const n = normalizar(cru)
    const v = /^(M|MASC)/.test(n) ? "M" : /^(F|FEM)/.test(n) ? "F" : null
    if (!v) return null
    return { ...base, valorNormalizado: v, valorData: null, confianca: meta.confianca }
  }

  const n = normalizar(cru)
  if (!n) return null
  return { ...base, valorNormalizado: n, valorData: null, confianca: meta.confianca }
}

/**
 * Remove leituras redundantes do MESMO extrator (mesmo campo/papel/valor),
 * mantendo a de maior confiança. Não funde valores diferentes — divergência
 * interna do extrator é informação, e a conferência precisa dela.
 */
export function dedup(campos: CampoExtraido[]): CampoExtraido[] {
  const porChave = new Map<string, CampoExtraido>()
  for (const c of campos) {
    const chave = `${c.campo}|${c.papel}|${c.valorNormalizado}`
    const atual = porChave.get(chave)
    if (!atual || c.confianca > atual.confianca) porChave.set(chave, c)
  }
  return [...porChave.values()]
}
