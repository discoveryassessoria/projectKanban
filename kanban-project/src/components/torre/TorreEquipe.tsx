"use client"
// src/components/torre/TorreEquipe.tsx — aba EQUIPE (Torre nova, frente F): "Quem está carregando o quê".
// Os números vêm das MESMAS linhas da Operação (/api/torre/equipe → `cargaPorPessoa`, a conta única — Ativas, Atrasadas e
// Aguard. terceiros fecham com a aba Tarefas e a Visão geral). Ausência é só REGISTRO (com sucessor sugerido); mover a carteira é
// ação MANUAL; "Simular saída" mostra o impacto antes de aplicar e NUNCA grava; "Distribuir por aptidão e carga" só atribui a quem
// tem aptidão comprovada (sem apto, a tarefa fica para o Precisa de você). Toda ação com efeito grava no histórico e tem Desfazer.
import { useEffect, useState } from "react"
import { api, erroDe, useTorre, type Desfazer } from "./torre-base"
import { TITULO_EQUIPE, TEXTO_EXPLICATIVO, toastAusenciaCancelada, toastAusenciaMarcada, toastCarteiraMovida, toastDistribuicao, toastRedistribuicao, toastSimulacaoAplicada } from "./equipe-visual"
import type { DadosDaEquipe, PessoaDaEquipe, SimulacaoDeSaida } from "./equipe-tipos"
import { EquipeTabela } from "./EquipeTabela"
import { EquipeSimulacao } from "./EquipeSimulacao"
import { EquipePrevisao } from "./EquipePrevisao"
import { AusenciaModal, MoverModal } from "./EquipeModais"
import "./equipe.css"

interface RespostaDistribuicao {
  atribuidas: number; porPessoa: Array<{ usuarioId: number; nome: string; quantidade: number }>; semApto: number; seguradas: number; falhas: number; desfazer?: Desfazer | null
}
interface RespostaRedistribuicao {
  movimentos: Array<{ deNome: string; paraNome: string; movidas: number }>; distribuicao: RespostaDistribuicao; desfazer?: Desfazer | null
}

export function TorreEquipe({ versao, pais = "" }: { versao: number; pais?: string }) {
  const { permissoes, avisar, recarregar } = useTorre()
  const [dados, setDados] = useState<DadosDaEquipe | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [ausencia, setAusencia] = useState<PessoaDaEquipe | null>(null)
  const [mover, setMover] = useState<PessoaDaEquipe | null>(null)
  const [sim, setSim] = useState<SimulacaoDeSaida | null>(null)
  const [diasSim, setDiasSim] = useState(10)
  const [ocupado, setOcupado] = useState(false)

  const permitido = !!permissoes?.equipe
  useEffect(() => {
    if (!permitido) return
    let vivo = true
    // O PAÍS DO CABEÇALHO FILTRA os números (carga, atrasadas, previsão): o servidor recorta as linhas por país antes de somar.
    void api<DadosDaEquipe>(`/api/torre/equipe${pais ? `?pais=${encodeURIComponent(pais)}` : ""}`).then((r) => {
      if (!vivo) return
      if (r.ok) { setDados(r.data); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar a equipe."))
    })
    return () => { vivo = false }
  }, [tick, versao, permitido, pais])
  const atualizar = () => { setTick((n) => n + 1); recarregar() }

  if (!permitido) return <div className="tor-card pad">A aba Equipe exige a permissão de gerenciar usuários e acessos (<code>usuarios.gerenciar</code>).</div>
  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!dados) return <div className="tor-card pad small">Carregando equipe…</div>

  const nomes = dados.pessoas.map((p) => p.nome)
  const cancelarAusencia = async (p: PessoaDaEquipe) => {
    if (!p.ausencia) return
    const r = await api("/api/operacao/capacidade", "PATCH", { acao: "encerrar_indisponibilidade", usuarioId: p.usuarioId, indisponibilidadeId: p.ausencia.id })
    if (r.ok) { avisar(toastAusenciaCancelada(p.nome)); atualizar() } else avisar(erroDe(r.data))
  }
  const simular = async (p: PessoaDaEquipe) => {
    setOcupado(true)
    const r = await api<SimulacaoDeSaida>("/api/torre/equipe/simular-saida", "POST", { usuarioId: p.usuarioId, dias: diasSim })
    setOcupado(false)
    if (r.ok) setSim(r.data); else avisar(erroDe(r.data))
  }
  const aplicar = async () => {
    if (!sim) return
    setOcupado(true)
    const r = await api<{ ok?: boolean; desfazer?: Desfazer | null }>("/api/torre/equipe/aplicar-saida", "POST", { usuarioId: sim.usuarioId, dias: sim.dias })
    setOcupado(false)
    if (r.ok) { avisar(toastSimulacaoAplicada(sim.nome), r.data.desfazer ?? null); setSim(null); atualizar() } else avisar(erroDe(r.data))
  }
  const distribuir = async () => {
    setOcupado(true)
    const r = await api<RespostaDistribuicao>("/api/torre/equipe/distribuir-sem-responsavel", "POST", {})
    setOcupado(false)
    if (typeof r.data?.atribuidas === "number") { avisar(toastDistribuicao(r.data, nomes), r.data.desfazer ?? null); atualizar() } else avisar(erroDe(r.data))
  }
  const redistribuir = async () => {
    setOcupado(true)
    const r = await api<RespostaRedistribuicao>("/api/torre/equipe/redistribuir", "POST", {})
    setOcupado(false)
    if (r.data?.distribuicao) {
      avisar(toastRedistribuicao({ movimentos: r.data.movimentos, atribuidas: r.data.distribuicao.atribuidas, semApto: r.data.distribuicao.semApto, seguradas: r.data.distribuicao.seguradas }, nomes), r.data.desfazer ?? null)
      atualizar()
    } else avisar(erroDe(r.data))
  }

  return (
    <div className="eqp">
      <div className="eqp-cab">
        <div className="eqp-mig"><a href="/torre?aba=visao">Torre de Controle</a> › Equipe</div>
        <h1 className="eqp-titulo">{TITULO_EQUIPE}</h1>
      </div>
      <div className="eqp-nota">{TEXTO_EXPLICATIVO}</div>

      <EquipeTabela dados={dados} acoes={{
        podeEditar: !!permissoes?.editar, ocupado, diasSim, onDias: setDiasSim,
        onMarcar: setAusencia, onCancelar: (p) => void cancelarAusencia(p), onMover: setMover, onSimular: (p) => void simular(p),
        onDistribuir: () => void distribuir(), onRedistribuir: () => void redistribuir(),
      }} />

      {sim && <EquipeSimulacao sim={sim} podeEditar={!!permissoes?.editar} ocupado={ocupado} onAplicar={() => void aplicar()} onFechar={() => setSim(null)} />}

      <EquipePrevisao previsao={dados.previsao} pessoas={dados.pessoas} />

      {ausencia && <AusenciaModal pessoa={ausencia} onFechar={() => setAusencia(null)} onFeito={() => { avisar(toastAusenciaMarcada(ausencia.nome)); setAusencia(null); atualizar() }} />}
      {mover && <MoverModal origem={mover} pessoas={dados.pessoas} onFechar={() => setMover(null)}
        onFeito={(r) => { avisar(toastCarteiraMovida(mover.nome, r), r.desfazer); setMover(null); atualizar() }} />}
    </div>
  )
}

