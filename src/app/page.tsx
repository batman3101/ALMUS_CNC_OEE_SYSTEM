'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function Home() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {t('app.title')}
              </h1>
              <p className="text-sm text-gray-500">{t('app.subtitle')}</p>
            </div>
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Welcome Card */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>{t('auth.welcome')}</CardTitle>
              <CardDescription>
                CNC 설비 800대의 OEE 지표를 실시간으로 모니터링하고 관리할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button>
                  {t('nav.dashboard')}
                </Button>
                <Button variant="outline">
                  {t('nav.machines')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* OEE Overview Cards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('oee.overall')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">85.2%</div>
              <p className="text-sm text-gray-500 mt-2">
                {t('time.today')} 평균
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('oee.availability')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">92.1%</div>
              <p className="text-sm text-gray-500 mt-2">
                가동 시간 효율
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('oee.performance')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">88.7%</div>
              <p className="text-sm text-gray-500 mt-2">
                생산 속도 효율
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('oee.quality')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">95.3%</div>
              <p className="text-sm text-gray-500 mt-2">
                품질 수율
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('production.output')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-600">12,847</div>
              <p className="text-sm text-gray-500 mt-2">
                {t('time.today')} 총 생산량
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">활성 설비</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                742<span className="text-lg text-gray-500">/800</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                현재 가동 중
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            빠른 실행
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Button variant="outline" className="h-16 text-left">
              <div>
                <div className="font-medium">{t('nav.logInput')}</div>
                <div className="text-sm text-gray-500">설비 상태 입력</div>
              </div>
            </Button>
            <Button variant="outline" className="h-16 text-left">
              <div>
                <div className="font-medium">{t('production.input')}</div>
                <div className="text-sm text-gray-500">생산 실적 입력</div>
              </div>
            </Button>
            <Button variant="outline" className="h-16 text-left">
              <div>
                <div className="font-medium">{t('nav.reports')}</div>
                <div className="text-sm text-gray-500">분석 리포트</div>
              </div>
            </Button>
            <Button variant="outline" className="h-16 text-left">
              <div>
                <div className="font-medium">{t('alert.title')}</div>
                <div className="text-sm text-gray-500">실시간 알림</div>
              </div>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
