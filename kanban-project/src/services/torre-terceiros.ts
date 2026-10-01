// src/services/torre-terceiros.ts
// ============================================================================
// TERCEIROS DA TORRE — cobrar por cartório/órgão, Contatos e a lista (Bloco G3–G5).
//
// NADA NOVO DE DADO: o órgão é `Tarefa.orgaoId` (Bloco C, o cadastro
// `OrgaoProtocolo`), o contato é `ContatoTerceiro` (Bloco B) e a cobrança é
// `registrarCobranca` via `cobrarTarefas`. Aqui só se AGRUPA por órgão, com as
// MESMAS linhas da Operação.
//
// "RÉGUA", NÃO "TEMPO APRENDIDO" (Decisão 1 do Passo 0): a coluna mostra só o que o
// Gerenciamento cadastrou — a regra temporal do ÓRGÃO (`RegraTemporalOrgao`) quando
// existe, senão a régua de cobrança dos passos publicados. Nenhuma mediana, nenhum
// "pior caso", nenhum histórico calculado.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { visaoGerencial, ordenarFila, type LinhaGerencial } from '@/lib/operacional/tarefa-projecoes'
import { lerReguaDeCobranca, reguaResumida, type LinhaDaRegua } from '@/lib/operacional/regras-torre'
import { ehCobravelVencido } from '@/lib/operacional/torre-predicados'
import { semFaseFutura } from '@/lib/operacional/fase-futura'
import { idsDeProcessosPausados, semProcessosPausados } from '@/src/services/processo-pausa'
import { cobrarTarefas, canaisCadastrados, CANAIS_VALIDOS, RESULTADOS_VALIDOS } from '@/src/services/cobranca-terceiros'

export interface OrgaoTerceiro {
  orgaoId: number
  nome: string
  uf: string | null
  canal: string
  emAberto: number
  aguardando: number
  semResposta: { tarefas: number; maxDias: number | null }
  regua: string
  naoLocalizada: number
  proximaCobranca: { data: string | null; vencida: boolean }
  cobrancasVencidas: number
  tarefaIds: number[]
}

async function tarefasAbertasDoOrgao(orgaoId: number, agora: Date): Promise<LinhaGerencial[]> {
  const todas: LinhaGerencial[] = []
  for (let pagina = 1; ; pagina++) {
    const { linhas, total } = await visaoGerencial({ orgaoId, pagina, porPagina: 500 }, agora)
    todas.push(...linhas)
    if (pagina * 500 >= total || linhas.length === 0) break
  }
  // Processo PAUSADO fica fora da Torre — inclusive de "Cobrar este cartório" (filtro canônico `semProcessosPausados`).
  return ordenarFila(semProcessosPausados(semFaseFutura(todas.filter((l) => l.coluna !== 'CONCLUIDA')), await idsDeProcessosPausados())) as LinhaGerencial[]
}

/** A régua que o CADASTRO define para cada órgão: a regra temporal DELE, senão a dos passos. */
async function reguaPorOrgao(orgaoIds: number[], regua: LinhaDaRegua[]): Promise<Map<number, string>> {
  const saida = new Map<number, string>()
  if (orgaoIds.length === 0) return saida
  const regras = await prisma.regraTemporalOrgao.findMany({
    where: { orgaoProtocoloId: { in: orgaoIds }, ativo: true }, select: { orgaoProtocoloId: true, stepKey: true, slaDays: true, followUpDays: true },
  })
  const rotuloDoPasso = new Map(regua.map((l) => [l.passoKey, l.passo]))
  const porOrgao = new Map<number, string[]>()
  for (const r of regras) {
    const partes = `${rotuloDoPasso.get(r.stepKey) ?? r.stepKey}: ${r.slaDays} d${r.followUpDays != null ? `, acompanhar a cada ${r.followUpDays} d` : ''}`
    porOrgao.set(r.orgaoProtocoloId, [...(porOrgao.get(r.orgaoProtocoloId) ?? []), partes])
  }
  const geral = reguaResumida(regua)
  for (const id of orgaoIds) saida.set(id, porOrgao.has(id) ? `régua do órgão — ${porOrgao.get(id)!.join('; ')}` : `régua do Gerenciamento — ${geral}`)
  return saida
}

