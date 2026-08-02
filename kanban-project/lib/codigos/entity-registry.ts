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
// CLIENTE = RELAÇÃO COMERCIAL, não papel. Contratante (quem contrata) é o portador da relação
// comercial → recebe CLI. Requerente é PAPEL dentro do processo: NÃO recebe CLI-n só por ser
// requerente (uma mesma pessoa pode acumular papéis, mas os papéis não são equivalentes). Gerar CLI
// para Requerente foi SUSPENSO até a entidade Cliente estar corretamente modelada. Não existe tabela
// "Cliente" nem "Produto" separado (Serviço = ServicoProduto).
export const CODE_REGISTRY: Record<string, RegistroCodigo> = {
  Contratante:    { entidade: 'CLIENT',   campo: 'publicCode' }, // CLI (relação comercial)
  ServicoProduto: { entidade: 'SERVICE',  campo: 'publicCode' }, // SRV
  Documento:      { entidade: 'DOCUMENT', campo: 'publicCode' }, // DOC (documento concreto)
  TipoDocumentoCadastro: { entidade: 'DOCUMENT_TYPE', campo: 'publicCode' }, // DOC1, DOC2… (tipo/mestre; sequência TDOC, distinta do DOC-n do documento concreto)
  Fornecedor:     { entidade: 'SUPPLIER', campo: 'publicCode' }, // FOR
  OrgaoProtocolo: { entidade: 'ORGANIZATION', campo: 'publicCode' }, // ORG1, ORG2… (Órgãos e Organizações)
  Usuario:        { entidade: 'USER',     campo: 'publicCode' }, // USR (equipe interna)
}
