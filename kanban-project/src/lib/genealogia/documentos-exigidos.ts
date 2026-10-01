// src/lib/genealogia/documentos-exigidos.ts
// ============================================================================
// PESSOA.documentosExigidos — o FILTRO SUBTRATIVO das certidões de uma pessoa (QUALQUER pessoa da árvore).
//
// Módulo PURO e sem imports de servidor (cliente, API e núcleo da Genealogia usam o MESMO).
//
//   exigido = (o que a regra automática da árvore pede) ∩ (o que está marcado)
//
// NUNCA cria exigência que a árvore não pede: marcar Casamento numa pessoa solteira ou Óbito numa viva não faz nascer nada.
// O filtro vale para QUALQUER pessoa — linha reta, requerente, fora da linhagem ou pendente (decisão do usuário, 01/10/2026:
// "quando a pessoa pertence à linha de transmissão eu também preciso escolher só Nascimento e Óbito"). O que `pessoaExigeDocumentacao`
// protege continua igual: desligar a caixa "Precisa de documentação" NÃO tira da árvore quem está na linha principal (mandato 675).
// `null` (campo nunca tocado) = regra automática = comportamento de antes desta coluna existir.
// ============================================================================

/** Lista FECHADA de três — a única constante. Os valores gravados em `Pessoa.documentosExigidos` são estes CODES. */
export const DOCUMENTOS_EXIGIVEIS = [
  { code: "NAS", rotulo: "Nascimento" },
  { code: "CAS", rotulo: "Casamento" },
  { code: "OBI", rotulo: "Óbito" },
] as const

export type CodigoDocumentoExigivel = (typeof DOCUMENTOS_EXIGIVEIS)[number]["code"]

export const CODIGOS_DOCUMENTOS_EXIGIVEIS: readonly CodigoDocumentoExigivel[] = DOCUMENTOS_EXIGIVEIS.map((d) => d.code)

export function ehCodigoDocumentoExigivel(v: unknown): v is CodigoDocumentoExigivel {
  return typeof v === "string" && (CODIGOS_DOCUMENTOS_EXIGIVEIS as readonly string[]).includes(v)
}

/**
 * Qual dos três é o `TipoDocumentoCadastro.code` de uma regra? O cadastro real usa `IT - NAS` / `IT - CAS` / `IT - OBI`
 * (regras da Genealogia) e `NAS` / `CAS` / `OBI` (tipos simples); fixtures usam `PREFIXO-NAS`. O CODE canônico é o último
 * token (separado por espaço ou hífen). Qualquer outro tipo (RG, comprovante, procuração…) devolve `null`: o filtro não o toca.
 */
export function codigoExigivelDoTipo(documentTypeCode: string | null | undefined): CodigoDocumentoExigivel | null {
  if (!documentTypeCode) return null
  const tokens = documentTypeCode.trim().toUpperCase().split(/[\s\-_]+/).filter(Boolean)
  const ultimo = tokens[tokens.length - 1]
  return ehCodigoDocumentoExigivel(ultimo) ? ultimo : null
}

export type ResultadoValidacaoDocumentosExigidos =
  | { ok: true; valor: CodigoDocumentoExigivel[] | null }
  | { ok: false; erro: string }

/**
 * Valida o que chega da API. `undefined` não chega aqui (campo não enviado = não mexe). `null` = volta à regra automática.
 * Array: só os três codes, sem repetição; vazio é válido ("nenhum documento"). Igual aos três = `null` (nada a filtrar).
 */
export function validarDocumentosExigidos(raw: unknown): ResultadoValidacaoDocumentosExigidos {
  if (raw === null) return { ok: true, valor: null }
  if (!Array.isArray(raw)) return { ok: false, erro: "documentosExigidos deve ser uma lista (ou null)" }
  const vistos = new Set<string>()
  for (const item of raw) {
    if (!ehCodigoDocumentoExigivel(item)) return { ok: false, erro: `documentosExigidos: "${String(item)}" não é um documento permitido (${CODIGOS_DOCUMENTOS_EXIGIVEIS.join(", ")})` }
    if (vistos.has(item)) return { ok: false, erro: `documentosExigidos: "${item}" repetido` }
    vistos.add(item)
  }
  if (vistos.size === CODIGOS_DOCUMENTOS_EXIGIVEIS.length) return { ok: true, valor: null }
  // ordem canônica, estável
  return { ok: true, valor: CODIGOS_DOCUMENTOS_EXIGIVEIS.filter((c) => vistos.has(c)) }
}

