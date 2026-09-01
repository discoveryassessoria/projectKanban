"use client"

// Órgãos e Organizações — cadastro MESTRE. Ficha completa da entidade (nome
// oficial, nome fantasia, categorias N:N, localização, contato, idioma, moeda,
// horário, responsável, tags). O código público (ORG1, ORG2…) é do backend:
// aparece em leitura e nunca é digitado.

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { CodigoPublicoField } from "./CodigoPublicoField"
import {
  useSelecaoEmMassa, executarEmMassa, CaixaDeSelecao, CaixaDeSelecaoTodos,
  BarraDeSelecao, ResumoEmMassa, type ResultadoEmMassa,
} from "@/src/components/ui/selecao-em-massa"
import { SelectPaisCanonico, type PaisCanonico } from "@/src/components/ui/select-pais-canonico"

interface CategoriaRef { id: number; code: string; nome: string; ativo: boolean }
type Funcao = 'ORGAO' | 'FORNECEDOR' | 'PARCEIRO' | 'CORRESPONDENTE' | 'CLIENTE_CORPORATIVO'
const FUNCOES: [Funcao, string][] = [
  ['ORGAO', 'Órgão'], ['FORNECEDOR', 'Fornecedor'], ['PARCEIRO', 'Parceiro'],
  ['CORRESPONDENTE', 'Correspondente'], ['CLIENTE_CORPORATIVO', 'Cliente Corporativo'],
]
const funcaoLabel = (f: Funcao) => FUNCOES.find(([v]) => v === f)?.[1] ?? f
interface Suspeita { id: number; publicCode: string | null; name: string; paisId: number | null; pais: string | null; similaridade: number; motivo: string }
interface Orgao {
  id: number
  publicCode: string | null
  name: string
  nomeFantasia: string | null
  type: string | null
  /// IDENTIDADE do país. O rótulo vem da relação, não de coluna copiada.
  paisId: number | null
  pais: { id: number; countryKey: string; countryLabel: string; flag?: string | null } | null
  state: string | null
  provincia: string | null
  city: string | null
  endereco: string | null
  cep: string | null
  site: string | null
  email: string | null
  telefone: string | null
  idioma: string | null
  moeda: string | null
  horario: string | null
  responsavel: string | null
  observacoes: string | null
  tags: string[]
  queueRule: string | null
  funcoes: Funcao[]
  identificacaoFiscal: string | null
  tipoIdentificacaoFiscal: string | null
  formaPagamento: string | null
  chavePix: string | null
  tipoChavePix: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipoConta: string | null
  prazoPagamentoDias: number | null
  contatoFinanceiro: string | null
  observacoesFinanceiras: string | null
  statusFinanceiro: string | null
  ativo: boolean
  categorias?: { categoriaId: number; categoria: CategoriaRef }[]
}

