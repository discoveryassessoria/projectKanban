// lib/operacional/atencao-operacional.ts
// ============================================================================
// AS 8 CATEGORIAS DE ATENÇÃO + O RANKING — a regra canônica de "o que Minha
// Operação mostra primeiro", numa peça PURA (sem `prisma`, sem I/O).
//
// Fica separada de `tarefa-projecoes.ts` de propósito: aquele módulo importa
// `@/lib/prisma` no topo, então nenhum símbolo de lá pode entrar num bundle de
// cliente. Esta regra não é nova lógica de negócio — é a MESMA leitura de
// atenção que `central-tarefas.tsx` já fazia como `FILTROS` (client-side,
// sobre os mesmos booleanos canônicos: `emRisco`, `atrasoInterno`,
// `atrasoTerceiro`, `acompanhamentoVencido`, `retornoRecebido`,
// `executavelAgora`, `coluna`, `atribuidaEm`) — só nomeada e reaproveitável
// pelos dois lados (KPI, chip e tabela nunca podem divergir, mandato §43).
// ============================================================================

// CORREÇÃO (15/09/2026) — "Novas atribuições", "Retorno recebido" e "Em
// risco" saíram do quadro de categorias operacionais. Decisão do
// Administrador: "Em risco" em particular NUNCA deveria existir aqui —
// quando o motor não consegue determinar com segurança quem age, o quê, ou
// quando volta à atenção, isso é um problema de CONFIGURAÇÃO do cadastro
// (passo sem previsão/acompanhamento definível), e problema de configuração
// vai para a Saúde do Sistema (EMI-022 já lê o mesmo `motivosRisco`/`emRisco`
// — a leitura continua existindo, só não é mais oferecida como categoria
// operacional aqui). O operador não deve ver "risco" como se fosse dele.
export type CategoriaAtencao =
  | 'paraAgirAgora' | 'acompanharHoje' | 'atrasoInterno'
  | 'terceirosAtrasados' | 'aguardandoTerceiros'

export const CATEGORIAS_ATENCAO: Array<{ chave: CategoriaAtencao; rotulo: string; tooltip: string }> = [
  { chave: 'paraAgirAgora', rotulo: 'Para fazer', tooltip: 'Existe uma ação interna executável por você agora.' },
  { chave: 'acompanharHoje', rotulo: 'Acompanhar hoje', tooltip: 'O próximo acompanhamento programado já venceu.' },
  { chave: 'atrasoInterno', rotulo: 'Atrasadas', tooltip: 'O prazo interno (seu) já passou — não é atraso de terceiro.' },
  { chave: 'terceirosAtrasados', rotulo: 'Terceiros atrasados', tooltip: 'A previsão do terceiro (cartório/tradutor/etc.) já venceu; não é atraso seu.' },
  { chave: 'aguardandoTerceiros', rotulo: 'Aguardando terceiros', tooltip: 'A operação está aberta, esperando uma resposta externa.' },
]

/** O contrato mínimo que a categorização e o ranking precisam — um subconjunto estrutural de `LinhaGerencial`. */
export interface LinhaComAtencao {
  taskId: number
  coluna: string
  dataPrazo: string | null
  atrasada: boolean
  venceHoje: boolean
  executavelAgora: boolean
  atribuidaEm: string | null
  acompanhamentoVencido: boolean
  atrasoInterno: boolean
  atrasoTerceiro: boolean
  retornoRecebido: boolean
  emRisco: boolean

  /**
   * REGRA TEMPORAL DA ESPERA CORRENTE (dimensão C própria da subtarefa,
   * mandato "correção definitiva do modelo temporal", 19-20/09/2026) — irmã
   * de `atrasoTerceiro` (dimensão C da Tarefa/solicitação), nunca a mesma
   * fonte. Vencida ⇒ terceiro atrasado, exatamente como a dimensão C de
   * Tarefa já faz — os dois convivem, OR simples.
   */
  regraTemporalPasso?: { atrasado: boolean } | null

