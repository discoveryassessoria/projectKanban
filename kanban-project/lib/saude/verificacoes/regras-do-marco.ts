// lib/saude/verificacoes/regras-do-marco.ts
// ============================================================================
// VIGIAS DAS «REGRAS INEGOCIÁVEIS DO MARCO» (07/10/2026) — INT-003. SOMENTE LEITURA (só SELECT; nunca grava, nunca corrige).
//
// Cada regra combinada com o Marco vira UM detector aqui. O mesmo detector alimenta (1) a Saúde do Sistema (cron, INT-003), (2) o script
// `scripts/vigia-regras-do-marco.ts` que lista as violações da PRODUÇÃO hoje, e (3) o teste da suíte crítica
// (`scripts/regras-inegociaveis-do-marco.test.ts`), que também prova que o detector ACUSA a violação (controle positivo).
//
//   a  Emissão TRAVADA («Aguardando Genealogia») enquanto a Genealogia da MESMA certidão está aberta — dados.
//   c  A tarefa que muda de fase nasce SEM responsável — nunca herda quem concluiu a anterior.
//   e  Ordem fixa das certidões em TODA lista (geração; depois Nascimento, Casamento, Óbito) — planilha e tabela do processo.
//   f  As 4 subtarefas da Emissão são obrigatórias; anexo/comprovante/dado preenchido NUNCA é obrigatório — cadastro publicado.
//   g  A certidão só entra em Feito com os 4 passos concluídos.
//   i  Contadores batem: sem responsável + com cada pessoa = abertas (cabeçalho × tabela × Caminho).
//   l  Certidão recebida/validada SÓ com o passo da Emissão correspondente concluído (Localizar registro na Genealogia nunca recebe nem valida).
//   n  As abas da Torre dizem a MESMA coisa (responsável, fases, risco, contagens): cada dado vem de UMA função no servidor (`torre-coerencia-abas.ts`).
//   m  Local do óbito: a cidade/estado da certidão de óbito LOCALIZADA e a árvore (Pessoa.local_obito/estado_obito) dizem o mesmo lugar.
//   j  Fluxo do recebimento: nenhuma subtarefa da Emissão concluída fora de ordem, e nenhuma gravada «Disponível» enquanto depende de outra.
//
// (b) seletores sem pessoa, (d) atribuição só na página do processo e (h) contador repetido são regras de TELA/CÓDIGO: vigiadas pelo teste
// da suíte (varredura do código) e pelo script (varredura + tela). Aqui ficam as que se provam com DADO.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { STEP_KEY_LOCALIZAR_REGISTRO, STEP_KEY_SOLICITAR_CERTIDAO } from '@/src/lib/process-stage/situacao-solicitacao-certidao'
import { MOTIVO_AGUARDANDO_GENEALOGIA } from '@/src/services/genealogia/trava-emissao-por-genealogia'
import { mesmoLugar } from '@/src/lib/genealogia/sincronizacao-registral'
import { compararCertidoesDaFamilia } from '@/lib/operacional/ordem-certidoes'
import { SUBTAREFA_PEDIDO_ENVIADO, SUBTAREFA_CONFIRMACAO, SUBTAREFA_CERTIDAO_RECEBIDA, SUBTAREFA_CONFERENCIA } from '@/lib/operacional/emissao-recebimento'

export type RegraDoMarco = 'a' | 'c' | 'e' | 'f' | 'g' | 'i' | 'j' | 'l' | 'm' | 'n' | 'o' | 'p'

/** O detalhe do processo lido UMA vez por rodada (as regras e, i e o script leem o mesmo). */
type Detalhe = Awaited<ReturnType<typeof import('@/lib/operacional/torre-foco')['detalheDoProcesso']>>
const memoDetalhe = new Map<number, Promise<Detalhe>>()
export function limparMemoDeDetalhes() { memoDetalhe.clear() }
export async function detalheMemo(id: number): Promise<Detalhe> {
  let p = memoDetalhe.get(id)
  if (!p) { p = import('@/lib/operacional/torre-foco').then((m) => m.detalheDoProcesso(id)); memoDetalhe.set(id, p) }
  return p
}

export interface ViolacaoDoMarco {
  regra: RegraDoMarco
  processoId: number | null
  familia: string
  certidao: string | null
  pessoa: string | null
  detalhe: string
  entidade: string
  registroId: number
}

export const TITULO_DA_REGRA: Record<RegraDoMarco, string> = {
  a: 'Emissão liberada com a Genealogia da mesma certidão aberta',
  c: 'Tarefa que mudou de fase com responsável herdado',
  e: 'Lista fora da ordem fixa das certidões',
  f: 'Subtarefa da Emissão opcional, ou anexo/dado obrigatório',
  g: 'Certidão concluída sem os 4 passos concluídos',
  i: 'Contadores que não batem',
  j: 'Subtarefa da Emissão fora de ordem ou com selo «Disponível» sendo que depende de outra',
  m: 'Local do óbito da certidão diferente (ou ausente) na árvore',
  n: 'Abas da Torre dizendo coisas diferentes (responsável, fases, risco ou contagens)',
  p: 'Necessidade dispensada sem registro de quem dispensou (a partir de 08/10/2026)',
  o: 'Documentos por pessoa: casamento fora do dono, dispensada com exigência, ou painel × aba Documentos × árvore × Torre divergentes',
  l: 'Certidão recebida/validada sem o passo de recebimento/validação da Emissão concluído',
}

