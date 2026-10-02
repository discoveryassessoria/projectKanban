"use client"

// src/components/arvore/fila-da-pessoa.tsx
// ============================================================================
// FILA DE TRABALHO DA PESSOA — a aba Operação (Etapa 4).
//
// Só DESENHA o que `montarFilaDaPessoa` (módulo puro) decidiu: cada documento real
// da pessoa com o estado que tem agora, e cada divergência do motor, cada um com
// o(s) botão(ões) que levam ao alvo real. Nenhuma regra mora aqui.
//
// Todo botão nasce ligado: `useExecutarAcaoDaFila` tem UM caso para cada tipo de
// ação que o módulo puro pode produzir (o `switch` é exaustivo — ação nova que
// ninguém tratou não compila).
// ============================================================================

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, FileText, TriangleAlert } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { linkDoAvisoParaAdmin } from "@/src/lib/torre-absorcao"
import { ROTULO_AGUARDANDO_FECHAMENTO } from "@/src/lib/process-stage/fase-pre-contrato"
import {
  linkDaTarefaNaCentral,
  type AcaoFila,
  type EstadoDocumento,
  type FilaDaPessoa,
  type ItemFila,
} from "@/src/lib/genealogia/operacional/fila-da-pessoa"
import type { DossiePessoa } from "@/src/lib/genealogia/operacional/dossie"

// ── AÇÕES ───────────────────────────────────────────────────────────────────

export interface DestinosDaFila {
  /** Foca a pessoa no mapa e abre o painel dela na aba Operação. */
  onAbrirPessoa?: (pessoaId: number) => void
  /** Abre o modal de vincular cônjuges (porta oficial de criação de união). */
  onVincularConjuge?: (pessoaId: number, outraPessoaId: number | null) => void
}

/** Executa a ação de um item da fila. Estável enquanto os destinos forem estáveis. */
export function useExecutarAcaoDaFila(destinos: DestinosDaFila): (acao: AcaoFila) => void {
  const router = useRouter()
  const { tipo } = usePermissoes()
  const { onAbrirPessoa, onVincularConjuge } = destinos
  return useCallback(
    (acao: AcaoFila) => {
      switch (acao.tipo) {
        case "abrir_tarefa": {
          const link = linkDaTarefaNaCentral(acao.processoId, acao.tarefaId)
          router.push(linkDoAvisoParaAdmin(link, tipo) ?? link)
          return
        }
        case "abrir_pessoa":
        case "ver_no_mapa":
          onAbrirPessoa?.(acao.pessoaId)
          return
        case "vincular_conjuge":
          onVincularConjuge?.(acao.pessoaId, acao.outraPessoaId)
          return
      }
    },
    [router, tipo, onAbrirPessoa, onVincularConjuge],
  )
}

/** Um botão só existe se o destino dele existe — nunca botão morto. */
export function acaoDisponivel(acao: AcaoFila, destinos: DestinosDaFila): boolean {
  switch (acao.tipo) {
    case "abrir_tarefa": return true
    case "abrir_pessoa":
    case "ver_no_mapa": return Boolean(destinos.onAbrirPessoa)
    case "vincular_conjuge": return Boolean(destinos.onVincularConjuge)
  }
}

// ── APARÊNCIA ───────────────────────────────────────────────────────────────

const ESTILO_ESTADO: Record<EstadoDocumento, string> = {
  bloqueado: "bg-[var(--danger-tile)] text-[var(--danger-text)]",
  a_localizar: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  a_solicitar: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  solicitado: "bg-[var(--info-tile)] text-[var(--info-text)]",
  recebido: "bg-[var(--success-tile)] text-[var(--success-text)]",
  dispensado: "bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
}

function BotaoDeAcao({
  acao,
  destaque,
  onExecutar,
}: {
  acao: AcaoFila
  destaque: boolean
  onExecutar: (a: AcaoFila) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onExecutar(acao)}
      className={
        destaque
          ? "inline-flex items-center gap-1 rounded-md bg-[var(--action-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
          : "inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      }
    >
      {acao.rotulo}
      {destaque && <ArrowRight className="h-3 w-3" aria-hidden />}
    </button>
  )
}

