// src/components/financeiro/v3/PagarCustoView.tsx
// ============================================================================
// F7.5 — PAGAR CUSTO (Contas a Pagar V3): assistente de pagamento RICO, nativo do
// domínio custo. Paridade com o recebimento de Receita (RegistrarPagamentoView),
// mas na língua certa: quem paga é a EMPRESA, quem recebe é o FORNECEDOR, a conta
// é de ORIGEM (saída de caixa) e o cronograma é de PARCELAS PAGÁVEIS.
//
// Não reimplementa motor: orquestra /v3/receita/[ref]/registrar-pagamento
// (registrarPagamentoComposto → registrarOcorrencia), com a MESMA fonte única de
// cálculo do backend (calcularRecebimento) e idempotência obrigatória.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import {
  Plus, Trash2, Upload, Loader2, Info as InfoIcon, AlertTriangle, CheckCircle2,
  Landmark, Building2, CalendarClock, FileText, X,
} from "lucide-react"
import { uploadFiles } from "@/src/lib/storage"
import { calcularRecebimento } from "@/lib/financeiro/dominio/calculo-recebimento"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as fmt } from "@/src/lib/financeiro/formato"
import { useChaveIdempotencia } from "@/src/lib/financeiro/useChaveIdempotencia"
import { CampoData } from "@/src/components/ui/campo-data"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const fmtTamanho = (b?: number | null) => { if (b == null) return ""; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; return `${(b / 1048576).toFixed(1)} MB` }
const hoje = () => new Date().toISOString().slice(0, 10)
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

let _rid = 0
const novaLinha = () => ({ _id: ++_rid, formaPagamentoId: "" as number | "", valor: "" as string, contaKey: "", dataPag: hoje(), referencia: "" })
type Linha = ReturnType<typeof novaLinha>

type ParcelaPagavel = { id: number; numero: number; vencimento: string; valor: number; moeda: string; status: string }

const inputCls = "w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--info)]"
const labelCls = "text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]"
const cardCls = "rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5"

