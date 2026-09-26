"use client"

// src/components/operacao/operacao-v3.tsx
// ============================================================================
// ETAPA 3 — TELA OPERAÇÃO, IDÊNTICA AO PROTÓTIPO
// (docs/design/operacao-v3-prototipo.html — ler antes de mexer aqui).
//
// Porta `renderVals()` do protótipo para dados REAIS: `/api/operacao/tarefas`
// (visao=minha_fila/acompanhamento/feito) é a MESMA consulta que qualquer
// outra tela de operação usa — nenhuma fonte de verdade nova, só uma
// apresentação nova sobre ela. Vive dentro de `<main>` de `src/app/operacao/
// page.tsx`, abaixo do `HeaderBarApp` global — o cabeçalho aqui (título +
// KPIs + sino) é conteúdo da PÁGINA, não chrome do app.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { urlArvoreDoProcesso } from "@/lib/operacional/navegacao"
import { auth } from "./kit-operacional"
import { useJsonLocalStorage } from "@/src/lib/cliente"
import { DocumentoOperationalDrawer } from "@/src/components/kanban/DocumentoOperationalDrawer"
import { TarefaTransversalModal } from "@/src/components/kanban/TarefaTransversalModal"
import type { LinhaOperacaoV3, RespostaTarefas, Vista, AgruparFilaPor, FiltroRadar, FiltroQuick } from "./operacao-v3-tipos"
import {
  relCls, acompTxtCompleto, passoLabelDe, porQueAquiDe, orgaoTxt, orgaoCls,
  cobrancasTxt, prazoTarefaCls, acaoDe, concluirLabelDe, aplicarBusca, aplicarVista,
  agruparDentroDaFamilia, agruparPorFamilia, type GrupoDeLinhas,
} from "./operacao-v3-derivacoes"
import {
  AbaAguardando, AbaAcompanhamento, AbaFamilias, AbaRadar, AbaFeito,
} from "./operacao-v3-abas"
import "./operacao-v3.css"

const ESCALADA_LIMIAR = 2

// ── DADOS ────────────────────────────────────────────────────────────────
function useOperacaoV3Dados() {
  const [abertos, setAbertos] = useState<LinhaOperacaoV3[] | null>(null)
  const [feito, setFeito] = useState<LinhaOperacaoV3[] | null>(null)
  const [erro, setErro] = useState(false)
  const [tick, setTick] = useState(0)
  const recarregar = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch("/api/operacao/tarefas?visao=minha_fila&porPagina=500", { headers: auth() }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/operacao/tarefas?visao=feito", { headers: auth() }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    ])
      .then(([a, f]: [RespostaTarefas, RespostaTarefas]) => {
        if (!vivo) return
        setAbertos(a.linhas)
        setFeito(f.linhas)
        setErro(false)
      })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [tick])

  return { abertos, feito, carregando: abertos == null && !erro, erro, recarregar }
}

// ── TIPO DE ABA ──────────────────────────────────────────────────────────
type Tab = "fila" | "aguard" | "acomp" | "fam" | "radar" | "feito"

