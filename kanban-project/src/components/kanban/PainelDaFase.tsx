// src/components/kanban/PainelDaFase.tsx
//
// Painel da fase operacional, clone fiel do mockup discovery-central-operacional-v2.html
// (funções renderCentral / coWorkflow / coKpis / coGroups / personRow / docExpRow).
//
// Substitui o conteúdo principal antigo da Central Operacional (matriz escura +
// cards de fila) pelo painel da fase do mockup:
//   - Cabeçalho da fase (título + badge "Fase atual · operacional" + "Abrir painel da fase" + abas)
//   - 5 etapas em linha (Solicitar / Aguardar / Receber / Conferir / Validar)
//   - 7 contadores (Obrigatórios / Validados / Solicitados / Aguardando / Recebidos / Conferidos / Divergentes)
//   - Barra de progresso da fase
//   - Tabela por pessoa (Linha principal / Fora da linhagem) com linhas expansíveis
//
// É a CASCA visual fiel. Recebe os dados via props (vindos da rota
// /api/processos/[id]/central-operacional + /phase). Onde o backend ainda não
// fornece um contador, ele aparece zerado (igual o mockup quando não há dado).

"use client"

import { useState } from "react"
import {
  ExternalLink,
  Search,
  Clock,
  Download,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Star,
  Users,
} from "lucide-react"

// ============================================================
// TIPOS
// ============================================================

export interface FaseStep {
  title: string
  status: "concluida" | "em_andamento" | "bloqueada" | "pendente"
}

export interface FaseKpi {
  label: string
  value: number
  tone?: "" | "ok" | "busca" | "late"
}

export interface FaseDocRow {
  id: number
  tipoLabel: string        // "Certidão de Nascimento"
  subtitulo?: string       // "Inteiro teor"
  statusLabel: string      // "A SOLICITAR"
  statusCls: string        // "pendente" | "em_busca" | "localizado" | "bloqueado" | ...
  responsavel?: string | null
  sla?: string | null
  proximaAcao?: string | null
  emissaoConcluida?: boolean
}

export interface FasePersonRow {
  pessoaId: number
  nome: string
  iniciais: string
  papel: string
  geracao: string          // "G1", "Atual", "—"
  isLinha: boolean
  transmissao: {
    state: "OK" | "BLOQUEADA" | "FORA"
    label: string
    sub?: string
  }
  docsResumo: Array<{ abbr: string; statusLabel: string; statusCls: string }>
  validados: number
  total: number
  responsavel?: string | null
  proximaAcao?: { txt: string; cls?: "crit" | "" ; semResp?: boolean } | null
  docs: FaseDocRow[]
}

