// src/services/torre-processo-distribuir.ts
// ============================================================================
// "DISTRIBUIR AS N" DO DETALHE DO PROCESSO (Torre nova, frente H, 01/10/2026).
//
// Distribui as tarefas ABERTAS e SEM RESPONSÁVEL deste processo por aptidão e carga. NENHUMA regra nova:
//   • quem recebe cada tarefa = a recomendação do motor de elegibilidade (`simularLote`: permissão, disponibilidade, aptidão por
//     unidade e por país, equipe, capacidade, menor custo operacional, com a carga VIRTUAL somando a cada tarefa);
//   • a atribuição = `atribuirEmLote` (a porta canônica de `redistribuirTarefas`/`atribuirTarefa`: auditoria por tarefa, sino
//     consolidado "N tarefas atribuídas a você", sem criar tarefa nova).
// REGRA DA TORRE NOVA: NUNCA atribui a quem não tem APTIDÃO COMPROVADA. O motor já exclui quem não é apto onde a regra de aptidão
// existe; onde NÃO existe regra (nenhuma aptidão cadastrada para o país/unidade — critério "não aplicável") a recomendação não
// prova aptidão nenhuma, então a tarefa fica SEM atribuir e o resultado diz "sem aptidão cadastrada". Nada é chutado.
// DESFAZER: o resultado traz `desfazer` (tipo ATRIBUICAO) — a porta existente `/api/torre/tarefas/desfazer` reverte.
// ============================================================================
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { simularLote, type Recomendacao } from '@/lib/operacional/elegibilidade'
import { atribuirEmLote } from '@/src/services/torre-acoes-lote'

export interface ResultadoDaDistribuicao {
  ok: boolean
  /** Quantas tarefas abertas sem responsável o processo tinha. */
  total: number
  atribuidas: number
  /** Ficaram sem responsável, e por quê (uma frase por motivo). */
  semAtribuir: Array<{ n: number; motivo: string }>
  porPessoa: Array<{ usuarioId: number; nome: string; n: number; apto: string | null }>
  tarefaIds: number[]
  mensagem: string
  desfazer: { tipo: 'ATRIBUICAO'; tarefaIds: number[] } | null
}

/** O texto da aptidão comprovada da recomendação ("apto em Espanha"), ou `null` se o motor não prova aptidão (critério não aplicável/reprovado). */
export function aptidaoComprovada(r: Recomendacao): string | null {
  const rec = r.recomendado
  if (!rec) return null
  const crit = r.avaliacoes.find((a) => a.usuarioId === rec.usuarioId)?.criterios.find((c) => c.chave === 'APTIDAO')
  return crit && crit.veredito === 'ok' ? crit.detalhe : null
}

/** A frase do toast: "12 certidões atribuídas a Daniela Brait (apto em Espanha)" · "8 a Daniela Brait, 4 a Priscila" · "nenhuma atribuída…". PURA. */
export function mensagemDaDistribuicao(r: Pick<ResultadoDaDistribuicao, 'total' | 'atribuidas' | 'porPessoa' | 'semAtribuir'>, objeto = 'tarefas'): string {
  const un = objeto === 'certidões' ? 'certidão' : 'tarefa'
  if (r.total === 0) return 'Nenhuma tarefa aberta sem responsável neste processo.'
  const partes = r.porPessoa.length === 1
    ? `${r.atribuidas} ${r.atribuidas === 1 ? `${un} atribuída` : `${objeto} atribuídas`} a ${r.porPessoa[0].nome}${r.porPessoa[0].apto ? ` (${r.porPessoa[0].apto})` : ''}`
    : r.atribuidas > 0
      ? `${r.atribuidas} ${r.atribuidas === 1 ? `${un} atribuída` : `${objeto} atribuídas`}: ${r.porPessoa.map((p) => `${p.n} a ${p.nome}`).join(', ')}`
      : 'Nenhuma atribuída'
  const fora = r.semAtribuir.reduce((s, x) => s + x.n, 0)
  const sobra = fora > 0 ? ` · ${fora} ficou sem responsável (${r.semAtribuir.map((x) => x.motivo).join('; ')})` : ''
  return `${partes}${sobra} · fica no histórico`
}

