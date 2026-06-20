# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

## [0.1.0] - 2026-06-20

### Added
- **Lên lịch đăng bài (tab Lịch đăng)** — tự động đăng theo lịch cho từng profile:
  - 2 mô hình: theo khoảng (mỗi N phút) hoặc giờ cố định (danh sách HH:MM mỗi ngày).
  - Jitter ± giây ngẫu nhiên mỗi lần chạy để giống thao tác người.
  - Bộ lập lịch (main process) tick 30s, chạy **tuần tự** (1 lần 1, xếp hàng khi trùng giờ) — tránh tải máy + giảm risk bị X flag.
  - UI: bảng Lịch đăng với toggle bật/tắt inline, cột "Lần cuối / Lần kế" (đếm ngược real-time), form thêm/sửa.
  - Mọi sự kiện (khởi động scheduler, kích hoạt, tạo/sửa/xóa/toggle lịch) đều ghi vào Nhật ký.
- **Quản lý Proxy (tab Proxy)** — kho proxy chung:
  - Thêm proxy theo **danh sách** (paste nhiều dòng cùng lúc, tự dedup + sinh nhãn `Proxy 1, 2…`).
  - Mỗi tài khoản gán proxy qua dropdown: **Local** (IP máy, mặc định) / **Random** (mỗi lần chạy lấy ngẫu nhiên) / proxy cụ thể.
  - Đổi proxy **trực tiếp ngoài bảng tài khoản** (inline select), không cần mở form Sửa.
- **Hashtag theo profile**: field hashtag trong cài đặt profile, tự chèn vào cuối caption khi đăng — **không** gửi vào webhook (markDone/fetch dùng caption gốc để n8n nhận diện đúng dòng sheet).
- **Nhật ký (tab Nhật ký)**: lưu DB kết quả/lỗi mỗi lần chạy, tự prune theo "số ngày giữ nhật ký" (xoá cả ảnh chụp lỗi), cột **Loại** (Đăng / Chạy lịch / Hệ thống) + badge **Bỏ qua** cho SKIP.
- **Thanh trạng thái**: full-width dưới đáy app, hiển thị tiến trình tác vụ real-time, có nút ẩn/hiện.
- **Cấu hình per-profile**: link Google Sheet (assetUrl) để n8n route đúng tài khoản; tùy chọn "Chạy ngầm" (headless).
- **markdone webhook**: app báo n8n đánh dấu video đã xử lý, kèm `event` (`publishpost`/`markdone`) + `reason` (`posted`/`broken`) + title + postUrl + assetUrl để n8n tìm đúng dòng sheet.
- **Trích pipeline đăng bài** (`scheduler/runner.ts`): hàm `runPostForAccount` dùng chung cho cả nút "Đăng" lẫn scheduler → logic duy nhất.

### Fixed
- **Nút Post bị overlay chặn** (`subtree intercepts pointer events` → timeout 30s, nặng khi proxy chậm): click thường trước, fallback `dispatchEvent('click')` bypass overlay; detection thành công chặt hơn (chỉ `ok` khi modal đóng / điều hướng `/status/`, không còn "thành công ảo").
- **Proxy `host:port:user:pass`**: `parseProxy` giờ hiểu dạng 4 phần (trước đó bỏ mất auth → proxy không có internet) cùng `user:pass@host:port`, `host:port`, kèm scheme `socks5://`.
- **Luồng link hỏng (SKIP) tối ưu webhook**: n8n trả SKIP (đã mark sheet) → app **gọi lại publish lấy bài kế**, KHÔNG gọi markdone thừa; markdone(broken) chỉ gọi khi tải video/ffmpeg lỗi (n8n không phát hiện). Giới hạn 10 SKIP liên tiếp để tránh loop.
- **Mở profile thủ công = headful luôn**: nút "Mở profile" hiện cửa sổ để đăng nhập bất kể cờ "Chạy ngầm"; cờ headless chỉ áp dụng khi đăng bài / lịch.
- **Chrome headless ẩn hoàn toàn**: bỏ hack PowerShell, dùng headless thuần (`--headless` thật) → không cửa sổ, không taskbar.
- **Nhãn nhật ký đúng nguồn**: eventType theo nguồn (manual='Đăng', schedule='Chạy lịch') áp dụng cho mọi dòng log kể cả SKIP/success; case tải lỗi sau SKIP cũng đúng loại.
- **Profile lock** ("Opening in existing browser session"): kill Chrome cũ đang giữ profile (`wmic`+`taskkill`) rồi retry.
- **Tự đóng profile** sau khi đăng thành công để giải phóng tài nguyên.
- **Audio Reddit**: ghép audio bằng cách đọc manifest DASH/HLS trực tiếp (720p + AAC stereo) thay vì `fallback_url` (chỉ video) / `DASH_AUDIO_*.mp4` (403).

