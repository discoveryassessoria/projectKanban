/**
 * GUARDA — código público do Tipo de Documento (DOC1, DOC2, DOC3…).
 * Rodar: npm run test:codigo-tipo-documento
 *
 * O que este teste trava:
 *  1. o padrão escrito é DOC + número, sem separador e sem zeros à esquerda;
 *  2. a sequência do tipo é PRÓPRIA (escopo TDOC) — não compartilha contador com
 *     o DOC-n do documento concreto;
 *  3. o código é gerado automaticamente no create (extensão do Prisma Client),
 *     ignorando qualquer valor enviado pelo cliente;
 *  4. nenhuma rota da API aceita/edita publicCode — nem no POST nem no PUT;
 *  5. a UI mostra o código em modo leitura e o exibe na listagem;
 *  6. a reconciliação de sequência entende o formato sem hífen (senão o contador
 *     ficaria eternamente atrás e todo create colidiria).
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  CODE_PREFIX,
  escopoDe,
  formatoDe,
  formatarCodigo,
  padraoLikeDe,
} from '../lib/codigos/code-patterns'
import { CODE_REGISTRY } from '../lib/codigos/entity-registry'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0, failed = 0
const falhas: string[] = []
const ok = (cond: boolean, nome: string) => {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// ═══════════════ 1) PADRÃO ESCRITO ═════════════════════════════════════════════
console.log('\n1) Padrão DOC1, DOC2, DOC3…')
ok(formatarCodigo('DOCUMENT_TYPE', 1) === 'DOC1', 'primeiro código = DOC1')
ok(formatarCodigo('DOCUMENT_TYPE', 2) === 'DOC2', 'segundo código = DOC2')
ok(formatarCodigo('DOCUMENT_TYPE', 3) === 'DOC3', 'terceiro código = DOC3')
ok(formatarCodigo('DOCUMENT_TYPE', 137) === 'DOC137', 'sem zeros à esquerda (DOC137)')
ok(/^DOC[1-9][0-9]*$/.test(formatarCodigo('DOCUMENT_TYPE', 42)), 'formato final: DOC + número, sem separador')
const f = formatoDe('DOCUMENT_TYPE')
ok(f.prefixo === 'DOC' && f.separador === '', 'formato declarado uma única vez (prefixo DOC, separador vazio)')

// ═══════════════ 2) SEQUÊNCIA PRÓPRIA ══════════════════════════════════════════
console.log('\n2) Contador próprio (não compartilha com o documento concreto)')
ok(escopoDe('DOCUMENT_TYPE') === 'TDOC', 'escopo da sequência do TIPO = TDOC')
ok(escopoDe('DOCUMENT') === 'DOC', 'escopo da sequência do DOCUMENTO concreto = DOC')
ok(escopoDe('DOCUMENT_TYPE') !== escopoDe('DOCUMENT'), 'tipo e documento contam separado')
ok(formatarCodigo('DOCUMENT', 1) === 'DOC-1', 'documento concreto continua DOC-1 (com hífen)')
ok(padraoLikeDe('DOCUMENT_TYPE') === 'DOC%', 'padrão de busca do tipo = DOC%')
ok(CODE_PREFIX.DOCUMENT_TYPE === 'TDOC', 'CODE_PREFIX guarda o ESCOPO (a escrita vem do formato)')

// ═══════════════ 3) GERAÇÃO AUTOMÁTICA NO CREATE ═══════════════════════════════
console.log('\n3) Gerado automaticamente, nunca informado pelo cliente')
ok(
  CODE_REGISTRY.TipoDocumentoCadastro?.entidade === 'DOCUMENT_TYPE' &&
  CODE_REGISTRY.TipoDocumentoCadastro?.campo === 'publicCode',
  'TipoDocumentoCadastro registrado no CODE_REGISTRY (geração automática)',
)
const prismaSrc = ler('lib/prisma.ts')
ok(/delete data\[cfg\.campo\]/.test(prismaSrc), 'create IGNORA qualquer publicCode enviado pelo cliente')
ok(/data\[cfg\.campo\] = await gerarCodigoPublico/.test(prismaSrc), 'create gera o código pelo serviço central')
ok(/sincronizarSequenciaComTabela\(base, model as string, cfg\.campo, cfg\.entidade\)/.test(prismaSrc), 'autocura da sequência usa a ENTIDADE (formato correto)')

const gen = ler('lib/codigos/code-generator.ts')
ok(/INSERT INTO "CodeSequence"[\s\S]*ON CONFLICT[\s\S]*ultimo" \+ 1/.test(gen), 'número vem de UPDATE atômico (unicidade sob concorrência)')
ok(/formatarCodigo\(entidade, numero/.test(gen), 'gerador escreve o código pelo formato da entidade')

// ═══════════════ 4) IMUTÁVEL NA API ════════════════════════════════════════════
console.log('\n4) Não editável')
const post = ler('src/app/api/gerenciamento/tipos-documento/route.ts')
const put = ler('src/app/api/gerenciamento/tipos-documento/[id]/route.ts')
ok(!/publicCode\s*:/.test(post), 'POST não grava publicCode (quem grava é a extensão)')
ok(!/publicCode/.test(put), 'PUT nunca toca publicCode')
ok(/data:\s*\{[\s\S]*code: atual\.code/.test(put), 'PUT usa whitelist de campos (nada do body vira coluna direto)')

// ═══════════════ 5) UI ═════════════════════════════════════════════════════════
console.log('\n5) Tela')
const tab = ler('src/components/gerenciamentoComponents/TiposDocumentoTab.tsx')
ok(/<CodigoPublicoField codigo=\{form\.publicCode\}/.test(tab), 'formulário mostra o código em modo leitura')
ok(!/name="publicCode"|onChange[^\n]*publicCode/.test(tab), 'não existe campo editável de código')
ok(/\{d\.publicCode \?\? "—"\}/.test(tab), 'listagem exibe o código na coluna Código')
const campo = ler('src/components/gerenciamentoComponents/CodigoPublicoField.tsx')
ok(/Será gerado automaticamente ao salvar/.test(campo), 'registro novo avisa que o código sai no salvamento')

// ═══════════════ 6) RECONCILIAÇÃO ENTENDE O FORMATO ════════════════════════════
console.log('\n6) Reconciliação e backfill entendem código sem hífen')
ok(/substring\("\$\{campo\}" from '\(\[0-9\]\+\)\$'\)/.test(gen), 'sincronização lê o sufixo numérico final (não o split por hífen)')
const rec = ler('scripts/reconciliar-sequencias-codigo.ts')
ok(/padraoLikeDe\(cfg\.entidade\)/.test(rec), 'reconciliação filtra pelo padrão da entidade')
ok(/\(\[0-9\]\+\)\$/.test(rec), 'reconciliação lê o sufixo numérico final')
const backfill = ler('scripts/codigos-backfill-all.ts')
ok(/formatoDe\(cfg\.entidade\)/.test(backfill), 'backfill usa o formato da entidade')

// ═══════════════ 7) MIGRATION DE ALINHAMENTO ═══════════════════════════════════
console.log('\n7) Migration que alinha o que já existe')
const mig = ler('prisma/migrations-arquivo/20260902100000_codigo_tipo_documento_doc/migration.sql')
ok(/TDOC-\[0-9\]\+\$/.test(mig), 'converte os TDOC-n antigos')
ok(/WHERE "publicCode" IS NULL/.test(mig), 'preenche os tipos que estavam sem código')
ok(/GREATEST\("CodeSequence"\."ultimo"/.test(mig), 'semeia a sequência sem retroceder')
ok(!/DELETE|DROP/i.test(mig), 'migration não apaga nada')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('Código do Tipo de Documento (DOC1, DOC2, DOC3…): validado ✅')
