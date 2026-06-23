# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [0.3.0] - 2026-06-23

### Added
- **Auto-fetch thông tin X khi nhập username** — điền follower / following / số bài + tên hiển thị tự động:
  - Module mới `src/main/x/FetchProfile.ts`: gọi API GraphQL công khai của X (guest token + `UserByScreenName`), hỗ trợ chạy qua proxy của tài khoản (CONNECT tunnel + TLS, native `http`/`https`, không thêm dependency `proxy-agent`).
  - DB migration: thêm cột `followers`, `following`, `statuses` (INTEGER, nullable) cho bảng `accounts`.
  - IPC `accounts:lookupX`, preload expose `window.aviary.accounts.lookup(handle, accountId?)`. Kết quả tự cache vào DB qua `updateAccountStats`.
  - UI AccountForm: debounce 600ms trên ô Username, hiện badge Followers/Following/Bài viết + Tên, tự điền Nhãn từ tên hiển thị X (chỉ khi không đang focus, tránh loop).
  - UI bảng Accounts: cột **Thống kê X** mới với badge màu riêng (xanh / xanh-lục / vàng).
- **Concurrency thật cho scheduler + bulk open** — chạy song song tối đa `settings.concurrency` job (mặc định 3):
  - DB migration: thêm cột `schedules.running` (INTEGER NOT NULL DEFAULT 0) — cờ bền vững, khôi phục sau crash bằng `resetAllRunning()` khi khởi động app.
  - Thay `_busy` boolean bằng semaphore (`activeRunCount` + `activeAccountIds` Set). `acquireSlot`/`releaseSlot` cho cả nút Đăng và scheduler. Mỗi tài khoản chỉ chạy 1 job cùng lúc.
  - `listDueSchedules` lọc `running = 0` tránh nhặt lại lịch đang chạy. Tick nhặt nhiều lịch tới giờ, lấp đầy slot còn trống, chạy fire-and-forget.
  - Thứ tự `finally` bắt buộc: `markRun` → `setScheduleRunning(false)` → `releaseSlot` → `emitQueueChanged` (tránh double-run).
  - Nút Đăng thủ công cũng đi qua semaphore — khi hết slot, báo progress `stage: 'queue'` "Đang chờ slot trống…" và chờ.
  - IPC `queue:changed` + preload `onQueueChanged` báo renderer hàng đợi thay đổi.
  - ScheduleView: cột "Lần kế" hiện badge "Đang chạy" (xanh) hoặc "Đang chờ hàng đợi" (vàng `st-queued`) thay vì countdown khi lịch trong hàng đợi.
- **Cột bảng kéo dãn được (resizable)** — kỹ thuật `<colgroup>` + `table-layout: fixed`:
  - Drag mutate trực tiếp `col.style.width` qua ref (KHÔNG re-render mỗi pixel) → mượt như native; mouseup mới commit về state 1 lần.
  - 5 cột kéo dãn: Name / Username / Thống kê X / Proxy / Trạng thái. Cột check (40px) và Actions (240px) cố định.
  - Handle dải mảnh ở mép phải header, hover mới nổi bật, khóa chọn text toàn app khi đang kéo.
- **Bulk-open profile song song**: dùng `Promise.allSettled` thay vì loop tuần tự — mở tất cả profile đã tick cùng lúc.
- **n8n: hỗ trợ payload Reddit gallery** — `normalizePayload` nhận `type: 'gallery'` + mảng `images[].highResImage` (lấy tối đa 4 ảnh theo giới hạn X), dùng `title` làm caption nếu chưa có.

### Fixed
- **Đóng profile sau pipeline (dù lỗi)** — cờ `openedByUs` trong `runPostForAccount` / `runDeleteForAccount`; nếu pipeline tự mở profile thì `finally` luôn đóng lại, giải phóng tài nguyên cho lần chạy kế (trước đó chỉ đóng khi thành công → browser treo vô hạn khi lỗi).
- **Lỗi nút Actions bị cắt mất sau khi bật kéo dãn cột** — `overflow: hidden` trên toàn bảng làm nhóm nút Actions bị clip. Khắc phục: cột Actions `width: 240px` cố định (chứa 6 nút icon 34px) + loại trừ `.col-actions` / `td.actions` khỏi `overflow: hidden` (`overflow: visible; white-space: nowrap`).

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
