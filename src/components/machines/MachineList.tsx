'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Row, 
  Col, 
  Input, 
  Select, 
  Space, 
  Typography, 
  Empty,
  Spin,
  Card
} from 'antd';
import { 
  SearchOutlined, 
  FilterOutlined,
  EnvironmentOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { Machine, MachineState } from '@/types';
import MachineCard from './MachineCard';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/lib/supabase';

const { Title } = Typography;
const { Option } = Select;

interface MachineListProps {
  machines: Machine[];
  loading?: boolean;
  onMachineClick?: (machine: Machine) => void;
}

interface FilterOptions {
  searchText: string;
  statusFilter: MachineState | 'all';
  locationFilter: string | 'all';
  modelFilter: string | 'all';
  activeFilter: 'all' | 'active' | 'inactive';
}

const MachineList: React.FC<MachineListProps> = ({
  machines,
  loading = false,
  onMachineClick
}) => {
  const { t, language } = useMachinesTranslation();
  const [filters, setFilters] = useState<FilterOptions>({
    searchText: '',
    statusFilter: 'all',
    locationFilter: 'all',
    modelFilter: 'all',
    activeFilter: 'all'
  });
  const [statusDescriptions, setStatusDescriptions] = useState<any[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);

  // 데이터베이스에서 상태 설명 가져오기
  useEffect(() => {
    const fetchStatusDescriptions = async () => {
      try {
        setStatusLoading(true);
        const { data, error } = await supabase
          .from('machine_status_descriptions')
          .select('*')
          .order('display_order');

        if (error) {
          console.error('Error fetching status descriptions:', error);
          return;
        }

        setStatusDescriptions(data || []);
      } catch (error) {
        console.error('Error in fetchStatusDescriptions:', error);
      } finally {
        setStatusLoading(false);
      }
    };

    fetchStatusDescriptions();
  }, []);

  // 필터링된 설비 목록
  const filteredMachines = useMemo(() => {
    return machines.filter(machine => {
      // 검색어 필터
      if (filters.searchText) {
        const searchLower = filters.searchText.toLowerCase();
        const matchesSearch = 
          machine.name.toLowerCase().includes(searchLower) ||
          machine.location.toLowerCase().includes(searchLower) ||
          machine.model_type.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

      // 상태 필터
      if (filters.statusFilter !== 'all') {
        if (machine.current_state !== filters.statusFilter) return false;
      }

      // 위치 필터
      if (filters.locationFilter !== 'all') {
        if (machine.location !== filters.locationFilter) return false;
      }

      // 모델 필터
      if (filters.modelFilter !== 'all') {
        if (machine.model_type !== filters.modelFilter) return false;
      }

      // 활성 상태 필터
      if (filters.activeFilter !== 'all') {
        const isActive = machine.is_active;
        if (filters.activeFilter === 'active' && !isActive) return false;
        if (filters.activeFilter === 'inactive' && isActive) return false;
      }

      return true;
    });
  }, [machines, filters]);

  // 고유한 위치 목록 추출
  const uniqueLocations = useMemo(() => {
    const locations = machines.map(m => m.location);
    return [...new Set(locations)].sort();
  }, [machines]);

  // 고유한 모델 목록 추출
  const uniqueModels = useMemo(() => {
    const models = machines.map(m => m.model_type);
    return [...new Set(models)].sort();
  }, [machines]);

  // 데이터베이스 기반 상태별 옵션
  const statusOptions = useMemo(() => {
    const options = [{ value: 'all', label: t('filterOptions.all') }];
    
    statusDescriptions.forEach(status => {
      let label = '';
      if (language === 'ko') {
        label = status.description_ko;
      } else if (language === 'vi') {
        label = status.description_vi || status.description_ko;
      } else {
        label = status.description_en || status.description_ko;
      }
      
      options.push({
        value: status.status,
        label: label
      });
    });
    
    return options;
  }, [statusDescriptions, language, t]);

  const handleFilterChange = (key: keyof FilterOptions, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const clearFilters = () => {
    setFilters({
      searchText: '',
      statusFilter: 'all',
      locationFilter: 'all',
      modelFilter: 'all',
      activeFilter: 'all'
    });
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="machine-list">
      {/* 헤더 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3}>
          {t('listTitle')}
          <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: 8 }}>
            ({filteredMachines.length}/{machines.length})
          </span>
        </Title>
      </div>

      {/* 필터 영역 */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 검색 */}
          <Input
            placeholder={t('filters.search')}
            prefix={<SearchOutlined />}
            value={filters.searchText}
            onChange={(e) => handleFilterChange('searchText', e.target.value)}
            allowClear
            size="large"
          />

          {/* 필터 옵션들 */}
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#666' }}>
                  {t('filters.statusLabel')}
                </div>
                <Select
                  placeholder={t('filters.statusPlaceholder')}
                  value={filters.statusFilter}
                  onChange={(value) => handleFilterChange('statusFilter', value)}
                  style={{ width: '100%' }}
                  suffixIcon={<FilterOutlined />}
                >
                  {statusOptions.map(option => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Select>
              </div>
            </Col>

            <Col xs={24} sm={12} md={6}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#666' }}>
                  {t('filters.locationLabel')}
                </div>
                <Select
                  placeholder={t('filters.locationPlaceholder')}
                  value={filters.locationFilter}
                  onChange={(value) => handleFilterChange('locationFilter', value)}
                  style={{ width: '100%' }}
                  suffixIcon={<EnvironmentOutlined />}
                >
                  <Option value="all">
                    {t('filterOptions.allLocations')}
                  </Option>
                  {uniqueLocations.map(location => (
                    <Option key={location} value={location}>
                      {location}
                    </Option>
                  ))}
                </Select>
              </div>
            </Col>

            <Col xs={24} sm={12} md={6}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#666' }}>
                  {t('filters.modelLabel')}
                </div>
                <Select
                  placeholder={t('filters.modelPlaceholder')}
                  value={filters.modelFilter}
                  onChange={(value) => handleFilterChange('modelFilter', value)}
                  style={{ width: '100%' }}
                  suffixIcon={<SettingOutlined />}
                >
                  <Option value="all">
                    {t('filterOptions.allModels')}
                  </Option>
                  {uniqueModels.map(model => (
                    <Option key={model} value={model}>
                      {model}
                    </Option>
                  ))}
                </Select>
              </div>
            </Col>

            <Col xs={24} sm={12} md={6}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#666' }}>
                  {t('filters.activeLabel')}
                </div>
                <Select
                  placeholder={t('filters.activePlaceholder')}
                  value={filters.activeFilter}
                  onChange={(value) => handleFilterChange('activeFilter', value)}
                  style={{ width: '100%' }}
                >
                  <Option value="all">
                    {t('filterOptions.all')}
                  </Option>
                  <Option value="active">
                    {t('filterOptions.active')}
                  </Option>
                  <Option value="inactive">
                    {t('filterOptions.inactive')}
                  </Option>
                </Select>
              </div>
            </Col>
          </Row>

          {/* 필터 초기화 버튼 */}
          {(filters.searchText || 
            filters.statusFilter !== 'all' || 
            filters.locationFilter !== 'all' || 
            filters.modelFilter !== 'all' || 
            filters.activeFilter !== 'all') && (
            <div>
              <a onClick={clearFilters}>
                {t('filters.clearFilters')}
              </a>
            </div>
          )}
        </Space>
      </Card>

      {/* 설비 카드 그리드 */}
      {filteredMachines.length === 0 ? (
        <Empty
          description={t('emptyMessage')}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredMachines.map(machine => (
            <Col key={machine.id} xs={24} sm={12} md={8} lg={6}>
              <MachineCard
                machine={machine}
                onClick={onMachineClick}
                language={language}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default MachineList;