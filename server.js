const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_ENDPOINT = process.env.KREA_ENDPOINT
  || 'https://api.krea.ai/node-apps/49a0d905-aa8e-4de4-b5f2-687c53413e4e/execute';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const REF_IMAGES = {
  'f2c0b30a-image': process.env.REF_KENWEI || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/e04e98c0d4ebee04f18ae4503e73d0cd_vnpcls.jpg',
  'bdbaac99-image': process.env.REF_LIGHT  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/f76189e81aa87a7bac0b44027a0eba92_uuwp5i.jpg',
  '9411fe60-image': process.env.REF_SCENE  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/c13c4e9597ffac87ae44de75484a0847_nx9cko.jpg',
};

const FIELD_MAP = {
  product_main: 'fe820f64-image',
  product_45:   '0ef2230a-image',
  product_side: '3965e631-image',
  product_back: '6c5064f2-image',
};
const FRONT_KEY = '7ec743de-image';
const TEXT_KEY = 'bcaa7354-inputText';

if (!KREA_API_KEY) console.warn('尚未設定 KREA_API_KEY');

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

const ANGLE_FIELDS = Object.keys(FIELD_MAP).map(name => ({ name, maxCount: 1 }));

app.post('/api/generate', upload.fields(ANGLE_FIELDS), async (req, res) => {
  try {
    const f = req.files || {};
    if (!f['product_main']) return res.status(400).json({ error: '主視角產品照為必填' });

    const urlOf = (field) => f[field] && f[field][0]
      ? `${PUBLIC_BASE_URL}/uploads/${f[field][0].filename}` : null;
    const mainUrl = urlOf('product_main');

    const body = { ...REF_IMAGES };
    for (const [feField, kreaKey] of Object.entries(FIELD_MAP)) {
      body[kreaKey] = urlOf(feField) || mainUrl;
    }
    body[FRONT_KEY] = mainUrl;
    body[TEXT_KEY] = (req.body.scene || '現代居家辦公空間').toString();

    const kreaRes = await fetch(KREA_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KREA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await kreaRes.json();
    if (!kreaRes.ok) {
      console.error('Krea execute 失敗:', JSON.stringify(data));
      return res.status(502).json({ error: 'Krea 呼叫失敗', detail: data });
    }

    const first = Array.isArray(data) ? data[0] : data;
    const jobId = first && (first.job_id || first.id);
    if (!jobId) return res.status(502).json({ error: '沒有取得 job_id', detail: data });
    res.json({ job_id: jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status/:jobId', async (req, res) => {
  try {
    const r = await fetch(`https://api.krea.ai/jobs/${req.params.jobId}`, {
      headers: { 'Authorization': `Bearer ${KREA_API_KEY}` },
    });
    let data = await r.json();
    if (!r.ok) return res.status(502).json({ error: '查詢失敗', detail: data });

    if (Array.isArray(data)) data = data[0] || {};

    const status = data.status;
    if (status === 'completed') {
      const result = data.result || {};
      const dig = (v) => {
        if (!v) return null;
        if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
        if (Array.isArray(v)) { for (const x of v) { const rr = dig(x); if (rr) return rr; } return null; }
        if (typeof v === 'object') {
          if (typeof v.url === 'string') return v.url;
          if (typeof v.image === 'string') return v.image;
          for (const x of Object.values(v)) { const rr = dig(x); if (rr) return rr; }
        }
        return null;
      };
      const image = dig(result) || dig(data);
      console.log('job completed, result:', JSON.stringify(result));
      return res.json({ status: 'completed', image, debug: image ? undefined : JSON.stringify(result) });
    }
    if (status === 'failed' || status === 'cancelled') {
      return res.json({ status: 'failed', detail: data });
    }
    res.json({ status: 'processing' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`伺服器啟動： ${PUBLIC_BASE_URL}`);
});
