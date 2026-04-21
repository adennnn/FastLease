import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FastLease — CRE Leasing on Autopilot',
  description: 'Automate commercial real estate leasing from scrape to signed tour.',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('fastlease-theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (theme === 'dark' || (theme !== 'light' && prefersDark)) {
                    document.documentElement.classList.add('dark');
                  }
                  if (!theme) localStorage.removeItem('fastlease-theme');
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-white dark:bg-zinc-950 text-black dark:text-zinc-50 antialiased">
        {children}
      </body>
    </html>
  )
}
