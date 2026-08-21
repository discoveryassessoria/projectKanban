// lib/saude/verificacoes/cadastro-execucao.ts
//
// A ARQUITETURA DECLARATIVA SE VIGIA.
//
// De nada adianta a publicação recusar configuração inválida se o que JÁ ESTÁ no
// banco puder ficar inconsistente por outro caminho — um passo apagado deixando
// dependência pendurada, um efeito removido do catálogo deixando ação órfã, uma
// execução sem tentativa, duas tentativas vigentes.
//
// Estas verificações rodam continuamente e transformam cada uma dessas classes de
// falha em pergunta respondida por número. "Nunca aconteceu" não é a mesma coisa que
// "não pode acontecer"; o que dá para provar aqui é a primeira, e é ela que avisa
// quando a segunda deixar de valer.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { efeitoExiste, efeitosDaFase } from '@/src/lib/motor/catalogo-de-efeitos'
import { detectarCiclo } from '@/src/services/validacao-de-publicacao'

const ROTA_INTERNO = '/administrator?screen=phaseiwf'
const ROTA_CANAIS = '/administrator?screen=canais'
const ROTA_FASES = '/administrator?screen=fases'

const vazio = (metricas: Record<string, number>, resumo: string): ResultadoVerificacao => ({ achados: [], metricas, resumo })

// ── EXECUÇÃO / TENTATIVA ────────────────────────────────────────────────────

registrar({
  id: 'saude.execucao.tentativa-vigente-duplicada',
  codigo: 'EXE-001',
  nome: 'Uma tentativa vigente por etapa',
  descricao: 'Duas tentativas não substituídas na mesma etapa tornam "qual é a execução atual?" ambígua.',
  dominio: 'WORKFLOW',
  modulo: 'Execução da etapa',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 15_000,
  orientacao: 'O banco tem índice parcial que impede isso. Se apareceu, o índice não está aplicado no alvo.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ stepInstanceId: number; n: bigint }>>(
      `SELECT "stepInstanceId", COUNT(*) AS n FROM "StepExecution" WHERE "supersededAt" IS NULL GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 50`,
    )
    if (!linhas.length) return vazio({ duplicadas: 0 }, 'Cada etapa tem no máximo uma tentativa vigente.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `tentativa-dupla:${l.stepInstanceId}`,
        severidade: 'CRITICO',
        titulo: `Etapa #${l.stepInstanceId} tem ${Number(l.n)} tentativas vigentes`,
        descricao: 'Mais de uma tentativa sem `supersededAt` na mesma etapa.',
        explicacao: 'A tentativa vigente é a única não substituída. Havendo duas, "a execução atual" deixa de ter resposta única.',
        impacto: 'Progresso, prazo e histórico da etapa passam a depender de qual linha for lida primeiro.',
        entidade: 'StepExecution', registroId: String(l.stepInstanceId), quantidade: Number(l.n),
        link: ROTA_INTERNO,
        recomendacao: 'Confirme que o índice StepExecution_uma_vigente_por_passo existe no banco deste ambiente.',
        evidencia: { stepInstanceId: l.stepInstanceId, vigentes: Number(l.n) },
      })),
      metricas: { duplicadas: linhas.length },
    }
  },
})

registrar({
  id: 'saude.execucao.etapa-sem-tentativa',
  codigo: 'EXE-002',
  nome: 'Toda etapa tem tentativa',
  descricao: 'Etapa sem nenhuma tentativa não sabe responder quando foi executada nem por quem.',
  dominio: 'WORKFLOW',
  modulo: 'Execução da etapa',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 20_000,
  orientacao: 'Rode `npm run backfill:tentativas -- --execute`. É idempotente.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const n = await prisma.phaseWorkflowStepInstance.count({ where: { execucoes: { none: {} } } })
    if (n === 0) return vazio({ semTentativa: 0 }, 'Toda etapa tem ao menos uma tentativa registrada.')
    return {
      achados: [{
        chave: 'etapas-sem-tentativa',
        severidade: 'ALERTA',
        titulo: `${n} etapa(s) sem tentativa registrada`,
        descricao: 'Existem etapas que não têm nenhuma linha em StepExecution.',
        explicacao: 'A tentativa é onde ficam início, fim, autor e resultado de cada execução. Sem ela, reabrir a etapa apagaria a informação em vez de arquivá-la.',
        impacto: 'O histórico dessas etapas não sobrevive a uma reabertura.',
        entidade: 'PhaseWorkflowStepInstance', quantidade: n,
        link: ROTA_INTERNO,
        recomendacao: 'Execute o backfill de tentativas; ele cria uma por etapa a partir do estado atual.',
        evidencia: { etapas: n },
      }],
      metricas: { semTentativa: n },
    }
  },
})

