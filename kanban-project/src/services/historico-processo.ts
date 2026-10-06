// src/services/historico-processo.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — o serviço que LÊ as fontes existentes, EM LOTE (nenhuma
// consulta por linha), e entrega os fatos já redigidos por `lib/operacional/
// historico-processo.ts`. É a ÚNICA fonte do histórico: a aba "Histórico" do
// processo e o Foco da família na Torre chamam esta mesma função (por rotas
// diferentes só para cada uma manter a sua permissão).
//
// Nada é gravado aqui e nenhuma tabela nasce: o histórico é PROJEÇÃO de
//   LogAuditoria · TarefaHistorico · WorkflowEvento · PhaseAdvanceLog ·
//   NecessidadeDocumentalEvento · ContatoTerceiro · ComentarioTarefa ·
//   SolicitacaoDocumento · SubtaskExecution · StepExecution · DocumentoObservacao.
//
// ESCOPO: por IDENTIDADE do processo — tarefas, passos, necessidades e
// documentos DESTE processo; nunca por nome/texto.
// ============================================================================
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { VINCULO_PROCESSO_ATIVO } from '@/src/lib/genealogia/vinculo-ativo'
import { titularDaUniao, SELECT_UNIAO_PARA_TITULAR } from '@/src/services/genealogia/titular-uniao'
import { labelDaFasePorPhaseKey, phaseKeyToFaseCode, rotuloDoPasso } from '@/src/lib/process-stage/fases-catalog'
import { TIPO_DOCUMENTO_LABELS } from '@/src/lib/process-stage/estrutura-operacional'
import { idsDeUsuarioNoTexto } from '@/lib/operacional/historico-apresentacao'
import {
  montarFatos, type ContextoDoHistorico, type FatoDoHistorico, type LinhaCrua, type ModoDeAgrupamento,
} from '@/lib/operacional/historico-processo'

/** Teto de linhas por fonte — o serviço diz quando cortou (`truncado`), nunca corta em silêncio. */
export const LIMITE_POR_FONTE = 5000

export interface HistoricoDoProcesso {
  processo: { id: number; nome: string; codigo: string | null; pais: string | null; familiaId: number | null; familiaNome: string | null; faseAtual: string | null }
  geradoEm: string
  fatos: FatoDoHistorico[]
  descartados: Record<string, number>
  naoClassificados: Record<string, number>
  truncado: boolean
}

type J = Record<string, unknown> | null
const asJ = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const ids = <T>(xs: Array<T | null | undefined>): T[] => [...new Set(xs.filter((x): x is T => x != null))]
const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Tipos de WorkflowEvento que carregam FATO (o resto é mecânica interna e nem é lido). */
const WORKFLOW_COM_FATO = ['FASE_AVANCADA', 'FASE_AVANCADA_FORCADO', 'FASE_RETORNADA', 'FASE_MOVIDA', 'FASE_REABERTA', 'TAREFA_BLOQUEADA'] as const

