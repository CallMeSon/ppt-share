# Pindahkan setting Output dan Network dari tab kanan ke chip top bar

Tanggal: 2026-11-19. Disetujui user. Mockup acuan (visual source of truth untuk tugas ini): https://claude.ai/artifact/9So2PunaYzEyuuVR6yjfQx (file lokal: `C:\Users\DOH\AppData\Local\Temp\claude\3f57d4daf375683f\d31feab7-bd97-49cf-9bbd-13cecac0e630\scratchpad\topbar-output.html`, bisa hilang; kalau tidak ada, ikuti deskripsi di bawah).

Baca dulu `PRODUCT.md`, `DESIGN.md`, `CLAUDE.md`. UI task: load skill `impeccable`, ikuti `DESIGN.md`. Jangan ubah palet dark. Jangan menambah radius atau tinggi kontrol baru (radius 3/4/6, tinggi 32/40/52).

## Tujuan

Tab **Output** di panel kanan dihapus. Semua settingnya pindah ke popover yang terbuka dari chip status di header (`OutputMenu.tsx`), supaya status dan kontrol ada di satu tempat dan panel kanan tidak penuh. Panel kanan tinggal tab **Controls** dan **Info**.

## Perilaku yang diminta

Header menampilkan lima chip, tiap chip adalah tombol yang membuka popover di bawah header (rata kanan chip, lebar 372px, `--pop-shadow`, radius 6, menutupi bukan Program tapi area di bawah header):

| Chip | Isi popover | Komponen yang dipakai ulang |
| --- | --- | --- |
| HDMI (`HDMI off/live/hidden/error`) | switch HDMI, pesan status, Target display | `HdmiSection` |
| OMT | switch, status + warning, Source name, Source (copy), kotak "Shared by OMT and NDI" | `OmtSection` + `NetworkSection` |
| NDI | switch, status + warning, Source name, kotak "Shared by OMT and NDI" | `NdiSection` + `NetworkSection` |
| Sound (ikon speaker, label tersembunyi untuk screen reader, ikon silang saat muted) | Audio device, Sound to, Master volume, Mute all | `AudioSection` |
| Ukuran canvas (mis. `1920×1080`, mono) | daftar preset, Match HDMI display, Custom size, hint konfirmasi | `CanvasSetting` dari `CanvasPicker.tsx` |

Aturan:

- Satu popover terbuka sekali waktu. Klik chip yang sama menutup. Klik di luar atau Esc menutup, fokus kembali ke chip yang membukanya. Gunakan pola menu/popover yang sudah ada di repo (cari komponen menu yang sudah ada di Header atau Decks panel) daripada menulis ulang; `aria-haspopup="dialog"` dan `aria-expanded` di chip.
- Popover ditandai `data-no-shortcuts` supaya Space, F, B, K, N tidak mengganggu Program saat mengetik di field (cek bagaimana `NetworkSection` dan dialog lain melakukannya).
- Semua perubahan tetap berlaku langsung seperti sekarang. Konfirmasi ganti canvas (`needsCanvasConfirm`), konfirmasi ganti frame rate saat ada receiver (`NETWORK_CHANGE_CONFIRM`), dan error inline tetap, logika di section tidak diubah.
- Chip menyala dengan warna tone yang sudah ada (`data-tone` ok/warn/error/off, aksen untuk ok). Ikon dan kata tetap membawa status (aturan "state tidak hanya warna").
- Frame rate dan "Send content only" dipakai bersama OMT dan NDI. Tampilkan di kedua popover dalam satu kotak berlabel "Shared by OMT and NDI". Nilainya sama di keduanya (state dari `useOutputSettings`, jangan duplikasi state). Karena `NetworkSection` sekarang memiliki judul "Network" sendiri, beri prop agar judul bisa diganti atau disembunyikan.
- Hapus teks "(default)" di chip ukuran canvas (hanya `1920×1080`). Label display target (`{target.label}, {w}x{h}`) tidak lagi ditampilkan di header kecuali ada ruang; boleh pindah ke dalam popover HDMI.
- Responsif: di bawah 1600px chip OMT/NDI memakai teks pendek (`ind-short`) seperti sekarang. Di window sempit chip tidak boleh membuat header meluap; chip Sound dan canvas sudah ikon/mono ringkas. Popover tidak boleh keluar dari window (clamp posisi kiri).
- Sound chip: tombol sound di transport bar tetap ada dan tetap mengatur mute yang sama (state `audio.muted`).

## Perubahan kode

