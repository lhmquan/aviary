# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## Unreleased

## [0.25.0] - 2026-07-31

### Added
- **Hiển thị ngày giờ tạo profile** trong cả chế độ card và hàng ngang của mục Tài khoản.

### Fixed
- **Chuẩn hóa caption trước khi đăng**: giải mã HTML entity thường gặp, kể cả entity dạng số và bị encode nhiều lớp.
- Sửa các chuỗi UTF-8 bị lỗi mojibake như `â€™`, `Ã©` và emoji bị biến dạng; loại bỏ ký tự điều khiển/zero-width không mong muốn nhưng vẫn giữ tiếng Việt, emoji và xuống dòng hợp lệ.

## [0.24.0] - 2026-07-26

### Changed
- **Lịch bình luận quét đúng timeline hiện tại**: không còn dùng URL lịch sử trong nhật ký để thay thế danh sách bài mới nhất trên profile, tránh bài cũ/đã xoá chiếm quota và làm bỏ sót bài mới.
- **Lọc reply ngay khi thu thập**: reply của chính tài khoản không còn chiếm một slot trong số N bài gốc cần xét.
- **Đọc views trực tiếp khi cuộn profile**: dùng số views đầy đủ từ `role="group"`/anchor analytics trên article; chỉ mở detail cho bài không có số views inline.

### Removed
- **Gỡ hoàn toàn Camoufox/Firefox khỏi runtime** sau khi X trả lỗi API trên nhiều account và proxy; Aviary hiện chỉ dùng Chromium + Patchright.
- Gỡ engine selector, session migration, proxy bridge Firefox, Camoufox launcher, dependency và các script PoC liên quan.

### Fixed
- **Bỏ sót bài đủ ngưỡng views trong lịch bình luận** khi nhật ký đã có đủ N URL nhưng không phản ánh timeline profile hiện tại.
- Giảm số lần mở permalink và tab detail khi quét views, đặc biệt với các bài mới có `aria-label` views đầy đủ trên profile.

## [0.23.0] - 2026-07-25

### Added
- **Sao chép auth token theo từng tài khoản**: action mới tự mở đúng Chromium/Camoufox, tôn trọng chế độ chạy ngầm của tài khoản, đọc cookie X và ghi thẳng vào clipboard hệ điều hành.
- **Dialog và toast dùng chung**: xác nhận destructive, trạng thái xử lý async và thông báo kết quả được chuẩn hoá bằng HTML `<dialog>` top-layer cùng toast không chặn giao diện.

### Changed
- **Loại bỏ toàn bộ popup Windows cũ** trong renderer: thay `alert()`/`confirm()` bằng dialog hiện đại có scrim, Escape, quản lý focus, trạng thái busy và nút hành động theo mức độ cảnh báo.
- **Form Tài khoản và Lên lịch chuyển sang drawer bên phải**: full-height, nội dung cuộn độc lập, header/footer cố định và giữ ngữ cảnh danh sách phía sau.
- Validation nhãn tài khoản chuyển sang lỗi inline; các lỗi và kết quả ngắn chuyển sang toast thay vì chặn renderer.

### Security
- Auth token export không trả credential qua IPC về renderer, không đưa vào React state, DB, file, console hoặc nhật ký; token chỉ đi từ cookie jar trong main process tới clipboard sau khi user xác nhận.
- Dialog sao chép token hiển thị rõ engine/chế độ mở profile, khóa đóng dialog trong lúc lấy token và nhắc người dùng không chia sẻ credential.

## [0.22.2] - 2026-07-23

### Changed
- **Tách cửa sổ Camoufox trên Windows taskbar theo từng tài khoản**: mỗi profile có AppUserModelID riêng, không còn gom mọi cửa sổ Camoufox vào chung một icon.
- Thêm script `postinstall` idempotent để vá đường dẫn WebGL DB của `camoufox-js` sau khi cài dependency.

### Fixed
- **Camoufox không mở được trong bản đóng gói** với lỗi `SqliteError: unable to open database file`: unpack `webgl_data.db` khỏi ASAR và chuyển sampler sang đường dẫn filesystem thật `app.asar.unpacked`.
- **Phiên đăng nhập bằng auth token bị mất sau khi đóng browser**: cookie nhập tay được lưu dạng persistent trong profile thay vì session cookie.

