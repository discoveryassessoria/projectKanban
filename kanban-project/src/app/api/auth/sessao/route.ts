// src/app/api/auth/sessao/route.ts
// ============================================================================
// SESSÃO — leitura e renovação. Uma rota, dois verbos:
//
//   GET  → estado autoritativo da sessão (expiração do token, início absoluto).
//          É a fonte que o cliente usa ao montar e após um refresh de página.
//   POST → RENOVA a janela de inatividade, emitindo token novo com o MESMO
//          `sessaoInicio`. Recusa se o teto absoluto de 8 h já passou.
//
// A renovação é economizada: acima de RENOVAR_QUANDO_RESTAR_MS o servidor
// devolve o token atual sem emitir nem auditar nada. Assim "renovar durante o
// uso" não vira uma linha de auditoria por clique.
//
// O token vem do cookie (mandado sozinho pelo browser) ou do header — as duas
// formas que o middleware já aceita.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { signAuthToken, verifyAuthToken } from '@/lib/auth-jwt'
import { registrarAcesso } from '@/lib/sessao/auditoria-acesso'
import { ABSOLUTA_MS, INATIVIDADE_MS, devoRenovar, estourouAbsoluta, expiracaoDoToken } from '@/lib/sessao/politica'

function tokenDaRequisicao(req: NextRequest): string | null {
  return req.cookies.get('authToken')?.value || req.headers.get('authorization')?.replace('Bearer ', '') || null
}

export async function GET(req: NextRequest) {
  const token = tokenDaRequisicao(req)
  if (!token) return NextResponse.json({ autenticado: false }, { status: 401 })
  const dados = await verifyAuthToken(token).catch(() => null)
  if (!dados) return NextResponse.json({ autenticado: false }, { status: 401 })
  return NextResponse.json({
    autenticado: true,
    usuarioId: dados.userId,
    email: dados.email,
    expiraEm: dados.exp,
    sessaoInicio: dados.sessaoInicio,
    limiteAbsoluto: dados.sessaoInicio + ABSOLUTA_MS,
    inatividadeMs: INATIVIDADE_MS,
  })
}

export async function POST(req: NextRequest) {
  const token = tokenDaRequisicao(req)
  if (!token) return NextResponse.json({ ok: false, motivo: 'token_invalido' }, { status: 401 })

  const dados = await verifyAuthToken(token).catch(() => null)
  if (!dados) return NextResponse.json({ ok: false, motivo: 'token_invalido' }, { status: 401 })

  const agora = Date.now()

  // Teto absoluto: nenhuma atividade compra tempo aqui.
  if (estourouAbsoluta(agora, dados.sessaoInicio)) {
    await registrarAcesso(
      'SESSAO_EXPIRADA',
      `Sessão de ${dados.email} atingiu a duração máxima de ${ABSOLUTA_MS / 3600000} h.`,
      dados.userId, req, { motivo: 'expiracao_absoluta', sessaoInicio: dados.sessaoInicio },
    )
    return NextResponse.json({ ok: false, motivo: 'expiracao_absoluta' }, { status: 401 })
  }

  // Ainda sobra bastante janela: não emite token novo (nem linha de auditoria).
  if (!devoRenovar(agora, dados.exp, dados.sessaoInicio)) {
    return NextResponse.json({ ok: true, renovado: false, token, expiraEm: dados.exp, sessaoInicio: dados.sessaoInicio })
  }

  const novo = await signAuthToken({
    userId: dados.userId, email: dados.email, tipo: dados.tipo, sessaoInicio: dados.sessaoInicio,
  })
  const expiraEm = expiracaoDoToken(agora, dados.sessaoInicio)

  await registrarAcesso(
    'SESSAO_RENOVADA',
    `Sessão de ${dados.email} renovada por atividade.`,
    dados.userId, req,
    { sessaoInicio: dados.sessaoInicio, expiraEm, restanteAbsolutaMs: dados.sessaoInicio + ABSOLUTA_MS - agora },
  )

  const res = NextResponse.json({ ok: true, renovado: true, token: novo, expiraEm, sessaoInicio: dados.sessaoInicio })
  // O cookie acompanha o token novo — senão o middleware seguiria com o antigo.
  res.cookies.set('authToken', novo, {
    path: '/', sameSite: 'lax', maxAge: Math.max(0, Math.ceil((expiraEm - agora) / 1000)),
  })
  return res
}
