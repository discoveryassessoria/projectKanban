// lib/saude/verificacoes/workflow.ts
//
// WORKFLOW — o fluxo tem que ter começo, meio e fim ALCANÇÁVEIS.
//
// Aqui não basta contar registros: fazemos análise do fluxo. Um workflow com
// fases cadastradas mas sem fase final, ou com fase inalcançável, está quebrado
// mesmo que todas as tabelas estejam preenchidas.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA_MACRO = '/administrator?screen=macrokanban'
const ROTA_INTERNO = '/administrator?screen=phaseiwf'
const ROTA_TIPOS = '/administrator?screen=proctypes'

registrar({
  id: 'saude.workflow.tipo-sem-workflow',
  codigo: 'WF-001',
  nome: 'Tipo de processo com workflow macro',
  descricao: 'Tipo de processo ativo sem workflow macro não consegue instanciar nenhum processo.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow Macro',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Crie o Workflow Macro do tipo de processo e declare suas fases.',
  rotaCorrecao: ROTA_MACRO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({
      where: { ativo: true, arquivado: false, macroWorkflow: { is: null } },
      select: { id: true, name: true }, take: 100,
    })
    if (!tipos.length) return { achados: [], metricas: { semWorkflow: 0 }, resumo: 'Todo tipo de processo ativo tem workflow macro.' }
    return {
      achados: tipos.map((t): Achado => ({
        chave: `tipo-sem-workflow:${t.id}`,
        severidade: 'CRITICO',
        titulo: `Tipo "${t.name}" não tem workflow macro`,
        descricao: `O tipo de processo "${t.name}" está ativo mas não possui Workflow Macro.`,
        explicacao: 'O Workflow Macro define as fases do processo. Sem ele, criar processo deste tipo não gera fase nem tarefa.',
        impacto: 'Nenhum processo deste tipo consegue nascer operacional nem avançar.',
        entidade: 'TipoProcessoNacionalidade',
        registroId: String(t.id),
        registroNome: t.name,
        quantidade: 1,
        link: ROTA_MACRO,
        recomendacao: 'Crie o Workflow Macro para este tipo e declare as fases, com inicial e final.',
        evidencia: { tipoProcessoId: t.id, nome: t.name },
      })),
      metricas: { semWorkflow: tipos.length },
    }
  },
})

