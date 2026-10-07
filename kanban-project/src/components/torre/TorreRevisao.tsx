"use client"
// src/components/torre/TorreRevisao.tsx — REVISAR O DIA (Bloco J2; Torre nova, frente B2): percorre as decisões do "Precisa de você" uma a
// uma, na ordem da lista, como no protótipo: "Revisar o dia · N de T", barra de progresso, "N decididas · N puladas", o cartão do item
// (selo, título, detalhe, "Sugestão: …") e Sair · Abrir o processo · Pular · botão 2 · botão 1. Cada botão executa a MESMA ação da tabela
// (porta canônica, auditada); "Pular" não grava nada e não abre aviso. A lista é uma FOTO tirada ao abrir: o que já foi decidido não
// desloca os itens seguintes. Sem estado no servidor — reabrir sempre começa do 1.
import { useState } from "react"
import { PdvModal } from "./pdv-modal"
import { ROTULO_TIPO, PILL_DO_TIPO, type ItemPrecisa } from "./tipos-precisa"
import { useAcoesDoItem } from "./acoes-do-item"

export function TorreRevisao({ itens, irParaAba, onSair }: { itens: ItemPrecisa[]; irParaAba: (aba: "equipe") => void; onSair: () => void }) {
  const { executar, modais, limparToast } = useAcoesDoItem({ irParaAba })
  const [i, setI] = useState(0)
  const [decididas, setDecididas] = useState(0)
  const [puladas, setPuladas] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const total = itens.length
  const item = itens[i]
  const fim = i >= total

  const decidir = async (qual: 1 | 2) => {
    setOcupado(true)
    const resumo = await executar(item, qual)
    setOcupado(false)
    // Cancelou ou a porta recusou (o erro já foi mostrado): o item continua na tela, nada avança.
    if (resumo == null) return
    setDecididas((n) => n + 1)
    setI((n) => n + 1)
  }
  const pular = () => { limparToast(); setPuladas((n) => n + 1); setI((n) => n + 1) }

  const posicao = Math.min(i + 1, total)
  const largura = total === 0 ? 100 : Math.round((Math.min(i, total) / total) * 100)

  return (
    <>
      <PdvModal rotulo="Revisar o dia" classe="rev" onFechar={ocupado ? () => undefined : onSair}>
        <div className="pdv-rev-topo">
          <div className="pdv-modal-t">Revisar o dia · {posicao} de {total}</div>
          <div className="pdv-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={largura}><i style={{ width: `${largura}%` }} /></div>
          <div className="pdv-contas">{decididas} decididas · {puladas} puladas</div>
        </div>
        {fim ? (
          <>
            <div className="pdv-rev-fim">
              Revisão concluída. Decisões tomadas: {decididas}. Puladas: {puladas}. Tudo ficou registrado no histórico de cada processo.
            </div>
            <div className="pdv-brief-ac"><button className="pdv-m1" onClick={onSair}>Fechar</button></div>
          </>
        ) : (
          <>
            <div className="pdv-cartao">
              <div><span className={`tor-p ${PILL_DO_TIPO[item.tipo]}`}>{ROTULO_TIPO[item.tipo] ?? item.tipo}</span></div>
              <div className="pdv-cartao-t">{item.titulo}</div>
              <div className="pdv-cartao-d">{item.detalhe}</div>
              {item.sugestao && <div className="pdv-cartao-s"><b>Sugestão:</b> {item.sugestao}</div>}
            </div>
            <div className="pdv-rodape-m">
              <button className="pdv-m3" onClick={onSair} disabled={ocupado}>Sair</button>
              {/* Em outra aba: o modal continua aberto, na mesma posição, quando a pessoa volta (como no protótipo). */}
              <a href={item.link} target="_blank" rel="noopener noreferrer">Abrir o processo</a>
              <span className="espaco" />
              <button className="pdv-m3" onClick={pular} disabled={ocupado}>Pular</button>
              <button className="pdv-m2" onClick={() => void decidir(2)} disabled={ocupado}>{item.acao2.rotulo}</button>
              <button className="pdv-m1" onClick={() => void decidir(1)} disabled={ocupado}>{item.acao1.rotulo}</button>
            </div>
          </>
        )}
      </PdvModal>
      {modais}
    </>
  )
}