## [0.22.1] - 2026-07-23

### Added
- **Đăng nhập X bằng auth token theo từng tài khoản**: thêm action nhập token, tự mở đúng engine Chromium/Camoufox đã cấu hình, thay cookie phiên và điều hướng tới `x.com/home`. Chỉ cập nhật trạng thái tài khoản sau khi xác nhận X Home đã đăng nhập.
- **Nhận nhiều định dạng auth token**: hỗ trợ giá trị token thuần, `auth_token=...`, cookie header đầy đủ, JSON/DevTools và token được bọc bằng dấu nháy.

### Changed
- **Aviary tự maximize khi khởi động** để giao diện sử dụng toàn bộ vùng làm việc ngay khi mở app.
- Auth token không được ghi vào DB, cấu hình hoặc log; browser chỉ lưu cookie phiên trong profile tương ứng để duy trì đăng nhập.

### Fixed
- **Auth token hợp lệ bị từ chối** khi user dán cookie có dấu `;`, khoảng trắng hoặc kèm `ct0`.
- **Thông báo lỗi IPC khó đọc** trong modal auth token: loại bỏ tiền tố kỹ thuật `Error invoking remote method` và `Error:` trước khi hiển thị.

## [0.22.0] - 2026-07-23

### Tổng quan
- **Chromium tiếp tục là engine mặc định và ổn định** cho tài khoản hiện có. Luồng đăng bài, xoá bài, bình luận, tương tác feed, scheduler và chặn media của Chromium được giữ nguyên.
- **Camoufox được phát hành dưới dạng engine beta theo từng tài khoản** để thử nghiệm anti-detect nâng cao. Tính năng đã hoạt động trong các PoC và kiểm tra hiện tại, nhưng vẫn cần tiếp tục kiểm chứng, theo dõi giới hạn phía X và sửa dần theo tình huống sử dụng thực tế.

### Added
- **Chọn engine theo từng tài khoản**: thêm `BrowserEngine` (`chromium` / `camoufox`), cột DB `accounts.engine`, lựa chọn engine trong form và logo engine trên card/hàng tài khoản. Migration idempotent giữ Chromium làm mặc định cho dữ liệu cũ.
- **Camoufox persistent profile tách biệt**: profile Firefox anti-detect nằm tại `<profileDir>/camoufox`, không trộn dữ liệu với profile Chromium. Binary Camoufox khoảng 470 MB được tải một lần bằng mạng máy, stream ra file tạm và cache dùng chung; binary không được bundle vào installer.
- **Fingerprint Camoufox cố định theo account**: BrowserForge identity, OS Windows, screen/window vật lý, WebGL vendor/renderer, canvas/audio/font seed, canvas anti-alias và history length được lưu theo schema riêng để giữ ổn định qua lần mở.
- **Geo-IP và chống rò rỉ**: timezone/locale/geolocation lấy theo GeoLite2 của Camoufox và IP proxy; WebRTC bị tắt. Diagnostic đối chiếu thêm timezone từ nguồn ngoài nhưng vẫn coi dữ liệu GeoLite2 của engine là nguồn chính.
- **Bảng chẩn đoán fingerprint**: icon kiểm tra trên từng tài khoản, snapshot runtime có cache, kiểm tra lại thủ công, single-flight chống mở trùng profile và báo cáo IP, timezone, UA/platform, CPU/RAM, WebDriver, màn hình/DPI, WebGL, canvas/audio, WebRTC cùng stored seeds.
- **Điểm anti-detect 0–100**: đánh giá collision giữa account, che dấu automation, identity/seeds riêng, WebRTC, tính hợp lý UA/platform/WebGL/screen, fingerprint surfaces và timezone khớp GeoLite2.
- **Chuyển phiên X từ Chromium sang Camoufox**: import đúng `ct0` và `auth_token` trong memory, không đưa credential qua renderer, DB, file, clipboard hoặc log. Chỉ đổi engine sau khi Camoufox xác nhận vào được X Home; thất bại giữ nguyên Chromium.
- **Giao diện Camoufox dùng được như browser thường**: bookmark bar `Aviary Checks`, tab có thể chọn/đóng, nút tab mới, trạng thái hover/selected rõ ràng và window controls không chồng lên tab.
- **Hai chế độ xem tài khoản**: giữ dạng thẻ và thêm dạng hàng ngang hiện đại, responsive. Lựa chọn `Thẻ / Hàng ngang` được ghi nhớ trên máy; hàng ngang vẫn có đủ identity, trạng thái, proxy, thống kê, hoạt động, tag và action.
- **Tài liệu nghiên cứu anti-detect**: bổ sung log PoC, benchmark, quyết định kỹ thuật và script đo fingerprint Camoufox phục vụ kiểm chứng nội bộ.

