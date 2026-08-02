// lib/saude/smoke.ts
//
// SMOKE HTTP AUTENTICADO E NÃO DESTRUTIVO.
//
// Rota protegida devolvendo 401 NÃO é rota testada — é rota não visitada. Por
// isso o smoke usa uma identidade técnica de curtíssima duração, assinada
// in-process com o segredo que o próprio sistema já usa. Nada é exposto: o
// token nasce, é usado e morre dentro desta função; não vai para log, resposta
// nem banco.
//
// SOMENTE GET. Nenhuma rota de escrita é tocada — o smoke não pode alterar
// produção.

import { signAuthToken } from '@/lib/auth-jwt'
import { prisma } from '@/lib/prisma'

export interface ResultadoRota {
  rota: string
  metodo: 'GET'
  status: number
  ms: number
  ok: boolean
  /** por que falhou, quando falhou */
  problema?: string
  /** tamanho do corpo — corpo vazio em rota de dados é sintoma */
  bytes?: number
}

export interface ResultadoSmoke {
  base: string
  autenticado: boolean
  motivoSemAutenticacao?: string
  rotas: ResultadoRota[]
  ok: number
  falhas: number
  lentas: number
  naoTestadas: number
}

/** Limite acima do qual a rota é considerada lenta (ms). */
const LIMITE_LENTO = 3000
const TIMEOUT = 12_000

/** Rotas essenciais — só leitura. */
export const ROTAS_SMOKE = [
  { rota: '/api/gerenciamento/overview', esperaJson: true },
  { rota: '/api/gerenciamento/saude', esperaJson: true },
  { rota: '/api/gerenciamento/orgaos-protocolo', esperaJson: true },
  { rota: '/api/gerenciamento/tipos-documento', esperaJson: true },
  { rota: '/api/gerenciamento/produtos', esperaJson: true },
  { rota: '/api/gerenciamento/plano-contas-financeiras', esperaJson: false },
  { rota: '/api/gerenciamento/diagnostico', esperaJson: true },
  { rota: '/api/processos', esperaJson: true },
  { rota: '/api/usuarios', esperaJson: true },
] as const

/**
 * Identidade técnica efêmera: usa um administrador REAL já existente, com token
 * de vida curta. Não cria usuário, não altera permissão, não persiste nada.
 */
async function tokenTecnico(): Promise<{ token: string | null; motivo?: string }> {
  if (!process.env.JWT_SECRET) return { token: null, motivo: 'JWT_SECRET ausente no ambiente' }
  const admin = await prisma.usuario.findFirst({
    where: { tipo: 'admin' },
    select: { id: true, email: true, tipo: true },
    orderBy: { id: 'asc' },
  })
  if (!admin) return { token: null, motivo: 'nenhum administrador cadastrado para a identidade técnica' }
  const token = await signAuthToken({
    userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now(),
  })
  return { token }
}

export async function executarSmoke(base?: string): Promise<ResultadoSmoke> {
  // O domínio de produção vem antes da URL do deployment: a URL do deployment
  // pode estar sob proteção de acesso da Vercel e devolveria 401 na borda,
  // antes de chegar na aplicação — alarme falso disfarçado de falha real.
  const origem = base
    ?? process.env.SAUDE_SMOKE_BASE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? 'http://localhost:3000'

  const { token, motivo } = await tokenTecnico()
  const rotas: ResultadoRota[] = []

  for (const alvo of ROTAS_SMOKE) {
    if (!token) {
      rotas.push({ rota: alvo.rota, metodo: 'GET', status: 0, ms: 0, ok: false, problema: 'não testada: sem identidade técnica' })
      continue
    }
    const t0 = Date.now()
    try {
      const controle = new AbortController()
      const timer = setTimeout(() => controle.abort(), TIMEOUT)
      const res = await fetch(`${origem}${alvo.rota}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controle.signal,
        cache: 'no-store',
      })
      clearTimeout(timer)
      const corpo = await res.text()
      const ms = Date.now() - t0

      let problema: string | undefined
      if (res.status === 404) problema = 'rota não encontrada (404)'
      else if (res.status >= 500) problema = `erro do servidor (${res.status})`
      else if (res.status === 401 || res.status === 403) problema = `autorização negada (${res.status}) mesmo com identidade técnica`
      else if (alvo.esperaJson) {
        try {
          const j = JSON.parse(corpo)
          if (j && typeof j === 'object' && 'error' in j) problema = `resposta de erro: ${String(j.error).slice(0, 120)}`
        } catch {
          problema = 'resposta não é JSON válido'
        }
      }
      if (!problema && ms > LIMITE_LENTO) problema = `resposta lenta (${ms}ms)`

      rotas.push({
        rota: alvo.rota, metodo: 'GET', status: res.status, ms,
        ok: !problema, problema, bytes: corpo.length,
      })
    } catch (e) {
      rotas.push({
        rota: alvo.rota, metodo: 'GET', status: 0, ms: Date.now() - t0, ok: false,
        problema: `falha de rede: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
      })
    }
  }

  return {
    base: origem,
    autenticado: !!token,
    motivoSemAutenticacao: motivo,
    rotas,
    ok: rotas.filter((r) => r.ok).length,
    falhas: rotas.filter((r) => !r.ok && r.status !== 0).length,
    lentas: rotas.filter((r) => r.ms > LIMITE_LENTO).length,
    naoTestadas: rotas.filter((r) => r.status === 0).length,
  }
}
