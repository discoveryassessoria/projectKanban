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
import { REGISTRO_DE_EXECUTORES } from '@/src/lib/motor/registro-de-executores'
import { executorEfetivo } from '@/src/services/validacao-de-publicacao'

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

// ── OPERAÇÃO: A TENTATIVA É A FONTE ─────────────────────────────────────────

registrar({
  id: 'saude.operacao.tentativa-e-fonte',
  codigo: 'OPE-001',
  nome: 'A operação da etapa vive na tentativa',
  descricao:
    'O que foi preenchido numa etapa pertence à EXECUÇÃO que o preencheu. Enquanto houver passo cuja ' +
    'operação só existe no blob antigo da linha, reexecutar essa etapa sobrescreveria o preenchimento anterior.',
  dominio: 'WORKFLOW',
  modulo: 'Operação da etapa',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.1.0',
  timeoutMs: 30_000,
  orientacao: 'Rode `npm run backfill:operacao -- --execute`. É idempotente e não apaga o blob.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const RESERVADAS = new Set(['acao', 'efeito', 'versaoDaConfiguracao', 'decididoEm', 'detalhes'])
    const passos = await prisma.phaseWorkflowStepInstance.findMany({
      select: { id: true, stepKey: true, metadata: true, execucoes: { where: { supersededAt: null }, select: { payload: true } } },
    })
    const soNoBlob: number[] = []
    const divergentes: number[] = []
    for (const p of passos) {
      const blob = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? null
      const chavesBlob = blob ? Object.keys(blob).filter((k) => !RESERVADAS.has(k)) : []
      if (chavesBlob.length === 0) continue
      const payload = (p.execucoes[0]?.payload ?? {}) as Record<string, unknown>
      const chavesTent = Object.keys(payload).filter((k) => !RESERVADAS.has(k))
      if (chavesTent.length === 0) { soNoBlob.push(p.id); continue }
      // DIVERGÊNCIA REAL: o blob tem campo que a tentativa não tem. O contrário é
      // normal — a tentativa recebe o que foi preenchido depois da troca de fonte.
      if (chavesBlob.some((k) => !(k in payload))) divergentes.push(p.id)
    }
    if (!soNoBlob.length && !divergentes.length) {
      return { achados: [], metricas: { passos: passos.length, soNoBlob: 0, divergentes: 0 }, resumo: 'Toda operação preenchida está na tentativa que a preencheu.' }
    }
    const achados: Achado[] = []
    if (soNoBlob.length) {
      achados.push({
        chave: 'operacao-so-no-blob', severidade: 'ALERTA',
        titulo: `${soNoBlob.length} etapa(s) com operação só no formato antigo`,
        descricao: 'O preenchimento dessas etapas está na linha do passo, não na tentativa.',
        explicacao: 'A linha do passo guarda um estado só. Reexecutar sobrescreveria o que a execução anterior registrou — o mesmo defeito do completedAt, uma camada acima.',
        impacto: 'O histórico de preenchimento dessas etapas não sobrevive a uma reexecução.',
        entidade: 'PhaseWorkflowStepInstance', quantidade: soNoBlob.length,
        link: ROTA_INTERNO, recomendacao: 'Execute o backfill da operação para a tentativa.',
        evidencia: { exemplos: soNoBlob.slice(0, 10) },
      })
    }
    if (divergentes.length) {
      achados.push({
        chave: 'operacao-divergente', severidade: 'ERRO',
        titulo: `${divergentes.length} etapa(s) com blob e tentativa divergentes`,
        descricao: 'O blob antigo tem campos que a tentativa não tem.',
        explicacao: 'Depois da troca de fonte, só a tentativa é escrita. Campo que existe no blob e não nela indica escrita por um caminho que não passou pela porta canônica.',
        impacto: 'Duas respostas para "o que foi preenchido nesta etapa".',
        entidade: 'PhaseWorkflowStepInstance', quantidade: divergentes.length,
        link: ROTA_INTERNO, recomendacao: 'Investigue quem escreveu; rode o backfill para reconciliar.',
        evidencia: { exemplos: divergentes.slice(0, 10) },
      })
    }
    return { achados, metricas: { passos: passos.length, soNoBlob: soNoBlob.length, divergentes: divergentes.length } }
  },
})

// ── O CADASTRO INTEGRAL DO PASSO ────────────────────────────────────────────
//
// Cada coisa que saiu do código para o cadastro trouxe junto uma classe nova de
// inconsistência possível: opção sem identidade, canal apontando para catálogo
// desativado, requisito cobrando um campo que ninguém cadastrou, executor que não
// existe mais no registro. Nenhuma delas trava a publicação de HOJE — a validação já
// cobre isso; elas nascem do que ficou no banco de ontem, ou de uma linha inserida por
// fora. É por isso que são verificação, e não só validação.

