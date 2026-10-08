// lib/operacional/torre-coerencia-abas.ts
// ============================================================================
// O VIGIA DAS ABAS DA TORRE (07/10/2026 — CLAUDE.md §41, regra n). Cada dado que a Torre mostra vem de UMA função no servidor; as abas só desenham. Este módulo LÊ o que
// cada aba vai desenhar — a partir das MESMAS linhas — e acusa qualquer divergência entre elas. SOMENTE LEITURA.
//   • responsável: Processos (donos por processo) × Equipe (carga por pessoa) × Tarefas (linhas abertas por dono) — mesmo número por pessoa e por «sem responsável».
//   • fases: Visão geral (funil) × Radar × Processos × Tarefas (filtro) × Kanban × rodapé «As 5 palavras» — a MESMA lista, na ordem real do processo.
//   • risco e contagens: funil (Visão geral) × botões e saúde da fase (Processos) × Radar × cartão «em risco» × aba Tarefas — mesmo número, a partir de `torre-contagens.ts`.
// Tarefa aberta, vencida ou sem responsável NUNCA é erro: é estado. O que se acusa é a ABA dizer outra coisa.
// ============================================================================

export interface DivergenciaEntreAbas {
  /** O assunto comparado (`responsavel`, `fases`, `risco`, `contagem`…). */
  assunto: string
  /** As abas que disseram coisas diferentes. */
  abas: string
  /** Quem/qual (nome da pessoa, da fase, da família). */
  chave: string
  detalhe: string
}

