"use client"
// src/components/torre/FocoFamilia.tsx — FOCO DA FAMÍLIA (Bloco I3). Só leitura das fontes existentes:
// /api/torre/foco/{processoId}; comentários em /api/comentarios (E4); relatório no motor de Relatórios.
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import { useCallback, useEffect, useState } from "react"
import { docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { LAYER } from "@/src/lib/ui/layers"
import { api, erroDe, fmtDataHora, useTorre } from "./torre-base"
import { bolaDe, type LinhaTorre } from "./tipos"
import { RelatorioControle } from "./RelatorioControle"

interface Foco {
  processoId: number; familiaId: number | null; familiaNome: string; pais: string | null; codigo: string | null
  faseAtual: { label: string | null; dias: number | null; horas: number | null; desde: string | null; origem: string | null }
  certidoes: { recebidas: number; requeridas: number }
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  tarefas: LinhaTorre[]
  linhaDoTempo: Array<{ id: string; quando: string; tipo: "AUDITORIA" | "FASE" | "CONTATO"; autor: string | null; titulo: string; texto: string | null }>
}
interface Comentario { id: number; texto: string; autorNome: string; criadoEm: string }
const TIPO = { AUDITORIA: "Auditoria", FASE: "Fase", CONTATO: "Contato" } as const

function comMencoes(texto: string) {
  const partes: Array<string | { nome: string }> = []
  let ultimo = 0
  for (const m of texto.matchAll(/@\[([^\]]+)\]\(\d+\)/g)) {
    partes.push(texto.slice(ultimo, m.index)); partes.push({ nome: m[1] }); ultimo = (m.index ?? 0) + m[0].length
  }
  partes.push(texto.slice(ultimo))
  return partes.map((p, i) => (typeof p === "string" ? p : <span key={i} className="tor-mention">@{p.nome}</span>))
}