// ── CADASTRO DECLARATIVO ────────────────────────────────────────────────────

registrar({
  id: 'saude.cadastro.acao-com-efeito-invalido',
  codigo: 'CAD-001',
  nome: 'Ação aponta para efeito existente',
  descricao: 'Ação cujo effectKey saiu do catálogo vira um botão que não faz nada.',
  dominio: 'WORKFLOW',
  modulo: 'Ações da etapa',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 15_000,
  orientacao: 'Reaponte a ação para um efeito do catálogo, ou desative-a.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const acoes = await prisma.stepAction.findMany({
      where: { ativo: true },
      select: { id: true, key: true, label: true, effectKey: true, step: { select: { key: true, workflow: { select: { name: true, phaseKey: true } } } } },
    })
    const ruins = acoes.filter((a) => !efeitoExiste(a.effectKey))
    if (!ruins.length) return vazio({ acoes: acoes.length, invalidas: 0 }, `${acoes.length} ação(ões) cadastrada(s), todas apontando para efeitos existentes.`)
    return {
      achados: ruins.map((a): Achado => ({
        chave: `acao-efeito-invalido:${a.id}`,
        severidade: 'ERRO',
        titulo: `"${a.label}" aponta para o efeito inexistente ${a.effectKey}`,
        descricao: `A ação "${a.key}" do passo "${a.step.key}" (${a.step.workflow.name}) referencia um efeito que não está no catálogo.`,
        explicacao: 'O efeito é o que a ação faz. Sem ele, escolher esse resultado é recusado na execução.',
        impacto: 'O operador vê uma opção que não executa.',
        entidade: 'StepAction', registroId: String(a.id), registroNome: a.label, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Abra o passo, aba Ações/Resultados, e escolha um efeito válido para esta fase.',
        evidencia: { acaoId: a.id, effectKey: a.effectKey, phaseKey: a.step.workflow.phaseKey },
      })),
      metricas: { acoes: acoes.length, invalidas: ruins.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.acao-fora-de-competencia',
  codigo: 'CAD-002',
  nome: 'Ação dentro da competência da fase',
  descricao: 'Ação cujo efeito a fase não tem competência para executar — é assim que uma decisão vaza para a fase errada.',
  dominio: 'FASES',
  modulo: 'Competência da fase',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 20_000,
  orientacao: 'Ou a ação sai do passo, ou a fase passa a declarar essa competência — e isso é decisão de negócio.',
  rotaCorrecao: ROTA_FASES,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const acoes = await prisma.stepAction.findMany({
      where: { ativo: true },
      select: { id: true, key: true, label: true, effectKey: true, step: { select: { key: true, workflow: { select: { phaseKey: true, name: true } } } } },
    })
    const fases = new Map((await prisma.catalogoFase.findMany({ select: { phaseKey: true, efeitosPermitidos: true } }))
      .map((f) => [f.phaseKey, f.efeitosPermitidos]))
    const fora = acoes.filter((a) => {
      const pk = a.step.workflow.phaseKey
      return !efeitosDaFase(pk, fases.get(pk) ?? null).includes(a.effectKey)
    })
    if (!fora.length) return vazio({ acoes: acoes.length, foraDeCompetencia: 0 }, 'Nenhuma ação executa efeito fora da competência da fase.')
    return {
      achados: fora.map((a): Achado => ({
        chave: `acao-fora-competencia:${a.id}`,
        severidade: 'ERRO',
        titulo: `"${a.label}" usa ${a.effectKey}, fora da competência de ${a.step.workflow.phaseKey}`,
        descricao: `O passo "${a.step.key}" de "${a.step.workflow.name}" oferece um resultado que a fase não deveria poder tomar.`,
        explicacao: 'Competência é o que impede uma fase de decidir o que pertence a outra — foi por esse caminho que a decisão de retificação passou a poder ser tomada na Emissão.',
        impacto: 'A execução recusa a ação; o operador encontra um resultado que não funciona.',
        entidade: 'StepAction', registroId: String(a.id), registroNome: a.label, quantidade: 1,
        link: ROTA_FASES,
        recomendacao: 'Remova a ação do passo ou declare a competência na fase, se for mesmo dela.',
        evidencia: { acaoId: a.id, effectKey: a.effectKey, phaseKey: a.step.workflow.phaseKey },
      })),
      metricas: { acoes: acoes.length, foraDeCompetencia: fora.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.dependencia-quebrada',
  codigo: 'CAD-003',
  nome: 'Dependências válidas e sem ciclo',
  descricao: 'Dependência para passo inexistente trava a etapa para sempre; ciclo trava todas as envolvidas.',
  dominio: 'WORKFLOW',
  modulo: 'Dependências',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 20_000,
  orientacao: 'Abra o passo, aba Dependências, e corrija. A publicação recusa isso — se existe, veio de antes ou de escrita direta.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const wfs = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false },
      select: { id: true, name: true, passos: { select: { key: true, label: true, dependeDe: true } } },
    })
    const achados: Achado[] = []
    for (const wf of wfs) {
      const chaves = new Set(wf.passos.map((p) => p.key))
      for (const p of wf.passos) {
        const deps = Array.isArray(p.dependeDe) ? (p.dependeDe as string[]) : []
        for (const d of deps) {
          if (!chaves.has(d)) {
            achados.push({
              chave: `dep-inexistente:${wf.id}:${p.key}:${d}`, severidade: 'CRITICO',
              titulo: `"${p.label}" depende de "${d}", que não existe`,
              descricao: `Em "${wf.name}", o passo "${p.key}" declara dependência de um passo que não está no workflow.`,
              explicacao: 'Uma etapa fica disponível quando todas as dependências estiverem concluídas. Uma dependência que não existe nunca conclui.',
              impacto: 'A etapa nunca fica disponível e a fase não fecha.',
              entidade: 'PhaseInternalWorkflowStep', registroId: `${wf.id}:${p.key}`, registroNome: p.label, quantidade: 1,
              link: ROTA_INTERNO,
              recomendacao: 'Remova a dependência ou crie o passo que falta.',
              evidencia: { workflowId: wf.id, stepKey: p.key, dependencia: d },
            })
          }
        }
      }
      const ciclo = detectarCiclo(wf.passos.map((p) => ({
        key: p.key, label: p.label, dependeDe: Array.isArray(p.dependeDe) ? (p.dependeDe as string[]) : [],
      })))
      if (ciclo) {
        achados.push({
          chave: `dep-ciclo:${wf.id}`, severidade: 'CRITICO',
          titulo: `Ciclo de dependências em "${wf.name}"`,
          descricao: `As dependências formam o ciclo ${ciclo.join(' → ')}.`,
          explicacao: 'Cada passo do ciclo espera outro do mesmo ciclo. Nenhum começa.',
          impacto: 'A fase inteira fica parada.',
          entidade: 'PhaseInternalWorkflow', registroId: String(wf.id), registroNome: wf.name, quantidade: ciclo.length,
          link: ROTA_INTERNO,
          recomendacao: 'Quebre o ciclo removendo uma das dependências.',
          evidencia: { workflowId: wf.id, ciclo },
        })
      }
    }
    if (!achados.length) return vazio({ workflows: wfs.length, quebradas: 0 }, `${wfs.length} workflow(s) com dependências consistentes.`)
    return { achados, metricas: { workflows: wfs.length, quebradas: achados.length } }
  },
})

