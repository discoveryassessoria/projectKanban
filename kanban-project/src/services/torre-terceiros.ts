// src/services/torre-terceiros.ts
// ============================================================================
// TERCEIROS DA TORRE — cobrar por pedido, por cartório (só para cobrar junto) e o histórico de contatos de um pedido.
// Torre nova, frente G (01/10/2026) — substitui a lista POR ÓRGÃO com placar (Em aberto · Sem resposta · Não localizada ·
// Régua): o protótipo é POR PEDIDO e NÃO tem ranking, média nem contagem comparativa por cartório.
//
// NADA NOVO DE DADO: o órgão é `Tarefa.orgaoId` (o cadastro `OrgaoProtocolo`), o contato é `ContatoTerceiro` (fato histórico
// append-only) e a cobrança é `registrarCobranca` via `cobrarTarefas` (cobranca-terceiros.ts) — a PORTA ÚNICA. A lista, os
// cartões e o resumo saem das MESMAS linhas da Torre no cliente (`lib/operacional/terceiros-pedidos.ts`).
//
// PEDIDO DE PROCESSO PAUSADO fica fora de toda cobrança (filtro canônico `idsDeProcessosPausados`), como fica fora da lista.
// COBRANÇA NÃO TEM "DESFAZER": o terceiro FOI contatado (ver torre-acoes-lote.ts).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { visaoGerencial, ordenarFila, type LinhaGerencial } from '@/lib/operacional/tarefa-projecoes'
import { lerReguaDeCobranca, reguaResumida, type LinhaDaRegua } from '@/lib/operacional/regras-torre'
import { ehCobravelVencido } from '@/lib/operacional/torre-predicados'
import { semFaseFutura } from '@/lib/operacional/fase-futura'
import { textoDoContato, textoDoPedido } from '@/lib/operacional/terceiros-pedidos'
import { idsDeProcessosPausados, semProcessosPausados } from '@/src/services/processo-pausa'
import { cobrarTarefas, canaisCadastrados, CANAIS_VALIDOS, RESULTADOS_VALIDOS, type CobrancaIgnorada } from '@/src/services/cobranca-terceiros'
import { proximaEmDiasValida, MAX_PROXIMA_COBRANCA_DIAS } from '@/src/services/subtarefas-da-etapa'

type Autor = { userId: number; tipo: string }
interface OpcoesDaCobranca {
  canal?: string | null; resultado?: string; observacao?: string | null; dataContato?: Date | null
  /** Dias corridos até a próxima cobrança (1 a 60). Ausente = a régua do cadastro. */
  proximaEmDias?: number | null
}

/** Valida o que vem do formulário — a API confere SEMPRE, não só a tela. */
function validarOpcoes(o: OpcoesDaCobranca): { ok: true } | { ok: false; erro: string; status: number } {
  if (o.canal && !CANAIS_VALIDOS.has(o.canal)) return { ok: false, erro: 'canal inválido', status: 400 }
  if (o.resultado && !RESULTADOS_VALIDOS.has(o.resultado)) return { ok: false, erro: 'resultado inválido', status: 400 }
  if (o.proximaEmDias != null && !proximaEmDiasValida(o.proximaEmDias)) {
    return { ok: false, erro: `"Próxima cobrança em (dias)" deve ser um número inteiro de 1 a ${MAX_PROXIMA_COBRANCA_DIAS}`, status: 400 }
  }
  return { ok: true }
}

