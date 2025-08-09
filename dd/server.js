const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// body parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// جلسات
app.use(session({
    secret: 'secretKey',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, secure: false }
}));

const usersFile = path.join(__dirname, 'users.json');
let users = [];
fs.readFile(usersFile, (err, data) => {
    if (err) {
        console.log('Error reading users file, starting with an empty array.');
    } else {
        try {
            users = JSON.parse(data);
        } catch {
            users = [];
        }
    }
});

// ملفات static من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// إعادة التوجيه للـ login عند /
app.get('/', (req, res) => {
    res.redirect('/login');
});

// صفحات تسجيل الدخول والتسجيل
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// تسجيل الدخول
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (user) {
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err || !isMatch) return res.send('Invalid credentials');
            req.session.loggedIn = true;
            req.session.username = username;
            res.redirect('/member');
        });
    } else {
        res.send('Invalid credentials');
    }
});

// التسجيل
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (users.find(u => u.username === username)) {
        return res.send('Username already exists');
    }
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) return res.send('Error hashing password');
        users.push({ username, password: hashedPassword });
        fs.writeFile(usersFile, JSON.stringify(users, null, 2), (err) => {
            if (err) return res.send('Error saving user data');
            res.redirect('/member');
        });
    });
});

// صفحة العضو مع عرض الملفات
app.get('/member', (req, res) => {
    if (req.session.loggedIn) {
        res.sendFile(path.join(__dirname, 'public', 'member.html'));
    } else {
        res.redirect('/login');
    }
});

// صفحة الإدارة (لوحة تحكم السيرفر)
app.get('/bimo', (req, res) => {
    const allowedAdmins = ['fenex', 'aljx_67', 'smill09'];
    if (req.session.loggedIn) {
        if (allowedAdmins.includes(req.session.username)) {
            res.sendFile(path.join(__dirname, 'public', 'admin.html'));
        } else {
            res.status(403).send(`
            <html>
            <head>
            <style>
            body { display:flex; justify-content:center; align-items:center; height:100vh; background:#222; color:#f33; font-size:32px; font-family:sans-serif; }
            button { margin-top:20px; padding:10px 20px; font-size:18px; cursor:pointer; }
            </style>
            </head>
            <body>
            ليس لك صلاحية لهذا القسم<br>
            <button onclick="location.href='/member'">العودة إلى صفحتك</button>
            </body>
            </html>
            `);
        }
    } else {
        res.redirect('/login');
    }
});

// API لإدارة الملفات

app.get('/api/files', (req, res) => {
    let dirPath = req.query.path || '/';
    if (!dirPath.startsWith('/')) dirPath = '/' + dirPath;
    const fullPath = path.join(__dirname, dirPath);

    fs.readdir(fullPath, { withFileTypes: true }, (err, files) => {
        if (err) return res.json({ error: 'خطأ في تحميل الملفات' });
        const list = files.map(f => ({
            name: f.name,
            isDirectory: f.isDirectory()
        }));
        res.json({ files: list });
    });
});

app.get('/api/file', (req, res) => {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('Missing file path');
    if (!filePath.startsWith('/')) filePath = '/' + filePath;
    const fullPath = path.join(__dirname, filePath);

    fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('File not found');
        res.send(data);
    });
});

app.post('/api/file/save', (req, res) => {
    let filePath = req.body.path;
    let content = req.body.content;

    if (!filePath) return res.status(400).json({ error: 'Missing file path' });
    if (!filePath.startsWith('/')) filePath = '/' + filePath;
    const fullPath = path.join(__dirname, filePath);

    fs.stat(fullPath, (err, stats) => {
        if (err || stats.isDirectory()) return res.status(400).json({ error: 'Invalid file path' });

        fs.writeFile(fullPath, content, 'utf8', (err) => {
            if (err) return res.status(500).json({ error: 'Error saving file' });
            res.json({ success: true });
        });
    });
});

app.post('/api/delete', (req, res) => {
    let filePath = req.body.path;
    if (!filePath) return res.json({ error: 'Missing path' });
    if (!filePath.startsWith('/')) filePath = '/' + filePath;
    const fullPath = path.join(__dirname, filePath);

    fs.stat(fullPath, (err, stats) => {
        if (err) return res.json({ error: 'File not found' });

        if (stats.isDirectory()) {
            fs.rmdir(fullPath, { recursive: true }, (err) => {
                if (err) return res.json({ error: 'Error deleting directory' });
                res.json({ success: true });
            });
        } else {
            fs.unlink(fullPath, (err) => {
                if (err) return res.json({ error: 'Error deleting file' });
                res.json({ success: true });
            });
        }
    });
});

// رفع ملف
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

app.post('/api/upload', upload.single('file'), (req, res) => {
    let targetPath = req.body.path || '/';
    if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;
    const destPath = path.join(__dirname, targetPath, req.file.originalname);

    fs.rename(req.file.path, destPath, (err) => {
        if (err) {
            fs.unlink(req.file.path, () => {});
            return res.json({ error: 'Error saving uploaded file' });
        }
        res.json({ success: true });
    });
});

// تشغيل وإيقاف السيرفر عبر Socket.io
let minecraftServerProcess = null;

io.on('connection', (socket) => {
    console.log('User connected');

    socket.on('start-server', () => {
        if (!minecraftServerProcess) {
            minecraftServerProcess = spawn('java', ['-Xmx7G', '-Xms7G', '-jar', 'server.jar', 'nogui'], {
                cwd: __dirname
            });
            io.emit('console-output', 'Minecraft server is starting...\n');
            io.emit('server-status', true);

            minecraftServerProcess.stdout.on('data', (data) => {
                io.emit('console-output', data.toString());
            });
            minecraftServerProcess.stderr.on('data', (data) => {
                io.emit('console-output', `ERROR: ${data.toString()}`);
            });
            minecraftServerProcess.on('close', (code) => {
                io.emit('console-output', `Minecraft server stopped with code ${code}\n`);
                io.emit('server-status', false);
                minecraftServerProcess = null;
            });
        } else {
            io.emit('console-output', 'Server is already running.\n');
        }
    });

    socket.on('stop-server', () => {
        if (minecraftServerProcess && minecraftServerProcess.stdin) {
            // إرسال أمر "stop" لإيقاف السيرفر بطريقة صحيحة
            minecraftServerProcess.stdin.write('stop\n');
        } else {
            io.emit('console-output', 'Server is not running.\n');
        }
    });

    socket.on('send-command', (command) => {
        if (minecraftServerProcess && minecraftServerProcess.stdin) {
            minecraftServerProcess.stdin.write(`${command}\n`);
            io.emit('console-output', `Command executed: ${command}\n`);
        } else {
            io.emit('console-output', 'Minecraft server is not running.\n');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// استقبال أوامر من الـ console (سطر الأوامر) وإرسالها للسيرفر
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.on('line', (input) => {
    if (minecraftServerProcess && minecraftServerProcess.stdin) {
        minecraftServerProcess.stdin.write(`${input}\n`);
        console.log(`Command sent to Minecraft server: ${input}`);
    } else {
        console.log('Minecraft server is not running.');
    }
});

// بدء الخادم
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
