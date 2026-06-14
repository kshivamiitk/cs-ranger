import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * PDF builders shared by achievement-service (completion certificates) and
 * payout-service (creator annual statements). Pure pdf-lib + standard fonts —
 * no network, no native deps — so generation works identically in local dev
 * and production. Note: standard fonts are WinAnsi-encoded, so amounts are
 * rendered as "Rs" rather than the ₹ glyph.
 */

const VIOLET = rgb(124 / 255, 58 / 255, 237 / 255);
const CYAN = rgb(6 / 255, 182 / 255, 212 / 255);
const INK = rgb(0.09, 0.1, 0.15);
const DIM = rgb(0.42, 0.45, 0.52);

function hexToRgb(hex: string | undefined, fallback = VIOLET) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function drawCentered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = INK) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font, color });
}

// ─── Certificate ──────────────────────────────────────────────────

export interface CertificatePdfOptions {
  siteName: string;
  learnerName: string;
  courseTitle: string;
  creatorName: string;
  completedAt: string;          // ISO date
  certificateId: string;
  verifyUrl: string;
  heading?: string;
  body?: string;
  accentColor?: string;
  footerNote?: string;
}

export async function buildCertificatePdf(o: CertificatePdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${o.siteName} Certificate — ${o.courseTitle}`);
  const page = doc.addPage([842, 595]); // A4 landscape
  const [regular, bold, italic] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const accent = hexToRgb(o.accentColor);

  // Frame
  page.drawRectangle({ x: 24, y: 24, width: 842 - 48, height: 595 - 48, borderColor: accent, borderWidth: 2 });
  page.drawRectangle({ x: 32, y: 32, width: 842 - 64, height: 595 - 64, borderColor: CYAN, borderWidth: 0.8 });

  drawCentered(page, o.siteName.toUpperCase(), 520, bold, 22, accent);
  drawCentered(page, o.heading || "CERTIFICATE OF COMPLETION", 478, bold, 30, INK);
  drawCentered(page, "This is to certify that", 430, regular, 14, DIM);

  const nameSize = o.learnerName.length > 28 ? 28 : 36;
  drawCentered(page, o.learnerName, 386, bold, nameSize, INK);
  page.drawLine({ start: { x: 240, y: 374 }, end: { x: 602, y: 374 }, thickness: 1, color: CYAN });

  drawCentered(page, o.body || "has successfully completed the course", 340, regular, 14, DIM);
  const titleSize = o.courseTitle.length > 50 ? 16 : 22;
  drawCentered(page, o.courseTitle, 306, bold, titleSize, accent);
  drawCentered(page, `created by ${o.creatorName}`, 278, italic, 13, DIM);

  const completedDate = new Date(o.completedAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  drawCentered(page, `Completed on ${completedDate}`, 232, regular, 13, INK);

  drawCentered(page, `Certificate ID: ${o.certificateId}`, 120, regular, 10, DIM);
  drawCentered(page, `Verify at ${o.verifyUrl}`, 104, regular, 10, DIM);
  drawCentered(page, o.footerNote || `${o.siteName} — learn. build. ship.`, 64, italic, 10, DIM);

  return doc.save();
}

// ─── Creator annual statement ─────────────────────────────────────

export interface StatementMonthRow {
  month: string;                // "Apr 2025"
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  tdsPaise: number;
  netPaise: number;
}

export interface AnnualStatementPdfOptions {
  siteName: string;
  creatorName: string;
  creatorEmail?: string;
  financialYear: string;        // "2025-26"
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  tdsPaise: number;
  netPaise: number;
  payoutsPaise: number;
  pendingPaise: number;
  months: StatementMonthRow[];
  generatedAt: string;          // ISO
  isEstimate?: boolean;
}

export async function buildAnnualStatementPdf(o: AnnualStatementPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${o.siteName} Annual Statement FY ${o.financialYear}`);
  const page = doc.addPage([595, 842]); // A4 portrait
  const [regular, bold] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ]);

  let y = 790;
  page.drawText(o.siteName, { x: 48, y, size: 20, font: bold, color: VIOLET });
  y -= 24;
  page.drawText(`Creator Annual Statement — FY ${o.financialYear}`, { x: 48, y, size: 14, font: bold, color: INK });
  y -= 18;
  page.drawText(`${o.creatorName}${o.creatorEmail ? `  ·  ${o.creatorEmail}` : ""}`, { x: 48, y, size: 10, font: regular, color: DIM });
  y -= 30;

  const summary: [string, string][] = [
    ["Gross revenue", formatRupees(o.grossPaise)],
    ["Platform commission", formatRupees(o.commissionPaise)],
    ["Refunds", formatRupees(o.refundsPaise)],
    ["TDS deducted", formatRupees(o.tdsPaise)],
    ["Net earnings", formatRupees(o.netPaise)],
    ["Payouts made", formatRupees(o.payoutsPaise)],
    ["Pending balance", formatRupees(o.pendingPaise)],
  ];
  page.drawText("Summary", { x: 48, y, size: 12, font: bold, color: INK });
  y -= 16;
  for (const [label, value] of summary) {
    page.drawText(label, { x: 56, y, size: 10, font: regular, color: DIM });
    const w = bold.widthOfTextAtSize(value, 10);
    page.drawText(value, { x: 547 - w, y, size: 10, font: bold, color: INK });
    page.drawLine({ start: { x: 48, y: y - 4 }, end: { x: 547, y: y - 4 }, thickness: 0.4, color: rgb(0.88, 0.89, 0.92) });
    y -= 18;
  }

  y -= 16;
  page.drawText("Monthly breakdown", { x: 48, y, size: 12, font: bold, color: INK });
  y -= 16;
  const cols = [48, 168, 268, 368, 458];
  const headers = ["Month", "Gross", "Commission", "Refunds + TDS", "Net"];
  headers.forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 9, font: bold, color: DIM }));
  y -= 14;
  for (const m of o.months) {
    if (y < 80) break; // single-page statement; 12 rows always fit
    const cells = [m.month, formatRupees(m.grossPaise), formatRupees(m.commissionPaise), formatRupees(m.refundsPaise + m.tdsPaise), formatRupees(m.netPaise)];
    cells.forEach((c, i) => page.drawText(c, { x: cols[i], y, size: 9, font: regular, color: INK }));
    page.drawLine({ start: { x: 48, y: y - 3 }, end: { x: 547, y: y - 3 }, thickness: 0.3, color: rgb(0.9, 0.91, 0.94) });
    y -= 14;
  }

  const generated = new Date(o.generatedAt).toLocaleString("en-IN");
  page.drawText(`Generated ${generated}.${o.isEstimate ? " Figures are computed from the live ledger and may be estimates until the financial year closes." : ""}`, {
    x: 48, y: 48, size: 8, font: regular, color: DIM, maxWidth: 500, lineHeight: 10,
  });

  return doc.save();
}
