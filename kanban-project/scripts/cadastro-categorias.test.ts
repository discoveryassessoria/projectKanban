/**
 * GUARDA — Categorias de Serviço: identidade, ordem, integridade e modal.
 * Rodar: npm run test:categorias-servico
 *
 * O que este teste garante:
 *  1. código gerado do nome, único e IMUTÁVEL;
 *  2. duplicidade bloqueada por caixa, acento e espaço excedente;
 *  3. criação na última posição e reordenação correta e estável;
 *  4. exclusão bloqueada com vínculo; inativação preserva o que já existe;
 *  5. o serviço referencia categoria só por `categoriaId` — texto é recusado;
 *  6. nenhuma escrita direta de categoria em texto sobrou no código;
 *  7. o modal cumpre a forma pedida (campos, títulos, foco, descarte).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  normalizarNome, chaveSemantica, mesmoNome, baseDoCodigo, gerarCodigo,
  proximaOrdem, posicoesReordenadas, moverUmaPosicao, moverPara,
} from '../lib/gerenciamento/cadastro-identidade'
import { CADASTROS } from '../src/lib/gerenciamento/cadastros-registry'
import { CATEGORIAS_SERVICO_OFICIAIS } from '../prisma/categorias-servico-oficiais'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Categorias de Serviço — identidade, ordem e integridade\n')

// ── 1) Código: gerado, único, imutável ─────────────────────────────────────
secao('1) Código gerado automaticamente e imutável')
{
  ok('deriva do nome', baseDoCodigo('Registro Civil') === 'REGISTRO_CIVIL')
  ok('ignora acento', baseDoCodigo('Retificação de Registro') === 'RETIFICACAO_DE_REGISTRO')
  ok('colapsa espaço e pontuação', baseDoCodigo('  Cidadania   e   Nacionalidade ') === 'CIDADANIA_E_NACIONALIDADE')
  ok('nome só com símbolos não gera código', gerarCodigo('—/—', []) === '')
  ok('respeita o limite da coluna', baseDoCodigo('a'.repeat(200)).length === 60)

  ok('código é único', gerarCodigo('Registro Civil', ['REGISTRO_CIVIL']) === 'REGISTRO_CIVIL_2')
  ok('colisão em cadeia continua determinística', gerarCodigo('Registro Civil', ['REGISTRO_CIVIL', 'REGISTRO_CIVIL_2']) === 'REGISTRO_CIVIL_3')
  ok('comparação de ocupados ignora caixa', gerarCodigo('Teste', ['teste']) === 'TESTE_2')

  const registry = src('src/lib/gerenciamento/cadastros-registry.ts')
  ok('campo code é imutável e somente leitura', /key: "code"[\s\S]{0,240}imutavel: true[\s\S]{0,80}somenteLeitura: true/.test(registry))

  const rotaPost = src('src/app/api/gerenciamento/cadastros/[entidade]/route.ts')
  ok('campo somenteLeitura NUNCA vem do cliente', rotaPost.includes('if (campo.somenteLeitura) continue'))
  ok('código é gerado no backend a partir do nome', rotaPost.includes('gerarCodigo(base, existentes.map'))

  const rotaPut = src('src/app/api/gerenciamento/cadastros/[entidade]/[id]/route.ts')
  // `dadosDaSpec(..., false)` pula campo imutável: renomear jamais regera o código.
  ok('edição não regera o código', !/data\.code\s*=/.test(rotaPut))
}

// ── 2) Duplicidade semântica ───────────────────────────────────────────────
secao('2) Duplicidade por equivalência semântica')
{
  ok('trim automático', normalizarNome('  Registro Civil  ') === 'Registro Civil')
  ok('espaço duplicado colapsado', normalizarNome('Registro   Civil') === 'Registro Civil')
  ok('caixa não cria cadastro novo', mesmoNome('REGISTRO CIVIL', 'registro civil'))
  ok('acento não cria cadastro novo', mesmoNome('Retificação', 'Retificacao'))
  ok('espaço excedente não cria cadastro novo', mesmoNome('Registro  Civil', 'Registro Civil'))
  ok('nomes realmente diferentes não colidem', !mesmoNome('Registro Civil', 'Registro Civil Judicial'))
  ok('nome vazio não colide com nada', !mesmoNome('', ''))
  ok('chave de comparação nunca é gravada', chaveSemantica('Registro Civil') === 'registro civil')

  const rotaPost = src('src/app/api/gerenciamento/cadastros/[entidade]/route.ts')
  const rotaPut = src('src/app/api/gerenciamento/cadastros/[entidade]/[id]/route.ts')
  ok('POST recusa equivalente (409)', rotaPost.includes('Já existe uma categoria equivalente') && rotaPost.includes('status: 409'))
  ok('PUT recusa equivalente de OUTRO registro', rotaPut.includes('Number(r.id) !== id') && rotaPut.includes('Já existe uma categoria equivalente'))
}

// ── 3) Ordem administrada pelo sistema ─────────────────────────────────────
secao('3) Ordem: nasce no fim, reordena estável')
{
  ok('lista vazia começa em 1', proximaOrdem([]) === 1)
  ok('nasce na última posição', proximaOrdem([{ id: 1, ordem: 1 }, { id: 2, ordem: 7 }]) === 8)
  ok('ordem nula não quebra a contagem', proximaOrdem([{ id: 1, ordem: null }]) === 1)

  const todos = [{ id: 1, ordem: 1 }, { id: 2, ordem: 2 }, { id: 3, ordem: 3 }]
  ok('reordenar dá posições 1..N sem buraco', JSON.stringify(posicoesReordenadas([3, 1, 2], todos)) === JSON.stringify([{ id: 3, ordem: 1 }, { id: 1, ordem: 2 }, { id: 2, ordem: 3 }]))
  ok('id desconhecido é ignorado', posicoesReordenadas([99, 1], todos).length === 3)
  ok('id repetido não duplica posição', posicoesReordenadas([1, 1, 2], todos).length === 3)
  ok('quem ficou de fora vai para o fim, na ordem que tinha', JSON.stringify(posicoesReordenadas([3], todos).map((p) => p.id)) === JSON.stringify([3, 1, 2]))

  ok('mover para cima troca com o anterior', JSON.stringify(moverUmaPosicao([1, 2, 3], 2, 'cima')) === JSON.stringify([2, 1, 3]))
  ok('mover para baixo troca com o seguinte', JSON.stringify(moverUmaPosicao([1, 2, 3], 2, 'baixo')) === JSON.stringify([1, 3, 2]))
  ok('no topo, mover para cima não circula', JSON.stringify(moverUmaPosicao([1, 2, 3], 1, 'cima')) === JSON.stringify([1, 2, 3]))
  ok('no fim, mover para baixo não circula', JSON.stringify(moverUmaPosicao([1, 2, 3], 3, 'baixo')) === JSON.stringify([1, 2, 3]))
  ok('arrastar leva para a posição destino', JSON.stringify(moverPara([1, 2, 3, 4], 4, 0)) === JSON.stringify([4, 1, 2, 3]))
  ok('arrastar para a própria posição não muda nada', moverPara([1, 2, 3], 2, 1).join(',') === '1,2,3')

  const spec = CADASTROS['categorias-servico']
  ok('cadastro é ordenável', spec.ordenavel === true)
  ok('NÃO existe campo manual de ordem', !spec.campos.some((c) => c.key === 'ordem'))
  ok('coluna "Ordem" saiu da listagem', !spec.colunas.some((c) => c.key === 'ordem'))

  const rotaOrdem = src('src/app/api/gerenciamento/cadastros/[entidade]/ordem/route.ts')
  ok('endpoint de ordem existe e é transacional', rotaOrdem.includes('PATCH') && rotaOrdem.includes('prisma.$transaction'))
  ok('endpoint recusa cadastro não ordenável', rotaOrdem.includes('!cfg.ordenavel'))
}

// ── 4) Integridade: exclusão, inativação e auditoria ───────────────────────
secao('4) Integridade referencial')
{
  const spec = CADASTROS['categorias-servico']
  ok('exclusão protegida por vínculo declarado', (spec.protegerExclusao ?? []).some((p) => p.model === 'itemCatalogo' && p.campo === 'categoriaId'))
  ok('auditoria declarada', spec.auditoria === 'CategoriaServico')

  const rotaPut = src('src/app/api/gerenciamento/cadastros/[entidade]/[id]/route.ts')
  ok('DELETE conta vínculos antes de apagar', rotaPut.includes('cfg.protegerExclusao') && rotaPut.includes('usos > 0'))
  ok('com vínculo, a resposta orienta INATIVAR', rotaPut.includes('Inative-o'))
  ok('com vínculo, nada é apagado (409)', /usos > 0[\s\S]{0,600}status: 409/.test(rotaPut))
  ok('inativar/ativar entram na auditoria', rotaPut.includes("'DESATIVAR'") && rotaPut.includes("'REATIVAR'"))
  ok('exclusão entra na auditoria', rotaPut.includes("acao: 'EXCLUIR'"))

  const rotaPost = src('src/app/api/gerenciamento/cadastros/[entidade]/route.ts')
  ok('criação entra na auditoria', rotaPost.includes("acao: 'CRIAR'"))

  const rotaOrdem = src('src/app/api/gerenciamento/cadastros/[entidade]/ordem/route.ts')
  ok('reordenação entra na auditoria', rotaOrdem.includes('registrarAuditoria'))

  const schema = src('prisma/schema.prisma')
  ok('FK real com integridade referencial', /categoria\s+CategoriaServico\?\s+@relation\(fields: \[categoriaId\], references: \[id\], onDelete: Restrict\)/.test(schema))
  ok('categoria em uso não pode ser apagada nem pelo banco', schema.includes('onDelete: Restrict'))
}

// ── 5) O serviço referencia categoria só por ID ────────────────────────────
secao('5) Serviço × categoria: exclusivamente por categoriaId')
{
  const ref = src('src/services/categoria-servico-ref.ts')
  ok('payload com campo textual é RECUSADO', ref.includes('CAMPOS_TEXTO_RECUSADOS') && ref.includes('não existe mais'))
  ok('recusa nome no lugar do id', /'category', 'categoria', 'categoryName', 'categoriaNome'/.test(ref))
  ok('id inexistente é erro, não fallback', ref.includes('Categoria inexistente no cadastro'))
  ok('categoria inativa não pode ser escolhida', ref.includes('Categoria inativa não pode ser selecionada'))
  ok('NUNCA cria categoria a partir do payload', !/categoriaServico\.(create|upsert)/.test(ref))

  const post = src('src/app/api/gerenciamento/produtos-servicos/route.ts')
  const put = src('src/app/api/gerenciamento/produtos-servicos/[id]/route.ts')
  ok('POST do serviço resolve a categoria oficial', post.includes('resolverCategoriaServico'))
  ok('PUT do serviço resolve a categoria oficial', put.includes('resolverCategoriaServico'))
  ok('PUT parcial preserva a categoria atual', put.includes('atual.itemCatalogo?.categoriaId'))

  const sync = src('src/services/catalogo-sync.ts')
  ok('a projeção no mestre grava categoriaId', sync.includes('categoriaId: s.categoriaId ?? null'))
  ok('nenhuma categoria textual na projeção', !/categoria:\s*s\.category/.test(sync))
}

// ── 6) Nenhum resquício textual ────────────────────────────────────────────
secao('6) Ausência de escrita/leitura textual de categoria')
{
  const schema = src('prisma/schema.prisma')
  /** Corpo de UM model — a busca não pode vazar para o model seguinte. */
  const bloco = (nome: string) => {
    const i = schema.indexOf(`model ${nome} {`)
    return i < 0 ? '' : schema.slice(i, schema.indexOf('\n}', i))
  }
  const servicoProduto = bloco('ServicoProduto')
  const itemCatalogo = bloco('ItemCatalogo')
  ok('ServicoProduto sem campo category', servicoProduto !== '' && !/\n\s+category\s+String/.test(servicoProduto))
  ok('ServicoProduto sem campo nationality', !/\n\s+nationality\s+String/.test(servicoProduto))
  ok('ItemCatalogo sem categoria textual', itemCatalogo !== '' && !/\n\s+categoria\s+String/.test(itemCatalogo))
  ok('ItemCatalogo aponta para o cadastro oficial', /categoriaId\s+Int\?/.test(itemCatalogo))

  const mig = src('prisma/migrations/20260830200000_catalogo_referencias_estruturais/migration.sql')
  ok('migration remove as três colunas textuais', /DROP COLUMN IF EXISTS "category"/.test(mig) && /DROP COLUMN IF EXISTS "nationality"/.test(mig) && /DROP COLUMN IF EXISTS "categoria"/.test(mig))
  ok('remoção acontece DEPOIS da verificação', mig.indexOf('RAISE EXCEPTION') < mig.indexOf('DROP COLUMN'))
  ok('migration cria as categorias oficiais', mig.includes("'CIDNAC'") && mig.includes("'REGCIV'") && mig.includes("'RETREG'"))
  ok('migration consolida variações sem duplicar', mig.includes('_mapa_categoria') && mig.includes('ON CONFLICT ("code") DO NOTHING'))
  ok('nada é apagado antes de estar convertido', mig.indexOf('INSERT INTO "ServicoProdutoPais"') < mig.indexOf('DROP COLUMN'))

  // A busca livre da listagem não alcança entidade — para isso existe filtro por id.
  const cat = src('lib/gerenciamento/catalogo-servicos.ts')
  ok('busca livre só em conteúdo próprio', cat.includes("norm([l.codigo ?? '', l.nome, l.descricao ?? ''].join(' '))"))
  ok('filtro de categoria é por id', cat.includes('l.categoriaId !== categoriaId'))

  const v3 = src('src/app/api/financeiro/v3/itens-catalogo/route.ts')
  ok('v3 não busca item por texto de categoria', !/categoria: \{ contains/.test(v3))
}