export function OperacaoV3() {
  const usuario = useJsonLocalStorage<{ nome?: string }>("user")
  const dados = useOperacaoV3Dados()

  const [tab, setTab] = useState<Tab>("fila")
  const [sel, setSel] = useState<Record<number, true>>({})
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null)
  const [group, setGroup] = useState<AgruparFilaPor>("pessoa")
  const [radar, setRadar] = useState<FiltroRadar>(null)
  const [quick, setQuick] = useState<FiltroQuick>(null)
  const [famOpen, setFamOpen] = useState<{ fam: string; estagio: string } | null>(null)
  const [famUltimo, setFamUltimo] = useState<Record<string, string>>({})
  const [col, setCol] = useState<Record<string, true>>({})
  const [vista, setVista] = useState<Vista>("minha")
  const [busca, setBusca] = useState("")
  const [aguardPor, setAguardPor] = useState<"familia" | "orgao">("familia")
  const [acompDepois, setAcompDepois] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [transversalProcessoId, setTransversalProcessoId] = useState<number | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const avisar = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const irPara = useCallback((t: Tab) => { setTab(t); setQuick(null) }, [])

  // ── FILTROS (vista → busca → quick/radar) ────────────────────────────
  const todos = useMemo(() => {
    const base = dados.abertos ?? []
    return aplicarBusca(aplicarVista(base, vista), busca)
  }, [dados.abertos, vista, busca])

  const abertosVisiveis = useMemo(() => todos.filter((l) => l.estadoOperacao !== "CONCLUIDA"), [todos])
  const filaBase = useMemo(() => abertosVisiveis.filter((l) => l.estadoOperacao === "FILA"), [abertosVisiveis])
  const aguardBase = useMemo(() => abertosVisiveis.filter((l) => l.estadoOperacao === "AGUARDANDO"), [abertosVisiveis])
  const acompVenc = useMemo(() => abertosVisiveis.filter((l) => l.acompanhamentoVencido), [abertosVisiveis])
  const atras = useMemo(() => abertosVisiveis.filter((l) => l.atrasada), [abertosVisiveis])
  const decis = useMemo(() => abertosVisiveis.filter((l) => l.escalada), [abertosVisiveis])
  const noOrg = useMemo(() => abertosVisiveis.filter((l) => l.aIniciar && !l.terceiroNome), [abertosVisiveis])
  const genOpen = useMemo(() => abertosVisiveis.filter((l) => l.faseMacroKey === "genealogia" && l.origem !== "TRANSVERSAL"), [abertosVisiveis])

  const qf = useCallback((l: LinhaOperacaoV3) => {
    if (!quick) return true
    if (quick === "atrasadas") return l.atrasada
    if (quick === "escaladas") return l.escalada
    if (quick === "vencidos") return l.acompanhamentoVencido
    return true
  }, [quick])

  const fila = useMemo(() => {
    let f = filaBase.filter(qf)
    if (radar === "noorg") f = f.filter((l) => l.aIniciar && !l.terceiroNome)
    if (radar === "faseant") f = f.filter((l) => l.faseMacroKey === "genealogia")
    return f
  }, [filaBase, qf, radar])
  const aguard = useMemo(() => aguardBase.filter(qf), [aguardBase, qf])

  const nFam = useMemo(() => new Set(abertosVisiveis.map((l) => l.familiaNome ?? "—")).size, [abertosVisiveis])
  const nRadar = (atras.length ? 1 : 0) + (acompVenc.length ? 1 : 0) + (decis.length ? 1 : 0) + (noOrg.length ? 1 : 0) + (genOpen.length ? 1 : 0) + 1

  const notifs = useMemo(() => {
    const itens: Array<{ tag: string; cls: string; txt: string; go: () => void }> = []
    for (const l of acompVenc.slice(0, 3)) {
      itens.push({ tag: "Acomp. vencido", cls: "opv3-p-amb", txt: `${passoLabelDe(l).label} · ${l.titulo} · ${l.pessoaNome ?? "—"} · ${l.familiaNome ?? "—"}`, go: () => { setNotifOpen(false); setDrawerTaskId(l.taskId) } })
    }
    for (const l of atras.slice(0, 2)) {
      itens.push({ tag: "Atrasada", cls: "opv3-p-red", txt: `${l.titulo} · ${l.pessoaNome ?? "—"} · ${l.familiaNome ?? "—"} · ${l.rotuloDoPrazo}`, go: () => { setNotifOpen(false); setDrawerTaskId(l.taskId) } })
    }
    for (const l of decis.slice(0, 1)) {
      itens.push({ tag: "Escalada", cls: "opv3-p-red", txt: `${l.terceiroNome ?? "órgão"} não responde após ${l.totalCobrancas} cobranças · ${l.familiaNome ?? "—"}`, go: () => { setNotifOpen(false); setDrawerTaskId(l.taskId) } })
    }
    if (noOrg.length) itens.push({ tag: "Bloqueio", cls: "opv3-p-red", txt: `${noOrg.length} certidões sem órgão emissor`, go: () => { setNotifOpen(false); setTab("fila"); setRadar("noorg") } })
    return itens
  }, [acompVenc, atras, decis, noOrg])

  const linhaPorId = useMemo(() => new Map(todos.map((l) => [l.taskId, l])), [todos])
  const drawerLinha = drawerTaskId != null ? linhaPorId.get(drawerTaskId) ?? null : null
  const focusOn = focus != null && drawerLinha != null

  const navFoco = useCallback((dir: 1 | -1) => {
    const lista = fila.length ? fila : abertosVisiveis
    const i = lista.findIndex((l) => l.taskId === drawerTaskId)
    const prox = lista[(i + dir + lista.length) % lista.length]
    if (!prox) return
    setDrawerTaskId(prox.taskId)
    if (focus != null) setFocus((i + dir + lista.length) % lista.length)
  }, [fila, abertosVisiveis, drawerTaskId, focus])

  const iniciarFoco = useCallback(() => {
    if (!fila.length) { avisar("Fila vazia."); return }
    setFocus(0); setDrawerTaskId(fila[0].taskId)
  }, [fila, avisar])

  // ── AÇÕES (chamam a API real, recarregam, avisam) ────────────────────
  const cobrar = useCallback(async (taskId: number, canal = "EMAIL") => {
    const r = await fetch(`/api/operacao/tarefas/${taskId}/cobrar`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ canal }) })
    const d = await r.json().catch(() => ({}))
    if (d.ok) avisar(`Cobrança registrada${d.escalada ? " · escalada ao gestor" : ""}.`)
    else avisar(d.mensagem ?? "Não foi possível registrar a cobrança.")
    dados.recarregar()
  }, [avisar, dados])

  const adiar = useCallback(async (taskId: number) => {
    const motivo = typeof window !== "undefined" ? window.prompt("Por que adiar o acompanhamento?") : null
    if (!motivo || motivo.trim().length < 3) return
    const r = await fetch(`/api/operacao/tarefas/${taskId}/adiar-acompanhamento`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ motivo, dias: 3 }) })
    const d = await r.json().catch(() => ({}))
    if (d.ok) avisar("Acompanhamento adiado 3 dias. O prazo da tarefa não muda.")
    else avisar(d.mensagem ?? "Não foi possível adiar.")
    dados.recarregar()
  }, [avisar, dados])

  const iniciarSelecionadas = useCallback(async () => {
    const ids = Object.keys(sel).map(Number)
    const r = await fetch("/api/operacao/tarefas/iniciar-lote", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ tarefaIds: ids }) })
    const d = await r.json().catch(() => ({}))
    setSel({})
    if (d.ok) avisar(`${d.iniciadas} certidões enviadas.${d.ignoradas?.length ? ` (${d.ignoradas.length} ignorada(s): ${d.ignoradas[0]?.motivo})` : ""}`)
    else avisar(d.mensagem ?? "Não foi possível iniciar em lote.")
    dados.recarregar()
  }, [sel, avisar, dados])

  const vincularOrgaoTodos = useCallback(async (ids: number[]) => {
    if (typeof window === "undefined") return
    const orgaoId = Number(window.prompt("ID do órgão emissor a vincular:"))
    if (!Number.isInteger(orgaoId) || orgaoId <= 0) return
    const r = await fetch("/api/operacao/tarefas/vincular-orgao-lote", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ tarefaIds: ids, orgaoId }) })
    const d = await r.json().catch(() => ({}))
    if (d.ok) avisar(`Órgão vinculado. Agora dá pra iniciar. (${d.vinculadas} vinculada(s))`)
    else avisar(d.mensagem ?? "Não foi possível vincular.")
    dados.recarregar()
  }, [avisar, dados])

  const naoLigado = useCallback(() => avisar("Ação ainda não ligada nesta tela."), [avisar])

  if (dados.erro) {
    return (
      <div className="opv3-root" style={{ padding: 40, textAlign: "center" }}>
        <div className="opv3-card" style={{ padding: 32, display: "inline-block" }}>
          <b>Não foi possível carregar a Operação.</b>
        </div>
      </div>
    )
  }
  if (dados.carregando) {
    return <div className="opv3-root" style={{ padding: 40, textAlign: "center", color: "#5b6478" }}>Carregando…</div>
  }

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })

  return (
    <div className="opv3-root" style={{ display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      {/* ===== HEADER: título + KPIs + sino ===== */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px 0", background: "#fff", borderBottom: "1px solid #dfe4ee" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0b1f4b" }}>Operação</h1>
          <div style={{ fontSize: 12, color: "#5b6478" }}>{hoje} · {usuario?.nome ?? "—"} · equipe documental</div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", gap: 8, paddingBottom: 12, alignItems: "center" }}>
          <button className="opv3-kpi" onClick={() => irPara("fila")} style={{ borderColor: "#c9622b", textAlign: "left" }}>
            <b style={{ color: "#c9622b" }}>{filaBase.length}</b><span>Fila</span>
          </button>
          <button className="opv3-kpi" onClick={() => irPara("aguard")} style={{ textAlign: "left" }}>
            <b>{aguardBase.length}</b><span>Aguardando</span>
          </button>
          <button className="opv3-kpi" onClick={() => irPara("acomp")} style={{ borderColor: "#b26a00", textAlign: "left" }}>
            <b style={{ color: "#7a4a00" }}>{acompVenc.length}</b><span>Acomp. vencidos</span>
          </button>
          <button className="opv3-kpi" onClick={() => { const emFila = filaBase.some((l) => l.atrasada); setTab(emFila ? "fila" : "aguard"); setQuick("atrasadas"); setRadar(null) }} style={{ borderColor: "#b3261e", textAlign: "left" }}>
            <b style={{ color: "#8f1d17" }}>{atras.length}</b><span>Atrasadas</span>
          </button>
          <button className="opv3-kpi" onClick={() => irPara("fam")} style={{ textAlign: "left" }}>
            <b>{abertosVisiveis.length}</b><span>Abertas</span>
          </button>
          <button className="opv3-btn" onClick={() => setNotifOpen((v) => !v)} aria-label="Notificações operacionais" style={{ minWidth: 44, position: "relative" }}>
            🔔 <span className="opv3-pill opv3-p-red" style={{ padding: "0 6px" }}>{notifs.length}</span>
          </button>
        </div>
      </header>

      {notifOpen && (
        <div className="opv3-card" style={{ position: "absolute", right: 4, top: 70, width: 400, zIndex: 20, boxShadow: "0 12px 32px rgba(11,31,75,.18)" }}>
          <div style={{ padding: "10px 14px", fontWeight: 700, borderBottom: "1px solid #edf0f5", display: "flex", justifyContent: "space-between" }}>
            <span>Notificações operacionais</span>
            <button className="opv3-btn opv3-sm" onClick={() => setNotifOpen(false)}>✕</button>
          </div>
          {notifs.length === 0 && <div style={{ padding: 14, fontSize: 12, color: "#5b6478" }}>Nada pendente.</div>}
          {notifs.map((n, i) => (
            <button key={i} onClick={n.go} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "10px 14px", borderBottom: "1px solid #edf0f5", fontSize: 12, cursor: "pointer" }}>
              <span className={`opv3-pill ${n.cls}`}>{n.tag}</span> {n.txt}
            </button>
          ))}
        </div>
      )}

      {/* ===== ABAS + VISTA/BUSCA ===== */}
      <div style={{ display: "flex", gap: 2, padding: "0 24px", background: "#fff", borderBottom: "1px solid #dfe4ee", alignItems: "center", flexWrap: "wrap" }}>
        <button className={`opv3-tab ${tab === "fila" ? "on" : ""}`} onClick={() => irPara("fila")}>Fila <span className="opv3-n">{filaBase.length}</span></button>
        <button className={`opv3-tab ${tab === "aguard" ? "on" : ""}`} onClick={() => irPara("aguard")}>Aguardando <span className="opv3-n">{aguardBase.length}</span></button>
        <button className={`opv3-tab ${tab === "acomp" ? "on" : ""}`} onClick={() => irPara("acomp")}>Acompanhamento <span className="opv3-n opv3-warn">{acompVenc.length} vencidos</span></button>
        <button className={`opv3-tab ${tab === "fam" ? "on" : ""}`} onClick={() => irPara("fam")}>Famílias <span className="opv3-n">{nFam}</span></button>
        <button className={`opv3-tab ${tab === "radar" ? "on" : ""}`} onClick={() => irPara("radar")}>Radar <span className="opv3-n">{nRadar}</span></button>
        <button className={`opv3-tab ${tab === "feito" ? "on" : ""}`} onClick={() => irPara("feito")}>Feito <span className="opv3-n">{(dados.feito ?? []).length}</span></button>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0" }}>
          <label className="opv3-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <span>Vista</span>
            <select aria-label="Vista salva" value={vista} onChange={(e) => setVista(e.target.value as Vista)} style={{ width: "auto" }}>
              <option value="minha">Minha fila</option>
              <option value="es">Só Espanha</option>
              <option value="it">Só Itália</option>
              <option value="urg">Só urgentes (vencidos + atrasadas)</option>
            </select>
          </label>
          <input aria-label="Buscar" placeholder="Buscar família, pessoa, documento, órgão…" value={busca} onChange={(e) => setBusca(e.target.value)}
            style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #cfd6e3", borderRadius: 7, width: 230, minHeight: 30 }} />
          {busca && <button className="opv3-btn opv3-sm" onClick={() => setBusca("")}>✕</button>}
        </div>
      </div>

      {/* ===== CORPO + DRAWER ===== */}
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <section style={{ flexGrow: 1, minWidth: 0, padding: "14px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {tab === "fila" && (
            <AbaFila
              linhas={fila} todasSelecionaveis={filaBase}
              group={group} setGroup={setGroup}
              radar={radar} clearRadar={() => setRadar(null)}
              quick={quick} clearQuick={() => setQuick(null)}
              sel={sel} setSel={setSel}
              col={col} setCol={setCol}
              nAguard={aguardBase.length} nAcompVenc={acompVenc.length}
              noOrgTotal={noOrg}
              onAbrir={(id) => setDrawerTaskId(id)}
              onIniciarFoco={iniciarFoco}
              onIniciarSelecionadas={iniciarSelecionadas}
              onVincularTodos={vincularOrgaoTodos}
              onAddTransversal={() => {
                const primeira = filaBase[0]
                if (!primeira?.processoId) { avisar("Nenhuma família na fila para anexar a tarefa transversal."); return }
                setTransversalProcessoId(primeira.processoId)
              }}
              onNaoLigado={naoLigado}
              onVerFamilia={(fam) => { setTab("fam"); setFamOpen({ fam, estagio: "iniciar" }); setFamUltimo((m) => ({ ...m, [fam]: "iniciar" })) }}
            />
          )}
          {tab === "aguard" && (
            <AbaAguardando
              linhas={aguard} aguardPor={aguardPor} setAguardPor={setAguardPor}
              quick={quick} clearQuick={() => setQuick(null)} col={col} setCol={setCol}
              onAbrir={(id) => setDrawerTaskId(id)} onCobrar={cobrar}
              onVerFamilia={(fam) => { setTab("fam"); setFamOpen({ fam, estagio: "cartorio" }); setFamUltimo((m) => ({ ...m, [fam]: "cartorio" })) }}
            />
          )}
          {tab === "acomp" && (
            <AbaAcompanhamento
              linhas={abertosVisiveis} acompDepois={acompDepois} setAcompDepois={setAcompDepois}
              col={col} setCol={setCol}
              onAbrir={(id) => setDrawerTaskId(id)} onCobrar={cobrar} onAdiar={adiar}
              onCobrarTodosVencidos={async () => {
                const ids = abertosVisiveis.filter((l) => l.acompanhamentoVencido && (l.faseMacroKey !== "genealogia")).map((l) => l.taskId)
                if (!ids.length) { avisar("Nenhum acompanhamento vencido de terceiro."); return }
                const r = await fetch("/api/operacao/tarefas/cobrar-todos-vencidos", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ tarefaIds: ids }) })
                const d = await r.json().catch(() => ({}))
                if (d.ok) avisar(`${d.cobradas} cobranças registradas.`)
                dados.recarregar()
              }}
              onVerFamilia={(fam) => { setTab("fam"); setFamOpen({ fam, estagio: "vencidos" }); setFamUltimo((m) => ({ ...m, [fam]: "vencidos" })) }}
            />
          )}
          {tab === "fam" && (
            <AbaFamilias
              abertos={abertosVisiveis} feito={dados.feito ?? []}
              famOpen={famOpen} setFamOpen={setFamOpen} famUltimo={famUltimo} setFamUltimo={setFamUltimo}
              onAbrir={(id) => setDrawerTaskId(id)} onNaoLigado={naoLigado}
            />
          )}
          {tab === "radar" && (
            <AbaRadar
              atras={atras} acompVenc={acompVenc} decis={decis} noOrg={noOrg} genOpen={genOpen}
              onKAtras={() => { const emFila = filaBase.some((l) => l.atrasada); setTab(emFila ? "fila" : "aguard"); setQuick("atrasadas") }}
              onGoAcomp={() => setTab("acomp")}
              onKEsc={() => { setTab("aguard"); setQuick("escaladas") }}
              onNoOrg={() => { setTab("fila"); setRadar("noorg") }}
              onFaseAnterior={() => { setTab("fila"); setRadar("faseant") }}
              onNaoLigado={naoLigado}
            />
          )}
          {tab === "feito" && (
            <AbaFeito linhas={dados.feito ?? []} col={col} setCol={setCol} onAbrir={(id) => setDrawerTaskId(id)} />
          )}
        </section>

        {/* O PAINEL REAL — Etapa 3, 26/09/2026: `DocumentoOperationalDrawer` usa
            `createPortal(..., document.body)` com `position: fixed` (z-index
            10001) por dentro; um `<aside>` nosso por FORA dele nunca fica na
            frente — ficava coberto assim que o conteúdo real terminava de
            carregar (achado real, testado ao vivo). Os três elementos que o
            protótipo pede (pílula "espelhado", barra de Modo foco, rodapé de
            navegação da fila) entram como PROPS aditivas do componente real
            (`pilulaExtra`/`barraSuperiorExtra`/`rodapeExtra`), renderizados
            dentro do MESMO z-index — nunca um wrapper concorrente. */}
        {drawerLinha && (
          <DocumentoOperationalDrawer
            documentoId={drawerLinha.documentoId}
            isOpen={true}
            onClose={() => { setDrawerTaskId(null); setFocus(null) }}
            onSave={() => dados.recarregar()}
            pilulaExtra="painel real do processo · espelhado"
            barraSuperiorExtra={focusOn ? (
              <div style={{ background: "#fff6f0", borderBottom: "1px solid #f0c9b3", padding: "8px 18px", display: "flex", alignItems: "center", gap: 10, fontSize: 12, flexShrink: 0 }}>
                <span className="opv3-pill opv3-p-blu">Modo foco</span>
                <b>{(focus ?? 0) + 1} de {fila.length}</b>
                <div className="opv3-bar" style={{ width: 120 }}><div style={{ width: `${Math.round(((focus ?? 0) + 1) / Math.max(1, fila.length) * 100)}%`, height: 8, background: "#c9622b" }} /></div>
                <div style={{ flexGrow: 1 }} />
                <button className="opv3-btn opv3-sm" onClick={() => navFoco(-1)}>←</button>
                <button className="opv3-btn opv3-sm" onClick={() => navFoco(1)}>Pular →</button>
                <button className="opv3-btn opv3-sm" onClick={() => { setFocus(null); setDrawerTaskId(null) }}>Sair</button>
              </div>
            ) : undefined}
            rodapeExtra={(
              <div style={{ background: "var(--surface-secondary)", borderTop: "1px solid var(--border-default)", padding: "10px 18px", display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#7a8296", flexShrink: 0 }}>
                <span>Navegação da fila (só na Operação)</span>
                <div style={{ flexGrow: 1 }} />
                <button className="opv3-btn opv3-sm" onClick={() => navFoco(-1)}>← Anterior</button>
                <button className="opv3-btn opv3-sm" onClick={() => navFoco(1)}>Próxima →</button>
              </div>
            )}
          />
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: "#0b1f4b", color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 12, zIndex: 30, boxShadow: "0 10px 30px rgba(0,0,0,.3)", display: "flex", gap: 12, alignItems: "center", maxWidth: 720 }}>
          <span>{toast}</span>
          <button className="opv3-btn opv3-sm" onClick={() => setToast(null)} style={{ background: "#1d3466", color: "#fff", borderColor: "#2c4a86" }}>ok</button>
        </div>
      )}

      {transversalProcessoId != null && (
        <TarefaTransversalModal
          processoId={transversalProcessoId}
          onClose={() => setTransversalProcessoId(null)}
          onCreated={() => { setTransversalProcessoId(null); avisar("Tarefa transversal criada. Não muda a fase do processo."); dados.recarregar() }}
        />
      )}
    </div>
  )
}