const TAREFA_ENCERRADA = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA']
const LOCALIZAR_RESOLVIDO = ['CONCLUIDO', 'DISPENSADO', 'CANCELADO', 'SUPERSEDIDO']
const SUB_ABERTA = ['PENDENTE', 'DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO_EXTERNO', 'BLOQUEADO']
const nomeDe = (p: { nome: string; sobrenome: string | null } | null | undefined) => (p ? [p.nome, p.sobrenome].filter(Boolean).join(' ').trim() : null)

/** Contexto comum: o nome do processo/família por id, só dos processos ATIVOS. */
async function processosAtivos() {
  const rows = await prisma.processo.findMany({
    where: { dataConclusao: null, faseAtualKey: { not: 'finalizado' } },
    select: { id: true, nome: true, arvore: { select: { nome: true } } },
  })
  const familia = new Map(rows.map((p) => [p.id, p.arvore?.nome ?? p.nome]))
  return { ids: rows.map((p) => p.id), familia, nome: (id: number | null) => (id == null ? '—' : familia.get(id) ?? `processo #${id}`) }
}

// ── a ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detectarRegraA(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const loc = await prisma.phaseWorkflowStepInstance.findMany({
    where: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { notIn: LOCALIZAR_RESOLVIDO as never }, necessidadeId: { not: null }, processoId: { in: ctx.ids } },
    select: { id: true, necessidadeId: true, processoId: true },
  })
  if (loc.length === 0) return []
  const necs = [...new Set(loc.map((l) => l.necessidadeId as number))]
  const nec = await prisma.necessidadeDocumental.findMany({
    where: { id: { in: necs } },
    select: { id: true, itemCatalogo: { select: { name: true } }, pessoa: { select: { nome: true, sobrenome: true } }, uniao: { select: { pessoa1: { select: { nome: true, sobrenome: true } }, pessoa2: { select: { nome: true, sobrenome: true } } } } },
  })
  const rotulo = new Map(nec.map((n) => [n.id, { certidao: n.itemCatalogo?.name ?? 'Documento', pessoa: nomeDe(n.pessoa) ?? [nomeDe(n.uniao?.pessoa1), nomeDe(n.uniao?.pessoa2)].filter(Boolean).join(' e ') }]))
  const emissao = await prisma.phaseWorkflowStepInstance.findMany({
    where: { stepKey: STEP_KEY_SOLICITAR_CERTIDAO, status: { notIn: ['SUPERSEDIDO', 'CANCELADO', 'DISPENSADO', 'CONCLUIDO'] as never }, OR: [{ necessidadeId: { in: necs } }, { documento: { necessidadeId: { in: necs } } }] },
    select: { id: true, status: true, motivo: true, necessidadeId: true, processoId: true, documento: { select: { necessidadeId: true } } },
  })
  const out: ViolacaoDoMarco[] = []
  for (const e of emissao) {
    const n = e.necessidadeId ?? e.documento?.necessidadeId
    if (n == null || !necs.includes(n)) continue
    const r = rotulo.get(n)
    // Liberada de verdade (não iniciada e NÃO travada): PENDENTE/DISPONIVEL. EM_ANDAMENTO é trabalho já em curso (a regra não o interrompe).
    if (e.status === 'DISPONIVEL' || e.status === 'PENDENTE') {
      out.push({ regra: 'a', processoId: e.processoId, familia: ctx.nome(e.processoId), certidao: r?.certidao ?? null, pessoa: r?.pessoa ?? null, detalhe: `Localizar registro aberto, mas o passo da Emissão está ${e.status} (deveria estar BLOQUEADO «${MOTIVO_AGUARDANDO_GENEALOGIA}»)`, entidade: 'PhaseWorkflowStepInstance', registroId: e.id })
    } else if (e.status === 'BLOQUEADO' && e.motivo !== MOTIVO_AGUARDANDO_GENEALOGIA) {
      // Bloqueio por outro motivo não é violação desta regra.
    }
  }
  return out
}

