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
import { phaseKeyToFaseCode, isProcessoFase } from '@/src/lib/process-stage/fases-catalog'
import { PHASEKEY_A_INICIAR } from '@/src/lib/process-stage/fase-pre-contrato'
import { processoParadoPorEscolhaManual } from '@/src/services/genealogia/zero-por-escolha'
import { projecoesDeCertidaoPorNecessidade, statusEPrazoEfetivos } from '@/src/lib/process-stage/projecao-certidao'

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
  descricao: 'Os crons do sino (resumo diário 07:00 e varredura horária) mantêm um resumo por (pessoa, família). Tarefa vencida cuja pessoa/família não tem resumo é prova de que a varredura não está rodando.',
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

    // O BURACO EXATO DO ACHADO #3860 (28/09/2026): uma tarefa de certidão pode
    // ter `dataPrazo` NULO no banco — a escrita por evento falhou — enquanto o
    // prazo REAL (SolicitacaoDocumento.previsaoRetorno) já venceu. A consulta
    // acima nunca a encontraria (filtra `dataPrazo: { not: null }`). Escopo
    // pequeno de propósito: só quem tem responsável e NecessidadeDocumental —
    // mesma régua de `statusEPrazoEfetivos` (Parte 1 opção ii, 29/09/2026).
    const semPrazoGravado = await prisma.tarefa.findMany({
      where: {
        statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] },
        responsavelId: { not: null },
        dataPrazo: null,
        necessidadeId: { not: null },
        tipo: 'NORMAL',
        // SÓ a Tarefa de Emissão Documental — a de Genealogia da mesma
        // necessidade não representa "solicitação de certidão" (mesma
        // régua de `statusEPrazoEfetivos`, achado real 29/09/2026).
        faseMacroKey: 'emissao_documental',
      },
      select: { id: true, titulo: true, dataPrazo: true, responsavelId: true, necessidadeId: true, tipo: true, statusTarefa: true, faseMacroKey: true },
      take: 500,
    })
    if (semPrazoGravado.length) {
      const necIds = [...new Set(semPrazoGravado.map((t) => t.necessidadeId!).filter((x) => x != null))]
      const projecoes = await projecoesDeCertidaoPorNecessidade(necIds)
      for (const t of semPrazoGravado) {
        const efetivo = statusEPrazoEfetivos(t, projecoes)
        if (efetivo.origem === 'CERTIDAO' && efetivo.dataPrazo && efetivo.dataPrazo < corte) {
          vencidas.push({ id: t.id, titulo: t.titulo, dataPrazo: efetivo.dataPrazo, responsavelId: t.responsavelId })
        }
      }
      vencidas.sort((a, b) => (a.dataPrazo?.getTime() ?? 0) - (b.dataPrazo?.getTime() ?? 0))
    }

    // SINO AGRUPADO (29/09/2026): não existe mais "um aviso de atraso por tarefa". O
    // efeito que a varredura tem de produzir é o RESUMO da (pessoa, família): um PRECISA_AGIR
    // aberto, ou um que ela já leu nas últimas 26h. Tarefa vencida cuja (responsável,
    // família) não tem nenhum dos dois é o buraco — a mesma pergunta de antes ("o aviso
    // está passando?"), no grão certo.
    const semAviso: typeof vencidas = []
    if (vencidas.length) {
      const vencidasComFamilia = await prisma.tarefa.findMany({
        where: { id: { in: vencidas.map((t) => t.id) } },
        select: { id: true, processoId: true },
      })
      const familiaDe = new Map(vencidasComFamilia.map((t) => [t.id, t.processoId]))
      const resumos = await prisma.notificacaoOperacional.findMany({
        where: {
          tipo: 'PRECISA_AGIR', agrupado: true,
          destinatarioId: { in: [...new Set(vencidas.map((t) => t.responsavelId!))] },
          OR: [{ lidaEm: null }, { lidaEm: { gte: new Date(agora.getTime() - 26 * HORA) } }],
        },
        select: { destinatarioId: true, processoId: true },
      })
      const cobertos = new Set(resumos.map((r) => `${r.destinatarioId}|${r.processoId ?? 0}`))
      for (const t of vencidas) {
        if (!cobertos.has(`${t.responsavelId}|${familiaDe.get(t.id) ?? 0}`)) semAviso.push(t)
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
        explicacao: 'Os crons /api/cron/resumo-diario (07:00) e /api/cron/avisos-prazo (de hora em hora) mantêm um resumo por (pessoa, família). Tarefa vencida cuja pessoa/família não tem nenhum resumo significa que ele não está passando.',
        impacto: 'O prazo vence e o responsável não fica sabendo — a fila continua correta e ninguém é avisado.',
        entidade: 'Tarefa',
        registroId: String(maisAntiga.id),
        quantidade: semAviso.length,
        link: '/operacao',
        recomendacao: 'Verifique o cron na Vercel e rode /api/cron/avisos-prazo?ensaio=1 para conferir o que seria enviado.',
        evidencia: { total: semAviso.length, amostra: semAviso.slice(0, 10).map((t) => ({ id: t.id, prazo: t.dataPrazo })) },
      })
    }

    // ESCOPO É "COM RESPONSÁVEL", NÃO "TODA TAREFA VENCIDA" — achado real
    // (28/09/2026): a tarefa 3827 estava vencida (TAR-002 contava 1), mas
    // sem responsável — o filtro `responsavelId: { not: null }` acima
    // corretamente a exclui daqui (não há para quem avisar). O resumo dizia
    // "Nenhuma tarefa vencida", que lido ao lado de TAR-002 ("1 vencida")
    // parecia contradição — a chave `vencidas` também colidia por nome com a
    // métrica de TAR-002, que mede outra população. Os dois nomes agora
    // deixam o recorte explícito.
    return {
      achados,
      metricas: { vencidasComResponsavel: vencidas.length, semAviso: semAviso.length },
      resumo: vencidas.length
        ? `${vencidas.length} tarefa(s) vencida(s) com responsável, ${semAviso.length} sem aviso.`
        : 'Nenhuma tarefa vencida COM RESPONSÁVEL — nada a avisar (ver TAR-002 para o total de tarefas vencidas, com ou sem dono).',
    }
  },
})

