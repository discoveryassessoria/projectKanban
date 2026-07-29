// scripts/sessao.test.ts
// ============================================================================
// SESSÃO — política (pura), token (assinatura real) e arquitetura.
//
// A política é a parte que decide quando avisar e quando encerrar; o token é
// onde a inatividade vira regra de servidor. Os dois são exercitados de
// verdade. A terceira seção é estrutural: garante que a implementação não
// duplicou lógica de logout, não deixou timer/listener órfão e não criou uma
// segunda fonte de verdade.
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ABSOLUTA_MS, AVISO_MS, INATIVIDADE_MS, MOTIVO_LABEL, RENOVAR_QUANDO_RESTAR_MS,
  avaliarSessao, devoRenovar, estourouAbsoluta, expiracaoDoToken, formatarContagem,
} from '@/lib/sessao/politica'

const RAIZ = process.cwd()
let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const sec = (t: string) => console.log(`\n── ${t}`)
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

const MIN = 60_000
const H = 60 * MIN

async function main() {
  // ── 1) configuração declarada ─────────────────────────────────────────────
  sec('1) configuração padrão')
  chk(INATIVIDADE_MS === 15 * MIN, 'inatividade = 15 minutos')
  chk(AVISO_MS === 60_000, 'aviso = 60 segundos antes')
  chk(ABSOLUTA_MS === 8 * H, 'sessão máxima = 8 horas')
  chk(RENOVAR_QUANDO_RESTAR_MS < INATIVIDADE_MS, 'renovação acontece ANTES de a janela acabar')

  // ── 2) as duas janelas ────────────────────────────────────────────────────
  sec('2) janela deslizante × teto absoluto')
  const t0 = 1_800_000_000_000 // instante fixo — teste não depende do relógio
  chk(expiracaoDoToken(t0, t0) === t0 + INATIVIDADE_MS, 'token novo vale a janela de inatividade')
  // perto do teto, o token nasce mais curto e NUNCA ultrapassa o limite
  const quaseNoFim = t0 + ABSOLUTA_MS - 5 * MIN
  chk(expiracaoDoToken(quaseNoFim, t0) === t0 + ABSOLUTA_MS, 'perto das 8 h o token é truncado no teto absoluto')
  chk(expiracaoDoToken(quaseNoFim, t0) - quaseNoFim === 5 * MIN, 'o último token dura só o que falta')
  chk(!estourouAbsoluta(t0 + ABSOLUTA_MS - 1, t0), 'antes de 8 h a sessão vive')
  chk(estourouAbsoluta(t0 + ABSOLUTA_MS, t0), 'às 8 h exatas a sessão morre')
  chk(estourouAbsoluta(t0 + ABSOLUTA_MS + H, t0), 'depois das 8 h continua morta')

  // ── 3) avaliação de estado ────────────────────────────────────────────────
  sec('3) avaliação do estado da sessão')
  const emUso = avaliarSessao(t0, t0 + INATIVIDADE_MS, t0)
  chk(emUso.restanteMs === INATIVIDADE_MS && !emUso.emAviso && !emUso.expirada, 'sessão recém-renovada: sem aviso')
  chk(emUso.motivo === null, 'sem aviso, sem motivo')

  const aviso = avaliarSessao(t0, t0 + 45_000, t0)
  chk(aviso.emAviso && !aviso.expirada, 'faltando 45 s: em aviso')
  chk(aviso.motivo === 'inatividade', 'motivo do aviso é inatividade')
  chk(avaliarSessao(t0, t0 + AVISO_MS, t0).emAviso, 'aviso começa exatamente em 60 s')
  chk(!avaliarSessao(t0, t0 + AVISO_MS + 1, t0).emAviso, 'a 60,001 s ainda não avisa')

  const morta = avaliarSessao(t0, t0 - 1, t0)
  chk(morta.expirada && morta.restanteMs === 0, 'token vencido = sessão expirada')

  // teto absoluto vence a janela de inatividade
  const perto = t0 + ABSOLUTA_MS - 30_000
  const abs = avaliarSessao(perto, perto + INATIVIDADE_MS, t0)
  chk(abs.emAviso && abs.motivo === 'expiracao_absoluta', 'perto das 8 h o aviso é de expiração absoluta')
  chk(abs.restanteMs === 30_000, 'restante segue o teto, não a inatividade')

  // ── 4) política de renovação ──────────────────────────────────────────────
  sec('4) quando renovar')
  chk(!devoRenovar(t0, t0 + INATIVIDADE_MS, t0), 'não renova com a janela cheia (evita chamada por clique)')
  chk(devoRenovar(t0, t0 + RENOVAR_QUANDO_RESTAR_MS - 1, t0), 'renova quando resta pouco')
  chk(!devoRenovar(t0 + ABSOLUTA_MS, t0 + ABSOLUTA_MS + MIN, t0), 'nunca renova depois do teto absoluto')

  // ── 5) contagem regressiva ────────────────────────────────────────────────
  sec('5) contagem regressiva')
  chk(formatarContagem(60_000) === '01:00', '60 s → 01:00')
  chk(formatarContagem(59_400) === '01:00', 'arredonda para cima (não mostra 00:59 faltando 59,4 s)')
  chk(formatarContagem(9_000) === '00:09', '9 s → 00:09')
  chk(formatarContagem(0) === '00:00', 'zero → 00:00')
  chk(formatarContagem(-5_000) === '00:00', 'negativo nunca vira contagem estranha')

  // ── 6) token real (assinatura + janelas) ──────────────────────────────────
  sec('6) token assinado de verdade')
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(64)
  const { signAuthToken, verifyAuthToken } = await import('@/lib/auth-jwt')

  const tok = await signAuthToken({ userId: 7, email: 'a@a.com', tipo: 'admin' })
  const v = await verifyAuthToken(tok)
  chk(v !== null, 'token de login é válido')
  chk(!!v && v.sessaoInicio > 0, 'token carrega o início da sessão')
  const duracao = (v!.exp - v!.sessaoInicio)
  chk(Math.abs(duracao - INATIVIDADE_MS) < 2000, `token de login vale ~15 min (${Math.round(duracao / 1000)}s), não 7 dias`)

  // renovação preserva o início — é isso que impede o teto de escorregar
  const inicioAntigo = Date.now() - 3 * H
  const renovado = await signAuthToken({ userId: 7, email: 'a@a.com', tipo: 'admin', sessaoInicio: inicioAntigo })
  const vr = await verifyAuthToken(renovado)
  chk(!!vr && vr.sessaoInicio === inicioAntigo, 'renovação NÃO reinicia o relógio absoluto')
  chk(!!vr && vr.exp - Date.now() > 14 * MIN, 'renovação devolve janela de inatividade cheia')

  // perto do teto o token é truncado
  const inicioQuaseNoFim = Date.now() - (ABSOLUTA_MS - 4 * MIN)
  const curto = await signAuthToken({ userId: 7, email: 'a@a.com', tipo: 'admin', sessaoInicio: inicioQuaseNoFim })
  const vc = await verifyAuthToken(curto)
  chk(!!vc && vc.exp - Date.now() < 5 * MIN, 'token emitido perto das 8 h nasce curto')

  // compatibilidade: token legado (sem sessaoInicio) não quebra
  const { SignJWT } = await import('jose')
  const legado = await new SignJWT({ userId: 7, email: 'a@a.com', tipo: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
  const vl = await verifyAuthToken(legado)
  chk(vl !== null, 'token legado (7 dias, sem sessaoInicio) continua válido')
  chk(!!vl && vl.sessaoInicio === vl.iat, 'no legado, o início da sessão cai no iat')

  // ── 7) arquitetura: uma saída, um timer, sem vazamento ────────────────────
  sec('7) arquitetura')
  const cliente = ler('src/lib/sessao/cliente.ts')
  chk(/export async function encerrarSessao/.test(cliente), 'existe UM ponto de encerramento de sessão')
  chk(cliente.includes('keepalive: true'), 'auditoria de saída sobrevive à navegação')
  chk(cliente.includes('BroadcastChannel'), 'sincroniza entre abas por BroadcastChannel')
  chk(cliente.includes('addEventListener("storage"') || cliente.includes("addEventListener(\"storage\""), 'fallback por storage para abas sem BroadcastChannel')
  chk((cliente.match(/setInterval/g) ?? []).length === 0, 'nenhum setInterval solto')
  chk((cliente.match(/setTimeout\(/g) ?? []).length === 1, 'UM único agendamento (timer não se multiplica)')
  chk(/parar:/.test(cliente) && cliente.includes('removeEventListener') && cliente.includes('clearTimeout'),
    'parar() remove listeners e cancela o timer (sem memory leak)')
  const listeners = (cliente.match(/addEventListener/g) ?? []).length
  const removals = (cliente.match(/removeEventListener/g) ?? []).length
  chk(listeners === removals, `todo listener registrado é removido (${listeners} add / ${removals} remove)`)
  chk(cliente.includes('lerToken'), 'estado se reconstrói do token (funciona após refresh)')

  const provider = ler('src/components/sessao/SessaoProvider.tsx')
  chk(/return \(\) => \{ s\.parar\(\)/.test(provider), 'provider desmonta o gerente no cleanup do efeito')
  chk(provider.includes('aria-modal') && provider.includes('aria-live'), 'aviso é acessível (dialog + contagem anunciada)')
  chk(provider.includes('Continuar conectado'), 'aviso permite continuar sem perder o trabalho')

  const providers = ler('src/components/providers.tsx')
  chk(providers.includes('SessaoProvider'), 'gerente montado na RAIZ (uma instância para o app)')

  // ── 8) logout não duplicado ───────────────────────────────────────────────
  sec('8) uma única saída (sem lógica duplicada)')
  const arquivos = (dir: string): string[] => {
    const out: string[] = []
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') out.push(...arquivos(p)) }
      else if (/\.(tsx|ts)$/.test(e)) out.push(p)
    }
    return out
  }
  const todos = arquivos(join(RAIZ, 'src'))
  const soltos = todos.filter((f) => {
    if (f.endsWith('src/lib/sessao/cliente.ts')) return false           // o próprio ponto único
    if (f.endsWith('src/components/auth.tsx')) return false             // higiene local NA tela de login
    return readFileSync(f, 'utf8').includes('removeItem("authToken")')
  })
  chk(soltos.length === 0, `nenhuma tela limpa credencial por conta própria${soltos.length ? `: ${soltos.map((f) => f.replace(RAIZ + '/', '')).join(', ')}` : ''}`)

  // ── 9) servidor: renovação, logout e auditoria ────────────────────────────
  sec('9) servidor')
  chk(existsSync(join(RAIZ, 'src/app/api/auth/sessao/route.ts')), 'rota de sessão existe')
  const rotaSessao = ler('src/app/api/auth/sessao/route.ts')
  chk(rotaSessao.includes('estourouAbsoluta'), 'renovação recusa depois do teto absoluto')
  chk(rotaSessao.includes('devoRenovar'), 'renovação é economizada (não emite token por clique)')
  chk(rotaSessao.includes("res.cookies.set('authToken'"), 'cookie acompanha o token renovado')
  chk(rotaSessao.includes('SESSAO_RENOVADA'), 'renovação é auditada')

  const rotaLogout = ler('src/app/api/auth/logout/route.ts')
  chk(rotaLogout.includes('decodeJwt'), 'logout audita QUEM saiu mesmo com token expirado')
  chk(rotaLogout.includes("maxAge: 0"), 'logout apaga o cookie no servidor')

  const auditoria = ler('lib/sessao/auditoria-acesso.ts')
  for (const acao of ['LOGIN', 'LOGOUT', 'SESSAO_EXPIRADA', 'SESSAO_RENOVADA']) {
    chk(auditoria.includes(`'${acao}'`), `trilha cobre ${acao}`)
  }
  chk(auditoria.includes("entidade: 'ACESSO'"), 'usa a entidade ACESSO já existente (sem tabela nova)')
  chk(!auditoria.includes('senha'), 'auditoria nunca registra credencial')
  chk(Object.keys(MOTIVO_LABEL).length >= 5, 'todos os motivos de encerramento têm rótulo')

  const mw = ler('middleware.ts')
  chk(mw.includes('/api/auth/logout'), 'middleware libera o logout (aceita token expirado para auditar)')
  chk(!mw.includes('/api/auth/sessao'), 'renovação continua exigindo token válido')

  const login = ler('src/app/api/auth/login/route.ts')
  chk(login.includes('signAuthToken'), 'login continua usando o assinador central')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
