// src/app/api/admin/mensagens/[processoId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { processoId: string } }
) {
  try {
    const { processoId: pid } = await params;
    const processoId = parseInt(pid);
    if (isNaN(processoId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, nome: true, pais: true },
    });

    if (!processo) {
      return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 });
    }

    const mensagens = await prisma.mensagem.findMany({
      where: { processoId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        conteudo: true,
        createdAt: true,
        usuarioId: true,
        clienteAuthId: true,
        editadoEm: true,
        usuario: { select: { id: true, nome: true } },
        clienteAuth: {
          select: {
            id: true,
            contratante: { select: { nome: true } },
            requerente: { select: { nome: true } },
          },
        },
      },
    });

    await prisma.mensagem.updateMany({
      where: {
        processoId,
        usuarioId: null,
        lidoPelaEquipe: false,
      },
      data: { lidoPelaEquipe: true },
    });

    const mensagensFormatadas = mensagens.map((m) => {
      const ehEquipe = m.usuarioId !== null;
      let nomeRemetente = 'Cliente';

      if (ehEquipe) {
        nomeRemetente = m.usuario?.nome || 'Equipe';
      } else if (m.clienteAuth) {
        nomeRemetente = m.clienteAuth.contratante?.nome || m.clienteAuth.requerente?.nome || 'Cliente';
      }

      return {
        id: m.id,
        conteudo: m.conteudo,
        data: m.createdAt,
        ehEquipe,
        remetente: nomeRemetente,
        editadoEm: m.editadoEm,
        usuarioId: m.usuarioId,
      };
    });

    return NextResponse.json({
      processo,
      mensagens: mensagensFormatadas,
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens admin:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { processoId: string } }
) {
  try {
    const { processoId: pid } = await params;
    const processoId = parseInt(pid);
    if (isNaN(processoId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const { conteudo, usuarioId } = body;

    if (!conteudo || !conteudo.trim()) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    if (!usuarioId) {
      return NextResponse.json({ error: 'usuarioId obrigatório' }, { status: 400 });
    }

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true },
    });

    if (!processo) {
      return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 });
    }

    const mensagem = await prisma.mensagem.create({
      data: {
        processoId,
        conteudo: conteudo.trim(),
        usuarioId: parseInt(usuarioId),
        lidoPelaEquipe: true,
        lidoPeloCliente: false,
      },
      include: {
        usuario: { select: { nome: true } },
      },
    });

    return NextResponse.json({
      id: mensagem.id,
      conteudo: mensagem.conteudo,
      data: mensagem.createdAt,
      ehEquipe: true,
      remetente: mensagem.usuario?.nome || 'Equipe',
      editadoEm: null,
      usuarioId: mensagem.usuarioId,
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem admin:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}