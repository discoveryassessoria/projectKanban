// src/components/registral/painel-proposta.tsx
//
// PAINEL DE DECISÃO de uma proposta de reconciliação.
//
// É aqui que a decisão humana acontece, e a tela existe para deixar o operador
// decidir com o que o motor sabe — não para empurrar o "sim":
//
//   · ANTES e DEPOIS lado a lado, cada um com a sua ORIGEM;
//   · evidências FAVORÁVEIS e CONTRÁRIAS na mesma altura visual (esconder as
//     contrárias transformaria revisão em carimbo);
//   · o impacto calculado, incluindo o que a aplicação criaria de inconsistência;
//   · o motivo é OBRIGATÓRIO — sem texto, o botão não fica disponível;
//   · proposta de BLOQUEIO exige, além do motivo, um desbloqueio explícito.
//
// Superfície: drawer sobre `--surface-overlay` (token global do DS), z-index do
// SSOT em src/lib/ui/layers.ts. Nenhum valor cravado.

"use client"

import * as React from "react"
import { useIsClient } from "@/src/lib/cliente"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ThumbsDown,
  X,
} from "lucide-react"
import {
  SectionCard,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
  SURFACE_OVERLAY,
  SURFACE_INPUT,
} from "@/src/components/financeiroComponents/ui/kit"
import { LAYER } from "@/src/lib/ui/layers"
import { enviar } from "@/src/lib/dados"
import {
  ROTULO_CAMPO_UI,
  ROTULO_CRITICIDADE,
  ROTULO_TIPO_PROPOSTA,
  evidenciasDe,
  tomDaCriticidade,
  tomDaSeveridade,
  tomDoStatus,
  type PropostaDetalhe,
} from "./tipos-ui"

const S = {
  border: "var(--border-default)",
  borderStrong: "var(--border-strong)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  surface2: "var(--surface-secondary)",
  danger: "var(--danger)",
  success: "var(--success)",
  warning: "var(--warning)",
} as const

export type AcaoProposta = "aprovar" | "rejeitar" | "adiar" | "reverter"

export interface PermissoesRegistrais {
  aprovar: boolean
  revisar: boolean
  alterarFiliacao: boolean
  mesclarPessoas: boolean
  reverter: boolean
}

/** Qual permissão a matriz exige para decidir esta proposta. */
export function permissaoExigida(tipo: string, criticidade: string): keyof PermissoesRegistrais {
  if (tipo === "MESCLAR_PESSOAS" || tipo === "SEPARAR_PESSOAS") return "mesclarPessoas"
  if (tipo === "CRIAR_RELACIONAMENTO" || tipo === "CORRIGIR_RELACIONAMENTO" || tipo === "REMOVER_RELACIONAMENTO") {
    return "alterarFiliacao"
  }
  return criticidade === "AUTOMATICA" ? "revisar" : "aprovar"
}

