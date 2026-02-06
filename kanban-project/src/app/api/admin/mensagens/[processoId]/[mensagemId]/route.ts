// src/app/api/admin/mensagens/[processoId]/[mensagemId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PATCH - Editar mensagem
export async function PATCH(
  request: NextRequest,
  { params }: { params: { processoId: string; mensagemId: string } }
) {
  try {
    const { mensagemId: mid } = await params;
    const mensagemId = parseInt(mid);
    if (isNaN(mensagemId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const { conteudo, usuarioId } = body;

    if (!conteudo || !conteudo.trim()) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    // Verificar se a mensagem existe e pertence ao usuário da equipe
    const mensagem = await prisma.mensagem.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
    }

    if (mensagem.usuarioId !== parseInt(usuarioId)) {
      return NextResponse.json({ error: 'Sem permissão para editar esta mensagem' }, { status: 403 });
    }

    const atualizada = await prisma.mensagem.update({
      where: { id: mensagemId },
      data: {
        conteudo: conteudo.trim(),
        editadoEm: new Date(),
      },
    });

    return NextResponse.json({ ok: true, mensagem: atualizada });
  } catch (error) {
    console.error('Erro ao editar mensagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE - Apagar mensagem
export async function DELETE(
  request: NextRequest,
  { params }: { params: { processoId: string; mensagemId: string } }
) {
  try {
    const { mensagemId: mid } = await params;
    const mensagemId = parseInt(mid);
    if (isNaN(mensagemId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const usuarioId = searchParams.get('usuarioId');

    const mensagem = await prisma.mensagem.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
    }

    // Equipe pode apagar suas próprias mensagens
    if (mensagem.usuarioId !== parseInt(usuarioId || '0')) {
      return NextResponse.json({ error: 'Sem permissão para apagar esta mensagem' }, { status: 403 });
    }

    await prisma.mensagem.delete({ where: { id: mensagemId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar mensagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}