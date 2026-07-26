# Nhật ký tiến trình Anti-Detect — Aviary

> File này ghi lại toàn bộ quá trình làm anti-detect fingerprint cho Aviary.
> Mục đích: sau này quay lại làm tiếp thì đọc để biết **đã làm gì, kết quả ra sao, còn vướng gì, hướng nào**.
> Cập nhật gần nhất: **2026-07-21**.

> **Quyết định 2026-07-26:** Camoufox đã được gỡ khỏi Aviary. X trả lỗi API trên Camoufox
> với nhiều account và proxy trong khi Chromium/Patchright hoạt động bình thường. Các phần
> Camoufox bên dưới được giữ như nhật ký nghiên cứu lịch sử, không còn là tính năng runtime.

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

### 12b. PoC VỚI PROXY (2026-07-21, proxy US live qua env)

**BƯỚC NGOẶT — geoip + proxy làm fingerprint TỰ KHỚP:**
```
ua: Firefox/152.0 (Windows NT 10.0; Win64; x64)   ← ĐÃ ĐỔI Mac→Windows! khớp proxy US
platform: Win32   cores: 8
tz: America/Chicago   ← TỰ động khớp proxy US (geoip hoạt động, hết Asia/Ho_Chi_Minh)
webdriver: false   webglVendor: Google Inc. (AMD)   webglRenderer: ANGLE AMD Radeon R9 200
canvasNativeToDataURL: true   canvasHash ổn định: true (8d57ab22)
```
→ Đây chính là điều local KHÔNG có: **UA + timezone + geo giờ NHẤT QUÁN với proxy**. Camoufox tự chọn OS profile khớp proxy (US → Windows US điển hình). Đây là cái pixelscan/iphey cần.

**pixelscan (proxy)**: chụp GIỮA lúc scan (proxy chậm, 12s chưa xong) — kịp thấy "Firefox 152 on **Windows**", "No automated behavior detected", Canvas/WebGL/AudioContext hash native. Verdict cuối CHƯA chụp được.
**browserscan (proxy)**: kịp thấy **"fingerprint authenticity: 100%"** (cao hơn local 92%!), nhưng field khác còn đang load.
**iphey + creepjs**: timeout 45s (proxy chậm, KHÔNG phải lỗi Camoufox).

**VẤN ĐỀ DUY NHẤT: proxy chậm** → site scan chưa kịp xong trong thời gian chờ. Đang chạy lại vòng "slow" (chờ 30-35s/site) để chụp verdict cuối. Fingerprint cốt lõi đã chứng minh Camoufox làm đúng.

### 12c. PoC ĐO SẠCH — OS ghim Windows + profile cố định + đợi scan xong (2026-07-21)

**BÀI HỌC QUAN TRỌNG (2 lỗi phương pháp đã sửa):**
1. **Camoufox random OS mỗi profile mới**: lần chạy `rm -rf profile` → có lần bốc Mac (WebGL Apple M1, screen Retina) lệch máy Windows → tăng nguy cơ "masking". **FIX: `os:'windows'` + profile CỐ ĐỊNH** (như app thật: 1 account = 1 fingerprint ổn định).
2. **Text-match verdict = DƯƠNG TÍNH GIẢ**: grep "consistent/masking" trong `body.innerText` bắt nhầm chữ trong FAQ/mô tả trang, KHÔNG phải verdict thật. **Phải ĐỌC ẢNH** để xác nhận. (User đã cảnh báo: điểm khi đang load nhảy lên rồi tụt — không được đoán.)

**CORE (OS ghim Windows, proxy US Indiana):**
```
ua: Firefox/152.0 (Windows NT 10.0; Win64; x64)   platform: Win32   cores: 16
tz: America/Chicago (khớp proxy)   webdriver: false   canvasNative: true
```

