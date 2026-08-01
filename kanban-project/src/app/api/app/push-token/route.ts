import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

const PREFIXO_EXPO = 'ExponentPushToken[';

export async function POST(request: NextRequest) {
  const payload = extrairToken(request);
  if (!payload) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let body: { expoPushToken?: unknown; plataforma?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { expoPushToken, plataforma } = body;

  if (typeof expoPushToken !== 'string' || expoPushToken.trim() === '') {
    return NextResponse.json({ error: 'expoPushToken é obrigatório' }, { status: 400 });
  }

  const token = expoPushToken.trim();
  if (!token.startsWith(PREFIXO_EXPO) || !token.endsWith(']')) {
    return NextResponse.json({ error: 'expoPushToken inválido' }, { status: 400 });
  }

  // Só aceita os dois valores que o app envia; qualquer outra coisa vira null
  // em vez de 400 — plataforma é acessório e não vale derrubar o registro.
  const plataformaNormalizada =
    plataforma === 'ios' || plataforma === 'android' ? plataforma : null;

  // Upsert PELO TOKEN, não pelo cliente: o mesmo aparelho pode ser relogado com
  // outra conta (reinstalação, troca de usuário). Nesse caso a linha existente
  // passa a apontar para o clienteAuthId autenticado agora, o que impede que o
  // dono anterior continue recebendo push nesse dispositivo.
  await prisma.dispositivoPush.upsert({
    where: { expoPushToken: token },
    update: {
      clienteAuthId: payload.clienteAuthId,
      plataforma: plataformaNormalizada,
    },
    create: {
      clienteAuthId: payload.clienteAuthId,
      expoPushToken: token,
      plataforma: plataformaNormalizada,
    },
  });

  return NextResponse.json({ sucesso: true });
}
