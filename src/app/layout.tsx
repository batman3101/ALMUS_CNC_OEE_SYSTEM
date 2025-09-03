import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from './providers';
import AppLayout from '@/components/layout/AppLayout';
import '@/lib/suppressWarnings'; // 경고 억제

const inter = Inter({
  subsets: ["latin"],
  display: 'swap',
});


export const metadata: Metadata = {
  title: "CNC OEE 모니터링 시스템",
  description: "CNC 설비 OEE 모니터링 및 관리 시스템",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* 로그인 페이지 prefetch - 로그아웃 시 빠른 로딩을 위해 */}
        <link rel="prefetch" href="/login" />
        <link rel="dns-prefetch" href="https://wmtkkefsorrdlzprhlpr.supabase.co" />
        
        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap" 
          rel="stylesheet" 
        />
        {/* 테마 깜박임 방지를 위한 초기화 스크립트 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // 로컬스토리지에서 테마 모드 가져오기
                  const savedMode = localStorage.getItem('theme-mode');
                  const mode = savedMode || 'light';
                  const isDark = mode === 'dark';
                  
                  // HTML 클래스 즉시 적용
                  document.documentElement.classList.add(mode);
                  document.documentElement.setAttribute('data-theme', mode);
                  
                  // CSS 변수 즉시 설정
                  const root = document.documentElement;
                  root.style.setProperty('--theme-bg-primary', isDark ? '#000000' : '#ffffff');
                  root.style.setProperty('--theme-bg-secondary', isDark ? '#141414' : '#f5f5f5');
                  root.style.setProperty('--theme-text-primary', isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)');
                  
                  // body 배경색 즉시 적용
                  document.addEventListener('DOMContentLoaded', function() {
                    document.body.classList.add(mode);
                    document.body.setAttribute('data-theme', mode);
                  });
                } catch (e) {
                  console.warn('Theme initialization failed:', e);
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.className} antialiased`}>
        <Providers>
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
      </body>
    </html>
  );
}
