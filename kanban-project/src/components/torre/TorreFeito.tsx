"use client"
// src/components/torre/TorreFeito.tsx — visão FEITO: concluídas dos últimos 14 dias (GET /api/operacao/tarefas?visao=feito&escopo=equipe),
// agrupadas Hoje / Ontem / Antes por `concluidaEm` e depois por família — a mesma derivação de `AbaFeito` da Operação. Somente leitura + Abrir.
import { useMemo } from "react"
import { agruparPorFamilia, docTipoTxt, orgaoTxt, fmtData } from "@/src/components/operacao/operacao-v3-derivacoes"
import type { LinhaOperacaoV3 } from "@/src/components/operacao/operacao-v3-tipos"

export function TorreFeito({ linhas, onAbrir }: { linhas: LinhaOperacaoV3[]; onAbrir: (l: LinhaOperacaoV3) => void }) {
  const blocos = useMemo(() => {
    const agora = new Date()
    const hojeStr = agora.toDateString(); const ontemStr = new Date(agora.getTime() - 86_400_000).toDateString()
    const hoje = linhas.filter((l) => l.concluidaEm && new Date(l.concluidaEm).toDateString() === hojeStr)
    const ontem = linhas.filter((l) => l.concluidaEm && new Date(l.concluidaEm).toDateString() === ontemStr)
    const antes = linhas.filter((l) => !hoje.includes(l) && !ontem.includes(l))
    return [{ titulo: "Hoje", rows: hoje }, { titulo: "Ontem", rows: ontem }, { titulo: "Antes", rows: antes }].filter((b) => b.rows.length > 0)
  }, [linhas])

  if (blocos.length === 0) return <div className="tor-card pad small">Nenhuma tarefa concluída nos últimos 14 dias.</div>
  return (
    <>
      {blocos.map((b) => (
        <div key={b.titulo}>
          <div className="tor-bar"><b>{b.titulo}</b><span className="tor-p grn">{b.rows.length} concluída(s)</span></div>
          {agruparPorFamilia(b.rows).map((g) => (
            <div key={g.fam} className="tor-card tor-scroll">
              <div className="tor-grp"><b>{g.fam}</b><div style={{ flexGrow: 1 }} /><span className="tor-p gry">{g.linhas.length} tarefas</span></div>
              <div className="tor-hd tor-gFe"><span>Certidão · pessoa</span><span>Concluída em</span><span>Prazo da tarefa</span><span>Órgão</span><span /></div>
              {g.linhas.map((l) => (
                <div key={l.taskId} className="tor-row tor-gFe">
                  <div><b>{docTipoTxt(l)}</b><div className="small">{l.pessoaNome ?? l.casalNomes ?? "—"} · #{l.taskId}</div></div>
                  <div><span className="tor-p grn">{fmtData(l.concluidaEm)}</span></div>
                  <div className="small">{l.rotuloDoPrazo || "—"}</div>
                  <div className="small">{orgaoTxt(l)}</div>
                  <div><button className="tor-btn pri" onClick={() => onAbrir(l)}>Abrir</button></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
