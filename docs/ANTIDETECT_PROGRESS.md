# Nhật ký tiến trình Anti-Detect — Aviary

> File này ghi lại toàn bộ quá trình làm anti-detect fingerprint cho Aviary.
> Mục đích: sau này quay lại làm tiếp thì đọc để biết **đã làm gì, kết quả ra sao, còn vướng gì, hướng nào**.
> Cập nhật gần nhất: **2026-07-21**.

---

## 1. Bối cảnh & mục tiêu

Aviary quản lý nhiều tài khoản X/Twitter, mỗi tài khoản = 1 profile Chromium riêng. Mục tiêu anti-detect:

1. **Mỗi profile là một "thiết bị" khác nhau** (canvas/WebGL/hardware/screen/fonts khác) → X không gom nhóm được các tài khoản là cùng 1 máy.
2. **Không lộ IP thật** (qua WebRTC) khi đã dùng proxy.
3. **Timezone/locale khớp proxy** → không bị đánh dấu "inconsistent".
4. **Trông đáng tin** trên các site test (iphey Trustworthy, pixelscan Consistent...).
5. **KHÔNG làm hỏng tính năng X** (đăng bài/comment/xoá/đọc views/upload nhiều ảnh).

---

## 2. Hành trình engine (tóm tắt)

### Giai đoạn 1 — patchright (BỎ)
- Engine gốc: `patchright` (Playwright fork vá stealth).
- **Vấn đề chí mạng phát hiện qua test**: patchright **cô lập MAIN world khỏi MỌI injection** — `addInitScript`, raw CDP `Page.addScriptToEvaluateOnNewDocument`, cả extension MV3 `world:MAIN` (Chrome 143 chặn `--load-extension`).
- Hệ quả: **Apify fingerprint-injector VÔ DỤNG** vì nó dựa `addInitScript`. Test xác nhận: `initScriptRan=false`, `hardwareConcurrency=8` (giá trị máy thật, không đổi được).

### Giai đoạn 2 — rebrowser-playwright + Apify (HIỆN TẠI)
- Đổi sang `rebrowser-playwright` (npm, org chính thức rebrowser, Playwright 1.52 + rebrowser-patches pre-applied, MIT/Apache).
- Test: `initScriptRan=true`, `hardwareConcurrency` override được, `navigator.webdriver=false`. → Apify inject **thành công**.
- Lib fingerprint: `fingerprint-generator` + `fingerprint-injector` v2.1.82 (Apify).

**Số liệu benchmark (proxy thật, rebrowser + Apify):**
- Canvas hash: máy thật `9be6ebdb...` → profile A `887c85...`, profile B `0f03a4...` (mỗi profile khác + nhất quán 2 lần mở) — **KHI CÒN canvas noise (đã bỏ, xem dưới)**.
- WebGL: HD 530 (thật) → Iris Xe (A) / AMD Radeon (B).
- Hardware: 8c/8GB → 16c/1GB (A) / 12c/8GB (B).
- webdriver: false mọi cấu hình.
- WebRTC: baseline lộ IP VN thật → sau mask = chỉ còn mDNS `.local`.

---

## 3. Các file đã tạo/sửa (trạng thái hiện tại)