// ── c ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Tarefa aberta que mudou de fase (TAREFA_REANCORADA para a fase atual) e AINDA tem responsável sem nenhuma atribuição/devolução depois da mudança. */
export async function detectarRegraC(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const abertas = await prisma.tarefa.findMany({
    where: { processoId: { in: ctx.ids }, responsavelId: { not: null }, statusTarefa: { notIn: TAREFA_ENCERRADA as never } },
    select: { id: true, titulo: true, processoId: true, faseMacroKey: true, responsavel: { select: { nome: true } } },
  })
  if (abertas.length === 0) return []
  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: { in: ['Tarefa', 'TAREFA'] }, entidadeId: { in: abertas.map((t) => t.id) }, acao: { in: ['TAREFA_REANCORADA', 'TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA', 'TAREFA_DEVOLVIDA_A_FILA'] } },
    orderBy: { id: 'asc' }, select: { entidadeId: true, acao: true, descricao: true, id: true },
  })
  const porTarefa = new Map<number, typeof logs>()
  for (const l of logs) { if (l.entidadeId == null) continue; porTarefa.set(l.entidadeId, [...(porTarefa.get(l.entidadeId) ?? []), l]) }
  const out: ViolacaoDoMarco[] = []
  for (const t of abertas) {
    const ls = porTarefa.get(t.id) ?? []
    let iMuda = -1
    ls.forEach((l, i) => { if (l.acao === 'TAREFA_REANCORADA' && t.faseMacroKey != null && l.descricao.includes(`para a fase ${t.faseMacroKey}`)) iMuda = i })
    if (iMuda < 0) continue
    if (ls.slice(iMuda + 1).some((l) => ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA', 'TAREFA_DEVOLVIDA_A_FILA'].includes(l.acao))) continue
    out.push({ regra: 'c', processoId: t.processoId, familia: ctx.nome(t.processoId), certidao: t.titulo.split(' · ')[0], pessoa: t.titulo.split(' · ')[1] ?? null, detalhe: `mudou para ${t.faseMacroKey} e continua com ${t.responsavel?.nome ?? 'responsável herdado'} (nenhuma atribuição depois da mudança de fase)`, entidade: 'Tarefa', registroId: t.id })
  }
  return out
}

// ── e ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const RANK_REGISTRO = (nome: string | null): number => {
  const t = (nome ?? '').toLowerCase()
  if (/nasc/.test(t)) return 0
  if (/casam/.test(t)) return 1
  if (/[óo]bito/.test(t)) return 2
  return 3
}
/** A sequência de uma pessoa tem de ser Nascimento → Casamento → Óbito; e as pessoas, por geração crescente dentro da linha principal. PURA. */
export function ordemDeRegistrosOk(tipos: Array<string | null>): boolean {
  const r = tipos.map(RANK_REGISTRO)
  return r.every((v, i) => i === 0 || r[i - 1] <= v)
}
export function ordemDeGeracoesOk(geracoes: Array<number | null>): boolean {
  const g = geracoes.filter((x): x is number => x != null)
  return g.every((v, i) => i === 0 || g[i - 1] <= v)
}
export async function detectarRegraE(opts: { profundo?: boolean } = {}): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const { montarEstruturaDocumental } = await import('@/lib/financeiro/leitura/planilha-documental')
  const out: ViolacaoDoMarco[] = []
  for (const id of ctx.ids) {
    const blocos = await montarEstruturaDocumental(id)
    const principais = blocos.filter((b) => b.linhagemPrincipal)
    if (!ordemDeGeracoesOk(principais.map((b) => b.geracao))) out.push({ regra: 'e', processoId: id, familia: ctx.nome(id), certidao: null, pessoa: null, detalhe: `planilha documental: pessoas da linha principal fora da ordem de geração (${principais.map((b) => b.geracao).join(', ')})`, entidade: 'Processo', registroId: id })
    for (const b of blocos) {
      if (!ordemDeRegistrosOk(b.linhas.map((l) => l.tipoRegistro))) out.push({ regra: 'e', processoId: id, familia: ctx.nome(id), certidao: null, pessoa: b.nome, detalhe: `planilha documental: registros fora de Nascimento → Casamento → Óbito (${b.linhas.map((l) => l.tipoRegistro).join(' › ')})`, entidade: 'Pessoa', registroId: b.pessoaId ?? 0 })
    }
    if (opts.profundo) {
      // A tabela do processo é ordenada NA TELA por `filtrarEOrdenar` (a função canônica); aqui se prova que ela de fato produz a ordem fixa.
      const d = await detalheMemo(id)
      if (d) {
        const { filtrarEOrdenar, chaveDaLinhaDaTabela } = await import('@/lib/operacional/torre-processo-puro')
        const naTela = filtrarEOrdenar(d.tabela, { pessoaId: null, status: 'TODOS' })
        const porFase = new Map<number, typeof naTela>()
        for (const l of naTela) porFase.set(l.fase?.ordem ?? 9999, [...(porFase.get(l.fase?.ordem ?? 9999) ?? []), l])
        for (const [, grupo] of porFase) {
          for (let i = 1; i < grupo.length; i++) {
            if (compararCertidoesDaFamilia(chaveDaLinhaDaTabela(grupo[i - 1]), chaveDaLinhaDaTabela(grupo[i])) > 0) { out.push({ regra: 'e', processoId: id, familia: ctx.nome(id), certidao: grupo[i].titulo, pessoa: grupo[i].pessoa, detalhe: `tabela do processo fora da ordem fixa (${grupo[i - 1].titulo} · ${grupo[i - 1].pessoa} antes de ${grupo[i].titulo} · ${grupo[i].pessoa})`, entidade: 'Tarefa', registroId: grupo[i].tarefaId ?? 0 }); break }
          }
        }
      }
    }
  }
  return out
}
void compararCertidoesDaFamilia