const TYPES: [string, string][] = [
  ["consulado", "Consulado"], ["comune", "Comune"], ["tribunal", "Tribunal"], ["conservatoria", "Conservatória"],
  ["cartorio", "Cartório"], ["ministerio", "Ministério"], ["prefeitura", "Prefeitura"], ["tradutor", "Tradutor"],
  ["apostilamento", "Apostilamento"], ["outro", "Outro"],
]
const typeLabel = (t: string | null) => (t ? TYPES.find(x => x[0] === t)?.[1] || t : "—")
const IDIOMAS: [string, string][] = [["pt", "Português"], ["es", "Espanhol"], ["it", "Italiano"], ["en", "Inglês"], ["fr", "Francês"], ["de", "Alemão"]]
const MOEDAS: [string, string][] = [["BRL", "Real (BRL)"], ["EUR", "Euro (EUR)"], ["USD", "Dólar (USD)"], ["ARS", "Peso argentino (ARS)"], ["PYG", "Guarani (PYG)"]]

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const opt = "bg-zinc-900"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number; publicCode?: string | null
  name: string; nomeFantasia: string; type: string
  paisId: number | null; state: string; provincia: string; city: string; endereco: string; cep: string
  site: string; email: string; telefone: string
  idioma: string; moeda: string; horario: string; responsavel: string
  observacoes: string; tags: string; queueRule: string
  categoriaIds: number[]
  funcoes: Funcao[]
  identificacaoFiscal: string; tipoIdentificacaoFiscal: string
  formaPagamento: string; chavePix: string; tipoChavePix: string
  banco: string; agencia: string; conta: string; tipoConta: string
  prazoPagamentoDias: string; contatoFinanceiro: string; observacoesFinanceiras: string; statusFinanceiro: string
  ativo: boolean
}
const blank = (): Form => ({
  name: "", nomeFantasia: "", type: "", paisId: null, state: "", provincia: "", city: "", endereco: "", cep: "",
  site: "", email: "", telefone: "", idioma: "", moeda: "", horario: "", responsavel: "",
  observacoes: "", tags: "", queueRule: "", categoriaIds: [], funcoes: ["ORGAO"],
  identificacaoFiscal: "", tipoIdentificacaoFiscal: "", formaPagamento: "", chavePix: "", tipoChavePix: "",
  banco: "", agencia: "", conta: "", tipoConta: "", prazoPagamentoDias: "", contatoFinanceiro: "",
  observacoesFinanceiras: "", statusFinanceiro: "", ativo: true,
})
const daLinha = (d: Orgao): Form => ({
  id: d.id, publicCode: d.publicCode, name: d.name, nomeFantasia: d.nomeFantasia || "", type: d.type || "",
  paisId: d.paisId ?? null, state: d.state || "", provincia: d.provincia || "", city: d.city || "", endereco: d.endereco || "", cep: d.cep || "",
  site: d.site || "", email: d.email || "", telefone: d.telefone || "", idioma: d.idioma || "", moeda: d.moeda || "",
  horario: d.horario || "", responsavel: d.responsavel || "", observacoes: d.observacoes || "",
  tags: (d.tags ?? []).join(", "), queueRule: d.queueRule || "",
  categoriaIds: (d.categorias ?? []).map(c => c.categoriaId), funcoes: d.funcoes ?? ["ORGAO"],
  identificacaoFiscal: d.identificacaoFiscal || "", tipoIdentificacaoFiscal: d.tipoIdentificacaoFiscal || "",
  formaPagamento: d.formaPagamento || "", chavePix: d.chavePix || "", tipoChavePix: d.tipoChavePix || "",
  banco: d.banco || "", agencia: d.agencia || "", conta: d.conta || "", tipoConta: d.tipoConta || "",
  prazoPagamentoDias: d.prazoPagamentoDias != null ? String(d.prazoPagamentoDias) : "",
  contatoFinanceiro: d.contatoFinanceiro || "", observacoesFinanceiras: d.observacoesFinanceiras || "",
  statusFinanceiro: d.statusFinanceiro || "", ativo: d.ativo,
})

