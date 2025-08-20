import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/oee-data - OEE 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const aggregation = searchParams.get('aggregation') || 'daily'; // daily, weekly, monthly

    // 실제 구현에서는 oee_data 테이블에서 데이터를 가져와야 함
    // 현재는 목업 데이터 생성
    const generateMockOEEData = (days: number) => {
      return Array.from({ length: days }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - index);
        
        const availability = 0.75 + Math.random() * 0.2; // 75-95%
        const performance = 0.80 + Math.random() * 0.15; // 80-95%
        const quality = 0.90 + Math.random() * 0.08; // 90-98%
        const oee = availability * performance * quality;

        return {
          id: `oee_${Date.now()}_${index}`,
          machine_id: machineId || `machine_${index % 3 + 1}`,
          date: date.toISOString().split('T')[0],
          shift: ['A', 'B'][index % 2] as 'A' | 'B',
          availability: Math.round(availability * 1000) / 1000,
          performance: Math.round(performance * 1000) / 1000,
          quality: Math.round(quality * 1000) / 1000,
          oee: Math.round(oee * 1000) / 1000,
          actual_runtime: Math.round(availability * 500),
          planned_runtime: 500,
          ideal_runtime: Math.round(performance * 500),
          output_qty: 100 + Math.floor(Math.random() * 50),
          defect_qty: Math.floor(Math.random() * 5),
          created_at: date.toISOString(),
          updated_at: date.toISOString()
        };
      });
    };

    let days = 7; // 기본 7일
    if (aggregation === 'weekly') days = 7;
    else if (aggregation === 'monthly') days = 30;
    else if (aggregation === 'yearly') days = 365;

    let oeeData = generateMockOEEData(days);

    // 필터 적용
    if (machineId) {
      oeeData = oeeData.filter(data => data.machine_id === machineId);
    }

    if (startDate && endDate) {
      oeeData = oeeData.filter(data => 
        data.date >= startDate && data.date <= endDate
      );
    }

    if (shift) {
      oeeData = oeeData.filter(data => data.shift === shift);
    }

    // 집계 처리
    let aggregatedData = oeeData;
    
    if (aggregation === 'weekly') {
      // 주별 집계 로직 (간단화)
      aggregatedData = oeeData.slice(0, 7);
    } else if (aggregation === 'monthly') {
      // 월별 집계 로직 (간단화)  
      aggregatedData = oeeData.slice(0, 30);
    }

    // 통계 계산
    const totalRecords = aggregatedData.length;
    const avgOEE = totalRecords > 0 
      ? aggregatedData.reduce((sum, data) => sum + data.oee, 0) / totalRecords 
      : 0;
    const avgAvailability = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.availability, 0) / totalRecords
      : 0;
    const avgPerformance = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.performance, 0) / totalRecords
      : 0;
    const avgQuality = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.quality, 0) / totalRecords
      : 0;

    return NextResponse.json({
      oee_data: aggregatedData,
      statistics: {
        total_records: totalRecords,
        avg_oee: Math.round(avgOEE * 1000) / 1000,
        avg_availability: Math.round(avgAvailability * 1000) / 1000,
        avg_performance: Math.round(avgPerformance * 1000) / 1000,
        avg_quality: Math.round(avgQuality * 1000) / 1000,
      },
      filters: {
        machine_id: machineId,
        start_date: startDate,
        end_date: endDate,
        shift,
        aggregation
      }
    });
  } catch (error) {
    console.error('Error fetching OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch OEE data' },
      { status: 500 }
    );
  }
}