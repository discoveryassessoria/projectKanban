// src/lib/genealogia/registral/extracao-estrutural.ts
//
// MRG — etapa REEXTRAINDO. Leitura B: GRAMÁTICA REGISTRAL + CANAL ESTRUTURADO.
// Pura, e deliberadamente INDEPENDENTE da leitura A.
//
// Diferenças que garantem independência real (verificadas por
// scripts/mrg-extracao.test.ts):
//   · A leitura A procura RÓTULO e pega o valor à direita. Esta leitura IGNORA
//     rótulos e lê a FÓRMULA do registro: "filho de X e de Y", "nasceu em
//     <local> aos <data>", "faleceu ... aos <idade> anos", "natural de <local>".
//   · A leitura A consome os campos literais do cadastro. Esta consome o canal
//     ESTRUTURADO (`Documento.registral` e `Documento.structuredData`), que é
//     dado já revisado na Análise Documental v2.
//   · Nenhuma das duas chama função de parsing da outra. Só compartilham
//     normalização (que é conversão, não leitura).
//
// Por que isso importa: erro de OCR num rótulo derruba a leitura A e não a B;
// erro na prosa derruba a B e não a A. É exatamente o par de falhas que a
// conferência precisa distinguir para NUNCA escolher silenciosamente.

import type {
  CampoExtraido,
  CampoRegistral,
  LeituraDocumento,
  NaturezaRegistral,
  PapelOcorrencia,
  ResultadoExtracao,
} from "./tipos"
import { montarCampo, dedup } from "./extracao-ancorada"
import { normalizarComMapa } from "./normalizacao"

export const EXTRATOR_B = "gramatica_registral"
export const VERSAO_EXTRATOR_B = "1.0.0"

/**
 * Fórmulas de filiação. Cobrem a redação corrente e a histórica:
 *   "filho de João da Silva e de Maria Souza"
 *   "filha legítima de João da Silva e dona Maria Souza"
 *   "filho natural de Maria Souza"
 */
const RE_FILIACAO_DUPLA =
  /FILH[OA]\s+(?:LEGITIM[OA]\s+|NATURAL\s+|ADOTIV[OA]\s+)?DE\s+([A-Z][A-Z\s]{2,80}?)\s+E(?:\s+DE)?\s+([A-Z][A-Z\s]{2,80}?)(?=\s+(?:NASCE|NASCID|RESIDENT|DOMICILIAD|NATURAL|CASAD|FALECID|COM\b|AOS\b|EM\b|NO\b|NA\b|,|\.|;|$))/
const RE_FILIACAO_SIMPLES =
  /FILH[OA]\s+(?:NATURAL\s+)?DE\s+([A-Z][A-Z\s]{2,80}?)(?=\s+(?:NASCE|NASCID|RESIDENT|DOMICILIAD|NATURAL|CASAD|FALECID|AOS\b|EM\b|,|\.|;|$))/

/** "nasceu em <local> aos <data>" / "nascida em <local> no dia <data>" */
const RE_NASCEU_LOCAL = /NASC(?:EU|IDO|IDA)\s+(?:EM|NA|NO|NESTA|NESTE)\s+([A-Z][A-Z\s]{2,60}?)(?=\s+(?:AOS|NO DIA|EM|,|\.|;|$))/
const RE_NATURAL_DE = /NATURAL\s+D[EOA]S?\s+([A-Z][A-Z\s]{2,60}?)(?=\s+(?:,|\.|;|E\s|FILH|RESIDENT|COM\b|$))/

/** Trecho temporal: "aos 12 de janeiro de 1923", "no dia vinte de maio de mil novecentos" */
const RE_TRECHO_DATA =
  /(?:AOS|NO DIA|EM|DIA)\s+((?:\d{1,2}|[A-Z]{3,12}(?:\s+E\s+[A-Z]{3,12})?)\s+(?:DE\s+)?[A-Z]{3,12}\s+(?:DE\s+)?(?:\d{4}|MIL[A-Z\s]{4,60}))/

/** Data em dígitos puros. */
const RE_DATA_DIGITOS = /\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})\b/

/** "faleceu ... aos 72 anos" */
const RE_IDADE_ANOS = /\b(?:AOS|COM|DE)\s+((?:\d{1,3}|[A-Z]{3,12}(?:\s+E\s+[A-Z]{3,12})?))\s+ANOS\b/

