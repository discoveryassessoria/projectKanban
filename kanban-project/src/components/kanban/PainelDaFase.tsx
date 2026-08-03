// src/components/kanban/PainelDaFase.tsx
//
// Painel da fase operacional. Ordem do que aparece, e por quê:
//
//   1. Cabeçalho da fase (título, subtítulo, abas)
//   2. Resumo AGREGADO da fase (contadores + progresso) — só resumo, sem lista
//   3. ESTRUTURA OPERACIONAL — a única lista de trabalho:
//
//         PESSOA → DOCUMENTO/CERTIDÃO → WORKFLOW DAQUELE DOCUMENTO → PASSOS
//
// Antes, o workflow era agrupado POR PASSO: "Solicitar certidão" aparecia uma vez e,
// dentro dele, as certidões de todas as pessoas misturadas. Isso descreve o cadastro,
// não o trabalho. Ninguém executa "Solicitar certidão"; executa-se "a certidão de
// nascimento da Tereza" — e essa certidão tem a sequência inteira do workflow só
// dela, com progresso, prazo e bloqueio próprios. Concluir o passo do João não pode
// mexer no da Tereza, e a tela precisa mostrar isso.
//
// A Central APRESENTA as instâncias oficiais já materializadas pelo domínio. Não cria
// passo, não copia tarefa, não infere sequência, não monta status. O agrupamento vem
// pronto do backend (getPhaseOperationalStructure), por IDs relacionais oficiais.

"use client"

import { useState } from "react"
import {
  ExternalLink,
  Search,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Star,
  Users,
  ArrowLeftRight,
  Ban,
  AlertTriangle,
  Layers,
} from "lucide-react"
import { FASES } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import type {
  AlvoDaEstrutura,
  EstruturaOperacional,
  PassoDaEstrutura,
  PessoaDaEstrutura,
} from "@/src/lib/process-stage/estrutura-operacional-core"

// Rótulo amigável da fase a partir do código técnico (origem da operação antecipada).
function faseLabel(code: string | null): string {
  if (!code) return "—"
  return FASES[code as FaseCode]?.label ?? code
}

// ============================================================
// TIPOS
// ============================================================

export type { AlvoDaEstrutura, EstruturaOperacional, PassoDaEstrutura, PessoaDaEstrutura }

export interface FaseKpi {
  label: string
  value: number
  tone?: "" | "ok" | "busca" | "late"
}

// Operação Antecipada vinculada a uma necessidade — VÍNCULO com a operação oficial (sem etapas
// próprias). O status vem do workflow OFICIAL da operação-alvo.
export interface OpAntecipadaInline {
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
  // true = documento-alvo É o exigido pela necessidade (será vinculado). false = documento de APOIO
  // (a avaliação captura RESULTADO estruturado; não vincula o doc à necessidade).
  vinculavel: boolean
  encerrada: boolean
}

export type ResultadoAvaliacaoUI = "SIM" | "PARCIAL" | "NAO" | "CANCELAR"
export type AvaliarFn = (id: number, resultado: ResultadoAvaliacaoUI, resultadoObtido: string, resultadoDados?: Record<string, unknown>) => void