export async function listarTerceiros(linhas: Array<LinhaGerencial & { orgaoId: number | null }>, agora = new Date()): Promise<OrgaoTerceiro[]> {
  const porOrgao = new Map<number, Array<LinhaGerencial & { orgaoId: number | null }>>()
  for (const l of linhas) if (l.orgaoId != null) porOrgao.set(l.orgaoId, [...(porOrgao.get(l.orgaoId) ?? []), l])
  const orgaoIds = [...porOrgao.keys()]
  if (orgaoIds.length === 0) return []

  const [orgaos, regua, canais, contatos] = await Promise.all([
    prisma.orgaoProtocolo.findMany({ where: { id: { in: orgaoIds } }, select: { id: true, name: true, nomeFantasia: true, state: true } }),
    lerReguaDeCobranca(),
    canaisCadastrados(linhas.filter((l) => l.orgaoId != null).map((l) => l.taskId)),
    prisma.contatoTerceiro.groupBy({ by: ['orgaoId'], where: { orgaoId: { in: orgaoIds }, resultado: 'NAO_LOCALIZOU' }, _count: { _all: true } }),
  ])
  const reguas = await reguaPorOrgao(orgaoIds, regua)
  const naoLoc = new Map(contatos.map((c) => [c.orgaoId as number, c._count._all]))

  const saida: OrgaoTerceiro[] = []
  for (const o of orgaos) {
    const ls = porOrgao.get(o.id) ?? []
    const aguard = ls.filter((l) => l.estadoOperacao === 'AGUARDANDO')
    const semResposta = aguard.filter((l) => l.cobrancasSemResposta > 0)
    const dias = semResposta.map((l) => l.esperandoHaDias).filter((d): d is number => d != null)
    const datas = aguard.map((l) => l.acompanhamentoPasso?.dueAt).filter((d): d is string => !!d).sort()
    const contagemCanais = new Map<string, number>()
    for (const l of aguard) { const c = canais.get(l.taskId)?.canal; if (c) contagemCanais.set(c, (contagemCanais.get(c) ?? 0) + 1) }
    const canal = [...contagemCanais.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EMAIL'
    saida.push({
      orgaoId: o.id, nome: o.nomeFantasia || o.name, uf: o.state,
      canal, emAberto: ls.length, aguardando: aguard.length,
      semResposta: { tarefas: semResposta.length, maxDias: dias.length ? Math.max(...dias) : null },
      regua: reguas.get(o.id) ?? '', naoLocalizada: naoLoc.get(o.id) ?? 0,
      proximaCobranca: { data: datas[0] ?? null, vencida: aguard.some((l) => l.acompanhamentoVencido) },
      cobrancasVencidas: ls.filter((l) => ehCobravelVencido(l)).length,
      tarefaIds: aguard.map((l) => l.taskId),
    })
  }
  // Vencidos primeiro, depois mais pedidos em aberto — a ordem do protótipo.
  return saida.sort((a, b) => Number(b.proximaCobranca.vencida) - Number(a.proximaCobranca.vencida) || b.emAberto - a.emAberto)
}

/**
 * COBRAR POR CARTÓRIO — o endpoint que faltava (o `cobrar-todos-vencidos` cobra tudo,
 * sem filtro por órgão). Cobra as tarefas que estão COM ESSE órgão, uma cobrança
 * (fato) por tarefa, pelo canal cadastrado (ou o escolhido no formulário).
 */
export async function cobrarOrgao(args: {
  orgaoId: number; autor: { userId: number; tipo: string }
  canal?: string | null; resultado?: string; observacao?: string | null; dataContato?: Date | null; agora?: Date
}): Promise<
  | { ok: false; erro: string; status: number }
  | { ok: true; orgao: string; cobradas: number; ignoradas: Array<{ tarefaId: number; motivo: string }>; canais: string[] }
> {
  const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: args.orgaoId }, select: { id: true, name: true, nomeFantasia: true } })
  if (!orgao) return { ok: false, erro: 'órgão não encontrado', status: 404 }
  if (args.canal && !CANAIS_VALIDOS.has(args.canal)) return { ok: false, erro: 'canal inválido', status: 400 }
  if (args.resultado && !RESULTADOS_VALIDOS.has(args.resultado)) return { ok: false, erro: 'resultado inválido', status: 400 }

  const abertas = await tarefasAbertasDoOrgao(args.orgaoId, args.agora ?? new Date())
  const aguardando = abertas.filter((l) => l.estadoOperacao === 'AGUARDANDO')
  if (aguardando.length === 0) return { ok: false, erro: 'nenhuma tarefa está com este órgão — nada a cobrar', status: 422 }

  const { cobradas, ignoradas } = await cobrarTarefas({
    tarefaIds: aguardando.map((l) => l.taskId), autor: args.autor,
    canal: args.canal ?? null, resultado: args.resultado, observacao: args.observacao ?? null, dataContato: args.dataContato ?? null,
    exigirAguardando: true,
  })
  const nome = orgao.nomeFantasia || orgao.name
  await prisma.logAuditoria.create({
    data: {
      acao: 'ORGAO_COBRADO', entidade: 'OrgaoProtocolo', entidadeId: orgao.id, usuarioId: args.autor.userId,
      descricao: `Cobrança ao órgão "${nome}" pela Torre: ${cobradas.length} de ${aguardando.length} pedido(s) cobrados.`,
      detalhes: JSON.parse(JSON.stringify({ orgaoId: orgao.id, cobradas, ignoradas })),
    },
  })
  return { ok: true, orgao: nome, cobradas: cobradas.length, ignoradas, canais: [...new Set(cobradas.map((c) => c.canal))] }
}

