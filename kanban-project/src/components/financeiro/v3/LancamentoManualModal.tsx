// src/components/financeiro/v3/LancamentoManualModal.tsx
// ============================================================================
// LANÇAMENTO MANUAL de Receita/Custo dentro do processo. Nasce SEMPRE de um item
// do Cadastro Mestre (Gerenciamento) — Tipo → Item → auto-preenche valor/moeda/
// categoria/fornecedor/forma. Ajuste manual só dos campos autorizados. Vínculo a
// processo inteiro / 1 requerente / vários (com rateio). Prévia de totais e
// distribuição antes de salvar. Reusa o motor V3 (POST /receitas | /custos).
// ============================================================================
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X, Plus, Users, User, Building2 } from "lucide-react"
import { emitirMutacaoFinanceira } from "@/src/lib/financeiro-bus"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const NATUREZA_LABEL: Record<string, string> = { DOCUMENTO: "Documento", PRODUTO: "Produto", SERVICO: "Serviço", HONORARIO: "Honorário", TAXA: "Taxa", DESPESA: "Despesa", LOGISTICA: "Logística", OUTRO: "Outro" }

type Natureza = "RECEITA" | "CUSTO"
type Vinculo = "processo" | "requerentes"
type ModoRateio = "IGUAL" | "PERCENTUAL" | "VALOR"

interface Item { id: number; name: string; natureza: string; categoria?: string | null; unidade?: string }
interface Requerente { id: number; nome: string; personId: number | null }
interface Fase { phaseKey: string; label: string }
interface Fornecedor { id: number; nome: string }

