-- publicCode (TDOC) para o cadastro mestre TipoDocumentoCadastro. Aditivo/único/nullable.
-- TDOC-n é o código do TIPO; distinto do DOC-n do documento concreto.
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "TipoDocumentoCadastro_publicCode_key" ON "TipoDocumentoCadastro"("publicCode");