**browserscan — LOAD XONG HOÀN TOÀN, verdict thật đầy đủ (đọc từ ảnh clean-browserscan.png):**
- ✅ **fingerprint authenticity: 100%**
- ✅ **Bot Detection: No Detection**
- ✅ UA/platform/header nhất quán Firefox 152 + Windows 10
- ✅ **timezone khớp 3 chiều**: IP Time Zone = Location (Indiana/USA) = JS Time Zone = America/Chicago
- ✅ **WebRTC: disabled** (block_webrtc OK), STUN=0, IP Count 7d=0 → KHÔNG lộ IP thật
- ✅ **DNS Leak = 103.105.164.144** (đúng IP proxy, không lộ DNS máy)
- ✅ WebGL Intel HD (khớp Windows), Canvas native — authenticity vẫn 100%

**pixelscan — KHÔNG scan xong dù đợi 300s (đọc từ ảnh clean-pixelscan.png):** vẫn "scanning..." + Location/Proxy/Fingerprint panel "Collecting Data...". Phần đã load: UA Win32 nhất quán, WebGL Intel (không còn Apple M1). → **Nguyên nhân: pixelscan gọi "Check Geo API" bên thứ 3 qua proxy datacenter chậm/bị chặn → treo. Đây là hạn chế của việc ĐO qua proxy datacenter, KHÔNG phải hạn chế Camoufox.** Chưa lấy được verdict cuối pixelscan.

**iphey — không load được verdict** (widget "Your Digital Identity" trống, chỉ hiện landing). Cần điều tra riêng (có thể chặn Firefox headful qua proxy DC, hoặc cần tương tác).

**KẾT LUẬN 12c**: browserscan (bằng chứng LOAD XONG duy nhất) cho **100% authenticity + bot=No + WebRTC/DNS/timezone khớp proxy hoàn hảo** — vượt trội. Nhưng **CHƯA có verdict pixelscan/iphey hoàn chỉnh** vì proxy datacenter quá chậm cho Check-Geo-API của các site đó. Để chốt GO/NO-GO cần: (a) proxy residential nhanh, HOẶC (b) chấp nhận browserscan 100% + core fingerprint là đủ bằng chứng Camoufox thắng rebrowser+Apify (canvas native + WebRTC disabled + geo khớp — những thứ rebrowser KHÔNG làm được).

### 12d. XÁC NHẬN CUỐI + QUYẾT ĐỊNH GO (2026-07-21, user đọc ảnh browserscan tận mắt)

User tự xem cửa sổ Camoufox headful đang mở, chụp ảnh browserscan load XONG HẲN. Đọc trực tiếp từ ảnh (KHÔNG đoán):
- **fingerprint authenticity: 100%**
- **Bot Detection: No Detection**
- **Proxy: No** ← browserscan KHÔNG phát hiện đây là kết nối qua proxy (cực kỳ quan trọng cho X)
- Platform: Windows 10 · Browser: Firefox 152.0 · IP Time Zone: America/Chicago
- Location: 38°N 87°W (Indiana/USA) · language: en-US · Postal 47649 — khớp IP hoàn toàn
- **DNS Leak: 103.105.164.144** = đúng IP proxy, không lộ DNS máy thật

**pixelscan/iphey treo (không đỏ)**: nguyên nhân là (1) 2 site gọi geo-API bên thứ 3 qua proxy datacenter chậm → treo "Collecting Data"; (2) `block_webrtc:true` làm probe WebRTC của chúng chờ vô hạn. **Treo ≠ đỏ** — nếu fingerprint sai chúng đỏ NGAY (như bản rebrowser trước báo "Masking" tức thì). browserscan tự chấm tại chỗ nên chạy xong.

**BÀI HỌC (đã sửa)**: đừng đoán UI site test (CreepJS trust score KHÔNG ở góc trên — tôi đoán sai, user bắt lỗi). Soi element thật / đọc ảnh trước.

**⇒ QUYẾT ĐỊNH: GO.** Camoufox thắng rõ rebrowser+Apify ở 3 điểm cốt lõi (canvas native, WebRTC disabled, geo/proxy tự khớp → "Proxy: No"). Đủ bằng chứng để dựng app.

