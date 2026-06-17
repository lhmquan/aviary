# Aviary — Roadmap

> Quản lý nhiều tài khoản X qua profile chromium anti-detect, hẹn giờ đăng bài, tích hợp n8n.

Phiên bản đánh số theo [SemVer](https://semver.org). Mỗi mốc dưới đây là một nhánh release; chi tiết thay đổi nằm ở `CHANGELOG.md`.

---

## Nguyên tắc nền

- **Không dùng X API để đăng bài.** Account chỉ Free tier, post bị chặn (402 credits / 403 not-enrolled). Đăng bài bằng automation trình duyệt trên profile đã đăng nhập.
- **Mỗi account = một profile chromium độc lập:** userDataDir riêng, proxy riêng, fingerprint riêng (canvas/WebGL/UA/timezone khớp proxy), cookie/session riêng.
- **Chạy ngầm, không chiếm chuột:** mọi thao tác qua Playwright (CDP), không điều khiển chuột thật của máy.
- **n8n là bộ não dữ liệu:** Aviary gọi webhook → n8n đọc Google Sheet, xử lý → trả về asset (ảnh/video URL) + caption → Aviary tải về + đăng.
- **An toàn tài khoản là ưu tiên số 1:** giới hạn nhịp độ, jitter thời gian, hành vi giống người, tránh pattern máy móc dễ bị X gắn cờ.

---

## Giai đoạn 1 — MVP đăng bài (v0.1.x)

Mục tiêu: đăng được 1 bài (ảnh hoặc video + caption) lên 1 account theo lịch, hoàn toàn tự động.

- [ ] Quản lý profile: tạo/sửa/xóa, mỗi profile gắn proxy + userDataDir.
- [ ] Mở profile để đăng nhập X thủ công lần đầu; session lưu lại, tái sử dụng.
- [ ] Fingerprint injection cơ bản mỗi profile (UA, viewport, timezone, locale theo proxy).
- [ ] Cấu hình webhook n8n (URL, method, header/secret).
- [ ] Luồng đăng bài: gọi n8n → nhận asset + caption → tải file về `data/downloads` → mở profile → đăng bài (text, ảnh, video) → xác nhận thành công.
- [ ] Bộ hẹn giờ (scheduler): đặt lịch đăng theo từng account, có jitter.
- [ ] Log + trạng thái mỗi lần chạy (thành công/lỗi, ảnh chụp khi lỗi).
- [ ] Cài đặt chung: proxy mặc định, thư mục tải, giới hạn concurrency.

## Giai đoạn 2 — Vận hành nhiều account (v0.2.x)

Mục tiêu: chạy ổn định 10-50 account song song có kiểm soát.

- [ ] Pool song song giới hạn concurrency (vd tối đa N profile mở cùng lúc).
- [ ] Hàng đợi lịch tập trung, tránh đụng tài nguyên (RAM/proxy).
- [ ] Health-check proxy trước khi chạy; cảnh báo proxy chết.
- [ ] Kiểm tra session còn sống (đã logout/checkpoint chưa) trước khi đăng.
- [ ] Retry có backoff khi đăng lỗi; phân loại lỗi (mạng / checkpoint / captcha / UI đổi).
- [ ] Dashboard tổng quan: account nào sắp đăng, đang chạy, lỗi gần đây.
- [ ] Import/Export cấu hình account (kèm proxy) dạng CSV/JSON — không kèm cookie nhạy cảm khi export.

## Giai đoạn 3 — Chăm sóc & nuôi tài khoản (v0.3.x)

Mục tiêu: account "sống" giống người thật, giảm rủi ro bị khóa.

- [ ] **Warmup mode:** account mới chạy nhịp nhẹ (lướt feed, đọc, thỉnh thoảng like) vài ngày trước khi đăng.
- [ ] **Auto engagement:** like / repost / reply theo danh sách từ khóa hoặc target account, có hạn mức/ngày.
- [ ] **Auto follow/unfollow** theo chiến lược, tôn trọng giới hạn ngày của X.
- [ ] **Lịch hành vi giống người:** giờ hoạt động theo timezone account, ngày nghỉ ngẫu nhiên, biến thiên nhịp độ.
- [ ] **Reply tự động** cho comment dưới bài của mình (qua n8n sinh nội dung).
- [ ] Hạn mức an toàn cấu hình được mỗi account (số post/like/follow tối đa mỗi ngày).

## Giai đoạn 4 — Nội dung & phát triển (v0.4.x)

Mục tiêu: tăng chất lượng nội dung và tốc độ phát triển account.

- [ ] **Thread tự động:** đăng chuỗi nhiều tweet nối nhau.
- [ ] **Hàng đợi nội dung (content queue):** kho bài chờ đăng, xoay vòng, tránh trùng.
- [ ] **Spintax/biến thể caption:** mỗi account đăng biến thể khác nhau để tránh trùng nội dung.
- [ ] **Tái sử dụng nội dung:** lấy bài tốt đăng lại sau X ngày (qua n8n quyết định).
- [ ] **Trend-aware:** n8n cấp hashtag/chủ đề trending, Aviary chèn vào bài.
- [ ] **A/B caption:** đăng 2 biến thể trên 2 account, so hiệu quả.

## Giai đoạn 5 — Phân tích & tối ưu (v0.5.x)

Mục tiêu: đo lường để biết cái gì hiệu quả.

- [ ] Thu thập chỉ số bài đăng (view/like/repost/reply) bằng cách đọc UI hoặc scrape nhẹ.
- [ ] Theo dõi tăng trưởng follower mỗi account theo thời gian.
- [ ] Báo cáo: bài tốt nhất, giờ đăng tốt nhất, account khỏe/yếu.
- [ ] Đẩy số liệu ngược về Google Sheet qua n8n để tổng hợp.
- [ ] Gợi ý giờ đăng tối ưu dựa trên dữ liệu lịch sử.

## Giai đoạn 6 — Bền vững & mở rộng (v0.6.x trở đi)

- [ ] **Backup/restore** toàn bộ cấu hình + session (mã hóa).
- [ ] **Cảnh báo** (Telegram/email qua n8n) khi account bị checkpoint/khóa.
- [ ] **Multi-platform** (mở rộng sang Threads/khác) nếu cần — kiến trúc tách adapter từ đầu.
- [ ] **Phát hiện checkpoint/captcha** và tạm dừng account đó, báo người dùng.
- [ ] Đóng gói cài đặt (installer) cho Windows.

---

## Ngoài phạm vi (hiện tại)

- Không bán/chia sẻ tài khoản. Công cụ phục vụ quản lý tài khoản của chính người dùng.
- Không vượt captcha tự động bằng dịch vụ bên thứ ba ở MVP (cân nhắc sau, có rủi ro ToS).
- Không giả mạo danh tính người khác.

## Rủi ro cần lưu ý

- **ToS của X:** automation trình duyệt có thể vi phạm điều khoản; rủi ro khóa account thuộc về người dùng. Aviary giảm thiểu bằng hành vi giống người + hạn mức, không loại bỏ hoàn toàn.
- **UI của X đổi:** selector đăng bài có thể vỡ khi X cập nhật giao diện → cần lớp selector tách riêng, dễ sửa.
- **Proxy chất lượng kém** là nguyên nhân khóa account phổ biến → health-check bắt buộc.