// ── f ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detectarRegraF(): Promise<ViolacaoDoMarco[]> {
  const out: ViolacaoDoMarco[] = []
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { phaseKey: 'emissao_documental', active: true, arquivado: false }, select: { id: true, name: true, versao: true } })
  for (const wf of wfs) {
    const versoes = await prisma.phaseInternalWorkflowVersao.findMany({ where: { workflowId: wf.id }, orderBy: { versao: 'desc' }, take: 1, select: { versao: true, passos: true } })
    for (const v of versoes) {
      for (const p of (v.passos as Array<Record<string, any>>) ?? []) {
        for (const s of (p.subtarefas as Array<Record<string, any>>) ?? []) {
          if (s.ativo === false) continue
          if (s.obrigatoria === false) out.push({ regra: 'f', processoId: null, familia: '—', certidao: String(s.label ?? s.key), pessoa: null, detalhe: `subtarefa «${s.label ?? s.key}» OPCIONAL na versão ${v.versao} publicada de «${wf.name}» (as 4 são obrigatórias)`, entidade: 'PhaseInternalWorkflow', registroId: wf.id })
          if (s.exigeProtocolo === true) out.push({ regra: 'f', processoId: null, familia: '—', certidao: String(s.label ?? s.key), pessoa: null, detalhe: `subtarefa «${s.label ?? s.key}» EXIGE protocolo/comprovante (versão ${v.versao})`, entidade: 'PhaseInternalWorkflow', registroId: wf.id })
          for (const c of (s.campos as Array<Record<string, any>>) ?? []) if (c.obrigatorio === true) out.push({ regra: 'f', processoId: null, familia: '—', certidao: String(s.label ?? s.key), pessoa: null, detalhe: `campo «${c.label ?? c.key}» OBRIGATÓRIO na subtarefa «${s.label ?? s.key}» (dado preenchido nunca é obrigatório)`, entidade: 'PhaseInternalWorkflow', registroId: wf.id })
          for (const r of (s.requisitos as Array<Record<string, any>>) ?? []) if (r.obrigatorio === true && ['EVIDENCIA_ANEXADA', 'CAMPO_PREENCHIDO'].includes(String(r.tipo))) out.push({ regra: 'f', processoId: null, familia: '—', certidao: String(s.label ?? s.key), pessoa: null, detalhe: `requisito «${r.label ?? r.key}» (${r.tipo}) OBRIGATÓRIO na subtarefa «${s.label ?? s.key}» (anexo/dado nunca é obrigatório)`, entidade: 'PhaseInternalWorkflow', registroId: wf.id })
        }
        const subs = ((p.subtarefas as Array<{ key: string }>) ?? []).map((s) => s.key)
        for (const k of [SUBTAREFA_PEDIDO_ENVIADO, SUBTAREFA_CONFIRMACAO, SUBTAREFA_CERTIDAO_RECEBIDA, SUBTAREFA_CONFERENCIA]) if (p.key === 'solicitar_certidao' && !subs.includes(k)) out.push({ regra: 'f', processoId: null, familia: '—', certidao: k, pessoa: null, detalhe: `a versão ${v.versao} não tem a subtarefa «${k}» (são 4 obrigatórias)`, entidade: 'PhaseInternalWorkflow', registroId: wf.id })
      }
      // Instâncias EM ANDAMENTO apontando para uma versão antiga com subtarefa opcional.
      const antigas = await prisma.phaseWorkflowInstance.findMany({ where: { workflowDefinitionId: wf.id, status: { in: ['ATIVO', 'BLOQUEADO', 'AGUARDANDO'] }, workflowVersion: { not: v.versao } }, select: { id: true, workflowVersion: true, processoId: true } })
      if (antigas.length > 0) {
        const verAntigas = await prisma.phaseInternalWorkflowVersao.findMany({ where: { workflowId: wf.id, versao: { in: [...new Set(antigas.map((a) => a.workflowVersion as number))] } }, select: { versao: true, passos: true } })
        const opcionais = new Set(verAntigas.filter((x) => ((x.passos as Array<Record<string, any>>) ?? []).some((p) => ((p.subtarefas as Array<Record<string, any>>) ?? []).some((s) => s.ativo !== false && s.obrigatoria === false))).map((x) => x.versao))
        for (const a of antigas.filter((x) => opcionais.has(x.workflowVersion as number))) out.push({ regra: 'f', processoId: a.processoId, familia: '—', certidao: null, pessoa: null, detalhe: `instância ${a.id} presa à versão ${a.workflowVersion}, que tem subtarefa opcional`, entidade: 'PhaseWorkflowInstance', registroId: a.id })
      }
    }
  }
  return out
}

