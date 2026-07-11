// lib/app-auth.ts
// Utilitário de autenticação para o app mobile
// INSTALAR: npm install jsonwebtoken bcryptjs
// INSTALAR: npm install -D @types/jsonwebtoken @types/bcryptjs

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { NextRequest } from 'next/server';

// CP-SEC — segredo OBRIGATÓRIO, sem fallback inseguro.
// Getter lazy: não avalia no import (senão o `next build`, que importa o
// módulo, quebraria em ambientes sem env). Lança apenas quando um token é
// realmente assinado/verificado, garantindo falha controlada (fail-closed).
function getAppSecret(): string {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'APP_JWT_SECRET não definido. Defina uma string longa e aleatória (>=32 chars).'
    );
  }
  if (secret.length < 32) {
    throw new Error('APP_JWT_SECRET deve ter pelo menos 32 caracteres.');
  }
  return secret;
}

export interface AppTokenPayload {
  clienteAuthId: number;
  email: string;
  contratanteId?: number;
  requerenteId?: number;
  nome: string;
}

// Gerar token JWT
export function gerarToken(payload: AppTokenPayload): string {
  return jwt.sign(payload, getAppSecret(), { expiresIn: '30d' });
}

// Verificar token JWT
export function verificarToken(token: string): AppTokenPayload | null {
  try {
    return jwt.verify(token, getAppSecret()) as AppTokenPayload;
  } catch {
    return null;
  }
}

// Extrair token do header Authorization
export function extrairToken(request: NextRequest): AppTokenPayload | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const token = authHeader.substring(7);
  return verificarToken(token);
}

// Hash de senha
export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}

// Verificar senha
export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

// Gerar senha temporária (10 caracteres alfanuméricos, CSPRNG)
// CP-SEC — usa crypto.randomInt em vez de Math.random (não-criptográfico).
export function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < 10; i++) {
    senha += chars.charAt(randomInt(chars.length));
  }
  return senha;
}
