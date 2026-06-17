# Aviary — Kiến trúc kỹ thuật

## 1. Tổng quan

Aviary là ứng dụng desktop chạy trên Windows, điều phối nhiều profile chromium (mỗi profile = 1 account X), hẹn giờ, và tự động đăng bài bằng automation trình duyệt. Dữ liệu nội dung lấy từ n8n qua webhook.

```
┌─────────────────────────────────────────────────────────────┐
│                        Aviary (Electron)                      │
│                                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  UI (React)  │←→ │  Main process │←→ │   SQLite (DB)   │  │
│  │  dashboard,  │   │  IPC, lifecycle│   │ accounts, jobs, │  │
│  │  cấu hình    │   └──────┬───────┘   │  logs, settings │  │
│  └──────────────┘          │           └─────────────────┘  │
│                            │                                  │
│         ┌──────────────────┼───────────────────┐            │
│         ▼                  ▼                   ▼            │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────┐     │
│  │ Scheduler  │   │ Browser Pool   │   │ n8n Connector │     │
│  │ (cron/queue)│  │ (Playwright)   │   │ (webhook HTTP)│     │
│  └────────────┘   └───────┬────────┘   └──────┬───────┘     │
└───────────────────────────┼───────────────────┼─────────────┘
                            │                   │
              ┌─────────────┴──────┐            ▼
              ▼                    ▼     ┌──────────────┐
        ┌──────────┐        ┌──────────┐ │     n8n      │
        │ Profile 1│  ...   │ Profile N│ │ Google Sheet │
        │ proxy+FP │        │ proxy+FP │ │ xử lý nội dung│
        └────┬─────┘        └────┬─────┘ └──────────────┘
             ▼                   ▼
          x.com               x.com
```

## 2. Stack lựa chọn

| Lớp | Công nghệ | Lý do |
|-----|-----------|-------|
| Vỏ desktop | **Electron** | Có UI quản lý trực quan, chạy Node (cần thiết để điều khiển Playwright + filesystem). Quen thuộc, nhiều tài liệu. |
| Giao diện | **React + Vite + TypeScript** | Dashboard nhiều trạng thái động (account, job, log). TS giảm bug. |
| Automation | **Playwright** (hướng **Patchright** — fork stealth) | Điều khiển chromium qua CDP, chạy ngầm không chiếm chuột thật. Patchright vá các dấu hiệu CDP dễ bị phát hiện. |
| Anti-detect | **Fingerprint injection tự xây** | Mỗi profile có canvas/WebGL/UA/timezone/locale riêng, khớp proxy. Không phụ thuộc AdsPower/GoLogin (theo lựa chọn user). |
| Lưu trữ | **SQLite** (better-sqlite3) | Nhẹ, không cần server, lưu account/job/log/settings local. |
| Hẹn giờ | **node-cron + hàng đợi tự xây** | Lịch theo account + giới hạn concurrency. |
| HTTP | **undici/axios** | Gọi webhook n8n, tải asset. |

**Vì sao không dùng X API:** xác định ở phiên trước — Free tier chặn đăng bài (402 CreditsDepleted, 403 client-not-enrolled), v1.1 statuses/update không có quyền. Automation trình duyệt là đường khả thi.

## 3. Mô hình tiến trình

- **Main process (Electron):** vòng đời app, IPC, sở hữu DB, scheduler, browser pool.
- **Renderer (React):** chỉ UI, giao tiếp qua IPC. Không truy cập trực tiếp Playwright/DB.
- **Browser pool:** quản lý các `BrowserContext` (persistent, 1 userDataDir/account). Giới hạn số context mở đồng thời (config, mặc định ~3-5 cho 10-50 account).

Mỗi account chạy `chromium.launchPersistentContext(userDataDir, { proxy, ...fingerprint })` để giữ session qua các lần.

## 4. Luồng đăng bài (MVP)

```
Scheduler tới giờ account A
   │
   ▼
Browser Pool xin slot (chờ nếu đầy)
   │
   ▼
Gọi n8n webhook (kèm accountId, secret)
   │  ← n8n đọc Google Sheet, xử lý
   ▼
Nhận { assets: [url...], caption } 
   │
   ▼
Tải asset về data/downloads/<accountId>/<jobId>/
   │
   ▼
launchPersistentContext(profile A) — session đã đăng nhập
   │
   ▼
Mở x.com → kiểm tra đã đăng nhập? (nếu logout/checkpoint → dừng, báo lỗi)
   │
   ▼
Soạn bài: nhập caption → upload ảnh/video → chờ xử lý → Post
   │
   ▼
Xác nhận đăng thành công (URL/tweet xuất hiện)
   │
   ▼
Ghi log + trạng thái, đóng context, nhả slot
```

Lỗi ở bất kỳ bước nào → chụp màn hình vào log, phân loại lỗi, retry theo policy (giai đoạn 2).

## 5. Lớp tách biệt quan trọng

- **`XActions` (Page Object):** mọi selector/thao tác với UI X gom về một module. Khi X đổi giao diện, chỉ sửa ở đây. **Đây là điểm dễ vỡ nhất** nên tách riêng từ đầu.
- **`FingerprintProfile`:** sinh + lưu fingerprint ổn định cho mỗi account (cùng account luôn cùng fingerprint).
- **`ProxyManager`:** gắn proxy/profile, health-check.
- **`N8nConnector`:** đóng gói gọi webhook, retry, validate response.
- **`Scheduler` + `JobQueue`:** tách lịch (khi nào) khỏi thực thi (chạy thế nào).

## 6. Cấu trúc thư mục

```
Aviary/
├── docs/                  # ROADMAP, ARCHITECTURE, ...
├── src/
│   ├── main/              # Electron main: lifecycle, IPC, scheduler, pool
│   │   ├── browser/       # Playwright: pool, context, XActions, fingerprint
│   │   ├── scheduler/     # cron + job queue
│   │   ├── n8n/           # webhook connector
│   │   ├── db/            # SQLite schema + truy vấn
│   │   └── ipc/           # handlers nối renderer ↔ main
│   ├── renderer/          # React UI (dashboard, account, settings, logs)
│   └── shared/            # types dùng chung main ↔ renderer
├── data/
│   ├── profiles/<id>/     # userDataDir mỗi account (gitignore)
│   └── downloads/         # asset tải về (gitignore)
├── CHANGELOG.md
├── package.json
└── README.md
```

## 7. Lưu trữ dữ liệu (SQLite phác thảo)

- `accounts`: id, tên, handle, proxy, đường dẫn profile, fingerprint (JSON), trạng thái, hạn mức/ngày.
- `jobs`: id, accountId, loại (post/like/follow...), lịch, payload, trạng thái, thời điểm chạy.
- `logs`: id, jobId, mức độ, thông điệp, ảnh chụp lỗi (đường dẫn), thời gian.
- `settings`: webhook URL/secret, proxy mặc định, thư mục tải, concurrency.

**Bảo mật:** secret webhook và dữ liệu nhạy cảm không commit. Cookie/session nằm trong `data/profiles` (gitignore). Cân nhắc mã hóa ở giai đoạn 6.

## 8. An toàn tài khoản (xuyên suốt)

- Jitter thời gian đăng (không đúng phút tròn).
- Hành vi giống người: cuộn trang, delay gõ phím ngẫu nhiên, không thao tác tức thời.
- Hạn mức/ngày mỗi account.
- Timezone/locale của profile khớp proxy.
- Health-check proxy trước khi chạy.
- Phát hiện checkpoint/captcha → dừng account đó, báo người dùng (không cố vượt ở MVP).
