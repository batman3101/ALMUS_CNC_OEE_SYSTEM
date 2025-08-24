import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '모델 정보 관리 - CNC OEE 모니터링 시스템',
  description: '생산 모델과 공정 정보를 관리합니다',
};

export default function ModelInfoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}