export function PainelProposta({
  proposta,
  permissoes,
  aoFechar,
  aoDecidir,
}: {
  proposta: PropostaDetalhe
  permissoes: PermissoesRegistrais
  aoFechar: () => void
  aoDecidir: () => void
}) {
  const [motivo, setMotivo] = React.useState("")
  const [desbloqueio, setDesbloqueio] = React.useState(false)
  const [enviando, setEnviando] = React.useState<AcaoProposta | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [aviso, setAviso] = React.useState<string | null>(null)
  // "Montado" é o contrato de hidratação, e o projeto já tem a abstração oficial
  // para ele — `useIsClient` usa useSyncExternalStore com snapshot de servidor
  // próprio, em vez de um setState no primeiro efeito.
  const montado = useIsClient()

  const favoraveis = evidenciasDe(proposta.evidenciasFavoraveis)
  const contrarias = evidenciasDe(proposta.evidenciasContrarias)
  const impactoPrevio = proposta.impactos.find((i) => i.momento === "PREVIO") ?? proposta.impactos[0] ?? null

  const chaveNecessaria = permissaoExigida(proposta.tipo, proposta.criticidade)
  const podeDecidir = permissoes[chaveNecessaria] === true
  const podeReverter = permissoes.reverter === true
  const ehBloqueio = proposta.criticidade === "BLOQUEIO"
  const decidida = proposta.status !== "PENDENTE" && proposta.status !== "ADIADA"
  const aplicada = proposta.status === "APLICADA"

  const motivoOk = motivo.trim().length >= 5
  const desbloqueioOk = !ehBloqueio || desbloqueio

  async function decidir(acao: AcaoProposta) {
    setErro(null)
    setAviso(null)
    setEnviando(acao)
    try {
      const r = await enviar<{ resultado: { ok: boolean; mensagem: string; falhasRevalidacao?: string[] } }>(
        `/api/registral/propostas/${proposta.id}`,
        {
          metodo: "PATCH",
          corpo: { acao, motivo: motivo.trim(), desbloqueioExplicito: desbloqueio },
        },
      )
      if (!r.resultado?.ok) {
        setErro(r.resultado?.mensagem ?? "A operação não foi concluída.")
        if (r.resultado?.falhasRevalidacao?.length) {
          setAviso(`Revalidação reprovou: ${r.resultado.falhasRevalidacao.join(" · ")}`)
        }
        return
      }
      aoDecidir()
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar a decisão.")
    } finally {
      setEnviando(null)
    }
  }

  if (!montado) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: LAYER.aboveProcessDrawer, background: "rgba(0,0,0,0.55)" }}
        onClick={aoFechar}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`Proposta ${ROTULO_TIPO_PROPOSTA[proposta.tipo] ?? proposta.tipo}`}
        className="fixed right-0 top-0 h-full w-full max-w-[640px] overflow-y-auto border-l"
        style={{ zIndex: LAYER.aboveProcessDrawer, background: SURFACE_OVERLAY, borderColor: S.border }}
      >
        <header
          className="sticky top-0 flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ background: SURFACE_OVERLAY, borderColor: S.border }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold truncate" style={{ color: S.textPrimary }}>
                {ROTULO_TIPO_PROPOSTA[proposta.tipo] ?? proposta.tipo}
              </h3>
              <StatusBadge tone={tomDaCriticidade(proposta.criticidade)}>
                {ROTULO_CRITICIDADE[proposta.criticidade]}
              </StatusBadge>
              <StatusBadge tone={tomDoStatus(proposta.status)}>{proposta.status}</StatusBadge>
            </div>
            <p className="text-xs mt-1" style={{ color: S.textSecondary }}>
              {proposta.campo ? `${ROTULO_CAMPO_UI[proposta.campo] ?? proposta.campo} · ` : ""}
              regra {proposta.regraAplicada} · confiança {(proposta.confianca * 100).toFixed(0)}%
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar painel"
            className="shrink-0 rounded-[var(--radius-sm)] border p-1.5 transition-colors"
            style={{ borderColor: S.border, color: S.textSecondary }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* ---------------- ANTES → DEPOIS ---------------- */}
          <SectionCard icon={<ArrowRight className="h-4 w-4" />} title="O que muda">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: S.border, background: S.surface2 }}>
                <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: S.textMuted }}>
                  Valor atual
                </div>
                <div className="text-sm break-words" style={{ color: S.textPrimary }}>
                  {proposta.valorAtual ?? <span style={{ color: S.textMuted }}>vazio</span>}
                </div>
                {proposta.origemValorAtual && (
                  <div className="text-[11px] mt-1.5" style={{ color: S.textMuted }}>
                    {proposta.origemValorAtual}
                  </div>
                )}
              </div>
              <div
                className="rounded-[var(--radius-sm)] border p-3"
                style={{ borderColor: "color-mix(in srgb, var(--accent-primary) 30%, transparent)", background: S.surface2 }}
              >
                <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: S.textMuted }}>
                  Valor proposto
                </div>
                <div className="text-sm break-words" style={{ color: S.textPrimary }}>
                  {proposta.valorProposto ?? <span style={{ color: S.textMuted }}>—</span>}
                </div>
                {proposta.origemValorProposto && (
                  <div className="text-[11px] mt-1.5" style={{ color: S.textMuted }}>
                    {proposta.origemValorProposto}
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: S.textSecondary }}>
              {proposta.justificativa}
            </p>
            {proposta.recomendacao && (
              <p className="text-xs mt-2" style={{ color: S.textMuted }}>
                Recomendação: {proposta.recomendacao}
              </p>
            )}
          </SectionCard>

          {/* ---------------- EVIDÊNCIAS ---------------- */}
          <SectionCard icon={<FileText className="h-4 w-4" />} title="Evidências">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ListaEvidencias titulo="A favor" itens={favoraveis} tom="success" />
              <ListaEvidencias titulo="Contra" itens={contrarias} tom="danger" />
            </div>
            {proposta.fato && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: S.border }}>
                <div className="text-xs mb-2" style={{ color: S.textSecondary }}>
                  Fato registral: {ROTULO_CAMPO_UI[proposta.fato.campo] ?? proposta.fato.campo} ·{" "}
                  <StatusBadge tone="neutral">{proposta.fato.estado}</StatusBadge>
                </div>
                <ul className="space-y-1">
                  {proposta.fato.evidencias.map((e) => (
                    <li key={e.id} className="text-[11px]" style={{ color: S.textMuted }}>
                      documento #{e.documentoId}
                      {e.pagina != null ? `, página ${e.pagina}` : ""} · {e.metodoExtracao} ·{" "}
                      {e.favoravel ? "favorável" : "contrária"}
                      {e.trechoTexto ? ` — “${e.trechoTexto.slice(0, 90)}”` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>

          {/* ---------------- IMPACTO ---------------- */}
          {impactoPrevio && (
            <SectionCard
              icon={<AlertTriangle className="h-4 w-4" />}
              title="Impacto calculado"
              right={
                impactoPrevio.bloqueado ? <StatusBadge tone="danger">Aplicação abortaria</StatusBadge> : null
              }
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                <Metrica rotulo="Pessoas" valor={impactoPrevio.pessoasAfetadas} />
                <Metrica rotulo="Vínculos" valor={impactoPrevio.vinculosAlterados} />
                <Metrica rotulo="Requerentes" valor={impactoPrevio.requerentesAfetados} />
                <Metrica rotulo="Processos" valor={impactoPrevio.processosAfetados} />
                <Metrica rotulo="Documentos" valor={impactoPrevio.documentosRelacionados} />
                <Metrica rotulo="Necessidades" valor={impactoPrevio.necessidadesRecalculadas} />
                <Metrica rotulo="Inconsist. criadas" valor={impactoPrevio.inconsistenciasCriadas} alerta />
                <Metrica rotulo="Inconsist. resolvidas" valor={impactoPrevio.inconsistenciasResolvidas} />
              </div>
              {(impactoPrevio.elegibilidadeAntes || impactoPrevio.elegibilidadeDepois) && (
                <p className="text-xs mt-3" style={{ color: S.textSecondary }}>
                  Elegibilidade: {impactoPrevio.elegibilidadeAntes ?? "—"} → {impactoPrevio.elegibilidadeDepois ?? "—"}
                </p>
              )}
              {impactoPrevio.motivoBloqueio && (
                <p className="text-xs mt-2" style={{ color: S.danger }}>
                  {impactoPrevio.motivoBloqueio}
                </p>
              )}
            </SectionCard>
          )}

          {/* ---------------- HISTÓRICO ---------------- */}
          {proposta.decisoes.length > 0 && (
            <SectionCard icon={<Clock className="h-4 w-4" />} title="Decisões registradas">
              <ul className="space-y-2">
                {proposta.decisoes.map((d) => (
                  <li key={d.id} className="text-xs" style={{ color: S.textSecondary }}>
                    <span style={{ color: S.textPrimary }}>{d.decisao}</span> ·{" "}
                    {d.responsavel?.nome ?? "sistema"} · {new Date(d.criadoEm).toLocaleString("pt-BR")}
                    <div style={{ color: S.textMuted }}>
                      {d.motivo} <span className="opacity-70">({d.permissao})</span>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {proposta.motivoAbortoRevalidacao && (
            <SectionCard icon={<ShieldAlert className="h-4 w-4" />} title="Por que foi abortada">
              <p className="text-xs leading-relaxed" style={{ color: S.danger }}>
                {proposta.motivoAbortoRevalidacao}
              </p>
            </SectionCard>
          )}

          {/* ---------------- DECISÃO ---------------- */}
          <SectionCard icon={<CheckCircle2 className="h-4 w-4" />} title="Decisão">
            {!podeDecidir && !aplicada && (
              <p className="text-xs mb-3" style={{ color: S.warning }}>
                Você não tem a permissão exigida para decidir esta proposta.
              </p>
            )}

            {decidida && !aplicada && (
              <p className="text-xs mb-3" style={{ color: S.textMuted }}>
                Esta proposta já foi decidida ({proposta.status}). Não há ação disponível.
              </p>
            )}

            {(!decidida || aplicada) && (
              <>
                <label className="block text-xs mb-1" style={{ color: S.textSecondary }}>
                  Motivo da decisão <span style={{ color: S.danger }}>*</span>
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Por que você está decidindo assim? Esta justificativa fica na auditoria."
                  className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none resize-y"
                  style={{ background: SURFACE_INPUT, borderColor: S.border, color: S.textPrimary }}
                />
                {!motivoOk && motivo.length > 0 && (
                  <p className="text-[11px] mt-1" style={{ color: S.textMuted }}>
                    Escreva ao menos 5 caracteres.
                  </p>
                )}

                {ehBloqueio && !aplicada && (
                  <label className="mt-3 flex items-start gap-2 text-xs cursor-pointer" style={{ color: S.textSecondary }}>
                    <input
                      type="checkbox"
                      checked={desbloqueio}
                      onChange={(e) => setDesbloqueio(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Esta operação está classificada como <strong style={{ color: S.danger }}>bloqueio</strong>.
                      Confirmo o desbloqueio explícito, ciente do impacto acima.
                    </span>
                  </label>
                )}

                {erro && (
                  <p className="text-xs mt-3" style={{ color: S.danger }}>
                    {erro}
                  </p>
                )}
                {aviso && (
                  <p className="text-xs mt-1" style={{ color: S.warning }}>
                    {aviso}
                  </p>
                )}

                <div className="flex items-center gap-2 flex-wrap mt-4">
                  {!decidida && podeDecidir && (
                    <>
                      <PrimaryButton
                        icon={enviando === "aprovar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        onClick={() => (motivoOk && desbloqueioOk && !enviando ? decidir("aprovar") : undefined)}
                        className={motivoOk && desbloqueioOk && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                      >
                        Aprovar e aplicar
                      </PrimaryButton>
                      <SecondaryButton
                        icon={enviando === "rejeitar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
                        onClick={() => (motivoOk && !enviando ? decidir("rejeitar") : undefined)}
                        className={motivoOk && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                      >
                        Rejeitar
                      </SecondaryButton>
                      <SecondaryButton
                        icon={enviando === "adiar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                        onClick={() => (motivoOk && !enviando ? decidir("adiar") : undefined)}
                        className={motivoOk && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                      >
                        Adiar
                      </SecondaryButton>
                    </>
                  )}

                  {aplicada && podeReverter && (
                    <SecondaryButton
                      icon={enviando === "reverter" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      onClick={() => (motivoOk && !enviando ? decidir("reverter") : undefined)}
                      className={motivoOk && !enviando ? "" : "opacity-50 cursor-not-allowed"}
                    >
                      Reverter aplicação
                    </SecondaryButton>
                  )}
                  {aplicada && !podeReverter && (
                    <p className="text-xs" style={{ color: S.textMuted }}>
                      Reverter exige a permissão dedicada de reversão.
                    </p>
                  )}
                </div>
              </>
            )}
          </SectionCard>
        </div>
      </aside>
    </>,
    document.body,
  )
}

function ListaEvidencias({
  titulo,
  itens,
  tom,
}: {
  titulo: string
  itens: Array<{ campo: string; descricao: string; peso: number }>
  tom: "success" | "danger"
}) {
  const cor = tom === "success" ? S.success : S.danger
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: cor }}>
        {titulo} ({itens.length})
      </div>
      {itens.length === 0 ? (
        <p className="text-xs" style={{ color: S.textMuted }}>
          nenhuma
        </p>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((e, i) => (
            <li key={`${e.campo}-${i}`} className="text-xs leading-snug" style={{ color: S.textSecondary }}>
              {e.descricao}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Metrica({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px]" style={{ color: S.textMuted }}>
        {rotulo}
      </span>
      <span
        className="text-sm font-semibold tabular-nums"
        style={{ color: alerta && valor > 0 ? S.danger : S.textPrimary }}
      >
        {valor}
      </span>
    </div>
  )
}

export { tomDaSeveridade }
