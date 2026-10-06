// lib/saude/verificacoes/integridade-invariantes.ts
// ============================================================================
// VIGIA DAS REGRAS FIXAS (06/10/2026) — INT-002. SOMENTE LEITURA: varre TODOS os processos ativos contra as regras que o dono definiu
// depois do caso Fogli (Rodolfo pulando a Genealogia) e avisa por nome (certidão + pessoa + família). Nunca corrige sozinho.
// Roda no diagnóstico da Saúde (cron) e sob demanda (botão de Saúde / `executarVigiaDeIntegridade`).
//
//   R1  Nenhuma certidão em Emissão com "Localizar registro" não concluído.
//   R2  Nenhuma fase concluída (ou 100%) com passo obrigatório aberto.
//   R3  Certidão exigida nunca vira "não exigida"/cancelada sem decisão humana registrada (lista de certidões da pessoa × necessidade já andada).
//   R4  Toda pessoa com certidão exigida tem tarefa viva, na fase certa (Genealogia enquanto o registro não foi localizado).
//   R5  Toda tarefa aberta tem como ser atribuída pela Torre (pendência de fase anterior sem responsável precisa estar visível).
//   R6  Barra de fases, Central e Torre mostram o mesmo estado (tarefa aberta presa a instância já concluída/supersedida).
//   R7  Tela × banco: a lista "Certidões exigidas desta pessoa" gravada concorda com as necessidades que existem.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { lerDocumentosExigidosGravado, type CodigoDocumentoExigivel } from '@/src/lib/genealogia/documentos-exigidos'
import { PESSOA_ATIVA } from '@/src/lib/genealogia/vinculo-ativo'

export type RegraDoVigia = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7'

export interface ViolacaoDoVigia {
  regra: RegraDoVigia
  processoId: number
  familia: string
  certidao: string | null
  pessoa: string | null
  detalhe: string
  entidade: 'NecessidadeDocumental' | 'PhaseWorkflowStepInstance' | 'Tarefa' | 'Pessoa' | 'PhaseWorkflowInstance'
  registroId: number
}

const PASSO_ENCERRADO = ['CONCLUIDO', 'DISPENSADO', 'CANCELADO', 'SUPERSEDIDO']
const TAREFA_ENCERRADA = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA']
const EMISSAO_VIVA_SEM_TRAVA = ['PENDENTE', 'DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO', 'EXECUTADO', 'AGUARDANDO_APROVACAO']
const nomeDe = (p: { nome: string; sobrenome: string | null } | null | undefined) => (p ? [p.nome, p.sobrenome].filter(Boolean).join(' ') : null)
const codigoDoItem = (nome: string | null | undefined): CodigoDocumentoExigivel | null => {
  const t = (nome ?? '').toLowerCase()
  if (/nasc/.test(t)) return 'NAS'
  if (/casam/.test(t)) return 'CAS'
  if (/[óo]bito/.test(t)) return 'OBI'
  return null
}

