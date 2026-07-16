"use client"

// Tela: Gerenciamento → Documentos e Protocolos → Regras Documentais.
// Fonte ÚNICA de regras documentais (MatrizDocumental ampliada). Absorve a antiga
// "Matriz Documental". Não mostra JSON técnico ao usuário. Nada aqui cria
// Documento/Necessidade/Tarefa — só CONFIGURA regras.

import { useEffect, useMemo, useState, useCallback } from "react"
import {
  PUBLICOS_ALVO, PUBLICO_ALVO_LABEL, OPERADORES, OPERADOR_LABEL,
  CAMPOS_CONDICAO, CAMPO_CONDICAO_LABEL,
  type RegraDocumental, type ConjuntoCondicoes, type Condicao, type PublicoAlvo,
  type Combinador, type CampoCondicao, type Operador, type Obrigatoriedade, type ResultadoAvaliacao,
} from "@/src/lib/documentos/regras-documentais/tipos"
import { validarConjunto, justificativaDoConjunto } from "@/src/lib/documentos/regras-documentais/condicoes"
import { resumoRegra } from "@/src/lib/documentos/regras-documentais/resumo"
import type { Conflito } from "@/src/lib/documentos/regras-documentais/conflitos"

// ---- tipos de apoio (espelho do GET) ----
interface Fase { phaseKey: string; label: string; ordem: number }
interface TipoProcesso { id: number; name: string; countryKey: string | null; modalityKey: string | null; versao: number | null; fases: Fase[] }
interface DocType { id: number; code: string | null; name: string; category: string | null; categoriaDocumental: { code: string; name: string } | null }
interface Categoria { code: string; name: string }
interface Modalidade { id: number; countryKey: string; modalityKey: string; modalityLabel: string }
interface Apoio { tiposProcesso: TipoProcesso[]; docTypes: DocType[]; categorias: Categoria[]; modalidades: Modalidade[]; fasesCatalogo: Fase[] }
interface Data extends Apoio { regras: RegraDocumental[]; conflitos: Conflito[] }

// ---- form ----
type RegraForm = {
  id?: number
  status?: string
  versao?: number
  nome: string; descricao: string; prioridade: number
  vigenciaInicio: string; vigenciaFim: string
  tipoProcessoId: number; modalidadeId: number | null; paisCode: string; regiaoCode: string
  documentTypeCode: string; categoriaCode: string; obrigatoriedade: Obrigatoriedade
  publicoAlvo: PublicoAlvo
  condicoes: ConjuntoCondicoes
  faseExigencia: string; faseBloqueio: string; bloqueiaConclusaoFase: boolean
  continuaObrigatorioNasFasesSeguintes: boolean; faseFinalExigencia: string; obrigatorioAteFinalProcesso: boolean
  possuiValidade: boolean; validadeDias: number | null; exigeDataEmissao: boolean
  renovarQuandoExpirado: boolean; antecedenciaRenovacaoDias: number | null
}
const blankForm = (tipoProcessoId: number): RegraForm => ({
  nome: "", descricao: "", prioridade: 0, vigenciaInicio: "", vigenciaFim: "",
  tipoProcessoId, modalidadeId: null, paisCode: "", regiaoCode: "",
  documentTypeCode: "", categoriaCode: "", obrigatoriedade: "OBRIGATORIA",
  publicoAlvo: "PESSOA_DA_LINHA_RETA", condicoes: { combinador: "TODAS", regras: [] },
  faseExigencia: "", faseBloqueio: "", bloqueiaConclusaoFase: false,
  continuaObrigatorioNasFasesSeguintes: false, faseFinalExigencia: "", obrigatorioAteFinalProcesso: false,
  possuiValidade: false, validadeDias: null, exigeDataEmissao: false, renovarQuandoExpirado: false, antecedenciaRenovacaoDias: null,
})
const regraParaForm = (r: RegraDocumental): RegraForm => ({
  id: r.id, status: r.status, versao: r.versao,
  nome: r.nome ?? "", descricao: r.descricao ?? "", prioridade: r.prioridade,
  vigenciaInicio: r.vigenciaInicio?.slice(0, 10) ?? "", vigenciaFim: r.vigenciaFim?.slice(0, 10) ?? "",
  tipoProcessoId: r.tipoProcessoId, modalidadeId: r.modalidadeId, paisCode: r.paisCode ?? "", regiaoCode: r.regiaoCode ?? "",
  documentTypeCode: r.documentTypeCode, categoriaCode: r.categoriaCode ?? "", obrigatoriedade: r.obrigatoriedade,
  publicoAlvo: r.publicoAlvo, condicoes: r.condicoes ?? { combinador: "TODAS", regras: [] },
  faseExigencia: r.faseExigencia ?? "", faseBloqueio: r.faseBloqueio ?? "", bloqueiaConclusaoFase: r.bloqueiaConclusaoFase,
  continuaObrigatorioNasFasesSeguintes: r.continuaObrigatorioNasFasesSeguintes, faseFinalExigencia: r.faseFinalExigencia ?? "", obrigatorioAteFinalProcesso: r.obrigatorioAteFinalProcesso,
  possuiValidade: r.possuiValidade, validadeDias: r.validadeDias, exigeDataEmissao: r.exigeDataEmissao,
  renovarQuandoExpirado: r.renovarQuandoExpirado, antecedenciaRenovacaoDias: r.antecedenciaRenovacaoDias,
})
// converte form (RegraForm) numa RegraDocumental parcial p/ frase-resumo/preview
const formParaRegra = (f: RegraForm): RegraDocumental => ({
  id: f.id ?? 0, codigo: null, nome: f.nome || null, descricao: f.descricao || null,
  status: (f.status as RegraDocumental["status"]) ?? "RASCUNHO", versao: f.versao ?? 1, prioridade: f.prioridade,
  vigenciaInicio: f.vigenciaInicio || null, vigenciaFim: f.vigenciaFim || null,
  tipoProcessoId: f.tipoProcessoId, modalidadeId: f.modalidadeId, paisCode: f.paisCode || null, regiaoCode: f.regiaoCode || null, tipoProcessoVersao: null,
  documentTypeCode: f.documentTypeCode, categoriaCode: f.categoriaCode || null, obrigatoriedade: f.obrigatoriedade,
  publicoAlvo: f.publicoAlvo, condicoes: f.condicoes.regras.length ? f.condicoes : null,
  faseExigencia: f.faseExigencia || null, faseBloqueio: f.faseBloqueio || null, bloqueiaConclusaoFase: f.bloqueiaConclusaoFase,
  continuaObrigatorioNasFasesSeguintes: f.continuaObrigatorioNasFasesSeguintes, faseFinalExigencia: f.faseFinalExigencia || null, obrigatorioAteFinalProcesso: f.obrigatorioAteFinalProcesso,
  possuiValidade: f.possuiValidade, validadeDias: f.validadeDias, exigeDataEmissao: f.exigeDataEmissao,
  renovarQuandoExpirado: f.renovarQuandoExpirado, antecedenciaRenovacaoDias: f.antecedenciaRenovacaoDias,
})