### Changed
- **Mọi action dùng chung cơ chế mở page tác vụ**: với Camoufox, page mới được mở thành tab trong cửa sổ hiện tại; Chromium tiếp tục dùng hành vi `newPage()` ổn định sẵn có. Áp dụng cho đăng, xoá, thu thập profile, đọc context/reply, đọc views, crawl, bình luận, fingerprint và chuyển phiên.
- **Camoufox chạy ngầm trên Windows bằng headful ẩn cửa sổ** thay cho headless persistent context dễ tự thoát. Thêm preference chống background timer/render throttling, focus loss và window occlusion để tác vụ tiếp tục khi tab hoặc cửa sổ không onscreen.
- **Tối ưu tài nguyên Camoufox**: giới hạn content process, cache RAM/media, bật unload tab khi thiếu RAM, tắt prefetch/predictor/speculative connections và bỏ uBlock mặc định; vẫn giữ disk cache/session history để X tải nhanh và nút Back hoạt động.
- **Chặn media theo từng engine**: Chromium giữ CDP `Network.setBlockedURLs`; Camoufox dùng chặn ảnh native và route video X, không chặn `blob:` preview hoặc endpoint upload.
- **Mở Camoufox tuần tự** để giảm spike CPU/RAM khi mở nhiều account, nhưng không áp giới hạn cứng số profile hoặc lượng RAM trống.
- **Ghim `playwright-core` đúng `1.53.1`** để tương thích protocol của Camoufox; tích hợp `camoufox-js` ESM bằng dynamic import an toàn trong main bundle CommonJS.

### Fixed
- **Camoufox mở cửa sổ mới cho mỗi action**: thay bằng tab mới trong đúng cửa sổ profile hiện có trên toàn bộ pipeline.
- **Camoufox dừng hoặc chậm khi chạy nền**: vô hiệu background throttling và dùng cửa sổ headful ẩn cho chế độ ngầm trên Windows.
- **Tab Camoufox không click được, mất nút đóng/tab mới và bookmark bar bị ẩn**: override chrome UI idempotent bằng marker riêng của Aviary.
- **Cửa sổ Camoufox có dải đen khi Windows scale 125%**: quy đổi kích thước DIP sang physical pixel, dùng viewport native và maximize đúng cửa sổ.
- **Nút Back không hoạt động**: bật cache và session history có giới hạn.
- **Canvas stability báo thay đổi giả**: hash pixel RGBA bằng `getImageData()` thay vì hash byte PNG có metadata biến động.
- **Rò rỉ dữ liệu nhạy cảm qua thông báo lỗi**: không đưa browser log, command line dài hoặc proxy credential ra UI/log.

### Known limitations
- Camoufox là tính năng **beta** trong `0.22.0`; cần tiếp tục test các pipeline dài, chế độ chạy ngầm và hành vi khi X áp checkpoint/anti-spam/rate-limit.
- X có thể chặn submit bằng cơ chế chống automation phía server. Đây không phải lỗi xác định được chỉ từ browser engine và không nên regression submit lặp lại trên tài khoản thật đang bị hạn chế.
- Thay đổi main/preload hoặc engine yêu cầu **tắt hẳn Aviary rồi mở lại**; nút Reload trong app không rebuild main process.

## [0.7.0] - 2026-06-28

### Added
- **Tự tách thread khi caption quá dài**: caption vượt 280 ký tự (tính theo cách X — URL=23, emoji/CJK=2) tự động tách thành nhiều phần ≤280 và đăng bằng nút "+" (addButton) trong composer. **Giữ nguyên toàn bộ nội dung**, tách ở ranh giới từ; token siêu dài (URL/chuỗi không khoảng trắng) được cắt cứng an toàn. Media gắn ở tweet đầu (upload trước khi tách thread).

