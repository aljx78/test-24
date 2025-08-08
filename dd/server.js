const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// إعدادات الـ body-parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// إعداد الجلسات
app.use(session({
    secret: 'secretKey',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, secure: false }  // تأكد من تغيير "secure" إلى true إذا كنت تستخدم HTTPS
}));

// ملف المستخدمين لتخزين بياناتهم بشكل دائم
const usersFile = path.join(__dirname, 'users.json');

// قراءة بيانات المستخدمين من الملف عند بدء الخادم
let users = [];
fs.readFile(usersFile, (err, data) => {
    if (err) {
        console.log('Error reading users file, starting with an empty array.');
    } else {
        users = JSON.parse(data);
    }
});

// إعداد المسارات
app.use(express.static(path.join(__dirname, 'public')));

// إعادة توجيه المسار الأساسي إلى صفحة login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// صفحة التسجيل
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// تسجيل الدخول
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (user) {
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err || !isMatch) {
                return res.send('Invalid credentials');
            }
            req.session.loggedIn = true;
            req.session.username = username;
            res.redirect('/member');
        });
    } else {
        res.send('Invalid credentials');
    }
});

// تسجيل مستخدم جديد
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    // التحقق من وجود المستخدم بالفعل
    const existingUser = users.find(u => u.username === username);
    if (existingUser) {
        return res.send('Username already exists');
    }

    // تشفير كلمة المرور قبل حفظها
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            return res.send('Error hashing password');
        }
        // إضافة المستخدم الجديد
        users.push({ username, password: hashedPassword });

        // حفظ بيانات المستخدمين في ملف users.json
        fs.writeFile(usersFile, JSON.stringify(users, null, 2), (err) => {
            if (err) {
                return res.send('Error saving user data');
            }
            res.redirect('/member');
        });
    });
});

// صفحة العضو
app.get('/member', (req, res) => {
    if (req.session.loggedIn) {
        res.sendFile(path.join(__dirname, 'public', 'member.html'));
    } else {
        res.redirect('/login');
    }
});

// صفحة الإدارة
app.get('/bimo', (req, res) => {
    const allowedAdmins = ['fenex', 'aljx_67', 'smill09'];

    if (req.session.loggedIn) {
        if (allowedAdmins.includes(req.session.username)) {
            res.sendFile(path.join(__dirname, 'public', 'admin.html'));
        } else {
            res.send(`
                <html>
                    <head>
                        <style>
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
                        </style>
                    </head>
                    <body>
                        <div>ليس لك صلاحية لهذا القسم</div>
                        <a href="/member"><button>العودة إلى صفحتك</button></a>
                    </body>
                </html>
            `);
        }
    } else {
        res.redirect('/login');
    }
});

// تقديم ملف usercache.json
app.get('/usercache.json', (req, res) => {
    const userCachePath = path.join(__dirname, 'usercache.json');
    if (fs.existsSync(userCachePath)) {
        res.sendFile(userCachePath);
    } else {
        res.status(404).send({ error: 'usercache.json not found' });
    }
});

// تشغيل السيرفر من خلال Socket.io
let minecraftServerProcess = null;
let connectedUsers = [];

io.on('connection', (socket) => {
    console.log('A user connected');

    // إرسال عدد اللاعبين عند الاتصال
    socket.emit('players-count', connectedUsers.length);

    socket.on('request-players', () => {
        // إرسال قائمة اللاعبين المتواجدين حاليًا
        socket.emit('players-list', connectedUsers);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        connectedUsers = connectedUsers.filter(user => user !== socket.id);
        io.emit('update-connected-users', connectedUsers);

        // إرسال عدد اللاعبين بعد مغادرة أحدهم
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

    socket.on('disconnect', () => {
        console.log('User disconnected');
        connectedUsers = connectedUsers.filter(user => user !== socket.id);
        io.emit('update-connected-users', connectedUsers);
    });
});

// إعداد الخادم
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