**HAI QUYẾT ĐỊNH KIẾN TRÚC (user duyệt 2026-07-21):**
1. **2 engine trong 1 app** (KHÔNG thay hẳn): giữ Chromium/rebrowser mặc định cho account cũ, thêm Camoufox làm tuỳ chọn per-account. An toàn — account cũ không gãy, account mới test Camoufox.
2. **Đóng gói: tải lần chạy đầu** (KHÔNG bundle): installer nhẹ như hiện tại; lần đầu tự tải Camoufox ~470MB + GeoIP 66MB về cache máy (`CAMOUFOX_INSTALL_DIR`), có thanh tiến trình.

---

## 13. PoC TÍCH HỢP NHỎ — 2 engine trong app thật (2026-07-21, nhánh feat/camoufox-poc)

**Mục tiêu**: mở được 1 account Camoufox TỪ TRONG app (npm run dev), lộ sớm rủi ro native module — TRƯỚC khi làm packaging.

**Rủi ro native đã ĐO & LOẠI (không đoán):**
- `camoufox-js@0.11.2` cài chung app: **better-sqlite3 VẪN 12.11.1** (không bị đổi version) → không conflict. App đã dùng better-sqlite3 build cho Electron 33 (ABI 130) OK → dùng chung được.
- `playwright-core` **pin cứng `1.53.1`** (bỏ `^`) trong package.json → tránh version drift (bản mới gửi field Juggler Camoufox không nhận).
- `maxmind@5.0.6` (geoip) = **pure-JS, KHÔNG native** → không lo ABI.
- Binary Camoufox + `GeoLite2-City.mmdb` đã có sẵn trong cache `~/AppData/Local/camoufox`.
- `npm run build` + `npm run typecheck`: **SẠCH** cả node + web + renderer. camoufox-js bundle vào main process không lỗi.

**Code đã thêm (kiến trúc 2 engine, KHÔNG đụng luồng Chromium cũ):**
| File | Thay đổi |
|------|----------|
| `src/shared/types.ts` | Thêm `type BrowserEngine = 'chromium' \| 'camoufox'` + `Account.engine` + `AccountInput.engine` |
| `src/main/db/index.ts` | Migration `addColumnIfMissing(accounts, engine, "TEXT NOT NULL DEFAULT 'chromium'")` — DB cũ tự nhận chromium |
| `src/main/db/accounts.ts` | Đọc/ghi cột engine + hàm `normalizeEngine()` (chỉ 'camoufox' hợp lệ, còn lại → chromium) |
| `src/main/browser/CamoufoxLauncher.ts` | **MỚI** — `launchCamoufox()`: Camoufox({os:windows, block_webrtc, geoip nếu có proxy, block_images nếu blockMedia, persistent_context}). Ép kiểu Browser→BrowserContext (cùng shape Playwright). |
| `src/main/browser/BrowserManager.ts` | `openProfile` RẼ theo `account.engine`: camoufox → launchCamoufox (bỏ CDP media block); chromium → NGUYÊN luồng patchright cũ |
| `src/renderer/views/AccountsView.tsx` | Dropdown chọn engine trong form account (mặc định Chromium) + hint Camoufox |

**Điểm rẽ engine DUY NHẤT = `BrowserManager.openProfile`** (mọi thứ đã đi qua browserManager). XActions/InteractSession chỉ dùng `type` Playwright → tương thích Firefox không cần sửa.

