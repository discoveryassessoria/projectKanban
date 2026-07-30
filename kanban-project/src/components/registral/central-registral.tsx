// src/components/registral/central-registral.tsx
//
// CENTRAL DE REVISÃO REGISTRAL — a superfície operacional do motor.
//
// O que ela mostra, nesta ordem, porque é a ordem em que o operador decide:
//   1. o estado do processo (linha de cidadania: comprovada ou não, e por quê);
//   2. o que exige DECISÃO dele (propostas e conflitos);
//   3. o que o motor leu (lotes/execuções), para conferir a origem;
//   4. o copiloto, para perguntar em vez de garimpar.
//
// Nada aqui reimplementa regra: a tela só consome as rotas do motor. Toda ação
// visível é ligada — não existe botão inerte.
//
// NÃO toca em nenhum arquivo da Árvore Genealógica: é uma superfície nova, feita
// com o kit do Design System e os tokens globais.

"use client"

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  GitBranch,
  Loader2,
  MessageCircleQuestion,
  Play,
  RefreshCw,
  ScrollText,
  ShieldAlert,
} from "lucide-react"
import {
  EmptyState,
  FilterChip,
  KpiCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
  SurfaceCard,
  SURFACE_INPUT,
} from "@/src/components/financeiroComponents/ui/kit"
import { enviar, invalidar, useApi } from "@/src/lib/dados"
import { PainelProposta, permissaoExigida, type PermissoesRegistrais } from "./painel-proposta"
import {
  ROTULO_CAMPO_UI,
  ROTULO_CRITICIDADE,
  ROTULO_ETAPA,
  ROTULO_RESULTADO_LINHA,
  ROTULO_TIPO_PROPOSTA,
  tomDaCriticidade,
  tomDaSeveridade,
  tomDoStatus,
  type ConflitoLista,
  type LinhagemResposta,
  type LoteDetalhe,
  type LoteResumo,
  type PropostaDetalhe,
  type PropostaLista,
  type RespostaCopilotoUI,
} from "./tipos-ui"

const S = {
  border: "var(--border-default)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  surface2: "var(--surface-secondary)",
  danger: "var(--danger)",
  success: "var(--success)",
  warning: "var(--warning)",
} as const

type Aba = "propostas" | "conflitos" | "leitura" | "copiloto"

export interface ProcessoOpcao {
  id: number
  nome: string
  codigo?: string | null
}