export interface PainelDaFaseProps {
  faseNome: string                 // "Emissão documental"
  faseSub: string                  // subtítulo da fase
  faseTabs: string[]               // abas do mockup pra essa fase
  kpis: FaseKpi[]                  // contadores agregados da fase
  progressoPct: number             // % da fase (projeção operacional canônica)
  progressoConcluidos: number
  progressoTotal: number
  progressoTexto: string
  /** ESTRUTURA OFICIAL da fase — a única fonte da lista de trabalho. */
  estrutura: EstruturaOperacional
  /**
   * Identidade da fase exibida (processo + fase + ciclo). Trocar de fase RESETA o
   * estado de expansão: manter o accordion de outra fase aberto mostraria posição de
   * um trabalho que não é este.
   */
  chaveExpansao: string
  /** Abre o passo na tela oficial da operação. undefined ⇒ só leitura. */
  onAbrirPasso?: (p: PassoDaEstrutura) => void
  // OPERAÇÃO ANTECIPADA — capacidade nativa preservada INTEGRALMENTE. Ela pertence ao
  // ALVO (a necessidade), então aparece UMA vez, no cabeçalho do documento a que se
  // refere — e não repetida em cada passo daquele mesmo documento.
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  onAbrirPainelCompleto?: () => void
  // CONSULTA de fase passada (PAST_READ_ONLY): mesmo layout/dados, mas SEM ações de
  // mutação. Só leitura.
  readOnly?: boolean
  // LEGADO_INATIVO (desativação Genealogia): em modo reestruturação, o painel NÃO
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
  estrutura,
  chaveExpansao,
  onAbrirPasso,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  onNovaOperacao,
  onAbrirPainelCompleto,
  readOnly = false,
  modoReestruturacao = false,
  avisoReestruturacao,
}: PainelDaFaseProps) {
  const [abaAtiva, setAbaAtiva] = useState("Resumo")

  return (
    <div>
      {/* ============== CABEÇALHO DA FASE (shell pps) ============== */}
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

        {/* Abas */}
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
          /* --- LEGADO_INATIVO: aviso neutro de reestruturação --- */
          <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-5 py-4 mb-5">
            <div className="text-[13px] font-bold text-[#d2a948] mb-1">
              Fase em reestruturação
            </div>
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
        {/* --- RESUMO AGREGADO DA FASE ---
            Só resumo. A lista de trabalho vive abaixo, dentro de cada documento de
            cada pessoa. Um agregado por passo aqui em cima seria o mesmo workflow
            desenhado duas vezes — e duas representações divergem. */}
        {/* auto-fit em vez de uma coluna por KPI: com 7 contadores numa largura
            pequena, colunas fixas espremem o número até ele deixar de ser legível. */}
        <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(116px, 1fr))" }}>
          {kpis.map((k, i) => {
            const valColor =
              k.tone === "ok" ? "text-[#4ade80]"
              : k.tone === "busca" ? "text-[#d2a948]"
              : k.tone === "late" ? "text-[#f87171]"
              : "text-white/95"
            return (
              <div key={i} className="bg-[#1b2027] border border-white/10 rounded-[10px] px-4 py-3">
                <b className={`text-[22px] font-extrabold block leading-none ${valColor}`}>{k.value}</b>
                <span className="text-[11px] text-white/40 font-semibold block mt-1.5">{k.label}</span>
              </div>
            )
          })}
        </div>

        {/* --- BARRA DE PROGRESSO DA FASE --- */}
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

        {/* --- ESTRUTURA OPERACIONAL — pessoa → documento → workflow → passos --- */}
        <EstruturaOperacionalView
          estrutura={estrutura}
          chaveExpansao={chaveExpansao}
          onAbrirPasso={onAbrirPasso}
          operacoesPorNec={operacoesPorNec}
          onAvaliarOperacao={onAvaliarOperacao}
          onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada}
          onNovaOperacao={onNovaOperacao}
          readOnly={readOnly}
          faseNome={faseNome}
        />
      </div>
    </div>
  )
}

// ============================================================
// ESTRUTURA OPERACIONAL
// ============================================================

interface AcoesEstrutura {
  onAbrirPasso?: (p: PassoDaEstrutura) => void
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  readOnly: boolean
}

/**
 * Quantos documentos ainda cabem abertos de saída. Acima disto a tela abriria como um
 * muro de passos; abaixo, deixar tudo fechado esconderia o trabalho. É uma decisão de
 * APRESENTAÇÃO — não filtra, não altera contagem e não muda nada nos dados.
 */
const LIMITE_AUTO_EXPANSAO = 12

interface Expansao {
  /** Fase a que este estado pertence. */
  chave: string
  /** Já foi semeado com uma estrutura que tinha trabalho. */
  semeado: boolean
  abertos: Set<string>
}

/** Estado inicial: abre quem tem trabalho, quando couber na tela. */
function semear(chave: string, estrutura: EstruturaOperacional): Expansao {
  const abertos = new Set<string>()
  if (estrutura.resumo.documentos > 0 && estrutura.resumo.documentos <= LIMITE_AUTO_EXPANSAO) {
    const pessoas = [...estrutura.linhaPrincipal, ...estrutura.foraDaLinha, ...estrutura.pendenteClassificacao]
    for (const l of pessoas) {
      if (l.semTrabalhoAplicavel) continue
      abertos.add(`pessoa:${l.pessoa.pessoaId}`)
      for (const d of l.documentos) if (!d.concluido) abertos.add(`alvo:${d.chave}`)
    }
  }
  return { chave, semeado: estrutura.resumo.documentos > 0, abertos }
}