export interface OrgaoTerceiro {
  orgaoId: number
  nome: string
  uf: string | null
  canal: string
  emAberto: number
  aguardando: number
  regua: string
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

/** O que o toast precisa para oferecer "Desfazer" numa cobrança: os contatos que ESTA ação criou (estorno, não exclusão). */
export interface DesfazerDeCobranca { tipo: 'COBRANCA'; tarefaIds: number[]; contatoIds: number[] }
export const desfazerDe = (cobradas: Array<{ tarefaId: number; contatoId: number }>): DesfazerDeCobranca | null =>
  cobradas.length ? { tipo: 'COBRANCA', tarefaIds: [], contatoIds: cobradas.map((c) => c.contatoId) } : null

/**
 * COBRAR PEDIDOS — "Cobrar" de uma linha e "Cobrar todos os vencidos (N)". Uma cobrança (fato) por pedido, pelo canal
 * cadastrado de cada um (ou o escolhido), e a PRÓXIMA agendada em `proximaEmDias` (ausente = a régua do cadastro).
 * Só cobra quem está COM o terceiro; processo pausado é recusado item a item; não-admin só cobra as próprias tarefas.
 */
export async function cobrarPedidos(args: { tarefaIds: number[]; autor: Autor } & OpcoesDaCobranca): Promise<
  | { ok: false; erro: string; status: number }
  | { ok: true; cobradas: number; ignoradas: CobrancaIgnorada[]; canais: string[]; proximaEmDias: number | null; desfazer: DesfazerDeCobranca | null }
> {
  const v = validarOpcoes(args)
  if (!v.ok) return v
  const ids = [...new Set(args.tarefaIds)]
  if (ids.length === 0) return { ok: false, erro: 'nenhum pedido para cobrar', status: 400 }

  const [tarefas, pausados] = await Promise.all([
    prisma.tarefa.findMany({ where: { id: { in: ids } }, select: { id: true, processoId: true } }),
    idsDeProcessosPausados(),
  ])
  const pausadas = new Set(tarefas.filter((t) => t.processoId != null && pausados.has(t.processoId)).map((t) => t.id))
  const ignoradasPorPausa: CobrancaIgnorada[] = [...pausadas].map((tarefaId) => ({ tarefaId, motivo: 'processo pausado — fora da Torre' }))

  const { cobradas, ignoradas } = await cobrarTarefas({
    tarefaIds: ids.filter((id) => !pausadas.has(id)), autor: args.autor,
    canal: args.canal ?? null, resultado: args.resultado, observacao: args.observacao ?? null, dataContato: args.dataContato ?? null,
    proximaEmDias: args.proximaEmDias ?? null, exigirAguardando: true,
  })
  const todasIgnoradas = [...ignoradasPorPausa, ...ignoradas]
  if (cobradas.length > 0) {
    await prisma.logAuditoria.create({
      data: {
        acao: 'TERCEIROS_COBRADOS', entidade: 'Tarefa', entidadeId: ids.length === 1 ? ids[0] : 0, usuarioId: args.autor.userId,
        descricao: `Cobrança de terceiro pela Torre: ${cobradas.length} de ${ids.length} pedido(s)${args.proximaEmDias != null ? `; próxima cobrança em ${args.proximaEmDias} dia(s)` : ''}.`,
        detalhes: JSON.parse(JSON.stringify({ cobradas, ignoradas: todasIgnoradas, proximaEmDias: args.proximaEmDias ?? null })),
      },
    })
  }
  return { ok: true, cobradas: cobradas.length, ignoradas: todasIgnoradas, canais: [...new Set(cobradas.map((c) => c.canal))], proximaEmDias: args.proximaEmDias ?? null, desfazer: desfazerDe(cobradas) }
}

/**
 * COBRAR POR CARTÓRIO — "Cobrar este cartório (n)" do agrupamento (só para cobrar junto). Cobra os pedidos que estão COM esse
 * órgão — se a tela mandou `tarefaIds` (o recorte que ela mostra, p.ex. com um país escolhido), só esses; uma cobrança (fato)
 * por pedido, pelo canal cadastrado (ou o escolhido), e audita sob o órgão.
 */
export async function cobrarOrgao(args: { orgaoId: number; autor: Autor; tarefaIds?: number[] | null; agora?: Date } & OpcoesDaCobranca): Promise<
  | { ok: false; erro: string; status: number }
  | { ok: true; orgao: string; cobradas: number; ignoradas: Array<{ tarefaId: number; motivo: string }>; canais: string[]; desfazer: DesfazerDeCobranca | null }
> {
  const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: args.orgaoId }, select: { id: true, name: true, nomeFantasia: true } })
  if (!orgao) return { ok: false, erro: 'órgão não encontrado', status: 404 }
  const v = validarOpcoes(args)
  if (!v.ok) return v

  const abertas = await tarefasAbertasDoOrgao(args.orgaoId, args.agora ?? new Date())
  const recorte = args.tarefaIds?.length ? new Set(args.tarefaIds) : null
  const aguardando = abertas.filter((l) => l.estadoOperacao === 'AGUARDANDO' && (!recorte || recorte.has(l.taskId)))
  if (aguardando.length === 0) return { ok: false, erro: 'nenhuma tarefa está com este órgão — nada a cobrar', status: 422 }

  const { cobradas, ignoradas } = await cobrarTarefas({
    tarefaIds: aguardando.map((l) => l.taskId), autor: args.autor,
    canal: args.canal ?? null, resultado: args.resultado, observacao: args.observacao ?? null, dataContato: args.dataContato ?? null,
    proximaEmDias: args.proximaEmDias ?? null, exigirAguardando: true,
  })
  const nome = orgao.nomeFantasia || orgao.name
  await prisma.logAuditoria.create({
    data: {
      acao: 'ORGAO_COBRADO', entidade: 'OrgaoProtocolo', entidadeId: orgao.id, usuarioId: args.autor.userId,
      descricao: `Cobrança ao órgão "${nome}" pela Torre: ${cobradas.length} de ${aguardando.length} pedido(s) cobrados.`,
      detalhes: JSON.parse(JSON.stringify({ orgaoId: orgao.id, cobradas, ignoradas, proximaEmDias: args.proximaEmDias ?? null })),
    },
  })
  return { ok: true, orgao: nome, cobradas: cobradas.length, ignoradas, canais: [...new Set(cobradas.map((c) => c.canal))], desfazer: desfazerDe(cobradas) }
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

  const [orgaos, regua, canais] = await Promise.all([
    prisma.orgaoProtocolo.findMany({ where: { id: { in: orgaoIds } }, select: { id: true, name: true, nomeFantasia: true, state: true } }),
    lerReguaDeCobranca(),
    canaisCadastrados(linhas.filter((l) => l.orgaoId != null).map((l) => l.taskId)),
  ])
  const reguas = await reguaPorOrgao(orgaoIds, regua)

  const saida: OrgaoTerceiro[] = []
  for (const o of orgaos) {
    const ls = porOrgao.get(o.id) ?? []
    const aguard = ls.filter((l) => l.estadoOperacao === 'AGUARDANDO')
    const datas = aguard.map((l) => l.acompanhamentoPasso?.dueAt).filter((d): d is string => !!d).sort()
    const contagemCanais = new Map<string, number>()
    for (const l of aguard) { const c = canais.get(l.taskId)?.canal; if (c) contagemCanais.set(c, (contagemCanais.get(c) ?? 0) + 1) }
    const canal = [...contagemCanais.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EMAIL'
    saida.push({
      orgaoId: o.id, nome: o.nomeFantasia || o.name, uf: o.state,
      canal, emAberto: ls.length, aguardando: aguard.length,
      regua: reguas.get(o.id) ?? '',
      proximaCobranca: { data: datas[0] ?? null, vencida: aguard.some((l) => l.acompanhamentoVencido) },
      cobrancasVencidas: ls.filter((l) => ehCobravelVencido(l)).length,
      tarefaIds: aguard.map((l) => l.taskId),
    })
  }
  // Vencidos primeiro, depois mais pedidos em aberto — a ordem do protótipo.
  return saida.sort((a, b) => Number(b.proximaCobranca.vencida) - Number(a.proximaCobranca.vencida) || b.emAberto - a.emAberto)
}

