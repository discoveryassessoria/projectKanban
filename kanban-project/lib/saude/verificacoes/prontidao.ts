// lib/saude/verificacoes/prontidao.ts
//
// PRONTIDÃO OPERACIONAL como VERIFICAÇÃO — é assim que a capacidade bloqueada
// entra no estado geral do sistema, no plano de correção e no histórico.
//
// Aqui também entram as verificações de superfície (cobertura do que existe) e
// o smoke HTTP autenticado.

import { registrar } from '../catalogo'
import { avaliarCapacidades, capacidades, PRONTIDAO_LABEL } from '../capacidades'
import { avaliarContratos } from '../contratos'
import { lacunasDeCobertura, mapearSuperficie } from '../superficie'
import { executarSmoke } from '../smoke'
import type { Achado, ResultadoVerificacao } from '../tipos'

registrar({
  id: 'saude.prontidao.capacidades',
  codigo: 'PRO-001',
  nome: 'Capacidades operacionais prontas',
  descricao: 'Avalia, para cada operação de negócio, se TODAS as dependências obrigatórias estão atendidas — cadastro, configuração, vínculo, automação, permissão e infraestrutura.',
  dominio: 'PONTA_A_PONTA',
  modulo: 'Prontidão Operacional',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 60_000,
  orientacao: 'Resolva as dependências na ordem do Plano de Correção — a primeira costuma destravar as demais.',
  rotaCorrecao: '/administrator?screen=syshealth',
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const avaliadas = await avaliarCapacidades()
    const achados: Achado[] = []

    for (const c of avaliadas) {
      if (c.estado === 'PRONTO') continue
      const severidade = c.estado === 'PARCIALMENTE_PRONTO'
        ? 'ALERTA'
        : c.estado === 'DIAGNOSTICO_INCOMPLETO'
          ? 'ERRO'
          : c.severidadeFalha
      achados.push({
        chave: `capacidade:${c.codigo}`,
        severidade,
        titulo: `${c.nome}: ${PRONTIDAO_LABEL[c.estado]}`,
        descricao: c.motivo,
        explicacao: `A capacidade "${c.operacao}" depende de ${c.dependencias.length} requisito(s). ${c.faltantes.length} não está(ão) atendido(s): ${c.faltantes.map((d) => `${d.nome} — ${d.detalhe}`).join(' · ')}`,
        impacto: c.estado === 'PARCIALMENTE_PRONTO'
          ? `A operação "${c.operacao}" funciona de forma incompleta.`
          : `A operação "${c.operacao}" não pode ser executada.`,
        entidade: 'Capacidade',
        registroId: c.codigo,
        registroNome: c.nome,
        quantidade: c.faltantes.length,
        link: c.faltantes.find((d) => d.rota)?.rota ?? '/administrator?screen=syshealth',
        recomendacao: c.faltantes[0]?.acao ?? 'Resolva as dependências listadas.',
        correcaoAutomatica: c.faltantes.find((d) => d.correcaoAutomatica)?.correcaoAutomatica ?? null,
        evidencia: {
          estado: c.estado,
          modulo: c.modulo,
          dependencias: c.dependencias.map((d) => ({ nome: d.nome, tipo: d.tipo, obrigatoria: d.obrigatoria, ok: d.ok, detalhe: d.detalhe })),
        },
      })
    }

    const prontas = avaliadas.filter((c) => c.estado === 'PRONTO').length
    return {
      achados,
      metricas: {
        capacidades: avaliadas.length,
        prontas,
        parciais: avaliadas.filter((c) => c.estado === 'PARCIALMENTE_PRONTO').length,
        bloqueadas: avaliadas.filter((c) => ['BLOQUEADO', 'NAO_CONFIGURADO', 'CONFIGURACAO_INVALIDA'].includes(c.estado)).length,
        indeterminadas: avaliadas.filter((c) => c.estado === 'DIAGNOSTICO_INCOMPLETO').length,
      },
      resumo: `${prontas}/${avaliadas.length} capacidade(s) operacional(is) prontas.`,
    }
  },
})