// ============================================================================
// ABA FILA — a mais rica: seleção em lote, agrupamento, faixa de bloqueio.
// ============================================================================
function AbaFila({
  linhas, todasSelecionaveis, group, setGroup, radar, clearRadar, quick, clearQuick,
  sel, setSel, col, setCol, nAguard, nAcompVenc, noOrgTotal,
  onAbrir, onIniciarFoco, onIniciarSelecionadas, onVincularTodos, onAddTransversal, onNaoLigado, onVerFamilia,
}: {
  linhas: LinhaOperacaoV3[]
  todasSelecionaveis: LinhaOperacaoV3[]
  group: AgruparFilaPor
  setGroup: (g: AgruparFilaPor) => void
  radar: FiltroRadar
  clearRadar: () => void
  quick: FiltroQuick
  clearQuick: () => void
  sel: Record<number, true>
  setSel: (s: Record<number, true>) => void
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  nAguard: number
  nAcompVenc: number
  noOrgTotal: LinhaOperacaoV3[]
  onAbrir: (taskId: number) => void
  onIniciarFoco: () => void
  onIniciarSelecionadas: () => void
  onVincularTodos: (ids: number[]) => void
  onAddTransversal: () => void
  onNaoLigado: () => void
  onVerFamilia: (fam: string) => void
}) {
  const familias = useMemo(() => agruparPorFamilia(linhas), [linhas])
  const selCount = Object.keys(sel).length
  const toggleCol = (k: string) => setCol(col[k] ? Object.fromEntries(Object.entries(col).filter(([x]) => x !== k)) : { ...col, [k]: true })
  const toggleLinha = (id: number) => setSel(sel[id] ? Object.fromEntries(Object.entries(sel).filter(([x]) => Number(x) !== id)) : { ...sel, [id]: true })
  const toggleGrupo = (rs: LinhaOperacaoV3[]) => {
    const todosMarcados = rs.every((r) => sel[r.taskId])
    const novo = { ...sel }
    for (const r of rs) { if (todosMarcados) delete novo[r.taskId]; else novo[r.taskId] = true }
    setSel(novo)
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="opv3-btn opv3-acc" onClick={onIniciarFoco}>▶ Trabalhar a fila ({linhas.length})</button>
        <label className="opv3-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <span>Por família, depois por</span>
          <select aria-label="Agrupar por" value={group} onChange={(e) => setGroup(e.target.value as AgruparFilaPor)} style={{ width: "auto" }}>
            <option value="pessoa">Pessoa</option>
            <option value="orgao">Órgão</option>
            <option value="passo">Passo</option>
          </select>
        </label>
        {radar && <span className="opv3-pill opv3-p-red">Radar: {radar === "noorg" ? "Sem órgão" : "Pendência de fase anterior"} <button onClick={clearRadar} style={{ border: 0, background: "transparent", color: "#8f1d17", cursor: "pointer" }}>✕</button></span>}
        {quick && <span className="opv3-pill opv3-p-red">Filtro: {quick === "atrasadas" ? "Atrasadas" : quick === "escaladas" ? "Escaladas ao gestor" : "Acompanhamento vencido"} <button onClick={clearQuick} style={{ border: 0, background: "transparent", color: "#8f1d17", cursor: "pointer" }}>✕</button></span>}
        <button className="opv3-btn" onClick={onAddTransversal}>+ Tarefa transversal</button>
        <button className="opv3-btn opv3-sm" onClick={() => { const c: Record<string, true> = {}; for (const f of familias) c[`fila|${f.fam}`] = true; setCol({ ...col, ...c }) }}>Recolher tudo</button>
        <button className="opv3-btn opv3-sm" onClick={() => setCol({})}>Expandir tudo</button>
        <div style={{ flexGrow: 1 }} />
        {selCount > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", background: "#fff6f0", border: "1px solid #f0c9b3", borderRadius: 10, padding: "5px 8px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#8a3f15" }}>{selCount} sel.</span>
            <button className="opv3-btn opv3-acc opv3-sm" onClick={onIniciarSelecionadas}>Iniciar (enviar ao cartório) as {selCount}</button>
            <button className="opv3-btn opv3-sm" onClick={() => onVincularTodos(Object.keys(sel).map(Number))}>Vincular órgão</button>
            <button className="opv3-btn opv3-sm" onClick={onNaoLigado}>Atribuir</button>
            <button className="opv3-btn opv3-sm" onClick={() => setSel({})}>Limpar</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#5b6478" }}>Fila = o que depende de você agora: certidões <b>a iniciar</b> (enviar ao cartório) e no <b>passo 4</b> (conferir e validar). O que está com o cartório fica em Aguardando.</div>

      {noOrgTotal.length > 0 && !radar && !quick && (
        <div className="opv3-card" style={{ borderLeft: "4px solid #b3261e", padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
          <span className="opv3-pill opv3-p-red">Bloqueio</span>
          <span><b>{noOrgTotal.length} certidões sem órgão emissor.</b> Não dá pra enviar sem destino — vincule antes de iniciar.</span>
          <div style={{ flexGrow: 1 }} />
          <button className="opv3-btn opv3-pri" onClick={() => onVincularTodos(noOrgTotal.map((l) => l.taskId))}>Vincular órgão nas {noOrgTotal.length}</button>
        </div>
      )}

      {linhas.length === 0 && (
        <div className="opv3-card" style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
          <b style={{ fontSize: 14, color: "#155e39" }}>{quick || radar ? "Nenhuma na fila com esse filtro." : "Nada na fila."}</b>
          <span style={{ color: "#5b6478" }}>{nAguard} certidões com o cartório · {nAcompVenc} acompanhamentos vencidos.</span>
        </div>
      )}

      {familias.map((F) => {
        const fk = `fila|${F.fam}`
        const aberta = !col[fk]
        const grupos = agruparDentroDaFamilia(F.linhas, group === "pessoa" ? "pessoa" : group === "orgao" ? "orgao" : "passo")
        const todosMarcados = F.linhas.every((r) => sel[r.taskId])
        return (
          <div key={F.fam} className="opv3-card" style={{ borderLeft: "4px solid #0b1f4b", marginTop: 10, paddingBottom: 12, boxShadow: "0 2px 8px rgba(11,31,75,.06)" }}>
            <div className="opv3-grp" style={{ borderTop: 0, borderRadius: "12px 12px 0 0", background: "#e3e8f2", padding: "13px 16px" }}>
              <button className={`opv3-chk ${todosMarcados ? "on" : ""}`} onClick={() => toggleGrupo(F.linhas)} aria-label="Selecionar família" />
              <button className="opv3-btn opv3-sm" onClick={() => toggleCol(fk)} aria-label="Expandir ou recolher família" style={{ minWidth: 32 }}>{aberta ? "▾" : "▸"}</button>
              <span className="opv3-pill opv3-p-gry">Família</span><b style={{ fontSize: 12.5 }}>{F.fam}</b><span style={{ color: "#5b6478" }}>{F.pais} · {F.linhas.length} tarefa(s) na fila</span>
              <div style={{ flexGrow: 1 }} />
              <button className="opv3-btn opv3-sm" onClick={() => onVerFamilia(F.fam)}>Ver família</button>
            </div>
            {aberta && grupos.map((g) => (
              <GrupoFila key={g.chave} grupo={g} col={col} setCol={setCol} sel={sel} toggleLinha={toggleLinha} toggleGrupo={toggleGrupo} onAbrir={onAbrir} famKey={F.fam} />
            ))}
          </div>
        )
      })}
    </>
  )
}

function GrupoFila({ grupo, col, setCol, sel, toggleLinha, toggleGrupo, onAbrir, famKey }: {
  grupo: GrupoDeLinhas
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  sel: Record<number, true>
  toggleLinha: (id: number) => void
  toggleGrupo: (rs: LinhaOperacaoV3[]) => void
  onAbrir: (id: number) => void
  famKey: string
}) {
  const router = useRouter()
  const ck = `fila|${famKey}|${grupo.chave}`
  const aberto = !col[ck]
  const toggleCol = () => setCol(col[ck] ? Object.fromEntries(Object.entries(col).filter(([x]) => x !== ck)) : { ...col, [ck]: true })
  // GENEALOGIA É SEM DOCUMENTO POR NATUREZA (Etapa D, 26/09/2026):
  // `localizar_registro` confirma o registro civil ANTES de qualquer
  // Documento existir — abrir o drawer documental (que espera
  // `documentoId`) sempre dá "sem documento associado". "Continuar" leva à
  // aba Árvore do processo, onde a Genealogia acontece de verdade.
  const abrirLinha = (t: LinhaOperacaoV3) => {
    if (t.faseMacroKey === "genealogia" && t.documentoId == null && t.processoId != null) {
      router.push(urlArvoreDoProcesso(t.processoId))
      return
    }
    onAbrir(t.taskId)
  }
  const todosMarcados = grupo.linhas.every((r) => sel[r.taskId])
  return (
    <div style={{ margin: "12px 12px 0", border: "1px solid #dfe4ee", borderRadius: 10, overflow: "hidden" }}>
      <div className="opv3-grp" style={{ borderTop: 0 }}>
        <button className={`opv3-chk ${todosMarcados ? "on" : ""}`} onClick={() => toggleGrupo(grupo.linhas)} aria-label="Selecionar grupo" />
        <button className="opv3-btn opv3-sm" onClick={toggleCol} aria-label="Expandir ou recolher" style={{ minWidth: 32 }}>{aberto ? "▾" : "▸"}</button>
        <span className={`opv3-pill ${grupo.pillCls}`}>{grupo.pill}</span><b>{grupo.titulo}</b><span style={{ color: "#5b6478" }}>{grupo.sub}</span>
        <div style={{ flexGrow: 1 }} />
        {grupo.lote && <button className="opv3-btn opv3-sm" onClick={() => toggleGrupo(grupo.linhas)}>Selecionar as {grupo.linhas.length} (mesmo requerimento)</button>}
      </div>
      {aberto && (
        <>
          <div className="opv3-hd opv3-gF"><span /><span>Documento</span><span>Pessoa</span><span>Por que aqui</span><span>Passo atual</span><span>Acompanhamento</span><span>Órgão</span><span>Ação</span></div>
          {grupo.linhas.map((t) => {
            const passo = passoLabelDe(t)
            const why = porQueAquiDe(t)
            const acao = acaoDe(t)
            return (
              <div key={t.taskId} className={`opv3-row opv3-gF ${sel[t.taskId] ? "opv3-sel" : ""}`}>
                <button className={`opv3-chk ${sel[t.taskId] ? "on" : ""}`} onClick={() => toggleLinha(t.taskId)} aria-label="Selecionar" />
                <div style={{ fontWeight: 600 }}>{t.titulo}<div style={{ fontSize: 11, color: "#7a8296", fontWeight: 500 }}>{t.familiaNome} · {t.pais}</div></div>
                <div>{t.pessoaNome ?? "—"}<div style={{ fontSize: 11, color: "#7a8296" }}>{t.numeroLinhagem != null ? `G${t.numeroLinhagem}` : ""}</div></div>
                <div><span className={`opv3-pill ${why.cls}`}>{why.texto}</span></div>
                <div>{passo.label}<div style={{ fontSize: 11, color: "#7a8296" }}>{passo.sub}</div></div>
                <div><span className={`opv3-pill ${relCls(t.acompanhamentoPasso)}`}>{acompTxtCompleto(t.acompanhamentoPasso)}</span><div style={{ fontSize: 11, color: "#7a8296" }}>{t.rotuloDoPrazo}</div></div>
                <div><span className={`opv3-pill ${orgaoCls(t)}`}>{orgaoTxt(t)}</span></div>
                <div style={{ display: "flex", gap: 4 }}><button className={`opv3-btn opv3-sm ${acao.accent ? "opv3-acc" : ""}`} onClick={() => abrirLinha(t)}>{acao.label}</button></div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

export { ESCALADA_LIMIAR }
