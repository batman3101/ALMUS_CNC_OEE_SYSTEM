import { OEEAggregationService, summarizeAggregationResults } from '../oeeAggregation';

// Mock Supabase
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn()
    },
    auth: {
      getUser: jest.fn()
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
          order: jest.fn(() => ({
            limit: jest.fn()
          }))
        })),
        order: jest.fn(() => ({
          limit: jest.fn()
        })),
        limit: jest.fn()
      }))
    })),
    rpc: jest.fn()
  }
}));

describe('OEEAggregationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('triggerDailyAggregation', () => {
    it('should trigger aggregation for specified date', async () => {
      const mockResult = {
        success: true,
        date: '2024-12-10',
        processed_records: 10,
        results: []
      };

      const { supabase } = require('@/lib/supabase');
      supabase.functions.invoke.mockResolvedValue({
        data: mockResult,
        error: null
      });

      const result = await OEEAggregationService.triggerDailyAggregation('2024-12-10');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('daily-oee-aggregation', {
        body: { date: '2024-12-10' }
      });
      expect(result).toEqual(mockResult);
    });

    it('should use current date when no date specified', async () => {
      const mockResult = {
        success: true,
        date: new Date().toISOString().split('T')[0],
        processed_records: 5,
        results: []
      };

      const { supabase } = require('@/lib/supabase');
      supabase.functions.invoke.mockResolvedValue({
        data: mockResult,
        error: null
      });

      const result = await OEEAggregationService.triggerDailyAggregation();

      expect(result.date).toBe(new Date().toISOString().split('T')[0]);
    });

    it('should handle errors gracefully', async () => {
      const { supabase } = require('@/lib/supabase');
      supabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Function error' }
      });

      const result = await OEEAggregationService.triggerDailyAggregation('2024-12-10');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Function error');
    });
  });

  describe('canTriggerAggregation', () => {
    it('should return true for admin users', async () => {
      const { supabase } = require('@/lib/supabase');
      
      supabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      });

      const mockFrom = {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({
              data: { role: 'admin', is_active: true },
              error: null
            })
          }))
        }))
      };

      supabase.from.mockReturnValue(mockFrom);

      const canTrigger = await OEEAggregationService.canTriggerAggregation();

      expect(canTrigger).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('user_profiles');
    });

    it('should return false for non-admin users', async () => {
      const { supabase } = require('@/lib/supabase');
      
      supabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      });

      const mockFrom = {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({
              data: { role: 'operator', is_active: true },
              error: null
            })
          }))
        }))
      };

      supabase.from.mockReturnValue(mockFrom);

      const canTrigger = await OEEAggregationService.canTriggerAggregation();

      expect(canTrigger).toBe(false);
    });

    it('should return false when user is not authenticated', async () => {
      const { supabase } = require('@/lib/supabase');
      
      supabase.auth.getUser.mockResolvedValue({
        data: { user: null }
      });

      const canTrigger = await OEEAggregationService.canTriggerAggregation();

      expect(canTrigger).toBe(false);
    });
  });

  describe('batchAggregation', () => {
    it('should process multiple dates sequentially', async () => {
      const dates = ['2024-12-08', '2024-12-09', '2024-12-10'];
      const mockResults = dates.map(date => ({
        success: true,
        date,
        processed_records: 5,
        results: []
      }));

      const { supabase } = require('@/lib/supabase');
      supabase.functions.invoke
        .mockResolvedValueOnce({ data: mockResults[0], error: null })
        .mockResolvedValueOnce({ data: mockResults[1], error: null })
        .mockResolvedValueOnce({ data: mockResults[2], error: null });

      const results = await OEEAggregationService.batchAggregation(dates);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(3);
    });

    it('should handle individual failures in batch', async () => {
      const dates = ['2024-12-08', '2024-12-09'];
      
      const { supabase } = require('@/lib/supabase');
      supabase.functions.invoke
        .mockResolvedValueOnce({ 
          data: { success: true, date: '2024-12-08', processed_records: 5 }, 
          error: null 
        })
        .mockResolvedValueOnce({ 
          data: null, 
          error: { message: 'Server error' } 
        });

      const results = await OEEAggregationService.batchAggregation(dates);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain('Server error');
    });
  });
});

describe('summarizeAggregationResults', () => {
  it('should correctly summarize aggregation results', () => {
    const results = [
      { success: true, date: '2024-12-08', processed_records: 10 },
      { success: true, date: '2024-12-09', processed_records: 8 },
      { success: false, date: '2024-12-10', processed_records: 0, error: 'Failed' }
    ];

    const summary = summarizeAggregationResults(results);

    expect(summary.totalDates).toBe(3);
    expect(summary.successfulDates).toBe(2);
    expect(summary.failedDates).toBe(1);
    expect(summary.totalRecordsProcessed).toBe(18);
    expect(summary.successRate).toBeCloseTo(66.67, 1);
  });

  it('should handle empty results array', () => {
    const summary = summarizeAggregationResults([]);

    expect(summary.totalDates).toBe(0);
    expect(summary.successfulDates).toBe(0);
    expect(summary.failedDates).toBe(0);
    expect(summary.totalRecordsProcessed).toBe(0);
    expect(summary.successRate).toBe(0);
  });
});