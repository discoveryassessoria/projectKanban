// app/api/app/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

export async function GET(request: NextRequest) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const clienteAuth = await prisma.clienteAuth.findUnique({
      where: { id: payload.clienteAuthId },
      include: {
        contratante: {
          select: {
            id: true, nome: true, email: true, telefone: true, cpf: true,
            cidade: true, estado: true, pais: true,
          },
        },
        requerente: {
          select: {
            id: true, nome: true, email: true, telefone: true, cpf: true,
            cidade: true, estado: true, pais: true,
          },
        },
      },
    });

    if (!clienteAuth || !clienteAuth.ativo) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const perfil = clienteAuth.contratante || clienteAuth.requerente;

    return NextResponse.json({
      id: clienteAuth.id,
      email: clienteAuth.email,
      tipo: clienteAuth.contratanteId ? 'contratante' : 'requerente',
      perfil,
    });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