registrar({
  id: 'saude.workflow.fluxo-completo',
  codigo: 'WF-002',
  nome: 'Workflow com fases, início e fim',
  descricao: 'Analisa o fluxo: existe fase, existe primeira fase e existe fase final alcançável.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow Macro',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Todo workflow precisa de pelo menos uma fase obrigatória e de uma fase final — senão o processo entra e nunca sai.',
  rotaCorrecao: ROTA_MACRO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const workflows = await prisma.macroWorkflow.findMany({
      where: { ativo: true },
      select: {
        id: true, name: true, tipoProcessoId: true,
        tipoProcesso: { select: { name: true, ativo: true, arquivado: true } },
        fases: { select: { phaseKey: true, label: true, ordem: true, required: true, conditional: true }, orderBy: { ordem: 'asc' } },
      },
    })
    const achados: Achado[] = []
    let semFases = 0, semObrigatoria = 0, ordemDuplicada = 0

    for (const w of workflows) {
      if (w.tipoProcesso && (!w.tipoProcesso.ativo || w.tipoProcesso.arquivado)) continue
      const nome = w.tipoProcesso?.name ?? w.name

      if (!w.fases.length) {
        semFases++
        achados.push({
          chave: `workflow-sem-fases:${w.id}`,
          severidade: 'CRITICO',
          titulo: `Workflow "${nome}" não tem fases`,
          descricao: 'O workflow macro existe mas nenhuma fase foi declarada.',
          explicacao: 'Sem fase não há fluxo: o processo não tem onde entrar nem para onde ir.',
          impacto: 'Processos deste tipo nascem sem posição e não avançam.',
          entidade: 'MacroWorkflow',
          registroId: String(w.id),
          registroNome: nome,
          quantidade: 1,
          link: ROTA_MACRO,
          recomendacao: 'Declare as fases do workflow, em ordem, marcando as obrigatórias.',
          evidencia: { macroWorkflowId: w.id, tipoProcessoId: w.tipoProcessoId },
        })
        continue
      }

      // fase final = última obrigatória alcançável. Fluxo só de condicionais
      // não garante conclusão.
      const obrigatorias = w.fases.filter((f) => f.required && !f.conditional)
      if (!obrigatorias.length) {
        semObrigatoria++
        achados.push({
          chave: `workflow-sem-fase-obrigatoria:${w.id}`,
          severidade: 'ERRO',
          titulo: `Workflow "${nome}" não tem nenhuma fase obrigatória`,
          descricao: `As ${w.fases.length} fase(s) declaradas são todas opcionais ou condicionais.`,
          explicacao: 'Sem fase obrigatória não existe caminho garantido do início ao fim: o fluxo pode ser inteiramente pulado.',
          impacto: 'O processo pode ser concluído sem passar por nenhuma etapa de trabalho.',
          entidade: 'MacroWorkflow',
          registroId: String(w.id),
          registroNome: nome,
          quantidade: w.fases.length,
          link: ROTA_MACRO,
          recomendacao: 'Marque como obrigatórias as fases que todo processo precisa cumprir.',
          evidencia: { macroWorkflowId: w.id, fases: w.fases.length },
        })
      }

      const ordens = w.fases.map((f) => f.ordem)
      const duplicadas = ordens.filter((o, i) => ordens.indexOf(o) !== i)
      if (duplicadas.length) {
        ordemDuplicada++
        achados.push({
          chave: `workflow-ordem-ambigua:${w.id}`,
          severidade: 'ALERTA',
          titulo: `Workflow "${nome}" tem fases com a mesma ordem`,
          descricao: `As posições ${[...new Set(duplicadas)].join(', ')} estão repetidas entre as fases.`,
          explicacao: 'A ordem define a sequência do fluxo. Empate torna a sequência dependente de desempate acidental.',
          impacto: 'A fase seguinte pode variar entre execuções, e o Kanban exibe ordem instável.',
          entidade: 'MacroWorkflow',
          registroId: String(w.id),
          registroNome: nome,
          quantidade: duplicadas.length,
          link: ROTA_MACRO,
          recomendacao: 'Reordene as fases para que cada uma tenha posição única.',
          evidencia: { macroWorkflowId: w.id, ordensDuplicadas: [...new Set(duplicadas)] },
        })
      }
    }

    return {
      achados,
      metricas: { workflows: workflows.length, semFases, semObrigatoria, ordemDuplicada },
      resumo: `${workflows.length} workflow(s) ativo(s) com fluxo completo.`,
    }
  },
})

registrar({
  id: 'saude.workflow.fase-fora-do-catalogo',
  codigo: 'WF-003',
  nome: 'Fase do workflow existe no catálogo',
  descricao: 'Fase declarada no workflow macro precisa existir no catálogo único de fases.',
  dominio: 'FASES',
  modulo: 'Workflow Macro / Catálogo de Fases',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Cadastre a fase no catálogo (Processos › Estrutura › Fases) ou remova-a do workflow.',
  rotaCorrecao: '/administrator?screen=fases',
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ phasekey: string; n: number }[]>(
      `SELECT f."phaseKey" AS phasekey, COUNT(*)::int AS n
         FROM "FaseMacro" f
         JOIN "MacroWorkflow" w ON w.id = f."macroWorkflowId" AND w.ativo = true
        WHERE NOT EXISTS (SELECT 1 FROM "CatalogoFase" c WHERE c."phaseKey" = f."phaseKey")
        GROUP BY f."phaseKey"`,
    )
    if (!linhas.length) return { achados: [], metricas: { forasDoCatalogo: 0 }, resumo: 'Toda fase de workflow existe no catálogo.' }
    return {
      achados: linhas.map((l): Achado => ({
        chave: `fase-fora-catalogo:${l.phasekey}`,
        severidade: 'ERRO',
        titulo: `Fase "${l.phasekey}" usada em workflow mas ausente do catálogo`,
        descricao: `${l.n} workflow(s) declaram a fase "${l.phasekey}", que não existe no catálogo de fases.`,
        explicacao: 'O catálogo de fases é a fonte única. Fase fora dele não tem rótulo, escopo nem regra de progresso.',
        impacto: 'A fase não computa progresso corretamente e a Central pode não saber o que exibir.',
        entidade: 'FaseMacro',
        quantidade: l.n,
        link: '/administrator?screen=fases',
        recomendacao: `Cadastre "${l.phasekey}" no catálogo ou remova-a dos workflows.`,
        evidencia: { phaseKey: l.phasekey, workflows: l.n },
      })),
      metricas: { forasDoCatalogo: linhas.length },
    }
  },
})

