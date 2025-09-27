import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ atividadeId: string }> }
) {
  try {
    const { atividadeId } = await params;
    const body = await request.json();
    const { statusId } = body;

    if (statusId === undefined || statusId === null) {
      return NextResponse.json(
        { error: 'O ID do status é obrigatório' },
        { status: 400 }
      );
    }

    const parsedStatusId = parseInt(statusId, 10);

    if (isNaN(parsedStatusId)) {
      return NextResponse.json(
        { error: `O ID do status é inválido: ${statusId}` },
        { status: 400 }
      );
    }

    const atividadeAtualizada = await prisma.atividade.update({
      where: {
        id: parseInt(atividadeId),
      },
      data: {
        statusId: parsedStatusId,
      },
    });

    return NextResponse.json({ atividade: atividadeAtualizada }, { status: 200 });
  } catch (error) {
    console.error('Erro ao atualizar atividade:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor ao atualizar atividade' },
      { status: 500 }
    );
  }
}