  /**
   * ACOMPANHAMENTO DA ESPERA CORRENTE (dimensão D própria da subtarefa) —
   * irmã de `acompanhamentoVencido` (dimensão D da Tarefa, hoje só manual),
   * nunca a mesma fonte. Vencido OU vence hoje ⇒ acompanhar hoje, mesmo OR
   * simples.
   *
   * `venceHoje` entra aqui de propósito (achado real, 19/09/2026 — mandato
   * "correção definitiva do modelo temporal"): a categoria se CHAMA
   * "Acompanhar hoje" — um acompanhamento cuja DATA-CALENDÁRIO é hoje
   * precisa cair nela mesmo que o horário exato ainda não tenha passado.
   * `venceHoje`/`atrasado` já vêm calculados por dia (não por instante) da
   * régua única (`nucleoTemporal`/`diasEntreDiasOperacionais`, no fuso
   * operacional) — nenhuma conta nova aqui, só os dois lidos juntos.
   */
  acompanhamentoPasso?: { atrasado: boolean; venceHoje: boolean } | null
}

const JANELA_NOVA_ATRIBUICAO_MS = 48 * 3600_000

/**
 * A CLASSIFICAÇÃO OPERACIONAL PRINCIPAL — UMA fila por tarefa, nunca duas
 * (mandato "Minha Operação como fila real", 17/09/2026). `categoriasDaLinha`
 * (abaixo) continua servindo os badges da linha (não-exclusivos, "em risco E
 * terceiro atrasado" cabem os dois) — mas para abrir a tela num número
 * confiável ("Para fazer: 12") e paginar por fila sem contador contraditório,
 * cada tarefa precisa de UMA resposta só, pela mesma precedência que já
 * ordena a atenção (`degrauDeAtencao`, abaixo): atraso interno → terceiro
 * atrasado → acompanhamento devido → ação interna executável agora →
 * aguardando terceiro → demais estados legítimos (concluída, bloqueada por
 * outro motivo etc. — fora das 5 filas nomeadas, mas nunca invisível: entram
 * em "Todas").
 */
export type CategoriaPrincipal = CategoriaAtencao | 'outras'

/**
 * MOTIVOS — os FATOS concorrentes, sempre preservados mesmo quando só UM
 * deles vira a categoria principal (mandato "motor de atenção operacional",
 * 17/09/2026, itens 14/38): "prazo macro venceu" e "prazo do passo venceu"
 * podem ser SIMULTANEAMENTE verdadeiros para a MESMA tarefa — isso nunca é
 * dois trabalhos, é uma tarefa com dois relógios tocando. A categoria
 * principal (abaixo) resolve UMA prioridade pra UI decidir onde a linha
 * mora; `motivos` é o que a linha pode mostrar por baixo, sem inventar uma
 * segunda tarefa nem uma segunda notificação.
 */
export type MotivoAtencao = 'PRAZO_TAREFA_VENCIDO' | 'ACOMPANHAMENTO_DEVIDO' | 'TERCEIRO_ATRASADO'

/** O rótulo de cada motivo — em linguagem de gente, um lugar só (nunca reescrito por tela). */
export const ROTULO_MOTIVO: Record<MotivoAtencao, string> = {
  PRAZO_TAREFA_VENCIDO: 'Prazo final vencido',
  ACOMPANHAMENTO_DEVIDO: 'Acompanhamento devido',
  TERCEIRO_ATRASADO: 'Terceiro atrasado',
}

export function motivosAtivos(l: LinhaComAtencao): MotivoAtencao[] {
  const motivos: MotivoAtencao[] = []
  if (l.atrasada) motivos.push('PRAZO_TAREFA_VENCIDO')
  if (l.acompanhamentoVencido || (l.acompanhamentoPasso?.atrasado || l.acompanhamentoPasso?.venceHoje)) motivos.push('ACOMPANHAMENTO_DEVIDO')
  if (l.atrasoTerceiro || l.regraTemporalPasso?.atrasado) motivos.push('TERCEIRO_ATRASADO')
  return motivos
}

export interface AtencaoOperacional {
  categoriaPrincipal: CategoriaPrincipal
  motivos: MotivoAtencao[]
}