export function LancamentoManualModal({ natureza, processoId, onClose, onCriado }: { natureza: Natureza; processoId: number; onClose: () => void; onCriado: (r?: { obrigacaoRef: number | null }) => void }) {
  const receita = natureza === "RECEITA"
  const [itens, setItens] = useState<Item[] | null>(null)
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [fases, setFases] = useState<Fase[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [centros, setCentros] = useState<{ id: number; nome: string }[]>([])
  const [centroCustoId, setCentroCustoId] = useState<string>("")

  // campos
  const [tipo, setTipo] = useState<string>("")           // filtra itens por natureza
  const [itemId, setItemId] = useState<string>("")
  const [descricao, setDescricao] = useState("")
  const [quantidade, setQuantidade] = useState("1")
  const [valorUnitario, setValorUnitario] = useState("")
  const [moeda, setMoeda] = useState("BRL")
  const [desconto, setDesconto] = useState("")
  const [acrescimo, setAcrescimo] = useState("")
  const [formaCobranca, setFormaCobranca] = useState("")
  const [fornecedorId, setFornecedorId] = useState<string>("")
  const [faseKey, setFaseKey] = useState<string>("")
  const [vencimento, setVencimento] = useState("")
  const [observacoes, setObservacoes] = useState("")

  // vínculo / rateio
  const [vinculo, setVinculo] = useState<Vinculo>("processo")
  const [selReq, setSelReq] = useState<Set<number>>(new Set()) // requerenteIds
  const [modoRateio, setModoRateio] = useState<ModoRateio>("IGUAL")
  const [rateioVal, setRateioVal] = useState<Record<number, string>>({}) // por requerenteId (percentual ou valor)

  const [salvando, setSalvando] = useState<null | "salvar" | "pagamento">(null)
  const [erro, setErro] = useState<string | null>(null)

  // ---- carregamentos base ----
  useEffect(() => {
    fetch(`/api/financeiro/v3/itens-catalogo${receita ? '?paraReceita=1' : ''}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setItens(j.itens ?? [])).catch(() => setItens([]))
    fetch(`/api/processos/${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => {
      const reqs = (j?.processo?.requerentes ?? j?.requerentes ?? []).map((x: any) => ({ id: x.id, nome: [x.nome, x.sobrenome].filter(Boolean).join(" ") || x.nome, personId: x.personId ?? null }))
      setRequerentes(reqs)
    }).catch(() => setRequerentes([]))
    fetch(`/api/processos/${processoId}/phases`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setFases((j?.phases ?? []).map((p: any) => ({ phaseKey: p.phaseKey, label: p.label })))).catch(() => setFases([]))
    if (!receita) {
      fetch(`/api/fornecedores?ativo=true`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setFornecedores((Array.isArray(j) ? j : j?.fornecedores ?? []).map((f: any) => ({ id: f.id, nome: f.nome })))).catch(() => setFornecedores([]))
      fetch(`/api/financeiro/v3/centros-custo`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setCentros(j?.centros ?? [])).catch(() => setCentros([]))
    }
  }, [processoId, receita])

  const tipos = useMemo(() => Array.from(new Set((itens ?? []).map((i) => i.natureza))), [itens])
  const itensFiltrados = useMemo(() => (itens ?? []).filter((i) => !tipo || i.natureza === tipo), [itens, tipo])

  // ---- auto-preenchimento ao escolher item ----
  useEffect(() => {
    if (!itemId) return
    const q = Number(quantidade) || 1
    fetch(`/api/financeiro/v3/item-config?itemCatalogoId=${itemId}&natureza=${natureza}&processoId=${processoId}&quantidade=${q}`, { headers: authHeaders() })
      .then((r) => r.json()).then((j) => {
        const d = j?.defaults
        if (!d) return
        if (d.valorUnitario != null) setValorUnitario(String(d.valorUnitario))
        if (d.moeda) setMoeda(d.moeda)
        if (d.formaCobranca) setFormaCobranca(d.formaCobranca)
        if (!receita && d.fornecedorPadraoId) setFornecedorId(String(d.fornecedorPadraoId))
        if (d.descricao && !descricao) setDescricao(d.descricao)
      }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // ---- totais ----
  const qtd = Math.max(1, Number(quantidade) || 1)
  const unit = Number(String(valorUnitario).replace(",", ".")) || 0
  const desc = Math.max(0, Number(String(desconto).replace(",", ".")) || 0)
  const acr = receita ? 0 : Math.max(0, Number(String(acrescimo).replace(",", ".")) || 0)
  const subtotal = cent(qtd * unit)
  const total = cent(subtotal - desc + acr)

  // requerentes elegíveis ao rateio (têm pessoa vinculada)
  // chave de idempotência estável por sessão (duplo clique/retry não duplica)
  const idemKey = useRef(`manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
  const reqSelecionados = useMemo(() => requerentes.filter((r) => selReq.has(r.id)), [requerentes, selReq])
  const distribuicao = useMemo(() => {
    if (vinculo !== "requerentes" || reqSelecionados.length === 0) return []
    if (reqSelecionados.length === 1) return [{ nome: reqSelecionados[0].nome, valor: total, pct: 100 }]
    if (modoRateio === "IGUAL") { const v = cent(total / reqSelecionados.length); return reqSelecionados.map((r, i) => ({ nome: r.nome, valor: i === reqSelecionados.length - 1 ? cent(total - v * (reqSelecionados.length - 1)) : v, pct: cent(100 / reqSelecionados.length) })) }
    if (modoRateio === "PERCENTUAL") return reqSelecionados.map((r) => { const p = Number(rateioVal[r.id]) || 0; return { nome: r.nome, valor: cent(total * p / 100), pct: p } })
    return reqSelecionados.map((r) => { const v = Number(rateioVal[r.id]) || 0; return { nome: r.nome, valor: cent(v), pct: total ? cent(v / total * 100) : 0 } })
  }, [vinculo, reqSelecionados, modoRateio, rateioVal, total])
  const somaRateio = cent(distribuicao.reduce((s, d) => s + d.valor, 0))

  function toggleReq(id: number) { setSelReq((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  function montarRateio() {
    if (vinculo !== "requerentes" || reqSelecionados.length === 0) return null
    const semPessoa = reqSelecionados.filter((r) => r.personId == null)
    if (semPessoa.length) throw new Error(`Requerente sem identidade vinculada não entra no rateio: ${semPessoa.map((r) => r.nome).join(", ")}.`)
    if (reqSelecionados.length === 1) return { modo: "IGUAL" as const, participantes: [{ pessoaId: reqSelecionados[0].personId!, incluido: true }] }
    if (modoRateio === "IGUAL") return { modo: "IGUAL" as const, participantes: reqSelecionados.map((r) => ({ pessoaId: r.personId!, incluido: true })) }
    if (modoRateio === "PERCENTUAL") return { modo: "PERCENTUAL" as const, participantes: reqSelecionados.map((r) => ({ pessoaId: r.personId!, percentual: Number(rateioVal[r.id]) || 0, incluido: true })) }
    return { modo: "VALOR" as const, participantes: reqSelecionados.map((r) => ({ pessoaId: r.personId!, valor: Number(rateioVal[r.id]) || 0, incluido: true })) }
  }

  async function salvar(comPagamento: boolean) {
    setErro(null)
    if (!itemId) { setErro("Selecione o item do Cadastro Mestre."); return }
    if (unit <= 0) { setErro("Informe um valor unitário maior que zero."); return }
    if (total <= 0) { setErro("O total precisa ser maior que zero."); return }
    let rateio: any = null
    try { rateio = montarRateio() } catch (e) { setErro(e instanceof Error ? e.message : "Rateio inválido."); return }
    setSalvando(comPagamento ? "pagamento" : "salvar")
    try {
      const url = receita ? `/api/financeiro/v3/receitas` : `/api/financeiro/v3/custos`
      const faseLabel = fases.find((f) => f.phaseKey === faseKey)?.label ?? null
      let body: any
      if (receita) {
        // RECEITA CANÔNICA: item mestre + participantes reais (requerenteId) + idempotência.
        const vinc = vinculo === "requerentes" ? "PARTICIPANTES" : "PROCESSO"
        const n = reqSelecionados.length
        const participantes = vinc === "PARTICIPANTES" ? reqSelecionados.map((r, i) => {
          let valor = 0
          if (n === 1) valor = total
          else if (modoRateio === "IGUAL") { const v = cent(total / n); valor = i === n - 1 ? cent(total - v * (n - 1)) : v }
          else if (modoRateio === "PERCENTUAL") valor = cent(total * (Number(rateioVal[r.id]) || 0) / 100)
          else valor = cent(Number(rateioVal[r.id]) || 0)
          return { requerenteId: r.id, nome: r.nome, valor }
        }) : []
        body = {
          processoId, itemCatalogoId: Number(itemId),
          descricao: [descricao.trim(), observacoes.trim()].filter(Boolean).join(" — ") || undefined,
          quantidade: qtd, valorUnitario: unit, desconto: desc || undefined,
          faseLabel: faseLabel || undefined, vinculo: vinc, participantes,
          idempotencyKey: idemKey.current,
        }
      } else {
        body = {
          processoId, itemCatalogoId: Number(itemId),
          descricao: [descricao.trim(), observacoes.trim()].filter(Boolean).join(" — ") || undefined,
          quantidade: qtd, valorUnitario: unit, moeda, desconto: desc || undefined, vencimento: vencimento || undefined,
          formaCobranca: formaCobranca || undefined, faseLabel: faseLabel || undefined, rateio,
          acrescimo: acr || undefined, fornecedorId: fornecedorId ? Number(fornecedorId) : undefined, centroCustoId: centroCustoId ? Number(centroCustoId) : undefined,
        }
      }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setErro(j?.erro || j?.motivo || `Falha ao salvar (HTTP ${res.status}).`); return }
      emitirMutacaoFinanceira({ processoId, obrigacaoId: j.obrigacaoRef ?? null })
      onCriado(comPagamento ? { obrigacaoRef: j.obrigacaoRef ?? null } : undefined)
    } catch { setErro("Erro de conexão ao salvar.") } finally { setSalvando(null) }
  }

  const inputCls = "mt-1 w-full rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/95 outline-none placeholder:text-white/30"
  const labelCls = "block text-xs text-white/68"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-xl border border-white/10 bg-[#1b2027] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{receita ? "Nova Receita" : "Novo Custo"}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* Tipo + Item */}
          <label className={labelCls}>Tipo
            <select value={tipo} onChange={(e) => { setTipo(e.target.value); setItemId("") }} className={inputCls}>
              <option value="">Todos os tipos</option>
              {tipos.map((t) => <option key={t} value={t}>{NATUREZA_LABEL[t] ?? t}</option>)}
            </select>
          </label>
          <label className={labelCls}>Item do Cadastro Mestre
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
              <option value="">{itens == null ? "carregando…" : "Selecione…"}</option>
              {itensFiltrados.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>

          {/* Descrição complementar */}
          <label className={`${labelCls} col-span-2`}>Descrição {receita ? "" : ""}<span className="text-white/30"> (complementar, opcional)</span>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Padrão: nome do item" className={inputCls} />
          </label>

          {/* Quantidade / Valor unitário / Moeda */}
          <label className={labelCls}>Quantidade
            <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="numeric" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Valor unitário{receita && <span className="ml-1 text-[10px] text-[#7dd3fc]">(Cadastro Mestre)</span>}
              <input value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
              {receita && <span className="mt-0.5 block text-[10px] text-white/35">Definido pelo Cadastro Mestre — alterar exige permissão.</span>}
            </label>
            <label className={labelCls}>Moeda
              {receita ? (
                <div className={`${inputCls} flex items-center justify-between`}><span>{moeda}</span><span className="text-[10px] text-white/35">Definido pelo Cadastro Mestre</span></div>
              ) : (
                <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>{["BRL", "EUR", "USD"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
              )}
            </label>
          </div>

          {/* Desconto / Acréscimo(custo) */}
          <label className={labelCls}>Desconto
            <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
          </label>
          {!receita ? (
            <label className={labelCls}>Acréscimos
              <input value={acrescimo} onChange={(e) => setAcrescimo(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
            </label>
          ) : <div />}

          {/* Fornecedor (custo) / Forma de cobrança */}
          {!receita && (
            <label className={labelCls}>Fornecedor
              <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
          )}
          {!receita && (
            <label className={labelCls}>Centro de custo <span className="text-white/30">(opcional)</span>
              <select value={centroCustoId} onChange={(e) => setCentroCustoId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          )}
          <label className={labelCls}>Forma de {receita ? "cobrança" : "pagamento"}
            <input value={formaCobranca} onChange={(e) => setFormaCobranca(e.target.value)} placeholder="—" className={inputCls} />
          </label>

          {/* Fase / Vencimento */}
          <label className={labelCls}>Fase <span className="text-white/30">(opcional)</span>
            <select value={faseKey} onChange={(e) => setFaseKey(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {fases.map((f) => <option key={f.phaseKey} value={f.phaseKey}>{f.label}</option>)}
            </select>
          </label>
          <label className={labelCls}>Vencimento <span className="text-white/30">(opcional)</span>
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={inputCls} />
          </label>

          {/* Observações */}
          <label className={`${labelCls} col-span-2`}>Observações
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className={inputCls} />
          </label>
        </div>

        {/* ── Vínculo / Rateio ── */}
        <div className="mt-4 rounded-lg border border-white/10 bg-[#12161c] p-3">
          <div className="mb-2 text-xs font-medium text-white/68">Vínculo</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setVinculo("processo")} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${vinculo === "processo" ? "border-[#d2a948]/50 bg-[#d2a948]/12 text-[#d2a948]" : "border-white/15 text-white/70"}`}><Building2 className="h-3.5 w-3.5" /> Processo inteiro</button>
            <button onClick={() => setVinculo("requerentes")} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${vinculo === "requerentes" ? "border-[#d2a948]/50 bg-[#d2a948]/12 text-[#d2a948]" : "border-white/15 text-white/70"}`}><Users className="h-3.5 w-3.5" /> Requerente(s)</button>
          </div>

          {vinculo === "requerentes" && (
            <div className="mt-3">
              {requerentes.length === 0 ? <div className="text-xs text-white/40">Este processo não tem requerentes cadastrados.</div> : (
                <div className="flex flex-wrap gap-2">
                  {requerentes.map((r) => (
                    <button key={r.id} onClick={() => toggleReq(r.id)} title={r.personId == null ? "Sem identidade vinculada — não entra em rateio" : ""} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${selReq.has(r.id) ? "border-violet-500/50 bg-violet-500/10 text-violet-200" : "border-white/15 text-white/70"} ${r.personId == null ? "opacity-60" : ""}`}><User className="h-3 w-3" /> {r.nome}</button>
                  ))}
                </div>
              )}
              {reqSelecionados.length > 1 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs text-white/68">Rateio</div>
                  <div className="flex gap-2">
                    {(["IGUAL", "PERCENTUAL", "VALOR"] as ModoRateio[]).map((m) => (
                      <button key={m} onClick={() => setModoRateio(m)} className={`rounded-lg border px-2.5 py-1 text-xs ${modoRateio === m ? "border-[#d2a948]/50 bg-[#d2a948]/12 text-[#d2a948]" : "border-white/15 text-white/70"}`}>{m === "IGUAL" ? "Igual" : m === "PERCENTUAL" ? "Percentual" : "Valor"}</button>
                    ))}
                  </div>
                  {modoRateio !== "IGUAL" && (
                    <div className="mt-2 space-y-1.5">
                      {reqSelecionados.map((r) => (
                        <div key={r.id} className="flex items-center gap-2">
                          <span className="w-40 truncate text-xs text-white/70">{r.nome}</span>
                          <input value={rateioVal[r.id] ?? ""} onChange={(e) => setRateioVal((s) => ({ ...s, [r.id]: e.target.value }))} inputMode="decimal" placeholder={modoRateio === "PERCENTUAL" ? "%" : moeda} className="w-28 rounded-lg border border-white/10 bg-[#12161c] px-2 py-1 text-xs text-white/95 outline-none" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Prévia ── */}
        <div className="mt-4 rounded-lg border border-white/10 bg-[#12161c] p-3 text-sm">
          <div className="flex justify-between text-white/68"><span>Subtotal</span><span className="text-white/80">{fmt(subtotal, moeda)}</span></div>
          {desc > 0 && <div className="flex justify-between text-white/68"><span>Desconto</span><span className="text-red-300">− {fmt(desc, moeda)}</span></div>}
          {!receita && acr > 0 && <div className="flex justify-between text-white/68"><span>Acréscimos</span><span className="text-white/80">+ {fmt(acr, moeda)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-white/10 pt-1 font-semibold text-white"><span>Total</span><span>{fmt(total, moeda)}</span></div>
          {distribuicao.length > 0 && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="mb-1 text-xs text-white/40">Distribuição por requerente</div>
              {distribuicao.map((d, i) => <div key={i} className="flex justify-between text-xs text-white/70"><span>{d.nome} <span className="text-white/40">({d.pct.toFixed(1)}%)</span></span><span>{fmt(d.valor, moeda)}</span></div>)}
              {Math.abs(somaRateio - total) > 0.01 && <div className="mt-1 text-xs text-[#d2a948]">⚠ Soma do rateio ({fmt(somaRateio, moeda)}) difere do total ({fmt(total, moeda)}).</div>}
            </div>
          )}
        </div>

        {erro && <div className="mt-3 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{erro}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/15 bg-[#1b2027] px-3.5 py-2 text-sm text-white/70 hover:border-white/25">Cancelar</button>
          <button onClick={() => salvar(true)} disabled={!!salvando} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-600/15 px-3.5 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50"><Plus className="h-4 w-4" /> {salvando === "pagamento" ? "Salvando…" : "Salvar e registrar pagamento"}</button>
          <button onClick={() => salvar(false)} disabled={!!salvando} className="rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-medium text-[#1b1508] hover:bg-[#e0b957] disabled:opacity-50">{salvando === "salvar" ? "Salvando…" : receita ? "Salvar receita" : "Salvar custo"}</button>
        </div>
      </div>
    </div>
  )
}
