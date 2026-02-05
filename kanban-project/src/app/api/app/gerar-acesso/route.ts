// app/api/app/gerar-acesso/route.ts
// Rota usada pelo sistema web para gerar/gerenciar acesso de clientes ao app
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashSenha, gerarSenhaTemporaria } from '@/src/lib/app-auth';

// GET - Verificar se um cliente já tem acesso ao app
// Query params: tipo (contratante|requerente) + id (número)
// Ou sem params: lista todos os acessos
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo');
    const id = searchParams.get('id');

    // Se passou tipo e id, busca acesso específico do cliente
    if (tipo && id) {
      const where = tipo === 'requerente'
        ? { requerenteId: parseInt(id) }
        : { contratanteId: parseInt(id) };

      const acesso = await prisma.clienteAuth.findFirst({
        where,
        select: {
          id: true,
          email: true,
          primeiroAcesso: true,
          ativo: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!acesso) {
        return NextResponse.json({ temAcesso: false });
      }

      return NextResponse.json({
        temAcesso: true,
        acesso: {
          id: acesso.id,
          email: acesso.email,
          primeiroAcesso: acesso.primeiroAcesso,
          ativo: acesso.ativo,
          criadoEm: acesso.createdAt,
          atualizadoEm: acesso.updatedAt,
        },
      });
    }

    // Sem params: listar todos os acessos
    const acessos = await prisma.clienteAuth.findMany({
      include: {
        contratante: { select: { id: true, nome: true } },
        requerente: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ acessos });
  } catch (error) {
    console.error('Erro ao verificar acesso:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST - Gerar novo acesso
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

    // Verificar se já existe acesso para este cliente (por ID)
    const whereCliente = requerenteId
      ? { requerenteId: parseInt(requerenteId) }
      : { contratanteId: parseInt(contratanteId) };

    const acessoCliente = await prisma.clienteAuth.findFirst({
      where: whereCliente,
    });

    if (acessoCliente) {
      return NextResponse.json(
        { error: 'Este cliente já possui acesso ao app com outro email' },
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
        contratanteId: contratanteId ? parseInt(contratanteId) : null,
        requerenteId: requerenteId ? parseInt(requerenteId) : null,
        primeiroAcesso: true,
      },
    });

    return NextResponse.json({
      id: clienteAuth.id,
      email: clienteAuth.email,
      senhaTemporaria,
      message: `Acesso criado! Envie a senha temporária para o cliente: ${senhaTemporaria}`,
    });
  } catch (error) {
    console.error('Erro ao gerar acesso:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT - Resetar senha de um acesso existente
export async function PUT(request: NextRequest) {
  try {
    const { acessoId } = await request.json();

    if (!acessoId) {
      return NextResponse.json({ error: 'ID do acesso é obrigatório' }, { status: 400 });
    }

    const acesso = await prisma.clienteAuth.findUnique({
      where: { id: parseInt(acessoId) },
    });

    if (!acesso) {
      return NextResponse.json({ error: 'Acesso não encontrado' }, { status: 404 });
    }

    // Gerar nova senha temporária
    const senhaTemporaria = gerarSenhaTemporaria();
    const senhaHash = await hashSenha(senhaTemporaria);

    await prisma.clienteAuth.update({
      where: { id: parseInt(acessoId) },
      data: {
        senhaHash,
        primeiroAcesso: true,
      },
    });

    return NextResponse.json({
      senhaTemporaria,
      message: `Senha resetada! Nova senha temporária: ${senhaTemporaria}`,
    });
  } catch (error) {
    console.error('Erro ao resetar senha:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE - Revogar acesso
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const acessoId = searchParams.get('id');

    if (!acessoId) {
      return NextResponse.json({ error: 'ID do acesso é obrigatório' }, { status: 400 });
    }

    await prisma.clienteAuth.delete({
      where: { id: parseInt(acessoId) },
    });

    return NextResponse.json({ message: 'Acesso revogado com sucesso' });
  } catch (error) {
    console.error('Erro ao revogar acesso:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}