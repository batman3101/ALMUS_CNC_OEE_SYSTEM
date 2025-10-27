export interface ProductModel {
  id: string;
  model_name: string;
  description?: string;
  cavity_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModelProcess {
  id: string;
  model_id: string;
  process_name: string;
  process_order: number;
  tact_time_seconds: number;
  cavity_count: number;
  created_at: string;
  updated_at: string;
  product_models?: {
    model_name: string;
  };
}

export interface ModelProcessWithModel extends ModelProcess {
  model_name: string;
}