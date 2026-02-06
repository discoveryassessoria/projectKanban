// src/app/api/app/mensagens/route.ts
// Lista as conversas (processos) do cliente com última mensagem e contagem de não lidas
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

export async function GET(request: NextRequest) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Buscar processos onde o cliente está vinculado
    const whereConditions: any[] = [];

    if (payload.contratanteId) {
      whereConditions.push({
        contratantes: {
          some: { contratanteId: payload.contratanteId },
        },
      });
    }

    if (payload.requerenteId) {
      whereConditions.push({
        requerentes: {
          some: { requerenteId: payload.requerenteId },
        },
      });
    }

    if (whereConditions.length === 0) {
      return NextResponse.json({ conversas: [] });
    }

    const processos = await prisma.processo.findMany({
      where: { OR: whereConditions },
      select: {
        id: true,
        nome: true,
        pais: true,
        mensagens: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            conteudo: true,
            createdAt: true,
            lidoPeloCliente: true,
            usuarioId: true,
            clienteAuthId: true,
            usuario: {
              select: { nome: true },
            },
          },
        },
        _count: {
          select: {
            mensagens: {
              where: {
                lidoPeloCliente: false,
                clienteAuthId: null, // Só conta as da equipe (não lidas pelo cliente)
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const conversas = processos.map((p) => {
      const ultimaMensagem = p.mensagens[0] || null;
      return {
        processoId: p.id,
        processoNome: p.nome,
        pais: p.pais,
        naoLidas: p._count.mensagens,
        ultimaMensagem: ultimaMensagem
          ? {
              conteudo: ultimaMensagem.conteudo,
              data: ultimaMensagem.createdAt,
              remetente: ultimaMensagem.clienteAuthId
                ? 'Você'
                : ultimaMensagem.usuario?.nome || 'Equipe',
            }
          : null,
      };
    });

    // Ordenar: conversas com mensagens primeiro, depois por data
    conversas.sort((a, b) => {
      if (a.ultimaMensagem && !b.ultimaMensagem) return -1;
      if (!a.ultimaMensagem && b.ultimaMensagem) return 1;
      if (a.ultimaMensagem && b.ultimaMensagem) {
        return new Date(b.ultimaMensagem.data).getTime() - new Date(a.ultimaMensagem.data).getTime();
      }
      return 0;
    });

    return NextResponse.json({ conversas });
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}