registrar({
  id: 'saude.prontidao.contratos-cadastro',
  codigo: 'PRO-002',
  nome: 'Cadastros ativos cumprem o contrato mínimo',
  descricao: 'Cadastro ATIVO promete estar utilizável. Verifica se cada registro ativo tem o que precisa para ser usado de verdade.',
  dominio: 'DUPLICIDADES',
  modulo: 'Cadastros mestres',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 40_000,
  orientacao: 'Complete os campos faltantes ou inative o registro enquanto ele não estiver pronto para uso.',
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const contratos = await avaliarContratos()
    const achados: Achado[] = []
    for (const c of contratos) {
      if (!c.incompletos.length) continue
      const faltas = new Map<string, number>()
      for (const i of c.incompletos) for (const f of i.faltando) faltas.set(f, (faltas.get(f) ?? 0) + 1)
      achados.push({
        chave: `contrato:${c.cadastro}`,
        severidade: 'ALERTA',
        titulo: `${c.incompletos.length} registro(s) incompleto(s) em ${c.rotulo}`,
        descricao: `${c.incompletos.length} de ${c.totalAtivos} registro(s) ativo(s) não cumprem o contrato mínimo de uso.`,
        explicacao: `Faltando: ${[...faltas.entries()].map(([f, n]) => `${f} (${n})`).join(', ')}. Contrato: ${c.requisitos.join(', ')}.`,
        impacto: 'Registro ativo mas incompleto falha na HORA DO USO, não no cadastro — o erro aparece para o operador no meio da operação.',
        entidade: c.cadastro,
        quantidade: c.incompletos.length,
        link: c.rota,
        recomendacao: `Complete os campos faltantes em ${c.rotulo}.`,
        evidencia: { requisitos: c.requisitos, amostra: c.incompletos.slice(0, 10) },
      })
    }
    return {
      achados,
      metricas: Object.fromEntries(contratos.map((c) => [c.cadastro, c.incompletos.length])),
      resumo: `${contratos.length} contrato(s) de prontidão verificados, todos cumpridos.`,
    }
  },
})

registrar({
  id: 'saude.cobertura.superficie',
  codigo: 'COB-001',
  nome: 'Toda a superfície do sistema é vigiada',
  descricao: 'Compara a superfície REAL (rotas, páginas, menus, entidades, crons, eventos) com o que o catálogo verifica. Lacuna de vigilância impede declarar saudável.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Cobertura',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 30_000,
  orientacao: 'Crie verificação ou capacidade para o alvo descoberto — o que não é vigiado não pode ser declarado saudável.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const s = mapearSuperficie()
    const lacunas = lacunasDeCobertura(s)
    const achados: Achado[] = []
    if (lacunas.length) {
      const porTipo = new Map<string, string[]>()
      for (const l of lacunas) {
        const atual = porTipo.get(l.tipo) ?? []
        atual.push(l.alvo)
        porTipo.set(l.tipo, atual)
      }
      for (const [tipo, alvos] of porTipo) {
        achados.push({
          chave: `lacuna-cobertura:${tipo}`,
          severidade: tipo === 'MENU' ? 'ERRO' : 'ALERTA',
          titulo: `${alvos.length} ${tipo.toLowerCase()}(s) sem vigilância`,
          descricao: `Sem verificação correspondente: ${alvos.slice(0, 8).join(', ')}${alvos.length > 8 ? '…' : ''}.`,
          explicacao: 'A superfície é descoberta automaticamente e comparada com o catálogo. O que não tem verificação não é observado — e ausência de alarme não é ausência de problema.',
          impacto: 'Falhas nesse alvo não seriam detectadas pelo diagnóstico.',
          entidade: tipo,
          quantidade: alvos.length,
          recomendacao: 'Declare uma verificação ou capacidade que cubra este alvo.',
          evidencia: { alvos },
        })
      }
    }
    return {
      achados,
      metricas: {
        paginas: s.paginas.length, apis: s.apis.length, apisAdministrativas: s.apisAdministrativas.length,
        telas: s.telasGerenciamento.length, itensDeMenu: s.itensDeMenu.length,
        entidades: s.entidades.length, crons: s.crons.length, tiposEvento: s.tiposEvento.length,
        capacidades: capacidades().length, lacunas: lacunas.length,
      },
      resumo: `Superfície: ${s.paginas.length} páginas · ${s.apis.length} APIs · ${s.entidades.length} entidades · ${s.crons.length} crons — toda vigiada.`,
    }
  },
})