registrar({
  id: 'saude.cadastro.passo-com-executor-inexistente',
  codigo: 'CAD-006',
  nome: 'Executor do passo existe no registro',
  descricao: 'Passo apontando para um executor que não está no registro abre uma etapa que nenhuma tela sabe desenhar.',
  dominio: 'WORKFLOW',
  modulo: 'Cadastro do passo',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 15_000,
  orientacao: 'Abra o passo em Workflows internos → Configurar → Geral e escolha um executor do registro.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const conhecidos = new Set(Object.keys(REGISTRO_DE_EXECUTORES))
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { executorKey: { not: null } },
      select: { id: true, key: true, executorKey: true, workflow: { select: { name: true } } },
    })
    const orfaos = passos.filter((p) => p.executorKey && !conhecidos.has(p.executorKey))
    if (!orfaos.length) return vazio({ passos: passos.length, orfaos: 0 }, `${passos.length} passo(s) com executor declarado, todos no registro.`)
    return {
      achados: orfaos.map((p): Achado => ({
        chave: `executor-inexistente:${p.id}`, severidade: 'ERRO',
        titulo: `"${p.key}" aponta para o executor "${p.executorKey}"`,
        descricao: `O passo "${p.key}" de "${p.workflow.name}" declara um executor que não está no registro.`,
        explicacao: 'O registro de executores é o vocabulário fechado do que o sistema sabe desenhar. Uma chave fora dele não tem tela.',
        impacto: 'A etapa abre sem painel, ou cai no painel genérico sem as capacidades que o cadastro supõe.',
        entidade: 'PhaseInternalWorkflowStep', registroId: String(p.id), registroNome: p.key, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Escolha um executor existente ou deixe em branco para o painel declarativo.',
        evidencia: { passoId: p.id, executorKey: p.executorKey },
      })),
      metricas: { passos: passos.length, orfaos: orfaos.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.campo-de-escolha-sem-opcao',
  codigo: 'CAD-007',
  nome: 'Campo de escolha tem opção',
  descricao: 'Campo select/radio sem nenhuma opção não deixa o operador escolher nada — e o requisito que o cobra nunca fica satisfeito.',
  dominio: 'WORKFLOW',
  modulo: 'Cadastro do passo',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 20_000,
  orientacao: 'Abra o passo → Campos → cadastre as opções, ou aponte o campo para um catálogo.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const campos = await prisma.stepField.findMany({
      where: { ativo: true, tipo: { in: ['select', 'multiselect', 'radio'] } },
      select: {
        id: true, key: true, label: true, opcoes: true,
        step: { select: { id: true, key: true, workflow: { select: { name: true } } } },
        opcoesCadastradas: { where: { ativo: true }, select: { id: true } },
      },
    })
    const semOpcao = campos.filter((c) => {
      if (c.opcoesCadastradas.length > 0) return false
      const o = c.opcoes as { catalogo?: string } | unknown[] | null
      if (o && !Array.isArray(o) && typeof o === 'object' && typeof (o as { catalogo?: string }).catalogo === 'string') return false
      return !Array.isArray(o) || o.length === 0
    })
    if (!semOpcao.length) return vazio({ campos: campos.length, semOpcao: 0 }, `${campos.length} campo(s) de escolha, todos com opção.`)
    return {
      achados: semOpcao.map((c): Achado => ({
        chave: `campo-sem-opcao:${c.id}`, severidade: 'ERRO',
        titulo: `"${c.label}" não tem opção`,
        descricao: `O campo "${c.key}" do passo "${c.step.key}" (${c.step.workflow.name}) é de escolha e não oferece nenhuma.`,
        explicacao: 'Antes de a opção ter identidade própria, uma lista vazia significava "o executor decide". Agora significa exatamente o que diz: não há o que escolher.',
        impacto: 'O operador trava na etapa; se o campo for obrigatório, a conclusão fica impossível.',
        entidade: 'StepField', registroId: String(c.id), registroNome: c.key, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Cadastre as opções do campo ou aponte-o para um catálogo.',
        evidencia: { campoId: c.id, stepId: c.step.id },
      })),
      metricas: { campos: campos.length, semOpcao: semOpcao.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.canal-do-passo-desativado',
  codigo: 'CAD-008',
  nome: 'Canal do passo continua ativo no catálogo',
  descricao: 'Passo que oferece um canal desativado no catálogo mostra ao operador um caminho que o servidor recusa.',
  dominio: 'WORKFLOW',
  modulo: 'Cadastro do passo',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 15_000,
  orientacao: 'Reative o canal no catálogo, ou desmarque-o nos passos que ainda o oferecem.',
  rotaCorrecao: ROTA_CANAIS,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const vinculos = await prisma.stepChannel.findMany({
      where: { ativo: true, canal: { ativo: false } },
      select: { id: true, canal: { select: { key: true, label: true } }, step: { select: { key: true, workflow: { select: { name: true } } } } },
      take: 50,
    })
    const total = await prisma.stepChannel.count()
    if (!vinculos.length) return vazio({ vinculos: total, desativados: 0 }, `${total} vínculo(s) de canal, nenhum apontando para canal desativado.`)
    return {
      achados: vinculos.map((v): Achado => ({
        chave: `canal-desativado:${v.id}`, severidade: 'ALERTA',
        titulo: `"${v.step.key}" ainda oferece o canal "${v.canal.label}"`,
        descricao: `O passo "${v.step.key}" de "${v.step.workflow.name}" oferece um canal que foi desativado no catálogo.`,
        explicacao: 'Desativar no catálogo tira o canal de circulação; o vínculo do passo continua existindo porque o histórico das execuções que o usaram precisa continuar legível.',
        impacto: 'O canal pode aparecer na tela do operador e ser recusado no envio.',
        entidade: 'StepChannel', registroId: String(v.id), registroNome: v.canal.key, quantidade: 1,
        link: ROTA_CANAIS,
        recomendacao: 'Reative o canal ou desmarque-o no passo.',
        evidencia: { vinculoId: v.id, canal: v.canal.key },
      })),
      metricas: { vinculos: total, desativados: vinculos.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.requisito-com-alvo-inexistente',
  codigo: 'CAD-009',
  nome: 'Requisito aponta para alvo existente',
  descricao: 'Requisito que cobra um campo, item ou ação que não existe no passo nunca fica satisfeito — e a etapa não conclui nunca.',
  dominio: 'WORKFLOW',
  modulo: 'Cadastro do passo',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 20_000,
  orientacao: 'Abra o passo → Requisitos e reaponte o requisito, ou cadastre o alvo que falta.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { requisitos: { some: { ativo: true } } },
      select: {
        id: true, key: true, workflow: { select: { name: true } },
        requisitos: { where: { ativo: true }, select: { id: true, key: true, label: true, tipo: true, alvoKey: true, acaoKey: true } },
        campos: { select: { key: true } },
        checkItens: { select: { key: true } },
        acoes: { select: { key: true } },
      },
    })
    const achados: Achado[] = []
    let total = 0
    for (const p of passos) {
      const campos = new Set(p.campos.map((c) => c.key))
      const itens = new Set(p.checkItens.map((c) => c.key))
      const acoes = new Set(p.acoes.map((c) => c.key))
      for (const r of p.requisitos) {
        total++
        // ALVO VAZIO É LEGÍTIMO: "checklist completo" sem alvo significa o checklist
        // inteiro. O defeito é apontar para uma chave que não existe.
        const problemas: string[] = []
        if (r.alvoKey) {
          if (r.tipo === 'CAMPO_PREENCHIDO' && !campos.has(r.alvoKey)) problemas.push(`campo "${r.alvoKey}"`)
          if (r.tipo === 'CHECKLIST_COMPLETO' && !itens.has(r.alvoKey)) problemas.push(`item "${r.alvoKey}"`)
          if (r.tipo === 'ACAO_EXECUTADA' && !acoes.has(r.alvoKey)) problemas.push(`ação "${r.alvoKey}"`)
        } else if (r.tipo === 'CAMPO_PREENCHIDO' || r.tipo === 'ACAO_EXECUTADA') {
          problemas.push('nenhum alvo declarado')
        }
        if (r.acaoKey && !acoes.has(r.acaoKey)) problemas.push(`ação condicionante "${r.acaoKey}"`)
        if (!problemas.length) continue
        achados.push({
          chave: `requisito-alvo:${r.id}`, severidade: 'CRITICO',
          titulo: `"${r.label}" cobra algo que não existe no passo`,
          descricao: `Em "${p.workflow.name}", o requisito "${r.key}" do passo "${p.key}" aponta para ${problemas.join(', ')}.`,
          explicacao: 'O requisito é avaliado sobre o que a etapa tem. Apontando para uma chave inexistente, a avaliação nunca dá satisfeita.',
          impacto: 'A etapa fica impossível de concluir, e o operador lê um motivo que não corresponde a nenhum campo da tela.',
          entidade: 'StepRequirement', registroId: String(r.id), registroNome: r.key, quantidade: 1,
          link: ROTA_INTERNO,
          recomendacao: 'Reaponte o requisito ou cadastre o alvo.',
          evidencia: { requisitoId: r.id, tipo: r.tipo, alvoKey: r.alvoKey, problemas },
        })
      }
    }
    if (!achados.length) return vazio({ requisitos: total, quebrados: 0 }, `${total} requisito(s) cadastrado(s), todos apontando para alvo existente.`)
    return { achados, metricas: { requisitos: total, quebrados: achados.length } }
  },
})

