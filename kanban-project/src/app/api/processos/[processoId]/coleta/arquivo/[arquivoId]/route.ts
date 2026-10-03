// GET /api/processos/[processoId]/coleta/arquivo/[arquivoId] — URL ASSINADA (curta) de leitura do arquivo
// privado de um envio. Só depois de autorizar (JWT + `clientes.criar`) e de conferir que o arquivo é
// DESTE processo. Devolve `{ url }`; o arquivo nunca tem endereço público antes da confirmação.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import { urlDeLeituraColeta } from "@/src/services/coleta/storage-coleta"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ processoId: string; arquivoId: string }> }) {
  const erro = await verificarPermissao(req, "clientes.criar")
  if (erro) return erro
  const { processoId: pid, arquivoId: aid } = await params
  const processoId = Number(pid)
  const arquivoId = Number(aid)
  if (!Number.isInteger(processoId) || !Number.isInteger(arquivoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const a = await prisma.coletaArquivo.findFirst({ where: { id: arquivoId, envio: { link: { processoId } } } })
  if (!a) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 })
  return NextResponse.json({ url: await urlDeLeituraColeta(a.chave, a.nome, a.mime) })
}
