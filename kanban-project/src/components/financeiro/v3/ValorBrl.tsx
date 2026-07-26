// src/components/financeiro/v3/ValorBrl.tsx
//
// APRESENTAÇÃO ÚNICA de valor em BRL sob a política canônica de câmbio.
//
// Quando `naoConvertido` > 0 não existe cotação e o BRL NÃO representa aquele
// montante — exibir "R$ 0,00" mentiria. Nesses casos mostra-se o valor na moeda
// de origem, marcado, com tooltip. Este é o mesmo padrão usado no Shell, no
// Detalhe da Receita e na aba Receitas: um só lugar define como a ausência
// aparece ao usuário.
//
// Só apresentação: não calcula câmbio, não decide política — apenas renderiza
// o que os read-models já entregam.

"use client"

const moedaFmt = (v: number, m = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)

export const semCotacao = (x?: { naoConvertido?: number | null } | null): boolean =>
  Number(x?.naoConvertido ?? 0) > 0

export const TITULO_SEM_COTACAO = "Sem cotação disponível — valor não convertido para BRL."

/** Texto puro (para células/labels que não aceitam nó React). */
export function textoBrlOuOrigem(valorBrl: number, naoConvertido?: number | null, moeda?: string | null): string {
  return Number(naoConvertido ?? 0) > 0
    ? `${moedaFmt(Number(naoConvertido), moeda ?? "BRL")} · não convertido`
    : moedaFmt(valorBrl)
}

export function ValorBrl({
  valor,
  naoConvertido,
  moeda,
  className,
}: {
  valor: number
  naoConvertido?: number | null
  moeda?: string | null
  className?: string
}) {
  if (Number(naoConvertido ?? 0) > 0) {
    return (
      <span className={`text-amber-300/90 ${className ?? ""}`} title={TITULO_SEM_COTACAO}>
        {moedaFmt(Number(naoConvertido), moeda ?? "BRL")}{" "}
        <span className="text-[11px] text-amber-300/70">não convertido</span>
      </span>
    )
  }
  return <span className={className}>{moedaFmt(valor)}</span>
}

/** Aviso de rodapé quando algum montante ficou fora do total em BRL. */
export function AvisoNaoConvertido({ quantidade, className }: { quantidade: number; className?: string }) {
  if (!quantidade) return null
  return (
    <div
      className={`rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12.5px] text-amber-200/90 ${className ?? ""}`}
    >
      {quantidade} lançamento(s) sem cotação disponível — os totais em BRL acima não incluem esse montante.
    </div>
  )
}