registrar({
  id: 'saude.rotas.smoke-autenticado',
  codigo: 'SMK-001',
  nome: 'Smoke HTTP autenticado das rotas essenciais',
  descricao: 'Visita as rotas essenciais COM identidade técnica de curta duração e valida status, payload e tempo. Rota respondendo 401 não conta como testada.',
  dominio: 'APIS',
  modulo: 'Smoke',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 120_000,
  orientacao: 'Investigue a rota que falhou: 404 indica rota removida; 500, erro de execução; 401 com identidade técnica, problema de autorização.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await executarSmoke()
    const achados: Achado[] = []

    // Se TODAS as rotas recusaram a identidade, o problema é a identidade
    // (segredo de outro ambiente), não nove rotas quebradas. Reportar nove
    // alertas aqui seria alarme falso — e alarme falso mata a confiança no
    // painel mais rápido do que a ausência de alarme.
    const todasRecusaram = r.rotas.length > 0 && r.rotas.every((x) => x.status === 401 || x.status === 403)
    if (todasRecusaram) {
      return {
        achados: [{
          chave: 'smoke-identidade-recusada',
          severidade: 'ERRO',
          titulo: `Nenhuma rota pôde ser visitada em ${r.base}`,
          descricao: `As ${r.rotas.length} rotas recusaram a identidade técnica (401/403).`,
          explicacao: 'O token é assinado com o segredo do ambiente em execução. Recusa em todas as rotas significa que o smoke está apontando para um host que usa outro segredo — as rotas não foram testadas, e isso não é o mesmo que estarem quebradas.',
          impacto: 'As rotas essenciais permanecem sem verificação de resposta real.',
          entidade: 'Smoke',
          quantidade: r.rotas.length,
          recomendacao: 'Execute o diagnóstico profundo a partir do próprio ambiente, ou aponte SAUDE_SMOKE_BASE_URL para o host cujo segredo é o mesmo.',
          evidencia: { base: r.base, rotas: r.rotas.length },
        }],
        metricas: { rotas: r.rotas.length, ok: 0, falhas: 0, lentas: 0, naoTestadas: r.rotas.length },
        resumo: `Nenhuma rota testada em ${r.base}.`,
      }
    }

    if (!r.autenticado) {
      achados.push({
        chave: 'smoke-sem-identidade',
        severidade: 'ERRO',
        titulo: 'Smoke não pôde autenticar',
        descricao: `As rotas protegidas não foram visitadas: ${r.motivoSemAutenticacao ?? 'identidade técnica indisponível'}.`,
        explicacao: 'Rota protegida devolvendo 401 não é rota testada — é rota não visitada. Sem identidade técnica, o smoke não prova nada.',
        impacto: 'Não há garantia de que as rotas essenciais respondem corretamente.',
        entidade: 'Smoke',
        quantidade: r.rotas.length,
        recomendacao: 'Garanta JWT_SECRET no ambiente e ao menos um administrador cadastrado.',
        evidencia: { base: r.base, motivo: r.motivoSemAutenticacao },
      })
    }

    // Rota que não pôde sequer ser alcançada NÃO pode passar em silêncio:
    // "não testada" nunca é sinônimo de "saudável".
    const naoAlcancadas = r.rotas.filter((x) => x.status === 0)
    if (naoAlcancadas.length) {
      achados.push({
        chave: 'smoke-rotas-nao-alcancadas',
        severidade: 'ERRO',
        titulo: `${naoAlcancadas.length} rota(s) essenciais não puderam ser visitadas`,
        descricao: `Nenhuma resposta de ${r.base}: ${naoAlcancadas.slice(0, 5).map((x) => x.rota).join(', ')}${naoAlcancadas.length > 5 ? '…' : ''}.`,
        explicacao: 'O smoke não obteve resposta do host — servidor fora do ar, rede bloqueada ou base apontando para um endereço que não existe naquele contexto de execução. Sem resposta não há prova de nada.',
        impacto: 'As rotas essenciais seguem sem verificação; uma quebra nelas não seria detectada.',
        entidade: 'Smoke',
        quantidade: naoAlcancadas.length,
        recomendacao: 'Ajuste SAUDE_SMOKE_BASE_URL para um host alcançável a partir do ambiente que executa o diagnóstico.',
        evidencia: { base: r.base, problemas: naoAlcancadas.slice(0, 5).map((x) => x.problema) },
      })
    }

    for (const rota of r.rotas.filter((x) => !x.ok && x.status !== 0)) {
      achados.push({
        chave: `smoke:${rota.rota}`,
        severidade: rota.status >= 500 || rota.status === 404 ? 'ERRO' : 'ALERTA',
        titulo: `${rota.rota} — ${rota.problema}`,
        descricao: `A rota respondeu ${rota.status} em ${rota.ms}ms.`,
        explicacao: 'O smoke visita a rota com identidade técnica válida e somente leitura.',
        impacto: rota.status >= 500 ? 'A funcionalidade que depende desta rota está quebrada em produção.' : 'A rota responde, mas fora do esperado.',
        entidade: 'Rota',
        registroId: rota.rota,
        quantidade: 1,
        link: rota.rota,
        recomendacao: 'Abra a rota e verifique o erro reportado.',
        evidencia: { status: rota.status, ms: rota.ms, bytes: rota.bytes, problema: rota.problema },
      })
    }

    return {
      achados,
      metricas: { rotas: r.rotas.length, ok: r.ok, falhas: r.falhas, lentas: r.lentas, naoTestadas: r.naoTestadas },
      resumo: `${r.ok}/${r.rotas.length} rota(s) essenciais responderam corretamente.`,
    }
  },
})

