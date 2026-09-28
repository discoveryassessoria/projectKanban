// src/lib/documentos/dados-preenchidos.ts
//
// "Documento existe" NUNCA foi "tem dado real preenchido" — desde a unificação
// 28/09/2026, o Documento nasce automaticamente junto com a NecessidadeDocumental
// (ver materializar-genealogia.ts), vazio (rascunho, sem cartório/livro/folha). Só
// ganha dado real quando alguém de fato localiza o registro. Esta é a ÚNICA função
// que decide "tem dado real" — nunca reimplementar o critério em outro lugar.
//
// Achado real que motivou isto: a Tarefa #3827 (necessidade 607, processo 651)
// aparecia "EM_ANDAMENTO" sem nenhum dado real por trás — status de Tarefa/Passo
// não diz nada sobre o conteúdo do Documento, e "Documento existe" (sozinho) também
// não. Cartório + livro + folha juntos são a identificação mínima de um registro
// civil localizado — vale igual pra nascimento, casamento e óbito (mesma tríade em
// toda certidão de registro civil brasileira).
export interface DocumentoParaDadosPreenchidos {
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
}

export function documentoTemDadosPreenchidos(
  doc: DocumentoParaDadosPreenchidos | null | undefined,
): boolean {
  if (!doc) return false
  return doc.cartorio != null && doc.livro != null && doc.folha != null
}
