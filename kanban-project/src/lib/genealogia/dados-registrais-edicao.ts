// src/lib/genealogia/dados-registrais-edicao.ts
// ============================================================================
// EDITAR OS DADOS REGISTRAIS DEPOIS DO "LOCALIZAR REGISTRO" (06/10/2026) — PURO. Regras:
//  • Edita evento (data do evento, data do registro), localidade (país, estado, cidade, cartório em texto livre) e referência (livro, folha, termo).
//    O órgão emissor continua pelo "alterar" próprio.
//  • Editar NÃO reabre o passo, NÃO muda a fase e NÃO cancela operação nenhuma: só grava no Documento.
//  • Toda edição vai ao histórico (antes → depois, quem e quando). Passo já concluído → MOTIVO da correção é obrigatório.
//  • Requerimento ao cartório já enviado → AVISO na tela antes de salvar ("o pedido ao cartório já saiu com 12/10/1937") e registro no histórico. Nada é reenviado.
//  • A edição dispara a sincronização com a árvore (ver `sincronizacao-registral.ts`).
// ============================================================================
import { dataBR, diaDe, mesmoLugar, textoDeCampo, type CampoSincronizavel } from "./sincronizacao-registral"

export type ChaveEditavel = "data_evento" | "data_registro" | "pais_registro" | "estado_registro" | "cidade_registro" | "cartorio" | "livro" | "folha" | "termo"

export interface CampoEditavel { chave: ChaveEditavel; rotulo: string; tipo: "data" | "texto"; grupo: "Evento" | "Localidade" | "Referência registral"; maiuscula?: boolean; max: number }

export const CAMPOS_EDITAVEIS: readonly CampoEditavel[] = [
  { chave: "data_evento", rotulo: "data do evento", tipo: "data", grupo: "Evento", max: 10 },
  { chave: "data_registro", rotulo: "data do registro", tipo: "data", grupo: "Evento", max: 10 },
  { chave: "pais_registro", rotulo: "país", tipo: "texto", grupo: "Localidade", max: 50 },
  { chave: "estado_registro", rotulo: "estado/província", tipo: "texto", grupo: "Localidade", max: 50 },
  { chave: "cidade_registro", rotulo: "cidade", tipo: "texto", grupo: "Localidade", max: 100 },
  { chave: "cartorio", rotulo: "cartório (texto livre)", tipo: "texto", grupo: "Localidade", max: 200 },
  { chave: "livro", rotulo: "livro", tipo: "texto", grupo: "Referência registral", maiuscula: true, max: 20 },
  { chave: "folha", rotulo: "folha", tipo: "texto", grupo: "Referência registral", maiuscula: true, max: 20 },
  { chave: "termo", rotulo: "termo", tipo: "texto", grupo: "Referência registral", maiuscula: true, max: 30 },
]

export type ValoresEditaveis = Partial<Record<ChaveEditavel, string | Date | null>>

/** O valor normalizado de um campo (data `AAAA-MM-DD`, texto aparado — maiúsculo em livro/folha/termo) ou `null` se vazio. */
export function normalizarCampo(c: CampoEditavel, v: string | Date | null | undefined): string | null {
  if (c.tipo === "data") return diaDe(v)
  const t = textoDeCampo(typeof v === "string" ? v : null)
  return t == null ? null : c.maiuscula ? t.toUpperCase() : t
}

export interface MudancaDeCampo { chave: ChaveEditavel; rotulo: string; antes: string | null; depois: string | null }

const mostrar = (c: CampoEditavel, v: string | null): string => (v == null ? "vazio" : c.tipo === "data" ? dataBR(v) : v)
export const mostrarMudanca = (m: MudancaDeCampo): string => {
  const c = CAMPOS_EDITAVEIS.find((x) => x.chave === m.chave)!
  return `${m.rotulo}: ${mostrar(c, m.antes)} → ${mostrar(c, m.depois)}`
}

