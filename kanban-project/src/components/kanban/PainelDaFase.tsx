// src/components/kanban/PainelDaFase.tsx
//
// ÍNDICE OPERACIONAL DA FASE.
//
// REGRA DE INTERFACE (a razão de este arquivo existir):
//
//   A Central Operacional INDEXA. O modal do documento EXECUTA.
//
//   Central Operacional
//   └── Linha principal / Fora da linhagem
//       └── PESSOA (card, com contadores)
//           └── DOCUMENTO (uma linha na tabela)
//               └── "Abrir detalhes" → modal do documento → aba Workflow
//                                      └── passos, status, responsável, SLA,
//                                          bloqueios, ações e Operação Antecipada
//
// FORA DO MODAL não aparece NADA de execução: nem passo, nem nome de passo, nem
// status de passo, nem executor, nem responsável de passo, nem SLA, nem prazo, nem
// motivo de bloqueio, nem botão por passo, nem Operação Antecipada, nem barra de
// progresso do workflow, nem "1/5 passos". Isso não é filtro de renderização — o DTO
// que esta tela recebe (IndiceOperacional) não carrega essas coisas.
//
// Duas telas desenhando o mesmo workflow divergem no primeiro dia em que uma delas
// deixa de ser atualizada. Só existe um executor: a aba Workflow do documento.

"use client"

import { useState } from "react"
import {
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
  Star,
  Users,
  AlertTriangle,
  Layers,
} from "lucide-react"
import type {
  DocumentoDoIndice,
  IndiceOperacional,
  PessoaDoIndice,
  StatusResumo,
} from "@/src/lib/process-stage/estrutura-operacional-core"

// ============================================================
// TIPOS
// ============================================================

export type { DocumentoDoIndice, IndiceOperacional, PessoaDoIndice }

export interface FaseKpi {
  label: string
  value: number
  tone?: "" | "ok" | "busca" | "late"
}

