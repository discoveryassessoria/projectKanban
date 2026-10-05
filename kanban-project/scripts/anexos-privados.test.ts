// scripts/anexos-privados.test.ts — anexo novo só no bucket PRIVADO; abrir só pela porta (login + permissão + URL de 5 min) (sem banco, sem rede).
//   npx tsx scripts/anexos-privados.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
process.env.R2_ACCOUNT_ID = "conta-teste"; process.env.R2_ACCESS_KEY_ID = "ak"; process.env.R2_SECRET_ACCESS_KEY = "sk"
process.env.R2_BUCKET_NAME = "bucket-publico-teste"; process.env.R2_PUBLIC_URL = "https://pub-teste.r2.dev"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const sem = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n")

async function main() {
  const { novaChaveDeAnexo, alvoDaChave, leituraDoValor, ehChaveDeAnexo, PERMISSAO_DO_DOMINIO, DOMINIOS_DE_ANEXO, PREFIXO_ANEXOS } = await import("../src/lib/anexos/chave")
  const { autorizarAbertura, autorizarAcessoAoAlvo, VALIDADE_DA_URL_DE_ANEXO_SEGUNDOS } = await import("../src/lib/anexos/porta")
  const { bucketDoAnexoNovo, prepararEnvioDeAnexo, BucketPrivadoNaoConfigurado } = await import("../src/lib/anexos/storage")

  console.log("a chave")
  const k = novaChaveDeAnexo({ alvo: { dominio: "contratante", id: 12 }, nome: "RG da Ana (frente).pdf", carimbo: 1700000000000, uuid8: "abcd1234" })
  ok("nasce em privado/anexos/<domínio>/<id>/… com nome seguro", k === "privado/anexos/contratante/12/1700000000000-abcd1234-RG_da_Ana_frente_.pdf", k)
  ok("a chave diz de quem é (domínio + id)", JSON.stringify(alvoDaChave(k)) === JSON.stringify({ dominio: "contratante", id: 12 }))
  ok("endereço antigo, caminho com .. e prefixo errado NÃO são chave de anexo", !ehChaveDeAnexo("https://pub.r2.dev/documentos/1/a.pdf") && !ehChaveDeAnexo("privado/anexos/../coleta/1/x") && !ehChaveDeAnexo("privado/coleta/1/u/x.png") && alvoDaChave("privado/anexos/inexistente/1/x") === null)
  ok("leitura dos DOIS formatos: chave nova → assinar; endereço antigo → usar como está; vazio → nada", leituraDoValor(k).tipo === "chave" && leituraDoValor("https://pub.r2.dev/a.pdf").tipo === "endereco" && leituraDoValor("  ").tipo === "vazio" && leituraDoValor(null).tipo === "vazio")
  ok("todo domínio tem permissão definida (rascunho = só quem enviou)", DOMINIOS_DE_ANEXO.every((d) => d in PERMISSAO_DO_DOMINIO) && PERMISSAO_DO_DOMINIO.rascunho === null)

  console.log("abrir sem permissão é NEGADO")
  const sempermissao = { userId: 5, tipo: "assistente", permissoes: {} as Record<string, boolean> }
  const comProcessos = { userId: 6, tipo: "assistente", permissoes: { "processos.ver": true } }
  const comClientes = { userId: 7, tipo: "assistente", permissoes: { "clientes.ver": true } }
  ok("sem login → 401", (autorizarAbertura(null, k) as { status: number }).status === 401)
  ok("logado SEM a permissão do módulo → 403 (anexo de cliente sem clientes.ver)", (autorizarAbertura(sempermissao, k) as { status: number }).status === 403)
  ok("com processos.ver, mas anexo de CLIENTE → 403 (permissão de outro módulo não serve)", (autorizarAbertura(comProcessos, k) as { status: number }).status === 403)
  ok("com clientes.ver, anexo de cliente → liberado", autorizarAbertura(comClientes, k).ok === true)
  const kProc = novaChaveDeAnexo({ alvo: { dominio: "processo", id: 847 }, nome: "a.pdf", uuid8: "u1" })
  ok("anexo de processo: processos.ver libera; clientes.ver não", autorizarAbertura(comProcessos, kProc).ok === true && (autorizarAbertura(comClientes, kProc) as { status: number }).status === 403)
  const kFin = novaChaveDeAnexo({ alvo: { dominio: "financeiro", id: 3 }, nome: "c.pdf", uuid8: "u2" })
  ok("comprovante financeiro: só financeiro.ver", (autorizarAbertura(comProcessos, kFin) as { status: number }).status === 403 && autorizarAbertura({ userId: 8, tipo: "x", permissoes: { "financeiro.ver": true } }, kFin).ok === true)
  const kRasc = novaChaveDeAnexo({ alvo: { dominio: "rascunho", id: 7 }, nome: "r.pdf", uuid8: "u3" })
  ok("rascunho: só quem enviou (7) abre; outro usuário, mesmo com todas as permissões, não", autorizarAbertura(comClientes, kRasc).ok === true && (autorizarAbertura({ userId: 9, tipo: "admin", permissoes: { "clientes.ver": true, "processos.ver": true, "financeiro.ver": true } }, kRasc) as { status: number }).status === 403)
  ok("chave inválida/endereço antigo na porta → 400 (a porta só assina chave de anexo)", (autorizarAbertura(comClientes, "https://pub.r2.dev/x.pdf") as { status: number }).status === 400 && (autorizarAbertura(comClientes, "privado/coleta/1/u/rg.png") as { status: number }).status === 400 && (autorizarAbertura(comClientes, 123 as unknown) as { status: number }).status === 400)
  ok("gravar também exige a permissão do domínio (não gera URL de envio para quem não pode ver)", (autorizarAcessoAoAlvo(sempermissao, { dominio: "processo", id: 1 }) as { status: number }).status === 403 && autorizarAcessoAoAlvo(comProcessos, { dominio: "protocolo", id: 1 }).ok === true)

  console.log("anexo NOVO nunca vai ao bucket público")
  const cfgDuplo = { publico: "bucket-publico-teste", privado: "discovery-privado-teste" }
  ok("modo duplo: o anexo novo é gravado no bucket PRIVADO", bucketDoAnexoNovo(k, cfgDuplo) === "discovery-privado-teste")
  let recusou = false
  try { bucketDoAnexoNovo(k, { publico: "bucket-publico-teste", privado: null }) } catch (e) { recusou = e instanceof BucketPrivadoNaoConfigurado }
  ok("sem bucket privado configurado: RECUSA (nunca cai no público)", recusou)
  let recusou2 = false
  try { bucketDoAnexoNovo(k, { publico: "mesmo", privado: "mesmo" }) } catch (e) { recusou2 = e instanceof BucketPrivadoNaoConfigurado }
  ok("privado igual ao público (configuração errada): RECUSA", recusou2)
  process.env.R2_BUCKET_PRIVADO = "discovery-privado-teste"
  const envio = await prepararEnvioDeAnexo({ alvo: { dominio: "protocolo", id: 99 }, nome: "Comprovante.pdf", tipo: "application/pdf", tamanho: 1234 })
  const host = new URL(envio.uploadUrl).hostname
  ok("a URL de envio assinada aponta para o bucket PRIVADO (e não para o público)", host.startsWith("discovery-privado-teste.") && !host.includes("bucket-publico-teste"), host)
  ok("a chave devolvida é a do privado/anexos e o endereço NÃO é público (nada de r2.dev)", envio.chave.startsWith(`${PREFIXO_ANEXOS}/protocolo/99/`) && !envio.uploadUrl.includes("r2.dev"))
  ok("o envio vale poucos minutos (X-Amz-Expires ≤ 300)", Number(new URL(envio.uploadUrl).searchParams.get("X-Amz-Expires")) <= 300)

  console.log("a URL assinada de abrir EXPIRA")
  const { urlAssinadaDoAnexo } = await import("../src/lib/anexos/storage")
  const resolver = async () => "discovery-privado-teste"
  const ass = await urlAssinadaDoAnexo(k, "RG.pdf", "application/pdf", false, resolver)
  const u = new URL(ass.url)
  const data = u.searchParams.get("X-Amz-Date")!, dur = Number(u.searchParams.get("X-Amz-Expires"))
  const emitida = Date.parse(`${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}T${data.slice(9, 11)}:${data.slice(11, 13)}:${data.slice(13, 15)}Z`)
  ok("validade = 5 minutos (300 s), nunca mais que isso", dur === 300 && VALIDADE_DA_URL_DE_ANEXO_SEGUNDOS === 300 && ass.expiraEmSegundos === 300)
  ok("a assinatura carrega o instante e a duração: expira 5 min depois de emitida (não é endereço fixo)", Math.abs(Date.now() - emitida) < 5000 && emitida + dur * 1000 <= Date.now() + 301_000 && emitida + dur * 1000 > Date.now())
  ok("aponta para o bucket PRIVADO", u.hostname.startsWith("discovery-privado-teste."))
  const ass2 = await urlAssinadaDoAnexo(k, "RG.pdf", "application/pdf", true, resolver)
  ok("baixar: a mesma URL curta, com Content-Disposition: attachment", /attachment/.test(decodeURIComponent(new URL(ass2.url).searchParams.get("response-content-disposition") ?? "")))

  console.log("estático: ninguém mais usa o endereço público do bucket")
  const rotas = ["src/app/api/storage/presign/route.ts", "src/app/api/app/upload/presign/route.ts", "src/app/api/anexos/abrir/route.ts"].map((p) => sem(p)).join("\n")
  ok("as rotas de envio e de abrir não usam R2_PUBLIC_URL nem o bucket público", !/R2_PUBLIC_URL|R2_BUCKET\b/.test(rotas))
  const porta = sem("src/app/api/anexos/abrir/route.ts")
  ok("a porta autoriza ANTES de assinar", porta.indexOf("autorizarAbertura(") > -1 && porta.indexOf("autorizarAbertura(") < porta.indexOf("urlAssinadaDoAnexo(") && /decisao\.ok/.test(porta))
  ok("o presign confere login e permissão do alvo e recusa sem 'alvo'", /extrairUsuarioComPermissoes/.test(sem("src/app/api/storage/presign/route.ts")) && /autorizarAcessoAoAlvo/.test(sem("src/app/api/storage/presign/route.ts")) && /alvo \{ dominio, id \} é obrigatório/.test(sem("src/app/api/storage/presign/route.ts")))
  ok("a confirmação do app do cliente só aceita chave da pasta do PRÓPRIO processo (antes aceitava qualquer texto)", /alvoDaChave\(publicUrl\)/.test(sem("src/app/api/app/upload/confirmar/route.ts")) && /necessidade\.processoId/.test(sem("src/app/api/app/upload/confirmar/route.ts")))
  ok("a coleta confirma movendo dentro do privado (sem R2_PUBLIC_URL)", !/R2_PUBLIC_URL|R2_BUCKET\b/.test(sem("src/services/coleta/storage-coleta.ts")))

  console.log("estático: nenhuma tela abre anexo por endereço direto")
  const arquivos: string[] = []
  const varre = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) varre(p); else if (/\.tsx$/.test(n)) arquivos.push(p) } }
  varre("src/components"); varre("src/app")
  const padrao = /(href|src)=\{[^}]*\b(urlArquivo|arquivoUrl|arquivo_url|arquivo_traducao_url|arquivo_apostila_url|comprovanteUrl|anexoUrl|pdfUrl|doc\.url|a\.url)\b[^}]*\}/
  const diretos = arquivos.filter((p) => !p.includes("bitrix-sidebar")).flatMap((p) => sem(p).split("\n").map((l, i) => ({ p, i: i + 1, l })).filter((x) => padrao.test(x.l)))
  ok("nenhum href/src usa o valor do anexo cru (sempre LinkDeAnexo / ImagemDeAnexo / IframeDeAnexo / abrirAnexo)", diretos.length === 0, diretos.slice(0, 4).map((d) => `${d.p}:${d.i}`).join(" | "))
  const uploads = arquivos.filter((p) => /uploadFiles\(/.test(sem(p))).flatMap((p) => { const s = sem(p); return [...s.matchAll(/uploadFiles\(/g)].map((m) => ({ p, ok: /alvo/.test(s.slice(m.index!, m.index! + 260)) })) })
  ok("todo uploadFiles informa o alvo (de quem é o anexo)", uploads.length >= 9 && uploads.every((u) => u.ok), uploads.filter((u) => !u.ok).map((u) => u.p).join(", "))

  console.log(`\n${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