/** "casou-se com X" / "contraiu matrimônio com X" / "viúvo de X" */
const RE_CONJUGE =
  /(?:CASOU\s*-?\s*SE\s+COM|CONTRAIU\s+MATRIMONIO\s+COM|RECEBERAM\s*-?\s*SE\s+EM\s+MATRIMONIO\s+COM|ESPOS[AO]\s+DE|VIUV[AO]\s+DE|CONSORTE\s+DE)\s+([A-Z][A-Z\s]{2,80}?)(?=\s+(?:FILH|NASC|NATURAL|EM\b|AOS\b|,|\.|;|$))/

/** Nome do registrado quando a prosa abre com ele: "... o registro de X, filho de..." */
const RE_REGISTRO_DE = /(?:REGISTRO|ASSENTO|TERMO)\s+DE\s+(?:NASCIMENTO\s+DE\s+|CASAMENTO\s+DE\s+|OBITO\s+DE\s+)?([A-Z][A-Z\s]{2,80}?)(?=\s*(?:,|\.|;|FILH|NASC|$))/
/** "batizei solenemente a X" / "foi batizado X" */
const RE_BATIZANDO = /(?:BATIZEI\s+SOLENEMENTE\s+A|FOI\s+BATIZAD[OA])\s+([A-Z][A-Z\s]{2,80}?)(?=\s*(?:,|\.|;|FILH|NASC|$))/

/** "profissão de lavrador" / "de profissão lavrador" */
const RE_PROFISSAO = /(?:DE\s+PROFISSAO|PROFISSAO\s+DE|OCUPACAO\s+DE)\s+([A-Z][A-Z\s]{2,40}?)(?=\s*(?:,|\.|;|E\s|RESIDENT|$))/

/** "residente em X" / "domiciliado na X" */
const RE_RESIDENCIA = /(?:RESIDENTE|DOMICILIAD[OA])\s+(?:EM|NA|NO|NESTA|NESTE)\s+([A-Z][A-Z\s]{2,60}?)(?=\s*(?:,|\.|;|E\s|FILH|$))/

/** "de nacionalidade italiana" / "italiano, natural de" */
const RE_NACIONALIDADE = /(?:DE\s+NACIONALIDADE|NACIONALIDADE)\s+([A-Z]{4,20})\b/

