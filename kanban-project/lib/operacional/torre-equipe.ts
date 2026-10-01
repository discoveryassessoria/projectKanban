// lib/operacional/torre-equipe.ts
// ============================================================================
// A ABA EQUIPE DA TORRE — Bloco H1/H2 (30/09/2026).
//
//   quadroDaEquipe   nome · papel · aptidões · ausência · Carga · Ativas ·
//                    Atrasadas · Aguard. · Fila em semanas  +  previsão de 4 semanas
//   simularSaida     o impacto de uma saída ANTES de aplicar — NÃO grava nada
//   moverCarteira    MANUAL, por `redistribuirTarefas` — nunca automático
//
// ─── UMA CONTA SÓ ───────────────────────────────────────────────────────────
// Os números vêm das MESMAS linhas que a Operação lê (`listarTarefasDaTorre`),
// pela conta única `cargaPorPessoa` — a que a regra r3 também usa. Capacidade
// medida e fila em semanas são as do Bloco E1 (`capacidadeMedidaPorUsuario`).
// Nada é recalculado por fora e nenhum número é de exemplo.
//
// ─── AUSÊNCIA NÃO MOVE NADA SOZINHA ─────────────────────────────────────────
// (Decisão 2 do Passo 0: a regra r4 não existe.) Marcar ausência é só REGISTRO,
// com o sucessor SUGERIDO (E2). Mover a carteira é um ato à parte, do gestor.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import { lerOrganizacao, capacidadeMedidaPorUsuario, unidadesDasTarefas, paisesDasTarefas, paisesComAptidaoDeclarada, unidadesComAptidaoDeclarada, rotulosDasUnidades, type Indisponibilidade } from './organizacao'
import { sugerirSucessor } from './elegibilidade'
import { redistribuirTarefas } from './tarefa-comandos'
import { cargaPorPessoa, faixaDaCarga, faixaDaFila, nivelDaPrevisao, ehExecutavel, type FaixaDaCarga, type FaixaDaFila } from './torre-predicados'
import { carregarContextoDeSugestao, escolherResponsavel, alvosDeSugestao } from './precisa-de-voce'
import { quemAbsorve, sugestaoDeRedistribuicao, type SugestaoDeRedistribuicao } from './torre-equipe-distribuicao'
import { inicioDoDiaOperacional } from './tempo-operacional'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'

const PERMISSAO_EXECUTAR = 'tarefas.iniciar_concluir'
const DIA_MS = 86_400_000

export interface LinhaDaEquipe {
  usuarioId: number
  nome: string
  papel: string
  aptidoes: string[]
  /** APTIDÃO POR PAÍS (Torre nova, M3): os países em que a pessoa é apta ("apto em Itália"). Vazio = sem aptidão por país cadastrada. */
  aptidoesPais: string[]
  ausencia: (Indisponibilidade & { rotulo: string }) | null
  carga: {
    executaveis: number
    limite: number | null
    /** `null` = sem limite cadastrado — não há % a mostrar (a tela diz "sem limite", nunca inventa um). */
    pct: number | null
    faixa: FaixaDaCarga | null
    fechaPorSemana: number
  }
  ativas: number
  atrasadas: number
  aguardando: number
  fila: { semanas: number | null; faixa: FaixaDaFila }
}

export interface LinhaDaPrevisao {
  usuarioId: number | null
  nome: string
  porSemana: Array<{ n: number; nivel: 0 | 1 | 2 | 3 }>
  /**
   * O QUE FICA FORA DAS 4 SEMANAS — e por isso precisa estar na tela para a soma FECHAR (achado real, 30/09/2026:
   * a previsão somava 19 contra 31 abertas porque as tarefas sem prazo, as já vencidas e as de depois da 4ª semana
   * ficavam de fora sem aviso). `total` = as abertas da pessoa (a mesma conta de `ativas`):
   * soma das 4 semanas + vencidas + depois + sem prazo = total.
   */
  vencidas: number
  depois: number
  semPrazo: number
  total: number
}

export interface PrevisaoDeCarga {
  semanas: Array<{ inicio: string; fim: string }>
  linhas: LinhaDaPrevisao[]
}