/**
 * A CLASSIFICAÇÃO CENTRAL — RELÓGIOS → CLASSIFICAÇÃO → UMA ATENÇÃO
 * OPERACIONAL. `calcularAtencaoOperacional` é o nome pedido pelo mandato;
 * `classificarAtencaoOperacional` (abaixo) continua existindo porque a
 * maior parte do código só precisa da categoria — a fonte da verdade é a
 * MESMA precedência nos dois.
 */
export function calcularAtencaoOperacional(l: LinhaComAtencao): AtencaoOperacional {
  return { categoriaPrincipal: classificarAtencaoOperacional(l), motivos: motivosAtivos(l) }
}

/**
 * PRECEDÊNCIA (mandato item 13): atraso interno (prazo final da Tarefa) →
 * terceiro atrasado → acompanhamento devido → ação interna executável agora
 * → aguardando terceiro → demais estados legítimos.
 *
 * `regraTemporalPasso`/`acompanhamentoPasso` (19-20/09/2026): dimensões C/D
 * PRÓPRIAS da subtarefa corrente entram nos MESMOS degraus que as dimensões
 * C/D da Tarefa já ocupavam — nunca um degrau novo, só mais uma fonte.
 *
 * A subtarefa NÃO tem relógio de execução próprio (decisão definitiva,
 * 23/09/2026): existia aqui `prazoPasso`, removido por completo — um único
 * prazo final por Tarefa, `atrasoInterno` já o cobre inteiro.
 */
export function classificarAtencaoOperacional(l: LinhaComAtencao): CategoriaPrincipal {
  if (l.atrasoInterno) return 'atrasoInterno'
  if (l.atrasoTerceiro || l.regraTemporalPasso?.atrasado) return 'terceirosAtrasados'
  if (l.acompanhamentoVencido || (l.acompanhamentoPasso?.atrasado || l.acompanhamentoPasso?.venceHoje)) return 'acompanharHoje'
  if (l.executavelAgora && (l.coluna === 'A_FAZER' || l.coluna === 'EM_ANDAMENTO')) return 'paraAgirAgora'
  if (l.coluna === 'AGUARDANDO_TERCEIRO') return 'aguardandoTerceiros'
  return 'outras'
}

/** As categorias que esta linha pertence — NÃO exclusivas (uma linha pode estar em risco E com terceiro atrasado). Uso: badges da linha, nunca contador de fila. */
export function categoriasDaLinha(l: LinhaComAtencao): CategoriaAtencao[] {
  const cats: CategoriaAtencao[] = []
  if (l.executavelAgora && (l.coluna === 'A_FAZER' || l.coluna === 'EM_ANDAMENTO')) cats.push('paraAgirAgora')
  if (l.acompanhamentoVencido || (l.acompanhamentoPasso?.atrasado || l.acompanhamentoPasso?.venceHoje)) cats.push('acompanharHoje')
  if (l.atrasoInterno) cats.push('atrasoInterno')
  if (l.atrasoTerceiro || l.regraTemporalPasso?.atrasado) cats.push('terceirosAtrasados')
  if (l.coluna === 'AGUARDANDO_TERCEIRO') cats.push('aguardandoTerceiros')
  return cats
}

/**
 * O DEGRAU DE ATENÇÃO — determinístico, excludente, nesta ordem (mandato
 * "Minha Operação" §78): atraso interno crítico (atrasada + a causa é
 * interna) → atraso interno → follow-up vencido → retorno recebido → ação
 * necessária hoje → nova atribuição → aguardando terceiro → demais.
 *
 * "Em risco" NÃO é mais um degrau — não é prioridade operacional da
 * Daniela, é sinal de configuração (Saúde do Sistema, EMI-022).
 */
function degrauDeAtencao(l: LinhaComAtencao): number {
  if (l.atrasada && l.atrasoInterno) return 0
  if (l.atrasoInterno) return 1
  if (l.acompanhamentoVencido || (l.acompanhamentoPasso?.atrasado || l.acompanhamentoPasso?.venceHoje)) return 2
  if (l.retornoRecebido) return 3
  if (l.venceHoje && l.executavelAgora) return 4
  if (l.coluna === 'A_FAZER' && l.atribuidaEm != null && Date.now() - new Date(l.atribuidaEm).getTime() <= JANELA_NOVA_ATRIBUICAO_MS) return 5
  if (l.coluna === 'AGUARDANDO_TERCEIRO') return 6
  return 7
}

