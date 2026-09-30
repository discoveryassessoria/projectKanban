"use client"
// src/components/torre/TorreRevisao.tsx — REVISAR O DIA (Bloco J2): percorre os itens do "Precisa de você" um a um,
// na ordem da lista. Cada botão executa a MESMA ação da tabela; "Pular" não faz nada. Sem estado de sessão no servidor:
// a lista é uma FOTO tirada ao abrir, para o que já foi decidido não deslocar os itens seguintes.
import { useState } from "react"
import { Modal } from "./torre-base"
import { ROTULO_TIPO, PILL_DA_FAIXA, type ItemPrecisa } from "./tipos-precisa"
import { useAcoesDoItem } from "./acoes-do-item"

export function TorreRevisao({ itens, irParaAba, onSair }: { itens: ItemPrecisa[]; irParaAba: (aba: "equipe") => void; onSair: () => void }) {
  const { executar, modais } = useAcoesDoItem({ irParaAba })
  const [i, setI] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const item = itens[i]
  const fim = i >= itens.length

  const decidir = async (qual: 1 | 2) => {
    setOcupado(true)
    const resumo = await executar(item, qual)
    setOcupado(false)
    // Cancelou ou a porta recusou (o erro já foi mostrado): o item continua na tela, nada avança.
    if (resumo == null) return
    setLog((l) => [...l, `#${item.tarefaId ?? item.processoId ?? "—"} ${resumo}`])
    setI((n) => n + 1)
  }
  const pular = () => { setLog((l) => [...l, "pulou"]); setI((n) => n + 1) }

  return (
    <>
      <Modal
        titulo={fim ? "Revisar o dia" : `Revisar o dia · ${i + 1} de ${itens.length}`} onFechar={onSair} ocupado={ocupado}
        rodape={fim ? <button className="tor-btn pri" onClick={onSair}>Fechar</button> : (
          <>
            <button className="tor-btn" onClick={onSair} disabled={ocupado}>Sair</button>
            <button className="tor-btn" onClick={pular} disabled={ocupado}>Pular</button>
            <button className="tor-btn" onClick={() => void decidir(2)} disabled={ocupado}>{item.acao2.rotulo}</button>
            <button className="tor-btn pri" onClick={() => void decidir(1)} disabled={ocupado}>{item.acao1.rotulo}</button>
          </>
        )}
      >
        {fim ? (
          <div className="space-y-2">
            <b style={{ color: "var(--success-text)", fontSize: 16 }}>Revisão concluída.</b>
            <div>Decisões tomadas: {log.length ? log.join(" · ") : "nenhuma"}.</div>
          </div>
        ) : (
          <div className="space-y-2">
            <span className={`tor-p ${PILL_DA_FAIXA[item.faixa]}`}>{ROTULO_TIPO[item.tipo] ?? item.tipo}</span>
            <div><b>{item.titulo}</b></div>
            <div className="small">{item.detalhe}</div>
            {item.sugestao && <div className="small"><b>Sugestão:</b> {item.sugestao}</div>}
          </div>
        )}
      </Modal>
      {modais}
    </>
  )
}