export interface LinhaMinima { processoId: number | null; responsavelId: number | null; responsavelNome: string | null; estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA' }
export interface ProcessoMinimo { processoId: number; familiaNome: string; proximaAcao: { responsaveis: { donos: Array<{ id: number; nome: string; n: number }>; semDono: number; abertas: number } } | null }
export interface PessoaDaEquipeMinima { usuarioId: number; nome: string; ativas: number }

/** Responsável: Processos × Equipe × Tarefas dizem o MESMO por pessoa e por «sem responsável». PURA. */
export function compararResponsaveis(args: { processos: ProcessoMinimo[]; linhas: LinhaMinima[]; equipe: PessoaDaEquipeMinima[]; semResponsavelDaEquipe: number }): DivergenciaEntreAbas[] {
  const out: DivergenciaEntreAbas[] = []
  const abertas = args.linhas.filter((l) => l.estadoOperacao !== 'CONCLUIDA')
  // Tarefas (a lista): por dono.
  const tarefasPorDono = new Map<number, number>()
  let tarefasSemDono = 0
  for (const l of abertas) { if (l.responsavelId == null) tarefasSemDono++; else tarefasPorDono.set(l.responsavelId, (tarefasPorDono.get(l.responsavelId) ?? 0) + 1) }
  // Processos: soma dos donos de cada processo.
  const processosPorDono = new Map<number, number>()
  let processosSemDono = 0
  const nomes = new Map<number, string>()
  for (const p of args.processos) {
    const r = p.proximaAcao?.responsaveis
    if (!r) continue
    processosSemDono += r.semDono
    for (const d of r.donos) { processosPorDono.set(d.id, (processosPorDono.get(d.id) ?? 0) + d.n); nomes.set(d.id, d.nome) }
  }
  // Só as tarefas que pertencem a um processo da lista entram na comparação com Processos.
  const idsDosProcessos = new Set(args.processos.map((p) => p.processoId))
  const tarefasDosProcessosPorDono = new Map<number, number>()
  let tarefasDosProcessosSemDono = 0
  for (const l of abertas) {
    if (l.processoId == null || !idsDosProcessos.has(l.processoId)) continue
    if (l.responsavelId == null) tarefasDosProcessosSemDono++
    else tarefasDosProcessosPorDono.set(l.responsavelId, (tarefasDosProcessosPorDono.get(l.responsavelId) ?? 0) + 1)
    if (l.responsavelId != null && l.responsavelNome) nomes.set(l.responsavelId, l.responsavelNome)
  }
  for (const id of new Set([...processosPorDono.keys(), ...tarefasDosProcessosPorDono.keys()])) {
    const a = processosPorDono.get(id) ?? 0, b = tarefasDosProcessosPorDono.get(id) ?? 0
    if (a !== b) out.push({ assunto: 'responsavel', abas: 'Processos × Tarefas', chave: nomes.get(id) ?? `#${id}`, detalhe: `Processos soma ${a} tarefa(s) abertas de ${nomes.get(id) ?? id}; a lista de Tarefas tem ${b}` })
  }
  if (processosSemDono !== tarefasDosProcessosSemDono) out.push({ assunto: 'responsavel', abas: 'Processos × Tarefas', chave: 'Sem responsável', detalhe: `Processos soma ${processosSemDono} sem responsável; Tarefas tem ${tarefasDosProcessosSemDono}` })
  // Equipe × Tarefas (todas as abertas).
  for (const e of args.equipe) {
    const t = tarefasPorDono.get(e.usuarioId) ?? 0
    if (e.ativas !== t) out.push({ assunto: 'responsavel', abas: 'Equipe × Tarefas', chave: e.nome, detalhe: `Equipe mostra ${e.ativas} ativa(s) de ${e.nome}; a lista de Tarefas tem ${t}` })
  }
  if (args.semResponsavelDaEquipe !== tarefasSemDono) out.push({ assunto: 'responsavel', abas: 'Equipe × Tarefas', chave: 'Sem responsável', detalhe: `Equipe mostra ${args.semResponsavelDaEquipe} sem responsável; Tarefas tem ${tarefasSemDono}` })
  return out
}

export interface ListaDeFasesDaAba { aba: string; chaves: string[]; /** `true` = a aba mostra TODAS as fases (tem de ser igual à lista única); `false` = um subconjunto, na mesma ordem. */ completa: boolean }

/** Fases: cada aba desenha a lista única (ou um subconjunto dela, na mesma ordem). PURA. */
export function compararFases(unica: string[], abas: ListaDeFasesDaAba[]): DivergenciaEntreAbas[] {
  const out: DivergenciaEntreAbas[] = []
  for (const a of abas) {
    if (a.completa) {
      if (a.chaves.join('>') !== unica.join('>')) out.push({ assunto: 'fases', abas: a.aba, chave: 'lista de fases', detalhe: `${a.aba} lista ${a.chaves.length} fase(s) [${a.chaves.join(' → ')}]; a lista única tem ${unica.length} [${unica.join(' → ')}]` })
      continue
    }
    let i = 0
    for (const k of a.chaves) { const j = unica.indexOf(k, i); if (j < 0) { out.push({ assunto: 'fases', abas: a.aba, chave: k, detalhe: `${a.aba} mostra a fase «${k}», que não está na lista única (ou está fora da ordem real)` }); break } i = j + 1 }
  }
  return out
}

export interface EntradaDeContagens {
  fases: Array<{ key: string }>
  processos: Array<{ processoId: number; nivelDeRisco: 'no_ritmo' | 'atencao' | 'parado' | 'critico'; semDono: boolean; faseAtualKey: string | null }>
  /** Funil da Visão geral: por fase. */
  funil: Array<{ key: string; total: number; ritmo: number; atencao: number; parados: number }>
  /** Processos: botões (n por fase) e filtros (por fase). */
  botoes: Array<{ key: string; n: number }>
  filtrosPorFase: Array<{ key: string; todos: number; precisam: number; atencao: number; parados: number }>
  /** Radar: contagens dos botões (todas · precisam · críticas). */
  radar: { todas: number; precisam: number; criticas: number }
  /** Cartão «em risco» da Visão geral e conjunto «processoEmRisco» da aba Tarefas. */
  emRiscoDoCartao: number
  emRiscoDaTarefas: number
}

/** Risco e contagens: cada aba diz o mesmo número que a contagem única. PURA. */
export function compararContagens(e: EntradaDeContagens, contar: (processos: EntradaDeContagens['processos'], fases: Array<{ key: string }>) => { linhas: Array<{ key: string; total: number; noRitmo: number; atencao: number; graves: number; precisam: number }> }, totais: (processos: EntradaDeContagens['processos']) => { total: number; precisam: number; graves: number }): DivergenciaEntreAbas[] {
  const out: DivergenciaEntreAbas[] = []
  const unica = contar(e.processos, e.fases).linhas
  const t = totais(e.processos)
  const dif = (abas: string, chave: string, esperado: number, aba: number, rotulo: string) => { if (esperado !== aba) out.push({ assunto: 'contagem', abas, chave, detalhe: `${rotulo}: a contagem única diz ${esperado}; a aba diz ${aba}` }) }
  for (const u of unica) {
    const f = e.funil.find((x) => x.key === u.key), b = e.botoes.find((x) => x.key === u.key), p = e.filtrosPorFase.find((x) => x.key === u.key)
    if (f) { dif('Visão geral (funil)', u.key, u.total, f.total, 'processos na fase'); dif('Visão geral (funil)', u.key, u.noRitmo, f.ritmo, 'no ritmo'); dif('Visão geral (funil)', u.key, u.atencao, f.atencao, 'atenção'); dif('Visão geral (funil)', u.key, u.graves, f.parados, 'parados ou críticos') }
    if (b) dif('Processos (botão da fase)', u.key, u.total, b.n, 'processos na fase')
    if (p) { dif('Processos (filtros)', u.key, u.total, p.todos, 'todos'); dif('Processos (filtros)', u.key, u.precisam, p.precisam, 'precisam de alguém'); dif('Processos (filtros)', u.key, u.atencao, p.atencao, 'atenção'); dif('Processos (filtros)', u.key, u.graves, p.parados, 'parados ou críticos') }
  }
  dif('Radar (botões)', 'Todas', t.total, e.radar.todas, 'processos'); dif('Radar (botões)', 'Precisam de alguém', t.precisam, e.radar.precisam, 'precisam de alguém'); dif('Radar (botões)', 'Críticas', t.graves, e.radar.criticas, 'críticas (parado ou crítico)')
  dif('Visão geral (cartão «em risco»)', 'em risco', t.graves, e.emRiscoDoCartao, 'processos em risco')
  dif('Tarefas (processos em risco)', 'em risco', t.graves, e.emRiscoDaTarefas, 'processos em risco')
  return out
}

/** Lê o que as abas desenham, a partir das MESMAS linhas, e compara. SOMENTE LEITURA (só SELECT). */
export async function compararAbasDaTorre(agora = new Date()): Promise<DivergenciaEntreAbas[]> {
  const { listarTarefasDaTorre } = await import('@/src/services/torre-tarefas')
  const { processosDaTorre } = await import('./torre-processos')
  const { quadroDaEquipe } = await import('./torre-equipe')
  const { lerFasesDaTorre } = await import('./torre-fases-leitura')
  const { funilDaTorre } = await import('./torre-funil')
  const { opcoesDosFiltros } = await import('./torre-filtros')
  const { linhas } = await listarTarefasDaTorre({}, agora)
  const [{ processos, colunas }, equipe, unica, funil] = await Promise.all([processosDaTorre(agora, linhas), quadroDaEquipe(linhas, agora), lerFasesDaTorre(), funilDaTorre(agora)])
  const chavesUnicas = unica.map((f) => f.key)
  const { contarPorFase, contarTotais } = await import('./torre-contagens')
  const { botoesDeFase, contagensDosFiltros, paraContagem, aplicarPaisRespBusca, TODOS_OS_PAISES: _t } = await import('./torre-fase') as unknown as typeof import('./torre-fase') & { TODOS_OS_PAISES?: string }
  void aplicarPaisRespBusca; void _t
  const { contagensDoRadar } = await import('./torre-radar')
  const { processosCriticos } = await import('./torre-processos')
  const funilLinhas = (await import('./torre-funil-puro')).funilDasFases({ fases: funil.fases, processos: processos as never, linhas: [], escopo: funil.geral })
  const criticos = await processosCriticos(agora)
  const radar = contagensDoRadar(processos)
  const procMin = processos.map((p) => ({ processoId: p.processoId, nivelDeRisco: p.nivelDeRisco, semDono: p.semDono, faseAtualKey: p.faseAtual.key }))
  const colunasFase = unica.map((f) => ({ key: f.key }))
  const tot = (ps: typeof procMin) => { const c = contarTotais(ps); return { total: c.total, precisam: c.precisam, graves: c.graves } }
  const contagens = compararContagens({
    fases: colunasFase, processos: procMin,
    funil: funilLinhas.linhas.map((l) => ({ key: l.key, total: l.total, ritmo: l.ritmo, atencao: l.atencao, parados: l.parados })),
    botoes: botoesDeFase(colunas, processos).map((b) => ({ key: b.key, n: b.n })),
    filtrosPorFase: unica.map((f) => { const c = contagensDosFiltros(processos.filter((p) => p.faseAtual.key === f.key)); return { key: f.key, ...c } }),
    radar: { todas: radar.todas, precisam: radar.precisam, criticas: radar.criticas },
    emRiscoDoCartao: contarTotais(processos.map(paraContagem)).graves,
    emRiscoDaTarefas: criticos.size,
  }, (ps, fs) => contarPorFase(ps, fs), tot)
  const prazos = await prazosAntesDaEntrada()
  const cobrancas = await compararCobrancas(linhas, agora)
  return [
    ...contagens,
    ...cobrancas,
    ...prazos,
    ...compararFases(chavesUnicas, [
      { aba: 'Visão geral (funil)', chaves: funil.fases.map((f) => f.key), completa: true },
      { aba: 'Radar e Processos (colunas)', chaves: colunas.map((c) => c.key), completa: true },
      { aba: 'Tarefas (filtro de fase)', chaves: opcoesDosFiltros(linhas as never).fases, completa: false },
    ]),
    ...compararResponsaveis({
      processos: processos.map((p) => ({ processoId: p.processoId, familiaNome: p.familiaNome, proximaAcao: p.proximaAcao })),
      linhas: linhas.map((l) => ({ processoId: l.processoId ?? null, responsavelId: l.responsavelId, responsavelNome: l.responsavelNome, estadoOperacao: l.estadoOperacao })),
      equipe: equipe.pessoas.map((e) => ({ usuarioId: e.usuarioId, nome: e.nome, ativas: e.ativas })),
      semResponsavelDaEquipe: equipe.semResponsavel.ativas,
    }),
  ]
}

/** Prazo de tarefa aberta, na fase atual do processo, anterior à entrada nela (Item 4). SOMENTE LEITURA. */
export async function prazosAntesDaEntrada(): Promise<DivergenciaEntreAbas[]> {
  const { prisma } = await import('@/lib/prisma')
  const abertas = await prisma.tarefa.findMany({
    where: { dataPrazo: { not: null }, statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] }, processo: { dataConclusao: null } },
    select: { id: true, titulo: true, processoId: true, faseMacroKey: true, dataPrazo: true, processo: { select: { nome: true, faseAtualKey: true } } },
  })
  const naFase = abertas.filter((t) => t.processoId != null && t.faseMacroKey != null && t.faseMacroKey === t.processo?.faseAtualKey)
  const ids = [...new Set(naFase.map((t) => t.processoId as number))]
  const logs = await prisma.phaseAdvanceLog.findMany({ where: { processoId: { in: ids }, resultado: { in: ['MOVIDO', 'AVANCADO', 'FORCADO'] } }, select: { processoId: true, fasePretendida: true, criadoEm: true } })
  const entrada = new Map<string, Date>()
  for (const l of logs) { const k = `${l.processoId}|${l.fasePretendida}`; const a = entrada.get(k); if (!a || l.criadoEm > a) entrada.set(k, l.criadoEm) }
  const out: DivergenciaEntreAbas[] = []
  for (const t of naFase) {
    const e = entrada.get(`${t.processoId}|${t.faseMacroKey}`)
    if (e && t.dataPrazo && t.dataPrazo < e) out.push({ assunto: 'prazo', abas: 'Processos / Tarefas', chave: `${t.processo?.nome ?? t.processoId} · tarefa ${t.id}`, detalhe: `prazo ${t.dataPrazo.toISOString().slice(0, 10)} é anterior à entrada na fase (${e.toISOString().slice(0, 10)}) — «${t.titulo}»` })
  }
  return out
}

