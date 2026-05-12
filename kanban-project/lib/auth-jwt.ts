// lib/auth-jwt.ts
// Helper centralizado pra assinar/verificar tokens JWT.
//
// Usa `jose` em vez de `jsonwebtoken` porque o middleware do Next roda em
// Edge Runtime, e `jsonwebtoken` não funciona lá (usa APIs Node-only).
// `jose` funciona tanto em Edge quanto em Node.
//
// Algoritmo: HS256 (HMAC + SHA-256). Suficiente pra autenticação interna
// onde o mesmo serviço assina e verifica.
//
// Variável de ambiente exigida: JWT_SECRET (string longa e aleatória,
// idealmente 64+ caracteres).

import { SignJWT, jwtVerify } from 'jose'

// Cache do TextEncoder.encode(secret) pra não recodificar a cada chamada
let _secretKey: Uint8Array | null = null

function getSecretKey(): Uint8Array {
  if (_secretKey) return _secretKey
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'JWT_SECRET não definido no .env. Defina uma string longa e aleatória.'
    )
  }
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET deve ter pelo menos 32 caracteres pra ser seguro.'
    )
  }
  _secretKey = new TextEncoder().encode(secret)
  return _secretKey
}

export interface AuthTokenPayload {
  userId: number
  email: string
  tipo: string
}

export interface VerifiedAuthToken extends AuthTokenPayload {
  /** Expiração em **milissegundos** (compat com código antigo que usa Date.now()) */
  exp: number
  /** Issued at em **milissegundos** */
  iat: number
}

/**
 * Assina um token JWT (HS256). Expira em 7 dias.
 * Retorna a string compacta JWT (header.payload.signature).
 */
export async function signAuthToken(payload: AuthTokenPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecretKey())
}

/**
 * Verifica um token JWT.
 *
 * Retorna o payload se for válido (assinatura correta, não expirado, com
 * todos os campos obrigatórios).
 *
 * Retorna `null` em qualquer caso de falha (token inválido, expirado,
 * assinatura errada, campo faltando). Não lança — sempre retorna null
 * pra ser fácil de usar com `if (!result) return ...`.
 */
export async function verifyAuthToken(
  token: string
): Promise<VerifiedAuthToken | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())

    // Validar campos obrigatórios (defesa: e.g. se algum token foi emitido
    // por outro sistema com formato diferente)
    if (
      typeof payload.userId !== 'number' ||
      typeof payload.email !== 'string' ||
      typeof payload.tipo !== 'string'
    ) {
      return null
    }

    return {
      userId: payload.userId,
      email: payload.email,
      tipo: payload.tipo,
      // jose retorna `exp` e `iat` em SEGUNDOS (padrão JWT, RFC 7519).
      // Convertemos pra ms pra manter compat com código antigo que comparava
      // com Date.now() (sempre em ms).
      exp: (payload.exp ?? 0) * 1000,
      iat: (payload.iat ?? 0) * 1000,
    }
  } catch {
    // Qualquer erro (assinatura errada, expirado, malformado) → null
    return null
  }
}