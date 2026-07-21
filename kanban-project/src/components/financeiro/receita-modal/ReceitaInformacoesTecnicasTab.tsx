// src/components/financeiro/receita-modal/ReceitaInformacoesTecnicasTab.tsx
// ============================================================================
// Tudo que é de suporte/auditoria e NÃO pertence à leitura principal: regra,
// tabela de preços, vigência, serviço, evento operacional, chaves e
// rastreabilidade. Seções expansíveis e endereçáveis — a Origem e o menu
// abrem aqui a seção correspondente. Somente leitura.
// ============================================================================
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { fmtData } from '@/lib/financeiro/apresentacao-lancamento'
import { fmtDataHora, type Detalhe } from './tipos'

export type SecaoTecnica = 'regra' | 'tabela' | 'servico' | 'rastreio' | 'excecoes'

function Secao({
  id,
  titulo,
  aberta,
  onToggle,
  children,
}: {
  id: SecaoTecnica
  titulo: string
  aberta: boolean
  onToggle: (id: SecaoTecnica) => void
  children: ReactNode
}) {
  return (
    <div className="rfm-expansivel" id={`rfm-tec-${id}`}>
      <button type="button" className="rfm-expansivel-botao" aria-expanded={aberta} onClick={() => onToggle(id)}>
        <span>{titulo}</span>
        <span className={`rfm-expansivel-seta${aberta ? ' aberta' : ''}`} aria-hidden="true">▸</span>
      </button>
      {aberta && <div className="rfm-expansivel-corpo">{children}</div>}
    </div>
  )
}

function Par({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div>
      <div className="rfm-par-rotulo">{rotulo}</div>
      <div className="rfm-par-valor">{valor ?? '—'}</div>
    </div>
  )
}

export interface ReceitaInformacoesTecnicasTabProps {
  detalhe: Detalhe
  secaoInicial?: SecaoTecnica | null
  onCopiar: (texto: string, rotulo: string) => void
}

