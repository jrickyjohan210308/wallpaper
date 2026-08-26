const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wallpaper123';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// JSON file database
const DB_FILE = 'database.json';

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  return { wallpapers: [] };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanupOldWallpapers() {
  const today = getTodayString();
  const oldWallpapers = db.wallpapers.filter(wp => wp.date < today);
  
  for (const wp of oldWallpapers) {
    const filePath = path.join(__dirname, 'uploads', wp.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    db.wallpapers = db.wallpapers.filter(w => w.id !== wp.id);
  }
  
  if (oldWallpapers.length > 0) {
    saveDB(db);
    console.log(`Cleaned up ${oldWallpapers.length} old wallpapers.`);
  }
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin-token-12345' });
  } else {
    res.status(401).json({ success: false, message: 'Wrong password' });
  }
});

app.get('/api/wallpapers', (req, res) => {
  const token = req.headers.authorization;
  if (token !== 'Bearer admin-token-12345') {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const wallpapers = [...db.wallpapers].sort((a, b) => b.date.localeCompare(a.date));
  res.json(wallpapers);
});

app.post('/api/wallpapers', upload.single('image'), (req, res) => {
  const token = req.headers.authorization;
  if (token !== 'Bearer admin-token-12345') {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No image uploaded' });
  }
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
  }
  
  const existingIndex = db.wallpapers.findIndex(w => w.date === date);
  if (existingIndex !== -1) {
    const oldPath = path.join(__dirname, 'uploads', db.wallpapers[existingIndex].filename);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
    db.wallpapers.splice(existingIndex, 1);
  }
  
  const newId = db.wallpapers.length > 0 ? Math.max(...db.wallpapers.map(w => w.id)) + 1 : 1;
  const wallpaper = {
    id: newId,
    date: date,
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  
  db.wallpapers.push(wallpaper);
  saveDB(db);
  
  res.json({ 
    success: true, 
    message: 'Wallpaper uploaded successfully',
    wallpaper: wallpaper
  });
});

app.delete('/api/wallpapers/:id', (req, res) => {
  const token = req.headers.authorization;
  if (token !== 'Bearer admin-token-12345') {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const id = parseInt(req.params.id);
  const wallpaper = db.wallpapers.find(w => w.id === id);
  if (!wallpaper) {
    return res.status(404).json({ message: 'Wallpaper not found' });
  }
  const filePath = path.join(__dirname, 'uploads', wallpaper.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  db.wallpapers = db.wallpapers.filter(w => w.id !== id);
  saveDB(db);
  res.json({ success: true, message: 'Wallpaper deleted' });
});

app.get('/api/today', (req, res) => {
  const today = getTodayString();
  const wallpaper = db.wallpapers.find(w => w.date === today);
  if (!wallpaper) {
    return res.status(404).json({ 
      message: 'No wallpaper for today',
      date: today 
    });
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers.host;
  const imageUrl = `${protocol}://${host}/uploads/${wallpaper.filename}`;
  res.json({
    date: wallpaper.date,
    imageUrl: imageUrl,
    originalName: wallpaper.originalName,
    uploadedAt: wallpaper.uploadedAt
  });
});

app.get('/api/today-image', (req, res) => {
  const today = getTodayString();
  const wallpaper = db.wallpapers.find(w => w.date === today);
  if (!wallpaper) {
    return res.status(404).json({ message: 'No wallpaper for today' });
  }
  const filePath = path.join(__dirname, 'uploads', wallpaper.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Image file not found' });
  }
  res.sendFile(filePath);
});

cleanupOldWallpapers();

app.listen(PORT, () => {
  console.log('=================================');
  console.log('  Wallpaper Launcher Server');
  console.log('=================================');
  console.log('  Running on: http://localhost:' + PORT);
  console.log('  Admin page: http://localhost:' + PORT + '/admin-login.html');
  console.log('  Client page: http://localhost:' + PORT + '/');
  console.log('=================================');
});