/** O detector puro: lê o banco e devolve as violações. Nunca escreve. */
export async function detectarViolacoesDeIntegridade(): Promise<{ processos: number; violacoes: ViolacaoDoVigia[] }> {
  const processos = await prisma.processo.findMany({
    where: { arvoreId: { not: null }, dataConclusao: null, faseAtualKey: { not: 'finalizado' } },
    select: { id: true, nome: true, faseAtualKey: true, arvore: { select: { nome: true } } },
  })
  const procIds = processos.map((p) => p.id)
  const proc = new Map(processos.map((p) => [p.id, p]))
  const familia = (id: number) => proc.get(id)?.arvore?.nome ?? proc.get(id)?.nome ?? `processo #${id}`
  const out: ViolacaoDoVigia[] = []
  if (procIds.length === 0) return { processos: 0, violacoes: out }

  const necs = await prisma.necessidadeDocumental.findMany({
    where: { processoId: { in: procIds }, supersedePorId: null },
    select: {
      id: true, processoId: true, status: true, pessoaId: true, uniaoId: true, itemCatalogo: { select: { name: true } },
      pessoa: { select: { id: true, nome: true, sobrenome: true, vivo: true, linhaReta: true, documentacao: true, documentosExigidos: true, removidaEm: true } },
      uniao: { select: { pessoa1: { select: { nome: true, sobrenome: true } }, pessoa2: { select: { nome: true, sobrenome: true } } } },
      documentos: { select: { id: true } },
    },
  })
  const necPorId = new Map(necs.map((n) => [n.id, n]))
  const quem = (n: (typeof necs)[number]) => nomeDe(n.pessoa) ?? [nomeDe(n.uniao?.pessoa1), nomeDe(n.uniao?.pessoa2)].filter(Boolean).join(' e ') ?? null
  const certidaoDe = (n: (typeof necs)[number]) => n.itemCatalogo?.name ?? 'Documento'

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId: { in: procIds }, status: { not: 'SUPERSEDIDO' } },
    select: { id: true, processoId: true, stepKey: true, status: true, obrigatorio: true, necessidadeId: true, documentoId: true, faseMacroKey: true, workflowInstance: { select: { id: true, status: true, faseMacroKey: true, ciclo: true } } },
  })
  const docNec = new Map(
    (await prisma.documento.findMany({ where: { id: { in: passos.map((p) => p.documentoId).filter((x): x is number => x != null) } }, select: { id: true, necessidadeId: true } })).map((d) => [d.id, d.necessidadeId]),
  )
  const necDoPasso = (p: (typeof passos)[number]) => p.necessidadeId ?? (p.documentoId != null ? docNec.get(p.documentoId) ?? null : null)

  const localizar = passos.filter((p) => p.stepKey === 'localizar_registro')
  const localizadoPorNec = new Map<number, { resolvido: boolean; aberto: boolean }>()
  for (const p of localizar) {
    const n = p.necessidadeId
    if (n == null) continue
    const e = localizadoPorNec.get(n) ?? { resolvido: false, aberto: false }
    if (p.status === 'CONCLUIDO' || p.status === 'DISPENSADO') e.resolvido = true
    else if (!PASSO_ENCERRADO.includes(p.status)) e.aberto = true
    localizadoPorNec.set(n, e)
  }

  // R1 — certidão em Emissão sem "Localizar registro" concluído.
  for (const p of passos.filter((x) => x.stepKey === 'solicitar_certidao' && EMISSAO_VIVA_SEM_TRAVA.includes(x.status))) {
    const nid = necDoPasso(p)
    const n = nid != null ? necPorId.get(nid) : undefined
    if (!n || n.status === 'DISPENSADA') continue
    const loc = localizadoPorNec.get(n.id)
    if (loc?.resolvido && !loc.aberto) continue
    out.push({ regra: 'R1', processoId: p.processoId, familia: familia(p.processoId), certidao: certidaoDe(n), pessoa: quem(n), detalhe: loc?.aberto ? 'Localizar registro ainda aberto' : 'nenhum Localizar registro concluído', entidade: 'PhaseWorkflowStepInstance', registroId: p.id })
  }

  // R2 — fase concluída com passo obrigatório aberto.
  for (const p of passos) {
    if (!p.obrigatorio || PASSO_ENCERRADO.includes(p.status)) continue
    if (p.workflowInstance.status !== 'CONCLUIDO') continue
    const nid = necDoPasso(p)
    const n = nid != null ? necPorId.get(nid) : undefined
    if (n?.status === 'DISPENSADA') continue
    out.push({ regra: 'R2', processoId: p.processoId, familia: familia(p.processoId), certidao: n ? certidaoDe(n) : p.stepKey, pessoa: n ? quem(n) : null, detalhe: `fase ${p.workflowInstance.faseMacroKey} (ciclo ${p.workflowInstance.ciclo}) concluída com o passo ${p.stepKey} em ${p.status}`, entidade: 'PhaseWorkflowStepInstance', registroId: p.id })
  }

  // R3 — necessidade que já andou, cuja certidão a lista da pessoa tirou SEM decisão humana registrada.
  const logsDecisao = await prisma.logAuditoria.findMany({
    where: { acao: 'PESSOA_DOCUMENTOS_EXIGIDOS_ALTERADOS', entidade: 'Pessoa', entidadeId: { in: necs.map((n) => n.pessoaId).filter((x): x is number => x != null) } },
    select: { entidadeId: true, detalhes: true },
  })
  const comDecisao = new Set(logsDecisao.filter((l) => (l.detalhes as { decisaoHumana?: unknown } | null)?.decisaoHumana === true).map((l) => l.entidadeId))
  for (const n of necs) {
    if (!n.pessoa || !['EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA'].includes(n.status)) continue
    const cod = codigoDoItem(n.itemCatalogo?.name)
    const lista = lerDocumentosExigidosGravado(n.pessoa.documentosExigidos)
    if (!cod || lista == null || lista.includes(cod) || comDecisao.has(n.pessoa.id)) continue
    out.push({ regra: 'R3', processoId: n.processoId, familia: familia(n.processoId), certidao: certidaoDe(n), pessoa: quem(n), detalhe: `a lista de certidões da pessoa não inclui ${cod}, a certidão já andou (${n.status}) e não há decisão humana registrada`, entidade: 'NecessidadeDocumental', registroId: n.id })
  }

  // R4 — certidão exigida sem tarefa viva, ou com tarefa na fase errada.
  const tarefas = await prisma.tarefa.findMany({
    where: { processoId: { in: procIds }, origem: { not: 'MANUAL' } },
    select: { id: true, processoId: true, necessidadeId: true, documentoId: true, statusTarefa: true, faseMacroKey: true, responsavelId: true, titulo: true, workflowInstance: { select: { status: true, faseMacroKey: true } } },
  })
  const tarefaDaNec = new Map<number, typeof tarefas>()
  const necDoDoc = new Map<number, number>()
  for (const n of necs) for (const d of n.documentos) necDoDoc.set(d.id, n.id)
  for (const t of tarefas) {
    const nid = t.necessidadeId ?? (t.documentoId != null ? necDoDoc.get(t.documentoId) ?? null : null)
    if (nid == null) continue
    const arr = tarefaDaNec.get(nid) ?? []
    arr.push(t)
    tarefaDaNec.set(nid, arr)
  }
  for (const n of necs) {
    if (codigoDoItem(n.itemCatalogo?.name) == null) continue // só certidão tem tarefa por desenho (RG, comprovante, procuração não)
    if (n.status === 'DISPENSADA' || n.status === 'ATENDIDA' || !n.pessoa || n.pessoa.removidaEm || !n.pessoa.linhaReta || n.pessoa.documentacao === false) continue
    const ts = tarefaDaNec.get(n.id) ?? []
    const vivas = ts.filter((t) => !TAREFA_ENCERRADA.includes(t.statusTarefa))
    if (vivas.length === 0) {
      out.push({ regra: 'R4', processoId: n.processoId, familia: familia(n.processoId), certidao: certidaoDe(n), pessoa: quem(n), detalhe: `certidão exigida (${n.status}) sem tarefa viva`, entidade: 'NecessidadeDocumental', registroId: n.id })
      continue
    }
    const loc = localizadoPorNec.get(n.id)
    if (loc?.aberto && !vivas.some((t) => t.faseMacroKey === 'genealogia')) {
      out.push({ regra: 'R4', processoId: n.processoId, familia: familia(n.processoId), certidao: certidaoDe(n), pessoa: quem(n), detalhe: `Localizar registro aberto, mas a tarefa está em ${vivas[0].faseMacroKey ?? 'outra fase'} (deveria estar na Genealogia)`, entidade: 'Tarefa', registroId: vivas[0].id })
    }
  }

  // R5 — pendência de fase anterior sem responsável (precisa estar visível e atribuível pela Torre).
  for (const t of tarefas) {
    if (t.processoId == null || TAREFA_ENCERRADA.includes(t.statusTarefa) || t.responsavelId != null) continue
    const p = proc.get(t.processoId)
    if (!p || !t.faseMacroKey || t.faseMacroKey === p.faseAtualKey) continue
    const n = t.necessidadeId != null ? necPorId.get(t.necessidadeId) : undefined
    out.push({ regra: 'R5', processoId: t.processoId, familia: familia(t.processoId), certidao: n ? certidaoDe(n) : t.titulo, pessoa: n ? quem(n) : null, detalhe: `tarefa aberta da fase ${t.faseMacroKey} (processo está em ${p.faseAtualKey}) sem responsável`, entidade: 'Tarefa', registroId: t.id })
  }

  // R6 — tarefa aberta presa a instância concluída/supersedida (barra, Central e Torre divergem).
  for (const t of tarefas) {
    if (t.processoId == null || TAREFA_ENCERRADA.includes(t.statusTarefa) || !t.workflowInstance) continue
    if (t.workflowInstance.status !== 'CONCLUIDO' && t.workflowInstance.status !== 'SUPERSEDIDO') continue
    const n = t.necessidadeId != null ? necPorId.get(t.necessidadeId) : undefined
    out.push({ regra: 'R6', processoId: t.processoId, familia: familia(t.processoId), certidao: n ? certidaoDe(n) : t.titulo, pessoa: n ? quem(n) : null, detalhe: `tarefa ${t.statusTarefa} ligada à instância ${t.workflowInstance.faseMacroKey} já ${t.workflowInstance.status}`, entidade: 'Tarefa', registroId: t.id })
  }

  // R7 — lista gravada × necessidades que existem.
  const pessoas = await prisma.pessoa.findMany({
    where: { arvore: { processos: { some: { id: { in: procIds } } } }, ...PESSOA_ATIVA },
    select: { id: true, nome: true, sobrenome: true, arvoreId: true, documentosExigidos: true, vivo: true },
  })
  for (const pe of pessoas) {
    const lista = lerDocumentosExigidosGravado(pe.documentosExigidos)
    if (lista == null) continue
    for (const n of necs.filter((x) => x.pessoaId === pe.id && x.status !== 'DISPENSADA')) {
      const cod = codigoDoItem(n.itemCatalogo?.name)
      if (cod && !lista.includes(cod) && n.status === 'PENDENTE') {
        out.push({ regra: 'R7', processoId: n.processoId, familia: familia(n.processoId), certidao: certidaoDe(n), pessoa: quem(n), detalhe: `a lista gravada (${lista.join(', ') || 'vazia'}) não inclui ${cod}, mas a necessidade segue ativa`, entidade: 'NecessidadeDocumental', registroId: n.id })
      }
    }
  }

  return { processos: processos.length, violacoes: out }
}

