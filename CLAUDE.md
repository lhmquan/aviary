# Aviary — Hard Rules cho Claude Code

Các quy tắc **bắt buộc** khi làm việc trong repo này. Vi phạm có thể làm rò rỉ dữ liệu mật.

## 🔒 Bảo mật — KHÔNG thương lượng

### Dữ liệu CẤM commit lên git
Các loại sau **tuyệt đối không được add/commit/push**:

| Loại | Lý do | Đã ignore trong `.gitignore` |
|------|-------|------------------------------|
| `*.db`, `*.sqlite`, `*.sqlite3` | DB SQLite `aviary.db` chứa: tài khoản X, **proxy credentials** (user:pass), webhook secret, nhật ký. | ✅ `*.db` |
| `.env`, `.env.*` | Token/secret cấu hình runtime. | ✅ `.env*` |
| `*.pem`, `*.key`, `secrets.json` | Khóa riêng, secret. | ✅ |
| **`.claude/`** | `settings.local.json` cache **token & permission** (vd `GH_TOKEN`, API key) — RỦI RO CAO. | ✅ `.claude/` |
| `data/profiles/`, `data/downloads/` | Session/cookie Chromium, file tải về. | ✅ |
| `tmp/`, `*.log`, `out/`, `node_modules/`, `dist/` | Tạm, build artifact, log. | ✅ |

### Quy trình commit BẮT BUỘC
1. **KHÔNG dùng `git add -A` / `git add .` mù quáng.** Phải kiểm tra `git status` + `git diff --cached` trước khi commit.
2. **Trước khi commit lần đầu trong session**: chạy scan secret (xem `docs/SECURITY.md` → mục "Scan trước khi commit").
3. **Không bao giờ ghi token/secret/password thật vào source code** (dù là comment, placeholder, hay file test). Dùng env var hoặc file bị ignore.
4. **Token GitHub / API key** chỉ dùng qua env var tạm thời (`export GH_TOKEN=...` trong 1 lệnh). Không lưu vào file nào có thể bị commit.
5. Nếu vô tình thấy secret trong diff → **DỪNG**, báo user, không commit.

### Token đã lộ phải REVOKE
Nếu một token/secret lỡ bị dán vào chat hoặc commit → nó bị xem là đã lộ. **Báo user revoke (thu hồi) ngay** trên GitHub/đối tác, không cố gắng "xoá khỏi git" là đủ (git history vẫn còn).

## 🏗️ Convention code
- **Comment + UI bằng tiếng Việt** (đã là pattern của repo).
- **TypeScript strict**: `npm run typecheck` phải sạch trước khi báo "xong".
- **Reload KHÔNG rebuild main process**: thay đổi main/preload → báo user **tắt app mở lại** (không phải nút Reload trong app).
- **DB migration**: dùng `addColumnIfMissing` / `CREATE TABLE IF NOT EXISTS` (idempotent, an toàn với DB cũ).
- **Pipeline đăng bài**: logic duy nhất ở `src/main/scheduler/runner.ts` (`runPostForAccount`). Cả nút "Đăng" lẫn scheduler đều gọi chung — không nhân bản logic.
- **Nhật ký**: mọi sự kiện (đăng, lịch, skip, lỗi) ghi qua `insertLog` với `eventType` đúng (`post`/`run`/`schedule`).

## 🔧 Lệnh thường dùng
```bash
npm run typecheck && npm run build   # kiểm tra + build (phải sạch)
npm run build:win                    # đóng gói Windows installer
npm run release                      # đóng gói + publish GitHub release (cho auto-update)
```

## 📚 Tài liệu
- Kiến trúc: `docs/ARCHITECTURE.md`
- Lộ trình: `docs/ROADMAP.md`
- Bảo mật chi tiết + scan secret: `docs/SECURITY.md`