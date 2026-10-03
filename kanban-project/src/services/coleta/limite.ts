// src/services/coleta/limite.ts
// Limite de requisições por IP para as rotas PÚBLICAS da coleta (não existia limitador no
// sistema). Janela deslizante em memória, por instância: em serverless é um freio de
// melhor esforço contra rajada; o freio que vale entre instâncias é o do banco
// (`contarEnviosRecentesDoIp`) nos envios. Só o hash do IP circula.
import { createHash } from "crypto"

export function hashDoIp(ip: string): string {
  return createHash("sha256").update(`coleta:${ip}`).digest("hex")
}

const janelas = new Map<string, number[]>()

/** true = pode seguir; false = estourou (`max` chamadas em `ms` milissegundos). */
export function dentroDoLimite(chave: string, max: number, ms: number, agora = Date.now()): boolean {
  const recentes = (janelas.get(chave) ?? []).filter((t) => agora - t < ms)
  if (recentes.length >= max) {
    janelas.set(chave, recentes)
    return false
  }
  recentes.push(agora)
  janelas.set(chave, recentes)
  if (janelas.size > 5000) for (const [k, v] of janelas) if (v.every((t) => agora - t >= ms)) janelas.delete(k)
  return true
}

export function ipDoRequest(req: Request): string {
  const f = req.headers.get("x-forwarded-for")
  return (f ? f.split(",")[0].trim() : req.headers.get("x-real-ip") ?? "desconhecido") || "desconhecido"
}
