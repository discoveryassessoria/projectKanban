// src/components/financeiro/SeletorTemplate.tsx
//
// Modal de seleção e aplicação de template financeiro.
// Clone visual do `abrirSeletorTemplate` do mockup (casa.html): overlay escuro,
// card branco 520px, lista de templates com badge "SUGERIDO", contagem de
// receitas/custos e info de requerentes adultos/menores.
//
// Fluxo:
//   1. monta -> GET /api/financeiro/templates?processoId=X
//   2. clique num template -> POST /api/financeiro/templates/aplicar
//   3. se o processo já tem lançamentos -> confirm() -> re-POST com confirmado:true
//   4. sucesso -> onAplicado() (recarrega a lista) + onFechar()

'use client'

import { useEffect, useState } from 'react'

// ============================================================================
// Tipos
// ============================================================================

interface TemplateResumo {
  key: string
  label: string
  receitas: number
  custos: number
}

interface TemplatesResponse {
  templates: TemplateResumo[]
  sugerido: string | null
  requerentes: { adultos: number; menores: number } | null
}

export interface SeletorTemplateProps {
  processoId: number
  /** Câmbio EUR/USD -> BRL usado na geração (vem do ProcessoFinanceiro). */
  fxHoje?: number
  /** Chamado após aplicar com sucesso — use pra recarregar a lista. */
  onAplicado: () => void
  /** Fecha o modal. */
  onFechar: () => void
}

// ============================================================================
// Helpers
// ============================================================================

const PRIMARY = '#5b3fff'

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${
      typeof window !== 'undefined'
        ? localStorage.getItem('authToken') || ''
        : ''
    }`,
  }
}

// ============================================================================
// Componente
// ============================================================================

export function SeletorTemplate({
  processoId,
  fxHoje,
  onAplicado,
  onFechar,
}: SeletorTemplateProps) {
  const [dados, setDados] = useState<TemplatesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aplicandoKey, setAplicandoKey] = useState<string | null>(null)

  // ---- Carrega lista de templates + sugestão ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const res = await fetch(
          `/api/financeiro/templates?processoId=${processoId}`,
          { headers: authHeaders() },
        )
        if (cancelado) return
        if (!res.ok) {
          setErro(`Não foi possível carregar os templates (HTTP ${res.status}).`)
          return
        }
        const data = (await res.json()) as TemplatesResponse
        if (!cancelado) setDados(data)
      } catch (err) {
        console.error('[SeletorTemplate] carregar:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar os templates.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Aplica um template ----
  async function aplicar(templateId: string, confirmado = false) {
    setAplicandoKey(templateId)
    setErro(null)
    try {
      const res = await fetch('/api/financeiro/templates/aplicar', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          processoId,
          templateId,
          opcoes: { cambio: fxHoje, confirmado },
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErro(data?.error || `Falha ao aplicar o template (HTTP ${res.status}).`)
        setAplicandoKey(null)
        return
      }

      // Processo já tem lançamentos — confirma antes de adicionar mais
      if (data?.precisaConfirmacao) {
        const jt = data.jaTem || { receitas: 0, custos: 0 }
        const ok = window.confirm(
          `Este processo já tem ${jt.receitas} receita(s) e ${jt.custos} custo(s) ativos.\n\n` +
            `Aplicar o template "${data.templateLabel}" vai ADICIONAR novos lançamentos ` +
            `(não substitui os existentes).\n\nDeseja continuar?`,
        )
        if (ok) {
          await aplicar(templateId, true)
        } else {
          setAplicandoKey(null)
        }
        return
      }

      // Sucesso
      if (data?.ok) {
        const partes = [
          `${data.receitasCriadas} receita(s)`,
          `${data.custosCriados} custo(s)`,
        ]
        let msg = `Template "${data.templateLabel}" aplicado.\n${partes.join(' + ')} criado(s).`
        if (data.aviso) msg += `\n\n⚠ ${data.aviso}`
        alert(msg)
        onAplicado()
        onFechar()
        return
      }

      setErro('Resposta inesperada do servidor ao aplicar o template.')
      setAplicandoKey(null)
    } catch (err) {
      console.error('[SeletorTemplate] aplicar:', err)
      setErro('Erro de conexão ao aplicar o template.')
      setAplicandoKey(null)
    }
  }

  const aplicando = aplicandoKey !== null

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !aplicando) onFechar()
      }}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          maxWidth: 520,
          width: '100%',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,.2)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h3
          style={{
            margin: '0 0 6px',
            fontSize: 17,
            fontWeight: 600,
            color: '#111827',
          }}
        >
          Aplicar Template Financeiro
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
          Selecione o template para gerar receitas e custos automaticamente.
        </p>

        {/* Info de requerentes */}
        {dados?.requerentes && (
          <div
            style={{
              background: '#f9fafb',
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: 12,
              color: '#374151',
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            👥 <strong>{dados.requerentes.adultos} adulto(s)</strong> entram na
            divisão ·{' '}
            <strong>{dados.requerentes.menores} menor(es)</strong> ficam fora
            automaticamente
          </div>
        )}

        {/* Erro */}
        {erro && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#7f1d1d',
              padding: '9px 12px',
              borderRadius: 8,
              fontSize: 12.5,
              marginBottom: 14,
              lineHeight: 1.4,
            }}
          >
            {erro}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            Carregando templates...
          </div>
        )}

        {/* Lista de templates */}
        {!loading &&
          dados?.templates.map((t) => {
            const isSug = t.key === dados.sugerido
            const isAplicandoEste = aplicandoKey === t.key
            return (
              <button
                key={t.key}
                type="button"
                disabled={aplicando}
                onClick={() => aplicar(t.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '14px 16px',
                  border: `1px solid ${isSug ? PRIMARY : '#e5e7eb'}`,
                  background: isSug ? '#f5f3ff' : '#fff',
                  borderRadius: 10,
                  cursor: aplicando ? 'default' : 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  marginBottom: 8,
                  opacity: aplicando && !isAplicandoEste ? 0.5 : 1,
                  transition: 'all .15s',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#111827',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {t.label}
                    {isSug && (
                      <span
                        style={{
                          background: PRIMARY,
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.3px',
                        }}
                      >
                        SUGERIDO
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      marginTop: 3,
                    }}
                  >
                    {t.receitas} receitas · {t.custos} custos
                  </div>
                </div>
                <div style={{ color: '#9ca3af', fontSize: 16 }}>
                  {isAplicandoEste ? '...' : '→'}
                </div>
              </button>
            )
          })}

        {/* Cancelar */}
        <button
          type="button"
          onClick={onFechar}
          disabled={aplicando}
          style={{
            marginTop: 8,
            width: '100%',
            padding: 10,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fff',
            cursor: aplicando ? 'default' : 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
            color: '#6b7280',
          }}
        >
          {aplicando ? 'Aplicando template...' : 'Cancelar'}
        </button>
      </div>
    </div>
  )
}

export default SeletorTemplate