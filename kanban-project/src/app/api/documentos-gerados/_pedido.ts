// Leitura do pedido de geração — UMA implementação para as três entradas
// (validar, prévia, gerar). Se cada rota lesse o corpo à sua maneira, a prévia
// poderia aceitar o que a geração recusa.

export interface PedidoLido {
  modeloId: number
  outorgante: { papel: "contratante" | "requerente"; id: number }
  processoId: number | null
  servicoId: number | null
  ato: { localEmissao: string; dataEmissao: string }
  chaveIdempotencia: string | null
}

export async function lerPedido(request: Request): Promise<PedidoLido | { error: string }> {
  let c: Record<string, unknown>
  try {
    c = await request.json()
  } catch {
    return { error: "Body inválido" }
  }

  const modeloId = Number(c.modeloId)
  if (!Number.isInteger(modeloId)) return { error: "modeloId é obrigatório" }

  const papel = String(c.outorgantePapel ?? "")
  if (papel !== "contratante" && papel !== "requerente") {
    return { error: "outorgantePapel deve ser 'contratante' ou 'requerente'" }
  }
  const outorganteId = Number(c.outorganteId)
  if (!Number.isInteger(outorganteId)) return { error: "outorganteId é obrigatório" }

  const localEmissao = String(c.localEmissao ?? "").trim()
  const dataEmissao = String(c.dataEmissao ?? "").trim()
  if (!localEmissao) return { error: "localEmissao é obrigatório" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) {
    return { error: "dataEmissao deve estar no formato aaaa-mm-dd" }
  }

  return {
    modeloId,
    outorgante: { papel, id: outorganteId },
    processoId: c.processoId == null || c.processoId === "" ? null : Number(c.processoId),
    servicoId: c.servicoId == null || c.servicoId === "" ? null : Number(c.servicoId),
    ato: { localEmissao, dataEmissao },
    chaveIdempotencia: c.chaveIdempotencia == null ? null : String(c.chaveIdempotencia),
  }
}
