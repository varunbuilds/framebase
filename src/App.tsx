import { RouterProvider } from '@tanstack/react-router'
import { AuthProvider } from '@/features/auth/auth-context'
import { router } from '@/router'

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
