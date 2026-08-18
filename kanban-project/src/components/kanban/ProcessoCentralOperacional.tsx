// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import { useJsonLocalStorage } from "@/src/lib/cliente"
import { Loader2, Eye, ArrowLeft } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { useAmbiente } from "@/src/contexts/ambiente-context"
import type { ProcessoWithStatus, Processo, OperationalProjection } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowMacroTrilha, ResumoDoProcesso, PROCESS_PHASES } from "./WorkflowMacroTrilha"
import { PainelDaFase, type FaseKpi } from "./PainelDaFase"
// ESTRUTURA OPERACIONAL — contrato oficial da Central (pessoa → documento →
// workflow do documento → passos). Vem pronta do backend; a tela não reagrupa.
import type { DocumentoDoIndice, IndiceOperacional } from "@/src/lib/process-stage/estrutura-operacional-core"
import { ProcessoAnalise } from "./ProcessoAnalise"
import { ProcessoTraducao } from "./ProcessoTraducao"
import { ProcessoFaseGenerica } from "./ProcessoFaseGenerica"
import { ProcessoApostilamento } from "./ProcessoApostilamento"
import { ProcessoFaseFinal } from "./ProcessoFaseFinal"
import { ProcessoRetificacao } from "./ProcessoRetificacao"
import { ProcessoEmissaoRetificada } from "./ProcessoEmissaoRetificada"
import { RetornarFaseButton } from "./RetornarFaseButton"
import { TarefaTransversalModal } from "./TarefaTransversalModal"
import type { FaseCode } from "@prisma/client"

// Metadados de uma fase materializada (espelho de /api/processos/[id]/phases).
// Operação Antecipada vinculada a uma necessidade (exibida inline no documento).
export interface OpAntecipada {
  id: number
  publicCode: string | null
  necessidadeId: number | null
  status: string
  operationType: string
  targetOperationId: number | null
  originPhaseCode: string | null
  targetPhaseCode: string | null
  objetivo: string | null
  resultadoObtido: string | null
  targetTipoDocumentoId?: number | null
  responsavel?: { id: number; nome: string | null } | null
  operacao: { statusRaw: string; statusLabel: string; concluida: boolean; uiRef: { kind: string; id: number | null; necessidadeId?: number | null } }
  aguardandoAvaliacao: boolean
  vinculavel: boolean
  encerrada: boolean
}

export interface PhaseMeta {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  state: "ACTIVE" | "COMPLETED" | "FUTURE"
  materialized: boolean
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
}
import { FASES, phaseKeyToFaseCode, faseCodeToPhaseKey } from "@/src/lib/process-stage/fases-catalog"

// Mapa label → phaseKey (a trilha emite o LABEL exato do catálogo).
const LABEL_TO_PHASEKEY: Record<string, string> = Object.fromEntries(
  Object.values(FASES).map((f) => [f.label, f.phaseKey]),
)

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

interface MatrixByPerson {
  pessoaId: number
  nome: string
  generation: number
  completed: number
  total: number
  percentage: number
}

interface MatrixMissing {
  docId: number
  pessoaId: number
  pessoaNome: string
  docType: string
  status: string
  generation: number
}

// ROSTER OFICIAL de pessoas do processo — espelho de central-operacional-core.
// Vem do vínculo Pessoa.arvoreId = Processo.arvoreId; NÃO é derivado da fila.
interface PessoaDoProcessoUI {
  pessoaId: number
  publicCode: string | null
  nome: string
  iniciais: string
  requerente: boolean
  linhaReta: boolean
  classificacao: "LINHA_PRINCIPAL" | "FORA_DA_LINHAGEM" | "PENDENTE_CLASSIFICACAO"
  geracao: number | null
  posicao: string
  pendencia: string | null
}

// ✅ NOVO: espelho do bloco faseProgress da rota (estado REAL dos passos).
interface FaseProgress {
  faseCode: string | null
  kind: "documento" | "processo"
  steps: Array<{
    ordem: number
    stepKey: string
    title: string
    status: "concluida" | "em_andamento" | "bloqueada" | "pendente"
    concluidos: number
    total: number
  }>
  docsNaFase: number
  counts: {
    solicitados: number
    aguardando: number
    recebidos: number
    conferidos: number
    validados: number
  }
}

