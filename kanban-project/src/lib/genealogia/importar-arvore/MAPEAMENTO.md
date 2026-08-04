# Mapeamento de campos — Importar Árvore por imagem

Fonte da verdade: os models `Pessoa` e `Uniao` do `prisma/schema.prisma`. Os
rótulos da coluna "Formulário" são os que o operador vê ao adicionar pai/mãe
manualmente.

## Pessoa

| Formulário (tela) | `PessoaExtraida` | Coluna Prisma | Tipo | Obrigatório |
|---|---|---|---|---|
| Nome | `nome` | `Pessoa.nome` | `VarChar(50)` | **sim** |
| Sobrenome | `sobrenome` | `Pessoa.sobrenome` | `VarChar(40)?` | não |
| Sexo | `sexo` | `Pessoa.sexo` | `VarChar(10)?` | não |
| Data de Nascimento | `data_nasc` | `Pessoa.data_nasc` | `DateTime?` | não |
| Cidade de Nascimento | `local_nasc` | `Pessoa.local_nasc` | `VarChar(100)?` | não |
| Estado de Nascimento | `estado_nasc` | `Pessoa.estado_nasc` | `VarChar(50)?` | não |
| País de Nascimento | `pais_nasc` | `Pessoa.pais_nasc` | `VarChar(50)?` | não |
| Nacionalidade | `nacionalidade` | `Pessoa.nacionalidade` | `VarChar(50)?` | não |
| Data de Falecimento | `data_obito` | `Pessoa.data_obito` | `DateTime?` | não |
| **Local de Falecimento** | `local_obito` | **não existe** | — | — |
| Nº Linhagem | `numeroLinhagem` | `Pessoa.numeroLinhagem` | `Int?` | não |
| (derivado) | — | `Pessoa.vivo` | `Boolean` | preenchido: `false` se há `data_obito` |
| (derivado) | — | `Pessoa.casado` | `Boolean` | preenchido: `true` se a pessoa entra em alguma união |
| (fixo) | — | `Pessoa.requerente` | `VarChar` | sempre `"nao"` — ver abaixo |
| (contexto) | — | `Pessoa.arvoreId` | `Int` | vem da rota, não da imagem |

### Local de falecimento — o campo que não tem onde entrar

`Pessoa` tem `data_obito` mas **não tem coluna de local de falecimento**. O
contrato extrai `local_obito` para não perder o dado da leitura, mas a rota
**não grava**. Persistir exige migration (`local_obito VarChar(100)?`), que não
foi feita porque está fora do escopo desta etapa.

### Requerente nunca vem da importação

`Pessoa.requerente` é sempre gravado como `"nao"`. A condição de requerente é
definida só pelo vínculo com o Processo (`ProcessoRequerente`), nunca por
criação de Pessoa — a mesma invariante que `POST /api/pessoas` aplica.

## Filiação

Não é campo de formulário: é a ligação entre cards.

| `PessoaExtraida` | Coluna Prisma |
|---|---|
| `paiRef` (ref local) | `Pessoa.paiId` (resolvido após criar todos) |
| `maeRef` (ref local) | `Pessoa.maeId` (idem) |

`ref` é identificador **local à extração** (`"p1"`, `"p2"`), não id de banco.
A gravação acontece em duas passadas: cria todas as pessoas sem parentesco,
depois liga. Ligar na criação exigiria ordenação topológica, e um ciclo nos
dados travaria a importação inteira.

## Uniao (casamento)

| Formulário | `UniaoExtraida` | Coluna Prisma | Obrigatório |
|---|---|---|---|
| Cônjuge | `pessoa1Ref` / `pessoa2Ref` | `Uniao.pessoa1Id` / `pessoa2Id` | **sim** |
| Data do Casamento | `data_inicio` | `Uniao.data_inicio` | não |
| Local do Casamento | `local` | `Uniao.local` | não |
| — | `estado` | `Uniao.estado` | não |
| — | `pais` | `Uniao.pais` | não |
| (fixo) | — | `Uniao.tipo` | gravado como `"casamento"` |

`Uniao` ainda tem `cartorio`, `livro`, `folha`, `termo`, `numero_registro`,
`data_registro` e `observacoes` — dados de registro civil que **não aparecem**
num print de árvore montada. Ficaram fora do contrato de propósito.

## Reaproveitamento das rotas existentes

A gravação **não** chama `POST /api/pessoas` nem `POST /api/unioes` por HTTP.
Chamada servidor-para-servidor da própria API custa repassar autenticação,
perde a transação e transforma um erro no meio numa árvore pela metade. A rota
usa Prisma direto, dentro de **uma transação**, replicando as mesmas regras
daquelas rotas (normalização de vazio para `null`, `requerente: "nao"`,
`dispararMaterializacaoPorArvore` ao final).

### Pendência: a trava de deduplicação

`POST /api/pessoas` exige `decisaoDedupId` — uma `DecisaoDeduplicacao`
registrada no Cadastro Mestre antes de criar Pessoa. Hoje a ausência só gera
`console.warn`, mas o próprio código diz que vira **409** quando os chamadores
estiverem migrados.

A importação em lote **não passa por essa triagem**. Isso é uma decisão em
aberto, não um esquecimento:

- importar 20 pessoas exigiria 20 triagens manuais, o que anula o ganho;
- mas criar 20 pessoas sem triagem pode duplicar quem já existe em outra
  árvore, e não há serviço de fusão (MDM-4) para desfazer.

Antes de ligar a IA, decidir: a importação passa a exigir triagem, ganha uma
triagem em lote própria, ou é declarada exceção explícita à regra.
