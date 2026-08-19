// src/app/api/cron/reconciliar-fases/route.ts
// ============================================================================
// A CONVERGÊNCIA DO MOTOR DE FASES — de hora em hora, e só isso.
//
//   GET/POST /api/cron/reconciliar-fases            reconcilia
//   GET/POST /api/cron/reconciliar-fases?ensaio=1   só relata quem avançaria
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// O avanço de fase sempre foi disparado por EVENTO: concluiu a etapa, validou a
// necessidade, encerrou a operação — e o gancho pergunta ao gate. Funciona enquanto
// a última pendência cai por um desses caminhos. Quando ela cai por qualquer outro —
// um passo duplicado supersedido por reparo, uma necessidade que desapareceu junto
// com a pessoa, um comando de tarefa que não estava na lista — não há evento, e o
// processo fica estacionado com a fase satisfeita e o card parado. Foi assim que o
// processo 523 ficou em Genealogia com `canAdvance = true`.
//
// Somar mais chamadas ao gancho reduz a chance, não a elimina: sempre haverá um
// caminho novo que alguém esqueceu de ligar. A garantia tem de ser de CONVERGÊNCIA,
// não de cobertura — é isso que esta varredura entrega: no máximo uma hora depois, o
// motor pergunta sozinho, e o processo sai de onde não devia estar.
//
// É também a RECUPERAÇÃO: se a transição falhar no meio (rede, conflito de CAS), a
// próxima execução repara. O motor não depende de nenhuma chamada ter dado certo.
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não força nada. Chama o MESMO reconciliador canônico, gateado pelo MESMO
// `computeGate`: processo com pendência real não se move, e nada é escrito. Não
// materializa, não cria tarefa, não conclui passo, não toca em prazo nem
// responsável. E não é botão: o operador não deve saber que isto existe.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reconciliarMotorDeFases } from '@/src/lib/motor/reconciliar-motor-fases'
import { calcularPendencias } from '@/src/lib/motor/blocking-engine'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Teto por execução. Varredura é manutenção; não pode virar carga. */
const LOTE = 200

async function autorizado(req: NextRequest): Promise<boolean> {
  if (req.headers.get('x-vercel-cron')) return true
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth === `Bearer ${segredo}`) return true
  const usuario = await extrairUsuarioComPermissoes(req)
  return !!usuario && (usuario.tipo === 'admin' || temPermissao(usuario.permissoes, 'usuarios.gerenciar'))
}

async function executar(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  const ensaio = new URL(req.url).searchParams.get('ensaio') === '1'

  // Só runtime v2 e só processo posicionado: o legado não tem motor de fases, e
  // processo sem fase não tem de onde sair.
  const processos = await prisma.processo.findMany({
    where: { workflowRuntime: 'v2', faseAtualKey: { not: null } },
    select: { id: true, faseAtualKey: true },
    orderBy: { id: 'asc' },
    take: LOTE,
  })

  let avaliados = 0
  let avancaram = 0
  let transicoes = 0
  const movimentos: Array<{ processoId: number; de: string; para: string }> = []
  const barrados: Array<{ processoId: number; fase: string; pendencias: string[] }> = []

  for (const p of processos) {
    avaliados++
    if (ensaio) {
      // ENSAIO consulta o gate e NÃO chama o reconciliador — nem para registrar
      // tentativa bloqueada. Ensaio que escreve log não é ensaio.
      const g = await calcularPendencias(p.id, p.faseAtualKey!, { correlationId: `ensaio-reconc-${p.id}` }).catch(() => null)
      if (g?.canAdvance) { avancaram++; movimentos.push({ processoId: p.id, de: p.faseAtualKey!, para: '(avançaria)' }) }
      else if (g) barrados.push({ processoId: p.id, fase: p.faseAtualKey!, pendencias: g.blocking.map((b) => b.code) })
      continue
    }

    // CORRELAÇÃO ESTÁVEL POR (PROCESSO, FASE): a tentativa bloqueada é auditada uma
    // vez por posição, não uma por hora. A chave única do PhaseAdvanceLog absorve as
    // repetições — sem isso a varredura encheria a auditoria de "continua parado".
    const d = await reconciliarMotorDeFases(p.id, {
      origem: 'cron-reconciliacao',
      correlationId: `reconc|p${p.id}|${p.faseAtualKey}`.slice(0, 60),
    })
    if (d.transicoes.length > 0) {
      avancaram++
      transicoes += d.transicoes.length
      for (const t of d.transicoes) movimentos.push({ processoId: p.id, de: t.de, para: t.para })
    } else if (d.pendencias.length > 0) {
      barrados.push({ processoId: p.id, fase: d.faseFinal ?? '—', pendencias: d.pendencias.map((b) => b.code) })
    }
  }

  console.log(
    `[cron/reconciliar-fases]${ensaio ? ' ENSAIO' : ''} avaliados=${avaliados} avancaram=${avancaram} ` +
    `transicoes=${transicoes} barrados=${barrados.length}` +
    (movimentos.length ? ` — ${movimentos.map((m) => `#${m.processoId} ${m.de}→${m.para}`).join('; ')}` : ''),
  )

  return NextResponse.json({ ok: true, ensaio, avaliados, avancaram, transicoes, movimentos, barrados })
}

export async function GET(req: NextRequest) { return executar(req) }
export async function POST(req: NextRequest) { return executar(req) }
