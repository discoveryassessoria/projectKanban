"use client"

// src/components/gerenciamentoComponents/ProfissionaisTab.tsx
// ÓRGÃOS E ORGANIZAÇÕES → PROFISSIONAIS.
//
// Cadastro ÚNICO das pessoas que exercem profissão regulamentada e atuam nos
// processos — advogado, tradutor juramentado, despachante. A Retificação apenas
// REFERENCIA daqui; não existe "advogado da retificação" como cadastro próprio, e é
// por isso que esta tela mora no módulo das entidades externas e não dentro de uma
// fase.
//
// A INSCRIÇÃO DE CLASSE É LISTA. O modelo aceita mais de uma — o mesmo advogado pode
// ter OAB em duas UFs, e um tradutor tem matrícula na Junta Comercial junto — então a
// tela administra a lista. Mostrar um campo só seria mentir sobre o schema.
//
// Backend: /api/gerenciamento/profissionais (GET/POST) + /[id] (GET/PATCH/DELETE)

import { useEffect, useState, useCallback } from "react"

interface Registro {
  id?: number
  tipo: string
  numero: string
  jurisdicao: string | null
  orgaoDeClasseId: number | null
  ativo: boolean
}

interface Profissional {
  id: number
  nome: string
  categoria: string
  email: string | null
  telefone: string | null
  observacoes: string | null
  ativo: boolean
  organizacaoId: number | null
  organizacao: { id: number; name: string; nomeFantasia: string | null } | null
  registros: Registro[]
  _count: { retificacoes: number }
}

interface Organizacao { id: number; name: string; nomeFantasia: string | null }

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"

/**
 * As categorias que o sistema já usa. É SUGESTÃO, não trava: `categoria` é texto
 * aberto no modelo, e a próxima profissão não pode exigir deploy. O campo aceita o
 * que for digitado.
 */
const CATEGORIAS_CONHECIDAS = ["advogado", "tradutor juramentado", "despachante", "contador", "correspondente"]
/** Idem para o conselho: OAB é um VALOR, e a lista só poupa digitação. */
const TIPOS_DE_REGISTRO_CONHECIDOS = ["OAB", "CRC", "CREA", "CRM", "JUCESP", "MTE"]

/** O formulário: o profissional sem as projeções de leitura, e com `id` só ao editar. */
type Formulario = Omit<Profissional, "id" | "organizacao" | "_count"> & { id?: number }

const vazio = (): Formulario => ({
  nome: "", categoria: "advogado", email: null, telefone: null, observacoes: null,
  ativo: true, organizacaoId: null, registros: [],
})

/** "OAB 123456/SP" — projeção montada aqui, nunca um campo guardado. */
export function descreverRegistro(r: Registro): string {
  return `${r.tipo} ${r.numero}${r.jurisdicao ? `/${r.jurisdicao}` : ""}`
}

