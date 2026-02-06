// src/app/api/admin/mensagens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const processos = await prisma.processo.findMany({
      where: {
        mensagens: { some: {} }, // Só processos que têm mensagens
      },
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
            lidoPelaEquipe: true,
            usuarioId: true,
            clienteAuthId: true,
            usuario: { select: { nome: true } },
            clienteAuth: {
              select: {
                contratante: { select: { nome: true } },
                requerente: { select: { nome: true } },
              },
            },
          },
        },
        _count: {
          select: {
            mensagens: {
              where: {
                lidoPelaEquipe: false,
                usuarioId: null, // Só mensagens do cliente não lidas pela equipe
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const conversas = processos.map((p) => {
      const ultima = p.mensagens[0] || null;
      let remetente = 'Cliente';
      if (ultima) {
        if (ultima.usuarioId) {
          remetente = ultima.usuario?.nome || 'Equipe';
        } else if (ultima.clienteAuthId) {
          const auth = ultima.clienteAuth;
          remetente = auth?.contratante?.nome || auth?.requerente?.nome || 'Cliente';
        }
      }

      return {
        processoId: p.id,
        processoNome: p.nome,
        pais: p.pais,
        naoLidas: p._count.mensagens,
        ultimaMensagem: ultima
          ? {
              conteudo: ultima.conteudo,
              data: ultima.createdAt,
              remetente,
            }
          : null,
      };
    });

    // Ordenar: não lidas primeiro, depois por data
    conversas.sort((a, b) => {
      if (a.naoLidas > 0 && b.naoLidas === 0) return -1;
      if (a.naoLidas === 0 && b.naoLidas > 0) return 1;
      if (a.ultimaMensagem && b.ultimaMensagem) {
        return new Date(b.ultimaMensagem.data).getTime() - new Date(a.ultimaMensagem.data).getTime();
      }
      return 0;
    });

    return NextResponse.json({ conversas });
  } catch (error) {
    console.error('Erro ao listar conversas admin:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}