export default function OrgaosProtocoloTab() {
  const [rows, setRows] = useState<Orgao[]>([])
  const [categorias, setCategorias] = useState<CategoriaRef[]>([])
  // PAÍSES GEOGRÁFICOS do Cadastro Mestre — não é a lista de nacionalidades
  // ofertadas: o órgão pode estar em qualquer país do mundo cadastrado.
  const [paisesCadastro, setPaisesCadastro] = useState<PaisCanonico[]>([])
  const [paisesCarregando, setPaisesCarregando] = useState(true)
  const [paisesErro, setPaisesErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)
  const [busca, setBusca] = useState("")
  // O filtro guarda o ID do país, não o texto: filtrar por grafia era o mesmo
  // defeito da coluna, só que na tela.
  const [filtroPais, setFiltroPais] = useState<number | "">("")
  const [filtroFuncao, setFiltroFuncao] = useState<"" | Funcao>("")
  const [suspeitas, setSuspeitas] = useState<Suspeita[]>([])
  const [existente, setExistente] = useState<{ id: number; publicCode: string | null; name: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [resOrg, resCat] = await Promise.all([
        fetch("/api/gerenciamento/orgaos-protocolo", { headers: authHeaders() }),
        fetch("/api/gerenciamento/cadastros/categorias-organizacao", { headers: authHeaders() }).catch(() => null),
      ])
      if (resOrg.ok) setRows((await resOrg.json()).orgaos || [])
      if (resCat?.ok) {
        const j = await resCat.json()
        setCategorias((j.registros ?? j.categorias ?? []).filter((c: CategoriaRef) => c.ativo !== false))
      }
    } finally { setLoading(false) }
  }, [])

  const carregarPaises = useCallback(async () => {
    setPaisesCarregando(true)
    setPaisesErro(null)
    try {
      const res = await fetch("/api/gerenciamento/paises", { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      setPaisesCadastro(((await res.json()).paises ?? []) as PaisCanonico[])
    } catch {
      setPaisesErro("falha ao carregar")
    } finally { setPaisesCarregando(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { carregarPaises() }, [carregarPaises])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2600) }

  // Só os países que REALMENTE têm órgão entram no filtro — a lista completa do
  // cadastro encheria o seletor de opções que não filtram nada.
  const paises = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const r of rows) if (r.paisId != null && r.pais) vistos.set(r.paisId, r.pais.countryLabel)
    return [...vistos.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
  }, [rows])
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return rows.filter(r => {
      if (filtroPais !== "" && r.paisId !== filtroPais) return false
      if (filtroFuncao && !(r.funcoes ?? []).includes(filtroFuncao)) return false
      if (!q) return true
      const alvo = [r.publicCode, r.name, r.nomeFantasia, r.city, r.pais?.countryLabel, ...(r.tags ?? []),
        ...(r.categorias ?? []).map(c => c.categoria?.nome)].filter(Boolean).join(" ").toLowerCase()
      return alvo.includes(q)
    })
  }, [rows, busca, filtroPais, filtroFuncao])

  // DETECÇÃO DE DUPLICIDADE: a organização é única no Discovery. Enquanto o nome
  // é digitado, o servidor diz se a entidade já existe — aí se acrescenta função
  // ao cadastro existente em vez de criar outro.
  const verificarDuplicidade = useCallback(async (f: Form) => {
    const nome = f.name.trim()
    if (nome.length < 4) { setSuspeitas([]); setExistente(null); return }
    const p = new URLSearchParams({ name: nome })
    if (f.nomeFantasia.trim()) p.set("nomeFantasia", f.nomeFantasia.trim())
    if (f.paisId != null) p.set("paisId", String(f.paisId))
    if (f.identificacaoFiscal.trim()) p.set("identificacaoFiscal", f.identificacaoFiscal.trim())
    if (f.id) p.set("ignorarId", String(f.id))
    try {
      const res = await fetch(`/api/gerenciamento/orgaos-protocolo/verificar?${p}`, { headers: authHeaders() })
      if (!res.ok) return
      const j = await res.json()
      setExistente(j.existente ?? null)
      setSuspeitas(j.suspeitas ?? [])
    } catch { /* verificação é auxílio; falha nela não trava o cadastro */ }
  }, [])

  // Agendada pelos próprios campos de identidade (evento), não por efeito: o
  // padrão da casa é não disparar setState dentro de useEffect.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agendarVerificacao = useCallback((f: Form) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => verificarDuplicidade(f), 400)
  }, [verificarDuplicidade])

  async function save() {
    if (!form) return
    if (!form.name.trim()) { showFlash("Informe o nome oficial."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/orgaos-protocolo/${form.id}` : "/api/gerenciamento/orgaos-protocolo"
      const { tags, publicCode: _pc, ...resto } = form
      void _pc
      const body = JSON.stringify({
        ...resto,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        prazoPagamentoDias: resto.prazoPagamentoDias === "" ? null : Number(resto.prazoPagamentoDias),
        // o operador já viu o aviso de duplicidade na tela antes de confirmar
        confirmarAcrescimo: !!existente,
        confirmarNova: suspeitas.length > 0 && !existente,
      })
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.orgao) {
        setForm(null)
        showFlash(j.acrescentado ? "Funções acrescentadas ao cadastro existente (sem duplicar)." : "Salvo.")
        load()
      } else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }

  const abrirForm = (f: Form | null) => { setSuspeitas([]); setExistente(null); setForm(f) }

  async function del(d: Orgao) {
    if (!confirm(`Excluir "${d.name}"?\n\nSe a organização já recebeu protocolo, ela é INATIVADA para preservar o histórico.`)) return
    const res = await fetch(`/api/gerenciamento/orgaos-protocolo/${d.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash(j.inativado ? `Inativada (${j.protocolos} protocolo(s) no histórico).` : "Excluída."); load() }
    else { showFlash(j.error || "Erro ao excluir."); load() }
  }

  // ─── SELEÇÃO MÚLTIPLA ──────────────────────────────────────────────────
  // Item a item pela MESMA porta do `del` acima — inclusive a regra que INATIVA
  // em vez de apagar quando a organização já recebeu protocolo. Por isso o
  // resumo distingue excluída de inativada: o histórico é intocável.
  const idsVisiveis = useMemo(() => visiveis.map((d) => d.id), [visiveis])
  const selecao = useSelecaoEmMassa(idsVisiveis, `orgaos:${busca}:${filtroPais}:${filtroFuncao}`)
  const [excluindoEmMassa, setExcluindoEmMassa] = useState(false)
  const [resultadoEmMassa, setResultadoEmMassa] = useState<ResultadoEmMassa | null>(null)
  const nomePorId = useMemo(() => {
    const mapa = new Map<number, string>()
    for (const d of rows) mapa.set(d.id, d.name)
    return mapa
  }, [rows])

  async function excluirSelecionadas() {
    const ids = [...selecao.selecionados]
    if (ids.length === 0) return
    if (!confirm(
      `Excluir ${ids.length} organização(ões)?\n\n` +
      "As que já receberam protocolo são INATIVADAS para preservar o histórico, não apagadas.",
    )) return
    setExcluindoEmMassa(true)
    setResultadoEmMassa(null)
    const resultado = await executarEmMassa(ids, async (id) => {
      const res = await fetch(`/api/gerenciamento/orgaos-protocolo/${id}`, { method: "DELETE", headers: authHeaders() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, motivo: j.error || `Erro ${res.status}.` }
      // Inativar NÃO é excluir: dizer "excluída" aqui seria mentir sobre o que
      // aconteceu com um registro que continua no cadastro.
      if (j.inativado) return { ok: false, motivo: `inativada — ${j.protocolos} protocolo(s) no histórico` }
      return { ok: true }
    })
    setExcluindoEmMassa(false)
    setResultadoEmMassa(resultado)
    selecao.limpar()
    load()
  }

  const alternarCategoria = (id: number) =>
    setForm(f => f && ({ ...f, categoriaIds: f.categoriaIds.includes(id) ? f.categoriaIds.filter(x => x !== id) : [...f.categoriaIds, id] }))

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Órgãos e Organizações</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Cadastro <strong className="text-white/80">mestre</strong> das entidades com que a operação fala: consulados, embaixadas, registros civis, comuni, tribunais, arquivos, cartórios, transportadoras e parceiros. Uma organização pode ter várias categorias.</p>
          </div>
          <button onClick={() => abrirForm(blank())} className="flex-none rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Nova organização</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, código, cidade, categoria ou tag…" className={inputCls + " max-w-md"} />
          <select
            value={filtroPais === "" ? "" : String(filtroPais)}
            onChange={e => setFiltroPais(e.target.value === "" ? "" : Number(e.target.value))}
            className={inputCls + " max-w-[14rem]"}
          >
            <option value="" className={opt}>Todos os países ({rows.length})</option>
            {paises.map(p => <option key={p.id} value={String(p.id)} className={opt}>{p.label}</option>)}
          </select>
          <select value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value as "" | Funcao)} className={inputCls + " max-w-[12rem]"}>
            <option value="" className={opt}>Todas as funções</option>
            {FUNCOES.map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
          </select>
          <span className="text-xs text-[var(--text-muted)]">{visiveis.length} exibida(s)</span>
        </div>
      </div>

      <ResumoEmMassa
        resultado={resultadoEmMassa}
        substantivo={["organização", "organizações"]}
        genero="f"
        rotuloDoItem={(id) => nomePorId.get(Number(id)) ?? `#${id}`}
        onFechar={() => setResultadoEmMassa(null)}
      />
      <BarraDeSelecao
        quantidade={selecao.quantidade}
        substantivo={["organização", "organizações"]}
        genero="f"
        onLimpar={selecao.limpar}
        onExcluir={() => void excluirSelecionadas()}
        excluindo={excluindoEmMassa}
      />

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="w-10 px-4 py-3 font-medium">
                <CaixaDeSelecaoTodos
                  todosMarcados={selecao.todosMarcados}
                  algumMarcado={selecao.algumMarcado}
                  onAlternar={selecao.alternarTodos}
                />
              </th>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">Nome oficial</th>
              <th className="px-4 py-3 font-medium">Funções</th>
              <th className="px-4 py-3 font-medium">Categorias</th>
              <th className="px-4 py-3 font-medium">País</th>
              <th className="px-4 py-3 font-medium">Cidade</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Província</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhuma organização encontrada.</td></tr>
            ) : visiveis.map(d => (
              <tr key={d.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 align-middle">
                  <CaixaDeSelecao
                    marcada={selecao.selecionados.has(d.id)}
                    onAlternar={() => selecao.alternar(d.id)}
                    rotulo={`Selecionar ${d.name}`}
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-[12px] font-bold text-white/80">{d.publicCode ?? "—"}</td>
                <td className="px-4 py-2.5 text-white">
                  {d.name}
                  {d.nomeFantasia && <span className="ml-2 text-[11px] text-[var(--text-muted)]">{d.nomeFantasia}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(d.funcoes ?? []).map(f => (
                      <span key={f} className={`rounded px-1.5 py-0.5 text-[10px] ${f === 'FORNECEDOR' ? 'bg-[var(--surface-secondary)] text-amber-800' : f === 'ORGAO' ? 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]' : 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]'}`}>{funcaoLabel(f)}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(d.categorias ?? []).length === 0
                      ? <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{typeLabel(d.type)}</span>
                      : (d.categorias ?? []).map(c => (
                        <span key={c.categoriaId} className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-white/70">{c.categoria?.nome}</span>
                      ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-white/70">{d.pais?.countryLabel || "—"}</td>
                <td className="px-4 py-2.5 text-white/70">{d.city || "—"}</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{d.provincia || "—"}</td>
                <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${d.ativo ? "bg-[var(--surface-secondary)] text-green-800" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}>{d.ativo ? "Ativo" : "Inativo"}</span></td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-[var(--text-secondary)]">
                    <button title="Editar" aria-label="Editar" onClick={() => abrirForm(daLinha(d))} className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white"><IEdit /></button>
                    <button title="Excluir" aria-label="Excluir" onClick={() => del(d)} className="rounded p-1 text-red-700/70 hover:bg-[var(--surface-secondary)] hover:text-red-700"><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => abrirForm(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Nova"} organização</h3></div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div className="col-span-2"><CodigoPublicoField codigo={form.publicCode} /></div>

              {/* ORGANIZAÇÃO ÚNICA — se a entidade já existe, acrescenta-se função ao
                  cadastro que existe. Nunca se cria um segundo registro. */}
              {existente && (
                <div className="col-span-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-amber-100">
                  Esta organização <b>já existe</b>: <span className="font-mono">{existente.publicCode ?? `#${existente.id}`}</span> — {existente.name}.
                  <div className="mt-1 text-xs text-amber-800/80">Salvar vai <b>acrescentar as funções e categorias</b> ao cadastro existente, sem duplicar.</div>
                </div>
              )}
              {!existente && suspeitas.length > 0 && (
                <div className="col-span-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-xs text-amber-100/90">
                  Organizações parecidas já cadastradas — confirme que esta é uma entidade diferente:
                  <ul className="mt-1 space-y-0.5">
                    {suspeitas.map(su => (
                      <li key={su.id}>
                        <span className="font-mono">{su.publicCode ?? `#${su.id}`}</span> — {su.name}
                        {su.pais ? ` (${su.pais})` : ""} · {su.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="col-span-2"><label className={labelCls}>Nome oficial *</label><input value={form.name} onChange={e => setForm(f => { if (!f) return f; const novo = { ...f, name: e.target.value }; agendarVerificacao(novo); return novo })} className={inputCls} placeholder="Na língua e grafia oficiais da entidade" /></div>

              <div className="col-span-2">
                <label className={labelCls}>Funções — a mesma organização pode exercer várias</label>
                <div className="flex flex-wrap gap-3 rounded-md border border-[var(--border-default)] px-3 py-2">
                  {FUNCOES.map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1.5 text-sm text-white/80">
                      <input
                        type="checkbox"
                        checked={form.funcoes.includes(v)}
                        onChange={() => setForm(f => f && ({
                          ...f,
                          funcoes: f.funcoes.includes(v) ? f.funcoes.filter(x => x !== v) : [...f.funcoes, v],
                        }))}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div><label className={labelCls}>Nome fantasia</label><input value={form.nomeFantasia} onChange={e => setForm(f => { if (!f) return f; const novo = { ...f, nomeFantasia: e.target.value }; agendarVerificacao(novo); return novo })} className={inputCls} placeholder="Sigla ou nome usual" /></div>
              <div>
                <label className={labelCls}>Tipo</label>
                <select value={form.type} onChange={e => setForm(f => f && { ...f, type: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>—</option>
                  {TYPES.map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Categorias</label>
                {categorias.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-muted)]">Nenhuma categoria cadastrada.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border-default)]">
                    {categorias.map(c => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-white/80 hover:bg-[var(--surface-hover)]">
                        <input type="checkbox" checked={form.categoriaIds.includes(c.id)} onChange={() => alternarCategoria(c.id)} />
                        {c.nome}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className={labelCls}>País</label>
                <SelectPaisCanonico
                  valor={form.paisId}
                  paises={paisesCadastro}
                  carregando={paisesCarregando}
                  erro={paisesErro}
                  onRecarregar={carregarPaises}
                  className={inputCls}
                  onChange={paisId => setForm(f => { if (!f) return f; const novo = { ...f, paisId }; agendarVerificacao(novo); return novo })}
                />
              </div>
              <div><label className={labelCls}>Estado / Região</label><input value={form.state} onChange={e => setForm(f => f && { ...f, state: e.target.value })} className={inputCls} placeholder="Veneto, SP, Cataluña…" /></div>
              <div><label className={labelCls}>Província / Distrito</label><input value={form.provincia} onChange={e => setForm(f => f && { ...f, provincia: e.target.value })} className={inputCls} placeholder="Vicenza (VI), Porto…" /></div>
              <div><label className={labelCls}>Cidade</label><input value={form.city} onChange={e => setForm(f => f && { ...f, city: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>CEP / Código postal</label><input value={form.cep} onChange={e => setForm(f => f && { ...f, cep: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Endereço</label><input value={form.endereco} onChange={e => setForm(f => f && { ...f, endereco: e.target.value })} className={inputCls} /></div>

              <div><label className={labelCls}>Site</label><input value={form.site} onChange={e => setForm(f => f && { ...f, site: e.target.value })} className={inputCls} placeholder="https://" /></div>
              <div><label className={labelCls}>E-mail</label><input value={form.email} onChange={e => setForm(f => f && { ...f, email: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Telefone</label><input value={form.telefone} onChange={e => setForm(f => f && { ...f, telefone: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Horário de funcionamento</label><input value={form.horario} onChange={e => setForm(f => f && { ...f, horario: e.target.value })} className={inputCls} /></div>

              <div>
                <label className={labelCls}>Idioma</label>
                <select value={form.idioma} onChange={e => setForm(f => f && { ...f, idioma: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>—</option>
                  {IDIOMAS.map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>
              <div>
                {/* FICHA DA ENTIDADE, não parâmetro do sistema. "Moeda" sozinho fazia
                    quem configurava supor que o campo alimenta preço ou custo — e ele
                    não alimenta nada: o preço vem da Tabela de Preços e o custo de
                    Fornecedor.moedaPadrao. O rótulo diz de quem é a moeda, e a linha
                    abaixo diz o que ela NÃO faz. */}
                <label className={labelCls}>Moeda utilizada pelo órgão</label>
                <select value={form.moeda} onChange={e => setForm(f => f && { ...f, moeda: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>—</option>
                  {MOEDAS.map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Informação cadastral. Não interfere em preços, custos ou cálculos financeiros.
                </p>
              </div>

              <div className="col-span-2"><label className={labelCls}>Responsável / contato</label><input value={form.responsavel} onChange={e => setForm(f => f && { ...f, responsavel: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Tags</label><input value={form.tags} onChange={e => setForm(f => f && { ...f, tags: e.target.value })} className={inputCls} placeholder="separadas por vírgula" /></div>
              <div className="col-span-2"><label className={labelCls}>Regra de fila</label><input value={form.queueRule} onChange={e => setForm(f => f && { ...f, queueRule: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Observações</label><textarea value={form.observacoes} onChange={e => setForm(f => f && { ...f, observacoes: e.target.value })} rows={3} className={inputCls} /></div>
              {/* IDENTIDADE FISCAL — chave forte de deduplicação entre sistemas. */}
              <div><label className={labelCls}>Identificação fiscal</label><input value={form.identificacaoFiscal} onChange={e => setForm(f => { if (!f) return f; const novo = { ...f, identificacaoFiscal: e.target.value }; agendarVerificacao(novo); return novo })} className={inputCls} placeholder="CNPJ / CPF / VAT / NIF / Partita IVA" /></div>
              <div>
                <label className={labelCls}>Tipo de identificação</label>
                <select value={form.tipoIdentificacaoFiscal} onChange={e => setForm(f => f && { ...f, tipoIdentificacaoFiscal: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>—</option>
                  {["CNPJ", "CPF", "VAT", "NIF", "CIF", "PIVA", "EIN", "OUTRO"].map(v => <option key={v} value={v} className={opt}>{v}</option>)}
                </select>
              </div>

              {/* FINANCEIRO — só aparece para quem é FORNECEDOR: sem função, sem campo morto. */}
              {form.funcoes.includes("FORNECEDOR") && (
                <>
                  <div className="col-span-2 mt-1 border-t border-[var(--border-default)] pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Dados financeiros do fornecedor</div>
                  <div><label className={labelCls}>Forma de pagamento</label><input value={form.formaPagamento} onChange={e => setForm(f => f && { ...f, formaPagamento: e.target.value })} className={inputCls} placeholder="PIX, transferência, boleto…" /></div>
                  <div><label className={labelCls}>Prazo de pagamento (dias)</label><input type="number" min={0} value={form.prazoPagamentoDias} onChange={e => setForm(f => f && { ...f, prazoPagamentoDias: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Chave PIX</label><input value={form.chavePix} onChange={e => setForm(f => f && { ...f, chavePix: e.target.value })} className={inputCls} /></div>
                  <div>
                    <label className={labelCls}>Tipo da chave</label>
                    <select value={form.tipoChavePix} onChange={e => setForm(f => f && { ...f, tipoChavePix: e.target.value })} className={inputCls}>
                      <option value="" className={opt}>—</option>
                      {["CPF", "CNPJ", "EMAIL", "TELEFONE", "ALEATORIA"].map(v => <option key={v} value={v} className={opt}>{v}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>Banco</label><input value={form.banco} onChange={e => setForm(f => f && { ...f, banco: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Agência</label><input value={form.agencia} onChange={e => setForm(f => f && { ...f, agencia: e.target.value })} className={inputCls} /></div>
                  <div><label className={labelCls}>Conta</label><input value={form.conta} onChange={e => setForm(f => f && { ...f, conta: e.target.value })} className={inputCls} /></div>
                  <div>
                    <label className={labelCls}>Tipo de conta</label>
                    <select value={form.tipoConta} onChange={e => setForm(f => f && { ...f, tipoConta: e.target.value })} className={inputCls}>
                      <option value="" className={opt}>—</option>
                      {["CORRENTE", "POUPANCA", "PAGAMENTO"].map(v => <option key={v} value={v} className={opt}>{v}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>Contato financeiro</label><input value={form.contatoFinanceiro} onChange={e => setForm(f => f && { ...f, contatoFinanceiro: e.target.value })} className={inputCls} /></div>
                  <div>
                    <label className={labelCls}>Status financeiro</label>
                    <select value={form.statusFinanceiro} onChange={e => setForm(f => f && { ...f, statusFinanceiro: e.target.value })} className={inputCls}>
                      <option value="" className={opt}>—</option>
                      {[["REGULAR", "Regular"], ["PENDENTE", "Pendente"], ["BLOQUEADO", "Bloqueado"]].map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2"><label className={labelCls}>Observações financeiras</label><textarea value={form.observacoesFinanceiras} onChange={e => setForm(f => f && { ...f, observacoesFinanceiras: e.target.value })} rows={2} className={inputCls} /></div>
                </>
              )}

              <label className="col-span-2 flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} />Ativo</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => abrirForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