// ── g ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detectarRegraG(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const out: ViolacaoDoMarco[] = []
  // (1) passo da Emissão concluído com subtarefa aberta.
  const fechadosCedo = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId: { in: ctx.ids }, faseMacroKey: 'emissao_documental', status: 'CONCLUIDO', execucoesDeSubtarefa: { some: { supersededAt: null, status: { in: SUB_ABERTA as never } } } },
    select: { id: true, processoId: true, documentoId: true, execucoesDeSubtarefa: { where: { supersededAt: null, status: { in: SUB_ABERTA as never } }, select: { subtaskKey: true } } },
  })
  const docs = await prisma.documento.findMany({ where: { id: { in: fechadosCedo.map((s) => s.documentoId).filter((x): x is number => x != null) } }, select: { id: true, tipo: true, pessoa: { select: { nome: true, sobrenome: true } } } })
  const docPor = new Map(docs.map((d) => [d.id, d]))
  for (const s of fechadosCedo) {
    const d = s.documentoId != null ? docPor.get(s.documentoId) : undefined
    out.push({ regra: 'g', processoId: s.processoId, familia: ctx.nome(s.processoId), certidao: d ? String(d.tipo) : null, pessoa: nomeDe(d?.pessoa), detalhe: `passo concluído com subtarefa aberta: ${s.execucoesDeSubtarefa.map((e) => e.subtaskKey).join(', ')}`, entidade: 'PhaseWorkflowStepInstance', registroId: s.id })
  }
  // (2) tarefa de Emissão CONCLUÍDA cujo documento ainda tem passo da Emissão não concluído (aparece em Feito sem os 4 passos).
  const concluidas = await prisma.tarefa.findMany({ where: { processoId: { in: ctx.ids }, faseMacroKey: 'emissao_documental', statusTarefa: 'CONCLUIDO_RECEBIDO', documentoId: { not: null } }, select: { id: true, titulo: true, processoId: true, documentoId: true } })
  if (concluidas.length > 0) {
    const passos = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: { in: concluidas.map((t) => t.documentoId as number) }, faseMacroKey: 'emissao_documental', status: { notIn: ['CONCLUIDO', 'SUPERSEDIDO', 'CANCELADO', 'DISPENSADO'] as never } }, select: { id: true, documentoId: true, status: true } })
    const abertoPorDoc = new Map(passos.map((p) => [p.documentoId as number, p]))
    for (const t of concluidas) {
      const p = abertoPorDoc.get(t.documentoId as number)
      if (p) out.push({ regra: 'g', processoId: t.processoId, familia: ctx.nome(t.processoId), certidao: t.titulo.split(' · ')[0], pessoa: t.titulo.split(' · ')[1] ?? null, detalhe: `tarefa concluída (aparece em Feito) mas o passo ${p.id} da Emissão está ${p.status}`, entidade: 'Tarefa', registroId: t.id })
    }
  }
  return out
}

// ── i ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Os contadores do processo, conferidos entre si. PURA: recebe os números já lidos. */
export function conferirContadores(a: {
  numerosAbertas: number; numerosSemResponsavel: number
  linhasAbertas: Array<{ responsavelId: number | null; faseKey: string | null }>
  fases: Array<{ key: string; abertas: number; semResponsavel: number; porPessoa: number }>
}): string[] {
  const erros: string[] = []
  const semResp = a.linhasAbertas.filter((l) => l.responsavelId == null).length
  const comResp = a.linhasAbertas.length - semResp
  if (a.numerosSemResponsavel !== semResp) erros.push(`cabeçalho diz ${a.numerosSemResponsavel} sem responsável; a tabela tem ${semResp}`)
  if (a.numerosAbertas !== a.linhasAbertas.length) erros.push(`cabeçalho diz ${a.numerosAbertas} abertas; a tabela tem ${a.linhasAbertas.length}`)
  if (semResp + comResp !== a.linhasAbertas.length) erros.push('sem responsável + com responsável ≠ abertas')
  for (const f of a.fases) if (f.semResponsavel + f.porPessoa !== f.abertas) erros.push(`fase ${f.key}: ${f.semResponsavel} sem responsável + ${f.porPessoa} com pessoa ≠ ${f.abertas} abertas`)
  const somaFases = a.fases.reduce((s, f) => s + f.abertas, 0)
  const comFase = a.linhasAbertas.filter((l) => l.faseKey != null && a.fases.some((f) => f.key === l.faseKey)).length
  if (somaFases !== comFase) erros.push(`a soma das fases do Caminho (${somaFases}) ≠ abertas da tabela nessas fases (${comFase})`)
  return erros
}
export async function detectarRegraI(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const { contaDaFase } = await import('@/lib/operacional/torre-processo-puro')
  const out: ViolacaoDoMarco[] = []
  for (const id of ctx.ids) {
    const d = await detalheMemo(id)
    if (!d) continue
    const linhas = d.tabela.filter((l) => l.tipo === 'ABERTA')
    const fases = d.caminho.fases.map((f) => { const c = contaDaFase(d.tabela, f.phaseKey); return { key: f.phaseKey, abertas: c.abertas, semResponsavel: c.semResponsavel, porPessoa: c.porPessoa.reduce((s, p) => s + p.n, 0) } })
    const erros = conferirContadores({ numerosAbertas: d.numeros.abertas, numerosSemResponsavel: d.numeros.semResponsavel, linhasAbertas: linhas.map((l) => ({ responsavelId: l.responsavelId, faseKey: l.fase?.key ?? null })), fases })
    for (const e of erros) out.push({ regra: 'i', processoId: id, familia: ctx.nome(id), certidao: null, pessoa: null, detalhe: e, entidade: 'Processo', registroId: id })
  }
  return out
}