1. `src/renderer/src/components/OutputMenu.tsx`: ubah dari satu tombol `output-btn` jadi lima chip + popover. Prop `onOpen` dihapus; terima yang diperlukan dari `Header.tsx`: `out` (OutputSettingsState), `program`. Buat komponen kecil per popover agar tidak bengkak.
2. `src/renderer/src/components/Header.tsx`: hapus prop `onOpenOutput`, teruskan prop baru.
3. `src/renderer/src/App.tsx`: hapus `showOutput`, `choosePanelTab('output')`, import dan render `OutputStatus` (sekitar baris 24, 160-170, 1157, 1365), hapus pengiriman `isOpen`/`onToggle` yang hanya dipakai Output.
4. `src/renderer/src/components/OutputStatus.tsx`: hapus file (pindahkan wrapper "Canvas" section ke popover canvas).
5. `src/renderer/src/components/NextPanel.tsx`: hapus tab `output` dari `TABS` dan panel `tab === 'output'` (sekitar baris 16-18, 312).
6. `src/renderer/src/panel-sections.ts`: `PanelTab` jadi `'controls' | 'info'`; `SectionId` buang `'output'` dan `'network'`; `DEFAULT_OPEN` dan `IDS` ikut. `loadPanelTab` harus memetakan nilai tersimpan lama `'output'` ke `'controls'` (user yang sudah punya localStorage lama). Sections tersimpan lama dengan id `output`/`network` harus diabaikan tanpa error. Update `panel-sections.test.ts` (loop tab, tambah test migrasi `'output'` -> `'controls'`).
7. `src/renderer/src/styles/app.css` (sekitar baris 341-370): ganti `.output-btn` dengan gaya chip (32 tinggi, padding 0 10, radius 4, hover Raised, expanded Raised High + border Line High, tone ok = aksen ink) dan gaya popover. Pakai variabel dari `tokens.css`, tidak ada warna literal. Gaya `.pop-section`/`.pop-head`/`.pop-status`/`.canvas-confirm` yang sudah ada dipakai ulang; sesuaikan padding bila perlu agar rapat 16px.
8. Pertahankan `data-testid` yang berguna: `hdmi-status`, `omt-status`, `ndi-status`, `canvas-badge`. Chip HDMI/OMT/NDI/canvas tiap-tiapnya tombol dengan testid baru: `output-chip-hdmi`, `output-chip-omt`, `output-chip-ndi`, `output-chip-sound`, `output-chip-canvas`. Popover: `output-popover`. `output-status` (lama, satu tombol) dihapus.

## Dokumen yang ikut diperbarui

- `DESIGN.md`: bagian Layout ("Header bar" tambah chip output dengan popover; "Right panel" jadi tab Controls dan Info saja, hapus kalimat tentang tab Output, section Output/Network, dan ringkasan nilai "HDMI off · 1920×1080"); "Component sizes" tambah baris Output chip + popover; tabel Underlined tab ("Controls, Output, Info" -> "Controls, Info"). Catat tanggal 2026-11-19 dan bahwa `Bridgecast.pen` belum dicerminkan.
- `PRODUCT.md`: baris "Panel and label names" dan "UI redesign" yang menyebut tab Output/Network di panel kanan; kalimat Canvas "output popover, Canvas section".
- `CLAUDE.md`: tidak ada yang menyebut tab Output secara spesifik, cek ulang saja.
- Komentar kode yang menyebut "Output tab" / "output popover" / "Controls tab" (`OutputMenu`, `HdmiSection`, `AudioSection`, `NetworkSection`, `OmtSection`, `NdiSection`, `useOutputSettings`) disesuaikan.

## E2E yang perlu disesuaikan

- `e2e/smoke.mjs` (~17 referensi): `output-panel` (sekitar baris 698), `output-status` (1138, 1382, 3289), dan langkah yang membuka tab Output lalu section Output/Network. Ganti: klik chip yang relevan (`output-chip-*`), kerjakan di dalam `output-popover`, Esc untuk menutup. Switch HDMI/OMT/NDI, `network-fps`, `audio-master`, dan input source name punya testid yang tidak berubah.
- `e2e/settings.mjs` (~3 referensi, `output-panel` baris 34): sama.
- `e2e/layout.mjs`: cek apakah ada asersi lebar header atau tab panel kanan (tiga tab -> dua).
- Screenshot header di smoke (baris ~1382) sekarang mencakup lima chip; pastikan tidak meluap di lebar window minimum 1024px (cek juga 1180px dan 1600px).

## Verifikasi (wajib sebelum lapor selesai)

```bash
npm run typecheck
npm test
npm run lint        # tidak boleh menambah error di atas 8 yang sudah ada
npm run test:e2e
npm run test:e2e:settings
npm run test:e2e:layout
npm run test:e2e:network
npm run test:e2e:new-event
```

Di Linux headless: `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e`. Cek manual dengan `npm run dev` pada window 1024px, 1180px, dan 1600px+, tema Light dan Dark: popover tidak keluar window, fokus keyboard bisa Tab ke chip, Enter membuka, Esc menutup dan fokus kembali, tidak ada tombol shortcut Program yang tertangkap saat mengetik Source name.

## Di luar lingkup

- Jangan ubah logika main process, IPC, atau reducer.
- Jangan ubah palet dark, radius, atau skala tinggi.
- `Bridgecast.pen` tidak diubah di tugas ini.
- Jangan commit file `.superpowers/`. Commit pakai identitas dari `CLAUDE.md` bila diminta. Stage hanya file sendiri.

## Panduan eksekusi

Model `sonnet`, effort `medium`. Eskalasi ke `opus` bila macet atau review gagal. Jika satu tugas gagal lebih dari 3 kali, berhenti dan laporkan tugas, file, perintah, dan errornya.