export function CentralRegistral({
  processos,
  processoId,
  aoTrocarProcesso,
  permissoes,
  podeProcessar,
}: {
  processos: ProcessoOpcao[]
  processoId: number | null
  aoTrocarProcesso: (id: number) => void
  permissoes: PermissoesRegistrais
  podeProcessar: boolean
}) {
  const [aba, setAba] = React.useState<Aba>("propostas")
  const [selecionada, setSelecionada] = React.useState<number | null>(null)
  const [processando, setProcessando] = React.useState(false)
  const [erroProcesso, setErroProcesso] = React.useState<string | null>(null)

  const chave = processoId ? String(processoId) : null

  const propostasReq = useApi<{ propostas: PropostaLista[] }>(
    chave ? `/api/registral/propostas?processoId=${chave}&limite=200` : null,
  )
  const conflitosReq = useApi<{ conflitos: ConflitoLista[] }>(
    chave ? `/api/registral/conflitos?processoId=${chave}&status=ABERTO,EM_REVISAO&limite=200` : null,
  )
  const linhagemReq = useApi<LinhagemResposta>(chave ? `/api/processos/${chave}/registral/linhagem` : null)
  const lotesReq = useApi<{ lotes: LoteResumo[] }>(chave ? `/api/processos/${chave}/registral/lotes` : null)
  const detalheReq = useApi<{ proposta: PropostaDetalhe }>(
    selecionada ? `/api/registral/propostas/${selecionada}` : null,
  )

  const propostas = propostasReq.dados?.propostas ?? []
  const conflitos = conflitosReq.dados?.conflitos ?? []
  const lotes = lotesReq.dados?.lotes ?? []
  const linhagem = linhagemReq.dados ?? null

  const pendentes = propostas.filter((p) => p.status === "PENDENTE" || p.status === "ADIADA")
  const bloqueios = pendentes.filter((p) => p.criticidade === "BLOQUEIO")
  const conflitosCriticos = conflitos.filter((c) => c.severidade === "CRITICO" || c.severidade === "ALTO")
  const documentosLidos = lotes.reduce((s, l) => s + l.processados, 0)

  async function recarregarTudo() {
    if (!chave) return
    await Promise.all([
      propostasReq.recarregar(),
      conflitosReq.recarregar(),
      linhagemReq.recarregar(),
      lotesReq.recarregar(),
    ])
  }

  async function processarPasta() {
    if (!processoId || processando) return
    setErroProcesso(null)
    setProcessando(true)
    try {
      await enviar(`/api/processos/${processoId}/registral/lotes`, { metodo: "POST", corpo: {} })
      await invalidar("/api/registral")
      await recarregarTudo()
    } catch (e) {
      setErroProcesso(e instanceof Error ? e.message : "Falha ao processar a pasta documental.")
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ScrollText className="h-5 w-5" />}
        title="Revisão Registral"
        subtitle="O que as certidões dizem, o que está comprovado e o que precisa da sua decisão."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={processoId ?? ""}
              onChange={(e) => aoTrocarProcesso(Number(e.target.value))}
              aria-label="Processo"
              className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
              style={{ background: SURFACE_INPUT, borderColor: S.border, color: S.textPrimary }}
            >
              <option value="" disabled>
                Selecione o processo
              </option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo ? `${p.codigo} · ` : ""}
                  {p.nome}
                </option>
              ))}
            </select>
            <SecondaryButton icon={<RefreshCw className="h-4 w-4" />} onClick={recarregarTudo}>
              Atualizar
            </SecondaryButton>
            {podeProcessar && (
              <PrimaryButton
                icon={processando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                onClick={processoId ? processarPasta : undefined}
                className={processoId && !processando ? "" : "opacity-50 cursor-not-allowed"}
              >
                Processar pasta
              </PrimaryButton>
            )}
          </div>
        }
      />

      {erroProcesso && (
        <SurfaceCard padding="p-3">
          <p className="text-xs" style={{ color: S.danger }}>
            {erroProcesso}
          </p>
        </SurfaceCard>
      )}

      {!processoId ? (
        <SurfaceCard>
          <EmptyState
            icon={<FileSearch className="h-6 w-6" />}
            title="Escolha um processo para revisar"
            subtitle="A revisão registral é sempre no contexto de um processo e da sua Pasta Documental."
          />
        </SurfaceCard>
      ) : (
        <>
          {/* ---------------- KPIs ---------------- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Aguardando decisão"
              value={pendentes.length}
              sub={`${propostas.length} proposta(s) no total`}
              iconTone={pendentes.length > 0 ? "warning" : "success"}
            />
            <KpiCard
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Bloqueios"
              value={bloqueios.length}
              sub="exigem permissão dedicada"
              iconTone={bloqueios.length > 0 ? "danger" : "neutral"}
            />
            <KpiCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Conflitos abertos"
              value={conflitos.length}
              sub={`${conflitosCriticos.length} grave(s)`}
              iconTone={conflitosCriticos.length > 0 ? "danger" : "neutral"}
            />
            <KpiCard
              icon={<FileSearch className="h-4 w-4" />}
              label="Documentos lidos"
              value={documentosLidos}
              sub={`${lotes.length} lote(s) de leitura`}
              iconTone="neutral"
            />
          </div>

          {/* ---------------- LINHA DE CIDADANIA ---------------- */}
          <SectionCard
            icon={<GitBranch className="h-4 w-4" />}
            title="Linha de cidadania"
            right={
              linhagem ? (
                <StatusBadge tone={linhagem.elegibilidade.comprovadoDocumentalmente ? "success" : "warning"}>
                  {ROTULO_RESULTADO_LINHA[linhagem.elegibilidade.resultado] ?? linhagem.elegibilidade.resultado}
                </StatusBadge>
              ) : null
            }
          >
            {linhagemReq.carregando ? (
              <Carregando />
            ) : !linhagem ? (
              <p className="text-xs" style={{ color: S.textMuted }}>
                Este processo não tem árvore vinculada.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed" style={{ color: S.textSecondary }}>
                  {linhagem.elegibilidade.explicacao}
                </p>
                <div className="text-xs mt-2" style={{ color: S.textMuted }}>
                  {(linhagem.elegibilidade.caminhoPrincipal?.ids ?? [])
                    .map((id) => linhagem.nomes.find((n) => n.id === id)?.nome ?? `#${id}`)
                    .join(" → ") || "caminho não apurado"}
                </div>
                {linhagem.elegibilidade.pendencias.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {linhagem.elegibilidade.pendencias.map((p, i) => (
                      <li key={i} className="text-xs" style={{ color: S.warning }}>
                        · {p}
                      </li>
                    ))}
                  </ul>
                )}
                {linhagem.elegibilidade.conflitos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {linhagem.elegibilidade.conflitos.map((c, i) => (
                      <li key={i} className="text-xs" style={{ color: S.danger }}>
                        · {c}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </SectionCard>

          {/* ---------------- ABAS ---------------- */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip active={aba === "propostas"} onClick={() => setAba("propostas")} count={pendentes.length}>
              Decisões
            </FilterChip>
            <FilterChip active={aba === "conflitos"} onClick={() => setAba("conflitos")} count={conflitos.length}>
              Conflitos
            </FilterChip>
            <FilterChip active={aba === "leitura"} onClick={() => setAba("leitura")} count={lotes.length}>
              Leitura dos documentos
            </FilterChip>
            <FilterChip active={aba === "copiloto"} onClick={() => setAba("copiloto")}>
              Copiloto
            </FilterChip>
          </div>

          {aba === "propostas" && (
            <AbaPropostas
              propostas={propostas}
              carregando={propostasReq.carregando}
              permissoes={permissoes}
              aoAbrir={setSelecionada}
            />
          )}
          {aba === "conflitos" && (
            <AbaConflitos
              conflitos={conflitos}
              carregando={conflitosReq.carregando}
              podeRevisar={permissoes.revisar}
              aoDecidir={recarregarTudo}
            />
          )}
          {aba === "leitura" && <AbaLeitura lotes={lotes} carregando={lotesReq.carregando} />}
          {aba === "copiloto" && <AbaCopiloto processoId={processoId} />}
        </>
      )}

      {selecionada && detalheReq.dados?.proposta && (
        <PainelProposta
          proposta={detalheReq.dados.proposta}
          permissoes={permissoes}
          aoFechar={() => setSelecionada(null)}
          aoDecidir={recarregarTudo}
        />
      )}
    </div>
  )
}

// ============================================================================

function Carregando() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin" style={{ color: S.textMuted }} />
    </div>
  )
}

function AbaPropostas({
  propostas,
  carregando,
  permissoes,
  aoAbrir,
}: {
  propostas: PropostaLista[]
  carregando: boolean
  permissoes: PermissoesRegistrais
  aoAbrir: (id: number) => void
}) {
  const [filtro, setFiltro] = React.useState<"pendentes" | "bloqueios" | "decididas" | "todas">("pendentes")

  const lista = propostas.filter((p) => {
    if (filtro === "pendentes") return p.status === "PENDENTE" || p.status === "ADIADA"
    if (filtro === "bloqueios") return p.criticidade === "BLOQUEIO"
    if (filtro === "decididas") return p.status !== "PENDENTE" && p.status !== "ADIADA"
    return true
  })

  return (
    <SectionCard
      icon={<CheckCircle2 className="h-4 w-4" />}
      title="Propostas de reconciliação"
      right={
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip active={filtro === "pendentes"} onClick={() => setFiltro("pendentes")}>
            Pendentes
          </FilterChip>
          <FilterChip active={filtro === "bloqueios"} onClick={() => setFiltro("bloqueios")}>
            Bloqueios
          </FilterChip>
          <FilterChip active={filtro === "decididas"} onClick={() => setFiltro("decididas")}>
            Decididas
          </FilterChip>
          <FilterChip active={filtro === "todas"} onClick={() => setFiltro("todas")}>
            Todas
          </FilterChip>
        </div>
      }
    >
      {carregando ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          compact
          title="Nada aguardando decisão"
          subtitle="Quando uma certidão trouxer algo que o motor não pode aplicar sozinho, aparece aqui."
        />
      ) : (
        <ul className="divide-y" style={{ borderColor: S.border }}>
          {lista.map((p) => {
            const exigida = permissaoExigida(p.tipo, p.criticidade)
            const pode = permissoes[exigida] === true
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => aoAbrir(p.id)}
                  className="w-full text-left py-3 px-1 transition-colors hover:opacity-90"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: S.textPrimary }}>
                          {ROTULO_TIPO_PROPOSTA[p.tipo] ?? p.tipo}
                        </span>
                        {p.campo && (
                          <span className="text-xs" style={{ color: S.textMuted }}>
                            {ROTULO_CAMPO_UI[p.campo] ?? p.campo}
                          </span>
                        )}
                        <StatusBadge tone={tomDaCriticidade(p.criticidade)}>
                          {ROTULO_CRITICIDADE[p.criticidade]}
                        </StatusBadge>
                        <StatusBadge tone={tomDoStatus(p.status)}>{p.status}</StatusBadge>
                        {!pode && p.status === "PENDENTE" && (
                          <span className="text-[11px]" style={{ color: S.textMuted }}>
                            sem permissão
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1 line-clamp-2" style={{ color: S.textSecondary }}>
                        {p.recomendacao ?? p.justificativa}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs tabular-nums" style={{ color: S.textMuted }}>
                        {(p.confianca * 100).toFixed(0)}%
                      </div>
                      {p.valorProposto && (
                        <div className="text-[11px] mt-0.5 max-w-[220px] truncate" style={{ color: S.textSecondary }}>
                          {p.valorAtual ? `${p.valorAtual} → ` : ""}
                          {p.valorProposto}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

function AbaConflitos({
  conflitos,
  carregando,
  podeRevisar,
  aoDecidir,
}: {
  conflitos: ConflitoLista[]
  carregando: boolean
  podeRevisar: boolean
  aoDecidir: () => void
}) {
  const [aberto, setAberto] = React.useState<number | null>(null)
  const [motivo, setMotivo] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  async function decidir(id: number, acao: "resolver" | "descartar") {
    if (motivo.trim().length < 5 || enviando) return
    setErro(null)
    setEnviando(true)
    try {
      const r = await enviar<{ resultado: { ok: boolean; mensagem: string } }>(
        `/api/registral/conflitos/${id}`,
        { metodo: "PATCH", corpo: { acao, motivo: motivo.trim() } },
      )
      if (!r.resultado?.ok) {
        setErro(r.resultado?.mensagem ?? "Não foi possível registrar a decisão.")
        return
      }
      setAberto(null)
      setMotivo("")
      aoDecidir()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao decidir o conflito.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <SectionCard icon={<AlertTriangle className="h-4 w-4" />} title="Conflitos abertos">
      {carregando ? (
        <Carregando />
      ) : conflitos.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          compact
          title="Nenhum conflito aberto"
          subtitle="O motor abre conflito quando se recusa a decidir — divergência entre leituras, homônimo, contradição."
        />
      ) : (
        <ul className="space-y-3">
          {conflitos.map((c) => (
            <li
              key={c.id}
              className="rounded-[var(--radius-sm)] border p-3"
              style={{ borderColor: S.border, background: S.surface2 }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={tomDaSeveridade(c.severidade)}>{c.severidade}</StatusBadge>
                    <span className="text-sm font-medium" style={{ color: S.textPrimary }}>
                      {c.descricao}
                    </span>
                  </div>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: S.textSecondary }}>
                    {c.explicacao}
                  </p>
                  {c.acaoSugerida && (
                    <p className="text-xs mt-1" style={{ color: S.textMuted }}>
                      Sugestão: {c.acaoSugerida}
                    </p>
                  )}
                  <p className="text-[11px] mt-1" style={{ color: S.textMuted }}>
                    {c.codigo}
                    {c.campo ? ` · ${ROTULO_CAMPO_UI[c.campo] ?? c.campo}` : ""}
                  </p>
                </div>
                {podeRevisar && (
                  <SecondaryButton
                    onClick={() => {
                      setAberto(aberto === c.id ? null : c.id)
                      setMotivo("")
                      setErro(null)
                    }}
                  >
                    {aberto === c.id ? "Fechar" : "Decidir"}
                  </SecondaryButton>
                )}
              </div>

              {aberto === c.id && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: S.border }}>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={2}
                    placeholder="O que você conferiu para decidir? Fica na auditoria."
                    className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none resize-y"
                    style={{ background: SURFACE_INPUT, borderColor: S.border, color: S.textPrimary }}
                  />
                  {erro && (
                    <p className="text-xs mt-2" style={{ color: S.danger }}>
                      {erro}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <PrimaryButton
                      icon={enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      onClick={() => decidir(c.id, "resolver")}
                      className={motivo.trim().length >= 5 && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                    >
                      Resolver
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={() => decidir(c.id, "descartar")}
                      className={motivo.trim().length >= 5 && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                    >
                      Descartar
                    </SecondaryButton>
                  </div>
                  {c.severidade === "CRITICO" && (
                    <p className="text-[11px] mt-2" style={{ color: S.warning }}>
                      Conflito crítico só pode ser descartado por quem administra as regras registrais.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function AbaLeitura({ lotes, carregando }: { lotes: LoteResumo[]; carregando: boolean }) {
  const [aberto, setAberto] = React.useState<number | null>(null)
  const detalhe = useApi<{ lote: LoteDetalhe }>(aberto ? `/api/registral/lotes/${aberto}` : null)

  return (
    <SectionCard icon={<FileSearch className="h-4 w-4" />} title="Leitura dos documentos">
      {carregando ? (
        <Carregando />
      ) : lotes.length === 0 ? (
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          compact
          title="Nenhuma leitura feita"
          subtitle="Use “Processar pasta” para o motor ler as certidões deste processo."
        />
      ) : (
        <ul className="space-y-2">
          {lotes.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setAberto(aberto === l.id ? null : l.id)}
                className="w-full text-left rounded-[var(--radius-sm)] border p-3 transition-colors"
                style={{ borderColor: S.border, background: S.surface2 }}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: S.textPrimary }}>
                        Lote #{l.id}
                      </span>
                      <StatusBadge tone={l.falhos > 0 ? "warning" : "success"}>{l.status}</StatusBadge>
                      <span className="text-[11px]" style={{ color: S.textMuted }}>
                        motor {l.versaoMotor}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: S.textSecondary }}>
                      {l.resumo ??
                        `${l.processados}/${l.totalDocumentos} documento(s) · ${l.evidenciasCriadas} evidência(s)`}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums shrink-0" style={{ color: S.textMuted }}>
                    {new Date(l.criadoEm).toLocaleString("pt-BR")}
                  </span>
                </div>
              </button>

              {aberto === l.id && (
                <div className="mt-2 ml-2 pl-3 border-l" style={{ borderColor: S.border }}>
                  {detalhe.carregando ? (
                    <Carregando />
                  ) : (
                    <ul className="space-y-1.5 py-2">
                      {(detalhe.dados?.lote.execucoes ?? []).map((e) => (
                        <li key={e.id} className="text-xs flex items-start justify-between gap-3">
                          <span style={{ color: S.textSecondary }}>
                            documento #{e.documentoId}
                            {e.tipoDetectado ? ` · ${e.tipoDetectado}` : ""}
                            {e.camposDivergentes > 0 && (
                              <span style={{ color: S.danger }}> · {e.camposDivergentes} divergência(s)</span>
                            )}
                          </span>
                          <span className="shrink-0" style={{ color: S.textMuted }}>
                            {ROTULO_ETAPA[e.etapa] ?? e.etapa}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function AbaCopiloto({ processoId }: { processoId: number }) {
  const [pergunta, setPergunta] = React.useState("")
  const [resposta, setResposta] = React.useState<RespostaCopilotoUI | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  const SUGESTOES = [
    "Quem transmite a cidadania?",
    "Onde está a quebra da linha?",
    "Quais certidões faltam?",
    "Quais dados divergem?",
    "Quais pessoas podem estar duplicadas?",
    "Qual documento comprova o vínculo?",
  ]

  async function perguntar(texto: string) {
    const q = texto.trim()
    if (!q || enviando) return
    setErro(null)
    setEnviando(true)
    try {
      const r = await enviar<{ resposta: RespostaCopilotoUI }>(
        `/api/processos/${processoId}/registral/copiloto`,
        { metodo: "POST", corpo: { pergunta: q } },
      )
      setResposta(r.resposta)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar o copiloto.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <SectionCard icon={<MessageCircleQuestion className="h-4 w-4" />} title="Copiloto genealógico">
      <p className="text-xs mb-3" style={{ color: S.textMuted }}>
        Responde somente com dados e evidências deste processo. Quando não há dado, ele diz que não há — não inventa.
      </p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {SUGESTOES.map((s) => (
          <FilterChip key={s} active={false} onClick={() => { setPergunta(s); perguntar(s) }}>
            {s}
          </FilterChip>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          onKeyDown={(e) => (e.key === "Enter" ? perguntar(pergunta) : undefined)}
          placeholder="Pergunte sobre a linha, os vínculos, as certidões…"
          className="flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
          style={{ background: SURFACE_INPUT, borderColor: S.border, color: S.textPrimary }}
        />
        <PrimaryButton
          icon={enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          onClick={() => perguntar(pergunta)}
          className={pergunta.trim() && !enviando ? "" : "opacity-50 cursor-not-allowed"}
        >
          Perguntar
        </PrimaryButton>
      </div>

      {erro && (
        <p className="text-xs mt-3" style={{ color: S.danger }}>
          {erro}
        </p>
      )}

      {resposta && (
        <div
          className="mt-4 rounded-[var(--radius-sm)] border p-3"
          style={{ borderColor: S.border, background: S.surface2 }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium" style={{ color: S.textPrimary }}>
              {resposta.conclusao}
            </p>
            <StatusBadge tone={resposta.semDados ? "neutral" : resposta.confianca >= 0.9 ? "success" : "warning"}>
              {resposta.semDados ? "sem dado" : `confiança ${(resposta.confianca * 100).toFixed(0)}%`}
            </StatusBadge>
          </div>

          {resposta.evidencias.length > 0 && (
            <ul className="mt-3 space-y-1">
              {resposta.evidencias.map((e, i) => (
                <li key={i} className="text-xs" style={{ color: S.textSecondary }}>
                  · {e}
                </li>
              ))}
            </ul>
          )}

          {resposta.pendencias.length > 0 && (
            <ul className="mt-3 space-y-1">
              {resposta.pendencias.map((p, i) => (
                <li key={i} className="text-xs" style={{ color: S.warning }}>
                  · {p}
                </li>
              ))}
            </ul>
          )}

          {resposta.origemDosDados.length > 0 && (
            <p className="text-[11px] mt-3" style={{ color: S.textMuted }}>
              Origem: {resposta.origemDosDados.join(" · ")}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  )
}