export interface PainelDaFaseProps {
  faseNome: string                 // "Emissão documental"
  faseSub: string                  // subtítulo da fase
  faseTabs: string[]               // abas do mockup pra essa fase
  kpis: FaseKpi[]                  // contadores agregados (calculados no backend)
  progressoPct: number             // % da fase (projeção operacional canônica)
  progressoConcluidos: number
  progressoTotal: number
  progressoTexto: string
  /** ÍNDICE OFICIAL da fase — pessoas e documentos. Sem nada de execução. */
  indice: IndiceOperacional
  /**
   * Identidade da fase exibida (processo + fase + ciclo). Trocar de fase RESETA a
   * expansão: manter o card de outra fase aberto mostraria a posição de um trabalho
   * que não é este.
   */
  chaveExpansao: string
  /** Abre o MODAL do documento — a única porta para a execução. */
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  onAbrirPainelCompleto?: () => void
  /** Consulta de fase passada: mesmo layout, sem ações de mutação. */
  readOnly?: boolean
  // LEGADO_INATIVO (desativação Genealogia): em modo reestruturação o painel NÃO
  // exibe KPIs/progresso antigos (derivados de Documento.status + linhaReta).
  modoReestruturacao?: boolean
  avisoReestruturacao?: string
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function PainelDaFase({
  faseNome,
  faseSub,
  faseTabs,
  kpis,
  progressoPct,
  progressoConcluidos,
  progressoTotal,
  progressoTexto,
  indice,
  chaveExpansao,
  onAbrirDetalhes,
  onAbrirPainelCompleto,
  readOnly = false,
  modoReestruturacao = false,
  avisoReestruturacao,
}: PainelDaFaseProps) {
  const [abaAtiva, setAbaAtiva] = useState("Resumo")

  return (
    <div>
      {/* ============== CABEÇALHO DA FASE ============== */}
      <div className="bg-[#1b2027] border border-white/10 border-b-0 rounded-t-2xl px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[19px] font-extrabold text-white/95">{faseNome}</h2>
          </div>
          <button
            onClick={onAbrirPainelCompleto}
            className="inline-flex items-center gap-1.5 border-[1.5px] border-white/10 bg-[#1b2027] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap hover:border-white/20 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir painel da fase
          </button>
        </div>
        <div className="text-[13px] text-white/55 mt-1.5">{faseSub}</div>

        <div className="flex gap-1 overflow-x-auto mt-3.5 border-b border-white/10">
          {faseTabs.map((t) => (
            <button
              key={t}
              onClick={() => setAbaAtiva(t)}
              className={`text-[12.5px] font-semibold px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
                abaAtiva === t
                  ? "border-[#2563eb] text-white"
                  : "text-white/55 border-transparent hover:text-white/95"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ============== CORPO DA FASE ============== */}
      <div className="bg-[#1b2027] border border-white/10 border-t-0 rounded-b-2xl px-5 py-5">

        {modoReestruturacao ? (
          <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-5 py-4 mb-5">
            <div className="text-[13px] font-bold text-[#d2a948] mb-1">Fase em reestruturação</div>
            <div className="text-[12.5px] text-[#d2a948] leading-relaxed">
              {avisoReestruturacao ||
                "A definição documental da Genealogia está em reestruturação. Nenhum progresso automático é calculado nesta etapa."}
            </div>
            <div className="text-[11.5px] text-[#d2a948]/80 mt-2">
              A árvore e os dados civis continuam disponíveis. Documentos exibidos são
              registros operacionais existentes — não representam obrigatoriedade nem validação.
            </div>
          </div>
        ) : (
        <>
          {/* --- RESUMO AGREGADO DA FASE --- Contadores vêm do backend, nunca de
              contar elementos renderizados. auto-fit para o número nunca ser espremido. */}
          <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))" }}>
            {kpis.map((k, i) => {
              const cor =
                k.tone === "ok" ? "text-[#4ade80]"
                : k.tone === "busca" ? "text-[#d2a948]"
                : k.tone === "late" ? "text-[#f87171]"
                : "text-white/95"
              return (
                <div key={i} className="bg-[#1b2027] border border-white/10 rounded-[10px] px-4 py-3">
                  <b className={`text-[22px] font-extrabold block leading-none ${cor}`}>{k.value}</b>
                  <span className="text-[11px] text-white/40 font-semibold block mt-1.5">{k.label}</span>
                </div>
              )
            })}
          </div>

          {/* --- PROGRESSO DA FASE (projeção operacional canônica) --- */}
          <div className="bg-[#1b2027] border border-white/10 rounded-xl px-5 py-4 mb-5">
            <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
              <div>
                <div className="text-[13px] font-semibold text-white/55 mb-1">Progresso da fase {faseNome}</div>
                <div className="text-[28px] font-extrabold text-white/95 leading-none">{progressoPct}%</div>
              </div>
              <div className="text-[13px] text-white/55">{progressoConcluidos} de {progressoTotal} documentos validados</div>
            </div>
            <div className="h-1.5 bg-[#252c35] rounded-full overflow-hidden mt-3">
              <div className="h-full bg-[#7dd3fc] transition-all duration-500" style={{ width: `${progressoPct}%` }} />
            </div>
            <div className="text-center text-[12.5px] text-white/40 mt-3">{progressoTexto}</div>
          </div>
        </>
        )}

        {/* --- ÍNDICE: pessoas e documentos --- */}
        <IndiceView
          indice={indice}
          chaveExpansao={chaveExpansao}
          onAbrirDetalhes={onAbrirDetalhes}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

// ============================================================
// ÍNDICE
// ============================================================

/** Acima disto os cards nascem fechados: abrir tudo viraria um muro. */
const LIMITE_AUTO_EXPANSAO = 12

interface Expansao {
  chave: string
  semeado: boolean
  abertos: Set<string>
}

function semear(chave: string, indice: IndiceOperacional): Expansao {
  const abertos = new Set<string>()
  if (indice.resumo.documentos > 0 && indice.resumo.documentos <= LIMITE_AUTO_EXPANSAO) {
    for (const p of [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao]) {
      if (!p.semDocumentoAplicavel) abertos.add(`pessoa:${p.pessoa.pessoaId}`)
    }
  }
  return { chave, semeado: indice.resumo.documentos > 0, abertos }
}

function IndiceView({
  indice,
  chaveExpansao,
  onAbrirDetalhes,
  readOnly,
}: {
  indice: IndiceOperacional
  chaveExpansao: string
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  readOnly: boolean
}) {
  // Expansão local, por processo/fase. Preferência visual não vai ao banco.
  // O ajuste acontece DURANTE a renderização (padrão do React para estado derivado de
  // prop), não num efeito: um efeito que dependesse do índice fecharia os cards a cada
  // revalidação em segundo plano, e o operador perderia a posição no meio do trabalho.
  const [expansao, setExpansao] = useState<Expansao>(() => semear(chaveExpansao, indice))
  let atual = expansao
  if (atual.chave !== chaveExpansao || (!atual.semeado && indice.resumo.documentos > 0)) {
    atual = semear(chaveExpansao, indice)
    setExpansao(atual)
  }
  const abertos = atual.abertos

  const alternar = (chave: string) =>
    setExpansao((prev) => {
      const proximo = new Set(prev.abertos)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return { ...prev, abertos: proximo }
    })

  const totalPessoas =
    indice.linhaPrincipal.length + indice.foraDaLinha.length + indice.pendenteClassificacao.length

  if (totalPessoas === 0 && indice.semDono.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl px-5 py-8 text-center">
        <div className="text-[13px] text-white/68">Esta fase não tem trabalho materializado.</div>
        <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
          Publique os passos da fase em Gerenciamento › Workflows das Fases. Enquanto
          não houver passo publicado, não há o que executar aqui.
        </div>
      </div>
    )
  }

  const grupo = (
    icone: React.ReactNode,
    titulo: string,
    tone: "linha" | "fora" | "pendente",
    pessoas: PessoaDoIndice[],
  ) =>
    pessoas.length === 0 ? null : (
      <div className="mb-5 last:mb-0">
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className={`w-[22px] h-[22px] rounded-lg grid place-items-center flex-none ${
            tone === "pendente" ? "bg-[#d2a948]/20 text-[#d2a948]" : tone === "fora" ? "bg-[#252c35] text-white/40" : "bg-[#252c35] text-white/55"
          }`}>
            {icone}
          </span>
          <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">{titulo}</b>
          <span className="ml-auto text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
            {pessoas.length} pessoa(s)
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {pessoas.map((p) => (
            <PessoaCard
              key={p.pessoa.pessoaId} linha={p}
              aberto={abertos.has(`pessoa:${p.pessoa.pessoaId}`)}
              alternar={() => alternar(`pessoa:${p.pessoa.pessoaId}`)}
              onAbrirDetalhes={onAbrirDetalhes} readOnly={readOnly}
            />
          ))}
        </div>
      </div>
    )

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[22px] h-[22px] rounded-lg grid place-items-center flex-none bg-[#252c35] text-white/55">
          <Layers className="w-3 h-3" />
        </span>
        <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">Documentos por pessoa</b>
        <span className="ml-auto text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
          {indice.resumo.documentos} documento(s)
        </span>
      </div>

      {grupo(<Star className="w-3 h-3" />, "Linha principal · transmissão de cidadania", "linha", indice.linhaPrincipal)}
      {grupo(<Users className="w-3 h-3" />, "Fora da linhagem · cônjuges / apoio", "fora", indice.foraDaLinha)}
      {grupo(<AlertTriangle className="w-3 h-3" />, "Pendente de classificação · revisar cadastro", "pendente", indice.pendenteClassificacao)}

      {/* DOCUMENTO SEM PESSOA NO ROSTER — cadastro inconsistente. Fica VISÍVEL:
          sumir seria esconder trabalho real que ninguém veria de novo. */}
      {indice.semDono.length > 0 && (
        <div className="rounded-xl border border-[#d2a948]/30 bg-[#d2a948]/[0.07] overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[#d2a948]/20">
            <AlertTriangle className="w-3.5 h-3.5 text-[#d2a948] flex-none" />
            <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-[#d2a948]">
              Sem pessoa vinculada · revisar cadastro do registro
            </b>
          </div>
          <TabelaDocumentos docs={indice.semDono} onAbrirDetalhes={onAbrirDetalhes} readOnly={readOnly} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PESSOA — card do índice
// ------------------------------------------------------------
// A pessoa existe na Central pelo vínculo com a árvore. Aparece com ou sem documento
// aplicável: quem não tem trabalho nesta fase diz isso em texto, e não conta como
// pendência nem bloqueia a conclusão.
function PessoaCard({
  linha,
  aberto,
  alternar,
  onAbrirDetalhes,
  readOnly,
}: {
  linha: PessoaDoIndice
  aberto: boolean
  alternar: () => void
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  readOnly: boolean
}) {
  const p = linha.pessoa
  const t = linha.totais
  const podeAbrir = !linha.semDocumentoAplicavel

  const transmissao =
    p.classificacao === "LINHA_PRINCIPAL"
      ? { cor: "text-[#4ade80]", dot: "bg-[#4ade80]", label: "Na linha de transmissão" }
      : p.classificacao === "FORA_DA_LINHAGEM"
        ? { cor: "text-white/40", dot: "bg-white/25", label: "Fora da linha" }
        : { cor: "text-[#f87171]", dot: "bg-[#f87171]", label: "Classificação pendente" }

  return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] overflow-hidden">
      <button
        type="button"
        onClick={() => podeAbrir && alternar()}
        disabled={!podeAbrir}
        className={`w-full text-left flex items-center gap-4 px-4 py-3.5 transition-colors ${podeAbrir ? "hover:bg-[#20262e]" : "cursor-default"}`}
      >
        <span className="w-10 h-10 rounded-full grid place-items-center text-white font-extrabold text-[13px] flex-none bg-[#252c35]">
          {p.iniciais}
        </span>

        <span className="min-w-0 flex-1">
          <b className="text-[14.5px] font-extrabold block leading-tight truncate text-white/95">{p.nome}</b>
          <span className="text-[11.5px] text-white/40 font-semibold flex items-center gap-1.5 mt-0.5 flex-wrap">
            {p.geracao != null && (
              <span className="text-[10px] font-extrabold bg-[#252c35] border border-white/10 rounded px-1.5 py-px">
                G{p.geracao + 1}
              </span>
            )}
            <span className="truncate">{[p.publicCode, p.requerente ? "Requerente" : p.posicao].filter(Boolean).join(" · ")}</span>
            <span className={`flex items-center gap-1 ${transmissao.cor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${transmissao.dot}`} />
              {transmissao.label}
            </span>
          </span>
          {p.pendencia && (
            <span className="text-[11px] text-[#d2a948] font-semibold flex items-start gap-1.5 leading-snug mt-1">
              <AlertTriangle className="w-3 h-3 flex-none mt-px" />
              {p.pendencia}
            </span>
          )}
        </span>

        {/* CONTADORES — do backend, nunca contando o que está na tela */}
        {linha.semDocumentoAplicavel ? (
          <span className="text-[12px] text-white/40 flex-none">Nenhum documento aplicável nesta fase</span>
        ) : (
          <span className="flex items-center gap-5 flex-none">
            <Pilula valor={t.documentos} rotulo="documentos" />
            <Pilula valor={t.prontos} rotulo="prontos" tone="ok" />
            <Pilula valor={t.pendentes} rotulo="pendentes" tone="busca" />
            {t.divergentes > 0 && <Pilula valor={t.divergentes} rotulo="divergentes" tone="late" />}
          </span>
        )}

        <span className="text-white/40 flex-none w-4">
          {!podeAbrir ? null : aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {aberto && podeAbrir && (
        <div className="border-t border-white/10">
          <TabelaDocumentos docs={linha.documentos} onAbrirDetalhes={onAbrirDetalhes} readOnly={readOnly} />
        </div>
      )}
    </div>
  )
}

function Pilula({ valor, rotulo, tone }: { valor: number; rotulo: string; tone?: "ok" | "busca" | "late" }) {
  const cor =
    tone === "ok" ? "text-[#4ade80]" : tone === "busca" ? "text-[#d2a948]" : tone === "late" ? "text-[#f87171]" : "text-white/95"
  return (
    <span className="text-center block">
      <b className={`text-[16px] font-extrabold block leading-none ${cor}`}>{valor}</b>
      <span className="text-[10px] text-white/40 font-semibold block mt-1">{rotulo}</span>
    </span>
  )
}

// ------------------------------------------------------------
// DOCUMENTOS DA PESSOA — uma linha por documento, sem execução
// ------------------------------------------------------------
// As colunas respondem "onde este documento está", não "o que fazer agora". O que
// fazer agora vive no modal, atrás de "Abrir detalhes".
const COLUNAS = "minmax(220px,2.2fr) 104px 104px 104px 104px 128px 132px"

function TabelaDocumentos({
  docs,
  onAbrirDetalhes,
  readOnly,
}: {
  docs: DocumentoDoIndice[]
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  readOnly: boolean
}) {
  if (docs.length === 0) {
    return <div className="px-4 py-4 text-[12px] text-white/40">Nenhum documento aplicável nesta fase.</div>
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div
          className="grid items-end gap-3 px-4 py-2 bg-[#20262e] border-b border-white/10 text-[10px] font-bold uppercase tracking-wider text-white/40"
          style={{ gridTemplateColumns: COLUNAS }}
        >
          <div>Documento</div>
          <div>Certidão</div>
          <div>Retificada</div>
          <div>Tradução</div>
          <div>Apostila</div>
          <div>Status final</div>
          <div className="text-right">Ações</div>
        </div>
        {docs.map((d) => (
          <LinhaDocumento key={d.chave} doc={d} onAbrirDetalhes={onAbrirDetalhes} readOnly={readOnly} />
        ))}
      </div>
    </div>
  )
}

const CLS_ARTEFATO: Record<StatusResumo, string> = {
  PRONTO: "text-[#4ade80]",
  EM_ANDAMENTO: "text-[#7dd3fc]",
  PENDENTE: "text-white/68",
  DIVERGENTE: "text-[#f87171]",
  INVALIDADO: "text-[#f87171]",
  NAO_APLICAVEL: "text-white/25",
}

const CLS_BADGE: Record<StatusResumo, string> = {
  PRONTO: "bg-[#4ade80]/15 text-[#4ade80]",
  EM_ANDAMENTO: "bg-[#7dd3fc]/15 text-[#7dd3fc]",
  PENDENTE: "bg-[#252c35] text-white/68",
  DIVERGENTE: "bg-[#f87171]/15 text-[#f87171]",
  INVALIDADO: "bg-[#f87171]/15 text-[#f87171]",
  NAO_APLICAVEL: "bg-transparent text-white/25",
}

const MARCA: Record<StatusResumo, string> = {
  PRONTO: "Pronto",
  EM_ANDAMENTO: "Em andamento",
  PENDENTE: "Pendente",
  DIVERGENTE: "Divergente",
  INVALIDADO: "Invalidado",
  NAO_APLICAVEL: "—",
}

function Artefato({ status }: { status: StatusResumo }) {
  return <span className={`text-[12px] font-semibold ${CLS_ARTEFATO[status]}`}>{MARCA[status]}</span>
}

function LinhaDocumento({
  doc,
  onAbrirDetalhes,
  readOnly,
}: {
  doc: DocumentoDoIndice
  onAbrirDetalhes?: (doc: DocumentoDoIndice) => void
  readOnly: boolean
}) {
  const pode = !!onAbrirDetalhes && doc.podeAbrirDetalhes
  return (
    <div
      className="grid items-center gap-3 px-4 py-3 border-b border-white/[0.07] last:border-b-0 hover:bg-[#20262e]/60 transition-colors"
      style={{ gridTemplateColumns: COLUNAS }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-7 h-7 rounded-lg grid place-items-center border border-white/10 bg-[#252c35] text-white/55 flex-none">
          <FileText className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <b className="text-[13px] font-bold block leading-tight truncate text-white/95">{doc.titulo}</b>
          <span className="text-[11px] text-white/40 block truncate">
            {[doc.tipoLabel, doc.pais].filter(Boolean).join(" · ") || "Certidão do processo"}
          </span>
        </div>
      </div>

      <Artefato status={doc.artefatos.certidao} />
      <Artefato status={doc.artefatos.retificada} />
      <Artefato status={doc.artefatos.traducao} />
      <Artefato status={doc.artefatos.apostila} />

      <div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${CLS_BADGE[doc.statusFinal]}`}>
          {doc.statusFinalLabel}
        </span>
      </div>

      <div className="flex justify-end">
        {pode ? (
          <button
            type="button"
            onClick={() => onAbrirDetalhes!(doc)}
            className="inline-flex items-center gap-1.5 bg-[#252c35] text-white/95 border border-white/10 text-[12px] font-bold px-3 py-1.5 rounded-lg hover:bg-[#2d353f] transition-colors whitespace-nowrap"
          >
            Abrir detalhes <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          // Sem executor configurado: o documento CONTINUA visível e o que falta é
          // dito em texto. Esconder a linha seria mentir sobre o trabalho.
          <span className="text-[11px] font-semibold text-[#d2a948] text-right leading-snug" title={doc.impedimento ?? undefined}>
            {readOnly ? "Somente leitura" : "Sem executor"}
          </span>
        )}
      </div>
    </div>
  )
}
