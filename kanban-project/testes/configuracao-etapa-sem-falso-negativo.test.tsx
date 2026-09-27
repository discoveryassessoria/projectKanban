// testes/configuracao-etapa-sem-falso-negativo.test.tsx
// ============================================================================
// EDITOR "ABRE E FECHA SOZINHO" (achado real, 27/09/2026 — Central Operacional
// do Cibils, passo "Enviar requerimento ao cartório"). Causa: `carregando` em
// `useConfiguracaoDaEtapa` (useConfiguracaoDaEtapa.ts) era um `useState(false)`
// separado, só virando `true` DENTRO de um microtask (`Promise.resolve().then`),
// deliberadamente adiado pra não encadear render. No PRIMEIRO render depois de
// `stepInstanceId` passar de `null` para um id real, esse `setState(true)`
// ainda não tinha rodado: `carregando` lia `false` e `subtarefas` lia `[]`
// (nada chegou ainda) — um FALSO NEGATIVO de "carregando".
//
// `EditorPorSubtarefaCorrente` (StepEditors.tsx) lia esse falso negativo como
// "confirmado: esta etapa não tem subtarefas cadastradas" e abria o editor do
// PASSO (kind errado) em vez de esperar. Um render depois, `carregando` virava
// `true` de verdade e aquele editor errado sumia — visualmente "abre e fecha".
//
// A correção torna `carregando` DERIVADO (não um estado solto): verdadeiro
// sempre que não temos ainda a resposta para a combinação exata
// (stepInstanceId, recarga) pedida — nunca há uma janela em que "ainda não
// perguntei" pareça "perguntei e não tem nada".
// ============================================================================
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConfiguracaoDaEtapa } from '@/src/components/kanban/workflow/useConfiguracaoDaEtapa'

function respostaControlavel() {
  let resolver: (v: unknown) => void = () => {}
  const promessa = new Promise((resolve) => { resolver = resolve })
  const fetchFn = vi.fn(async () => {
    await promessa
    return {
      ok: true,
      json: async () => ({ subtarefas: [{ key: 'enviar_requerimento_cartorio', label: 'Enviar requerimento' }] }),
    }
  })
  return { fetchFn, liberar: () => resolver(undefined) }
}

describe('useConfiguracaoDaEtapa — sem janela de falso-negativo em "carregando"', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('no PRIMEIRO render após stepInstanceId ir de null pra um id real, carregando já é true (nunca false com subtarefas=[])', async () => {
    const { fetchFn, liberar } = respostaControlavel()
    vi.stubGlobal('fetch', fetchFn)

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useConfiguracaoDaEtapa(id),
      { initialProps: { id: null as number | null } },
    )
    expect(result.current.carregando).toBe(false) // sem etapa, não há o que carregar

    act(() => { rerender({ id: 2835 }) })

    // ESTE é o ponto exato do bug: no primeiro render pós-transição, antes de
    // QUALQUER await, `carregando` já precisa refletir "estou buscando" — não
    // pode ler `false`/`subtarefas: []` como se already tivesse a resposta.
    expect(result.current.carregando).toBe(true)
    expect(result.current.subtarefas).toEqual([])

    liberar()
    await waitFor(() => expect(result.current.carregando).toBe(false))
    expect(result.current.subtarefas).toHaveLength(1)
    expect(result.current.subtarefas[0].key).toBe('enviar_requerimento_cartorio')
  })

  it('regressão: um consumidor que decide pelo par (carregando, subtarefas) nunca vê "carregando=false + subtarefas=[]" antes da resposta real', async () => {
    const { fetchFn, liberar } = respostaControlavel()
    vi.stubGlobal('fetch', fetchFn)

    const leituras: Array<{ carregando: boolean; nSubtarefas: number }> = []
    const { rerender } = renderHook(
      ({ id }: { id: number | null }) => {
        const { carregando, subtarefas } = useConfiguracaoDaEtapa(id)
        leituras.push({ carregando, nSubtarefas: subtarefas.length })
      },
      { initialProps: { id: null as number | null } },
    )

    const leiturasComIdReal = leituras.length // marca onde termina o render inicial (id=null)
    act(() => { rerender({ id: 2835 }) })
    liberar()
    await waitFor(() => expect(leituras[leituras.length - 1].carregando).toBe(false))

    // Em NENHUMA leitura DEPOIS de pedir o id 2835 "carregando=false" veio
    // acompanhada de "0 subtarefas" — é essa combinação (falso negativo) que
    // fazia `EditorPorSubtarefaCorrente` abrir o editor errado. A leitura FINAL
    // tem carregando=false com 1 subtarefa (resposta real) — essa é legítima.
    const falsoNegativo = leituras
      .slice(leiturasComIdReal)
      .some((l) => !l.carregando && l.nSubtarefas === 0)
    expect(falsoNegativo).toBe(false)
  })
})
