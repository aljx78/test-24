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
const disk = require('diskusage'); // npm install diskusage

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

// ملفات المستخدمين والمشرفين
const usersFile = path.join(__dirname, 'users.json');
const adminsFile = path.join(__dirname, 'admins.json');

let users = [];
let allowedAdmins = [];

// قراءة المستخدمين
fs.readFile(usersFile, (err, data) => {
    if (err) {
        console.log('بدء مصفوفة مستخدمين فارغة');
    } else {
        users = JSON.parse(data);
    }
});

// قراءة المشرفين
fs.readFile(adminsFile, 'utf8', (err, data) => {
    if (err) {
        console.log('إنشاء ملف admins.json جديد');
        allowedAdmins = [];
        fs.writeFileSync(adminsFile, JSON.stringify(allowedAdmins, null, 2));
    } else {
        try {
            allowedAdmins = JSON.parse(data);
        } catch {
            allowedAdmins = [];
        }
    }
});

// الملفات المسموح تعديلها
const allowedEditExtensions = ['.js', '.json', '.txt', '.html', '.css'];
const disallowedFiles = ['server.js', 'server.jar', 'users.json'];

app.use(express.static(path.join(__dirname, 'public')));

// المسارات الأساسية
app.get('/', (req, res) => res.redirect('/login'));

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
    if (users.find(u => u.username === username)) return res.send('Username already exists');

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) return res.send('Error hashing password');
        users.push({ username, password: hashedPassword });
        fs.writeFile(usersFile, JSON.stringify(users, null, 2), err => {
            if (err) return res.send('Error saving user data');
            res.redirect('/member');
        });
    });
});

