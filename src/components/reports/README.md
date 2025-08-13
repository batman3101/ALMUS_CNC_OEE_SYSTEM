# Reports Module

This module provides comprehensive PDF and Excel report generation functionality for the CNC OEE Monitoring System.

## Components

### ReportGenerator
Main component that provides quick export buttons and custom report generation options.

**Features:**
- Quick PDF/Excel export with default settings
- Custom report generation with user-defined parameters
- Integration with existing OEE data

**Usage:**
```tsx
import { ReportGenerator } from '@/components/reports';

<ReportGenerator
  machines={machines}
  oeeData={oeeData}
  productionData={productionData}
/>
```

### ReportExportModal
Modal component for configuring custom report parameters.

**Features:**
- Report type selection (summary, detailed, trend, downtime)
- Date range selection
- Machine filtering
- Content selection (OEE, production, charts, etc.)
- Grouping options

### ReportTemplates
Static class containing PDF and Excel generation logic.

**Methods:**
- `generatePDFReport(data)` - Creates PDF reports using jsPDF
- `generateExcelReport(data)` - Creates Excel reports using xlsx
- `generateTemplateReport(type, data, format)` - Template-based report generation

### ReportDashboard
Comprehensive dashboard for report management and generation.

**Features:**
- Statistics overview
- Quick report generation (daily, weekly, monthly)
- Machine filtering
- Date range selection

## Dependencies

### Required Libraries
- `jspdf` - PDF generation
- `xlsx` - Excel file generation
- `@types/jspdf` - TypeScript types for jsPDF

### Installation
```bash
npm install jspdf xlsx
npm install --save-dev @types/jspdf
```

## Report Types

### PDF Reports
- **Format**: PDF document with multiple sections
- **Content**: 
  - Report header with metadata
  - Machine list
  - OEE metrics summary
  - Production summary
  - Chart placeholders (for future chart integration)
- **Features**: Multi-page support, formatted text, tables

### Excel Reports
- **Format**: Multi-sheet Excel workbook
- **Sheets**:
  - Summary: Overview and key metrics
  - Machines: Machine list and details
  - OEE Data: Detailed OEE metrics
  - Production Data: Production records
- **Features**: Formatted data, multiple worksheets, formulas

## Chart Integration

The system supports chart integration in PDF reports through the `ReportUtils` class:

```typescript
// Capture chart as image
const chartImage = await ReportUtils.chartToImage(chartRef);

// Include in PDF
doc.addImage(chartImage, 'PNG', x, y, width, height);
```

## Usage Examples

### Basic Report Generation
```tsx
// Quick PDF export
await ReportTemplates.generatePDFReport({
  machines,
  oeeData,
  productionData,
  reportType: 'summary',
  dateRange: ['2024-01-01', '2024-01-31'],
  selectedMachines: ['machine_1', 'machine_2'],
  includeCharts: true,
  includeOEE: true,
  includeProduction: true,
  includeDowntime: true,
  groupBy: 'machine'
});
```

### Custom Report with Modal
```tsx
<ReportExportModal
  visible={true}
  exportType="pdf"
  machines={machines}
  oeeData={oeeData}
  productionData={productionData}
  onCancel={() => setVisible(false)}
/>
```

### Dashboard Integration
```tsx
<ReportDashboard machines={machines} />
```

## File Structure

```
src/components/reports/
├── index.ts                 # Export declarations
├── ReportGenerator.tsx      # Main report component
├── ReportExportModal.tsx    # Configuration modal
├── ReportTemplates.tsx      # PDF/Excel generation logic
├── ReportDashboard.tsx      # Comprehensive dashboard
├── __tests__/
│   └── ReportGenerator.test.tsx
└── README.md               # This file
```

## Utility Functions

### ReportUtils
Located in `src/utils/reportUtils.ts`, provides helper functions:

- `chartToImage()` - Convert Chart.js charts to images
- `elementToImage()` - Convert HTML elements to images
- `arrayToCSV()` - Convert data arrays to CSV format
- `downloadFile()` - File download helper
- `formatNumber()` - Number formatting
- `formatPercent()` - Percentage formatting
- `getOEEColor()` - OEE status color coding

## Future Enhancements

1. **Chart Integration**: Full integration with Chart.js for including charts in PDF reports
2. **Email Reports**: Automatic report generation and email delivery
3. **Scheduled Reports**: Cron-based automatic report generation
4. **Report Templates**: Pre-defined report templates for different use cases
5. **Data Visualization**: Enhanced charts and graphs in reports
6. **Multi-language Support**: Report generation in multiple languages

## Testing

Run tests with:
```bash
npm test -- --testPathPattern=reports
```

## Troubleshooting

### Common Issues

1. **PDF Generation Fails**: Ensure jsPDF is properly installed and imported
2. **Excel Export Issues**: Check xlsx library version compatibility
3. **Chart Images Not Showing**: Verify chart references and canvas availability
4. **Large File Sizes**: Consider data pagination for large datasets

### Performance Considerations

- Large datasets may cause memory issues during report generation
- Consider implementing data pagination for reports with >1000 records
- PDF generation is CPU-intensive; consider web workers for large reports
- Excel files with multiple sheets may take longer to generate

## API Reference

### ReportData Interface
```typescript
interface ReportData {
  machines: Machine[];
  oeeData: OEEMetrics[];
  productionData: ProductionRecord[];
  reportType: 'summary' | 'detailed' | 'trend' | 'downtime';
  dateRange: [string, string];
  selectedMachines: string[];
  includeCharts: boolean;
  includeOEE: boolean;
  includeProduction: boolean;
  includeDowntime: boolean;
  groupBy: 'machine' | 'date' | 'shift';
}
```

### Component Props
See individual component files for detailed prop interfaces and documentation.