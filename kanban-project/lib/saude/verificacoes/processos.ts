// lib/saude/verificacoes/processos.ts
//
// PROCESSOS — o que impede um processo de andar.
//
// Cada achado aqui responde: qual processo, por que travou e onde se resolve.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const linkProcesso = (id: number) => `/kanban?processoId=${id}`
const ROTA_TIPOS = '/administrator?screen=proctypes'

/** Amostra citável — o operador precisa saber QUAIS registros, não só quantos. */
const amostra = <T extends { id: number; nome?: string | null }>(l: T[], n = 5) =>
  l.slice(0, n).map((p) => ({ id: p.id, nome: p.nome ?? null }))

registrar({
  id: 'saude.processos.sem-tipo',
  codigo: 'PROC-001',
  nome: 'Processo com tipo de processo definido',
  descricao: 'Processo sem tipo não resolve workflow, preço nem regra documental — fica órfão de configuração.',
  dominio: 'PROCESSOS',
  modulo: 'Processos',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Abra o processo e vincule o tipo (país + produto). Sem tipo, o motor não sabe qual workflow aplicar.',
  rotaCorrecao: ROTA_TIPOS,
  responsavel: 'Processos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const semTipo = await prisma.processo.findMany({
      where: { tipoProcessoMotorId: null, dataConclusao: null },
      select: { id: true, nome: true }, take: 200,
    })
    if (!semTipo.length) return { achados: [], metricas: { semTipo: 0 }, resumo: 'Todo processo ativo tem tipo definido.' }
    return {
      achados: [{
        chave: 'processo-sem-tipo',
        severidade: 'CRITICO',
        titulo: `${semTipo.length} processo(s) sem tipo de processo`,
        descricao: `${semTipo.length} processo(s) ativo(s) não têm tipo vinculado.`,
        explicacao: 'O tipo de processo (país + produto) é o que resolve workflow, matriz documental e configuração financeira.',
        impacto: 'Estes processos não conseguem instanciar workflow nem avançar de fase; nenhuma automação se aplica a eles.',
        entidade: 'Processo',
        registroId: String(semTipo[0].id),
        registroNome: semTipo[0].nome ?? null,
        quantidade: semTipo.length,
        link: linkProcesso(semTipo[0].id),
        recomendacao: 'Vincule o tipo em cada processo listado na evidência.',
        evidencia: { total: semTipo.length, amostra: amostra(semTipo) },
      }],
      metricas: { semTipo: semTipo.length },
    }
  },
})

registrar({
  id: 'saude.processos.sem-fase-atual',
  codigo: 'PROC-002',
  nome: 'Processo ativo com fase atual',
  descricao: 'Processo ativo sem fase atual não aparece no fluxo e não tem próxima transição possível.',
  dominio: 'PROCESSOS',
  modulo: 'Processos',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Reprocesse a criação V2 do processo ou posicione a fase manualmente na Central Operacional.',
  responsavel: 'Motor',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const semFase = await prisma.processo.findMany({
      where: { faseAtualKey: null, dataConclusao: null },
      select: { id: true, nome: true }, take: 200,
    })
    if (!semFase.length) return { achados: [], metricas: { semFase: 0 }, resumo: 'Todo processo ativo está posicionado em uma fase.' }
    return {
      achados: [{
        chave: 'processo-sem-fase-atual',
        severidade: 'ERRO',
        titulo: `${semFase.length} processo(s) sem fase atual`,
        descricao: `${semFase.length} processo(s) ativo(s) não têm fase atual definida.`,
        explicacao: 'A fase atual é o ponteiro do processo no workflow macro; sem ela não há gate, nem progresso, nem próxima transição.',
        impacto: 'O processo não avança e some das filas operacionais da Central.',
        entidade: 'Processo',
        registroId: String(semFase[0].id),
        registroNome: semFase[0].nome ?? null,
        quantidade: semFase.length,
        link: linkProcesso(semFase[0].id),
        recomendacao: 'Verifique se a criação V2 concluiu; reposicione a fase pela Central Operacional.',
        evidencia: { total: semFase.length, amostra: amostra(semFase) },
      }],
      metricas: { semFase: semFase.length },
    }
  },
})

