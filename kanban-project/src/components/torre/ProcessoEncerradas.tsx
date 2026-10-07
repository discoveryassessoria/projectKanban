"use client"
// src/components/torre/ProcessoEncerradas.tsx — "Cancelada / não exigida" do processo: a lista que o card abre.
// As CANCELADAS são as da aba Tarefas (a MESMA consulta `listarCanceladasDaTorre`: o número do card = o tamanho desta lista); as certidões
// inativas SEM tarefa (a árvore deixou de exigir) vêm separadas, nunca somadas. Cancelar nunca esconde: motivo, histórico e Reabrir (cancelada
// por decisão humana) ficam aqui — as ações de TRABALHO e de atribuição moram na tabela de tarefas (que é a da aba Tarefas).
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"
import type { LinhaDaTabela } from "@/lib/operacional/torre-processo-puro"

export function ProcessoEncerradas({ d, podeEditar, ocupado, onMotivo, onHistorico, onReabrir }: {
  d: DetalheDoProcesso; podeEditar: boolean; ocupado: boolean
  onMotivo: (l: LinhaDaTabela) => void; onHistorico: (l: LinhaDaTabela) => void; onReabrir: (l: LinhaDaTabela) => void
}) {
  const todas = d.tabela.filter((l) => l.tipo === "CANCELADA" || l.tipo === "NAO_EXIGIDA")
  const canceladas = todas.filter((l) => l.tipo === "CANCELADA" && !l.semTarefa)
  const semTarefa = todas.filter((l) => l.semTarefa)
  const grupo = (titulo: string, linhas: LinhaDaTabela[], testid: string) => linhas.length === 0 ? null : (
    <div data-testid={testid}>
      <div className="tpr-resumo" style={{ borderTop: "1px solid var(--border-default)", borderBottom: 0 }}><b>{titulo} · {linhas.length}</b></div>
      {linhas.map((l) => (
        <div key={l.chave} className="tpr-grade tpr-tr fora" data-linha={l.chave} data-fora={l.tipo === "NAO_EXIGIDA" ? "nao_exigida" : "cancelada"} style={{ minWidth: 0 }}>
          <div />
          <div className="cert"><b>{l.titulo}</b><span>{l.pessoa ?? "Processo inteiro"}{l.geracao ? ` · ${l.geracao}` : ""} · {l.encerramentoTexto}</span></div>
          <div className="tpr-c-mut">{l.fase?.label ?? "—"}</div>
          <div><span className="tpr-pill fora">{l.statusRotulo}</span></div>
          <div>—</div><div>—</div><div>—</div><div>—</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="tpr-linkbtn" onClick={() => onMotivo(l)}>Motivo</button>
            <button type="button" className="tpr-linkbtn" onClick={() => onHistorico(l)}>Histórico</button>
            {l.reabrivel && <button type="button" className="tpr-linkbtn" disabled={ocupado || !podeEditar} onClick={() => onReabrir(l)}>Reabrir</button>}
          </div>
        </div>
      ))}
    </div>
  )
  return (
    <div className="tpr-tab" data-testid="encerradas-do-processo">
      <div className="tpr-tab-cab"><div className="t">Canceladas · {canceladas.length}{semTarefa.length > 0 ? ` (+ ${semTarefa.length} sem tarefa)` : ""}</div></div>
      <div className="tpr-scroll">
        {todas.length === 0 && <div className="tpr-vazio">Nada cancelado nem dispensado pela árvore.</div>}
        {grupo("Tarefas canceladas (as mesmas da aba Tarefas)", canceladas, "grupo-canceladas")}
        {grupo("Certidões sem tarefa — a árvore deixou de exigir", semTarefa, "grupo-sem-tarefa")}
      </div>
    </div>
  )
}
