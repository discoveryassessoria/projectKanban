// src/app/api/app/mensagens/[processoId]/[mensagemId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
// CP-SEC — usa a verificação REAL de assinatura (app-auth) em vez do
// decoder inline que apenas fazia base64 do payload (forjável).
import { extrairToken } from '@/src/lib/app-auth';

// PATCH - Cliente edita sua própria mensagem
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; mensagemId: string }> }
) {
  try {
    const payload = extrairToken(request);
    if (!payload?.clienteAuthId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { mensagemId: mid } = await params;
    const mensagemId = parseInt(mid);
    if (isNaN(mensagemId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const { conteudo } = body;

    if (!conteudo || !conteudo.trim()) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    const mensagem = await prisma.mensagem.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
    }

    if (mensagem.clienteAuthId !== payload.clienteAuthId) {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    const atualizada = await prisma.mensagem.update({
      where: { id: mensagemId },
      data: {
        conteudo: conteudo.trim(),
        editadoEm: new Date(),
      },
    });

    return NextResponse.json({ ok: true, mensagem: atualizada });
  } catch (error) {
    console.error('Erro ao editar mensagem (app):', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE - Cliente apaga sua própria mensagem
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; mensagemId: string }> }
) {
  try {
    const payload = extrairToken(request);
    if (!payload?.clienteAuthId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { mensagemId: mid } = await params;
    const mensagemId = parseInt(mid);
    if (isNaN(mensagemId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const mensagem = await prisma.mensagem.findUnique({
      where: { id: mensagemId },
    });

    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
    }

    if (mensagem.clienteAuthId !== payload.clienteAuthId) {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    await prisma.mensagem.delete({ where: { id: mensagemId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar mensagem (app):', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}