### Notes
- Đổi schema: cột `accounts.headless/asset_url/hashtag/proxy_id`, bảng mới `proxies`/`schedules`/`logs.event_type` — migration tự động, an toàn với DB cũ.

### Added
- **Auto-update (electron-updater)**:
  - Module `src/main/updater.ts`: `initUpdater()` gắn listener (checking/available/downloading/downloaded/error), `checkForUpdates()` (báo `none` ở dev vì không có `app-update.yml`), `installUpdate()` đóng sạch profile chromium trước khi `quitAndInstall()`.
  - IPC `update:check` / `update:install`, broadcast `update:status` từ main → renderer.
  - Preload expose `window.aviary.update.check/install/onStatus`.
  - UI sidebar: nút "Kiểm tra cập nhật → Có bản mới/đang tải → Cài & khởi động lại", thanh progress khi tải, hiện lỗi nếu có.
  - `UpdateState` + `UpdateStatusPayload` trong `src/shared/types.ts`.
- **Giao diện làm lại bằng lucide-react icons**:
  - Sidebar, nav, theme toggle (system/light/dark, lưu localStorage), badge trạng thái có chấm màu, empty state.
  - AccountsView: nút thao tác chuyển thành icon-only có tooltip (Mở/Đóng/Đăng thử/Sửa/Xóa), modal kết quả đăng bài đẹp hơn (hiện URL + ảnh lỗi).
  - SettingsView: icon theo từng card, secret nhập dạng password, kết quả test webhook có icon OK/Lỗi.

### Fixed
- **XActions: lỗi `compose` timeout do neo nhầm `role="dialog"` ẩn**:
  - Bỏ filter `[role="dialog"]` (trang X có dialog wrapper ẩn cũng "chứa" textarea theo DOM → chộp nhầm phần tử hidden → timeout 15s).
  - Neo trực tiếp vào `tweetTextarea_0:visible`; nút media/Post tìm trong scope dialog/form visible chứa textarea đó.
  - Upload media ưu tiên `setInputFiles` thẳng vào `[data-testid="fileInput"]` (ổn định hơn filechooser), fallback `mediaUploadButton`.
  - Nút Post chấp nhận cả `tweetButton` và `tweetButtonInline` (lọc `:visible`), chờ visible rồi click.
- **ffmpeg khi đóng gói**: sửa path binary `app.asar` → `app.asar.unpacked` (đã khai báo `asarUnpack` cho `ffmpeg-static`).

### Added (đã có từ trước)
- **XActions: post flow trên x.com** (Giai đoạn 1 - MVP):
  - Module `src/main/actions/XActions.ts` với `postTweet()`: mở compose page, nhập caption, upload media, bấm Post.
  - Hỗ trợ media ảnh/video (video đã được tải về với audio nếu cần).
  - Trả về `PostResult { ok, url, error, step }` với URL bài post.
- **Pipeline đăng thử (run-now)**:
  - IPC `post:runNow`: gọi webhook → `downloadAssets` → `postTweet`.
  - Yêu cầu profile chromium phải được mở trước.
  - Preload expose `window.aviary.post.runNow(accountId)`.
- **UI Đăng thử**:
  - Nút "Đăng thử" trên hàng tài khoản.
  - Hiển thị kết quả trong alert: thành công (URL) hoặc lỗi (error + step).
- `BrowserManager.getContext(accountId)` để lấy BrowserContext đang mở cho XActions.
- `PostResult` type trong `src/shared/types.ts`.

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
  - UI **Cài đặt**: nhập Webhook URL/Secret, thư mục tải, concurrency. Nút **Test webhook` hiện kết quả.
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
