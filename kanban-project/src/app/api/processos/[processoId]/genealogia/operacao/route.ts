// src/app/api/processos/[processoId]/genealogia/operacao/route.ts
//
// Abertura da operação "localizar_registro": garante o REGISTRO OPERACIONAL
// (Documento) da NecessidadeDocumental para o editor registral existente carregar.
// Idempotente (reusa o Documento se já existir). Liga o passo localizar_registro
// ao Documento. NÃO altera regras, motor, progresso, BlockingEngine nem avanço.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { TipoDocumento } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

const TIPOS = new Set(Object.values(TipoDocumento) as string[])

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const procId = Number(processoId)
    const body = await request.json().catch(() => ({}))
    const necessidadeId = Number(body?.necessidadeId)
    if (!procId || !necessidadeId) return NextResponse.json({ error: "processoId e necessidadeId são obrigatórios." }, { status: 400 })

    const nec = await prisma.necessidadeDocumental.findUnique({
      where: { id: necessidadeId },
      select: { id: true, processoId: true, pessoaId: true, itemCatalogoId: true },
    })
    if (!nec || nec.processoId !== procId) return NextResponse.json({ error: "Necessidade não encontrada neste processo." }, { status: 404 })
    if (!nec.pessoaId) return NextResponse.json({ error: "Necessidade sem pessoa (sujeito) — não é possível abrir a operação." }, { status: 400 })

    // tipo do documento a partir do itemCatalogo da necessidade (ponte legacyEnumKey)
    const tipoDoc = await prisma.tipoDocumentoCadastro.findFirst({
      where: { itemCatalogoId: nec.itemCatalogoId },
      select: { id: true, legacyEnumKey: true },
    })
    const tipoEnum = tipoDoc?.legacyEnumKey && TIPOS.has(tipoDoc.legacyEnumKey) ? (tipoDoc.legacyEnumKey as TipoDocumento) : null

    // idempotência: reusa o Documento já vinculado à necessidade
    const doc = await prisma.$transaction(async (tx) => {
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
      // liga o passo localizar_registro da necessidade ao Documento (para o editor
      // carregar o workflow por documentoId). Não altera status do passo.
      await tx.phaseWorkflowStepInstance.updateMany({
        where: { necessidadeId: nec.id, stepKey: "localizar_registro", documentoId: null },
        data: { documentoId: d.id },
      })
      return d
    })

    return NextResponse.json({ documentoId: doc.id })
  } catch (e) {
    console.error("POST genealogia/operacao", e)
    return NextResponse.json({ error: "Erro ao abrir a operação." }, { status: 500 })
  }
}
