// src/lib/genealogia/sincronizacao-registral.ts
// ============================================================================
// SINCRONIZAÇÃO ÁRVORE ⇄ DADOS REGISTRAIS DA GENEALOGIA (06/10/2026) — PURO (sem banco, sem tela).
//
// REGRA DE NEGÓCIO: a árvore começa como GUIA; o dado real é o do REGISTRO LOCALIZADO na fase de Genealogia ("Localizar registro" concluído).
// Quando os dois diferem, vale o da Genealogia. Sentido ÚNICO: Dados Registrais → árvore. Campo que veio do registro não se edita na árvore.
//
// FONTE POR CAMPO (uma certidão NUNCA altera campo de outro evento):
//   Certidão de NASCIMENTO → Pessoa.data_nasc · local_nasc (cidade) · estado_nasc · pais_nasc
//   Certidão de CASAMENTO  → União.data_inicio · local (cidade) · estado · pais
//   Certidão de ÓBITO      → Pessoa.data_obito   (a Pessoa NÃO tem coluna de local do óbito: nada a sincronizar no local)
//   Origem no registro: data_evento · cidade_registro · estado_registro · pais_registro  (a "Data do registro" NUNCA é a data do evento).
// Valor vazio no registro nunca apaga a árvore.
// ============================================================================

export type EventoRegistral = "NASCIMENTO" | "CASAMENTO" | "OBITO"
export type AlvoDaSincronizacao = "PESSOA" | "UNIAO"
export type OrigemNoRegistro = "data_evento" | "cidade_registro" | "estado_registro" | "pais_registro" | "data_registro" | "cartorio" | "livro" | "folha" | "termo"

export interface CampoSincronizavel {
  /** Chave estável (`PESSOA.data_nasc`, `UNIAO.local`…). */
  chave: string
  alvo: AlvoDaSincronizacao
  /** Coluna do modelo da árvore (Pessoa/Uniao). */
  coluna: string
  evento: EventoRegistral
  origem: OrigemNoRegistro
  tipo: "data" | "texto"
  /** Rótulo para a tela: "data do nascimento". */
  rotulo: string
}

export const CAMPOS_SINCRONIZAVEIS: readonly CampoSincronizavel[] = [
  { chave: "PESSOA.data_nasc", alvo: "PESSOA", coluna: "data_nasc", evento: "NASCIMENTO", origem: "data_evento", tipo: "data", rotulo: "data do nascimento" },
  { chave: "PESSOA.local_nasc", alvo: "PESSOA", coluna: "local_nasc", evento: "NASCIMENTO", origem: "cidade_registro", tipo: "texto", rotulo: "cidade do nascimento" },
  { chave: "PESSOA.estado_nasc", alvo: "PESSOA", coluna: "estado_nasc", evento: "NASCIMENTO", origem: "estado_registro", tipo: "texto", rotulo: "estado do nascimento" },
  { chave: "PESSOA.pais_nasc", alvo: "PESSOA", coluna: "pais_nasc", evento: "NASCIMENTO", origem: "pais_registro", tipo: "texto", rotulo: "país do nascimento" },
  { chave: "UNIAO.data_inicio", alvo: "UNIAO", coluna: "data_inicio", evento: "CASAMENTO", origem: "data_evento", tipo: "data", rotulo: "data do casamento" },
  { chave: "UNIAO.local", alvo: "UNIAO", coluna: "local", evento: "CASAMENTO", origem: "cidade_registro", tipo: "texto", rotulo: "cidade do casamento" },
  { chave: "UNIAO.estado", alvo: "UNIAO", coluna: "estado", evento: "CASAMENTO", origem: "estado_registro", tipo: "texto", rotulo: "estado do casamento" },
  { chave: "UNIAO.pais", alvo: "UNIAO", coluna: "pais", evento: "CASAMENTO", origem: "pais_registro", tipo: "texto", rotulo: "país do casamento" },
  { chave: "PESSOA.data_obito", alvo: "PESSOA", coluna: "data_obito", evento: "OBITO", origem: "data_evento", tipo: "data", rotulo: "data do óbito" },
  // Só o CASAMENTO tem onde guardar a referência do registro na árvore (a União). Nascimento e óbito: Pessoa não tem data de registro, cartório, livro, folha nem termo
  // — sem equivalente, sem comparação e sem modal. Cada campo só contra o seu: cartório é CARTÓRIO (nunca cidade); livro, folha e termo, cada um com o seu.
  { chave: "UNIAO.data_registro", alvo: "UNIAO", coluna: "data_registro", evento: "CASAMENTO", origem: "data_registro", tipo: "data", rotulo: "data do registro do casamento" },
  { chave: "UNIAO.cartorio", alvo: "UNIAO", coluna: "cartorio", evento: "CASAMENTO", origem: "cartorio", tipo: "texto", rotulo: "cartório do casamento" },
  { chave: "UNIAO.livro", alvo: "UNIAO", coluna: "livro", evento: "CASAMENTO", origem: "livro", tipo: "texto", rotulo: "livro do casamento" },
  { chave: "UNIAO.folha", alvo: "UNIAO", coluna: "folha", evento: "CASAMENTO", origem: "folha", tipo: "texto", rotulo: "folha do casamento" },
  { chave: "UNIAO.termo", alvo: "UNIAO", coluna: "termo", evento: "CASAMENTO", origem: "termo", tipo: "texto", rotulo: "termo do casamento" },
]

