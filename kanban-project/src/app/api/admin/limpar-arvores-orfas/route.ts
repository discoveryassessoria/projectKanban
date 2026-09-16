// ESTE ARQUIVO VAI EM: src/app/api/admin/limpar-arvores-orfas/route.ts
// API para limpar árvores que não estão vinculadas a nenhum processo

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { exigirPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { FRASE_CONFIRMACAO } from "@/src/services/exclusao-definitiva"
import { limparArvoreOrfaAposExclusaoDeProcesso } from "@/src/services/pessoa-ciclo-vida"

// GET - Listar árvores órfãs (preview antes de deletar)
export async function GET(request: NextRequest) {
  const { erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
  try {
    // Buscar todas as árvores que NÃO estão vinculadas a nenhum processo
    const arvoresOrfas = await prisma.arvore.findMany({
      where: {
        processos: {
          none: {},
        },
      },
      include: {
        _count: {
          select: {
            pessoas: true,
          },
        },
      },
    })

    return NextResponse.json({
      total: arvoresOrfas.length,
      arvores: arvoresOrfas.map((a) => ({
        id: a.id,
        nome: a.nome,
        descricao: a.descricao,
        totalPessoas: a._count.pessoas,
      })),
    })
  } catch (error) {
    console.error("Erro ao buscar árvores órfãs:", error)
    return NextResponse.json({ error: "Erro ao buscar árvores órfãs" }, { status: 500 })
  }
}

// DELETE - Deletar todas as árvores órfãs
export async function DELETE(request: NextRequest) {
  // 🔒 Achado real (corrigido 15/09/2026): esta rota apagava em massa via
  // `prisma.arvore.deleteMany()` cru — cascade de pessoas, uniões e documentos
  // sem nenhuma cadeia canônica por trás. A permissão exclusiva e a frase de
  // confirmação abaixo continuam valendo; o guard real é `limparArvoreOrfaApos
  // ExclusaoDeProcesso`, o MESMO usado por `DELETE /api/processos/[id]` —
  // aplicado árvore por árvore, nunca um `deleteMany` cru.
  //
  // Desde 16/09/2026 essa função força o HARD delete mesmo com fato histórico
  // protegido (decisão explícita do usuário: "apaga tudo, não pode sobrar
  // nada") — só fica de fora árvore com processo ainda vivo apontando pra ela.
  const { erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (String((body as { confirmacao?: string })?.confirmacao ?? "").trim() !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ error: `Confirmação inválida. Envie { "confirmacao": "${FRASE_CONFIRMACAO}" } no corpo.` }, { status: 400 })
  }
  try {
    const arvoresOrfas = await prisma.arvore.findMany({
      where: { processos: { none: {} } },
      select: { id: true, nome: true },
    })

    if (arvoresOrfas.length === 0) {
      return NextResponse.json({ success: true, message: "Nenhuma árvore órfã encontrada", deletadas: 0 })
    }

    const actorUserId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    const removidas: { id: number; nome: string }[] = []
    const bloqueadas: { id: number; nome: string; motivo: string | undefined }[] = []
    for (const a of arvoresOrfas) {
      const r = await limparArvoreOrfaAposExclusaoDeProcesso(a.id, actorUserId)
      if (r?.removida) removidas.push({ id: a.id, nome: a.nome })
      else bloqueadas.push({ id: a.id, nome: a.nome, motivo: r?.motivoNaoRemovida })
    }

    console.log(`Limpeza de árvores órfãs: ${removidas.length} removida(s), ${bloqueadas.length} bloqueada(s)`)

    return NextResponse.json({
      success: true,
      message: `${removidas.length} árvore(s) órfã(s) removida(s)` +
        (bloqueadas.length ? ` · ${bloqueadas.length} ainda com processo vivo ou falha na remoção (não removidas)` : ""),
      deletadas: removidas.length,
      arvoresRemovidas: removidas,
      arvoresBloqueadas: bloqueadas,
    })
  } catch (error) {
    console.error("Erro ao limpar árvores órfãs:", error)
    return NextResponse.json({ error: "Erro ao limpar árvores órfãs" }, { status: 500 })
  }
}