| File | Vai trò |
|------|---------|
| `src/main/browser/BrowserManager.ts` | Đổi import `patchright`→`rebrowser-playwright`. Thêm `resolveProxyGeo` (set timezoneId+locale khớp proxy), arg `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, gọi `injectFingerprint`. `ensureTestBookmarks` MERGE 6 site test vào profile. |
| `src/main/browser/fingerprintScript.ts` | Script inject MAIN world: (1) xoá `window.__pwInitScripts` (rebrowser để lộ), (2) WebRTC mask IPv4+IPv6 (scrub SDP + lọc onicecandidate). **KHÔNG noise canvas** (xem lý do §4). |
| `src/main/browser/proxyGeo.ts` | Tra IP proxy qua `ip-api.com` → `{timezone, locale, countryCode}`. Cache theo proxyString. |
| `src/main/actions/InteractSession.ts` | Import `patchright`→`rebrowser-playwright`. |
| `src/main/actions/XActions.ts` | Import `patchright`→`rebrowser-playwright`. |
| `src/shared/types.ts` | Thêm `fingerprint?: string \| null` vào Account (lưu fingerprint Apify vào DB để nhất quán). |
| `package.json` | Bỏ `patchright`, thêm `rebrowser-playwright ^1.52.0`, giữ `fingerprint-generator/injector ^2.1.82`. |

---

## 4. Quyết định lớn: BỎ canvas noise (2026-07-20)

**Vấn đề**: canvas noise tầng JS (override `toDataURL`/`getImageData`) LUÔN bị **pixelscan báo "Masking detected"** + **iphey "Unreliable"**.

**Nghiên cứu (2 nguồn độc lập: NST + Castle blog + đọc source Apify) xác nhận:**
1. pixelscan/iphey bắt canvas-noise-JS qua: `toString()` không còn `[native code]`, double-read không ổn định, proof-of-work pixel check.
2. **Chỉ native kernel patch** (NST = Skia C++, Camoufox = Firefox Juggler) mới noise được canvas mà không lộ.
3. **Apify fingerprint-injector CỐ TÌNH KHÔNG noise canvas** — để canvas native vì "canvas thật > canvas giả bị bắt".

**→ Quyết định**: theo Apify — BỎ canvas noise, để canvas native. Profile phân biệt nhau qua WebGL/hardware/screen/fonts/locale.

**Đánh đổi**: các tài khoản trên **cùng 1 máy sẽ CÓ CÙNG canvas hash** (có thể bị link nếu X so canvas). Nhưng không còn cờ "masking detected".

---

## 5. Kết quả test 4 site (proxy US)

| Site | Kết quả |
|------|---------|
| bot-detector.rebrowser.net | ✅ TẤT CẢ XANH (pwInitScripts/webdriver/Runtime.Enable pass) |
| Timezone (pixelscan) | ✅ America/Los_Angeles khớp proxy US |
| WebRTC | ✅ chỉ còn mDNS `.local`, không lộ IP thật |
| iphey / pixelscan (canvas) | ⚠️ Khi CÒN canvas noise → "masking". Sau khi BỎ → cần test lại (chưa xác nhận) |

**Phản hồi user gần nhất (2026-07-21): "vẫn thấy đỏ nhiều lắm" + "một số tài khoản hay bị lock tạm thời".**
→ Chưa rõ site nào/mục nào đỏ (chưa lấy được chi tiết). Đây là lý do chuyển hướng nghiên cứu Camoufox.

---

## 6. Giới hạn cố hữu của hướng JS-injection (Chromium)

1. **ServiceWorker/Worker context**: Apify+JS KHÔNG chạm được → CreepJS đọc hardware thật ở đó. Chỉ native patch tránh được.
2. **Canvas**: không thể noise mà không bị bắt (đã bỏ).
3. **Cùng máy = cùng canvas** (link được).
4. Các "lie" nhỏ CreepJS luôn bắt được (bản chất mọi JS-injection).

---

## 7. Rủi ro account lock (cần điều tra thêm)

User báo "tài khoản hay bị lock tạm thời". Chưa xác định nguyên nhân. Các khả năng, XẾP THEO ĐỘ NGHI:
1. **Chất lượng proxy** (datacenter/đã bị blacklist) — thường là nguyên nhân #1 gây lock X, KHÔNG liên quan fingerprint.
2. **Pattern hành vi** (đăng/comment quá nhanh, quá đều) — xem `InteractSession.ts` think-time.
3. **Đổi fingerprint đột ngột** giữa các lần mở cùng account (nếu fingerprint không nhất quán → X thấy "thiết bị đổi liên tục" = đáng ngờ). CẦN KIỂM: fingerprint có lưu DB và tái dùng đúng không? (Có — `updateAccount(account.id, {fingerprint})`.)
4. Engine swap patchright→rebrowser có thể đổi một số đặc tính → cần so trước/sau.

> **Việc cần làm khi tiếp tục**: lấy từ user CHI TIẾT lock xảy ra khi nào (ngay khi login / sau thao tác / ngẫu nhiên), và site nào báo đỏ ở mục gì.

---

## 8. Hướng đang nghiên cứu: Camoufox (nhánh riêng)

**Lý do**: chỉ native patch mới giải quyết được canvas + Worker context + canvas-riêng-mỗi-profile mà vẫn pass pixelscan.

**Kế hoạch (user duyệt 2026-07-21):**
1. Rẽ nhánh git mới (không đụng `main`).
2. Nghiên cứu Camoufox: khả năng, chi phí, cách bundle Electron.
3. Tạo app song song chạy Camoufox, cấu trúc tương tự, **clone data app cũ** để test.
4. Sau thời gian test, nếu ổn → merge vào app chính.

> **(Phần đánh giá Camoufox chi tiết sẽ được điền sau khi có kết quả nghiên cứu — xem §9.)**

---

## 9. Đánh giá Camoufox (nghiên cứu 2026-07-21, có số thật + nguồn)

### Là gì / license / chi phí
- **Fork Firefox** (base LibreWolf) patch tầng **C++/native** (Juggler) → canvas/WebGL/fingerprint đến từ dưới JS → **KHÔNG bị pixelscan/iphey báo "masking"** (giải đúng vấn đề Aviary).
- License repo `daijro/camoufox`: **MPL-2.0**; `camoufox-js` (Apify port): **MPL-2.0**; Python `camoufox`: MIT. → **Dùng thương mại được**, chỉ cần công khai nếu sửa chính file MPL (ta chỉ dùng, không sửa).
- **Miễn phí hoàn toàn**, không bản trả phí, không giới hạn profile.
- Sức khoẻ dự án: 10.3k sao, commit mới 2026-07-19, base **Firefox 152**, version `v152.0.4-beta.28` (vẫn **beta**).
- ⚠️ **Rủi ro maintenance CAO**: single-maintainer, đã có **~1 năm gián đoạn 2025-2026** → dự án tự thừa nhận hiệu năng chống-detect **đã giảm** + có fingerprint inconsistency mới. Hiện hoạt động lại.

### Điều khiển bằng code
- Package Node: **`camoufox-js`** (Apify) v0.11.2, ~156k download/tuần. peerDep: **`playwright-core`** (phải tự cài). Deps: `better-sqlite3` (native!), `maxmind`, `fingerprint-generator`. `engines: node >=22`.
- Dùng **Playwright-Firefox API chuẩn** → trả `Browser/Page/BrowserContext` như Playwright. Launch: `Camoufox({...})` hoặc `firefox.launch({...await launchOptions()})`.
- Binary **tải riêng** (`npx camoufox-js fetch`), KHÔNG kèm npm. Trỏ chỗ cài qua env `CAMOUFOX_INSTALL_DIR` / `executablePath`.

### Tương thích action Aviary
| Action | Firefox/Camoufox |
|--------|------------------|
| Đăng text/ảnh/video, `setInputFiles`, upload nhiều ảnh, comment, xoá, đọc analytics, `addInitScript`, persistent context, proxy per-context | ✅ Y hệt (API Playwright chuẩn) |
| **Chặn media qua CDP `Network.setBlockedURLs`** | ❌ **Firefox KHÔNG có CDP** → phải viết lại bằng `page.route()` (cross-browser) hoặc option native `block_images: true` (gọn hơn) |

### Fingerprint native (spoof dưới JS)
- navigator/screen/WebGL/**canvas**/fonts/audio/battery/voices/geo/timezone/locale/WebRTC/OS.
- **Config per-profile**: có (fingerprint sinh từ BrowserForge/fingerprint-generator).
- **`geoip: true`** → tự tính geolocation+timezone+locale+WebRTC theo **vùng proxy** (MaxMind GeoLite2 ~40MB). → **Thay thế được proxyGeo.ts + WebRTC mask + timezone thủ công hiện tại**. (Yêu cầu CÓ proxy.)

### Kích thước & đóng gói (Windows, số thật GitHub API)
- Binary Windows x64 (.zip nén): **469.6 MB**. Giải nén + các version: tổng storage **~1.2 GB** (+~40MB GeoIP).
- Đóng gói electron-builder: (1) bundle sẵn → installer **phồng ~470MB–1.2GB**; hoặc (2) tải lần chạy đầu → installer nhẹ nhưng cần mạng + xử lý progress.
- ⚠️ Vướng: `better-sqlite3` cần **electron-rebuild**; `node>=22` cần Electron ≥31.

### Kết luận Camoufox vs rebrowser+Apify hiện tại
**Thắng**: canvas/fingerprint native (hết "masking"), geo/WebRTC/timezone tự động, Firefox ít bị nhắm hơn, miễn phí, API quen.
**Thua/rủi ro**: maintenance single-dev + gián đoạn (chống-detect đã giảm), mất CDP (viết lại media block), **installer phồng ~470MB–1.2GB**, native deps phức tạp, **phải test lại toàn bộ selector X trên Firefox**, vẫn beta.

**Ước lượng công sức**: automation logic gần như copy (đổi chromium→firefox); media block vài giờ (`page.route`/`block_images`); gỡ Apify/canvas/WebRTC/proxyGeo (Camoufox lo hết); nặng nhất là **packaging + regression test DOM X trên Firefox**. Tổng: **1–2 tuần PoC**, **2–4 tuần** chuyển + QA + đóng gói ổn định.

**Khuyến nghị**: làm **PoC đo số thật** (iphey/pixelscan/rebrowser-bot-detector) TRƯỚC khi cam kết — vì dự án tự nói đã giảm hiệu năng, phải xác nhận nó thực sự thắng rebrowser+Apify mới đáng gánh +470MB + rủi ro. Cân nhắc **kiến trúc 2 engine** (Chromium mặc định, Camoufox tuỳ chọn per-profile) thay vì thay hẳn.

### Số CHƯA chắc (không bịa)
- Dung lượng giải nén riêng bản Windows (chỉ có ~1.2GB tổng từ docs Python).
- Benchmark điểm iphey/pixelscan thực tế của Camoufox 2026 — **phải tự đo bằng PoC**.

---

## 12. KẾT QUẢ PoC Camoufox (2026-07-21, đo THẬT, nhánh feat/camoufox-poc)

**Setup**: thư mục PoC độc lập `E:/Antigravity/camoufox-poc` (KHÔNG đụng node_modules app vì app dùng better-sqlite3 build cho Electron, PoC cần build cho Node v24). `scripts/camoufox-poc.mjs` trong repo (bản gốc). Binary Camoufox 492MB + GeoIP 66MB tải vào cache `~/AppData/Local/camoufox`.

**⚠️ VERSION DRIFT (rủi ro thật đã gặp)**: `camoufox-js` peerDep `playwright-core: "*"` → npm kéo bản mới nhất **1.61.1** → LỖI `Browser.setDefaultViewport ... isMobile not described in scheme` (Juggler Camoufox Firefox 152 không nhận field mới). **FIX: pin `playwright-core@1.53.1`** (khớp devDep camoufox-js `^1.53.1`). → Khi tích hợp app PHẢI pin playwright-core đúng version, không để "*".

**FINGERPRINT CỐT LÕI (chạy LOCAL, không proxy):**
```
ua: Firefox/152.0 (Macintosh; Intel Mac OS X 10.15)   ← spoof OS Windows→Mac
platform: MacIntel   cores: 10   webdriver: false
webglVendor: Intel Inc.   webglRenderer: Intel(R) HD Graphics 400
canvasNativeToDataURL: TRUE   ← toDataURL VẪN [native code], KHÔNG bị masking (JS injection KHÔNG làm được)
canvasHash ổn định 2 lần đọc: TRUE (f43535b3 = f43535b3)   ← không double-read instability
tz: Asia/Ho_Chi_Minh   ← máy thật, vì CHƯA có proxy (geoip cần proxy)
```

**rebrowser-bot-detector**: dummyFn=0, sourceUrlLeak=0, mainWorldExecution=0, **runtimeEnableLeak=-1 (No leak)**, navigatorWebdriver=No, **pwInitScripts=No leak** (Camoufox KHÔNG có __pwInitScripts — rebrowser thì có, phải tự xoá!). ⚠️ chỉ 1 điểm: `viewport` = default {1280,720} → cần **`viewport: null`** (dễ fix).

**browserscan (local)**: **fingerprint authenticity 92%**, Bot Detection = No, Mac OS/Firefox 152 nhất quán. ❌ chỉ "IP different" + WebRTC lộ IP VN thật (vì KHÔNG proxy).

**pixelscan (local)**: "inconsistent" + "Masking detected" ❌ — **NHƯNG lý do KHÔNG phải canvas** (canvas native, hash ổn định). Lý do: chạy local → Location=Vietnam + tz=Asia/Ho_Chi_Minh (IP thật) NHƯNG UA=Mac OS → địa-lý-vs-UA lệch. WebRTC lộ 14.187.140.243. → **Dự kiến sẽ khớp khi có proxy + geoip + block_webrtc.**

**KẾT LUẬN PoC (local)**: Camoufox giải đúng vấn đề canvas (native, KHÔNG masking) — điều rebrowser+Apify KHÔNG làm được. Các cờ đỏ còn lại đều do THIẾU PROXY, cần vòng test với proxy để chốt. Điểm cần chỉnh khi tích hợp: `viewport: null`, `block_webrtc`, pin playwright-core.

**CÒN LẠI để quyết định GO/NO-GO**: chạy PoC với **proxy US live** (env TEST_PROXY) + `geoip:true` + `block_webrtc:true` + `viewport:null`, xác nhận pixelscan → Consistent, iphey → Trustworthy, WebRTC không lộ. Nếu đạt → dựng app đầy đủ.

---

## 10. Lệnh & lưu ý build

- `npm run dev` = chạy code hiện tại (dev). KHÔNG tạo installer.
- `npm run build` = biên dịch ra `out/` (không đóng gói).
- `npm run build:win` = build + đóng gói installer `.exe` trong `dist/`. **Đây mới là bản cài đặt mới.**
- `npm run release` = build + publish GitHub (cần `GH_TOKEN`, chỉ khi "Up Version").
- **App đã cài trong máy = bản build TRƯỚC ĐÓ** (chưa có thay đổi anti-detect). Tắt `npm run dev` + mở app đã cài = quay về bản ổn định cũ. Fingerprint thừa trong DB không gây hại.

---

## 11. Nhắc bảo mật

- Proxy test dùng khi benchmark (Webshare) đã bị **coi là lộ** trong hội thoại — user nên **revoke trên Webshare**. KHÔNG ghi IP/credential thật vào file này.
- Không hardcode proxy/secret vào source. Dùng env `TEST_PROXY`.