/** O tipo do documento (enum legado) → o evento da certidão. `null` = não é certidão de nascimento/casamento/óbito. */
export function eventoDoTipoDeDocumento(tipo: string | null | undefined): EventoRegistral | null {
  const t = String(tipo ?? "").toUpperCase()
  if (/^CERTIDAO_NASCIMENTO/.test(t)) return "NASCIMENTO"
  if (/^CERTIDAO_CASAMENTO/.test(t)) return "CASAMENTO"
  if (/^CERTIDAO_OBITO/.test(t)) return "OBITO"
  return null
}

/** Os tipos de documento (enum) que são certidão de algum dos três eventos. */
export const TIPOS_DE_CERTIDAO_DO_EVENTO: readonly string[] = [
  "CERTIDAO_NASCIMENTO", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR", "CERTIDAO_CASAMENTO", "CERTIDAO_CASAMENTO_INTEIRO_TEOR", "CERTIDAO_OBITO", "CERTIDAO_OBITO_INTEIRO_TEOR",
]

/** O que o registro localizado diz (Dados Registrais da certidão). */
export interface ValoresDoRegistro {
  data_evento?: Date | string | null
  cidade_registro?: string | null
  estado_registro?: string | null
  pais_registro?: string | null
  data_registro?: Date | string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
}

// ─── normalização e texto ───────────────────────────────────────────────────
const semAcento = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "")