export default function PagarCustoView({ obrigacaoId, fornecedor, onClose, onDone }: {
  obrigacaoId: number
  /** Nome do fornecedor — vem da lista/detalhe do custo (o payload do lançamento não o carrega). */
  fornecedor?: string | null
  onClose: () => void; onDone?: () => void
}) {
  const [custo, setCusto] = useState<any>(null)
  const [parcelas, setParcelas] = useState<ParcelaPagavel[]>([])
  const [formasCad, setFormasCad] = useState<any[]>([])
  const [contasOpts, setContasOpts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [linhas, setLinhas] = useState<Linha[]>([novaLinha()])
  const [ajustes, setAjustes] = useState({ desconto: "", juros: "", multa: "", acrescimo: "" })
  const [comprovantes, setComprovantes] = useState<{ arquivoUrl: string; arquivoNome: string; tamanho: number }[]>([])
  const [subindo, setSubindo] = useState(false)
  const [observacao, setObservacao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erroSubmit, setErroSubmit] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // idempotência estável por sessão da tela: duplo-clique/retry não duplica pagamento.
  const idemKey = useChaveIdempotencia(`custo-${obrigacaoId}`)

  useEffect(() => {
    let vivo = true
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onClose() }
    document.addEventListener("keydown", onEsc)
    ;(async () => {
      try {
        const [rDet, rCron, rCad] = await Promise.all([
          fetch(`/api/financeiro/v3/receita/${obrigacaoId}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
          fetch(`/api/financeiro/v3/obrigacoes/${obrigacaoId}/cronograma`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
          fetch(`/api/financeiro/v3/cadastros-pagamento`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
        ])
        if (!vivo) return
        setCusto(rDet?.receita ?? null)
        setParcelas(Array.isArray(rCron?.parcelas) ? rCron.parcelas : [])
        setFormasCad(rCad?.formasPagamento ?? [])
        const contas = (rCad?.contas ?? []).map((c: any) => ({ key: `c:${c.id}`, id: c.id, tipo: "conta", label: c.nome, sub: [c.banco, [c.agencia, c.conta].filter(Boolean).join("/")].filter(Boolean).join(" · "), banco: c.banco ?? c.nome, agencia: c.agencia ?? null, numero: c.conta ?? null }))
        const cart = (rCad?.carteiras ?? []).map((c: any) => ({ key: `w:${c.id}`, id: c.id, tipo: "carteira", label: c.nome, sub: "Carteira", banco: c.nome, agencia: null, numero: null }))
        setContasOpts([...contas, ...cart])
        if (!rDet?.receita) setErro("Não foi possível carregar o custo.")
      } catch { if (vivo) setErro("Falha ao carregar.") } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false; document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [obrigacaoId, onClose, enviando])

  const moeda = custo?.moeda ?? "BRL"
  const saldoAberto = Number(custo?.saldoBrl ?? custo?.saldo ?? 0)
  const desconto = num(ajustes.desconto)
  const juros = num(ajustes.juros)
  const multa = num(ajustes.multa)
  const acrescimo = num(ajustes.acrescimo)

  // FONTE ÚNICA de cálculo — a MESMA função revalidada no backend. Memorizada
  // para que os valores derivados dela sejam dependências estáveis.
  const calc = useMemo(() => calcularRecebimento({
    saldoSelecionado: saldoAberto,
    linhas: linhas.map((l) => ({ valor: num(l.valor) })),
    desconto, juros, multa, acrescimo, creditoUtilizado: 0,
  }), [saldoAberto, linhas, desconto, juros, multa, acrescimo])
  const totalPago = calc.totalInformado
  const devido = calc.valorLiquidoDevido
  const saldoRestante = calc.saldoRestante
  const excedente = calc.excedente
  const situacao = calc.situacao

  // Quais parcelas pagáveis este pagamento quita (ordem de vencimento) — informativo:
  // o status da ParcelaPagavel é DERIVADO do Ledger, nunca escrito pela tela.
  // Sem useMemo manual: a memoização artesanal aqui bloqueava a otimização do
  // componente inteiro pelo React Compiler. O cálculo é barato e derivado.
  const quitacaoPrevista = (() => {
    // Consome o valor pago pelas parcelas em ordem de vencimento. O saldo
    // restante caminha dentro do próprio reduce em vez de mutar uma variável do
    // escopo — mesma conta, sem estado escapando do cálculo.
    const abertas = parcelas
      .filter((p) => (p.status ?? "").toUpperCase() !== "PAGA" && (p.status ?? "").toUpperCase() !== "CANCELADA")
      .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)))

    const { itens } = abertas.reduce<{ restante: number; itens: (typeof abertas[number] & { aplica: number })[] }>(
      (acc, p) => {
        const aplica = cent(Math.min(acc.restante, Number(p.valor)))
        acc.itens.push({ ...p, aplica })
        return { restante: cent(acc.restante - aplica), itens: acc.itens }
      },
      { restante: totalPago, itens: [] },
    )
    return itens.filter((p) => p.aplica > 0)
  })()

  // Sem useMemo manual: a memoização artesanal aqui bloqueava a otimização do
  // componente inteiro pelo React Compiler. O cálculo é barato e derivado.
  const pendencias = (() => {
    const p: string[] = []
    const comValor = linhas.filter((l) => num(l.valor) > 0)
    if (!comValor.length) p.push("Adicione ao menos uma forma de pagamento com valor.")
    for (const l of linhas) {
      if (num(l.valor) > 0 && !l.formaPagamentoId) p.push("Toda linha com valor precisa de uma forma de pagamento.")
      if (num(l.valor) > 0 && !l.contaKey) p.push("Toda linha com valor precisa de uma conta de origem (de onde sai o dinheiro).")
      if (num(l.valor) < 0) p.push("Valor não pode ser negativo.")
    }
    if (desconto > saldoAberto + 0.01) p.push("O desconto não pode exceder o saldo em aberto.")
    return [...new Set(p)]
  })()
  const valido = pendencias.length === 0

  const setLinha = (id: number, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l._id === id ? { ...l, ...patch } : l)))
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha()])
  const rmLinha = (id: number) => setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l._id !== id) : ls))
  const preencherSaldo = () => setLinhas((ls) => (ls.length === 1 ? [{ ...ls[0], valor: String(saldoAberto).replace(".", ",") }] : ls))

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setSubindo(true)
    try {
      const enviados = await uploadFiles(Array.from(files), { prefix: "financeiro/comprovantes" })
      setComprovantes((c) => [...c, ...enviados.map((e) => ({ arquivoUrl: e.url, arquivoNome: e.name, tamanho: e.size }))])
    } catch { setErroSubmit("Falha no upload de comprovante.") } finally { setSubindo(false) }
  }, [])

  const origemRecurso = (forma: any): string => {
    const s = `${forma?.name ?? ""} ${forma?.type ?? ""} ${forma?.categoria ?? ""}`.toUpperCase()
    if (s.includes("PIX")) return "PIX"
    if (s.includes("CART") || s.includes("CARD")) return "CARTAO"
    if (s.includes("DINHEIRO") || s.includes("ESPÉCIE") || s.includes("ESPECIE")) return "OUTRO"
    return "CONTA"
  }

  const submit = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErroSubmit(null)
    try {
      const formas = linhas.filter((l) => num(l.valor) > 0).map((l) => {
        const forma = formasCad.find((f) => f.id === Number(l.formaPagamentoId))
        const conta = contasOpts.find((c) => c.key === l.contaKey)
        return {
          formaPagamentoId: Number(l.formaPagamentoId) || null, formaLabel: forma?.name ?? null, valor: num(l.valor),
          contaId: conta?.id ?? null, contaTipo: conta?.tipo ?? null, contaLabel: conta?.label ?? null,
          contaBanco: conta?.banco ?? null, contaAgencia: conta?.agencia ?? null, contaNumero: conta?.numero ?? null,
          dataRecebimento: l.dataPag || null, dataCompensacao: null, referencia: l.referencia || null,
          origemRecurso: forma ? origemRecurso(forma) : null,
        }
      })
      const body = {
        obrigacaoId, moeda,
        formas,
        // Num custo quem paga é a EMPRESA (saída de caixa) — nunca um requerente.
        pagador: { tipo: "EMPRESA" as const, pessoaId: null },
        ajustes: { desconto, juros, multa, acrescimo, creditoUtilizado: 0 },
        aplicacao: { politica: "MAIS_ANTIGA" }, // quita da parcela mais antiga para a mais nova
        excedenteTratamento: situacao === "EXCEDENTE" ? "CREDITO" : null,
        parcialTratamento: null,
        saldoSelecionado: saldoAberto,
        totais: { totalInformado: totalPago, saldoRestante, excedente },
        idempotencyKey: idemKey.current,
        comprovantes,
        observacao: observacao || null,
      }
      const r = await fetch(`/api/financeiro/v3/receita/${obrigacaoId}/registrar-pagamento`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      }).then((x) => x.json())
      if (!r?.ok) { setErroSubmit(r?.erro ?? "Falha ao registrar o pagamento."); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 700)
    } catch { setErroSubmit("Erro de rede ao registrar o pagamento."); setEnviando(false) }
  }

  const conteudo = (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--surface-overlay)]" style={{ zIndex: LAYER.aboveProcessCritical }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        {/* Cabeçalho */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span>🧾</span> Financeiro <span>›</span> Custos <span>›</span> <span className="text-[var(--text-secondary)]">Pagar custo</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">Pagar custo</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {custo?.codigo ? `${custo.codigo} · ` : ""}{custo?.descricao ?? "Custo"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Fechar</button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-[var(--text-muted)]"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando custo…</div>
        ) : erro ? (
          <div className="rounded-[var(--radius-md)] border p-4 text-sm text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>{erro}</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {/* Beneficiário + saldo */}
              <div className={cardCls}>
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]"><Building2 className="h-4 w-4" /> Beneficiário</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><div className={labelCls}>Fornecedor</div><div className="mt-1 text-sm text-[var(--text-primary)]">{fornecedor ?? "—"}</div></div>
                  <div><div className={labelCls}>Saldo a pagar</div><div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{fmt(saldoAberto, moeda)}</div></div>
                  <div><div className={labelCls}>Pagador</div><div className="mt-1 text-sm text-[var(--text-primary)]">Empresa (saída de caixa)</div></div>
                </div>
              </div>

              {/* Formas de pagamento */}
              <div className={cardCls}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]"><Landmark className="h-4 w-4" /> Formas de pagamento</h2>
                  <div className="flex items-center gap-2">
                    <button onClick={preencherSaldo} disabled={linhas.length !== 1} title={linhas.length === 1 ? "Preencher com o saldo em aberto" : "Disponível com uma única linha"} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40">Pagar saldo total</button>
                    <button onClick={addLinha} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Plus className="h-3.5 w-3.5" /> Adicionar forma</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {linhas.map((l) => (
                    <div key={l._id} className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3 sm:grid-cols-12">
                      <div className="sm:col-span-3">
                        <div className={labelCls}>Forma</div>
                        <select value={l.formaPagamentoId} onChange={(e) => setLinha(l._id, { formaPagamentoId: e.target.value ? Number(e.target.value) : "" })} className={`${inputCls} mt-1`}>
                          <option value="">Selecione…</option>
                          {formasCad.map((f: any) => <option key={f.id} value={f.id}>{f.name ?? f.nome}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-4">
                        <div className={labelCls}>Conta de origem</div>
                        <select value={l.contaKey} onChange={(e) => setLinha(l._id, { contaKey: e.target.value })} className={`${inputCls} mt-1`}>
                          <option value="">Selecione…</option>
                          {contasOpts.map((c) => <option key={c.key} value={c.key}>{c.label}{c.sub ? ` — ${c.sub}` : ""}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <div className={labelCls}>Valor</div>
                        <input value={l.valor} onChange={(e) => setLinha(l._id, { valor: e.target.value })} inputMode="decimal" placeholder="0,00" className={`${inputCls} mt-1`} />
                      </div>
                      <div className="sm:col-span-2">
                        <div className={labelCls}>Data</div>
                        <CampoData
                          value={l.dataPag}
                          onChange={(v) => setLinha(l._id, { dataPag: (v ?? "") })}
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div className="flex items-end sm:col-span-1">
                        <button onClick={() => rmLinha(l._id)} disabled={linhas.length === 1} title={linhas.length === 1 ? "Ao menos uma forma" : "Remover"} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2 text-[var(--text-muted)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="sm:col-span-12">
                        <div className={labelCls}>Referência (documento / nota / comprovante)</div>
                        <input value={l.referencia} onChange={(e) => setLinha(l._id, { referencia: e.target.value.slice(0, 120) })} placeholder="Ex.: NF 1234 · DOC 998" className={`${inputCls} mt-1`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ajustes */}
              <div className={cardCls}>
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Ajustes</h2>
                <div className="grid gap-3 sm:grid-cols-4">
                  {([["desconto", "Desconto"], ["juros", "Juros"], ["multa", "Multa"], ["acrescimo", "Acréscimo"]] as const).map(([k, lb]) => (
                    <div key={k}>
                      <div className={labelCls}>{lb}</div>
                      <input value={(ajustes as any)[k]} onChange={(e) => setAjustes((a) => ({ ...a, [k]: e.target.value }))} inputMode="decimal" placeholder="0,00" className={`${inputCls} mt-1`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Comprovantes */}
              <div className={cardCls}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]"><FileText className="h-4 w-4" /> Comprovantes</h2>
                  <button onClick={() => fileRef.current?.click()} disabled={subindo} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Anexar</button>
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
                </div>
                {comprovantes.length === 0
                  ? <p className="text-xs text-[var(--text-muted)]">Nenhum comprovante anexado.</p>
                  : (
                    <ul className="space-y-1.5">
                      {comprovantes.map((c, i) => (
                        <li key={i} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                          <span className="truncate">{c.arquivoNome} <span className="text-[var(--text-muted)]">{fmtTamanho(c.tamanho)}</span></span>
                          <button onClick={() => setComprovantes((cs) => cs.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X className="h-3.5 w-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                <div className="mt-3">
                  <div className={labelCls}>Observação</div>
                  <textarea value={observacao} onChange={(e) => setObservacao(e.target.value.slice(0, 300))} rows={2} className={`${inputCls} mt-1 resize-none`} placeholder="Contexto do pagamento (auditoria)" />
                </div>
              </div>
            </div>

            {/* Resumo */}
            <aside className="space-y-4">
              <div className={cardCls}>
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Resumo</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Saldo em aberto</dt><dd className="text-[var(--text-primary)]">{fmt(saldoAberto, moeda)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Devido após ajustes</dt><dd className="text-[var(--text-primary)]">{fmt(devido, moeda)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Total informado</dt><dd className="font-semibold text-[var(--text-primary)]">{fmt(totalPago, moeda)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Saldo restante</dt><dd style={{ color: saldoRestante > 0 ? "var(--accent-primary)" : "var(--success)" }}>{fmt(saldoRestante, moeda)}</dd></div>
                  {excedente > 0 && <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Excedente</dt><dd style={{ color: "var(--info)" }}>{fmt(excedente, moeda)}</dd></div>}
                </dl>
                {situacao === "EXCEDENTE" && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-[var(--radius-sm)] border p-2.5 text-[11px] text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--info) 25%, transparent)", background: "color-mix(in srgb, var(--info) 6%, transparent)" }}>
                    <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--info)" }} /> Pagamento acima do saldo: o excedente vira crédito financeiro vinculado a este custo.
                  </p>
                )}
              </div>

              {quitacaoPrevista.length > 0 && (
                <div className={cardCls}>
                  <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]"><CalendarClock className="h-4 w-4" /> Parcelas quitadas</h2>
                  <ul className="space-y-1.5 text-xs">
                    {quitacaoPrevista.map((p) => (
                      <li key={p.id} className="flex items-center justify-between text-[var(--text-secondary)]">
                        <span>#{p.numero} · vence {dataBR(p.vencimento)}</span>
                        <span className="text-[var(--text-primary)]">{fmt(p.aplica, p.moeda ?? moeda)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">Previsão pela ordem de vencimento — o status real da parcela é derivado do Ledger após o registro.</p>
                </div>
              )}

              {pendencias.length > 0 && (
                <div className="rounded-[var(--radius-md)] border p-3 text-xs" style={{ borderColor: "color-mix(in srgb, var(--accent-primary) 30%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 6%, transparent)" }}>
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-[var(--text-secondary)]"><AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} /> Falta preencher</div>
                  <ul className="list-inside list-disc space-y-0.5 text-[var(--text-muted)]">{pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
              {erroSubmit && <div className="rounded-[var(--radius-md)] border p-3 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>{erroSubmit}</div>}

              <button onClick={submit} disabled={!valido || enviando || ok} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--success)" }}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : null}
                {ok ? "Pagamento registrado" : "Registrar pagamento"}
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  )

  return typeof document !== "undefined" ? createPortal(conteudo, document.body) : null
}
