// src/lib/anexos/chave.ts
// ============================================================================
// A CHAVE DE UM ANEXO — pura (cliente e servidor). Todo anexo NOVO nasce no bucket PRIVADO, em `privado/anexos/<domínio>/<id>/…`, e o banco
// guarda SÓ a chave (nunca um endereço). Quem abre o anexo passa pela porta única (`POST /api/anexos/abrir`), que confere login e permissão
// e devolve uma URL assinada de poucos minutos. Nada de endereço fixo.
//
// O domínio na chave diz DE QUEM é o anexo e, por isso, QUAL permissão abre: processo/protocolo/documento/etapa → `processos.ver`;
// contratante/requerente → `clientes.ver`; financeiro → `financeiro.ver`; rascunho (cliente ainda não salvo) → só quem enviou.
//
// LEITURA DOS DOIS FORMATOS (sem migration): valor que começa com `privado/anexos/` = chave nova; `http(s)://…` = endereço antigo (público ou
// de outro serviço), usado como está. Nenhuma das duas formas é convertida no banco.
// ============================================================================

export const PREFIXO_ANEXOS = "privado/anexos"

export const DOMINIOS_DE_ANEXO = ["processo", "protocolo", "documento", "etapa", "contratante", "requerente", "financeiro", "rascunho"] as const
export type DominioDeAnexo = (typeof DOMINIOS_DE_ANEXO)[number]

/** Permissão do módulo que abre (e que também autoriza gravar) o anexo de cada domínio. `null` = regra própria (rascunho). */
export const PERMISSAO_DO_DOMINIO: Record<DominioDeAnexo, "processos.ver" | "clientes.ver" | "financeiro.ver" | null> = {
  processo: "processos.ver", protocolo: "processos.ver", documento: "processos.ver", etapa: "processos.ver",
  contratante: "clientes.ver", requerente: "clientes.ver",
  financeiro: "financeiro.ver",
  rascunho: null,
}

export interface AlvoDoAnexo { dominio: DominioDeAnexo; id: number }

export const ehDominioDeAnexo = (v: unknown): v is DominioDeAnexo => typeof v === "string" && (DOMINIOS_DE_ANEXO as readonly string[]).includes(v)

/** Nome de arquivo seguro para caminho (sem acento, sem espaço, sem dado pessoal além do que a pessoa já nomeou). */
export function nomeSeguroDeAnexo(nome: string): string {
  return String(nome ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "arquivo"
}

/** `privado/anexos/<domínio>/<id>/<carimbo>-<uuid8>-<nome>` — o domínio e o id ficam na própria chave. */
export function novaChaveDeAnexo(args: { alvo: AlvoDoAnexo; nome: string; carimbo?: number; uuid8: string }): string {
  const id = Number.isInteger(args.alvo.id) && args.alvo.id >= 0 ? args.alvo.id : 0
  return `${PREFIXO_ANEXOS}/${args.alvo.dominio}/${id}/${args.carimbo ?? Date.now()}-${args.uuid8}-${nomeSeguroDeAnexo(args.nome)}`
}

/** A chave nova? (só o formato; não diz se o objeto existe) */
export const ehChaveDeAnexo = (v: unknown): v is string => typeof v === "string" && v.startsWith(`${PREFIXO_ANEXOS}/`) && !v.includes("..")

/** `privado/anexos/contratante/12/…` → `{ dominio: "contratante", id: 12 }`; qualquer outra coisa → `null`. */
export function alvoDaChave(chave: string): AlvoDoAnexo | null {
  if (!ehChaveDeAnexo(chave)) return null
  const [, , dominio, id] = chave.split("/")
  const n = Number(id)
  return ehDominioDeAnexo(dominio) && Number.isInteger(n) && n >= 0 ? { dominio, id: n } : null
}

export type LeituraDeAnexo =
  | { tipo: "chave"; chave: string }
  | { tipo: "endereco"; url: string }
  | { tipo: "vazio" }

/** O que o valor guardado no banco é: chave nova (precisa de URL assinada), endereço antigo/externo (usa como está) ou nada. */
export function leituraDoValor(valor: string | null | undefined): LeituraDeAnexo {
  const v = String(valor ?? "").trim()
  if (!v) return { tipo: "vazio" }
  if (ehChaveDeAnexo(v)) return { tipo: "chave", chave: v }
  return { tipo: "endereco", url: v }
}