registrar({
  id: 'saude.cadastro.execucao-aponta-para-versao-inexistente',
  codigo: 'CAD-010',
  nome: 'Execução alcança a versão que registrou',
  descricao: 'Instância que registrou uma versão sem conteúdo congelado não consegue dizer o que a configuração dizia quando ela começou.',
  dominio: 'WORKFLOW',
  modulo: 'Versionamento',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 25_000,
  orientacao: 'Rode `npm run backfill:versao-publicada -- --execute`; ele congela as versões vigentes que faltam.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // SEM `.catch`. Uma verificação que engole o próprio erro devolve "0 achados" e
    // fica indistinguível de saudável — foi exatamente assim que esta query passou a
    // reportar tudo em ordem enquanto apontava para colunas que não existem.
    const linhas = await prisma.$queryRawUnsafe<Array<{ workflowId: number; versao: number; n: bigint }>>(
      `SELECT i."workflowDefinitionId" AS "workflowId", i."workflowVersion" AS versao, COUNT(*) AS n
         FROM "PhaseWorkflowInstance" i
        WHERE i."workflowDefinitionId" IS NOT NULL AND i."workflowVersion" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "PhaseInternalWorkflowVersao" v
             WHERE v."workflowId" = i."workflowDefinitionId" AND v."versao" = i."workflowVersion")
        GROUP BY 1, 2 LIMIT 50`,
    )
    if (!linhas.length) return vazio({ orfas: 0 }, 'Toda execução alcança a versão congelada que registrou.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `versao-inalcancavel:${l.workflowId}:${l.versao}`, severidade: 'ERRO',
        titulo: `${Number(l.n)} execução(ões) apontam para a v${l.versao} do workflow #${l.workflowId}, que não está congelada`,
        descricao: 'A instância registrou um número de versão cujo conteúdo não existe.',
        explicacao: 'O número da versão é a promessa de que o conteúdo daquele dia continua legível. Sem a linha congelada, a promessa não é cumprível.',
        impacto: 'Essas execuções caem na configuração de hoje ou em nenhuma — as duas coisas reinterpretam o passado.',
        entidade: 'PhaseWorkflowInstance', registroId: String(l.workflowId), quantidade: Number(l.n),
        link: ROTA_INTERNO,
        recomendacao: 'Execute o backfill de versão publicada.',
        evidencia: { workflowId: l.workflowId, versao: l.versao, instancias: Number(l.n) },
      })),
      metricas: { orfas: linhas.length },
    }
  },
})

