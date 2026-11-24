// Bilingual notification texts (en + vi). Stored in the notifications table and shown by the service worker.
import { formatVND } from '../shared/format';

export interface NotificationText {
  title_en: string;
  body_en: string;
  title_vi: string;
  body_vi: string;
  url: string;
}

export function dailyLogMessage(n: number, total: number): NotificationText {
  const empty = n === 0;
  return {
    title_en: "Log today's spending",
    body_en: empty ? 'Nothing logged yet today.' : `Today: ${n} entries, ${formatVND(total, 'en')}`,
    title_vi: 'Ghi chi tiêu hôm nay',
    body_vi: empty ? 'Hôm nay chưa ghi khoản chi nào.' : `Hôm nay: ${n} khoản, ${formatVND(total, 'vi')}`,
    url: '/',
  };
}

export function monthEndMessage(): NotificationText {
  return {
    title_en: 'Month-end review',
    body_en: 'Update stock prices and balances.',
    title_vi: 'Tổng kết cuối tháng',
    body_vi: 'Cập nhật giá cổ phiếu và số dư.',
    url: '/assets',
  };
}

export function maturityMessage(name: string, amount: number): NotificationText {
  return {
    title_en: 'Deposit matures tomorrow',
    body_en: `${name} matures tomorrow (${formatVND(amount, 'en')})`,
    title_vi: 'Tiền gửi đáo hạn ngày mai',
    body_vi: `${name} đáo hạn ngày mai (${formatVND(amount, 'vi')})`,
    url: '/assets',
  };
}

/** One notice for several deposits that mature on the same date. `matures` is YYYY-MM-DD. */
export function groupedMaturityMessage(count: number, total: number, matures: string): NotificationText {
  const day = `${matures.slice(8, 10)}/${matures.slice(5, 7)}`;
  return {
    title_en: 'Deposits mature tomorrow',
    body_en: `${count} savings deposits mature on ${day} · ${formatVND(total, 'en')}`,
    title_vi: 'Tiền gửi đáo hạn ngày mai',
    body_vi: `${count} khoản tiết kiệm đáo hạn ngày ${day} · ${formatVND(total, 'vi')}`,
    url: '/assets',
  };
}

export function testMessage(): NotificationText {
  return {
    title_en: 'My Finance',
    body_en: 'Test notification',
    title_vi: 'Tài chính của tôi',
    body_vi: 'Thông báo thử',
    url: '/settings',
  };
}
