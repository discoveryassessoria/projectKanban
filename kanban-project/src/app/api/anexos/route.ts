import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { exigirPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { excluirAnexos } from "@/src/services/anexos-exclusao"
import { promoverRascunhoDeAnexo } from "@/src/lib/anexos/storage"
import { leituraDoValor, alvoDaChave } from "@/src/lib/anexos/chave"

// POST - Salvar anexo
export async function POST(request: NextRequest) {
  try {
    // Login + permissão sobre o cadastro do cliente (criar ou editar). Sem login 401; sem permissão 403.
    const usuarioLogado = await extrairUsuarioComPermissoes(request)
    if (!usuarioLogado) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    if (usuarioLogado.permissoes["clientes.editar"] !== true && usuarioLogado.permissoes["clientes.criar"] !== true) {
      return NextResponse.json({ error: "Sem permissão para esta ação", permissao: "clientes.editar" }, { status: 403 })
    }
    const body = await request.json()
    const { nome, nomeArquivo, urlArquivo: urlArquivoRecebido, tamanho, mimeType, tipoCliente, contratanteId, requerenteId, categoria } = body

    if (!urlArquivoRecebido || !nomeArquivo) {
      return NextResponse.json({ error: "Dados do arquivo são obrigatórios" }, { status: 400 })
    }

    // Anexo que nasceu como RASCUNHO (cliente ainda não salvo) é promovido para a pasta do dono definitivo — só assim a equipe com permissão
    // sobre o cliente consegue abri-lo (a chave de rascunho só abre para quem enviou).
    let urlArquivo = urlArquivoRecebido as string
    const ehRascunho = leituraDoValor(urlArquivo).tipo === "chave" && alvoDaChave(urlArquivo)?.dominio === "rascunho"
    if (ehRascunho) {
      const usuario = usuarioLogado
      const dono = tipoCliente === "requerente" && requerenteId
        ? { dominio: "requerente" as const, id: parseInt(requerenteId) }
        : { dominio: "contratante" as const, id: parseInt(contratanteId) }
      if (!Number.isInteger(dono.id)) return NextResponse.json({ error: "ID do cliente é obrigatório" }, { status: 400 })
      urlArquivo = await promoverRascunhoDeAnexo(urlArquivo, dono, usuario.userId, nomeArquivo)
    } else if (leituraDoValor(urlArquivo).tipo === "chave") {
      // Chave já definitiva: só pode ser gravada na linha do dono que a chave nomeia (ninguém "cola" o anexo de outro cliente no seu).
      const alvo = alvoDaChave(urlArquivo)
      const donoEsperado = tipoCliente === "requerente" && requerenteId ? { dominio: "requerente", id: parseInt(requerenteId) } : { dominio: "contratante", id: parseInt(contratanteId) }
      if (!alvo || alvo.dominio !== donoEsperado.dominio || alvo.id !== donoEsperado.id) {
        return NextResponse.json({ error: "Arquivo não pertence a este cliente" }, { status: 403 })
      }
    }

    let anexo

    if (tipoCliente === "requerente" && requerenteId) {
      anexo = await prisma.anexoRequerente.create({
        data: {
          nome: nome || nomeArquivo,
          nomeArquivo,
          urlArquivo,
          tamanho: tamanho || null,
          mimeType: mimeType || null,
          tipo: "Documento",
          requerenteId: parseInt(requerenteId),
          categoria: categoria || null,
        },
      })
    } else if (contratanteId) {
      anexo = await prisma.anexoContratante.create({
        data: {
          nome: nome || nomeArquivo,
          nomeArquivo,
          urlArquivo,
          tamanho: tamanho || null,
          mimeType: mimeType || null,
          tipo: "Documento",
          contratanteId: parseInt(contratanteId),
          categoria: categoria || null,
        },
      })
    } else {
      return NextResponse.json({ error: "ID do cliente é obrigatório" }, { status: 400 })
    }

    return NextResponse.json({ anexo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao salvar anexo:", error)
    return NextResponse.json({ error: "Erro ao salvar anexo" }, { status: 500 })
  }
}

// GET - Buscar anexos por cliente
export async function GET(request: NextRequest) {
  try {
    const { erro } = await exigirPermissao(request, "clientes.ver")
    if (erro) return erro
    const { searchParams } = new URL(request.url)
    const tipoCliente = searchParams.get("tipoCliente")
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 })
    }

    let anexos

    if (tipoCliente === "requerente") {
      anexos = await prisma.anexoRequerente.findMany({
        where: { requerenteId: parseInt(id) },
        orderBy: { createdAt: "desc" },
      })
    } else {
      anexos = await prisma.anexoContratante.findMany({
        where: { contratanteId: parseInt(id) },
        orderBy: { createdAt: "desc" },
      })
    }

    return NextResponse.json({ anexos })
  } catch (error) {
    console.error("Erro ao buscar anexos:", error)
    return NextResponse.json({ error: "Erro ao buscar anexos" }, { status: 500 })
  }
}

// DELETE - Excluir anexo (login + clientes.editar; linha + auditoria numa transação, objeto apagado DEPOIS do commit)
export async function DELETE(request: NextRequest) {
  try {
    const { usuario, erro } = await exigirPermissao(request, "clientes.editar")
    if (erro) return erro

    const { searchParams } = new URL(request.url)
    const tipoCliente = searchParams.get("tipoCliente")
    const id = parseInt(searchParams.get("id") ?? "")

    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 })
    }

    const r = await excluirAnexos({
      tabela: tipoCliente === "requerente" ? "AnexoRequerente" : "AnexoContratante",
      ids: [id],
      usuarioId: usuario.userId,
    })
    if (r.excluidos === 0) return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 })

    return NextResponse.json({ success: true, arquivosNaoApagados: r.falhas.length })
  } catch (error) {
    console.error("Erro ao excluir anexo:", error)
    return NextResponse.json({ error: "Erro ao excluir anexo" }, { status: 500 })
  }
}
