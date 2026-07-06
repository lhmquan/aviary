import { browserManager } from '../browser/BrowserManager'

// Cơ chế DỪNG ĐỘT NGỘT 1 phiên đang chạy (mọi action: đăng/xoá/bình luận/tương tác).
// Hai lớp phối hợp:
//   1) Đóng profile NGAY -> mọi thao tác Playwright đang chờ (goto/click/waitFor) throw
//      "Target closed" -> pipeline nhảy vào catch/finally -> kết thúc sớm.
//   2) Cờ Set<accountId>: các vòng lặp dài (phiên tương tác, xoá nhiều bài, bình luận nhiều
//      bài, poll chờ đăng) tự kiểm tra giữa các bước để thoát SẠCH thay vì chờ throw.
// clearStop() gọi ở đầu mỗi pipeline để cờ của lần chạy trước không dính sang lần mới.

const stopRequested = new Set<string>()

// Đánh dấu account cần dừng + đóng profile để cắt thao tác Playwright đang chạy.
export async function requestStop(accountId: string): Promise<void> {
  stopRequested.add(accountId)
  // Đóng profile khiến context.close() -> thao tác đang chờ throw ngay (không đợi timeout).
  await browserManager.closeProfile(accountId).catch(() => {})
}

// Vòng lặp dài đọc cờ này để thoát sớm khi user bấm Dừng.
export function isStopRequested(accountId: string): boolean {
  return stopRequested.has(accountId)
}

// Xoá cờ — gọi ở ĐẦU mỗi pipeline (trước khi chạy) để không dính cờ cũ.
export function clearStop(accountId: string): void {
  stopRequested.delete(accountId)
}
