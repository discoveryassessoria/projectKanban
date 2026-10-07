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
import { api, erroDe, useTorre, type Desfazer } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import { TerceirosRegua } from "./TerceirosRegua"
import { CobrarTodosModal, type DadosDaCobranca } from "./TerceirosModais"
import "./terceiros.css"

type Retorno = { ok: boolean; mensagem?: string }

interface RespostaDaCobranca { ok?: boolean; desfazer?: Desfazer | null; cobradas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }

/** O que a porta devolveu → ok/erro para o modal. Nenhuma cobrança feita é erro (nada de "enviada" que não aconteceu). */
function aceitar(r: { ok: boolean; data: RespostaDaCobranca }): Retorno & { cobradas: number; desfazer?: Desfazer | null } {
  if (!r.ok || !r.data.ok) return { ok: false, mensagem: erroDe(r.data, "Não foi possível registrar a cobrança."), cobradas: 0 }
  const cobradas = r.data.cobradas ?? 0
  if (cobradas === 0) return { ok: false, mensagem: r.data.ignoradas?.[0]?.motivo ?? "Nenhuma cobrança foi registrada.", cobradas }
  return { ok: true, cobradas, desfazer: r.data.desfazer ?? null }
}

export function TorreTerceiros({ linhas, versao }: { linhas: LinhaTorre[]; versao: number }) {
  const { avisar, recarregar } = useTorre()
  const router = useRouter()
  const [todos, setTodos] = useState(false)
  // "Hoje" só depois de montar (hidratação): `null` no servidor e no primeiro render; o instante real (a cada minuto) depois.
  const agora = useAgora()

  const pedidos = useMemo(() => (agora ? pedidosDeTerceiros(linhas, agora) : []), [linhas, agora])
  const resumo = useMemo(() => (agora ? resumoDeTerceiros(linhas, agora) : null), [linhas, agora])
  const idsVencidos = useMemo(() => (agora ? idsParaCobrar(linhas, agora) : []), [linhas, agora])
  const grupos = useMemo(() => agruparPorOrgao(pedidos), [pedidos])
  const pedidosVencidos = useMemo(() => pedidos.filter((p) => p.cobrar), [pedidos])

  const cobrarIds = async (tarefaIds: number[], d: DadosDaCobranca) =>
    aceitar(await api<RespostaDaCobranca>("/api/torre/terceiros/cobrar", "POST", { tarefaIds, canal: d.canal, proximaEmDias: d.proximaEmDias }))

  const cobrarVencidos = async (d: DadosDaCobranca): Promise<Retorno> => {
    const r = await cobrarIds(idsVencidos, d)
    if (!r.ok) return r
    setTodos(false)
    avisar(`${r.cobradas} ${r.cobradas === 1 ? "cobrança registrada" : "cobranças registradas"}`, r.desfazer ?? null)
    recarregar()
    return { ok: true }
  }
  const cobrarCartorio = async (orgaoId: number, nome: string, doGrupo: PedidoDeTerceiro[]) => {
    const r = aceitar(await api<RespostaDaCobranca>(`/api/torre/terceiros/${orgaoId}/cobrar`, "POST", { tarefaIds: doGrupo.map((p) => p.taskId), proximaEmDias: DIAS_PADRAO_DA_COBRANCA }))
    if (!r.ok) { avisar(r.mensagem ?? "Não foi possível cobrar este cartório."); return }
    avisar(`Cobrança registrada para ${nome} com ${r.cobradas} ${r.cobradas === 1 ? "certidão" : "certidões"} · registrada em cada uma`, r.desfazer ?? null)
    recarregar()
  }

  return (
    <div>
      <div className="ter-cab">
        <div className="ter-trilha"><Link href="/torre?aba=hoje">Torre de Controle</Link> › Terceiros</div>
        <h1 className="ter-titulo">Terceiros · quem de fora está nos devendo resposta</h1>
      </div>

      <div className="ter-kpis" role="group" aria-label="Resumo por tipo de terceiro">
        <div className="ter-kpi" title="Todos os pedidos que esperam resposta de fora, com ou sem responsável na tarefa — o MESMO número da visão 'Aguardando terceiros' da aba Tarefas; os sem responsável entram em 'Sem responsável'."><b className="ter-kpi-n">{resumo ? milhar(resumo.aguardando) : "…"}</b><span className="ter-kpi-l">aguardando terceiros (com ou sem responsável)</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? milhar(resumo.comCartorios) : "…"}</b><span className="ter-kpi-l">com cartórios</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? milhar(resumo.comOCliente) : "…"}</b><span className="ter-kpi-l">com o cliente</span></div>
        <div className="ter-kpi"><b className="ter-kpi-n">{resumo ? `${milhar(resumo.tradutora)} · ${milhar(resumo.juizo)} · ${milhar(resumo.consulado)}` : "…"}</b><span className="ter-kpi-l">tradutora · juízo · consulado</span></div>
        <div className="ter-kpi amb"><b className="ter-kpi-n">{resumo ? milhar(resumo.paraCobrar) : "…"}</b><span className="ter-kpi-l">para cobrar hoje ou vencidas</span></div>
        <div className="ter-kpi red"><b className="ter-kpi-n">{resumo ? milhar(resumo.escaladas) : "…"}</b><span className="ter-kpi-l">escaladas (sem resposta após 2 cobranças)</span></div>
      </div>

      <div className="tor-card">
        <div className="ter-card-topo">
          <h2 className="ter-card-titulo">Órgãos que nos devem resposta · {grupos.length}</h2>
          <button
            className="tor-btn pri" disabled={!agora}
            onClick={() => (idsVencidos.length ? setTodos(true) : avisar("Nenhum pedido com data de cobrança vencida ou de hoje."))}
          >Cobrar todos os vencidos ({resumo ? resumo.paraCobrar : "…"})</button>
        </div>

        <div className="tor-scroll" data-testid="terceiros-orgaos">
          <div className="tor-hd ter-g"><span>Órgão</span><span>Pedidos</span><span>A cobrar</span><span>Escaladas</span><span>Ações</span></div>
          {agora && grupos.length === 0 && <div className="ter-vazio">Nenhum pedido esperando resposta de terceiros.</div>}
          {!agora && <div className="ter-vazio">Carregando terceiros…</div>}
          {grupos.map((g) => {
            const aCobrar = g.pedidos.filter((p) => p.cobrar).length
            const escaladas = g.pedidos.filter((p) => p.escalada).length
            return (
              <div key={g.orgaoId ?? "sem"} className="tor-row ter-g" data-orgao={g.orgaoId ?? "sem"}>
                <div className="ter-quem">{g.nome}</div>
                <div>{g.pedidos.length}</div>
                <div className={aCobrar ? "ter-cobrar-em vencida" : "ter-cobrar-em"}>{aCobrar}</div>
                <div className={escaladas ? "ter-cobrar-em vencida" : "ter-cobrar-em"}>{escaladas}</div>
                <div className="ter-acoes">
                  {g.orgaoId != null && <button className="tor-btn" onClick={() => void cobrarCartorio(g.orgaoId!, g.nome, g.pedidos)}>Cobrar este órgão ({g.pedidos.length})</button>}
                  {/* Os PEDIDOS (tarefas) moram na aba Tarefas — aqui só o link (L1). */}
                  <Link className="tor-btn ter-ver-btn" href={g.orgaoId != null ? `/torre?aba=tarefas&visao=aguard&orgao=${g.orgaoId}` : "/torre?aba=tarefas&visao=aguard"}>Ver os {g.pedidos.length} em Tarefas</Link>
                </div>
              </div>
            )
          })}
        </div>

        <div className="ter-nota">
          Esta aba lista ÓRGÃOS, não tarefas: cada pedido (certidão · pessoa · família), com o botão Cobrar da linha, está na aba Tarefas (visão "Aguardando terceiros"). Não há ranking nem média por cartório; o número de pedidos é o da própria lista. Quem decide quando cobrar é a data de cobrança.
        </div>
      </div>

      <TerceirosRegua versao={versao} />

      {todos && <CobrarTodosModal n={idsVencidos.length} cartorios={cartoriosDistintos(pedidosVencidos)} onFechar={() => setTodos(false)} onEnviar={cobrarVencidos} />}
    </div>
  )
}