// ---- estilos ----
const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const label = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"
const btnP = "rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
const btnG = "rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

const STATUS_STYLE: Record<string, string> = {
  RASCUNHO: "bg-white/10 text-white/60", PUBLICADA: "bg-green-500/15 text-green-300",
  INATIVA: "bg-amber-500/15 text-amber-300", ARQUIVADA: "bg-white/5 text-white/40",
}
const ETAPAS = ["Identificação", "Processo e modalidade", "Documento", "Público-alvo", "Condições", "Fases e bloqueio", "Validade", "Revisão final"]

export default function RegrasDocumentaisTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [ptId, setPtId] = useState<number | null>(null)
  const [showArch, setShowArch] = useState(false)
  const [form, setForm] = useState<RegraForm | null>(null)
  const [etapa, setEtapa] = useState(0)
  const [simOpen, setSimOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/regras-documentais", { headers: authHeaders() })
      if (res.ok) { const d: Data = await res.json(); setData(d); setPtId((p) => p ?? (d.tiposProcesso[0]?.id ?? null)) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }
  const proc = data?.tiposProcesso.find((t) => t.id === ptId) || null
  const fasesDoProc = proc?.fases?.length ? proc.fases : (data?.fasesCatalogo ?? [])
  const docName = (code: string) => data?.docTypes.find((d) => (d.code || String(d.id)) === code)?.name || code
  const faseName = (pk: string | null) => (pk ? fasesDoProc.find((f) => f.phaseKey === pk)?.label || pk : "—")
  const modName = (id: number | null) => (id ? data?.modalidades.find((m) => m.id === id)?.modalityLabel || `#${id}` : "—")

  const regras = useMemo(() => (data?.regras || []).filter((r) => r.tipoProcessoId === ptId && (showArch || r.status !== "ARQUIVADA")), [data, ptId, showArch])
  const conflitosDoProc = useMemo(() => {
    const ids = new Set(regras.map((r) => r.id))
    return (data?.conflitos || []).filter((c) => c.regras.some((id) => ids.has(id)))
  }, [data, regras])

  async function salvar(publicar: boolean) {
    if (!form) return
    const problems = validarConjunto(form.condicoes.regras.length ? form.condicoes : null)
    if (problems.length) { showFlash(problems[0].mensagem); setEtapa(4); return }
    if (!form.documentTypeCode) { showFlash("Escolha o documento."); setEtapa(2); return }
    if (!form.nome.trim()) { showFlash("Dê um nome à regra."); setEtapa(0); return }
    setBusy(true)
    try {
      const payload = { ...form }
      const url = form.id ? `/api/gerenciamento/regras-documentais/${form.id}` : "/api/gerenciamento/regras-documentais"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showFlash(j.error || "Erro ao salvar."); setBusy(false); return }
      const novoId = j.regra?.id ?? form.id
      if (publicar && novoId) {
        const p = await fetch(`/api/gerenciamento/regras-documentais/${novoId}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ acao: "publicar" }) })
        const pj = await p.json().catch(() => ({}))
        if (!p.ok) { showFlash(pj.error || "Salvo como rascunho, mas não publicado (sem permissão?)."); await load(); setForm(null); setBusy(false); return }
      }
      showFlash(publicar ? "Regra publicada." : "Rascunho salvo.")
      setForm(null); await load()
    } finally { setBusy(false) }
  }

  async function acao(r: RegraDocumental, acaoNome: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return
    const res = await fetch(`/api/gerenciamento/regras-documentais/${r.id}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ acao: acaoNome }) })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash("Feito."); await load() }
    else showFlash(j.error || "Erro.")
  }
  async function editarNovaVersao(r: RegraDocumental) {
    // publicada → cria nova versão (rascunho) e abre para edição
    const res = await fetch(`/api/gerenciamento/regras-documentais/${r.id}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ acao: "nova_versao" }) })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.regra) { await load(); const nova = regraParaForm(matrizRowParaRegra(j.regra)); setForm(nova); setEtapa(0); showFlash(`Nova versão v${j.regra.versao} criada (rascunho).`) }
    else showFlash(j.error || "Erro.")
  }
  async function excluir(r: RegraDocumental) {
    if (!confirm(`Excluir definitivamente a regra "${r.nome ?? r.documentTypeCode}"? (só se nunca utilizada)`)) return
    const res = await fetch(`/api/gerenciamento/regras-documentais/${r.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash("Regra excluída."); await load() } else showFlash(j.error || "Erro.")
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-blue-400/30 bg-blue-500/15 px-4 py-3 text-sm text-blue-100">{flash}</div>}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Regras Documentais</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/60">Fonte única e configurável dos documentos exigidos: para quem, sob quais condições, em qual fase começam a ser exigidos, qual fase bloqueiam, obrigatoriedade e validade. <span className="text-white/40">Configuração apenas — nenhum documento ou tarefa é criado aqui.</span></p>
          </div>
          <div className="flex gap-2">
            <button className={btnG} onClick={() => setSimOpen(true)}>Simular regras</button>
            {proc && <button className={btnP} onClick={() => { setForm(blankForm(proc.id)); setEtapa(0) }}>+ Nova regra</button>}
          </div>
        </div>
        <div className="mt-4 max-w-md">
          <label className={label}>Tipo de processo</label>
          <select value={ptId ?? ""} onChange={(e) => { setPtId(Number(e.target.value)); setShowArch(false) }} className={input}>
            {(data?.tiposProcesso || []).length === 0 && <option value="" className={opt}>Nenhum processo cadastrado</option>}
            {data?.tiposProcesso.map((t) => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* conflitos */}
      {conflitosDoProc.length > 0 && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
          <div className="mb-2 text-sm font-semibold text-red-200">⚠ {conflitosDoProc.length} conflito(s) detectado(s) — resolver manualmente</div>
          <ul className="space-y-1 text-xs text-red-100/90">
            {conflitosDoProc.map((c, i) => <li key={i}>• [{c.severidade}] {c.mensagem}</li>)}
          </ul>
        </div>
      )}

      {/* listagem */}
      {proc && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-white/50">{regras.length} regra(s)</span>
            <button className={`${btnG} ml-auto`} onClick={() => setShowArch((v) => !v)}>{showArch ? "Ocultar arquivadas" : "Mostrar arquivadas"}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-2 py-2">Nome</th><th className="px-2 py-2">Modalidade</th><th className="px-2 py-2">Documento</th>
                  <th className="px-2 py-2">Aplicável a</th><th className="px-2 py-2">Condições</th><th className="px-2 py-2">Exigência</th>
                  <th className="px-2 py-2">Bloqueia</th><th className="px-2 py-2">Obrig.</th><th className="px-2 py-2">Validade</th>
                  <th className="px-2 py-2">Versão</th><th className="px-2 py-2">Status</th><th className="px-2 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {regras.length === 0 ? (
                  <tr><td colSpan={12} className="px-2 py-8 text-center text-xs text-white/40">Nenhuma regra para este processo.</td></tr>
                ) : regras.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 last:border-0">
                    <td className="px-2 py-2 font-medium text-white">{r.nome ?? "—"}</td>
                    <td className="px-2 py-2 text-xs text-white/60">{modName(r.modalidadeId)}</td>
                    <td className="px-2 py-2 text-xs text-white/80">{docName(r.documentTypeCode)}</td>
                    <td className="px-2 py-2 text-xs text-white/60">{PUBLICO_ALVO_LABEL[r.publicoAlvo]}</td>
                    <td className="px-2 py-2 text-[11px] text-white/50">{r.condicoes && r.condicoes.regras.length ? justificativaDoConjunto(r.condicoes) : "—"}</td>
                    <td className="px-2 py-2 text-xs text-white/60">{faseName(r.faseExigencia)}</td>
                    <td className="px-2 py-2 text-xs">{r.bloqueiaConclusaoFase ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">{faseName(r.faseBloqueio)}</span> : <span className="text-white/30">—</span>}</td>
                    <td className="px-2 py-2 text-xs"><span className={`rounded px-1.5 py-0.5 text-[10px] ${r.obrigatoriedade === "OBRIGATORIA" ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-white/50"}`}>{r.obrigatoriedade === "OBRIGATORIA" ? "obrig." : "opc."}</span></td>
                    <td className="px-2 py-2 text-[11px] text-white/50">{r.possuiValidade ? `${r.validadeDias ?? "?"}d${r.renovarQuandoExpirado ? " ↻" : ""}` : "—"}</td>
                    <td className="px-2 py-2 text-xs text-white/60">v{r.versao}</td>
                    <td className="px-2 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[r.status]}`}>{r.status.toLowerCase()}</span></td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-1 text-[11px]">
                        {r.status === "PUBLICADA"
                          ? <button className={btnG} onClick={() => editarNovaVersao(r)}>nova versão</button>
                          : (r.status === "RASCUNHO" || r.status === "INATIVA")
                            ? <button className={btnG} onClick={() => { setForm(regraParaForm(r)); setEtapa(0) }}>editar</button>
                            : null}
                        {r.status === "RASCUNHO" && <button className={btnP} onClick={() => acao(r, "publicar")}>publicar</button>}
                        {r.status === "PUBLICADA" && <button className={btnG} onClick={() => acao(r, "inativar")}>inativar</button>}
                        <button className={btnG} onClick={() => acao(r, "duplicar")}>duplicar</button>
                        {r.status !== "ARQUIVADA" && <button className={btnG} onClick={() => acao(r, "arquivar", `Arquivar "${r.nome ?? r.documentTypeCode}"?`)}>arquivar</button>}
                        {r.status === "ARQUIVADA" && <button className={btnG} onClick={() => acao(r, "reativar")}>reabrir</button>}
                        <button className="rounded px-2 py-1 text-red-300/70 hover:bg-red-500/10" onClick={() => excluir(r)}>excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && data && <FormWizard form={form} setForm={setForm} etapa={etapa} setEtapa={setEtapa} data={data} proc={proc} fases={fasesDoProc} busy={busy} onCancel={() => setForm(null)} onSalvar={salvar} docName={docName} />}
      {simOpen && data && <Simulador data={data} ptId={ptId} onClose={() => setSimOpen(false)} />}
    </div>
  )
}

