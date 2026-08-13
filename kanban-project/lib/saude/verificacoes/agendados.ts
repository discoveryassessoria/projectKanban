// lib/saude/verificacoes/agendados.ts
//
// JOBS AGENDADOS — quem vigia o vigia.
//
// Um cron que para de rodar não emite erro: ele emite SILÊNCIO. Por isso a
// vigilância aqui é por EVIDÊNCIA de execução, não por ausência de exceção.
//
// A evidência escolhida para cada job é aquela que existe mesmo quando não há
// trabalho a fazer — senão um sistema ocioso viraria alarme falso.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const HORA = 60 * 60 * 1000

registrar({
  id: 'saude.cron.diagnostico-vivo',
  codigo: 'CRON-001',
  nome: 'O diagnóstico automático está rodando',
  descricao: 'O cron horário da saúde grava uma execução a cada passagem. Sem execução recente, o painel mostra um retrato velho como se fosse o estado de agora.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 15_000,
  orientacao: 'Confira o cron /api/cron/saude na Vercel e o CRON_SECRET do ambiente.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const ultima = await prisma.saudeExecucao.findFirst({
      orderBy: { concluidoEm: 'desc' },
      select: { id: true, modo: true, estado: true, concluidoEm: true },
    })
    const achados: Achado[] = []

    if (!ultima) {
      achados.push({
        chave: 'diagnostico-nunca-executado',
        severidade: 'ERRO',
        titulo: 'Nenhuma execução de diagnóstico registrada',
        descricao: 'Não há nenhuma execução persistida neste ambiente.',
        explicacao: 'Sem histórico não existe linha de base: nem tendência, nem reincidência, nem prova de que o motor roda sozinho.',
        impacto: 'A saúde do sistema só é conhecida quando alguém abre a tela manualmente.',
        entidade: 'SaudeExecucao',
        quantidade: 0,
        recomendacao: 'Verifique se o cron /api/cron/saude está ativo na Vercel.',
      })
    } else {
      // o agendamento é horário; três horas de silêncio já é sinal, não ruído
      const idadeH = (Date.now() - ultima.concluidoEm.getTime()) / HORA
      if (idadeH > 3) {
        achados.push({
          chave: 'diagnostico-desatualizado',
          severidade: idadeH > 24 ? 'ERRO' : 'ALERTA',
          titulo: `Último diagnóstico automático há ${Math.round(idadeH)}h`,
          descricao: `A execução mais recente terminou em ${ultima.concluidoEm.toISOString()} (modo ${ultima.modo}).`,
          explicacao: 'O cron é horário. Silêncio prolongado significa que o job não está rodando — e um retrato velho passa por atual.',
          impacto: 'Problemas surgidos depois desse retrato não estão sendo detectados.',
          entidade: 'SaudeExecucao',
          registroId: String(ultima.id),
          quantidade: Math.round(idadeH),
          recomendacao: 'Verifique o agendamento e os logs do cron /api/cron/saude.',
          evidencia: { ultimaExecucao: ultima.concluidoEm, modo: ultima.modo, estado: ultima.estado },
        })
      }
    }

    return {
      achados,
      metricas: { horasDesdeUltima: ultima ? Math.round((Date.now() - ultima.concluidoEm.getTime()) / HORA) : -1 },
      resumo: ultima ? `Último diagnóstico automático em ${ultima.concluidoEm.toISOString()}.` : 'Nenhuma execução registrada.',
    }
  },
})

registrar({
  id: 'saude.cron.registral-drenando',
  codigo: 'REG-001',
  nome: 'O motor registral está drenando os lotes',
  descricao: 'O worker registral roda a cada 10 minutos. Lote pendente envelhecendo é prova de que ele não está drenando.',
  dominio: 'FILAS',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 20_000,
  orientacao: 'Reprocessamento manual em Registral; se o backlog não cair, investigue o cron /api/cron/registral.',
  rotaCorrecao: '/registral',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // Sistema ocioso não é sistema doente: só há sinal quando EXISTE trabalho
    // pendente e ele não anda.
    const limite = new Date(Date.now() - 2 * HORA)
    const pendentes = await prisma.loteRegistral.findMany({
      where: { status: { in: ['RECEBIDO', 'EM_PROCESSAMENTO'] } },
      select: { id: true, status: true, criadoEm: true, totalDocumentos: true, processados: true, falhos: true },
      orderBy: { criadoEm: 'asc' },
      take: 100,
    })
    const parados = pendentes.filter((l) => l.criadoEm < limite)
    const achados: Achado[] = []

    if (parados.length) {
      const maisAntigo = parados[0]
      const horas = Math.round((Date.now() - maisAntigo.criadoEm.getTime()) / HORA)
      achados.push({
        chave: 'lote-registral-parado',
        severidade: horas > 24 ? 'ERRO' : 'ALERTA',
        titulo: `${parados.length} lote(s) registrais parados há mais de 2h`,
        descricao: `O mais antigo está pendente há ${horas}h (lote ${maisAntigo.id}, ${maisAntigo.processados}/${maisAntigo.totalDocumentos} documentos processados).`,
        explicacao: 'O worker registral roda a cada 10 minutos e faz claim atômico por execução. Lote pendente por horas indica worker parado ou documento em falha permanente.',
        impacto: 'Certidões enviadas não viram evidência nem proposta — a operação segue sem os dados que já chegaram.',
        entidade: 'LoteRegistral',
        registroId: String(maisAntigo.id),
        quantidade: parados.length,
        link: '/registral',
        recomendacao: 'Reprocesse o lote e, se persistir, verifique o cron /api/cron/registral.',
        evidencia: { total: parados.length, amostra: parados.slice(0, 10) },
      })
    }

    return {
      achados,
      metricas: { pendentes: pendentes.length, parados: parados.length },
      resumo: pendentes.length
        ? `${pendentes.length} lote(s) em processamento, nenhum parado.`
        : 'Nenhum lote registral pendente.',
    }
  },
})

