// src/app/api/operacao/capacidade/route.ts
// ============================================================================
// EQUIPES E CAPACIDADE OPERACIONAL — a camada de organização dos funcionários.
//
//   GET   /api/operacao/capacidade          o quadro inteiro
//   PATCH /api/operacao/capacidade          altera aptidão / disponibilidade / capacidade
//
// O que se cadastra aqui NÃO autoriza ninguém. Autorização continua em
// Gerenciamento › Perfis e Permissões, e é lá que se concede ou se tira. Esta
// camada só RESTRINGE quem já tem permissão: declara para que trabalho a pessoa
// está apta, quando ela não deve receber nada, e quanto trabalho executável ela
// aguenta ao mesmo tempo.
//
// A carga vem da MESMA projeção canônica que a operação usa — não há segunda
// contagem de tarefa neste arquivo.
//
// ─── PERMISSÃO ──────────────────────────────────────────────────────────────
// Ver e mexer na organização da equipe é ato de gestão: `usuarios.gerenciar`,
// a mesma do módulo de Usuários e Acessos onde a tela vive.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import type { TipoIndisponibilidade } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import {
  lerOrganizacao, fasesDisponiveis, definirAptidoes, definirCapacidade,
  abrirIndisponibilidade, encerrarIndisponibilidade,
} from '@/lib/operacional/organizacao'
import { inicioDoDiaOperacional } from '@/lib/operacional/tarefa-projecoes'
import { STATUS_ATIVOS } from '@/lib/operacional/tarefa-canonica'

const TIPOS: TipoIndisponibilidade[] = ['FERIAS', 'AFASTAMENTO', 'AUSENCIA', 'BLOQUEIO_OPERACIONAL']

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const agora = new Date()
  const corte = inicioDoDiaOperacional(agora)

  // A carga detalhada por pessoa, em DUAS consultas agregadas — nunca uma por
  // funcionário, que é como esta tela ficaria lenta com a equipe crescendo.
  const [usuarios, organizacao, ativas] = await Promise.all([
    prisma.usuario.findMany({
      select: { id: true, nome: true, email: true, tipo: true, permissoesCustom: true, perfil: { select: { nome: true, permissoes: true } } },
      orderBy: { nome: 'asc' },
    }),
    lerOrganizacao(agora),
    prisma.tarefa.findMany({
      where: { statusTarefa: { in: STATUS_ATIVOS }, responsavelId: { not: null } },
      select: { responsavelId: true, statusTarefa: true, dataPrazo: true, prioridade: true },
    }),
  ])

  const carga = new Map<number, { ativas: number; executaveis: number; atrasadas: number; urgentes: number; aguardandoTerceiro: number; bloqueadas: number }>()
  for (const u of usuarios) carga.set(u.id, { ativas: 0, executaveis: 0, atrasadas: 0, urgentes: 0, aguardandoTerceiro: 0, bloqueadas: 0 })
  for (const t of ativas) {
    const c = carga.get(t.responsavelId!)
    if (!c) continue
    c.ativas++
    if (t.statusTarefa === 'AGUARDANDO_TERCEIRO' || t.statusTarefa === 'AGUARDANDO_CLIENTE') c.aguardandoTerceiro++
    else if (t.statusTarefa === 'BLOQUEADA') c.bloqueadas++
    else c.executaveis++
    if (t.dataPrazo != null && t.dataPrazo < corte) c.atrasadas++
    if (t.prioridade === 'URGENTE') c.urgentes++
  }

  const linhas = usuarios.map((u) => {
    const permissoes = calcularPermissoes(
      u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null,
    )
    const org = organizacao.get(u.id)
    return {
      usuarioId: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil?.nome ?? (u.tipo === 'admin' ? 'Administrador' : u.tipo),
      /** Sem isto, nada mais importa — e a tela precisa dizer isso primeiro. */
      podeExecutar: temPermissao(permissoes, 'tarefas.iniciar_concluir'),
      equipes: org?.equipes ?? [],
      aptidoes: org?.aptidoes ?? [],
      indisponivelPor: org?.indisponivelPor ?? null,
      indisponibilidades: org?.indisponibilidades ?? [],
      limiteExecutaveis: org?.limiteExecutaveis ?? null,
      observacaoCapacidade: org?.observacaoCapacidade ?? null,
      carga: carga.get(u.id) ?? { ativas: 0, executaveis: 0, atrasadas: 0, urgentes: 0, aguardandoTerceiro: 0, bloqueadas: 0 },
    }
  })

  return NextResponse.json({ linhas, fases: fasesDisponiveis(), tipos: TIPOS })
}

export async function PATCH(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const autor = await extrairUsuarioComPermissoes(request)
  if (!autor) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const usuarioId = Number(b?.usuarioId)
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return NextResponse.json({ error: 'usuarioId inválido' }, { status: 400 })
  }
  const existe = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true } })
  if (!existe) return NextResponse.json({ error: 'usuário não encontrado' }, { status: 404 })

  switch (String(b?.acao ?? '')) {
    case 'aptidoes': {
      const r = await definirAptidoes(usuarioId, Array.isArray(b?.faseKeys) ? b.faseKeys.map(String) : [])
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 422 })
    }
    case 'capacidade': {
      const bruto = b?.limiteExecutaveis
      const limite = bruto === null || bruto === '' || bruto === undefined ? null : Number(bruto)
      const r = await definirCapacidade({
        usuarioId, limiteExecutaveis: limite,
        observacao: typeof b?.observacao === 'string' ? b.observacao : null, autorId: autor.userId,
      })
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 422 })
    }
    case 'indisponibilizar': {
      const tipo = String(b?.tipo ?? '') as TipoIndisponibilidade
      if (!TIPOS.includes(tipo)) return NextResponse.json({ error: `tipo inválido; use um de ${TIPOS.join(', ')}` }, { status: 422 })
      const inicio = b?.inicio ? new Date(String(b.inicio)) : new Date()
      const fim = b?.fim ? new Date(String(b.fim)) : null
      if (Number.isNaN(inicio.getTime()) || (fim && Number.isNaN(fim.getTime()))) {
        return NextResponse.json({ error: 'data inválida' }, { status: 422 })
      }
      const r = await abrirIndisponibilidade({
        usuarioId, tipo, inicio, fim,
        motivo: typeof b?.motivo === 'string' ? b.motivo : null, autorId: autor.userId,
      })
      return r.ok ? NextResponse.json({ ok: true, id: r.id }) : NextResponse.json({ error: r.erro }, { status: 422 })
    }
    case 'encerrar_indisponibilidade': {
      const id = Number(b?.indisponibilidadeId)
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'indisponibilidadeId inválido' }, { status: 400 })
      const r = await encerrarIndisponibilidade(id)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 422 })
    }
    default:
      return NextResponse.json(
        { error: 'ação desconhecida', acoes: ['aptidoes', 'capacidade', 'indisponibilizar', 'encerrar_indisponibilidade'] },
        { status: 400 },
      )
  }
}