const ROTULO_AUSENCIA: Record<string, string> = { FERIAS: 'férias', AFASTAMENTO: 'afastamento', AUSENCIA: 'ausência', BLOQUEIO_OPERACIONAL: 'bloqueio operacional' }

const dataCurta = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })

/** As 4 semanas a partir de HOJE (no fuso operacional): [hoje, hoje+6], [hoje+7, hoje+13]… */
export function semanasDaPrevisao(agora: Date, quantas = 4): Array<{ inicio: Date; fim: Date }> {
  const hoje = inicioDoDiaOperacional(agora)
  return Array.from({ length: quantas }, (_, i) => ({
    inicio: new Date(hoje.getTime() + i * 7 * DIA_MS),
    fim: new Date(hoje.getTime() + (i * 7 + 7) * DIA_MS - 1),
  }))
}

/**
 * Onde cada tarefa ABERTA de um responsável cai: numa das semanas, antes de hoje (vencida), depois da última
 * semana, ou sem prazo. Cada tarefa cai em EXATAMENTE um balde — a soma dos baldes é o total de abertas.
 */
export function distribuirNaPrevisao(
  linhas: ReadonlyArray<Pick<LinhaDaTorre, 'responsavelId' | 'dataPrazo' | 'estadoOperacao'>>,
  responsavelId: number | null,
  semanas: ReadonlyArray<{ inicio: Date; fim: Date }>,
): { porSemana: number[]; vencidas: number; depois: number; semPrazo: number; total: number } {
  const porSemana = semanas.map(() => 0)
  let vencidas = 0, depois = 0, semPrazo = 0, total = 0
  const inicioDaJanela = semanas[0].inicio.getTime()
  const fimDaJanela = semanas[semanas.length - 1].fim.getTime()
  for (const l of linhas) {
    if (l.responsavelId !== responsavelId || l.estadoOperacao === 'CONCLUIDA') continue
    total++
    const prazo = l.dataPrazo != null ? Date.parse(l.dataPrazo) : NaN
    if (Number.isNaN(prazo)) { semPrazo++; continue }
    if (prazo < inicioDaJanela) { vencidas++; continue }
    if (prazo > fimDaJanela) { depois++; continue }
    porSemana[semanas.findIndex((s) => prazo >= s.inicio.getTime() && prazo <= s.fim.getTime())]++
  }
  return { porSemana, vencidas, depois, semPrazo, total }
}

export interface LinhaSemResponsavel {
  /** As abertas SEM DONO (a mesma conta de "Sem responsável" na aba Tarefas e na Visão geral). */
  ativas: number
  atrasadas: number
  aguardando: number
}

