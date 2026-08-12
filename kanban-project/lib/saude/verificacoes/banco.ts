// lib/saude/verificacoes/banco.ts
//
// BANCO, MIGRATIONS E INTEGRIDADE — a fundação. Se isto está errado, o resto do
// diagnóstico não vale nada.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

registrar({
  id: 'saude.banco.conexao',
  codigo: 'DB-001',
  nome: 'Banco acessível e responsivo',
  descricao: 'Verifica conectividade e latência do banco — se isto falha, nenhum outro diagnóstico é confiável.',
  dominio: 'BANCO',
  modulo: 'Infraestrutura',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Verifique a variável de conexão e o pool. Latência alta costuma ser pool esgotado por transação longa.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const t0 = Date.now()
    await prisma.$queryRawUnsafe('SELECT 1')
    const latencia = Date.now() - t0
    const achados: Achado[] = []
    if (latencia > 2000) {
      achados.push({
        chave: 'banco-latencia-alta',
        severidade: latencia > 5000 ? 'ERRO' : 'ALERTA',
        titulo: `Banco respondendo em ${latencia}ms`,
        descricao: `Uma consulta trivial levou ${latencia}ms.`,
        explicacao: 'Latência alta em SELECT 1 indica saturação de pool, rede ou instância sobrecarregada.',
        impacto: 'Todas as telas ficam lentas; operações longas podem estourar timeout.',
        entidade: 'Banco',
        quantidade: 1,
        recomendacao: 'Verifique conexões abertas e transações longas.',
        evidencia: { latenciaMs: latencia },
      })
    }
    return { achados, metricas: { latenciaMs: latencia }, resumo: `Banco respondeu em ${latencia}ms.` }
  },
})

