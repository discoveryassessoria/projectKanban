// src/lib/genealogia/registral/conferencia.ts
//
// MRG — comparação entre as duas leituras + montagem das ocorrências. Pura.
//
// A REGRA que este módulo existe para garantir (requisito 3 do escopo e 7 do
// protocolo): quando as duas leituras divergem num campo CRÍTICO, o sistema NÃO
// escolhe a de maior confiança. Ele bloqueia o campo para revisão e devolve o
// material para abrir conflito.
//
// Em campo não crítico a divergência é registrada e o valor fica marcado como
// divergente — nunca silenciosamente consolidado.

import { chaveFonetica, normalizar, similaridadeLocal, similaridadeNome } from "@/src/lib/genealogia/motor/texto"
import { CAMPOS_DATA, CAMPOS_LOCAL, CAMPOS_NOME, ROTULO_CAMPO, ehCampoCritico } from "./campos"
import { PAPEIS_ESPERADOS } from "./classificador"
import { normalizarIdade, sexoDoPapel } from "./normalizacao"
import type {
  AtributosOcorrencia,
  CampoConferido,
  CampoExtraido,
  CampoRegistral,
  NaturezaRegistral,
  OcorrenciaExtraida,
  PapelOcorrencia,
  ResultadoExtracao,
  VeredictoConferencia,
} from "./tipos"

/** Similaridade acima da qual duas leituras de nome são a MESMA leitura. */
export const LIMIAR_NOME_EQUIVALENTE = 0.92
/** Similaridade de local acima da qual as leituras concordam. */
export const LIMIAR_LOCAL_EQUIVALENTE = 0.85

export interface ResultadoConferencia {
  campos: CampoConferido[]
  /** Campos críticos bloqueados por divergência entre leituras. */
  bloqueados: CampoConferido[]
  ocorrencias: OcorrenciaExtraida[]
  /** true quando não há material mínimo para seguir (documento insuficiente). */
  insuficiente: boolean
  motivoInsuficiencia: string | null
  lacunas: string[]
}

/** Chave de agrupamento: um campo por papel. */
function chave(c: { campo: CampoRegistral; papel: PapelOcorrencia }): string {
  return `${c.campo}|${c.papel}`
}

export function conferir(
  a: ResultadoExtracao,
  b: ResultadoExtracao,
  natureza: NaturezaRegistral,
): ResultadoConferencia {
  const chaves = new Set<string>([...a.campos.map(chave), ...b.campos.map(chave)])
  const campos: CampoConferido[] = []

  for (const k of chaves) {
    const [campoStr, papelStr] = k.split("|")
    const campo = campoStr as CampoRegistral
    const papel = papelStr as PapelOcorrencia

    // Dentro do mesmo extrator, mais de uma leitura do mesmo campo/papel é
    // ambiguidade interna: pega a de maior confiança MAS registra a divergência.
    const daA = a.campos.filter((c) => c.campo === campo && c.papel === papel)
    const daB = b.campos.filter((c) => c.campo === campo && c.papel === papel)
    const melhorA = escolherInterno(daA)
    const melhorB = escolherInterno(daB)

    const ambiguidadeInterna =
      distintos(daA).length > 1 || distintos(daB).length > 1

    campos.push(
      comparar(campo, papel, melhorA, melhorB, ambiguidadeInterna),
    )
  }

  campos.sort((x, y) => x.campo.localeCompare(y.campo) || x.papel.localeCompare(y.papel))

  const bloqueados = campos.filter((c) => c.bloqueadoParaRevisao)
  const ocorrencias = montarOcorrencias(campos, natureza)

  const temNome = campos.some(
    (c) => c.campo === "NOME_REGISTRAL" && c.papel === "REGISTRADO" && c.valorNormalizado,
  )
  const temAlgumFato = campos.some((c) => c.valorNormalizado)

  let motivo: string | null = null
  if (!temAlgumFato) {
    motivo = "Nenhum campo registral pôde ser lido nas duas passagens."
  } else if (!temNome) {
    motivo = "O nome do registrado não foi confirmado por nenhuma das duas leituras."
  }

  return {
    campos,
    bloqueados,
    ocorrencias,
    insuficiente: motivo != null,
    motivoInsuficiencia: motivo,
    lacunas: [...a.lacunas, ...b.lacunas],
  }
}

function distintos(cs: CampoExtraido[]): string[] {
  return [...new Set(cs.map((c) => c.valorNormalizado))]
}

function escolherInterno(cs: CampoExtraido[]): CampoExtraido | null {
  if (!cs.length) return null
  return cs.reduce((melhor, c) => (c.confianca > melhor.confianca ? c : melhor), cs[0])
}