export function ReceitaInformacoesTecnicasTab({
  detalhe,
  secaoInicial,
  onCopiar,
}: ReceitaInformacoesTecnicasTabProps) {
  const [abertas, setAbertas] = useState<SecaoTecnica[]>(['regra'])

  useEffect(() => {
    if (!secaoInicial) return
    setAbertas((s) => (s.includes(secaoInicial) ? s : [...s, secaoInicial]))
    // rola até a seção pedida sem mover o fundo
    const el = document.getElementById(`rfm-tec-${secaoInicial}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [secaoInicial])

  const alternar = (id: SecaoTecnica) =>
    setAbertas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const aberta = (id: SecaoTecnica) => abertas.includes(id)

  const o = detalhe.origem
  const tabela = o.tabelaPrecos

  return (
    <div>
      <Secao id="regra" titulo="Regra financeira" aberta={aberta('regra')} onToggle={alternar}>
        <div className="rfm-pares">
          <Par rotulo="Descrição" valor={o.regraFinanceira?.descricao ?? '—'} />
          <Par rotulo="Tipo da regra" valor={o.regraFinanceira?.ruleKind ?? '—'} />
          <Par rotulo="Fonte da regra" valor={o.regraFinanceira?.ruleSource ?? '—'} />
          <Par rotulo="Identificador da regra" valor={o.regraFinanceira?.ruleId != null ? `#${o.regraFinanceira.ruleId}` : '—'} />
          <Par rotulo="Origem ativa" valor={detalhe.origemAtiva ? 'Sim' : 'Não'} />
        </div>
        {o.regraFinanceira?.ruleId != null && (
          <button
            type="button"
            className="rfm-btn-txt"
            onClick={() => onCopiar(String(o.regraFinanceira?.ruleId), 'Identificador da regra')}
          >
            Copiar identificador da regra
          </button>
        )}
      </Secao>

      <Secao id="tabela" titulo="Tabela de preços e vigência" aberta={aberta('tabela')} onToggle={alternar}>
        <div className="rfm-pares">
          <Par rotulo="Tabela" valor={tabela ? `#${tabela.id}` : '—'} />
          <Par rotulo="Modo de cálculo" valor={tabela?.modoCalculo ?? '—'} />
          <Par rotulo="Natureza" valor={tabela?.natureza ?? '—'} />
          <Par rotulo="Vigência" valor={tabela ? `${tabela.vigenciaInicio ?? '—'} → ${tabela.vigenciaFim ?? 'sem fim'}` : '—'} />
          <Par rotulo="Arquivada" valor={tabela ? (tabela.arquivado ? 'Sim' : 'Não') : '—'} />
          <Par rotulo="Data de aplicação" valor={o.dataReferencia ? fmtData(o.dataReferencia) : '—'} />
        </div>
      </Secao>

      <Secao id="servico" titulo="Serviço e evento operacional" aberta={aberta('servico')} onToggle={alternar}>
        <div className="rfm-pares">
          <Par rotulo="Serviço" valor={o.servico ?? '—'} />
          <Par
            rotulo="Configuração financeira"
            valor={o.configuracaoFinanceira ? `${o.configuracaoFinanceira.nome} (${o.configuracaoFinanceira.moedaPadrao})` : '—'}
          />
          <Par rotulo="Evento operacional" valor={o.eventoOperacional ?? '—'} />
          <Par rotulo="Fase técnica" valor={o.phaseKey ?? '—'} />
          <Par rotulo="Documento relacionado" valor={o.documento ? `#${o.documento.id} ${o.documento.tipo ?? ''}`.trim() : '—'} />
          <Par rotulo="Processo" valor={o.processo ? `${o.processo.codigo ?? o.processo.nome} · ${o.processo.pais}` : '—'} />
        </div>
        {o.eventoOperacional && (
          <button type="button" className="rfm-btn-txt" onClick={() => onCopiar(o.eventoOperacional!, 'Evento operacional')}>
            Copiar evento operacional
          </button>
        )}
      </Secao>

      <Secao id="rastreio" titulo="Rastreabilidade" aberta={aberta('rastreio')} onToggle={alternar}>
        <div className="rfm-pares">
          <Par rotulo="Código do lançamento" valor={<span className="rfm-mono">{detalhe.receita.codigo}</span>} />
          <Par rotulo="Identificador interno" valor={<span className="rfm-mono">#{detalhe.receita.id}</span>} />
          <Par rotulo="Criado em" valor={fmtDataHora(o.criadoEm)} />
          <Par rotulo="Última reconciliação" valor={fmtDataHora(o.atualizadoEm)} />
        </div>
        <div className="rfm-proxima-acoes">
          <button type="button" className="rfm-btn-txt" onClick={() => onCopiar(detalhe.receita.codigo, 'Referência')}>
            Copiar referência
          </button>
          <button type="button" className="rfm-btn-txt" onClick={() => onCopiar(String(detalhe.receita.id), 'ID interno')}>
            Copiar ID interno
          </button>
        </div>
        <div style={{ marginTop: 18 }}>
          <div className="rfm-par-rotulo">Chaves e metadados do motor</div>
          <pre className="rfm-json" style={{ marginTop: 8 }}>{JSON.stringify(o.tecnico, null, 2)}</pre>
        </div>
      </Secao>

      {(detalhe.supressao || detalhe.cancelamento || detalhe.estorno) && (
        <Secao id="excecoes" titulo="Supressão, cancelamento e estorno" aberta={aberta('excecoes')} onToggle={alternar}>
          <div className="rfm-pares">
            {detalhe.supressao && (
              <>
                <Par rotulo="Supressão ativa" valor={detalhe.supressao.ativa ? 'Sim' : 'Não'} />
                <Par rotulo="Motivo da supressão" valor={detalhe.supressao.motivo} />
                <Par rotulo="Suprimido em" valor={fmtDataHora(detalhe.supressao.suprimidoEm)} />
              </>
            )}
            {detalhe.cancelamento && (
              <>
                <Par rotulo="Cancelado em" valor={fmtDataHora(detalhe.cancelamento.em)} />
                <Par rotulo="Motivo do cancelamento" valor={detalhe.cancelamento.motivo ?? '—'} />
                <Par rotulo="Cancelado por" valor={detalhe.cancelamento.por ?? '—'} />
              </>
            )}
            {detalhe.estorno && (
              <>
                <Par rotulo="Estornado em" valor={fmtDataHora(detalhe.estorno.em)} />
                <Par rotulo="Motivo do estorno" valor={detalhe.estorno.motivo ?? '—'} />
              </>
            )}
          </div>
        </Secao>
      )}
    </div>
  )
}

export default ReceitaInformacoesTecnicasTab
