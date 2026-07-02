const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_ENDPOINT = process.env.KREA_ENDPOINT
  || 'https://api.krea.ai/node-apps/49a0d905-aa8e-4de4-b5f2-687c53413e4e/execute';

const REF_URLS = {
  '1': process.env.REF_KENWEI || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/e04e98c0d4ebee04f18ae4503e73d0cd_vnpcls.jpg',
  '2': process.env.REF_LIGHT  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/f76189e81aa87a7bac0b44027a0eba92_uuwp5i.jpg',
  '3': process.env.REF_SCENE  || 'https://res.cloudinary.com/de4ovur81/image/upload/v1782900712/c13c4e9597ffac87ae44de75484a0847_nx9cko.jpg',
};

const FIELD_MAP = {
  product_main: 'fe820f64-image',
  product_45:   '45',
  product_side: '3965e631-image',
  product_back: '0ef2230a-image',
};
const FRONT_KEY = '7ec743de-image';
const TEXT_KEY = 'subject';

if (!KREA_API_KEY) console.warn('尚未設定 KREA_API_KEY');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('只接受圖片檔')),
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function toDataUri(buffer) {
  const resized = await sharp(buffer)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

async function urlToDataUri(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`參考圖下載失敗 ${r.status}: ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return toDataUri(buf);
}

let REF_CACHE = null;
async function getRefImages() {
  if (REF_CACHE) return REF_CACHE;
  const out = {};
  for (const [k, url] of Object.entries(REF_URLS)) {
    out[k] = await urlToDataUri(url);
  }
  REF_CACHE = out;
  return out;
}

const ANGLE_FIELDS = Object.keys(FIELD_MAP).map(name => ({ name, maxCount: 1 }));

app.post('/api/generate', upload.fields(ANGLE_FIELDS), async (req, res) => {
  try {
    const f = req.files || {};
    if (!f['product_main']) return res.status(400).json({ error: '主視角產品照為必填' });

    const dataUris = {};
    for (const feField of Object.keys(FIELD_MAP)) {
      if (f[feField] && f[feField][0]) {
        dataUris[feField] = await toDataUri(f[feField][0].buffer);
      }
    }
    const mainUri = dataUris['product_main'];

    const refs = await getRefImages();
    const body = { ...refs };

    for (const [feField, kreaKey] of Object.entries(FIELD_MAP)) {
      body[kreaKey] = dataUris[feField] || mainUri;
    }
    body[FRONT_KEY] = mainUri;
    body[TEXT_KEY] = (req.body.scene || '現代居家辦公空間').toString();

    console.log('=== 送給 Krea（欄位）===', Object.keys(body).join(', '));

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
  console.log(`伺服器啟動： port ${PORT}`);
});
