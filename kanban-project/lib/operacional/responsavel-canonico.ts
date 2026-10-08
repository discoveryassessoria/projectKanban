// lib/operacional/responsavel-canonico.ts
// ============================================================================
// UMA LEITURA DE RESPONSÁVEL PARA A TORRE INTEIRA (07/10/2026). A fonte é `Tarefa.responsavelId` (memória «ownership canônico»); o que faltava era a AGREGAÇÃO por
// processo: a aba Processos mostrava o nome de UMA tarefa (a «representativa») como se fosse o responsável das 20 certidões — com donos mistos (17 Daniela + 3 Marco)
// o nome único mentia. Aqui o processo devolve QUEM tem quantas tarefas abertas e quantas estão sem dono; Processos, Radar, filtros e vigia leem DAQUI.
// Tarefa aberta, vencida ou sem responsável NUNCA é erro: é só estado.
// ============================================================================

export interface LinhaComDono {
  responsavelId: number | null
  responsavelNome: string | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
}

export interface DonoNoProcesso { id: number; nome: string; n: number }
export interface ResponsaveisDoProcesso {
  /** Quem tem tarefa aberta, do maior para o menor (empate: nome). */
  donos: DonoNoProcesso[]
  /** Tarefas abertas SEM responsável. */
  semDono: number
  /** Tarefas abertas consideradas. */
  abertas: number
  /** O texto da célula: «Daniela Brait» · «Daniela Brait (17) · Marco Rovatti (3)» · «Sem responsável». */
  texto: string
}

export const SEM_RESPONSAVEL_TEXTO = 'Sem responsável'

/** O dono de UMA tarefa — a única maneira de ler «de quem é» uma linha. */
export const responsavelDaTarefa = (l: Pick<LinhaComDono, 'responsavelId' | 'responsavelNome'>): { id: number; nome: string } | null =>
  l.responsavelId != null ? { id: l.responsavelId, nome: l.responsavelNome ?? `Pessoa #${l.responsavelId}` } : null

/** Os donos das tarefas ABERTAS (as concluídas não contam). */
export function responsaveisDoProcesso(linhas: ReadonlyArray<LinhaComDono>): ResponsaveisDoProcesso {
  const abertas = linhas.filter((l) => l.estadoOperacao !== 'CONCLUIDA')
  const por = new Map<number, DonoNoProcesso>()
  let semDono = 0
  for (const l of abertas) {
    const d = responsavelDaTarefa(l)
    if (!d) { semDono++; continue }
    const atual = por.get(d.id)
    if (atual) atual.n++
    else por.set(d.id, { id: d.id, nome: d.nome, n: 1 })
  }
  const donos = [...por.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR'))
  const partes = donos.map((d) => (donos.length === 1 && semDono === 0 ? d.nome : `${d.nome} (${d.n})`))
  if (semDono > 0 && donos.length > 0) partes.push(`${SEM_RESPONSAVEL_TEXTO.toLowerCase()} (${semDono})`)
  return { donos, semDono, abertas: abertas.length, texto: partes.length ? partes.join(' · ') : SEM_RESPONSAVEL_TEXTO }
}

/** O processo tem tarefa aberta SEM dono? (o único lugar que decide «sem responsável» de um processo) */
export const processoTemSemDono = (r: ResponsaveisDoProcesso): boolean => r.semDono > 0 || r.donos.length === 0
/** Tem tarefa aberta de `nome`? (o filtro «Responsável» da aba Processos) */
export const processoTemDono = (r: ResponsaveisDoProcesso, nome: string): boolean => r.donos.some((d) => d.nome === nome)
