-- CreateTable
CREATE TABLE "public"."Usuario" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "email" VARCHAR(30) NOT NULL,
    "senha" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(15) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pessoa" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "sobrenome" VARCHAR(40),
    "sexo" VARCHAR(10),
    "data_nasc" TIMESTAMP(3),
    "local_nasc" VARCHAR(30),
    "data_obito" TIMESTAMP(3),
    "batizado" VARCHAR(10),
    "comentario" TEXT,
    "x" INTEGER,
    "y" INTEGER,
    "arvoreId" INTEGER NOT NULL,
    "paiId" INTEGER,
    "maeId" INTEGER,

    CONSTRAINT "Pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Uniao" (
    "id" SERIAL NOT NULL,
    "data_inicio" TIMESTAMP(3),
    "data_fim" TIMESTAMP(3),
    "tipo" VARCHAR(10),
    "pessoa1Id" INTEGER NOT NULL,
    "pessoa2Id" INTEGER NOT NULL,

    CONSTRAINT "Uniao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Arvore" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(200),
    "commentPosX" DOUBLE PRECISION DEFAULT 0,
    "commentPosY" DOUBLE PRECISION DEFAULT 0,
    "pessoaPrincipalId" INTEGER,

    CONSTRAINT "Arvore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjetoKanban" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(40),
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,

    CONSTRAINT "ProjetoKanban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Atividade" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(20) NOT NULL,
    "descricao" VARCHAR(40),
    "data_termino" TIMESTAMP(3),
    "data_criacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projetoId" INTEGER NOT NULL,
    "statusId" INTEGER NOT NULL,

    CONSTRAINT "Atividade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserAtv" (
    "usuarioId" INTEGER NOT NULL,
    "atividadeId" INTEGER NOT NULL,

    CONSTRAINT "UserAtv_pkey" PRIMARY KEY ("usuarioId","atividadeId")
);

-- CreateTable
CREATE TABLE "public"."Status" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(20) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "projetoId" INTEGER,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Requerente" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "cpf" VARCHAR(11),
    "rg" VARCHAR(10),
    "endereco" VARCHAR(100),
    "telefone" VARCHAR(11),

    CONSTRAINT "Requerente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contratante" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "cpf" VARCHAR(11),
    "rg" VARCHAR(10),
    "endereco" VARCHAR(100),
    "telefone" VARCHAR(11),

    CONSTRAINT "Contratante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "public"."Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Arvore_pessoaPrincipalId_key" ON "public"."Arvore"("pessoaPrincipalId");

-- AddForeignKey
ALTER TABLE "public"."Pessoa" ADD CONSTRAINT "Pessoa_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "public"."Arvore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pessoa" ADD CONSTRAINT "Pessoa_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "public"."Pessoa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Pessoa" ADD CONSTRAINT "Pessoa_maeId_fkey" FOREIGN KEY ("maeId") REFERENCES "public"."Pessoa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Uniao" ADD CONSTRAINT "Uniao_pessoa1Id_fkey" FOREIGN KEY ("pessoa1Id") REFERENCES "public"."Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Uniao" ADD CONSTRAINT "Uniao_pessoa2Id_fkey" FOREIGN KEY ("pessoa2Id") REFERENCES "public"."Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Arvore" ADD CONSTRAINT "Arvore_pessoaPrincipalId_fkey" FOREIGN KEY ("pessoaPrincipalId") REFERENCES "public"."Pessoa"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProjetoKanban" ADD CONSTRAINT "ProjetoKanban_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "public"."Contratante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjetoKanban" ADD CONSTRAINT "ProjetoKanban_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "public"."Requerente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Atividade" ADD CONSTRAINT "Atividade_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "public"."ProjetoKanban"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Atividade" ADD CONSTRAINT "Atividade_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "public"."Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAtv" ADD CONSTRAINT "UserAtv_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAtv" ADD CONSTRAINT "UserAtv_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "public"."Atividade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Status" ADD CONSTRAINT "Status_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "public"."ProjetoKanban"("id") ON DELETE SET NULL ON UPDATE CASCADE;