/**
 * O RÓTULO DE ATENÇÃO DA LINHA — a primeira coluna da tabela (mandato §14).
 * Deriva SEMPRE dos mesmos booleanos canônicos do ranking — nunca uma
 * prioridade paralela: se `prioridade` (campo canônico da Tarefa) já é
 * URGENTE, ela aparece; o resto é leitura operacional (atraso/risco/hoje),
 * não um segundo campo de prioridade inventado pela UI.
 */
export function rotuloDeAtencao(l: LinhaComAtencao & { prioridade: string }): { rotulo: string; tom: 'critico' | 'alerta' | 'neutro' } {
  if (l.atrasada && l.atrasoInterno) return { rotulo: 'Crítico', tom: 'critico' }
  if (l.atrasoInterno) return { rotulo: 'Atrasado', tom: 'critico' }
  if (l.acompanhamentoVencido || (l.acompanhamentoPasso?.atrasado || l.acompanhamentoPasso?.venceHoje) || l.retornoRecebido) return { rotulo: 'Atenção', tom: 'alerta' }
  if (l.venceHoje && l.executavelAgora) return { rotulo: 'Hoje', tom: 'alerta' }
  if (l.prioridade === 'URGENTE') return { rotulo: 'Urgente', tom: 'alerta' }
  if (l.coluna === 'AGUARDANDO_TERCEIRO') return { rotulo: 'Aguardando', tom: 'neutro' }
  return { rotulo: 'Normal', tom: 'neutro' }
}

/**
 * HUMANIZAÇÃO DE MOTIVO DE RISCO — mandato "Minha Operação" §16-18.
 *
 * `motivosRisco` (de `computarProximoAcontecimento`, `proximo-acontecimento.ts`)
 * é diagnóstico técnico: o código é estável e às vezes carrega detalhe bruto
 * depois de ":" (ex. `CONFLITO_PRAZO_TAREFA_PASSO: Tarefa.dataPrazo=... ×
 * PhaseWorkflowStepInstance.prazo=...`). Isso é correto para auditoria/Saúde
 * do Sistema — NUNCA para a Daniela. Esta função é a ÚNICA tradução para
 * linguagem operacional; o código técnico continua disponível (chamador
 * decide se mostra, ex. um tooltip administrativo), nunca é apagado.
 */
const HUMANIZACAO_RISCO: Record<string, string> = {
  CONFLITO_PRAZO_TAREFA_PASSO: 'Conflito de prazo: o prazo do passo atual diverge do prazo geral desta operação.',
  CONFLITO_RETORNO_TERCEIRO: 'O último contato registra retorno recebido, mas o pedido formal ainda não foi confirmado como respondido — divergência entre as duas fontes.',
  RETORNO_SEM_ACAO_INTERNA: 'O terceiro respondeu, mas a operação continua marcada como em espera.',
  AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO: 'Esta operação está aguardando terceiro sem previsão de retorno nem próximo acompanhamento definidos.',
  ACOMPANHAMENTO_VENCIDO: 'O próximo acompanhamento programado já venceu.',
  SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL: 'Não foi possível determinar o que acontece a seguir nesta operação.',
  SEM_RESPONSAVEL_PARA_PROXIMA_ACAO: 'Esta operação não possui responsável definido para agir.',
}

export function humanizarMotivoRisco(motivo: string): { texto: string; codigo: string } {
  const codigo = motivo.split(':')[0]?.trim() ?? motivo
  return { texto: HUMANIZACAO_RISCO[codigo] ?? 'Não foi possível determinar a próxima ação desta operação com segurança.', codigo }
}

/** A ordem que a operação olha primeiro — dentro do mesmo degrau, prazo mais próximo, depois `taskId` (determinístico). */
export function ordenarPorAtencaoOperacional<T extends LinhaComAtencao>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const d = degrauDeAtencao(a) - degrauDeAtencao(b)
    if (d !== 0) return d
    const pa = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
    const pb = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    return a.taskId - b.taskId
  })
}