registrar({
  id: 'saude.cron.avisos-de-prazo',
  codigo: 'PRZ-001',
  nome: 'A varredura de prazos está avisando',
  descricao: 'O cron horário /api/cron/avisos-prazo avisa o responsável quando o prazo vence. Tarefa vencida SEM o aviso dela é prova de que a varredura não está rodando.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 20_000,
  orientacao: 'Confira o cron /api/cron/avisos-prazo na Vercel; rode /api/cron/avisos-prazo?ensaio=1 para ver o que seria enviado.',
  rotaCorrecao: '/operacao',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // A EVIDÊNCIA É O EFEITO, não um registro de execução.
    //
    // A varredura não grava nada quando não há marco — e é assim que deve ser.
    // Então o que se mede é o buraco: tarefa VENCIDA, com responsável, sem o
    // aviso de atraso correspondente. Sem tarefa vencida, não há buraco, e um
    // sistema em dia não vira alarme.
    //
    // A folga de duas horas existe porque o cron é horário: cobrar o aviso no
    // minuto seguinte ao vencimento acusaria atraso do relógio, não do job.
    const agora = new Date()
    const corte = new Date(agora.getTime() - 2 * HORA)
    const vencidas = await prisma.tarefa.findMany({
      where: {
        statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] },
        responsavelId: { not: null },
        dataPrazo: { not: null, lt: corte },
      },
      select: { id: true, titulo: true, dataPrazo: true, responsavelId: true },
      orderBy: { dataPrazo: 'asc' },
      take: 200,
    })

    const semAviso: typeof vencidas = []
    if (vencidas.length) {
      const avisos = await prisma.notificacaoOperacional.findMany({
        where: { tipo: 'ATRASO', tarefaId: { in: vencidas.map((t) => t.id) } },
        select: { tarefaId: true, chaveIdempotencia: true },
      })
      const avisadas = new Set(avisos.map((a) => a.chaveIdempotencia))
      for (const t of vencidas) {
        // A chave carrega o PRAZO: remarcar a tarefa cria um marco novo, e a
        // ausência do aviso do prazo NOVO é um buraco legítimo.
        const dia = t.dataPrazo!.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        if (!avisadas.has(`notif::atraso::t${t.id}::${dia}`)) semAviso.push(t)
      }
    }

    const achados: Achado[] = []
    if (semAviso.length) {
      const maisAntiga = semAviso[0]
      const horas = Math.round((agora.getTime() - maisAntiga.dataPrazo!.getTime()) / HORA)
      achados.push({
        chave: 'avisos-de-prazo-parados',
        severidade: horas > 24 ? 'ERRO' : 'ALERTA',
        titulo: `${semAviso.length} tarefa(s) vencida(s) sem aviso de atraso`,
        descricao: `A mais antiga venceu há ${horas}h (tarefa ${maisAntiga.id} — ${maisAntiga.titulo}).`,
        explicacao: 'O cron /api/cron/avisos-prazo roda de hora em hora e cria um aviso por marco. Tarefa vencida sem o aviso dela significa que ele não está passando.',
        impacto: 'O prazo vence e o responsável não fica sabendo — a fila continua correta e ninguém é avisado.',
        entidade: 'Tarefa',
        registroId: String(maisAntiga.id),
        quantidade: semAviso.length,
        link: '/operacao',
        recomendacao: 'Verifique o cron na Vercel e rode /api/cron/avisos-prazo?ensaio=1 para conferir o que seria enviado.',
        evidencia: { total: semAviso.length, amostra: semAviso.slice(0, 10).map((t) => ({ id: t.id, prazo: t.dataPrazo })) },
      })
    }

    return {
      achados,
      metricas: { vencidas: vencidas.length, semAviso: semAviso.length },
      resumo: vencidas.length
        ? `${vencidas.length} tarefa(s) vencida(s), ${semAviso.length} sem aviso.`
        : 'Nenhuma tarefa vencida — nada a avisar.',
    }
  },
})
