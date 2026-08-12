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
  lerOrganizacao, unidadesOperacionais, definirAptidoes, definirCapacidade,
  abrirIndisponibilidade, encerrarIndisponibilidade,
} from '@/lib/operacional/organizacao'
import { inicioDoDiaOperacional } from '@/lib/operacional/tarefa-projecoes'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { STATUS_ATIVOS } from '@/lib/operacional/tarefa-canonica'

const TIPOS: TipoIndisponibilidade[] = ['FERIAS', 'AFASTAMENTO', 'AUSENCIA', 'BLOQUEIO_OPERACIONAL']

/**
 * A ENTIDADE AUDITADA é o FUNCIONÁRIO, não cada tabelinha.
 *
 * `entidadeId` é o id do usuário porque a pergunta que se faz depois é "o que
 * mexeram na configuração da Daniela", e não "o que aconteceu com a linha 47 de
 * AptidaoOperacional". Auditar por tabela dispersaria a resposta em três lugares.
 */
const ENTIDADE_AUDITADA = 'CapacidadeOperacional'

const ROTULO_TIPO: Record<string, string> = {
  FERIAS: 'férias', AFASTAMENTO: 'afastamento',
  AUSENCIA: 'ausência', BLOQUEIO_OPERACIONAL: 'bloqueio operacional',
}

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
      /** Ids das unidades — é o que o formulário marca. */
      aptidoes: org?.aptidoes ?? [],
      /** As mesmas, com nome e família — é o que a tabela mostra. */
      aptidoesDetalhadas: org?.aptidoesDetalhadas ?? [],
      indisponivelPor: org?.indisponivelPor ?? null,
      indisponibilidades: org?.indisponibilidades ?? [],
      limiteExecutaveis: org?.limiteExecutaveis ?? null,
      observacaoCapacidade: org?.observacaoCapacidade ?? null,
      carga: carga.get(u.id) ?? { ativas: 0, executaveis: 0, atrasadas: 0, urgentes: 0, aguardandoTerceiro: 0, bloqueadas: 0 },
    }
  })

  // O HISTÓRICO VEM JUNTO, e numa consulta só.
  //
  // Configuração que decide quem recebe trabalho precisa responder "quem mudou
  // isto, quando e do quê para quê" sem abrir outra tela. Buscar por
  // funcionário seria uma consulta por linha.
  const historico = await prisma.logAuditoria.findMany({
    where: { entidade: ENTIDADE_AUDITADA },
    select: { id: true, acao: true, entidadeId: true, descricao: true, criadoEm: true, usuario: { select: { nome: true } } },
    orderBy: { criadoEm: 'desc' },
    take: 300,
  })
  const porUsuario = new Map<number, Array<{ id: number; acao: string; descricao: string; em: string; por: string | null }>>()
  for (const h of historico) {
    if (h.entidadeId == null) continue
    const lista = porUsuario.get(h.entidadeId) ?? []
    if (lista.length < 20) lista.push({ id: h.id, acao: h.acao, descricao: h.descricao, em: h.criadoEm.toISOString(), por: h.usuario?.nome ?? null })
    porUsuario.set(h.entidadeId, lista)
  }

  return NextResponse.json({
    linhas: linhas.map((l) => ({ ...l, historico: porUsuario.get(l.usuarioId) ?? [] })),
    // AS UNIDADES DE TRABALHO — do Cadastro Mestre. Fases macro NÃO entram aqui:
    // "Finalizado" é posição do processo, não competência de ninguém.
    unidades: await unidadesOperacionais(),
    tipos: TIPOS,
  })
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
  const existe = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nome: true } })
  if (!existe) return NextResponse.json({ error: 'usuário não encontrado' }, { status: 404 })
  const quem = existe.nome

  switch (String(b?.acao ?? '')) {
    case 'aptidoes': {
      const nomes = async () =>
        (await prisma.aptidaoOperacional.findMany({
          where: { usuarioId }, select: { perfilOperacional: { select: { name: true } } },
        })).map((a) => a.perfilOperacional.name).sort()
      const antes = await nomes()
      const pedidas = Array.isArray(b?.perfilOperacionalIds)
        ? (b.perfilOperacionalIds as unknown[]).map(Number)
        : []
      const r = await definirAptidoes(usuarioId, pedidas)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 })
      const depois = await nomes()
      await registrarAuditoria(request, {
        acao: 'EDITAR', entidade: ENTIDADE_AUDITADA, entidadeId: usuarioId,
        descricao: `Aptidões de ${quem}: ${depois.length ? depois.join(', ') : 'nenhuma'}` +
          `${antes.join('|') === depois.join('|') ? ' (sem mudança)' : ` (antes: ${antes.length ? antes.join(', ') : 'nenhuma'})`}`,
        detalhes: { de: antes, para: depois },
      })
      return NextResponse.json({ ok: true })
    }
    case 'capacidade': {
      const bruto = b?.limiteExecutaveis
      const limite = bruto === null || bruto === '' || bruto === undefined ? null : Number(bruto)
      const antes = (await prisma.capacidadeOperacional.findUnique({ where: { usuarioId }, select: { limiteExecutaveis: true } }))?.limiteExecutaveis ?? null
      const r = await definirCapacidade({
        usuarioId, limiteExecutaveis: limite,
        observacao: typeof b?.observacao === 'string' ? b.observacao : null, autorId: autor.userId,
      })
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 })
      const texto = (n: number | null) => (n == null ? 'sem teto' : `${n} executáveis`)
      await registrarAuditoria(request, {
        acao: 'EDITAR', entidade: ENTIDADE_AUDITADA, entidadeId: usuarioId,
        descricao: `Capacidade de ${quem}: ${texto(antes)} → ${texto(limite)}`,
        detalhes: { de: antes, para: limite },
      })
      return NextResponse.json({ ok: true })
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
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 })
      await registrarAuditoria(request, {
        acao: 'CRIAR', entidade: ENTIDADE_AUDITADA, entidadeId: usuarioId,
        descricao: `${quem} indisponível por ${ROTULO_TIPO[tipo] ?? tipo} desde ${inicio.toISOString().slice(0, 10)}` +
          `${fim ? ` até ${fim.toISOString().slice(0, 10)}` : ' (sem data de retorno)'}` +
          `${b?.motivo ? ` — ${String(b.motivo).slice(0, 120)}` : ''}`,
        detalhes: { indisponibilidadeId: r.id, tipo, inicio: inicio.toISOString(), fim: fim?.toISOString() ?? null },
      })
      return NextResponse.json({ ok: true, id: r.id })
    }
    case 'encerrar_indisponibilidade': {
      const id = Number(b?.indisponibilidadeId)
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'indisponibilidadeId inválido' }, { status: 400 })
      const r = await encerrarIndisponibilidade(id)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 })
      await registrarAuditoria(request, {
        acao: 'EDITAR', entidade: ENTIDADE_AUDITADA, entidadeId: usuarioId,
        descricao: `Indisponibilidade de ${quem} encerrada — volta a receber trabalho`,
        detalhes: { indisponibilidadeId: id },
      })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json(
        { error: 'ação desconhecida', acoes: ['aptidoes', 'capacidade', 'indisponibilizar', 'encerrar_indisponibilidade'] },
        { status: 400 },
      )
  }
}
