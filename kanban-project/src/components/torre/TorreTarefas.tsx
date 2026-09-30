"use client"
// src/components/torre/TorreTarefas.tsx — aba TAREFAS (Bloco G1–G3, G6).
// A MESMA projeção da Operação (/api/torre/tarefas). Lote com toast de 6 s + Desfazer, ação rápida por
// linha (Atribuir / Cobrar / Iniciar — o Iniciar só aparece para quem realmente pode iniciar), "Cobrar
// todos os vencidos (N)" e o painel espelhado da tarefa. Nada de dado de exemplo.
import { useEffect, useMemo, useState } from "react"
import { DocumentoOperationalDrawer } from "@/src/components/kanban/DocumentoOperationalDrawer"
import { RegistrarContatoModal } from "@/src/components/operacao/RegistrarContatoModal"
import { passoLabelDe, acompTxtCompleto, aplicarBusca, docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe, Campo, Modal, resumoDoLote, useTorre, type Desfazer } from "./torre-base"
import { bolaDe, riscoDe, type LinhaTorre } from "./tipos"
import { PainelTorreTarefa } from "./PainelTorreTarefa"
import { CobrarTodosVencidos } from "./CobrarTodosVencidos"

type Agrupar = "fam" | "resp" | "org" | "fase" | "none"
type Visao = "todas" | "vencidas" | "semdono" | "aguard" | "cobranca"

const VISOES: Array<[Visao, string]> = [
  ["todas", "Todas as abertas"], ["vencidas", "Vencidas"], ["semdono", "Sem responsável"], ["aguard", "Com o cartório"], ["cobranca", "Cobranças vencidas"],
]
const PREDICADO: Record<Visao, (l: LinhaTorre) => boolean> = {
  todas: () => true, vencidas: (l) => l.atrasada, semdono: (l) => l.responsavelId == null,
  aguard: (l) => l.estadoOperacao === "AGUARDANDO", cobranca: (l) => l.cobravelVencida,
}
const CHAVE: Record<Agrupar, (l: LinhaTorre) => string> = {
  fam: (l) => l.familiaNome ?? l.processoNome ?? "Sem família",
  resp: (l) => l.responsavelNome ?? "Sem responsável",
  org: (l) => l.terceiroNome ?? "Sem cartório",
  fase: (l) => l.faseAtualDoProcessoLabel ?? l.faseMacroKey ?? "Sem fase",
  none: () => "Todas",
}

interface Funcionario { id: number; nome: string; email?: string; tarefasAtivas: number }
interface RespLote { total?: number; sucesso?: number; falha?: number; itens?: Array<{ ok: boolean; mensagem?: string }>; desfazer?: Desfazer | null; error?: string }

