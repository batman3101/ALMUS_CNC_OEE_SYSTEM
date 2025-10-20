#!/bin/bash

# CNC OEE 모니터링 시스템 - Supabase Edge Functions 배포 스크립트
# 이 스크립트는 OEE 집계를 위한 Edge Function을 Supabase에 배포합니다.

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로그 함수
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 스크립트 시작
log_info "Starting Supabase Edge Functions deployment..."

# 현재 디렉토리 확인
if [ ! -f "package.json" ]; then
    log_error "package.json not found. Please run this script from the project root directory."
    exit 1
fi

# Supabase CLI 설치 확인
if ! command -v supabase &> /dev/null; then
    log_error "Supabase CLI is not installed. Please install it first:"
    echo "npm install -g supabase"
    echo "or"
    echo "brew install supabase/tap/supabase"
    exit 1
fi

# 환경 변수 확인
if [ -z "$SUPABASE_PROJECT_REF" ]; then
    log_warning "SUPABASE_PROJECT_REF environment variable is not set."
    read -p "Enter your Supabase project reference: " SUPABASE_PROJECT_REF
    export SUPABASE_PROJECT_REF
fi

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    log_warning "SUPABASE_ACCESS_TOKEN environment variable is not set."
    echo "Please set your Supabase access token:"
    echo "export SUPABASE_ACCESS_TOKEN=your_access_token"
    echo "You can get your access token from: https://app.supabase.com/account/tokens"
    exit 1
fi

# Supabase 로그인 확인
log_info "Checking Supabase authentication..."
if ! supabase projects list &> /dev/null; then
    log_info "Logging in to Supabase..."
    supabase login
fi

# 프로젝트 링크 확인
log_info "Linking to Supabase project..."
if [ ! -f ".supabase/config.toml" ]; then
    supabase link --project-ref "$SUPABASE_PROJECT_REF"
else
    log_info "Project already linked."
fi

# Edge Functions 디렉토리 확인
if [ ! -d "supabase/functions" ]; then
    log_error "supabase/functions directory not found."
    exit 1
fi

# daily-oee-aggregation 함수 배포
log_info "Deploying daily-oee-aggregation function..."
if [ -d "supabase/functions/daily-oee-aggregation" ]; then
    supabase functions deploy daily-oee-aggregation --project-ref "$SUPABASE_PROJECT_REF"
    log_success "daily-oee-aggregation function deployed successfully!"
else
    log_error "daily-oee-aggregation function directory not found."
    exit 1
fi

# 함수 권한 설정
log_info "Setting up function permissions..."
supabase sql --project-ref "$SUPABASE_PROJECT_REF" --file supabase/migrations/20241211000000_setup_daily_oee_cron.sql || {
    log_warning "Failed to execute migration. You may need to run it manually in the Supabase dashboard."
}

# 환경 변수 설정 안내
log_info "Setting up environment variables..."
echo ""
echo "Please ensure the following environment variables are set in your Supabase project:"
echo "1. Go to https://app.supabase.com/project/$SUPABASE_PROJECT_REF/settings/functions"
echo "2. Add the following environment variables:"
echo "   - SUPABASE_URL: https://$SUPABASE_PROJECT_REF.supabase.co"
echo "   - SUPABASE_SERVICE_ROLE_KEY: (your service role key)"
echo ""

# 함수 테스트
log_info "Testing the deployed function..."
FUNCTION_URL="https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/daily-oee-aggregation"

# 서비스 역할 키 확인
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    log_warning "SUPABASE_SERVICE_ROLE_KEY not set. Skipping function test."
else
    log_info "Testing function with yesterday's date..."
    YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null || echo "2024-12-10")
    
    curl -X POST "$FUNCTION_URL" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"date\": \"$YESTERDAY\"}" \
        --max-time 30 \
        --silent \
        --show-error || {
        log_warning "Function test failed or timed out. This might be normal if there's no data to aggregate."
    }
fi

# Cron 작업 설정 안내
log_info "Setting up cron jobs..."
echo ""
echo "To set up automatic daily aggregation, you need to:"
echo "1. Go to https://app.supabase.com/project/$SUPABASE_PROJECT_REF/database/extensions"
echo "2. Enable the 'pg_cron' extension if not already enabled"
echo "3. Go to the SQL Editor and run the cron setup commands from the migration file"
echo "4. Update the function URL in the cron commands to use your project reference"
echo ""

# 배포 완료
log_success "Edge Functions deployment completed!"
echo ""
echo "Summary:"
echo "✅ daily-oee-aggregation function deployed"
echo "✅ Database migration executed (or needs manual execution)"
echo "⚠️  Environment variables need to be configured"
echo "⚠️  Cron jobs need to be set up manually"
echo ""
echo "Function URL: $FUNCTION_URL"
echo "Project Dashboard: https://app.supabase.com/project/$SUPABASE_PROJECT_REF"
echo ""

# 다음 단계 안내
log_info "Next steps:"
echo "1. Configure environment variables in Supabase dashboard"
echo "2. Set up cron jobs for automatic aggregation"
echo "3. Test the function manually from your application"
echo "4. Monitor the aggregation logs in your database"
echo ""

log_success "Deployment script completed successfully!"