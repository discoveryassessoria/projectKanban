import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nome, statusId, projetoId } = body;

    if (!nome || !statusId || !projetoId) {
      return NextResponse.json(
        { error: 'Nome, statusId e projetoId são obrigatórios' },
        { status: 400 }
      );
    }

    const novaAtividade = await prisma.atividade.create({
      data: {
        nome,
        statusId,
        projetoId,
      },
      include: {
        status: true, // Include related status
      },
    });

    return NextResponse.json({ atividade: novaAtividade }, { status: 201 });

  } catch (error) {
    console.error('Erro ao criar atividade:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor ao criar atividade' },
      { status: 500 }
    );
  }
}