registrar({
  id: 'saude.cadastro.rascunho-nao-publicado',
  codigo: 'CAD-011',
  nome: 'Rascunho de workflow sem publicação',
  descricao: 'Alteração salva e não publicada não vale para nenhum processo — e é fácil supor que valha.',
  dominio: 'WORKFLOW',
  modulo: 'Versionamento',
  severidadePadrao: 'INFORMATIVO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.2.0',
  timeoutMs: 10_000,
  orientacao: 'Abra o workflow e use "Publicar…" para ver o que muda e confirmar.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const wfs = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false, rascunhoAlteradoEm: { not: null } },
      select: { id: true, name: true, versao: true, rascunhoAlteradoEm: true },
      take: 50,
    })
    if (!wfs.length) return vazio({ rascunhos: 0 }, 'Nenhum workflow com alteração pendente de publicação.')
    return {
      achados: wfs.map((w): Achado => ({
        chave: `rascunho:${w.id}`, severidade: 'INFORMATIVO',
        titulo: `"${w.name}" tem alteração não publicada`,
        descricao: `A definição viva difere da versão ${w.versao}, publicada por último.`,
        explicacao: 'Salvar deixou de publicar justamente para o administrador poder revisar antes. O efeito colateral é que a alteração fica invisível para os processos até alguém publicar.',
        impacto: 'Os processos em andamento continuam na versão anterior — o que é correto, mas pode não ser o que se espera.',
        entidade: 'PhaseInternalWorkflow', registroId: String(w.id), registroNome: w.name, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Revise a prévia e publique, ou desfaça a alteração.',
        evidencia: { workflowId: w.id, versaoPublicada: w.versao, alteradoEm: w.rascunhoAlteradoEm },
      })),
      metricas: { rascunhos: wfs.length },
    }
  },
})

// ── A SUBTAREFA CANÔNICA ────────────────────────────────────────────────────
//
// A subtarefa trouxe consigo classes novas de inconsistência: execução apontando para
// uma subtarefa que saiu do cadastro, subtarefa manual sem ação (o operador a vê e não
// pode concluí-la), ciclo entre irmãs, passo que conclui por subtarefas e não tem
// nenhuma. A validação da publicação recusa tudo isso HOJE; estas verificações olham o
// que ficou no banco de ontem — e o que entrar por fora dela.

registrar({
  id: 'saude.subtarefa.execucao-sem-definicao',
  codigo: 'SUB-001',
  nome: 'Execução de subtarefa alcança sua definição',
  descricao: 'Execução cuja subtarefa não existe mais na versão que ela registrou não sabe dizer o que era.',
  dominio: 'WORKFLOW',
  modulo: 'Subtarefas',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.3.0',
  timeoutMs: 25_000,
  orientacao: 'A subtarefa foi removida do cadastro em vez de inativada. Recadastre-a com a MESMA chave e inative-a.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // A definição histórica vem da versão CONGELADA, então basta conferir se a chave
    // existe entre as subtarefas daquela versão.
    const execucoes = await prisma.subtaskExecution.findMany({
      where: { supersededAt: null },
      select: {
        id: true, subtaskKey: true, workflowVersao: true,
        stepInstance: { select: { id: true, stepKey: true, workflowInstance: { select: { workflowDefinitionId: true } } } },
      },
      take: 500,
    })
    if (execucoes.length === 0) return vazio({ execucoes: 0, orfas: 0 }, 'Nenhuma execução de subtarefa ainda.')

    const versoes = await prisma.phaseInternalWorkflowVersao.findMany({ select: { workflowId: true, versao: true, passos: true } })
    const chavesPor = new Map<string, Set<string>>()
    for (const v of versoes) {
      const passos = Array.isArray(v.passos) ? (v.passos as Array<{ key: string; subtarefas?: Array<{ key: string }> }>) : []
      for (const p of passos) {
        chavesPor.set(`${v.workflowId}|${v.versao}|${p.key}`, new Set((p.subtarefas ?? []).map((s) => s.key)))
      }
    }
    const orfas = execucoes.filter((e) => {
      const wfId = e.stepInstance.workflowInstance.workflowDefinitionId
      if (!wfId || e.workflowVersao == null) return false
      const chaves = chavesPor.get(`${wfId}|${e.workflowVersao}|${e.stepInstance.stepKey}`)
      // Sem versão congelada para comparar, esta verificação não tem o que afirmar —
      // quem cobra isso é CAD-010, e duplicar o achado só faria barulho.
      if (!chaves) return false
      return !chaves.has(e.subtaskKey)
    })
    if (orfas.length === 0) return vazio({ execucoes: execucoes.length, orfas: 0 }, `${execucoes.length} execução(ões) de subtarefa, todas com definição alcançável.`)
    return {
      achados: orfas.slice(0, 20).map((e): Achado => ({
        chave: `subexec-orfa:${e.id}`, severidade: 'ERRO',
        titulo: `Execução #${e.id} aponta para a subtarefa "${e.subtaskKey}", que não está na v${e.workflowVersao}`,
        descricao: `A etapa "${e.stepInstance.stepKey}" tem execução de uma subtarefa que a versão registrada não contém.`,
        explicacao: 'A chave da subtarefa é o que a execução guarda. Sumindo do cadastro, ela deixa de saber o que era.',
        impacto: 'O histórico dessa execução fica sem nome e sem configuração; a tela não consegue desenhá-la.',
        entidade: 'SubtaskExecution', registroId: String(e.id), registroNome: e.subtaskKey, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Recadastre a subtarefa com a mesma chave e inative-a, em vez de removê-la.',
        evidencia: { execucaoId: e.id, subtaskKey: e.subtaskKey, versao: e.workflowVersao },
      })),
      metricas: { execucoes: execucoes.length, orfas: orfas.length },
    }
  },
})

