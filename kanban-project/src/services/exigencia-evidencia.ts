// src/services/exigencia-evidencia.ts
//
// EXIGÊNCIA DE EVIDÊNCIA DE ETAPA — quem responde "que documento mestre esta
// etapa exige que seja anexado".
//
// O PROBLEMA QUE ISTO RESOLVE
// ---------------------------
// O editor de "Solicitar certidão" sabia que precisava de um anexo, mas não sabia
// O QUE ele era: o único indício era o rótulo do campo ("Requerimento PDF
// enviado", "Print do protocolo CRC") — texto de tela. O arquivo subia sem
// classificação nenhuma, e nenhuma aba conseguia dizer que aquilo era o
// "Requerimento inteiro teor" que existe no Cadastro Mestre de Documentos.
//
// A exigência agora é CONFIGURAÇÃO, apontando para a linha do cadastro por ID
// (`ExigenciaEvidenciaEtapa.evidenciaTipoId`). O runtime nunca menciona "DOC21",
// nem nome, nem código: ele lê a configuração e usa o ID que ela devolve. Quem
// resolve código → ID é o seed do cadastro, uma única vez.
//
// ESPECIFICIDADE
// --------------
// Uma exigência pode valer para qualquer tipo de documento operacional e qualquer
// canal (as duas colunas nulas), ou ser restrita a um tipo, a um canal, ou aos
// dois. Quando mais de uma linha alcança o mesmo documento mestre, vence a MAIS
// específica — regra determinística, sem empate possível.

import { prisma } from "@/lib/prisma"
import type { Prisma, CanalSolicitacaoDocumento, TipoArquivoDocumento } from "@prisma/client"

/** Documento mestre exigido por uma etapa, já resolvido por ID. */
export interface ExigenciaEvidenciaDTO {
  id: number
  stepKey: string
  /** null = a exigência vale para qualquer canal. */
  canal: CanalSolicitacaoDocumento | null
  /** null = a exigência vale para qualquer tipo de documento operacional. */
  documentoTipoId: number | null
  finalidade: TipoArquivoDocumento
  obrigatoria: boolean
  cardinalidadeMax: number
  /** O CADASTRO MESTRE — é este ID que classifica o arquivo. */
  documentoMestre: {
    id: number
    publicCode: string | null
    code: string | null
    name: string
  }
}

/**
 * Quão específica é uma exigência. Maior vence. Puro e total — testável sem banco.
 * Tipo de documento pesa mais que canal: "requerimento de inteiro teor" é um fato
 * do DOCUMENTO; o canal só muda por onde ele foi enviado.
 */
export function especificidadeDaExigencia(e: {
  documentoTipoId: number | null
  canal: CanalSolicitacaoDocumento | null
}): number {
  return (e.documentoTipoId != null ? 2 : 0) + (e.canal != null ? 1 : 0)
}

const SELECT_MESTRE = { select: { id: true, publicCode: true, code: true, name: true } } as const

/**
 * Exigências de uma etapa, para um documento operacional e um canal concretos.
 * `canal` nulo = ainda não escolhido: devolve o que vale para qualquer canal (é o
 * que a tela precisa para já mostrar o campo antes da escolha).
 *
 * Aceita `tx` para rodar DENTRO da transação da conclusão da etapa — a validação
 * e a classificação têm de enxergar a mesma configuração, no mesmo instante.
 */
export async function resolverExigenciasDaEtapa(
  args: {
    stepKey: string
    documentoTipoId: number | null
    canal?: CanalSolicitacaoDocumento | null
  },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ExigenciaEvidenciaDTO[]> {
  const linhas = await db.exigenciaEvidenciaEtapa.findMany({
    where: {
      stepKey: args.stepKey,
      ativo: true,
      OR: [{ documentoTipoId: null }, ...(args.documentoTipoId != null ? [{ documentoTipoId: args.documentoTipoId }] : [])],
      AND: [{ OR: [{ canal: null }, ...(args.canal ? [{ canal: args.canal }] : [])] }],
    },
    include: { evidenciaTipo: SELECT_MESTRE },
    orderBy: { id: "asc" },
  })

  // Um documento mestre aparece UMA vez: entre as linhas que o alcançam, a mais
  // específica. Sem isso, a regra genérica e a específica exigiriam o mesmo
  // arquivo duas vezes.
  const porMestre = new Map<number, ExigenciaEvidenciaDTO>()
  for (const l of linhas) {
    const dto: ExigenciaEvidenciaDTO = {
      id: l.id,
      stepKey: l.stepKey,
      canal: l.canal,
      documentoTipoId: l.documentoTipoId,
      finalidade: l.finalidade,
      obrigatoria: l.obrigatoria,
      cardinalidadeMax: l.cardinalidadeMax,
      documentoMestre: l.evidenciaTipo,
    }
    const atual = porMestre.get(l.evidenciaTipoId)
    if (!atual || especificidadeDaExigencia(dto) > especificidadeDaExigencia(atual)) {
      porMestre.set(l.evidenciaTipoId, dto)
    }
  }
  return [...porMestre.values()]
}

/**
 * A exigência PRINCIPAL da etapa — a que o campo único de anexo do editor atende.
 * É a obrigatória mais específica; na ausência de obrigatória, a primeira opcional.
 * Devolve null quando a etapa não exige documento mestre nenhum (e aí o anexo
 * continua sendo aceito, apenas sem classificação — nada é inventado).
 */
export function exigenciaPrincipal(exigencias: ExigenciaEvidenciaDTO[]): ExigenciaEvidenciaDTO | null {
  if (exigencias.length === 0) return null
  const ordenadas = [...exigencias].sort((a, b) => {
    if (a.obrigatoria !== b.obrigatoria) return a.obrigatoria ? -1 : 1
    return especificidadeDaExigencia(b) - especificidadeDaExigencia(a)
  })
  return ordenadas[0]
}

/**
 * Códigos de exigência obrigatória NÃO atendida. Puro: recebe o que a etapa exige
 * e o que foi anexado, devolve o que falta. Usado no servidor (trava) e disponível
 * para a tela (aviso) — a mesma regra, nunca duas.
 */
export function exigenciasNaoAtendidas(
  exigencias: ExigenciaEvidenciaDTO[],
  anexados: Array<{ documentTypeId: number | null }>,
): ExigenciaEvidenciaDTO[] {
  const presentes = new Set(anexados.map((a) => a.documentTypeId).filter((id): id is number => id != null))
  return exigencias.filter((e) => e.obrigatoria && !presentes.has(e.documentoMestre.id))
}