// ── j ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEPENDENCIA_DA_EMISSAO: Record<string, string | null> = {
  [SUBTAREFA_PEDIDO_ENVIADO]: null, [SUBTAREFA_CONFIRMACAO]: SUBTAREFA_PEDIDO_ENVIADO,
  [SUBTAREFA_CERTIDAO_RECEBIDA]: SUBTAREFA_CONFIRMACAO, [SUBTAREFA_CONFERENCIA]: SUBTAREFA_CERTIDAO_RECEBIDA,
}
/** PURA: o que está errado numa sequência de estados de subtarefa da Emissão (chave → estado). */
export function problemasDeOrdemDaEmissao(estados: Readonly<Record<string, string>>): string[] {
  const out: string[] = []
  for (const [k, dep] of Object.entries(DEPENDENCIA_DA_EMISSAO)) {
    const e = estados[k]
    if (!dep || e == null) continue
    const depOk = estados[dep] === 'CONCLUIDO'
    if (e === 'CONCLUIDO' && !depOk) out.push(`«${k}» concluída sem «${dep}» concluída (passo pulado)`)
    else if ((e === 'DISPONIVEL' || e === 'PENDENTE') && !depOk) out.push(`«${k}» gravada «${e}» mas depende de «${dep}», que não foi concluída (o selo mentiria)`)
  }
  return out
}
export async function detectarRegraJ(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const exec = await prisma.subtaskExecution.findMany({
    where: { supersededAt: null, stepInstance: { processoId: { in: ctx.ids }, faseMacroKey: 'emissao_documental', status: { notIn: ['SUPERSEDIDO', 'CANCELADO', 'DISPENSADO'] as never } } },
    select: { stepInstanceId: true, subtaskKey: true, status: true, stepInstance: { select: { processoId: true, documentoId: true } } },
  })
  const por = new Map<number, typeof exec>()
  for (const e of exec) por.set(e.stepInstanceId, [...(por.get(e.stepInstanceId) ?? []), e])
  const docIds = [...new Set(exec.map((e) => e.stepInstance.documentoId).filter((x): x is number => x != null))]
  const docs = docIds.length ? await prisma.documento.findMany({ where: { id: { in: docIds } }, select: { id: true, tipo: true, pessoa: { select: { nome: true, sobrenome: true } } } }) : []
  const docPor = new Map(docs.map((d) => [d.id, d]))
  const out: ViolacaoDoMarco[] = []
  for (const [stepId, es] of por) {
    const probs = problemasDeOrdemDaEmissao(Object.fromEntries(es.map((e) => [e.subtaskKey, e.status])))
    const d = es[0].stepInstance.documentoId != null ? docPor.get(es[0].stepInstance.documentoId) : undefined
    for (const p of probs) out.push({ regra: 'j', processoId: es[0].stepInstance.processoId, familia: ctx.nome(es[0].stepInstance.processoId), certidao: d ? String(d.tipo) : null, pessoa: nomeDe(d?.pessoa), detalhe: p, entidade: 'PhaseWorkflowStepInstance', registroId: stepId })
  }
  return out
}

// ── l ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Certidão que APARECE como recebida/validada sem o passo da Emissão que a faz assim. PURA: recebe o que foi lido.
 *  • recebida sem «Receber certidão» concluída  → só pode vir de recebimento direto (upload/lote) ou de tarefa de Emissão concluída por fora do passo;
 *  • validada sem «Conferir e validar» concluída → tarefa de Emissão CONCLUÍDA sem o passo 4;
 *  • a leitura oficial (`estadoOperacionalDosDocumentos`) diz recebida/validada, mas só há Tarefa da GENEALOGIA — a regressão que este vigia existe para pegar.
 */
