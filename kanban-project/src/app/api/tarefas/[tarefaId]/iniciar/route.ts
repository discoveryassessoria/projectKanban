// src/app/api/tarefas/[tarefaId]/iniciar/route.ts
// ============================================================================
// CASCA FINA — inicia a tarefa pela porta canônica e mais nada.
//
// Esta rota tinha dois caminhos: com runtime v2, delegava ao motor; sem ele,
// escrevia `prisma.tarefa.update` direto e o passo ficava para trás. Iniciar
// pelo mesmo botão produzia históricos diferentes conforme uma flag.
//
// Hoje há um caminho só: `iniciarTarefa` (camada de tarefa), que registra o
// início do trabalho e delega a transição do PASSO ao dono dela.
//
// O prazo NÃO é decidido aqui. Ele vem do SLA das etapas obrigatórias do
// workflow publicado — deixar a tela mandar um número no corpo do POST era
// permitir que quem executa escolhesse o próprio prazo.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { iniciarTarefa } from "@/lib/operacional/tarefa-comandos"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.iniciar_concluir')
    if (erro) return erro

    const { tarefaId } = await params
    const id = parseInt(tarefaId)
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const tarefa = await prisma.tarefa.findUnique({
      where: { id },
      select: { id: true, responsavelId: true },
    })
    if (!tarefa) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
    }

    // 🔒 E4 — só o dono (ou admin) inicia esta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
    if (negado) return negado

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

    const r = await iniciarTarefa({
      tarefaId: id,
      autorId: usuario.userId,
      permiteDeTerceiro: usuario.tipo === 'admin',
    })
    if (!r.ok) {
      return NextResponse.json({ error: r.mensagem, codigo: r.codigo }, { status: r.codigo === 'NAO_ENCONTRADA' ? 404 : 409 })
    }
    return NextResponse.json({ tarefaId: r.tarefaId })
  } catch (error) {
    console.error("Erro ao iniciar tarefa:", error)
    return NextResponse.json({ error: "Erro ao iniciar tarefa" }, { status: 500 })
  }
}