export interface PainelDaFaseProps {
  faseNome: string                 // "Emissão documental"
  faseSub: string                  // subtítulo da fase
  faseTabs: string[]               // abas do mockup pra essa fase
  steps: FaseStep[]                // as 5 etapas
  kpis: FaseKpi[]                  // os 7 contadores
  progressoPct: number             // % da fase
  progressoConcluidos: number      // ex: 0
  progressoTotal: number           // ex: 1
  progressoTexto: string           // "Solicite, receba... Falta 1 documento..."
  linhaPrincipal: FasePersonRow[]
  foraDaLinha: FasePersonRow[]
  onAbrirOperacao: (docId: number) => void
  onAbrirPainelCompleto?: () => void
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function PainelDaFase({
  faseNome,
  faseSub,
  faseTabs,
  steps,
  kpis,
  progressoPct,
  progressoConcluidos,
  progressoTotal,
  progressoTexto,
  linhaPrincipal,
  foraDaLinha,
  onAbrirOperacao,
  onAbrirPainelCompleto,
}: PainelDaFaseProps) {
  const [abaAtiva, setAbaAtiva] = useState("Resumo")

  return (
    <div>
      {/* ============== CABEÇALHO DA FASE (shell pps) ============== */}
      <div className="bg-white border border-gray-200 border-b-0 rounded-t-2xl px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[19px] font-extrabold text-gray-900">{faseNome}</h2>
            <span className="text-[11.5px] font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">
              Fase atual · operacional
            </span>
          </div>
          <button
            onClick={onAbrirPainelCompleto}
            className="inline-flex items-center gap-1.5 border-[1.5px] border-gray-200 bg-white text-gray-700 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir painel da fase
          </button>
        </div>
        <div className="text-[13px] text-gray-500 mt-1.5">{faseSub}</div>

        {/* Abas */}
        <div className="flex gap-1 overflow-x-auto mt-3.5 border-b border-gray-200">
          {faseTabs.map((t) => (
            <button
              key={t}
              onClick={() => setAbaAtiva(t)}
              className={`text-[12.5px] font-semibold px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
                abaAtiva === t
                  ? "text-blue-600 border-blue-600"
                  : "text-gray-500 border-transparent hover:text-gray-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ============== CORPO DA FASE ============== */}
      <div className="bg-white border border-gray-200 border-t-0 rounded-b-2xl px-5 py-5">

        {/* --- 5 ETAPAS EM LINHA --- */}
        <div className="flex items-center mb-5 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const cls =
              s.status === "concluida" ? "done"
              : s.status === "em_andamento" ? "active"
              : "pend"
            const icBorder =
              cls === "done" ? "border-green-600 text-green-600"
              : cls === "active" ? "border-blue-600 text-blue-600"
              : "border-gray-200 text-gray-400"
            const titColor = cls === "pend" ? "text-gray-400" : "text-gray-900"
            const subColor =
              cls === "done" ? "text-green-600"
              : cls === "active" ? "text-blue-600"
              : "text-gray-400"
            const subTxt =
              s.status === "concluida" ? "Concluído"
              : s.status === "em_andamento" ? "Em andamento"
              : "Bloqueada"
            return (
              <div key={i} className="flex items-center flex-none">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-full grid place-items-center border-[1.5px] bg-white ${icBorder}`}>
                    {s.status === "concluida" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : s.status === "em_andamento" ? (
                      <Search className="w-3.5 h-3.5" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div>
                    <div className={`text-[12.5px] font-bold leading-tight ${titColor}`}>{s.title}</div>
                    <div className={`text-[11px] font-semibold mt-px ${subColor}`}>{subTxt}</div>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className={`h-px min-w-[28px] flex-1 mx-2.5 ${s.status === "concluida" ? "bg-green-600" : "bg-gray-200"}`} style={{ width: 60 }} />
                )}
              </div>
            )
          })}
        </div>

        {/* --- 7 CONTADORES --- */}
        <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
          {kpis.map((k, i) => {
            const valColor =
              k.tone === "ok" ? "text-green-600"
              : k.tone === "busca" ? "text-amber-600"
              : k.tone === "late" ? "text-red-600"
              : "text-gray-900"
            return (
              <div key={i} className="bg-white border border-gray-200 rounded-[10px] px-4 py-3">
                <b className={`text-[22px] font-extrabold block leading-none ${valColor}`}>{k.value}</b>
                <span className="text-[11px] text-gray-400 font-semibold block mt-1.5">{k.label}</span>
              </div>
            )
          })}
        </div>

        {/* --- BARRA DE PROGRESSO DA FASE --- */}
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-5">
          <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
            <div>
              <div className="text-[13px] font-semibold text-gray-500 mb-1">Progresso da fase {faseNome}</div>
              <div className="text-[28px] font-extrabold text-gray-900 leading-none">{progressoPct}%</div>
            </div>
            <div className="text-[13px] text-gray-500">{progressoConcluidos} de {progressoTotal} documentos validados</div>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-3">
            <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progressoPct}%` }} />
          </div>
          <div className="text-center text-[12.5px] text-gray-400 mt-3">{progressoTexto}</div>
        </div>

        {/* --- TABELA POR PESSOA --- */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Cabeçalho de colunas */}
          <div
            className="grid items-center gap-2.5 px-5 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-200"
            style={{ gridTemplateColumns: "52px minmax(160px,1.6fr) 1fr 1.2fr 0.9fr 1.2fr 124px" }}
          >
            <div>G</div>
            <div>Pessoa</div>
            <div>Transmissão</div>
            <div>Documentos</div>
            <div>Responsável</div>
            <div>Próxima ação</div>
            <div className="text-right">Ação</div>
          </div>

          {/* Grupo Linha Principal */}
          <GroupBar
            icon={<Star className="w-3 h-3" />}
            title="Linha principal · transmissão de cidadania"
            count={linhaPrincipal.length}
            tone="linha"
          />
          {linhaPrincipal.map((p) => (
            <PersonRow key={p.pessoaId} p={p} onAbrirOperacao={onAbrirOperacao} />
          ))}

          {/* Grupo Fora da linhagem */}
          <GroupBar
            icon={<Users className="w-3 h-3" />}
            title="Fora da linhagem · cônjuges / apoio"
            count={foraDaLinha.length}
            tone="fora"
          />
          {foraDaLinha.map((p) => (
            <PersonRow key={p.pessoaId} p={p} onAbrirOperacao={onAbrirOperacao} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================

function GroupBar({
  icon,
  title,
  count,
  tone,
}: {
  icon: React.ReactNode
  title: string
  count: number
  tone: "linha" | "fora"
}) {
  return (
    <div className={`flex items-center gap-2.5 px-5 py-2.5 border-b border-gray-200 ${tone === "fora" ? "bg-gray-100" : "bg-slate-50/70"}`}>
      <span className={`w-[22px] h-[22px] rounded-lg grid place-items-center flex-none ${tone === "fora" ? "bg-gray-200 text-gray-400" : "bg-gray-100 text-gray-500"}`}>
        {icon}
      </span>
      <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-gray-500">{title}</b>
      <span className="ml-auto text-[11px] font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-2.5 py-0.5">
        {count} pessoa(s)
      </span>
    </div>
  )
}

function PersonRow({
  p,
  onAbrirOperacao,
}: {
  p: FasePersonRow
  onAbrirOperacao: (docId: number) => void
}) {
  const [exp, setExp] = useState(false)

  const borderCls = !p.isLinha
    ? "border-l-[3px] border-gray-200 bg-gray-50/60"
    : p.transmissao.state === "BLOQUEADA"
    ? "border-l-[3px] border-red-500"
    : p.transmissao.state === "OK"
    ? "border-l-[3px] border-green-500"
    : "border-l-[3px] border-transparent"

  const transDot =
    p.transmissao.state === "OK" ? "bg-green-500"
    : p.transmissao.state === "BLOQUEADA" ? "bg-red-500"
    : "bg-gray-400"
  const transColor =
    p.transmissao.state === "OK" ? "text-green-600"
    : p.transmissao.state === "BLOQUEADA" ? "text-red-700"
    : "text-gray-400"

  const pctVal = p.total > 0 ? Math.round((p.validados / p.total) * 100) : 0

  return (
    <>
      <div
        className={`grid items-center gap-2.5 px-5 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${borderCls}`}
        style={{ gridTemplateColumns: "52px minmax(160px,1.6fr) 1fr 1.2fr 0.9fr 1.2fr 124px" }}
      >
        {/* G */}
        <div className="text-center text-[11px] font-extrabold text-gray-500 bg-white border border-gray-200 rounded-lg py-1.5 leading-tight">
          {p.geracao === "Atual" ? (
            <>
              <span className="text-[13px]">{p.iniciais}</span>
              <small className="block text-[8.5px] font-bold text-gray-400">Atual</small>
            </>
          ) : (
            p.geracao
          )}
        </div>

        {/* Pessoa */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[34px] h-[34px] rounded-full grid place-items-center text-white font-extrabold text-[12.5px] flex-none bg-slate-600">
            {p.iniciais}
          </div>
          <div className="min-w-0">
            <b className="text-[14px] font-extrabold block leading-tight truncate">{p.nome}</b>
            <span className="text-[11.5px] text-gray-400 font-semibold">
              {p.papel} · {p.isLinha ? "Linha reta" : "Fora da linha"}
            </span>
          </div>
        </div>

        {/* Transmissão */}
        <div>
          <div className={`flex items-center gap-1.5 text-[13px] font-bold ${transColor}`}>
            <span className={`w-2 h-2 rounded-full flex-none ${transDot}`} />
            {p.transmissao.label}
          </div>
          {p.transmissao.sub && (
            <div className="text-[11.5px] text-gray-400 font-medium mt-0.5">{p.transmissao.sub}</div>
          )}
        </div>

        {/* Documentos (resumo + barra) */}
        <div>
          {p.docsResumo.length === 0 ? (
            <span className="text-[11.5px] text-gray-300">—</span>
          ) : (
            p.docsResumo.map((d, i) => (
              <div key={i} className="grid gap-2 text-[11.5px] leading-relaxed" style={{ gridTemplateColumns: "34px auto" }}>
                <span className="text-gray-500 font-bold">{d.abbr}</span>
                <span className={`flex items-center gap-1.5 font-semibold ${docCls(d.statusCls)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-none ${docDot(d.statusCls)}`} />
                  {d.statusLabel.toLowerCase()}
                </span>
              </div>
            ))
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] font-bold text-gray-500">{p.validados} / {p.total}</span>
            <div className="w-24 h-1 rounded bg-gray-100 overflow-hidden">
              <div className="h-full bg-blue-600" style={{ width: `${pctVal}%` }} />
            </div>
          </div>
        </div>

        {/* Responsável */}
        <div className="text-[12px] font-bold text-gray-500">
          {p.responsavel ? (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
              {p.responsavel.toUpperCase()}
            </div>
          ) : (
            <span className="text-gray-300 font-medium">—</span>
          )}
        </div>

        {/* Próxima ação */}
        <div className="text-[13px] font-semibold text-gray-500">
          {p.proximaAcao?.semResp && (
            <span className="inline-block text-[10.5px] font-extrabold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md mb-1">
              sem responsável
            </span>
          )}
          <div className={p.proximaAcao?.cls === "crit" ? "text-red-700 font-bold" : ""}>
            {p.proximaAcao?.txt || <span className="text-gray-300">—</span>}
          </div>
        </div>

        {/* Ação */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => p.docs.length && (setExp(true))}
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white text-[12.5px] font-bold px-3.5 py-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Abrir <ChevronRight className="w-3 h-3" />
          </button>
          {p.docs.length > 0 && (
            <button
              onClick={() => setExp(!exp)}
              className="w-7 h-7 grid place-items-center text-gray-400 hover:text-gray-600"
            >
              {exp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Linhas expandidas (documentos) */}
      {exp &&
        p.docs.map((d) => (
          <div
            key={d.id}
            className="grid items-center gap-3 border-t border-gray-100 py-3 pr-5"
            style={{ gridTemplateColumns: "minmax(200px,2fr) 0.9fr 1fr 0.8fr 1.2fr 124px", paddingLeft: 76 }}
          >
            {/* Nome do doc */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-white border border-gray-200 grid place-items-center text-gray-500 flex-none">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div>
                <b className="text-[13px] font-bold block leading-tight">{d.tipoLabel}</b>
                <span className="text-[11px] text-gray-400">{d.subtitulo || "Inteiro teor"}</span>
              </div>
            </div>

            {/* Status pill */}
            <div>
              <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-extrabold px-2.5 py-1 rounded-full uppercase ${pillCls(d.statusCls)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${docDot(d.statusCls)}`} />
                {d.statusLabel}
              </span>
            </div>