export function problemasDeRecebimento(a: { statusDocumento: string | null; recebimentoConcluido: boolean; validacaoConcluida: boolean; tarefaDeEmissaoConcluida: boolean; tarefaDaGenealogiaConcluida: boolean; leituraDizRecebida: boolean }): string[] {
  const out: string[] = []
  const recebimentoDireto = a.statusDocumento === 'RECEBIDO' || a.statusDocumento === 'ENTREGUE'
  if ((recebimentoDireto || a.tarefaDeEmissaoConcluida) && !a.recebimentoConcluido) out.push(`aparece como RECEBIDA (${recebimentoDireto ? `Documento.status ${a.statusDocumento}` : 'tarefa de Emissão concluída'}) mas «Receber certidão» não foi concluída na Emissão`)
  if (a.tarefaDeEmissaoConcluida && !a.validacaoConcluida) out.push('aparece como VALIDADA (tarefa de Emissão concluída) mas «Conferir e validar certidão» não foi concluída')
  if (a.leituraDizRecebida && a.tarefaDaGenealogiaConcluida && !a.recebimentoConcluido && !a.tarefaDeEmissaoConcluida && !recebimentoDireto) out.push('a leitura diz RECEBIDA só porque a Genealogia (Localizar registro) concluiu — a Genealogia nunca recebe nem valida')
  return out
}
export async function detectarRegraL(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  const docs = await prisma.documento.findMany({
    where: { pessoa: { arvore: { processos: { some: { id: { in: ctx.ids } } } } }, status: { notIn: ['CANCELADO', 'NAO_EXIGIDO'] as never } },
    select: { id: true, tipo: true, status: true, pessoa: { select: { nome: true, sobrenome: true, arvore: { select: { processos: { select: { id: true }, take: 1 } } } } } },
  })
  if (docs.length === 0) return []
  const ids = docs.map((d) => d.id)
  const [tarefas, execs, { estadoOperacionalDosDocumentos, FASE_GENEALOGIA, SUBTAREFAS_DE_RECEBIMENTO, SUBTAREFAS_DE_VALIDACAO }] = await Promise.all([
    prisma.tarefa.findMany({ where: { documentoId: { in: ids }, statusTarefa: 'CONCLUIDO_RECEBIDO' }, select: { documentoId: true, faseMacroKey: true } }),
    prisma.subtaskExecution.findMany({ where: { supersededAt: null, status: 'CONCLUIDO', subtaskKey: { in: ['receber_certidao', 'receber_certidao_retificada', 'conferir_validar_certidao', 'conferir_validar_certidao_retificada'] }, stepInstance: { documentoId: { in: ids } } }, select: { subtaskKey: true, stepInstance: { select: { documentoId: true } } } }),
    import('@/lib/operacional/documento-estado'),
  ])
  const estados = await estadoOperacionalDosDocumentos(ids)
  const emissao = new Set<number>(), genealogia = new Set<number>(), recebeu = new Set<number>(), validou = new Set<number>()
  for (const t of tarefas) if (t.documentoId != null) (t.faseMacroKey === FASE_GENEALOGIA ? genealogia : emissao).add(t.documentoId)
  for (const e of execs) { const id = e.stepInstance.documentoId; if (id == null) continue; ((SUBTAREFAS_DE_RECEBIMENTO as readonly string[]).includes(e.subtaskKey) ? recebeu : validou).add(id) }
  const out: ViolacaoDoMarco[] = []
  for (const d of docs) {
    const probs = problemasDeRecebimento({ statusDocumento: d.status as string, recebimentoConcluido: recebeu.has(d.id), validacaoConcluida: validou.has(d.id), tarefaDeEmissaoConcluida: emissao.has(d.id), tarefaDaGenealogiaConcluida: genealogia.has(d.id), leituraDizRecebida: estados.get(d.id)?.jaRecebido === true })
    const processoId = d.pessoa.arvore?.processos[0]?.id ?? null
    for (const p of probs) out.push({ regra: 'l', processoId, familia: ctx.nome(processoId), certidao: d.tipo ? String(d.tipo) : null, pessoa: nomeDe(d.pessoa), detalhe: p, entidade: 'Documento', registroId: d.id })
  }
  return out
}

// ── m ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Cidade/estado da certidão de óbito × o que a árvore guarda do óbito. PURA. `null` = tudo certo. */
export function problemaDoLocalDoObito(a: { cidadeCertidao: string | null; estadoCertidao: string | null; cidadeArvore: string | null; estadoArvore: string | null }): string | null {
  const cert = (a.cidadeCertidao ?? '').trim(), arv = (a.cidadeArvore ?? '').trim()
  if (cert && !arv) return `a certidão diz «${cert}» mas a árvore não tem a cidade do óbito`
  if (cert && arv && !mesmoLugar({ origem: 'cidade_registro' }, arv, cert)) return `cidade do óbito: certidão «${cert}» × árvore «${arv}»`
  const ec = (a.estadoCertidao ?? '').trim(), ea = (a.estadoArvore ?? '').trim()
  if (ec && ea && !mesmoLugar({ origem: 'estado_registro' }, ea, ec)) return `estado do óbito: certidão «${ec}» × árvore «${ea}»`
  return null
}
export async function detectarRegraM(): Promise<ViolacaoDoMarco[]> {
  const ctx = await processosAtivos()
  try {
    const docs = await prisma.documento.findMany({
      where: {
        OR: [{ tipo: { in: ['CERTIDAO_OBITO', 'CERTIDAO_OBITO_INTEIRO_TEOR'] as never[] } }, { documentType: { legacyEnumKey: { in: ['CERTIDAO_OBITO', 'CERTIDAO_OBITO_INTEIRO_TEOR'] } } }],
        status: { notIn: ['CANCELADO', 'NAO_EXIGIDO'] as never }, cidade_registro: { not: null },
        stepInstances: { some: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: 'CONCLUIDO' } },
        pessoa: { arvore: { processos: { some: { id: { in: ctx.ids } } } } },
      },
      select: { id: true, tipo: true, cidade_registro: true, estado_registro: true, pessoa: { select: { nome: true, sobrenome: true, local_obito: true, estado_obito: true, arvore: { select: { processos: { select: { id: true }, take: 1 } } } } } },
    })
    const out: ViolacaoDoMarco[] = []
    for (const d of docs) {
      const p = problemaDoLocalDoObito({ cidadeCertidao: d.cidade_registro, estadoCertidao: d.estado_registro, cidadeArvore: d.pessoa.local_obito, estadoArvore: d.pessoa.estado_obito })
      if (p) { const processoId = d.pessoa.arvore?.processos[0]?.id ?? null; out.push({ regra: 'm', processoId, familia: ctx.nome(processoId), certidao: d.tipo ? String(d.tipo) : null, pessoa: nomeDe(d.pessoa), detalhe: p, entidade: 'Documento', registroId: d.id }) }
    }
    return out
  } catch (e) {
    console.error('[regra m] coluna do local do óbito ainda não existe neste banco:', e instanceof Error ? e.message : e)
    return []
  }
}

