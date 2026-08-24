// As divergências que a Análise marcou para retificação e que ainda NÃO estão num
// pedido aberto. É a lista de onde se agrupa — quem já está sendo tratado não aparece
// de novo, porque a mesma correção não pode ser pedida duas vezes.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { ESTADOS_ENCERRADOS } from "@/src/services/retificacao-canonica"

export async function GET(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  const { processoId } = await params
  const id = Number(processoId)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const divergencias = await prisma.divergencia.findMany({
    where: {
      analise: { processoId: id },
      status: "retificacao",
      pacotes: { none: { pacote: { status: { notIn: ESTADOS_ENCERRADOS } } } },
    },
    select: {
      id: true, campoLabel: true, pessoaNome: true, documentoTitulo: true,
      valorArvore: true, valorDocumento: true, severidade: true,
    },
    orderBy: { id: "asc" },
  })
  return NextResponse.json({ divergencias })
}
