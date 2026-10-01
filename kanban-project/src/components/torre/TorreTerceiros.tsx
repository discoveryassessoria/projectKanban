"use client"
// src/components/torre/TorreTerceiros.tsx — aba TERCEIROS (Torre nova, frente G): "quem de fora está nos devendo resposta".
// Faixa de resumo POR TIPO de terceiro (Cartório · Cliente · Tradutor · Juízo · Consulado — pela categoria do cadastro de
// órgãos, `torre-bola.ts`) + a lista POR PEDIDO (certidão · pessoa · família, pedida a, pedida há, cobrar em) + a alternância
// "agrupado por cartório (para cobrar junto)". NÃO há ranking, média nem número comparativo por cartório: o agrupamento só
// serve para cobrar junto. Tudo sai das MESMAS linhas da Torre (`terceiros-pedidos.ts`) — os números fecham com Tarefas e
// Visão geral. "Cobrar" grava pela porta única (`registrarCobranca` → `ContatoTerceiro`) e marca a próxima cobrança.
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DIAS_PADRAO_DA_COBRANCA } from "@/lib/operacional/torre-bola"
import {
  agruparPorOrgao, cartoriosDistintos, idsParaCobrar, milhar, pedidosDeTerceiros, resumoDeTerceiros, subtituloDoGrupo,
  type PedidoDeTerceiro,
} from "@/lib/operacional/terceiros-pedidos"
import { useAgora } from "@/src/lib/torre-agora"
import { api, erroDe, useTorre } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import { TerceirosRegua } from "./TerceirosRegua"
import { CobrarPedidoModal, CobrarTodosModal, ContatosDoPedidoModal, type DadosDaCobranca } from "./TerceirosModais"
import "./terceiros.css"

type Visao = "pedido" | "orgao"
type Retorno = { ok: boolean; mensagem?: string }

interface RespostaDaCobranca { ok?: boolean; cobradas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }

/** O que a porta devolveu → ok/erro para o modal. Nenhuma cobrança feita é erro (nada de "enviada" que não aconteceu). */
function aceitar(r: { ok: boolean; data: RespostaDaCobranca }): Retorno & { cobradas: number } {
  if (!r.ok || !r.data.ok) return { ok: false, mensagem: erroDe(r.data, "Não foi possível registrar a cobrança."), cobradas: 0 }
  const cobradas = r.data.cobradas ?? 0
  if (cobradas === 0) return { ok: false, mensagem: r.data.ignoradas?.[0]?.motivo ?? "Nenhuma cobrança foi registrada.", cobradas }
  return { ok: true, cobradas }
}