function comparar(
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  a: CampoExtraido | null,
  b: CampoExtraido | null,
  ambiguidadeInterna: boolean,
): CampoConferido {
  const critico = ehCampoCritico(campo)
  const rotulo = ROTULO_CAMPO[campo]

  // Só uma leitura encontrou → COMPLEMENTAR. Não é divergência: é cobertura
  // parcial. Campo crítico com uma única leitura NÃO chega a confirmado — a
  // confiança fica limitada e o estado do fato reflete isso.
  if (a && !b) {
    return {
      campo,
      papel,
      veredicto: "COMPLEMENTAR",
      a,
      b: null,
      valorNormalizado: a.valorNormalizado,
      valorData: a.valorData ?? null,
      confianca: a.confianca * (critico ? 0.7 : 0.9),
      bloqueadoParaRevisao: false,
      explicacao: `${rotulo}: lido apenas pela leitura por rótulo. ${critico ? "Campo crítico com uma única leitura não é confirmado." : "Confiança reduzida por falta de conferência."}`,
    }
  }
  if (b && !a) {
    return {
      campo,
      papel,
      veredicto: "COMPLEMENTAR",
      a: null,
      b,
      valorNormalizado: b.valorNormalizado,
      valorData: b.valorData ?? null,
      confianca: b.confianca * (critico ? 0.7 : 0.9),
      bloqueadoParaRevisao: false,
      explicacao: `${rotulo}: lido apenas pela leitura estrutural. ${critico ? "Campo crítico com uma única leitura não é confirmado." : "Confiança reduzida por falta de conferência."}`,
    }
  }
  if (!a && !b) {
    return {
      campo,
      papel,
      veredicto: "AUSENTE",
      a: null,
      b: null,
      valorNormalizado: null,
      valorData: null,
      confianca: 0,
      bloqueadoParaRevisao: false,
      explicacao: `${rotulo}: ausente nas duas leituras.`,
    }
  }

  const A = a as CampoExtraido
  const B = b as CampoExtraido

  // ---- igualdade exata
  if (A.valorNormalizado === B.valorNormalizado) {
    return {
      campo,
      papel,
      veredicto: "CONCORDANTE",
      a: A,
      b: B,
      valorNormalizado: A.valorNormalizado,
      valorData: A.valorData ?? B.valorData ?? null,
      confianca: Math.min(0.99, (A.confianca + B.confianca) / 2 + 0.08),
      bloqueadoParaRevisao: ambiguidadeInterna,
      explicacao: ambiguidadeInterna
        ? `${rotulo}: as duas leituras concordam, mas o documento apresenta mais de um valor para o mesmo campo — revisão necessária.`
        : `${rotulo}: as duas leituras independentes chegaram ao mesmo valor.`,
    }
  }

  // ---- equivalência após normalização (grafia/fonética/local)
  const equivalente = saoEquivalentes(campo, A.valorNormalizado, B.valorNormalizado)
  if (equivalente.equivalente) {
    // Mesmo equivalente, o valor consolidado é o de MAIOR confiança — mas isso
    // não é "escolher em silêncio": não há divergência de conteúdo, só de grafia,
    // e a explicação registra as duas formas.
    const vencedor = A.confianca >= B.confianca ? A : B
    return {
      campo,
      papel,
      veredicto: "CONCORDANTE_APOS_NORMALIZACAO",
      a: A,
      b: B,
      valorNormalizado: vencedor.valorNormalizado,
      valorData: vencedor.valorData ?? null,
      confianca: Math.min(0.95, (A.confianca + B.confianca) / 2),
      bloqueadoParaRevisao: ambiguidadeInterna,
      explicacao: `${rotulo}: “${A.valorNormalizado}” e “${B.valorNormalizado}” são equivalentes (${equivalente.motivo}).`,
    }
  }

  // ---- divergência real
  return {
    campo,
    papel,
    veredicto: "DIVERGENTE",
    a: A,
    b: B,
    // DIVERGENTE nunca consolida valor. É o ponto exato em que o sistema se
    // recusa a escolher.
    valorNormalizado: null,
    valorData: null,
    confianca: 0,
    bloqueadoParaRevisao: true,
    explicacao: `${rotulo}: leituras independentes discordam — por rótulo “${A.valorNormalizado}”, por fórmula registral “${B.valorNormalizado}”. ${critico ? "Campo crítico: bloqueado até revisão humana." : "Registrado como divergente; não vira fato."}`,
  }
}

