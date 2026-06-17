# Changelog

Mọi thay đổi đáng chú ý của Aviary được ghi tại đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/),
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added
- Scaffold Electron + React + Vite (TypeScript) chạy được: main process tạo BrowserWindow, preload expose IPC `getAppInfo` qua `contextBridge`, renderer dashboard có sidebar 5 mục (Tài khoản / Lịch đăng / Nội dung / Nhật ký / Cài đặt).
- `electron.vite.config.ts`, `tsconfig.json` (+ `tsconfig.node.json` cho main/preload, `tsconfig.web.json` cho renderer).
- Style cơ bản theme tối, alias `@shared/*`.
- Khởi tạo dự án: cấu trúc thư mục, tài liệu roadmap và kiến trúc.
- `docs/ROADMAP.md`: lộ trình 6 giai đoạn (MVP đăng bài → vận hành nhiều account → chăm sóc/nuôi account → nội dung → phân tích → bền vững).
- `docs/ARCHITECTURE.md`: kiến trúc kỹ thuật (Electron + React + Playwright/Patchright + SQLite), luồng đăng bài, mô hình tiến trình.

## [0.0.1] - 2026-06-17

### Added
- Tạo repository và khung dự án Aviary.