function EstruturaOperacionalView({
  estrutura,
  chaveExpansao,
  faseNome,
  ...acoes
}: AcoesEstrutura & {
  estrutura: EstruturaOperacional
  chaveExpansao: string
  faseNome: string
}) {
  // ESTADO DE EXPANSÃO — local, por processo/fase. Preferência visual não vai ao banco.
  //
  // O ajuste acontece DURANTE a renderização (padrão oficial do React para "estado
  // derivado de prop que mudou"), não num efeito: um efeito que dependesse da
  // `estrutura` fecharia os accordions a cada revalidação em segundo plano — o
  // operador perderia a posição no meio do trabalho a cada refresh.
  const [expansao, setExpansao] = useState<Expansao>(() => semear(chaveExpansao, estrutura))
  let atual = expansao
  if (atual.chave !== chaveExpansao || (!atual.semeado && estrutura.resumo.documentos > 0)) {
    atual = semear(chaveExpansao, estrutura)
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
    estrutura.linhaPrincipal.length + estrutura.foraDaLinha.length + estrutura.pendenteClassificacao.length
  const semNada = totalPessoas === 0 && estrutura.globais.length === 0 && estrutura.semDono.length === 0

  return (
    // A hierarquia tem colunas com largura mínima real (pessoa, estado, responsável,
    // prazo, ação). Numa largura pequena elas ESCOAM dentro deste container em vez de
    // espremer o conteúdo até ficar ilegível — e a página nunca ganha scroll lateral.
    <div className="border border-white/10 rounded-xl overflow-x-auto">
      <div className="min-w-[860px]">
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-white/10 bg-[#20262e]/70">
        <span className="w-[22px] h-[22px] rounded-lg grid place-items-center flex-none bg-[#252c35] text-white/55">
          <Layers className="w-3 h-3" />
        </span>
        <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">
          Execução · {faseNome}
        </b>
        <span className="ml-auto flex items-center gap-1.5">
          <Contador texto={`${totalPessoas} pessoa(s)`} />
          <Contador texto={`${estrutura.resumo.documentos} documento(s)`} />
        </span>
      </div>

      {semNada ? (
        <div className="px-5 py-6 text-center">
          <div className="text-[13px] text-white/68">Esta fase não tem trabalho materializado.</div>
          <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
            Publique os passos da fase em Gerenciamento › Workflows das Fases. Enquanto
            não houver passo publicado, não há o que executar aqui.
          </div>
        </div>
      ) : (
        <>
          {/* PASSOS DA FASE INTEIRA (escopo PROCESSO) — uma instância por fase/ciclo.
              Não pertencem a nenhuma pessoa; por isso ficam aqui, e não repetidos
              dentro de cada uma. */}
          {estrutura.globais.length > 0 && (
            <>
              <GroupBar icon={<Layers className="w-3 h-3" />} title="Passos da fase · escopo do processo" contagem={`${estrutura.globais.length} passo(s)`} tone="linha" />
              <div className="bg-[#15191f]">
                {estrutura.globais.map((p) => (
                  <PassoRow key={p.stepInstanceId} p={p} {...acoes} recuo={40} />
                ))}
              </div>
            </>
          )}

          <GroupBar
            icon={<Star className="w-3 h-3" />}
            title="Linha principal · transmissão de cidadania"
            contagem={`${estrutura.linhaPrincipal.length} pessoa(s)`}
            tone="linha"
          />
          {estrutura.linhaPrincipal.map((l) => (
            <PessoaAccordion key={l.pessoa.pessoaId} linha={l} abertos={abertos} alternar={alternar} {...acoes} />
          ))}

          <GroupBar
            icon={<Users className="w-3 h-3" />}
            title="Fora da linhagem · cônjuges / apoio"
            contagem={`${estrutura.foraDaLinha.length} pessoa(s)`}
            tone="fora"
          />
          {estrutura.foraDaLinha.map((l) => (
            <PessoaAccordion key={l.pessoa.pessoaId} linha={l} abertos={abertos} alternar={alternar} {...acoes} />
          ))}

          {/* Só aparece quando há inconsistência REAL de cadastro. Nenhuma pessoa é
              descartada em silêncio. */}
          {estrutura.pendenteClassificacao.length > 0 && (
            <>
              <GroupBar
                icon={<AlertTriangle className="w-3 h-3" />}
                title="Pendente de classificação · revisar cadastro"
                contagem={`${estrutura.pendenteClassificacao.length} pessoa(s)`}
                tone="pendente"
              />
              {estrutura.pendenteClassificacao.map((l) => (
                <PessoaAccordion key={l.pessoa.pessoaId} linha={l} abertos={abertos} alternar={alternar} {...acoes} />
              ))}
            </>
          )}

          {/* ALVO SEM DONO NO ROSTER — cadastro inconsistente (pessoa fora da árvore
              do processo, união sem titular). Fica VISÍVEL: sumir seria esconder
              trabalho real que ninguém veria de novo. */}
          {estrutura.semDono.length > 0 && (
            <>
              <GroupBar
                icon={<AlertTriangle className="w-3 h-3" />}
                title="Sem pessoa vinculada · revisar cadastro do registro"
                contagem={`${estrutura.semDono.length} documento(s)`}
                tone="pendente"
              />
              <div className="bg-[#15191f]">
                {estrutura.semDono.map((d) => (
                  <DocumentoAccordion key={d.chave} doc={d} pessoaId={null} abertos={abertos} alternar={alternar} {...acoes} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      </div>
    </div>
  )
}

function Contador({ texto }: { texto: string }) {
  return (
    <span className="text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
      {texto}
    </span>
  )
}

function GroupBar({
  icon,
  title,
  contagem,
  tone,
}: {
  icon: React.ReactNode
  title: string
  contagem: string
  tone: "linha" | "fora" | "pendente"
}) {
  return (
    <div className={`flex items-center gap-2.5 px-5 py-2.5 border-y border-white/10 ${tone === "pendente" ? "bg-[#d2a948]/12" : tone === "fora" ? "bg-[#252c35]" : "bg-[#20262e]/70"}`}>
      <span className={`w-[22px] h-[22px] rounded-lg grid place-items-center flex-none ${tone === "pendente" ? "bg-[#d2a948]/20 text-[#d2a948]" : tone === "fora" ? "bg-[#252c35] text-white/40" : "bg-[#252c35] text-white/55"}`}>
        {icon}
      </span>
      <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">{title}</b>
      <span className="ml-auto"><Contador texto={contagem} /></span>
    </div>
  )
}

// ------------------------------------------------------------
// PESSOA — nível 1 da execução
// ------------------------------------------------------------
// A pessoa existe na Central pelo vínculo com a árvore. Ela aparece com ou sem
// documento aplicável: quem não tem trabalho nesta fase diz isso, em texto, e não
// conta como pendência nem bloqueia a conclusão.
function PessoaAccordion({
  linha,
  abertos,
  alternar,
  ...acoes
}: AcoesEstrutura & {
  linha: PessoaDaEstrutura
  abertos: Set<string>
  alternar: (chave: string) => void
}) {
  const p = linha.pessoa
  const chave = `pessoa:${p.pessoaId}`
  const aberto = abertos.has(chave)
  const podeAbrir = !linha.semTrabalhoAplicavel
  const prog = linha.progresso

  const transmissao =
    p.classificacao === "LINHA_PRINCIPAL"
      ? { cor: "text-[#4ade80]", dot: "bg-[#4ade80]", label: "Na linha de transmissão", sub: p.posicao }
      : p.classificacao === "FORA_DA_LINHAGEM"
        ? { cor: "text-white/40", dot: "bg-white/25", label: "Fora da linha", sub: "Sem impacto na transmissão" }
        : { cor: "text-[#f87171]", dot: "bg-[#f87171]", label: "Classificação pendente", sub: p.pendencia ?? undefined }

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => podeAbrir && alternar(chave)}
        disabled={!podeAbrir}
        className={`w-full text-left grid items-center gap-2.5 px-5 py-3 transition-colors ${podeAbrir ? "hover:bg-[#20262e]" : "cursor-default"}`}
        style={{ gridTemplateColumns: "52px minmax(180px,2fr) 1.2fr 1.4fr 140px 20px" }}
      >
        {/* Geração */}
        <span className="text-center text-[11px] font-extrabold text-white/55 bg-[#1b2027] border border-white/10 rounded-lg py-1.5 leading-tight block">
          {p.geracao != null ? `G${p.geracao + 1}` : "—"}
        </span>

        {/* Pessoa */}
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-[34px] h-[34px] rounded-full grid place-items-center text-white font-extrabold text-[12.5px] flex-none bg-[#252c35]">
            {p.iniciais}
          </span>
          <span className="min-w-0 block">
            <b className="text-[14px] font-extrabold block leading-tight truncate text-white/95">{p.nome}</b>
            <span className="text-[11.5px] text-white/40 font-semibold block truncate">
              {[p.publicCode, p.requerente ? "Requerente" : p.posicao].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>

        {/* Transmissão */}
        <span className="block min-w-0">
          <span className={`flex items-center gap-1.5 text-[13px] font-bold ${transmissao.cor}`}>
            <span className={`w-2 h-2 rounded-full flex-none ${transmissao.dot}`} />
            {transmissao.label}
          </span>
          {transmissao.sub && <span className="text-[11.5px] text-white/40 font-medium block mt-0.5 truncate">{transmissao.sub}</span>}
        </span>

        {/* Documentos / pendência de cadastro */}
        <span className="block min-w-0">
          {linha.semTrabalhoAplicavel ? (
            <span className="text-[11.5px] text-white/40">Nenhum documento aplicável nesta fase</span>
          ) : (
            <span className="text-[12px] text-white/68">
              {linha.documentos.length} documento(s)
              {linha.passosDaPessoa.length > 0 && ` · ${linha.passosDaPessoa.length} passo(s) da pessoa`}
              {linha.divergentes > 0 && <span className="text-[#f87171]"> · {linha.divergentes} divergente(s)</span>}
            </span>
          )}
          {p.pendencia && (
            <span className="text-[11.5px] text-[#d2a948] font-semibold flex items-start gap-1.5 leading-snug mt-0.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-none mt-px" />
              {p.pendencia}
            </span>
          )}
        </span>

        {/* Progresso da pessoa — soma dos obrigatórios dos alvos dela */}
        <span className="block">
          {linha.semTrabalhoAplicavel ? (
            <span className="text-[11.5px] text-white/25">—</span>
          ) : (
            <>
              <span className="text-[11.5px] text-white/55 font-semibold block mb-1">
                {prog.concluidos}/{prog.total} passo(s)
              </span>
              <span className="block h-1.5 rounded bg-[#252c35] overflow-hidden">
                <span className="block h-full bg-[#7dd3fc]" style={{ width: `${prog.pct}%` }} />
              </span>
            </>
          )}
        </span>

        <span className="text-white/40 flex-none">
          {!podeAbrir ? null : aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {aberto && podeAbrir && (
        <div className="bg-[#15191f] border-t border-white/10">
          {linha.documentos.map((d) => (
            <DocumentoAccordion
              key={d.chave} doc={d} pessoaId={linha.pessoa.pessoaId}
              abertos={abertos} alternar={alternar} {...acoes}
            />
          ))}
          {/* PASSOS DE ESCOPO PESSOA — trabalho da pessoa que não pertence a um
              documento. Não são "documento vazio": têm lugar próprio. */}
          {linha.passosDaPessoa.length > 0 && (
            <div className="border-t border-white/10">
              <div className="px-5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-white/40" style={{ paddingLeft: 40 }}>
                Passos da pessoa
              </div>
              {linha.passosDaPessoa.map((s) => (
                <PassoRow key={s.stepInstanceId} p={s} {...acoes} recuo={56} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// DOCUMENTO / CERTIDÃO — nível 2 da execução
// ------------------------------------------------------------
// Cada documento carrega o workflow COMPLETO da fase aplicado só a ele: sequência,
// progresso, prazo e bloqueio próprios. Concluir "Solicitar certidão" aqui libera o
// próximo passo DESTE documento — nenhum outro.
function DocumentoAccordion({
  doc,
  pessoaId,
  abertos,
  alternar,
  ...acoes
}: AcoesEstrutura & {
  doc: AlvoDaEstrutura
  pessoaId: number | null
  abertos: Set<string>
  alternar: (chave: string) => void
}) {
  const chave = `alvo:${doc.chave}`
  const aberto = abertos.has(chave)
  const ops = doc.necessidadeId != null ? acoes.operacoesPorNec?.get(doc.necessidadeId) ?? [] : []

  const icBorder =
    doc.divergente ? "border-[#f87171]/40 text-[#f87171]"
    : doc.concluido ? "border-[#4ade80]/40 text-[#4ade80]"
    : doc.progresso.concluidos > 0 ? "border-[#2563eb] text-[#7dd3fc]"
    : "border-white/10 text-white/40"

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => alternar(chave)}
        className="w-full text-left flex items-center gap-3 py-2.5 pr-5 hover:bg-[#20262e] transition-colors"
        style={{ paddingLeft: 40 }}
      >
        <span className={`w-7 h-7 rounded-lg grid place-items-center border-[1.5px] flex-none bg-[#1b2027] ${icBorder}`}>
          {doc.divergente ? <Ban className="w-3.5 h-3.5" />
            : doc.concluido ? <CheckCircle2 className="w-3.5 h-3.5" />
            : <FileText className="w-3.5 h-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <b className={`text-[13.5px] font-bold block leading-tight truncate ${doc.concluido ? "text-white/68" : "text-white/95"}`}>
            {doc.titulo}
          </b>
          <span className="text-[11.5px] text-white/40 block truncate">
            {[doc.subtitulo, doc.pais, doc.statusLabel].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>

        {ops.length > 0 && (
          <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#a78bfa]/15 text-[#a78bfa] flex-none">
            {ops.length} antecipada(s)
          </span>
        )}
        {doc.vencido && (
          <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#f87171]/15 text-[#f87171] flex-none">vencido</span>
        )}

        <span className="text-[11.5px] text-white/40 font-semibold flex-none w-24 text-right">
          {doc.progresso.concluidos}/{doc.progresso.total} passo(s)
        </span>
        <span className="w-24 h-1.5 rounded bg-[#252c35] overflow-hidden flex-none">
          <span className="block h-full bg-[#7dd3fc]" style={{ width: `${doc.progresso.pct}%` }} />
        </span>
        <span className="text-white/40 flex-none">
          {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {aberto && (
        <div className="border-t border-white/10 bg-[#12161b]">
          {doc.passos.length === 0 ? (
            <div className="px-5 py-3 text-[12px] text-white/40" style={{ paddingLeft: 56 }}>
              Nenhum passo materializado para este registro.
            </div>
          ) : (
            doc.passos.map((s) => <PassoRow key={s.stepInstanceId} p={s} {...acoes} recuo={56} />)
          )}

          {/* OPERAÇÃO ANTECIPADA — pertence ao ALVO (a necessidade), então vive AQUI,
              no documento a que se refere, e aparece UMA vez. Antes era repetida em
              cada passo do mesmo documento: a mesma operação em cinco lugares. */}
          {!acoes.readOnly && acoes.onNovaOperacao && doc.necessidadeId != null && !doc.concluido && (
            <div className="pb-2 pr-5" style={{ paddingLeft: 56 }}>
              <button
                type="button"
                onClick={() => acoes.onNovaOperacao!(doc.necessidadeId as number, pessoaId, doc.titulo)}
                className="text-[11px] font-semibold text-white/40 hover:text-[#7dd3fc] underline decoration-dotted underline-offset-2"
              >
                + operação antecipada
              </button>
            </div>
          )}
          {ops.length > 0 && (
            <OperacoesAntecipadasInline
              ops={ops} readOnly={acoes.readOnly}
              onAvaliar={acoes.onAvaliarOperacao} onAbrir={acoes.onAbrirOperacaoAntecipada}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// PASSO — nível 3 da execução
// ------------------------------------------------------------
// Estado, responsável, prazo e disponibilidade vêm PERSISTIDOS do domínio. A tela não
// decide se o passo pode ser executado; ela mostra o que o motor gravou, incluindo o
// motivo de estar parado.
function PassoRow({
  p,
  recuo,
  onAbrirPasso,
  readOnly,
}: AcoesEstrutura & { p: PassoDaEstrutura; recuo: number }) {
  const concluida = p.balde === "CONCLUIDA"
  const podeAbrir = !readOnly && !!onAbrirPasso && !!p.executor && (p.disponivel || concluida)

  const icone = concluida ? <CheckCircle2 className="w-3.5 h-3.5" />
    : p.bloqueado ? <Ban className="w-3.5 h-3.5" />
    : p.balde === "EM_ANDAMENTO" ? <Search className="w-3.5 h-3.5" />
    : <Clock className="w-3.5 h-3.5" />
  const icBorder = concluida ? "border-[#4ade80]/40 text-[#4ade80]"
    : p.bloqueado ? "border-white/10 text-white/25"
    : p.balde === "EM_ANDAMENTO" ? "border-[#2563eb] text-[#7dd3fc]"
    : "border-white/10 text-white/40"

  return (
    <button
      type="button"
      onClick={() => podeAbrir && onAbrirPasso!(p)}
      disabled={!podeAbrir}
      title={p.erroAdministrativo ?? p.motivoBloqueio ?? (readOnly ? "Somente leitura" : `Abrir: ${p.titulo}`)}
      className={`w-full text-left grid items-center gap-2.5 pr-5 py-2.5 border-b border-white/10 last:border-b-0 transition-colors ${
        podeAbrir ? "hover:bg-[#20262e] cursor-pointer" : "cursor-default"
      }`}
      style={{ paddingLeft: recuo, gridTemplateColumns: "24px minmax(140px,2fr) 1.2fr 1fr 0.7fr 100px" }}
    >
      <span className={`w-6 h-6 rounded-full grid place-items-center border-[1.5px] flex-none bg-[#1b2027] ${icBorder}`}>
        {icone}
      </span>

      <span className="min-w-0 block">
        <b className={`text-[12.5px] font-bold block leading-tight truncate ${concluida ? "text-white/55" : p.bloqueado ? "text-white/55" : "text-white/95"}`}>
          {p.ordem}. {p.titulo}
        </b>
        {!p.obrigatorio && <span className="text-[10.5px] text-white/40">opcional</span>}
      </span>

      <span className="block min-w-0">
        <span className={`text-[12px] font-semibold ${concluida ? "text-[#4ade80]" : p.balde === "EM_ANDAMENTO" ? "text-[#7dd3fc]" : "text-white/68"}`}>
          {p.statusLabel}
        </span>
        {p.motivoBloqueio && <span className="text-[11px] text-white/40 block truncate">{p.motivoBloqueio}</span>}
        {p.erroAdministrativo && (
          <span className="text-[11px] text-[#d2a948] block leading-snug mt-0.5">⚠ {p.erroAdministrativo}</span>
        )}
      </span>

      <span className="text-[12px] block truncate">
        {p.responsavelNome
          ? <span className="text-white/80 font-semibold">{p.responsavelNome}</span>
          : <span className="text-white/40">Sem responsável</span>}
      </span>

      <span className="text-[12px] block">
        {p.diasParaPrazo != null ? (
          <span className={p.diasParaPrazo < 0 ? "text-[#f87171] font-semibold" : "text-white/68"}>
            {p.diasParaPrazo < 0 ? `${Math.abs(p.diasParaPrazo)}d atrasada` : `${p.diasParaPrazo}d`}
          </span>
        ) : p.slaDays ? (
          <span className="text-white/40">SLA {p.slaDays}d</span>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </span>

      <span className="flex justify-end items-center">
        {podeAbrir ? (
          <span className="inline-flex items-center gap-1.5 bg-[#252c35] text-white/95 border border-white/10 text-[12px] font-bold px-3 py-1.5 rounded-lg">
            {concluida ? "Ver" : "Abrir"} <ChevronRight className="w-3 h-3" />
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[#d2a948] text-right">
            {readOnly ? "Somente leitura" : !p.executor ? "Sem executor" : "Bloqueado"}
          </span>
        )}
      </span>
    </button>
  )
}

// ============================================================
// OPERAÇÃO ANTECIPADA (preservada integralmente)
// ============================================================

const ST_OP_LABEL: Record<string, { t: string; c: string }> = {
  CRIADA: { t: "Criada", c: "bg-[#252c35] text-white/68" },
  EM_EXECUCAO: { t: "Em execução", c: "bg-[#7dd3fc]/15 text-[#7dd3fc]" },
  AGUARDANDO_RESULTADO: { t: "Aguardando avaliação", c: "bg-[#d2a948]/15 text-[#d2a948]" },
  CONCLUIDA: { t: "Concluída", c: "bg-[#4ade80]/15 text-[#4ade80]" },
  CONCLUIDA_PARCIAL: { t: "Concluída parcial", c: "bg-teal-500/15 text-teal-300" },
  NAO_ATINGIDA: { t: "Não atingida", c: "bg-[#f87171]/15 text-[#f87171]" },
  CANCELADA: { t: "Cancelada", c: "bg-[#252c35] text-white/40" },
}

function OperacoesAntecipadasInline({ ops, readOnly, onAvaliar, onAbrir }: {
  ops: OpAntecipadaInline[]
  readOnly?: boolean
  onAvaliar?: AvaliarFn
  onAbrir?: (op: OpAntecipadaInline) => void
}) {
  const abertas = ops.filter((o) => !o.encerrada).length
  return (
    <div className="pr-5 pb-2" style={{ paddingLeft: 56 }}>
      <div className="rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/12 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#a78bfa]/20 text-[10.5px] font-bold uppercase tracking-wide text-[#a78bfa]">
          <ArrowLeftRight className="w-3 h-3" /> Operações antecipadas
          <span className="font-semibold text-[#a78bfa]/70 normal-case tracking-normal">· {ops.length}{abertas > 0 ? ` (${abertas} aberta${abertas > 1 ? "s" : ""})` : ""}</span>
        </div>
        <div className="divide-y divide-[#a78bfa]/15">
          {ops.map((o) => (
            <OperacaoAntecipadaItem key={o.id} o={o} readOnly={readOnly} onAvaliar={onAvaliar} onAbrir={onAbrir} />
          ))}
        </div>
      </div>
    </div>
  )
}

function OperacaoAntecipadaItem({ o, readOnly, onAvaliar, onAbrir }: {
  o: OpAntecipadaInline
  readOnly?: boolean
  onAvaliar?: AvaliarFn
  onAbrir?: (op: OpAntecipadaInline) => void
}) {
  const [avaliando, setAvaliando] = useState(false)
  const [resultado, setResultado] = useState("")
  const [dados, setDados] = useState<Record<string, string>>({})
  const st = ST_OP_LABEL[o.status] ?? { t: o.status, c: "bg-[#252c35] text-white/68" }
  const objetivo = o.objetivo || "Operação antecipada"
  const apoio = !o.vinculavel // documento-alvo diferente do exigido → captura resultado estruturado
  const setD = (k: string, v: string) => setDados((d) => ({ ...d, [k]: v }))
  const enviar = (r: ResultadoAvaliacaoUI) => {
    onAvaliar?.(o.id, r, resultado, r === "SIM" && apoio ? { ...dados } : undefined)
    setAvaliando(false)
  }

  return (
    <div className={`px-3 py-2.5 ${o.encerrada ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
          {/* Operação Antecipada é orquestração interna: identificada pelo objetivo/documento/serviço vinculado, sem código público próprio (OPA-n removido). */}
          <span className="text-[12.5px] font-semibold text-white/95">{objetivo}</span>
          <span className="text-[11px] text-white/40">
            {o.operacao.statusLabel}
            {o.originPhaseCode ? ` · origem ${faseLabel(o.originPhaseCode)}` : ""}
            {apoio && o.targetTipoDocumentoId ? " · documento de apoio" : ""}
            {o.responsavel?.nome ? ` · ${o.responsavel.nome}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${st.c}`}>{st.t}</span>
          {onAbrir && (
            <button onClick={() => onAbrir(o)} className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-[#252c35] text-white/95 border border-white/10 hover:bg-[#2d353f]">Abrir operação</button>
          )}
        </div>
      </div>

      {/* AVALIAÇÃO FINAL — só após o workflow oficial concluir. Documento de APOIO captura o
          resultado ESTRUTURADO (é ele que resolve a necessidade de origem, não o doc em si). */}
      {!readOnly && o.aguardandoAvaliacao && onAvaliar && (
        avaliando ? (
          <div className="mt-2 rounded-md border border-white/10 bg-[#1b2027] p-2 space-y-2">
            {apoio && (
              <div className="grid grid-cols-2 gap-2">
                {[["cartorio", "Cartório"], ["municipio", "Município"], ["livro", "Livro"], ["folha", "Folha"], ["termo", "Termo"], ["data", "Data"], ["fonte", "Fonte da informação"]].map(([k, label]) => (
                  <input key={k} value={dados[k] ?? ""} onChange={(e) => setD(k, e.target.value)} placeholder={label} className="text-[12px] rounded-md border border-white/10 px-2 py-1.5 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25" />
                ))}
              </div>
            )}
            <input value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder={apoio ? "Observações" : "Resultado obtido"} className="w-full text-[12px] rounded-md border border-white/10 px-2 py-1.5 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25" autoFocus />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => enviar("SIM")} className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1.5 rounded-md bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40 hover:bg-[#4ade80]/25"><CheckCircle2 className="w-3.5 h-3.5" /> Objetivo atingido</button>
              <button onClick={() => enviar("PARCIAL")} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md border border-teal-500/25 text-teal-300 hover:bg-teal-500/10">Parcialmente</button>
              <button onClick={() => enviar("NAO")} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md border border-white/10 text-white/80 hover:bg-[#20262e]">Não atingido</button>
              <button onClick={() => enviar("CANCELAR")} className="text-[11.5px] text-white/40 hover:text-[#f87171] ml-auto">Cancelar operação</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setAvaliando(true); setResultado("") }} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1.5 rounded-md bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40 hover:bg-[#4ade80]/25"><CheckCircle2 className="w-3.5 h-3.5" /> Operação concluída — avaliar objetivo</button>
        )
      )}
      {o.resultadoObtido && <div className="text-[11px] text-white/55 mt-1">Resultado: {o.resultadoObtido}</div>}
    </div>
  )
}
