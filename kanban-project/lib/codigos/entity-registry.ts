// lib/codigos/entity-registry.ts
// REGISTRO ÚNICO entidade→gerador. É a fonte que liga cada modelo Prisma ao CodeGeneratorService
// central. Conectar uma entidade nova = 1 linha aqui (+ coluna publicCode + backfill). A geração
// no create é automática via extensão do Prisma Client (lib/prisma.ts) — sem lógica duplicada.
import type { EntidadeCodigo } from './code-patterns'

export interface RegistroCodigo {
  entidade: EntidadeCodigo   // tipo no CODE_PREFIX/escopoDe
  campo: string              // coluna de destino (sempre "publicCode" no rollout)
}

// Chave = nome do MODELO Prisma (como a extensão $extends reporta: PascalCase).
// Entidades já concluídas (Processo.codigo, Receita.codigo, Custo.codigo) NÃO entram aqui — usam
// o mesmo gerador por chamada explícita e não devem ser alteradas.
//
// ESCOPO DEFINITIVO (correção conceitual): publicCode SÓ para cadastros operacionais REAIS que o
// usuário cria, pesquisa e referencia. NÃO para entidades internas/config/infra. Por isso saíram
// daqui: Pessoa (interna — o cliente é Contratante/Requerente), ProdutoFinanceiro (config),
// TabelaValor (preço/config), Tarefa, Evento, Protocolo (identificado por numeroProtocolo/consulado),
// PhaseAutomationRule (regra/automação) e OperacaoAntecipada (orquestração interna — identificada
// pelo documento/serviço/operação oficial vinculada). Essas mantêm apenas o ID técnico interno.
//
// Cliente = Contratante + Requerente compartilham o MESMO escopo CLI (sequência única entre as duas
// tabelas). Não existe tabela "Cliente" nem "Produto" separado (Serviço = ServicoProduto).
export const CODE_REGISTRY: Record<string, RegistroCodigo> = {
  Contratante:    { entidade: 'CLIENT',   campo: 'publicCode' }, // CLI (cliente)
  Requerente:     { entidade: 'CLIENT',   campo: 'publicCode' }, // CLI (cliente — mesma sequência)
  ServicoProduto: { entidade: 'SERVICE',  campo: 'publicCode' }, // SRV
  Documento:      { entidade: 'DOCUMENT', campo: 'publicCode' }, // DOC (documento concreto)
  Fornecedor:     { entidade: 'SUPPLIER', campo: 'publicCode' }, // FOR
  Usuario:        { entidade: 'USER',     campo: 'publicCode' }, // USR (equipe interna)
}