registrar({
  id: 'saude.processos.fase-inexistente',
  codigo: 'PROC-003',
  nome: 'Fase atual existe no catálogo de fases',
  descricao: 'Processo apontando para uma fase que não existe mais no catálogo — ponteiro quebrado.',
  dominio: 'PROCESSOS',
  modulo: 'Processos / Fases',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Recrie a fase no catálogo ou mova os processos para uma fase válida antes de remover qualquer fase.',
  rotaCorrecao: '/administrator?screen=fases',
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ faseatualkey: string; n: number }[]>(
      `SELECT p."faseAtualKey" AS faseatualkey, COUNT(*)::int AS n
         FROM "Processo" p
        WHERE p."faseAtualKey" IS NOT NULL AND p."dataConclusao" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "CatalogoFase" c WHERE c."phaseKey" = p."faseAtualKey")
        GROUP BY p."faseAtualKey"`,
    )
    if (!linhas.length) return { achados: [], metricas: { fasesQuebradas: 0 }, resumo: 'Toda fase atual existe no catálogo.' }
    const total = linhas.reduce((a, l) => a + l.n, 0)
    return {
      achados: linhas.map((l): Achado => ({
        chave: `fase-inexistente:${l.faseatualkey}`,
        severidade: 'CRITICO',
        titulo: `Fase "${l.faseatualkey}" não existe no catálogo`,
        descricao: `${l.n} processo(s) ativo(s) apontam para a fase "${l.faseatualkey}", que não está no catálogo de fases.`,
        explicacao: 'O catálogo de fases (CatalogoFase) é a fonte única. Ponteiro para chave inexistente quebra gate, progresso e transição.',
        impacto: 'Processos travados: o motor não consegue calcular o que falta nem para onde avançar.',
        entidade: 'Processo',
        quantidade: l.n,
        link: '/administrator?screen=fases',
        recomendacao: `Recrie a fase "${l.faseatualkey}" no catálogo ou reposicione os processos afetados.`,
        evidencia: { phaseKey: l.faseatualkey, processos: l.n },
      })),
      metricas: { fasesQuebradas: linhas.length, processosAfetados: total },
    }
  },
})

registrar({
  id: 'saude.processos.sem-cliente',
  codigo: 'PROC-004',
  nome: 'Processo com cliente vinculado',
  descricao: 'Processo sem contratante nem requerente não tem a quem cobrar nem para quem entregar.',
  dominio: 'PROCESSOS',
  modulo: 'Processos',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Vincule ao menos um contratante ou requerente ao processo.',
  responsavel: 'Processos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ id: number; nome: string | null }[]>(
      `SELECT p.id, p.nome FROM "Processo" p
        WHERE p."dataConclusao" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "ProcessoContratante" c WHERE c."processoId" = p.id)
          AND NOT EXISTS (SELECT 1 FROM "ProcessoRequerente" r WHERE r."processoId" = p.id)
        LIMIT 200`,
    )
    if (!linhas.length) return { achados: [], metricas: { semCliente: 0 }, resumo: 'Todo processo ativo tem cliente vinculado.' }
    return {
      achados: [{
        chave: 'processo-sem-cliente',
        severidade: 'ERRO',
        titulo: `${linhas.length} processo(s) sem cliente`,
        descricao: `${linhas.length} processo(s) ativo(s) não têm contratante nem requerente vinculado.`,
        explicacao: 'Contratante é a relação comercial; requerente é quem pede a nacionalidade. Sem nenhum dos dois o processo não tem sujeito.',
        impacto: 'Não há a quem cobrar, para quem emitir documento nem a quem entregar o resultado.',
        entidade: 'Processo',
        registroId: String(linhas[0].id),
        registroNome: linhas[0].nome,
        quantidade: linhas.length,
        link: linkProcesso(linhas[0].id),
        recomendacao: 'Abra cada processo e vincule o contratante e/ou os requerentes.',
        evidencia: { total: linhas.length, amostra: amostra(linhas) },
      }],
      metricas: { semCliente: linhas.length },
    }
  },
})