export async function quadroDaEquipe(
  linhasEntrada?: LinhaDaTorre[], agora = new Date(),
): Promise<{ agora: string; pessoas: LinhaDaEquipe[]; semResponsavel: LinhaSemResponsavel; sugestao: SugestaoDeRedistribuicao; previsao: PrevisaoDeCarga }> {
  const linhas = linhasEntrada ?? (await listarTarefasDaTorre({}, agora)).linhas
  const [usuarios, organizacao] = await Promise.all([
    prisma.usuario.findMany({
      select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { nome: true, permissoes: true } } },
      orderBy: { nome: 'asc' },
    }),
    lerOrganizacao(agora),
  ])
  const cargas = cargaPorPessoa(linhas)

  // Entra na aba quem EXECUTA trabalho ou tem trabalho aberto. Quem só administra o sistema não é "equipe".
  const executam = usuarios.filter((u) => {
    const perms = calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null)
    return temPermissao(perms, PERMISSAO_EXECUTAR) || (cargas.get(u.id)?.ativas ?? 0) > 0
  })
  const executaveisPorUsuario = new Map(executam.map((u) => [u.id, cargas.get(u.id)?.executaveis ?? 0]))
  const [medidas, sugestao] = await Promise.all([
    capacidadeMedidaPorUsuario(executam.map((u) => u.id), executaveisPorUsuario, agora),
    sugestaoDeRedistribuicao(linhas, organizacao, agora),
  ])

  const pessoas: LinhaDaEquipe[] = executam.map((u) => {
    const org = organizacao.get(u.id)
    const c = cargas.get(u.id) ?? { ativas: 0, executaveis: 0, atrasadas: 0, aguardando: 0 }
    const m = medidas.get(u.id) ?? { concluidasUltimasSemanas: 0, mediaSemanal: 0, filaEmSemanas: null }
    const limite = org?.limiteExecutaveis ?? null
    const pct = limite != null && limite > 0 ? Math.round((c.executaveis / limite) * 100) : null
    const ind = org?.indisponivelPor ?? null
    return {
      usuarioId: u.id, nome: u.nome,
      papel: u.perfil?.nome ?? (u.tipo === 'admin' ? 'Administrador' : u.tipo),
      aptidoes: (org?.aptidoesDetalhadas ?? []).map((a) => a.nome),
      aptidoesPais: (org?.paisesAptosDetalhados ?? []).map((p) => p.nome),
      ausencia: ind ? { ...ind, rotulo: ROTULO_AUSENCIA[ind.tipo] ?? ind.tipo } : null,
      carga: { executaveis: c.executaveis, limite, pct, faixa: pct != null ? faixaDaCarga(pct) : null, fechaPorSemana: m.mediaSemanal },
      ativas: c.ativas, atrasadas: c.atrasadas, aguardando: c.aguardando,
      fila: { semanas: m.filaEmSemanas, faixa: faixaDaFila(m.filaEmSemanas, c.executaveis) },
    }
  })

  // A linha-balde "Sem responsável": a MESMA conta das abertas sem dono da Operação (Tarefas e Visão geral leem das mesmas linhas).
  const semDono = linhas.filter((l) => l.responsavelId == null && l.estadoOperacao !== 'CONCLUIDA')
  const semResponsavel: LinhaSemResponsavel = {
    ativas: semDono.length, atrasadas: semDono.filter((l) => l.atrasada).length, aguardando: semDono.filter((l) => l.estadoOperacao === 'AGUARDANDO').length,
  }

  // ── H2: PREVISÃO DE 4 SEMANAS — vencimentos (prazo da linha) por pessoa por semana ──
  const semanas = semanasDaPrevisao(agora)
  const linhaDaPrevisao = (usuarioId: number | null, nome: string): LinhaDaPrevisao => {
    const d = distribuirNaPrevisao(linhas, usuarioId, semanas)
    return {
      usuarioId, nome,
      porSemana: d.porSemana.map((n) => ({ n, nivel: nivelDaPrevisao(n) })),
      vencidas: d.vencidas, depois: d.depois, semPrazo: d.semPrazo, total: d.total,
    }
  }
  const previsao: PrevisaoDeCarga = {
    semanas: semanas.map((s) => ({ inicio: s.inicio.toISOString(), fim: s.fim.toISOString() })),
    linhas: [
      ...pessoas.map((p) => linhaDaPrevisao(p.usuarioId, p.nome)),
      // O que vence sem dono também é carga que vem — sem esta linha a soma da tela não fecha com a Operação.
      linhaDaPrevisao(null, 'Sem responsável'),
    ],
  }
  return { agora: agora.toISOString(), pessoas, semResponsavel, sugestao, previsao }
}

export const rotuloDaSemana = (s: { inicio: string; fim: string }) => `${dataCurta(new Date(s.inicio))}–${dataCurta(new Date(s.fim))}`

// ─── QUEM ESTÁ NO LIMITE — a conta ÚNICA (Equipe, regra r3 e item "Carga" do Precisa de você) ──

export interface PessoaNoLimite { usuarioId: number; nome: string; executaveis: number; limite: number }

/**
 * A carga executável de QUEM TEM LIMITE cadastrado. Vem da MESMA conta da aba
 * Equipe (`cargaPorPessoa`, sobre as linhas da Operação) — r3 e a tela nunca
 * discordam sobre "quem está no limite".
 */