**LỖI RUNTIME ĐÃ GẶP & FIX (2026-07-21)**: chạy `npm run dev` → `ERR_REQUIRE_ESM: require() of ES Module camoufox-js/dist/index.js not supported`.
- **Nguyên nhân**: `camoufox-js` là **ESM-only**; app build ra **CommonJS** (out/main dùng `require`). `externalizeDepsPlugin()` giữ camoufox-js là external → bundle ra `require('camoufox-js')` → vỡ.
- **Bẫy phụ**: đổi sang `import()` động KHÔNG đủ — với `tsconfig module=CommonJS`, tsc HẠ CẤP `import()` thành `require()` → vẫn vỡ.
- **FIX**: dùng `const importESM = new Function('specifier','return import(specifier)')` để giữ nguyên `import()` runtime (tsc không đụng chuỗi trong Function) + cache module. Xác nhận bundle: không còn `require('camoufox-js')`, chỉ còn `importESM("camoufox-js")`.
- **BÀI HỌC packaging**: mọi ESM-only dep trong main process CommonJS phải load qua `importESM` helper này, KHÔNG import tĩnh.

**TÁCH PROFILE THEO ENGINE (2026-07-21, user duyệt)**: profile Chromium & Camoufox ĐỊNH DẠNG KHÁC NHAU (Chromium: Default/Network/Cookies SQLite mã hoá DPAPI; Firefox/Camoufox: cookies.sqlite + sessionstore) → KHÔNG lẫn được.
- `BrowserManager.openProfile`: `profileDir = engine==='camoufox' ? join(account.profileDir,'camoufox') : account.profileDir`. Chromium giữ thư mục gốc (không phá session cũ), Camoufox dùng thư mục con riêng.
- Đổi engine account đã có → **phải đăng nhập X lại** (session không chuyển Chromium↔Firefox). Đã thêm `confirm()` cảnh báo trong form trước khi lưu.
- **Binary tải KHÔNG qua proxy**: `pkgman.js` gọi `fetch()` trực tiếp từ mạng máy (không đi qua proxy account). Cache chung 1 máy tại `~/AppData/Local/camoufox` (INSTALL_DIR), tải ĐÚNG 1 LẦN — mọi account camoufox dùng chung binary, account sau KHÔNG tải lại. Đã sửa hint UI cho đúng.

**CÒN LẠI ĐỂ CHỐT PoC**: user chạy lại `npm run dev`, tạo/sửa 1 account engine=Camoufox, bấm Mở profile → xác nhận cửa sổ Firefox mở x.com được DƯỚI ELECTRON. Nếu OK → làm tiếp packaging + regression test action X trên Firefox.

### 13b. PoC dưới Electron PASS + hardening runtime (2026-07-21)

User đã mở account Camoufox thành công từ app. Các vấn đề runtime quan sát được và cách xử lý:
- **Vòng tròn đỏ + thao tác chậm**: do `humanize:true` (Camoufox hiển thị con trỏ mô phỏng và kéo dài mỗi lần di chuột tới ~1,5s). Đã tắt; Playwright vẫn click/type bình thường nhưng không có overlay đỏ và bớt độ trễ.
- **Cửa sổ 1280x720, không phủ màn hình**: launcher giờ lấy `screen.getPrimaryDisplay().workAreaSize` để sinh fingerprint/window theo vùng làm việc thật.
- **Ảnh bị chặn nhưng video vẫn phát**: `block_images` chỉ ảnh. Đã bổ sung route chặn `video.twimg.com` + HLS/DASH (`.m3u8/.ts/.m4s/.mpd/.mp4`), không chặn `blob:` preview hoặc `upload.twitter.com`.
- **Camoufox nặng/chậm hơn Chromium**: Camoufox mặc định tắt cache. Khi không bật chặn media, launcher giờ bật `enable_cache`; khi bật chặn media, Playwright route buộc tắt cache nên vẫn có đánh đổi hiệu năng để chặn video.
- **Race tải binary lần đầu trong camoufox-js**: `camoufoxPath()` gọi install fire-and-forget, có thể launch trước khi tải xong. Aviary giờ tải có `await`, stream file ~470MB ra temp (không giữ trong RAM), khóa dùng chung tránh nhiều account tải trùng, gửi % tiến trình về terminal UI, rồi mới launch. GeoIP cũng được chuẩn bị có await khi account dùng proxy.
- **Đóng gói Windows**: `npm run build:win` PASS; electron-builder rebuild `better-sqlite3` cho Electron; installer 112,5MB (không bundle binary Camoufox); `app.asar` có đủ `camoufox-js` + `playwright-core`; bản `win-unpacked` smoke test chạy được với user-data tạm.