// ── n ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detectarRegraN(): Promise<ViolacaoDoMarco[]> {
  const { compararAbasDaTorre } = await import('@/lib/operacional/torre-coerencia-abas')
  const divs = await compararAbasDaTorre()
  return divs.map((d, i) => ({ regra: 'n' as const, processoId: null, familia: '—', certidao: null, pessoa: d.chave, detalhe: `[${d.assunto}] ${d.abas}: ${d.detalhe}`, entidade: 'Torre', registroId: i + 1 }))
}

// ── o ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detectarRegraO(): Promise<ViolacaoDoMarco[]> {
  const { divergenciasDeDocumentosPorPessoa } = await import('@/lib/operacional/coerencia-documentos-pessoa')
  const divs = await divergenciasDeDocumentosPorPessoa()
  return divs.map((d, i) => ({ regra: 'o' as const, processoId: d.processoId, familia: d.familia, certidao: d.certidao, pessoa: d.pessoa, detalhe: d.detalhe, entidade: 'Documento', registroId: d.documentoId ?? i + 1 }))
}

// ── p ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A regra vale daqui para a frente: o histórico antigo NÃO é reescrito (a dispensa manual de 06/10 18:20 do Bernardo ficou sem autor e assim permanece). */
export const DISPENSA_COM_AUTOR_DESDE = new Date('2026-10-08T12:45:00Z')
export async function detectarRegraP(desde: Date = DISPENSA_COM_AUTOR_DESDE): Promise<ViolacaoDoMarco[]> {
  const dispensadas = await prisma.necessidadeDocumental.findMany({
    where: { status: 'DISPENSADA', updatedAt: { gte: desde } },
    select: { id: true, processoId: true, itemCatalogo: { select: { name: true } }, pessoa: { select: { nome: true, sobrenome: true } }, processo: { select: { nome: true } } },
  })
  if (dispensadas.length === 0) return []
  const comLog = new Set((await prisma.logAuditoria.findMany({ where: { acao: 'NECESSIDADE_DISPENSADA', entidade: 'NecessidadeDocumental', entidadeId: { in: dispensadas.map((d) => d.id) }, criadoEm: { gte: desde } }, select: { entidadeId: true } })).map((l) => l.entidadeId))
  return dispensadas.filter((d) => !comLog.has(d.id)).map((d) => ({ regra: 'p' as const, processoId: d.processoId, familia: d.processo?.nome ?? '—', certidao: d.itemCatalogo?.name ?? null, pessoa: nomeDe(d.pessoa), detalhe: 'necessidade dispensada sem linha de histórico com autor (usuário ou sistema + motivo)', entidade: 'NecessidadeDocumental', registroId: d.id }))
}

export async function detectarRegrasDoMarco(opts: { profundo?: boolean } = {}): Promise<{ violacoes: ViolacaoDoMarco[]; porRegra: Record<RegraDoMarco, number> }> {
  limparMemoDeDetalhes()
  const todas = [
    ...(await detectarRegraA()), ...(await detectarRegraC()), ...(await detectarRegraE(opts)),
    ...(await detectarRegraF()), ...(await detectarRegraG()), ...(opts.profundo ? await detectarRegraI() : []), ...(await detectarRegraJ()), ...(await detectarRegraL()), ...(await detectarRegraM()), ...(await detectarRegraN()), ...(await detectarRegraO()), ...(await detectarRegraP()),
  ]
  const porRegra = { a: 0, c: 0, e: 0, f: 0, g: 0, i: 0, j: 0, l: 0, m: 0, n: 0, o: 0, p: 0 } as Record<RegraDoMarco, number>
  for (const v of todas) porRegra[v.regra]++
  return { violacoes: todas, porRegra }
}