registrar({
  id: 'saude.subtarefa.manual-sem-acao',
  codigo: 'SUB-002',
  nome: 'Subtarefa manual tem como ser concluída',
  descricao: 'Subtarefa manual sem nenhuma ação aparece para o operador sem nenhum botão — ele a vê e não pode fechá-la.',
  dominio: 'WORKFLOW',
  modulo: 'Subtarefas',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.3.0',
  timeoutMs: 15_000,
  orientacao: 'Abra o passo → Subtarefas → Configurar → Ações e cadastre ao menos um resultado.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const subs = await prisma.stepSubtaskDefinition.findMany({
      where: { ativo: true, modoExecucao: 'MANUAL' },
      select: {
        id: true, key: true, label: true,
        step: { select: { key: true, workflow: { select: { name: true } } } },
        acoes: { where: { ativo: true }, select: { id: true } },
      },
    })
    const mudas = subs.filter((s) => s.acoes.length === 0)
    if (mudas.length === 0) return vazio({ subtarefas: subs.length, mudas: 0 }, `${subs.length} subtarefa(s) manual(is), todas com ação.`)
    return {
      achados: mudas.map((s): Achado => ({
        chave: `subtarefa-muda:${s.id}`, severidade: 'ERRO',
        titulo: `"${s.label}" não tem nenhum resultado`,
        descricao: `A subtarefa "${s.key}" de "${s.step.key}" (${s.step.workflow.name}) é manual e não oferece ação nenhuma.`,
        explicacao: 'Uma subtarefa manual é concluída escolhendo um resultado. Sem resultado cadastrado, não há o que escolher.',
        impacto: 'O operador vê a subtarefa aberta e não tem como fechá-la — e o passo que depender dela não conclui.',
        entidade: 'StepSubtaskDefinition', registroId: String(s.id), registroNome: s.key, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Cadastre ao menos uma ação, ou marque a subtarefa como automática.',
        evidencia: { subtarefaId: s.id, passo: s.step.key },
      })),
      metricas: { subtarefas: subs.length, mudas: mudas.length },
    }
  },
})

registrar({
  id: 'saude.subtarefa.dependencia-quebrada',
  codigo: 'SUB-003',
  nome: 'Dependência entre subtarefas é válida e sem ciclo',
  descricao: 'Dependência para subtarefa inexistente trava a subtarefa para sempre; ciclo trava todas as envolvidas.',
  dominio: 'WORKFLOW',
  modulo: 'Subtarefas',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.3.0',
  timeoutMs: 20_000,
  orientacao: 'Abra o passo → Subtarefas → Configurar → Geral e reveja "Depende de".',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { subtarefas: { some: {} } },
      select: {
        id: true, key: true, workflow: { select: { name: true } },
        subtarefas: { where: { ativo: true }, select: { key: true, label: true, dependeDe: true } },
      },
    })
    const achados: Achado[] = []
    let total = 0
    for (const p of passos) {
      total += p.subtarefas.length
      const chaves = new Set(p.subtarefas.map((s) => s.key))
      for (const s of p.subtarefas) {
        const deps = Array.isArray(s.dependeDe) ? (s.dependeDe as string[]) : []
        for (const d of deps) {
          if (chaves.has(d) && d !== s.key) continue
          achados.push({
            chave: `subdep-quebrada:${p.id}:${s.key}:${d}`, severidade: 'CRITICO',
            titulo: `"${s.label}" depende de "${d}", que não é subtarefa deste passo`,
            descricao: `Em "${p.workflow.name}", o passo "${p.key}" tem dependência de subtarefa apontando para o nada.`,
            explicacao: 'A dependência é satisfeita quando a irmã é concluída. Apontando para uma chave inexistente, ela nunca é.',
            impacto: 'A subtarefa fica bloqueada para sempre — e o passo que depender dela não conclui nunca.',
            entidade: 'StepSubtaskDefinition', registroId: String(p.id), registroNome: s.key, quantidade: 1,
            link: ROTA_INTERNO,
            recomendacao: 'Reaponte a dependência ou cadastre a subtarefa que falta.',
            evidencia: { passo: p.key, subtarefa: s.key, dependeDe: d },
          })
        }
      }
      const ciclo = detectarCiclo(p.subtarefas.map((s) => ({
        key: s.key, label: s.label,
        dependeDe: Array.isArray(s.dependeDe) ? (s.dependeDe as string[]) : [],
      })))
      if (ciclo) {
        achados.push({
          chave: `subdep-ciclo:${p.id}`, severidade: 'CRITICO',
          titulo: `As subtarefas de "${p.key}" formam um ciclo`,
          descricao: `O ciclo é ${ciclo.join(' → ')}.`,
          explicacao: 'Cada uma espera a outra. Nenhuma fica disponível, e não há ordem que resolva.',
          impacto: 'O passo trava por completo.',
          entidade: 'PhaseInternalWorkflowStep', registroId: String(p.id), registroNome: p.key, quantidade: 1,
          link: ROTA_INTERNO,
          recomendacao: 'Quebre o ciclo removendo uma das dependências.',
          evidencia: { passo: p.key, ciclo },
        })
      }
    }
    if (achados.length === 0) return vazio({ subtarefas: total, quebradas: 0 }, `${total} subtarefa(s) com dependências consistentes.`)
    return { achados, metricas: { subtarefas: total, quebradas: achados.length } }
  },
})

