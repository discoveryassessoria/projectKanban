"use client"
// src/components/torre/TerceirosRegua.tsx — o que JÁ EXISTIA na aba Terceiros e fica (ordem do usuário: manter tudo o que existe):
// a RÉGUA de cobrança de cada órgão (só o que o Gerenciamento cadastrou — nunca "tempo aprendido"), os Contatos do órgão,
// o "Tempo médio real por fase" e o "Backlog". Fica ABAIXO da lista por pedido, sem mexer na estrutura do protótipo.
// NÃO há aqui "sem resposta (dias)" nem "não localizada" por órgão, nem ranking/média comparando cartórios.
import { useEffect, useState } from "react"
import { ddmmHora } from "@/lib/operacional/terceiros-pedidos"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"
import { CANAIS_DE_CONTATO_UI } from "@/src/components/operacao/RegistrarContatoModal"
import { api, erroDe, Modal } from "./torre-base"
import "./terceiros.css"

interface OrgaoRegua { orgaoId: number; nome: string; uf: string | null; canal: string; emAberto: number; regua: string; proximaCobranca: { data: string | null; vencida: boolean } }
interface ContatoOrgao { id: string; tipo: "CONTATO" | "CANAL_ALTERADO"; quando: string; quem: string | null; tarefaId: number | null; tarefaTitulo: string | null; canal: string | null; texto: string; estornado?: boolean }
interface TempoPorFase { fase: string; amostras: number; mediaDias: number }
const humanizar = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