            {/* Responsável */}
            <span className={`text-[12px] ${d.responsavel ? "text-gray-700" : "text-gray-300"}`}>
              {d.responsavel || "—"}
            </span>

            {/* SLA */}
            <span className={`text-[12px] ${d.sla ? "text-gray-700" : "text-gray-300"}`}>
              {d.sla || "—"}
            </span>

            {/* Próxima ação */}
            <span className="text-[12px] text-gray-600">{d.proximaAcao || "—"}</span>

            {/* Botão */}
            <div className="flex justify-end">
              <button
                onClick={() => onAbrirOperacao(d.id)}
                className={`text-[12px] font-bold px-3 py-2 rounded-lg transition-colors ${
                  d.emissaoConcluida
                    ? "border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                    : "bg-blue-600 text-white hover:bg-blue-500"
                }`}
              >
                {d.emissaoConcluida ? "Ver workflow" : "Abrir operação"}
              </button>
            </div>
          </div>
        ))}
    </>
  )
}

// ============================================================
// HELPERS DE COR (status do documento)
// ============================================================

function docCls(cls: string): string {
  switch (cls) {
    case "localizado":
    case "validado":
    case "recebido": return "text-green-600"
    case "em_busca":
    case "solicitado": return "text-amber-600"
    case "bloqueado": return "text-red-700"
    case "desnecessario": return "text-gray-400"
    default: return "text-gray-400"
  }
}

function docDot(cls: string): string {
  switch (cls) {
    case "localizado":
    case "validado":
    case "recebido": return "bg-green-500"
    case "em_busca":
    case "solicitado": return "bg-amber-500"
    case "bloqueado": return "bg-red-500"
    default: return "bg-gray-400"
  }
}

function pillCls(cls: string): string {
  switch (cls) {
    case "localizado":
    case "validado":
    case "recebido": return "bg-green-100 text-green-700"
    case "em_busca":
    case "solicitado": return "bg-amber-100 text-amber-700"
    case "bloqueado": return "bg-red-100 text-red-700"
    case "desnecessario": return "bg-gray-100 text-gray-400"
    default: return "bg-gray-100 text-gray-500"
  }
}