interface CentralOpData {
  // Modo + contexto da fase consultada (Central unificada). ausente ⇒ ACTIVE (retrocompat).
  mode?: "ACTIVE" | "PAST_READ_ONLY"
  phaseContext?: { faseCode: string | null; faseMacroKey: string | null; workflowInstanceId: number | null; ciclo: number | null }
  // Projeção operacional oficial (fonte única do percentual/estado da fase).
  projection?: OperationalProjection | null
  // ESTADO REAL da materialização da fase, quando o servidor precisou convergi-la
  // nesta leitura. É o que impede a tela de traduzir "não materializou" como
  // "não há regra documental configurada" — duas coisas diferentes.
  materializacao?: {
    estado: string
    mensagemAdministrativa: string | null
    motivos: Array<{ code: string; message: string }>
    workflowInstanceId: number | null
    ciclo: number | null
    passos: number
  } | null
  matrix: {
    percentage: number
    completed: number
    total: number
    directPeopleCount: number
    missingCount: number
    nameVariationsCount: number
    byPerson: MatrixByPerson[]
    missing: MatrixMissing[]
  }
  cards: {
    all: number
    pending: number
    overdue: number
    critical: number
    waiting: number
    blocked: number
    noOwner: number
    followup: number
    stale: number
  }
  queue: Array<{
    docId: number
    pessoaId?: number
    pessoaNome: string
    docType: string
    docTypeLabel: string
    status: string
    statusRaw: string
    responsavelNome: string | null
    prazo: string | null
    diasParaPrazo: number | null
    motivoBloqueio: string | null
    ultimaMovimentacao: string | null
    isCritical: boolean
    isOverdue: boolean
    isBlocked: boolean
    noOwner: boolean
    proximoPasso: string | null
    generation: number
    isLinhaReta: boolean
    necessidadeId?: number | null
    responsavelId?: number | null
  }>
  queueTitle: string
  // Pessoas do processo (fonte oficial) e ESTRUTURA da fase — as instâncias oficiais
  // já organizadas na hierarquia em que são executadas.
  pessoas?: PessoaDoProcessoUI[]
  indice?: IndiceOperacional
  faseProgress?: FaseProgress // ✅ NOVO (opcional: fallback cobre ausência)
  // LEGADO_INATIVO (desativação Genealogia): flag+mensagem de reestruturação.
  genealogiaReestruturacao?: boolean
  mensagemReestruturacao?: string | null
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

/** O cabeçalho de sessão — mesmo padrão das demais chamadas da tela. */
const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

/**
 * A TAREFA PERDEU A CAUSA — e alguém precisa decidir o que fazer com ela.
 *
 * O reconciliador marca e para, porque cancelar trabalho já feito não é decisão
 * de motor. Só que marcar sem oferecer saída deixava a fila pedindo uma decisão
 * que nenhuma tela aceitava: o cartão dizia "Requer decisão" e não havia o que
 * clicar.
 *
 * As duas saídas são as do domínio, e nenhuma é nova: ENCERRAR (a obrigação
 * sumiu e o trabalho sumiu com ela) ou MANTER (a obrigação sumiu, o trabalho
 * continua valendo). A justificativa é obrigatória nas duas: quem ler o
 * histórico daqui a seis meses precisa entender por quê.
 */
function DecisaoSobreCausa({
  taskId, titulo, motivo, podeDecidir, aoDecidir,
}: {
  taskId: number
  titulo: string
  motivo: string | null
  podeDecidir: boolean
  aoDecidir: (decisao: "MANTER" | "ENCERRAR") => void
}) {
  const [justificativa, setJustificativa] = useState("")
  const [enviando, setEnviando] = useState<"MANTER" | "ENCERRAR" | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const decidir = async (decisao: "MANTER" | "ENCERRAR") => {
    if (!justificativa.trim()) { setErro("Explique a decisão — ela fica no histórico da tarefa."); return }
    setEnviando(decisao)
    setErro(null)
    try {
      const r = await fetch(`/api/tarefas/${taskId}/comando`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "decidir_causa", decisao, motivo: justificativa.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(d?.mensagem || d?.error || "Não foi possível registrar a decisão."); return }
      aoDecidir(decisao)
    } catch {
      setErro("Não foi possível registrar a decisão.")
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-[#d2a948]/30 bg-[#d2a948]/10 p-4">
      <div className="text-sm font-semibold text-[#d2a948]">Esta tarefa perdeu a causa · requer decisão</div>
      <p className="mt-1 text-xs text-white/70">
        <span className="text-white/90">{titulo}</span>
        {motivo ? ` — ${motivo}` : ""}
      </p>
      <p className="mt-1 text-xs text-white/55">
        O trabalho já iniciado foi preservado: nada foi cancelado automaticamente.
        Encerrar retira a tarefa da fila; manter devolve o trabalho a quem o executa.
      </p>
      {podeDecidir ? (
        <>
          <textarea
            value={justificativa}
            onChange={(e) => { setJustificativa(e.target.value); setErro(null) }}
            rows={2}
            maxLength={300}
            placeholder="Por quê? (obrigatório — fica no histórico)"
            className="mt-3 w-full resize-none rounded-md border border-white/15 bg-black/30 px-3 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decidir("MANTER")}
              disabled={enviando !== null}
              className="rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/85 hover:bg-white/15 disabled:opacity-50"
            >
              {enviando === "MANTER" ? "Registrando…" : "Manter o trabalho"}
            </button>
            <button
              type="button"
              onClick={() => decidir("ENCERRAR")}
              disabled={enviando !== null}
              className="rounded-md border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-50"
            >
              {enviando === "ENCERRAR" ? "Encerrando…" : "Encerrar a tarefa"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-white/45">
          Você não tem permissão para decidir sobre esta tarefa. Procure quem responde pela fila.
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
    </div>
  )
}

interface ProcessoCentralOperacionalProps {
  processo: ProcessoWithStatus | Processo
  /**
   * DEEP-LINK: a tarefa que trouxe o usuário até aqui.
   *
   * A Central é um índice — com quinze certidões, chegar por um link e ter de
   * procurar qual delas anula o propósito do link. Com isto preenchido, a
   * pessoa dela abre, a linha recebe realce e o painel de operação abre
   * sozinho, no documento certo.
   *
   * A resolução acontece no SERVIDOR (`/navegacao`): a URL é do usuário, e
   * trocar um número nela não pode virar chave de outro processo.
   */
  taskIdAlvo?: number | null
  /** Chamado quando a fase ATIVA do processo muda aqui (ex.: retorno de fase),
   *  para o container (modal) invalidar Header/Drawer/Kanban. */
  onProcessoMudou?: () => void
}

// ============================================================
// Mapeia o data da rota central-operacional -> props do PainelDaFase
// ============================================================

function statusParaCls(statusLabel: string): string {
  const s = statusLabel.toLowerCase()
  // Genealogia V2: "Registro localizado" = concluído (verde, conta no progresso).
  if (s.includes("recebid") || s.includes("entregue") || s.includes("validad") || s.includes("localizado")) return "recebido"
  if (s.includes("a localizar")) return "pendente"
  if (s.includes("solicit")) return "solicitado"
  if (s.includes("busca")) return "em_busca"
  if (s.includes("invál") || s.includes("inval") || s.includes("não enc") || s.includes("nao enc")) return "bloqueado"
  if (s.includes("pendente")) return "pendente"
  return "pendente"
}

function abreviar(tipo: string): string {
  if (tipo.includes("NASCIMENTO")) return "Nasc."
  if (tipo.includes("CASAMENTO")) return "Cas."
  if (tipo.includes("OBITO")) return "Óbito"
  return "Doc."
}

function mapearPainel(data: CentralOpData, faseNome: string) {
  const matrix = data.matrix
  const resumo = data.indice?.resumo ?? null

  const total = matrix.total
  const validados = matrix.completed

  // ============================================================
  // RESUMO AGREGADO DA FASE
  // ------------------------------------------------------------
  // Os contadores saem do MESMO resumo que o índice abaixo — contador e lista têm
  // uma fonte só, então não podem divergir. Nenhum deles conta elementos
  // renderizados, e nenhum expõe detalhe interno do workflow.
  //
  // O PERCENTUAL da fase continua sendo o da PROJEÇÃO OPERACIONAL CANÔNICA
  // (matrix.percentage) — a mesma do Kanban, do Header e do gate de avanço. Um
  // segundo percentual calculado aqui seria uma segunda fonte de verdade.
  // ============================================================
  const kpis: FaseKpi[] = resumo
    ? [
        { label: "Pessoas", value: resumo.pessoasComTrabalho },
        { label: "Documentos", value: resumo.documentos },
        { label: "Prontos", value: resumo.prontos, tone: "ok" },
        { label: "Pendentes", value: resumo.pendentes, tone: "busca" },
        { label: "Divergentes", value: resumo.divergentes, tone: "late" },
      ]
    : // Janela de deploy (back sem `estrutura`): números da matriz oficial, sem
      // inventar um agregado paralelo.
      [
        { label: "Obrigatórios", value: total },
        { label: "Validados", value: validados, tone: "ok" },
      ]

  const pct = matrix.percentage
  // "Faltam 0 documentos" não é informação — é um contador falando sozinho. Com
  // denominador zero a fase não tem documento configurado, e é ISSO que o operador
  // precisa ler: o trabalho não começou porque não há o que exigir, e o caminho
  // para resolver é a Matriz Documental, não esta tela.
  // Quando o servidor reporta o ESTADO da materialização, ele é a explicação — e
  // ganha da frase genérica. "Nenhum documento configurado" só é verdade quando a
  // configuração é mesmo o que falta; falta de árvore, workflow não publicado ou
  // tipo documental sem vínculo no Documento Mestre são outras coisas, e o operador
  // não consegue agir enquanto a tela chamar todas elas pelo mesmo nome.
  const explicacaoMaterializacao =
    data.materializacao && data.materializacao.estado !== "MATERIALIZADO"
      ? data.materializacao.mensagemAdministrativa
      : null

  const progressoTexto =
    total === 0
      ? (explicacaoMaterializacao
        ?? `Nenhum documento obrigatório configurado para a ${faseNome}. Defina as regras em Gerenciamento › Documentos e Protocolos › Matriz Documental.`)
      : validados >= total
        ? `${faseNome} concluída — todos os documentos validados.`
        : `Solicite, receba, confira e valide cada certidão. Falta${total - validados === 1 ? "" : "m"} ${total - validados} documento${total - validados === 1 ? "" : "s"} para concluir a ${faseNome}.`

  return { kpis, pct, validados, total, progressoTexto }
}

// Back sem `indice` (janela de deploy): a tela renderiza o índice VAZIO, que diz que
// não há trabalho materializado — nunca uma lista montada de outra fonte.
const INDICE_VAZIO: IndiceOperacional = {
  resumo: { documentos: 0, prontos: 0, pendentes: 0, divergentes: 0, pessoasComTrabalho: 0 },
  linhaPrincipal: [], foraDaLinha: [], pendenteClassificacao: [], semDono: [],
}

const FASE_META: Record<string, { sub: string; tabs: string[] }> = {
  "Genealogia": { sub: "Crie a árvore, defina a linha reta e localize os documentos obrigatórios.", tabs: ["Resumo", "Árvore", "Linha reta", "Documentos gerados", "Busca documental", "Histórico"] },
  "Emissão documental": { sub: "Solicite, receba, confira e valide as certidões nos cartórios.", tabs: ["Resumo", "Documentos", "Solicitações", "Recebimentos", "Validações", "Histórico"] },
  "Análise Documental": { sub: "Compare a árvore com os documentos, avalie divergências e decida o caminho.", tabs: ["Resumo", "Divergências", "Documentos comparados", "IA & Revisão", "Decisões", "Pareceres", "Histórico"] },
  "Retificação de registros": { sub: "Execute a retificação judicial ou administrativa dos registros divergentes.", tabs: ["Resumo", "Pacotes de retificação", "Judicial / Administrativo", "Anexos", "Decisões", "Histórico"] },
  "Emissão documental retificada": { sub: "Emita novamente apenas os documentos impactados pela retificação.", tabs: ["Resumo", "Averbações", "Certidões retificadas", "Solicitações", "Validações", "Histórico"] },
  "Tradução juramentada": { sub: "Traduza a pasta documental por tradutor juramentado e valide as traduções.", tabs: ["Resumo", "Documentos", "Traduções", "Validações", "IA & Revisão", "Decisões", "Histórico"] },
  "Apostilamento": { sub: "Apostile (Haia) os documentos finais e valide a pasta apostilada.", tabs: ["Resumo", "Pasta de apostilamento", "Documentos apostilados", "Conferência", "Validações", "Histórico"] },
  "Aguardando protocolo": { sub: "Reúna o dossiê final e protocole o pedido no órgão de destino.", tabs: ["Resumo", "Pasta final", "Previsão", "Movimentações", "Protocolo", "Histórico"] },
  "Protocolado": { sub: "Acompanhe o pedido protocolado e registre a decisão do órgão.", tabs: ["Resumo", "Dados do protocolo", "Exigências", "Movimentações", "Decisões", "Histórico"] },
  "Finalizado": { sub: "Confirme o reconhecimento, entregue ao cliente e arquive o processo.", tabs: ["Resumo", "Resultado final", "Entregáveis", "Auditoria", "Arquivos finais", "Histórico"] },
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

const SEM_PHASES: PhaseMeta[] = []

export function ProcessoCentralOperacional({
  processo,
  onProcessoMudou,
  taskIdAlvo = null,
}: ProcessoCentralOperacionalProps) {
  const { pode } = usePermissoes()

  // Ambiente visual: abrir/estar num processo é a FONTE mais confiável do país.
  // Mantém o país ao navegar entre as abas do processo (Central/Documentos/Árvore/
  // Financeiro do Processo). Só decora o fundo — não altera layout/dados.
  const { entrarNoProcesso } = useAmbiente()
  useEffect(() => {
    const p = processo as { id: number; pais?: string | null; codigo?: string | null; nome?: string | null; faseAtualKey?: string | null }
    entrarNoProcesso({ processoId: p.id, pais: p.pais ?? null, codigo: p.codigo ?? null, familia: p.nome ?? null, fase: p.faseAtualKey ?? null })
  }, [processo, entrarNoProcesso])
  // Central da fase ATIVA, pela camada oficial. O usuário entra na chave porque a fila
  // é priorizada para ele.
  const userIdAtual = useJsonLocalStorage<{ id?: number }>("user")?.id ?? null
  const chaveAtiva = (() => {
    const params = new URLSearchParams({ queue: "all", sort: "priority" })
    if (userIdAtual) params.set("userId", String(userIdAtual))
    return `/api/processos/${processo.id}/central-operacional?${params.toString()}`
  })()
  const centralReq = useApi<CentralOpData>(chaveAtiva)
  // A projeção otimista ("Atualizando…") é escrita no cache, não num estado paralelo.
  const data = centralReq.dados ?? null
  const loading = centralReq.carregando
  const refreshing = centralReq.revalidando && !centralReq.carregando
  const [erroLocal, setErro] = useState<string | null>(null)
  // O erro mostra O QUE ACONTECEU, não um rótulo genérico: a camada oficial já traz a
  // mensagem do servidor (ou "não respondeu no prazo" / "falha de rede"). Um "Erro ao
  // carregar" sem fato nenhum obriga a abrir o DevTools para saber se foi 403, 500 ou
  // rede — e é indistinguível de tela travada.
  const erro = erroLocal ?? (centralReq.erro
    ? (centralReq.erro.status === 404
        ? "Endpoint /api/processos/[id]/central-operacional ainda não existe."
        : `${centralReq.erro.message}${centralReq.erro.status > 0 ? ` (HTTP ${centralReq.erro.status})` : ""}`)
    : null)
  const setData = useCallback((proximos: CentralOpData | null | ((anteriores: CentralOpData | null) => CentralOpData | null)) => {
    const valor = typeof proximos === 'function' ? proximos(data) : proximos
    void centralReq.recarregar(valor ?? undefined)
  }, [data, centralReq])
  // `carregar(silencioso)` continua existindo para os ~10 pontos que o chamam depois de
  // escrever; a distinção entre carga inicial e refresh agora vem da própria consulta.
  const carregar = useCallback((_modoSilencioso = false) => { void centralReq.recarregar() }, [centralReq])

  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [initModalDocId, setInitModalDocId] = useState<number | null>(null)
  const [abrindoOperacao, setAbrindoOperacao] = useState(false)
  const [erroOperacao, setErroOperacao] = useState<string | null>(null)

  // NAVEGAÇÃO ENTRE FASES (OPERATE|VIEW). activePhaseKey = fase OPERADA (do processo);
  // selectedPhaseKey = fase CONSULTADA (clique na trilha). Independentes: consultar
  // NUNCA altera a fase ativa. selectedPhaseKey=null ⇒ segue a ativa (modo OPERATE).
  // Leitura pura das fases materializadas — NUNCA materializa. Falha degrada a trilha
  // para não-clicável, como antes (por isso o erro é ignorado aqui).
  const phasesReq = useApi<{ phases?: PhaseMeta[] }>(`/api/processos/${processo.id}/phases`)
  const phases = phasesReq.dados?.phases ?? SEM_PHASES
  const carregarFases = () => { void phasesReq.recarregar() }
  const [selectedPhaseKey, setSelectedPhaseKey] = useState<string | null>(null)

  // CENTRAL UNIFICADA (OPERATE|PAST_READ_ONLY): ao consultar uma fase PASSADA, a MESMA
  // Central carrega os DADOS VIVOS daquela fase (instância/ciclo) num fetch paralelo. O
  // corpo renderiza `viewData ?? data` — mesmo layout, só leitura. `data` (fase ATIVA)
  // segue intacto para a trilha/resumo. Nunca snapshot; sempre dados reais da instância.

  // Operação Antecipada: contexto (necessidade) para o modal de criação + lista por necessidade.
  // Tarefa Transversal (funcionalidade oficial e SEPARADA da Operação Antecipada).
  const [novaTransversalCtx, setNovaTransversalCtx] = useState<{ necessidadeId?: number | null; pessoaId?: number | null; label?: string } | null>(null)
  // Banner "executada antecipadamente para atender…" exibido na tela oficial (drawer) reusada.
  const [bannerAntecipada, setBannerAntecipada] = useState<string | null>(null)

  // ─── O ALVO DO DEEP-LINK ──────────────────────────────────────────────────
  //
  // O resultado carrega a CHAVE do pedido que o produziu: assim "ainda não
  // resolvi" é derivação, não um `setState(null)` no corpo do efeito — e a
  // resposta de um link antigo não se passa pela do atual.
  type AlvoDaTela = {
    taskId: number; documentoId: number | null; requerDecisao: boolean; titulo: string
    causaRemovidaMotivo: string | null
  }
  const [resolvido, setResolvido] = useState<{ chave: number; alvo: AlvoDaTela | null } | null>(null)
  useEffect(() => {
    if (taskIdAlvo == null) return
    let vivo = true
    fetch(`/api/operacao/tarefas/${taskIdAlvo}/navegacao`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { alvo: AlvoDaTela }) => { if (vivo) setResolvido({ chave: taskIdAlvo, alvo: d.alvo }) })
      // Sem acesso ou inexistente: a Central abre normalmente, sem alvo. Não é
      // erro de tela — é o servidor recusando revelar o que não é de quem pediu.
      .catch(() => { if (vivo) setResolvido({ chave: taskIdAlvo, alvo: null }) })
    return () => { vivo = false }
  }, [taskIdAlvo])
  const alvo = taskIdAlvo != null && resolvido?.chave === taskIdAlvo ? resolvido.alvo : null

  /** O alvo já aberto — referência, não estado: não deve provocar render. */
  const alvoAberto = useRef<number | null>(null)



  // TROCA DE CONTEXTO NO AVANÇO DE FASE: quando a fase da Central muda (avanço/retorno),
  // qualquer drawer aberto está exibindo o contexto da fase ANTIGA (ex.: o passo
  // localizar_registro da Genealogia). Fecha tudo — a Central já re-renderiza com a
  // fase nova e o drawer reabre no contexto da fase atual. Sem estado residual.
  const faseCodeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const fc = data?.faseProgress?.faseCode
    if (fc === undefined) return // ainda carregando
    if (faseCodeRef.current !== undefined && faseCodeRef.current !== fc) {
      setDrawerDocId(null)
      setInitModalDocId(null)
      setAbrindoOperacao(false)
      setErroOperacao(null)
    }
    faseCodeRef.current = fc
  }, [data?.faseProgress?.faseCode])

  // Abre a operação. Se já há Documento (docId>0) abre direto; se for uma
  // necessidade da Genealogia V2 ainda sem Documento (docId=0), garante o
  // registro operacional no back e abre com o id real — em vez de abrir o
  // drawer com id inválido (backdrop vazio, tela travada). O loading SEMPRE
  // termina (finally) e o erro é sempre visível/fechável (nunca backdrop órfão).
  const abrirOperacao = useCallback(
    async (docId: number, necessidadeId?: number | null) => {
      if (docId && docId > 0) { setDrawerDocId(docId); return }
      if (!necessidadeId) { setErroOperacao("Operação sem documento associado. Recarregue a fase e tente novamente."); return }
      setAbrindoOperacao(true)
      setErroOperacao(null)
      // Timeout defensivo: o loading SEMPRE termina, mesmo se o servidor pendurar.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/operacao`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // MESMA autenticação usada por toda a app (Bearer authToken). Sem isso
            // o endpoint responde 401 para o usuário logado e a operação nunca abre.
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId }),
          signal: ctrl.signal,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.documentoId) {
          setErroOperacao(json?.error || `Não foi possível abrir a operação (HTTP ${res.status}).`)
          return
        }
        setDrawerDocId(json.documentoId)
      } catch (e) {
        setErroOperacao(
          (e as Error)?.name === "AbortError"
            ? "A abertura da operação excedeu 15 segundos. Tente novamente."
            : "Falha de rede ao abrir a operação."
        )
      } finally {
        clearTimeout(timer)
        setAbrindoOperacao(false)
      }
    },
    [processo.id]
  )