/** Data → `AAAA-MM-DD` (dia civil UTC, como o banco guarda). `null` se vazia/ inválida. */
export function diaDe(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T00:00:00.000Z`) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
/** `AAAA-MM-DD` → `dd/mm/aaaa`. */
export const dataBR = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")
export const textoDeCampo = (v: string | null | undefined): string | null => { const t = (v ?? "").trim().replace(/\s+/g, " "); return t === "" ? null : t }
/** Igualdade de texto sem acento e sem diferença de caixa ("Sao Paulo" = "São Paulo"). */
export const mesmoTexto = (a: string | null | undefined, b: string | null | undefined): boolean => semAcento(textoDeCampo(a) ?? "").toLowerCase() === semAcento(textoDeCampo(b) ?? "").toLowerCase()

/** O valor do campo no registro (normalizado: data `AAAA-MM-DD`, texto aparado) ou `null` se vazio. */
export function valorDoRegistro(campo: CampoSincronizavel, registro: ValoresDoRegistro): string | null {
  const bruto = registro[campo.origem]
  if (campo.tipo === "data") return diaDe(bruto as Date | string | null | undefined)
  const t = textoDeCampo(bruto as string | null | undefined)
  // «0» é o valor padrão do cadastro de livro/folha/termo: não é dado (nem se compara, nem preenche a árvore).
  return t != null && (campo.origem === "livro" || campo.origem === "folha" || campo.origem === "termo") && /^0+$/.test(t) ? null : t
}

/** O valor atual na árvore, no mesmo formato. */
export function valorNaArvore(campo: CampoSincronizavel, atual: Record<string, unknown>): string | null {
  const v = atual[campo.coluna]
  return campo.tipo === "data" ? diaDe(v as Date | string | null | undefined) : textoDeCampo(v as string | null | undefined)
}

// ─── EQUIVALÊNCIA: o mesmo lugar escrito de outro jeito NÃO é divergência ──────────────────────────────────────────────────
// A árvore guarda "SP" e o registro "São Paulo"; a árvore guarda "São Paulo (Santo Amaro)" (distrito entre parênteses, a convenção do cadastro) e o registro "São Paulo".
// Sobrescrever perderia informação (o distrito). Só é conflito quando o LUGAR é outro.
const UF_BR: Record<string, string> = {
  AC: "acre", AL: "alagoas", AP: "amapa", AM: "amazonas", BA: "bahia", CE: "ceara", DF: "distrito federal", ES: "espirito santo", GO: "goias", MA: "maranhao", MT: "mato grosso",
  MS: "mato grosso do sul", MG: "minas gerais", PA: "para", PB: "paraiba", PR: "parana", PE: "pernambuco", PI: "piaui", RJ: "rio de janeiro", RN: "rio grande do norte",
  RS: "rio grande do sul", RO: "rondonia", RR: "roraima", SC: "santa catarina", SP: "sao paulo", SE: "sergipe", TO: "tocantins",
}
/** O texto sem o sufixo entre parênteses (distrito), sem acento e sem caixa. */
const baseDoLugar = (v: string): string => semAcento(v.replace(/\s*\([^)]*\)\s*$/, "")).toLowerCase().trim()
const nomeDeUf = (v: string): string => { const b = baseDoLugar(v); return UF_BR[b.toUpperCase()] ?? b }

/** Os dois textos dizem o MESMO lugar? (campo "estado": sigla = nome; qualquer campo: o distrito entre parênteses não conta.) */
export function mesmoLugar(campo: Pick<CampoSincronizavel, "origem">, a: string, b: string): boolean {
  if (campo.origem === "estado_registro") return nomeDeUf(a) === nomeDeUf(b)
  return baseDoLugar(a) === baseDoLugar(b)
}

/** O texto sem o sufixo entre parênteses («SP (2º Subd.)» → «SP»; «São Paulo (Lapa)» → «São Paulo») — o que a Genealogia assume quando vale o valor da árvore. */
export const semParenteses = (v: string): string => v.replace(/\s*\([^)]*\)\s*$/, "").trim()

export type TipoDeDiferenca = "PREENCHER" | "CONFLITO"

export interface DiferencaDeCampo {
  campo: CampoSincronizavel
  /** O que a árvore tem (formato interno) — `null` = vazio. */
  arvore: string | null
  /** O que o registro tem (formato interno). */
  registro: string
  tipo: TipoDeDiferenca
}

/** Como mostrar um valor ao usuário ("03/10/1937", "Santo André"). */
export const mostrarValor = (campo: CampoSincronizavel, v: string | null): string => (v == null ? "—" : campo.tipo === "data" ? dataBR(v) : v)

/**
 * As diferenças entre UMA certidão (evento) e o alvo da árvore: só os campos DAQUELE evento. Campo vazio no registro não entra (nunca apaga). Vazio na
 * árvore → PREENCHER (sozinho). Diferente → CONFLITO (vale o registro, com aviso e histórico). Igual → nada.
 */
export function diferencasDoEvento(evento: EventoRegistral, registro: ValoresDoRegistro, atual: Record<string, unknown>): DiferencaDeCampo[] {
  const r: DiferencaDeCampo[] = []
  for (const campo of CAMPOS_SINCRONIZAVEIS) {
    if (campo.evento !== evento) continue // uma certidão nunca altera campo de outro evento
    const doRegistro = valorDoRegistro(campo, registro)
    if (doRegistro == null) continue
    const daArvore = valorNaArvore(campo, atual)
    if (daArvore == null) { r.push({ campo, arvore: null, registro: doRegistro, tipo: "PREENCHER" }); continue }
    const igual = campo.tipo === "data" ? daArvore === doRegistro : mesmoLugar(campo, daArvore, doRegistro)
    if (!igual) r.push({ campo, arvore: daArvore, registro: doRegistro, tipo: "CONFLITO" })
  }
  return r
}

/** O aviso da tela, na hora de digitar um valor diferente do da árvore. */
export function textoDoAvisoDeConflito(campo: CampoSincronizavel, arvore: string | null, novo: string): string {
  return `A árvore diz ${mostrarValor(campo, arvore)}. Confirmar ${mostrarValor(campo, novo)} como ${campo.rotulo}?`
}

/** A frase do histórico: "data do nascimento: 03/10/1937 → 12/10/1937". */
export function textoDoHistorico(campo: CampoSincronizavel, antes: string | null, depois: string): string {
  return `${campo.rotulo}: ${antes == null ? "vazio" : mostrarValor(campo, antes)} → ${mostrarValor(campo, depois)}`
}

export const campoDaChave = (chave: string): CampoSincronizavel | null => CAMPOS_SINCRONIZAVEIS.find((c) => c.chave === chave) ?? null

/**
 * Os campos da árvore TRAVADOS (vieram do registro): uma certidão localizada que tem valor para o campo. Quem NÃO tem registro continua editável.
 * `registros` = os registros localizados do alvo (um por evento).
 */
export function camposTravados(registros: ReadonlyArray<{ evento: EventoRegistral; valores: ValoresDoRegistro }>, destravados?: ReadonlySet<string>): Set<string> {
  const travados = new Set<string>()
  for (const reg of registros) {
    for (const campo of CAMPOS_SINCRONIZAVEIS) {
      if (campo.evento !== reg.evento || destravados?.has(campo.chave)) continue
      if (valorDoRegistro(campo, reg.valores) != null) travados.add(campo.chave)
    }
  }
  return travados
}
