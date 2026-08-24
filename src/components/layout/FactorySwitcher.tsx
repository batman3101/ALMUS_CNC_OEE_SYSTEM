'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined, CheckOutlined } from '@ant-design/icons';
import { authFetch } from '@/lib/authFetch';
import { FACTORY_COOKIE } from '@/lib/factoryConstants';

interface FactoryOption {
  code: string;
  name: string;
  role: string;
}

interface FactoryContext {
  current: { code: string; role: string };
  canSwitch: boolean;
  available: FactoryOption[];
}

/**
 * 헤더의 공장 표시 · 전환기.
 *
 * ## 표시는 서버 판정을 그대로 쓴다
 *
 * 쿠키를 직접 읽어 표시하지 않는다. 서버가 그 쿠키를 거부했을 때(만료된 membership,
 * 비활성 공장) 화면만 다른 공장을 가리키게 되고, 사용자는 ALV 를 보고 있다고 믿으면서
 * ALT 데이터를 보게 된다. 표시와 데이터가 어긋나는 것이 가장 위험한 상태다.
 *
 * ## 갈 곳이 하나면 전환기를 감춘다
 *
 * 일반 사용자는 소속이 하나뿐이라 배지만 보인다. "공장 전환 토글은 두지 않는다"는 결정은
 * 이 사용자들에 대한 것이었고, 그 성질은 그대로 유지된다.
 *
 * ## 전환은 전체 페이지 이동으로 한다
 *
 * 쿠키를 바꾼 뒤 `location.replace` 로 다시 들어간다. SPA 상태를 손으로 정리하지 않는다 —
 * 계약 5.1 은 공장 전환 시 "이전 공장의 channel, cache, snapshot, pending request 와
 * optimistic state 를 먼저 제거"하라고 요구하는데, 전체 이동은 그것을 브라우저가 대신
 * 해 준다. 손으로 지우면 하나라도 빠뜨렸을 때 이전 공장 데이터가 새 화면에 남는다.
 */
export default function FactorySwitcher({ size = 'middle' }: { size?: 'small' | 'middle' }) {
  const [ctx, setCtx] = useState<FactoryContext | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/factory-context', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.success) {
          setCtx({ current: json.current, canSwitch: json.canSwitch, available: json.available ?? [] });
        }
      } catch {
        // 공장 표시는 부가 정보다. 실패해도 화면을 막지 않는다 — 다만 **아무것도 표시하지
        // 않는다.** 모를 때 짐작해서 표시하면 그것이 곧 잘못된 표시다.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const switchTo = useCallback((code: string) => {
    if (code === ctx?.current.code) return;
    setSwitching(true);
    // Secure 는 https 에서만 유효하다. 로컬(http)에서 붙이면 쿠키가 저장되지 않아
    // 전환이 조용히 실패한다. SameSite=Lax 면 같은 사이트 이동에는 늘 따라간다.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${FACTORY_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
    // replace 로 이동해 뒤로가기가 이전 공장 화면으로 돌아가지 않게 한다.
    window.location.replace('/dashboard');
  }, [ctx]);

  if (!ctx) return null;

  const label = (
    <Tag color="blue" style={{ margin: 0, fontWeight: 600, letterSpacing: '0.02em' }}>
      {ctx.current.code}
    </Tag>
  );

  // 갈 곳이 하나면 배지만. 전환기를 그릴 이유가 없다.
  if (!ctx.canSwitch) {
    return (
      <Tooltip title={ctx.available.find(f => f.code === ctx.current.code)?.name ?? ctx.current.code}>
        {label}
      </Tooltip>
    );
  }

  const items: MenuProps['items'] = ctx.available.map(f => ({
    key: f.code,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
        <span style={{ width: 14, display: 'inline-flex' }}>
          {f.code === ctx.current.code ? <CheckOutlined /> : null}
        </span>
        <strong>{f.code}</strong>
        <span style={{ opacity: 0.65 }}>{f.name}</span>
      </span>
    ),
    onClick: () => switchTo(f.code),
  }));

  return (
    <Dropdown menu={{ items }} placement="bottomRight" disabled={switching}>
      <Button type="text" size={size} loading={switching} style={{ paddingInline: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {label}
          <DownOutlined style={{ fontSize: 10, opacity: 0.6 }} />
        </span>
      </Button>
    </Dropdown>
  );
}