registrar({
  id: 'saude.subtarefa.conclusao-sem-subtarefa',
  codigo: 'SUB-004',
  nome: 'Passo que conclui por subtarefas tem subtarefas',
  descricao: 'Passo cuja regra de conclusão olha subtarefas e não tem nenhuma nunca conclui.',
  dominio: 'WORKFLOW',
  modulo: 'Subtarefas',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.3.0',
  timeoutMs: 15_000,
  orientacao: 'Cadastre as subtarefas, ou volte a condição de conclusão para "quando a ação do passo for executada".',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { regraDeConclusao: { not: 'ACAO_DO_PASSO' } },
      select: {
        id: true, key: true, label: true, regraDeConclusao: true,
        workflow: { select: { name: true } },
        subtarefas: { where: { ativo: true }, select: { id: true } },
      },
    })
    const sem = passos.filter((p) => p.subtarefas.length === 0)
    if (sem.length === 0) return vazio({ passos: passos.length, sem: 0 }, `${passos.length} passo(s) concluem por subtarefa, todos com subtarefas.`)
    return {
      achados: sem.map((p): Achado => ({
        chave: `conclusao-sem-subtarefa:${p.id}`, severidade: 'CRITICO',
        titulo: `"${p.label}" conclui por subtarefas e não tem nenhuma`,
        descricao: `Em "${p.workflow.name}", o passo declara ${p.regraDeConclusao} e não tem subtarefa ativa.`,
        explicacao: 'A regra pergunta às subtarefas se pode concluir. Sem nenhuma, a resposta nunca chega.',
        impacto: 'O passo não conclui, e a fase inteira trava atrás dele.',
        entidade: 'PhaseInternalWorkflowStep', registroId: String(p.id), registroNome: p.key, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Cadastre as subtarefas ou volte a regra para a ação do passo.',
        evidencia: { passo: p.key, regra: p.regraDeConclusao },
      })),
      metricas: { passos: passos.length, sem: sem.length },
    }
  },
})

registrar({
  id: 'saude.subtarefa.canal-sem-organizacao',
  codigo: 'SUB-005',
  nome: 'Quem usa canal do fornecedor tem fornecedor com canal',
  descricao: 'Subtarefa que envia pelo fornecedor fica bloqueada em todo documento cujo órgão não tem canal cadastrado.',
  dominio: 'WORKFLOW',
  modulo: 'Subtarefas',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.3.0',
  timeoutMs: 20_000,
  orientacao: 'Cadastre os canais em Órgãos e Organizações → Canais de atendimento.',
  rotaCorrecao: '/administrator?screen=canais',
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const usamCanal = await prisma.stepSubtaskDefinition.count({
      where: { ativo: true, fonteDeCanais: { not: 'NENHUMA' } },
    })
    if (usamCanal === 0) return vazio({ subtarefas: 0, orgaosSemCanal: 0 }, 'Nenhuma subtarefa depende de canal do fornecedor.')

    // NENHUMA ORGANIZAÇÃO COM CANAL é o caso mais grave e o menos visível: a conta
    // abaixo, que compara órgãos EM USO contra órgãos com canal, dá "tudo certo"
    // quando nenhum documento aponta para órgão nenhum. Zero contra zero fecha, e o
    // sistema parece saudável enquanto toda solicitação publicada bloquearia.
    const totalDeVinculos = await prisma.organizacaoCanal.count({ where: { ativo: true } })
    if (totalDeVinculos === 0) {
      return {
        achados: [{
          chave: 'nenhuma-organizacao-com-canal', severidade: 'ALERTA',
          titulo: `${usamCanal} subtarefa(s) enviam pelo fornecedor, e nenhuma organização tem canal cadastrado`,
          descricao: 'A tabela de canais por organização está vazia.',
          explicacao: 'A subtarefa resolve os canais pelo cadastro do órgão do documento. Sem nenhum cadastrado, ela bloqueia em todo documento — e publicar essa configuração pararia a solicitação inteira.',
          impacto: 'Toda etapa de solicitação ficaria bloqueada assim que a configuração fosse publicada.',
          entidade: 'OrganizacaoCanal', quantidade: 0,
          link: '/administrator?screen=canais',
          recomendacao: 'Cadastre por onde cada órgão atende ANTES de publicar as subtarefas que usam canal.',
          evidencia: { subtarefasQueUsamCanal: usamCanal, vinculos: 0 },
        }],
        metricas: { subtarefas: usamCanal, orgaosSemCanal: 0, vinculos: 0 },
      }
    }

    // OS ÓRGÃOS QUE JÁ SÃO USADOS por algum documento e não têm canal cadastrado. Órgão
    // que ninguém usa não é problema: ele não bloqueia execução nenhuma.
    const usados = await prisma.documento.groupBy({
      by: ['orgaoId'], where: { orgaoId: { not: null } }, _count: { _all: true },
    })
    const comCanal = new Set((await prisma.organizacaoCanal.findMany({
      where: { ativo: true }, select: { organizacaoId: true },
    })).map((c) => c.organizacaoId))
    const sem = usados.filter((u) => u.orgaoId && !comCanal.has(u.orgaoId))
    if (sem.length === 0) return vazio({ subtarefas: usamCanal, orgaosSemCanal: 0 }, `${usamCanal} subtarefa(s) usam canal; todo órgão em uso tem canal cadastrado.`)

    const nomes = await prisma.orgaoProtocolo.findMany({
      where: { id: { in: sem.map((s) => s.orgaoId!).slice(0, 20) } }, select: { id: true, name: true },
    })
    return {
      achados: nomes.map((o): Achado => ({
        chave: `orgao-sem-canal:${o.id}`, severidade: 'ALERTA',
        titulo: `"${o.name}" não tem canal de atendimento cadastrado`,
        descricao: `${sem.find((s) => s.orgaoId === o.id)?._count._all ?? 0} documento(s) apontam para este órgão.`,
        explicacao: 'A subtarefa que envia pelo fornecedor resolve os canais pelo cadastro dele. Sem canal, ela bloqueia.',
        impacto: 'Toda etapa de solicitação nesses documentos fica bloqueada com "o órgão não tem canal cadastrado".',
        entidade: 'OrgaoProtocolo', registroId: String(o.id), registroNome: o.name, quantidade: 1,
        link: '/administrator?screen=canais',
        recomendacao: 'Cadastre por onde este órgão atende.',
        evidencia: { orgaoId: o.id },
      })),
      metricas: { subtarefas: usamCanal, orgaosSemCanal: sem.length },
    }
  },
})

