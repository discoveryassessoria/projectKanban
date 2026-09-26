"use client"

// src/components/operacao/operacao-v3-abas.tsx
// ============================================================================
// ETAPA 3 — abas Aguardando/Acompanhamento/Famílias/Radar/Feito.
// Ver operacao-v3.tsx (shell + aba Fila) e docs/design/operacao-v3-prototipo.html.
// ============================================================================
import { useMemo } from "react"
import type { LinhaOperacaoV3 } from "./operacao-v3-tipos"
import {
  fmtData, acompTxtCompleto, relCls, passoLabelDe, orgaoTxt, cobrancasTxt, prazoTarefaCls,
  concluirLabelDe, agruparPorFamilia, agruparPorOrgao, type FamiliaComGrupos,
} from "./operacao-v3-derivacoes"

const toggle = (col: Record<string, true>, setCol: (c: Record<string, true>) => void, k: string) =>
  setCol(col[k] ? Object.fromEntries(Object.entries(col).filter(([x]) => x !== k)) : { ...col, [k]: true })

// ============================================================================
// AGUARDANDO
// ============================================================================
export function AbaAguardando({
  linhas, aguardPor, setAguardPor, quick, clearQuick, col, setCol, onAbrir, onCobrar, onVerFamilia,
}: {
  linhas: LinhaOperacaoV3[]
  aguardPor: "familia" | "orgao"
  setAguardPor: (v: "familia" | "orgao") => void
  quick: "atrasadas" | "escaladas" | "vencidos" | null
  clearQuick: () => void
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  onAbrir: (id: number) => void
  onCobrar: (id: number) => void
  onVerFamilia: (fam: string) => void
}) {
  const grupos = useMemo(() => (aguardPor === "orgao" ? agruparPorOrgao(linhas) : agruparPorFamilia(linhas)), [linhas, aguardPor])

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#0b1f4b" }}>O que está com o cartório</div>
        <span style={{ fontSize: 12, color: "#5b6478" }}>passos 2 (confirmar pedido) e 3 (receber certidão) — vencido ou não</span>
        <label className="opv3-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <span>Agrupar por</span>
          <select aria-label="Agrupar Aguardando" value={aguardPor} onChange={(e) => setAguardPor(e.target.value as "familia" | "orgao")} style={{ width: "auto" }}>
            <option value="familia">Família</option>
            <option value="orgao">Órgão (cobrar juntos)</option>
          </select>
        </label>
        {quick && <span className="opv3-pill opv3-p-red">Filtro: {quick === "atrasadas" ? "Atrasadas" : quick === "escaladas" ? "Escaladas ao gestor" : "Acompanhamento vencido"} <button onClick={clearQuick} style={{ border: 0, background: "transparent", color: "#8f1d17", cursor: "pointer" }}>✕</button></span>}
        <div style={{ flexGrow: 1 }} />
      </div>

      {linhas.length === 0 && (
        <div className="opv3-card" style={{ padding: 40, textAlign: "center", color: "#5b6478" }}>
          <b style={{ color: "#0b1f4b" }}>{quick ? "Nenhuma com esse filtro." : "Nada com terceiros."}</b><br />
          {quick ? "Tire o filtro para ver todas." : "Inicie uma certidão na Fila (enviar ao cartório) e ela aparece aqui."}
        </div>
      )}

      {grupos.map((g) => (
        <GrupoAguardando key={g.fam} grupo={g} col={col} setCol={setCol} onAbrir={onAbrir} onCobrar={onCobrar} onVerFamilia={aguardPor === "familia" ? onVerFamilia : undefined} />
      ))}
    </>
  )
}

