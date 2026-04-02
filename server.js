const express = require('express');
require('dotenv').config({ override: true });
const compression = require('compression');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { Blob } = require('buffer');
const FormData = require('form-data');
const { ReadableStream } = require('stream/web');

// Compatibility for environments where global Fetch classes are missing (Node < 18).
if (typeof globalThis.Headers === 'undefined') {
    globalThis.Headers = fetch.Headers;
}
if (typeof globalThis.Request === 'undefined') {
    globalThis.Request = fetch.Request;
}
if (typeof globalThis.Response === 'undefined') {
    globalThis.Response = fetch.Response;
}
if (typeof globalThis.fetch === 'undefined') {
    globalThis.fetch = fetch;
}
if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = Blob;
}
if (typeof globalThis.FormData === 'undefined') {
    globalThis.FormData = FormData;
}
if (typeof globalThis.File === 'undefined' && fetch.File) {
    globalThis.File = fetch.File;
}
if (typeof globalThis.ReadableStream === 'undefined') {
    globalThis.ReadableStream = ReadableStream;
}

const { google } = require('googleapis');

// Models
const Quiz = require('./models/Quiz');
const Submission = require('./models/Submission');
const Visit = require('./models/Visit');
const Admin = require('./models/Admin');
const AssessmentConfig = require('./models/AssessmentConfig');
const AssessmentAttempt = require('./models/AssessmentAttempt');
const AssessmentAiRun = require('./models/AssessmentAiRun');
const { startCleanupService } = require('./services/cleanup');

const adminTokens = new Map(); // token -> { exp }
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const app = express();
const PORT = process.env.PORT || 4010;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizzes';
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'hungnq';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'HungNQ@1979';
const HYBRID_AI_PROVIDER = process.env.HYBRID_AI_PROVIDER || 'gemini';
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_API_KEYS = String(process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map(x => String(x || '').trim())
    .filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_MAX_OUTPUT_TOKENS = Math.max(512, Math.min(8192, parseInt(String(process.env.GEMINI_MAX_OUTPUT_TOKENS || '3072'), 10) || 3072));

// Connect to MongoDB and ensure default admin exists before accepting requests
let ensureAdminPromise = null;
function ensureDefaultAdmin() {
    if (ensureAdminPromise) return ensureAdminPromise;
    ensureAdminPromise = (async () => {
        const defaultUsername = DEFAULT_ADMIN_USERNAME;
        const defaultPasswordHash = crypto.createHash('sha256').update(DEFAULT_ADMIN_PASSWORD).digest('hex');
        const existing = await Admin.findOne({ username: defaultUsername });
        if (!existing) {
            await Admin.create({ username: defaultUsername, passwordHash: defaultPasswordHash });
            console.log(`Default admin created: ${defaultUsername}`);
        }
    })();
    return ensureAdminPromise;
}

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        return ensureDefaultAdmin();
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            startCleanupService(3600000, 21600000);
        });
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Trust proxy for Nginx
app.set('trust proxy', 1);

// Rate Limiters
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP.'
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many API requests from this IP.'
});

// Middleware
app.use(globalLimiter);
app.use(cors());
app.use((req, res, next) => {
    console.log('Request:', req.method, req.url);
    next();
});

// Record visit for page views (before static so we see all requests)
app.use((req, res, next) => {
    const urlPath = (req.url || '').split('?')[0];
    const isPage = req.method === 'GET' && (
        urlPath === '/' || urlPath === '' ||
        /\.(html?)$/i.test(urlPath) ||
        ['/create', '/quiz', '/results', '/guide', '/policy', '/privacy'].some(p => urlPath === p || urlPath.startsWith(p + '/'))
    );
    if (isPage) {
        const country = (req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').trim() || 'Unknown';
        Visit.create({ path: urlPath || '/', country: country || 'Unknown' }).catch(() => { });
    }
    next();
});

app.use(compression());
console.log('Static directory:', path.join(__dirname, 'public'));
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d' // Cache static assets for 1 day
}));
app.use(express.json());
app.use('/api/', apiLimiter);

// Multer Config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads/')) {
            fs.mkdirSync('uploads/');
        }
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- API Endpoints ---

// Upload & Create Quiz
app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        let parts = [];
        const legacyFile = req.files ? req.files.find(f => f.fieldname === 'file') : null;
        if (legacyFile) {
            parts.push({
                file: legacyFile,
                bankName: 'General',
                skillType: 'General'
            });
        } else if (req.files) {
            // Multer nhận file theo "fieldname" (file_0, file_1, ...).
            // Frontend có thể không gửi liên tục (ví dụ file_0 rỗng nhưng file_1 có),
            // nên không được break theo index trống.
            const fileFields = req.files
                .filter(f => typeof f.fieldname === 'string' && /^file_\d+$/.test(f.fieldname))
                .map(f => {
                    const idx = parseInt(String(f.fieldname).split('_')[1], 10);
                    return { file: f, idx: Number.isFinite(idx) ? idx : null };
                })
                .filter(x => x.idx !== null)
                .sort((a, b) => a.idx - b.idx);

            for (const { file: f, idx } of fileFields) {
                parts.push({
                    file: f,
                    bankName: req.body[`bankName_${idx}`] || `Bank ${idx + 1}`,
                    skillType: req.body[`skillType_${idx}`] || `Type ${idx + 1}`
                });
            }
        }

        if (parts.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        const teacherName = req.body.teacherName || '';
        const teacherEmail = req.body.teacherEmail || '';
        let startTime = req.body.startTime || null;
        let endTime = req.body.endTime || null;

        if (startTime && !startTime.includes('Z') && !startTime.match(/[+-]\d{2}:\d{2}$/)) {
            startTime = startTime.length === 16 ? startTime + ':00+07:00' : startTime + '+07:00';
        }
        if (endTime && !endTime.includes('Z') && !endTime.match(/[+-]\d{2}:\d{2}$/)) {
            endTime = endTime.length === 16 ? endTime + ':00+07:00' : endTime + '+07:00';
        }
        const timeLimit = req.body.timeLimit ? parseInt(req.body.timeLimit) : null;
        const password = req.body.password || null;
        const questionMode = String(req.body.questionMode || 'all').trim().toLowerCase();
        const randomCount = req.body.randomCount ? parseInt(String(req.body.randomCount).trim(), 10) : null;
        const optionsCount = parseInt(req.body.optionsCount) || 4;

        let allowedIPs = [];
        if (req.body.allowedIPs) {
            allowedIPs = req.body.allowedIPs.split(',').map(ip => ip.trim()).filter(ip => ip !== '');
        }

        const collectMAC = req.body.collectMAC === 'true' || req.body.collectMAC === true;

        let finalQuestions = [];
        let globalQuestionId = 1;
        let assessmentQuestions = [];

        for (const part of parts) {
            const filePath = part.file.path;
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

            if (!rows || rows.length === 0) continue;

            const firstRow = rows[0];
            const keys = Object.keys(firstRow);
            const hasQuestionCol = keys.some(k => ['Câu hỏi', 'Question'].includes(k));
            const hasCorrectAnswerCol = keys.some(k => ['Phương án đúng', 'Correct Answer', 'Đáp án đúng'].includes(k));
            
            if (optionsCount === 101) {
                const questions = rows.map((row) => {
                    const questionText = row['Câu hỏi'] || row['Question'];
                    
                    let allOptions = [
                        row['Đáp án 1'] || row['Option 1'],
                        row['Đáp án 2'] || row['Option 2'],
                        row['Đáp án 3'] || row['Option 3'],
                        row['Đáp án 4'] || row['Option 4'],
                        row['Đáp án 5'] || row['Option 5']
                    ];

                    return {
                        id: globalQuestionId++,
                        question: questionText,
                        options: allOptions.filter(opt => opt !== undefined && opt !== null && String(opt).trim() !== ''),
                        segmentName: part.bankName,
                        skillType: part.skillType
                    };
                }).filter(q => q !== null);

                assessmentQuestions.push(...questions);
            } else {
                if (!hasQuestionCol || !hasCorrectAnswerCol) {
                    return res.status(400).json({
                        error: `Invalid Excel format in file ${part.file.originalname}. Required columns: "Câu hỏi"/"Question" and "Phương án đúng"/"Correct Answer".`
                    });
                }

                const questions = rows.map((row) => {
                    const questionText = row['Câu hỏi'] || row['Question'];
                    const correctAnswer = row['Phương án đúng'] || row['Correct Answer'] || row['Đáp án đúng'];

                    if (!questionText || !correctAnswer) return null;

                    let allOptions = [
                        row['Đáp án 1'] || row['Option 1'],
                        row['Đáp án 2'] || row['Option 2'],
                        row['Đáp án 3'] || row['Option 3'],
                        row['Đáp án 4'] || row['Option 4']
                    ];

                    if (optionsCount === 3) {
                        allOptions = allOptions.slice(0, 3);
                    }

                    return {
                        id: globalQuestionId++,
                        question: questionText,
                        options: allOptions.filter(opt => opt !== undefined && opt !== null && String(opt).trim() !== ''),
                        correctAnswer: correctAnswer,
                        segmentName: part.bankName,
                        skillType: part.skillType
                    };
                }).filter(q => q !== null);

                finalQuestions.push(...questions);
            }
        }

        if (finalQuestions.length === 0) {
            if (optionsCount !== 101) {
                return res.status(400).json({ error: 'No valid questions found in the uploaded files' });
            }
        }

        if (optionsCount === 101 && assessmentQuestions.length === 0) {
            return res.status(400).json({
                error: 'Assessment mode requires an Excel sheet named "assessment" with at least 1 question.'
            });
        }
        // Store all questions (Bank) and let client handle randomization/slicing
        const quizId = uuidv4();
        const quizTitle = req.body.quizTitle || 'Untitled Quiz';

        // Save to MongoDB
        await Quiz.create({
            id: quizId,
            title: quizTitle,
            type: optionsCount === 101 ? 'assessment' : 'quiz',
            filename: parts.map(p => p.file.originalname).join(', '),
            teacherName: teacherName,
            email: teacherEmail,
            startTime: startTime,
            endTime: endTime,
            timeLimit: timeLimit,
            password: password,
            filePath: parts.map(p => p.file.path).join('|'),

            createdAt: new Date(),
            questions: [...finalQuestions, ...assessmentQuestions],
            questionMode: questionMode,
            randomCount: randomCount,
            allowedIPs: allowedIPs,
            collectMAC: collectMAC,
            assessmentEnabled: optionsCount === 101 || assessmentQuestions.length > 0,
            assessmentConfigVersion: null
        });

        res.json({ success: true, quizId: quizId, message: 'Quiz created successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to process file' });
    }
});