registrar({
  id: 'saude.cadastro.canais-vazio',
  codigo: 'CAD-004',
  nome: 'Canais de solicitação cadastrados',
  descricao: 'Com a tabela vazia, quem responde é a semente em código — e cadastrar canal novo não teria efeito.',
  dominio: 'CONFIGURACOES',
  modulo: 'Canais',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 10_000,
  orientacao: 'Rode `npm run seed:cadastro-canonico -- --execute`, que cria os canais com exatamente os valores da semente.',
  rotaCorrecao: ROTA_CANAIS,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const n = await prisma.canalOperacional.count()
    if (n > 0) return vazio({ canais: n }, `${n} canal(is) cadastrado(s).`)
    return {
      achados: [{
        chave: 'canais-vazio', severidade: 'ALERTA',
        titulo: 'Nenhum canal de solicitação cadastrado',
        descricao: 'A tabela de canais está vazia e a lista em código está respondendo no lugar dela.',
        explicacao: 'A semente evita que a tela de solicitação fique sem opção alguma numa janela de deploy. Mas enquanto ela responde, cadastrar um canal novo não muda nada.',
        impacto: 'O administrador cadastra um canal e ele não aparece.',
        entidade: 'CanalOperacional', quantidade: 0,
        link: ROTA_CANAIS,
        recomendacao: 'Execute o seed do cadastro canônico.',
        evidencia: { canais: 0 },
      }],
      metricas: { canais: 0 },
    }
  },
})

