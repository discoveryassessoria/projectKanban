// src/lib/documentos/pontos-retificacao.ts
//
// PONTOS DE RETIFICAÇÃO — formata divergências já confirmadas como "retificação"
// no formato "a) Corrigir [campo] de 'X' para 'Y';" — o mesmo padrão de uma
// petição real de retificação judicial (verificado contra o documento real da
// família Medina Olivares usado nesta sessão: cada item do pedido segue
// exatamente essa forma, um documento por bloco, itens lettered a, b, c...).
//
// PURO texto de DADO, nunca texto jurídico: só interpola campo/valor-errado/
// valor-correto que a Análise Documental já decidiu. Os fundamentos jurídicos,
// o cabeçalho da petição, os pedidos ao juízo — isso é conteúdo de MODELO
// versionado (Repositório de Modelos Documentais), nunca escrito aqui.

export interface DivergenciaParaPonto {
  documentoTitulo: string
  pessoaNome: string
  campoLabel: string
  valorDocumento: string | null
  valorArvore: string | null
}

const LETRAS = "abcdefghijklmnopqrstuvwxyz"

function primeiraMinuscula(s: string): string {
  return s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/** Um item: "a) Corrigir nome do pai de "X" para "Y";" — sempre com valores entre aspas, nunca vazios sem dizer isso. */
function formatarItem(d: DivergenciaParaPonto, indice: number): string {
  const letra = LETRAS[indice] ?? String(indice + 1)
  const de = d.valorDocumento?.trim() || "—"
  const para = d.valorArvore?.trim() || "—"
  return `${letra}) Corrigir ${primeiraMinuscula(d.campoLabel)} de "${de}" para "${para}";`
}

/**
 * Agrupa por documento (mesmo documentoTitulo + pessoaNome) e numera os blocos —
 * é exatamente a estrutura "1. Casamento de X e Y... Retificações requeridas: a) ...
 * b) ..." do documento real. Ordem de entrada preservada (quem chama decide a
 * ordem dos documentos; aqui só agrupa e numera).
 */
export function formatarPontosDeRetificacao(divergencias: DivergenciaParaPonto[]): string {
  const grupos: Array<{ titulo: string; pessoa: string; itens: DivergenciaParaPonto[] }> = []
  const indicePorChave = new Map<string, number>()
  for (const d of divergencias) {
    const chave = `${d.documentoTitulo}::${d.pessoaNome}`
    let idx = indicePorChave.get(chave)
    if (idx === undefined) {
      idx = grupos.length
      indicePorChave.set(chave, idx)
      grupos.push({ titulo: d.documentoTitulo, pessoa: d.pessoaNome, itens: [] })
    }
    grupos[idx].itens.push(d)
  }

  return grupos
    .map((g, i) => {
      const cabecalho = `${i + 1}. ${g.titulo} — ${g.pessoa}`
      const itens = g.itens.map((d, j) => formatarItem(d, j)).join("\n")
      return `${cabecalho}\n\nRetificações requeridas:\n${itens}`
    })
    .join("\n\n")
}