// --- Assessment APIs ---

// Get assessment config (latest version) by quizId
app.get('/api/assessments/config/:quizId', async (req, res) => {
    try {
        const quizId = String(req.params.quizId || '').trim();
        if (!quizId) return res.status(400).json({ error: 'Missing quizId' });

        const quiz = await Quiz.findOne({ id: quizId }).lean();
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (!quiz.assessmentEnabled) return res.status(404).json({ error: 'Assessment not enabled for this quiz' });

        const cfg = await ensureAssessmentConfigWithTags({ quizId, quiz });

        res.json({ quizId, version: cfg.version, questions: cfg.questions || [] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

function normalizeSkillTag(tag) {
    return String(tag || '').trim().toLowerCase();
}

function clampNumber(n, min, max) {
    if (!Number.isFinite(n)) return null;
    if (Number.isFinite(min) && n < min) return min;
    if (Number.isFinite(max) && n > max) return max;
    return n;
}

/** Match answer keys whether client sent number or string (e.g. originalIndex vs "5"). */
function getAnswerForQuestion(answers, questionId) {
    const a = answers || {};
    if (questionId === undefined || questionId === null) return undefined;
    if (Object.prototype.hasOwnProperty.call(a, questionId)) return a[questionId];
    const s = String(questionId);
    if (Object.prototype.hasOwnProperty.call(a, s)) return a[s];
    const n = Number(questionId);
    if (Number.isFinite(n) && Object.prototype.hasOwnProperty.call(a, n)) return a[n];
    return undefined;
}

function truncateForPrompt(s, maxLen) {
    const t = String(s || '').trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function formatAnswerForEvidence(raw, q) {
    if (raw === undefined || raw === null || raw === '') return '';
    const type = q && q.type;
    if (type === 'multi') {
        const arr = Array.isArray(raw) ? raw : String(raw).split('|').map(x => x.trim()).filter(Boolean);
        return arr.join('; ');
    }
    if (typeof raw === 'object') return JSON.stringify(raw);
    return String(raw);
}

/** Câu hỏi + câu trả lời thực tế để model căn cứ gợi ý, không chỉ điểm tổng hợp. */
function buildSubmittedAnswerEvidence(configQuestions, answers) {
    const rows = [];
    let ord = 0;
    for (const q of configQuestions || []) {
        const qid = q.questionId;
        const raw = getAnswerForQuestion(answers, qid);
        if (raw === undefined || raw === null || raw === '') continue;
        ord += 1;
        rows.push({
            order: ord,
            questionId: String(qid),
            type: q.type || 'single',
            question: truncateForPrompt(q.question || '', 520),
            answer: truncateForPrompt(formatAnswerForEvidence(raw, q), 420),
            options: Array.isArray(q.options)
                ? q.options.slice(0, 8).map(o => truncateForPrompt(String(o || ''), 80))
                : []
        });
    }
    return rows;
}

function mergeSuggestedMajorsScoresFromBaseline(suggestedMajors, baseline) {
    const map = new Map((baseline || []).map(b => [String(b.majorName || ''), Number(b.score) || 0]));
    const out = (suggestedMajors || []).map(m => {
        const name = String(m.majorName || '');
        const ruleScore = map.get(name);
        const aiScore = Number(m.score);
        const score = map.has(name) ? ruleScore : (Number.isFinite(aiScore) ? aiScore : 0);
        return { ...m, majorName: name, score: Math.max(0, Math.min(100, Math.round(score))) };
    });
    out.sort((a, b) => b.score - a.score);
    return out;
}

function buildProfessionalFallbackNarrative(skillScores, majors) {
    const labelMap = {
        leadership: 'Lãnh đạo',
        teamwork: 'Làm việc nhóm',
        communication: 'Giao tiếp',
        logical: 'Tư duy logic',
        analysis: 'Phân tích',
        creativity: 'Sáng tạo',
        detail: 'Tỉ mỉ/Kỷ luật',
        language: 'Ngoại ngữ',
        general: 'Năng lực chung'
    };
    const arr = Object.entries(skillScores || {})
        .map(([k, v]) => ({ key: String(k), score: Number(v) }))
        .filter(x => Number.isFinite(x.score))
        .sort((a, b) => b.score - a.score);

    const strengths = arr.slice(0, 3).filter(x => x.score > 0).map(x =>
        `${labelMap[x.key] || x.key}: ${Math.round(x.score)}% - nổi trội trong bài làm hiện tại.`
    );
    const risks = arr.slice().reverse().slice(0, 2).filter(x => x.score <= 45).map(x =>
        `${labelMap[x.key] || x.key}: ${Math.round(x.score)}% - nên có kế hoạch bồi dưỡng theo lộ trình 6-8 tuần.`
    );
    const topMajor = Array.isArray(majors) && majors[0] ? String(majors[0].majorName || '') : '';
    const marketNote = topMajor
        ? `Với định hướng ${topMajor}, nên xác thực thêm qua dự án trải nghiệm ngắn và dữ liệu tuyển dụng thực tế trước khi chốt lộ trình học.`
        : 'Nên kết hợp kết quả này với bài test chuyên sâu và thông tin tuyển sinh cập nhật để ra quyết định cuối cùng.';

    return {
        strengths: strengths.length ? strengths : ['Chưa có nhóm năng lực nào vượt trội rõ ràng trong lần đánh giá này.'],
        risks: risks.length ? risks : ['Không có nhóm năng lực yếu rõ rệt, nhưng vẫn cần duy trì nhịp học đều.'],
        marketNote
    };
}

function deriveSkillScoresFromAnswers(configQuestions, answers) {
    const scores = {}; // skill -> { sum, weight }
    const a = answers || {};

    for (const q of (configQuestions || [])) {
        const qid = q.questionId;
        const raw = getAnswerForQuestion(a, qid);
        if (raw === undefined || raw === null || raw === '') continue;

        const weight = Number.isFinite(q.weight) ? q.weight : 1;
        const tags = (q.skillTags || []).map(normalizeSkillTag).filter(Boolean);
        // If no skill tags exist, fallback to using questionId as a "dimension"
        // so UI charts/trends still have signal.
        const finalTags = tags.length ? tags : [String(qid)];

        let numeric = null;
        if (q.type === 'yesno') {
            const opts = Array.isArray(q.options) ? q.options : [];
            if (opts.length >= 2) {
                const opt0 = String(opts[0]).trim();
                const opt1 = String(opts[1]).trim();
                const rawStr = String(raw).trim();
                if (rawStr === opt0) numeric = 1;
                else if (rawStr === opt1) numeric = 0;
                else {
                    // fallback: allow boolean-like inputs
                    const b = raw === true || rawStr.toLowerCase() === 'true' || rawStr === '1' || rawStr.toLowerCase() === 'yes';
                    numeric = b ? 1 : 0;
                }
            } else {
                const rawStr = String(raw).trim();
                const b = raw === true || rawStr.toLowerCase() === 'true' || rawStr === '1' || rawStr.toLowerCase() === 'yes';
                numeric = b ? 1 : 0;
            }
        } else if (q.type === 'scale') {
            const min = Number(q.min ?? 1);
            const max = Number(q.max ?? 5);
            const rawNum = Number(raw);
            if (Number.isFinite(rawNum)) {
                numeric = clampNumber(rawNum, min, max);
            } else {
                // If UI sent label text instead of numeric, map it back to index 1..5.
                const opts = Array.isArray(q.options) ? q.options : [];
                const rawStr = String(raw).trim().toLowerCase();
                const idx = opts.findIndex(o => String(o).trim().toLowerCase() === rawStr);
                numeric = idx >= 0 ? (idx + 1) : null;
                numeric = numeric == null ? null : clampNumber(numeric, min, max);
            }
            if (numeric == null) continue;
            // normalize to 0..1
            numeric = max > min ? (numeric - min) / (max - min) : 0;
        } else if (q.type === 'single') {
            // Map single-choice selection to a 0..1 score instead of always 1,
            // otherwise every competency easily becomes 100% and looks fake.
            const opts = Array.isArray(q.options) ? q.options : [];
            const rawStr = String(raw).trim().toLowerCase();
            const idx = opts.findIndex(o => String(o).trim().toLowerCase() === rawStr);

            if (idx >= 0 && opts.length >= 2) {
                // normalize by position (last option = strongest)
                numeric = idx / (opts.length - 1);
            } else {
                // fallback: try numeric answers like 1..5
                const n = Number(raw);
                if (Number.isFinite(n)) {
                    const min = Number(q.min ?? 1);
                    const max = Number(q.max ?? Math.max(min + 1, opts.length || 5));
                    const clamped = clampNumber(n, min, max);
                    if (clamped == null) continue;
                    numeric = max > min ? (clamped - min) / (max - min) : 0;
                } else {
                    // last resort: treat as "selected" but not maximal
                    numeric = 0.6;
                }
            }
        } else if (q.type === 'multi') {
            const arr = Array.isArray(raw) ? raw : String(raw).split('|').map(x => x.trim()).filter(Boolean);
            numeric = arr.length > 0 ? 1 : 0;
        }

        if (numeric == null) continue;
        if (q.reverseScore) numeric = 1 - numeric;

        for (const t of finalTags) {
            if (!scores[t]) scores[t] = { sum: 0, w: 0 };
            scores[t].sum += numeric * weight;
            scores[t].w += weight;
        }
    }

    const out = {};
    for (const [skill, v] of Object.entries(scores)) {
        const val = v.w > 0 ? v.sum / v.w : 0;
        out[skill] = Math.round(val * 1000) / 10; // 0..100 with 0.1 precision
    }
    return out;
}

function baselineMajorsFromSkills(skillScores) {
    // Minimal deterministic mapping. Can be externalized later.
    const s = skillScores || {};
    const get = (k) => Number(s[k] || 0);
    const getAny = (keys) => {
        for (const k of keys) {
            const v = Number(s[k] || 0);
            if (v) return v;
        }
        return 0;
    };

    // Canonical list of majors (used by both rules + AI prompting)
    const allowedMajors = [
        'Lập trình Web',
        'Lập trình Mobile',
        'Lập trình Game',
        'Phát triển Phần mềm',
        'Lập trình Ứng dụng Trí tuệ nhân tạo (AI)',
        'Ứng dụng phần mềm',
        'Quản trị kinh doanh - Digital Marketing',
        'Quản trị kinh doanh - Marketing & Sales',
        'Quản trị kinh doanh - Truyền thông & Tổ chức sự kiện',
        'Quản trị dịch vụ du lịch và lữ hành',
        'Quản trị khách sạn nhà hàng',
        'Quản lý vận tải và dịch vụ logistics',
        'Công nghệ kỹ thuật điện, điện tử',
        'CN kỹ thuật điều khiển & tự động hoá',
        'Công nghệ Chip & Bán dẫn',
        'Thiết kế đồ hoạ',
        'Công nghệ kỹ thuật cơ khí',
        'Tiếng Trung Quốc',
        'Tiếng Hàn Quốc',
        'Tiếng Anh',
        'Tiếng Nhật',
        'Dược'
    ];

    const candidates = [
        { majorName: 'Lập trình Web', weights: { logical: 1.0, analysis: 0.65, detail: 0.7, creativity: 0.3 } },
        { majorName: 'Lập trình Mobile', weights: { logical: 1.0, analysis: 0.65, detail: 0.7, creativity: 0.3 } },
        { majorName: 'Lập trình Game', weights: { logical: 0.8, creativity: 1.0, analysis: 0.5, detail: 0.45 } },
        { majorName: 'Phát triển Phần mềm', weights: { logical: 1.0, analysis: 0.75, detail: 0.9 } },
        { majorName: 'Lập trình Ứng dụng Trí tuệ nhân tạo (AI)', weights: { analysis: 1.0, logical: 0.9, detail: 0.65 } },
        { majorName: 'Ứng dụng phần mềm', weights: { logical: 0.85, analysis: 0.65, detail: 0.75 } },
        { majorName: 'Quản trị kinh doanh - Digital Marketing', weights: { creativity: 0.9, communication: 0.8, teamwork: 0.4, detail: 0.4 } },
        { majorName: 'Quản trị kinh doanh - Marketing & Sales', weights: { communication: 0.9, leadership: 0.65, creativity: 0.5 } },
        { majorName: 'Quản trị kinh doanh - Truyền thông & Tổ chức sự kiện', weights: { communication: 0.9, leadership: 0.7, creativity: 0.7, detail: 0.4 } },
        { majorName: 'Quản trị dịch vụ du lịch và lữ hành', weights: { communication: 0.9, teamwork: 0.6, language: 0.6 } },
        { majorName: 'Quản trị khách sạn nhà hàng', weights: { communication: 0.9, leadership: 0.6, detail: 0.6 } },
        { majorName: 'Quản lý vận tải và dịch vụ logistics', weights: { detail: 0.8, analysis: 0.7, logical: 0.6 } },
        { majorName: 'Công nghệ kỹ thuật điện, điện tử', weights: { logical: 0.8, analysis: 0.7, detail: 0.7 } },
        { majorName: 'CN kỹ thuật điều khiển & tự động hoá', weights: { logical: 0.9, analysis: 0.9, detail: 0.8 } },
        { majorName: 'Công nghệ Chip & Bán dẫn', weights: { analysis: 1.0, detail: 0.9, logical: 0.6 } },
        { majorName: 'Thiết kế đồ hoạ', weights: { creativity: 1.0, detail: 0.55, communication: 0.3 } },
        { majorName: 'Công nghệ kỹ thuật cơ khí', weights: { logical: 0.75, analysis: 0.7, detail: 0.85 } },
        { majorName: 'Tiếng Trung Quốc', weights: { language: 1.0, communication: 0.6 } },
        { majorName: 'Tiếng Hàn Quốc', weights: { language: 1.0, communication: 0.6 } },
        { majorName: 'Tiếng Anh', weights: { language: 1.0, communication: 0.6 } },
        { majorName: 'Tiếng Nhật', weights: { language: 1.0, communication: 0.6 } },
        { majorName: 'Dược', weights: { detail: 1.0, analysis: 0.6, logical: 0.35 } }
    ];

    const scored = candidates.map(c => {
        let sum = 0;
        let w = 0;
        const matchedSkills = [];
        for (const [k, wk] of Object.entries(c.weights)) {
            const v = k === 'logical'
                ? getAny(['logical', 'logic'])
                : k === 'analysis'
                    ? getAny(['analysis', 'math'])
                    : get(k);
            if (v > 0) matchedSkills.push(k);
            sum += v * wk;
            w += wk;
        }
        const score = w > 0 ? sum / w : 0;
        return {
            majorName: c.majorName,
            score: Math.round(score),
            reasons: matchedSkills.length ? [`Phù hợp với các kỹ năng: ${matchedSkills.join(', ')}`] : [],
            matchedSkills
        };
    });

    scored.sort((a, b) => b.score - a.score);
    const topScore = scored.length ? scored[0].score : 0;
    // If no signal at all, do NOT default to the first majors (avoids always picking "Lập trình Web").
    if (!Number.isFinite(topScore) || topScore <= 0) return [];
    return scored.slice(0, 5);
}

function extractJsonObject(text) {
    if (!text) return null;
    const s = String(text);
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    const candidate = s.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch (_) { return null; }
}

function tryRecoverJsonObject(text) {
    if (!text) return null;
    const s = String(text);
    const first = s.indexOf('{');
    if (first === -1) return null;
    let candidate = s.slice(first);
    // Naive recovery for truncated JSON: close missing ] and }.
    const openSq = (candidate.match(/\[/g) || []).length;
    const closeSq = (candidate.match(/\]/g) || []).length;
    if (closeSq < openSq) candidate += ']'.repeat(openSq - closeSq);
    const openCurly = (candidate.match(/\{/g) || []).length;
    const closeCurly = (candidate.match(/\}/g) || []).length;
    if (closeCurly < openCurly) candidate += '}'.repeat(openCurly - closeCurly);
    try { return JSON.parse(candidate); } catch (_) { return null; }
}

async function runHybridAi({ quizId, attemptId, answers, configQuestions }) {
    const t0 = Date.now();
    const logPrefix = `[HYBRID_AI][quizId=${quizId || '-'}][attemptId=${attemptId ? String(attemptId) : '-'}]`;
    
    // 1. Tính toán điểm kỹ năng từ logic cứng (nếu hàm này trả về object các kỹ năng)
    let derivedSkillScores = typeof deriveSkillScoresFromAnswers === 'function' 
        ? deriveSkillScoresFromAnswers(configQuestions, answers) 
        : { "Logic": 0, "Kỹ thuật": 0, "Sáng tạo": 0, "Giao tiếp": 0, "Ngoại ngữ": 0 };

    const submittedAnswerEvidence = buildSubmittedAnswerEvidence(configQuestions || [], answers || {});
    const evidenceCount = Array.isArray(submittedAnswerEvidence) ? submittedAnswerEvidence.length : 0;

    const apiKeys = Array.from(new Set([GEMINI_API_KEY, ...GEMINI_API_KEYS].filter(Boolean)));
    const model = GEMINI_MODEL;

    // Hàm trả về trạng thái lỗi (Điểm về 0, Ngành là "Lỗi AI")
    const returnErrorState = (msg, rawError = null) => {
        const baselineLocal = typeof baselineMajorsFromSkills === 'function'
            ? baselineMajorsFromSkills(derivedSkillScores)
            : [];
        const fallbackMajors = baselineLocal.slice(0, 3);
        const trendSignals = buildProfessionalFallbackNarrative(derivedSkillScores, fallbackMajors);
        return {
            provider: 'gemini',
            latencyMs: Date.now() - t0,
            fallbackUsed: true,
            aiRawResponse: rawError,
            derivedSkillScores,
            suggestedMajors: fallbackMajors.length ? fallbackMajors : [{
                majorName: 'Lỗi AI',
                score: 0,
                reasons: ["Không thể kết nối với trí tuệ nhân tạo"],
                matchedSkills: []
            }],
            explanationSummary: fallbackMajors.length
                ? `AI tạm thời lỗi. Đang dùng gợi ý dự phòng từ điểm bài làm. (${msg})`
                : msg,
            trendSignals,
            promptSnapshot: ''
        };
    };

    const majorsList = [
        'Lập trình Web',
        'Lập trình Mobile',
        'Lập trình Game',
        'Phát triển Phần mềm',
        'Lập trình Ứng dụng Trí tuệ nhân tạo (AI)',
        'Ứng dụng phần mềm',
        'Quản trị kinh doanh - Digital Marketing',
        'Quản trị kinh doanh - Marketing & Sales',
        'Quản trị kinh doanh - Truyền thông & Tổ chức sự kiện',
        'Quản trị dịch vụ du lịch và lữ hành',
        'Quản trị khách sạn nhà hàng',
        'Quản lý vận tải và dịch vụ logistics',
        'Công nghệ kỹ thuật điện, điện tử',
        'CN kỹ thuật điều khiển & tự động hoá',
        'Công nghệ Chip & Bán dẫn',
        'Thiết kế đồ hoạ',
        'Công nghệ kỹ thuật cơ khí',
        'Tiếng Trung Quốc',
        'Tiếng Hàn Quốc',
        'Tiếng Anh',
        'Tiếng Nhật',
        'Dược'
    ];

    const baseline = typeof baselineMajorsFromSkills === 'function' ? baselineMajorsFromSkills(derivedSkillScores) : [];
    const topSkills = Object.entries(derivedSkillScores || {})
        .map(([k, v]) => ({ k: String(k), v: Number(v) }))
        .filter(x => Number.isFinite(x.v))
        .sort((a, b) => b.v - a.v)
        .slice(0, 6);

    const hasSignal = topSkills.length > 0 && topSkills[0].v > 0;
    if (!hasSignal) {
        console.warn(`${logPrefix} skip_ai reason=no_skill_signal topSkills=${JSON.stringify(topSkills.slice(0, 3))}`);
        return {
            provider: 'rules',
            modelName: '',
            latencyMs: Date.now() - t0,
            fallbackUsed: true,
            aiRawResponse: null,
            derivedSkillScores,
            suggestedMajors: [],
            explanationSummary: 'Chưa đủ tín hiệu để gợi ý chuyên ngành (điểm kỹ năng không đủ phân biệt).',
            trendSignals: { strengths: [], risks: [], marketNote: "" },
            promptSnapshot: ''
        };
    }

    if (!submittedAnswerEvidence.length) {
        console.warn(`${logPrefix} skip_ai reason=no_submitted_answer_evidence configQuestions=${Array.isArray(configQuestions) ? configQuestions.length : 0}`);
        return {
            provider: 'rules',
            modelName: '',
            latencyMs: Date.now() - t0,
            fallbackUsed: true,
            aiRawResponse: null,
            derivedSkillScores,
            suggestedMajors: [],
            explanationSummary: 'Không đọc được chi tiết câu trả lời (thiếu khớp mã câu hỏi với cấu hình đề). Vui lòng nộp bài lại hoặc kiểm tra bài thi.',
            trendSignals: { strengths: [], risks: [], marketNote: '' },
            promptSnapshot: ''
        };
    }

    if (HYBRID_AI_PROVIDER !== 'gemini') {
        console.error(`${logPrefix} provider_error provider=${HYBRID_AI_PROVIDER}`);
        return returnErrorState(`Unsupported HYBRID_AI_PROVIDER: ${HYBRID_AI_PROVIDER}`);
    }
    if (!apiKeys.length) {
        console.error(`${logPrefix} config_error missing=GEMINI_API_KEY or GEMINI_API_KEYS`);
        return returnErrorState('Missing GEMINI_API_KEY in environment');
    }

    const promptText = [
        'Vai trò: chuyên gia tư vấn hướng nghiệp dựa trên dữ liệu bài làm.',
        '',
        'Mục tiêu:',
        '- Chọn tối đa 3 ngành trong majorsList phù hợp nhất với thí sinh.',
        '- Nếu tín hiệu yếu hoặc mâu thuẫn, có thể trả suggestedMajors theo xu hướng từ trendSignals.',
        '',
        'Ưu tiên dữ liệu (theo thứ tự):',
        '1) submittedAnswerEvidence (quan trọng nhất, phải bám trực tiếp đáp án đã chọn).',
        '2) derivedSkillScores (dùng để kiểm tra chéo, không được mâu thuẫn).',
        '3) trendSignals (chỉ tham khảo).',
        '',
        'Quy tắc bắt buộc:',
        '- Chỉ dùng majorName nằm trong majorsList.',
        '- Mỗi ngành phải có reasons gắn với bằng chứng cụ thể (ưu tiên nêu Q{order}).',
        '- Không dùng lập luận chung chung áp cho mọi thí sinh.',
        '- Nếu thuộc nhóm CNTT/Kinh doanh/Kỹ thuật, phải ưu tiên trả ngành con cụ thể (ví dụ Web/Mobile/Game/AI...) thay vì tên nhóm chung.',
        '- Không mặc định "Lập trình Web" nếu bằng chứng không nghiêng về CNTT.',
        '- Bỏ qua mọi ngành "(dự kiến)" hoặc chưa tuyển sinh ổn định.',
        '- Score phải có phân hạng rõ; tránh 90/90/90 nếu không có bằng chứng tương đương.',
        '- Nếu bằng chứng chưa đủ: suggestedMajors=[], explanationSummary nêu rõ "chưa đủ tín hiệu từ bài làm".',
        '',
        'Yêu cầu độ dài để tránh tràn token:',
        '- Mỗi reasons item <= 20 từ.',
        '- explanationSummary <= 80 từ.',
        '',
        'Output duy nhất là JSON object hợp lệ theo schema:',
        '{',
        '  "suggestedMajors":[{"majorName":"...","score":0-100,"reasons":["..."],"matchedSkills":["..."]}],',
        '  "explanationSummary":"...",',
        '  "trendSignals":{"strengths":["..."],"risks":["..."],"marketNote":"..."}',
        '}',
        '',
        'Input JSON:',
        JSON.stringify({
            quizId,
            attemptId: attemptId ? String(attemptId) : null,
            submittedAnswerEvidence,
            derivedSkillScores,
            topSkills,
            baselineSuggestions: baseline,
            majorsList
        })
    ].join('\n');

    try {
        const modelCandidates = [String(model || '').trim()].filter(Boolean);
        console.log(`${logPrefix} start provider=${HYBRID_AI_PROVIDER} models=${modelCandidates.join(',')} keyCount=${apiKeys.length} evidenceCount=${evidenceCount} promptChars=${promptText.length}`);
        let lastError = null;
        let leakedKeyDetected = false;

        for (const apiKey of apiKeys) {
            const keySuffix = apiKey.slice(-6);
            for (const mdl of modelCandidates) {
                try {
                    console.log(`${logPrefix} call_model model=${mdl} keySuffix=***${keySuffix} maxOutputTokens=${GEMINI_MAX_OUTPUT_TOKENS}`);
                    const resp = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': apiKey
                      },
                      body: JSON.stringify({
                        contents: [
                          {
                            role: "user",
                            parts: [{
                              text: `
Bạn là AI hướng nghiệp. Chỉ trả về 1 JSON object hợp lệ, không markdown, không text thừa.

${promptText}
                              `
                            }]
                          }
                        ],
                        generationConfig: {
                            temperature: 0.45,
                            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                            thinkingConfig: {
                              thinkingBudget: 0
                            },
                            responseMimeType: 'application/json'
                          }
                      })
                    }
                  );

                    if (!resp.ok) {
                        const errTxt = await resp.text();
                        lastError = `Gemini ${mdl} HTTP ${resp.status}: ${errTxt.slice(0, 500)}`;
                        if (resp.status === 403 && /reported as leaked/i.test(errTxt)) {
                            leakedKeyDetected = true;
                            console.error(`${logPrefix} key_blocked keySuffix=***${keySuffix} ${lastError}`);
                        } else {
                            console.error(`${logPrefix} ${lastError}`);
                        }
                        continue;
                    }

                    const data = await resp.json();
                    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const finishReason = String(data?.candidates?.[0]?.finishReason || '');
                    const usage = data?.usageMetadata || {};
                    let parsed = extractJsonObject(content);
                    if (!parsed) parsed = tryRecoverJsonObject(content);
                    if (!parsed || !Array.isArray(parsed.suggestedMajors) || parsed.suggestedMajors.length === 0) {
                        lastError = `Gemini ${mdl} invalid payload`;
                        console.error(`${logPrefix} ${lastError} finishReason=${finishReason} promptTokens=${usage.promptTokenCount || 0} outputTokens=${usage.candidatesTokenCount || 0} thoughtsTokens=${usage.thoughtsTokenCount || 0} contentLength=${content.length} content=${content ? content.slice(0, 400) : '<empty>'}`);
                        continue;
                    }

                    const mapped = parsed.suggestedMajors.map(m => ({
                        majorName: String(m.majorName || 'Unknown'),
                        score: Number(m.score || 0),
                        reasons: Array.isArray(m.reasons) ? m.reasons : [],
                        matchedSkills: Array.isArray(m.matchedSkills) ? m.matchedSkills : []
                    }));
                    const suggestedMajors = mergeSuggestedMajorsScoresFromBaseline(mapped, baseline);

               
                

                    return {
                        provider: 'gemini',
                        modelName: mdl,
                        latencyMs: Date.now() - t0,
                        fallbackUsed: false,
                        aiRawResponse: data,
                        derivedSkillScores,
                        suggestedMajors,
                        explanationSummary: String(parsed.explanationSummary || ''),
                        trendSignals: parsed.trendSignals || { strengths: [], risks: [], marketNote: "" },
                        promptSnapshot: truncateForPrompt(promptText, 14000)
                    };
                } catch (innerErr) {
                    lastError = `Gemini ${mdl} exception: ${innerErr.message || innerErr}`;
                    console.error(`${logPrefix} ${lastError}`);
                }
            }
        }

        if (leakedKeyDetected) {
            console.error(`${logPrefix} fallback_used reason=gemini_api_key_blocked lastError=${String(lastError || '')}`);
            return returnErrorState('Gemini API key đã bị khóa (leaked). Vui lòng thay key mới', lastError);
        }
        console.error(`${logPrefix} fallback_used reason=gemini_unavailable lastError=${String(lastError || '')}`);
        return returnErrorState('Lỗi kết nối Gemini API', lastError);
    } catch (e) {
        console.error(`${logPrefix} fatal_error`, e);
        return returnErrorState('Lỗi hệ thống', e.message);
    }
}

function buildFallbackAssessmentConfigFromQuiz(quiz) {
    const qs = Array.isArray(quiz?.questions) ? quiz.questions : [];
    // Map each quiz question into an "assessment config question" shape so hybrid-ai can run
    // even when no AssessmentConfig exists yet.
    function inferCompetencyTags(questionText) {
        return inferCompetencyTagsFromText(questionText);
    }

    return qs.map((q, idx) => {
        const questionId = String(
            q?.originalIndex !== undefined && q?.originalIndex !== null ? q.originalIndex : idx
        );
        const tags = inferCompetencyTags(q?.question || '');
        return {
            questionId,
            type: 'single',
            question: String(q?.question || ''),
            options: Array.isArray(q?.options) ? q.options.map(x => String(x)) : [],
            weight: 1,
            reverseScore: false,
            skillTags: tags
        };
    });
}

function inferCompetencyTagsFromText(questionText) {
    const t = String(questionText || '').toLowerCase();
    const tags = new Set();

    if (/(lãnh đạo|lanh dao|leadership|leader|quản lý|quan ly|điều phối|dieu phoi|chỉ huy|chi huy)/i.test(t)) tags.add('leadership');
    if (/(làm việc nhóm|lam viec nhom|teamwork|team|phối hợp|phoi hop|hợp tác|hop tac)/i.test(t)) tags.add('teamwork');
    if (/(giao tiếp|giao tiep|communication|thuyết trình|thuyet trinh|trình bày|trinh bay|đàm phán|dam phan)/i.test(t)) tags.add('communication');

    if (/(tư duy logic|logic|suy luận|suy luan|thuật toán|thuat toan|problem solving|giải quyết vấn đề|giai quyet van de)/i.test(t)) tags.add('logical');
    if (/(phân tích|phan tich|analysis|dữ liệu|du lieu|data|thống kê|thong ke)/i.test(t)) tags.add('analysis');
    if (/(sáng tạo|sang tao|creativity|ý tưởng|y tuong|thiết kế|thiet ke|design|đồ hoạ|do hoa|visual)/i.test(t)) tags.add('creativity');

    if (/(tỉ mỉ|ti mi|cẩn thận|can than|chi tiết|chi tiet|detail|kỷ luật|ky luat|kiên trì|kien tri)/i.test(t)) tags.add('detail');
    if (/(ngoại ngữ|ngoai ngu|english|tiếng anh|tieng anh|japan|nhật|han|hàn|trung|chinese)/i.test(t)) tags.add('language');

    if (tags.size === 0) tags.add('general');
    return Array.from(tags);
}

async function ensureAssessmentConfigWithTags({ quizId, quiz }) {
    let cfg = await AssessmentConfig.findOne({ quizId }).sort({ version: -1, createdAt: -1 }).lean();
    if (!cfg || !Array.isArray(cfg.questions) || cfg.questions.length === 0) {
        const questions = buildFallbackAssessmentConfigFromQuiz(quiz);
        cfg = await AssessmentConfig.create({ quizId, version: 1, questions });
        return cfg;
    }

    const nonEmptyTags = cfg.questions
        .flatMap(q => (Array.isArray(q.skillTags) ? q.skillTags : []))
        .map(t => String(t || '').trim())
        .filter(Boolean);

    // Upgrade if no tags OR tags look like legacy numeric ids (e.g. "123") instead of competencies.
    const hasAnyTags = nonEmptyTags.length > 0;
    const looksLegacyNumericTags = hasAnyTags && nonEmptyTags.every(t => /^\d+$/.test(t));
    if (hasAnyTags && !looksLegacyNumericTags) return cfg;

    const upgradedQuestions = cfg.questions.map(q => ({
        ...q,
        skillTags: inferCompetencyTagsFromText(q.question || '')
    }));
    cfg = await AssessmentConfig.create({ quizId, version: Number(cfg.version || 1) + 1, questions: upgradedQuestions });
    return cfg;
}

// Submit assessment attempt -> run hybrid AI -> save AI run -> return chart-ready payload
app.post('/api/assessments/:quizId/submit', async (req, res) => {
    try {
        const quizId = String(req.params.quizId || '').trim();
        const { studentName, studentPhone, studentDob, studentAddress, studentSchool, studentCode, classCode, subjectCode, studentEmail, answers, macAddress, clientMeta } = req.body || {};
        if (!quizId) return res.status(400).json({ error: 'Missing quizId' });
        if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Missing answers' });

        const quiz = await Quiz.findOne({ id: quizId });
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (!quiz.assessmentEnabled) return res.status(400).json({ error: 'Assessment not enabled for this quiz' });

        const cfg = await ensureAssessmentConfigWithTags({ quizId, quiz });

        const mergedClientMeta = {
            ...(clientMeta || {}),
            macAddress: macAddress ? String(macAddress) : undefined,
            userAgent: String(req.headers['user-agent'] || ''),
            ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '')
        };

        const attempt = await AssessmentAttempt.create({
            quizId,
            studentName: String(studentName || ''),
            studentPhone: String(studentPhone || ''),
            studentDob: String(studentDob || ''),
            studentAddress: String(studentAddress || ''),
            studentSchool: String(studentSchool || ''),
            studentCode: String(studentCode || ''),
            classCode: String(classCode || ''),
            subjectCode: String(subjectCode || ''),
            studentEmail: String(studentEmail || ''),
            answers,
            submittedAt: new Date(),
            clientMeta: mergedClientMeta
        });

        const ai = await runHybridAi({ quizId, attemptId: attempt._id, answers, configQuestions: cfg.questions });
        const run = await AssessmentAiRun.create({
            attemptId: attempt._id,
            quizId,
            derivedSkillScores: ai.derivedSkillScores,
            suggestedMajors: ai.suggestedMajors,
            explanationSummary: ai.explanationSummary,
            trendSignals: ai.trendSignals,
            provider: ai.provider,
            modelName: ai.modelName,
            modelParams: ai.modelParams,
            latencyMs: ai.latencyMs,
            fallbackUsed: ai.fallbackUsed,
            promptSnapshot: ai.promptSnapshot,
            aiRawResponse: ai.aiRawResponse
        });

        res.json({
            success: true,
            attemptId: attempt._id,
            aiRunId: run._id,
            quizId,
            aiStatus: run.provider === 'gemini' && !!run.fallbackUsed ? 'error' : 'ok',
            student: {
                studentName: attempt.studentName,
                studentPhone: attempt.studentPhone,
                studentDob: attempt.studentDob,
                studentAddress: attempt.studentAddress,
                studentSchool: attempt.studentSchool,
                studentCode: attempt.studentCode,
                classCode: attempt.classCode,
                subjectCode: attempt.subjectCode,
                studentEmail: attempt.studentEmail,
                submittedAt: attempt.submittedAt,
                clientMeta: attempt.clientMeta || {}
            },
            derivedSkillScores: run.derivedSkillScores,
            suggestedMajors: run.suggestedMajors,
            explanationSummary: run.explanationSummary,
            trendSignals: run.trendSignals
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Backward-compatible endpoint used by public/assessment.html
// Accepts quizId in body and returns the same payload as /api/assessments/:quizId/submit
app.post('/api/submit/hybrid-ai', async (req, res) => {
    try {
        const { quizId, studentName, studentPhone, studentDob, studentAddress, studentSchool, studentCode, classCode, subjectCode, studentEmail, answers, macAddress, clientMeta } = req.body || {};
        const qid = String(quizId || '').trim();
        if (!qid) return res.status(400).json({ error: 'Missing quizId' });
        if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Missing answers' });
        console.log(`[SUBMIT_HYBRID_AI][quizId=${qid}] incoming answers=${Object.keys(answers || {}).length} student=${String(studentName || '').slice(0, 80)}`);

        const quiz = await Quiz.findOne({ id: qid });
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (!quiz.assessmentEnabled) return res.status(400).json({ error: 'Assessment not enabled for this quiz' });

        const cfg = await ensureAssessmentConfigWithTags({ quizId: qid, quiz });

        const mergedClientMeta = {
            ...(clientMeta || {}),
            macAddress: macAddress ? String(macAddress) : undefined,
            userAgent: String(req.headers['user-agent'] || ''),
            ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '')
        };

        const attempt = await AssessmentAttempt.create({
            quizId: qid,
            studentName: String(studentName || ''),
            studentPhone: String(studentPhone || ''),
            studentDob: String(studentDob || ''),
            studentAddress: String(studentAddress || ''),
            studentSchool: String(studentSchool || ''),
            studentCode: String(studentCode || ''),
            classCode: String(classCode || ''),
            subjectCode: String(subjectCode || ''),
            studentEmail: String(studentEmail || ''),
            answers,
            submittedAt: new Date(),
            clientMeta: mergedClientMeta
        });

        const ai = await runHybridAi({ quizId: qid, attemptId: attempt._id, answers, configQuestions: cfg.questions });
        console.log(`[SUBMIT_HYBRID_AI][quizId=${qid}][attemptId=${attempt._id}] ai_done fallbackUsed=${!!ai?.fallbackUsed} model=${ai?.modelName || ''} latencyMs=${Number(ai?.latencyMs || 0)}`);
  
        const run = await AssessmentAiRun.create({
            attemptId: attempt._id,
            quizId: qid,
            derivedSkillScores: ai.derivedSkillScores,
            suggestedMajors: ai.suggestedMajors,
            explanationSummary: ai.explanationSummary,
            trendSignals: ai.trendSignals,
            provider: ai.provider,
            modelName: ai.modelName,
            modelParams: ai.modelParams,
            latencyMs: ai.latencyMs,
            fallbackUsed: ai.fallbackUsed,
            promptSnapshot: ai.promptSnapshot,
            aiRawResponse: ai.aiRawResponse
        });

        res.json({
            success: true,
            attemptId: attempt._id,
            aiRunId: run._id,
            quizId: qid,
            aiStatus: run.provider === 'gemini' && !!run.fallbackUsed ? 'error' : 'ok',
            student: {
                studentName: attempt.studentName,
                studentPhone: attempt.studentPhone,
                studentDob: attempt.studentDob,
                studentAddress: attempt.studentAddress,
                studentSchool: attempt.studentSchool,
                studentCode: attempt.studentCode,
                classCode: attempt.classCode,
                subjectCode: attempt.subjectCode,
                studentEmail: attempt.studentEmail,
                submittedAt: attempt.submittedAt,
                clientMeta: attempt.clientMeta || {}
            },
            derivedSkillScores: run.derivedSkillScores,
            suggestedMajors: run.suggestedMajors,
            explanationSummary: run.explanationSummary,
            trendSignals: run.trendSignals
        });
    } catch (e) {
        console.error('[SUBMIT_HYBRID_AI] failed', {
            message: e?.message || 'Unknown error',
            stack: e?.stack || ''
        });
        res.status(500).json({ error: 'Server error' });
    }
});

// Get attempt detail (answers + config + ai run)
app.get('/api/assessments/attempts/:attemptId', async (req, res) => {
    try {
        const attemptId = req.params.attemptId;
        const attempt = await AssessmentAttempt.findById(attemptId).lean();
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

        const cfg = await AssessmentConfig.findOne({ quizId: attempt.quizId }).sort({ version: -1, createdAt: -1 }).lean();
        const run = await AssessmentAiRun.findOne({ attemptId: attempt._id }).sort({ createdAt: -1 }).lean();
        if (!run) return res.status(404).json({ error: 'AI result not found' });
        const aiStatus = run.provider === 'gemini' && !!run.fallbackUsed ? 'error' : 'ok';

        res.json({
            attempt,
            config: cfg ? { quizId: cfg.quizId, version: cfg.version, questions: cfg.questions } : null,
            result: {
                ...run,
                aiStatus
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Retry AI run for an existing attempt (useful when provider was temporarily unavailable)
app.post('/api/assessments/attempts/:attemptId/retry-ai', async (req, res) => {
    try {
        const attemptId = String(req.params.attemptId || '').trim();
        if (!attemptId) return res.status(400).json({ error: 'Missing attemptId' });
        console.log(`[RETRY_AI][attemptId=${attemptId}] start`);

        const attempt = await AssessmentAttempt.findById(attemptId);
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

        const quiz = await Quiz.findOne({ id: attempt.quizId });
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const cfg = await ensureAssessmentConfigWithTags({ quizId: attempt.quizId, quiz });
        const ai = await runHybridAi({
            quizId: attempt.quizId,
            attemptId: attempt._id,
            answers: attempt.answers || {},
            configQuestions: cfg.questions
        });
        console.log(`[RETRY_AI][attemptId=${attemptId}] ai_done fallbackUsed=${!!ai?.fallbackUsed} model=${ai?.modelName || ''} latencyMs=${Number(ai?.latencyMs || 0)}`);
        const existingRun = await AssessmentAiRun.findOne({ attemptId: attempt._id }).sort({ createdAt: -1 });
        let run;
        if (existingRun) {
            existingRun.quizId = attempt.quizId;
            existingRun.derivedSkillScores = ai.derivedSkillScores;
            existingRun.suggestedMajors = ai.suggestedMajors;
            existingRun.explanationSummary = ai.explanationSummary;
            existingRun.trendSignals = ai.trendSignals;
            existingRun.provider = ai.provider;
            existingRun.modelName = ai.modelName;
            existingRun.modelParams = ai.modelParams;
            existingRun.latencyMs = ai.latencyMs;
            existingRun.fallbackUsed = ai.fallbackUsed;
            existingRun.promptSnapshot = ai.promptSnapshot;
            existingRun.aiRawResponse = ai.aiRawResponse;
            existingRun.createdAt = new Date(); // keep latest retry as newest snapshot
            run = await existingRun.save();
        } else {
            run = await AssessmentAiRun.create({
                attemptId: attempt._id,
                quizId: attempt.quizId,
                derivedSkillScores: ai.derivedSkillScores,
                suggestedMajors: ai.suggestedMajors,
                explanationSummary: ai.explanationSummary,
                trendSignals: ai.trendSignals,
                provider: ai.provider,
                modelName: ai.modelName,
                modelParams: ai.modelParams,
                latencyMs: ai.latencyMs,
                fallbackUsed: ai.fallbackUsed,
                promptSnapshot: ai.promptSnapshot,
                aiRawResponse: ai.aiRawResponse
            });
        }

        res.json({
            success: true,
            attemptId: attempt._id,
            aiRunId: run._id,
            aiStatus: run.provider === 'gemini' && !!run.fallbackUsed ? 'error' : 'ok',
            derivedSkillScores: run.derivedSkillScores,
            suggestedMajors: run.suggestedMajors,
            explanationSummary: run.explanationSummary,
            trendSignals: run.trendSignals
        });
    } catch (e) {
        console.error('[RETRY_AI] failed', {
            message: e?.message || 'Unknown error',
            stack: e?.stack || '',
            attemptId: String(req.params?.attemptId || '')
        });
        res.status(500).json({ error: 'Server error' });
    }
});

// List attempts (optionally filter by quizId / email)
app.get('/api/assessments/attempts', async (req, res) => {
    try {
        const quizId = req.query.quizId ? String(req.query.quizId).trim() : '';
        const email = req.query.email ? String(req.query.email).trim() : '';
        const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50));
        const skip = Math.max(0, parseInt(String(req.query.skip || '0'), 10) || 0);

        const q = {};
        if (quizId) q.quizId = quizId;
        if (email) q.studentEmail = email;

        const attempts = await AssessmentAttempt.find(q)
            .sort({ submittedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const withAi = await Promise.all(attempts.map(async (a) => {
            const run = await AssessmentAiRun.findOne({ attemptId: a._id }).sort({ createdAt: -1 }).lean();
            const top = run?.suggestedMajors?.[0] || null;
            const aiStatus = run
                ? (run.provider === 'gemini' && !!run.fallbackUsed ? 'error' : 'ok')
                : 'missing';
            return {
                attemptId: a._id,
                quizId: a.quizId,
                studentName: a.studentName || '',
                studentPhone: a.studentPhone || '',
                studentCode: a.studentCode || '',
                classCode: a.classCode || '',
                subjectCode: a.subjectCode || '',
                studentEmail: a.studentEmail || '',
                submittedAt: a.submittedAt,
                clientMeta: a.clientMeta || {},
                topMajor: top ? { majorName: top.majorName, score: top.score } : null,
                provider: run?.provider || null,
                fallbackUsed: !!run?.fallbackUsed,
                aiStatus
            };
        }));

        res.json({ success: true, total: withAi.length, items: withAi });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

function csvCell(v) {
    const s = String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
}

function csvTextPreserve(v) {
    // Prevent Excel/Sheets from stripping leading zeros by exporting as a string formula.
    // Example: 0901... -> ="0901..."
    const s = String(v ?? '');
    const safe = s.replace(/"/g, '""');
    return `="` + safe + `"`;
}

function getVietnamDaySheetName(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = String(dt.getFullYear());
    return `${day}-${month}-${year}`;
}

function parseGooglePrivateKey(raw) {
    return String(raw || '').replace(/\\n/g, '\n');
}

async function appendRowsToGoogleSheetsDailyTab({ rows, dayDate }) {
    const clientEmail = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '').trim();
    const privateKey = parseGooglePrivateKey(process.env.GOOGLE_SHEETS_PRIVATE_KEY);
    const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();

    if (!clientEmail || !privateKey || !spreadsheetId) {
        throw new Error('Missing Google Sheets env config');
    }

    const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const tabName = getVietnamDaySheetName(dayDate || new Date());

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = (meta.data.sheets || []).some(s => String(s.properties?.title || '') === tabName);

    if (!exists) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: tabName } } }]
            }
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${tabName}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [rows[0]] }
        });
    }

    // Always append data rows only; header is written once when sheet is first created.
    const payloadRows = rows.slice(1);
    if (payloadRows.length > 0) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${tabName}!A1`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: payloadRows }
        });
    }

    return { tabName, spreadsheetId, appendedRows: payloadRows.length };
}

// Export attempts as CSV (full student info + AI result) for Google Sheets
// NOTE: use a non-conflicting route name because /api/assessments/attempts/:attemptId exists.
app.get('/api/assessments/attempts-export', async (req, res) => {
    try {
        const quizId = req.query.quizId ? String(req.query.quizId).trim() : '';
        const email = req.query.email ? String(req.query.email).trim() : '';
        const limit = Math.max(1, Math.min(2000, parseInt(String(req.query.limit || '2000'), 10) || 2000));

        const q = {};
        if (quizId) q.quizId = quizId;
        if (email) q.studentEmail = email;

        const attempts = await AssessmentAttempt.find(q)
            .sort({ submittedAt: -1 })
            .limit(limit)
            .lean();

        const headers = [
            'StudentName',
            'StudentPhone',
            'StudentEmail',
            'StudentDob',
            'StudentAddress',
            'StudentSchool',
            'SuggestedMajor'
        ];

        const rows = [headers];

        for (const a of attempts) {
            const run = await AssessmentAiRun.findOne({ attemptId: a._id }).sort({ createdAt: -1 }).lean();
            const majors = Array.isArray(run?.suggestedMajors) ? run.suggestedMajors : [];
            const m1 = majors[0] || {};
            const m2 = majors[1] || {};
            const m3 = majors[2] || {};
            const trend = run?.trendSignals || {};

            rows.push([
                a.studentName || '',
                csvTextPreserve(a.studentPhone || ''),
                a.studentEmail || '',
                a.studentDob || '',
                a.studentAddress || '',
                a.studentSchool || '',
                m1.majorName || ''
            ]);
        }

        const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
        const fileTag = quizId ? quizId : 'all';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="assessment-attempts-${fileTag}.csv"`);
        // BOM for Excel/Google Sheets UTF-8
        res.send('\uFEFF' + csv);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Export attempts directly to Google Sheets daily tab (no file download)
app.post('/api/assessments/attempts-export-sheets', async (req, res) => {
    try {
        const quizId = req.body?.quizId ? String(req.body.quizId).trim() : '';
        const email = req.body?.email ? String(req.body.email).trim() : '';
        const limit = Math.max(1, Math.min(2000, parseInt(String(req.body?.limit || '2000'), 10) || 2000));

        const q = {};
        if (quizId) q.quizId = quizId;
        if (email) q.studentEmail = email;

        const attempts = await AssessmentAttempt.find(q)
            .sort({ submittedAt: -1 })
            .limit(limit)
            .lean();

        const headers = [
            'StudentName',
            'StudentPhone',
            'StudentEmail',
            'StudentDob',
            'StudentAddress',
            'StudentSchool',
            'SuggestedMajor',
            'SubmittedAt'
        ];
        const rows = [headers];

        for (const a of attempts) {
            const run = await AssessmentAiRun.findOne({ attemptId: a._id }).sort({ createdAt: -1 }).lean();
            const majors = Array.isArray(run?.suggestedMajors) ? run.suggestedMajors : [];
            const m1 = majors[0] || {};
            rows.push([
                String(a.studentName || ''),
                String(a.studentPhone || ''),
                String(a.studentEmail || ''),
                String(a.studentDob || ''),
                String(a.studentAddress || ''),
                String(a.studentSchool || ''),
                String(m1.majorName || ''),
                a.submittedAt ? new Date(a.submittedAt).toISOString() : ''
            ]);
        }

        const out = await appendRowsToGoogleSheetsDailyTab({ rows, dayDate: new Date() });
        res.json({
            success: true,
            mode: 'google-sheets',
            tabName: out.tabName,
            spreadsheetId: out.spreadsheetId,
            appendedRows: out.appendedRows,
            totalAttempts: attempts.length
        });
    } catch (e) {
        console.error('[EXPORT_SHEETS] failed', {
            message: e?.message || 'Unknown error',
            stack: e?.stack || '',
            body: req?.body || {}
        });
        res.status(500).json({
            error: 'Failed to export to Google Sheets',
            detail: e.message || 'Unknown error'
        });
    }
});

// Trends per quizId (daily avg skill scores + top majors distribution)
app.get('/api/assessments/:quizId/trends', async (req, res) => {
    try {
        const quizId = String(req.params.quizId || '').trim();
        if (!quizId) return res.status(400).json({ error: 'Missing quizId' });

        const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const to = req.query.to ? new Date(String(req.query.to)) : new Date();

        const runs = await AssessmentAiRun.aggregate([
            { $match: { quizId, createdAt: { $gte: from, $lte: to } } },
            {
                $project: {
                    day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    derivedSkillScores: 1,
                    suggestedMajors: 1
                }
            },
            { $sort: { day: 1 } }
        ]);

        const byDay = new Map(); // day -> { count, skillSums, majorCounts }

        for (const r of runs) {
            const day = r.day;
            if (!byDay.has(day)) byDay.set(day, { count: 0, skillSums: {}, majorCounts: {} });
            const bucket = byDay.get(day);
            bucket.count++;

            const scores = r.derivedSkillScores || {};
            for (const [k, v] of Object.entries(scores)) {
                const num = Number(v);
                if (!Number.isFinite(num)) continue;
                bucket.skillSums[k] = (bucket.skillSums[k] || 0) + num;
            }

            const majors = Array.isArray(r.suggestedMajors) ? r.suggestedMajors : [];
            for (const m of majors) {
                const name = String(m.majorName || m.major || '').trim();
                if (!name) continue;
                bucket.majorCounts[name] = (bucket.majorCounts[name] || 0) + 1;
            }
        }

        const days = Array.from(byDay.keys()).sort();
        const series = days.map(d => {
            const b = byDay.get(d);
            const avgSkillScores = {};
            for (const [k, sum] of Object.entries(b.skillSums)) {
                avgSkillScores[k] = Math.round((sum / b.count) * 10) / 10;
            }
            const majorDistribution = Object.entries(b.majorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([majorName, count]) => ({ majorName, count }));
            return { date: d, attemptCount: b.count, avgSkillScores, majorDistribution };
        });

        res.json({ quizId, from, to, series });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Quiz by ID
app.get('/api/assessments/quizzes', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const query = { assessmentEnabled: true };
        if (search) {
            query.$or = [
                { quizTitle: { $regex: search, $options: 'i' } },
                { title: { $regex: search, $options: 'i' } },
                { id: { $regex: search, $options: 'i' } }
            ];
        }

        const items = await Quiz.find(query)
            .select('id quizTitle title createdAt teacherName teacherEmail startTime endTime questions randomCount')
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();
        const quizIds = items.map(q => String(q.id || '')).filter(Boolean);
        const attemptAgg = quizIds.length
            ? await AssessmentAttempt.aggregate([
                { $match: { quizId: { $in: quizIds } } },
                { $group: { _id: '$quizId', count: { $sum: 1 } } }
            ])
            : [];
        const attemptCountByQuizId = new Map(
            attemptAgg.map(x => [String(x._id || ''), Number(x.count || 0)])
        );

        res.json({
            success: true,
            total: items.length,
            items: items.map(q => ({
                id: String(q.id || ''),
                title: String(q.quizTitle || q.title || 'Untitled Assessment'),
                questionCount: Array.isArray(q.questions) ? q.questions.length : 0,
                attemptCount: attemptCountByQuizId.get(String(q.id || '')) || 0,
                createdAt: q.createdAt || null,
                teacherName: String(q.teacherName || ''),
                teacherEmail: String(q.teacherEmail || ''),
                startTime: q.startTime || null,
                endTime: q.endTime || null
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Quiz by ID
app.get('/api/quiz/:id', async (req, res) => {
    try {
        const quiz = await Quiz.findOne({ id: req.params.id });
        if (quiz) {
            res.json(quiz);
        } else {
            res.status(404).json({ error: 'Quiz not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Submit Quiz
app.post('/api/submit', async (req, res) => {
    try {
        const { quizId, studentName, studentCode, classCode, subjectCode, studentEmail, answers, macAddress } = req.body;

        if (!quizId || !studentName || !studentCode || !classCode || !subjectCode || !studentEmail || !answers) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const quiz = await Quiz.findOne({ id: quizId });
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const now = new Date();
        if (quiz.startTime && new Date(quiz.startTime) > now) {
            return res.status(403).json({ error: 'Quiz has not started yet.' });
        }
        if (quiz.endTime && new Date(quiz.endTime) < now) {
            return res.status(403).json({ error: 'Quiz has ended.' });
        }

        let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        let normalizedClientIp = clientIp.includes(',') ? clientIp.split(',')[0].trim() : clientIp.trim();

        if (normalizedClientIp === '::1') {
            normalizedClientIp = '127.0.0.1';
        }
        if (normalizedClientIp.startsWith('::ffff:')) {
            normalizedClientIp = normalizedClientIp.substring(7);
        }

        if (quiz.allowedIPs && quiz.allowedIPs.length > 0) {
            if (!quiz.allowedIPs.includes(normalizedClientIp)) {
                return res.status(403).json({ error: `Access denied. Your IP address (${normalizedClientIp}) is not permitted to take this quiz.` });
            }
        }

        let score = 0;
        quiz.questions.forEach((q, index) => {
            const studentAnswer = answers[index];
            if (studentAnswer && studentAnswer.toString().trim() === q.correctAnswer.toString().trim()) {
                score++;
            }
        });

        console.log('Received submission:', { quizId, studentName, score });

        const submission = {
            id: uuidv4(),
            quizId,
            studentName,
            studentCode: studentCode || '',
            classCode: classCode || '',
            subjectCode: subjectCode || '',
            studentEmail: studentEmail || '',
            score,
            total: (quiz.randomCount && quiz.randomCount > 0 && quiz.randomCount < quiz.questions.length) ? quiz.randomCount : quiz.questions.length,
            submittedAt: new Date(),
            answers: answers,
            ipAddress: normalizedClientIp,
            macAddress: quiz.collectMAC ? (macAddress || 'unknown') : ''
        };

        // Save to MongoDB
        await Submission.create(submission);

        res.json({ success: true, message: 'Submission successful' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete Quiz
app.delete('/api/quiz/:id', async (req, res) => {
    try {
        const quizId = req.params.id;
        const { password } = req.body;

        const quiz = await Quiz.findOne({ id: quizId });
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        if (quiz.password && quiz.password !== password) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        // Delete files
        if (quiz.filePath) {
            const paths = quiz.filePath.split('|');
            paths.forEach(p => {
                if (fs.existsSync(p)) {
                    try {
                        fs.unlinkSync(p);
                        console.log(`Deleted file: ${p}`);
                    } catch (err) {
                        console.error('Error deleting file:', err);
                    }
                }
            });
        }

        // Delete from MongoDB
        await Quiz.deleteOne({ id: quizId });
        await Submission.deleteMany({ quizId: quizId });

        res.json({ success: true, message: 'Quiz deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Results
app.get('/api/results/:quizId', async (req, res) => {
    try {
        const quizId = req.params.quizId;
        const providedPassword = req.query.password;

        const quiz = await Quiz.findOne({ id: quizId });
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        if (quiz.password && quiz.password !== providedPassword) {
            return res.status(401).json({ error: 'Password required', passwordRequired: true });
        }

        const results = await Submission.find({ quizId: quizId });
        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get IP
app.get('/api/ip', (req, res) => {
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    if (clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }
    // Handle localhost IPv6 loopback
    if (clientIp === '::1') {
        clientIp = '127.0.0.1';
    }
    if (clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.substring(7);
    }
    res.json({ ip: clientIp });
});

// Export Results
app.get('/api/export-results/:quizId', async (req, res) => {
    try {
        const quizId = req.params.quizId;
        const quiz = await Quiz.findOne({ id: quizId });
        if (!quiz) {
            return res.status(404).send('Quiz not found');
        }

        const providedPassword = req.query.password;
        if (quiz.password && quiz.password !== providedPassword) {
            return res.status(401).send('Password required');
        }

        const quizSubmissions = await Submission.find({ quizId: quizId });

        const data = quizSubmissions.map(sub => {
            const row = {
                'Student Name': sub.studentName,
                'Student Code': sub.studentCode || '',
                'Student Email': sub.studentEmail || '',
                'Mark': sub.score,
                'Total Questions': sub.total,
                'Date Submitted': new Date(sub.submittedAt).toLocaleString()
            };

            const breakdown = {};
            quiz.questions.forEach((q, index) => {
                const studentAnswer = sub.answers ? (sub.answers[index] || sub.answers[String(index)]) : '';
                const isCorrect = String(studentAnswer).trim() === String(q.correctAnswer).trim();

                const skill = q.skillType || 'General';
                const segment = q.segmentName || 'General';
                const key = `${segment} - ${skill}`;

                if (!breakdown[key]) {
                    breakdown[key] = { total: 0, correct: 0 };
                }
                breakdown[key].total++;
                if (isCorrect) breakdown[key].correct++;
            });

            for (const key in breakdown) {
                const b = breakdown[key];
                const pct = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
                row[`Thống kê - ${key}`] = `${b.correct}/${b.total} (${pct}%)`;
            }

            quiz.questions.forEach((q, index) => {
                const studentAnswer = sub.answers ? (sub.answers[index] || sub.answers[String(index)]) : '';
                // Handle mixed array/object answers if legacy data differs
                row[`Q${index + 1}: ${q.question}`] = studentAnswer;
                row[`Correct Answer Q${index + 1}`] = q.correctAnswer;
            });

            return row;
        });

        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const safeTitle = (quiz.title || quiz.filename || 'quiz').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        res.setHeader('Content-Disposition', `attachment; filename="results-${safeTitle}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// --- Admin API (auth required) ---
function getAdminToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.slice(7).trim();
}

function requireAdmin(req, res, next) {
    const token = getAdminToken(req);
    if (!token || !adminTokens.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const data = adminTokens.get(token);
    if (data.exp < Date.now()) {
        adminTokens.delete(token);
        return res.status(401).json({ error: 'Token expired' });
    }
    next();
}

// Admin login (credentials from MongoDB)
app.post('/api/admin/login', async (req, res) => {
    try {
        await ensureDefaultAdmin();
        const rawUsername = (req.body && req.body.username) != null ? String(req.body.username) : '';
        const rawPassword = (req.body && req.body.password) != null ? String(req.body.password) : '';
        const username = rawUsername.trim();
        const password = rawPassword.trim();
        if (!username || !password) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        const passHash = crypto.createHash('sha256').update(password).digest('hex');
        let admin = await Admin.findOne({ username });
        if (!admin) {
            const count = await Admin.countDocuments();
            if (count === 0) {
                await ensureDefaultAdmin();
                admin = await Admin.findOne({ username });
            }
        }
        if (!admin || admin.passwordHash !== passHash) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        adminTokens.set(token, { exp: Date.now() + TOKEN_TTL_MS });
        res.json({ success: true, token });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin logout (optional: invalidate token)
app.post('/api/admin/logout', requireAdmin, (req, res) => {
    const token = getAdminToken(req);
    if (token) adminTokens.delete(token);
    res.json({ success: true });
});

// Admin stats: visits, by day, quiz count, by country
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [totalVisits, visitsByDay, quizCount, countryAgg] = await Promise.all([
            Visit.countDocuments(),
            Visit.aggregate([
                { $project: { day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } },
                { $group: { _id: '$day', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Quiz.countDocuments(),
            Visit.aggregate([
                { $group: { _id: '$country', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);
        const totalByCountry = countryAgg.reduce((s, c) => s + c.count, 0);
        const visitsByCountry = countryAgg.map(c => ({
            country: c._id || 'Unknown',
            count: c.count,
            percent: totalByCountry > 0 ? Math.round((c.count / totalByCountry) * 1000) / 10 : 0
        }));
        res.json({
            totalVisits,
            visitsByDay: visitsByDay.map(d => ({ date: d._id, count: d.count })),
            quizCount,
            visitsByCountry
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin storage: disk usage by uploads, mongo, etc.
function getDirSize(dirPath) {
    if (!fs.existsSync(dirPath)) return { size: 0, fileCount: 0 };
    let size = 0, fileCount = 0;
    const walk = (p) => {
        const stat = fs.statSync(p);
        if (stat.isFile()) { size += stat.size; fileCount++; return; }
        if (stat.isDirectory()) {
            try {
                fs.readdirSync(p).forEach(f => walk(path.join(p, f)));
            } catch (_) { }
        }
    };
    try { walk(dirPath); } catch (_) { }
    return { size, fileCount };
}

app.get('/api/admin/storage', requireAdmin, async (req, res) => {
    try {
        const uploadsPath = path.join(__dirname, 'uploads');
        const uploadsStat = getDirSize(uploadsPath);
        const mongoDumpPath = path.join(__dirname, 'mongo_dump');
        const mongoDumpStat = getDirSize(mongoDumpPath);
        const db = mongoose.connection.db;
        let collectionsSize = 0;
        let collectionsBreakdown = [];
        if (db) {
            const cols = await db.listCollections().toArray();
            for (const c of cols) {
                const stats = await db.collection(c.name).stats();
                const size = stats.size || 0;
                collectionsSize += size;
                collectionsBreakdown.push({ name: c.name, size });
            }
        }
        const total = uploadsStat.size + mongoDumpStat.size + collectionsSize;
        res.json({
            uploads: { size: uploadsStat.size, fileCount: uploadsStat.fileCount },
            mongoDump: { size: mongoDumpStat.size, fileCount: mongoDumpStat.fileCount },
            mongoCollections: { totalSize: collectionsSize, breakdown: collectionsBreakdown },
            total,
            totalMB: Math.round(total / 1024 / 1024 * 100) / 100
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin safe delete
app.post('/api/admin/delete', requireAdmin, async (req, res) => {
    try {
        const { type, days, quizId } = req.body || {};
        const result = { deleted: 0, message: '' };

        if (type === 'old_visits') {
            const d = typeof days === 'number' ? days : 90;
            const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
            const r = await Visit.deleteMany({ date: { $lt: cutoff } });
            result.deleted = r.deletedCount;
            result.message = `Deleted ${result.deleted} visit records older than ${d} days.`;
        } else if (type === 'orphan_files') {
            const quizzes = await Quiz.find({}).select('filePath').lean();
            const usedPaths = new Set(quizzes.map(q => q.filePath).filter(Boolean).map(p => path.resolve(p)));
            const uploadsDir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(uploadsDir)) {
                result.message = 'Uploads folder not found.';
                return res.json(result);
            }
            const files = fs.readdirSync(uploadsDir);
            let deleted = 0;
            for (const f of files) {
                const full = path.join(uploadsDir, f);
                try {
                    if (fs.statSync(full).isFile()) {
                        const resolved = path.resolve(full);
                        if (!usedPaths.has(resolved)) {
                            fs.unlinkSync(full);
                            deleted++;
                        }
                    }
                } catch (_) { }
            }
            result.deleted = deleted;
            result.message = `Deleted ${deleted} orphan file(s) in uploads.`;
        } else if (type === 'submissions_older_than' && quizId) {
            const d = typeof days === 'number' ? days : 365;
            const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
            const r = await Submission.deleteMany({ quizId, submittedAt: { $lt: cutoff } });
            result.deleted = r.deletedCount;
            result.message = `Deleted ${result.deleted} submission(s) for quiz ${quizId} older than ${d} days.`;
        } else if (type === 'all_visits') {
            const r = await Visit.deleteMany({});
            result.deleted = r.deletedCount;
            result.message = `Deleted all visit records (${result.deleted}).`;
        } else {
            return res.status(400).json({ error: 'Invalid type or missing params. Use: old_visits (days), orphan_files, submissions_older_than (quizId, days), all_visits.' });
        }
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// List quizzes for admin (for delete submissions by quiz)
app.get('/api/admin/quizzes', requireAdmin, async (req, res) => {
    try {
        const list = await Quiz.find({}).select('id title filename createdAt').sort({ createdAt: -1 }).lean();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

