/**
 * MODELOS DOCUMENTAIS — GUARD DE ARQUITETURA.
 *
 * Rodar: npm run test:modelos-guard
 *
 * Esta suíte não testa comportamento: testa que as DECISÕES continuam valendo no
 * código. Ela existe porque as regras que mais custam a recuperar são as que se
 * perdem em silêncio — um segundo gerador, um texto jurídico colado num
 * componente, um arquivo servido por URL pública, uma versão publicada editável.
 *
 * A baseline arquitetural congelada NÃO é alterada por este módulo: as
 * verificações abaixo provam que o repositório de modelos ESTENDE o Discovery
 * sem tocar em Documento, DocumentoArquivo, PhaseWorkflowInstance, Tarefa,
 * materializador, ciclo ou obrigação.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const existe = (rel: string) => existsSync(join(ROOT, rel))

let passou = 0
let falhou = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

/** Código sem comentários: a regra proíbe o CÓDIGO depender de texto, não explicá-lo. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

function arquivosDe(dir: string, filtro: RegExp): string[] {
  const base = join(ROOT, dir)
  if (!existsSync(base)) return []
  const saida: string[] = []
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const caminho = join(d, nome)
      if (statSync(caminho).isDirectory()) { andar(caminho); continue }
      if (filtro.test(nome)) saida.push(caminho)
    }
  }
  andar(base)
  return saida
}

const TODO_SRC = arquivosDe("src", /\.(ts|tsx)$/)
const conteudoSrc = new Map(TODO_SRC.map((f) => [f, readFileSync(f, "utf8")]))

console.log("MODELOS DOCUMENTAIS — guard de arquitetura\n")

// ════════════════════════════════════════════════════════════════════════════
console.log("(1) Um repositório, um gerador:")

ok(existe("src/services/modelos/repositorio-modelos.ts"),
  "1.1 o repositório de modelos tem UMA implementação de escrita")
ok(existe("src/services/modelos/gerar-documento.ts"),
  "1.2 o motor de geração tem UMA implementação")

const escritoresModelo = [...conteudoSrc.entries()]
  .filter(([f, c]) => /modeloDocumentalVersao\.(create|update|upsert)/.test(c)
    && !f.endsWith("repositorio-modelos.ts"))
  .map(([f]) => f.replace(ROOT + "/", ""))
ok(escritoresModelo.length === 0,
  `1.3 só o repositório grava versão de modelo${escritoresModelo.length ? " — vazou: " + escritoresModelo.join(", ") : ""}`)

const escritoresGeracao = [...conteudoSrc.entries()]
  .filter(([f, c]) => /documentoGeradoVersao\.create\b/.test(c)
    && !f.endsWith("gerar-documento.ts"))
  .map(([f]) => f.replace(ROOT + "/", ""))
ok(escritoresGeracao.length === 0,
  `1.4 só o motor cria versão gerada${escritoresGeracao.length ? " — vazou: " + escritoresGeracao.join(", ") : ""}`)

const geradorDocx = [...conteudoSrc.entries()]
  .filter(([f, c]) => /substituirPlaceholdersDocx/.test(c)
    && !f.includes("documentos/modelos/docx.ts")
    && !f.endsWith("gerar-documento.ts"))
  .map(([f]) => f.replace(ROOT + "/", ""))
ok(geradorDocx.length === 0,
  `1.5 a substituição de variáveis só é chamada pelo motor${geradorDocx.length ? " — vazou: " + geradorDocx.join(", ") : ""}`)

const previa = ler("src/services/modelos/gerar-documento.ts")
ok(/export async function gerarPrevia[\s\S]*?produzirArtefatos\(/.test(previa),
  "1.6 a prévia usa o MESMO motor da geração oficial — não existe render paralelo")
ok(!/gerarPrevia[\s\S]{0,400}(prisma\.|tx\.)\w+\.create/.test(previa),
  "1.7 a prévia não persiste nada")

const acaoProcesso = ler("src/components/kanban/ProcuracaoDoProcesso.tsx")
ok(acaoProcesso.includes("DocumentosGeradosTab"),
  "1.8 a ação dentro do processo reusa a MESMA tela do cliente — não há segundo gerador")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(2) O texto jurídico não mora no código:")

// Marcas que SÓ existem se alguém colou a redação do instrumento. Nomes de
// propriedade ("outorgante:") e rótulos de campo ("cédula de identidade") não
// entram: são vocabulário do domínio, não texto do documento.
const MARCAS_DE_TEXTO_JURIDICO = [
  /ad judicia/i,
  /poderes\s*:\s*amplos/i,
  /substabelecer/i,
  /Consulado Geral da It/i,
  /poderes especiais para transigir/i,
  /firme e valioso/i,
  /OUTORGADO:\s*[A-ZÀ-Ý]{3,}/,
]
const vazou = [...conteudoSrc.entries()].filter(([, c]) => {
  const limpo = semComentarios(c)
  return MARCAS_DE_TEXTO_JURIDICO.some((re) => re.test(limpo))
}).map(([f]) => f.replace(ROOT + "/", ""))
ok(vazou.length === 0,
  `2.1 nenhum trecho do instrumento no código${vazou.length ? " — vazou: " + vazou.join(", ") : ""}`)

// Nomes dos clientes dos modelos de origem NUNCA podem existir no código.
const NOMES_DE_ORIGEM = [/EDISON/i, /SYLVIA/i, /ANT[ÃA]O JUNIOR/i, /BONCI/i]
const vazouNome = [...conteudoSrc.entries()]
  .filter(([, c]) => NOMES_DE_ORIGEM.some((re) => re.test(semComentarios(c))))
  .map(([f]) => f.replace(ROOT + "/", ""))
ok(vazouNome.length === 0,
  `2.2 nenhum nome de cliente do modelo de origem no runtime${vazouNome.length ? " — vazou: " + vazouNome.join(", ") : ""}`)

const validador = semComentarios(ler("src/lib/documentos/modelos/validador.ts"))
ok(!NOMES_DE_ORIGEM.some((re) => re.test(validador)),
  "2.3 o validador não procura nome de cliente — detecta FORMA de identificação")

const docxDir = arquivosDe("src", /\.docx$/i)
ok(docxDir.length === 0,
  `2.4 nenhum DOCX solto dentro de src/${docxDir.length ? " — achado: " + docxDir.join(", ") : ""}`)
ok(arquivosDe("public", /\.docx$/i).length === 0, "2.5 nenhum DOCX solto em public/")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(3) Referência estrutural por ID, nunca por nome:")

const NOMES_DE_MODELO = [/"Procuração Judicial"/, /"Procuração Administrativa"/, /'Procuração Judicial'/]
const runtimeSemNome = [
  "src/services/modelos/gerar-documento.ts",
  "src/services/modelos/repositorio-modelos.ts",
  "src/services/modelos/documentos-gerados.ts",
  "src/services/modelos/outorgante.ts",
  "src/lib/documentos/modelos/variaveis.ts",
  "src/lib/documentos/modelos/docx.ts",
  "src/lib/documentos/modelos/pdf.ts",
  "src/lib/documentos/modelos/validador.ts",
].map(ler).join("\n")
ok(!NOMES_DE_MODELO.some((re) => re.test(semComentarios(runtimeSemNome))),
  "3.1 o runtime nunca cita o nome de um modelo como chave")
ok(!/PROC-JUD|PROC-ADM|DOC19|DOC20/.test(semComentarios(runtimeSemNome)),
  "3.2 o runtime não conhece código de modelo nem publicCode de tipo")

const tela = semComentarios(ler("src/components/contratantesComponents/DocumentosGeradosTab.tsx"))
ok(!NOMES_DE_MODELO.some((re) => re.test(tela)) && !/PROC-JUD|PROC-ADM/.test(tela),
  "3.3 a tela não hardcoda modelo — lista o que o repositório publicou")
ok(tela.includes("/api/documentos-gerados/modelos"),
  "3.4 a lista de tipos vem do servidor, não de uma constante local")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(4) Imutabilidade da versão publicada:")

const repo = ler("src/services/modelos/repositorio-modelos.ts")
ok(!/status:\s*"RASCUNHO"[\s\S]{0,200}update/.test(repo),
  "4.1 não existe caminho que devolva versão publicada a rascunho")
ok(/VERSAO_REVOGADA/.test(repo),
  "4.2 versão revogada não volta a ser publicada")
ok(/if \(!validacao\.ok\)[\s\S]{0,200}VALIDACAO_REPROVADA/.test(repo),
  "4.3 publicar EXIGE validação aprovada — não existe 'publicar mesmo assim'")

const migracao = "prisma/migrations/20260805_modelos_documentais/migration.sql"
ok(existe(migracao), "4.4 a migration do módulo está versionada")
const sql = ler(migracao)
ok(/CREATE UNIQUE INDEX[\s\S]{0,200}"ModeloDocumentalVersao" \("modeloId"\)[\s\S]{0,80}WHERE "status" = 'PUBLICADA'/.test(sql),
  "4.5 o BANCO garante UMA versão publicada por modelo")
ok(/CREATE UNIQUE INDEX[\s\S]{0,220}"DocumentoGeradoVersao" \("documentoGeradoId"\)[\s\S]{0,80}WHERE "status" = 'VIGENTE'/.test(sql),
  "4.6 o BANCO garante UMA versão vigente por documento gerado")
ok(/CHECK \(\("contratanteId" IS NOT NULL\)::int \+ \("requerenteId" IS NOT NULL\)::int = 1\)/.test(sql),
  "4.7 o BANCO garante exatamente um outorgante por documento gerado")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(5) Migration aditiva — a baseline não foi tocada:")

const linhasDestrutivas = sql
  .split("\n")
  .filter((l) => /^\s*(DROP|TRUNCATE|DELETE|ALTER TABLE\s+"?\w+"?\s+DROP)/i.test(l))
ok(linhasDestrutivas.length === 0,
  `5.1 a migration não tem DROP/TRUNCATE/DELETE${linhasDestrutivas.length ? ": " + linhasDestrutivas[0] : ""}`)

const TABELAS_CONGELADAS = [
  "Documento", "DocumentoArquivo", "PhaseWorkflowInstance", "PhaseWorkflowStepInstance",
  "Tarefa", "Processo", "SolicitacaoDocumento", "ExigenciaEvidenciaEtapa", "NecessidadeDocumental",
]
const alteracoesProibidas = TABELAS_CONGELADAS.filter((t) =>
  new RegExp(`ALTER TABLE "${t}"(?![\\s\\S]{0,80}ADD CONSTRAINT "DocumentoGerado)`, "").test(sql),
)
ok(alteracoesProibidas.length === 0,
  `5.2 nenhuma tabela da baseline é alterada${alteracoesProibidas.length ? ": " + alteracoesProibidas.join(", ") : ""}`)

const schema = ler("prisma/schema.prisma")
function bloco(nome: string): string {
  const i = schema.indexOf(`model ${nome} {`)
  if (i < 0) return ""
  return schema.slice(i, schema.indexOf("\n}", i) + 2)
}
ok(!/\bdocumentoGeradoId\b/.test(bloco("PhaseWorkflowInstance")),
  "5.3 PhaseWorkflowInstance segue sem saber de documento gerado")
ok(!/\bdocumentoGeradoId\b/.test(bloco("Documento")),
  "5.4 Documento não ganhou coluna nova — a referência sai do documento gerado")
ok(bloco("Documento").includes('origem   String  @default("manual")')
  || /origem\s+String\s+@default\("manual"\)/.test(bloco("Documento")),
  "5.5 Documento.origem não foi alterado — a origem do gerado vive em DocumentoGerado")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(6) Fonte única de arquivo — nada é copiado:")

const gerados = ler("src/services/modelos/documentos-gerados.ts")
ok(/vincularArquivoDocumentoTx/.test(gerados),
  "6.1 vincular a documento operacional usa o escritor canônico de arquivo")
const escreveArquivoDireto = [...conteudoSrc.entries()]
  .filter(([f, c]) => /documentoArquivo\.(create|createMany)/.test(c) && !f.includes("documento-arquivos.ts"))
  .map(([f]) => f.replace(ROOT + "/", ""))
ok(escreveArquivoDireto.length === 0,
  `6.2 o módulo não abriu um segundo escritor de DocumentoArquivo${escreveArquivoDireto.length ? " — vazou: " + escreveArquivoDireto.join(", ") : ""}`)
ok(/urlInternaDoArquivo/.test(gerados) && !/R2_PUBLIC_URL/.test(gerados),
  "6.3 o vínculo aponta para a rota autenticada — nunca para URL pública do bucket")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(7) Privacidade dos arquivos:")

const storage = ler("src/lib/documentos/modelos/storage-privado.ts")
ok(!/R2_PUBLIC_URL/.test(semComentarios(storage)),
  "7.1 o storage do módulo NUNCA monta URL pública")
ok(/getSignedUrl/.test(storage) && /VALIDADE_URL_ASSINADA/.test(storage),
  "7.2 o acesso é por URL assinada com validade")
ok(/PREFIXO_PRIVADO = "privado\//.test(storage),
  "7.3 os objetos vivem em prefixo privado dedicado")
ok(/randomUUID\(\)/.test(storage),
  "7.4 a chave do objeto é opaca — não carrega identidade da pessoa no caminho")

const rotaArquivo = ler("src/app/api/documentos-gerados/[id]/arquivo/route.ts")
ok(/verificarPermissao\(request, "documentos_gerados\.baixar"\)/.test(rotaArquivo),
  "7.5 baixar exige permissão própria, verificada no servidor")
ok(!/chave|storageKey/.test(rotaArquivo.replace(/\/\/.*$/gm, "")),
  "7.6 a rota nunca aceita chave de storage vinda do cliente (anti-IDOR)")
const servico = ler("src/services/modelos/documentos-gerados.ts")
ok(/documentoGeradoId: args\.documentoGeradoId/.test(servico),
  "7.7 a versão é resolvida SEMPRE dentro do documento pedido")

const blocoAuditoria = semComentarios(ler("src/services/modelos/gerar-documento.ts"))
  .split("logAuditoria.create")[1]
  ?.split("})")[0] ?? ""
ok(!/valores|snapshot|cpf|rg\b/i.test(blocoAuditoria),
  "7.8 a auditoria registra o ato e os IDs — nunca os dados pessoais do documento")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(8) Permissões:")

const permissoes = ler("src/lib/permissoes.ts")
for (const p of ["modelos.ver", "modelos.gerenciar", "modelos.publicar", "modelos.revogar",
                 "documentos_gerados.ver", "documentos_gerados.gerar", "documentos_gerados.baixar",
                 "documentos_gerados.vincular", "documentos_gerados.invalidar"]) {
  ok(permissoes.includes(`'${p}'`), `8.x a permissão ${p} existe no catálogo oficial`)
}

const rotas = arquivosDe("src/app/api/documentos-gerados", /route\.ts$/)
  .concat(arquivosDe("src/app/api/gerenciamento/modelos", /route\.ts$/))
const semGuarda = rotas
  .filter((f) => !/verificarPermissao|exigirPermissao/.test(readFileSync(f, "utf8")))
  .map((f) => f.replace(ROOT + "/", ""))
ok(semGuarda.length === 0,
  `8.10 toda rota do módulo verifica permissão no servidor${semGuarda.length ? " — sem guarda: " + semGuarda.join(", ") : ""}`)

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(9) Zero legado:")

const registry = ler("src/lib/gerenciamento/cadastros-registry.ts")
ok(!/^\s*modelos:\s*\{[\s\S]{0,80}entidade: "modelos"/m.test(registry),
  "9.1 o cadastro genérico de 'modelos de texto' saiu do motor de cadastros")
const paginaAdmin = ler("src/app/administrator/page.tsx")
ok(/templates:\s*ModelosDocumentaisTab/.test(paginaAdmin),
  "9.2 a tela Sistema › Modelos aponta para o repositório oficial")
ok(!/templates:\s*cad\("modelos"\)/.test(paginaAdmin),
  "9.3 a tela antiga (CRUD de texto em coluna) não é mais alcançável pelo menu")
ok(/modelosMensagem/.test(registry),
  "9.4 o modelo de MENSAGEM (notificação) tem nome próprio — não disputa o termo 'modelo'")

// Nenhum fallback/alias: se não há versão publicada, a geração falha com motivo.
const motor = semComentarios(ler("src/services/modelos/gerar-documento.ts"))
ok(/SEM_VERSAO_PUBLICADA/.test(motor) && !/versaoPadrao|fallback|ultimaVersao/i.test(motor),
  "9.5 sem versão publicada a geração PARA — não existe fallback para rascunho")
ok(!/catch\s*\{\s*\}/.test(motor.replace(/removerObjetoPrivado[\s\S]{0,60}/g, "")),
  "9.6 nenhum erro é engolido silenciosamente no motor")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(10) Transação e compensação:")

ok(/prisma\.\$transaction\(async \(tx\)/.test(motor),
  "10.1 a geração oficial acontece em UMA transação")
ok(/FOR UPDATE/.test(motor),
  "10.2 gerações concorrentes do mesmo documento são serializadas no banco")
ok(/chaveIdempotencia/.test(motor),
  "10.3 duplo clique e retry caem na mesma versão")
ok(/removerObjetoPrivado\(objetoDocx\.chave\)/.test(motor),
  "10.4 falha na transação remove os binários — nenhum arquivo órfão")
const corpoGerar = motor.slice(motor.indexOf("export async function gerarDocumento"))
ok(
  corpoGerar.indexOf("await produzirArtefatos(") >= 0 &&
    corpoGerar.indexOf("await produzirArtefatos(") < corpoGerar.indexOf("gravarObjetoPrivado("),
  "10.5 nada sobe ao storage antes de o documento estar provado",
)
ok(/PLACEHOLDER_REMANESCENTE/.test(motor) && /PDF_INVALIDO/.test(motor) && /DOCX_INVALIDO/.test(motor),
  "10.6 DOCX, PDF e ausência de placeholder são conferidos antes de persistir")

// ════════════════════════════════════════════════════════════════════════════
console.log("\n(11) Módulo congelado (05/08/2026):")

const doc = ler("docs/architecture/10-modelos-documentais.md")
ok(/M[ÓO]DULO CONGELADO em 05\/08\/2026/.test(doc),
  "11.1 o congelamento está declarado no documento de arquitetura")
ok(/corre[çc][ãa]o de bug/.test(doc) && /nova vers[ãa]o de template/.test(doc),
  "11.2 as duas exceções admitidas estão nomeadas")

const variaveis = ler("src/lib/documentos/modelos/variaveis.ts")
ok(/renderizacao: \{ caixaAlta: true, negrito: true \}/.test(variaveis),
  "11.3 a renderização do nome do outorgante é declarada no REGISTRY, não no motor")
ok((variaveis.match(/renderizacao: \{ caixaAlta: true, negrito: true \}/g) || []).length === 2,
  "11.4 vale para a qualificação e para a assinatura — o mesmo nome, do mesmo jeito")
ok(/valorRenderizado/.test(ler("src/lib/documentos/modelos/docx.ts")),
  "11.5 a caixa alta acontece na escrita do DOCX")

const resolver = semComentarios(ler("src/services/modelos/outorgante.ts"))
ok(!/toLocaleUpperCase|toUpperCase/.test(resolver),
  "11.6 o resolvedor NÃO altera a grafia — cadastro, checklist e snapshot ficam como estão")
const motorGeracao = semComentarios(ler("src/services/modelos/gerar-documento.ts"))
ok(!/toLocaleUpperCase|toUpperCase/.test(motorGeracao),
  "11.7 o snapshot guarda o valor do cadastro, não o desenhado")

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0) {
  console.log("FALHAS: " + falhas.join("; "))
  process.exit(1)
}
console.log("\nGUARD DOS MODELOS DOCUMENTAIS ✅ — extensão sem tocar na baseline.")
