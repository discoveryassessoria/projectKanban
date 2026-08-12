# 12 — Materializador documental único (REGRA PERMANENTE, 06/08/2026)

**Status:** regra arquitetural. Violação reprova o build e o CI.

---

## A regra

> Nenhum código do Discovery cria, atualiza ou faz upsert de
> `NecessidadeDocumental` fora do serviço canônico
> `src/services/necessidade-documental.ts`.
>
> Quem decide **que obrigação deve existir** é um só:
> `materializarExecucaoDaFase()` → `materializarGenealogia()` → Regras
> Documentais **PUBLICADAS**.

```
Evento → Workflow Macro → Execução da Fase
  → materializarExecucaoDaFase
    → materializarGenealogia          (avalia as Regras PUBLICADAS)
      → garantirNecessidade           (único ponto de escrita)
        → instanciarWorkflowDaFase    (alvo vira passo)
          → Central Operacional
```

---

## O que aconteceu, e por que a regra existe

O Discovery teve **dois** materializadores rodando na mesma passagem:

| Motor | Regras | `varianteKey` |
|---|---|---|
| `materializarGenealogia` | Matriz PUBLICADA, condições avaliadas | `rd:<regra>:v<n>` |
| `garantirNecessidadesArvoreDoProcesso` | `DOCUMENT_RULES` hardcoded, sem condição | `"padrao"` |

O segundo não era uma rota: rodava **escondido dentro do primeiro**, em
`carregarContextoEscopo`. E `materializarExecucaoDaFase` nunca chamava
`materializarGenealogia` — o motor oficial só era acionado por
`POST /genealogia/sincronizar`.

A chave de idempotência inclui `varianteKey`. Para o banco eram duas obrigações
distintas, e a mesma pessoa recebia a certidão de nascimento duas vezes.

**Nada quebrou por meses.** O sistema respondia, os testes passavam, só a
contagem estava errada. É por isso que a regra precisa de um guard automático e
não de disciplina: o sintoma não interrompe ninguém.

O comentário do código legado chegava a declarar a premissa errada — *"as duas
origens convivem na mesma NecessidadeDocumental"*. Não conviviam: multiplicavam.

---

## O que foi eliminado (não desativado)

- `garantirNecessidadesArvoreDoProcesso`
- `garantirNecessidadesDaMatriz`
- `src/lib/document-generator.ts` — arquivo removido
- `POST /pessoas/[id]/reconcile` — rota removida
- `POST /necessidades {gerar_arvore|gerar_matriz}` — respondem **410**

---

## Exceções, e o critério que as separa

**Materializador** percorre regras × pessoas e decide sozinho o que deve
existir. É dele que nasce duplicidade quando há mais de um. **Ato
administrativo** cria UMA necessidade a partir de decisão humana já auditada.

Só existe um materializador. Dois atos administrativos permanecem:

| Ponto | Por quê |
|---|---|
| `POST /necessidades {criar_manual}` | necessidade avulsa pedida na tela |
| `CRIAR_NECESSIDADE` (Motor Registral) | operação de proposta **aprovada**, dentro da transação que versiona, audita e reverte |

Ambos passam pelo serviço canônico — não escrevem direto.

---

## Como a regra é imposta

**`npm run test:guard-necessidade`** varre o repositório inteiro (`src`, `lib`,
`scripts`, `prisma`) e reprova quando encontra:

1. escrita direta em runtime fora do dono único — reporta `arquivo:linha`;
2. escrita em script/backfill fora da **allowlist nominal** do próprio guard;
3. `INSERT`/`UPDATE`/`DELETE` cru em `"NecessidadeDocumental"` (desvio do ORM);
4. qualquer símbolo de motor legado ressuscitado em runtime;
5. a cadeia oficial desligada (`materializarExecucaoDaFase` sem
   `materializarGenealogia`, ou a chamada fora de ordem).

A allowlist é **código**: crescer exige commit e revisão. Entrada morta também
reprova, para a lista não virar depósito.

**Onde roda:**

- `npm run build` → `test:guards-arquitetura` — **bloqueia todo deploy** (Vercel
  roda o build em cada deploy; é o portão real do projeto);
- `.github/workflows/guards-arquitetura.yml` — todo push e toda PR.

Os guards são estáticos: não precisam de banco e terminam em segundos.

---

## Prova executada

`npm run test:motor-unico:e2e` monta um processo com requerente, pai, mãe, avô e
avó e materializa **20 vezes**:

```
rodada  1: 11 necessidades   (5 nascimento + 4 casamento + 2 óbito)
rodada 20: 11 necessidades
variações: 0 · nenhuma varianteKey "padrao" · 11 pares (pessoa,item) únicos
```

Com dois motores, a contagem subia já na segunda rodada.

---

## Evolução

Mudança futura **pode**: acrescentar regra documental, mudar a avaliação de
condições, mudar o que a fase aceita por natureza.

Mudança futura **não pode**: criar um segundo caminho de materialização;
escrever `NecessidadeDocumental` fora do serviço canônico; relaxar o guard para
"destravar" o build; adicionar arquivo à allowlist sem que ele seja backfill
auditado ou teste.

Se o guard reprovar, a resposta quase certa **não** é entrar na allowlist — é
chamar o serviço canônico.