export function saoEquivalentes(
  campo: CampoRegistral,
  x: string,
  y: string,
): { equivalente: boolean; motivo: string } {
  if (x === y) return { equivalente: true, motivo: "valores idênticos" }

  if (CAMPOS_DATA.has(campo)) {
    // Datas são comparadas como valor, nunca por texto.
    return { equivalente: false, motivo: "datas diferentes" }
  }

  if (CAMPOS_NOME.has(campo)) {
    const sim = similaridadeNome(x, y)
    if (sim >= LIMIAR_NOME_EQUIVALENTE) {
      return {
        equivalente: true,
        motivo:
          chaveFonetica(x) === chaveFonetica(y)
            ? "mesma chave fonética — variação de grafia"
            : `similaridade ${(sim * 100).toFixed(0)}%`,
      }
    }
    // Um nome contido no outro é COMPLEMENTO, não divergência, quando o contido
    // tem pelo menos dois tokens (evita "MARIA" bater com "MARIA SOUZA BIANCHI").
    const tx = normalizar(x).split(" ").filter(Boolean)
    const ty = normalizar(y).split(" ").filter(Boolean)
    const menor = tx.length <= ty.length ? tx : ty
    const maior = tx.length <= ty.length ? ty : tx
    if (menor.length >= 2 && menor.every((t) => maior.includes(t))) {
      return { equivalente: true, motivo: "uma leitura é forma abreviada da outra" }
    }
    return { equivalente: false, motivo: "nomes distintos" }
  }

  if (CAMPOS_LOCAL.has(campo)) {
    const sim = similaridadeLocal(x, y)
    if (sim >= LIMIAR_LOCAL_EQUIVALENTE) {
      return { equivalente: true, motivo: `localidades equivalentes (${(sim * 100).toFixed(0)}%)` }
    }
    return { equivalente: false, motivo: "localidades distintas" }
  }

  if (campo === "IDADE_DECLARADA") {
    const ix = normalizarIdade(x)
    const iy = normalizarIdade(y)
    if (ix != null && iy != null && Math.abs(ix - iy) <= 1) {
      return { equivalente: true, motivo: "idade declarada com 1 ano de diferença" }
    }
    return { equivalente: false, motivo: "idades diferentes" }
  }

  if (normalizar(x) === normalizar(y)) return { equivalente: true, motivo: "iguais após normalização" }
  return { equivalente: false, motivo: "valores diferentes" }
}

// ---------------------------------------------------------------- ocorrências

/**
 * Monta as OCORRÊNCIAS DOCUMENTAIS a partir dos campos conferidos.
 *
 * Uma ocorrência = uma pessoa como ela APARECE no documento (papel + nome +
 * atributos citados). A mesma identidade humana pode gerar ocorrências em vários
 * documentos, com grafias diferentes — e é por isso que ocorrência não é Pessoa.
 *
 * Campo bloqueado para revisão NÃO alimenta ocorrência: seria transformar uma
 * leitura contestada em mención de pessoa.
 */