export function TerceirosRegua({ versao }: { versao: number }) {
  const [orgaos, setOrgaos] = useState<OrgaoRegua[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [contatos, setContatos] = useState<{ orgao: OrgaoRegua; lista: ContatoOrgao[] | null; erro: string | null } | null>(null)
  const [fases, setFases] = useState<TempoPorFase[] | null>(null)
  const [erroFases, setErroFases] = useState<string | null>(null)
  const [backlog, setBacklog] = useState<{ abertas: number; fechadas: number } | null>(null)
  const [erroBacklog, setErroBacklog] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void api<{ orgaos: OrgaoRegua[] }>("/api/torre/terceiros").then((r) => {
      if (!vivo) return
      if (r.ok) { setOrgaos(r.data.orgaos); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar a régua dos órgãos."))
    })
    void api<{ porFase: TempoPorFase[] }>("/api/operacao/tempo-medio-por-fase").then((r) => {
      if (!vivo) return
      if (r.ok) { setFases(r.data.porFase); setErroFases(null) } else setErroFases(erroDe(r.data, "Não foi possível carregar o tempo médio por fase."))
    })
    void api<{ backlog: { abertas: number; fechadas: number } }>("/api/torre/tendencias").then((r) => {
      if (!vivo) return
      if (r.ok) { setBacklog(r.data.backlog); setErroBacklog(null) } else setErroBacklog(erroDe(r.data, "Não foi possível carregar o backlog."))
    })
    return () => { vivo = false }
  }, [versao])

  const abrirContatos = async (o: OrgaoRegua) => {
    setContatos({ orgao: o, lista: null, erro: null })
    const r = await api<{ contatos: ContatoOrgao[] }>(`/api/torre/terceiros/${o.orgaoId}/contatos`)
    setContatos({ orgao: o, lista: r.ok ? r.data.contatos : null, erro: r.ok ? null : erroDe(r.data) })
  }
  const sentido = backlog ? (backlog.abertas > backlog.fechadas ? "cresce" : backlog.abertas < backlog.fechadas ? "encolhe" : "estável") : null

  return (
    <>
      <div className="tor-card">
        <div className="ter-card-topo"><h2 className="ter-card-titulo">Régua de cobrança por órgão</h2></div>
        <div className="small" style={{ padding: "0 16px 8px" }}>Régua = o que o Gerenciamento cadastrou (regra do órgão ou régua dos passos).</div>
        {erro && <div className="ter-vazio">{erro}</div>}
        {!erro && orgaos == null && <div className="ter-vazio">Carregando…</div>}
        {orgaos?.length === 0 && <div className="ter-vazio">Nenhum cartório/órgão com trabalho em aberto vinculado.</div>}
        <div className="tor-scroll">
          {orgaos?.map((o) => (
            <div key={o.orgaoId} className="tor-row ter-gr">
              <div><b>{o.nome}</b><div className="small">{o.uf ?? "—"} · canal: {CANAIS_DE_CONTATO_UI.find((c) => c.v === o.canal)?.l ?? o.canal}</div></div>
              <div className="small">{o.regua}</div>
              <div>{o.proximaCobranca.vencida ? <span className="tor-p red">vencida</span> : <span className="tor-p gry">{o.proximaCobranca.data ? ddmmHora(o.proximaCobranca.data).slice(0, 5) : "—"}</span>}</div>
              <div><button className="tor-btn" onClick={() => void abrirContatos(o)}>Contatos</button></div>
            </div>
          ))}
        </div>
      </div>

      <div className="tor-card pad">
        <h2 className="font-extrabold">Tempo médio real por fase</h2>
        {erroFases && <div className="small mt-1">{erroFases}</div>}
        {!erroFases && fases == null && <div className="small mt-1">Carregando…</div>}
        {fases?.length === 0 && <div className="small mt-1">Sem fase concluída no log de transição ainda — nada a mostrar.</div>}
        {fases && fases.length > 0 && (
          <ul className="mt-2 space-y-1">
            {fases.map((f) => <li key={f.fase} className="text-[13px]"><b>{labelDaFasePorPhaseKey(f.fase) ?? humanizar(f.fase)}</b> · {String(f.mediaDias).replace(".", ",")} dias <span className="small">(n={f.amostras})</span></li>)}
          </ul>
        )}
        <div className="small mt-2">Só permanências completas (entrada e saída registradas no log de transição); fase ainda em curso não entra na média.</div>
      </div>
      <div className="tor-card pad">
        <h2 className="font-extrabold">Backlog</h2>
        {erroBacklog && <div className="small mt-1">{erroBacklog}</div>}
        {!erroBacklog && backlog == null && <div className="small mt-1">Carregando…</div>}
        {backlog && (
          <div className="mt-1 text-[13px]">Abre <b>{backlog.abertas}</b> / fecha <b>{backlog.fechadas}</b> tarefas nesta semana — <b>{sentido}</b>.
            <div className="small">Abre = tarefas criadas na semana; fecha = concluídas com sucesso na semana (cancelada nunca conta).</div>
          </div>
        )}
      </div>

      {contatos && (
        <Modal titulo={`Contatos · ${contatos.orgao.nome}`} subtitulo="Cobranças, ligações e trocas de canal — os mesmos registros do Andamento de cada tarefa." onFechar={() => setContatos(null)} rodape={<button className="tor-btn" onClick={() => setContatos(null)}>Fechar</button>}>
          {contatos.erro && <div className="ter-erro">{contatos.erro}</div>}
          {!contatos.erro && contatos.lista == null && <div className="small">Carregando…</div>}
          {contatos.lista?.length === 0 && <div className="small">Nenhum contato registrado com este órgão ainda.</div>}
          <ul className="space-y-2">
            {contatos.lista?.map((c) => (
              <li key={c.id} className="text-[12.5px] border-b border-[var(--border-default)] pb-1.5">
                <div style={c.estornado ? { textDecoration: "line-through", opacity: 0.7 } : undefined}><b>{c.tipo === "CANAL_ALTERADO" ? "Canal alterado" : c.canal === "TELEFONE" ? "Ligação" : "Cobrança"}</b> · {ddmmHora(c.quando)}{c.quem ? ` · ${c.quem}` : ""}{c.estornado ? " · desfeita" : ""}</div>
                <div className="small">{c.tarefaTitulo ? `${c.tarefaTitulo} · ` : ""}{c.tarefaId != null ? `#${c.tarefaId} · ` : ""}{c.texto}</div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  )
}
