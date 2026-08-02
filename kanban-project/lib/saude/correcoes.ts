// lib/saude/correcoes.ts
//
// CORREÇÃO AUTOMÁTICA — só o que é comprovadamente seguro e reversível.
//
// A regra é dura de propósito: uma correção automática só entra aqui se for
// idempotente, não destrutiva e sem ambiguidade de negócio. Tudo que envolve
// EXCLUSÃO, FUSÃO de duplicidade, alteração FINANCEIRA, mudança de workflow,
// substituição de documento, alteração de permissão ou decisão jurídica fica
// FORA — essas exigem decisão humana, e o motor apenas aponta.
//
// Toda execução registra auditoria com o resultado.

import { prisma } from '@/lib/prisma'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'
import { processarOutbox } from '@/src/services/outbox-dispatcher'

export interface ResultadoCorrecao {
  ok: boolean
  mensagem: string
  afetados: number
  detalhes?: Record<string, unknown>
}

export interface Correcao {
  id: string
  nome: string
  /** o que exatamente vai acontecer, em uma frase que o operador entende */
  descricao: string
  /** por que é segura: idempotente, não destrutiva, reversível */
  porqueSegura: string
  executar: () => Promise<ResultadoCorrecao>
}

const CORRECOES = new Map<string, Correcao>()
const registrar = (c: Correcao) => { CORRECOES.set(c.id, c); return c }

export const correcaoPorId = (id: string) => CORRECOES.get(id) ?? null
export const correcoes = () => [...CORRECOES.values()].map(({ executar: _e, ...meta }) => meta)

// ── reprocessar a fila de eventos ────────────────────────────────────────────
registrar({
  id: 'reprocessar-outbox',
  nome: 'Despachar a fila de eventos',
  descricao: 'Executa o dispatcher da outbox, drenando os eventos pendentes.',
  porqueSegura: 'O dispatcher é idempotente por construção: cada efeito é protegido por chave de idempotência, então reprocessar não duplica tarefa, lançamento nem avanço de fase.',
  executar: async () => {
    let processados = 0
    let falhos = 0
    for (let i = 0; i < 20; i++) {
      const r = await processarOutbox({ limite: 50 })
      processados += r.processados
      falhos += r.falhos
      if (r.lidos === 0) break
    }
    const restantes = await prisma.domainOutbox.count({ where: { status: 'PENDENTE' } })
    return {
      ok: falhos === 0,
      mensagem: `${processados} evento(s) despachado(s); ${restantes} ainda pendente(s)${falhos ? `; ${falhos} falha(s)` : ''}.`,
      afetados: processados,
      detalhes: { processados, falhos, restantes },
    }
  },
})

// ── ressincronizar sequências de código público ──────────────────────────────
registrar({
  id: 'reconciliar-sequencias',
  nome: 'Ressincronizar sequências de código',
  descricao: 'Alinha o contador de cada escopo com o maior código já gravado.',
  porqueSegura: 'A semente é monotônica (GREATEST): o contador só avança, nunca retrocede nem reaproveita número. Não toca em nenhum registro de negócio.',
  executar: async () => {
    const alvos = [
      { tabela: 'OrgaoProtocolo', escopo: 'ORG', like: 'ORG%' },
      { tabela: 'TipoDocumentoCadastro', escopo: 'TDOC', like: 'DOC%' },
      { tabela: 'Contratante', escopo: 'CLI', like: 'CLI-%' },
      { tabela: 'Usuario', escopo: 'USR', like: 'USR-%' },
      { tabela: 'Fornecedor', escopo: 'FOR', like: 'FOR-%' },
    ]
    let ajustados = 0
    const detalhes: Record<string, unknown> = {}
    for (const a of alvos) {
      const r = await prisma.$queryRawUnsafe<{ max: number }[]>(
        `SELECT COALESCE(MAX(NULLIF(substring("publicCode" from '([0-9]+)$'), '')::bigint), 0)::int AS max
           FROM "${a.tabela}" WHERE "publicCode" LIKE $1`, a.like,
      )
      const max = r?.[0]?.max ?? 0
      if (max <= 0) continue
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm") VALUES ($1, $2, now())
         ON CONFLICT ("scope") DO UPDATE SET "ultimo" = GREATEST("CodeSequence"."ultimo", $2), "atualizadoEm" = now()`,
        a.escopo, max,
      )
      detalhes[a.escopo] = max
      ajustados++
    }
    return { ok: true, mensagem: `${ajustados} sequência(s) ressincronizada(s).`, afetados: ajustados, detalhes }
  },
})

// ── gerar código público faltante ────────────────────────────────────────────
const geradorDeCodigo = (
  id: string,
  nome: string,
  modelo: 'orgaoProtocolo' | 'tipoDocumentoCadastro',
  entidade: 'ORGANIZATION' | 'DOCUMENT_TYPE',
  rotulo: string,
) => registrar({
  id,
  nome,
  descricao: `Gera o código público dos registros de ${rotulo} que estão sem.`,
  porqueSegura: 'Só PREENCHE campo vazio, usando o gerador central. Nenhum código existente é alterado e nenhum dado é removido.',
  executar: async () => {
    const alvo = prisma[modelo] as unknown as {
      findMany: (a: unknown) => Promise<{ id: number }[]>
      update: (a: unknown) => Promise<unknown>
    }
    const sem = await alvo.findMany({ where: { publicCode: null }, select: { id: true }, orderBy: { id: 'asc' }, take: 1000 })
    for (const r of sem) {
      const codigo = await gerarCodigoPublico(prisma, entidade)
      await alvo.update({ where: { id: r.id }, data: { publicCode: codigo } })
    }
    return { ok: true, mensagem: `${sem.length} código(s) gerado(s) para ${rotulo}.`, afetados: sem.length }
  },
})

geradorDeCodigo('gerar-codigo-organizacao', 'Gerar código de organizações', 'orgaoProtocolo', 'ORGANIZATION', 'Órgãos e Organizações')
geradorDeCodigo('gerar-codigo-tipo-documento', 'Gerar código de tipos de documento', 'tipoDocumentoCadastro', 'DOCUMENT_TYPE', 'Tipos de Documento')

// ── o que NUNCA é automático ─────────────────────────────────────────────────
/**
 * Ações proibidas de automatizar, por decisão de arquitetura. Ficam aqui
 * DECLARADAS para que a ausência seja explícita — e para a tela poder explicar
 * ao operador por que aquele achado não tem botão de correção.
 */
export const NUNCA_AUTOMATICO = [
  'exclusão de registros',
  'fusão de organizações ou pessoas duplicadas',
  'alteração de valor financeiro, cobrança ou pagamento',
  'mudança de workflow, fase ou transição',
  'substituição ou remoção de documento',
  'alteração de permissões e perfis',
  'qualquer ação com efeito jurídico',
  'qualquer decisão ambígua que dependa de contexto de negócio',
] as const
