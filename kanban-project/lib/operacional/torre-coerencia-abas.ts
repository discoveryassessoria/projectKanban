// lib/operacional/torre-coerencia-abas.ts
// ============================================================================
// O VIGIA DAS ABAS DA TORRE (07/10/2026 — CLAUDE.md §41, regra n). Cada dado que a Torre mostra vem de UMA função no servidor; as abas só desenham. Este módulo LÊ o que
// cada aba vai desenhar — a partir das MESMAS linhas — e acusa qualquer divergência entre elas. SOMENTE LEITURA.
//   • responsável: Processos (donos por processo) × Equipe (carga por pessoa) × Tarefas (linhas abertas por dono) — mesmo número por pessoa e por «sem responsável».
// (Os itens seguintes do mandato acrescentam fases, risco e contagens aqui, no mesmo comparador.)
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

/** Lê o que as abas desenham, a partir das MESMAS linhas, e compara. SOMENTE LEITURA (só SELECT). */
export async function compararAbasDaTorre(agora = new Date()): Promise<DivergenciaEntreAbas[]> {
  const { listarTarefasDaTorre } = await import('@/src/services/torre-tarefas')
  const { processosDaTorre } = await import('./torre-processos')
  const { quadroDaEquipe } = await import('./torre-equipe')
  const { linhas } = await listarTarefasDaTorre({}, agora)
  const [{ processos }, equipe] = await Promise.all([processosDaTorre(agora, linhas), quadroDaEquipe(linhas, agora)])
  return [
    ...compararResponsaveis({
      processos: processos.map((p) => ({ processoId: p.processoId, familiaNome: p.familiaNome, proximaAcao: p.proximaAcao })),
      linhas: linhas.map((l) => ({ processoId: l.processoId ?? null, responsavelId: l.responsavelId, responsavelNome: l.responsavelNome, estadoOperacao: l.estadoOperacao })),
      equipe: equipe.pessoas.map((e) => ({ usuarioId: e.usuarioId, nome: e.nome, ativas: e.ativas })),
      semResponsavelDaEquipe: equipe.semResponsavel.ativas,
    }),
  ]
}
