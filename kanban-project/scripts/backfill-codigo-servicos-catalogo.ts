// scripts/backfill-codigo-servicos-catalogo.ts
//
// BACKFILL — serviço do Catálogo sem código canônico SRV-n.
//
// CAUSA QUE ELE CORRIGE
// ---------------------
// O Catálogo de Serviços exibe DUAS origens do mesmo mestre: ServicoProduto
// (cadastro canônico, portador de `publicCode` = SRV-n) e ItemCatalogo de
// natureza SERVICO que ainda não virou serviço. A segunda origem não tem onde
// carregar o código, então aparece com "—".
//
// O backfill promove esses itens ao cadastro canônico com
// `garantirServicoDoItem` — o MESMO serviço que a rota usa. Nenhum código é
// montado aqui: quem numera é o CodeGeneratorService, pela extensão do Prisma.
//
// GARANTIAS
//   • idempotente — item que já tem serviço é pulado sem consumir número;
//   • aditivo — nada é apagado, renomeado ou renumerado; a chave estrutural do
//     mestre (SRV_EMISSAO_CERTIDAO…) permanece intacta;
//   • um serviço por transação — falha em um não desfaz os já promovidos, e o
//     que falha não deixa serviço sem código (a transação dele cai inteira);
//   • dry-run por padrão. Escreve só com --execute.
//
// Uso: npm run backfill:codigo-servicos:dry | npm run backfill:codigo-servicos

// O client ESTENDIDO é obrigatório aqui: é a extensão de `lib/prisma` que chama o
// CodeGeneratorService no create. Um `new PrismaClient()` cru gravaria o serviço
// sem código — exatamente o defeito que este backfill corrige.
import { prisma } from '@/lib/prisma'
import { NaturezaItem } from '@prisma/client'
import { garantirServicoDoItem } from '@/src/services/catalogo-sync'

const EXECUTAR = process.argv.includes('--execute')

async function main() {
  const candidatos = await prisma.itemCatalogo.findMany({
    where: { natureza: NaturezaItem.SERVICO, servicos: { none: {} } },
    orderBy: { id: 'asc' },
    select: { id: true, code: true, name: true, ativo: true },
  })

  console.log(`\n${EXECUTAR ? 'EXECUÇÃO' : 'DRY-RUN'} — serviços do Catálogo sem código canônico`)
  console.log(`Itens de natureza SERVICO sem ServicoProduto: ${candidatos.length}`)
  if (candidatos.length === 0) {
    console.log('Nada a fazer: todo serviço do Catálogo já tem cadastro canônico (e portanto código).')
    return
  }
  for (const c of candidatos) console.log(`  · item #${c.id} ${c.code} — "${c.name}"${c.ativo ? '' : ' (inativo)'}`)

  if (!EXECUTAR) {
    console.log('\nNenhuma escrita feita. Rode com --execute para promover e gerar os códigos.')
    return
  }

  console.log('')
  const atribuidos: string[] = []
  for (const c of candidatos) {
    // Timeout folgado: contra o banco de produção cada ida-e-volta custa, e o
    // default de 5s estoura no meio da desambiguação da chave técnica.
    const r = await prisma.$transaction((tx) => garantirServicoDoItem(tx, c.id), { timeout: 30000, maxWait: 10000 })
    console.log(`  ${r.criado ? '✓ criado ' : '· já existia'} ${r.publicCode} → "${c.name}" (serviço #${r.servicoId}, item #${c.id})`)
    if (r.criado && r.publicCode) atribuidos.push(`${r.publicCode} = ${c.name}`)
  }

  // VERIFICAÇÃO FINAL — a promessa do backfill é "nenhum serviço sem código".
  // Conferida contra o banco, não contra o que o laço acha que fez.
  const [restantes, semCodigo] = await Promise.all([
    prisma.itemCatalogo.count({ where: { natureza: NaturezaItem.SERVICO, servicos: { none: {} } } }),
    prisma.servicoProduto.count({ where: { publicCode: null } }),
  ])
  console.log(`\nAtribuídos agora: ${atribuidos.length}`)
  for (const a of atribuidos) console.log(`  ${a}`)
  console.log(`Itens SERVICO ainda sem cadastro canônico: ${restantes}`)
  console.log(`ServicoProduto ainda sem publicCode: ${semCodigo}`)
  if (restantes > 0 || semCodigo > 0) {
    throw new Error('Backfill terminou com serviço sem código — investigar antes de seguir.')
  }
  console.log('OK: todo serviço do Catálogo possui código canônico SRV-n.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
