# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [0.2.1] - 2026-06-23

### Added
- Redesign statusbar thành panel kiểu terminal với resize handle, auto‑scroll, cắt dòng (MAX_LINES 180), memo hoá các dòng, pill stage màu sắc cải tiến.
- Cải thiện hiệu năng bằng cách format thời gian một lần và dùng `memo` cho `TerminalRow`.
- UI mới: status dot, nút thu/mở, nút xoá log, nút nhảy xuống cuối.
- Lưu chiều cao vào `localStorage` để giữ giữa các phiên.

### Fixed
- Điều chỉnh CSS cho dark theme nhất quán.

## [0.2.0] - 2026-06-22

### Added
- **Proxy nâng cấp** — quản lý + kiểm tra proxy toàn diện:
  - DB migration: thêm cột `status` (unchecked/live/dead), `checked_at`, `latency_ms`, `country`, `city`, `check_ip` cho bảng `proxies`.
  - Kiểm tra proxy live/die: đo latency, tra vị trí (quốc gia, thành phố, IP xuất) qua ip-api.com.
  - UI: nút **Kiểm tra** (từng proxy / đã chọn / tất cả), cột **Trạng thái** (badge Live/Die/Chưa kiểm), cột **Vị trí** (city, country).
  - Multi-select: checkbox từng dòng + chọn tất cả, bulk xoá / bulk kiểm tra.
  - Nút **Xoá tất cả** proxy (danger).
  - IPC `proxies:clear`, `proxies:check`; preload expose `window.aviary.proxies.clear()`, `window.aviary.proxies.check(ids)`.
- **Icon app mới** — lông chim (feather) gradient xanh-tím:
  - Script `scripts/generate-icons.js` tạo `build/icon.png` (256x256) + `build/tray-16x16.png` từ code.
  - BrowserWindow dùng icon 256x256 từ file (fallback none nếu thiếu).
  - Tray icon resize từ icon.png (fallback tạo từ code nếu thiếu file).
  - `extraResources` đóng gói icon vào installer.
- **Phân trang nhật ký**:
  - `listLogs()` nhận `{ page, pageSize }`, trả `{ rows, total }` (LIMIT/OFFSET).
  - UI: nút Trang trước/Sau, hiển thị "Trang X/Y", tự reset về trang 1 khi có log mới.
  - Types `LogListParams`, `LogListResult` trong shared types.
- **System tray** — thu gọn xuống khay hệ thống khi nhấn X:
  - Module `src/main/tray.ts`: icon tray + context menu (Hiện cửa sổ / Thoát).
  - Nhấn X = ẩn cửa sổ (không thoát), click tray = hiện lại.
  - Flag `isQuitting` phân biệt "thu tray" vs "thoật thật" (từ tray, relaunch, update).
  - `window-all-closed` không quit — app chạy nền trên tray.
- **Auto-start cùng Windows**: IPC `autoStart:get` / `autoStart:set`, module `src/main/autostart.ts` (registry key).
- UI Cài đặt: nút khởi động cùng Windows (toggle).

### Fixed
- **Typecheck**: sửa `nativeImage` type → `Electron.NativeImage`, proxy check result `null` → `undefined` cho string fields.
- **AccountsView**: `a.handle` possibly null — thêm null-safe.
- **ffmpeg / updater**: sửa import path.

## [0.1.0] - 2026-06-20
