"use client"
// src/components/torre/TorreProcessoPagina.tsx — o PROCESSO como PÁGINA (`/torre/processo/[id]`) — Torre nova, Etapa A.
// CASCA SIMPLES: a trilha (Torre › Processos › família), o cabeçalho do processo com dados REAIS (`/api/torre/foco/{id}`: família,
// país, código, fase, certidões, os 4 números e o selo "Pausado") e o acesso ao Foco completo (tarefas, histórico, comentários)
// enquanto o dono do detalhe (H) preenche o resto da página. Nada daqui escreve: só lê.
import Link from "next/link"
import { useEffect, useState } from "react"
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import { api, erroDe, fmtDataHora, TorreProvider } from "./torre-base"
import { FocoFamilia } from "./FocoFamilia"
import "./torre.css"

interface PausaDoProcesso { motivo: string; pausadoEm: string; pausadoPor: { nome: string } | null }
interface FocoDaPagina {
  processoId: number; familiaNome: string; pais: string | null; codigo: string | null
  faseAtual: { label: string | null; dias: number | null; horas: number | null; desde: string | null; origem: string | null }
  certidoes: { recebidas: number; requeridas: number }
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  pausa: PausaDoProcesso | null
}

export function TorreProcessoPagina({ processoId }: { processoId: number }) {
  const [foco, setFoco] = useState<FocoDaPagina | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    let vivo = true
    void api<FocoDaPagina>(`/api/torre/foco/${processoId}`).then((r) => {
      if (!vivo) return
      if (r.ok) { setFoco(r.data); setErro(null) } else setErro(erroDe(r.data, "Não foi possível abrir o processo."))
    })
    return () => { vivo = false }
  }, [processoId])

  return (
    <TorreProvider permissoes={null} recarregar={() => {}}>
      <div className="tor">
        <nav className="small mb-3" aria-label="Trilha">
          <Link href="/torre">Torre de Controle</Link> › <Link href="/torre?aba=processos">Processos</Link> › <span>{foco?.familiaNome ?? `Processo #${processoId}`}</span>
        </nav>
        {erro && <div className="tor-card pad">{erro}</div>}
        {!erro && !foco && <div className="tor-card pad small">Carregando o processo…</div>}
        {foco && (
          <div className="tor-card pad">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-extrabold" style={{ fontSize: 20 }}>{foco.familiaNome}</h1>
              {foco.pausa && <span className="tor-p amb" title={`Pausado em ${fmtDataHora(foco.pausa.pausadoEm)}${foco.pausa.pausadoPor ? ` por ${foco.pausa.pausadoPor.nome}` : ""}: ${foco.pausa.motivo}`}>Pausado</span>}
            </div>
            <div className="small">{foco.pais ?? "—"} · {foco.codigo ?? "—"}</div>
            <div className="mt-2">{foco.faseAtual.label ?? "—"} · {foco.certidoes.recebidas} de {foco.certidoes.requeridas} certidões recebidas
              <span className="small"> · {foco.faseAtual.desde ? `na fase há ${textoTempoNaFase(foco.faseAtual)}` : "sem registro de quando entrou na fase"}</span></div>
            {foco.pausa && <div className="small mt-1">Fora da Torre desde {fmtDataHora(foco.pausa.pausadoEm)} — {foco.pausa.motivo}</div>}
            <div className="tor-num">
              <div><b>{foco.numeros.abertas}</b><span>Abertas</span></div>
              <div><b>{foco.numeros.vencidas}</b><span>Vencidas</span></div>
              <div><b>{foco.numeros.comCartorio}</b><span>Aguardando terceiros</span></div>
              <div><b>{foco.numeros.semResponsavel}</b><span>Sem responsável</span></div>
            </div>
            <button type="button" className="tor-btn pri" onClick={() => setAberto(true)}>Ver tarefas, histórico e comentários</button>
          </div>
        )}
        {aberto && <FocoFamilia processoId={processoId} onFechar={() => setAberto(false)} />}
      </div>
    </TorreProvider>
  )
}