  // A Operação Antecipada saiu da listagem principal: ela pertence ao ALVO e vive no
  // MODAL do documento, na aba Workflow. A Central só guarda o ALVO do documento que
  // está sendo aberto e repassa como contexto — sem lista, sem avaliação, sem botão.
  const [alvoAntecipada, setAlvoAntecipada] = useState<{ necessidadeId: number | null; pessoaId: number | null } | null>(null)

  // ABRIR DETALHES — a ÚNICA porta da Central para a execução.
  // A listagem é índice; quem executa é o modal do documento (aba Workflow). Aqui só
  // se resolve QUAL documento abrir, por ID:
  //   • documentoId presente  → drawer da operação daquele documento;
  //   • só necessidadeId      → materializa o registro operacional e abre o drawer.
  // Nenhuma condição de progresso, quantidade ou obrigatoriedade participa disto.
  const abrirDetalhes = useCallback((doc: DocumentoDoIndice) => {
    // Sem executor configurado: erro ADMINISTRATIVO explícito. A linha do documento
    // continua visível na listagem — o que falta é cadastro.
    if (!doc.podeAbrirDetalhes) {
      setErroOperacao(doc.impedimento ?? "Sem executor configurado para este documento.")
      return
    }
    setBannerAntecipada(null)
    setAlvoAntecipada({ necessidadeId: doc.necessidadeId, pessoaId: doc.pessoaId ?? null })
    void abrirOperacao(doc.documentoId ?? 0, doc.necessidadeId)
  }, [abrirOperacao])