export async function cargasComLimite(
  agora = new Date(), linhas?: LinhaDaTorre[], organizacaoJaLida?: Awaited<ReturnType<typeof lerOrganizacao>>,
): Promise<Map<number, PessoaNoLimite>> {
  const organizacao = organizacaoJaLida ?? await lerOrganizacao(agora)
  const comLimite = [...organizacao.values()].filter((o) => o.limiteExecutaveis != null)
  const saida = new Map<number, PessoaNoLimite>()
  if (comLimite.length === 0) return saida
  const cargas = cargaPorPessoa(linhas ?? (await listarTarefasDaTorre({}, agora)).linhas)
  for (const o of comLimite) {
    saida.set(o.usuarioId, { usuarioId: o.usuarioId, nome: o.nome, executaveis: cargas.get(o.usuarioId)?.executaveis ?? 0, limite: o.limiteExecutaveis as number })
  }
  return saida
}

/** Quem JÁ atingiu o limite do cadastro (executáveis ≥ limite). */
export async function pessoasNoLimite(
  agora = new Date(), linhas?: LinhaDaTorre[], organizacaoJaLida?: Awaited<ReturnType<typeof lerOrganizacao>>,
): Promise<Map<number, PessoaNoLimite>> {
  const todas = await cargasComLimite(agora, linhas, organizacaoJaLida)
  return new Map([...todas].filter(([, p]) => p.executaveis >= p.limite))
}

// ─── SIMULAR SAÍDA — SÓ LEITURA ─────────────────────────────────────────────

export interface SimulacaoDeSaida {
  usuarioId: number
  nome: string
  dias: number
  /** O sucessor que a regra SUGERE (E2). `null` = sem apto disponível. */
  sucessor: { usuarioId: number; nome: string } | null
  ativas: number
  /** Aguardando terceiros: continuam correndo e não dependem da pessoa agora. */
  comOCartorio: number
  /** Vencem dentro do período da saída. */
  vencemNoPeriodo: number
  /** Ficariam sem dono sem o sucessor mover a carteira. */
  ficamSemDono: number
  /** O sucessor absorve (apto à unidade da tarefa). */
  absorvidas: number
  /** Sobram sem apto — precisam de decisão. */
  semApto: number
  texto: string
}

export async function simularSaida(
  usuarioId: number, dias: number, linhasEntrada?: LinhaDaTorre[], agora = new Date(),
): Promise<SimulacaoDeSaida | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nome: true } })
  if (!usuario) return null
  const linhas = linhasEntrada ?? (await listarTarefasDaTorre({}, agora)).linhas
  const minhas = linhas.filter((l) => l.responsavelId === usuarioId && l.estadoOperacao !== 'CONCLUIDA')
  const sucessor = await sugerirSucessor(usuarioId, agora)
  const limite = agora.getTime() + dias * DIA_MS
  const comOCartorio = minhas.filter((l) => l.estadoOperacao === 'AGUARDANDO')
  const vencem = minhas.filter((l) => l.dataPrazo != null && Date.parse(l.dataPrazo) <= limite)
  // "Ficam sem toque": o que dependia DELA agora (executáveis) e ninguém toca enquanto ela estiver fora — a mesma conta da Carga.
  const semToque = minhas.filter((l) => ehExecutavel(l.statusTarefa))
  const absorve = await quemAbsorve(minhas.map((l) => l.taskId), sucessor?.usuarioId ?? null, agora)
  const absorvidas = minhas.filter((l) => absorve.has(l.taskId)).length
  const semApto = minhas.length - absorvidas

  let texto: string
  if (minhas.length === 0) {
    texto = 'Sem impacto: nenhuma tarefa ativa.'
  } else {
    const inicio = `Vencem ${vencem.length} prazos nesses ${dias} dias e ${semToque.length} certidões ficam sem toque.`
    if (!sucessor) {
      texto = `${inicio} Nenhum sucessor apto e disponível — as ${minhas.length} ficam sem dono até alguém decidir.`
    } else {
      const [detalhe, fila] = await Promise.all([
        detalheDoSucessor(usuarioId, sucessor.usuarioId, minhas, absorve, agora),
        textoDaFilaDoSucessor(sucessor.usuarioId, semToque.filter((l) => absorve.has(l.taskId)).length, agora),
      ])
      texto = `${inicio} Sucessor sugerido: ${sucessor.nome}${detalhe}. ${fila}`
    }
  }
  return {
    usuarioId, nome: usuario.nome, dias,
    sucessor: sucessor ? { usuarioId: sucessor.usuarioId, nome: sucessor.nome } : null,
    ativas: minhas.length, comOCartorio: comOCartorio.length, vencemNoPeriodo: vencem.length,
    ficamSemDono: minhas.length, absorvidas, semApto, texto,
  }
}

