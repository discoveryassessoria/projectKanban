// src/components/financeiro/v3/lancamento/LancamentoFinanceiroModal.tsx
// ============================================================================
// LANÇAMENTO FINANCEIRO — experiência ÚNICA e definitiva de criação de Custo e
// de Receita dentro do processo. Substitui integralmente o formulário legado.
//
// Princípios:
//  • o operador procura pelo NOME do que comprou/vendeu — não escolhe "Tipo" nem
//    entende a estrutura interna do sistema. A natureza vem do Cadastro Mestre;
//  • todo campo preenchido sozinho DIZ de onde veio (Tabela de Valores,
//    fornecedor padrão, configuração financeira);
//  • cálculo e parcelamento em tempo real, com a soma das parcelas sendo uma
//    partição exata do total;
//  • erro nunca é genérico: aponta o campo e a correção. O botão principal fica
//    travado enquanto houver erro impeditivo;
//  • fonte única: Catálogo Mestre, Configuração Financeira, Tabela de Valores,
//    Fornecedores, Formas e Condições de Pagamento.
//
// O núcleo de cálculo/validação é puro e vive em lib/financeiro/lancamento/calculo.ts.
// ============================================================================
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Building2, Plus, User, Users, X } from "lucide-react"
import { emitirMutacaoFinanceira } from "@/src/lib/financeiro-bus"
import { dedupPorPessoa, registrarPendenciaReconciliacao } from "@/lib/financeiro/identidade/dedup-pessoa"
import { LAYER } from "@/src/lib/ui/layers"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as fmt } from "@/src/lib/financeiro/formato"
import {
  calcularTotal, gerarParcelas, problemasDoCampo, temErro, validarLancamento,
  type Parcela, type Problema,
} from "@/lib/financeiro/lancamento/calculo"
import { SeletorItemCatalogo, type ItemCatalogoOpcao } from "./SeletorItemCatalogo"
import { Campo, Origem, Secao, Selecao, ValorFixo, inputCls, type Opcao } from "./campos"

type Natureza = "RECEITA" | "CUSTO"
type Vinculo = "processo" | "requerentes"
type ModoRateio = "IGUAL" | "PERCENTUAL" | "VALOR"

interface Requerente { id: number; nome: string; personId: number | null }
interface Fase { phaseKey: string; label: string }
interface Nomeado { id: number; nome: string }

interface AvisoLancamento {
  codigo: string
  severidade: "info" | "atencao" | "alto"
  mensagem: string
  evidencias?: { obrigacaoId: number; codigo: string | null; descricao: string | null; valor: number; moeda: string; criadoEm: string | null }[]
}
interface Analise {
  avisos: AvisoLancamento[]
  sugestoes: {
    fornecedor: { id: number; nome: string; ocorrencias: number } | null
    valorTipico: { valor: number; moeda: string; amostras: number; minimo: number; maximo: number } | null
  }
  baseHistorica: number
}

interface Defaults {
  descricao?: string | null
  valorUnitario?: number | null
  moeda?: string | null
  unidade?: string | null
  fornecedorPadraoId?: number | null
  fornecedorPadraoNome?: string | null
  condicaoPagamentoId?: number | null
  formaCobranca?: string | null
  naturezaFin?: string | null
  repasse?: boolean
  reembolsavel?: boolean
  cobravelDoCliente?: boolean
  precoRazao?: string | null
}

const opcoesDe = (lista: Nomeado[]): Opcao[] => lista.map((x) => ({ valor: String(x.id), rotulo: x.nome }))

