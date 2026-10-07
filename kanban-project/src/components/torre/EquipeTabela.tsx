"use client"
// src/components/torre/EquipeTabela.tsx — a tabela "Quem está carregando o quê" + o rodapé de sugestão (Torre nova, aba Equipe).
// Pinta o que /api/torre/equipe devolve; nenhuma conta aqui (as regras de texto/cor vivem em equipe-visual.ts).
import {
  COLUNAS_DA_TABELA, atrasadasEmAlerta, barraDaCarga, filaVisual, pedacosDaSugestao, textoDaCarga, textoDoPapel,
} from "./equipe-visual"
import type { DadosDaEquipe, PessoaDaEquipe } from "./equipe-tipos"
import "./equipe.css"

export interface AcoesDaTabela {
  podeEditar: boolean; ocupado: boolean; diasSim: number
  onDias: (n: number) => void
  onMarcar: (p: PessoaDaEquipe) => void
  onCancelar: (p: PessoaDaEquipe) => void
  onMover: (p: PessoaDaEquipe) => void
  onSimular: (p: PessoaDaEquipe) => void
  onDistribuir: () => void
  onRedistribuir: () => void
}

function LinhaDaPessoa({ p, agora, acoes }: { p: PessoaDaEquipe; agora: string; acoes: AcoesDaTabela }) {
  const barra = p.carga.limite != null ? barraDaCarga(p.carga.executaveis, p.carga.limite) : null
  const fila = filaVisual(p.fila.semanas, p.carga.executaveis)
  const ehAdmin = p.papel.toLowerCase() === "administrador"
  const titulo = p.aptidoes.length ? `Unidades de trabalho: ${p.aptidoes.join(", ")}` : undefined
  return (
    <div className="eqp-grade eqp-row" data-pessoa={p.usuarioId}>
      <div className="eqp-pessoa">
        <span className="eqp-nome">{p.nome}</span>
        <span className="eqp-sub" title={titulo}>{textoDoPapel({ ...p, ehAdministrador: ehAdmin }, agora)}</span>
      </div>
      <div className="eqp-carga">
        <span className="eqp-carga-txt">{textoDaCarga(p.carga.executaveis, p.carga.limite, p.carga.fechaPorSemana)}</span>
        <div className="eqp-barra" aria-hidden="true">{barra && <i className={barra.cor} style={{ width: `${barra.largura}%` }} />}</div>
      </div>
      <div className="eqp-n">{p.ativas}</div>
      <div className={`eqp-n${atrasadasEmAlerta(p.atrasadas) ? " forte" : ""}`}>{p.atrasadas}</div>
      <div className="eqp-n leve">{p.aguardando}</div>
      <div><span className={`eqp-selo ${fila.cor}`}>{fila.texto}</span></div>
      <div className="eqp-acoes">
        {p.ausencia
          ? <button className="eqp-btn" onClick={() => acoes.onCancelar(p)}>Cancelar ausência</button>
          : <button className="eqp-btn" onClick={() => acoes.onMarcar(p)}>Marcar ausência</button>}
        {acoes.podeEditar && <button className="eqp-btn" disabled={p.ativas === 0} title={p.ativas === 0 ? "Nada a mover" : undefined} onClick={() => acoes.onMover(p)}>Mover carteira</button>}
        <button className="eqp-btn" disabled={acoes.ocupado} onClick={() => acoes.onSimular(p)}>Simular saída</button>
      </div>
    </div>
  )
}

function LinhaSemResponsavel({ dados, acoes }: { dados: DadosDaEquipe; acoes: AcoesDaTabela }) {
  const sr = dados.semResponsavel
  const plano = dados.sugestao.semResponsavel
  const podeDistribuir = plano.porPessoa.length > 0
  return (
    <div className="eqp-grade eqp-row" data-pessoa="sem-responsavel">
      <div className="eqp-pessoa">
        <span className="eqp-nome sem">Sem responsável</span>
        <span className="eqp-sub">—</span>
      </div>
      <div className="eqp-carga">
        <span className="eqp-carga-txt">{sr.ativas} sem dono</span>
        <div className="eqp-barra" aria-hidden="true">{sr.ativas > 0 && <i className="verm" style={{ width: "100%" }} />}</div>
      </div>
      <div className="eqp-n">{sr.ativas}</div>
      <div className={`eqp-n${atrasadasEmAlerta(sr.atrasadas) ? " forte" : ""}`}>{sr.atrasadas}</div>
      <div className="eqp-n leve">{sr.aguardando}</div>
      <div><span className={`eqp-selo ${sr.ativas > 0 ? "red" : "grn"}`}>{sr.ativas > 0 ? "distribuir" : "livre"}</span></div>
      <div className="eqp-acoes">
        {sr.ativas > 0 && acoes.podeEditar && (
          <button className="eqp-btn pri" disabled={acoes.ocupado || !podeDistribuir}
            title={podeDistribuir ? undefined : "Nenhuma tem apto comprovado com carga livre: continuam no Precisa de você"} onClick={acoes.onDistribuir}>
            Distribuir as {sr.ativas} por aptidão e carga
          </button>
        )}
        {sr.ativas > 0 && acoes.podeEditar && !podeDistribuir && <span className="eqp-aviso">nenhuma tem apto comprovado com carga livre</span>}
      </div>
    </div>
  )
}

export function EquipeTabela({ dados, acoes }: { dados: DadosDaEquipe; acoes: AcoesDaTabela }) {
  const nomes = dados.pessoas.map((p) => p.nome)
  const pedacos = pedacosDaSugestao(dados.sugestao, nomes)
  return (
    <div className="eqp-card">
      <div className="eqp-scroll">
        <div className="eqp-grade eqp-hd">{COLUNAS_DA_TABELA.map((c) => <div key={c}>{c}</div>)}</div>
        {dados.pessoas.length === 0 && <div className="eqp-row eqp-nota">Nenhuma pessoa executa trabalho ainda.</div>}
        {dados.pessoas.map((p) => <LinhaDaPessoa key={p.usuarioId} p={p} agora={dados.agora} acoes={acoes} />)}
        <LinhaSemResponsavel dados={dados} acoes={acoes} />
      </div>
      <div className="eqp-rodape">
        <span>{pedacos.map((x, i) => (x.destaque ? <b key={i}>{x.texto}</b> : <span key={i}>{x.texto}</span>))}</span>
        {dados.sugestao.temAcao && acoes.podeEditar && <button className="eqp-btn pq" disabled={acoes.ocupado} onClick={acoes.onRedistribuir}>Redistribuir</button>}
        <span>· Dias da simulação de saída</span>
        <input type="number" min={1} max={365} className="eqp-dias" aria-label="Dias da simulação" value={acoes.diasSim}
          onChange={(e) => acoes.onDias(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
      </div>
    </div>
  )
}

