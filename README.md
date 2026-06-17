# Aviary

Ứng dụng desktop quản lý nhiều tài khoản X (Twitter). Mỗi tài khoản chạy trên một profile chromium riêng (proxy riêng, session riêng, fingerprint riêng). App hẹn giờ, tới giờ mở profile đã đăng nhập sẵn, lấy nội dung từ n8n qua webhook, tải ảnh/video về máy và tự động đăng bài. Mọi quy trình chạy ngầm, không chiếm chuột.

## Vì sao không dùng X API

Tài khoản chỉ ở Free tier nên đăng bài bị chặn (lỗi `402 CreditsDepleted` / `403 client-not-enrolled`), endpoint v1.1 `statuses/update` không có quyền. Aviary đăng bài bằng automation trình duyệt trên profile đã đăng nhập thay vì gọi API.

## Kiến trúc tóm tắt

- **Electron + React (TypeScript):** vỏ desktop + dashboard quản lý.
- **Playwright (hướng Patchright stealth):** điều khiển chromium ngầm qua CDP.
- **Fingerprint injection tự xây:** mỗi account một fingerprint ổn định, khớp proxy.
- **SQLite:** lưu account, job, log, settings.
- **n8n:** nguồn dữ liệu/xử lý nội dung (đọc Google Sheet → trả asset + caption).

Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Lộ trình: [docs/ROADMAP.md](docs/ROADMAP.md)

## Trạng thái

Đang ở giai đoạn khởi tạo (v0.0.1). Xem [CHANGELOG.md](CHANGELOG.md).

## Lưu ý

Công cụ phục vụ quản lý tài khoản của chính người dùng. Automation trình duyệt có thể vi phạm ToS của X; rủi ro liên quan tới tài khoản thuộc về người dùng. Aviary giảm thiểu rủi ro bằng hành vi giống người và hạn mức, nhưng không loại bỏ hoàn toàn.