function LinhaDaFila({
  item,
  destinos,
  onExecutar,
}: {
  item: ItemFila
  destinos: DestinosDaFila
  onExecutar: (a: AcaoFila) => void
}) {
  const acoes = item.acoes.filter((a) => acaoDisponivel(a, destinos))

  if (item.tipo === "documento") {
    return (
      <li
        data-fila-documento={item.necessidadeId}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="flex min-w-0 items-start gap-1.5 text-sm font-medium leading-snug text-[var(--text-primary)]">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <span className="min-w-0">
              {item.nome}
              {item.opcional && <span className="ml-1 text-[11px] font-normal text-[var(--text-secondary)]">(opcional)</span>}
            </span>
          </p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTILO_ESTADO[item.estado]}`}>
            {item.rotuloEstado}
          </span>
        </div>
        {item.detalhe && <p className="mt-0.5 pl-5 text-[11px] text-[var(--text-secondary)]">{item.detalhe}</p>}
        {acoes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
            {acoes.map((a, i) => (
              <BotaoDeAcao key={`${a.tipo}-${i}`} acao={a} destaque={i === 0} onExecutar={onExecutar} />
            ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <li
      data-achado-do-motor={item.achadoId}
      className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2"
    >
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        {item.rotuloEstado}
      </p>
      <p className="mt-0.5 text-sm font-medium leading-snug text-[var(--warning-text)]">{item.titulo}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{item.explicacao}</p>
      {acoes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {acoes.map((a, i) => (
            <BotaoDeAcao key={`${a.tipo}-${i}`} acao={a} destaque={i === 0} onExecutar={onExecutar} />
          ))}
        </div>
      )}
    </li>
  )
}

// ── LISTA (aba Operação) ────────────────────────────────────────────────────

export function ListaDaFila({
  fila,
  mensagemAntesDaGenealogia,
  destinos,
  onExecutar,
}: {
  fila: FilaDaPessoa
  mensagemAntesDaGenealogia: string
  destinos: DestinosDaFila
  onExecutar: (a: AcaoFila) => void
}) {
  if (fila.antesDaGenealogia && fila.itens.length === 0) {
    return (
      <p className="py-2 text-sm italic text-[var(--text-secondary)]" data-fila-antes-da-genealogia>
        {mensagemAntesDaGenealogia}
      </p>
    )
  }
  if (fila.itens.length === 0) {
    return (
      <p className="flex items-center gap-1.5 py-2 text-sm text-[var(--text-secondary)]">
        <CheckCircle2 className="h-4 w-4 text-[var(--success)]" aria-hidden />
        Nenhuma exigência documental nem divergência para esta pessoa.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {fila.itens.map((i) => (
        <LinhaDaFila key={i.chave} item={i} destinos={destinos} onExecutar={onExecutar} />
      ))}
    </ul>
  )
}

// ── RESUMO (topo do painel) ─────────────────────────────────────────────────
// Impacto da pessoa + a PRÓXIMA AÇÃO como botão que executa/abre o alvo. Os
// contadores (Exig./Receb./Pend./Diverg.) saíram: a lista dos documentos é a
// resposta — contar não diz o que fazer.

export function ResumoOperacional({
  dossie,
  fila,
  mensagemAntesDaGenealogia,
  destinos,
  onExecutar,
  nomeDeRequerente,
}: {
  dossie: DossiePessoa
  fila: FilaDaPessoa
  mensagemAntesDaGenealogia: string
  destinos: DestinosDaFila
  onExecutar: (a: AcaoFila) => void
  nomeDeRequerente?: (id: number) => string
}) {
  const d = dossie.documental
  const compartilhada = dossie.requerentesDependentes.length > 1
  const proximo = fila.proximo
  const acaoProxima = proximo?.acoes.find((a) => acaoDisponivel(a, destinos)) ?? null
  const nomeProximo = proximo ? (proximo.tipo === "documento" ? proximo.nome : proximo.titulo) : null
  const faltaTarefa = fila.itens.some((i) => i.tipo === "documento" && i.ordem < 70 && i.acoes.length === 0)

  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--surface-secondary)]/60 px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Resumo operacional
        </span>
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {fila.antesDaGenealogia ? ROTULO_AGUARDANDO_FECHAMENTO : d.progresso == null ? "Sem exigência" : `${d.progresso}% do dossiê`}
        </span>
      </div>

      {fila.antesDaGenealogia && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-secondary)]">{mensagemAntesDaGenealogia}</p>
      )}

      {compartilhada && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-secondary)]">
          {dossie.requerentesDependentes.length} requerentes dependem desta pessoa
          {nomeDeRequerente
            ? `: ${dossie.requerentesDependentes.map(nomeDeRequerente).join(", ")}`
            : ""}
          . Resolver aqui destrava todos.
        </p>
      )}

      {proximo && acaoProxima ? (
        <div className="mt-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Próxima ação
          </p>
          <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">{nomeProximo}</p>
          <button
            type="button"
            data-proxima-acao
            onClick={() => onExecutar(acaoProxima)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-[var(--action-primary)] px-2.5 py-1 text-xs font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
          >
            {acaoProxima.rotulo}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ) : faltaTarefa ? (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-secondary)]">
          Há documento pendente sem tarefa aberta para executar — veja a aba Operação.
        </p>
      ) : null}
    </div>
  )
}