export function FocoFamilia({ processoId, onFechar }: { processoId: number; onFechar: () => void }) {
  const { permissoes } = useTorre()
  const { pode } = usePermissoes()
  const [foco, setFoco] = useState<Foco | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [comentarios, setComentarios] = useState<Comentario[] | null>(null)
  const [texto, setTexto] = useState("")
  const [pessoas, setPessoas] = useState<Array<{ id: number; nome: string }>>([])
  const [enviando, setEnviando] = useState(false)
  const [relatorio, setRelatorio] = useState(false)
  const { avisar } = useTorre()

  useEffect(() => {
    let vivo = true
    void api<Foco>(`/api/torre/foco/${processoId}`).then((r) => { if (!vivo) return; if (r.ok) setFoco(r.data); else setErro(erroDe(r.data, "Não foi possível abrir o foco.")) })
    return () => { vivo = false }
  }, [processoId])
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && !relatorio) onFechar() }
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f)
  }, [onFechar, relatorio])

  const familiaId = foco?.familiaId ?? null
  const carregarComentarios = useCallback(async () => {
    if (familiaId == null) return
    const r = await api<{ comentarios: Comentario[] }>(`/api/comentarios?familiaId=${familiaId}`)
    if (r.ok) setComentarios(r.data.comentarios); else avisar(erroDe(r.data))
  }, [familiaId, avisar])
  useEffect(() => {
    if (familiaId == null) return
    let vivo = true
    void api<{ comentarios: Comentario[] }>(`/api/comentarios?familiaId=${familiaId}`).then((r) => { if (vivo && r.ok) setComentarios(r.data.comentarios) })
    return () => { vivo = false }
  }, [familiaId])
  useEffect(() => {
    if (!permissoes?.editar) return
    void api<{ funcionarios: Array<{ id: number; nome: string }> }>("/api/operacao/atribuiveis").then((r) => { if (r.ok) setPessoas(r.data.funcionarios ?? []) })
  }, [permissoes?.editar])

  const comentar = async () => {
    setEnviando(true)
    const r = await api("/api/comentarios", "POST", { familiaId, texto })
    setEnviando(false)
    if (r.ok) { setTexto(""); avisar("Comentário registrado."); void carregarComentarios() } else avisar(erroDe(r.data))
  }

  return (
    <div className="tor-modal-g" style={{ zIndex: LAYER.popover }} onClick={onFechar}>
      <div role="dialog" aria-label="Foco da família" className="tor" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            {foco ? (
              <>
                <h2 className="font-extrabold" style={{ fontSize: 18 }}>{foco.familiaNome} · {foco.pais ?? "—"} · {foco.codigo ?? "—"}</h2>
                <div>{foco.faseAtual.label ?? "—"} · {foco.certidoes.recebidas} de {foco.certidoes.requeridas} certidões recebidas
                  <span className="small"> · {foco.faseAtual.desde ? `na fase há ${textoTempoNaFase(foco.faseAtual)}` : "sem registro de quando entrou na fase"}</span></div>
              </>
            ) : <h2 className="font-extrabold" style={{ fontSize: 18 }}>Foco da família</h2>}
          </div>
          {foco && pode("relatorios.ver") && <button className="tor-btn pri" onClick={() => setRelatorio(true)}>Relatório de controle</button>}
          <button className="tor-btn" onClick={onFechar}>Fechar</button>
        </div>
        {erro && <div className="tor-card pad mt-3">{erro}</div>}
        {!erro && !foco && <div className="small mt-3">Carregando…</div>}
        {foco && (
          <>
            <div className="tor-num">
              {([["Abertas", foco.numeros.abertas], ["Vencidas", foco.numeros.vencidas], ["Com o cartório", foco.numeros.comCartorio], ["Sem responsável", foco.numeros.semResponsavel]] as const).map(([r, n]) => (
                <div key={r}><b>{n}</b><span>{r}</span></div>
              ))}
            </div>
            <div className="tor-card tor-scroll">
              <div className="tor-hd tor-gF"><span>Certidão</span><span>Cartório</span><span>Bola com</span><span>Prazo</span><span>Responsável</span></div>
              {foco.tarefas.length === 0 && <div className="p-4 small">Nenhuma tarefa aberta nesta família.</div>}
              {foco.tarefas.map((l) => { const b = bolaDe(l); return (
                <div key={l.taskId} className="tor-row tor-gF">
                  <div><b>{docTipoTxt(l)}</b><div className="small">{l.pessoaNome ?? l.casalNomes ?? "—"} · #{l.taskId}</div></div>
                  <div className="small">{l.terceiroNome ?? "—"}</div>
                  <div><span className={`tor-p ${b.cls}`}>{b.txt}</span></div>
                  <div className="small">{l.rotuloDoPrazo || "—"}</div>
                  <div className="small">{l.responsavelNome ?? "sem responsável"}</div>
                </div>
              ) })}
            </div>
            <h3 className="font-extrabold mt-3">Linha do tempo</h3>
            {foco.linhaDoTempo.length === 0 ? <div className="small">Nada registrado ainda para esta família.</div> : (
              <ul className="space-y-1.5 mt-1">{foco.linhaDoTempo.map((e) => (
                <li key={e.id} className="border-b border-[var(--border-default)] pb-1.5">
                  <div><span className="tor-p gry">{TIPO[e.tipo]}</span> <b>{e.titulo}</b> <span className="small">· {fmtDataHora(e.quando)}{e.autor ? ` · ${e.autor}` : ""}</span></div>
                  {e.texto && <div className="small">{e.texto}</div>}
                </li>
              ))}</ul>
            )}
            <h3 className="font-extrabold mt-4">Comentários</h3>
            {familiaId == null ? <div className="small">Processo sem família cadastrada — comentário indisponível.</div> : (
              <>
                {permissoes?.editar && (
                  <div className="space-y-2 my-2">
                    <textarea className="tor-in w-full" rows={3} aria-label="Novo comentário" placeholder="Escreva um comentário; use Mencionar para citar alguém." value={texto} onChange={(e) => setTexto(e.target.value)} />
                    <div className="flex gap-2 items-center">
                      <select className="tor-in" aria-label="Mencionar" value="" onChange={(e) => { const p = pessoas.find((x) => x.id === Number(e.target.value)); if (p) setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@[${p.nome}](${p.id}) `) }}>
                        <option value="">Mencionar…</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                      <button className="tor-btn pri" disabled={enviando || !texto.trim()} onClick={() => void comentar()}>{enviando ? "Enviando…" : "Comentar"}</button>
                    </div>
                  </div>
                )}
                {comentarios == null ? <div className="small">Carregando comentários…</div> : comentarios.length === 0 ? <div className="small">Nenhum comentário ainda.</div> : (
                  <ul className="space-y-1.5">{comentarios.map((c) => (
                    <li key={c.id} className="border-b border-[var(--border-default)] pb-1.5"><div className="small"><b>{c.autorNome}</b> · {fmtDataHora(c.criadoEm)}</div><div>{comMencoes(c.texto)}</div></li>
                  ))}</ul>
                )}
              </>
            )}
          </>
        )}
        {relatorio && foco && (
          <RelatorioControle processoId={foco.processoId} processoRotulo={foco.codigo ?? foco.familiaNome} familiaId={foco.familiaId} familiaNome={foco.familiaNome} onFechar={() => setRelatorio(false)} />
        )}
      </div>
    </div>
  )
}