/** O PLANO (sem gravar): quem receberia o quê. A prévia da confirmação e a execução leem o MESMO plano. */
export async function planejarDistribuicaoDoProcesso(processoId: number, agora: Date) {
  const { linhas } = await listarTarefasDaTorre({ processoId }, agora, { incluirPausados: true })
  const alvo = linhas.filter((l) => l.responsavelId == null)
  const objeto = alvo.length > 0 && alvo.every((l) => l.documentoId != null) ? 'certidões' : 'tarefas'
  const porUsuario = new Map<number, { nome: string; ids: number[]; apto: string | null }>()
  const sem = new Map<string, number>()
  const semMotivo = (m: string) => sem.set(m, (sem.get(m) ?? 0) + 1)
  if (alvo.length > 0) {
    const { recomendacoes } = await simularLote({ taskIds: alvo.map((l) => l.taskId) }, agora)
    for (const r of recomendacoes) {
      if (!r.recomendado) { semMotivo(r.abstencao?.texto ?? 'nenhum candidato apto e disponível'); continue }
      const apto = aptidaoComprovada(r)
      if (apto == null) { semMotivo('sem aptidão cadastrada'); continue }
      const g = porUsuario.get(r.recomendado.usuarioId) ?? { nome: r.recomendado.nome, ids: [], apto }
      g.ids.push(r.taskId)
      porUsuario.set(r.recomendado.usuarioId, g)
    }
  }
  return { alvo, objeto, porUsuario, sem, titulos: new Map(alvo.map((l) => [l.taskId, l.titulo])) }
}

export async function distribuirProcesso(args: { processoId: number; autorId: number; autorNome?: string | null; agora?: Date }): Promise<ResultadoDaDistribuicao> {
  const agora = args.agora ?? new Date()
  const { alvo, objeto, porUsuario, sem } = await planejarDistribuicaoDoProcesso(args.processoId, agora)
  const semMotivo = (m: string) => sem.set(m, (sem.get(m) ?? 0) + 1)
  if (alvo.length === 0) {
    const vazio = { total: 0, atribuidas: 0, porPessoa: [], semAtribuir: [] }
    return { ok: true, ...vazio, tarefaIds: [], mensagem: mensagemDaDistribuicao(vazio, objeto), desfazer: null }
  }

  const feitas: number[] = []
  const porPessoa: ResultadoDaDistribuicao['porPessoa'] = []
  for (const [usuarioId, g] of porUsuario) {
    const lote = await atribuirEmLote({ tarefaIds: g.ids, responsavelId: usuarioId, autorId: args.autorId, motivo: `via sugestão do Precisa de você (Distribuir, confirmada${args.autorNome ? ` por ${args.autorNome}` : ''})` })
    const certas = lote.itens.filter((i) => i.ok).map((i) => i.tarefaId)
    feitas.push(...certas)
    if (certas.length > 0) porPessoa.push({ usuarioId, nome: g.nome, n: certas.length, apto: g.apto })
    const falhas = lote.itens.filter((i) => !i.ok)
    for (const f of falhas) semMotivo(f.mensagem ?? 'a atribuição foi recusada')
  }
  porPessoa.sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR'))
  const semAtribuir = [...sem].map(([motivo, n]) => ({ n, motivo }))
  const resumo = { total: alvo.length, atribuidas: feitas.length, porPessoa, semAtribuir }
  return {
    ok: feitas.length > 0, ...resumo, tarefaIds: feitas,
    mensagem: feitas.length > 0 ? mensagemDaDistribuicao(resumo, objeto) : `Nenhuma tarefa atribuída: ${semAtribuir.map((x) => `${x.n} — ${x.motivo}`).join('; ') || 'nenhum candidato'}`,
    desfazer: feitas.length > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: feitas } : null,
  }
}

/** A prévia da confirmação do "Distribuir as N" (mesmo plano da execução; nada é gravado). `null` = nada a atribuir. */
export async function previaDeDistribuirProcesso(processoId: number, agora = new Date()): Promise<import('@/src/lib/torre-confirmacao').PreviaDeConfirmacao | null> {
  const { porUsuario, titulos } = await planejarDistribuicaoDoProcesso(processoId, agora)
  if (porUsuario.size === 0) return null
  const itens = [...porUsuario.values()].map((g) => ({ pessoa: g.nome, quantidade: g.ids.length, tarefas: g.ids.map((id) => titulos.get(id) ?? `#${id}`) }))
  const total = itens.reduce((n, i) => n + i.quantidade, 0)
  const pares = [...porUsuario.entries()].flatMap(([u, g]) => g.ids.map((t) => [t, u] as [number, number])).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return {
    pergunta: `Atribuir ${total} ${total === 1 ? 'tarefa' : 'tarefas'}: ${itens.map((i) => `${i.quantidade} a ${i.pessoa}`).join(', ')}?`,
    itens, assinatura: pares.map(([t, u]) => `${t}:${u}`).join(','),
  }
}
