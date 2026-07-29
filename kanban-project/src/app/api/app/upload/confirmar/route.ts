import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

export async function POST(request: NextRequest) {
  const payload = extrairToken(request);
  if (!payload) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let body: {
    necessidadeId?: number;
    publicUrl?: string;
    filename?: string;
    size?: number;
    mimeType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { necessidadeId, publicUrl, filename, size, mimeType } = body;
  if (!necessidadeId || !publicUrl) {
    return NextResponse.json({ error: 'necessidadeId e publicUrl são obrigatórios' }, { status: 400 });
  }

  const necessidade = await prisma.necessidadeDocumental.findUnique({
    where: { id: necessidadeId },
    select: {
      id: true,
      pessoaId: true,
      documentos: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      processo: {
        select: {
          contratantes: { select: { contratanteId: true } },
          requerentes: { select: { requerenteId: true } },
        },
      },
    },
  });

  if (!necessidade || !necessidade.pessoaId) {
    return NextResponse.json({ error: 'Necessidade não encontrada' }, { status: 404 });
  }

  const temAcesso =
    (payload.contratanteId &&
      necessidade.processo.contratantes.some((c) => c.contratanteId === payload.contratanteId)) ||
    (payload.requerenteId &&
      necessidade.processo.requerentes.some((r) => r.requerenteId === payload.requerenteId));

  if (!temAcesso) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  const dadosArquivo = {
    arquivo_url: publicUrl,
    arquivo_nome: filename || null,
    arquivo_tamanho: size || null,
    arquivo_mime_type: mimeType || null,
  };

  const documentoExistente = necessidade.documentos[0];

  // Se já existe um documento pra essa necessidade, atualiza o arquivo dele.
  // Se ainda não existe (caso comum na Genealogia), cria um novo, marcado
  // como RECEBIDO — vira visível pra equipe conferir na Central Operacional,
  // sem inventar um mecanismo de arquivo paralelo ao que já existe.
  const documento = documentoExistente
    ? await prisma.documento.update({
        where: { id: documentoExistente.id },
        data: { ...dadosArquivo, status: 'RECEBIDO' },
      })
    : await prisma.documento.create({
        data: {
          pessoaId: necessidade.pessoaId,
          necessidadeId: necessidade.id,
          status: 'RECEBIDO',
          origem: 'cliente_app',
          ...dadosArquivo,
        },
      });

  return NextResponse.json({ documentoId: documento.id, status: documento.status });
}