// helper: converte a linha crua devolvida pela API (MatrizDocumental) numa RegraDocumental
// (a API de ação devolve a ROW, não a mapeada; reidratamos os campos que a tela usa)
function matrizRowParaRegra(row: Record<string, unknown>): RegraDocumental {
  const g = <T,>(k: string, d: T): T => (row[k] === undefined || row[k] === null ? d : (row[k] as T))
  return {
    id: g("id", 0), codigo: g("codigo", null), nome: g("nome", null), descricao: g("descricao", null),
    status: g("status", "RASCUNHO") as RegraDocumental["status"], versao: g("versao", 1), prioridade: g("prioridade", 0),
    vigenciaInicio: g("vigenciaInicio", null), vigenciaFim: g("vigenciaFim", null),
    tipoProcessoId: g("tipoProcessoId", 0), modalidadeId: g("modalidadeId", null), paisCode: g("paisCode", null), regiaoCode: g("regiaoCode", null), tipoProcessoVersao: g("tipoProcessoVersao", null),
    documentTypeCode: g("documentTypeCode", ""), categoriaCode: g("categoriaCode", null), obrigatoriedade: g("obrigatoriedade", "OBRIGATORIA") as Obrigatoriedade,
    publicoAlvo: g("publicoAlvo", "PESSOA_DA_LINHA_RETA") as PublicoAlvo, condicoes: (row.condicoes as ConjuntoCondicoes) ?? null,
    faseExigencia: g("faseExigencia", null), faseBloqueio: g("faseBloqueio", null), bloqueiaConclusaoFase: g("blocksPhaseCompletion", false),
    continuaObrigatorioNasFasesSeguintes: g("continuaObrigatorioNasFasesSeguintes", false), faseFinalExigencia: g("faseFinalExigencia", null), obrigatorioAteFinalProcesso: g("obrigatorioAteFinalProcesso", false),
    possuiValidade: g("possuiValidade", false), validadeDias: g("validadeDias", null), exigeDataEmissao: g("exigeDataEmissao", false),
    renovarQuandoExpirado: g("renovarQuandoExpirado", false), antecedenciaRenovacaoDias: g("antecedenciaRenovacaoDias", null),
  }
}

