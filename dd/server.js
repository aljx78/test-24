const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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
        console.log('Error reading users file, starting with empty array');
    } else {
        users = JSON.parse(data);
    }
});

const adminsFile = path.join(__dirname, 'admins.json');
let admins = [];
fs.readFile(adminsFile, (err, data) => {
    if (!err) {
        admins = JSON.parse(data);
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

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

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const existingUser = users.find(u => u.username === username);
    if (existingUser) return res.send('Username already exists');

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) return res.send('Error hashing password');
        users.push({ username, password: hashedPassword });
        fs.writeFile(usersFile, JSON.stringify(users, null, 2), (err) => {
            if (err) return res.send('Error saving user data');
            res.redirect('/member');
        });
    });
});

// صفحة العضو - عرض قائمة اللاعبين وحالة السيرفر مع IP
app.get('/member', (req, res) => {
    if (req.session.loggedIn) {
        res.sendFile(path.join(__dirname, 'public', 'member.html'));
    } else {
        res.redirect('/login');
    }
});

// صفحة الإدارة مع التحقق من صلاحية الدخول
app.get('/bimo', (req, res) => {
    if (req.session.loggedIn && admins.includes(req.session.username)) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else if (req.session.loggedIn) {
        res.send(`
        <html>
        <head><style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #333;
            color: red;
            font-size: 40px;
            text-align: center;
            flex-direction: column;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 18px;
            margin-top: 20px;
        }
        button:hover {
            background-color: #45a049;
        }
        </style></head>
        <body>
            <div>ليس لك صلاحية لهذا القسم</div>
            <a href="/member"><button>العودة إلى صفحتك</button></a>
        </body>
        </html>
        `);
    } else {
        res.redirect('/login');
    }
});

// تعديل الملفات (الزر الأول) - عرض ملفات باستثناء الملفات المحظورة
app.get('/files-list', (req, res) => {
    if (!req.session.loggedIn) return res.status(401).send('Unauthorized');

    fs.readdir(__dirname, (err, files) => {
        if (err) return res.status(500).send('Error reading files');
        const filtered = files.filter(f => !['server.js', 'server.jar', 'users.json'].includes(f));
        res.json(filtered);
    });
});

app.post('/edit-file', (req, res) => {
    if (!req.session.loggedIn) return res.status(401).send('Unauthorized');

    const { filename, content } = req.body;
    if (['server.js', 'server.jar', 'users.json'].includes(filename)) {
        return res.status(403).send('This file cannot be edited');
    }

    fs.writeFile(path.join(__dirname, filename), content, (err) => {
        if (err) return res.status(500).send('Error writing file');
        res.send('File saved successfully');
    });
});

// إضافة مستخدم لصفحة bimo (الزر الثاني)
app.post('/add-admin', (req, res) => {
    if (!req.session.loggedIn) return res.status(401).send('Unauthorized');

    const { username } = req.body;
    if (!username) return res.status(400).send('Username is required');

    if (admins.includes(username)) return res.send('Admin already exists');

    admins.push(username);
    fs.writeFile(adminsFile, JSON.stringify(admins, null, 2), (err) => {
        if (err) return res.status(500).send('Failed to save');
        res.send('Admin added successfully');
    });
});

// قائمة اللاعبين (الزر الثالث)
app.get('/players-list', (req, res) => {
    if (!req.session.loggedIn) return res.status(401).send('Unauthorized');

    fs.readFile(path.join(__dirname, 'players.json'), 'utf8', (err, data) => {
        if (err) return res.status(500).send('Error reading players');
        res.json(JSON.parse(data));
    });
});

// معلومات النظام (رام، CPU، التخزين) لصفحة الإدارة
app.get('/system-info', (req, res) => {
    if (!req.session.loggedIn) return res.status(401).send('Unauthorized');

    const ramUsedMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
    const cpuLoad = os.loadavg();
    // ملاحظة: لا توجد طريقة مباشرة لقياس التخزين المستخدم بحجم دقيق على كل الأنظمة بسهولة من Node.js فقط، يحتاج مكتبات خارجية.

    res.json({
        ramUsedMB,
        cpuLoad,
        disk: 'لا يتوفر حالياً، يمكنك إضافة مكتبة خارجية'
    });
});

// إعداد static لمجلد public
app.use(express.static(path.join(__dirname, 'public')));

// ملفات أخرى (login, register) كما لديك

// ---- Minecraft server process عبر socket.io ----

let minecraftServerProcess = null;

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('start-server', () => {
        if (!minecraftServerProcess) {
            minecraftServerProcess = spawn('java', ['-Xmx7G', '-Xms7G', '-jar', 'server.jar', 'nogui']);

            minecraftServerProcess.stdout.on('data', (data) => {
                io.emit('console-output', data.toString());
            });

            minecraftServerProcess.stderr.on('data', (data) => {
                io.emit('console-output', `ERROR: ${data.toString()}`);
            });

            minecraftServerProcess.on('close', (code) => {
                io.emit('console-output', `Minecraft server closed with code ${code}`);
                minecraftServerProcess = null;
                io.emit('server-status', false);
            });

            io.emit('console-output', 'Minecraft server is starting...');
            io.emit('server-status', true);
        }
    });

    socket.on('stop-server', () => {
        if (minecraftServerProcess) {
            minecraftServerProcess.kill('SIGINT');
            minecraftServerProcess = null;
            io.emit('console-output', 'Server is stopping...');
            io.emit('server-status', false);
        }
    });

    socket.on('send-command', (command) => {
        if (minecraftServerProcess && minecraftServerProcess.stdin) {
            minecraftServerProcess.stdin.write(command + '\n');
            io.emit('console-output', `Command executed: ${command}`);
        } else {
            io.emit('console-output', 'Minecraft server is not running.');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// بدء الخادم
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