export function ProfissionaisTab() {
  const [lista, setLista] = useState<Profissional[]>([])
  const [orgs, setOrgs] = useState<Organizacao[]>([])
  const [busca, setBusca] = useState("")
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<Formulario | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)

  // A BUSCA ENTRA NA CORRENTE, e não num `await` dentro do efeito: estado mexido antes
  // do primeiro await dispara render em cascata. `carregando` nasce ligado e é
  // religado por quem digita — evento de gente, não efeito.
  const [recarga, setRecarga] = useState(0)
  const carregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => {
    const q = new URLSearchParams()
    if (busca.trim()) q.set("q", busca.trim())
    if (mostrarInativos) q.set("inativos", "1")
    let vivo = true
    fetch(`/api/gerenciamento/profissionais?${q}`, { headers: authHeaders() })
      .then(async (r) => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => {
        if (!vivo) return
        if (!ok) { setErro(j.mensagem || j.error || "Não foi possível carregar."); return }
        setLista(j.profissionais ?? []); setErro(null)
      })
      .catch(() => { if (vivo) setErro("Erro ao carregar profissionais.") })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [busca, mostrarInativos, recarga])
  useEffect(() => {
    // O ESCRITÓRIO VEM DE ORGANIZAÇÕES. Não se cadastra escritório aqui — escolhe-se.
    void (async () => {
      const r = await fetch("/api/gerenciamento/orgaos-protocolo?limite=500", { headers: authHeaders() }).catch(() => null)
      if (!r?.ok) return
      const j = await r.json().catch(() => null)
      setOrgs((j?.orgaos ?? j?.organizacoes ?? j?.itens ?? []) as Organizacao[])
    })()
  }, [])

  async function salvar() {
    if (!form) return
    setSalvando(true); setErroForm(null)
    try {
      const editando = typeof form.id === "number"
      const r = await fetch(
        editando ? `/api/gerenciamento/profissionais/${form.id}` : "/api/gerenciamento/profissionais",
        { method: editando ? "PATCH" : "POST", headers: authHeaders(), body: JSON.stringify(form) },
      )
      const j = await r.json()
      if (!r.ok) throw new Error(j.mensagem || j.error || "Não foi possível salvar.")
      setForm(null)
      carregar()
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : "Erro ao salvar.")
    } finally {
      setSalvando(false)
    }
  }

  async function alternarAtivo(p: Profissional) {
    await fetch(`/api/gerenciamento/profissionais/${p.id}`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify({ ativo: !p.ativo }),
    })
    carregar()
  }

  async function excluir(p: Profissional) {
    const r = await fetch(`/api/gerenciamento/profissionais/${p.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await r.json().catch(() => ({}))
    // EM USO NÃO SE APAGA. A mensagem do servidor explica e oferece o caminho certo.
    if (!r.ok) { setErro(j.mensagem || "Não foi possível excluir."); return }
    carregar()
  }

  const setCampo = (patch: Partial<Formulario>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const setRegistro = (i: number, patch: Partial<Registro>) =>
    setForm((f) => (f ? { ...f, registros: f.registros.map((r, k) => (k === i ? { ...r, ...patch } : r)) } : f))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-white">Profissionais</h2>
        <p className="mt-1 text-sm text-white/50">
          Pessoas que exercem profissão regulamentada e atuam nos processos. Os pedidos de retificação
          referenciam daqui — nome e inscrição são lidos deste cadastro, nunca copiados.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${inputCls} max-w-sm`} placeholder="Buscar por nome, e-mail, categoria ou número do registro"
          value={busca} onChange={(e) => { setCarregando(true); setErro(null); setBusca(e.target.value) }}
        />
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => { setCarregando(true); setMostrarInativos(e.target.checked) }} />
          mostrar fora de circulação
        </label>
        <button
          onClick={() => { setErroForm(null); setForm({ ...vazio() }) }}
          className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
        >+ Novo profissional</button>
      </div>

      {erro && <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">{erro}</div>}

      {carregando ? (
        <p className="py-10 text-center text-sm text-white/40">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-white/40">
          {busca ? "Nenhum profissional encontrado para essa busca." : "Nenhum profissional cadastrado ainda."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-2.5">Nome</th>
                <th className="px-4 py-2.5">Categoria</th>
                <th className="px-4 py-2.5">Registro</th>
                <th className="px-4 py-2.5">Escritório</th>
                <th className="px-4 py-2.5">Situação</th>
                <th className="px-4 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={`border-t border-white/5 ${p.ativo ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2.5 text-white/90">{p.nome}</td>
                  <td className="px-4 py-2.5 text-white/60">{p.categoria}</td>
                  <td className="px-4 py-2.5 text-white/60">
                    {p.registros.filter((r) => r.ativo !== false).map(descreverRegistro).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-white/60">
                    {p.organizacao ? (p.organizacao.nomeFantasia || p.organizacao.name) : "autônomo"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={p.ativo ? "text-emerald-300/80" : "text-white/40"}>
                      {p.ativo ? "em circulação" : "fora de circulação"}
                    </span>
                    {p._count.retificacoes > 0 && (
                      <span className="ml-2 text-[11px] text-white/35">{p._count.retificacoes} pedido(s)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => { setErroForm(null); setForm({ ...p }) }}
                      className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10">Editar</button>
                    <button onClick={() => void alternarAtivo(p)}
                      className="ml-2 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10">
                      {p.ativo ? "Tirar de circulação" : "Reativar"}
                    </button>
                    {/* EXCLUIR só aparece para quem nunca foi usado — quem já conduziu
                        um pedido é histórico, e o botão diria uma coisa que não pode fazer. */}
                    {p._count.retificacoes === 0 && (
                      <button onClick={() => void excluir(p)}
                        className="ml-2 rounded border border-white/10 px-2 py-1 text-xs text-red-300/80 hover:bg-red-500/10">Excluir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[#0f1115] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-white">
              {form.id ? "Editar profissional" : "Novo profissional"}
            </h3>

            {erroForm && <div className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{erroForm}</div>}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Nome *</label>
                <input className={inputCls} value={form.nome} onChange={(e) => setCampo({ nome: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Categoria profissional *</label>
                <input className={inputCls} list="categorias-profissionais" value={form.categoria}
                  onChange={(e) => setCampo({ categoria: e.target.value })} />
                <datalist id="categorias-profissionais">
                  {CATEGORIAS_CONHECIDAS.map((c) => <option key={c} value={c} />)}
                </datalist>
                <p className="mt-1 text-[11px] text-white/35">Sugestões conhecidas; aceita qualquer categoria.</p>
              </div>
              <div>
                <label className={labelCls}>Escritório / organização</label>
                <select className={inputCls} value={form.organizacaoId ?? ""}
                  onChange={(e) => setCampo({ organizacaoId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— autônomo —</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.nomeFantasia || o.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-white/35">Escolhido em Órgãos e Organizações — não se cadastra escritório aqui.</p>
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input className={inputCls} value={form.email ?? ""} onChange={(e) => setCampo({ email: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Telefone</label>
                <input className={inputCls} value={form.telefone ?? ""} onChange={(e) => setCampo({ telefone: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Observações</label>
                <textarea className={inputCls} rows={2} value={form.observacoes ?? ""} onChange={(e) => setCampo({ observacoes: e.target.value })} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setCampo({ ativo: e.target.checked })} />
                em circulação
              </label>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <label className={`${labelCls} mb-0`}>Registros de classe</label>
                <button
                  onClick={() => setForm((f) => f ? { ...f, registros: [...f.registros, { tipo: "OAB", numero: "", jurisdicao: null, orgaoDeClasseId: null, ativo: true }] } : f)}
                  className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10">+ Registro</button>
              </div>
              <p className="mt-1 text-[11px] text-white/35">
                O tipo é um valor, não uma estrutura: OAB, CRC, JUCESP. A mesma inscrição não se repete no sistema —
                &quot;OAB 123456/SP&quot; identifica uma pessoa só.
              </p>
              {form.registros.length === 0 && (
                <p className="mt-2 text-[11px] text-white/35">Nenhum registro. Um advogado sem OAB não pode assinar petição.</p>
              )}
              {form.registros.map((r, i) => (
                <div key={i} className="mt-2 grid grid-cols-[110px_1fr_90px_auto] items-center gap-2">
                  <input className={inputCls} list="tipos-registro" placeholder="OAB" value={r.tipo}
                    onChange={(e) => setRegistro(i, { tipo: e.target.value.toUpperCase() })} />
                  <input className={inputCls} placeholder="número" value={r.numero}
                    onChange={(e) => setRegistro(i, { numero: e.target.value })} />
                  <input className={inputCls} placeholder="UF" value={r.jurisdicao ?? ""}
                    onChange={(e) => setRegistro(i, { jurisdicao: e.target.value.toUpperCase() || null })} />
                  <button onClick={() => setForm((f) => f ? { ...f, registros: f.registros.filter((_, k) => k !== i) } : f)}
                    className="rounded border border-white/10 px-2 py-2 text-xs text-red-300/80 hover:bg-red-500/10">Remover</button>
                </div>
              ))}
              <datalist id="tipos-registro">
                {TIPOS_DE_REGISTRO_CONHECIDOS.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/10">Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando || !form.nome.trim() || !form.categoria.trim()}
                className="rounded-lg border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-40">
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
