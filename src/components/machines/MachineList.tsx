'use client';

import React, { useState, useMemo } from 'react';
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

const { Title } = Typography;
const { Option } = Select;

interface MachineListProps {
  machines: Machine[];
  loading?: boolean;
  onMachineClick?: (machine: Machine) => void;
  language?: 'ko' | 'vi';
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
  onMachineClick,
  language = 'ko'
}) => {
  const [filters, setFilters] = useState<FilterOptions>({
    searchText: '',
    statusFilter: 'all',
    locationFilter: 'all',
    modelFilter: 'all',
    activeFilter: 'all'
  });

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

  // 상태별 옵션
  const statusOptions = [
    { value: 'all', label: language === 'ko' ? '전체' : 'Tất cả' },
    { value: 'NORMAL_OPERATION', label: language === 'ko' ? '정상가동' : 'Hoạt động bình thường' },
    { value: 'MAINTENANCE', label: language === 'ko' ? '점검중' : 'Bảo trì' },
    { value: 'MODEL_CHANGE', label: language === 'ko' ? '모델교체' : 'Thay đổi mô hình' },
    { value: 'PLANNED_STOP', label: language === 'ko' ? '계획정지' : 'Dừng theo kế hoạch' },
    { value: 'PROGRAM_CHANGE', label: language === 'ko' ? '프로그램 교체' : 'Thay đổi chương trình' },
    { value: 'TOOL_CHANGE', label: language === 'ko' ? '공구교환' : 'Thay đổi công cụ' },
    { value: 'TEMPORARY_STOP', label: language === 'ko' ? '일시정지' : 'Dừng tạm thời' }
  ];

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
          {language === 'ko' ? '설비 목록' : 'Danh sách thiết bị'}
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
            placeholder={language === 'ko' ? '설비명, 위치, 모델로 검색...' : 'Tìm kiếm theo tên, vị trí, mô hình...'}
            prefix={<SearchOutlined />}
            value={filters.searchText}
            onChange={(e) => handleFilterChange('searchText', e.target.value)}
            allowClear
            size="large"
          />

          {/* 필터 옵션들 */}
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={language === 'ko' ? '상태 선택' : 'Chọn trạng thái'}
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
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={language === 'ko' ? '위치 선택' : 'Chọn vị trí'}
                value={filters.locationFilter}
                onChange={(value) => handleFilterChange('locationFilter', value)}
                style={{ width: '100%' }}
                suffixIcon={<EnvironmentOutlined />}
              >
                <Option value="all">
                  {language === 'ko' ? '전체 위치' : 'Tất cả vị trí'}
                </Option>
                {uniqueLocations.map(location => (
                  <Option key={location} value={location}>
                    {location}
                  </Option>
                ))}
              </Select>
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={language === 'ko' ? '모델 선택' : 'Chọn mô hình'}
                value={filters.modelFilter}
                onChange={(value) => handleFilterChange('modelFilter', value)}
                style={{ width: '100%' }}
                suffixIcon={<SettingOutlined />}
              >
                <Option value="all">
                  {language === 'ko' ? '전체 모델' : 'Tất cả mô hình'}
                </Option>
                {uniqueModels.map(model => (
                  <Option key={model} value={model}>
                    {model}
                  </Option>
                ))}
              </Select>
            </Col>

            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={language === 'ko' ? '활성 상태' : 'Trạng thái hoạt động'}
                value={filters.activeFilter}
                onChange={(value) => handleFilterChange('activeFilter', value)}
                style={{ width: '100%' }}
              >
                <Option value="all">
                  {language === 'ko' ? '전체' : 'Tất cả'}
                </Option>
                <Option value="active">
                  {language === 'ko' ? '활성' : 'Hoạt động'}
                </Option>
                <Option value="inactive">
                  {language === 'ko' ? '비활성' : 'Không hoạt động'}
                </Option>
              </Select>
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
                {language === 'ko' ? '필터 초기화' : 'Xóa bộ lọc'}
              </a>
            </div>
          )}
        </Space>
      </Card>

      {/* 설비 카드 그리드 */}
      {filteredMachines.length === 0 ? (
        <Empty
          description={
            language === 'ko' 
              ? '조건에 맞는 설비가 없습니다' 
              : 'Không có thiết bị nào phù hợp với điều kiện'
          }
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