"use client"
// src/components/torre/TarefasGaveta.tsx — a GAVETA lateral da tarefa (560 px) e o MODO FOCO (Torre nova, igual ao protótipo).
// Abre ao clicar no nome da certidão; fecha com ✕ ou clicando no fundo. De cima para baixo: (só no foco) a barra "Modo foco · i de N" com
// o progresso e ← Anterior / Próxima →; "{família} · {fase}", a certidão e a pessoa; a grade Bola com / Status / Prazo da tarefa /
// Próxima cobrança / Responsável / Iniciou em; "Passos desta certidão" (os passos REAIS da certidão: feito / agora); "Ações" (a primária
// da linha + Repactuar prazo · Bloquear com motivo · Reabrir passo · Adiar · Registrar ligação · Trocar canal); o histórico REAL da
// certidão; e "Abrir o processo inteiro ›". Nada de passo ou fato de exemplo: sem registro, a gaveta diz isso.
import Link from "next/link"
import { useEffect, useState } from "react"
import { passosDaGaveta, textoDaBola, textoDoCobrar, textoDoIniciou, type AcaoDaLinha } from "@/lib/operacional/torre-tarefas-tela"
import { statusTarefaTxt, docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import { rotularFase } from "@/src/components/operacao/kit-operacional"
import { textoPrazoDaTarefa } from "@/src/lib/tarefa/texto-prazo"
import { api, useEscFecha, useTorre } from "./torre-base"
import type { AcaoComModal, DadosDaGaveta, LinhaDaTela } from "./tarefas-tipos"
import { ehCancelada } from "./tarefas-tipos"

const SECUNDARIAS: Array<[AcaoComModal, string]> = [
  ["repactuar", "Repactuar prazo"], ["bloquear", "Bloquear com motivo"], ["reabrir", "Reabrir passo"], ["adiar", "Adiar"], ["ligacao", "Registrar ligação"], ["canal", "Trocar canal"],
]

export interface FocoDaGaveta { pos: number; total: number; onAnterior: () => void; onProxima: () => void }

export function TarefasGaveta({ linha, agora, foco, acoes, onFechar, onAcaoPrimaria, onAcaoComModal }: {
  linha: LinhaDaTela; agora: Date; foco: FocoDaGaveta | null
  /** Os dois botões da linha: o 1º é o primário da gaveta. */
  acoes: AcaoDaLinha[]
  onFechar: () => void
  onAcaoPrimaria: (acao: AcaoDaLinha) => void
  onAcaoComModal: (acao: AcaoComModal) => void
}) {
  const { permissoes } = useTorre()
  // Esc fecha a gaveta (T015) — só quando ela é o único painel aberto (um modal de justificativa por cima nunca fecha por Esc).
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && document.querySelectorAll("[role=dialog]").length <= 1) onFechar() }
    window.addEventListener("keydown", f)
    return () => window.removeEventListener("keydown", f)
  }, [onFechar])
  const [dados, setDados] = useState<{ id: number; d: DadosDaGaveta | null; erro: boolean } | null>(null)
  useEffect(() => {
    let vivo = true
    void api<DadosDaGaveta>(`/api/torre/tarefas/${linha.taskId}/gaveta`).then((r) => { if (vivo) setDados({ id: linha.taskId, d: r.ok ? r.data : null, erro: !r.ok }) })
    return () => { vivo = false }
  }, [linha.taskId])
  const carregado = dados?.id === linha.taskId ? dados : null

  const bola = textoDaBola(linha, agora)
  const cobrar = textoDoCobrar(linha.cobrarEm, agora)
  const cancelada = ehCancelada(linha)
  const fase = rotularFase(linha.faseMacroKey) ?? linha.faseAtualDoProcessoLabel ?? "—"
  const passos = carregado?.d ? passosDaGaveta(carregado.d.etapas) : []
  const podeEditar = !!permissoes?.editar
  const permitida = (a: AcaoComModal): boolean => (a === "bloquear" ? !!permissoes?.bloquear : a === "ligacao" ? true : podeEditar)

  return (
    <>
      <div className="tf-fundo" onClick={onFechar} />
      <aside className="tf-gaveta tor" role="dialog" aria-label="Painel da tarefa" aria-modal="true">
        {foco && (
          <div className="tf-foco-barra" role="toolbar" aria-label="Modo foco">
            <b>Modo foco · {foco.pos} de {foco.total}</b>
            <div className="trilho"><i style={{ width: `${Math.round((foco.pos / Math.max(foco.total, 1)) * 100)}%` }} /></div>
            <button type="button" onClick={foco.onAnterior} disabled={foco.pos <= 1}>← Anterior</button>
            <button type="button" className="claro" onClick={foco.onProxima} disabled={foco.pos >= foco.total}>Próxima →</button>
          </div>
        )}
        <div className="tf-g-topo">
          <div className="t">
            <div className="fase">{linha.familiaNome ?? linha.processoNome ?? "—"} · {fase}</div>
            <div className="cert">{docTipoTxt(linha)}</div>
            <div className="pessoa">{linha.pessoaNome ?? linha.casalNomes ?? "—"}</div>
          </div>
          <button type="button" className="tf-x" aria-label="Fechar" onClick={onFechar}>✕</button>
        </div>

        <div className="tf-grade">
          <div><span className="k">Aguardando</span><span className="v">{cancelada ? "—" : bola.texto}</span></div>
          <div><span className="k">Status</span><span className="v">{statusTarefaTxt(linha)}</span></div>
          <div><span className="k">Prazo da tarefa</span><span className={`v ${linha.atrasada && !cancelada ? "tf-verm" : ""}`}>{cancelada ? "—" : textoPrazoDaTarefa(linha) || "—"}</span></div>
          <div><span className="k">Próxima cobrança</span><span className="v">{cancelada || !cobrar ? "—" : cobrar.texto}</span></div>
          <div><span className="k">Responsável</span><span className={`v ${linha.responsavelId == null && !cancelada ? "tf-verm" : ""}`}>{linha.responsavelNome ?? (cancelada ? "—" : "Sem responsável")}</span></div>
          <div><span className="k">Iniciou em</span><span className="v">{cancelada ? "—" : textoDoIniciou(linha)}</span></div>
        </div>

        <div className="tf-sec">
          <div className="tf-sec-t">Passos desta certidão</div>
          {!carregado && <span className="tf-vazio">Carregando os passos…</span>}
          {carregado?.erro && <span className="tf-vazio">Não foi possível carregar os passos.</span>}
          {carregado?.d && passos.length === 0 && <span className="tf-vazio">Nenhum passo materializado para esta certidão.</span>}
          {passos.map((p) => (
            <div key={p.n} className={`tf-passo ${p.estado}`}>
              <span className="bol">{p.n}</span><span className="nm">{p.nome}</span>
              <span className="q">{p.estado === "feito" ? "feito" : p.estado === "agora" ? "agora" : ""}</span>
            </div>
          ))}
        </div>

        <div className="tf-sec">
          <div className="tf-sec-t">Ações</div>
          <div className="tf-g-acoes">
            {acoes[0] && <button type="button" className="pri" onClick={() => onAcaoPrimaria(acoes[0])}>{acoes[0]}</button>}
            {SECUNDARIAS.map(([a, nome]) => (
              <button key={a} type="button" disabled={!permitida(a)} title={permitida(a) ? undefined : "Sem permissão para esta ação"} onClick={() => onAcaoComModal(a)}>{nome}</button>
            ))}
          </div>
          <div className="tf-peq">Bloquear pede motivo e o prazo continua contando. Reabrir passo pede justificativa. Tudo vai para o histórico e tem &quot;Desfazer&quot;.</div>
        </div>

        <div className="tf-sec">
          <div className="tf-sec-t">Histórico desta certidão</div>
          {!carregado && <span className="tf-vazio">Carregando o histórico…</span>}
          {carregado?.d && carregado.d.historico.length === 0 && <span className="tf-vazio">Nenhum fato registrado ainda.</span>}
          {carregado?.d?.historico.map((h, i) => (
            <div key={`${h.em}-${i}`} className="tf-hist"><span className="q">{h.quando}</span><span>{h.autor ? `${h.autor} — ` : ""}{h.texto}</span></div>
          ))}
        </div>

        {linha.processoId != null && <Link className="tf-g-link" href={`/torre/processo/${linha.processoId}`}>Abrir o processo inteiro ›</Link>}
      </aside>
    </>
  )
}
