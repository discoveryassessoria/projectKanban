// app/api/app/gerar-acesso/route.ts
// Rota usada pelo sistema web para gerar acesso de um cliente ao app
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashSenha, gerarSenhaTemporaria } from '@/src/lib/app-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, contratanteId, requerenteId } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email é obrigatório' }, { status: 400 });
    }

    if (!contratanteId && !requerenteId) {
      return NextResponse.json(
        { error: 'Deve vincular a um contratante ou requerente' },
        { status: 400 }
      );
    }

    // Verificar se já existe acesso para este email
    const existente = await prisma.clienteAuth.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existente) {
      return NextResponse.json(
        { error: 'Já existe um acesso cadastrado para este email' },
        { status: 409 }
      );
    }

    // Gerar senha temporária
    const senhaTemporaria = gerarSenhaTemporaria();
    const senhaHash = await hashSenha(senhaTemporaria);

    // Criar acesso
    const clienteAuth = await prisma.clienteAuth.create({
      data: {
        email: email.toLowerCase().trim(),
        senhaHash,
        contratanteId: contratanteId || null,
        requerenteId: requerenteId || null,
        primeiroAcesso: true,
      },
    });

    return NextResponse.json({
      id: clienteAuth.id,
      email: clienteAuth.email,
      senhaTemporaria, // Mostrar para o admin copiar e enviar ao cliente
      message: `Acesso criado! Envie a senha temporária para o cliente: ${senhaTemporaria}`,
    });
  } catch (error) {
    console.error('Erro ao gerar acesso:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// Listar todos os acessos do app (para o admin gerenciar)
export async function GET() {
  try {
    const acessos = await prisma.clienteAuth.findMany({
      include: {
        contratante: { select: { id: true, nome: true } },
        requerente: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ acessos });
  } catch (error) {
    console.error('Erro ao listar acessos:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
