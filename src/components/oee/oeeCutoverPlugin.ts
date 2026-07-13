import type { Chart, ChartType, Plugin, Scale } from 'chart.js';
import { OEE_CALC_CHANGE_DATE, isCutoverInRange } from '@/lib/oeeCutover';

/**
 * 계산식 변경일 마커의 차트별 옵션.
 *
 * ⚠️ dates 를 플러그인 팩토리의 클로저로 넘기면 안 된다.
 * react-chartjs-2 는 `plugins` prop 을 차트 "생성 시점"에만 반영하므로,
 * 첫 렌더(데이터 로딩 전, 빈 배열)의 값이 그대로 고정되어 이후 데이터가 도착해도
 * 마커가 그려지지 않는다. 그래서 옵션으로 받아 매 draw 마다 최신 값을 읽는다.
 */
export interface OeeCutoverMarkerOptions {
  /** 차트 데이터 포인트와 동일한 순서의 'YYYY-MM-DD' 배열 */
  dates: string[];
  label: string;
}

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    oeeCutoverMarker?: OeeCutoverMarkerOptions;
  }
}

/**
 * 카테고리(날짜) X축에서 계산식 변경일에 해당하는 픽셀 좌표를 구한다.
 * 정확히 일치하는 날짜가 없으면(주간/월간 집계 등) 앞뒤 지점 사이를 날짜 비율로 선형 보간한다.
 */
function findCutoverPixel(dates: string[], scale: Scale): number | null {
  const exactIndex = dates.indexOf(OEE_CALC_CHANGE_DATE);
  if (exactIndex !== -1) {
    return scale.getPixelForValue(exactIndex);
  }

  let beforeIndex = -1;
  let afterIndex = -1;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] < OEE_CALC_CHANGE_DATE) beforeIndex = i;
    if (dates[i] > OEE_CALC_CHANGE_DATE && afterIndex === -1) afterIndex = i;
  }
  if (beforeIndex === -1 || afterIndex === -1) return null;

  const beforeTime = new Date(dates[beforeIndex]).getTime();
  const afterTime = new Date(dates[afterIndex]).getTime();
  const cutoverTime = new Date(OEE_CALC_CHANGE_DATE).getTime();
  const ratio = (cutoverTime - beforeTime) / (afterTime - beforeTime);

  const beforePixel = scale.getPixelForValue(beforeIndex);
  const afterPixel = scale.getPixelForValue(afterIndex);
  return beforePixel + (afterPixel - beforePixel) * ratio;
}

/**
 * chartjs-plugin-annotation 없이 계산식 변경일 위치에 점선 세로선과 짧은 라벨을 그린다.
 * 표시 중인 날짜 범위가 변경일을 포함하지 않으면 아무것도 그리지 않는다.
 *
 * 사용법: options.plugins.oeeCutoverMarker = { dates, label } 로 옵션을 주고,
 *        <Line plugins={[oeeCutoverMarkerPlugin]} /> 로 등록한다.
 */
export const oeeCutoverMarkerPlugin: Plugin<'line'> = {
  id: 'oeeCutoverMarker',
  afterDraw(chart: Chart<'line'>) {
    // chart.options 는 DeepPartial 로 추론되므로 여기서 실제 값으로 정규화한다.
    const config = chart.options.plugins?.oeeCutoverMarker;
    const dates = (config?.dates ?? []).filter((d): d is string => typeof d === 'string');
    const label = typeof config?.label === 'string' ? config.label : '';
    if (dates.length === 0 || !isCutoverInRange(dates)) return;

    const xScale = chart.scales.x;
    if (!xScale) return;

    const rawX = findCutoverPixel(dates, xScale);
    if (rawX === null || Number.isNaN(rawX)) return;

    const { top, bottom, left, right } = chart.chartArea;
    const ctx = chart.ctx;

    // 변경일이 축의 양 끝이면 세로선이 그래프 테두리와 겹쳐 보이지 않으므로 안쪽으로 민다.
    const EDGE_INSET = 1.5;
    const x = Math.min(Math.max(rawX, left + EDGE_INSET), right - EDGE_INSET);

    // 라벨이 그래프 밖으로 잘리지 않도록 끝단에서는 정렬 방향을 바꾼다.
    const LABEL_EDGE_MARGIN = 40;
    const labelAlign: CanvasTextAlign =
      x > right - LABEL_EDGE_MARGIN ? 'right' : x < left + LABEL_EDGE_MARGIN ? 'left' : 'center';
    const labelX = labelAlign === 'right' ? x - 4 : labelAlign === 'left' ? x + 4 : x;

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(250, 140, 22, 0.9)';
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(250, 140, 22, 1)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = labelAlign;
    ctx.fillText(label, labelX, top + 12);
    ctx.restore();
  },
};
