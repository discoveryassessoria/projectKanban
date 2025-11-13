"use client";

import Image from "next/image"
import AuthComponent from "@/src/components/auth"
import backgroundImage from "@/public/imagemfundo.jpg"
import discoveryLogo from "@/public/discoverylogo.svg"
import { motion } from "framer-motion"

export default function AuthPage() {
  return (
    <div className="relative min-h-screen w-screen overflow-hidden flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-6">
      {/* Fundo ocupa toda a tela */}
      <Image
        src={backgroundImage}
        alt="Fundo"
        fill
        priority
        className="object-cover"
      />

      {/* Camada de conteúdo */}
      <div className="absolute inset-0 flex items-center justify-between px-8 md:px-20 lg:px-32">
        {/* Logo grande à esquerda */}
        <motion.div 
        className="flex-1 flex items-center justify-center" 
        initial={{ x: -80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Image
            src={discoveryLogo}
            alt="Logo Discovery"
            width={560} // aumentei mais a logo
            height={200}
            className="drop-shadow-2xl"
            priority
          />
        </motion.div>

        {/* Caixa de login, mais centralizada */}
        <motion.div 
        className="flex-1 flex items-center justify-center"
        initial={{ x: 80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        > 
          <div className="w-full max-w-md">
            <AuthComponent />
          </div>
        </motion.div>
      </div>
    </div>
  )
}