// ── DUPLICIDADE E ÓRFÃOS DE WORKFLOW INTERNO ────────────────────────────────
//
// Em 22/08 dois workflows respondiam pela fase de Emissão Documental: o genérico
// (`all::emissao_documental`, 6 instâncias) e um preso a `tipoProcessoId = 2`
// (`2::emissao_documental`, nunca executado) — um tipo de processo que havia sido
// APAGADO. A referência ao tipo é solta, sem chave estrangeira, então o workflow
// sobreviveu ao dono e ficou pendurado: inalcançável por qualquer processo, mas
// visível no cadastro, dobrando o trabalho do administrador e acumulando
// configuração que ninguém executa.

registrar({
  id: 'saude.workflow.tipo-de-processo-inexistente',
  codigo: 'WFI-001',
  nome: 'Workflow interno aponta para tipo de processo existente',
  descricao: 'Workflow preso a um tipo de processo apagado é inalcançável: nenhum processo pode selecioná-lo.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow interno',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.4.0',
  timeoutMs: 15_000,
  orientacao: 'Reaponte o workflow para um tipo existente, torne-o genérico, ou arquive-o.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const wfs = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false, tipoProcessoId: { not: null } },
      select: { id: true, name: true, wfUid: true, phaseKey: true, tipoProcessoId: true },
    })
    if (!wfs.length) return vazio({ workflows: 0, orfaos: 0 }, 'Nenhum workflow interno preso a tipo de processo.')
    const tipos = new Set((await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true } })).map((t) => t.id))
    const orfaos = wfs.filter((w) => w.tipoProcessoId != null && !tipos.has(w.tipoProcessoId))
    if (!orfaos.length) return vazio({ workflows: wfs.length, orfaos: 0 }, `${wfs.length} workflow(s) por tipo, todos apontando para tipo existente.`)
    return {
      achados: orfaos.map((w): Achado => ({
        chave: `wf-tipo-inexistente:${w.id}`, severidade: 'ALERTA',
        titulo: `"${w.name}" está preso ao tipo de processo ${w.tipoProcessoId}, que não existe`,
        descricao: `O workflow ${w.wfUid} da fase ${w.phaseKey} referencia um tipo de processo apagado.`,
        explicacao: 'A referência ao tipo é solta, sem chave estrangeira: o workflow sobrevive ao dono e fica inalcançável — nenhum processo pode selecioná-lo.',
        impacto: 'Ele aparece no cadastro, dobra o trabalho do administrador e acumula configuração que nunca executa.',
        entidade: 'PhaseInternalWorkflow', registroId: String(w.id), registroNome: w.name, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Reaponte para um tipo existente, torne genérico, ou arquive.',
        evidencia: { wfUid: w.wfUid, tipoProcessoId: w.tipoProcessoId },
      })),
      metricas: { workflows: wfs.length, orfaos: orfaos.length },
    }
  },
})

registrar({
  id: 'saude.workflow.dois-ativos-para-a-mesma-fase',
  codigo: 'WFI-002',
  nome: 'Uma definição ativa por fase e contexto',
  descricao: 'Dois workflows ativos alcançáveis pela mesma fase tornam ambíguo qual configuração vale.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow interno',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.4.0',
  timeoutMs: 15_000,
  orientacao: 'Arquive o que não é canônico, ou dê a cada um um tipo de processo distinto e existente.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const wfs = await prisma.phaseInternalWorkflow.findMany({
      where: { arquivado: false, active: true },
      select: { id: true, name: true, phaseKey: true, tipoProcessoId: true },
    })
    const tipos = new Set((await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true } })).map((t) => t.id))
    // ALCANÇÁVEL = genérico, ou preso a um tipo que existe. Um workflow órfão não
    // disputa com ninguém — quem o acusa é a WFI-001.
    const alcancaveis = wfs.filter((w) => w.tipoProcessoId == null || tipos.has(w.tipoProcessoId))
    const porContexto = new Map<string, typeof alcancaveis>()
    for (const w of alcancaveis) {
      const ctx = `${w.phaseKey}|${w.tipoProcessoId ?? 'todos'}`
      porContexto.set(ctx, [...(porContexto.get(ctx) ?? []), w])
    }
    const ambiguos = [...porContexto.entries()].filter(([, l]) => l.length > 1)
    if (!ambiguos.length) return vazio({ workflows: alcancaveis.length, ambiguos: 0 }, `${alcancaveis.length} workflow(s) alcançável(is), um por fase e contexto.`)
    return {
      achados: ambiguos.map(([ctx, lista]): Achado => ({
        chave: `wf-ambiguo:${ctx}`, severidade: 'ERRO',
        titulo: `${lista.length} workflows ativos para ${ctx.split('|')[0]}`,
        descricao: `São eles: ${lista.map((w) => `#${w.id} "${w.name}"`).join(', ')}.`,
        explicacao: 'Com dois alcançáveis pelo mesmo contexto, qual configuração vale passa a depender da ordem da consulta.',
        impacto: 'O administrador configura um e o processo executa o outro.',
        entidade: 'PhaseInternalWorkflow', registroId: String(lista[0].id), quantidade: lista.length,
        link: ROTA_INTERNO,
        recomendacao: 'Arquive o que não é canônico, ou dê a cada um um tipo de processo distinto.',
        evidencia: { contexto: ctx, workflows: lista.map((w) => w.id) },
      })),
      metricas: { workflows: alcancaveis.length, ambiguos: ambiguos.length },
    }
  },
})