registrar({
  id: 'saude.cadastro.workflow-sem-versao-congelada',
  codigo: 'CAD-005',
  nome: 'Versão vigente congelada',
  descricao: 'Workflow cuja versão vigente não foi congelada não consegue dizer o que ele dizia quando um processo começou.',
  dominio: 'WORKFLOW',
  modulo: 'Versionamento',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 20_000,
  orientacao: 'Rode `npm run backfill:versao-publicada -- --execute`.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const wfs = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false }, select: { id: true, name: true, versao: true },
    })
    const congeladas = new Set((await prisma.phaseInternalWorkflowVersao.findMany({ select: { workflowId: true, versao: true } }))
      .map((v) => `${v.workflowId}|${v.versao}`))
    const faltando = wfs.filter((w) => !congeladas.has(`${w.id}|${w.versao}`))
    if (!faltando.length) return vazio({ workflows: wfs.length, semVersao: 0 }, `${wfs.length} workflow(s) com a versão vigente congelada.`)
    return {
      achados: faltando.map((w): Achado => ({
        chave: `wf-sem-versao:${w.id}`, severidade: 'ERRO',
        titulo: `"${w.name}" v${w.versao} não está congelada`,
        descricao: 'A versão vigente do workflow não tem conteúdo congelado.',
        explicacao: 'A versão congelada é o que uma execução lê para saber o que a configuração dizia no dia em que ela começou.',
        impacto: 'Execuções desse workflow não conseguem resolver a configuração histórica — nem os resultados que podiam ser escolhidos.',
        entidade: 'PhaseInternalWorkflow', registroId: String(w.id), registroNome: w.name, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Execute o backfill de versão publicada.',
        evidencia: { workflowId: w.id, versao: w.versao },
      })),
      metricas: { workflows: wfs.length, semVersao: faltando.length },
    }
  },
})

registrar({
  id: 'saude.documento.linhagem-consistente',
  codigo: 'DOC-L01',
  nome: 'Linhagem documental consistente',
  descricao: 'Documento derivado precisa apontar para uma origem existente e não pode ter mais de uma via vigente na mesma necessidade.',
  dominio: 'DOCUMENTOS',
  modulo: 'Linhagem',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 25_000,
  orientacao: 'Nova via cria documento novo e marca o anterior como substituído. Duas vias vigentes indicam escrita fora dessa porta.',
  rotaCorrecao: '/kanban',
  responsavel: 'Documentos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ necessidadeId: number; n: bigint }>>(
      `SELECT "necessidadeId", COUNT(*) AS n FROM "Documento"
        WHERE "necessidadeId" IS NOT NULL AND "substituidoEm" IS NULL AND "derivadoDeId" IS NOT NULL
        GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 50`,
    )
    const derivados = await prisma.documento.count({ where: { derivadoDeId: { not: null } } })
    if (!linhas.length) return vazio({ derivados, necessidadesComDuasVias: 0 }, `${derivados} documento(s) derivado(s), nenhuma necessidade com duas vias vigentes.`)
    return {
      achados: linhas.map((l): Achado => ({
        chave: `linhagem-duas-vias:${l.necessidadeId}`, severidade: 'ALERTA',
        titulo: `Necessidade #${l.necessidadeId} tem ${Number(l.n)} vias vigentes`,
        descricao: 'Mais de um documento derivado sem `substituidoEm` atendendo à mesma necessidade.',
        explicacao: 'A necessidade tem um documento vigente por vez; os anteriores continuam legíveis, marcados como substituídos.',
        impacto: '"Qual é o documento que vale?" passa a depender de qual linha for lida primeiro.',
        entidade: 'Documento', registroId: String(l.necessidadeId), quantidade: Number(l.n),
        link: '/kanban',
        recomendacao: 'Verifique qual via é a vigente e marque as demais como substituídas.',
        evidencia: { necessidadeId: l.necessidadeId, vigentes: Number(l.n) },
      })),
      metricas: { derivados, necessidadesComDuasVias: linhas.length },
    }
  },
})
