/**
 * GUARDA DE ARQUITETURA — nenhuma referência estrutural em texto.
 * Rodar: npm run test:arquitetura-referencias
 *
 * Varre o schema Prisma e o código à procura dos padrões que a arquitetura
 * proíbe: cadastro mestre guardado como String, id de entidade em texto, array
 * textual ou JSON no lugar de tabela associativa, e entidade localizada por nome.
 *
 * FALHA O PIPELINE quando aparece um achado NOVO. A lista de exceções abaixo é
 * o inventário do que ainda existe — cada linha com o motivo e o destino. Ela só
 * pode encolher: retirar um item é concluir a migração daquele ponto.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  analisarSchema, idsTextuais, analisarCodigo, formatar,
  ENTIDADES_MESTRES, type Achado, type Excecao,
} from '../lib/arquitetura/referencias-estruturais'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// ════════════════════════════════════════════════════════════════════════════
// EXCEÇÕES JUSTIFICADAS — inventário do legado textual que ainda existe.
// Cada entrada é uma dívida declarada, com o destino escrito. Nada de regra
// desligada em bloco: um alvo por linha, um motivo por alvo.
// ════════════════════════════════════════════════════════════════════════════
const EXCECOES_SCHEMA: Excecao[] = [
  // ── Conteúdo próprio do registro (texto legítimo, não referência) ─────────
  { alvo: 'CatalogoPais.nationalityKey', motivo: 'Chave própria do país no seu PRÓPRIO cadastro — é identidade dele, não referência a outro.' },
  { alvo: 'CatalogoPais.nationalityLabel', motivo: 'Rótulo pátrio exibido — conteúdo do próprio registro.' },
  { alvo: 'TipoProcessoNacionalidade.nationalityKey', motivo: 'Chave própria do tipo de processo.' },
  { alvo: 'TipoProcessoNacionalidade.nationalityLabel', motivo: 'Rótulo exibido do próprio registro.' },
  { alvo: 'ModalidadePais.modalityKey', motivo: 'Chave própria da modalidade no seu cadastro.' },
  { alvo: 'ModalidadePais.modalityLabel', motivo: 'Rótulo exibido do próprio registro.' },
  { alvo: 'ModalidadePais.countryKey', motivo: 'Chave do país no par único (countryKey, modalityKey) — identidade composta anterior ao cadastro de países; migrar para paisId.' },
  { alvo: 'CategoriaOrganizacao.nome', motivo: 'Nome próprio da categoria.' },

  // ── Dívida declarada: campo textual que ainda representa entidade ─────────
  { alvo: 'Pessoa.nacionalidade', motivo: 'DÍVIDA: nacionalidade da pessoa em texto. Destino: paisId → CatalogoPais. Depende do MDM de identidade.' },
  { alvo: 'Requerente.nacionalidade', motivo: 'DÍVIDA: idem Pessoa.nacionalidade.' },
  { alvo: 'Contratante.nacionalidade', motivo: 'DÍVIDA: idem Pessoa.nacionalidade.' },
  { alvo: 'ClienteFinal.nacionalidade', motivo: 'DÍVIDA: idem Pessoa.nacionalidade.' },
  { alvo: 'TipoDocumentoCadastro.category', motivo: 'DÍVIDA: já existe categoriaDocumentalId (FK) e a escrita dupla persiste. Destino: remover a coluna após migrar os consumidores.' },
  { alvo: 'ItemCatalogo.categoria', motivo: 'REMOVIDO no schema; entrada mantida enquanto a migration não roda em produção.' },
  { alvo: 'TabelaValor.regiao', motivo: 'DÍVIDA: nível país/região do preço em texto. Destino: paisId → CatalogoPais.' },
  { alvo: 'FormaPagamentoCadastro.categoria', motivo: 'DÍVIDA: classificação do meio de pagamento em texto. Destino: cadastro próprio ou enum estrutural.' },
  { alvo: 'TaxaPagamento.categoria', motivo: 'DÍVIDA: idem FormaPagamentoCadastro.categoria.' },
  { alvo: 'ModeloDocumento.categoria', motivo: 'DÍVIDA: categoria do modelo em texto. Destino: CategoriaDocumental.' },
  { alvo: 'BlogPost.categoria', motivo: 'Conteúdo editorial, fora do domínio operacional. Sem cadastro mestre correspondente.' },
  { alvo: 'AnexoContratante.categoria', motivo: 'DÍVIDA: rótulo de anexo em texto. Destino: cadastro de tipos de anexo.' },
  { alvo: 'AnexoRequerente.categoria', motivo: 'DÍVIDA: idem AnexoContratante.categoria.' },
  { alvo: 'ServicoProduto.nationality', motivo: 'REMOVIDO no schema; entrada mantida enquanto a migration não roda em produção.' },
  { alvo: 'ServicoProduto.category', motivo: 'REMOVIDO no schema; entrada mantida enquanto a migration não roda em produção.' },

  // ── INVENTÁRIO DA AUDITORIA (30/07) — país como texto ─────────────────────
  // Todos com o mesmo destino: paisId → CatalogoPais. Cada um exige migration
  // própria + troca dos consumidores; entram aqui declarados, não escondidos.
  { alvo: 'Processo.pais', motivo: 'DÍVIDA: país do processo em texto. Destino: paisId → CatalogoPais. É o de maior alcance — o motor lê `proc.pais`.' },
  { alvo: 'Status.pais', motivo: 'DÍVIDA: país no status legado. Destino: paisId → CatalogoPais.' },
  { alvo: 'Tarefa.pais', motivo: 'DÍVIDA: país da tarefa em texto. Destino: paisId → CatalogoPais.' },
  { alvo: 'Uniao.pais', motivo: 'DÍVIDA: país do casamento em texto. Destino: paisId → CatalogoPais.' },
  { alvo: 'Contratante.pais', motivo: 'DÍVIDA: país de endereço. Destino: paisId → CatalogoPais.' },
  { alvo: 'Requerente.pais', motivo: 'DÍVIDA: idem Contratante.pais.' },
  { alvo: 'Fornecedor.pais', motivo: 'DÍVIDA: idem Contratante.pais.' },
  { alvo: 'Banco.pais', motivo: 'DÍVIDA: país do banco. Destino: paisId → CatalogoPais.' },
  { alvo: 'OrgaoProtocolo.country', motivo: 'DÍVIDA: país do órgão. Destino: paisId → CatalogoPais.' },

  // ── Cadastros de pagamento — texto no lugar de FK ─────────────────────────
  { alvo: 'FormaPagamentoCadastro.moeda', motivo: 'DÍVIDA: moeda em texto. Destino: moedaId → MoedaCadastro (o vínculo N:N já existe em CondicaoPagamentoMoeda).' },
  { alvo: 'TaxaPagamento.moeda', motivo: 'DÍVIDA: idem FormaPagamentoCadastro.moeda.' },
  { alvo: 'CondicaoPagamento.modalidades', motivo: 'DÍVIDA: array textual — projeção legada do motor. A seleção real já é CondicaoPagamentoModalidade; falta desligar a projeção.' },
  { alvo: 'TaxaPagamento.modalidades', motivo: 'DÍVIDA: idem CondicaoPagamento.modalidades.' },
  { alvo: 'CondicaoPagamento.perfil', motivo: 'DÍVIDA: perfil em texto. Destino: perfilId → Perfil.' },
  { alvo: 'TaxaPagamento.perfil', motivo: 'DÍVIDA: idem CondicaoPagamento.perfil.' },
  { alvo: 'CotacaoCambio.modalidade', motivo: 'DÍVIDA: modalidade em texto. Destino: modalidadeId → ModalidadePais.' },

  // ── Financeiro / operação ─────────────────────────────────────────────────
  { alvo: 'Custo.fornecedor', motivo: 'DÍVIDA: fornecedor em texto convivendo com fornecedorId. Destino: remover a coluna após migrar os consumidores.' },
  { alvo: 'OutroCusto.fornecedor', motivo: 'DÍVIDA: idem Custo.fornecedor.' },
  { alvo: 'LedgerEntry.contaContabil', motivo: 'DÍVIDA: conta contábil em texto no lançamento. Destino: contaContabilId → ContaContabil. CUIDADO: é histórico contábil congelado — migrar com espelho, sem reescrever lançamento fechado.' },
  { alvo: 'PhaseWorkflowStepInstance.equipe', motivo: 'DÍVIDA: equipe responsável em texto. Destino: equipeId → GrupoUsuario.' },
  { alvo: 'ParteExterna.documento', motivo: 'FALSO POSITIVO CONTROLADO: é o número do documento da parte (CPF/passaporte), conteúdo próprio — não referência ao Documento Mestre.' },
  { alvo: 'PropostaReconciliacao.vinculosAfetados', motivo: 'DÍVIDA: JSON descrevendo o impacto de uma proposta do MRG. É snapshot de PROPOSTA (não vínculo vigente); destino: tabela de impacto com FKs.' },
]

const EXCECOES_CODIGO: Excecao[] = [
  { alvo: 'prisma/carga-servicos-oficiais.ts', motivo: 'Carga curada: idempotência por nome normalizado é intencional e roda uma vez, fora do caminho de requisição.' },
  { alvo: 'scripts/catalogo-certidoes-vinculo.ts', motivo: 'Diagnóstico read-only que PROPÕE consolidação por nome para decisão humana; não grava sozinho.' },
  { alvo: 'scripts/seed-honorarios-italia.ts', motivo: 'Seed curado: find-or-create por nome é a idempotência do próprio registro que ele cria, fora do caminho de requisição.' },
]

// ── Coleta ─────────────────────────────────────────────────────────────────
const PASTAS = ['src', 'lib', 'prisma', 'scripts']
const IGNORAR = /node_modules|\.next|\.d\.ts$|migrations|generated/

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (IGNORAR.test(caminho)) continue
    const st = statSync(caminho)
    if (st.isDirectory()) arquivos(caminho, acc)
    else if (/\.(ts|tsx)$/.test(caminho)) acc.push(caminho)
  }
  return acc
}

console.log('GUARDA DE ARQUITETURA — referência estrutural nunca é texto\n')
console.log(`Entidades mestres registradas: ${ENTIDADES_MESTRES.length}`)
console.log(`Exceções justificadas: ${EXCECOES_SCHEMA.length} no schema · ${EXCECOES_CODIGO.length} no código\n`)

const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
const achados: Achado[] = [
  ...analisarSchema(schema, EXCECOES_SCHEMA),
  ...idsTextuais(schema, EXCECOES_SCHEMA),
]

for (const pasta of PASTAS) {
  for (const caminho of arquivos(join(RAIZ, pasta))) {
    const rel = relative(RAIZ, caminho)
    achados.push(...analisarCodigo(rel, readFileSync(caminho, 'utf8'), EXCECOES_CODIGO))
  }
}

// Toda exceção precisa de motivo escrito — exceção muda é regra desligada.
const semMotivo = [...EXCECOES_SCHEMA, ...EXCECOES_CODIGO].filter((e) => !e.motivo || e.motivo.length < 20)
if (semMotivo.length) {
  console.log('EXCEÇÕES SEM JUSTIFICATIVA ADEQUADA:')
  for (const e of semMotivo) console.log(`  ✗ ${e.alvo}`)
}

const dividas = EXCECOES_SCHEMA.filter((e) => e.motivo.startsWith('DÍVIDA'))
console.log(`Dívidas de referência textual ainda abertas: ${dividas.length}`)
for (const d of dividas) console.log(`  · ${d.alvo} — ${d.motivo.replace('DÍVIDA: ', '')}`)

console.log(`\nAchados NOVOS: ${achados.length}`)
console.log(formatar(achados))

console.log(`\n${'='.repeat(64)}`)
if (achados.length > 0 || semMotivo.length > 0) {
  console.log('FALHOU — referência estrutural em texto fora do inventário.')
  console.log('Corrija o vínculo (FK/tabela associativa) ou declare a exceção com motivo.')
  process.exit(1)
}
console.log('OK — nenhuma referência estrutural em texto fora do inventário declarado.')
