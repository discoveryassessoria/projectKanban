// src/components/financeiro/receita-modal/ReceitaRecebimentoForm.tsx
// ============================================================================
// Formulário completo de RECEBIMENTO — registrar e editar.
//
// Reutiliza integralmente os endpoints existentes:
//   • registrar → POST /api/financeiro/parcelas/[id]/lancamento
//   • editar    → PATCH /api/financeiro/parcelas/[id]  (campos operacionais)
//   • anexo     → POST /api/storage/presign + PUT no storage
//
// Valor e moeda são do motor: exibidos, nunca editáveis. Data e câmbio ficam
// congelados na edição porque o endpoint operacional não os altera — o caminho
// oficial para corrigir um recebimento lançado é o estorno.
// ============================================================================
'use client'

import { useRef, useState } from 'react'
import { fmtCambio, fmtData, fmtMoeda, num, type Moeda, type ParcelaView } from '@/lib/financeiro/apresentacao-lancamento'
import { cabecalhosAuth } from './tipos'

const FORMAS: Array<{ valor: string; rotulo: string }> = [
  { valor: 'PIX', rotulo: 'PIX' },
  { valor: 'TRANSFERENCIA', rotulo: 'Transferência' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'CARTAO_CREDITO', rotulo: 'Cartão de crédito' },
  { valor: 'CARTAO_DEBITO', rotulo: 'Cartão de débito' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'CHEQUE', rotulo: 'Cheque' },
  { valor: 'OUTRO', rotulo: 'Outro' },
]

export interface ReceitaRecebimentoFormProps {
  modo: 'registrar' | 'editar'
  parcela: ParcelaView
  moeda: Moeda
  cambioReferencia: number
  salvando: boolean
  podeAlterarComprovante: boolean
  podeExcluirComprovante: boolean
  onCancelar: () => void
  onConfirmar: (dados: {
    dataPagamento?: string
    cambioAplicado?: number
    formaPagamento: string | null
    banco: string | null
    observacoes: string | null
    comprovanteUrl: string | null
    comprovanteNome: string | null
  }) => void
}

