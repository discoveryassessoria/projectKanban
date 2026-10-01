"use client"
// src/components/torre/ProcessoComentarios.tsx — "Comentários da família · N" do Detalhe do Processo, com @menção.
//   • Lê e grava em /api/comentarios (âncora = a FAMÍLIA, `comentario-tarefa.ts`); o comentário entra no histórico da família.
//   • Quem é @mencionado recebe aviso no SINO (tipo MENCAO) e no RESUMO DIÁRIO — a entrega é do servidor (`criarComentario`).
//   • Ao abrir esta página, as menções do usuário a este processo são marcadas como lidas (PATCH /api/comentarios/mencoes { processoId }).
//   • Processo SEM família (ex.: um processo avulso) não tem âncora de comentário de família: o bloco diz isso, sem erro, e NÃO cria família.
import { useCallback, useEffect, useRef, useState } from "react"
import { iniciaisDe, pedacosDoComentario, resolverMencoes, rotuloQuando, type PessoaMencionavel } from "@/lib/operacional/torre-processo-puro"
import { api, erroDe } from "./torre-base"

interface Comentario { id: number; texto: string; autorId: number; autorNome: string; criadoEm: string }

export function ProcessoComentarios({ processoId, familiaId, agora, podeComentar, avisar }: {
  processoId: number; familiaId: number | null; agora: Date; podeComentar: boolean; avisar: (msg: string) => void
}) {
  const [comentarios, setComentarios] = useState<Comentario[] | null>(null)
  const [equipe, setEquipe] = useState<PessoaMencionavel[]>([])
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const ancora = useRef<HTMLDivElement | null>(null)

  const carregar = useCallback(async () => {
    if (familiaId == null) return
    const r = await api<{ comentarios: Comentario[] }>(`/api/comentarios?familiaId=${familiaId}`)
    // O servidor devolve o mais recente primeiro; a conversa lê-se do mais antigo para o mais novo (como no protótipo).
    if (r.ok) setComentarios([...r.data.comentarios].sort((a, b) => Date.parse(a.criadoEm) - Date.parse(b.criadoEm) || a.id - b.id))
    else avisar(erroDe(r.data, "Não foi possível ler os comentários."))
  }, [familiaId, avisar])

  useEffect(() => {
    if (familiaId == null) return
    let vivo = true
    void api<{ comentarios: Comentario[] }>(`/api/comentarios?familiaId=${familiaId}`).then((r) => {
      if (vivo && r.ok) setComentarios([...r.data.comentarios].sort((a, b) => Date.parse(a.criadoEm) - Date.parse(b.criadoEm) || a.id - b.id))
    })
    return () => { vivo = false }
  }, [familiaId])
  useEffect(() => {
    if (!podeComentar) return
    void api<{ funcionarios: PessoaMencionavel[] }>("/api/operacao/atribuiveis").then((r) => { if (r.ok) setEquipe((r.data.funcionarios ?? []).map((f) => ({ id: f.id, nome: f.nome }))) })
  }, [podeComentar])
  // Abrir o processo lê as menções feitas a você nele.
  useEffect(() => { void api("/api/comentarios/mencoes", "PATCH", { processoId }) }, [processoId])
  // Link do sino: /torre/processo/{id}#comentarios leva ao bloco.
  useEffect(() => {
    if (comentarios != null && typeof window !== "undefined" && window.location.hash === "#comentarios") ancora.current?.scrollIntoView({ block: "start" })
  }, [comentarios])

  const comentar = async () => {
    const { texto: gravado } = resolverMencoes(texto, equipe)
    setEnviando(true)
    const r = await api<{ comentario?: Comentario }>("/api/comentarios", "POST", { familiaId, processoId, texto: gravado })
    setEnviando(false)
    if (r.ok) { setTexto(""); await carregar() } else avisar(erroDe(r.data, "Não foi possível registrar o comentário."))
  }

  return (
    <div className="tpr-bloco" id="comentarios" ref={ancora} style={{ padding: "14px 18px", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>Comentários da família · {familiaId == null ? "—" : comentarios?.length ?? "…"}</div>
      {familiaId == null && (
        <div className="tpr-13 tpr-mut">Este processo não tem família cadastrada — os comentários e as menções da família não se aplicam a ele. Cadastre a família no processo para abrir a conversa.</div>
      )}
      {familiaId != null && comentarios == null && <div className="tpr-13 tpr-mut">Carregando comentários…</div>}
      {familiaId != null && comentarios?.length === 0 && <div className="tpr-13 tpr-mut">Nenhum comentário ainda.</div>}
      {(comentarios ?? []).map((c) => (
        <div key={c.id} className="tpr-com" data-comentario={c.id}>
          <div className="av" aria-hidden>{iniciaisDe(c.autorNome)}</div>
          <div className="corpo">
            <div><b style={{ fontWeight: 600 }}>{c.autorNome}</b> <span className="tpr-mut">· {rotuloQuando(c.criadoEm, agora, true)}</span></div>
            <div>{pedacosDoComentario(c.texto).map((p, i) => p.tipo === "mencao" ? <span key={i} className="tpr-mencao">{p.valor}</span> : <span key={i}>{p.valor}</span>)}</div>
          </div>
        </div>
      ))}
      {familiaId != null && (
        <div className="tpr-novo">
          <input type="text" aria-label="Novo comentário" placeholder="Escreva um comentário… use @ para mencionar alguém da equipe" value={texto}
            disabled={!podeComentar} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && texto.trim() && !enviando) { e.preventDefault(); void comentar() } }} />
          <select aria-label="Mencionar" value="" disabled={!podeComentar}
            onChange={(e) => { const p = equipe.find((x) => x.id === Number(e.target.value)); if (p) setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${p.nome} `) }}>
            <option value="">Mencionar…</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>@{p.nome}</option>)}
          </select>
          <button type="button" disabled={!podeComentar || enviando || !texto.trim()} onClick={() => void comentar()} title={podeComentar ? undefined : "Seu perfil não comenta em tarefas."}>{enviando ? "Enviando…" : "Comentar"}</button>
        </div>
      )}
      <div className="tpr-12 tpr-mut">Quem é mencionado recebe aviso no sino e no resumo diário. O comentário fica no histórico da família.</div>
    </div>
  )
}