export interface ContatoDoPedido {
  id: string
  tipo: 'PEDIDO' | 'CONTATO' | 'CANAL_ALTERADO'
  quando: string
  /** A frase pronta: "Priscila cobrou por e-mail · sem resposta". */
  texto: string
  /** Cobrança ESTORNADA (Desfazer): continua no histórico, riscada; não conta em nada. */
  estornado?: boolean
}

/**
 * OS CONTATOS DE UM PEDIDO — o histórico da certidão, do mais novo ao mais antigo: cada cobrança/ligação
 * (`ContatoTerceiro`), cada troca de canal (a auditoria `SOLICITACAO_CANAL_ALTERADO`) e o envio do pedido
 * (`SolicitacaoDocumento`, com o protocolo quando houver). São os MESMOS registros que o Andamento da tarefa lê:
 * um registro, duas projeções, nunca duplicado. `null` = a tarefa não existe.
 */
export async function contatosDoPedido(tarefaId: number, limite = 100): Promise<{ tarefaId: number; contatos: ContatoDoPedido[] } | null> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true } })
  if (!tarefa) return null
  const [contatos, canais, pedidos] = await Promise.all([
    prisma.contatoTerceiro.findMany({
      where: { tarefaId }, orderBy: { registradoEm: 'desc' }, take: limite,
      select: { id: true, canal: true, resultado: true, observacao: true, registradoEm: true, estornadoEm: true, registradoPor: { select: { nome: true } } },
    }),
    prisma.logAuditoria.findMany({
      where: { acao: 'SOLICITACAO_CANAL_ALTERADO', entidade: 'Tarefa', entidadeId: tarefaId },
      orderBy: { criadoEm: 'desc' }, take: limite, select: { id: true, descricao: true, criadoEm: true },
    }),
    prisma.solicitacaoDocumento.findMany({
      where: { tarefaId, status: { not: 'CANCELADA' } }, orderBy: { dataEnvio: 'desc' }, take: limite,
      select: { id: true, canal: true, dataEnvio: true, criadoPor: { select: { nome: true } }, protocolos: { select: { numeroProtocolo: true }, orderBy: { id: 'asc' } } },
    }),
  ])
  const saida: ContatoDoPedido[] = [
    ...contatos.map((c): ContatoDoPedido => ({
      id: `contato:${c.id}`, tipo: 'CONTATO', quando: c.registradoEm.toISOString(),
      texto: textoDoContato({ quem: c.registradoPor?.nome ?? null, canal: c.canal, resultado: c.resultado, observacao: c.observacao }),
      ...(c.estornadoEm ? { estornado: true } : {}),
    })),
    ...canais.map((l): ContatoDoPedido => ({ id: `canal:${l.id}`, tipo: 'CANAL_ALTERADO', quando: l.criadoEm.toISOString(), texto: l.descricao })),
    ...pedidos.map((p): ContatoDoPedido => ({
      id: `pedido:${p.id}`, tipo: 'PEDIDO', quando: p.dataEnvio.toISOString(),
      texto: textoDoPedido({ quem: p.criadoPor?.nome ?? null, canal: p.canal, protocolo: p.protocolos.map((x) => x.numeroProtocolo).find((n): n is string => !!n) ?? null }),
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limite)
  return { tarefaId, contatos: saida }
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
  /** Cobrança ESTORNADA (Desfazer): continua no histórico, riscada; não conta em nada. */
  estornado?: boolean
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
      select: { id: true, tarefaId: true, canal: true, resultado: true, observacao: true, registradoEm: true, estornadoEm: true, registradoPor: { select: { nome: true } } },
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
      ...(c.estornadoEm ? { estornado: true } : {}),
    })),
    ...canais.map((l): ContatoDoOrgao => ({
      id: `canal:${l.id}`, tipo: 'CANAL_ALTERADO', quando: l.criadoEm.toISOString(), quem: l.usuario?.nome ?? null,
      tarefaId: l.entidadeId, tarefaTitulo: l.entidadeId != null ? titulos.get(l.entidadeId) ?? null : null,
      canal: (l.detalhes as { para?: string } | null)?.para ?? null, resultado: null, texto: l.descricao,
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limite)
  return { orgao: { id: orgao.id, nome: orgao.nomeFantasia || orgao.name }, contatos: saida }
}