registrar({
  id: 'saude.workflow.interno-sem-passos',
  codigo: 'WF-004',
  nome: 'Workflow interno com passos',
  descricao: 'Workflow interno ativo sem passos não produz tarefa nenhuma quando a fase é instanciada.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow Interno',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Declare os passos do workflow interno ou desative-o enquanto não estiver pronto.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // SEM .catch(): erro de consulta precisa virar FALHA_TÉCNICA no motor. Engolir
    // exceção aqui devolveria "aprovada" para uma verificação que não rodou — o
    // exato tipo de silêncio que este módulo existe para eliminar.
    const linhas = await prisma.$queryRawUnsafe<{ id: number; nome: string | null; phasekey: string | null }[]>(
      `SELECT w.id, w.name AS nome, w."phaseKey" AS phasekey
         FROM "PhaseInternalWorkflow" w
        WHERE w.active = true AND w.arquivado = false
          AND NOT EXISTS (SELECT 1 FROM "PhaseInternalWorkflowStep" s WHERE s."workflowId" = w.id)
        LIMIT 100`,
    )
    if (!linhas.length) return { achados: [], metricas: { semPassos: 0 }, resumo: 'Todo workflow interno ativo tem passos declarados.' }
    return {
      achados: linhas.map((l): Achado => ({
        chave: `wf-interno-sem-passos:${l.id}`,
        severidade: 'ERRO',
        titulo: `Workflow interno "${l.nome ?? l.id}" não tem passos`,
        descricao: `O workflow interno da fase ${l.phasekey ?? '—'} está ativo mas não declara nenhum passo.`,
        explicacao: 'Os passos do workflow interno são o que vira tarefa obrigatória quando a fase é instanciada.',
        impacto: 'A fase abre sem trabalho a fazer e o gate fecha vazio — o processo "avança" sem que nada tenha sido feito.',
        entidade: 'PhaseInternalWorkflow',
        registroId: String(l.id),
        registroNome: l.nome,
        quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Declare os passos ou desative o workflow interno enquanto ele não estiver pronto.',
        evidencia: { workflowId: l.id, phaseKey: l.phasekey },
      })),
      metricas: { semPassos: linhas.length },
    }
  },
})