// ============================================================
// WIZARD (8 etapas)
// ============================================================
function FormWizard(props: {
  form: RegraForm; setForm: (f: RegraForm | null) => void; etapa: number; setEtapa: (n: number) => void
  data: Data; proc: TipoProcesso | null; fases: Fase[]; busy: boolean
  onCancel: () => void; onSalvar: (publicar: boolean) => void; docName: (c: string) => string
}) {
  const { form, setForm, etapa, setEtapa, data, proc, fases, busy, onCancel, onSalvar, docName } = props
  const up = (patch: Partial<RegraForm>) => setForm({ ...form, ...patch })
  const modsDoProc = data.modalidades.filter((m) => !proc?.countryKey || m.countryKey === proc.countryKey)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 px-6 py-4">
          <h3 className="font-semibold text-white">{form.id ? `Editar regra (v${form.versao ?? 1})` : "Nova regra documental"}</h3>
          <div className="mt-3 flex flex-wrap gap-1">
            {ETAPAS.map((e, i) => (
              <button key={e} onClick={() => setEtapa(i)} className={`rounded-full px-2.5 py-1 text-[11px] ${i === etapa ? "bg-blue-600 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>{i + 1}. {e}</button>
            ))}
          </div>
        </div>

        <div className="px-6 py-5">
          {etapa === 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={label}>Nome da regra *</label><input className={input} value={form.nome} onChange={(e) => up({ nome: e.target.value })} placeholder="Ex.: Certidão de casamento (linha reta casada)" /></div>
              <div className="col-span-2"><label className={label}>Descrição</label><textarea className={input} rows={2} value={form.descricao} onChange={(e) => up({ descricao: e.target.value })} /></div>
              <div><label className={label}>Prioridade</label><input type="number" className={input} value={form.prioridade} onChange={(e) => up({ prioridade: Number(e.target.value) })} /></div>
              <div />
              <div><label className={label}>Vigência início</label><input type="date" className={input} value={form.vigenciaInicio} onChange={(e) => up({ vigenciaInicio: e.target.value })} /></div>
              <div><label className={label}>Vigência fim</label><input type="date" className={input} value={form.vigenciaFim} onChange={(e) => up({ vigenciaFim: e.target.value })} /></div>
            </div>
          )}
          {etapa === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Tipo de processo</label>
                <select className={input} value={form.tipoProcessoId} onChange={(e) => up({ tipoProcessoId: Number(e.target.value) })}>
                  {data.tiposProcesso.map((t) => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
                </select></div>
              <div><label className={label}>Modalidade (opcional)</label>
                <select className={input} value={form.modalidadeId ?? ""} onChange={(e) => up({ modalidadeId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="" className={opt}>— qualquer —</option>
                  {modsDoProc.map((m) => <option key={m.id} value={m.id} className={opt}>{m.modalityLabel}</option>)}
                </select></div>
              <div><label className={label}>País (opcional)</label><input className={input} value={form.paisCode} onChange={(e) => up({ paisCode: e.target.value })} placeholder={proc?.countryKey ?? ""} /></div>
              <div><label className={label}>Região (opcional)</label><input className={input} value={form.regiaoCode} onChange={(e) => up({ regiaoCode: e.target.value })} /></div>
            </div>
          )}
          {etapa === 2 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={label}>Tipo de documento *</label>
                <select className={input} value={form.documentTypeCode} onChange={(e) => up({ documentTypeCode: e.target.value })}>
                  <option value="" className={opt}>— selecione —</option>
                  {data.docTypes.map((d) => <option key={d.id} value={d.code || String(d.id)} className={opt}>{d.name}</option>)}
                </select></div>
              <div><label className={label}>Categoria documental</label>
                <select className={input} value={form.categoriaCode} onChange={(e) => up({ categoriaCode: e.target.value })}>
                  <option value="" className={opt}>— automática —</option>
                  {data.categorias.map((c) => <option key={c.code} value={c.code} className={opt}>{c.name}</option>)}
                </select></div>
              <div><label className={label}>Obrigatoriedade</label>
                <select className={input} value={form.obrigatoriedade} onChange={(e) => up({ obrigatoriedade: e.target.value as Obrigatoriedade })}>
                  <option value="OBRIGATORIA" className={opt}>Obrigatória</option>
                  <option value="OPCIONAL" className={opt}>Opcional</option>
                </select></div>
            </div>
          )}
          {etapa === 3 && (
            <div>
              <label className={label}>Aplicável a</label>
              <div className="grid gap-2">
                {PUBLICOS_ALVO.map((p) => (
                  <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${form.publicoAlvo === p ? "border-blue-400/50 bg-blue-500/10 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                    <input type="radio" name="publicoAlvo" checked={form.publicoAlvo === p} onChange={() => up({ publicoAlvo: p })} />
                    {PUBLICO_ALVO_LABEL[p]}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/40">O público não é inferido pelo nome do documento — é definido explicitamente aqui.</p>
            </div>
          )}
          {etapa === 4 && <ConstrutorCondicoes form={form} setForm={setForm} />}
          {etapa === 5 && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Fase em que passa a ser exigido</label>
                <select className={input} value={form.faseExigencia} onChange={(e) => up({ faseExigencia: e.target.value })}>
                  <option value="" className={opt}>— qualquer fase —</option>
                  {fases.map((f) => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}
                </select></div>
              <div><label className={label}>Fase que bloqueia</label>
                <select className={input} value={form.faseBloqueio} onChange={(e) => up({ faseBloqueio: e.target.value })}>
                  <option value="" className={opt}>— nenhuma —</option>
                  {fases.map((f) => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}
                </select></div>
              <label className="col-span-2 inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.bloqueiaConclusaoFase} onChange={(e) => up({ bloqueiaConclusaoFase: e.target.checked })} /> Bloqueia a conclusão da fase</label>
              <label className="col-span-2 inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.continuaObrigatorioNasFasesSeguintes} onChange={(e) => up({ continuaObrigatorioNasFasesSeguintes: e.target.checked })} /> Continua obrigatório nas fases seguintes</label>
              <div><label className={label}>Fase final da exigência (opcional)</label>
                <select className={input} value={form.faseFinalExigencia} onChange={(e) => up({ faseFinalExigencia: e.target.value })}>
                  <option value="" className={opt}>— sem limite —</option>
                  {fases.map((f) => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}
                </select></div>
              <label className="inline-flex items-center gap-2 pt-6 text-sm text-white/70"><input type="checkbox" checked={form.obrigatorioAteFinalProcesso} onChange={(e) => up({ obrigatorioAteFinalProcesso: e.target.checked })} /> Obrigatório até o final</label>
            </div>
          )}
          {etapa === 6 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.possuiValidade} onChange={(e) => up({ possuiValidade: e.target.checked })} /> Possui validade / vencimento</label>
              {form.possuiValidade && <>
                <div><label className={label}>Validade (dias)</label><input type="number" className={input} value={form.validadeDias ?? ""} onChange={(e) => up({ validadeDias: e.target.value ? Number(e.target.value) : null })} /></div>
                <div><label className={label}>Antecedência p/ renovar (dias)</label><input type="number" className={input} value={form.antecedenciaRenovacaoDias ?? ""} onChange={(e) => up({ antecedenciaRenovacaoDias: e.target.value ? Number(e.target.value) : null })} /></div>
                <label className="inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.exigeDataEmissao} onChange={(e) => up({ exigeDataEmissao: e.target.checked })} /> Exige data de emissão</label>
                <label className="inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.renovarQuandoExpirado} onChange={(e) => up({ renovarQuandoExpirado: e.target.checked })} /> Renovar quando expirado</label>
              </>}
            </div>
          )}
          {etapa === 7 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">Resumo</div>
                <p className="mt-1 text-sm text-white/90">{resumoRegra(formParaRegra(form), docName(form.documentTypeCode))}</p>
              </div>
              {(() => { const probs = validarConjunto(form.condicoes.regras.length ? form.condicoes : null); return probs.length ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">{probs.map((p, i) => <div key={i}>⚠ {p.mensagem}</div>)}</div> : null })()}
              <p className="text-[11px] text-white/40">Salvar cria/atualiza um RASCUNHO. Publicar torna a regra vigente (requer permissão). Publicar não reaplica a processos existentes.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4">
          <div className="flex gap-2">
            <button className={btnG} disabled={etapa === 0} onClick={() => setEtapa(Math.max(0, etapa - 1))}>Voltar</button>
            <button className={btnG} disabled={etapa === ETAPAS.length - 1} onClick={() => setEtapa(Math.min(ETAPAS.length - 1, etapa + 1))}>Avançar</button>
          </div>
          <div className="flex gap-2">
            <button className={btnG} onClick={onCancel}>Cancelar</button>
            <button className={btnG} disabled={busy} onClick={() => onSalvar(false)}>Salvar rascunho</button>
            <button className={btnP} disabled={busy} onClick={() => onSalvar(true)}>Salvar e publicar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CONSTRUTOR DE CONDIÇÕES
// ============================================================
function ConstrutorCondicoes({ form, setForm }: { form: RegraForm; setForm: (f: RegraForm) => void }) {
  const c = form.condicoes
  const setC = (nc: ConjuntoCondicoes) => setForm({ ...form, condicoes: nc })
  const addCond = () => setC({ ...c, regras: [...c.regras, { campo: "precisaDeDocumentacao", operador: "igual", valor: true }] })
  const rmCond = (i: number) => setC({ ...c, regras: c.regras.filter((_, idx) => idx !== i) })
  const setCond = (i: number, patch: Partial<Condicao>) => setC({ ...c, regras: c.regras.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) })
  const problemas = validarConjunto(c.regras.length ? c : null)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-white/80">
        Aplicar quando
        <select className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white" value={c.combinador} onChange={(e) => setC({ ...c, combinador: e.target.value as Combinador })}>
          <option value="TODAS" className={opt}>TODAS</option>
          <option value="QUALQUER" className={opt}>QUALQUER</option>
        </select>
        as condições forem verdadeiras
      </div>

      <div className="space-y-2">
        {c.regras.length === 0 && <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">Sem condições — a regra aplica-se a todo o público-alvo.</div>}
        {c.regras.map((cond, i) => {
          const isBool = ["precisaDeDocumentacao", "requerente", "contratante", "linhaReta", "casado", "falecido", "vivo", "possuiConjuge"].includes(cond.campo)
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2">
              <span className="text-xs text-white/40">{i + 1}.</span>
              <select className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white" value={cond.campo} onChange={(e) => setCond(i, { campo: e.target.value as CampoCondicao })}>
                {CAMPOS_CONDICAO.map((k) => <option key={k} value={k} className={opt}>{CAMPO_CONDICAO_LABEL[k]}</option>)}
              </select>
              <select className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white" value={cond.operador} onChange={(e) => setCond(i, { operador: e.target.value as Operador })}>
                {OPERADORES.map((o) => <option key={o} value={o} className={opt}>{OPERADOR_LABEL[o]}</option>)}
              </select>
              {cond.operador !== "existe" && cond.operador !== "nao_existe" && (
                isBool
                  ? <select className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white" value={String(cond.valor)} onChange={(e) => setCond(i, { valor: e.target.value === "true" })}><option value="true" className={opt}>Sim</option><option value="false" className={opt}>Não</option></select>
                  : <input className="w-32 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white" value={String(cond.valor ?? "")} onChange={(e) => setCond(i, { valor: e.target.value })} placeholder="valor" />
              )}
              <button className="ml-auto rounded px-2 py-1 text-xs text-red-300/70 hover:bg-red-500/10" onClick={() => rmCond(i)}>remover</button>
            </div>
          )
        })}
      </div>
      <button className={btnG} onClick={addCond}>+ Adicionar condição</button>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] text-white/40">Resumo</div>
        <p className="mt-1 text-sm text-white/80">Aplica-se quando {justificativaDoConjunto(c.regras.length ? c : null)}.</p>
      </div>
      {problemas.length > 0 && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">{problemas.map((p, i) => <div key={i}>⚠ {p.mensagem}</div>)}</div>}
    </div>
  )
}

// ============================================================
// SIMULADOR
// ============================================================
function Simulador({ data, ptId, onClose }: { data: Data; ptId: number | null; onClose: () => void }) {
  const [tipoProcessoId, setTipo] = useState<number>(ptId ?? data.tiposProcesso[0]?.id ?? 0)
  const [modalidadeId, setMod] = useState<number | null>(null)
  const [faseKey, setFase] = useState<string>("")
  const [incluirRascunhos, setRascunhos] = useState(true)
  const [suj, setSuj] = useState({ nome: "Pessoa de teste", ehPessoaArvore: true, requerente: false, contratante: false, linhaReta: false, precisaDeDocumentacao: true, casado: false, falecido: false, vivo: true })
  const [dataEmissao, setDataEmissao] = useState("")
  const [res, setRes] = useState<ResultadoAvaliacao | null>(null)
  const [busy, setBusy] = useState(false)
  const proc = data.tiposProcesso.find((t) => t.id === tipoProcessoId)
  const fases = proc?.fases?.length ? proc.fases : data.fasesCatalogo
  const modsDoProc = data.modalidades.filter((m) => !proc?.countryKey || m.countryKey === proc.countryKey)
  const tog = (k: keyof typeof suj) => setSuj((s) => ({ ...s, [k]: !s[k] }))

  async function simular() {
    setBusy(true)
    try {
      const body = { tipoProcessoId, modalidadeId, faseKey: faseKey || null, incluirRascunhos, sujeito: { ...suj, vivo: !suj.falecido, dataEmissaoDocumento: dataEmissao || null } }
      const r = await fetch("/api/gerenciamento/regras-documentais/simular", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) setRes(j.resultado); else setRes(null)
    } finally { setBusy(false) }
  }
  const docName = (code: string) => data.docTypes.find((d) => (d.code || String(d.id)) === code)?.name || code

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 px-6 py-4"><h3 className="font-semibold text-white">Simular regras documentais</h3><p className="mt-0.5 text-xs text-white/50">Só calcula e explica — não cria documento, necessidade nem tarefa.</p></div>
        <div className="grid grid-cols-2 gap-3 px-6 py-4">
          <div><label className={label}>Tipo de processo</label><select className={input} value={tipoProcessoId} onChange={(e) => setTipo(Number(e.target.value))}>{data.tiposProcesso.map((t) => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}</select></div>
          <div><label className={label}>Modalidade</label><select className={input} value={modalidadeId ?? ""} onChange={(e) => setMod(e.target.value ? Number(e.target.value) : null)}><option value="" className={opt}>— qualquer —</option>{modsDoProc.map((m) => <option key={m.id} value={m.id} className={opt}>{m.modalityLabel}</option>)}</select></div>
          <div><label className={label}>Fase</label><select className={input} value={faseKey} onChange={(e) => setFase(e.target.value)}><option value="" className={opt}>— qualquer —</option>{fases.map((f) => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}</select></div>
          <div><label className={label}>Data de emissão (validade)</label><input type="date" className={input} value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} /></div>
          <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/70">
            {([["ehPessoaArvore", "Pessoa da árvore"], ["requerente", "Requerente"], ["precisaDeDocumentacao", "Documentação"], ["linhaReta", "Linha reta"], ["casado", "Casado"], ["falecido", "Falecido"]] as [keyof typeof suj, string][]).map(([k, lbl]) => (
              <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!suj[k]} onChange={() => tog(k)} />{lbl}</label>
            ))}
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={incluirRascunhos} onChange={() => setRascunhos((v) => !v)} />Incluir rascunhos</label>
          </div>
        </div>
        <div className="px-6 pb-2"><button className={btnP} disabled={busy} onClick={simular}>{busy ? "Simulando…" : "Simular"}</button></div>

        {res && (
          <div className="grid grid-cols-2 gap-3 px-6 py-4">
            <div>
              <div className="mb-1 text-xs font-semibold text-green-300">Aplicáveis ({res.aplicaveis.length})</div>
              <div className="space-y-1.5">
                {res.aplicaveis.length === 0 && <div className="text-xs text-white/40">Nenhum.</div>}
                {res.aplicaveis.map((a) => (
                  <div key={a.regraId} className="rounded-lg border border-green-400/20 bg-green-500/5 px-3 py-2 text-xs">
                    <div className="font-medium text-white">{docName(a.documentTypeCode)} <span className={`ml-1 rounded px-1 py-0.5 text-[9px] ${a.obrigatoriedade === "OBRIGATORIA" ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-white/50"}`}>{a.obrigatoriedade === "OBRIGATORIA" ? "obrig." : "opc."}</span></div>
                    <div className="text-white/50">Motivo: {a.justificativa}</div>
                    {a.bloqueiaConclusaoFase && <div className="text-red-300/80">Bloqueia: {a.faseBloqueio}</div>}
                    {a.validade.possuiValidade && <div className="text-white/50">Validade: {a.validade.validadeDias}d {a.validade.expirado ? <span className="text-red-300">· EXPIRADO{a.validade.precisaRenovar ? " (renovar)" : ""}</span> : a.validade.diasParaVencer != null ? `· vence em ${a.validade.diasParaVencer}d` : ""}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-white/50">Não aplicáveis ({res.naoAplicaveis.length})</div>
              <div className="space-y-1.5">
                {res.naoAplicaveis.map((a) => (
                  <div key={a.regraId} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
                    <div className="text-white/70">{docName(a.documentTypeCode)}</div>
                    <div className="text-white/40">{a.motivoNaoAplicavel}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end border-t border-white/10 px-6 py-4"><button className={btnG} onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  )
}