### Fixed
- **Lỗi "Đã bấm Post nhưng modal chưa đóng" do caption dài**: trước đây caption vượt giới hạn khiến X khoá nút Post (`aria-disabled`) vĩnh viễn → app vẫn click vào nút chết → chờ 45s → báo lỗi đổ cho "overlay/mạng chậm" (sai bản chất). Giờ: phát hiện nút Post còn bị khoá sau khi nhập → báo lỗi đúng nguyên nhân (độ dài ký tự cụ thể vs giới hạn) kèm screenshot, không click vô ích.
- **Nút "+" thêm ô soạn thread không tìm thấy**: cải thiện `addThreadComposer` với 6 biến thể selector (bao gồm `data-testid="addButton"` và `aria-label="Thêm bài đăng"` tiếng Việt), scroll nút vào view, force-click 3 nấc. Khi thất bại in chẩn đoán DOM thật (liệt kê nút Add/Thêm khả nghi) ra terminal.

## [0.6.0] - 2026-06-27

### Added
- **Hàng đợi — thiết kế lại "Live Queue Board"** (từ bảng phẳng → danh sách card sống động):
  - Mỗi tài khoản là 1 card 3 cột: danh tính (avatar thật + tên + @handle + chip tác vụ), lịch + tiến trình, trạng thái + countdown.
  - **Tiến trình realtime thật**: card đang chạy hiện shimmer bar + dòng stage sống ("Đang chờ X xác nhận…") lấy từ `onProgress.message` theo `accountId` (trước đây bỏ phí, chỉ dùng `busy` để refresh).
  - **Thanh tiến trình** tới lần chạy kế (fill theo % thời gian trôi `lastRunAt → nextRunAt`, fallback theo chu kỳ interval).
  - **Slot meter dạng pips** (●●○) trực quan thay badge chữ; nhãn "kế tiếp" cho item sắp chạy gần nhất; vòng sáng nhấp nháy quanh avatar khi đang chạy.
  - Chip tác vụ đủ 3 màu: Đăng (xanh), Xoá (đỏ), **Bình luận (tím)** — bổ sung comment mà bản cũ thiếu.
- **Analytics UI**:
  - Mỗi card hiện dòng "Đang theo dõi N ngày · từ DD/MM" + dòng "Từ khi theo dõi: +X fl / +Y bài".
  - Badge mốc chưa đủ dữ liệu hiển thị "—" mờ với tooltip giải thích (vd "Chưa đủ dữ liệu cho mốc 7 ngày trước — đang theo dõi 1 ngày").
  - Card overview "followers tăng/tuần" tự fallback sang "tăng từ đầu" khi chưa account nào đủ 7 ngày.
  - Ghi chú cảnh báo khi dữ liệu còn mỏng (< 7 ngày): nhắc fetch đều mỗi ngày để mốc 7d/30d chính xác.

### Changed
- **Analytics — hệ thống lại cách tính & hiển thị tăng trưởng (trung thực theo dữ liệu)**:
  - `computeDelta` giờ **neo theo snapshot mới nhất** (không neo "hôm nay") và chỉ tính khi tìm được snapshot tham chiếu thật trong dung sai cho phép (1d→±1 ngày, 7d→±3 ngày, 30d→±15 ngày). **Bỏ fallback bịa số** (cũ lấy `series[0]` cho mọi mốc → khi chỉ có 1 snapshot, cả 1d/7d/30d đều ra +0 giống nhau).
  - `GrowthDelta` thêm cờ `available`: `false` nghĩa là "chưa đủ dữ liệu để tính" (hiển thị "—" mờ + tooltip), **khác hẳn** số 0 (có data nhưng không đổi).
  - Thêm `sinceStart` (tổng thay đổi từ snapshot đầu tiên), `trackedDays`, `firstDay`, `latestDay` vào `AccountGrowth`.
- **Tài khoản**: đưa nút "Chạy ngầm" (Eye/EyeOff) + "Test webhook" (Zap) ra ngoài card dưới dạng icon-only (có tooltip), menu `⋮` chỉ còn "Sửa" + "Xoá".
- **Terminal**: thu gọn chiều cao header (nút action 26→22px, bỏ min-height co giãn) để bớt chiếm khoảng trống.

