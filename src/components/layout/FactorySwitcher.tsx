'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined, CheckOutlined } from '@ant-design/icons';
import { authFetch } from '@/lib/authFetch';

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

  const switchTo = useCallback(async (code: string) => {
    if (code === ctx?.current.code) return;
    setSwitching(true);
    try {
      // 선택은 **서버가 저장한다.** 쿠키로 두면 RLS 가 읽지 못해 Route 데이터와 브라우저
      // 직접 조회가 서로 다른 공장을 가리킨다(@/lib/factoryAuth 의 설명).
      const res = await authFetch('/api/factory-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        // 저장에 실패했으면 **이동하지 않는다.** 이동해 버리면 화면은 새 공장을 가리키는데
        // 서버는 옛 공장을 쓰는, 정확히 없애려던 상태가 된다.
        setSwitching(false);
        return;
      }
    } catch {
      setSwitching(false);
      return;
    }
    // replace 로 이동해 뒤로가기가 이전 공장 화면으로 돌아가지 않게 한다.
    // 전체 페이지 이동이라 이전 공장의 channel·cache·snapshot 이 함께 사라진다(계약 5.1).
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