export async function historicoDoProcesso(processoId: number, opcoes: { agora?: Date; /** cliente instrumentado (teste de contagem de consultas) */ db?: PrismaClient; /** `minuto` = linha do tempo da Torre (lote por identificador, ou usuário + ação + mesmo minuto); padrão: sequência (aba Histórico) */ agrupar?: ModoDeAgrupamento } = {}): Promise<HistoricoDoProcesso | null> {
  const agora = opcoes.agora ?? new Date()
  const db = opcoes.db ?? prisma
  const proc = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, familiaId: true, arvoreId: true, paisCanonico: { select: { countryLabel: true } }, familia: { select: { nome: true } } },
  })
  if (!proc) return null

  // ── ONDA 1: o vocabulário do processo (quem existe nele) ───────────────────
  const [tarefas, necessidades, passos, arvorePessoas, requerentes] = await Promise.all([
    db.tarefa.findMany({ where: { processoId }, select: { id: true, titulo: true, documentoId: true, necessidadeId: true, pessoaId: true, faseMacroKey: true, statusTarefa: true, responsavelId: true } }),
    db.necessidadeDocumental.findMany({ where: { processoId }, select: { id: true, pessoaId: true, itemCatalogo: { select: { name: true } }, uniao: { select: SELECT_UNIAO_PARA_TITULAR } } }),
    db.phaseWorkflowStepInstance.findMany({ where: { processoId }, select: { id: true, stepKey: true, snapshot: true, faseMacroKey: true, documentoId: true, necessidadeId: true, pessoaId: true } }),
    proc.arvoreId ? db.pessoa.findMany({ where: { arvoreId: proc.arvoreId }, select: { id: true, nome: true, sobrenome: true } }) : Promise.resolve([]),
    db.processoRequerente.count({ where: { processoId, ...VINCULO_PROCESSO_ATIVO } }),
  ])
  const tarefaIds = tarefas.map((t) => t.id)
  const necIds = necessidades.map((n) => n.id)
  const passoIds = passos.map((p) => p.id)
  const pessoaIdsDaArvore = arvorePessoas.map((p) => p.id)
  const docIdsReferenciados = ids([...tarefas.map((t) => t.documentoId), ...passos.map((p) => p.documentoId)])

  // ── ONDA 2: as fontes (todas em lote) ──────────────────────────────────────
  const [subtarefas, execucoesDePasso, solicitacoes, documentos] = await Promise.all([
    passoIds.length ? db.subtaskExecution.findMany({ where: { stepInstanceId: { in: passoIds } }, orderBy: { id: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, stepInstanceId: true, subtaskKey: true, completedAt: true, executadoPorId: true, resultado: true } }) : Promise.resolve([]),
    passoIds.length ? db.stepExecution.findMany({ where: { stepInstanceId: { in: passoIds }, completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, stepInstanceId: true, completedAt: true, executadoPorId: true } }) : Promise.resolve([]),
    db.solicitacaoDocumento.findMany({ where: { processoId }, orderBy: { createdAt: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, documentoId: true, tarefaId: true, canal: true, destinatarioNome: true, criadoPorId: true, createdAt: true, orgao: { select: { name: true, nomeFantasia: true } } } }),
    db.documento.findMany({
      where: { OR: [...(pessoaIdsDaArvore.length ? [{ pessoaId: { in: pessoaIdsDaArvore } }] : []), ...(docIdsReferenciados.length ? [{ id: { in: docIdsReferenciados } }] : [])] },
      select: { id: true, pessoaId: true, tipo: true, status: true, necessidadeId: true },
    }),
  ])
  const docIds = documentos.map((d) => d.id)
  const solicitacaoIds = solicitacoes.map((s) => s.id)
  const subtarefaIds = subtarefas.map((s) => s.id)

  const [logs, eventosWorkflow, avancos, eventosNec, contatos, comentarios, observacoes, historicoTarefa] = await Promise.all([
    db.logAuditoria.findMany({
      where: {
        OR: [
          ...(tarefaIds.length ? [{ entidade: { in: ['Tarefa', 'TAREFA'] }, entidadeId: { in: tarefaIds } }] : []),
          { entidade: { in: ['Processo', 'PROCESSO'] }, entidadeId: processoId },
          ...(necIds.length ? [{ entidade: 'NecessidadeDocumental', entidadeId: { in: necIds } }] : []),
          ...(docIds.length ? [{ entidade: 'Documento', entidadeId: { in: docIds }, acao: 'DOCUMENTO_ORFAO_NAO_EXIGIDO' }] : []),
          ...(passoIds.length ? [{ entidade: 'PhaseWorkflowStepInstance', entidadeId: { in: passoIds } }] : []),
          ...(subtarefaIds.length ? [{ entidade: 'SubtaskExecution', entidadeId: { in: subtarefaIds } }] : []),
          ...(solicitacaoIds.length ? [{ entidade: 'SolicitacaoDocumento', entidadeId: { in: solicitacaoIds }, acao: 'PROTOCOLO_INFORMADO_POSTERIORMENTE' }] : []),
        ],
      },
      orderBy: { criadoEm: 'desc' }, take: LIMITE_POR_FONTE,
      select: { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, detalhes: true, usuarioId: true, criadoEm: true },
    }),
    db.workflowEvento.findMany({ where: { processoId, tipo: { in: [...WORKFLOW_COM_FATO] } }, orderBy: { criadoEm: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, tipo: true, entityType: true, entityId: true, tarefaId: true, stepInstanceId: true, dados: true, criadoEm: true } }),
    db.phaseAdvanceLog.findMany({ where: { processoId, resultado: { notIn: ['BLOQUEADO', 'IDEMPOTENTE', 'CONFLITO'] } }, orderBy: { criadoEm: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, faseAtual: true, fasePretendida: true, resultado: true, origem: true, solicitadoPorId: true, forcado: true, justificativa: true, criadoEm: true } }),
    necIds.length ? db.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: { in: necIds } }, orderBy: { criadoEm: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, necessidadeId: true, tipo: true, descricao: true, dados: true, criadoEm: true } }) : Promise.resolve([]),
    tarefaIds.length ? db.contatoTerceiro.findMany({ where: { tarefaId: { in: tarefaIds }, estornadoEm: null }, orderBy: { registradoEm: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, tarefaId: true, documentoId: true, canal: true, resultado: true, observacao: true, registradoPorId: true, registradoEm: true, orgao: { select: { name: true, nomeFantasia: true } } } }) : Promise.resolve([]),
    db.comentarioTarefa.findMany({ where: { OR: [...(tarefaIds.length ? [{ tarefaId: { in: tarefaIds } }] : []), ...(proc.familiaId != null ? [{ familiaId: proc.familiaId }] : [])] }, orderBy: { criadoEm: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, tarefaId: true, familiaId: true, autorId: true, texto: true, criadoEm: true } }),
    docIds.length ? db.documentoObservacao.findMany({ where: { documentoId: { in: docIds } }, orderBy: { createdAt: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, documentoId: true, texto: true, criadoPorId: true, createdAt: true } }) : Promise.resolve([]),
    tarefaIds.length ? db.tarefaHistorico.findMany({ where: { tarefaId: { in: tarefaIds }, acao: { in: ['COMENTARIO', 'ACOMPANHAMENTO_ADIADO'] } }, orderBy: { createdAt: 'desc' }, take: LIMITE_POR_FONTE, select: { id: true, tarefaId: true, acao: true, descricao: true, dados: true, usuarioId: true, createdAt: true } }) : Promise.resolve([]),
  ])
  const truncado = [logs, eventosWorkflow, avancos, eventosNec, contatos, comentarios, observacoes, historicoTarefa, subtarefas, execucoesDePasso, solicitacoes].some((l) => l.length >= LIMITE_POR_FONTE)

  // Passos citados só dentro de `detalhes` de logs (ex.: cancelamento de operação) e que não são deste conjunto — raro, mas o vocabulário os inclui.
  const passoIdsDosLogs = ids(logs.flatMap((l) => { const d = asJ(l.detalhes); return [numOf(d?.stepInstanceId), l.entidade === 'PhaseWorkflowStepInstance' ? l.entidadeId : null] }))
  const passosExtras = passoIdsDosLogs.filter((i) => !passoIds.includes(i))
  const passosDeFora = passosExtras.length
    ? await db.phaseWorkflowStepInstance.findMany({ where: { id: { in: passosExtras }, processoId }, select: { id: true, stepKey: true, snapshot: true, faseMacroKey: true, documentoId: true, necessidadeId: true, pessoaId: true } })
    : []
  const todosPassos = [...passos, ...passosDeFora]

  // ── ONDA 3: nomes (uma consulta por tipo de nome) ──────────────────────────
  const usuarioIds = ids<number>([
    ...logs.flatMap((l) => { const d = asJ(l.detalhes); return [l.usuarioId, numOf(d?.de), numOf(d?.para), numOf(d?.responsavelId)] }),
    ...tarefas.map((t) => t.responsavelId),
    ...subtarefas.map((s) => s.executadoPorId), ...execucoesDePasso.map((e) => e.executadoPorId),
    ...solicitacoes.map((s) => s.criadoPorId), ...contatos.map((c) => c.registradoPorId),
    ...comentarios.map((c) => c.autorId), ...observacoes.map((o) => o.criadoPorId), ...historicoTarefa.map((h) => h.usuarioId),
    ...avancos.map((a) => a.solicitadoPorId),
    // ids citados DENTRO do texto gravado ("passadas ao usuário 7"): resolvidos aqui, em lote, para a exibição traduzir (nada é regravado).
    ...logs.flatMap((l) => [...idsDeUsuarioNoTexto(l.descricao), ...idsDeUsuarioNoTexto((typeof asJ(l.detalhes)?.motivo === 'string' ? (asJ(l.detalhes)?.motivo as string) : null))]),
  ])
  const pessoaIdsCitados = ids<number>([
    ...pessoaIdsDaArvore, ...tarefas.map((t) => t.pessoaId), ...documentos.map((d) => d.pessoaId), ...necessidades.map((n) => n.pessoaId),
    ...necessidades.map((n) => titularDaUniao(n.uniao)), ...todosPassos.map((p) => p.pessoaId),
  ])
  const pessoasFora = pessoaIdsCitados.filter((i) => !pessoaIdsDaArvore.includes(i))
  const fasesCitadas = ids<string>([
    proc.faseAtualKey, ...tarefas.map((t) => t.faseMacroKey), ...todosPassos.map((p) => p.faseMacroKey),
    ...avancos.flatMap((a) => [a.faseAtual, a.fasePretendida]),
    ...eventosWorkflow.flatMap((e) => { const d = asJ(e.dados); return [typeof d?.de === 'string' ? d.de : null, typeof d?.para === 'string' ? d.para : null, typeof d?.faseDestino === 'string' ? d.faseDestino : null] }),
    ...logs.flatMap((l) => { const d = asJ(l.detalhes); return [typeof d?.faseMacroKey === 'string' ? d.faseMacroKey : null, typeof d?.primeiraFase === 'string' ? d.primeiraFase : null, typeof d?.deFase === 'string' ? d.deFase : null, typeof d?.paraFase === 'string' ? d.paraFase : null] }),
  ])
  const [usuarios, pessoasExtras, catalogo] = await Promise.all([
    usuarioIds.length ? db.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
    pessoasFora.length ? db.pessoa.findMany({ where: { id: { in: pessoasFora } }, select: { id: true, nome: true, sobrenome: true } }) : Promise.resolve([]),
    fasesCitadas.length ? db.catalogoFase.findMany({ where: { phaseKey: { in: fasesCitadas } }, select: { phaseKey: true, label: true } }) : Promise.resolve([]),
  ])
  const rotuloCadastro = new Map(catalogo.map((c) => [c.phaseKey, c.label]))
  const nomeCompleto = (p: { nome: string; sobrenome: string | null }) => `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ''}`
  const pessoas: Record<number, string> = {}
  for (const p of [...arvorePessoas, ...pessoasExtras]) pessoas[p.id] = nomeCompleto(p)

  const ctx: ContextoDoHistorico = {
    processo: { id: proc.id, nome: proc.nome, pais: proc.paisCanonico?.countryLabel ?? null, requerentes, familiaId: proc.familiaId },
    usuarios: Object.fromEntries(usuarios.map((u) => [u.id, u.nome])),
    pessoas,
    tarefas: Object.fromEntries(tarefas.map((t) => [t.id, { titulo: t.titulo, documentoId: t.documentoId, necessidadeId: t.necessidadeId, pessoaId: t.pessoaId, faseMacroKey: t.faseMacroKey, statusTarefa: t.statusTarefa, responsavelId: t.responsavelId }])),
    documentos: Object.fromEntries(documentos.map((d) => [d.id, { rotulo: d.tipo ? TIPO_DOCUMENTO_LABELS[d.tipo] ?? String(d.tipo) : null, pessoaId: d.pessoaId, necessidadeId: d.necessidadeId, status: String(d.status) }])),
    necessidades: Object.fromEntries(necessidades.map((n) => {
      const pessoaId = n.pessoaId ?? titularDaUniao(n.uniao)
      const nome = pessoaId != null ? pessoas[pessoaId] : null
      return [n.id, { rotulo: `${n.itemCatalogo?.name ?? 'Documento'}${nome ? ` · ${nome}` : ''}`, pessoaId }]
    })),
    passos: Object.fromEntries(todosPassos.map((p) => [p.id, { stepKey: p.stepKey, titulo: rotuloDoPasso({ stepKey: p.stepKey, snapshot: p.snapshot, faseCode: phaseKeyToFaseCode(p.faseMacroKey) }), faseMacroKey: p.faseMacroKey, documentoId: p.documentoId, necessidadeId: p.necessidadeId, pessoaId: p.pessoaId }])),
    rotuloDaFase: (chave) => (chave ? rotuloCadastro.get(chave) ?? labelDaFasePorPhaseKey(chave) ?? null : null),
  }

  const iso = (d: Date) => d.toISOString()
  const linhas: LinhaCrua[] = [
    ...logs.map((l): LinhaCrua => ({ fonte: 'LOG', id: l.id, acao: l.acao, entidade: l.entidade, entidadeId: l.entidadeId, descricao: l.descricao, detalhes: asJ(l.detalhes), criadoEm: iso(l.criadoEm), usuarioId: l.usuarioId })),
    ...eventosWorkflow.map((w): LinhaCrua => ({ fonte: 'WORKFLOW', id: w.id, tipo: String(w.tipo), entityType: w.entityType, entityId: w.entityId, tarefaId: w.tarefaId, stepInstanceId: w.stepInstanceId, dados: asJ(w.dados), criadoEm: iso(w.criadoEm) })),
    ...avancos.map((a): LinhaCrua => ({ fonte: 'FASE', id: a.id, faseAtual: a.faseAtual, fasePretendida: a.fasePretendida, resultado: String(a.resultado), origem: a.origem, solicitadoPorId: a.solicitadoPorId, forcado: a.forcado, justificativa: a.justificativa, criadoEm: iso(a.criadoEm) })),
    ...eventosNec.map((n): LinhaCrua => ({ fonte: 'NECESSIDADE', id: n.id, necessidadeId: n.necessidadeId, tipo: String(n.tipo), descricao: n.descricao, dados: asJ(n.dados), criadoEm: iso(n.criadoEm) })),
    ...contatos.map((c): LinhaCrua => ({ fonte: 'CONTATO', id: c.id, tarefaId: c.tarefaId, documentoId: c.documentoId, orgaoNome: c.orgao ? c.orgao.nomeFantasia || c.orgao.name : null, canal: c.canal, resultado: c.resultado, observacao: c.observacao, registradoPorId: c.registradoPorId, criadoEm: iso(c.registradoEm) })),
    ...comentarios.map((c): LinhaCrua => ({ fonte: 'COMENTARIO', id: c.id, tarefaId: c.tarefaId, familiaId: c.familiaId, autorId: c.autorId, texto: c.texto, criadoEm: iso(c.criadoEm) })),
    ...subtarefas.filter((s) => s.completedAt != null).map((s): LinhaCrua => ({ fonte: 'SUBTAREFA', id: s.id, stepInstanceId: s.stepInstanceId, subtaskKey: s.subtaskKey, completedAt: iso(s.completedAt as Date), executadoPorId: s.executadoPorId, resultado: s.resultado })),
    ...execucoesDePasso.map((e): LinhaCrua => ({ fonte: 'PASSO', id: e.id, stepInstanceId: e.stepInstanceId, completedAt: iso(e.completedAt as Date), executadoPorId: e.executadoPorId })),
    ...solicitacoes.map((s): LinhaCrua => ({ fonte: 'SOLICITACAO', id: s.id, documentoId: s.documentoId, tarefaId: s.tarefaId, canal: String(s.canal), destinatarioNome: s.destinatarioNome, orgaoNome: s.orgao ? s.orgao.nomeFantasia || s.orgao.name : null, criadoPorId: s.criadoPorId, criadoEm: iso(s.createdAt) })),
    ...observacoes.map((o): LinhaCrua => ({ fonte: 'OBSERVACAO', id: o.id, documentoId: o.documentoId, texto: o.texto, criadoPorId: o.criadoPorId, criadoEm: iso(o.createdAt) })),
    ...historicoTarefa.map((h): LinhaCrua => ({ fonte: 'TAREFA_HIST', id: h.id, tarefaId: h.tarefaId, acao: h.acao, descricao: h.descricao, dados: asJ(h.dados), usuarioId: h.usuarioId, criadoEm: iso(h.createdAt) })),
  ]

  const r = montarFatos(linhas, ctx, { agrupar: opcoes.agrupar })
  return {
    processo: { id: proc.id, nome: proc.nome, codigo: proc.codigo, pais: ctx.processo.pais, familiaId: proc.familiaId, familiaNome: proc.familia?.nome ?? null, faseAtual: ctx.rotuloDaFase(proc.faseAtualKey) },
    geradoEm: agora.toISOString(), fatos: r.fatos, descartados: r.descartados, naoClassificados: r.naoClassificados, truncado,
  }
}
