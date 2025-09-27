import AuthComponent from "@/src/components/auth"

export default function AuthPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-6">
      <div className="absolute inset-0 bg-grid-pattern opacity-5 dark:opacity-10"></div>
      <div className="relative z-10 w-full flex justify-center">
        <AuthComponent />
      </div>
    </div>
  )
}