export function montarOcorrencias(
  campos: CampoConferido[],
  natureza: NaturezaRegistral,
): OcorrenciaExtraida[] {
  const validos = campos.filter((c) => c.valorNormalizado && !c.bloqueadoParaRevisao)
  const porPapel = new Map<PapelOcorrencia, CampoConferido[]>()
  for (const c of validos) {
    const arr = porPapel.get(c.papel)
    if (arr) arr.push(c)
    else porPapel.set(c.papel, [c])
  }

  const doRegistrado = porPapel.get("REGISTRADO") ?? []
  const valorDoRegistrado = (campo: CampoRegistral): string | null =>
    doRegistrado.find((c) => c.campo === campo)?.valorNormalizado ?? null

  const ocorrencias: OcorrenciaExtraida[] = []

  for (const [papel, lista] of porPapel) {
    const nome = nomeDoPapel(papel, lista)
    if (!nome) continue

    const atributos: AtributosOcorrencia = {}
    if (papel === "REGISTRADO") {
      atributos.dataNascimento = valorDoRegistrado("DATA_NASCIMENTO")
      atributos.localNascimento = valorDoRegistrado("LOCAL_NASCIMENTO")
      atributos.paisNascimento = valorDoRegistrado("PAIS_NASCIMENTO")
      atributos.dataObito = valorDoRegistrado("DATA_OBITO")
      atributos.dataCasamento = valorDoRegistrado("DATA_CASAMENTO")
      atributos.localCasamento = valorDoRegistrado("LOCAL_CASAMENTO")
      atributos.profissao = valorDoRegistrado("PROFISSAO")
      atributos.residencia = valorDoRegistrado("RESIDENCIA_HISTORICA")
      atributos.nacionalidade = valorDoRegistrado("NACIONALIDADE")
      const idade = valorDoRegistrado("IDADE_DECLARADA")
      atributos.idadeDeclarada = idade ? Number(idade) : null
      atributos.nomePai = porPapel.get("PAI")?.find((c) => c.campo === "FILIACAO_PAI")?.valorNormalizado ?? null
      atributos.nomeMae = porPapel.get("MAE")?.find((c) => c.campo === "FILIACAO_MAE")?.valorNormalizado ?? null
      atributos.nomeConjuge = porPapel.get("CONJUGE")?.find((c) => c.campo === "CONJUGE")?.valorNormalizado ?? null
    } else if (papel === "PAI" || papel === "MAE") {
      // O que a certidão diz do genitor: o cônjuge dele é o outro genitor.
      const outro = papel === "PAI" ? porPapel.get("MAE") : porPapel.get("PAI")
      atributos.nomeConjuge =
        outro?.find((c) => c.campo === "FILIACAO_PAI" || c.campo === "FILIACAO_MAE")?.valorNormalizado ?? null
    } else if (papel === "CONJUGE") {
      atributos.nomeConjuge = valorDoRegistrado("NOME_REGISTRAL")
      atributos.dataCasamento = valorDoRegistrado("DATA_CASAMENTO")
      atributos.localCasamento = valorDoRegistrado("LOCAL_CASAMENTO")
    }

    const ref = validos.find((c) => c.campo === "REFERENCIA_REGISTRAL")?.valorNormalizado
    if (ref) atributos.cartorio = ref

    ocorrencias.push({
      papel,
      nomeBruto: nome.bruto,
      nomeNormalizado: nome.normalizado,
      chaveFonetica: chaveFonetica(nome.normalizado),
      sexoInferido: sexoDoPapel(papel) ?? (papel === "REGISTRADO" ? valorDoRegistrado("SEXO") : null),
      atributos,
      camposIds: [],
    })
  }

  // Papel que não pertence à natureza do documento é ruído de leitura (ex.:
  // "padrinho" num registro de óbito). Descartar aqui evita criar menção de
  // pessoa a partir de um rótulo lido fora de contexto.
  const esperados = new Set(PAPEIS_ESPERADOS[natureza] ?? [])
  const filtradas = esperados.size
    ? ocorrencias.filter((o) => esperados.has(o.papel))
    : ocorrencias

  // Determinismo: a ordem influencia a idempotência da chave.
  const ordemPapel = (p: PapelOcorrencia) => ORDEM_PAPEL[p] ?? 99
  filtradas.sort(
    (x, y) => ordemPapel(x.papel) - ordemPapel(y.papel) || x.nomeNormalizado.localeCompare(y.nomeNormalizado),
  )
  return filtradas
}

const ORDEM_PAPEL: Partial<Record<PapelOcorrencia, number>> = {
  REGISTRADO: 0,
  PAI: 1,
  MAE: 2,
  CONJUGE: 3,
  FILHO: 4,
  AVO_PATERNO: 5,
  AVOA_PATERNA: 6,
  AVO_MATERNO: 7,
  AVOA_MATERNA: 8,
  DECLARANTE: 9,
  PADRINHO: 10,
  MADRINHA: 11,
  TESTEMUNHA: 12,
  OFICIANTE: 13,
  OUTRO: 14,
}

function nomeDoPapel(
  papel: PapelOcorrencia,
  lista: CampoConferido[],
): { bruto: string; normalizado: string } | null {
  const camposDeNome: CampoRegistral[] =
    papel === "PAI" || papel === "AVO_PATERNO" || papel === "AVO_MATERNO"
      ? ["FILIACAO_PAI", "NOME_REGISTRAL"]
      : papel === "MAE" || papel === "AVOA_PATERNA" || papel === "AVOA_MATERNA"
        ? ["FILIACAO_MAE", "NOME_REGISTRAL"]
        : papel === "CONJUGE"
          ? ["CONJUGE", "NOME_REGISTRAL"]
          : ["NOME_REGISTRAL"]

  for (const cn of camposDeNome) {
    const achado = lista.find((c) => c.campo === cn && c.valorNormalizado)
    if (achado) {
      const bruto = achado.a?.valorBruto ?? achado.b?.valorBruto ?? achado.valorNormalizado!
      return { bruto, normalizado: achado.valorNormalizado! }
    }
  }
  return null
}

/** Veredictos que impedem consolidação (usado por serviços e testes). */
export const VEREDICTOS_SEM_VALOR: ReadonlySet<VeredictoConferencia> = new Set<VeredictoConferencia>([
  "DIVERGENTE",
  "AUSENTE",
])