  // Lista de funcionários para os seletores "Delegar" (carrega uma vez).
  const [usuarios, setUsuarios] = useState<Array<{ id: number; nome: string; publicCode?: string | null }>>([])
  useEffect(() => {
    fetch("/api/usuarios", { headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } })
      .then((r) => r.json())
      .then((d) => setUsuarios((d.usuarios || d || []).map((u: { id: number; nome: string; publicCode?: string | null }) => ({ id: u.id, nome: u.nome, publicCode: u.publicCode ?? null }))))
      .catch(() => {})
  }, [])

  // Delega o passo localizar_registro de uma necessidade (fila) SEM abrir a operação
  // nem criar Documento. Grava o responsável direto no passo.
  const getUserId = (): number | null => {
    try {
      const stored = localStorage.getItem("user")
      if (stored) {
        const u = JSON.parse(stored)
        return u.id ?? null
      }
    } catch {}
    return null
  }

  const delegar = useCallback(
    async (necessidadeId: number, responsavelId: number | null) => {
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/delegar`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId, responsavelId }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErroOperacao(j?.error || `Não foi possível delegar (HTTP ${res.status}).`)
          return
        }
        carregar(true)
      } catch {
        setErroOperacao("Falha de rede ao delegar.")
      }
    },
    // `carregar` entra de verdade: a memoização anterior declarava só `processo.id` e
    // fechava sobre um `carregar` mais antigo.
    [processo.id, carregar]
  )



  // "Abrir operação" de uma antecipada: reusa a MESMA tela oficial (drawer) + banner.
  const abrirOperacaoAlvo = useCallback((documentoId: number, necessidadeId: number | null, objetivo: string | null) => {
    setBannerAntecipada(objetivo ? `Executada antecipadamente para atender: ${objetivo}` : "Operação executada antecipadamente")
    void abrirOperacao(documentoId, necessidadeId)
  }, [abrirOperacao])

  // Fase PASSADA consultada: dados VIVOS daquela fase (instância/ciclo), na MESMA rota
  // da Central. Antes isto tinha AbortController e checagens de `signal.aborted` em
  // quatro pontos, para que a resposta de uma fase nunca vazasse para outra. Com a fase
  // na CHAVE, o vazamento é impossível por construção: a resposta de uma chave não é
  // aplicada em outra. O guard inteiro saiu.
  const chaveView = (() => {
    if (!selectedPhaseKey) return null
    const faseCode = phaseKeyToFaseCode(selectedPhaseKey)
    if (!faseCode) return null
    const meta = phases.find((p) => p.phaseKey === selectedPhaseKey)
    const params = new URLSearchParams({ queue: "all", sort: "priority", faseCode })
    if (userIdAtual) params.set("userId", String(userIdAtual))
    if (meta?.workflowInstanceId != null) params.set("instanceId", String(meta.workflowInstanceId))
    if (meta?.ciclo != null) params.set("ciclo", String(meta.ciclo))
    return `/api/processos/${processo.id}/central-operacional?${params.toString()}`
  })()
  const viewReq = useApi<CentralOpData>(chaveView)
  const viewData = chaveView ? (viewReq.dados ?? null) : null

  // ─── ABRIR SOZINHO, UMA VEZ ───────────────────────────────────────────────
  //
  // Assim que o índice chega, o documento do alvo é localizado por ID e a porta
  // única de execução é acionada — a MESMA que o clique manual usa. `alvoAbriu`
  // impede que uma revalidação em segundo plano reabra o painel por cima do
  // trabalho de quem já seguiu adiante.
  //
  // Tarefa com CAUSA REMOVIDA não abre executor: ela precisa de decisão, não de
  // execução. A Central mostra o contexto e o realce; o painel fica ao alcance
  // de um clique, mas não se impõe.
  useEffect(() => {
    if (!alvo || alvo.requerDecisao) return
    if (alvoAberto.current === alvo.taskId) return
    if (alvo.documentoId == null) return
    const indice = (viewData ?? data)?.indice
    if (!indice) return
    const todas = [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao]
    const doc = todas.flatMap((p) => p.documentos).find((d) => d.documentoId === alvo.documentoId)
    if (!doc) return
    alvoAberto.current = alvo.taskId
    // AGENDADA, não executada durante o commit: abrir o painel é uma AÇÃO em
    // resposta ao índice ter chegado, e disparar a cascata de estado dentro do
    // efeito é o que a regra do React existe para evitar.
    queueMicrotask(() => abrirDetalhes(doc))
  }, [alvo, data, viewData, abrirDetalhes])
  const viewLoading = Boolean(chaveView) && viewReq.carregando
  const viewErro = chaveView && viewReq.erro ? "Não foi possível carregar os dados desta fase." : null

  // Otimista: marca o doc recém-mexido como "Atualizando…" na fila enquanto
  // a Central recarrega em 2º plano — evita a sensação de "concluí e nada mudou".
  const marcarAtualizando = useCallback((docId: number | null) => {
    if (docId == null) return
    setData((prev) =>
      prev
        ? {
            ...prev,
            queue: prev.queue.map((q) =>
              q.docId === docId ? { ...q, proximoPasso: "Atualizando…" } : q,
            ),
          }
        : prev,
    )
  }, [setData])

  // NÃO existe efeito de carga aqui: a consulta busca sozinha ao montar e ao
  // trocar de chave. Um `useEffect(() => carregar(), [carregar])` só reabastecia
  // o ciclo — era ele, somado à identidade instável do resultado, que prendia a
  // aba no spinner.

  // ── ESTADO 1: carregando ────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    )
  }

  // ── ESTADO 2: erro — sempre com saída, nunca um beco sem ação ───────────
  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">
          <div>⚠ {erro}</div>
          <button
            onClick={() => { setErro(null); carregar() }}
            className="mt-2 rounded-md border border-[#d2a948]/40 px-3 py-1 text-xs transition hover:bg-[#d2a948]/15"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // ── ESTADO 3: vazio — a consulta terminou e não há operação materializada ──
  // Antes isto caía num `return null` mudo: a aba ficava em branco e era lida
  // como travamento. Sem workflow, sem fase, sem documento ou sem tarefa, o
  // carregamento TERMINA e a tela diz o que está acontecendo.
  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
          <div className="text-white/80">Nenhuma operação materializada para este processo.</div>
          <div className="mt-1 text-xs text-white/45">
            A Central aparece quando o processo tem fase e workflow ativos.
          </div>
          <button
            onClick={() => carregar()}
            className="mt-3 rounded-md border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // ====== CÁLCULOS (ordem importa: declarar ANTES de usar) ======
  // FONTE DA FASE = a resposta FRESCA da rota (data.faseProgress.faseCode), que lê
  // processo.faseAtualKey do banco a cada fetch. O prop `processo` é estático e NÃO
  // reflete o avanço — usá-lo mantinha a Central presa na Genealogia após avançar.
  // Fallback ao prop só cobre o 1º render antes de `data` chegar.
  // FASE ATIVA (trilha + resumo) — SEMPRE de `data`. Consultar fase passada NUNCA altera.
  const faseCodeAtiva = (data?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKeyAtiva =
    faseCodeAtiva ??
    phaseKeyToFaseCode((processo as { faseAtualKey?: string | null }).faseAtualKey) ??
    undefined
  const faseAtivaNome = (faseKeyAtiva ? FASES[faseKeyAtiva]?.label : undefined) ?? "Genealogia"
  const idxAtual = PROCESS_PHASES.indexOf(faseAtivaNome as (typeof PROCESS_PHASES)[number])
  const fasesConcluidas = idxAtual > 0 ? PROCESS_PHASES.slice(0, idxAtual) : []
  // Percentual da fase ATIVA = projeção oficial (mesmo % do Kanban/Header). Fases
  // concluídas = 100, futuras = 0. Nenhum recálculo local.
  const pctFaseAtual = data.projection?.progress.percentage ?? data.matrix?.percentage ?? 0
  const progressoPorFase: Record<string, number> = {}
  PROCESS_PHASES.forEach((ph, i) => {
    if (i < idxAtual) progressoPorFase[ph] = 100
    else if (i === idxAtual) progressoPorFase[ph] = pctFaseAtual
    else progressoPorFase[ph] = 0
  })
  const activePhaseKey = faseKeyAtiva ? faseCodeToPhaseKey(faseKeyAtiva) : null

  // FASE CONSULTADA (corpo) — `viewData` (passada) ou `data` (ativa). MESMO layout;
  // PAST_READ_ONLY só bloqueia mutações. Dados VIVOS da instância/ciclo (nunca snapshot).
  // isView = INTENÇÃO (fase selecionada ≠ ativa), NÃO "viewData chegou". Assim, durante o
  // loading/erro do fetch da fase passada a Central JÁ está em modo consulta (readOnly +
  // spinner/erro) — nunca expõe o painel EDITÁVEL da fase ativa por engano.
  const isView = !!selectedPhaseKey && selectedPhaseKey !== activePhaseKey
  const bodyData = (isView ? viewData : data) ?? data
  const readOnly = isView || bodyData.mode === "PAST_READ_ONLY"
  const faseCodeData = (bodyData?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKey =
    faseCodeData ??
    (selectedPhaseKey ? phaseKeyToFaseCode(selectedPhaseKey) ?? undefined : undefined) ??
    faseKeyAtiva ??
    undefined
  const faseAtualNome =
    (faseKey ? FASES[faseKey]?.label : undefined) ??
    "Genealogia"

  const painel = mapearPainel(bodyData, faseAtualNome)



  const meta = FASE_META[faseAtualNome] || { sub: "", tabs: ["Resumo"] }

  // Detecta a fase de Análise Documental (tolerante a acento/caixa)
  const ehAnalise = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("analise documental")

  const ehTraducao = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("traducao juramentada")

  const ehApostilamento = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("apostilamento")

  const ehFaseFinal = ["aguardando protocolo", "protocolado", "finalizado"].some((nome) =>
    faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(nome)
  )

  // Fases por-processo (checklist + avançar). Mapeia nome → faseCode (tolerante a acento/caixa).
  const FASE_CODE_POR_NOME: Record<string, FaseCode> = {
    "retificacao de registros": "RETIFICACAO_REGISTROS",
    "emissao documental retificada": "EMISSAO_DOCUMENTAL_RETIFICADA",
    "traducao juramentada": "TRADUCAO_JURAMENTADA",
    "apostilamento": "APOSTILAMENTO",
    "aguardando protocolo": "AGUARDANDO_PROTOCOLO",
    "protocolado": "PROTOCOLADO",
    "finalizado": "FINALIZADO",
  }
  const faseNorm = faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const faseCodeGenerica: FaseCode | undefined = FASE_CODE_POR_NOME[faseNorm]
  const ehRetificacao = faseNorm.includes("retificacao de registros")
  const ehEmissaoRetificada = faseNorm.includes("emissao documental retificada")

  // ====== TRILHA: realce da fase selecionada + metadados do modo consulta ======
  // (activePhaseKey/isView/readOnly j\u00e1 declarados acima). selectedKey = fase real\u00e7ada.
  const selectedKey = selectedPhaseKey ?? activePhaseKey
  const selectedFaseCode = selectedKey ? phaseKeyToFaseCode(selectedKey) : null
  const selectedLabel = selectedFaseCode ? FASES[selectedFaseCode].label : undefined
  const selectedPhaseMeta: PhaseMeta | null =
    (isView && selectedKey)
      ? (phases.find((p) => p.phaseKey === selectedKey) ?? {
          // Fallback quando a rota /phases ainda n\u00e3o respondeu: metadados m\u00ednimos.
          phaseKey: selectedKey, faseCode: selectedFaseCode, label: selectedLabel ?? selectedKey,
          ordem: selectedFaseCode ? FASES[selectedFaseCode].ordem : 0,
          state: (selectedFaseCode && faseKeyAtiva && FASES[selectedFaseCode].ordem < FASES[faseKeyAtiva].ordem
            ? "COMPLETED" : "FUTURE") as PhaseMeta["state"],
          materialized: false, workflowInstanceId: null, ciclo: null, status: null,
        })
      : null

  const onSelectPhase = (label: string) => {
    const pk = LABEL_TO_PHASEKEY[label]
    if (!pk) return
    // Selecionar a fase ativa volta para OPERATE; qualquer outra entra em consulta (VIEW).
    setSelectedPhaseKey(pk === activePhaseKey ? null : pk)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#15191f]">
      <div className="px-6 py-5">

        {/* ===== TOPO: Trilha de fases + Resumo do processo (lado a lado) ===== */}
        <div className="flex flex-col gap-4 mb-4">
          <div className="min-w-0">
            <WorkflowMacroTrilha
              currentPhase={faseAtivaNome}
              completedPhases={fasesConcluidas}
              phaseProgress={progressoPorFase}
              selectedPhase={selectedLabel}
              onSelectPhase={onSelectPhase}
            />
          </div>
          <ResumoDoProcesso
            currentPhase={faseAtivaNome}
            completedPhases={fasesConcluidas}
            phaseProgress={progressoPorFase}
          />
        </div>

        {/* Botões "Nova tarefa transversal" / "Nova operação antecipada" removidos da barra
            da Central Operacional (a pedido). A operação antecipada segue acessível por
            necessidade/pessoa dentro do painel da fase. */}


        {/* ===== Cabeçalho do MODO CONSULTA (fase passada) — MESMA casca, só leitura ===== */}
        {isView && (
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full bg-[#d2a948]/15 text-[#d2a948]">
                <Eye className="w-3.5 h-3.5" /> Somente leitura
              </span>
              <span className="text-[13px] font-semibold text-white/80">
                {selectedPhaseMeta?.state === "FUTURE" ? "Fase futura · ainda não iniciada"
                  : `Fase concluída${selectedPhaseMeta?.ciclo ? ` · Ciclo ${selectedPhaseMeta.ciclo}` : ""}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedPhaseKey(null)}
                className="inline-flex items-center gap-1.5 border-[1.5px] border-white/10 bg-[#1b2027] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg hover:border-white/20 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar à fase ativa
              </button>
              {pode("workflow.retornarFase") && selectedPhaseMeta?.state === "COMPLETED" && selectedKey && (
                <RetornarFaseButton
                  processoId={processo.id}
                  faseKey={selectedKey}
                  faseLabel={selectedLabel ?? selectedKey}
                  onRetornou={() => {
                    setSelectedPhaseKey(null)
                    carregar(true)
                    carregarFases()
                    onProcessoMudou?.()
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* CONSULTA (fase passada): sempre o corpo GENÉRICO da Central com dados VIVOS e
            ESCOPADOS da instância (bodyData). Os painéis bespoke por-fase buscam a fase
            ATIVA (não escopam) — por isso só aparecem no modo ACTIVE, garantindo que
            NENHUM dado da fase ativa vaze na consulta de fase passada. */}
        {isView && !viewData ? (
          // Consultando fase passada e os dados ainda NÃO chegaram (loading/erro): mostra
          // spinner/erro — NUNCA o corpo, que cairia nos dados da fase ativa.
          viewErro
            ? <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">⚠ {viewErro}</div>
            : <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !isView && ehAnalise ? (
          <ProcessoAnalise processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehTraducao ? (
          <ProcessoTraducao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehApostilamento ? (
          <ProcessoApostilamento processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehRetificacao ? (
          <ProcessoRetificacao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehEmissaoRetificada ? (
          <ProcessoEmissaoRetificada processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehFaseFinal ? (
          <ProcessoFaseFinal processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && faseCodeGenerica ? (
          <ProcessoFaseGenerica processoId={processo.id} faseCode={faseCodeGenerica} onConcluido={() => carregar(true)} />
        ) : (
        <>
        {/* ===== Header da Central ===== */}
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white/95 tracking-tight">Central Operacional</h3>
          <p className="text-xs text-white/55 mt-0.5">
            Fila de produção documental · todas as tarefas ativas do processo
          </p>
        </div>

        {/* A DECISÃO PEDIDA, onde ela pode ser tomada. Chegar aqui por um cartão
            que diz "Requer decisão" e não encontrar nada para decidir é um beco:
            a marca vira ruído permanente na fila de quem não pode resolvê-la. */}
        {alvo?.requerDecisao && (
          <DecisaoSobreCausa
            taskId={alvo.taskId}
            titulo={alvo.titulo}
            motivo={alvo.causaRemovidaMotivo}
            podeDecidir={pode("tarefas.excluir")}
            aoDecidir={(decisao) => {
              // MANTER devolve o trabalho: o alvo continua sendo o alvo, e a
              // Central abre o executor como abriria por qualquer deep-link.
              // ENCERRAR tira a tarefa da fila — não há mais onde parar.
              setResolvido((prev) =>
                prev && decisao === "MANTER" && prev.alvo
                  ? { chave: prev.chave, alvo: { ...prev.alvo, requerDecisao: false } }
                  : prev && { chave: prev.chave, alvo: null },
              )
              carregar(true)
            }}
          />
        )}

        {/* ===== Central Operacional (largura cheia, sem sidebar) ===== */}
        <div className="min-w-0">
          <PainelDaFase
            faseNome={faseAtualNome}
            faseSub={bodyData.genealogiaReestruturacao ? "" : meta.sub}
            faseTabs={meta.tabs}
            kpis={painel.kpis}
            progressoPct={painel.pct}
            progressoConcluidos={painel.validados}
            progressoTotal={painel.total}
            progressoTexto={painel.progressoTexto}
            indice={bodyData.indice ?? INDICE_VAZIO}
            // A identidade da fase EXIBIDA (não a ativa): trocar de fase reseta a
            // expansão, para o card nunca mostrar a posição de outro trabalho.
            chaveExpansao={`${processo.id}|${bodyData.phaseContext?.faseMacroKey ?? faseAtualNome}|${bodyData.phaseContext?.ciclo ?? ""}`}
            onAbrirDetalhes={abrirDetalhes}
            documentoDestacadoId={alvo?.documentoId ?? null}
            readOnly={readOnly}
            modoReestruturacao={!!bodyData.genealogiaReestruturacao}
            avisoReestruturacao={bodyData.mensagemReestruturacao ?? undefined}
          />

          {abrindoOperacao && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
              <div className="rounded-md bg-[#1b2027] px-4 py-2 text-sm text-white/80 shadow">Abrindo operação…</div>
            </div>
          )}

          {erroOperacao && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30" onClick={() => setErroOperacao(null)}>
              <div className="max-w-sm rounded-lg bg-[#1b2027] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-semibold text-white/95 mb-1">Não foi possível abrir a operação</div>
                <div className="text-sm text-white/68 mb-4">{erroOperacao}</div>
                <div className="flex justify-end">
                  <button onClick={() => setErroOperacao(null)} className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#252c35] hover:bg-[#252c35] text-white/95">Fechar</button>
                </div>
              </div>
            </div>
          )}

          <DocumentoOperationalDrawer
            // key inclui a FASE ATUAL + doc: ao trocar de fase (ou documento) o drawer
            // é DESMONTADO e REMONTADO — zera estado interno (doc/workflow/aba/loading),
            // sem herdar nada da fase anterior.
            key={`${faseCodeData ?? "?"}-${drawerDocId ?? "none"}`}
            documentoId={drawerDocId}
            isOpen={drawerDocId !== null}
            bannerAntecipada={bannerAntecipada}
            // CONTEXTO DA OPERAÇÃO ANTECIPADA — o ALVO do documento aberto. Ela vive
            // na aba Workflow do modal; a Central só diz sobre QUE alvo se trata.
            contextoAntecipada={
              alvoAntecipada
                ? {
                    processoId: processo.id,
                    necessidadeId: alvoAntecipada.necessidadeId,
                    pessoaId: alvoAntecipada.pessoaId,
                    faseAtivaCode: faseKeyAtiva ? String(faseKeyAtiva) : null,
                    usuarios,
                    onAbrirOperacaoAlvo: readOnly ? undefined : abrirOperacaoAlvo,
                    readOnly,
                  }
                : undefined
            }
            onClose={() => { setDrawerDocId(null); setBannerAntecipada(null); setAlvoAntecipada(null) }}
            onSave={() => {
              marcarAtualizando(drawerDocId)
              carregar(true)
            }}
          />

          <InitOperationModal
            documentoId={initModalDocId}
            isOpen={initModalDocId !== null}
            onClose={() => setInitModalDocId(null)}
            onSuccess={() => {
              setInitModalDocId(null)
              carregar(true)
            }}
          />
        </div>
        </>
        )}


        {novaTransversalCtx && (
          <TarefaTransversalModal
            processoId={processo.id}
            necessidadeId={novaTransversalCtx.necessidadeId}
            necessidadeLabel={novaTransversalCtx.label}
            pessoaId={novaTransversalCtx.pessoaId}
            usuarios={usuarios}
            onClose={() => setNovaTransversalCtx(null)}
            onCreated={() => { setNovaTransversalCtx(null); carregar(true) }}
          />
        )}
      </div>
    </div>
  )
}