/** O que MUDA: só os campos enviados (`depois` definido) cujo valor normalizado difere do de hoje. Campo omitido não é tocado. */
export function mudancasDaEdicao(atual: ValoresEditaveis, novo: ValoresEditaveis): MudancaDeCampo[] {
  const r: MudancaDeCampo[] = []
  for (const c of CAMPOS_EDITAVEIS) {
    if (!(c.chave in novo) || novo[c.chave] === undefined) continue
    const antes = normalizarCampo(c, atual[c.chave]), depois = normalizarCampo(c, novo[c.chave])
    if (antes !== depois) r.push({ chave: c.chave, rotulo: c.rotulo, antes, depois })
  }
  return r
}

export const MOTIVO_MINIMO = 10
export const MOTIVO_MAXIMO = 300

/** O motivo é OBRIGATÓRIO quando o passo "Localizar registro" já estava concluído (a edição é uma CORREÇÃO). */
export function motivoValido(passoConcluido: boolean, motivo: string | null | undefined): { ok: true; motivo: string | null } | { ok: false; mensagem: string } {
  const t = (motivo ?? "").trim().replace(/\s+/g, " ")
  if (!passoConcluido) return { ok: true, motivo: t === "" ? null : t.slice(0, MOTIVO_MAXIMO) }
  if (t.length < MOTIVO_MINIMO) return { ok: false, mensagem: `Informe o motivo da correção (pelo menos ${MOTIVO_MINIMO} caracteres): o registro já foi localizado.` }
  return { ok: true, motivo: t.slice(0, MOTIVO_MAXIMO) }
}

/**
 * O aviso do requerimento já enviado ao cartório: "o pedido ao cartório já saiu com 12/10/1937 (data do evento)". Só os campos que mudaram e que o pedido levava
 * (evento, localidade, cartório e referência — todos). `null` = o pedido não foi enviado ou nada mudou.
 */
export function avisoDoRequerimentoEnviado(enviadoEm: Date | string | null | undefined, mudancas: readonly MudancaDeCampo[]): string | null {
  if (!enviadoEm || mudancas.length === 0) return null
  const valores = mudancas.map((m) => {
    const c = CAMPOS_EDITAVEIS.find((x) => x.chave === m.chave)!
    return `${mostrar(c, m.antes)} (${m.rotulo})`
  })
  const lista = valores.length === 1 ? valores[0] : `${valores.slice(0, -1).join(", ")} e ${valores[valores.length - 1]}`
  const dia = diaDe(enviadoEm)
  return `O pedido ao cartório já saiu${dia ? ` em ${dataBR(dia)}` : ""} com ${lista}. Nada será reenviado: se for preciso, avise o cartório.`
}

/** Conflito com a ÁRVORE na hora de digitar (aviso da tela): o campo do registro que difere do que a árvore tem. */
export interface ConflitoComArvore { campo: CampoSincronizavel | { chave: string; rotulo: string; tipo: "data" | "texto" }; origem: string; arvore: string; novo: string }

export function conflitosComArvore(
  camposDaArvore: ReadonlyArray<{ chave: string; rotulo: string; origem: string; tipo: "data" | "texto"; arvore: string | null }>,
  digitado: Partial<Record<string, string | null | undefined>>,
): ConflitoComArvore[] {
  const r: ConflitoComArvore[] = []
  for (const c of camposDaArvore) {
    if (c.arvore == null) continue // vazio na árvore preenche sozinho: sem aviso
    const bruto = digitado[c.origem]
    const novo = c.tipo === "data" ? diaDe(bruto ?? null) : textoDeCampo(bruto ?? null)
    if (novo == null) continue
    const igual = c.tipo === "data" ? novo === c.arvore : mesmoLugar({ origem: c.origem as never }, novo, c.arvore)
    if (!igual) r.push({ campo: { chave: c.chave, rotulo: c.rotulo, tipo: c.tipo }, origem: c.origem, arvore: c.arvore, novo })
  }
  return r
}
