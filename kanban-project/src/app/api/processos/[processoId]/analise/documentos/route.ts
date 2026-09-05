// src/app/api/processos/[processoId]/analise/documentos/route.ts
//
// ANEXAR UMA CERTIDÃO a uma pessoa da linha reta, pronta para a Análise Documental.
//
// ─── POR QUE ESTA ROTA EXISTE ───────────────────────────────────────────────
// A Análise Documental lê `Pessoa.documentos` (o modelo `Documento`). Sem uma porta
// que crie essa linha, o único jeito de uma certidão aparecer aqui era alguém
// escrever direto no banco. O arquivo em si já foi enviado ao R2 pelo presign
// (`/api/storage/presign` + `uploadFiles`); esta rota só registra a referência.
//
// NÃO faz upload, NÃO lê o conteúdo do arquivo, NÃO inventa dado nenhum — grava
// exatamente o que veio: pessoa, tipo (do catálogo fechado) e a URL do arquivo.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { TipoDocumento } from "@prisma/client"

const TIPOS_PERMITIDOS = new Set<string>([
  "CERTIDAO_NASCIMENTO", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
  "CERTIDAO_CASAMENTO", "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
  "CERTIDAO_OBITO", "CERTIDAO_OBITO_INTEIRO_TEOR",
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro

  const { processoId } = await params
  const id = Number(processoId)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as {
    pessoaId?: number; tipo?: string
    arquivoUrl?: string; arquivoNome?: string; arquivoMimeType?: string
  }

  if (!body.pessoaId || !Number.isInteger(body.pessoaId)) {
    return NextResponse.json({ error: "PESSOA_OBRIGATORIA", mensagem: "Escolha a pessoa." }, { status: 422 })
  }
  if (!body.tipo || !TIPOS_PERMITIDOS.has(body.tipo)) {
    return NextResponse.json({ error: "TIPO_INVALIDO", mensagem: "Escolha um tipo de certidão válido." }, { status: 422 })
  }
  if (!body.arquivoUrl) {
    return NextResponse.json({ error: "ARQUIVO_OBRIGATORIO", mensagem: "Envie o arquivo antes de salvar." }, { status: 422 })
  }

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  // A pessoa precisa ser desta árvore — não dá pra anexar certidão de gente de
  // outro processo por engano de payload.
  const pessoa = await prisma.pessoa.findFirst({
    where: { id: body.pessoaId, arvoreId: processo.arvoreId ?? -1 },
    select: { id: true },
  })
  if (!pessoa) return NextResponse.json({ error: "PESSOA_FORA_DA_ARVORE", mensagem: "Essa pessoa não pertence à árvore deste processo." }, { status: 422 })

  const documento = await prisma.documento.create({
    data: {
      pessoaId: pessoa.id,
      tipo: body.tipo as TipoDocumento,
      status: "RECEBIDO",
      dataStatus: "not_filled",
      analysisStatus: "pending",
      arquivo_url: body.arquivoUrl,
      arquivo_nome: body.arquivoNome ?? null,
      arquivo_mime_type: body.arquivoMimeType ?? null,
    },
    select: { id: true, tipo: true, arquivo_url: true },
  })

  return NextResponse.json({ ok: true, documento })
}
