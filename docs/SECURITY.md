# Security — Hard Rules cho dự án Aviary

Tài liệu này là **luật bắt buộc** cho mọi người (và mọi AI agent) làm việc trong repo.
Mục tiêu: không bao giờ rò rỉ dữ liệu mật (token, credential, session user) lên git.

## 1. Dữ liệu cấm commit

Repo Aviary xử lý: tài khoản X thật, **proxy có credential**, session đăng nhập Chromium,
webhook secret, nhật ký. Mọi thứ đó là **dữ liệu người dùng**, không bao giờ được đưa lên GitHub.

`.gitignore` đã chặn:
```
*.db  *.sqlite*        # DB SQLite (accounts, proxies user:pass, webhook secret, logs)
.env*  secrets.json    # secret cấu hình
*.pem *.key            # khóa riêng
.claude/               # cache token/permission của Claude Code (GH_TOKEN, API key…)
data/  tmp/  out/  *.log   # session, tải về, build, log
```

> Bất kỳ pattern mới nào chứa secret → thêm vào `.gitignore` ngay.

## 2. Quy trình commit bắt buộc

### Quy tắc vàng
- **KHÔNG `git add -A` / `git add .` mù quáng.**
- **Luôn xem `git status` + `git diff --cached` trước khi `git commit`.**
- **Không hardcode** token/password/secret thật vào source (kể cả comment, test, placeholder).

### Scan secret trước khi commit (bắt buộc ít nhất 1 lần/đầu session)

Chạy pre-commit hook (đã cài ở `.githooks/pre-commit`, tự chạy khi `git commit`):

```bash
# Bật hook (chạy 1 lần / clone mới)
git config core.hooksPath .githooks
```

Hoặc scan thủ công — tìm các pattern secret phổ biến:
```bash
# Token GitHub / PAT / OpenAI / AWS / private key
grep -rnIE "ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|gho_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.md' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out . \
  && echo "⚠️ TÌM THẤY SECRET — KHÔNG COMMIT" || echo "✓ Sạch"
```

Kiểm tra không có file nhạy cảm nào bị track:
```bash
git ls-files | grep -iE '\.(db|sqlite|pem|key|env)$|secret|credential|cookie' && echo "⚠️ CÓ" || echo "✓ Sạch"
```

## 3. Token đã lộ = phải revoke

Nếu một secret lỡ bị **dán vào chat**, **commit**, hoặc **ghi vào file không ignore**:
1. **DỪNG**, không push.
2. Báo user **revoke (thu hồi) token ngay** trên GitHub Settings → Developer settings → Tokens.
3. Xoá token khỏi file/commit chỉ là phụ — git history vẫn lưu → revoke là biện pháp duy nhất triệt để.
4. Nếu đã push secret → user phải force-push xoá + revoke token + xoá cache GitHub (contact GitHub Support nếu cần).

> Xoá file khỏi working copy KHÔNG đủ. Git lưu lịch sử. **Revoke là bắt buộc.**

## 4. Pre-commit hook (defense in depth)

`.githooks/pre-commit` quét secret trong staged files trước mỗi commit. Nếu thấy pattern
token/key → **chặn commit**. Cài 1 lần:
```bash
git config core.hooksPath .githooks
```

Hook không thay thế việc con người/người đại diện kiểm tra — nó là tầng phòng thủ cuối.

## 5. Audit định kỳ

Khi nghi ngờ leak:
```bash
# Xem toàn bộ lịch sử có commit file .db/.env/.claude không
git log --all --full-history -- '*.db' '.env*' '.claude/*' 'secrets.json'
```
Nếu có → báo user, cân nhắc revoke + xoá lịch sử.