const SEM_APTO_DISPONIVEL = 'sem apto disponível'

/** "Depois da mudança, a fila do sucessor sobe 1.5 semana(s)." — absorvidas executáveis ÷ o que o sucessor fecha por semana. */
async function textoDaFilaDoSucessor(sucessorId: number, executaveisAbsorvidas: number, agora: Date): Promise<string> {
  const m = (await capacidadeMedidaPorUsuario([sucessorId], undefined, agora)).get(sucessorId)
  if (executaveisAbsorvidas === 0) return 'Depois da mudança, a fila do sucessor não muda.'
  if (!m || m.mediaSemanal <= 0) return `Depois da mudança, o sucessor passa a ter ${executaveisAbsorvidas} executáveis a mais e ainda não há base para estimar semanas (nenhuma conclusão nas últimas 4).`
  return `Depois da mudança, a fila do sucessor sobe ${(executaveisAbsorvidas / m.mediaSemanal).toFixed(1)} semana(s).`
}

/**
 * O parêntese do sucessor — "(apto em Espanha; Itália fica com Rafael)": onde o sucessor é apto e, para o que ele NÃO é apto,
 * quem fica com cada parte (a MESMA `escolherResponsavel`, sem o ausente). Vazio quando o sucessor absorve tudo.
 */
async function detalheDoSucessor(
  ausenteId: number, sucessorId: number, minhas: LinhaDaTorre[], absorve: Set<number>, agora: Date,
): Promise<string> {
  const naoAbsorvidas = minhas.filter((l) => !absorve.has(l.taskId))
  if (naoAbsorvidas.length === 0) return ''
  const ids = minhas.map((l) => l.taskId)
  const [unidades, paises, comAptidaoU, comAptidaoP, rotulos, ctx, alvos] = await Promise.all([
    unidadesDasTarefas(ids), paisesDasTarefas(ids), unidadesComAptidaoDeclarada(), paisesComAptidaoDeclarada(), rotulosDasUnidades(),
    carregarContextoDeSugestao(agora), alvosDeSugestao(ids),
  ])
  const nomesDePais = new Map<number, string>()
  const paisIds = [...new Set([...paises.values()].filter((p): p is number => p != null))]
  if (paisIds.length) for (const p of await prisma.catalogoPais.findMany({ where: { id: { in: paisIds } }, select: { id: true, countryLabel: true } })) nomesDePais.set(p.id, p.countryLabel)
  const aptoEm = new Set(ctx.organizacao.get(sucessorId)?.paisesAptos ?? [])
  // O RÓTULO de onde a regra atua: o país (quando o país tem regra) ou a unidade de trabalho.
  const rotuloDe = (taskId: number): string | null => {
    const p = paises.get(taskId) ?? null, u = unidades.get(taskId) ?? null
    if (p != null && comAptidaoP.has(p) && nomesDePais.has(p)) return nomesDePais.get(p)!
    if (u != null && comAptidaoU.has(u)) return rotulos.get(u)?.nome ?? null
    return null
  }
  const ondeApto = [...new Set(minhas.filter((l) => absorve.has(l.taskId)).map((l) => rotuloDe(l.taskId)).filter((r): r is string => r != null))]
  // Sem o ausente na disputa, e sem o sucessor (que já se declarou não apto a essas): quem fica com cada parte.
  const ctxSemAusente = { ...ctx, usuarios: ctx.usuarios.filter((u) => u.id !== ausenteId && u.id !== sucessorId) }
  const fica = new Map<string, Set<string>>()
  for (const l of naoAbsorvidas) {
    const rotulo = rotuloDe(l.taskId) ?? 'sem classificação'
    const s = escolherResponsavel(ctxSemAusente, alvos.get(l.taskId) ?? null)
    const nome = s && !s.fallback ? s.nome : null
    const conjunto = fica.get(rotulo) ?? new Set<string>()
    conjunto.add(nome ?? SEM_APTO_DISPONIVEL)
    fica.set(rotulo, conjunto)
  }
  void aptoEm
  const partes: string[] = []
  if (ondeApto.length) partes.push(`apto(a) em ${ondeApto.join(', ')}`)
  for (const [rotulo, nomes] of fica) {
    const lista = [...nomes]
    partes.push(lista.length === 1 && lista[0] === SEM_APTO_DISPONIVEL ? `${rotulo}: sem apto disponível` : `${rotulo} fica com ${lista.join(' e ')}`)
  }
  return partes.length ? ` (${partes.join('; ')})` : ''
}

