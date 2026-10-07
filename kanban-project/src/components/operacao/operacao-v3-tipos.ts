// src/components/operacao/operacao-v3-tipos.ts
// ============================================================================
// ETAPA 3 — TELA OPERAÇÃO, TIPOS.
//
// Espelho do que `/api/operacao/tarefas` devolve (LinhaGerencial, serializado
// em JSON — datas viram string). Campo por campo, nunca `any`: uma divergência
// de nome aqui é um bug silencioso na tela inteira.
// ============================================================================

export type EstadoOperacao = "FILA" | "AGUARDANDO" | "CONCLUIDA"

export interface EstadoTemporalApi {
  dueAt: string | null
  diasParaPrazo: number | null
  atrasado: boolean
  atrasadoHaDias: number | null
  venceHoje: boolean
  venceAmanha: boolean
  semPrazo: boolean
}

export interface LinhaOperacaoV3 {
  taskId: number
  titulo: string
  documentoId: number | null
  processoId: number | null
  processoNome: string | null
  pais: string | null
  familiaNome: string | null
  pessoaId: number | null
  pessoaNome: string | null
  numeroLinhagem: number | null
  linhaReta: boolean | null
  /** A GERAÇÃO de verdade (G1 = ancestral que origina o direito) — o "G" da tela e a chave da regra fixa de ordem. NÃO é `numeroLinhagem`. */
  geracao: number | null
  /** Data de nascimento da pessoa (ISO) — a ordem de nascimento da regra fixa. */
  pessoaNascimento: string | null
  /** Os dois nomes, quando a obrigação é de uma UNIÃO (certidão de casamento) — "Fulano e Fulana". `null` para obrigação de pessoa. */
  casalNomes: string | null
  /** O cônjuge (quando a obrigação é de UNIÃO) — "com <cônjuge>". `pessoaId`/`pessoaNome` já são os da pessoa da linha reta. */
  conjugeNome: string | null
  /** A tarefa é de uma fase ANTERIOR à fase atual do processo — só então o selo "Fase anterior" é correto. */
  faseAnteriorAFaseAtual: boolean
  /** Rótulo canônico da fase atual do processo — "Genealogia", nunca "genealogia". */
  faseAtualDoProcessoLabel: string | null
  /** Rótulo da PRÓXIMA fase do caminho do processo — a fase seguinte do Workflow Macro dele (tipo + modalidade),
   *  pulando as condicionais que a Análise não pediu (`proximaFaseDoCaminho`, `tarefa-projecoes.ts`). `null` na
   *  última fase: a aba Famílias omite o "Próximo marco". Opcional só para fixtures de tela antigas. */
  proximaFaseDoProcessoLabel?: string | null
  categoriaDoc: "NASCIMENTO" | "CASAMENTO" | "OBITO" | null
  origem: string | null
  faseMacroKey: string | null
  etapaAtual: string | null
  statusTarefa: string
  equipeKey: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prioridade: string
  dataPrazo: string | null
  atrasada: boolean
  rotuloDoPrazo: string
  diasParaPrazo: number | null
  aguardandoDependencia: boolean
  requerDecisao: boolean
  executavelAgora: boolean
  terceiroNome: string | null
  /** O cartório digitado (texto livre) quando NÃO há órgão vinculado — a coluna Órgão mostra "<texto> · não vinculado". */
  cartorioTexto: string | null
  terceiroEmail: string | null
  terceiroTelefone: string | null
  servico: string | null
  criadaEm: string | null
  atribuidaEm: string | null
  passoAtual: { ordem: number; total: number } | null
  /** Aguardando o cartório: quando o requerimento foi enviado, quem o enviou e o lembrete de cobrança (pedido + prazo do passo). */
  pedidoEnviadoEm?: string | null
  pedidoPorId?: number | null
  lembreteDeCobrancaEm?: string | null
  regraTemporalPasso: EstadoTemporalApi | null
  acompanhamentoPasso: EstadoTemporalApi | null
  emRisco: boolean
  motivosRisco: string[]
  atrasoInterno: boolean
  atrasoTerceiro: boolean
  acompanhamentoVencido: boolean
  retornoRecebido: boolean
  proximoAcontecimento: { tipo: string; data: string | null; descricao: string } | null
  escalada: boolean
  totalCobrancas: number
  estadoOperacao: EstadoOperacao
  aIniciar: boolean
  passoCorrente: { chave: string; label: string } | null
  // LinhaGerencial (soma sobre LinhaDeFila):
  venceHoje: boolean
  coluna: string
  esperandoDe: "terceiro" | "cliente" | null
  esperandoDesde: string | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
  concluidaEm: string | null
}

export interface RespostaTarefas {
  visao: string
  total: number
  linhas: LinhaOperacaoV3[]
}

export type Vista = "minha" | "es" | "it" | "urg"
export type AgruparFilaPor = "pessoa" | "orgao" | "passo"
export type AgruparAguardPor = "familia" | "orgao"
export type FiltroRadar = "noorg" | "faseant" | null
export type FiltroQuick = "atrasadas" | "escaladas" | "vencidos" | null