// ── PASSO ATIVO SEM MEIO DE EXECUÇÃO ────────────────────────────────────────
//
// Um passo publicado, ativo, numa fase que já roda, e sem nada cadastrado, é uma
// etapa que o operador abre e não consegue fechar. Foi o caso dos seis da Retificação.
//
// ─── O QUE ESTA VERIFICAÇÃO PRECISOU APRENDER ──────────────────────────────
// A primeira versão desta conta (feita à mão numa auditoria) contou linhas de cadastro
// e acusou `localizar_registro` junto com eles. Estava errado: aquele passo tem
// executor ESPECIALIZADO (`registral`), que traz o próprio formulário e grava na fonte
// canônica — o Documento —, e por contrato NÃO consome ações cadastradas. Cadastro
// vazio ali é o esperado, não um defeito.
//
// A distinção que importa é entre:
//   · executor DECLARATIVO — desenha exatamente o que estiver cadastrado. Sem cadastro,
//     tela vazia. É defeito.
//   · executor ESPECIALIZADO que não consome ações cadastradas — tem contrato próprio.
//     Cadastro vazio é normal.
//   · fase que NUNCA rodou — é rascunho de futuro, não operação quebrada. Vira INFO.

registrar({
  id: 'saude.cadastro.passo-ativo-sem-execucao',
  codigo: 'CAD-012',
  nome: 'Passo ativo tem como ser executado',
  descricao: 'Passo publicado numa fase que já roda, com executor declarativo e nenhum cadastro, abre vazio para o operador.',
  dominio: 'WORKFLOW',
  modulo: 'Cadastro do passo',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.5.0',
  timeoutMs: 25_000,
  orientacao: 'Abra o passo em Workflows internos → Configurar e cadastre ao menos um resultado, ou declare um executor que traga o próprio formulário.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({
      where: { workflow: { arquivado: false, active: true } },
      select: {
        id: true, key: true, label: true, executorKey: true, createsTask: true,
        workflow: { select: { id: true, name: true, phaseKey: true } },
        acoes: { where: { ativo: true }, select: { id: true } },
        campos: { where: { ativo: true }, select: { id: true } },
        checkItens: { where: { ativo: true }, select: { id: true } },
        subtarefas: { where: { ativo: true }, select: { id: true } },
      },
    })
    if (!passos.length) return vazio({ passos: 0, incompletos: 0 }, 'Nenhum passo ativo.')

    // FASES QUE JÁ RODARAM — a diferença entre operação quebrada e rascunho de futuro.
    const rodaram = new Set(
      (await prisma.phaseWorkflowInstance.groupBy({ by: ['faseMacroKey'], _count: { _all: true } }))
        .filter((i) => i._count._all > 0).map((i) => i.faseMacroKey),
    )

    const semCadastro = passos.filter((p) =>
      !p.acoes.length && !p.campos.length && !p.checkItens.length && !p.subtarefas.length)

    const achados: Achado[] = []
    let placeholders = 0
    let especializados = 0
    for (const p of semCadastro) {
      // O EXECUTOR EFETIVO decide se cadastro vazio é defeito. Sem `executorKey`, o
      // registro resolve pela chave do passo — pode cair num especializado.
      const exec = executorEfetivo({ key: p.key, executorKey: p.executorKey }, p.workflow.phaseKey)
      const cap = REGISTRO_DE_EXECUTORES[exec as keyof typeof REGISTRO_DE_EXECUTORES]
      if (cap && !cap.acoesCadastradas) { especializados++; continue }
      if (!rodaram.has(p.workflow.phaseKey)) { placeholders++; continue }

      achados.push({
        chave: `passo-sem-execucao:${p.id}`,
        severidade: 'ERRO',
        titulo: `"${p.label}" não tem como ser executado`,
        descricao: `O passo "${p.key}" de "${p.workflow.name}" usa o executor declarativo "${exec}" e não tem ação, campo, checklist nem subtarefa cadastrada.`,
        explicacao: 'O executor declarativo desenha exatamente o que está cadastrado. Sem cadastro, o operador abre a etapa e não encontra nada — nem como concluí-la.',
        impacto: `A fase ${p.workflow.phaseKey} já tem execuções: quem chegar neste passo trava nele.`,
        entidade: 'PhaseInternalWorkflowStep', registroId: String(p.id), registroNome: p.key, quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Cadastre ao menos um resultado, ou declare um executor com formulário próprio.',
        evidencia: { passo: p.key, fase: p.workflow.phaseKey, executor: exec },
      })
    }

    const metricas = {
      passos: passos.length, semCadastro: semCadastro.length,
      incompletos: achados.length, placeholders, especializados,
    }
    if (!achados.length) {
      return {
        achados: [], metricas,
        resumo: `${passos.length} passo(s) ativos; ${especializados} com executor próprio e ${placeholders} em fase que nunca rodou — nenhum operacionalmente vazio.`,
      }
    }
    return { achados, metricas }
  },
})
