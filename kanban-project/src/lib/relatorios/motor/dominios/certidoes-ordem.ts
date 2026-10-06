// src/lib/relatorios/motor/dominios/certidoes-ordem.ts
// ============================================================================
// A ORDEM FIXA DAS CERTIDÕES NO RELATÓRIO DE CONTROLE (06/10/2026) — PURO (sem banco). Dentro da família vale a regra
// (`lib/operacional/ordem-certidoes.ts`: geração → linha reta → nascimento → pessoa → Nascimento, Casamento, Óbito, outros); a ordenação escolhida
// no relatório (criação, situação, família) só ordena as FAMÍLIAS. Serve ao preview, à paginação e às exportações CSV/Excel/PDF (o motor pagina esta lista).
// ============================================================================
import { ordenarListaPorFamilia } from "@/lib/operacional/ordem-certidoes"

export interface ItemDoRelatorio {
  id: number
  createdAt: number
  status: string
  familia: string
  geracao: number | null
  linhaReta: boolean
  nascimento: Date | string | null
  pessoaId: number | null
  titulo: string | null
}

export function ordenarItensDoRelatorio(itens: ItemDoRelatorio[], ordenarPor: string, direcao: "asc" | "desc"): ItemDoRelatorio[] {
  const sinal = direcao === "desc" ? -1 : 1
  const entreFamilias =
    ordenarPor === "criacao" ? (a: ItemDoRelatorio, b: ItemDoRelatorio) => (a.createdAt - b.createdAt) * sinal
    : ordenarPor === "status" ? (a: ItemDoRelatorio, b: ItemDoRelatorio) => a.status.localeCompare(b.status) * sinal
    : (a: ItemDoRelatorio, b: ItemDoRelatorio) => a.familia.localeCompare(b.familia, "pt-BR") * sinal
  return ordenarListaPorFamilia(itens, {
    familia: (i) => i.familia,
    chave: (i) => ({ geracao: i.geracao, linhaReta: i.linhaReta, pessoaNascimento: i.nascimento, pessoaId: i.pessoaId, titulo: i.titulo, desempate: i.id }),
    entreFamilias,
  })
}
