# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added
- Cài đặt + tích hợp n8n (Giai đoạn 1):
  - Bảng `settings` (key-value), API `getAllSettings`/`saveSettings`.
  - `N8nConnector`: gọi webhook (POST kèm `X-Aviary-Secret`), normalize response thành `PostPayload { caption, assets }`, hỗ trợ vài dạng phổ biến (`assets`/`media`/`urls`, item là string hoặc object), hàm `downloadAssets` tải file về `downloadsDir/<accountId>/<jobId>/`.
  - IPC `settings:get/save`, `webhook:test`. Preload mở rộng `window.aviary.settings` và `window.aviary.webhook`.
  - UI **Cài đặt**: nhập Webhook URL/Secret, thư mục tải, concurrency. Nút **Test webhook** hiện kết quả (status, caption, số asset) hoặc lỗi.
- Module quản lý tài khoản + profile chromium (Giai đoạn 1):
  - DB layer bằng `better-sqlite3` (rebuild theo ABI Electron qua `@electron/rebuild`), bảng `accounts` + CRUD.
  - `BrowserManager` dùng Patchright: mở/đóng persistent context theo profile riêng mỗi account, gắn proxy (parse `user:pass@host:port`), tự mở x.com để đăng nhập thủ công lần đầu, đóng sạch khi quit.
  - IPC accounts (list/create/update/delete) + browser (open/close/status), preload expose `window.aviary.accounts` và `window.aviary.browser`.
  - UI Tài khoản: bảng danh sách, form thêm/sửa (nhãn, handle, proxy), nút Mở/Đóng profile, badge trạng thái.
- Cài Patchright + chromium (anti-detect, drop-in replacement của Playwright).
- Scaffold Electron + React + Vite (TypeScript) chạy được: main process tạo BrowserWindow, preload expose IPC `getAppInfo` qua `contextBridge`, renderer dashboard có sidebar 5 mục (Tài khoản / Lịch đăng / Nội dung / Nhật ký / Cài đặt).
- `electron.vite.config.ts` (externalize native deps), `tsconfig.json` (+ `tsconfig.node.json` cho main/preload, `tsconfig.web.json` cho renderer).
- Style cơ bản theme tối, alias `@shared/*`.
- Khởi tạo dự án: cấu trúc thư mục, tài liệu roadmap và kiến trúc.
- `docs/ROADMAP.md`: lộ trình 6 giai đoạn (MVP đăng bài → vận hành nhiều account → chăm sóc/nuôi account → nội dung → phân tích → bền vững).
- `docs/ARCHITECTURE.md`: kiến trúc kỹ thuật (Electron + React + Playwright/Patchright + SQLite), luồng đăng bài, mô hình tiến trình.

### Notes
- Electron 33 dùng Node 20 (chưa có `node:sqlite` built-in) nên chọn `better-sqlite3` + `@electron/rebuild`.

## [0.0.1] - 2026-06-17

### Added
- Tạo repository và khung dự án Aviary.