registrar({
  id: 'saude.processos.multiplas-instancias-ativas',
  codigo: 'PROC-005',
  nome: 'Uma instância de workflow ativa por fase',
  descricao: 'Duas instâncias ativas na mesma fase produzem contagem dupla e gate ambíguo.',
  dominio: 'PROCESSOS',
  modulo: 'Motor / Workflow Interno',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Superseda a instância duplicada pelo Diagnóstico de Runtime; nunca apague — o histórico do ciclo é preservado.',
  rotaCorrecao: '/administrator?screen=runtimediag',
  responsavel: 'Motor',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ processoid: number; fasemacrokey: string; n: number }[]>(
      `SELECT "processoId" AS processoid, "faseMacroKey" AS fasemacrokey, COUNT(*)::int AS n
         FROM "PhaseWorkflowInstance"
        WHERE status IN ('ATIVO', 'BLOQUEADO')
        GROUP BY "processoId", "faseMacroKey"
       HAVING COUNT(*) > 1
        LIMIT 100`,
    )
    if (!linhas.length) return { achados: [], metricas: { duplicadas: 0 }, resumo: 'Nenhuma fase com instância de workflow duplicada.' }
    return {
      achados: linhas.map((l): Achado => ({
        chave: `instancia-duplicada:${l.processoid}:${l.fasemacrokey}`,
        severidade: 'ERRO',
        titulo: `Processo ${l.processoid} com ${l.n} instâncias ativas na fase ${l.fasemacrokey}`,
        descricao: `Há ${l.n} instâncias de workflow interno ativas simultaneamente na mesma fase.`,
        explicacao: 'O motor pressupõe uma instância ativa por fase/ciclo. Duas instâncias duplicam passos e tornam o gate ambíguo.',
        impacto: 'Progresso e gate ficam incorretos; a fase pode nunca fechar ou fechar sem que o trabalho tenha sido feito.',
        entidade: 'PhaseWorkflowInstance',
        registroId: String(l.processoid),
        quantidade: l.n,
        link: linkProcesso(l.processoid),
        recomendacao: 'Superseda a instância excedente pelo Diagnóstico de Runtime.',
        evidencia: { processoId: l.processoid, faseMacroKey: l.fasemacrokey, instancias: l.n },
      })),
      metricas: { duplicadas: linhas.length },
    }
  },
})

registrar({
  id: 'saude.processos.familia-orfa',
  codigo: 'PROC-900',
  nome: 'Família sem processo e sem árvore',
  descricao: 'Família que nenhuma porta do sistema alcança — ela só aparece somando no relatório.',
  dominio: 'PROCESSOS',
  modulo: 'Processos',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao:
    'Confira a evidência e exclua as famílias listadas — nenhuma tem processo ou árvore, então nada se perde. ' +
    'Se alguma for família real que você pretende usar, vincule-a a um processo.',
  rotaCorrecao: '/relatorios?d=familias',
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // Em 02/09/2026 existiam 61 destas em produção, com nomes como
    // "Árvore do Processo 458" e "teste" repetido dezesseis vezes: criar uma
    // árvore criava uma Família copiando o nome da árvore, e apagar o processo
    // não levava a família junto. O relatório dizia "63 famílias" existindo duas.
    //
    // A porta foi fechada e a exclusão passou a limpar. Esta verificação existe
    // para o caso de o resíduo voltar por um caminho que ninguém revisou.
    const orfas = await prisma.familia.findMany({
      where: { processos: { none: {} }, arvores: { none: {} } },
      select: { id: true, nome: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: 200,
    })
    if (!orfas.length) {
      return { achados: [], metricas: { familiasOrfas: 0 }, resumo: 'Toda família tem processo ou árvore.' }
    }
    return {
      achados: [{
        chave: 'familia-orfa',
        severidade: 'ERRO',
        titulo: `${orfas.length} família(s) sem processo e sem árvore`,
        descricao: `${orfas.length} família(s) não são alcançadas por nenhum processo nem por nenhuma árvore.`,
        explicacao:
          'Família é a unidade de atendimento: ela existe para agrupar processos. Sem processo e sem árvore, ' +
          'ninguém chega até ela por tela nenhuma — mas ela continua contando no relatório de Famílias.',
        impacto:
          'O relatório informa um total que não corresponde à operação. Número certo sobre dado sujo é pior que ' +
          'um erro: no erro a pessoa desconfia, neste não.',
        entidade: 'Familia',
        registroId: String(orfas[0].id),
        registroNome: orfas[0].nome,
        quantidade: orfas.length,
        link: '/relatorios?d=familias',
        recomendacao: 'Exclua as famílias órfãs, ou vincule a um processo aquelas que forem reais.',
        evidencia: { total: orfas.length, amostra: orfas.slice(0, 10).map((f) => ({ id: f.id, nome: f.nome })) },
      }],
      metricas: { familiasOrfas: orfas.length },
    }
  },
})
