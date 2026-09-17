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

    // 🔒 OWNERSHIP: notificação PESSOAL de prazo (vencida/hoje/próximos 3
    // dias) respeita SEMPRE o responsável ATUAL da tarefa — inclusive para
    // o Admin. Achado real 17/09/2026: o `OR` com `responsavelId: null` que
    // existia aqui fazia TODA tarefa sem dono do sistema (ex.: 15 certidões
    // da Grisotto ainda não distribuídas) aparecer como prazo pessoal do
    // Admin no sino — "PRÓXIMOS 3 DIAS (15)" para um trabalho que ainda não
    // era dele. "Sem responsável" é fila de DISTRIBUIÇÃO: visibilidade
    // administrativa/gerencial, resolvida em Tarefas e Projetos, na Central
    // Operacional e pela obrigação administrativa ATRIBUIR_TAREFAS (que já
    // chega ao Admin pelo canal certo — `acontecimentos`, tipo
    // `DISTRIBUICAO_NECESSARIA`, com responsável definido). Nunca aqui.
    const ehAdmin = usuario.tipo === 'admin'
    const filtroResponsavel = { responsavelId: usuario.userId }

    // 🔒 Etapa 4 (item 15) — o SINO REAL passa a consumir a porta canônica de
    // notificação (`notificarAcontecimento`). Só NÃO LIDAS: uma notificação
    // arquivada/lida sai do sino sozinha, sem precisar de um segundo estado.
    // RBAC embutido na própria query: cada usuário só vê o que É destinatário
    // dele — nunca por vazamento de acesso ao processo/tarefa (item 17).
    //
    // Lida ANTES das janelas de prazo/"novas" de propósito (achado real
    // 17/09/2026): quando a MESMA atribuição já gerou um aviso específico
    // (`ATRIBUICAO`/`TRANSFERENCIA`/`ATRIBUICAO_LOTE`, ainda não lido), as
    // tarefas que ele cobre não podem TAMBÉM explodir como N entradas de
    // prazo/"nova tarefa" — o mesmo acontecimento não é três avisos. A
    // supressão vale só enquanto o aviso da atribuição estiver pendente:
    // marcá-lo como lido (ou ele nunca ter existido) libera a tarefa para as
    // janelas de prazo normais — nenhum dado de prazo/SLA é alterado, só
    // QUAIS tarefas aparecem soltas aqui.
    const acontecimentosRaw = await prisma.notificacaoOperacional.findMany({
      where: { destinatarioId: usuario.userId, lidaEm: null },
      select: { id: true, tipo: true, titulo: true, mensagem: true, link: true, criadoEm: true, tarefaId: true, processoId: true },
      orderBy: { criadoEm: 'desc' },
      take: 30,
    })
    const tarefasCobertasPorAtribuicao = new Set<number>()
    const processosCobertosPorAtribuicaoLote = new Set<number>()
    for (const a of acontecimentosRaw) {
      if (a.tipo !== 'ATRIBUICAO' && a.tipo !== 'TRANSFERENCIA' && a.tipo !== 'ATRIBUICAO_LOTE') continue
      if (a.tarefaId != null) tarefasCobertasPorAtribuicao.add(a.tarefaId)
      if (a.processoId != null) processosCobertosPorAtribuicaoLote.add(a.processoId)
    }
    const acontecimentos = acontecimentosRaw.map((n) => ({
      id: n.id, tipo: n.tipo, titulo: n.titulo, mensagem: n.mensagem, link: n.link,
      criadoEm: n.criadoEm.toISOString(),
    }))

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
        tipo: true,
        dataPrazo: true,
        createdAt: true,
        processoId: true,
        responsavelId: true,
        processo: { select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } }
      },
      orderBy: { dataPrazo: 'asc' }
    })

    const vencidas: any[] = []
    const hojeList: any[] = []
    const proximos3Dias: any[] = []
    const novas: any[] = []
    let suprimidasPorAtribuicaoPendente = 0

    for (const t of tarefas) {
      // JÁ COBERTA por um aviso de atribuição pendente — não duplica o
      // acontecimento em mais um bucket (item C, 17/09/2026).
      const jaAvisada = tarefasCobertasPorAtribuicao.has(t.id) || (t.processoId != null && processosCobertosPorAtribuicaoLote.has(t.processoId))
      if (jaAvisada) { suprimidasPorAtribuicaoPendente++; continue }

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

      // "NOVA TAREFA" avisa QUEM É DONO dela. Depois do fix de ownership
      // acima, `filtroResponsavel` já garante `responsavelId === usuario.
      // userId` para toda linha de `tarefas` — este `!= null` é só reforço
      // defensivo (nunca deveria ser falso aqui), não a barreira real.
      //
      // ADMINISTRATIVA nunca entra aqui (achado real 17/09/2026): essa
      // Tarefa já tem aviso PRÓPRIO e mais específico (`DISTRIBUICAO_
      // NECESSARIA`, em `acontecimentos`) — empurrá-la também como "nova
      // tarefa" genérica duplicava o mesmo fato pra o mesmo destinatário.
      if (t.createdAt >= umDiaAtras && t.responsavelId != null && t.tipo !== 'ADMINISTRATIVA') novas.push(item)
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
      acontecimentos,
      // GRAIN = TAREFA, sem duplicidade: uma tarefa criada há menos de 24h E com
      // prazo nos próximos dias cai em DOIS buckets de exibição ao mesmo tempo
      // (`novas` + a janela de prazo correspondente — `novas` é um `if` à parte,
      // não `else if`, de propósito, porque os dois fatos são independentes e a
      // tela mostra os dois). O TOTAL não pode somar os buckets (contaria essa
      // tarefa 2x) — é sempre `tarefas.length`, a query já traz cada Tarefa uma
      // única vez (achado real da auditoria de 10/09/2026). `acontecimentos` é
      // grão NOTIFICAÇÃO — nunca TAREFA — e soma à parte, de propósito (item 19
      // do contrato: "Notification NÃO é Tarefa").
      total: (tarefas.length - suprimidasPorAtribuicaoPendente) + (saudeCritica ? 1 : 0) + acontecimentos.length
    })
  } catch (error) {
    console.error('Erro ao buscar notificações:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}