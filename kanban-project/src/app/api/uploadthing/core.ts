import { createUploadthing, type FileRouter } from "uploadthing/next"

const f = createUploadthing()

export const ourFileRouter = {
  // Upload de anexos para contratantes/requerentes
  anexoUploader: f({
    image: { maxFileSize: "64MB", maxFileCount: 10 },
    pdf: { maxFileSize: "64MB", maxFileCount: 10 },
    "application/msword": { maxFileSize: "64MB", maxFileCount: 10 },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxFileSize: "64MB", maxFileCount: 10 },
    "application/vnd.ms-excel": { maxFileSize: "64MB", maxFileCount: 10 },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { maxFileSize: "64MB", maxFileCount: 10 },
  })
    .onUploadComplete(async ({ file }) => {
      console.log("Upload completo:", file.url)
      return { url: file.url }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter