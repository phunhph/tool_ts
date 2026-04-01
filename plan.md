# Plan: Phase mới - "Đánh giá năng lực" (Assessment case)

Phiên bản: 0.1
Ngày: 2026-03-26
Người tạo: (tạm)

## Mục tiêu
- Thêm một "case"/phase mới vào hệ thống hiện tại để thu thập thông tin người dùng (câu hỏi yes/no, mức độ) và đưa ra gợi ý ngành học bằng cách sử dụng hybrid AI (kết hợp model LLM + rules). 
- Kết quả: bảng thống kê đánh giá, biểu đồ (visualization) và phần "nguyên nhân"/giải thích vì sao AI gợi ý những ngành đó.

## Phạm vi
- Không tạo project mới — đây là một phase mới trong codebase hiện tại.
- UI: `public/create.html` sẽ được mở rộng bằng 1 checkbox "Đánh giá năng lực" và các trường câu hỏi phù hợp.
- Backend: thêm collection/table riêng (ví dụ `assessments`), API endpoints riêng để tạo và truy vấn assessments.
 - Backend: thêm collection/table riêng (ví dụ `assessments`). IMPORTANT: tạo assessment sẽ là một "ops" bổ sung chạy trong cùng flow tạo đề (ví dụ trong handler `POST /api/upload`) — tức là khi giáo viên upload/tao đề, nếu bật checkbox đánh giá thì server sẽ tạo thêm một bản ghi trong collection `assessments` liên kết với quiz/ case vừa tạo. Có thể vẫn thêm các endpoint admin riêng để truy vấn/thống kê.
- AI: viết service gọi hybrid AI (prompt template + local rules), lưu prompt/response để audit.

## Yêu cầu chức năng (high-level)
1. UI: người dùng có thể bật "Đánh giá năng lực" khi tạo quiz/case.
2. Form chứa một số câu hỏi: yes/no, thang mức độ (1-5) — có thể mặc định tập câu hỏi.
3. Khi submit và checkbox được chọn, frontend gửi dữ liệu đánh giá kèm theo request tạo đề (ví dụ thêm field `assessmentEnabled` và `assessmentAnswers` trong FormData gửi tới `POST /api/upload`). Server xử lý upload như trước và thêm 1 bước: tạo document `assessments` dựa trên payload, gọi Hybrid AI, lưu kết quả liên kết với quiz vừa tạo.
4. Server lưu assessment vào collection `assessments`, gọi Hybrid AI service để nhận gợi ý ngành học kèm lý do.
5. Kết quả trả về để frontend hiển thị bảng + biểu đồ; admin/owner có thể xem thống kê tổng hợp.

## Data model (MongoDB / tương tự)
- Collection: `assessments`
  - _id: ObjectId
  - userId: optional (nếu có đăng nhập)
  - caseId: optional (liên quan đến quiz)
  - enabled: boolean (checkbox trạng thái)
  - answers: object (key -> value, e.g. { q1: true, q2: 4, q3: false })
  - skillScores: object (tính từ answers) - các điểm năng lực định danh để vẽ biểu đồ
  - suggestedMajors: [
      { major: string, score: number (0-100), reasons: [string], matchedSkills: [string] }
    ]
  - promptSnapshot: string (prompt đã gửi cho AI, để audit)
  - aiRawResponse: object (response JSON/text từ AI, có thể lưu tóm tắt)
  - createdAt, updatedAt

- Collection: `assessment_results` (kết quả AI, phục vụ cho thống kê/visualization)
  - _id: ObjectId
  - assessmentId: ObjectId (ref -> assessments)
  - quizId: string (ref -> quizzes)
  - suggestedMajors: [{ major: string, score: number, reasons: [string], matchedSkills: [string] }]
  - explanationSummary: string
  - modelName: string
  - modelParams: object
  - aiRawResponse: object
  - createdAt, updatedAt

## Excel template / file structure (quan trọng)
Vì quy trình tạo đề trong hệ thống dựa trên upload file Excel, cần có một spec rõ ràng để giáo viên chuẩn bị file đúng định dạng. Dưới đây là tài liệu chi tiết có thể dán vào README hoặc gửi cho giáo viên.

1) Tóm tắt yêu cầu chung
- Chấp nhận: .xlsx, .xls (first sheet used per bank upload) hoặc nhiều file/ nhiều sheets (mỗi bank 1 sheet).
- Mỗi sheet đại diện cho một "bank" (nhóm câu hỏi). Nếu upload nhiều file, mỗi file tương đương một bank.
- File có thể chứa hai phần: phần câu hỏi quiz (bắt buộc) và (tuỳ chọn) sheet tên `assessment` cho bộ câu hỏi thu thập thông tin/đánh giá năng lực (theo spec `assessment` đã mô tả).
- Tên sheet mặc định cho quiz: bất kỳ tên; parser sẽ đọc sheet đầu tiên nếu không chỉ định.

2) Bắt buộc cho quiz (columns required)
Sử dụng các tiêu đề sau (case-insensitive; hỗ trợ tiếng Việt/EN):
- Question ("Câu hỏi" / "Question") — TEXT — bắt buộc: nội dung câu hỏi.
- Correct Answer ("Phương án đúng" / "Correct Answer" / "Đáp án đúng") — TEXT — bắt buộc: giá trị chính xác cho so sánh (dùng exact match on trimmed string).

3) Tùy chọn khuyến nghị (columns để parser đọc thêm metadata)
- Option 1, Option 2, Option 3, Option 4 ("Đáp án 1", "Đáp án 2", ...) — TEXT — option text (nếu thiếu option sẽ bị loại bỏ). Nếu dùng nhiều hơn 4 options, có thể thêm Option 5..n (parser sẽ lấy tất cả option* cột có tên tương tự).
- Question Type ("QuestionType") — one of: `mcq` (single correct choice), `multi` (multiple correct), `tf` (true/false), `text` (short text), `scale` (numeric scale). Nếu bỏ trống mặc định `mcq`.
- Skill ("SkillType" / "skill") — tag để gắn skill cho question (ví dụ: Logical, Verbal, Math, Grammar).
- Bank ("BankName") — tên bank nếu muốn override upload grouping.
- Difficulty — numeric or enumerated (e.g., 1-5, Easy/Medium/Hard).
- Points — numeric score weight for the question.
- Explanation — text: lời giải/giải thích (sẽ hiển thị trong chế độ xem giáo viên/admin nếu cần).
- ImageURL — url string, nếu question chứa hình ảnh (server sẽ not download by default but can store the URL).
- ShuffleOptions — true/false (whether to randomize options for this question on delivery).

4) Multiple-correct and multi-select (multi)
- For `QuestionType` == `multi`, set `Correct Answer` as a delimiter-separated list (ví dụ: "A|C" or the actual option text separated by `|`). Parser sẽ tách theo `|` hoặc `;` và so sánh trimmed values.

5) True/False
- For `QuestionType` == `tf`, `Correct Answer` should be `TRUE` or `FALSE` (case-insensitive).

6) Scale questions
- For `QuestionType` == `scale`, provide `Correct Answer` optional (or leave empty). Use `Options` columns to indicate the scale labels if desired. The system will treat scale answers as numeric values for aggregation.

7) Sheet for assessment (optional)
- If teacher wants custom assessment questions, add a sheet named exactly `assessment` (case-insensitive). Columns: QuestionID, QuestionText, QuestionType (yesno|scale|multi), Options (pipe-separated, optional), SkillTag, Weight, Order.
- Alternatively frontend inline quick questions can be used; `assessment` sheet is only required when teacher uploads custom assessment set.

8) Example rows (CSV-friendly examples you can paste into Excel)
- Example MCQ (4-options):
  Question,Option 1,Option 2,Option 3,Option 4,Correct Answer,SkillType,BankName,Difficulty,Points,Explanation
  "What is 2+2?","1","2","3","4","4","Math","Basics",1,1,"Simple addition"

- Example multiple-correct:
  "Select prime numbers","2","3","4","5","2|3|5","Math","Primes",2,1,"Primes under 6"

- Example true/false:
  "The earth is flat","True","False",,,"False","General","Facts",1,1,"False statement"

- Example scale (1-5):
  "I enjoy solving puzzles",,,,,"","Personality","SelfAssess",, ,"Scale 1-5"

9) Parsing rules & validation (backend expectations)
- The server will read the first sheet of each uploaded file by default. If sheet empty -> skip.
- Required columns: `Question` AND one `Correct Answer`-like column. If missing -> return 400 with error message listing the file name and required columns.
- Option columns: parser collects `Option 1..n` columns in order and removes empty options. If a question has fewer options than declared `optionsCount` in the form, it's accepted.
- Trim all string fields and normalize whitespace. Treat HTML tags as plain text (no sanitization is performed on upload; sanitize before display where needed).
- For `QuestionType=multi`, split `Correct Answer` on `|` or `;` to get array of correct answers.
- For scale questions, parse numeric answers and map to skillScores accordingly.
- Maximum rows: configurable (default 5000 rows per sheet). If exceed -> return 400 with message.
- Maximum file size: rely on multer limits (configurable). If file too large -> multer error.
- Encoding: support UTF-8; ensure Excel saved in standard xlsx format to avoid charset issues.

10) Error messages / usability
- When validation fails, return a descriptive 400 JSON with fields: { error: 'Invalid Excel format', file: '<filename>', details: '<which columns missing or row number>' } so client can highlight the issue to teacher.

11) Recommended teacher workflow (short copy for UI/guide)
- Download the provided template (include a button "Download Excel template") which contains example rows and the `assessment` sheet sample.
- Fill questions in the template, keep headers unchanged, then upload.
- If you want built-in quick assessment questions, simply tick "Enable assessment" and answer inline questions in the form.

12) Implementation notes for devs
- Keep the parser tolerant but strict on required headers. Use a small helper mapping to detect Vietnamese/English headers (e.g., check for 'Câu hỏi' or 'Question').
- Store the original uploaded file path and sheet name in quiz metadata for traceability.
- If `assessment` sheet exists, parse it and save assessment config to `assessments` collection linked to quiz. If both assessment sheet and `assessmentAnswers` sent, prefer uploaded sheet.

13) Sample template file
- I'll include a small sample CSV block below (teachers can copy/paste into Excel):

Question,Option 1,Option 2,Option 3,Option 4,Correct Answer,SkillType,BankName,Difficulty,Points,Explanation
"What is 2+2?","1","2","3","4","4","Math","Basics",1,1,"Simple addition"
"Select even numbers","1","2","3","4","2|4","Math","Basics",2,1,"Multiple selection example"
"The sky is blue","True","False",,,"True","Science","Basics",1,1,"True statement"

---
Ghi chú: Tôi sẽ thêm phần template file thực tế (xlsx) dưới dạng tệp download nếu bạn muốn tôi tạo tệp mẫu và commit vào `public/`.

### Cấu trúc file Excel cho câu hỏi thu thập thông tin (assessment)
Khi giáo viên thêm bộ câu hỏi để thu thập thông tin/đánh giá năng lực, file Excel nên có cấu trúc rõ ràng để backend có thể parse tự động. Đề xuất cột như sau:

- Column headers (ví dụ):
  - QuestionID (string | optional) — mã câu hỏi, ví dụ Q1
  - QuestionText (string) — nội dung câu hỏi, ví dụ "Bạn có thích lập trình?"
  - QuestionType (string) — one of: "yesno", "scale", "multi" (yes/no, thang 1-5, lựa chọn nhiều)
  - Options (string | optional) — với các câu type `multi` chứa các phương án, có thể là JSON array hoặc phân tách bằng `|`, ví dụ "A|B|C"
  - SkillTag (string | optional) — nhãn kỹ năng liên quan, ví dụ "logical", "verbal", "math", "creativity"
  - Weight (number | optional) — trọng số câu hỏi khi tính skill score (mặc định 1)
  - Order (number | optional) — vị trí/thuật tự câu hỏi

Ví dụ một hàng (CSV/Excel):
QuestionID | QuestionText | QuestionType | Options | SkillTag | Weight | Order
Q1 | Bạn có thích lập trình? | yesno |  | logical | 1 | 1
Q2 | Mức độ thích đọc/viết (1-5) | scale | 1|2|3|4|5 | verbal | 1 | 2

Backend sẽ parse sheet đầu tiên (hoặc sheet có tên `assessment`) và tạo một cấu trúc câu hỏi assessment trong quiz metadata hoặc lưu riêng nếu muốn.

Lưu ý: nếu bạn muốn giáo viên chỉ tick checkbox (không upload file), ta có thể cung cấp bộ câu hỏi mặc định phía frontend.

## API contract (proposed)

Primary (integrated into existing create/upload): POST /api/upload
 - Behaviour: keep the existing upload/create behaviour. Accept optional assessment fields in the same request when the user enables the assessment feature:
   - `assessmentEnabled` (boolean true/false)
   - `assessmentAnswers` (JSON string or form field containing answers, e.g. '{"q1":true,"q2":4}')
 - Server behavior when `assessmentEnabled` is true: parse `assessmentAnswers`, derive skillScores (or accept provided), call Hybrid AI (Gemini) / fallback, create a separate `assessments` document linked to the new quiz (via `quizId` or `caseId`), and include an `assessment` object in the `/api/upload` response. Example combined response:
   {
     "success": true,
     "quizId": "...",
     "assessment": { "id": "...", "suggestedMajors": [...], "skillScores": {...} }
   }

## Flow khi tạo đề (chi tiết thao tác tích hợp assessment)
Khi người dùng (giáo viên) nhấn "Upload & Create" trên `create.html`, backend hiện tại xử lý file Excel, trích xuất câu hỏi và lưu quiz vào collection `quizzes`. Ta sẽ bổ sung các bước sau nếu người tạo bật `assessmentEnabled` hoặc upload sheet `assessment`:

1. Frontend: khi build `FormData` cho `/api/upload`, nếu assessment bật thì append:
  - `assessmentEnabled` = 'true'
  - `assessmentAnswers` = JSON string hoặc `assessmentFile` (nếu giáo viên upload file assessment riêng)
  - Hoặc backend có thể tự parse sheet `assessment` trong file upload nếu có.

2. Backend `/api/upload` (sau khi đã parse và chuẩn bị `finalQuestions`):
  a. Lưu quiz như hiện tại (collection `quizzes`) và lấy `quizId`.
  b. Nếu `assessmentEnabled` true:
    - Nếu có assessment sheet/file -> parse câu hỏi assessment và lưu metadata (câu hỏi, skillTag, weight) vào `assessments` collection (document type: assessment config) với field `quizId` reference.
    - Nếu frontend gửi `assessmentAnswers` (ví dụ do giáo viên nhập các câu hỏi nhanh) -> lưu answers vào `assessments.answers`.
    - Derive `skillScores` từ answers (rule-based) hoặc dùng trực tiếp nếu gửi kèm.
    - Call Hybrid AI (Gemini) với prompt bao gồm answers + derived skillScores để nhận `suggestedMajors` + reasons. Nếu AI fails -> use fallback rule-based suggestions.
    - Lưu kết quả AI trả về vào collection `assessment_results` (schema bên dưới) và link `assessment_resultId` vào document `assessments` (hoặc lưu trực tiếp vào `assessments.suggestedMajors` nếu muốn đơn giản).

3. Response: server trả về response upload gốc bổ sung object `assessment` (nếu có) như ví dụ bên trên.

4. Duyệt/approve: nếu quy trình có bước duyệt đề (admin review) thì:
  - Quiz vẫn lưu vào `quizzes` dưới trạng thái `pending` (nếu hiện có flow này) và assessment record được tạo kèm (status `pending` hoặc `ready`).
  - Khi admin/phê duyệt quiz, trạng thái `quiz.published=true` và assessment record có thể được gắn cờ `approvedAt`.

5. Kết quả: cả quiz và assessment_result đều được lưu trong DB (2 collection khác nhau) để truy vấn/thống kê riêng biệt.

Optional admin/query endpoints (authenticated):
 - GET /api/assessments/:id -> returns the assessment document
 - GET /api/assessments/stats?caseId=...&from=...&to=... -> aggregated stats for charts (counts, averages, distributions)

Security: admin/query endpoints must be authenticated/authorized. Creation via `/api/upload` is part of the normal teacher/creator flow but must respect consent and PII/redaction policies.

## Hybrid AI – prompt & call flow (template)

Flow:
1. Server receives answers.
2. Server runs small rule-based pre-processing to calculate base skill scores (e.g. logical, verbal, math) from answers.
3. Build prompt including: system instructions, user answers, derived skillScores, desired output JSON schema and a request for short reasoning per suggested major.
4. Call the Gemini model (Google/Vertex AI) as the primary LLM with low temperature for consistent structured outputs. If the Gemini call fails or returns malformed JSON, fall back to the rule-based recommender.

Gemini integration (tích hợp Gemini) — yêu cầu rõ:
- Provider/config: dùng Google Cloud / Vertex AI hoặc Gemini API. Đặt biến môi trường `GEMINI_MODEL` và `GEMINI_API_KEY` (hoặc đường dẫn service account JSON nếu dùng Google SDK). Không commit key vào repo.
- Model selection: mặc định dùng placeholder `GEMINI_MODEL` (ví dụ `gemini-1.5` hoặc `gemini-pro`) — bạn xác nhận model cụ thể nếu cần.
- Call options: temperature 0.0–0.3, max tokens vừa phải, timeout ~8s, retry 1-2 lần với exponential backoff.
- Response validation: bắt buộc parse JSON; nếu parse lỗi, thực hiện một structured re-prompt asking for JSON only; nếu vẫn lỗi, ghi `aiRawResponse` và return rule-based suggestions.
- Audit: lưu `promptSnapshot`, `modelName`, `modelParams`, `aiRawResponse`, `latency` vào logs (redact PII) để phục vụ sau này.

Prompt template (example):
- System: "You are an expert career counselor. Given the user's answers and derived skill scores, suggest up to 3 academic majors ranked by fit. For each major return: name, score (0-100), 2-3 concise reasons mapping to the answers/skills. Return JSON ONLY matching the schema provided — nothing else."
- User: include answers, derived skillScores, optional context (age/goals) and the JSON schema example.

Expected AI response (JSON):
{
  "suggestedMajors": [
    {"major":"Computer Science","score":92,"reasons":["High programming interest","High logical score"],"matchedSkills":["logical","coding"]}
  ],
  "explanationSummary":"Short summary mapping answers -> suggested majors"
}

Security & cost notes:
- Redact personal data from prompts before saving to long-term storage. Keep raw prompt/response only if consented; otherwise store minimal audit metadata.
- Set quotas / monitoring for API usage to avoid cost spikes. Implement rate-limiting per IP/session.

Fallback strategy:
- If Gemini returns malformed data or times out after retries: compute suggestions via deterministic rule-based engine (map skillScores -> majors), mark assessment as `fallbackUsed: true`, and include short explanation why fallback triggered.


## Frontend changes

- `public/create.html` (hoặc partial `public/assessment.html`):
  - Thêm checkbox: "Đánh giá năng lực" (label rõ ràng) trong form tạo case.
  - Khi checkbox ON, load hiển thị bộ câu hỏi (yes/no, mức 1-5). Hỗ trợ cấu hình câu hỏi mặc định hoặc per-case.
  - Khi submit, nếu assessment enabled, đính kèm dữ liệu đánh giá trong cùng request POST `/api/upload` (ví dụ thêm các trường FormData `assessmentEnabled` và `assessmentAnswers` chứa JSON string). Server sẽ xử lý upload và tạo assessment record bổ sung rồi trả về kết quả assessment cùng response tạo đề.
  - Sau nhận response, render:
    - Bảng `suggestedMajors` (major, score, reasons)
    - Biểu đồ `skillScores` (bar chart) — dùng Chart.js với `responsive: true, maintainAspectRatio: false` để đảm bảo co dãn.
    - Mục "Vì sao gợi ý" hiển thị reasoning text cho mỗi major.

### Chi tiết chỉnh `public/create.html` (nơi bạn đang làm tới phần upload banks)

Ghi chú: bạn đã có form upload ở `create.html` và code đến phần upload banks; dưới đây là hướng cụ thể để tiếp tục (phần UI/fields mà backend sẽ đọc):

1) Vị trí: chèn block "Đánh giá năng lực" ngay bên dưới khu "Upload Question Banks" (hoặc như một bank-item thứ cuối). Giữ cùng style `.form-card` để đồng bộ.

2) Trường form & tên field (quan trọng để backend đọc):
  - Checkbox bật/tắt: `<input type="checkbox" name="assessmentEnabled" id="assessmentEnabled" value="true">`
  - Option 1 — Upload Excel assessment sheet (recommended if teacher wants custom questions):
     `<input type="file" name="assessmentFile" accept=".xlsx,.xls">`
     - Nếu loại này được dùng, backend sẽ parse sheet đầu tiên hoặc sheet có tên `assessment` theo cấu trúc đã mô tả (QuestionID, QuestionText, QuestionType, Options, SkillTag, Weight, Order).
  - Option 2 — Inline quick questions (fast): render a small editor with a few default questions (yes/no, scale 1-5) and collect answers; on submit append a JSON string into FormData under key `assessmentAnswers` (e.g. `{"q1":true,"q2":4}`).

3) Frontend submit behavior (explicit):
  - When user clicks "Upload & Create":
    a) Build existing FormData for quiz upload (banks/files etc.)
    b) If `assessmentEnabled` checked:
      - If `assessmentFile` provided, include the file in FormData (name `assessmentFile`), and optionally set `assessmentEnabled=true`.
      - Else if inline answers exist, `formData.append('assessmentAnswers', JSON.stringify(answersObj)); formData.append('assessmentEnabled', 'true');`
  - Submit FormData to `/api/upload` as usual.

4) Preview & validation UI suggestions:
  - Show a small preview panel listing assessment questions or uploaded assessment file name.
  - Validate at least one question/answer exists if `assessmentEnabled` is set; show inline errors.

5) UX details and accessibility:
  - Keep section collapsible and show a short consent note ("Bật để thu thập thông tin và nhận gợi ý ngành học. Dữ liệu sẽ được lưu theo chính sách privacy.").
  - Ensure labels, aria attrs, and mobile-friendly tap targets.

6) Server expectations (so front/back align):
  - Read `req.body.assessmentEnabled` or `req.body['assessmentEnabled']` (multipart) and `req.body.assessmentAnswers` (string) or `req.files` entry `assessmentFile`.
  - If `assessmentFile` present, parse for assessment sheet; else parse `assessmentAnswers` JSON.

7) CSS/responsive: use existing `.form-card` styling; ensure the preview panel and any inline editor fit within the two-column grid (use `grid-column: 1 / -1` for full-width on small screens).

8) Incremental approach (implementation plan):
  - Step A: Add checkbox + inline quick questions UI (no file upload) and append `assessmentAnswers` to FormData. This is low-risk and fast to test.
  - Step B: Add optional `assessmentFile` input and server-side parsing for sheet `assessment` (or sheet 0). Handle parsing errors gracefully and fall back to inline questions.
  - Step C: Add preview + validation + accessibility polish.

Thêm vào Acceptance criteria (ngắn):
 - `create.html` must include `assessmentEnabled` field and either `assessmentFile` or `assessmentAnswers` appended to `/api/upload` FormData when enabled.
 - The server shall create `assessments` + `assessment_results` when `assessmentEnabled` is present, and the upload response must contain `assessment` object with `suggestedMajors`.

CSS & responsive checklist (phải đảm bảo):
- HTML: đảm bảo `<meta name="viewport" content="width=device-width, initial-scale=1">` trong header.
- Layout: wrapper `.container { max-width: 1100px; margin: 0 auto; padding: 16px; box-sizing: border-box; }` để tránh overflow.
- Use flexbox/grid cho grid của chart + table và set `flex-wrap: wrap` để tránh horizontal scroll.
- Chart canvas: đặt `width:100%` và bọc trong div với chiều cao linh hoạt (ví dụ `height: 300px` trên desktop, `200px` trên mobile) và Chart.js option `maintainAspectRatio: false`.
- Long texts: `word-break: break-word; overflow-wrap: anywhere;` để tránh chèn layout.
- Inputs/Buttons: kích thước touch target >= 40px, margin/padding hợp lý.
- Breakpoints test: 320px, 375px, 425px, 768px, 1024px, 1366px; fix overflow issues on the smallest widths.
- Add `aria-label` cho chart containers and summary to improve accessibility.

Structure suggestion (non-breaking):
- Tách partial `public/assessment.html` và file JS `public/js/assessment.js` để chứa logic hiển thị/validate/API call. Giữ `create.html` nhẹ.

Testing & verification (CSS):
- Manual responsive check in devtools for breakpoints trên; kiểm tra không có horizontal scroll, các text/element không bị tràn.
- Thực hiện quick cross-browser check (Chrome, Edge) và mobile emulation.


## Visualization / Output
- Table: suggestedMajors (major, score, key reasons)
- Chart: bar chart của skillScores
- Optional: radar chart cho nhiều skill

## Privacy & Compliance
- Luôn hiển thị checkbox/consent: người dùng phải bật để thu thập và phân tích.
- Có thể lưu anonymized (nếu userId không có, store as anonymous).
- Lưu promptSnapshot/aiRawResponse nhưng có policy xóa sau X ngày (configurable).

## Error handling & edge cases
- Missing answers: reject with 400 or apply defaults.
- AI failure / timeout: fallback to rule-based suggestions.
- Contradictory answers: AI should be allowed to explain contradictions; store a flag `isContradictory` if rules detect.

## Acceptance criteria
1. `public/create.html` shows checkbox and question inputs when enabled.
2. Creation of assessment is integrated into `POST /api/upload`: when `assessmentEnabled` is sent, the server creates an `assessments` document linked to the quiz and creates an `assessment_results` document with AI suggestions; the upload response includes assessment result data.
3. Frontend renders table + chart and shows reasons.
4. Admin can query `/api/assessments/stats` for aggregated charts.

## Implementation steps & rough estimate
1. (0.5 day) Soạn `plan.md` và chuẩn hoá schema — (this file).
2. (0.5 day) UI changes in `public/create.html` (checkbox + question UI + client POST).
3. (1 day) DB model `models/Assessment.js` (Mongo schema) and optional migration.
4. (1 day) API endpoints: POST/GET/stats in server code (e.g., `server.js` or add `assessments.js` route).
5. (1 day) Hybrid AI service: implement prompt builder, call wrapper, logging & fallback.
6. (0.5 day) Frontend result page + Chart.js integration.
7. (0.5 day) Tests + docs + small polish.

Tổng: ~5.5 ngày (có thể tách thành 2-3 sprint nhỏ). Thời gian có thể giảm nếu reuse nhiều code hiện có.

## Testing strategy
- Unit tests for prompt builder and data mapping.
- Integration test mocking AI (return canned JSON) to verify API flow and DB write.
- Manual frontend test: submit sample answers -> verify table + chart.

## Next steps (chờ duyệt - không thực hiện code nếu chưa có phê duyệt)
1. Bạn duyệt phần plan đã sửa này (đặc biệt xác nhận: sử dụng Gemini làm provider và chấp nhận lưu biến env `GEMINI_MODEL` / `GEMINI_API_KEY`).
2. Xác nhận bạn muốn tôi tách UI (partial + JS) khi bắt tay implement hay giữ nguyên `create.html`.
3. Xác nhận retention policy cho prompt/response (ví dụ xóa promptSnapshot sau 30 ngày) và việc redact PII.

4. Xác nhận hành vi tích hợp: assessment được gửi kèm trong `POST /api/upload` và server sẽ tạo `assessments` record liên quan (mặc định). Nếu bạn muốn vẫn giữ endpoint `POST /api/assessments` riêng cho các luồng tách rời, hãy ghi rõ để tôi thêm như tuỳ chọn.

Ghi chú quan trọng: tôi sẽ không bắt tay vào viết code / chỉnh `public/create.html` hay API endpoint cho tới khi bạn explicit phê duyệt bước thực hiện. Sau khi bạn phê duyệt, tôi sẽ thực hiện theo thứ tự: UI changes -> model -> API -> AI service -> frontend result + CSS fixes, và sẽ báo tiến độ sau mỗi bước.

---
Bạn kiểm tra và cho tôi biết các điểm cần sửa thêm trên plan; nếu OK, hãy trả lời "Phê duyệt" và tôi sẽ bắt tay vào implement theo plan (hoặc bạn có thể cho phép tôi làm từng phần từng phần nếu muốn review incremental).