app.get('/member', (req, res) => {
    if (req.session.loggedIn) {
        res.sendFile(path.join(__dirname, 'public', 'member.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/bimo', (req, res) => {
    if (req.session.loggedIn) {
        if (allowedAdmins.includes(req.session.username)) {
            res.sendFile(path.join(__dirname, 'public', 'admin.html'));
        } else {
            res.send(`
                <html><head><style>
                body {display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#333;color:red;font-size:40px;text-align:center;flex-direction:column;}
                button {background:#4CAF50;color:#fff;padding:10px 20px;border:none;border-radius:5px;cursor:pointer;font-size:18px;margin-top:20px;}
                button:hover {background:#45a049;}
                </style></head><body>
                <div>ليس لك صلاحية لهذا القسم</div>
                <a href="/member"><button>العودة إلى صفحتك</button></a>
                </body></html>
            `);
        }
    } else {
        res.redirect('/login');
    }
});

app.get('/usercache.json', (req, res) => {
    const userCachePath = path.join(__dirname, 'usercache.json');
    if (fs.existsSync(userCachePath)) {
        res.sendFile(userCachePath);
    } else {
        res.status(404).send({ error: 'usercache.json not found' });
    }
});

app.get('/editor', (req, res) => {
    if (req.session.loggedIn) {
        res.sendFile(path.join(__dirname, 'public', 'editor.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/api/files', (req, res) => {
    const directoryPath = __dirname;
    fs.readdir(directoryPath, (err, files) => {
        if (err) return res.status(500).send('Cannot read directory');
        const filtered = files.filter(file => {
            const ext = path.extname(file);
            return allowedEditExtensions.includes(ext) && !disallowedFiles.includes(file);
        });
        res.json(filtered);
    });
});

app.get('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    if (disallowedFiles.includes(filename)) return res.status(403).send('Access Denied');
    const filePath = path.join(__dirname, filename);
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('File not found');
        res.send(data);
    });
});

app.post('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const content = req.body.content;
    if (disallowedFiles.includes(filename)) return res.status(403).send('Access Denied');
    const filePath = path.join(__dirname, filename);
    fs.writeFile(filePath, content, (err) => {
        if (err) return res.status(500).send('Failed to save');
        res.send('Saved');
    });
});

app.get('/add-admin', (req, res) => {
    if (req.session.loggedIn && allowedAdmins.includes(req.session.username)) {
        res.sendFile(path.join(__dirname, 'public', 'add_admin.html'));
    } else {
        res.send('ليس لديك صلاحية الوصول لهذه الصفحة');
    }
});

app.post('/api/add-admin', (req, res) => {
    const { username } = req.body;

    if (!req.session.loggedIn || !allowedAdmins.includes(req.session.username)) {
        return res.status(403).send('أنت لا تملك صلاحية الإضافة');
    }
    if (!username) {
        return res.status(400).send('يرجى إدخال اسم المستخدم');
    }
    if (allowedAdmins.includes(username)) {
        return res.send('المستخدم موجود بالفعل في قائمة المشرفين');
    }
    allowedAdmins.push(username);
    fs.writeFile(adminsFile, JSON.stringify(allowedAdmins, null, 2), (err) => {
        if (err) return res.status(500).send('حدث خطأ أثناء حفظ البيانات');
        res.send(`تمت إضافة ${username} كمشرف`);
    });
});

// API لجلب قائمة اللاعبين
app.get('/api/players', (req, res) => {
    if (!req.session.loggedIn || !allowedAdmins.includes(req.session.username)) {
        return res.status(403).send('ليس لديك صلاحية');
    }
    res.json(connectedUsers);
});

// API لجلب إحصائيات النظام
app.get('/api/system-stats', async (req, res) => {
    if (!req.session.loggedIn || !allowedAdmins.includes(req.session.username)) {
        return res.status(403).send('ليس لديك صلاحية');
    }
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        const cpus = os.cpus();
        let idleMs = 0;
        let totalMs = 0;
        cpus.forEach(core => {
            for (const type in core.times) {
                totalMs += core.times[type];
            }
            idleMs += core.times.idle;
        });
        const cpuUsage = 100 - Math.floor((idleMs / totalMs) * 100);

        const pathToCheck = os.platform() === 'win32' ? 'c:' : '/';
        const info = await disk.check(pathToCheck);

        res.json({
            cpuUsagePercent: cpuUsage,
            ramTotalMB: Math.round(totalMem / 1024 / 1024),
            ramUsedMB: Math.round(usedMem / 1024 / 1024),
            ramFreeMB: Math.round(freeMem / 1024 / 1024),
            diskTotalMB: Math.round(info.total / 1024 / 1024),
            diskFreeMB: Math.round(info.free / 1024 / 1024),
            diskUsedMB: Math.round((info.total - info.free) / 1024 / 1024)
        });
    } catch (e) {
        res.status(500).send('Error getting system stats');
    }
});

let minecraftServerProcess = null;
let connectedUsers = [];

io.on('connection', (socket) => {
    console.log('A user connected');

    connectedUsers.push(socket.id);

    socket.emit('players-count', connectedUsers.length);

    socket.on('request-players', () => {
        socket.emit('players-list', connectedUsers);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        connectedUsers = connectedUsers.filter(user => user !== socket.id);
        io.emit('update-connected-users', connectedUsers);
        io.emit('players-count', connectedUsers.length);
    });

    socket.on('start-server', () => {
        if (!minecraftServerProcess) {
            console.log('Starting Minecraft server...');
            minecraftServerProcess = spawn('java', ['-Xmx7G', '-Xms7G', '-jar', 'server.jar', 'nogui']);
            minecraftServerProcess.stdout.on('data', (data) => {
                io.emit('console-output', data.toString());
            });
            minecraftServerProcess.stderr.on('data', (data) => {
                io.emit('console-output', `ERROR: ${data.toString()}`);
            });
            minecraftServerProcess.on('close', (code) => {
                console.log(`Minecraft server process exited with code ${code}`);
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
            minecraftServerProcess.stdin.write(`${command}\n`);
            io.emit('console-output', `Command executed: ${command}`);
        } else {
            io.emit('console-output', 'Minecraft server is not running.');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
