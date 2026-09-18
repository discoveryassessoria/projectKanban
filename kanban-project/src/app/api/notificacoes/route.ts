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
    const acontecimentosRaw = await prisma.notificacaoOperacional.findMany({
      where: { destinatarioId: usuario.userId, lidaEm: null },
      select: { id: true, tipo: true, titulo: true, mensagem: true, link: true, criadoEm: true, tarefaId: true, processoId: true },
      orderBy: { criadoEm: 'desc' },
      take: 30,
    })
    // Lida ANTES das janelas de prazo/"novas" de propósito (achado real
    // 17/09/2026): quando a MESMA atribuição já gerou um aviso específico
    // (`ATRIBUICAO`/`TRANSFERENCIA`/`ATRIBUICAO_LOTE`), as tarefas que ele
    // cobre não podem TAMBÉM explodir como N entradas de prazo/"nova tarefa"
    // — o mesmo acontecimento não é dois avisos.
    //
    // DOIS RECORTES, de propósito (achado real 18/09/2026 — auditoria da
    // Grisotto): a supressão de PRAZO (vencidas/hoje/próximos 3 dias) vale só
    // enquanto o aviso está PENDENTE — ler a notificação libera a tarefa para
    // as janelas de prazo normais, e isso é intencional (a Daniela continua
    // precisando ver "vence amanhã" depois de já ter lido "foi atribuída a
    // você"; `sino-ownership.test.ts` prova isso). Mas a supressão de "NOVAS
    // TAREFAS" tem que ser mais larga que isso: ela existe para não deixar o
    // MESMO acontecimento de atribuição virar N entradas soltas — e isso
    // continua sendo o mesmo acontecimento MESMO DEPOIS de lido. Usar só
    // `lidaEm: null` aqui foi o bug real: assim que a notificação consolidada
    // da Grisotto foi lida, as 3 tarefas (criadas há menos de 24h) voltaram a
    // cair, uma por uma, em `novas` — nenhuma delas tinha outra notificação
    // pendente cobrindo. `atribuicoesRecentes` cobre a MESMA janela de 24h que
    // `novas` usa (lida ou não) — o suficiente para nunca duplicar o
    // acontecimento, sem nunca esconder um acontecimento novo e genuinamente
    // diferente (chave de idempotência do lote muda a cada conjunto de ids).
    const tarefasCobertasPorAtribuicao = new Set<number>()
    const processosCobertosPorAtribuicaoLote = new Set<number>()
    for (const a of acontecimentosRaw) {
      if (a.tipo !== 'ATRIBUICAO' && a.tipo !== 'TRANSFERENCIA' && a.tipo !== 'ATRIBUICAO_LOTE') continue
      if (a.tarefaId != null) tarefasCobertasPorAtribuicao.add(a.tarefaId)
      if (a.processoId != null) processosCobertosPorAtribuicaoLote.add(a.processoId)
    }
    const atribuicoesRecentesRaw = await prisma.notificacaoOperacional.findMany({
      where: {
        destinatarioId: usuario.userId,
        tipo: { in: ['ATRIBUICAO', 'TRANSFERENCIA', 'ATRIBUICAO_LOTE'] },
        criadoEm: { gte: umDiaAtras },
      },
      select: { tarefaId: true, processoId: true },
    })
    const tarefasJaComunicadas = new Set<number>()
    const processosJaComunicadosPorLote = new Set<number>()
    for (const a of atribuicoesRecentesRaw) {
      if (a.tarefaId != null) tarefasJaComunicadas.add(a.tarefaId)
      if (a.processoId != null) processosJaComunicadosPorLote.add(a.processoId)
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
    // GRAIN = TAREFA, contado por ID VISÍVEL — não por linha somada (uma
    // tarefa pode legitimamente aparecer em um balde de prazo E em "novas" ao
    // mesmo tempo, dois fatos independentes; contar seria dobrar essa mesma
    // tarefa no total). Substitui o antigo contador de "suprimidas": agora há
    // dois recortes de supressão diferentes (pendente vs. já comunicada), e o
    // que realmente importa para o total é só "apareceu em algum balde?".
    const idsVisiveis = new Set<number>()

    for (const t of tarefas) {
      // JÁ COBERTA por um aviso de atribuição pendente — não duplica o
      // acontecimento em mais um bucket de PRAZO (item C, 17/09/2026).
      const jaAvisada = tarefasCobertasPorAtribuicao.has(t.id) || (t.processoId != null && processosCobertosPorAtribuicaoLote.has(t.processoId))
      if (jaAvisada) continue

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
        if (prazo < hoje) { vencidas.push(item); idsVisiveis.add(t.id) }
        else if (prazo.getTime() === hoje.getTime()) { hojeList.push(item); idsVisiveis.add(t.id) }
        else if (prazo <= em3Dias) { proximos3Dias.push(item); idsVisiveis.add(t.id) }
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
      //
      // JÁ COMUNICADA por uma atribuição recente (lida ou não — achado real
      // 18/09/2026, ver comentário acima da query `atribuicoesRecentesRaw`):
      // essa tarefa já tem UM acontecimento de atribuição que a representa —
      // "novas" não pode ser um segundo, ungrupado, por tarefa.
      const jaComunicadaComoAtribuicao =
        tarefasJaComunicadas.has(t.id) || (t.processoId != null && processosJaComunicadosPorLote.has(t.processoId))
      if (t.createdAt >= umDiaAtras && t.responsavelId != null && t.tipo !== 'ADMINISTRATIVA' && !jaComunicadaComoAtribuicao) {
        novas.push(item)
        idsVisiveis.add(t.id)
      }
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
      // tarefa 2x) — é `idsVisiveis.size`: quantas Tarefas DISTINTAS apareceram
      // em pelo menos um balde depois de toda supressão (achado real da
      // auditoria de 10/09/2026, refinado em 18/09/2026 — antes era
      // `tarefas.length - suprimidas`, que contava uma tarefa suprimida SÓ de
      // "novas" como se ainda estivesse visível em algum balde, inflando o
      // badge para acontecimentos que na prática não aparecem em lugar
      // nenhum). `acontecimentos` é grão NOTIFICAÇÃO — nunca TAREFA — e soma à
      // parte, de propósito (item 19 do contrato: "Notification NÃO é
      // Tarefa"; e item 21 do mandato de 18/09/2026: o badge conta
      // acontecimentos não lidos, nunca as tarefas que um acontecimento
      // consolidado carrega dentro dele).
      total: idsVisiveis.size + (saudeCritica ? 1 : 0) + acontecimentos.length
    })
  } catch (error) {
    console.error('Erro ao buscar notificações:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}