/** COBRANÇAS: Visão geral (cartão «Cobranças a fazer») = rótulo da aba Terceiros = Tarefas («Cobrar hoje») = Terceiros («para cobrar») = o botão «Cobrar todos». E nenhuma delas sem pedido enviado. */
export async function compararCobrancas(linhas: Parameters<typeof import('./torre-kpis').numeroDoKpi>[1], agora: Date): Promise<DivergenciaEntreAbas[]> {
  const { numeroDoKpi } = await import('./torre-kpis')
  const { resumoDeTerceiros, idsParaCobrar } = await import('./terceiros-pedidos')
  const { predicadoDaVisao } = await import('./torre-tarefas-tela')
  const out: DivergenciaEntreAbas[] = []
  const visaoGeral = numeroDoKpi('cob', linhas, agora)
  const rotuloDaAba = visaoGeral // o rótulo «N a cobrar» da aba Terceiros lê numeroDoKpi('cob') (Torre.tsx)
  const tarefas = (linhas as Array<{ cobravelVencida?: boolean }>).filter((l) => predicadoDaVisao('cobranca', null, agora)(l as never)).length
  const terceiros = resumoDeTerceiros(linhas as never, agora).paraCobrar
  const botao = idsParaCobrar(linhas as never, agora).length
  const dif = (abas: string, n: number) => { if (n !== visaoGeral) out.push({ assunto: 'cobranca', abas, chave: 'Cobranças a fazer', detalhe: `Visão geral diz ${visaoGeral}; ${abas} diz ${n}` }) }
  dif('Tarefas («Cobrar hoje»)', tarefas); dif('Terceiros («para cobrar»)', terceiros); dif('Terceiros («Cobrar todos os vencidos»)', botao); dif('rótulo da aba Terceiros', rotuloDaAba)
  const semPedido = (linhas as unknown as Array<{ taskId: number; titulo: string; estadoOperacao: string; cobravelVencida?: boolean }>).filter((l) => l.cobravelVencida && l.estadoOperacao !== 'AGUARDANDO')
  for (const l of semPedido) out.push({ assunto: 'cobranca', abas: 'todas', chave: `tarefa ${l.taskId}`, detalhe: `«${l.titulo}» conta como cobrança sem ter pedido enviado ao terceiro` })
  return out
}
