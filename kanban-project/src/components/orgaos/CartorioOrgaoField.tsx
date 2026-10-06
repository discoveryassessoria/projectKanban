// src/components/orgaos/CartorioOrgaoField.tsx
// ============================================================================
// Campo "Cartório" do painel do documento: BUSCA no cadastro OrgaoProtocolo
// (nome/cidade/UF/tipo, por proximidade). Selecionar vincula na hora
// (Documento.orgaoId + Tarefa.orgaoId — POST /api/documentos/:id/orgao).
// Sem correspondência: "Cadastrar este cartório" inline (nome, tipo, cidade,
// UF, país, e-mail, telefone) — cria o órgão e já vincula. Duplicado (mesmo
// nome normalizado na mesma cidade/UF) oferece o existente. Texto livre legado
// sem órgão aparece com o selo "a mapear".
// ============================================================================
"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2, Plus, Search } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

interface OrgaoSugerido { id: number; name: string; type: string | null; city: string | null; state: string | null; pais: string | null; origem: "cadastrado" | "cartorio_nacional"; cartorioId: number | null }
interface Existente { id: number; name: string; city: string | null; state: string | null }
interface PaisCat { id: number; countryLabel: string }

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const rotulo = (o: { city: string | null; state: string | null; type: string | null }) =>
  [o.type, [o.city, o.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")

export function CartorioOrgaoField({
  documentoId, texto, orgaoId, ufSigla, cidade, paisNome, requiredToComplete, onTextoChange, onVinculado,
}: {
  documentoId: number
  texto: string
  orgaoId: number | null
  ufSigla: string | null
  cidade: string
  /** Nome do país de registro (rótulo do CatalogoPais); usado só como padrão do cadastro. */
  paisNome: string
  requiredToComplete?: boolean
  onTextoChange: (v: string) => void
  onVinculado: (orgao: { id: number; name: string }) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [resultado, setResultado] = useState<OrgaoSugerido[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [cadastro, setCadastro] = useState(false)
  const seq = useRef(0)
  const q = texto.trim()
  const cidadeSel = cidade.trim()
  // Sem texto digitado, mas com CIDADE já escolhida na Localidade acima: ainda
  // assim busca — lista todos os cartórios daquela cidade ao abrir o campo
  // (era o comportamento de antes, com o <datalist> por uf+município; perdido
  // quando este campo passou a exigir 2+ caracteres pra buscar).
  const podeBuscar = q.length >= 2 || !!cidadeSel

  useEffect(() => {
    if (!aberto || !podeBuscar) { setResultado([]); return }
    let ativo = true
    setCarregando(true)
    const t = setTimeout(() => {
      const params = new URLSearchParams()
      if (q) params.set("q", q)
      if (ufSigla) params.set("uf", ufSigla)
      if (cidadeSel) params.set("cidade", cidadeSel)
      fetch(`/api/operacao/orgaos/busca?${params.toString()}`, { headers: auth() })
        .then((r) => (r.ok ? r.json() : { orgaos: [] }))
        .then((j) => { if (ativo) setResultado(j.orgaos ?? []) })
        .catch(() => { if (ativo) setResultado([]) })
        .finally(() => { if (ativo) setCarregando(false) })
    }, 250)
    return () => { ativo = false; clearTimeout(t) }
  }, [q, aberto, ufSigla, cidadeSel, podeBuscar])
  const buscando = aberto && podeBuscar && carregando
  const sugestoes = resultado

  const vincular = async (corpo: Record<string, unknown>) => {
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/documentos/${documentoId}/orgao`, { method: "POST", headers: auth(), body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false as const, status: r.status, corpo: j }
      onVinculado(j.orgao); setAberto(false); setCadastro(false)
      return { ok: true as const, status: 200, corpo: {} }
    } catch {
      setErro("Não foi possível vincular agora. Tente novamente.")
      return { ok: false as const, status: 0, corpo: {} }
    } finally { setSalvando(false) }
  }

  const aMapear = !!q && orgaoId == null
  const semResultado = aberto && !buscando && podeBuscar && sugestoes.length === 0

  return (
    <div className="col-span-2 relative">
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-secondary)]">Cartório</label>
        {requiredToComplete && (
          <span className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            !q ? "bg-[var(--accent-primary)]/20 text-[var(--accent-text)] border-[var(--accent-primary)]/40"
               : "bg-[var(--surface-secondary)] text-green-800 border-[var(--border-default)]"}`}>obrigatório p/ concluir</span>
        )}
        {aMapear && (
          <span data-testid="selo-a-mapear" className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--warning-bg,transparent)] text-[var(--warning-text)] border border-[var(--warning-text)]/40">a mapear</span>
        )}
        {orgaoId != null && (
          <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--success-text)] border border-[var(--success-text)]/40">vinculado</span>
        )}
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
        <input
          data-testid="cartorio-busca"
          value={texto}
          onChange={(e) => { onTextoChange(e.target.value); setAberto(true) }}
          onFocus={() => setAberto(true)}
          placeholder={cidadeSel ? `Buscar cartório em ${cidadeSel}…` : "Buscar cartório por nome, cidade ou UF…"}
          className="w-full pl-8 pr-8 py-2 text-[13px] rounded-md bg-[var(--surface-secondary)] border border-[var(--border-default)] text-[var(--text-primary)]"
        />
        {buscando && <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" />}
      </div>

      {aberto && podeBuscar && (
        <div className="absolute left-0 right-0 mt-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-lg max-h-64 overflow-y-auto" style={{ zIndex: LAYER.popover }}>
          {sugestoes.map((o) => (
            <button key={`${o.origem}-${o.id}`} type="button" disabled={salvando} data-testid="cartorio-sugestao"
              onClick={() => {
                onTextoChange(o.name)
                // "cartorio_nacional": ainda não é um OrgaoProtocolo — a base nacional de
                // cartórios (7000+, Registro Civil/Transparência) é só REFERÊNCIA.
                // `cartorioId` promove (cria ou reaproveita) e vincula na mesma chamada.
                void vincular(o.origem === "cartorio_nacional" ? { cartorioId: o.cartorioId } : { orgaoId: o.id })
              }}
              className="w-full text-left px-3 py-2 hover:bg-[var(--surface-secondary)] border-b border-[var(--border-default)] last:border-0">
              <div className="text-[12.5px] text-[var(--text-primary)] flex items-center gap-1.5">
                {o.name}
                {o.origem === "cartorio_nacional" && (
                  <span className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)]">base nacional</span>
                )}
              </div>
              <div className="text-[10.5px] text-[var(--text-secondary)]">{rotulo(o)}{o.pais ? ` · ${o.pais}` : ""}</div>
            </button>
          ))}
          {semResultado && (
            <div className="px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">Nenhum órgão cadastrado com “{q}”.</div>
          )}
          {!buscando && (
            <button type="button" data-testid="cartorio-cadastrar" onClick={() => { setAberto(false); setCadastro(true) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--surface-secondary)]">
              <Plus className="w-3.5 h-3.5" /> Cadastrar este cartório
            </button>
          )}
        </div>
      )}
      {erro && <div className="mt-1 text-[10.5px] text-[var(--warning-text)]">{erro}</div>}

      {cadastro && (
        <ModalCadastro
          nomeInicial={q} cidadeInicial={cidade} ufInicial={ufSigla ?? ""} paisNome={paisNome} salvando={salvando}
          onFechar={() => setCadastro(false)}
          onSalvar={(novo) => vincular({ novo })}
          onUsarExistente={(id) => vincular({ orgaoId: id })}
        />
      )}
    </div>
  )
}