export function TorreTerceiros({ linhas, versao }: { linhas: LinhaTorre[]; versao: number }) {
  const { avisar, recarregar } = useTorre()
  const router = useRouter()
  const [visao, setVisao] = useState<Visao>("pedido")
  const [cobrar, setCobrar] = useState<PedidoDeTerceiro | null>(null)
  const [todos, setTodos] = useState(false)
  const [contatos, setContatos] = useState<PedidoDeTerceiro | null>(null)
  // "Hoje" só depois de montar (hidratação): `null` no servidor e no primeiro render; o instante real (a cada minuto) depois.
  const agora = useAgora()

  const pedidos = useMemo(() => (agora ? pedidosDeTerceiros(linhas, agora) : []), [linhas, agora])
  const resumo = useMemo(() => (agora ? resumoDeTerceiros(linhas, agora) : null), [linhas, agora])
  const idsVencidos = useMemo(() => (agora ? idsParaCobrar(linhas, agora) : []), [linhas, agora])
  const grupos = useMemo(() => (visao === "orgao" ? agruparPorOrgao(pedidos) : []), [visao, pedidos])
  const pedidosVencidos = useMemo(() => pedidos.filter((p) => p.cobrar), [pedidos])

  const cobrarIds = async (tarefaIds: number[], d: DadosDaCobranca) =>
    aceitar(await api<RespostaDaCobranca>("/api/torre/terceiros/cobrar", "POST", { tarefaIds, canal: d.canal, proximaEmDias: d.proximaEmDias }))

  const cobrarUm = async (p: PedidoDeTerceiro, d: DadosDaCobranca): Promise<Retorno> => {
    const r = await cobrarIds([p.taskId], d)
    if (!r.ok) return r
    setCobrar(null)
    avisar(`Cobrança enviada e registrada · ${p.pessoa}`)
    recarregar()
    return { ok: true }
  }
  const cobrarVencidos = async (d: DadosDaCobranca): Promise<Retorno> => {
    const r = await cobrarIds(idsVencidos, d)
    if (!r.ok) return r
    setTodos(false)
    avisar(`${r.cobradas} ${r.cobradas === 1 ? "cobrança enviada e registrada" : "cobranças enviadas e registradas"}`)
    recarregar()
    return { ok: true }
  }
  const cobrarCartorio = async (orgaoId: number, nome: string, doGrupo: PedidoDeTerceiro[]) => {
    const r = aceitar(await api<RespostaDaCobranca>(`/api/torre/terceiros/${orgaoId}/cobrar`, "POST", { tarefaIds: doGrupo.map((p) => p.taskId), proximaEmDias: DIAS_PADRAO_DA_COBRANCA }))
    if (!r.ok) { avisar(r.mensagem ?? "Não foi possível cobrar este cartório."); return }
    avisar(`Cobrança enviada a ${nome} com ${r.cobradas} ${r.cobradas === 1 ? "certidão" : "certidões"} · registrada em cada uma`)
    recarregar()
  }

  const linhaDoPedido = (p: PedidoDeTerceiro) => (
    <div key={p.taskId} className="tor-row ter-g" data-pedido={p.taskId}>
      <div>
        <div className="ter-quem">{p.certidao}</div>
        <div className="small">{p.pessoa} · {p.familia}</div>
      </div>
      <div>
        <div className="ter-orgao">{p.orgao ?? "—"}</div>
        <div className="small">{p.cobrancas}</div>
      </div>
      <div className="ter-cobrar-em">{p.pedidaHa}</div>
      <div className={`ter-cobrar-em ${p.cobrarEm.tom === "vencida" ? "vencida" : p.cobrarEm.tom === "hoje" ? "hoje" : ""}`}>{p.cobrarEm.texto}</div>
      <div className="ter-acoes">
        {p.cobrar
          ? <button className="tor-btn pri" onClick={() => setCobrar(p)}>Cobrar</button>
          : p.processoId != null && <button className="tor-btn ter-ver-btn" onClick={() => router.push(`/torre/processo/${p.processoId}`)}>Ver</button>}
        <button className="tor-btn" onClick={() => setContatos(p)}>Contatos</button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="ter-cab">
        <div className="ter-trilha"><Link href="/torre?aba=visao">Torre de Controle</Link> › Terceiros</div>
        <h1 className="ter-titulo">Terceiros · quem de fora está nos devendo resposta</h1>
      </div>

      <div className="ter-kpis" role="group" aria-label="Resumo por tipo de terceiro">
        <div className="ter-kpi" title="O mesmo número de Aguardando terceiros na Visão geral e na aba Tarefas."><b className="ter-kpi-n">{resumo ? milhar(resumo.aguardando) : "…"}</b><span className="ter-kpi-l">aguardando terceiros</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? milhar(resumo.comCartorios) : "…"}</b><span className="ter-kpi-l">com cartórios</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? milhar(resumo.comOCliente) : "…"}</b><span className="ter-kpi-l">com o cliente</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? `${milhar(resumo.tradutora)} · ${milhar(resumo.juizo)} · ${milhar(resumo.consulado)}` : "…"}</b><span className="ter-kpi-l">tradutora · juízo · consulado</span></div>
        <div className="ter-kpi amb"><b className="ter-kpi-n">{resumo ? milhar(resumo.paraCobrar) : "…"}</b><span className="ter-kpi-l">para cobrar hoje ou vencidas</span></div>
        <div className="ter-kpi red"><b className="ter-kpi-n">{resumo ? milhar(resumo.escaladas) : "…"}</b><span className="ter-kpi-l">escaladas (sem resposta após 2 cobranças)</span></div>
      </div>

      <div className="tor-card">
        <div className="ter-card-topo">
          <h2 className="ter-card-titulo">Pedidos esperando resposta</h2>
          <div className="ter-ver" role="group" aria-label="Ver">
            <span className="ter-ver-rot">Ver:</span>
            <button className={`tor-btn ${visao === "pedido" ? "pri" : ""}`} aria-pressed={visao === "pedido"} onClick={() => setVisao("pedido")}>por pedido</button>
            <button className={`tor-btn ${visao === "orgao" ? "pri" : ""}`} aria-pressed={visao === "orgao"} onClick={() => setVisao("orgao")}>agrupado por cartório (para cobrar junto)</button>
          </div>
          <button
            className="tor-btn pri" disabled={!agora}
            onClick={() => (idsVencidos.length ? setTodos(true) : avisar("Nenhum pedido com data de cobrança vencida ou de hoje."))}
          >Cobrar todos os vencidos ({resumo ? resumo.paraCobrar : "…"})</button>
        </div>

        <div className="tor-scroll">
          <div className="tor-hd ter-g"><span>Certidão · pessoa · família</span><span>Pedida a</span><span>Pedida há</span><span>Cobrar em</span><span>Ações</span></div>
          {agora && pedidos.length === 0 && <div className="ter-vazio">Nenhum pedido esperando resposta de terceiros.</div>}
          {!agora && <div className="ter-vazio">Carregando terceiros…</div>}
          {visao === "pedido" && pedidos.map(linhaDoPedido)}
          {visao === "orgao" && grupos.map((g) => (
            <div key={g.orgaoId ?? "sem"}>
              <div className="ter-grupo">
                <span className="ter-grupo-nome">{g.nome}</span>
                <span className="ter-grupo-sub">{subtituloDoGrupo(g.pedidos.length)}</span>
                {g.orgaoId != null && <button className="tor-btn" onClick={() => void cobrarCartorio(g.orgaoId!, g.nome, g.pedidos)}>Cobrar este cartório ({g.pedidos.length})</button>}
              </div>
              {g.pedidos.map(linhaDoPedido)}
            </div>
          ))}
        </div>

        <div className="ter-nota">
          A lista é por pedido. "Agrupado por cartório" serve só para cobrar junto o que está no mesmo lugar; não há ranking nem média por cartório, porque a maioria aparece uma vez só. Quem decide quando cobrar é a data de cobrança de cada pedido (padrão: 7 dias depois do pedido ou da última cobrança). "Cobrar" registra no histórico da certidão e marca a próxima data.
        </div>
      </div>

      <TerceirosRegua versao={versao} />

      {cobrar && <CobrarPedidoModal pedido={cobrar} onFechar={() => setCobrar(null)} onEnviar={(d) => cobrarUm(cobrar, d)} />}
      {todos && <CobrarTodosModal n={idsVencidos.length} cartorios={cartoriosDistintos(pedidosVencidos)} onFechar={() => setTodos(false)} onEnviar={cobrarVencidos} />}
      {contatos && <ContatosDoPedidoModal pedido={contatos} onFechar={() => setContatos(null)} />}
    </div>
  )
}