## [0.5.0] - 2026-06-26

### Added
- **Tính năng Bình luận (comment)** — tác vụ mới cho scheduler (`action: post | delete | comment`):
  - Webhook event `comments` gửi handle + URL nguồn → n8n lọc Google Sheet → trả nội dung bình luận.
  - App cuộn trang profile thu thập link bài gốc, phát hiện reply qua `tabindex` trên trang tweet detail (bài gốc `tabindex="-1"`, reply `tabindex="0"`).
  - Bình luận tuần tự với delay giữa mỗi lần. Cache link đã xử lý với 4 status: `collected` (chưa mở), `commented` (thành công), `reply_skip` (là reply), `fail` (lỗi, thử lại).
  - Tối ưu: nếu cache còn đủ link chưa xử lý → bỏ qua cuộn profile (tiết kiệm thời gian).
  - **Limit comment/ngày**: cài đặt global (`commentDailyLimit`, mặc định 30). Chạm limit → lịch dời `nextRunAt` sang midnight hôm sau.
  - Cài đặt: số bài/lần chạy, thời gian giữa mỗi bình luận (chỉ hiện khi count > 1), nguồn Google Sheet + nút **Test Webhook**.
  - Ràng buộc thời gian: tổng thời gian thực thi `(count-1) × interval + buffer 30s` phải ≤ khoảng cách giữa 2 tác vụ.
  - Badge màu **tím** (`action-comment`, `ev-comment`, `ev-run-comment`).
  - DB mới: bảng `comment_history` + cột `comment_count`, `comment_interval_seconds`, `comment_source_url` cho schedules.
- **Webhook `data_acc`**: nút "Fetch ngay" trong Analytics gửi snapshot dữ liệu (followers/following/posts/name/handle) về n8n để cập nhật Google Sheet. Chỉ kích hoạt khi bấm thủ công (không gửi khi auto-fetch).
- **Delay giữa mỗi lần fetch tài khoản**: giảm concurrency 3→1, thêm delay 2.5s giữa mỗi lần fetch tránh X rate-limit (429).
- **Cài đặt `commentDailyLimit`** trong tab Settings.

### Changed
- Đổi label "Số phút giữa mỗi lần đăng" → "Thời gian giữa mỗi tác vụ" (áp dụng cả post/delete/comment).
- Gộp "Số bài bình luận" + "Thời gian giữa mỗi bình luận" vào 1 hàng ngang (`.field-row-2`) để gọn UI.
- Status bar header gọn hơn (padding 1px, min-height 24px).

### Fixed
- **Analytics delta sai**: `upsertDailyStats` cũ chỉ update `captured_at` khi cùng ngày → giữ giá trị đầu ngày → 3 mốc delta (1d/7d/30d) tham chiếu cùng giá trị → ra kết quả giống nhau. Giờ update toàn bộ stats (followers, following, statuses_count, name) → mỗi ngày giữ giá trị mới nhất.
- **Tiền tố caption**: decode HTML entities (`&amp;` → `&`) + hỗ trợ escape `\n`, `\t`, `\\`. Bỏ `.trim()` để giữ dấu cách đầu/cuối.
- **Link Reddit hỏng**: `originalUrl` (i.redd.it) ưu tiên trước `imageUrl` (preview.redd.it) cho `single_image` — URL thô, không HTML entity, không query param → ít lỗi 403 hơn.
- **Nút Reply không bấm được**: tìm nút trên toàn page thay vì trong scope; dùng `fill()` thay `keyboard.type` để trigger input event đúng.

## [0.4.0] - 2026-06-24

### Added
- **Analytics**: snapshot thống kê X (followers/following/posts) theo ngày cho từng tài khoản, biểu đồ tăng trưởng, delta 1d/7d/30d.
- **Queue**: hàng đợi scheduler với giới hạn đồng thời (semaphore), cờ `running` bền vững khôi phục sau crash.
- **Redesign UI**: bảng tài khoản kéo dãn cột, badge trạng thái màu sắc, terminal statusbar.
- **Sửa rò rỉ dữ liệu**: `.gitignore` chặt chẽ hơn cho DB, `.env`, `.claude/`, session Chromium.

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
