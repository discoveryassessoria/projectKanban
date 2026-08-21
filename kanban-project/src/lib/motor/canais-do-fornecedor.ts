// src/lib/motor/canais-do-fornecedor.ts
// ============================================================================
// POR ONDE DÁ PARA PEDIR — pergunta do FORNECEDOR, não do workflow.
//
// ─── O ERRO QUE ISTO DESFAZ ────────────────────────────────────────────────
// O workflow mantinha um cadastro próprio de canais e cada passo declarava quais
// oferecia. O resultado: um cartório que só atende no balcão aparecia com CRC e
// e-mail, porque o PASSO dizia que sim. O operador descobria tentando.
//
// "Quais canais existem" é vocabulário de domínio (`CanalOperacional`, fechado).
// "Quais canais ESTA organização atende" é cadastro dela (`OrganizacaoCanal`).
// "Esta subtarefa usa os canais do fornecedor" é configuração do passo.
// Três perguntas, três donos — e nenhum deles copia o cadastro do outro.
//
// ─── A EXIGÊNCIA SÓ ACRESCENTA ─────────────────────────────────────────────
// O tipo de canal exige o que exige. A organização pode exigir MAIS (um cartório que
// só aceita pedido com procuração anexada). Nunca menos: se pudesse dispensar, a
// exigência do tipo viraria sugestão e o servidor aceitaria o que o domínio recusa.
// ============================================================================

import { prisma } from "@/lib/prisma"

export interface CanalDisponivel {
  key: string
  label: string
  descricao: string | null
  ordem: number
  exigeProtocolo: boolean
  exigeAnexo: boolean
  anexoLabel: string | null
  exigeRastreio: boolean
  exigeObservacao: boolean
  /// Endereço da organização NESTE canal (e-mail, portal, telefone, guichê).
  endereco: string | null
  prazoDias: number | null
  /// De onde a lista veio — a tela diz a verdade sobre isso em vez de fingir cadastro.
  origem: "FORNECEDOR" | "CATALOGO"
}

/** O que a fonte de canais de uma subtarefa pode ser. Vocabulário fechado. */
export const FONTES_DE_CANAIS = {
  /// A subtarefa não envia nada para fora.
  NENHUMA: "NENHUMA",
  /// Os canais que o fornecedor CONCRETO daquele documento atende.
  FORNECEDOR_RELACIONADO: "FORNECEDOR_RELACIONADO",
  /// Restringe a tipos específicos, entre os que o fornecedor atende.
  TIPOS_PERMITIDOS: "TIPOS_PERMITIDOS",
} as const
export type FonteDeCanais = (typeof FONTES_DE_CANAIS)[keyof typeof FONTES_DE_CANAIS]

/**
 * OS CANAIS QUE UMA ORGANIZAÇÃO ATENDE.
 *
 * Lista vazia é resposta legítima e diferente de "não sei": quer dizer que ninguém
 * cadastrou por onde aquela organização atende. Quem chama decide se isso bloqueia —
 * e a projeção da subtarefa bloqueia, com `CANAL_INDISPONIVEL`, em vez de oferecer
 * uma lista inventada.
 */
export async function canaisDaOrganizacao(organizacaoId: number): Promise<CanalDisponivel[]> {
  const linhas = await prisma.organizacaoCanal.findMany({
    where: { organizacaoId, ativo: true, organizacao: { ativo: true }, canal: { ativo: true } },
    include: { canal: true },
    orderBy: [{ ordem: "asc" }, { id: "asc" }],
  })

  return linhas.map((l) => ({
    key: l.canal.key,
    label: l.canal.label,
    descricao: l.canal.descricao,
    ordem: l.ordem,
    // SÓ ACRESCENTA: a organização soma exigência ao tipo, nunca dispensa.
    exigeProtocolo: l.exigeProtocolo === true || l.canal.protocoloObrigatorio,
    exigeAnexo: l.exigeAnexo === true || l.canal.anexoObrigatorioLabel != null,
    anexoLabel: l.canal.anexoObrigatorioLabel,
    exigeRastreio: l.exigeRastreio === true || l.canal.rastreioObrigatorio,
    exigeObservacao: l.exigeObservacao === true || l.canal.observacaoObrigatoria,
    endereco: l.endereco,
    prazoDias: l.prazoDias,
    origem: "FORNECEDOR" as const,
  }))
}

/** Todo o vocabulário de tipos de canal, ativo. Usado pelo cadastro, não pelo runtime. */
export async function tiposDeCanal(): Promise<CanalDisponivel[]> {
  const linhas = await prisma.canalOperacional.findMany({
    where: { ativo: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }],
  })
  return linhas.map((c) => ({
    key: c.key, label: c.label, descricao: c.descricao, ordem: c.ordem,
    exigeProtocolo: c.protocoloObrigatorio,
    exigeAnexo: c.anexoObrigatorioLabel != null,
    anexoLabel: c.anexoObrigatorioLabel,
    exigeRastreio: c.rastreioObrigatorio,
    exigeObservacao: c.observacaoObrigatoria,
    endereco: null, prazoDias: null,
    origem: "CATALOGO" as const,
  }))
}

/**
 * OS CANAIS QUE ESTA SUBTAREFA OFERECE, para ESTE fornecedor.
 *
 * `fornecedorId` nulo com fonte FORNECEDOR_RELACIONADO devolve lista vazia — e isso é
 * a resposta certa: sem saber a quem se está pedindo, não há por onde pedir. Quem
 * projeta transforma isso em bloqueio nomeado (`FORNECEDOR_AUSENTE`), que é o que a
 * tela precisa para explicar ao operador o que falta.
 */
export async function canaisDaSubtarefa(args: {
  fonteDeCanais: string
  tiposPermitidos?: string[] | null
  fornecedorId?: number | null
}): Promise<CanalDisponivel[]> {
  if (args.fonteDeCanais === FONTES_DE_CANAIS.NENHUMA) return []
  if (!args.fornecedorId) return []

  const doFornecedor = await canaisDaOrganizacao(args.fornecedorId)
  if (args.fonteDeCanais !== FONTES_DE_CANAIS.TIPOS_PERMITIDOS) return doFornecedor

  const permitidos = new Set(args.tiposPermitidos ?? [])
  // RESTRIÇÃO É INTERSEÇÃO, nunca acréscimo: o passo pode proibir um canal que o
  // fornecedor atende, e não pode habilitar um que ele não atende.
  if (permitidos.size === 0) return doFornecedor
  return doFornecedor.filter((c) => permitidos.has(c.key))
}

/** O QUE FALTA para enviar por este canal. Mesma conta que a porta de execução aplica. */
export function faltaParaEnviarPeloCanal(
  canal: CanalDisponivel,
  valores: { protocolo?: string | null; anexo?: string | null; rastreio?: string | null; observacao?: string | null },
): string[] {
  const vazio = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "")
  const faltando: string[] = []
  if (canal.exigeProtocolo && vazio(valores.protocolo)) faltando.push("NUMERO_PROTOCOLO")
  if (canal.exigeAnexo && vazio(valores.anexo)) faltando.push("ANEXO")
  if (canal.exigeRastreio && vazio(valores.rastreio)) faltando.push("CODIGO_RASTREIO")
  if (canal.exigeObservacao && vazio(valores.observacao)) faltando.push("OBSERVACAO")
  return faltando
}