registrar({
  id: 'saude.migrations.pendentes',
  codigo: 'DB-002',
  nome: 'Migrations aplicadas e consistentes',
  descricao: 'Compara o histórico de migrations do banco com o esperado e detecta aplicação parcial.',
  dominio: 'MIGRATIONS',
  modulo: 'Infraestrutura',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Aplique as migrations pendentes pelo guard oficial de produção antes de qualquer operação.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const aplicadas = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    )
    const falhas = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL LIMIT 20`,
    )
    const achados: Achado[] = []
    if (falhas.length) {
      achados.push({
        chave: 'migration-incompleta',
        severidade: 'CRITICO',
        titulo: `${falhas.length} migration(s) não concluída(s)`,
        descricao: `As migrations ${falhas.map((f) => f.migration_name).join(', ')} não têm marca de conclusão ou foram revertidas.`,
        explicacao: 'Migration aplicada pela metade deixa o schema divergente do código: colunas podem faltar em runtime.',
        impacto: 'Erros imprevisíveis de coluna/tabela inexistente durante a operação.',
        entidade: '_prisma_migrations',
        quantidade: falhas.length,
        recomendacao: 'Resolva o estado da migration antes de seguir operando.',
        evidencia: { migrations: falhas.map((f) => f.migration_name) },
      })
    }
    return {
      achados,
      metricas: { aplicadas: aplicadas?.[0]?.n ?? 0, incompletas: falhas.length },
      resumo: `${aplicadas?.[0]?.n ?? 0} migrations aplicadas.`,
    }
  },
})

registrar({
  id: 'saude.integridade.sequencias-codigo',
  codigo: 'DB-003',
  nome: 'Sequências de código público sincronizadas',
  descricao: 'A sequência não pode estar atrás do maior código já gravado — se estiver, o próximo create colide.',
  dominio: 'INTEGRIDADE',
  modulo: 'Códigos públicos',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Rode a reconciliação de sequências (scripts/reconciliar-sequencias-codigo.ts).',
  correcaoAutomatica: 'reconciliar-sequencias',
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const alvos: { tabela: string; escopo: string; like: string }[] = [
      { tabela: 'OrgaoProtocolo', escopo: 'ORG', like: 'ORG%' },
      { tabela: 'TipoDocumentoCadastro', escopo: 'TDOC', like: 'DOC%' },
      { tabela: 'Contratante', escopo: 'CLI', like: 'CLI-%' },
      // Requerente compartilha a sequência CLI e é quem de fato concentra os
      // códigos de cliente. Sem ele aqui, a sincronização olhava a tabela com
      // 2 registros e ignorava a de 765 — e o contador podia ficar atrás do
      // maior código já gravado, entregando número repetido na próxima criação.
      { tabela: 'Requerente', escopo: 'CLI', like: 'CLI-%' },
      { tabela: 'Usuario', escopo: 'USR', like: 'USR-%' },
      { tabela: 'Fornecedor', escopo: 'FOR', like: 'FOR-%' },
    ]
    const achados: Achado[] = []
    const metricas: Record<string, number> = {}

    for (const a of alvos) {
      // Sem .catch(): erro de consulta sobe e vira FALHA_TÉCNICA no motor. Engolir
      // a exceção devolveria "aprovada" para algo que não foi verificado.
      const maxRow = await prisma.$queryRawUnsafe<{ max: number }[]>(
        `SELECT COALESCE(MAX(NULLIF(substring("publicCode" from '([0-9]+)$'), '')::bigint), 0)::int AS max
           FROM "${a.tabela}" WHERE "publicCode" LIKE $1`, a.like,
      )
      const seqRow = await prisma.$queryRawUnsafe<{ ultimo: number }[]>(
        `SELECT COALESCE("ultimo", 0)::int AS ultimo FROM "CodeSequence" WHERE scope = $1`, a.escopo,
      )
      const max = maxRow?.[0]?.max ?? 0
      const seq = seqRow?.[0]?.ultimo ?? 0
      metricas[`${a.escopo}_max`] = max
      metricas[`${a.escopo}_sequencia`] = seq
      if (max > seq) {
        achados.push({
          chave: `sequencia-atrasada:${a.escopo}`,
          severidade: 'ERRO',
          titulo: `Sequência ${a.escopo} atrás dos códigos gravados`,
          descricao: `O maior código de ${a.tabela} é ${max}, mas o contador está em ${seq}.`,
          explicacao: 'O gerador entrega o próximo número do contador; se ele está atrás, o código já existe e o insert falha (P2002).',
          impacto: `Criar novo registro de ${a.tabela} vai falhar com erro de duplicidade.`,
          entidade: a.tabela,
          quantidade: max - seq,
          recomendacao: 'Rode a reconciliação de sequências — é idempotente e monotônica.',
          correcaoAutomatica: 'reconciliar-sequencias',
          evidencia: { escopo: a.escopo, maiorCodigo: max, sequencia: seq },
        })
      }
    }
    return { achados, metricas, resumo: 'Sequências de código à frente dos dados.' }
  },
})

registrar({
  id: 'saude.integridade.codigos-duplicados',
  codigo: 'DB-004',
  nome: 'Códigos públicos únicos',
  descricao: 'Dois registros com o mesmo código público quebram a referência humana.',
  dominio: 'DUPLICIDADES',
  modulo: 'Códigos públicos',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Índice único deveria impedir. Se ocorreu, investigue escrita fora do fluxo oficial.',
  responsavel: 'Cadastros',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // O Processo guarda o código público em `codigo` (IT-1, ES-1…); as demais em
    // `publicCode`. Coluna errada geraria falha técnica, não silêncio.
    const tabelas: { nome: string; coluna: string }[] = [
      { nome: 'OrgaoProtocolo', coluna: 'publicCode' },
      { nome: 'TipoDocumentoCadastro', coluna: 'publicCode' },
      { nome: 'Contratante', coluna: 'publicCode' },
      { nome: 'Usuario', coluna: 'publicCode' },
      { nome: 'Fornecedor', coluna: 'publicCode' },
      { nome: 'Processo', coluna: 'codigo' },
    ]
    const achados: Achado[] = []
    for (const { nome: t, coluna } of tabelas) {
      const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT "${coluna}" FROM "${t}" WHERE "${coluna}" IS NOT NULL
            GROUP BY "${coluna}" HAVING COUNT(*) > 1) x`,
      )
      const n = r?.[0]?.n ?? 0
      if (n) {
        achados.push({
          chave: `codigo-duplicado:${t}`,
          severidade: 'CRITICO',
          titulo: `${n} código(s) duplicado(s) em ${t}`,
          descricao: `${n} código(s) público(s) aparecem em mais de um registro de ${t}.`,
          explicacao: 'O código público é referência humana única; duplicidade torna a citação ambígua.',
          impacto: 'Buscar pelo código traz o registro errado; documentos podem citar a entidade errada.',
          entidade: t,
          quantidade: n,
          recomendacao: 'Investigue a origem e regenere o código do registro mais novo.',
          evidencia: { tabela: t, duplicados: n },
        })
      }
    }
    return { achados, metricas: { tabelasVerificadas: tabelas.length }, resumo: 'Nenhum código público duplicado.' }
  },
})
