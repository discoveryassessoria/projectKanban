import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { prepararEnvioDeAnexo, BucketPrivadoNaoConfigurado } from '@/src/lib/anexos/storage';
import { extrairToken } from '@/src/lib/app-auth';

const MAX_SIZE = 20 * 1024 * 1024; // 20MB — documento de cliente, sem motivo pra mais
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);


export async function POST(request: NextRequest) {
  const payload = extrairToken(request);
  if (!payload) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let body: { necessidadeId?: number; filename?: string; contentType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { necessidadeId, filename, contentType, size } = body;

  if (!necessidadeId || !filename || !contentType || typeof size !== 'number') {
    return NextResponse.json(
      { error: 'necessidadeId, filename, contentType e size são obrigatórios' },
      { status: 400 }
    );
  }
  if (size <= 0 || size > MAX_SIZE) {
    return NextResponse.json(
      { error: `Tamanho inválido. Limite: ${MAX_SIZE / 1024 / 1024}MB` },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: `Tipo não permitido: ${contentType}` }, { status: 400 });
  }

  // Confirma que a necessidade pertence a um PROCESSO DO PRÓPRIO CLIENTE.
  // Sem isso, qualquer cliente logado poderia gerar link de upload pra
  // qualquer necessidade do sistema, de qualquer processo.
  const necessidade = await prisma.necessidadeDocumental.findUnique({
    where: { id: necessidadeId },
    select: {
      id: true,
      processo: {
        select: {
          id: true,
          contratantes: { select: { contratanteId: true } },
          requerentes: { select: { requerenteId: true } },
        },
      },
    },
  });

  if (!necessidade) {
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

  // O arquivo do cliente vai para o bucket PRIVADO, na pasta do processo (a equipe abre pela porta de anexos, com permissão de processos).
  // `publicUrl` devolve a CHAVE (campo mantido por compatibilidade): nunca há endereço público.
  try {
    const { chave, uploadUrl } = await prepararEnvioDeAnexo({ alvo: { dominio: 'processo', id: necessidade.processo.id }, nome: filename, tipo: contentType, tamanho: size });
    return NextResponse.json({ uploadUrl, publicUrl: chave, key: chave });
  } catch (err) {
    if (err instanceof BucketPrivadoNaoConfigurado) {
      console.error('[/api/app/upload/presign]', err.message);
      return NextResponse.json({ error: 'Armazenamento privado indisponível. Tente novamente mais tarde.' }, { status: 503 });
    }
    console.error('[/api/app/upload/presign] erro:', err);
    return NextResponse.json({ error: 'Erro ao gerar URL de upload' }, { status: 500 });
  }
}