function ModalCadastro({ nomeInicial, cidadeInicial, ufInicial, paisNome, salvando, onFechar, onSalvar, onUsarExistente }: {
  nomeInicial: string; cidadeInicial: string; ufInicial: string; paisNome: string; salvando: boolean
  onFechar: () => void
  onSalvar: (n: Record<string, unknown>) => Promise<{ ok: boolean; status: number; corpo: { code?: string; mensagem?: string; existente?: Existente } }>
  onUsarExistente: (id: number) => Promise<unknown>
}) {
  const [f, setF] = useState({ name: nomeInicial, tipo: "CARTORIO", city: cidadeInicial, state: ufInicial, paisId: "", email: "", telefone: "" })
  const [paises, setPaises] = useState<PaisCat[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [existente, setExistente] = useState<Existente | null>(null)

  useEffect(() => {
    fetch("/api/paises").then((r) => (r.ok ? r.json() : { paises: [] })).then((j) => {
      const lista: PaisCat[] = j.paises ?? []
      setPaises(lista)
      const alvo = (paisNome || "Brasil").toLowerCase()
      const achou = lista.find((p) => p.countryLabel.toLowerCase() === alvo || (alvo === "brazil" && p.countryLabel.toLowerCase() === "brasil"))
      if (achou) setF((x) => (x.paisId ? x : { ...x, paisId: String(achou.id) }))
    }).catch(() => setPaises([]))
  }, [paisNome])

  const completo = f.name.trim() && f.tipo && f.city.trim() && f.paisId
  const enviar = async () => {
    setErro(null); setExistente(null)
    const r = await onSalvar({ ...f, paisId: f.paisId ? Number(f.paisId) : null })
    if (r.ok) return
    if (r.corpo.code === "DUPLICADO" && r.corpo.existente) { setExistente(r.corpo.existente); return }
    setErro(r.corpo.mensagem ?? "Não foi possível cadastrar.")
  }
  const cls = "w-full px-2.5 py-1.5 text-[13px] rounded-md bg-[var(--surface-secondary)] border border-[var(--border-default)] text-[var(--text-primary)]"
  const lab = "block text-[10px] uppercase font-semibold tracking-wider text-[var(--text-secondary)] mb-1"

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: LAYER.aboveProcessCritical }} data-testid="modal-cadastrar-cartorio">
      <div className="w-[480px] max-w-[92vw] rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Cadastrar este cartório</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={lab}>Nome *</label><input className={cls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className={lab}>Tipo *</label>
            <select className={cls} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="CARTORIO">Cartório</option><option value="CONSULADO">Consulado</option>
              <option value="JUIZO">Juízo</option><option value="OUTRO">Outro</option>
            </select></div>
          <div><label className={lab}>País *</label>
            <select className={cls} value={f.paisId} onChange={(e) => setF({ ...f, paisId: e.target.value })}>
              <option value="">Selecione…</option>{paises.map((p) => <option key={p.id} value={p.id}>{p.countryLabel}</option>)}
            </select></div>
          <div><label className={lab}>Cidade *</label><input className={cls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
          <div><label className={lab}>UF</label><input className={cls} maxLength={60} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></div>
          <div><label className={lab}>E-mail</label><input className={cls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label className={lab}>Telefone</label><input className={cls} value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></div>
        </div>
        {existente && (
          <div data-testid="aviso-duplicado" className="mt-3 p-2.5 rounded-md border border-[var(--warning-text)]/40 text-[12px] text-[var(--warning-text)]">
            Já existe “{existente.name}” ({[existente.city, existente.state].filter(Boolean).join("/")}). Use o cadastro existente em vez de criar outro.
            <div className="mt-2"><button type="button" disabled={salvando} onClick={() => void onUsarExistente(existente.id)}
              className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white">Usar o existente</button></div>
          </div>
        )}
        {erro && <div className="mt-3 text-[12px] text-[var(--warning-text)]">{erro}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-default)] text-[var(--text-primary)]">Cancelar</button>
          <button type="button" disabled={!completo || salvando} onClick={() => void enviar()}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white disabled:opacity-50">
            {salvando ? "Salvando…" : "Cadastrar e vincular"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