// ─── MOVER CARTEIRA — MANUAL ────────────────────────────────────────────────

export interface ResultadoMoverCarteira {
  de: { usuarioId: number; nome: string }
  para: { usuarioId: number; nome: string }
  total: number
  movidas: number
  falhas: number
  /** Ficaram de fora porque o destino não é apto à unidade da tarefa. */
  naoAptas: number
  tarefaIds: number[]
  itens: Array<{ tarefaId: number; ok: boolean; mensagem?: string }>
}

/**
 * MOVE A CARTEIRA de uma pessoa para outra — sempre um ato deliberado do gestor,
 * pela MESMA porta da redistribuição (`redistribuirTarefas`: item a item,
 * auditado, uma notificação agrupada). Só move o que o destino é APTO a executar
 * (a mesma regra opt-in da sugestão) a menos que `incluirNaoAptas`.
 * `paraUsuarioId` ausente = o sucessor sugerido.
 */
export async function moverCarteira(args: {
  deUsuarioId: number; paraUsuarioId?: number | null; autorId: number; incluirNaoAptas?: boolean; agora?: Date; linhas?: LinhaDaTorre[]
}): Promise<{ ok: true; resultado: ResultadoMoverCarteira } | { ok: false; erro: string }> {
  const agora = args.agora ?? new Date()
  const de = await prisma.usuario.findUnique({ where: { id: args.deUsuarioId }, select: { id: true, nome: true } })
  if (!de) return { ok: false, erro: 'pessoa de origem não encontrada' }
  const paraId = args.paraUsuarioId ?? (await sugerirSucessor(args.deUsuarioId, agora))?.usuarioId ?? null
  if (paraId == null) return { ok: false, erro: 'nenhum destino apto e disponível — escolha uma pessoa' }
  if (paraId === args.deUsuarioId) return { ok: false, erro: 'origem e destino são a mesma pessoa' }
  const para = await prisma.usuario.findUnique({ where: { id: paraId }, select: { id: true, nome: true } })
  if (!para) return { ok: false, erro: 'destino não encontrado' }

  const linhas = args.linhas ?? (await listarTarefasDaTorre({}, agora)).linhas
  const minhas = linhas.filter((l) => l.responsavelId === args.deUsuarioId && l.estadoOperacao !== 'CONCLUIDA').map((l) => l.taskId)
  if (minhas.length === 0) return { ok: false, erro: 'nada a mover: a pessoa não tem tarefa ativa' }

  const aptas = args.incluirNaoAptas ? new Set(minhas) : await quemAbsorve(minhas, paraId, agora)
  const aMover = minhas.filter((id) => aptas.has(id))
  if (aMover.length === 0) return { ok: false, erro: `${para.nome} não é apto a nenhuma das ${minhas.length} tarefa(s) — nada foi movido` }

  const r = await redistribuirTarefas({
    tarefaIds: aMover, novoResponsavelId: paraId, autorId: args.autorId,
    motivo: `mover carteira de ${de.nome} para ${para.nome} (ação manual, Torre)`,
  })
  return {
    ok: true,
    resultado: {
      de: { usuarioId: de.id, nome: de.nome }, para: { usuarioId: para.id, nome: para.nome },
      total: minhas.length, movidas: r.sucesso, falhas: r.falha, naoAptas: minhas.length - aMover.length,
      tarefaIds: r.itens.filter((i) => i.ok).map((i) => i.tarefaId),
      itens: r.itens.map((i) => ({ tarefaId: i.tarefaId, ok: i.ok, mensagem: i.mensagem })),
    },
  }
}