registrar({
  id: 'saude.processos.parados',
  codigo: 'PROC-006',
  nome: 'Processos reais conseguem seguir',
  descricao: 'Analisa processos REAIS parados: sem responsável, sem tarefa aberta e sem movimentação recente.',
  dominio: 'PROCESSOS',
  modulo: 'Processos',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 30_000,
  orientacao: 'Processo sem próxima ação não anda sozinho: atribua responsável ou gere a tarefa da fase.',
  rotaCorrecao: '/kanban',
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const { prisma } = await import('@/lib/prisma')
    const semProximaAcao = await prisma.$queryRawUnsafe<{ id: number; nome: string }[]>(
      `SELECT p.id, p.nome FROM "Processo" p
        WHERE p."dataConclusao" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "Tarefa" t WHERE t."processoId" = p.id AND t.concluida = false)
        LIMIT 100`,
    )
    // O MOTIVO JÁ FOI ESCRITO — BASTA LER. O materializador nomeia por que não
    // criou nada ("o passo opera por NECESSIDADE e o processo não tem certidão a
    // localizar") e grava isso na auditoria. Dizer só "sem tarefa aberta" obriga
    // quem lê o painel a abrir o banco para descobrir o que já está registrado.
    // Leitura pura: a verificação NÃO chama o materializador, que escreveria.
    const motivoPorProcesso = new Map<number, string>()
    if (semProximaAcao.length) {
      const logs = await prisma.logAuditoria.findMany({
        where: { acao: 'FASE_MATERIALIZADA', entidade: 'PROCESSO', entidadeId: { in: semProximaAcao.map((p) => p.id) } },
        select: { entidadeId: true, detalhes: true },
        orderBy: { criadoEm: 'desc' },
      })
      // Quem separa motivo ACIONÁVEL de nota de bastidor é o próprio
      // materializador. Repetir a lista aqui criaria uma segunda verdade que
      // envelheceria calada — e o primeiro motivo da lista é justamente uma
      // nota de bastidor ("Tipo inferido de createsTask=true"), inútil para
      // quem lê o painel.
      const { motivosAcionaveis } = await import('@/src/services/materializar-fase')
      for (const log of logs) {
        if (log.entidadeId == null || motivoPorProcesso.has(log.entidadeId)) continue
        const d = log.detalhes as { estado?: string; motivos?: { code: string; message?: string }[] } | null
        // O JSON da auditoria pode ter motivo sem mensagem; o filtro exige a
        // mensagem presente, então normaliza antes de entregar.
        const motivos = (d?.motivos ?? []).map((m) => ({ code: m.code, message: m.message ?? '' }))
        const acionaveis = motivosAcionaveis(motivos)
        const frase = acionaveis.find((m) => m.message)?.message ?? d?.motivos?.find((m) => m.message)?.message
        if (frase) motivoPorProcesso.set(log.entidadeId, `${d?.estado ?? '?'} — ${frase}`)
      }
    }

    const comMotivo = semProximaAcao.map((p) => ({
      id: p.id, nome: p.nome,
      motivo: motivoPorProcesso.get(p.id) ?? 'sem registro de materialização — a fase pode nunca ter sido materializada',
    }))

    const achados: Achado[] = []
    if (semProximaAcao.length) {
      const primeiro = comMotivo[0]
      achados.push({
        chave: 'processo-sem-proxima-acao',
        severidade: 'ALERTA',
        titulo: `${semProximaAcao.length} processo(s) sem próxima ação`,
        descricao: `${primeiro.nome} (#${primeiro.id}): ${primeiro.motivo}`,
        explicacao: 'Sem tarefa aberta, ninguém tem o que fazer no processo — ele fica parado sem aparecer em nenhuma fila. O motivo acima é o que o materializador registrou quando tentou criar as tarefas da fase.',
        impacto: 'Processo estagnado sem sinal visível para a operação.',
        entidade: 'Processo',
        registroId: String(primeiro.id),
        registroNome: primeiro.nome,
        quantidade: semProximaAcao.length,
        link: `/kanban?processoId=${primeiro.id}`,
        recomendacao: 'Leia o motivo: SEM_ALVO_APLICAVEL quase sempre significa que a fase só tem passos que operam sobre uma entidade que o processo ainda não tem — é cadastro do workflow da fase, não falha de execução.',
        evidencia: { total: semProximaAcao.length, amostra: comMotivo.slice(0, 10) },
      })
    }
    return { achados, metricas: { semProximaAcao: semProximaAcao.length }, resumo: 'Todo processo em andamento tem próxima ação.' }
  },
})
