// app/api/app/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarSenha, gerarToken, hashSenha } from '@/src/lib/app-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, senha, novaSenha } = await request.json();

    if (!email || !senha) {
      return NextResponse.json(
        { error: 'Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    // Buscar ClienteAuth pelo email
    const clienteAuth = await prisma.clienteAuth.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        contratante: true,
        requerente: true,
      },
    });

    if (!clienteAuth) {
      return NextResponse.json(
        { error: 'Email ou senha incorretos' },
        { status: 401 }
      );
    }

    if (!clienteAuth.ativo) {
      return NextResponse.json(
        { error: 'Acesso desativado. Entre em contato com o escritório.' },
        { status: 403 }
      );
    }

    // Verificar senha
    const senhaCorreta = await verificarSenha(senha, clienteAuth.senhaHash);
    if (!senhaCorreta) {
      return NextResponse.json(
        { error: 'Email ou senha incorretos' },
        { status: 401 }
      );
    }

    // Se é primeiro acesso e veio nova senha, trocar
    if (clienteAuth.primeiroAcesso) {
      if (!novaSenha) {
        return NextResponse.json(
          { primeiroAcesso: true, message: 'Defina uma nova senha para continuar' },
          { status: 200 }
        );
      }
      
      if (novaSenha.length < 6) {
        return NextResponse.json(
          { error: 'A nova senha deve ter pelo menos 6 caracteres' },
          { status: 400 }
        );
      }

      await prisma.clienteAuth.update({
        where: { id: clienteAuth.id },
        data: {
          senhaHash: await hashSenha(novaSenha),
          primeiroAcesso: false,
          ultimoLogin: new Date(),
        },
      });
    } else {
      // Atualizar último login
      await prisma.clienteAuth.update({
        where: { id: clienteAuth.id },
        data: { ultimoLogin: new Date() },
      });
    }

    // Determinar nome do cliente
    const nome = clienteAuth.contratante?.nome || clienteAuth.requerente?.nome || 'Cliente';

    // Gerar token
    const token = gerarToken({
      clienteAuthId: clienteAuth.id,
      email: clienteAuth.email,
      contratanteId: clienteAuth.contratanteId ?? undefined,
      requerenteId: clienteAuth.requerenteId ?? undefined,
      nome,
    });

    return NextResponse.json({
      token,
      usuario: {
        id: clienteAuth.id,
        nome,
        email: clienteAuth.email,
        tipo: clienteAuth.contratanteId ? 'contratante' : 'requerente',
      },
    });
  } catch (error) {
    console.error('Erro no login do app:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