function GrupoAguardando({ grupo, col, setCol, onAbrir, onCobrar, onVerFamilia }: {
  grupo: FamiliaComGrupos
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  onAbrir: (id: number) => void
  onCobrar: (id: number) => void
  onVerFamilia?: (fam: string) => void
}) {
  const ck = `ag|${grupo.fam}`
  const aberto = !col[ck]
  return (
    <div className="opv3-card" style={{ borderLeft: "4px solid #0b1f4b", marginTop: 10, paddingBottom: 12, boxShadow: "0 2px 8px rgba(11,31,75,.06)" }}>
      <div className="opv3-grp" style={{ borderTop: 0, borderRadius: "12px 12px 0 0", background: "#e3e8f2", padding: "13px 16px" }}>
        <button className="opv3-btn opv3-sm" onClick={() => toggle(col, setCol, ck)} aria-label="Expandir ou recolher família" style={{ minWidth: 32 }}>{aberto ? "▾" : "▸"}</button>
        <span className="opv3-pill opv3-p-gry">{onVerFamilia ? "Família" : "Órgão"}</span>
        <b style={{ fontSize: 12.5 }}>{grupo.fam}</b>
        <span style={{ color: "#5b6478" }}>{grupo.pais ? `${grupo.pais} · ` : ""}{grupo.linhas.length} tarefa(s)</span>
        <div style={{ flexGrow: 1 }} />
        {onVerFamilia && <button className="opv3-btn opv3-sm" onClick={() => onVerFamilia(grupo.fam)}>Ver família</button>}
      </div>
      {aberto && (
        <div style={{ margin: "12px 12px 0", border: "1px solid #dfe4ee", borderRadius: 10, overflow: "hidden" }}>
          <div className="opv3-hd opv3-gA"><span>Documento</span><span>Com quem</span><span>Passo atual</span><span>Desde</span><span>Acompanhamento</span><span>Cobranças</span><span>Prazo da tarefa</span><span>Ação</span></div>
          {grupo.linhas.map((t) => {
            const passo = passoLabelDe(t)
            return (
              <div key={t.taskId} className="opv3-row opv3-gA" style={{ boxShadow: `inset 4px 0 0 ${t.atrasada ? "#b3261e" : "transparent"}` }}>
                <div style={{ fontWeight: 600 }}>{t.titulo}<div style={{ fontSize: 11, color: "#7a8296", fontWeight: 500 }}>{t.familiaNome} · {t.pessoaNome}</div></div>
                <div>{orgaoTxt(t)}</div>
                <div>{passo.label}<div style={{ fontSize: 11, color: "#7a8296" }}>{passo.sub}</div></div>
                <div>{fmtData(t.atribuidaEm)}</div>
                <div><span className={`opv3-pill ${relCls(t.acompanhamentoPasso)}`}>{acompTxtCompleto(t.acompanhamentoPasso)}</span></div>
                <div>{cobrancasTxt(t)}</div>
                <div><span className={`opv3-pill ${prazoTarefaCls(t)}`}>{t.rotuloDoPrazo}</span></div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {t.acompanhamentoVencido && <button className="opv3-btn opv3-sm opv3-acc" onClick={() => onCobrar(t.taskId)}>Cobrar</button>}
                  <button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>{concluirLabelDe(t)}</button>
                  <button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>Abrir</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// ACOMPANHAMENTO
// ============================================================================
export function AbaAcompanhamento({
  linhas, acompDepois, setAcompDepois, col, setCol, onAbrir, onCobrar, onAdiar, onCobrarTodosVencidos, onVerFamilia,
}: {
  linhas: LinhaOperacaoV3[]
  acompDepois: boolean
  setAcompDepois: (v: boolean) => void
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  onAbrir: (id: number) => void
  onCobrar: (id: number) => void
  onAdiar: (id: number) => void
  onCobrarTodosVencidos: () => void
  onVerFamilia: (fam: string) => void
}) {
  const comAcomp = useMemo(() => linhas.filter((l) => l.acompanhamentoPasso && !l.acompanhamentoPasso.semPrazo), [linhas])
  const blocos = useMemo(() => {
    const dias = (l: LinhaOperacaoV3) => l.acompanhamentoPasso!.diasParaPrazo ?? (l.acompanhamentoPasso!.atrasado ? -(l.acompanhamentoPasso!.atrasadoHaDias ?? 1) : 999)
    const defs: Array<[string, (l: LinhaOperacaoV3) => boolean, string, string]> = [
      ["Vencidos", (l) => l.acompanhamentoPasso!.atrasado, "#8f1d17", "opv3-p-red"],
      ["Hoje", (l) => !l.acompanhamentoPasso!.atrasado && l.acompanhamentoPasso!.venceHoje, "#c9622b", "opv3-p-amb"],
      ["Amanhã", (l) => !l.acompanhamentoPasso!.atrasado && !l.acompanhamentoPasso!.venceHoje && l.acompanhamentoPasso!.venceAmanha, "#0b1f4b", "opv3-p-gry"],
      ["Próximos 7 dias", (l) => { const d = dias(l); return d > 1 && d <= 7 }, "#5b6478", "opv3-p-gry"],
      ["Depois de 7 dias", (l) => dias(l) > 7, "#9aa4b8", "opv3-p-gry"],
    ]
    return defs
      .map(([title, pred, color, cls]) => ({ title, color, cls, linhas: comAcomp.filter(pred) }))
      .filter((b) => b.title !== "Depois de 7 dias" || acompDepois)
      .filter((b) => b.linhas.length > 0)
  }, [comAcomp, acompDepois])

  const contagem = (nome: string) => comAcomp.filter((l) => {
    if (nome === "Vencidos") return l.acompanhamentoPasso!.atrasado
    if (nome === "Hoje") return !l.acompanhamentoPasso!.atrasado && l.acompanhamentoPasso!.venceHoje
    if (nome === "Amanhã") return !l.acompanhamentoPasso!.atrasado && !l.acompanhamentoPasso!.venceHoje && l.acompanhamentoPasso!.venceAmanha
    const d = l.acompanhamentoPasso!.diasParaPrazo ?? 999
    return d > 1 && d <= 7
  }).length

  const proximo = useMemo(() => comAcomp.filter((l) => !l.acompanhamentoPasso!.atrasado).sort((a, b) => (a.acompanhamentoPasso!.diasParaPrazo ?? 999) - (b.acompanhamentoPasso!.diasParaPrazo ?? 999))[0], [comAcomp])

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#0b1f4b" }}>O que precisa de controle</div>
        <span style={{ fontSize: 12, color: "#5b6478" }}>só acompanhamentos vencidos, de hoje, de amanhã e dos próximos 7 dias — de qualquer passo, esteja na Fila ou em Aguardando</span>
        <div style={{ flexGrow: 1 }} />
        <button className="opv3-btn opv3-sm" onClick={() => setAcompDepois(!acompDepois)}>{acompDepois ? "Ocultar depois de 7 dias" : "Mostrar depois de 7 dias"}</button>
        <button className="opv3-btn" onClick={onCobrarTodosVencidos}>Cobrar todos os vencidos de terceiro</button>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="opv3-kpi" style={{ borderColor: "#b3261e" }}><b style={{ color: "#8f1d17" }}>{contagem("Vencidos")}</b><span>Vencidos</span></div>
        <div className="opv3-kpi" style={{ borderColor: "#c9622b" }}><b style={{ color: "#c9622b" }}>{contagem("Hoje")}</b><span>Hoje</span></div>
        <div className="opv3-kpi"><b>{contagem("Amanhã")}</b><span>Amanhã</span></div>
        <div className="opv3-kpi"><b>{contagem("Próximos 7 dias")}</b><span>Próximos 7 dias</span></div>
      </div>

      {blocos.length === 0 && (
        <div className="opv3-card" style={{ padding: 40, textAlign: "center", color: "#5b6478" }}>
          <b style={{ color: "#155e39" }}>Tudo em dia.</b><br />
          Próximo acompanhamento: {proximo ? `${fmtData(proximo.acompanhamentoPasso!.dueAt)} · ${passoLabelDe(proximo).label} · ${proximo.pessoaNome ?? "—"}` : "—"}
        </div>
      )}

      {blocos.map((b) => (
        <div key={b.title} style={{ marginTop: 6 }}>
          <div className="opv3-blk" style={{ borderTop: 0, color: b.color, padding: "6px 4px" }}><span>{b.title}</span><span className={`opv3-pill ${b.cls}`}>{b.linhas.length}</span></div>
          {agruparPorFamilia(b.linhas).map((g) => (
            <div key={g.fam} className="opv3-card" style={{ borderLeft: "4px solid #0b1f4b", marginTop: 10, paddingBottom: 12, boxShadow: "0 2px 8px rgba(11,31,75,.06)" }}>
              <div className="opv3-grp" style={{ borderTop: 0, borderRadius: "12px 12px 0 0", background: "#e3e8f2", padding: "13px 16px" }}>
                <button className="opv3-btn opv3-sm" onClick={() => toggle(col, setCol, `ac|${b.title}|${g.fam}`)} aria-label="Expandir ou recolher família" style={{ minWidth: 32 }}>{col[`ac|${b.title}|${g.fam}`] ? "▸" : "▾"}</button>
                <span className="opv3-pill opv3-p-gry">Família</span><b style={{ fontSize: 12.5 }}>{g.fam}</b><span style={{ color: "#5b6478" }}>{g.pais} · {g.linhas.length} tarefa(s)</span>
                <div style={{ flexGrow: 1 }} />
                <button className="opv3-btn opv3-sm" onClick={() => onVerFamilia(g.fam)}>Ver família</button>
              </div>
              {!col[`ac|${b.title}|${g.fam}`] && (
                <div style={{ margin: "12px 12px 0", border: "1px solid #dfe4ee", borderRadius: 10, overflow: "hidden" }}>
                  <div className="opv3-hd opv3-gC"><span>Documento</span><span>Passo</span><span>Com quem / de onde veio a data</span><span>Acompanhamento</span><span>Cobranças</span><span>Prazo tarefa</span><span>Ação</span></div>
                  {g.linhas.map((t) => {
                    const passo = passoLabelDe(t)
                    const terceiro = t.estadoOperacao === "AGUARDANDO"
                    return (
                      <div key={t.taskId} className="opv3-row opv3-gC">
                        <div style={{ fontWeight: 600 }}>{t.titulo}<div style={{ fontSize: 11, color: "#7a8296", fontWeight: 500 }}>{t.familiaNome} · {t.pessoaNome}</div></div>
                        <div>{passo.label}<div style={{ fontSize: 11, color: "#7a8296" }}>{terceiro ? "espera de terceiro" : "ação interna"}</div></div>
                        <div>{orgaoTxt(t)}</div>
                        <div><span className={`opv3-pill ${relCls(t.acompanhamentoPasso)}`}>{acompTxtCompleto(t.acompanhamentoPasso)}</span></div>
                        <div>{cobrancasTxt(t)}</div>
                        <div><span className={`opv3-pill ${prazoTarefaCls(t)}`}>{t.rotuloDoPrazo}</span></div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {terceiro && t.acompanhamentoVencido && <button className="opv3-btn opv3-sm opv3-acc" onClick={() => onCobrar(t.taskId)}>Cobrar</button>}
                          <button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>{concluirLabelDe(t)}</button>
                          <button className="opv3-btn opv3-sm" onClick={() => onAdiar(t.taskId)}>Adiar +3 d</button>
                          <button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>Abrir</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ============================================================================
// FAMÍLIAS
// ============================================================================
const ESTAGIOS: Array<{ chave: string; label: string; pred: (l: LinhaOperacaoV3) => boolean; cor: string }> = [
  { chave: "iniciar", label: "A iniciar", pred: (l) => l.aIniciar, cor: "#141a2b" },
  { chave: "cartorio", label: "Com o cartório", pred: (l) => l.estadoOperacao === "AGUARDANDO", cor: "#141a2b" },
  { chave: "conferir", label: "A conferir", pred: (l) => l.estadoOperacao === "FILA" && !l.aIniciar, cor: "#141a2b" },
  { chave: "concluidas", label: "Concluídas", pred: (l) => l.estadoOperacao === "CONCLUIDA", cor: "#155e39" },
  { chave: "atrasadas", label: "Atrasadas", pred: (l) => l.atrasada && l.estadoOperacao !== "CONCLUIDA", cor: "#8f1d17" },
  { chave: "vencidos", label: "Acomp. vencidos", pred: (l) => l.acompanhamentoVencido && l.estadoOperacao !== "CONCLUIDA", cor: "#7a4a00" },
]

export function AbaFamilias({
  abertos, feito, famOpen, setFamOpen, famUltimo, setFamUltimo, onAbrir, onNaoLigado,
}: {
  abertos: LinhaOperacaoV3[]
  feito: LinhaOperacaoV3[]
  famOpen: { fam: string; estagio: string } | null
  setFamOpen: (v: { fam: string; estagio: string } | null) => void
  famUltimo: Record<string, string>
  setFamUltimo: (f: Record<string, string>) => void
  onAbrir: (id: number) => void
  onNaoLigado: () => void
}) {
  const todas = useMemo(() => [...abertos, ...feito], [abertos, feito])
  const familias = useMemo(() => {
    const nomes = [...new Set(todas.map((l) => l.familiaNome ?? "—"))]
    return nomes.map((nome) => {
      const ts = todas.filter((l) => (l.familiaNome ?? "—") === nome)
      const abertosDaFam = abertos.filter((l) => (l.familiaNome ?? "—") === nome)
      const escaladaPorOrgao = new Map<string, number>()
      for (const l of abertosDaFam) if (l.escalada && l.terceiroNome) escaladaPorOrgao.set(l.terceiroNome, (escaladaPorOrgao.get(l.terceiroNome) ?? 0) + 1)
      const gargaloEntry = [...escaladaPorOrgao.entries()].sort((a, b) => b[1] - a[1])[0]
      const semOrgao = abertosDaFam.filter((l) => l.aIniciar && !l.terceiroNome).length
      const gargalo = gargaloEntry ? `${gargaloEntry[0]} (escalada)` : semOrgao > 0 ? "órgão emissor não vinculado" : "—"
      return { nome, ts, pais: ts[0]?.pais ?? "—", fase: ts[0]?.faseMacroKey ?? "—", gargalo }
    })
  }, [todas, abertos])

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#0b1f4b" }}>Como está cada processo</div>
      {familias.map((f) => {
        const aberto = famOpen?.fam === f.nome ? ESTAGIOS.find((e) => e.chave === famOpen.estagio) : null
        const cards = ESTAGIOS.map((e) => ({ ...e, rows: f.ts.filter(e.pred) }))
        const inicial = f.nome.slice(0, 1).toUpperCase()
        return (
          <div key={f.nome} className="opv3-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, borderLeft: `4px solid ${aberto ? "#c9622b" : "#1d3f8f"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ width: 38, height: 38, borderRadius: 999, background: "#0b1f4b", color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{inicial}</div>
              <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{f.nome}</div><div style={{ fontSize: 12, color: "#5b6478" }}>{f.pais} · {f.ts.length} tarefa(s)</div></div>
              <div style={{ flexGrow: 1 }} />
              <span className="opv3-pill opv3-p-blu">{f.fase}</span>
              <button className="opv3-btn" onClick={() => { const ultimo = famUltimo[f.nome] ?? "iniciar"; const abrindo = famOpen?.fam !== f.nome; setFamOpen(abrindo ? { fam: f.nome, estagio: ultimo } : null) }}>
                {famOpen?.fam === f.nome ? "Recolher ▴" : "Expandir ▾"}
              </button>
              <button className="opv3-btn" onClick={onNaoLigado}>Abrir processo</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
              {cards.map((c) => {
                const op = famOpen?.fam === f.nome && famOpen.estagio === c.chave
                return (
                  <button key={c.chave} onClick={() => { setFamOpen(op ? null : { fam: f.nome, estagio: c.chave }); setFamUltimo({ ...famUltimo, [f.nome]: c.chave }) }}
                    className="opv3-btn" style={{ border: `1px solid ${op ? "#c9622b" : "#dfe4ee"}`, background: op ? "#fff8f3" : "#fff", borderRadius: 10, padding: 10, textAlign: "left", display: "flex", flexDirection: "column", gap: 2, minHeight: 60 }}>
                    <div style={{ fontSize: 11, color: "#7a8296", textTransform: "uppercase", fontWeight: 600, display: "flex", justifyContent: "space-between", width: "100%" }}>
                      <span>{c.label}</span><span>{op ? "▴ ocultar" : "▾ ver"}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: c.cor }}>{c.rows.length}</div>
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 12, color: "#5b6478" }}>Gargalo: <b>{f.gargalo}</b> · Próximo marco: <b>Análise documental</b></div>
            {aberto && (
              <div style={{ border: "1px solid #dfe4ee", borderRadius: 10, overflow: "hidden" }}>
                <div className="opv3-grp" style={{ borderTop: 0 }}>
                  <b>{aberto.label}</b><span style={{ color: "#5b6478" }}>{cards.find((c) => c.chave === aberto.chave)?.rows.length ?? 0} tarefa(s) · mesma linha e mesmo painel da Fila</span>
                  <div style={{ flexGrow: 1 }} />
                  <button className="opv3-btn opv3-sm" onClick={() => setFamOpen(null)}>Recolher ▴</button>
                </div>
                <div className="opv3-hd" style={{ gridTemplateColumns: "1.5fr 1.1fr 1fr 1fr 0.9fr 0.8fr 120px" }}><span>Documento</span><span>Pessoa</span><span>Passo atual</span><span>Acompanhamento</span><span>Prazo da tarefa</span><span>Órgão</span><span>Ação</span></div>
                {(cards.find((c) => c.chave === aberto.chave)?.rows.length ?? 0) === 0 && (
                  <div style={{ padding: 20, textAlign: "center", color: "#5b6478", fontSize: 12 }}>Nenhuma tarefa neste estágio.</div>
                )}
                {cards.find((c) => c.chave === aberto.chave)?.rows.map((t) => {
                  const passo = passoLabelDe(t)
                  return (
                    <div key={t.taskId} className="opv3-row" style={{ gridTemplateColumns: "1.5fr 1.1fr 1fr 1fr 0.9fr 0.8fr 120px", boxShadow: `inset 4px 0 0 ${t.atrasada ? "#b3261e" : "transparent"}` }}>
                      <div style={{ fontWeight: 600 }}>{t.titulo}<div style={{ fontSize: 11, color: "#7a8296", fontWeight: 500 }}>{t.familiaNome} · {t.pais}</div></div>
                      <div>{t.pessoaNome ?? "—"}<div style={{ fontSize: 11, color: "#7a8296" }}>{t.numeroLinhagem != null ? `G${t.numeroLinhagem}` : ""}</div></div>
                      <div>{passo.label}<div style={{ fontSize: 11, color: "#7a8296" }}>{passo.sub}</div></div>
                      <div><span className={`opv3-pill ${relCls(t.acompanhamentoPasso)}`}>{acompTxtCompleto(t.acompanhamentoPasso)}</span></div>
                      <div><span className={`opv3-pill ${prazoTarefaCls(t)}`}>{t.rotuloDoPrazo}</span></div>
                      <div><span className="opv3-pill opv3-p-gry">{orgaoTxt(t)}</span></div>
                      <div><button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>Abrir</button></div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ============================================================================
// RADAR
// ============================================================================
export function AbaRadar({
  atras, acompVenc, decis, noOrg, genOpen, onKAtras, onGoAcomp, onKEsc, onNoOrg, onFaseAnterior, onNaoLigado,
}: {
  atras: LinhaOperacaoV3[]
  acompVenc: LinhaOperacaoV3[]
  decis: LinhaOperacaoV3[]
  noOrg: LinhaOperacaoV3[]
  genOpen: LinhaOperacaoV3[]
  onKAtras: () => void
  onGoAcomp: () => void
  onKEsc: () => void
  onNoOrg: () => void
  onFaseAnterior: () => void
  onNaoLigado: () => void
}) {
  const cor = (n: number) => (n > 0 ? "#b3261e" : "#1f7a4d")
  const cls = (n: number) => (n > 0 ? "opv3-p-red" : "opv3-p-grn")
  const primeiro = genOpen[0]
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#0b1f4b" }}>Só o que está errado — clique para abrir a lista</div>
        <span style={{ fontSize: 12, color: "#5b6478" }}>Vazio é bom sinal.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <button className="opv3-radar" style={{ borderLeftColor: cor(atras.length) }} onClick={onKAtras}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Tarefas atrasadas</b><span className={`opv3-pill ${cls(atras.length)}`}>{atras.length}</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>passou o prazo da tarefa (10 dias do cartório) — falha de entrega</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: cor(acompVenc.length) }} onClick={onGoAcomp}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Acompanhamentos vencidos</b><span className={`opv3-pill ${cls(acompVenc.length)}`}>{acompVenc.length}</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>despertador tocou e ninguém agiu — controle, não atraso</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: cor(decis.length) }} onClick={onKEsc}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Escaladas ao gestor</b><span className={`opv3-pill ${cls(decis.length)}`}>{decis.length}</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>2 cobranças sem resposta</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: cor(noOrg.length) }} onClick={onNoOrg}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Sem órgão emissor</b><span className={`opv3-pill ${cls(noOrg.length)}`}>{noOrg.length}</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>não dá pra iniciar sem destino</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: cor(genOpen.length) }} onClick={onFaseAnterior}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Pendência de fase anterior</b><span className={`opv3-pill ${cls(genOpen.length)}`}>{genOpen.length}</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>{primeiro ? `${primeiro.familiaNome} · ${primeiro.titulo} · ${primeiro.pessoaNome} · trava a família` : "nenhuma"}</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: "#1f7a4d" }} onClick={onNaoLigado}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Dados inconsistentes</b><span className="opv3-pill opv3-p-grn">0</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>sem checagem automática ainda — 0 por definição</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: "#1f7a4d" }} onClick={onNaoLigado}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Sem responsável</b><span className="opv3-pill opv3-p-grn">0</span></div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: "#1f7a4d" }} onClick={onNaoLigado}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Anexo faltando</b><span className="opv3-pill opv3-p-grn">0</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>recebida sem arquivo — sem checagem automática ainda</div>
        </button>
        <button className="opv3-radar" style={{ borderLeftColor: "#1f7a4d" }} onClick={onNaoLigado}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>Erro do sistema</b><span className="opv3-pill opv3-p-grn">0</span></div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>ex.: lista não carregou (500)</div>
        </button>
      </div>
    </>
  )
}

// ============================================================================
// FEITO
// ============================================================================
export function AbaFeito({ linhas, col, setCol, onAbrir }: {
  linhas: LinhaOperacaoV3[]
  col: Record<string, true>
  setCol: (c: Record<string, true>) => void
  onAbrir: (id: number) => void
}) {
  const [hojeStr, ontemStr] = useMemo(() => {
    const agora = new Date()
    return [agora.toDateString(), new Date(agora.getTime() - 86_400_000).toDateString()]
  }, [])
  const hoje = linhas.filter((l) => l.concluidaEm && new Date(l.concluidaEm).toDateString() === hojeStr)
  const ontem = linhas.filter((l) => l.concluidaEm && new Date(l.concluidaEm).toDateString() === ontemStr)
  const antes = linhas.filter((l) => !hoje.includes(l) && !ontem.includes(l))
  const enviadasHoje = linhas.filter((l) => l.criadaEm && new Date(l.criadaEm).toDateString() === hojeStr).length
  const blocos = [
    { title: "Hoje", rows: hoje }, { title: "Ontem", rows: ontem }, { title: "Antes", rows: antes },
  ].filter((b) => b.rows.length > 0)

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#0b1f4b" }}>O que andou</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="opv3-kpi"><b>{hoje.length}</b><span>Concluídas hoje</span></div>
        <div className="opv3-kpi"><b>{ontem.length}</b><span>Ontem</span></div>
        <div className="opv3-kpi"><b>{linhas.length}</b><span>Esta semana</span></div>
        <div className="opv3-kpi"><b>{enviadasHoje}</b><span>Enviadas hoje</span></div>
      </div>
      {blocos.map((b) => (
        <div key={b.title} style={{ marginTop: 6 }}>
          <div className="opv3-blk" style={{ borderTop: 0, padding: "6px 4px" }}><span>{b.title}</span><span className="opv3-pill opv3-p-grn">{b.rows.length} concluída(s)</span></div>
          {agruparPorFamilia(b.rows).map((g) => (
            <div key={g.fam} className="opv3-card" style={{ borderLeft: "4px solid #0b1f4b", marginTop: 10, paddingBottom: 12, boxShadow: "0 2px 8px rgba(11,31,75,.06)" }}>
              <div className="opv3-grp" style={{ borderTop: 0, borderRadius: "12px 12px 0 0", background: "#e3e8f2", padding: "13px 16px" }}>
                <button className="opv3-btn opv3-sm" onClick={() => toggle(col, setCol, `fe|${b.title}|${g.fam}`)} aria-label="Expandir ou recolher família" style={{ minWidth: 32 }}>{col[`fe|${b.title}|${g.fam}`] ? "▸" : "▾"}</button>
                <span className="opv3-pill opv3-p-gry">Família</span><b style={{ fontSize: 12.5 }}>{g.fam}</b><span style={{ color: "#5b6478" }}>{g.pais} · {g.linhas.length} tarefa(s)</span>
              </div>
              {!col[`fe|${b.title}|${g.fam}`] && (
                <div style={{ margin: "12px 12px 0", border: "1px solid #dfe4ee", borderRadius: 10, overflow: "hidden" }}>
                  <div className="opv3-hd" style={{ gridTemplateColumns: "1.5fr 1.1fr 1.3fr 0.9fr 0.8fr 120px" }}><span>Documento</span><span>Pessoa</span><span>Concluída em</span><span>Prazo da tarefa</span><span>Órgão</span><span>Ação</span></div>
                  {g.linhas.map((t) => (
                    <div key={t.taskId} className="opv3-row" style={{ gridTemplateColumns: "1.5fr 1.1fr 1.3fr 0.9fr 0.8fr 120px" }}>
                      <div style={{ fontWeight: 600 }}>{t.titulo}<div style={{ fontSize: 11, color: "#7a8296", fontWeight: 500 }}>{t.familiaNome} · {t.pais}</div></div>
                      <div>{t.pessoaNome ?? "—"}<div style={{ fontSize: 11, color: "#7a8296" }}>{t.numeroLinhagem != null ? `G${t.numeroLinhagem}` : ""}</div></div>
                      <div><span className="opv3-pill opv3-p-grn">{fmtData(t.concluidaEm)}</span></div>
                      <div><span className={`opv3-pill ${prazoTarefaCls(t)}`}>{t.rotuloDoPrazo}</span></div>
                      <div><span className="opv3-pill opv3-p-gry">{orgaoTxt(t)}</span></div>
                      <div><button className="opv3-btn opv3-sm" onClick={() => onAbrir(t.taskId)}>Abrir</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="opv3-card">
        <div className="opv3-blk" style={{ borderTop: 0 }}><span>Eventos do processo</span><span style={{ fontSize: 12, color: "#7a8296", fontWeight: 500 }}>não são tarefas — mudanças de fase e atribuições</span></div>
        <div style={{ padding: 20, textAlign: "center", color: "#5b6478", fontSize: 12 }}>Sem eventos recentes.</div>
      </div>
    </>
  )
}