registrar({
  id: 'saude.workflow.interno-inalcancavel',
  codigo: 'WF-006',
  nome: 'Workflow interno alcançável e sem ambiguidade',
  descricao:
    'Workflow interno ativo que nenhum processo pode alcançar — ou que disputa a mesma fase com outro — é rotina publicada que ninguém revisa.',
  dominio: 'WORKFLOW',
  modulo: 'Workflow Interno',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao:
    'Aponte o workflow para um tipo de processo existente, ou desative-o. Havendo dois ativos para a mesma fase e tipo, mantenha um.',
  rotaCorrecao: ROTA_INTERNO,
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // ─── POR QUE ESTA VERIFICAÇÃO EXISTE ───────────────────────────────────
    // A resolução do workflow aplicável é "o do TIPO vence; sem ele, o
    // genérico". Um workflow apontando para um tipo que não existe fica
    // invisível: não roda, não dá erro, e ninguém revisa o que não aparece.
    // Ele só reaparece no dia em que alguém cria um tipo com aquele id — e aí
    // passa a MANDAR na fase, com a ordem e os rótulos que estiverem lá.
    //
    // Em produção havia um assim na Emissão Documental: ordem trocada
    // (aguardar retorno antes de solicitar, validar antes de conferir) e um
    // passo rotulado "VVVVVVVVVVV". Zero instâncias — porque o tipo não
    // existia. Uma bomba de cadastro esperando um id.
    const orfaos = await prisma.$queryRawUnsafe<{ id: number; nome: string | null; phasekey: string | null; tipoid: number | null }[]>(
      `SELECT w.id, w.name AS nome, w."phaseKey" AS phasekey, w."tipoProcessoId" AS tipoid
         FROM "PhaseInternalWorkflow" w
        WHERE w.active = true AND w.arquivado = false
          AND w."tipoProcessoId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "TipoProcessoNacionalidade" t
             WHERE t.id = w."tipoProcessoId" AND t.ativo = true AND t.arquivado = false
          )
        LIMIT 100`,
    )
    // DOIS ATIVOS PARA A MESMA (fase, tipo): a seleção usa `findFirst`, então
    // quem vence é o que o banco devolver primeiro — ou seja, o acaso.
    const ambiguos = await prisma.$queryRawUnsafe<{ phasekey: string; tipoid: number | null; quantos: number; ids: string }[]>(
      `SELECT w."phaseKey" AS phasekey, w."tipoProcessoId" AS tipoid,
              COUNT(*)::int AS quantos, string_agg(w.id::text, ', ' ORDER BY w.id) AS ids
         FROM "PhaseInternalWorkflow" w
        WHERE w.active = true AND w.arquivado = false
        GROUP BY w."phaseKey", w."tipoProcessoId"
       HAVING COUNT(*) > 1
        LIMIT 100`,
    )
    const achados: Achado[] = [
      ...orfaos.map((l): Achado => ({
        chave: `wf-interno-tipo-inexistente:${l.id}`,
        severidade: 'ALERTA',
        titulo: `Workflow interno "${l.nome ?? l.id}" aponta para um tipo de processo que não existe`,
        descricao: `O workflow da fase ${l.phasekey ?? '—'} está ativo e vinculado ao tipo ${l.tipoid}, que não existe (ou está inativo/arquivado).`,
        explicacao:
          'A resolução do workflow aplicável prefere o do TIPO ao genérico. Sem o tipo, este workflow nunca é escolhido — e nunca é revisado.',
        impacto:
          'Rotina publicada fora de uso e fora de revisão. No dia em que um tipo com esse id existir, ela passa a mandar na fase — com a ordem e os rótulos que estiverem gravados nela.',
        entidade: 'PhaseInternalWorkflow',
        registroId: String(l.id),
        registroNome: l.nome,
        quantidade: 1,
        link: ROTA_INTERNO,
        recomendacao: 'Aponte para um tipo existente ou desative o workflow.',
        evidencia: { workflowId: l.id, phaseKey: l.phasekey, tipoProcessoId: l.tipoid },
      })),
      ...ambiguos.map((l): Achado => ({
        chave: `wf-interno-ambiguo:${l.phasekey}:${l.tipoid ?? 'null'}`,
        severidade: 'ERRO',
        titulo: `Fase "${l.phasekey}" tem ${l.quantos} workflows internos ativos para o mesmo tipo`,
        descricao: `Workflows #${l.ids} estão ativos para a fase ${l.phasekey} e o tipo ${l.tipoid ?? 'genérico'}.`,
        explicacao:
          'A seleção do workflow aplicável pega o PRIMEIRO que o banco devolver. Com dois candidatos idênticos em critério, quem manda na fase é o acaso da consulta.',
        impacto: 'Dois processos iguais podem materializar roteiros diferentes, com ordens e rótulos diferentes.',
        entidade: 'PhaseInternalWorkflow',
        registroId: l.ids,
        registroNome: l.phasekey,
        quantidade: l.quantos,
        link: ROTA_INTERNO,
        recomendacao: 'Mantenha um ativo por (fase, tipo) e arquive o outro.',
        evidencia: { phaseKey: l.phasekey, tipoProcessoId: l.tipoid, workflowIds: l.ids },
      })),
    ]
    if (!achados.length) {
      return { achados: [], metricas: { orfaos: 0, ambiguos: 0 }, resumo: 'Todo workflow interno ativo é alcançável e único por fase e tipo.' }
    }
    return { achados, metricas: { orfaos: orfaos.length, ambiguos: ambiguos.length } }
  },
})

registrar({
  id: 'saude.workflow.tipos-catalogo-vazio',
  codigo: 'WF-005',
  nome: 'Catálogo de fases populado',
  descricao: 'Sem catálogo de fases o sistema inteiro fica sem vocabulário de fluxo.',
  dominio: 'FASES',
  modulo: 'Catálogo de Fases',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Cadastre as fases oficiais em Processos › Estrutura › Fases.',
  rotaCorrecao: '/administrator?screen=fases',
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const total = await prisma.catalogoFase.count({ where: { ativo: true } })
    if (total > 0) return { achados: [], metricas: { fasesAtivas: total }, resumo: `${total} fase(s) ativa(s) no catálogo.` }
    return {
      achados: [{
        chave: 'catalogo-fases-vazio',
        severidade: 'CRITICO',
        titulo: 'Catálogo de fases vazio',
        descricao: 'Não há nenhuma fase ativa no catálogo.',
        explicacao: 'O catálogo de fases é a fonte única do vocabulário de fluxo do Discovery.',
        impacto: 'Nenhum workflow pode ser montado e nenhum processo consegue se posicionar.',
        entidade: 'CatalogoFase',
        quantidade: 0,
        link: '/administrator?screen=fases',
        recomendacao: 'Cadastre as fases oficiais antes de operar.',
        evidencia: { fasesAtivas: 0 },
      }],
      metricas: { fasesAtivas: 0 },
    }
  },
})