export function extrairEstrutural(
  leitura: LeituraDocumento,
  natureza: NaturezaRegistral,
): ResultadoExtracao {
  const campos: CampoExtraido[] = []
  const lacunas: string[] = []

  // ---- 1. Canal ESTRUTURADO (AD2): dado registral já revisado por humano.
  colherEstruturado(campos, leitura, natureza)

  // ---- 2. Gramática registral sobre a prosa transcrita.
  for (const pagina of leitura.paginas) {
    const bruto = pagina.texto || ""
    if (!bruto.trim()) continue
    // Mesma normalização alinhada da leitura A — mas as REGRAS são outras: aqui
    // não existe rótulo, só fórmula registral.
    const { norm, mapa } = normalizarComMapa(bruto)

    // filiação
    const dupla = norm.match(RE_FILIACAO_DUPLA)
    if (dupla) {
      empurrar(campos, "FILIACAO_PAI", "PAI", dupla[1], pagina.pagina, bruto, mapa, norm, dupla, "B-FORMULA-FILIACAO-DUPLA", 0.9)
      empurrar(campos, "FILIACAO_MAE", "MAE", dupla[2], pagina.pagina, bruto, mapa, norm, dupla, "B-FORMULA-FILIACAO-DUPLA", 0.9)
    } else {
      const simples = norm.match(RE_FILIACAO_SIMPLES)
      if (simples) {
        // Filiação única declarada: o motor NÃO adivinha se é pai ou mãe.
        // Registra como mãe apenas quando a fórmula é "filho natural de", que no
        // registro civil brasileiro histórico designa a mãe; fora disso, lacuna.
        if (/FILH[OA]\s+NATURAL\s+DE/.test(norm)) {
          empurrar(campos, "FILIACAO_MAE", "MAE", simples[1], pagina.pagina, bruto, mapa, norm, simples, "B-FORMULA-FILIACAO-NATURAL", 0.72)
        } else {
          lacunas.push("Fórmula de filiação com um único nome: não é possível determinar se é pai ou mãe.")
        }
      }
    }

    // nome do registrado
    const reg = norm.match(RE_REGISTRO_DE) || norm.match(RE_BATIZANDO)
    if (reg) {
      empurrar(campos, "NOME_REGISTRAL", "REGISTRADO", reg[1], pagina.pagina, bruto, mapa, norm, reg, "B-FORMULA-REGISTRADO", 0.85)
    }

    // local do evento / naturalidade
    const nasceu = norm.match(RE_NASCEU_LOCAL)
    if (nasceu) {
      empurrar(campos, "LOCAL_NASCIMENTO", "REGISTRADO", nasceu[1], pagina.pagina, bruto, mapa, norm, nasceu, "B-FORMULA-NASCEU-EM", 0.85)
    }
    const natural = norm.match(RE_NATURAL_DE)
    if (natural) {
      empurrar(campos, "LOCAL_NASCIMENTO", "REGISTRADO", natural[1], pagina.pagina, bruto, mapa, norm, natural, "B-FORMULA-NATURAL-DE", 0.8)
    }

    // data do evento
    const campoData = campoDataDaNatureza(natureza)
    if (campoData) {
      const trecho = norm.match(RE_TRECHO_DATA)
      if (trecho) {
        empurrar(campos, campoData, "REGISTRADO", trecho[1], pagina.pagina, bruto, mapa, norm, trecho, "B-FORMULA-DATA-EXTENSA", 0.88)
      } else {
        const dig = norm.match(RE_DATA_DIGITOS)
        if (dig) {
          empurrar(campos, campoData, "REGISTRADO", dig[1], pagina.pagina, bruto, mapa, norm, dig, "B-DATA-DIGITOS", 0.7)
        }
      }
    }

    // cônjuge
    const conj = norm.match(RE_CONJUGE)
    if (conj) {
      empurrar(campos, "CONJUGE", "CONJUGE", conj[1], pagina.pagina, bruto, mapa, norm, conj, "B-FORMULA-CONJUGE", 0.85)
    }

    // idade declarada
    const idade = norm.match(RE_IDADE_ANOS)
    if (idade) {
      empurrar(campos, "IDADE_DECLARADA", "REGISTRADO", idade[1], pagina.pagina, bruto, mapa, norm, idade, "B-FORMULA-IDADE", 0.85)
    }

    // profissão / residência / nacionalidade
    const prof = norm.match(RE_PROFISSAO)
    if (prof) empurrar(campos, "PROFISSAO", "REGISTRADO", prof[1], pagina.pagina, bruto, mapa, norm, prof, "B-FORMULA-PROFISSAO", 0.8)
    const res = norm.match(RE_RESIDENCIA)
    if (res) empurrar(campos, "RESIDENCIA_HISTORICA", "REGISTRADO", res[1], pagina.pagina, bruto, mapa, norm, res, "B-FORMULA-RESIDENCIA", 0.8)
    const nac = norm.match(RE_NACIONALIDADE)
    if (nac) empurrar(campos, "NACIONALIDADE", "REGISTRADO", nac[1], pagina.pagina, bruto, mapa, norm, nac, "B-FORMULA-NACIONALIDADE", 0.82)
  }

  if (!campos.length) {
    lacunas.push("Nenhuma fórmula registral reconhecida e canal estruturado vazio.")
  }

  return {
    extrator: EXTRATOR_B,
    versao: VERSAO_EXTRATOR_B,
    natureza,
    campos: dedup(campos),
    lacunas,
  }
}

// ---------------------------------------------------------------- internos

function campoDataDaNatureza(n: NaturezaRegistral): CampoRegistral | null {
  switch (n) {
    case "NASCIMENTO":
      return "DATA_NASCIMENTO"
    case "CASAMENTO":
      return "DATA_CASAMENTO"
    case "OBITO":
      return "DATA_OBITO"
    case "BATISMO":
      return "DATA_BATISMO"
    case "IMIGRACAO":
      return "DATA_EMIGRACAO"
    case "NATURALIZACAO":
      return "NATURALIZACAO"
    default:
      return null
  }
}

function empurrar(
  destino: CampoExtraido[],
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  valor: string,
  pagina: number,
  original: string,
  mapa: number[],
  norm: string,
  m: RegExpMatchArray,
  regra: string,
  confianca: number,
): void {
  const inicioNorm = m.index ?? 0
  const fimNorm = Math.min(norm.length, inicioNorm + (m[0]?.length ?? 0))
  // Offsets REAIS do documento (via mapa de posição) — é o que a evidência cita.
  const ini = mapa[inicioNorm] ?? 0
  const fim = (mapa[Math.max(inicioNorm, fimNorm - 1)] ?? ini) + 1

  const c = montarCampo(campo, papel, valor, {
    pagina,
    regiao: `offset ${ini}-${fim}`,
    trecho: original.slice(Math.max(0, ini - 20), Math.min(original.length, fim + 20)),
    metodo: `${EXTRATOR_B}:formula`,
    confianca,
    regra,
  })
  if (c) destino.push(c)
}

