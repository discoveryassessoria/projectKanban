"use client"
// src/components/torre/ProcessoFatos.tsx — "Últimos fatos" do Detalhe do Processo: os 4 fatos mais recentes do HISTÓRICO DO PROCESSO
// (a MESMA fonte da aba Histórico e do Foco: `/api/torre/foco/{id}/historico` → `src/services/historico-processo.ts`), sem recontar nada.
import { useEffect, useState } from "react"
import type { FatoDoHistorico } from "@/lib/operacional/historico-processo"
import { rotuloQuando } from "@/lib/operacional/torre-processo-puro"
import { api } from "./torre-base"

export const QUANTOS_FATOS = 4

/** Tira o nome de quem fez do começo da frase (a tela o põe em negrito à parte). */
function semOAutor(frase: string, nome: string): string {
  const f = frase.trim()
  return f.startsWith(nome) ? f.slice(nome.length).trim() : f
}

export function ProcessoFatos({ processoId, agora, versao, onVerTudo }: { processoId: number; agora: Date; versao: number; onVerTudo: () => void }) {
  const [fatos, setFatos] = useState<FatoDoHistorico[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void api<{ fatos: FatoDoHistorico[] }>(`/api/torre/foco/${processoId}/historico`).then((r) => {
      if (!vivo) return
      if (r.ok) { setFatos(r.data.fatos ?? []); setErro(null) } else setErro("Não foi possível ler o histórico agora.")
    })
    return () => { vivo = false }
  }, [processoId, versao])

  // Marcos do processo: o que o Sistema faz por baixo (`automatico`) fica de fora, como no Histórico.
  const ultimos = (fatos ?? []).filter((f) => !f.automatico).sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando)).slice(0, QUANTOS_FATOS)

  return (
    <div className="tpr-bloco" style={{ padding: "14px 18px", gap: 10 }}>
      <div className="tpr-bloco-cab">
        <div className="t">Últimos fatos</div>
        <button type="button" className="tpr-linkbtn" onClick={onVerTudo}>Ver histórico completo</button>
      </div>
      {erro && <div className="tpr-13 tpr-mut">{erro}</div>}
      {!erro && fatos == null && <div className="tpr-13 tpr-mut">Carregando…</div>}
      {!erro && fatos != null && ultimos.length === 0 && <div className="tpr-13 tpr-mut">Nenhum fato registrado ainda.</div>}
      <div className="tpr-fatos">
        {ultimos.map((f) => (
          <div key={f.id} className="tpr-fato">
            <span className="qd">{rotuloQuando(f.quando, agora)}</span>
            <span><b>{f.quem.nome}</b> {semOAutor(f.nucleo, f.quem.nome)}{f.motivo ? <> · &ldquo;{f.motivo}&rdquo;</> : null}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
