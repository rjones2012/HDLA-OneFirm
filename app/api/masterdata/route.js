import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { downloadFile } from '../../../lib/graph';
import { requireCaller } from '../../../lib/apiAuth';

// Force dynamic - no caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(/[$,%]/g, '')) || 0;
  return 0;
}

function parsePercent(val) {
  if (typeof val === 'number') return val > 1 ? val : val * 100; // Handle both 0.5 and 50 formats
  if (typeof val === 'string') return parseFloat(val.replace(/[$,%]/g, '')) || 0;
  return 0;
}

export async function GET(req) {
  const { error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const buffer = Buffer.from(await downloadFile('HDLA Master Data.xlsx'));
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets['Master Data'];
    
    if (!sheet) {
      return NextResponse.json({ error: 'Master Data sheet not found', data: [] }, { status: 404 });
    }
    
    // Use sheet_to_json with header row to get named columns
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    
    // Map to the format frontend expects - include all fields needed for projections
    const data = rows.map(row => {
      const projectNum = row['Project #'] || row['Project#'] || row['Project Number'] || '';
      const projectName = row['Project Name'] || row['Project Name '] || '';
      const client = row['Client'] || row['Client '] || '';
      const location = row['Location'] || row['Office'] || '';
      const phase = row['Phase'] || '';
      const pm = row['PM'] || '';
      const partner = row['Partner'] || '';
      const status = row['Status'] || '';
      const fee = parseNumber(row['Fee']);
      const previouslyBilled = parseNumber(row['Previously Billed']);
      const previouslyBilledPct = parsePercent(row['Previously Billed %']);
      const feeRemaining = parseNumber(row['Fee Remaining']);
      
      return {
        'Project #': String(projectNum).trim(),
        'Project Name': String(projectName).trim(),
        'Client': String(client).trim(),
        'Location': String(location).trim(),
        'Phase': String(phase).trim(),
        'PM': String(pm).trim(),
        'Partner': String(partner).trim(),
        'Status': String(status).trim(),
        'Fee': fee,
        'Previously Billed': previouslyBilled,
        'Previously Billed %': previouslyBilledPct,
        'Fee Remaining': feeRemaining
      };
    }).filter(row => row['Project #']); // Only rows with project numbers
    
    // Load Summary tab for historical billing/expenses data
    let summary = [];
    try {
      const summarySheet = workbook.Sheets['Summary'];
      if (summarySheet) {
        // Use raw:true to get actual date serial numbers we can parse reliably
        const summaryRows = XLSX.utils.sheet_to_json(summarySheet, { defval: '', raw: true });
        summary = summaryRows
          .filter(r => r['Month'] || r['month'])
          .map(r => {
            let monthRaw = r['Month'] || r['month'] || '';
            let monthLabel = '';
            
            // Excel stores dates as serial numbers (e.g., 46082 = March 1, 2026)
            // When raw:true, we get the serial number directly
            if (typeof monthRaw === 'number' && monthRaw > 10000) {
              // Convert Excel serial to JS date
              // Excel epoch is Jan 1, 1900. Serial 1 = Jan 1, 1900.
              // But Excel has a bug treating 1900 as leap year, so subtract 1 for dates after Feb 28, 1900
              const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
              const dt = new Date(excelEpoch.getTime() + monthRaw * 86400000);
              monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            } else if (monthRaw instanceof Date || (typeof monthRaw === 'string' && monthRaw.match(/^\d{4}-\d{2}/))) {
              const dt = new Date(monthRaw);
              if (!isNaN(dt.getTime())) {
                monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
              }
            } else {
              monthLabel = String(monthRaw).trim();
            }
            
            return {
              month: monthLabel,
              billing: parseNumber(r['Billing'] || r['billing'] || 0),
              expenses: parseNumber(r['Expenses'] || r['expenses'] || 0),
              pipeline: parseNumber(r['Pipeline'] || r['pipeline'] || 0),
              underContract: parseNumber(r['Under Contract'] || r['underContract'] || r['Under contract'] || 0),
              underContract12: parseNumber(r['Under Contract 12 Months'] || r['Under Contract 12 months'] || 0),
              balance: parseNumber(r['Balance'] || r['balance'] || 0),
              deposits: parseNumber(r['Deposits'] || r['deposits'] || 0),
            };
          })
          .filter(r => r.month && r.month !== '')
          // Sort chronologically (data may be in reverse order)
          .sort((a, b) => new Date(a.month + ' 1') - new Date(b.month + ' 1'));
      }
    } catch(e) {
      console.error('Summary tab error:', e.message);
    }

    console.log('Loaded', data.length, 'project rows,', summary.length, 'summary months');
    
    return NextResponse.json({ data, summary }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Error loading master data:', error);
    return NextResponse.json({ error: error.message, data: [] }, { status: 500 });
  }
}