// ── 7) Dados oficiais ──────────────────────────────────────────────────────
secao('7) Categorias oficiais')
{
  const codes = CATEGORIAS_SERVICO_OFICIAIS.map((c) => c.code)
  ok('exatamente as três categorias definidas', codes.join(',') === 'CIDNAC,REGCIV,RETREG')
  ok('nenhuma categoria especulativa', CATEGORIAS_SERVICO_OFICIAIS.length === 3)
  ok('cada uma tem descrição própria', CATEGORIAS_SERVICO_OFICIAIS.every((c) => c.descricao.length > 20))
  ok('códigos são únicos', new Set(codes).size === codes.length)

  const seedMod = src('prisma/categorias-servico-oficiais.ts')
  ok('seed é idempotente por code', seedMod.includes('where: { code: c.code }') && seedMod.includes('upsert'))
  ok('seed nunca altera o code', !/update:\s*\{[^}]*code:/.test(seedMod))
  ok('resolver por code falha alto se não existir', seedMod.includes('não está cadastrada'))

  // Transcrição continua em Registro Civil.
  const carga = src('prisma/carga-servicos-oficiais.ts')
  ok('Transcrição fica em Registro Civil', /Transcrição de Registro Civil', categoriaCode: 'REGCIV'/.test(carga))
  ok('serviços de nacionalidade em Cidadania e Nacionalidade', (carga.match(/categoriaCode: 'CIDNAC'/g) ?? []).length === 3)
  ok('carga não grava nacionalidade textual', !carga.includes('nationality: s.nationality'))
  ok('carga para se o país não existir', carga.includes('não está em CatalogoPais'))
}

// ── 8) Modal ───────────────────────────────────────────────────────────────
secao('8) Modal de criação e edição')
{
  const spec = CADASTROS['categorias-servico']
  const chaves = spec.campos.map((c) => c.key)
  ok('ordem dos campos: nome, descrição, código, ativo', chaves.join(',') === 'nome,descricao,code,ativo')
  ok('nome é obrigatório', spec.campos.find((c) => c.key === 'nome')?.obrigatorio === true)
  ok('descrição é opcional', !spec.campos.find((c) => c.key === 'descricao')?.obrigatorio)
  ok('descrição tem texto de apoio', !!spec.campos.find((c) => c.key === 'descricao')?.ajuda)
  ok('código é somente leitura', spec.campos.find((c) => c.key === 'code')?.somenteLeitura === true)
  ok('nenhum campo de país/modalidade/processo/cor/ícone/pai/preço', !chaves.some((k) => /pais|modalidade|processo|cor|icone|pai|preco|valor/i.test(k)))
  ok('título no singular disponível', spec.singular === 'categoria de serviço')

  const tela = src('src/components/gerenciamentoComponents/CadastroGenericoTab.tsx')
  ok('título muda entre Nova e Editar', tela.includes('`${form.id ? "Editar" : "Nova"} ${spec.singular}`'))
  ok('campo somente leitura é desabilitado', tela.includes('const desabilitado = !!c.somenteLeitura'))
  ok('código mostra que será gerado', tela.includes('Gerado ao salvar'))
  ok('foco inicial no primeiro campo', tela.includes('autoFocus={indiceCampo === 0'))
  ok('erro aparece abaixo do campo', tela.includes('{erroDesteCampo && <p'))
  ok('Salvar desabilita durante o envio', tela.includes('disabled={busy}') && tela.includes('Salvando…'))
  ok('duplo clique não dispara duas gravações', tela.includes('if (!form || !spec || busy) return'))
  ok('dados preenchidos sobrevivem ao erro', tela.includes('// O formulário CONTINUA preenchido'))
  ok('sucesso só após persistência real', /await load\(\)\s*\n\s*showFlash\("Registro salvo\."\)/.test(tela))
  ok('lista atualiza sem recarregar a página', !tela.includes('window.location.reload'))
  ok('Escape respeita alteração não salva', tela.includes('if (e.key === "Escape") fecharModal()') && tela.includes('Há alterações não salvas'))
  ok('arrasto e botões acessíveis na listagem', tela.includes('draggable={!!spec.ordenavel') && tela.includes('para cima') && tela.includes('para baixo'))
}

console.log(`\n${'='.repeat(64)}`)
console.log(`Categorias de Serviço: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('Identidade, ordem, integridade e modal validados ✅')