/** Chaves do canal estruturado da AD2, por natureza. */
const MAPA_ESTRUTURADO: Record<string, Array<[string, CampoRegistral, PapelOcorrencia]>> = {
  birth: [
    ["name", "NOME_REGISTRAL", "REGISTRADO"],
    ["fullName", "NOME_REGISTRAL", "REGISTRADO"],
    ["birthDate", "DATA_NASCIMENTO", "REGISTRADO"],
    ["date", "DATA_NASCIMENTO", "REGISTRADO"],
    ["birthPlace", "LOCAL_NASCIMENTO", "REGISTRADO"],
    ["place", "LOCAL_NASCIMENTO", "REGISTRADO"],
    ["country", "PAIS_NASCIMENTO", "REGISTRADO"],
    ["fatherName", "FILIACAO_PAI", "PAI"],
    ["motherName", "FILIACAO_MAE", "MAE"],
    ["sex", "SEXO", "REGISTRADO"],
    ["nationality", "NACIONALIDADE", "REGISTRADO"],
  ],
  marriage: [
    ["name", "NOME_REGISTRAL", "REGISTRADO"],
    ["spouseName", "CONJUGE", "CONJUGE"],
    ["marriageDate", "DATA_CASAMENTO", "REGISTRADO"],
    ["date", "DATA_CASAMENTO", "REGISTRADO"],
    ["marriagePlace", "LOCAL_CASAMENTO", "REGISTRADO"],
    ["place", "LOCAL_CASAMENTO", "REGISTRADO"],
    ["fatherName", "FILIACAO_PAI", "PAI"],
    ["motherName", "FILIACAO_MAE", "MAE"],
  ],
  death: [
    ["name", "NOME_REGISTRAL", "REGISTRADO"],
    ["deathDate", "DATA_OBITO", "REGISTRADO"],
    ["date", "DATA_OBITO", "REGISTRADO"],
    ["deathPlace", "LOCAL_OBITO", "REGISTRADO"],
    ["place", "LOCAL_OBITO", "REGISTRADO"],
    ["birthDate", "DATA_NASCIMENTO", "REGISTRADO"],
    ["fatherName", "FILIACAO_PAI", "PAI"],
    ["motherName", "FILIACAO_MAE", "MAE"],
    ["spouseName", "CONJUGE", "CONJUGE"],
    ["age", "IDADE_DECLARADA", "REGISTRADO"],
  ],
}

function colherEstruturado(
  destino: CampoExtraido[],
  leitura: LeituraDocumento,
  natureza: NaturezaRegistral,
): void {
  // `registral` (revisado) tem precedência sobre `structuredData` (extraído).
  const fontes: Array<[string, Record<string, unknown> | null]> = [
    ["registral", leitura.registral],
    ["structuredData", leitura.estruturado],
  ]

  for (const [nomeFonte, raiz] of fontes) {
    if (!raiz || typeof raiz !== "object") continue
    for (const [secao, mapa] of Object.entries(MAPA_ESTRUTURADO)) {
      const bloco = (raiz as Record<string, unknown>)[secao]
      if (!bloco || typeof bloco !== "object") continue
      const obj = bloco as Record<string, unknown>
      for (const [chave, campo, papel] of mapa) {
        const v = obj[chave]
        if (v == null || v === "") continue
        const c = montarCampo(campo, papel, String(v), {
          pagina: null,
          regiao: `estruturado:${nomeFonte}.${secao}.${chave}`,
          trecho: String(v).slice(0, 200),
          metodo: `${EXTRATOR_B}:estruturado`,
          confianca: nomeFonte === "registral" ? 0.98 : 0.9,
          regra: `B-ESTRUTURADO-${campo}`,
        })
        if (c) destino.push(c)
      }
    }
    // Campos de raiz (schema plano, também aceito pela AD2).
    const mapaRaiz = MAPA_ESTRUTURADO[secaoDaNatureza(natureza)] ?? []
    for (const [chave, campo, papel] of mapaRaiz) {
      const v = (raiz as Record<string, unknown>)[chave]
      if (v == null || v === "") continue
      const c = montarCampo(campo, papel, String(v), {
        pagina: null,
        regiao: `estruturado:${nomeFonte}.${chave}`,
        trecho: String(v).slice(0, 200),
        metodo: `${EXTRATOR_B}:estruturado`,
        confianca: nomeFonte === "registral" ? 0.98 : 0.9,
        regra: `B-ESTRUTURADO-RAIZ-${campo}`,
      })
      if (c) destino.push(c)
    }
  }
}

function secaoDaNatureza(n: NaturezaRegistral): string {
  if (n === "CASAMENTO") return "marriage"
  if (n === "OBITO") return "death"
  return "birth"
}
