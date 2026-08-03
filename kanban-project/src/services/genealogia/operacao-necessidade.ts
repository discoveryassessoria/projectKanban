// src/services/genealogia/operacao-necessidade.ts
//
// ABRIR A BUSCA de um registro/certidão: garante o Documento operacional da
// NecessidadeDocumental e liga a ele os passos daquele alvo, para que o executor de
// busca documental (que opera por documentoId) carregue o workflow certo.
//
// Idempotente e serializado por advisory lock: duplo-clique ou retry reusam o mesmo
// Documento. Não altera status de passo, não conclui nada, não avança fase.
//
// Extraído da rota POST /api/processos/[id]/genealogia/operacao para que o fluxo
// tenha UM dono e possa ser exercitado em teste sem HTTP.

import { prisma } from "@/lib/prisma"
import type { Prisma, TipoDocumento } from "@prisma/client"

/** Enum legado de tipo de documento aceito pelo Documento. */
const TIPOS = new Set<string>([
  "CERTIDAO_NASCIMENTO", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
  "CERTIDAO_CASAMENTO", "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
  "CERTIDAO_OBITO", "CERTIDAO_OBITO_INTEIRO_TEOR",
  "CERTIDAO_BATISMO", "CNN", "CARTA_NATURALIZACAO", "RG", "CPF", "CNH",
  "PASSAPORTE_BRASILEIRO", "TITULO_ELEITOR", "RESERVISTA", "PASSAPORTE_ESTRANGEIRO",
  "CERTIDAO_CIDADANIA_ESTRANGEIRA", "COMPROVANTE_RESIDENCIA", "TRADUCAO_JURAMENTADA",
  "APOSTILA_HAIA", "FOTO_3X4", "PROCURACAO", "ARVORE_GENEALOGICA_DOC", "OUTRO",
])

export class OperacaoNecessidadeErro extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * Documento operacional do registro a localizar. Cria na primeira abertura, reusa
 * nas seguintes, e vincula os passos daquele alvo ao Documento.
 */
export async function garantirDocumentoDaNecessidade(
  processoId: number,
  necessidadeId: number,
): Promise<number> {
  const nec = await prisma.necessidadeDocumental.findUnique({
    where: { id: necessidadeId },
    select: { id: true, processoId: true, pessoaId: true, itemCatalogoId: true },
  })
  if (!nec || nec.processoId !== processoId) {
    throw new OperacaoNecessidadeErro("Necessidade não encontrada neste processo.", 404)
  }
  if (!nec.pessoaId) {
    throw new OperacaoNecessidadeErro("Necessidade sem pessoa (sujeito) — não é possível abrir a operação.", 400)
  }

  // Tipo do documento a partir do itemCatalogo da necessidade (ponte legacyEnumKey).
  const tipoDoc = await prisma.tipoDocumentoCadastro.findFirst({
    where: { itemCatalogoId: nec.itemCatalogoId },
    select: { id: true, legacyEnumKey: true },
  })
  const tipoEnum = tipoDoc?.legacyEnumKey && TIPOS.has(tipoDoc.legacyEnumKey)
    ? (tipoDoc.legacyEnumKey as TipoDocumento)
    : null

  const doc = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // ADVISORY LOCK transacional por necessidade (namespace fixo): serializa criações
    // concorrentes (duplo-clique/retry) SEM constraint no banco — como o modelo permite
    // N documentos por necessidade, um unique global não cabe; o lock garante que só o
    // primeiro cria e os demais reusam. Liberado no fim da transação.
    // ::int4 obrigatório: o Prisma vincula como bigint e a assinatura
    // pg_advisory_xact_lock(int4,int4) não casa com (int4,bigint).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741852, ${nec.id}::int4)`
    let d = await tx.documento.findFirst({ where: { necessidadeId: nec.id }, select: { id: true } })
    if (!d) {
      d = await tx.documento.create({
        data: {
          pessoaId: nec.pessoaId!,
          necessidadeId: nec.id,
          documentTypeId: tipoDoc?.id ?? null,
          tipo: tipoEnum,
          status: "PENDENTE",
          // CHECK Documento_origem_check em prod só admite 'manual'|'automatica'.
          // Registro operacional gerado pelo sistema (regra documental) = automatica.
          origem: "automatica",
        },
        select: { id: true },
      })
    }
    // Liga ao Documento TODOS os passos daquele alvo — por necessidade, não por nome
    // de passo. Assim qualquer passo que o workflow publicado tenha para este registro
    // abre no executor, e trocar o rótulo do passo no cadastro não quebra a ligação.
    await tx.phaseWorkflowStepInstance.updateMany({
      where: { necessidadeId: nec.id, documentoId: null },
      data: { documentoId: d.id },
    })
    return d
  })

  return doc.id
}
