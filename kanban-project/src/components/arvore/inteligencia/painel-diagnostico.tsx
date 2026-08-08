"use client"

// src/components/arvore/inteligencia/painel-diagnostico.tsx
// ============================================================================
// DIAGNÓSTICO — o indicador no topo e a lista do que trava.
//
// Duas peças, na mesma gramática dos controles que já existiam:
//
//   • `SeloSaude` — botão discreto no canto superior direito, ao lado de
//     "Buscar"/"Análise". Diz "Processo saudável" ou "7 pendências". Nada de
//     dashboard sobre a árvore: é um botão do tamanho dos outros.
//
//   • `PainelDiagnostico` — drawer `fixed` por cima do canvas, igual ao painel
//     de Inteligência que já existe. Abrir e fechar não move um card.
//
// Cada problema mostra PESSOA, MOTIVO, IMPACTO, FONTE e AÇÃO — e o clique leva
// direto à pessoa, com o painel dela já aberto. O operador não procura à mão.
// ============================================================================

import { AlertTriangle, CircleCheck, TriangleAlert, X } from "lucide-react"
import {
  ROTULO_CATEGORIA,
  type Diagnostico,
  type NivelSaude,
  type AcaoRecomendada,
} from "@/src/lib/genealogia/operacional/diagnostico"

/** Cores por nível. Mesma paleta dos cartões de insight que já existiam. */
const CORES: Record<NivelSaude, { texto: string; fundo: string; borda: string }> = {
  saudavel: { texto: "#067647", fundo: "#ecfdf3", borda: "#abefc6" },
  atencao: { texto: "#b54708", fundo: "#fffaeb", borda: "#fedf89" },
  critico: { texto: "#b42318", fundo: "#fef3f2", borda: "#fecdca" },
}

export function SeloSaude({
  diagnostico,
  onAbrir,
  ativo,
}: {
  diagnostico: Diagnostico
  onAbrir: () => void
  ativo: boolean
}) {
  const cor = CORES[diagnostico.saude]
  const Icone =
    diagnostico.saude === "saudavel"
      ? CircleCheck
      : diagnostico.saude === "critico"
        ? AlertTriangle
        : TriangleAlert

  return (
    <button
      onClick={onAbrir}
      title="Diagnóstico do processo (D)"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-sm transition ${
        ativo ? "border-gray-300 bg-gray-50 font-medium text-gray-900" : "hover:border-gray-300"
      }`}
      style={
        ativo
          ? undefined
          : { borderColor: cor.borda, backgroundColor: cor.fundo, color: cor.texto }
      }
    >
      <Icone className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{diagnostico.resumo}</span>
      <span className="sm:hidden tabular-nums">
        {diagnostico.problemas.length || "OK"}
      </span>
    </button>
  )
}

interface Props {
  diagnostico: Diagnostico
  proximaAcao: AcaoRecomendada
  aberto: boolean
  onFechar: () => void
  /** Leva à pessoa: centraliza, dá zoom e abre o painel dela. */
  onIrParaPessoa: (pessoaId: number) => void
  /** Escopo em texto ("linhagem de Marco" | "árvore inteira"). */
  escopo: string
}

export function PainelDiagnostico({
  diagnostico,
  proximaAcao,
  aberto,
  onFechar,
  onIrParaPessoa,
  escopo,
}: Props) {
  if (!aberto) return null
  const cor = CORES[diagnostico.saude]

  // Cor própria na raiz: este painel pode abrir dentro do modal do processo,
  // que é escuro, e `position: fixed` não interrompe herança de cor.
  return (
    <div className="fixed right-0 top-0 z-[10002] flex h-full w-[420px] flex-col border-l border-gray-200 bg-white text-gray-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Diagnóstico</h2>
          <p className="truncate text-[11px] text-gray-500">{escopo}</p>
        </div>
        <button
          onClick={onFechar}
          aria-label="Fechar diagnóstico"
          className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: cor.borda, backgroundColor: cor.fundo }}
        >
          <p className="text-sm font-semibold" style={{ color: cor.texto }}>
            {diagnostico.resumo}
          </p>
          <p className="mt-0.5 text-[12px] text-gray-600">
            {diagnostico.criticos} impeditivo(s) · {diagnostico.atencao} de atenção
          </p>
          {/* Honestidade sobre cobertura: verde sem exigência materializada não
              é aprovação, é ausência de coisa para conferir. */}
          {diagnostico.semExigenciaMaterializada && (
            <p className="mt-2 rounded-md bg-white/70 px-2 py-1.5 text-[11px] leading-snug text-gray-700">
              Nenhuma exigência documental foi materializada para este escopo. O verde significa
              “nada a apontar ainda”, não “conferido e aprovado”.
            </p>
          )}
        </div>

        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Próxima ação
          </h3>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            <p className="text-[13px] leading-snug text-gray-800">
              {proximaAcao.pessoaNome ? (
                <span className="font-medium">{proximaAcao.pessoaNome}: </span>
              ) : null}
              {proximaAcao.acao}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-gray-500">{proximaAcao.motivo}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">
              Prioridade {proximaAcao.prioridade}/7 · Fonte: {proximaAcao.fonte}
            </p>
            {proximaAcao.pessoaId != null && (
              <button
                onClick={() => onIrParaPessoa(proximaAcao.pessoaId!)}
                className="mt-1.5 text-[12px] font-medium text-gray-800 underline underline-offset-2 transition hover:text-gray-950"
              >
                Abrir pessoa
              </button>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Pendências ({diagnostico.problemas.length})
          </h3>
          {diagnostico.problemas.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">
              Nenhuma pendência conhecida neste escopo.
            </p>
          ) : (
            <ol className="space-y-2">
              {diagnostico.problemas.map((p) => {
                const c = p.impeditivo ? CORES.critico : CORES.atencao
                return (
                  <li
                    key={p.id}
                    className="rounded-lg border p-2.5"
                    style={{ borderColor: c.borda, backgroundColor: c.fundo }}
                  >
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: c.texto }}
                    >
                      {p.impeditivo ? "Crítico" : "Atenção"} · {ROTULO_CATEGORIA[p.categoria]}
                    </p>
                    <p className="mt-0.5 text-[13px] font-medium leading-snug text-gray-900">
                      {p.titulo}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-gray-600">{p.motivo}</p>
                    <p className="mt-1 text-[11px] leading-snug text-gray-600">{p.impacto}</p>
                    <p className="mt-1.5 text-[11px] font-medium leading-snug text-gray-800">
                      → {p.acao}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] uppercase tracking-wide text-gray-400">
                        Fonte: {p.fonte}
                      </span>
                      {p.pessoaId != null && (
                        <button
                          onClick={() => onIrParaPessoa(p.pessoaId!)}
                          className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
                        >
                          Abrir pessoa
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