const TITULO: Record<RegraDoVigia, string> = {
  R1: 'certidão em Emissão sem "Localizar registro" concluído',
  R2: 'fase concluída com passo obrigatório aberto',
  R3: 'certidão já andada tirada da lista sem decisão humana',
  R4: 'certidão exigida sem tarefa (ou na fase errada)',
  R5: 'pendência de fase anterior sem responsável',
  R6: 'tarefa aberta presa a fase já concluída',
  R7: 'lista de certidões da pessoa × necessidades divergem',
}

registrar({
  id: 'saude.integridade.regras-fixas',
  codigo: 'INT-002',
  nome: 'Regras fixas de integridade (Genealogia × Emissão × Torre)',
  descricao: 'Varre todos os processos ativos contra as 7 regras fixas definidas em 06/10/2026 (caso Fogli): certidão só na Emissão com o registro localizado; fase concluída sem passo obrigatório aberto; certidão andada nunca "não exigida" sem decisão humana; toda certidão exigida com tarefa na fase certa; toda tarefa aberta atribuível; barra/Central/Torre no mesmo estado; lista de certidões da pessoa coerente. Somente leitura.',
  dominio: 'ARVORE',
  modulo: 'Genealogia',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.12.0',
  timeoutMs: 120_000,
  orientacao: 'Cada achado nomeia certidão, pessoa e família. Nada é corrigido sozinho: abra o processo e decida (ou peça a correção).',
  rotaCorrecao: '/operacao',
  correcaoAutomatica: null,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const { processos, violacoes } = await detectarViolacoesDeIntegridade()
    const achados: Achado[] = violacoes.map((v) => ({
      chave: `INT-002:${v.regra}:${v.entidade}:${v.registroId}`,
      severidade: v.regra === 'R5' || v.regra === 'R7' ? 'ALERTA' : 'ERRO',
      titulo: `${v.regra} — ${TITULO[v.regra]}: ${v.certidao ?? '—'}${v.pessoa ? ` · ${v.pessoa}` : ''} (família ${v.familia} · processo #${v.processoId})`,
      descricao: v.detalhe,
      entidade: v.entidade, registroId: String(v.registroId), registroNome: `${v.certidao ?? ''}${v.pessoa ? ` · ${v.pessoa}` : ''}`.trim(),
      link: `/torre/processo/${v.processoId}`,
      recomendacao: 'Somente leitura: abra o processo e resolva (o vigia nunca corrige sozinho).',
      evidencia: { regra: v.regra, processoId: v.processoId, familia: v.familia, certidao: v.certidao, pessoa: v.pessoa },
    }))
    const porRegra: Record<string, number> = {}
    for (const v of violacoes) porRegra[v.regra] = (porRegra[v.regra] ?? 0) + 1
    return { achados, metricas: { processos, violacoes: violacoes.length, ...porRegra }, resumo: violacoes.length === 0 ? `${processos} processos conferidos: nenhuma violação.` : `${violacoes.length} violação(ões) em ${processos} processos.` }
  },
})

/** Sob demanda (comando/botão): o mesmo detector, formatado por nome. */
export async function executarVigiaDeIntegridade() {
  const { processos, violacoes } = await detectarViolacoesDeIntegridade()
  return { processos, violacoes, linhas: violacoes.map((v) => `${v.regra} | ${v.certidao ?? '—'} | ${v.pessoa ?? '—'} | família ${v.familia} (processo ${v.processoId}) | ${v.detalhe}`) }
}
