"use client"
// src/components/torre/TorreTerceiros.tsx — aba TERCEIROS (Bloco G3–G5).
// Cartório/órgão, Em aberto, Sem resposta, RÉGUA (só o que o Gerenciamento cadastrou — nunca "tempo
// aprendido"), Não localizada, Próx. cobrança, Cobrar (SÓ aquele órgão) e Contatos (histórico).
import { useEffect, useState } from "react"
import { RegistrarContatoModal, CANAL_CADASTRADO } from "@/src/components/operacao/RegistrarContatoModal"
import { api, erroDe, fmtDataHora, fmtDia, Modal, useTorre } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import { CobrarTodosVencidos } from "./CobrarTodosVencidos"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"

interface OrgaoTerceiro {
  orgaoId: number; nome: string; uf: string | null; canal: string; emAberto: number; aguardando: number
  semResposta: { tarefas: number; maxDias: number | null }; regua: string; naoLocalizada: number
  proximaCobranca: { data: string | null; vencida: boolean }; cobrancasVencidas: number
}
interface Contato { id: string; tipo: "CONTATO" | "CANAL_ALTERADO"; quando: string; quem: string | null; tarefaId: number | null; tarefaTitulo: string | null; canal: string | null; resultado: string | null; texto: string }

export function TorreTerceiros({ linhas, versao }: { linhas: LinhaTorre[]; versao: number }) {
  const { avisar, recarregar } = useTorre()
  const [orgaos, setOrgaos] = useState<OrgaoTerceiro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cobrar, setCobrar] = useState<OrgaoTerceiro | null>(null)
  const [contatos, setContatos] = useState<{ orgao: OrgaoTerceiro; lista: Contato[] | null; erro: string | null } | null>(null)

  useEffect(() => {
    let vivo = true
    void api<{ orgaos: OrgaoTerceiro[] }>("/api/torre/terceiros").then((r) => {
      if (!vivo) return
      if (r.ok) { setOrgaos(r.data.orgaos); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar os terceiros."))
    })
    return () => { vivo = false }
  }, [versao])

  const abrirContatos = async (o: OrgaoTerceiro) => {
    setContatos({ orgao: o, lista: null, erro: null })
    const r = await api<{ contatos: Contato[] }>(`/api/torre/terceiros/${o.orgaoId}/contatos`)
    setContatos({ orgao: o, lista: r.ok ? r.data.contatos : null, erro: r.ok ? null : erroDe(r.data) })
  }

  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!orgaos) return <div className="tor-card pad small">Carregando terceiros…</div>

  return (
    <div>
      <div className="tor-bar">
        <div className="small">Régua = o que o Gerenciamento cadastrou (regra do órgão ou régua dos passos). Cobrar aqui cobra só o cartório da linha.</div>
        <div style={{ flexGrow: 1 }} />
        <CobrarTodosVencidos linhas={linhas} />
      </div>
      <div className="tor-card tor-scroll">
        <div className="tor-hd tor-gC"><span>Cartório / órgão (UF · canal)</span><span>Em aberto</span><span>Sem resposta (dias)</span><span>Régua</span><span>Não localizada</span><span>Próx. cobrança</span><span /></div>
        {orgaos.length === 0 && <div className="p-4 small">Nenhum cartório/órgão com trabalho em aberto vinculado.</div>}
        {orgaos.map((o) => (
          <div key={o.orgaoId} className="tor-row tor-gC">
            <div><b>{o.nome}</b><div className="small">{o.uf ?? "—"} · canal: {o.canal}</div></div>
            <div>{o.emAberto}</div>
            <div>{o.semResposta.tarefas > 0 ? <span className="tor-p amb">{o.semResposta.tarefas}{o.semResposta.maxDias != null ? ` · ${o.semResposta.maxDias} d` : ""}</span> : "—"}</div>
            <div className="small">{o.regua}</div>
            <div className="small">{o.naoLocalizada > 0 ? `${o.naoLocalizada} registro(s) não localizado(s)` : "0"}</div>
            <div>{o.proximaCobranca.vencida ? <span className="tor-p red">vencida</span> : <span className="tor-p gry">{o.proximaCobranca.data ? fmtDia(o.proximaCobranca.data) : "—"}</span>}</div>
            <div className="flex gap-1">
              <button className="tor-btn pri" disabled={o.aguardando === 0} title={o.aguardando === 0 ? "Nada está com este órgão" : undefined} onClick={() => setCobrar(o)}>Cobrar</button>
              <button className="tor-btn" onClick={() => void abrirContatos(o)}>Contatos</button>
            </div>
          </div>
        ))}
      </div>

      {cobrar && (
        <RegistrarContatoModal
          titulo={`Cobrar ${cobrar.nome}`} subtitulo={`${cobrar.aguardando} pedido(s) com este órgão — um contato registrado por pedido.`} opcaoCanalCadastrado
          onFechar={() => setCobrar(null)}
          onEnviar={async (dados) => {
            const r = await api<{ ok?: boolean; cobradas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }>(`/api/torre/terceiros/${cobrar.orgaoId}/cobrar`, "POST", { ...dados, canal: dados.canal === CANAL_CADASTRADO ? undefined : dados.canal })
            if (!r.ok || !r.data.ok) return { ok: false, mensagem: erroDe(r.data) }
            setCobrar(null)
            avisar(`Cobrança enviada a ${cobrar.nome}: ${r.data.cobradas} pedido(s).${r.data.ignoradas?.length ? ` (${r.data.ignoradas.length} ignorado(s): ${r.data.ignoradas[0].motivo})` : ""}`)
            recarregar()
            return { ok: true }
          }}
        />
      )}

      {contatos && (
        <Modal titulo={`Contatos · ${contatos.orgao.nome}`} subtitulo="Cobranças, ligações e trocas de canal — os mesmos registros do Andamento de cada tarefa." onFechar={() => setContatos(null)} rodape={<button className="tor-btn" onClick={() => setContatos(null)}>Fechar</button>}>
          {contatos.erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{contatos.erro}</div>}
          {!contatos.erro && contatos.lista == null && <div className="small">Carregando…</div>}
          {contatos.lista?.length === 0 && <div className="small">Nenhum contato registrado com este órgão ainda.</div>}
          <ul className="space-y-2">
            {contatos.lista?.map((c) => (
              <li key={c.id} className="text-[12.5px] border-b border-[var(--border-default)] pb-1.5">
                <div><b>{c.tipo === "CANAL_ALTERADO" ? "Canal alterado" : c.canal === "TELEFONE" ? "Ligação" : "Cobrança"}</b> · {fmtDataHora(c.quando)}{c.quem ? ` · ${c.quem}` : ""}</div>
                <div className="small">{c.tarefaTitulo ? `${c.tarefaTitulo} · ` : ""}{c.tarefaId != null ? `#${c.tarefaId} · ` : ""}{c.texto}</div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      <CartoesDeMetricas versao={versao} />
    </div>
  )
}

interface TempoPorFase { fase: string; amostras: number; mediaDias: number }
const humanizar = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

/** "Tempo médio real por fase" (E11, log de transição) e "Backlog" (abre/fecha na semana) — Bloco J4. */
function CartoesDeMetricas({ versao }: { versao: number }) {
  const [fases, setFases] = useState<TempoPorFase[] | null>(null)
  const [erroFases, setErroFases] = useState<string | null>(null)
  const [backlog, setBacklog] = useState<{ abertas: number; fechadas: number } | null>(null)
  const [erroBacklog, setErroBacklog] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
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
  const sentido = backlog ? (backlog.abertas > backlog.fechadas ? "cresce" : backlog.abertas < backlog.fechadas ? "encolhe" : "estável") : null
  return (
    <>
      <div className="tor-card pad">
        <h2 className="font-extrabold">Tempo médio real por fase</h2>
        {erroFases && <div className="small mt-1">{erroFases}</div>}
        {!erroFases && fases == null && <div className="small mt-1">Carregando…</div>}
        {fases?.length === 0 && <div className="small mt-1">Sem fase concluída no log de transição ainda — nada a mostrar.</div>}
        {fases && fases.length > 0 && (
          <ul className="mt-2 space-y-1">
            {fases.map((f) => (
              <li key={f.fase} className="text-[13px]"><b>{labelDaFasePorPhaseKey(f.fase) ?? humanizar(f.fase)}</b> · {String(f.mediaDias).replace(".", ",")} dias <span className="small">(n={f.amostras})</span></li>
            ))}
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
    </>
  )
}
