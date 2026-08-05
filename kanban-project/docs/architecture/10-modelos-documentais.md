# 10 — Repositório Oficial de Modelos Documentais

> **MÓDULO CONGELADO em 05/08/2026.** A arquitetura descrita aqui está fechada.
> Alteração futura admitida em exatamente dois casos: **correção de bug** e
> **nova versão de template** (que é um ato de operação, feito pela tela, sem
> tocar em código). Mudança arquitetural — entidade nova, gerador novo, fonte de
> dado nova, mudança de invariante — exige decisão explícita e ADR próprio, como
> qualquer alteração na baseline.

> Extensão da baseline congelada em 04/08/2026. **Nada aqui altera** Cadastro
> Mestre, Documento Operacional, Matriz Documental, PhaseWorkflowInstance,
> materializador, runtime, ciclos, movimentação manual, obrigações, Operação
> Antecipada, sincronismo passo ↔ tarefa, Central Operacional, anexos ou DOC21.
> O guard `npm run test:modelos-guard` prova isso a cada build.

## O problema

Uma procuração era um DOCX no iCloud. Para emitir, alguém abria o arquivo de um
cliente anterior, salvava com outro nome e sobrescrevia nome, RG, CPF e endereço.
Três consequências: o texto jurídico e os dados de uma pessoa real ocupavam o
mesmo arquivo; não havia versão nem autoria; e não havia como provar qual redação
foi usada em qual instrumento assinado.

## A separação

Um **Modelo** não é um documento. É o molde. O documento é o **resultado**.

```
Modelo → Versão publicada → Motor de geração → Documento Gerado → Cliente/Pessoa/Processo
```

A relação nunca se inverte. Não existe "cadastro de procurações": procuração é
uma linha do repositório de modelos, como contrato, declaração e requerimento
serão.

## Modelo de domínio

| Entidade | Papel |
|---|---|
| `ModeloDocumental` | identidade do template: código, nome, categoria, `documentTypeId` (Cadastro Mestre), ativo |
| `ModeloDocumentalVersao` | o DOCX oficial: chave no storage privado, checksum, estado, placeholders, dados fixos declarados, autoria |
| `DocumentoGerado` | o agregado: tipo × outorgante × processo. É ele que garante "uma versão vigente por pessoa + tipo + processo" |
| `DocumentoGeradoVersao` | o par DOCX+PDF de uma geração, com o snapshot imutável dos dados de origem |

Categorias (`ModeloDocumentalCategoria`) são dimensão **fechada** de domínio —
mesma natureza de `TipoArquivoDocumento`. O que o documento **é** continua sendo
`TipoDocumentoCadastro`, por ID.

## Onde mora o texto jurídico

Dentro do DOCX versionado, no storage privado. **Não** em coluna do banco, **não**
em componente, **não** em constante. O banco guarda identidade, versão, checksum,
estado e autoria — o que permite provar qual texto foi usado sem duplicá-lo.

## Regras invariantes

1. **Só versão PUBLICADA gera documento oficial.** Sem versão publicada, a geração
   para com motivo — não há fallback para rascunho.
2. **Versão publicada é imutável.** Alteração de redação cria versão nova; a
   anterior é preservada. Uma publicada por modelo, garantido por índice único
   parcial no banco.
3. **Publicar exige validação aprovada.** Não existe "publicar mesmo assim".
4. **Os dados variáveis vêm do cadastro.** Nunca de observação, metadata, título
   de processo, arquivo anterior ou digitação no ato.
5. **O que falta bloqueia.** Campo obrigatório ausente impede a geração, com o
   campo nomeado. Nenhum documento sai com placeholder vazio.
6. **Gênero gramatical vem do cadastro.** Sem `sexo`, a geração é bloqueada —
   nunca se infere gênero pelo nome.
7. **O PDF é renderizado a partir do DOCX gerado.** Não existe segunda origem de
   conteúdo; os dois arquivos pertencem à mesma versão.
8. **Nova geração cria VERSÃO.** A anterior vira `SUBSTITUIDA` e continua
   acessível, com o snapshot dos dados que a produziram.
9. **Um gerador só.** A aba do cliente, a ação no processo e a prévia usam a
   mesma implementação. A prévia É o documento final, apenas não guardado.
10. **Arquivo é privado.** Storage com prefixo dedicado, chave opaca, URL assinada
    de 5 minutos, emitida só depois da checagem de permissão. A rota nunca aceita
    chave de storage vinda do cliente.

## Renderização do nome do outorgante

O nome do outorgante sai do gerador em **CAIXA ALTA e negrito**, nos dois lugares
em que aparece: a qualificação e a linha de assinatura.

É regra de **renderização**, declarada no registry
(`renderizacao: { caixaAlta: true, negrito: true }`) e aplicada na hora de
escrever no DOCX. O cadastro continua guardando "João da Silva", o checklist da
tela continua mostrando "João da Silva" e o snapshot da versão gerada continua
registrando "João da Silva" — só o documento desenha "**JOÃO DA SILVA**".