export function ReceitaRecebimentoForm({
  modo,
  parcela,
  moeda,
  cambioReferencia,
  salvando,
  podeAlterarComprovante,
  podeExcluirComprovante,
  onCancelar,
  onConfirmar,
}: ReceitaRecebimentoFormProps) {
  const registrando = modo === 'registrar'
  const [data, setData] = useState(
    parcela.dataPagamento ? String(parcela.dataPagamento).slice(0, 10) : new Date().toISOString().slice(0, 10),
  )
  const [cambio, setCambio] = useState(String(num(parcela.cambioAplicado) || cambioReferencia))
  const [forma, setForma] = useState(parcela.formaPagamento ?? '')
  const [conta, setConta] = useState(parcela.banco ?? '')
  const [observacoes, setObservacoes] = useState(parcela.observacoes ?? '')
  const [comprovanteUrl, setComprovanteUrl] = useState(parcela.comprovanteUrl ?? null)
  const [comprovanteNome, setComprovanteNome] = useState(parcela.comprovanteNome ?? null)
  const [enviando, setEnviando] = useState(false)
  const [erroAnexo, setErroAnexo] = useState<string | null>(null)
  const arquivo = useRef<HTMLInputElement>(null)

  const valor = num(parcela.valor)
  const taxa = Number(cambio.replace(',', '.'))
  const cambioValido = isFinite(taxa) && taxa > 0

  async function enviarArquivo(file: File) {
    setErroAnexo(null)
    setEnviando(true)
    try {
      const res = await fetch('/api/storage/presign', {
        method: 'POST',
        headers: cabecalhosAuth(),
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          prefix: 'financeiro/comprovantes',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErroAnexo(json?.error ?? `Falha ao preparar o envio (HTTP ${res.status}).`)
        return
      }
      const put = await fetch(json.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) {
        setErroAnexo(`Falha ao enviar o comprovante (HTTP ${put.status}).`)
        return
      }
      setComprovanteUrl(json.publicUrl)
      setComprovanteNome(file.name)
    } catch {
      setErroAnexo('Erro de conexão ao enviar o comprovante.')
    } finally {
      setEnviando(false)
    }
  }

  function confirmar() {
    onConfirmar({
      ...(registrando ? { dataPagamento: data, cambioAplicado: taxa } : {}),
      formaPagamento: forma || null,
      banco: conta.trim() || null,
      observacoes: observacoes.trim() || null,
      comprovanteUrl,
      comprovanteNome,
    })
  }

  return (
    <div className="rfm-form">
      <h3 className="rfm-confirm-titulo">
        {registrando ? 'Registrar recebimento' : 'Editar recebimento'}
      </h3>
      <p className="rfm-confirm-texto">
        Parcela {parcela.numero} · {fmtMoeda(valor, moeda)}
        {!registrando && parcela.dataPagamento ? ` · recebida em ${fmtData(parcela.dataPagamento)}` : ''}
      </p>

      <div className="rfm-form-grade">
        {/* Valor e moeda vêm do motor — leitura. */}
        <div className="rfm-campo">
          <span className="rfm-campo-rotulo">Valor</span>
          <output className="rfm-campo-fixo">{fmtMoeda(valor, moeda)}</output>
        </div>
        <div className="rfm-campo">
          <span className="rfm-campo-rotulo">Moeda</span>
          <output className="rfm-campo-fixo">{moeda}</output>
        </div>

        <label className="rfm-campo">
          <span className="rfm-campo-rotulo">Data do recebimento</span>
          {registrando ? (
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          ) : (
            <output className="rfm-campo-fixo">{fmtData(parcela.dataPagamento)}</output>
          )}
        </label>

        <label className="rfm-campo">
          <span className="rfm-campo-rotulo">Câmbio aplicado</span>
          {registrando ? (
            <input inputMode="decimal" value={cambio} onChange={(e) => setCambio(e.target.value)} aria-invalid={!cambioValido} />
          ) : (
            <output className="rfm-campo-fixo">
              {num(parcela.cambioAplicado) ? fmtCambio(num(parcela.cambioAplicado)) : '—'}
            </output>
          )}
        </label>

        <label className="rfm-campo">
          <span className="rfm-campo-rotulo">Forma de pagamento</span>
          <select value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">Não informada</option>
            {FORMAS.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
          </select>
        </label>

        <label className="rfm-campo">
          <span className="rfm-campo-rotulo">Conta financeira</span>
          <input
            value={conta}
            onChange={(e) => setConta(e.target.value)}
            placeholder="Banco, caixa ou conta de destino"
            maxLength={100}
          />
        </label>
      </div>

      <label className="rfm-campo">
        <span className="rfm-campo-rotulo">Observações</span>
        <textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </label>

      <div className="rfm-campo">
        <span className="rfm-campo-rotulo">Comprovante</span>
        <div className="rfm-anexo">
          {comprovanteUrl ? (
            <>
              <a className="rfm-anexo-nome" href={comprovanteUrl} target="_blank" rel="noreferrer">
                {comprovanteNome ?? 'Comprovante anexado'}
              </a>
              {podeAlterarComprovante && (
                <button type="button" className="rfm-btn-sec" disabled={enviando} onClick={() => arquivo.current?.click()}>
                  Substituir
                </button>
              )}
              {podeExcluirComprovante && (
                <button
                  type="button"
                  className="rfm-btn-sec"
                  disabled={enviando}
                  onClick={() => { setComprovanteUrl(null); setComprovanteNome(null) }}
                >
                  Remover
                </button>
              )}
            </>
          ) : podeAlterarComprovante ? (
            <button type="button" className="rfm-btn-sec" disabled={enviando} onClick={() => arquivo.current?.click()}>
              {enviando ? 'Enviando…' : 'Anexar comprovante'}
            </button>
          ) : (
            <span className="rfm-nota" style={{ margin: 0 }}>Sem comprovante.</span>
          )}
          <input
            ref={arquivo}
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarArquivo(f); e.target.value = '' }}
          />
        </div>
        {erroAnexo && <span className="rfm-erro-campo">{erroAnexo}</span>}
      </div>

      {!registrando && (
        <p className="rfm-nota">
          Data, valor e câmbio de um recebimento lançado não são editáveis: a correção oficial é o estorno,
          que preserva o histórico financeiro.
        </p>
      )}

      <div className="rfm-confirm-acoes">
        <button type="button" className="rfm-btn-sec" onClick={onCancelar}>Cancelar</button>
        <button
          type="button"
          className="rfm-btn"
          disabled={salvando || enviando || (registrando && !cambioValido)}
          onClick={confirmar}
        >
          {registrando ? 'Registrar' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

export default ReceitaRecebimentoForm