**BUG AN TOÀN ACCOUNT QUAN TRỌNG ĐÃ SỬA**: `camoufox-js` mặc định sinh fingerprint + canvas/audio/font seed MỚI ở mỗi lần launch, kể cả cùng `user_data_dir`. Điều này làm X thấy account đổi thiết bị liên tục. Aviary giờ sinh identity Camoufox đúng 1 lần, lưu envelope versioned trong `accounts.fingerprint`, rồi tái dùng nguyên fingerprint và seed ở mọi lần mở sau.

**CÒN LẠI**: restart main process để test launcher mới trên profile thật; regression action X có kiểm soát (text, ảnh, nhiều ảnh, video, thread, đọc view, bình luận, xoá). Không tự chạy các action tạo/xoá dữ liệu thật khi chưa có account test/nội dung test được user cho phép.

### 13c. Kết quả tối ưu + regression thực tế (2026-07-22)

**Giao diện/runtime đã PASS trên account Camoufox thật:**
- Vòng tròn đỏ biến mất; dùng `humanize:0.25` để giữ quỹ đạo chuột nhẹ nhưng `showcursor:false`.
- Nút Back Firefox hoạt động lại nhờ luôn bật cache/session history.
- Video feed bị chặn thành công khi bật chặn media.
- Aviary không còn Not Responding trong lúc mở profile: Camoufox launch được tuần tự; IP proxy đã check được lấy từ DB thay vì gọi lại dịch vụ ngoài mỗi lần.
- Full-screen/dải đen đã sửa đúng gốc: Windows scale 125%, Playwright khóa viewport mặc định `1280x720` dù native window `1920x1020`. Thêm `viewport:null`, fingerprint screen/window theo physical pixel và native maximize. Số đo sau sửa: `inner 1536x760, outer 1920x1020, screen 1920x1080, DPR 1.25`; dải đen hết.

**Bảo vệ khi chạy nhiều profile:**
- Một Camoufox quan sát được khoảng 10 process và ~1,07GB working set trong lần đo trước tối ưu.
- Launcher chỉ khởi tạo 1 Camoufox tại một thời điểm để tránh burst CPU/RAM.
- Tối đa 3 Camoufox mở đồng thời và từ chối mở thêm nếu RAM trống <1,25GB. Thông báo nêu rõ số profile + RAM trống thay vì để Windows pagefile làm treo app.
- Máy test 15,9GB RAM nhưng có lúc chỉ còn 1,6–3,4GB trống khi chưa mở Camoufox: thực tế chỉ nên chạy 1–2 Camoufox đồng thời trên máy này. 3 cần đóng app khác; 5 không khuyến nghị.

**Fingerprint ổn định:** envelope nâng lên version 3, lưu fingerprint BrowserForge + canvas/audio/font seed + physical screen/window trong `accounts.fingerprint`. Cùng account tái dùng nguyên identity; chỉ sinh lại khi schema đổi hoặc màn hình vật lý đổi.

**Regression action X:**
- Pipeline đăng đi qua mở profile, composer/upload/submit bình thường tới bước X xử lý request.
- X từ chối submit với cảnh báo `This request looks like it might be automated...`; đây là anti-spam server-side, có thể liên quan trust account/proxy/hành vi, không phải selector lỗi. Đã dừng thử lại để tránh tăng rủi ro lock.
- Vì không tạo được bài test, chưa chạy tiếp comment/xóa bài test. Không đánh dấu text/ảnh/video/thread/comment/delete là PASS cho tới khi test bằng account/proxy có trust phù hợp.

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
