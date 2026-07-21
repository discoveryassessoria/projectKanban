// src/components/financeiro/receita-modal/ReceitaInformacoesTecnicasTab.tsx
// ============================================================================
// Tudo que é de suporte/auditoria e NÃO pertence à leitura principal: regra,
// tabela de preços, vigência, serviço, evento operacional, chave idempotente,
// documento, datas, identificadores e supressão. Seções expansíveis.
// ============================================================================
'use client'

import { useState, type ReactNode } from 'react'
import { fmtData } from '@/lib/financeiro/apresentacao-lancamento'
import { fmtDataHora, type Detalhe } from './tipos'

function Secao({ titulo, aberta, children }: { titulo: string; aberta?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!aberta)
  return (
    <div className="rfm-expansivel">
      <button type="button" className="rfm-expansivel-botao" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{titulo}</span>
        <span className={`rfm-expansivel-seta${open ? ' aberta' : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && <div className="rfm-expansivel-corpo">{children}</div>}
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
}

export function ReceitaInformacoesTecnicasTab({ detalhe }: ReceitaInformacoesTecnicasTabProps) {
  const o = detalhe.origem
  const tabela = o.tabelaPrecos

  return (
    <div>
      <Secao titulo="Regra financeira" aberta>
        <div className="rfm-pares">
          <Par rotulo="Descrição" valor={o.regraFinanceira?.descricao ?? '—'} />
          <Par rotulo="Tipo da regra" valor={o.regraFinanceira?.ruleKind ?? '—'} />
          <Par rotulo="Fonte da regra" valor={o.regraFinanceira?.ruleSource ?? '—'} />
          <Par rotulo="Identificador da regra" valor={o.regraFinanceira?.ruleId != null ? `#${o.regraFinanceira.ruleId}` : '—'} />
          <Par rotulo="Origem ativa" valor={detalhe.origemAtiva ? 'Sim' : 'Não'} />
        </div>
      </Secao>

      <Secao titulo="Tabela de preços e vigência">
        <div className="rfm-pares">
          <Par rotulo="Tabela" valor={tabela ? `#${tabela.id}` : '—'} />
          <Par rotulo="Modo de cálculo" valor={tabela?.modoCalculo ?? '—'} />
          <Par rotulo="Natureza" valor={tabela?.natureza ?? '—'} />
          <Par rotulo="Vigência" valor={tabela ? `${tabela.vigenciaInicio ?? '—'} → ${tabela.vigenciaFim ?? 'sem fim'}` : '—'} />
          <Par rotulo="Arquivada" valor={tabela ? (tabela.arquivado ? 'Sim' : 'Não') : '—'} />
          <Par rotulo="Data de aplicação" valor={o.dataReferencia ? fmtData(o.dataReferencia) : '—'} />
        </div>
      </Secao>

      <Secao titulo="Serviço e evento operacional">
        <div className="rfm-pares">
          <Par rotulo="Serviço" valor={o.servico ?? '—'} />
          <Par rotulo="Configuração financeira" valor={o.configuracaoFinanceira ? `${o.configuracaoFinanceira.nome} (${o.configuracaoFinanceira.moedaPadrao})` : '—'} />
          <Par rotulo="Evento operacional" valor={o.eventoOperacional ?? '—'} />
          <Par rotulo="Fase técnica" valor={o.phaseKey ?? '—'} />
          <Par rotulo="Documento relacionado" valor={o.documento ? `#${o.documento.id} ${o.documento.tipo ?? ''}`.trim() : '—'} />
        </div>
      </Secao>

      <Secao titulo="Rastreabilidade">
        <div className="rfm-pares">
          <Par rotulo="Código do lançamento" valor={<span className="rfm-mono">{detalhe.receita.codigo}</span>} />
          <Par rotulo="Identificador interno" valor={<span className="rfm-mono">#{detalhe.receita.id}</span>} />
          <Par rotulo="Criado em" valor={fmtDataHora(o.criadoEm)} />
          <Par rotulo="Última reconciliação" valor={fmtDataHora(o.atualizadoEm)} />
        </div>
        <div style={{ marginTop: 18 }}>
          <div className="rfm-par-rotulo">Chaves e metadados do motor</div>
          <pre className="rfm-json" style={{ marginTop: 8 }}>{JSON.stringify(o.tecnico, null, 2)}</pre>
        </div>
      </Secao>

      {(detalhe.supressao || detalhe.cancelamento || detalhe.estorno) && (
        <Secao titulo="Supressão, cancelamento e estorno">
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
