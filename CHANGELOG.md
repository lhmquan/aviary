# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added
- N8nConnector hỗ trợ payload Reddit của workflow user:
  - `type=video` (Reddit DASH split): nhận `videoUrl` + `audioUrls/audioUrl1/audioUrl2`, tải video + audio rồi **ghép bằng ffmpeg** (`-c:v copy -c:a aac -shortest`) ra 1 mp4 duy nhất.
  - `type=single_image` / `image`: nhận `imageUrl/originalUrl/url`.
  - Caption ưu tiên `caption/text/content/title` (tương thích Reddit `title`).
  - Vẫn giữ tương thích payload Aviary native (`assets/media/urls`).
- ffmpeg: ưu tiên dùng `ffmpeg-static` (binary đi kèm), fallback `ffmpeg` trên PATH.
- Test webhook hiện thêm "Phát hiện video tách audio - sẽ ghép bằng ffmpeg khi tải".
- Picker thư mục lưu asset (`dialog.showOpenDialog`), khi để trống thì mặc định lưu trong `userData/downloads`.
- Nút **Update / Reload** ở sidebar: đóng tất cả profile chromium → `app.relaunch()` → exit, để nạp code mới mà không phải `npm run dev` lại.
- Cài đặt + tích hợp n8n (Giai đoạn 1):
  - Bảng `settings` (key-value), API `getAllSettings`/`saveSettings`.
  - `N8nConnector`: gọi webhook (POST kèm `X-Aviary-Secret`), normalize response thành `PostPayload { caption, assets }`.
  - IPC `settings:get/save`, `webhook:test`. Preload mở rộng `window.aviary.settings` và `window.aviary.webhook`.
  - UI **Cài đặt**: nhập Webhook URL/Secret, thư mục tải, concurrency. Nút **Test webhook** hiện kết quả.
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
