// ============================================================
//  Backbone 情境圖生成器 — 後端伺服器
//  已依你的 API Reference 對準：
//   - Execute: POST /node-apps/49a0d905-aa8e-4de4-b5f2-687c53413e4e/execute
//   - 查狀態: GET /jobs/{jobId}，完成時圖片在 result.urls
//   - Body 欄位 key 見下方 FIELD_MAP
//  你的 API Key 只存在這裡（環境變數），前端永遠看不到。
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 設定（用環境變數，不要寫死）----
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_ENDPOINT = process.env.KREA_ENDPOINT
  || 'https://api.krea.ai/node-apps/49a0d905-aa8e-4de4-b5f2-687c53413e4e/execute';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// ---- 三張參考圖：required，用固定 URL（你調好的那三張）----
// ⚠️ 請把這三個換成你參考圖的「公開可存取」URL。
//    可放 GitHub、圖床、或這台伺服器的 /uploads。
//    沒填的話，Krea 因 required 會回 400。
const REF_IMAGES = {
  '1': process.env.REF_KENWEI || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/e04e98c0d4ebee04f18ae4503e73d0cd_vnpcls.jpg', // 圖1 鏡位參考（角度/構圖）
  '2': process.env.REF_LIGHT  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/f76189e81aa87a7bac0b44027a0eba92_uuwp5i.jpg', // 圖2 光影參考（光向/色溫）
  '3': process.env.REF_SCENE  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/c13c4e9597ffac87ae44de75484a0847_nx9cko.jpg', // 圖3 場景風格參考（空間/材質）
};

// ---- 前端 4 個上傳格 → Krea 產品照欄位 key 的對應 ----
const FIELD_MAP = {
  product_main: 'fe820f64-image', // 產品照（主體-保留原貌）← 必填
  product_45:   '45',             // 產品照-45度
  product_side: '3965e631-image', // 產品照-側面
  product_back: '0ef2230a-image', // 產品照-背面
};
// 正面欄位（App 也有 required 的正面），若前端沒有獨立「正面」格，
// 就用主視角那張填進去，避免 required 缺值。
const FRONT_KEY = '7ec743de-image'; // 產品照-正面

if (!KREA_API_KEY) console.warn('⚠️  尚未設定 KREA_API_KEY，呼叫 Krea 會失敗。');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
  filename: (_r, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('只接受圖片檔')),
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ============================================================
//  POST /api/generate  → 呼叫 Krea execute，回 job_id
// ============================================================
const ANGLE_FIELDS = Object.keys(FIELD_MAP).map(name => ({ name, maxCount: 1 }));

app.post('/api/generate', upload.fields(ANGLE_FIELDS), async (req, res) => {
  try {
    const f = req.files || {};
    if (!f['product_main']) return res.status(400).json({ error: '主視角產品照為必填' });

    const urlOf = (field) => f[field] && f[field][0]
      ? `${PUBLIC_BASE_URL}/uploads/${f[field][0].filename}` : null;

    const mainUrl = urlOf('product_main');

    // 組 Krea body：產品照欄位 + 正面 + 三張參考圖 + subject 文字
    const body = { ...REF_IMAGES };
    for (const [feField, kreaKey] of Object.entries(FIELD_MAP)) {
      const u = urlOf(feField);
      // 選填角度沒上傳時，用主視角那張補（因為 App 全部欄位 required）
      body[kreaKey] = u || mainUrl;
    }
    body[FRONT_KEY] = urlOf('product_main'); // 正面用主視角補（或你可加獨立正面格）
    body['subject'] = (req.body.scene || '現代居家辦公空間').toString();

    const kreaRes = await fetch(KREA_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KREA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await kreaRes.json();
    if (!kreaRes.ok) {
      console.error('Krea execute 失敗:', data);
      return res.status(502).json({ error: 'Krea 呼叫失敗', detail: data });
    }

    const jobId = data.job_id || data.id;
    if (!jobId) return res.json({ done: true, raw: data });
    res.json({ job_id: jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  GET /api/status/:jobId  → 查 job，完成回圖片 URL
//  依 API Reference：GET /jobs/{jobId}，完成時圖在 result.urls
// ============================================================
app.get('/api/status/:jobId', async (req, res) => {
  try {
    const r = await fetch(`https://api.krea.ai/jobs/${req.params.jobId}`, {
      headers: { 'Authorization': `Bearer ${KREA_API_KEY}` },
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: '查詢失敗', detail: data });

    const status = data.status;
    if (status === 'completed') {
      // result.urls 是 object，取第一個 URL
      const urls = data.result && data.result.urls;
      let image = null;
      if (urls) {
        const vals = Object.values(urls);
        image = typeof urls === 'string' ? urls : (vals.length ? vals[0] : null);
      }
      return res.json({ status: 'completed', image, raw: data });
    }
    if (status === 'failed' || status === 'cancelled') {
      return res.json({ status: 'failed', raw: data });
    }
    res.json({ status: 'processing' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 伺服器啟動： ${PUBLIC_BASE_URL}`);
  console.log(`   前端頁面： ${PUBLIC_BASE_URL}/`);
});
