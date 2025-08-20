// 개발 환경용 Supabase 모의 클라이언트

interface MockResponse<T = any> {
  data: T | null;
  error: any;
}

interface MockChannel {
  on: (event: string, options: any, callback: (payload: any) => void) => MockChannel;
  subscribe: () => MockChannel;
  send: (payload: any) => Promise<void>;
}

class MockSupabaseClient {
  private mockData: Record<string, any[]> = {
    system_settings: [
      {
        id: '1',
        category: 'general',
        setting_key: 'company_name',
        setting_value: 'CNC Manufacturing Co.',
        value_type: 'string',
        description: '회사명',
        is_system: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: '2',
        category: 'display',
        setting_key: 'theme_mode',
        setting_value: 'light',
        value_type: 'string',
        description: '테마 모드',
        is_system: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: '3',
        category: 'display',
        setting_key: 'theme_primary_color',
        setting_value: '#1890ff',
        value_type: 'color',
        description: '주요 테마 색상',
        is_system: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ],
    machines: [],
    user_profiles: [],
    machine_logs: [],
    production_records: []
  };

  from(table: string) {
    return {
      select: (columns: string = '*') => ({
        eq: (column: string, value: any) => ({
          order: (orderBy: string) => this.mockQuery(table, { [column]: value }),
          single: () => this.mockQuery(table, { [column]: value }, true),
          ...this.mockQuery(table, { [column]: value })
        }),
        ...this.mockQuery(table)
      }),
      insert: (data: any) => this.mockInsert(table, data),
      update: (data: any) => ({
        eq: (column: string, value: any) => this.mockUpdate(table, data, { [column]: value })
      }),
      delete: () => ({
        eq: (column: string, value: any) => this.mockDelete(table, { [column]: value })
      })
    };
  }

  private mockQuery(table: string, filter?: Record<string, any>, single = false): MockResponse {
    try {
      let data = this.mockData[table] || [];
      
      if (filter) {
        data = data.filter(item => {
          return Object.entries(filter).every(([key, value]) => item[key] === value);
        });
      }

      return {
        data: single ? (data[0] || null) : data,
        error: null
      };
    } catch (error) {
      return {
        data: null,
        error: { message: 'Mock query error', code: 'MOCK_ERROR' }
      };
    }
  }

  private mockInsert(table: string, data: any): MockResponse {
    try {
      const newItem = {
        id: Date.now().toString(),
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (!this.mockData[table]) {
        this.mockData[table] = [];
      }
      
      this.mockData[table].push(newItem);

      return {
        data: newItem,
        error: null
      };
    } catch (error) {
      return {
        data: null,
        error: { message: 'Mock insert error', code: 'MOCK_ERROR' }
      };
    }
  }

  private mockUpdate(table: string, data: any, filter: Record<string, any>): MockResponse {
    try {
      const items = this.mockData[table] || [];
      const index = items.findIndex(item => {
        return Object.entries(filter).every(([key, value]) => item[key] === value);
      });

      if (index !== -1) {
        this.mockData[table][index] = {
          ...this.mockData[table][index],
          ...data,
          updated_at: new Date().toISOString()
        };
        
        return {
          data: this.mockData[table][index],
          error: null
        };
      }

      return {
        data: null,
        error: { message: 'Item not found', code: 'PGRST116' }
      };
    } catch (error) {
      return {
        data: null,
        error: { message: 'Mock update error', code: 'MOCK_ERROR' }
      };
    }
  }

  private mockDelete(table: string, filter: Record<string, any>): MockResponse {
    try {
      const items = this.mockData[table] || [];
      const index = items.findIndex(item => {
        return Object.entries(filter).every(([key, value]) => item[key] === value);
      });

      if (index !== -1) {
        const deletedItem = this.mockData[table].splice(index, 1)[0];
        return {
          data: deletedItem,
          error: null
        };
      }

      return {
        data: null,
        error: { message: 'Item not found', code: 'PGRST116' }
      };
    } catch (error) {
      return {
        data: null,
        error: { message: 'Mock delete error', code: 'MOCK_ERROR' }
      };
    }
  }

  rpc(functionName: string, params?: any): MockResponse {
    // RPC 함수 모의 구현
    switch (functionName) {
      case 'get_system_setting':
        const { p_category, p_key } = params || {};
        const setting = this.mockData.system_settings.find(
          s => s.category === p_category && s.setting_key === p_key
        );
        return {
          data: setting?.setting_value || null,
          error: null
        };
      
      case 'update_system_setting':
        // 설정 업데이트 모의
        return {
          data: true,
          error: null
        };
      
      default:
        return {
          data: null,
          error: { message: `Unknown RPC function: ${functionName}`, code: 'MOCK_ERROR' }
        };
    }
  }

  channel(name: string): MockChannel {
    return {
      on: (event: string, options: any, callback: (payload: any) => void) => {
        // 모의 이벤트 리스너
        return this.channel(name);
      },
      subscribe: () => {
        console.log(`Mock channel ${name} subscribed`);
        return this.channel(name);
      },
      send: async (payload: any) => {
        console.log(`Mock channel ${name} send:`, payload);
      }
    };
  }

  removeChannel(channel: MockChannel) {
    console.log('Mock channel removed');
  }

  // Auth 모의
  auth = {
    getUser: async () => ({
      data: {
        user: {
          id: 'mock-user-id',
          email: 'admin@example.com',
          role: 'authenticated'
        }
      },
      error: null
    }),
    signInWithPassword: async (credentials: any) => ({
      data: {
        user: {
          id: 'mock-user-id',
          email: credentials.email,
          role: 'authenticated'
        },
        session: {
          access_token: 'mock-token'
        }
      },
      error: null
    }),
    signOut: async () => ({
      error: null
    }),
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      // 모의 인증 상태 변경
      setTimeout(() => {
        callback('SIGNED_IN', {
          user: {
            id: 'mock-user-id',
            email: 'admin@example.com'
          }
        });
      }, 100);
      
      return {
        data: { subscription: { unsubscribe: () => {} } }
      };
    },
    uid: () => 'mock-user-id',
    role: () => 'authenticated'
  };

  // Functions 모의
  functions = {
    invoke: async (functionName: string, options?: any) => ({
      data: { message: `Mock function ${functionName} called` },
      error: null
    })
  };
}

export const mockSupabase = new MockSupabaseClient();