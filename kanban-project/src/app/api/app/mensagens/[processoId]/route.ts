// src/app/api/app/mensagens/[processoId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { processoId: pid } = await params;
    const processoId = parseInt(pid);
    if (isNaN(processoId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const whereConditions: any[] = [];
    if (payload.contratanteId) {
      whereConditions.push({
        contratantes: { some: { contratanteId: payload.contratanteId } },
      });
    }
    if (payload.requerenteId) {
      whereConditions.push({
        requerentes: { some: { requerenteId: payload.requerenteId } },
      });
    }

    const processo = await prisma.processo.findFirst({
      where: {
        id: processoId,
        OR: whereConditions,
      },
      select: { id: true, nome: true },
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
        usuario: {
          select: { id: true, nome: true },
        },
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
        clienteAuthId: null,
        lidoPeloCliente: false,
      },
      data: { lidoPeloCliente: true },
    });

    const mensagensFormatadas = mensagens.map((m) => {
      const ehCliente = m.clienteAuthId !== null;
      const ehMeu = m.clienteAuthId === payload.clienteAuthId;
      let nomeRemetente = 'Equipe';

      if (ehCliente) {
        const auth = m.clienteAuth;
        nomeRemetente = auth?.contratante?.nome || auth?.requerente?.nome || 'Cliente';
      } else if (m.usuario) {
        nomeRemetente = m.usuario.nome;
      }

      return {
        id: m.id,
        conteudo: m.conteudo,
        data: m.createdAt,
        ehMeu,
        remetente: nomeRemetente,
        editadoEm: m.editadoEm,
      };
    });

    return NextResponse.json({
      processo: { id: processo.id, nome: processo.nome },
      mensagens: mensagensFormatadas,
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { processoId: pid } = await params;
    const processoId = parseInt(pid);
    if (isNaN(processoId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const { conteudo } = body;

    if (!conteudo || !conteudo.trim()) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    const whereConditions: any[] = [];
    if (payload.contratanteId) {
      whereConditions.push({
        contratantes: { some: { contratanteId: payload.contratanteId } },
      });
    }
    if (payload.requerenteId) {
      whereConditions.push({
        requerentes: { some: { requerenteId: payload.requerenteId } },
      });
    }

    const processo = await prisma.processo.findFirst({
      where: { id: processoId, OR: whereConditions },
      select: { id: true },
    });

    if (!processo) {
      return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 });
    }

    const mensagem = await prisma.mensagem.create({
      data: {
        processoId,
        conteudo: conteudo.trim(),
        clienteAuthId: payload.clienteAuthId,
        lidoPeloCliente: true,
        lidoPelaEquipe: false,
      },
    });

    return NextResponse.json({
      id: mensagem.id,
      conteudo: mensagem.conteudo,
      data: mensagem.createdAt,
      ehMeu: true,
      remetente: 'Você',
      editadoEm: null,
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}