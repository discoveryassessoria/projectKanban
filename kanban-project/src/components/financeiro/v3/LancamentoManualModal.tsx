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
import { dedupPorPessoa, registrarPendenciaReconciliacao } from "@/lib/financeiro/identidade/dedup-pessoa"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as fmt } from "@/src/lib/financeiro/formato"

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const NATUREZA_LABEL: Record<string, string> = { DOCUMENTO: "Documento", PRODUTO: "Produto", SERVICO: "Serviço", HONORARIO: "Honorário", TAXA: "Taxa", DESPESA: "Despesa", LOGISTICA: "Logística", OUTRO: "Outro" }

type Natureza = "RECEITA" | "CUSTO"
type Vinculo = "processo" | "requerentes"
type ModoRateio = "IGUAL" | "PERCENTUAL" | "VALOR"

interface Item { id: number; name: string; natureza: string; categoria?: string | null; unidade?: string }
interface Requerente { id: number; nome: string; personId: number | null }
interface Fase { phaseKey: string; label: string }
interface Fornecedor { id: number; nome: string }
// F8.1 — retorno de /v3/custos/analise (inteligência do lançamento).
interface AvisoLancamento { codigo: string; severidade: "info" | "atencao" | "alto"; mensagem: string; evidencias?: { obrigacaoId: number; codigo: string | null; descricao: string | null; valor: number; moeda: string; criadoEm: string | null }[] }
interface Analise {
  avisos: AvisoLancamento[]
  sugestoes: {
    fornecedor: { id: number; nome: string; ocorrencias: number } | null
    centroCusto: { id: number; nome: string; ocorrencias: number } | null
    valorTipico: { valor: number; moeda: string; amostras: number; minimo: number; maximo: number } | null
  }
  baseHistorica: number
}

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
      const reqsBrutos: Requerente[] = (j?.processo?.requerentes ?? j?.requerentes ?? []).map((x: any) => ({ id: x.id, nome: [x.nome, x.sobrenome].filter(Boolean).join(" ") || x.nome, personId: x.personId ?? null }))
      // dedup VISUAL por identidade canônica (personId): a mesma Pessoa não aparece 2x na seleção.
      // Sem personId → mantido individual. Duplicidade real vira pendência de reconciliação (sem merge).
      const { itens: reqs, duplicatas } = dedupPorPessoa(reqsBrutos)
      registrarPendenciaReconciliacao(`lancamento-manual:processo:${processoId}`, duplicatas)
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

  // ---- F8.1: inteligência do lançamento (server-side, só leitura) ----
  // Conselho com evidência: avisa duplicidade provável / valor fora da faixa praticada /
  // vencimento vencido / campos que custam caro depois, e sugere fornecedor, centro de custo
  // e valor típicos do MESMO item. NUNCA bloqueia nem preenche sozinho.
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [analisando, setAnalisando] = useState(false)

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

  // F8.1 — reanalisa (com folga de digitação) sempre que muda algo que altera o julgamento.
  // Só para CUSTO: a inteligência é do domínio Contas a Pagar.
  useEffect(() => {
    if (receita) return
    const t = setTimeout(() => {
      setAnalisando(true)
      fetch(`/api/financeiro/v3/custos/analise`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processoId, itemCatalogoId: itemId ? Number(itemId) : null, fornecedorId: fornecedorId ? Number(fornecedorId) : null, centroCustoId: centroCustoId ? Number(centroCustoId) : null, valor: total || null, moeda, vencimento: vencimento || null }),
      }).then((r) => r.json()).then((j) => setAnalise(j?.ok ? j : null)).catch(() => setAnalise(null)).finally(() => setAnalisando(false))
    }, 400)
    return () => clearTimeout(t)
  }, [receita, processoId, itemId, fornecedorId, centroCustoId, total, moeda, vencimento])

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

  const inputCls = "mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
  const labelCls = "block text-xs text-[var(--text-secondary)]"

  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4" style={{ zIndex: LAYER.aboveProcess }} onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{receita ? "Nova Receita" : "Novo Custo"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-4 w-4" /></button>
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
          <label className={`${labelCls} col-span-2`}>Descrição {receita ? "" : ""}<span className="text-[var(--text-muted)]"> (complementar, opcional)</span>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Padrão: nome do item" className={inputCls} />
          </label>

          {/* Quantidade / Valor unitário / Moeda */}
          <label className={labelCls}>Quantidade
            <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="numeric" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Valor unitário{receita && <span className="ml-1 text-[10px] text-[var(--info)]">(Cadastro Mestre)</span>}
              <input value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
              {receita && <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">Definido pelo Cadastro Mestre — alterar exige permissão.</span>}
            </label>
            <label className={labelCls}>Moeda
              {receita ? (
                <div className={`${inputCls} flex items-center justify-between`}><span>{moeda}</span><span className="text-[10px] text-[var(--text-muted)]">Definido pelo Cadastro Mestre</span></div>
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
            <label className={labelCls}>Centro de custo <span className="text-[var(--text-muted)]">(opcional)</span>
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
          <label className={labelCls}>Fase <span className="text-[var(--text-muted)]">(opcional)</span>
            <select value={faseKey} onChange={(e) => setFaseKey(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {fases.map((f) => <option key={f.phaseKey} value={f.phaseKey}>{f.label}</option>)}
            </select>
          </label>
          <label className={labelCls}>Vencimento <span className="text-[var(--text-muted)]">(opcional)</span>
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={inputCls} />
          </label>

          {/* Observações */}
          <label className={`${labelCls} col-span-2`}>Observações
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className={inputCls} />
          </label>
        </div>

        {/* ── Vínculo / Rateio ── */}
        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Vínculo</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setVinculo("processo")} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs ${vinculo === "processo" ? "border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]" : "border-[var(--border-strong)] text-[var(--text-secondary)]"}`}><Building2 className="h-3.5 w-3.5" /> Processo inteiro</button>
            <button onClick={() => setVinculo("requerentes")} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs ${vinculo === "requerentes" ? "border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]" : "border-[var(--border-strong)] text-[var(--text-secondary)]"}`}><Users className="h-3.5 w-3.5" /> Requerente(s)</button>
          </div>

          {vinculo === "requerentes" && (
            <div className="mt-3">
              {requerentes.length === 0 ? <div className="text-xs text-[var(--text-muted)]">Este processo não tem requerentes cadastrados.</div> : (
                <div className="flex flex-wrap gap-2">
                  {requerentes.map((r) => (
                    <button key={r.id} onClick={() => toggleReq(r.id)} title={r.personId == null ? "Sem identidade vinculada — não entra em rateio" : ""} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs ${selReq.has(r.id) ? "border-[color-mix(in_srgb,var(--info)_50%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] text-[var(--info)]" : "border-[var(--border-strong)] text-[var(--text-secondary)]"} ${r.personId == null ? "opacity-60" : ""}`}><User className="h-3 w-3" /> {r.nome}</button>
                  ))}
                </div>
              )}
              {reqSelecionados.length > 1 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs text-[var(--text-secondary)]">Rateio</div>
                  <div className="flex gap-2">
                    {(["IGUAL", "PERCENTUAL", "VALOR"] as ModoRateio[]).map((m) => (
                      <button key={m} onClick={() => setModoRateio(m)} className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs ${modoRateio === m ? "border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]" : "border-[var(--border-strong)] text-[var(--text-secondary)]"}`}>{m === "IGUAL" ? "Igual" : m === "PERCENTUAL" ? "Percentual" : "Valor"}</button>
                    ))}
                  </div>
                  {modoRateio !== "IGUAL" && (
                    <div className="mt-2 space-y-1.5">
                      {reqSelecionados.map((r) => (
                        <div key={r.id} className="flex items-center gap-2">
                          <span className="w-40 truncate text-xs text-[var(--text-secondary)]">{r.nome}</span>
                          <input value={rateioVal[r.id] ?? ""} onChange={(e) => setRateioVal((s) => ({ ...s, [r.id]: e.target.value }))} inputMode="decimal" placeholder={modoRateio === "PERCENTUAL" ? "%" : moeda} className="w-28 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none" />
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
        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm">
          <div className="flex justify-between text-[var(--text-secondary)]"><span>Subtotal</span><span className="text-[var(--text-secondary)]">{fmt(subtotal, moeda)}</span></div>
          {desc > 0 && <div className="flex justify-between text-[var(--text-secondary)]"><span>Desconto</span><span className="text-[var(--danger)]">− {fmt(desc, moeda)}</span></div>}
          {!receita && acr > 0 && <div className="flex justify-between text-[var(--text-secondary)]"><span>Acréscimos</span><span className="text-[var(--text-secondary)]">+ {fmt(acr, moeda)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-[var(--border-default)] pt-1 font-semibold text-[var(--text-primary)]"><span>Total</span><span>{fmt(total, moeda)}</span></div>
          {distribuicao.length > 0 && (
            <div className="mt-2 border-t border-[var(--border-default)] pt-2">
              <div className="mb-1 text-xs text-[var(--text-muted)]">Distribuição por requerente</div>
              {distribuicao.map((d, i) => <div key={i} className="flex justify-between text-xs text-[var(--text-secondary)]"><span>{d.nome} <span className="text-[var(--text-muted)]">({d.pct.toFixed(1)}%)</span></span><span>{fmt(d.valor, moeda)}</span></div>)}
              {Math.abs(somaRateio - total) > 0.01 && <div className="mt-1 text-xs text-[var(--accent-primary)]">⚠ Soma do rateio ({fmt(somaRateio, moeda)}) difere do total ({fmt(total, moeda)}).</div>}
            </div>
          )}
        </div>

        {/* F8.1 — Inteligência do lançamento: conselho com evidência, nunca bloqueio.
            Sugestões só aparecem quando divergem do que já está preenchido. */}
        {!receita && analise && (analise.avisos.length > 0 || analise.sugestoes.fornecedor || analise.sugestoes.centroCusto || analise.sugestoes.valorTipico) && (
          <div className="mt-3 space-y-2">
            {analise.avisos.map((a) => {
              const cor = a.severidade === "alto" ? "var(--danger)" : a.severidade === "atencao" ? "var(--accent-primary)" : "var(--info)"
              return (
                <div key={a.codigo} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs" style={{ borderColor: `color-mix(in srgb, ${cor} 30%, transparent)`, background: `color-mix(in srgb, ${cor} 8%, transparent)` }}>
                  <div className="font-medium" style={{ color: cor }}>{a.mensagem}</div>
                  {!!a.evidencias?.length && (
                    <ul className="mt-1 space-y-0.5 text-[var(--text-muted)]">
                      {a.evidencias.map((ev) => (
                        <li key={ev.obrigacaoId}>• {ev.codigo ?? `#${ev.obrigacaoId}`} — {ev.descricao ?? "sem descrição"} — {fmt(ev.valor, ev.moeda)}{ev.criadoEm ? ` — ${new Date(ev.criadoEm).toLocaleDateString("pt-BR")}` : ""}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            {(() => {
              const sug = analise.sugestoes
              const mostrarForn = sug.fornecedor && String(sug.fornecedor.id) !== fornecedorId
              const mostrarCentro = sug.centroCusto && String(sug.centroCusto.id) !== centroCustoId
              const mostrarValor = sug.valorTipico && sug.valorTipico.moeda === moeda
              if (!mostrarForn && !mostrarCentro && !mostrarValor) return null
              return (
                <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs">
                  <div className="mb-1.5 text-[var(--text-muted)]">Com base em {analise.baseHistorica} lançamento(s) deste mesmo item:</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {mostrarForn && (
                      <button type="button" onClick={() => setFornecedorId(String(sug.fornecedor!.id))} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                        Usar fornecedor <span className="font-medium text-[var(--text-primary)]">{sug.fornecedor!.nome}</span> ({sug.fornecedor!.ocorrencias}×)
                      </button>
                    )}
                    {mostrarCentro && (
                      <button type="button" onClick={() => setCentroCustoId(String(sug.centroCusto!.id))} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                        Usar centro de custo <span className="font-medium text-[var(--text-primary)]">{sug.centroCusto!.nome}</span> ({sug.centroCusto!.ocorrencias}×)
                      </button>
                    )}
                    {mostrarValor && (
                      <button type="button" onClick={() => { setQuantidade("1"); setValorUnitario(String(sug.valorTipico!.valor)) }} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                        Usar valor típico <span className="font-medium text-[var(--text-primary)]">{fmt(sug.valorTipico!.valor, sug.valorTipico!.moeda)}</span> (de {fmt(sug.valorTipico!.minimo, sug.valorTipico!.moeda)} a {fmt(sug.valorTipico!.maximo, sug.valorTipico!.moeda)})
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
        {!receita && analisando && !analise && <div className="mt-3 text-xs text-[var(--text-muted)]">analisando o histórico…</div>}

        {erro && <div className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-overlay)] px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={() => salvar(true)} disabled={!!salvando} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--success)_50%,transparent)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-3.5 py-2 text-sm font-medium text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_25%,transparent)] disabled:opacity-50"><Plus className="h-4 w-4" /> {salvando === "pagamento" ? "Salvando…" : "Salvar e registrar pagamento"}</button>
          <button onClick={() => salvar(false)} disabled={!!salvando} className="rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:opacity-50">{salvando === "salvar" ? "Salvando…" : receita ? "Salvar receita" : "Salvar custo"}</button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