// ── RECONCILIAÇÃO DE FASES ──────────────────────────────────────────────────
//
// Este cron não deixa rastro quando nada muda — e é justamente esse o silêncio
// perigoso: ele parar de rodar é indistinguível de ele rodar e não ter o que fazer.
// O que se vigia, então, não é o job: é o EFEITO dele. Um processo cujo gate está
// satisfeito e que continua parado prova que ninguém está convergindo o motor.

registrar({
  id: 'saude.cron.reconciliacao-convergindo',
  codigo: 'CRON-005',
  nome: 'A reconciliação de fases está convergindo',
  descricao:
    'O cron horário /api/cron/reconciliar-fases avança os processos cujo gate já está satisfeito. ' +
    'Processo pronto para avançar e parado há horas é prova de que a varredura não está acontecendo.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 45_000,
  orientacao: 'Confira o cron /api/cron/reconciliar-fases na Vercel e o CRON_SECRET do ambiente.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const { calcularPendencias } = await import('@/src/lib/motor/blocking-engine')
    const processos = await prisma.processo.findMany({
      // "Aguardando fechamento" (`a_iniciar`) fora da amostra: ela só sai por decisão humana (sem tarefa, o gate é "0 exigido = 100%"),
      // então "pode avançar e não avançou" seria falso positivo permanente para todo processo que ainda espera o fechamento.
      where: { workflowRuntime: 'v2', faseAtualKey: { not: null, notIn: [PHASEKEY_A_INICIAR] }, dataConclusao: null },
      select: { id: true, nome: true, faseAtualKey: true, updatedAt: true },
      orderBy: { id: 'asc' },
      // AMOSTRA, não varredura: esta verificação roda a cada hora junto com dezenas de
      // outras. Um processo parado indevidamente não fica sozinho por muito tempo.
      take: 40,
    })
    const limite = Date.now() - 3 * 60 * 60 * 1000
    const parados: Array<{ id: number; nome: string; fase: string }> = []
    for (const p of processos) {
      // Mexido há pouco não é sintoma: o reconciliador roda de hora em hora, e um
      // processo que acabou de mudar ainda não teve a passagem dele.
      if (p.updatedAt.getTime() > limite) continue
      // Fase "processo" (checklist + avanço MANUAL, por definição do catálogo)
      // satisfeita e parada não é sintoma de cron silencioso — é o comportamento
      // correto: a varredura automática se recusa a avançar essas fases sozinha
      // (ver AVANCO_MANUAL_OBRIGATORIO em phase-advance.ts). Sinalizar isso aqui
      // como "cron parado" seria falso positivo permanente para todo processo
      // nessas fases, todo dia, para sempre.
      const faseCode = phaseKeyToFaseCode(p.faseAtualKey)
      if (faseCode && isProcessoFase(faseCode)) continue
      const g = await calcularPendencias(p.id, p.faseAtualKey!, { correlationId: `saude-reconc-${p.id}` }).catch(() => null)
      // Genealogia zerada por ESCOLHA MANUAL (todas as certidões desmarcadas na árvore): o processo espera decisão humana, de propósito
      // (`AVANCO_MANUAL_OBRIGATORIO`) — "pode avançar e não avançou" seria falso positivo permanente.
      if (g?.canAdvance && (await processoParadoPorEscolhaManual(p.id, p.faseAtualKey))) continue
      if (g?.canAdvance) parados.push({ id: p.id, nome: p.nome, fase: p.faseAtualKey! })
    }
    if (!parados.length) {
      return { achados: [], metricas: { avaliados: processos.length, prontosEParados: 0 }, resumo: `${processos.length} processo(s) avaliado(s); nenhum pronto para avançar e parado.` }
    }
    return {
      achados: parados.map((p): Achado => ({
        chave: `reconc-parado:${p.id}`,
        severidade: 'ERRO',
        titulo: `"${p.nome}" pode avançar de ${p.fase} e não avançou`,
        descricao: 'O gate da fase está satisfeito há mais de três horas e o processo continua nela.',
        explicacao: 'O reconciliador horário existe para fechar exatamente essa distância entre "pode avançar" e "avançou". Se ela persiste, ele não está rodando.',
        impacto: 'Processos param sozinhos sem que ninguém receba erro — o silêncio parece normalidade.',
        entidade: 'Processo', registroId: String(p.id), registroNome: p.nome, quantidade: 1,
        link: `/kanban?processo=${p.id}`,
        recomendacao: 'Verifique o agendamento e os logs de /api/cron/reconciliar-fases.',
        evidencia: { processoId: p.id, fase: p.fase },
      })),
      metricas: { avaliados: processos.length, prontosEParados: parados.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// TOR-001 — OS DOIS CRONS DA TORRE (indicadores e regras) — vigilância (30/09/2026, autorizado)
// ═══════════════════════════════════════════════════════════════════════════
// COB-001 acusava `/api/cron/torre-indicadores` e `/api/cron/torre-regras` como jobs sem vigia. Vigiar não é
// citar o nome: é provar que o job deixou o RASTRO que só ele deixa.
//   · torre-indicadores (diário 09:00 UTC) grava a foto do dia em `TorreIndicadorDiario` — a tendência dos KPIs
//     da Torre depende dela. Foto mais nova com mais de 2 dias = o cron não está rodando.
//   · torre-regras (de hora em hora) só deixa rastro (`REGRA_TORRE_EXECUTADA`) quando a regra r1 está LIGADA.
//     Com r1 desligada (o padrão) o cron é inofensivo e não escreve nada — não há o que cobrar. Com r1 ligada,
//     nenhuma execução nas últimas 3 h = o cron parou.
registrar({
  id: 'saude.cron.torre',
  codigo: 'TOR-001',
  nome: 'Os crons da Torre estão rodando',
  descricao: 'Vigia /api/cron/torre-indicadores (foto diária dos KPIs em TorreIndicadorDiario) e /api/cron/torre-regras (execução horária da regra r1, quando ligada).',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.1.0',
  timeoutMs: 20_000,
  orientacao: 'Confira na Vercel os crons /api/cron/torre-indicadores e /api/cron/torre-regras; rode ?ensaio=1 para ver o que fariam.',
  rotaCorrecao: '/torre',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const agora = Date.now()
    const achados: Achado[] = []
    const ultima = await prisma.torreIndicadorDiario.findFirst({ orderBy: { data: 'desc' }, select: { data: true } })
    const idadeDias = ultima ? Math.floor((agora - ultima.data.getTime()) / 86_400_000) : null
    if (ultima && idadeDias! > 2) {
      achados.push({
        chave: 'torre-indicadores-parado',
        severidade: 'ALERTA',
        titulo: `A foto diária dos KPIs da Torre está ${idadeDias} dias atrasada`,
        descricao: `A última foto gravada é de ${ultima.data.toISOString().slice(0, 10)}; o cron /api/cron/torre-indicadores roda todo dia às 09:00 UTC.`,
        explicacao: 'A tendência (▲/▼ vs semana passada) dos KPIs da Torre é lida dessa foto. Sem o cron, ela envelhece e passa a comparar com um passado que não é o de ontem.',
        impacto: 'Os KPIs continuam corretos; só a tendência fica defasada.',
        entidade: 'TorreIndicadorDiario', quantidade: 1, link: '/torre',
        recomendacao: 'Verifique o cron /api/cron/torre-indicadores na Vercel (e o bloqueio de crons no middleware).',
        evidencia: { ultimaFoto: ultima.data.toISOString(), idadeDias },
      })
    }
    const { lerRegras } = await import('@/lib/operacional/regras-torre')
    const r1 = (await lerRegras()).find((r) => r.chave === 'r1')
    let ultimaExecucaoR1: Date | null = null
    if (r1?.ativa) {
      const e = await prisma.logAuditoria.findFirst({ where: { acao: 'REGRA_TORRE_EXECUTADA', entidade: 'RegraTorre' }, orderBy: { id: 'desc' }, select: { criadoEm: true } })
      ultimaExecucaoR1 = e?.criadoEm ?? null
      if (!ultimaExecucaoR1 || agora - ultimaExecucaoR1.getTime() > 3 * 3_600_000) {
        achados.push({
          chave: 'torre-regras-parado',
          severidade: 'ALERTA',
          titulo: 'A regra r1 está LIGADA mas o cron horário não a executa',
          descricao: ultimaExecucaoR1 ? `A última execução registrada é de ${ultimaExecucaoR1.toISOString()}.` : 'Nenhuma execução registrada.',
          explicacao: 'Com r1 ligada, /api/cron/torre-regras roda de hora em hora e grava REGRA_TORRE_EXECUTADA a cada execução.',
          impacto: 'Tarefas sem dono deixam de ser atribuídas automaticamente por país e fase.',
          entidade: 'RegraTorre', registroId: 'r1', quantidade: 1, link: '/torre',
          recomendacao: 'Verifique o cron /api/cron/torre-regras na Vercel (e o bloqueio de crons no middleware).',
          evidencia: { ultimaExecucaoR1: ultimaExecucaoR1?.toISOString() ?? null },
        })
      }
    }
    return {
      achados,
      metricas: { idadeFotoDias: idadeDias ?? -1, r1Ligada: r1?.ativa ? 1 : 0 },
      resumo: `Foto dos KPIs ${ultima ? `de ${ultima.data.toISOString().slice(0, 10)}` : 'ainda não gravada (o primeiro cron roda às 09:00 UTC)'}; regra r1 ${r1?.ativa ? 'ligada' : 'desligada — o cron não tem o que fazer'}.`,
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// CRON-006 — OS SEIS CRONS QUE NÃO DEIXAVAM RASTRO (09/10/2026)
// ═══════════════════════════════════════════════════════════════════════════
// COB-001 acusava /api/cron/avisos-prazo, /api/cron/resumo-diario, /api/cron/cartorios, /api/cron/coleta-purga, /api/cron/coleta-orfaos e
// /api/cron/conferidor-orfaos como jobs sem vigia. Cada um agora grava, ao terminar bem, a hora da última passagem (`lib/operacional/cron-rastro.ts`);
// aqui se cobra a idade desse rastro contra o ritmo do vercel.json (hora em hora, diário, semanal).
registrar({
  id: 'saude.cron.rastro-dos-jobs',
  codigo: 'CRON-006',
  nome: 'Os jobs avisos-prazo, resumo-diario, cartorios, coleta-purga, coleta-orfaos e conferidor-orfaos estão rodando',
  descricao: 'Vigia /api/cron/avisos-prazo, /api/cron/resumo-diario, /api/cron/cartorios, /api/cron/coleta-purga, /api/cron/coleta-orfaos e /api/cron/conferidor-orfaos pela hora da última passagem que cada um grava ao terminar bem.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Plataforma / Jobs agendados',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.2.0',
  timeoutMs: 15_000,
  orientacao: 'Confira o cron na Vercel (agendamento, CRON_SECRET e o bloqueio de crons no middleware) e rode-o à mão com ?ensaio=1 quando houver.',
  rotaCorrecao: '/administrator?screen=syshealth',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const { CRONS_COM_RASTRO, chaveDoRastro, situacaoDoRastro } = await import('@/lib/operacional/cron-rastro')
    const agora = new Date()
    const registros = await prisma.configuracaoSistema.findMany({ where: { chave: { in: CRONS_COM_RASTRO.map((c) => chaveDoRastro(c.chave)) } }, select: { chave: true, valor: true } })
    const porChave = new Map(registros.map((r) => [r.chave, r.valor ? new Date(r.valor) : null]))
    const achados: Achado[] = []
    for (const c of CRONS_COM_RASTRO) {
      const ultimo = porChave.get(chaveDoRastro(c.chave)) ?? null
      const s = situacaoDoRastro({ ultimo: ultimo && !Number.isNaN(ultimo.getTime()) ? ultimo : null, agora, maxHoras: c.maxHoras })
      if (!s.atrasado) continue
      achados.push({
        chave: `cron-sem-rastro:${c.chave}`,
        severidade: 'ALERTA',
        titulo: `O job /api/cron/${c.chave} (${c.descricao}) não deixa rastro há ${Math.floor(s.horas)} h`,
        descricao: s.nuncaRodou ? `Nenhuma passagem registrada desde que o rastro existe (09/10/2026); o esperado é no máximo ${c.maxHoras} h entre passagens.` : `A última passagem registrada é de ${ultimo!.toISOString()}; o esperado é no máximo ${c.maxHoras} h entre passagens.`,
        explicacao: 'Um cron parado não emite erro, emite silêncio. Este job grava a hora em que terminou bem; sem ela recente, ele não está rodando (ou está falhando antes de terminar).',
        impacto: 'O trabalho do job fica por fazer sem que ninguém perceba.',
        entidade: 'Cron', registroId: c.chave, quantidade: 1, link: '/administrator?screen=syshealth',
        recomendacao: `Verifique o agendamento e os logs de /api/cron/${c.chave} na Vercel.`,
        evidencia: { cron: c.chave, ultimo: ultimo?.toISOString() ?? null, maxHoras: c.maxHoras },
      })
    }
    return { achados, metricas: { crons: CRONS_COM_RASTRO.length, atrasados: achados.length }, resumo: `${CRONS_COM_RASTRO.length} job(s) vigiado(s) pelo rastro da última passagem; ${achados.length} atrasado(s).` }
  },
})
