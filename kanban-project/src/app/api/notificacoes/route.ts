// src/app/api/notificacoes/route.ts
// Retorna notificações categorizadas para o sino do HeaderBar.
// Filtro pesado feito no Postgres — payload ~3-8 kB em vez de 281 kB.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { STATUS_TERMINAIS } from '@/lib/operacional/tarefa-canonica'

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)

    if (!usuario) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    // Janelas de tempo
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const em3Dias = new Date(hoje)
    em3Dias.setDate(em3Dias.getDate() + 3)
    const umDiaAtras = new Date()
    umDiaAtras.setDate(umDiaAtras.getDate() - 1)

    // 🔒 HIERARQUIA: "sem responsável" é fila de DISTRIBUIÇÃO — só admin gere
    // o que ainda não é de ninguém. Sem isto, todo mundo era notificado de
    // toda tarefa sem dono do sistema inteiro, e o sino virava um segundo
    // "Tarefas e Projetos" para quem não devia nem ver essa tela.
    const ehAdmin = usuario.tipo === 'admin'
    const filtroResponsavel = ehAdmin
      ? { OR: [{ responsavelId: usuario.userId }, { responsavelId: null }] }
      : { responsavelId: usuario.userId }

    const tarefas = await prisma.tarefa.findMany({
      where: {
        concluida: false,
        // `concluida` só vira `true` para CONCLUIDO_RECEBIDO — CANCELADA e
        // SUPERSEDIDA ficam com `concluida: false` para sempre. Sem isto, uma
        // tarefa já encerrada (ex.: substituída por Movimentação Manual de Fase)
        // continua notificando como se fosse nova, para sempre.
        statusTarefa: { notIn: STATUS_TERMINAIS },
        AND: [
            filtroResponsavel,
            // Janela de tempo (vencidas/próximas OU recém-criadas)
            {
            OR: [
                { dataPrazo: { lte: em3Dias } },
                { createdAt: { gte: umDiaAtras } }
            ]
            }
        ]
      },
      select: {
        id: true,
        titulo: true,
        dataPrazo: true,
        createdAt: true,
        processoId: true,
        processo: { select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } }
      },
      orderBy: { dataPrazo: 'asc' }
    })

    const vencidas: any[] = []
    const hojeList: any[] = []
    const proximos3Dias: any[] = []
    const novas: any[] = []

    for (const t of tarefas) {
      const item = {
        id: t.id,
        titulo: t.titulo,
        dataPrazo: t.dataPrazo,
        processoId: t.processo?.id ?? t.processoId,
        processoNome: t.processo?.nome ?? 'Sem processo',
        // `Tarefa.pais` era identidade textual duplicada e saiu. O país de uma
        // tarefa é o do PROCESSO — uma fonte, não duas que podiam divergir.
        pais: t.processo?.paisCanonico?.countryKey ?? null
      }

      if (t.dataPrazo) {
        const prazo = new Date(t.dataPrazo)
        prazo.setHours(0, 0, 0, 0)
        if (prazo < hoje) vencidas.push(item)
        else if (prazo.getTime() === hoje.getTime()) hojeList.push(item)
        else if (prazo <= em3Dias) proximos3Dias.push(item)
      }

      if (t.createdAt >= umDiaAtras) novas.push(item)
    }

    // 🔒 Achado real: quando a Saúde do Sistema encontra um erro crítico, o
    // único lugar que isso ia parar era o LogAuditoria — sem provedor de
    // e-mail configurado, ninguém era avisado de verdade, a menos que
    // alguém abrisse a tela por conta própria. Reusa o MESMO canal que
    // `notificarAchados` já escreve (nenhum canal paralelo inventado);
    // só admin vê, e só enquanto o incidente continuar sendo confirmado
    // pela rodada horária (2h de folga sobre o cron de hora em hora).
    let saudeCritica: { descricao: string; criticos: number; erros: number; desde: string; link: string } | null = null
    if (ehAdmin) {
      const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60_000)
      const incidente = await prisma.logAuditoria.findFirst({
        where: { entidade: 'SAUDE', acao: 'SAUDE_INCIDENTE', criadoEm: { gte: duasHorasAtras } },
        orderBy: { criadoEm: 'desc' },
        select: { descricao: true, detalhes: true, criadoEm: true },
      })
      const d = incidente?.detalhes as { criticos?: number; erros?: number } | null
      if (incidente && ((d?.criticos ?? 0) > 0 || (d?.erros ?? 0) > 0)) {
        saudeCritica = {
          descricao: incidente.descricao ?? 'Saúde do sistema requer atenção',
          criticos: d?.criticos ?? 0,
          erros: d?.erros ?? 0,
          desde: incidente.criadoEm.toISOString(),
          link: '/administrator?screen=syshealth',
        }
      }
    }

    return NextResponse.json({
      vencidas,
      hoje: hojeList,
      proximos3Dias,
      novas,
      saudeCritica,
      total: vencidas.length + hojeList.length + proximos3Dias.length + novas.length + (saudeCritica ? 1 : 0)
    })
  } catch (error) {
    console.error('Erro ao buscar notificações:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}