/** Lê o valor GRAVADO (Json do banco) de forma defensiva: qualquer coisa que não seja lista válida vale `null` (regra automática). */
export function lerDocumentosExigidosGravado(v: unknown): CodigoDocumentoExigivel[] | null {
  if (!Array.isArray(v)) return null
  const r = validarDocumentosExigidos(v.filter(ehCodigoDocumentoExigivel))
  return r.ok ? r.valor : null
}

/** Os três marcados? (o que a tela mostra quando o campo é `null`). */
export function marcadosParaTela(gravado: unknown): CodigoDocumentoExigivel[] {
  return lerDocumentosExigidosGravado(gravado) ?? [...CODIGOS_DOCUMENTOS_EXIGIVEIS]
}

export interface PessoaParaFiltroDocumental {
  classificacao: "LINHA_PRINCIPAL" | "FORA_DA_LINHAGEM" | "PENDENTE_CLASSIFICACAO"
  documentacao: boolean
  documentosExigidos: unknown
}

/**
 * O filtro se aplica a esta pessoa? Quando há lista gravada — para QUALQUER classificação. Exceção: FORA da linhagem com a
 * documentação DESLIGADA não gera documento nenhum (a pessoa inteira sai), então a lista nem chega a valer.
 */
export function filtroSeAplica(p: PessoaParaFiltroDocumental): boolean {
  if (p.classificacao === "FORA_DA_LINHAGEM" && p.documentacao !== true) return false
  return lerDocumentosExigidosGravado(p.documentosExigidos) !== null
}

/**
 * O documento `codigo` continua EXIGIDO para esta pessoa? `true` quando o filtro não se aplica (campo `null`, ou pessoa fora da
 * linhagem sem documentação) ou quando o tipo não é um dos três.
 */
export function documentoEscolhidoParaPessoa(p: PessoaParaFiltroDocumental, codigo: CodigoDocumentoExigivel | null): boolean {
  if (codigo == null) return true
  if (!filtroSeAplica(p)) return true
  return (lerDocumentosExigidosGravado(p.documentosExigidos) ?? []).includes(codigo)
}

/**
 * CASAMENTO (alvo UNIÃO): vale se PELO MENOS UM dos cônjuges o mantém. Cônjuge sem lista (campo `null`) conta como "marcado" —
 * exceto o FORA da linhagem com documentação DESLIGADA, que não quer documento nenhum e conta como desmarcado.
 */
export function documentoDaUniaoEscolhido(conjuges: PessoaParaFiltroDocumental[], codigo: CodigoDocumentoExigivel | null): boolean {
  if (codigo == null) return true
  return conjuges.some((c) => {
    if (c.classificacao === "FORA_DA_LINHAGEM" && c.documentacao !== true) return false
    return documentoEscolhidoParaPessoa(c, codigo)
  })
}

const ROTULO_POR_CODIGO: Record<CodigoDocumentoExigivel, string> = { NAS: "Nascimento", CAS: "Casamento", OBI: "Óbito" }

/** "Nascimento, Óbito" / "nenhum documento" — para auditoria e tela. */
export function rotuloDaLista(lista: readonly CodigoDocumentoExigivel[]): string {
  return lista.length === 0 ? "nenhum documento" : lista.map((c) => ROTULO_POR_CODIGO[c]).join(", ")
}

/** Duas escolhas gravadas significam o MESMO? (`null` ≡ os três marcados.) */
export function mesmaEscolha(a: unknown, b: unknown): boolean {
  const x = marcadosParaTela(a), y = marcadosParaTela(b)
  return x.length === y.length && x.every((c) => y.includes(c))
}

/** O que mudou na escolha, em palavras (auditoria). `null` = nada mudou. */
export function descreverMudancaDocumentosExigidos(antes: unknown, depois: unknown): string | null {
  if (mesmaEscolha(antes, depois)) return null
  return `documentos exigidos da pessoa alterados: de ${rotuloDaLista(marcadosParaTela(antes))} para ${rotuloDaLista(marcadosParaTela(depois))}`
}