export interface ContatoDoOrgao {
  id: string
  tipo: 'CONTATO' | 'CANAL_ALTERADO'
  quando: string
  quem: string | null
  tarefaId: number | null
  tarefaTitulo: string | null
  canal: string | null
  resultado: string | null
  texto: string
}

/**
 * OS CONTATOS DE UM ÓRGÃO — o histórico de cobranças e de trocas de canal. Lê os
 * MESMOS registros que o Andamento da tarefa lê (`ContatoTerceiro`, e a auditoria
 * `SOLICITACAO_CANAL_ALTERADO`): um registro, duas projeções, nunca duplicado.
 * Contatos antigos (sem `orgaoId` gravado) entram pela tarefa do órgão.
 */
export async function contatosDoOrgao(orgaoId: number, limite = 100): Promise<{ orgao: { id: number; nome: string } | null; contatos: ContatoDoOrgao[] }> {
  const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: orgaoId }, select: { id: true, name: true, nomeFantasia: true } })
  if (!orgao) return { orgao: null, contatos: [] }
  const tarefasDoOrgao = await prisma.tarefa.findMany({
    where: { OR: [{ orgaoId }, { documento: { orgaoId } }] }, select: { id: true, titulo: true },
  })
  const ids = tarefasDoOrgao.map((t) => t.id)
  const titulos = new Map(tarefasDoOrgao.map((t) => [t.id, t.titulo]))

  const [contatos, canais] = await Promise.all([
    prisma.contatoTerceiro.findMany({
      where: { OR: [{ orgaoId }, ...(ids.length ? [{ tarefaId: { in: ids } }] : [])] },
      orderBy: { registradoEm: 'desc' }, take: limite,
      select: { id: true, tarefaId: true, canal: true, resultado: true, observacao: true, registradoEm: true, registradoPor: { select: { nome: true } } },
    }),
    ids.length
      ? prisma.logAuditoria.findMany({
          where: { acao: 'SOLICITACAO_CANAL_ALTERADO', entidade: 'Tarefa', entidadeId: { in: ids } },
          orderBy: { criadoEm: 'desc' }, take: limite,
          select: { id: true, entidadeId: true, descricao: true, criadoEm: true, detalhes: true, usuario: { select: { nome: true } } },
        })
      : Promise.resolve([]),
  ])

  const saida: ContatoDoOrgao[] = [
    ...contatos.map((c): ContatoDoOrgao => ({
      id: `contato:${c.id}`, tipo: 'CONTATO', quando: c.registradoEm.toISOString(), quem: c.registradoPor?.nome ?? null,
      tarefaId: c.tarefaId, tarefaTitulo: titulos.get(c.tarefaId) ?? null, canal: c.canal, resultado: c.resultado,
      texto: `${c.canal} · ${c.resultado}${c.observacao ? ` — ${c.observacao}` : ''}`,
    })),
    ...canais.map((l): ContatoDoOrgao => ({
      id: `canal:${l.id}`, tipo: 'CANAL_ALTERADO', quando: l.criadoEm.toISOString(), quem: l.usuario?.nome ?? null,
      tarefaId: l.entidadeId, tarefaTitulo: l.entidadeId != null ? titulos.get(l.entidadeId) ?? null : null,
      canal: (l.detalhes as { para?: string } | null)?.para ?? null, resultado: null, texto: l.descricao,
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limite)
  return { orgao: { id: orgao.id, nome: orgao.nomeFantasia || orgao.name }, contatos: saida }
}
