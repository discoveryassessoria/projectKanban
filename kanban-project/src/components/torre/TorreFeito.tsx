"use client"
// src/components/torre/TorreFeito.tsx — a visão FEITO (Torre nova): "Concluídas nos últimos 14 dias · toda a equipe · N certidões" e três
// cartões — Hoje · Ontem · Antes (12 dias) — cada um com a pílula "N concluída(s)" e as colunas Certidão · pessoa, Família, Concluída em,
// Prazo era (verde se cumprido, vermelho se concluída depois), Por quem e o link "Abrir" (leva ao detalhe do Processo). Somente leitura.
// A fonte é a MESMA aba Feito da Operação (`concluidasRecentesDoUsuario`, escopo de equipe) + quem concluiu (LogAuditoria): sem registro, "—".
import Link from "next/link"
import { useMemo } from "react"
import { blocoDoFeito, prazoEraDoFeito, textoConcluidaEm, type BlocoDoFeito } from "@/lib/operacional/torre-tarefas-tela"
import { docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import type { LinhaDoFeito } from "./tarefas-tipos"

const BLOCOS: Array<[BlocoDoFeito, string]> = [["hoje", "Hoje"], ["ontem", "Ontem"], ["antes", "Antes (12 dias)"]]

export function TorreFeito({ linhas, agora }: { linhas: LinhaDoFeito[]; agora: Date }) {
  const blocos = useMemo(() => BLOCOS.map(([k, titulo]) => ({
    titulo, linhas: linhas.filter((l) => blocoDoFeito(l.concluidaEm, agora) === k),
  })).filter((b) => b.linhas.length > 0), [linhas, agora])

  return (
    <>
      <div className="tf-feito-txt">Concluídas nos últimos 14 dias · toda a equipe · {linhas.length} {linhas.length === 1 ? "certidão" : "certidões"}</div>
      {blocos.length === 0 && <div className="tf-card"><span className="tf-vazio">Nenhuma tarefa concluída nos últimos 14 dias.</span></div>}
      {blocos.map((b) => (
        <div key={b.titulo} className="tf-tabela">
          <div className="tf-feito-bloco-t"><span>{b.titulo}</span><span className="tf-pilula verde">{b.linhas.length} concluída(s)</span></div>
          <div className="tf-rolagem">
            <div className="tf-feito-g tf-feito-h"><div>Certidão · pessoa</div><div>Família</div><div>Concluída em</div><div>Prazo era</div><div>Por quem</div><div /></div>
            {b.linhas.map((l) => {
              const prazo = prazoEraDoFeito(l.dataPrazo, l.concluidaEm)
              return (
                <div key={l.taskId} className="tf-feito-g tf-feito-linha">
                  <div className="tf-cert"><b>{docTipoTxt(l)}</b><span className="tf-peq">{l.pessoaNome ?? l.casalNomes ?? "—"}</span></div>
                  <div>{l.familiaNome ?? l.processoNome ?? "—"}</div>
                  <div>{textoConcluidaEm(l.concluidaEm, agora)}</div>
                  <div className={prazo.cumprido === true ? "tf-ok" : prazo.cumprido === false ? "tf-verm" : ""}>{prazo.texto}</div>
                  <div>{l.concluidaPorNome ?? "—"}</div>
                  <div>{l.processoId != null ? <Link className="tf-link" href={`/torre/processo/${l.processoId}`}>Abrir</Link> : null}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
