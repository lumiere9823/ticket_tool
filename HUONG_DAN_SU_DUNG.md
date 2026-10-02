# 📖 HƯỚNG DẪN SỬ DỤNG TICKETBOX PURCHASE ASSISTANT

Chào bạn! Đây là tài liệu hướng dẫn chi tiết từng bước sử dụng **Ticketbox Purchase Assistant** — công cụ hỗ trợ săn vé tự động, bảo vệ an toàn danh mục vé, chống mua nhầm hạng vé ngoài ý muốn và tự động kích hoạt đúng giờ mở bán.

---

## 📑 MỤC LỤC

1. [Cài đặt Extension lên trình duyệt](#1-cài-đặt-extension-lên-trình-duyệt)
2. [Tổng quan 2 Chế Độ Sử Dụng](#2-tổng-quan-2-chế-độ-sử-dụng)
3. [Hướng dẫn Chế độ Cơ bản (⚡ Khuyên dùng - Cực dễ)](#3-hướng-dẫn-chế-độ-cơ-bản--khuyên-dùng)
4. [Hướng dẫn Chế độ Chuyên sâu (🎯 Hardcore / Scoped Matrix)](#4-hướng-dẫn-chế-độ-chuyên-sâu--hardcore--scoped-matrix)
5. [Tính năng Hẹn Giờ Mở Bán (Scheduled ARM) & Cơ chế Đánh thức](#5-tính-năng-hẹn-giờ-mở-bán-scheduled-arm)
6. [Các lưu ý "sống còn" khi săn vé Ticketbox](#6-các-lưu-ý-sống-còn-khi-săn-vé-ticketbox)
7. [Giải đáp thắc mắc thường gặp (FAQ)](#7-giải-đáp-thắc-mắc-thường-gặp-faq)
8. [Xử lý sự cố](#8-xử-lý-sự-cố)

---

## 1. Cài đặt Extension lên trình duyệt

Nếu bạn vừa tải mã nguồn hoặc vừa build xong:

1. Mở trình duyệt Google Chrome (hoặc Edge, Brave, Cốc Cốc).
2. Truy cập đường dẫn: `chrome://extensions/`
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
5. Chọn thư mục `dist` trong thư mục dự án (`d:\ticket_tool\dist`).
6. Ghim (Pin) biểu tượng extension lên thanh công cụ trình duyệt để tiện sử dụng.

---

## 2. Tổng quan 2 Chế Độ Sử Dụng

Giao diện popup hiện nay được chia thành **2 chế độ riêng biệt**, bạn có thể bấm chuyển đổi ngay thanh tab trên cùng:

| Tiêu chí              | ⚡ Chế độ Cơ bản (Basic)                                        | 🎯 Chế độ Chuyên sâu (Hardcore)                                        |
| :-------------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **Đối tượng**         | Người dùng thông thường, muốn săn vé nhanh, dễ hiểu             | Săn vé show lớn, nhiều ngày, cần chiến thuật dự phòng chặt chẽ         |
| **Cách chọn vé**      | Tick chọn trực tiếp vào danh sách vé hiển thị giá tiền          | Bảng ma trận Suất diễn × Hạng vé (Scoped Matrix)                       |
| **Chiến lược**        | Ưu tiên từ trên xuống dưới theo danh sách vé đã chọn            | Tùy biến: Theo Rank mục tiêu, Ưu tiên suất diễn, hay Ưu tiên hạng vé   |
| **Thông số kiên trì** | Tự động áp dụng mặc định (Poll 2s, trần 120 phút, 1000 lần thử) | Cho phép tự chỉnh trần phút, trần số lần thử, khoảng cách poll, Jitter |
| **Thao tác ARM**      | 1 Click duy nhất là chạy ngay                                   | Yêu cầu tick hộp kiểm duyệt an toàn (Scope Confirmation)               |

---

## 3. Hướng dẫn Chế độ Cơ bản (⚡ Khuyên dùng)

> **Ví dụ thực tế:** Bạn muốn săn 2 vé cho concert _"Sao Concert Trăm Sao"_ (hoặc _"Anh Trai Vượt Ngàn Chông Gai"_). Bạn chỉ muốn mua hạng **VIP 1** hoặc **VIP 2**, nếu hết cả 2 thì không mua các vé khác. Vé mở bán lúc **14:00**.

### Bước 1: Mở trang sự kiện trên Ticketbox

1. Mở Chrome, đăng nhập tài khoản Ticketbox của bạn trước.
2. Mở tab trang sự kiện bạn muốn mua vé (Ví dụ: `https://ticketbox.vn/event/...`).

### Bước 2: Mở Extension & Quét thông tin vé

1. Bấm vào biểu tượng **Ticketbox Assistant** trên thanh công cụ.
2. URL trang sự kiện sẽ tự động được nhận diện.
3. Bấm nút **↺ (Làm mới catalog)**.
   - Biểu tượng trạng thái sẽ chuyển thành `✓` màu xanh và hiển thị tên sự kiện cùng số lượng vé đã tìm thấy.

### Bước 3: Cấu hình nhanh chỉ với 3 mục

1. **1. CHỌN HẠNG VÉ MUỐN MUA:**
   - Bạn sẽ thấy danh sách toàn bộ các hạng vé kèm giá tiền rõ ràng:
     - `[✓] VIP 1 — 2.500.000 đ [Còn vé]`
     - `[✓] VIP 2 — 2.000.000 đ [Còn vé]`
     - `[ ] GA Đứng Khu A — 1.200.000 đ [Còn vé]`
     - `[ ] GA Đứng Khu B — 800.000 đ [Còn vé]`
   - **Chỉ cần tick chọn các vé bạn đồng ý mua** (Ví dụ tick VIP 1 và VIP 2). _Trợ lý sẽ tự động ưu tiên vé ở trên trước, nếu hết vé trên mới thử vé dưới._
2. **2. SỐ LƯỢNG & GIỜ MỞ BÁN:**
   - **Số lượng vé:** Nhập số vé bạn muốn (Ví dụ: `2`).
   - **⏰ Giờ mở bán:**
     - **Nếu vé đã mở bán rồi:** Để trống ô này.
     - **Nếu chưa mở bán (ví dụ mở lúc 14:00):** Bấm chọn ngày và giờ mở bán là `14:00`.
3. **3. THÔNG TIN NGƯỜI NHẬN (PROFILE):**
   - Điền Họ tên, Số điện thoại, Email, Số CCCD. Extension sẽ tự động ghi nhớ cho các lần sau.
   - **Bắt buộc tick ô "Đồng ý điều khoản & BTC sử dụng thông tin".** Nếu sự kiện có bảng câu hỏi (question form) yêu cầu đồng ý điều khoản mà ô này chưa tick, trợ lý sẽ **tự động dừng lại** ở trạng thái `CONSENT_REQUIRED` và chờ bạn tick thủ công — đây là hành vi an toàn có chủ đích, không phải lỗi.

### Bước 4: Bấm nút ARM và an tâm chờ đợi

- Bấm nút to màu xanh lá: **🚀 BẮT ĐẦU SĂN VÉ (ARM)**.
- **Nếu bạn chọn săn ngay:** Trợ lý sẽ bắt đầu theo dõi và đặt vé ngay lập tức!
- **Nếu bạn hẹn giờ:** Popup sẽ hiện thông báo _"Đã đặt lịch hẹn ARM thành công!"_. Trạng thái chuyển sang `SCHEDULED`. Bạn có thể yên tâm làm việc khác!

---

## 4. Hướng dẫn Chế độ Chuyên sâu (🎯 Hardcore / Scoped Matrix)

Chế độ này dành cho các đợt mở bán cực kỳ gay cấn, có nhiều suất diễn (Nhiều ngày thứ 7, Chủ nhật), và bạn muốn lập chiến lược dự phòng nhiều lớp.

### 1. Bảng ma trận Scoped Matrix:

- Hàng ngang là các Suất diễn (Showing).
- Bạn có thể đặt thứ tự ưu tiên (**Rank 1, Rank 2,...**):
  - **Rank 1:** Suất diễn ngày 1 (Thứ 7) — Tick chọn [VIP 1, VIP 2].
  - **Rank 2:** Suất diễn ngày 2 (Chủ nhật) — Tick chọn [VIP 1, VIP 2, GA 1].
- **Chiến lược ưu tiên (Strategy):**
  - `BY_TARGET_ORDER`: Theo thứ tự Rank bạn xếp (Rank 1 trước, không có mới sang Rank 2).
  - `SHOWING_FIRST`: Cố gắng mua bằng được trong cùng 1 ngày trước khi đổi ngày khác.
  - `TIER_FIRST`: Cố gắng tìm hạng vé VIP trên mọi ngày trước khi hạ tiêu chuẩn xuống GA.

### 2. Thông số kiên trì (Persistence Policy):

- **Trần thời gian (phút):** Mặc định 120 phút, trần cứng 240 phút. Giá trị `0` hoặc để trống sẽ **không** phải là vô hạn — hệ thống tự động dùng lại mặc định 120 phút (Rule 07: không tự động hoá vô hạn).
- **Trần số lần thử:** Mặc định 1000 lần thử, trần cứng 5000 lần. Giá trị `0` hoặc để trống cũng rơi về mặc định 1000, không phải vô hạn.
- **Giãn cách poll (ms):** Mặc định `2000ms` (2 giây mỗi lần quét, sàn tối thiểu bắt buộc `1500ms` để vừa bắt kịp vé nhả vừa không bị Cloudflare / Ticketbox chặn IP).
- **Tỷ lệ Jitter:** Dao động ngẫu nhiên ±20% để mô phỏng hành vi tự nhiên của con người.

### 3. Scope Confirmation Box:

- Hiển thị danh sách tóm tắt: _"Sẽ chỉ mua những vé này... Sẽ KHÔNG mua bất kỳ vé nào khác"_.
- Tick vào ô _"Tôi xác nhận chỉ mua các vé trong phạm vi trên"_ rồi bấm **ARM ASSISTANT**.

---

## 5. Tính năng Hẹn Giờ Mở Bán (Scheduled ARM)

Ticketbox Assistant được trang bị cơ chế hẹn giờ thông minh qua **Chrome Alarms API** kết hợp **Background Timer**:

### Cơ chế hoạt động:

1. **Trước giờ mở bán:** Bạn cấu hình xong, chọn giờ mở bán và bấm ARM. Trợ lý vào chế độ `SCHEDULED` và không gửi request liên tục làm nóng máy hay lộ bot.
2. **Đến đúng giờ mở bán:**
   - Service worker của extension tự động kích hoạt.
   - **Tự động đưa tab Ticketbox lên Foreground:** Cửa sổ và tab Ticketbox sẽ tự động được Focus và chuyển lên màn hình chính của bạn.
   - **Gỡ bỏ Browser Timer Throttling:** Nhờ tab được đưa lên Foreground, Chrome sẽ gỡ bỏ hạn chế timer nền, cho phép tốc độ quét vé đạt độ chính xác từng mili-giây!
   - **Nếu bạn vô tình tắt tab:** Extension sẽ tự động mở lại tab sự kiện và bắt đầu quét ngay lập tức.
   - Đẩy thông báo chuông máy tính: `🔔 Ticketbox Assistant — ĐÃ ĐẾN GIỜ MỞ BÁN!`.

---

## 6. Các lưu ý "sống còn" khi săn vé Ticketbox

1. **Đăng nhập trước tài khoản Ticketbox:**
   - Luôn đăng nhập tài khoản Ticketbox trên trình duyệt trước giờ mở bán ít nhất 15 phút.
2. **Chuẩn bị trước giờ mở bán (Pre-warm & Đồng bộ giờ Server):**
   - Trước giờ mở bán $T_0$, trợ lý tự động đồng bộ giờ với máy chủ Ticketbox qua header `Date` để triệt tiêu lệch đồng hồ máy tính cá nhân.
   - Trợ lý thực hiện bước nạp trước dữ liệu đọc (Pre-warm) gồm thông tin suất diễn, danh mục vé và form câu hỏi mà hoàn toàn không can thiệp DOM hoặc gửi request trái phép.
   - Kiểm tra bảng sẵn sàng trên popup: đồng hồ đã đồng bộ, tab đang ở mặt trước (foreground), thông tin người nhận đã điền đầy đủ và đã tick đồng ý điều khoản.
3. **Khi vào hàng chờ (Waiting Room): TUYỆT ĐỐI ĐỪNG TẢI LẠI TRANG:**
   - Với các concert quy mô lớn, Ticketbox có thể kích hoạt phòng chờ ảo (Waiting Room / Queue-it).
   - Khi phát hiện đang ở hàng chờ, trợ lý sẽ chuyển sang trạng thái `IN_QUEUE` (hiển thị nhãn màu cam `QUEU` trên extension icon và cảnh báo trong popup).
   - **Cơ chế an toàn tự động:** Trợ lý sẽ TỰ ĐỘNG DỪNG mọi hành động click, đồng thời CHẶN toàn bộ các cơ chế tự tải lại trang (chống zoom-thrash và chống 404 lạc trang).
   - **Hành động của bạn:** Hãy giữ nguyên tab, TUYỆT ĐỐI KHÔNG bấm F5 / Reload trang, không mở thêm tab mới tranh hàng chờ. Khi hệ thống duyệt bạn vào trang chọn vé, trợ lý sẽ tự động tiếp tục chu trình săn vé an toàn.
4. **Không để máy tính Sleep / Gập màn hình:**
   - Trình duyệt cần máy tính đang hoạt động (không ở chế độ Sleep sâu) để chuông hẹn giờ và vòng lặp chính xác (Precision Timer) kích hoạt mốc $T_0$.
5. **Bước thanh toán (Payment Gateway) an toàn:**
   - Để bảo vệ tài khoản ngân hàng của bạn, Ticketbox Assistant sẽ tự động chọn vé, điền thông tin người mua, vượt qua các bước chọn khu vực/ghế và **dừng lại ở màn hình Thanh toán / Nhập OTP**.
   - Chuông thông báo sẽ reo lên để bạn chọn phương thức thanh toán (MoMo, Thẻ tín dụng, VietQR) và nhập OTP an toàn.
6. **Nút 🗑 RESET CONFIG:**
   - Khi bạn muốn chuyển sang săn một sự kiện khác, hãy bấm nút **RESET CONFIG** để xóa cấu hình cũ và bắt đầu cấu hình mới hoàn toàn tinh tươm.

---

## 7. Giải đáp thắc mắc thường gặp (FAQ)

**H: Tôi thấy cảnh báo `Tab hidden: Browser background timer throttling may affect polling interval` là gì?**

> **Đ:** Đây là tính năng tiết kiệm pin mặc định của trình duyệt Chrome khi một tab bị ẩn dưới nền. Khi đến giờ mở bán, Ticketbox Assistant sẽ **tự động kích hoạt tab lên mặt trước (Foreground)** nên bạn hoàn toàn yên tâm. Tuy nhiên, trong lúc săn vé trực tiếp, tốt nhất bạn nên giữ tab Ticketbox hiển thị trên màn hình.

**H: Nếu vé vừa mở bán mà đã hết sạch thì sao?**

> **Đ:** Assistant sẽ liên tục kiên trì thăm dò (Polling) theo chu kỳ an toàn. Rất nhiều người giữ vé nhưng sau 10 - 15 phút không thanh toán hoặc hủy đơn, vé sẽ được nhả lại vào hệ thống. Assistant sẽ tóm ngay cơ hội này để giữ vé cho bạn!

**H: Làm sao để hủy lịch hẹn ARM nếu tôi đổi ý?**

> **Đ:** Trong popup, bạn chỉ cần bấm nút **✕ Hủy hẹn** màu đỏ bên cạnh dòng thông báo lịch hẹn, hoặc bấm nút **🛑 DỪNG LẠI (STOP)**.

---

_Chúc bạn săn được những tấm vé ưng ý với Ticketbox Purchase Assistant!_

### CAPTCHA, OTP hoặc yêu cầu đăng nhập lại

- Khi phát hiện CAPTCHA/Turnstile/reCAPTCHA/hCaptcha, OTP hoặc phiên đăng nhập hết hạn, trợ lý chuyển sang trạng thái can thiệp thủ công và dừng hành trình tự động.
- Hãy giải thử thách trực tiếp trên tab Ticketbox, đăng nhập lại nếu được yêu cầu, rồi bấm **Tiếp tục sau khi xác thực** trong banner popup.
- Extension không tự giải CAPTCHA, không tự nhập OTP và không lưu các giá trị này.

### Rate limit hoặc hàng chờ

- Khi gặp tín hiệu rate limit, trợ lý dừng an toàn hoặc chuyển sang trạng thái chờ theo state machine; không cố tăng tốc hoặc gửi request dồn dập.
- Hàng chờ/waiting room không được bypass. Hãy để trang Ticketbox xử lý theo quy trình bình thường và chỉ tiếp tục khi giao diện đã sẵn sàng.

### Trang 404 hoặc tab bị chuyển sai trang

- Khi đang theo dõi mà tab rơi vào trang 404, trang chủ hoặc một event khác, content script có cơ chế nhận diện và thử quay về `targetEventUrl` với thời gian cooldown.
- Nếu không tự khôi phục, mở lại đúng trang event, kiểm tra URL trong popup và bấm **Làm mới catalog**.

### Hết vé, không thấy catalog hoặc tab bị ẩn

- Discovery là thụ động và chỉ hiển thị dữ liệu quan sát được. Nếu catalog trống, mở đúng trang event rồi bấm **Làm mới catalog**; không nhập endpoint hoặc selector thủ công.
- Cảnh báo `Tab hidden` nghĩa là Chrome có thể giảm độ chính xác timer nền. Giữ tab Ticketbox ở foreground trong thời gian săn vé.
- Polling luôn có sàn an toàn `1500ms` và có giới hạn thời gian/số lần thử; giá trị `0` cho hai giới hạn này không biến hành trình thành vô hạn.

### Đã tới bước thanh toán

- Khi tới `/payment`, `/checkout` hoặc trạng thái `PAYMENT_GATE`, trợ lý dừng để bạn tự chọn phương thức thanh toán và nhập OTP/3DS nếu cần.
- Không coi việc chuyển URL, banner hoặc nút đã bấm là bằng chứng thanh toán thành công. Chỉ state có receipt/confirmation từ server mới là xác nhận cuối cùng.

---