export function LancamentoFinanceiroModal({
  natureza, processoId, onClose, onCriado,
}: {
  natureza: Natureza
  processoId: number
  onClose: () => void
  onCriado: (r?: { obrigacaoRef: number | null }) => void
}) {
  const custo = natureza === "CUSTO"

  // ── cadastros ──
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [fases, setFases] = useState<Fase[]>([])
  const [fornecedores, setFornecedores] = useState<Nomeado[]>([])
  const [formasPagamento, setFormasPagamento] = useState<Nomeado[]>([])
  const [condicoes, setCondicoes] = useState<{ id: number; nome: string; parcelas: number }[]>([])

  // ── item + configuração ──
  const [item, setItem] = useState<ItemCatalogoOpcao | null>(null)
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [pendenciasConfig, setPendenciasConfig] = useState<string[]>([])
  const [valorTabela, setValorTabela] = useState<number | null>(null)

  // ── campos ──
  const [descricao, setDescricao] = useState("")
  const [quantidade, setQuantidade] = useState("1")
  const [valorUnitario, setValorUnitario] = useState("")
  const [moeda, setMoeda] = useState("BRL")
  const [desconto, setDesconto] = useState("")
  const [acrescimo, setAcrescimo] = useState("")
  const [fornecedorId, setFornecedorId] = useState("")
  const [condicaoId, setCondicaoId] = useState("")
  const [formaPagamento, setFormaPagamento] = useState("")
  const [nParcelas, setNParcelas] = useState("1")
  const [primeiroVencimento, setPrimeiroVencimento] = useState("")
  const [intervaloDias, setIntervaloDias] = useState("")
  const [faseKey, setFaseKey] = useState("")
  const [observacoes, setObservacoes] = useState("")

  // ── vínculo / rateio ──
  const [vinculo, setVinculo] = useState<Vinculo>("processo")
  const [selReq, setSelReq] = useState<Set<number>>(new Set())
  const [modoRateio, setModoRateio] = useState<ModoRateio>("IGUAL")
  const [rateioVal, setRateioVal] = useState<Record<number, string>>({})

  // Inteligência do lançamento (custo) — declarada aqui porque a troca de item a limpa.
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [salvando, setSalvando] = useState<null | "salvar" | "pagamento">(null)
  const [erroServidor, setErroServidor] = useState<string | null>(null)
  const [sujo, setSujo] = useState(false)
  const dialogo = useRef<HTMLDivElement>(null)

  // ── carregamentos base ──
  useEffect(() => {
    fetch(`/api/processos/${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => {
      const brutos: Requerente[] = (j?.processo?.requerentes ?? j?.requerentes ?? []).map((x: any) => ({
        id: x.id, nome: [x.nome, x.sobrenome].filter(Boolean).join(" ") || x.nome, personId: x.personId ?? null,
      }))
      const { itens, duplicatas } = dedupPorPessoa(brutos)
      registrarPendenciaReconciliacao(`lancamento:processo:${processoId}`, duplicatas)
      setRequerentes(itens)
    }).catch(() => setRequerentes([]))
    fetch(`/api/processos/${processoId}/phases`, { headers: authHeaders() }).then((r) => r.json())
      .then((j) => setFases((j?.phases ?? []).map((p: any) => ({ phaseKey: p.phaseKey, label: p.label })))).catch(() => setFases([]))
    fetch(`/api/financeiro/v3/cadastros-pagamento`, { headers: authHeaders() }).then((r) => r.json()).then((j) => {
      setFormasPagamento((j?.formasPagamento ?? []).map((f: any) => ({ id: f.id, nome: f.name })))
      setCondicoes((j?.condicoes ?? []).map((c: any) => ({ id: c.id, nome: c.name, parcelas: Number(c.parcelas) || 1 })))
    }).catch(() => {})
    if (custo) {
      fetch(`/api/fornecedores?ativo=true`, { headers: authHeaders() }).then((r) => r.json())
        .then((j) => setFornecedores((Array.isArray(j) ? j : j?.fornecedores ?? []).map((f: any) => ({ id: f.id, nome: f.nome })))).catch(() => setFornecedores([]))
    }
  }, [processoId, custo])

  /** Troca de item: limpa o que veio do item anterior AQUI (no evento), não num
   *  efeito — assim nenhum setState roda no corpo de effect e não há render em cascata. */
  const escolherItem = (i: ItemCatalogoOpcao | null) => {
    marcarSujo()
    setItem(i)
    setDefaults(null); setPendenciasConfig([]); setValorTabela(null); setAnalise(null)
  }

  // ── auto-preenchimento ao escolher o item ──
  useEffect(() => {
    if (!item) return
    const q = Number(quantidade) || 1
    fetch(`/api/financeiro/v3/item-config?itemCatalogoId=${item.id}&natureza=${natureza}&processoId=${processoId}&quantidade=${q}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        const d: Defaults = j?.defaults ?? {}
        setDefaults(d)
        setPendenciasConfig(Array.isArray(j?.pendencias) ? j.pendencias : [])
        setValorTabela(d.valorUnitario ?? null)
        if (d.valorUnitario != null) setValorUnitario(String(d.valorUnitario))
        if (d.moeda) setMoeda(d.moeda)
        if (custo && d.fornecedorPadraoId) setFornecedorId(String(d.fornecedorPadraoId))
        if (d.condicaoPagamentoId) setCondicaoId(String(d.condicaoPagamentoId))
        if (!descricao) setDescricao(d.descricao ?? item.name)
      })
      .catch(() => { setDefaults({}); setPendenciasConfig(["Não foi possível ler a configuração financeira do item."]) })
  // quantidade entra no preço (faixas) — reconsulta ao mudar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, quantidade])

  // ── inteligência do lançamento (custo): conselho com evidência, nunca bloqueio ──
  useEffect(() => {
    if (!custo || !item) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ processoId: String(processoId), itemCatalogoId: String(item.id) })
      if (Number(valorUnitario) > 0) qs.set("valor", String(total))
      if (moeda) qs.set("moeda", moeda)
      if (primeiroVencimento) qs.set("vencimento", primeiroVencimento)
      fetch(`/api/financeiro/v3/custos/analise?${qs}`, { headers: authHeaders(), signal: ctrl.signal })
        .then((r) => r.json()).then((j) => setAnalise(j?.ok === false ? null : j)).catch(() => {})
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custo, item?.id, valorUnitario, quantidade, desconto, acrescimo, moeda, primeiroVencimento])

  // ── cálculo em tempo real ──
  const { subtotal, desconto: desc, acrescimo: acr, total } = useMemo(
    () => calcularTotal({ quantidade: Number(quantidade), valorUnitario: Number(valorUnitario), desconto: Number(desconto), acrescimo: Number(acrescimo) }),
    [quantidade, valorUnitario, desconto, acrescimo],
  )

  const n = Math.max(1, Math.floor(Number(nParcelas) || 1))
  const parcelas: Parcela[] = useMemo(
    () => (custo && n > 1 && primeiroVencimento ? gerarParcelas({ total, nParcelas: n, primeiroVencimento, intervaloDias: Number(intervaloDias) || undefined }) : []),
    [custo, n, primeiroVencimento, intervaloDias, total],
  )

  const duplicidade = !!analise?.avisos.some((a) => /duplic/i.test(a.codigo) || /duplic/i.test(a.mensagem))

  const problemas: Problema[] = useMemo(() => validarLancamento({
    natureza, itemId: item?.id ?? null, itemAtivo: true,
    quantidade: Number(quantidade), valorUnitario: Number(valorUnitario), moeda,
    desconto: Number(desconto) || 0, acrescimo: Number(acrescimo) || 0,
    nParcelas: n, primeiroVencimento,
    fornecedorId: fornecedorId ? Number(fornecedorId) : null,
    fornecedorObrigatorio: false,
    temConfig: item ? item.temConfig : undefined,
    pendenciasDaConfig: pendenciasConfig,
    valorDaTabela: valorTabela,
    parcelas,
    duplicidadeProvavel: duplicidade,
  }), [natureza, item, quantidade, valorUnitario, moeda, desconto, acrescimo, n, primeiroVencimento, fornecedorId, pendenciasConfig, valorTabela, parcelas, duplicidade])

  const bloqueado = temErro(problemas)
  const doCampo = (c: string) => problemasDoCampo(problemas, c)

  // ── rateio ──
  const reqSelecionados = useMemo(() => requerentes.filter((r) => selReq.has(r.id)), [requerentes, selReq])
  const distribuicao = useMemo(() => {
    if (vinculo !== "requerentes" || reqSelecionados.length === 0) return []
    if (modoRateio === "IGUAL") {
      const cota = total / reqSelecionados.length
      return reqSelecionados.map((r) => ({ nome: r.nome, valor: cota, pct: 100 / reqSelecionados.length }))
    }
    return reqSelecionados.map((r) => {
      const v = Number(rateioVal[r.id]) || 0
      const valor = modoRateio === "PERCENTUAL" ? (total * v) / 100 : v
      return { nome: r.nome, valor, pct: total > 0 ? (valor / total) * 100 : 0 }
    })
  }, [vinculo, reqSelecionados, modoRateio, rateioVal, total])
  const somaRateio = distribuicao.reduce((s, d) => s + d.valor, 0)

  const toggleReq = (id: number) => { marcarSujo(); setSelReq((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const marcarSujo = () => setSujo(true)

  // ── fechamento seguro ──
  const fechar = () => {
    if (sujo && !window.confirm("Há alterações não salvas neste lançamento. Descartar?")) return
    onClose()
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); fechar() } }
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sujo])

  // ── salvar ──
  async function salvar(comPagamento: boolean) {
    if (bloqueado || salvando) return
    setSalvando(comPagamento ? "pagamento" : "salvar")
    setErroServidor(null)
    try {
      const faseLabel = fases.find((f) => f.phaseKey === faseKey)?.label ?? null
      const rateio = vinculo === "requerentes" && reqSelecionados.length > 0
        ? {
            modo: modoRateio,
            participantes: reqSelecionados.map((r) => ({
              requerenteId: r.id, personId: r.personId,
              valor: modoRateio === "VALOR" ? Number(rateioVal[r.id]) || 0 : undefined,
              percentual: modoRateio === "PERCENTUAL" ? Number(rateioVal[r.id]) || 0 : undefined,
            })),
          }
        : null

      const comum = {
        processoId, itemCatalogoId: item!.id,
        descricao: [descricao.trim(), observacoes.trim()].filter(Boolean).join(" — ") || undefined,
        quantidade: Number(quantidade) || 1,
        valorUnitario: Number(valorUnitario),
        moeda,
        desconto: desc || undefined,
        vencimento: primeiroVencimento || undefined,
        formaCobranca: formaPagamento || undefined,
        faseLabel: faseLabel || undefined,
        rateio,
        registrarPagamento: comPagamento || undefined,
      }
      const body = custo
        ? { ...comum, acrescimo: acr || undefined, fornecedorId: fornecedorId ? Number(fornecedorId) : undefined, parcelas: parcelas.length > 1 ? parcelas : undefined }
        : comum

      const res = await fetch(`/api/financeiro/v3/${custo ? "custos" : "receitas"}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setErroServidor(j?.erro || j?.motivo || `Não foi possível salvar (HTTP ${res.status}).`); return }
      if (j.cronogramaErro) { setErroServidor(`Lançamento criado, mas o cronograma não foi definido: ${j.cronogramaErro}`); return }
      emitirMutacaoFinanceira({ processoId, obrigacaoId: j.obrigacaoRef ?? null })
      setSujo(false)
      onCriado(comPagamento ? { obrigacaoRef: j.obrigacaoRef ?? null } : undefined)
    } catch {
      setErroServidor("Não foi possível falar com o servidor. Verifique a conexão e tente de novo.")
    } finally { setSalvando(null) }
  }

  const alterar = <T,>(set: (v: T) => void) => (v: T) => { marcarSujo(); set(v) }

  const conteudo = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4" style={{ zIndex: LAYER.aboveProcess }} onClick={fechar}>
      <div
        ref={dialogo} role="dialog" aria-modal="true" aria-labelledby="lanc-titulo"
        className="my-6 w-full max-w-3xl rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div>
            <h3 id="lanc-titulo" className="text-base font-semibold text-[var(--text-primary)]">{custo ? "Novo custo" : "Nova receita"}</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Busque o item pelo nome — natureza, valor e classificação vêm do cadastro.
            </p>
          </div>
          <button type="button" onClick={fechar} aria-label="Fechar" className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* ── SEÇÃO 1 — Item ── */}
          <Secao titulo="Item do custo" descricao={custo ? undefined : "Item comercializável do catálogo."}>
            <div className="space-y-3">
              <Campo label="Item do catálogo" problemas={doCampo("item")}>
                {({ id, descrevePor, invalido }) => (
                  <div id={id}>
                    <SeletorItemCatalogo
                      natureza={natureza} valor={item} autoFocus invalido={invalido} descrevePor={descrevePor}
                      onSelecionar={escolherItem}
                    />
                  </div>
                )}
              </Campo>

              <Campo label="Descrição complementar" opcional dica="Padrão: o nome do item.">
                {({ id, descrevePor }) => (
                  <input id={id} aria-describedby={descrevePor} value={descricao} onChange={(e) => alterar(setDescricao)(e.target.value)}
                    placeholder={item?.name ?? "—"} className={inputCls} style={{ borderColor: "var(--border-default)" }} />
                )}
              </Campo>

              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label={`Quantidade${defaults?.unidade ? ` (${String(defaults.unidade).toLowerCase()})` : ""}`} problemas={doCampo("quantidade")}>
                  {({ id, descrevePor, invalido }) => (
                    <input id={id} aria-describedby={descrevePor} value={quantidade} onChange={(e) => alterar(setQuantidade)(e.target.value)}
                      inputMode="decimal" className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                  )}
                </Campo>

                <Campo
                  label="Valor unitário" problemas={doCampo("valorUnitario")}
                  dica={valorTabela != null ? <Origem>{defaults?.precoRazao || "Definido pela Tabela de Valores"}</Origem> : undefined}
                >
                  {({ id, descrevePor, invalido }) => (
                    <input id={id} aria-describedby={descrevePor} value={valorUnitario} onChange={(e) => alterar(setValorUnitario)(e.target.value)}
                      inputMode="decimal" placeholder="0,00" className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                  )}
                </Campo>

                <Campo label="Moeda" problemas={doCampo("moeda")}
                  dica={defaults?.moeda ? <Origem>Configuração financeira do item</Origem> : undefined}>
                  {({ id, descrevePor, invalido }) => (
                    <Selecao id={id} descrevePor={descrevePor} invalido={invalido} valor={moeda} onChange={alterar(setMoeda)}
                      opcoes={["BRL", "EUR", "USD"].map((m) => ({ valor: m, rotulo: m }))} />
                  )}
                </Campo>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Desconto" opcional problemas={doCampo("desconto")}>
                  {({ id, descrevePor, invalido }) => (
                    <input id={id} aria-describedby={descrevePor} value={desconto} onChange={(e) => alterar(setDesconto)(e.target.value)}
                      inputMode="decimal" placeholder="0,00" className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                  )}
                </Campo>
                {custo && (
                  <Campo label="Acréscimos" opcional problemas={doCampo("acrescimo")}>
                    {({ id, descrevePor, invalido }) => (
                      <input id={id} aria-describedby={descrevePor} value={acrescimo} onChange={(e) => alterar(setAcrescimo)(e.target.value)}
                        inputMode="decimal" placeholder="0,00" className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                    )}
                  </Campo>
                )}
              </div>

              <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2">
                <span className="text-xs text-[var(--text-secondary)]">Total</span>
                <span className="text-base font-semibold text-[var(--text-primary)]" data-testid="total">{fmt(total, moeda)}</span>
              </div>
            </div>
          </Secao>

          {/* ── SEÇÃO 2 — Pagamento ── */}
          <Secao titulo={custo ? "Pagamento" : "Cobrança"}>
            <div className="grid gap-3 sm:grid-cols-2">
              {custo && (
                <Campo label="Fornecedor" problemas={doCampo("fornecedor")}
                  dica={defaults?.fornecedorPadraoNome ? <Origem>Fornecedor padrão do cadastro</Origem> : undefined}>
                  {({ id, descrevePor, invalido }) => (
                    <Selecao id={id} descrevePor={descrevePor} invalido={invalido} valor={fornecedorId} onChange={alterar(setFornecedorId)} opcoes={opcoesDe(fornecedores)} />
                  )}
                </Campo>
              )}

              <Campo label="Condição de pagamento" opcional
                dica={defaults?.condicaoPagamentoId ? <Origem>Configuração financeira do item</Origem> : undefined}>
                {({ id, descrevePor }) => (
                  <Selecao id={id} descrevePor={descrevePor} valor={condicaoId}
                    onChange={(v) => { marcarSujo(); setCondicaoId(v); const c = condicoes.find((x) => String(x.id) === v); if (c?.parcelas) setNParcelas(String(c.parcelas)) }}
                    opcoes={condicoes.map((c) => ({ valor: String(c.id), rotulo: c.nome, detalhe: c.parcelas > 1 ? `${c.parcelas}×` : undefined }))} />
                )}
              </Campo>

              <Campo label={`Forma de ${custo ? "pagamento" : "cobrança"}`} opcional>
                {({ id, descrevePor }) => (
                  <Selecao id={id} descrevePor={descrevePor} valor={formaPagamento} onChange={alterar(setFormaPagamento)}
                    opcoes={formasPagamento.map((f) => ({ valor: f.nome, rotulo: f.nome }))} />
                )}
              </Campo>

              {custo && (
                <Campo label="Parcelas" problemas={doCampo("nParcelas")}>
                  {({ id, descrevePor, invalido }) => (
                    <input id={id} aria-describedby={descrevePor} value={nParcelas} onChange={(e) => alterar(setNParcelas)(e.target.value)}
                      inputMode="numeric" className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                  )}
                </Campo>
              )}

              <Campo label={custo && n > 1 ? "Vencimento da 1ª parcela" : "Vencimento"} opcional={n <= 1} problemas={doCampo("primeiroVencimento")}>
                {({ id, descrevePor, invalido }) => (
                  <input id={id} aria-describedby={descrevePor} type="date" value={primeiroVencimento} onChange={(e) => alterar(setPrimeiroVencimento)(e.target.value)}
                    className={inputCls} style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }} />
                )}
              </Campo>

              {custo && n > 1 && (
                <Campo label="Intervalo entre parcelas" opcional dica="Vazio = mensal (mesmo dia do mês).">
                  {({ id, descrevePor }) => (
                    <input id={id} aria-describedby={descrevePor} value={intervaloDias} onChange={(e) => alterar(setIntervaloDias)(e.target.value)}
                      inputMode="numeric" placeholder="dias" className={inputCls} style={{ borderColor: "var(--border-default)" }} />
                  )}
                </Campo>
              )}

            </div>

            {/* Preview das parcelas — em tempo real, somando exatamente o total. */}
            {parcelas.length > 1 && (
              <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3" data-testid="preview-parcelas">
                <div className="mb-2 text-xs text-[var(--text-secondary)]">{parcelas.length} parcelas — soma {fmt(parcelas.reduce((s, p) => s + p.valor, 0), moeda)}</div>
                <ul className="space-y-1">
                  {parcelas.map((p) => (
                    <li key={p.numero} className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>{p.numero}/{parcelas.length} — {new Date(`${p.vencimento}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                      <span className="text-[var(--text-primary)]">{fmt(p.valor, moeda)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Secao>

          {/* ── SEÇÃO 3 — Classificação e contexto ── */}
          <Secao titulo="Classificação e contexto">
            {/* "Classificação financeira" e "Conta contábil" saíram daqui: a
                classificação intermediária (categorias / plano de contas / centros
                de custo) foi ELIMINADA, e a conta contábil passou a ser decidida
                pelo Ledger a partir do plano fixo, no momento em que ele registra
                a partida. Nenhum cadastro guarda esses dois valores — a API nunca
                os enviou, e os campos só sabiam exibir "—". Campo que jamais pode
                ter valor é a versão silenciosa do botão morto. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Natureza financeira">
                {() => <ValorFixo>{defaults?.naturezaFin ? String(defaults.naturezaFin).replaceAll("_", " ").toLowerCase() : "—"}</ValorFixo>}
              </Campo>
              <Campo label="Fase do processo" opcional>
                {({ id, descrevePor }) => (
                  <Selecao id={id} descrevePor={descrevePor} valor={faseKey} onChange={alterar(setFaseKey)}
                    opcoes={fases.map((f) => ({ valor: f.phaseKey, rotulo: f.label }))} />
                )}
              </Campo>
              <Campo label="Observações internas" opcional className="sm:col-span-2">
                {({ id, descrevePor }) => (
                  <textarea id={id} aria-describedby={descrevePor} value={observacoes} onChange={(e) => alterar(setObservacoes)(e.target.value)}
                    rows={2} className={inputCls} style={{ borderColor: "var(--border-default)" }} />
                )}
              </Campo>
            </div>

            {(defaults?.repasse || defaults?.reembolsavel || defaults?.cobravelDoCliente) && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {defaults?.repasse && <Marca>Repasse ao cliente</Marca>}
                {defaults?.reembolsavel && <Marca>Reembolsável</Marca>}
                {defaults?.cobravelDoCliente && <Marca>Cobrável do cliente</Marca>}
              </div>
            )}

            {/* Vínculo / rateio por requerente */}
            <div className="mt-4 border-t border-[var(--border-default)] pt-3">
              <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Vínculo</div>
              <div className="flex flex-wrap gap-2">
                <Chip ativo={vinculo === "processo"} onClick={() => { marcarSujo(); setVinculo("processo") }} icone={<Building2 className="h-3.5 w-3.5" />}>Processo inteiro</Chip>
                <Chip ativo={vinculo === "requerentes"} onClick={() => { marcarSujo(); setVinculo("requerentes") }} icone={<Users className="h-3.5 w-3.5" />}>Requerente(s)</Chip>
              </div>
              {vinculo === "requerentes" && (
                <div className="mt-3">
                  {requerentes.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">Este processo não tem requerentes cadastrados.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {requerentes.map((r) => (
                        <Chip key={r.id} ativo={selReq.has(r.id)} onClick={() => toggleReq(r.id)} icone={<User className="h-3 w-3" />}
                          titulo={r.personId == null ? "Sem identidade vinculada — não entra em rateio" : undefined}>{r.nome}</Chip>
                      ))}
                    </div>
                  )}
                  {reqSelecionados.length > 1 && (
                    <div className="mt-3">
                      <div className="mb-1 text-xs text-[var(--text-secondary)]">Rateio</div>
                      <div className="flex gap-2">
                        {(["IGUAL", "PERCENTUAL", "VALOR"] as ModoRateio[]).map((m) => (
                          <Chip key={m} ativo={modoRateio === m} onClick={() => { marcarSujo(); setModoRateio(m) }}>
                            {m === "IGUAL" ? "Igual" : m === "PERCENTUAL" ? "Percentual" : "Valor"}
                          </Chip>
                        ))}
                      </div>
                      {modoRateio !== "IGUAL" && (
                        <div className="mt-2 space-y-1.5">
                          {reqSelecionados.map((r) => (
                            <div key={r.id} className="flex items-center gap-2">
                              <span className="w-40 truncate text-xs text-[var(--text-secondary)]">{r.nome}</span>
                              <input value={rateioVal[r.id] ?? ""} onChange={(e) => { marcarSujo(); setRateioVal((s) => ({ ...s, [r.id]: e.target.value })) }}
                                inputMode="decimal" aria-label={`Rateio de ${r.nome}`} placeholder={modoRateio === "PERCENTUAL" ? "%" : moeda}
                                className="w-28 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Secao>

          {/* ── SEÇÃO 4 — Resumo ── */}
          <Secao titulo="Resumo" descricao="Confira antes de criar a obrigação.">
            <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              <Linha rotulo="Item">{item?.name ?? "—"}</Linha>
              {custo && <Linha rotulo="Fornecedor">{fornecedores.find((f) => String(f.id) === fornecedorId)?.nome ?? "—"}</Linha>}
              <Linha rotulo="Subtotal">{fmt(subtotal, moeda)}</Linha>
              {desc > 0 && <Linha rotulo="Desconto">− {fmt(desc, moeda)}</Linha>}
              {custo && acr > 0 && <Linha rotulo="Acréscimos">+ {fmt(acr, moeda)}</Linha>}
              <Linha rotulo="Total">{fmt(total, moeda)}</Linha>
              {custo && <Linha rotulo="Parcelas">{parcelas.length > 1 ? `${parcelas.length}× — 1º em ${new Date(`${parcelas[0].vencimento}T12:00:00`).toLocaleDateString("pt-BR")}` : "à vista"}</Linha>}
            </dl>

            {distribuicao.length > 0 && (
              <div className="mt-3 border-t border-[var(--border-default)] pt-2">
                <div className="mb-1 text-xs text-[var(--text-muted)]">Distribuição por requerente</div>
                {distribuicao.map((d, i) => (
                  <div key={i} className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>{d.nome} <span className="text-[var(--text-muted)]">({d.pct.toFixed(1)}%)</span></span><span>{fmt(d.valor, moeda)}</span>
                  </div>
                ))}
                {Math.abs(somaRateio - total) > 0.01 && (
                  <p className="mt-1 text-xs text-[var(--accent-primary)]">A soma do rateio ({fmt(somaRateio, moeda)}) difere do total ({fmt(total, moeda)}).</p>
                )}
              </div>
            )}

            {/* Alertas e pendências */}
            {(problemas.some((p) => p.severidade === "aviso") || (analise?.avisos.length ?? 0) > 0) && (
              <div className="mt-3 space-y-1.5" data-testid="alertas">
                {problemas.filter((p) => p.severidade === "aviso").map((p, i) => (
                  <p key={`v${i}`} className="flex items-start gap-1.5 text-[11px] text-[var(--accent-primary)]">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{p.mensagem}
                  </p>
                ))}
                {analise?.avisos.map((a) => (
                  <p key={a.codigo} className="flex items-start gap-1.5 text-[11px]" style={{ color: a.severidade === "alto" ? "var(--danger)" : "var(--accent-primary)" }}>
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{a.mensagem}
                  </p>
                ))}
              </div>
            )}

            {/* Sugestões com evidência histórica — conselho, nunca preenchimento silencioso. */}
            {custo && analise && (analise.sugestoes.fornecedor || analise.sugestoes.valorTipico) && (
              <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-xs">
                <div className="mb-1.5 text-[var(--text-muted)]">Com base em {analise.baseHistorica} lançamento(s) deste mesmo item:</div>
                <div className="flex flex-wrap items-center gap-2">
                  {analise.sugestoes.fornecedor && String(analise.sugestoes.fornecedor.id) !== fornecedorId && (
                    <Sugestao onClick={() => alterar(setFornecedorId)(String(analise.sugestoes.fornecedor!.id))}>
                      Usar fornecedor <b className="text-[var(--text-primary)]">{analise.sugestoes.fornecedor.nome}</b> ({analise.sugestoes.fornecedor.ocorrencias}×)
                    </Sugestao>
                  )}
                  {analise.sugestoes.valorTipico && analise.sugestoes.valorTipico.moeda === moeda && (
                    <Sugestao onClick={() => { marcarSujo(); setQuantidade("1"); setValorUnitario(String(analise.sugestoes.valorTipico!.valor)) }}>
                      Usar valor típico <b className="text-[var(--text-primary)]">{fmt(analise.sugestoes.valorTipico.valor, analise.sugestoes.valorTipico.moeda)}</b>
                    </Sugestao>
                  )}
                </div>
              </div>
            )}
          </Secao>

          {erroServidor && (
            <div role="alert" className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs text-[var(--danger)]"
              style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
              {erroServidor}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-default)] px-5 py-4">
          <button type="button" onClick={fechar}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-overlay)] px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
            Cancelar
          </button>
          <button type="button" onClick={() => salvar(true)} disabled={bloqueado || !!salvando}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--success)_50%,transparent)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-3.5 py-2 text-sm font-medium text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_25%,transparent)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
            <Plus className="h-4 w-4" />{salvando === "pagamento" ? "Salvando…" : `Salvar e registrar ${custo ? "pagamento" : "recebimento"}`}
          </button>
          <button type="button" onClick={() => salvar(false)} disabled={bloqueado || !!salvando}
            className="rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
            {salvando === "salvar" ? "Salvando…" : custo ? "Criar custo" : "Criar receita"}
          </button>
        </footer>
      </div>
    </div>
  )

  return typeof document !== "undefined" ? createPortal(conteudo, document.body) : null
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--border-default)] py-1 last:border-0">
      <dt className="text-[var(--text-muted)]">{rotulo}</dt>
      <dd className="truncate text-right text-[var(--text-primary)]">{children}</dd>
    </div>
  )
}

function Chip({ ativo, onClick, children, icone, titulo }: { ativo: boolean; onClick: () => void; children: React.ReactNode; icone?: React.ReactNode; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-pressed={ativo}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={ativo
        ? { borderColor: "color-mix(in srgb, var(--accent-primary) 50%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", color: "var(--accent-primary)" }
        : { borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
      {icone}{children}
    </button>
  )
}

function Marca({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-1.5 py-0.5 text-[var(--text-secondary)]">{children}</span>
}

function Sugestao({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
      {children}
    </button>
  )
}