O negrito é atributo de *run*, não de parágrafo. Engrossar o run inteiro deixaria
a qualificação toda em negrito; por isso o motor **divide o run**: fecha o
corrente depois do prefixo, abre um com as mesmas propriedades acrescidas de
`w:b`, e reabre outro igual ao original para o sufixo. Fonte, tamanho, cor,
sublinhado, alinhamento e entrelinha vêm do próprio `w:rPr` copiado — nada mais
muda. Se o run já era negrito, nada é acrescentado.

Um modelo futuro que use `{{OUTORGANTE_NOME_COMPLETO}}` herda o tratamento sem
alteração no motor: a regra mora no registry, não no template nem no código de
substituição.

## O validador de template

Publicação é bloqueada quando o DOCX não abre, quando usa variável desconhecida,
quando tem marcador mal formado, quando não usa variável nenhuma, ou quando restou
um literal com forma de identificação civil (CPF, RG, CEP) **não declarado**.

A detecção é por **forma**, não por nome: procurar "EDISON" ou "SYLVIA" amarraria
o sistema a duas pessoas reais e falharia em qualquer template novo. Todo literal
encontrado precisa ser declarado como dado fixo do outorgado — é aí que a
conferência humana acontece.

Há ainda o cruzamento com o cadastro real: número que pertence a um cliente
cadastrado é **erro** sem declaração. Com declaração expressa, permanece
registrado como **aviso** — porque o outorgado das procurações administrativas é
sócio do escritório e tem ficha de cliente, e um bloqueio absoluto reprovaria o
template correto.

## O que este módulo NÃO faz

- **Não cria Documento Operacional.** O motor documental é dono dessa criação;
  inventar documento por fora romperia a materialização. `DocumentoGerado.documentoId`
  existe para o ato explícito de vincular a um documento **já existente** — e esse
  vínculo passa pelo escritor canônico (`vincularArquivoDocumentoTx`), referenciando
  o mesmo binário, sem cópia e sem novo upload.
- **Não materializa passo, não move fase, não toca obrigação.**

## Decisões arquiteturais

**M1 — Storage privado próprio.** O fluxo de anexos usa presign de escrita pelo
navegador e devolve URL pública adivinhável. Correto para o que faz; inaceitável
para um instrumento com CPF, RG e endereço residencial. Aqui o binário nasce no
servidor e sai só assinado.

**M2 — PDF por renderização do DOCX, não por conversor externo.** Converter com
LibreOffice exigiria um binário que o runtime não tem. A alternativa honesta não
era gerar o PDF de outro lugar — isso criaria a segunda fonte que a arquitetura
proíbe —, e sim renderizar o próprio DOCX: página, margens, alinhamento,
entrelinha, recuo, negrito, itálico, sublinhado, tamanho, quebras, cabeçalho,
rodapé e paginação saem do pacote gerado.

**M3 — Determinismo como prova.** Data das entradas do ZIP fixada, data de criação
do PDF fixada e identificador do PDF derivado do DOCX. Sem isso o checksum mudaria
a cada chamada e deixaria de provar identidade — e a idempotência da geração não
reconheceria o mesmo documento.

**M4 — `Documento.origem` não foi alterado.** O `CHECK` do banco admite apenas
`manual|automatica`. Relaxá-lo para acomodar um marcador novo seria mexer no
núcleo congelado; a procedência do documento gerado vive em `DocumentoGerado`,
que é onde ela pertence.

**M5 — Identidade por IDS.** `chaveIdentidade` = tipo + papel/id do outorgante +
processo. Nome de pessoa nunca é chave.

**M6 — Modelo de mensagem ≠ modelo documental.** `ModeloDocumento` (texto de
e-mail/notificação) saiu do menu "Modelos" e passou a se chamar *modelo de
mensagem* na configuração de notificações. O termo "Modelo", na navegação, passa a
ter um dono só.

## Testes obrigatórios

| Suíte | O que prova |
|---|---|
| `npm run test:modelos` | registry, flexão, resolução do outorgante, motor DOCX, motor PDF, validador, preparação de template, identidade (82 asserções) |
| `npm run test:modelos-guard` | um gerador, zero texto jurídico no código, referência por ID, imutabilidade, migration aditiva, fonte única de arquivo, privacidade, permissões, zero legado, transação (62 asserções) |
| `npm run test:modelos-e2e` | os cenários com banco e storage reais: judicial, administrativa, dados ausentes, nova versão, isolamento e invalidação (56 asserções) |

As duas primeiras rodam no `npm run build`.

## Pendências declaradas

- **Órgão expedidor do RG** não existe no cadastro de Contratante/Requerente. A
  variável está no registry e o checklist a marca como ausente com o motivo
  correto; nenhum dos dois modelos oficiais a usa. Um modelo que a exija só será
  publicável depois que o campo entrar no cadastro.
- **`prisma/migrations-arquivo` e recibos/faturas em jsPDF** não foram migrados
  para o repositório: são renderizadores programáticos de artefatos financeiros,
  não templates de texto. Migrá-los muda a identidade visual de uma função em
  produção e é decisão própria.
- **Smoke autenticado por HTTP em produção** não é executável a partir do
  ambiente local: `JWT_SECRET` é *Sensitive* na Vercel. A validação equivalente
  foi feita na camada de serviço, contra o banco e o storage de produção.