export function TorreTarefas({ linhas, carregando, erro }: { linhas: LinhaTorre[]; carregando: boolean; erro: boolean }) {
  const { permissoes, avisar, recarregar } = useTorre()
  const [agrupar, setAgrupar] = useState<Agrupar>("fam")
  const [visao, setVisao] = useState<Visao>("todas")
  const [busca, setBusca] = useState("")
  const [sel, setSel] = useState<Record<number, true>>({})
  const [pessoas, setPessoas] = useState<Funcionario[]>([])
  const [pessoaId, setPessoaId] = useState<number | null>(null)
  const [repactuar, setRepactuar] = useState(false)
  const [cobrarLinha, setCobrarLinha] = useState<LinhaTorre | null>(null)
  const [aberta, setAberta] = useState<LinhaTorre | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const podeEditar = !!permissoes?.editar
  useEffect(() => {
    if (!podeEditar) return
    let vivo = true
    void api<{ funcionarios: Funcionario[] }>("/api/operacao/atribuiveis").then((r) => {
      if (vivo && r.ok) { setPessoas(r.data.funcionarios ?? []); setPessoaId((atual) => atual ?? r.data.funcionarios?.[0]?.id ?? null) }
    })
    return () => { vivo = false }
  }, [podeEditar])

  const visiveis = useMemo(() => aplicarBusca(linhas.filter(PREDICADO[visao]), busca) as LinhaTorre[], [linhas, visao, busca])
  const grupos = useMemo(() => {
    const m = new Map<string, LinhaTorre[]>()
    for (const l of visiveis) { const k = CHAVE[agrupar](l); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()]
  }, [visiveis, agrupar])
  const selIds = useMemo(() => Object.keys(sel).map(Number).filter((id) => linhas.some((l) => l.taskId === id)), [sel, linhas])
  const pessoa = pessoas.find((p) => p.id === pessoaId)

  const alternar = (ids: number[], ligar: boolean) => setSel((s) => {
    const n = { ...s }
    for (const id of ids) { if (ligar) n[id] = true; else delete n[id] }
    return n
  })

  const lote = async (acao: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true)
    const r = await api<RespLote>("/api/torre/tarefas/lote", "POST", { acao, tarefaIds: selIds, ...extra })
    setOcupado(false)
    if (r.data && typeof r.data.total === "number") {
      const verbo = { ATRIBUIR: `atribuída(s) a ${pessoa?.nome ?? "a pessoa"}`, PRIORIDADE_ALTA: "com prioridade alta", REPACTUAR: "repactuada(s)", COBRAR: "cobrada(s) ao cartório" }[acao]
      avisar(`${resumoDoLote(r.data)} — ${verbo}.`, r.data.desfazer ?? null)
      setSel({}); recarregar()
      return { ok: true as const }
    }
    avisar(erroDe(r.data))
    return { ok: false as const, mensagem: erroDe(r.data) }
  }

  const atribuirRapido = async (l: LinhaTorre) => {
    const r = await api<{ mensagem?: string; desfazer?: Desfazer }>(`/api/torre/tarefas/${l.taskId}/atribuir-sugerido`, "POST")
    if (r.ok) { avisar(r.data.mensagem ?? "Atribuída.", r.data.desfazer ?? null); recarregar() } else avisar(erroDe(r.data))
  }
  const iniciarRapido = async (l: LinhaTorre) => {
    const r = await api<{ mensagem?: string }>(`/api/torre/tarefas/${l.taskId}/iniciar`, "POST", {})
    avisar(r.ok ? (r.data.mensagem ?? "Iniciada.") : erroDe(r.data))
    if (r.ok) recarregar()
  }

  if (erro) return <div className="tor-card pad">Não foi possível carregar as tarefas. Tente recarregar a página.</div>
  if (carregando) return <div className="tor-card pad small">Carregando tarefas…</div>

  return (
    <div>
      <div className="tor-bar">
        <label className="flex items-center gap-1.5 small">Agrupar por
          <select className="tor-in" aria-label="Agrupar por" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
            <option value="fam">Família</option><option value="resp">Responsável</option><option value="org">Cartório</option><option value="fase">Fase</option><option value="none">Sem agrupamento</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 small">Visão
          <select className="tor-in" aria-label="Visão" value={visao} onChange={(e) => setVisao(e.target.value as Visao)}>
            {VISOES.map(([v, l]) => <option key={v} value={v}>{l}{v === "cobranca" ? ` (${linhas.filter(PREDICADO.cobranca).length})` : ""}</option>)}
          </select>
        </label>
        <input className="tor-in" placeholder="Buscar família, pessoa, certidão, cartório…" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div style={{ flexGrow: 1 }} />
        <CobrarTodosVencidos linhas={linhas} />
        {selIds.length > 0 && (
          <div className="tor-sel" role="toolbar" aria-label="Ações em lote">
            <b>{selIds.length} sel.</b>
            {podeEditar && (
              <>
                <select className="tor-in" aria-label="Pessoa" value={pessoaId ?? ""} onChange={(e) => setPessoaId(Number(e.target.value))}>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.tarefasAtivas})</option>)}
                </select>
                <button className="tor-btn pri" disabled={ocupado || !pessoa} onClick={() => void lote("ATRIBUIR", { responsavelId: pessoaId })}>Atribuir a {pessoa?.nome ?? "…"}</button>
                <button className="tor-btn" disabled={ocupado} onClick={() => void lote("PRIORIDADE_ALTA")}>Prioridade alta</button>
                <button className="tor-btn" disabled={ocupado} onClick={() => setRepactuar(true)}>Repactuar prazo</button>
              </>
            )}
            <button className="tor-btn" disabled={ocupado} onClick={() => void lote("COBRAR")}>Cobrar cartório</button>
            <button className="tor-btn" onClick={() => setSel({})}>Limpar</button>
          </div>
        )}
      </div>

      {grupos.length === 0 && <div className="tor-card pad small">Nenhuma tarefa nesta visão.</div>}
      {grupos.map(([nome, itens]) => {
        const todas = itens.every((l) => sel[l.taskId]); const alguma = itens.some((l) => sel[l.taskId])
        return (
          <div key={nome} className="tor-card tor-scroll">
            <div className="tor-grp">
              <button className={`tor-chk ${todas ? "on" : alguma ? "mid" : ""}`} aria-label={`Selecionar o grupo ${nome}`} onClick={() => alternar(itens.map((l) => l.taskId), !todas)} />
              <b>{nome}</b><div style={{ flexGrow: 1 }} /><span className="tor-p gry">{itens.length} tarefas</span>
            </div>
            <div className="tor-hd tor-gT"><span /><span>Certidão · pessoa</span><span>Bola com</span><span>Etapa</span><span>Responsável</span><span>Prazo</span><span>Acomp.</span><span>Risco</span><span /></div>
            {itens.map((l) => {
              const bola = bolaDe(l); const risco = riscoDe(l)
              return (
                <div key={l.taskId} className={`tor-row tor-gT ${sel[l.taskId] ? "sel" : ""}`}>
                  <button className={`tor-chk ${sel[l.taskId] ? "on" : ""}`} aria-label={`Selecionar a tarefa ${l.taskId}`} onClick={() => alternar([l.taskId], !sel[l.taskId])} />
                  <div><b>{docTipoTxt(l)}</b><div className="small">{l.pessoaNome ?? l.casalNomes ?? "—"} · {l.familiaNome ?? l.processoNome ?? "—"} · #{l.taskId}</div></div>
                  <div><span className={`tor-p ${bola.cls}`}>{bola.txt}</span>{l.esperandoHaDias != null && <div className="small">há {l.esperandoHaDias} d</div>}</div>
                  <div className="small">{passoLabelDe(l).label}</div>
                  <div className={l.responsavelId ? "" : "small"}>{l.responsavelNome ?? "sem responsável"}</div>
                  <div className="small">{l.rotuloDoPrazo || "—"}</div>
                  <div className="small">{acompTxtCompleto(l.acompanhamentoPasso)}</div>
                  <div><span className={`tor-p ${risco.cls}`}>{risco.txt}</span></div>
                  <div className="flex flex-wrap gap-1">
                    <button className="tor-btn pri" onClick={() => setAberta(l)}>Abrir</button>
                    {podeEditar && l.responsavelId == null && <button className="tor-btn" onClick={() => void atribuirRapido(l)}>Atribuir</button>}
                    {l.estadoOperacao === "AGUARDANDO" && <button className="tor-btn" onClick={() => setCobrarLinha(l)}>Cobrar</button>}
                    {l.podeIniciar && permissoes?.iniciar && <button className="tor-btn" onClick={() => void iniciarRapido(l)}>Iniciar</button>}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {repactuar && <RepactuarLoteModal n={selIds.length} onFechar={() => setRepactuar(false)} onEnviar={async (novoPrazo, justificativa) => {
        const r = await lote("REPACTUAR", { novoPrazo, justificativa })
        if (r.ok) setRepactuar(false)
        return r
      }} />}

      {cobrarLinha && (
        <RegistrarContatoModal
          titulo="Cobrar" subtitulo={`${cobrarLinha.terceiroNome ?? "Cartório"} · #${cobrarLinha.taskId}`}
          onFechar={() => setCobrarLinha(null)}
          onEnviar={async (dados) => {
            const r = await api<{ ok?: boolean; mensagem?: string; escalada?: boolean }>(`/api/operacao/tarefas/${cobrarLinha.taskId}/cobrar`, "POST", dados)
            if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data) }
            setCobrarLinha(null); avisar(`Contato registrado${r.data.escalada ? " · escalada ao gestor" : ""}.`); recarregar()
            return { ok: true }
          }}
        />
      )}

      {aberta && (aberta.documentoId != null ? (
        <DocumentoOperationalDrawer
          documentoId={aberta.documentoId} isOpen onClose={() => setAberta(null)} onSave={() => recarregar()}
          pilulaExtra="painel real do processo · espelhado"
          barraSuperiorExtra={<PainelTorreTarefa linha={linhas.find((l) => l.taskId === aberta.taskId) ?? aberta} />}
        />
      ) : (
        <div className="tor tor-gaveta" onClick={() => setAberta(null)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Painel da tarefa">
            <div className="p-4 flex items-center gap-2"><b className="flex-1">{aberta.titulo}</b><button className="tor-btn" onClick={() => setAberta(null)}>Fechar</button></div>
            <PainelTorreTarefa linha={linhas.find((l) => l.taskId === aberta.taskId) ?? aberta} />
            <p className="small p-4">Esta tarefa não tem documento vinculado: o painel completo do processo não se aplica.</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function RepactuarLoteModal({ n, onFechar, onEnviar }: { n: number; onFechar: () => void; onEnviar: (novoPrazoIso: string, justificativa: string) => Promise<{ ok: boolean; mensagem?: string }> }) {
  const [data, setData] = useState("")
  const [just, setJust] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const valido = data !== "" && just.trim().length >= 5
  const enviar = async () => {
    setEnviando(true); setErro(null)
    // Meio-dia UTC — nunca meia-noite, que vira o dia anterior no fuso operacional (mesma convenção do modal individual).
    const r = await onEnviar(`${data}T12:00:00.000Z`, just.trim())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível repactuar.")
  }
  return (
    <Modal titulo={`Repactuar prazo de ${n} tarefa(s)`} subtitulo="UMA justificativa para todas; cada tarefa grava a sua linha de auditoria." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !valido}>{enviando ? "Repactuando…" : "Repactuar prazo"}</button>
    </>}>
      <Campo rotulo="Novo prazo"><input type="date" className="tor-in w-full" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
      <Campo rotulo="Justificativa única (obrigatória)"><textarea className="tor-in w-full" rows={3} value={just} onChange={(e) => setJust(e.target.value)} /></Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}
