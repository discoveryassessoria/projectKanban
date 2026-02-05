// lib/app-auth.ts
// Utilitário de autenticação para o app mobile
// INSTALAR: npm install jsonwebtoken bcryptjs
// INSTALAR: npm install -D @types/jsonwebtoken @types/bcryptjs

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

const JWT_SECRET = process.env.APP_JWT_SECRET || 'discovery-app-secret-change-this';

export interface AppTokenPayload {
  clienteAuthId: number;
  email: string;
  contratanteId?: number;
  requerenteId?: number;
  nome: string;
}

// Gerar token JWT
export function gerarToken(payload: AppTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

// Verificar token JWT
export function verificarToken(token: string): AppTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AppTokenPayload;
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

// Gerar senha temporária (6 caracteres alfanuméricos)
export function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < 6; i++) {
    senha += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return senha;
}
