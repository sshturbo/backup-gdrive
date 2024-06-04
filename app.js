require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const authenticate = require('./authenticate');
const backup = require('./backup');
const cron = require('node-cron');

const app = express();
const PORT = 21467;

// Configurar o express-session
app.use(session({
    secret: 'secret_key', // Altere para uma chave secreta forte em produção
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Defina como true se estiver usando HTTPS
}));

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Definir o caminho para a pasta onde os arquivos serão salvos
const dataDir = path.join(__dirname, 'data');

// Garantir que a pasta exista ao iniciar a aplicação
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Variáveis de controle
let isBackupEnabled = false;
let cronJobs = {};
let backupHistory = [];
const cronConfigPath = path.join(dataDir, 'crons.json');
const TOKEN_PATH = path.join(dataDir, 'token.json');
const backupStatePath = path.join(dataDir, 'backupState.json');
const backupHistoryPath = path.join(dataDir, 'backupHistory.json');
const passwordFilePath = path.join(dataDir, 'password.json');

// Função para ler os crons do arquivo JSON
function readCrons() {
    if (fs.existsSync(cronConfigPath)) {
        const data = fs.readFileSync(cronConfigPath, 'utf8');
        if (data) {
            return JSON.parse(data);
        }
    }
    return {};
}

// Função para escrever os crons no arquivo JSON
function writeCrons(crons) {
    const serializableCrons = {};
    for (const id in crons) {
        serializableCrons[id] = {
            schedule: crons[id].schedule
        };
    }
    const data = JSON.stringify(serializableCrons, null, 2);
    fs.writeFileSync(cronConfigPath, data, 'utf8');
    console.log('Crons salvos em crons.json');
}

// Função para ler o estado do backup de um arquivo JSON
function readBackupState() {
    if (fs.existsSync(backupStatePath)) {
        const data = fs.readFileSync(backupStatePath, 'utf8');
        if (data) {
            return JSON.parse(data);
        }
    }
    return { isBackupEnabled: false };
}

// Função para escrever o estado do backup em um arquivo JSON
function writeBackupState(state) {
    fs.writeFileSync(backupStatePath, JSON.stringify(state, null, 2), 'utf8');
    console.log('Estado do backup salvo em backupState.json');
}

// Função para ler o histórico de backups de um arquivo JSON
function readBackupHistory() {
    if (fs.existsSync(backupHistoryPath)) {
        const data = fs.readFileSync(backupHistoryPath, 'utf8');
        if (data) {
            return JSON.parse(data);
        }
    }
    return [];
}

// Função para escrever o histórico de backups em um arquivo JSON
function writeBackupHistory(history) {
    fs.writeFileSync(backupHistoryPath, JSON.stringify(history, null, 2), 'utf8');
    console.log('Histórico de backups salvo em backupHistory.json');
}

// Função para executar o backup e upload
const performBackup = async () => {
    try {
        const auth = await authenticate();
        const { outputPath, date, time } = await backup.createBackup();
        await backup.uploadBackup(auth, outputPath, date);
        backupHistory.push({ date, time, status: 'Sucesso' });
        writeBackupHistory(backupHistory);
        console.log('Backup and upload completed successfully.');
    } catch (error) {
        backupHistory.push({ date: new Date().toISOString(), status: 'Falha', error: error.message });
        writeBackupHistory(backupHistory);
        console.error('Error during backup and upload:', error);
    }
};

// Função para agendar um cron job
function scheduleCron(id, cronData) {
    if (cronJobs[id]) cronJobs[id].stop();
    cronJobs[id] = cron.schedule(cronData.schedule, performBackup, {
        scheduled: true,
        timezone: process.env.TIMEZONE
    });
    cronJobs[id].start();
}

// Função para iniciar todos os crons quando o backup é ativado
function startAllCrons() {
    const crons = readCrons();
    for (const id in crons) {
        scheduleCron(id, crons[id]);
    }
}

// Função para parar e remover todos os crons quando o backup é desativado
function stopAllCrons() {
    for (const id in cronJobs) {
        cronJobs[id].stop();
        delete cronJobs[id];
    }
}

// Função para deletar todos os crons do node-cron
function deleteAllCrons() {
    stopAllCrons();
    cronJobs = {};
}

// Função para ler a senha do arquivo JSON
function readPassword() {
    if (fs.existsSync(passwordFilePath)) {
        const data = fs.readFileSync(passwordFilePath, 'utf8');
        if (data) {
            return JSON.parse(data);
        }
    }
    return null;
}

// Função para escrever a senha no arquivo JSON
function writePassword(password) {
    const hash = bcrypt.hashSync(password, 10);
    fs.writeFileSync(passwordFilePath, JSON.stringify({ password: hash }, null, 2), 'utf8');
    console.log('Senha salva em password.json');
}

// Função para verificar se o usuário está autenticado
function isAuthenticated(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Verifica se o arquivo de senha existe ao iniciar a aplicação
let passwordExists = fs.existsSync(passwordFilePath);

if (!passwordExists) {
    app.get('*', (req, res, next) => {
        if (req.path !== '/register' && req.path !== '/login') {
            res.redirect('/register');
        } else {
            next();
        }
    });
} else {
    app.use((req, res, next) => {
        if (req.path === '/register') {
            res.redirect('/login');
        } else {
            next();
        }
    });
    app.use((req, res, next) => {
        if (req.path !== '/login' && !req.session.loggedIn) {
            res.redirect('/login');
        } else {
            next();
        }
    });
}

// Rota para a tela de registro
app.get('/register', (req, res) => {
    if (passwordExists) {
        res.redirect('/login');
    } else {
        res.render('register');
    }
});

app.post('/register', (req, res) => {
    const { password } = req.body;
    if (password) {
        try {
            writePassword(password);
            passwordExists = true; // Atualiza a variável para refletir a existência do arquivo de senha
            console.log('Senha criada com sucesso.');
            res.redirect('/login');
        } catch (error) {
            console.error('Erro ao salvar a senha:', error);
            res.render('register', { message: 'Erro ao salvar a senha. Tente novamente.' });
        }
    } else {
        res.render('register', { message: 'A senha é obrigatória.' });
    }
});

// Rota para a tela de login
app.get('/login', (req, res) => {
    if (!passwordExists) {
        res.redirect('/register');
    } else {
        res.render('login');
    }
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    const savedPassword = readPassword();

    if (savedPassword && bcrypt.compareSync(password, savedPassword.password)) {
        req.session.loggedIn = true;
        console.log('Login bem-sucedido.');
        res.redirect('/');
    } else {
        console.log('Falha no login: senha inválida.');
        res.render('login', { message: 'Senha inválida.' });
    }
});

// Rota para logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        console.log('Logout bem-sucedido.');
        res.redirect('/login');
    });
});

// Carrega o estado do backup e o histórico de backups ao iniciar o servidor
const backupState = readBackupState();
isBackupEnabled = backupState.isBackupEnabled;
backupHistory = readBackupHistory();

// Carrega os crons existentes ao iniciar o servidor e reativa-os se o backup estiver habilitado
let crons = readCrons();
if (isBackupEnabled) {
    startAllCrons();
}

// Rota para criar um cron job
app.post('/create-cron', isAuthenticated, (req, res) => {
    const { schedule } = req.body;
    console.log('Criando cron:', schedule);

    // Verifica se a expressão cron é válida
    if (!cron.validate(schedule)) {
        return res.json({ success: false, message: 'Expressão Cron inválida.' });
    }

    const id = Date.now().toString();
    const cronData = { schedule };
    crons[id] = cronData;
    writeCrons(crons);

    res.json({ success: true, message: 'Agendamento criado com sucesso!' });
});

// Rota para editar um cron job
app.put('/edit-cron/:id', isAuthenticated, (req, res) => {
    const id = req.params.id;
    const { schedule } = req.body;
    console.log('Editando cron:', schedule);

    // Verifica se a expressão cron é válida
    if (!cron.validate(schedule)) {
        return res.json({ success: false, message: 'Expressão Cron inválida.' });
    }

    if (crons[id]) {
        crons[id].schedule = schedule;
        writeCrons(crons);
        res.json({ success: true, message: 'Agendamento editado com sucesso!' });
    } else {
        res.status(404).json({ success: false, message: 'Cron não encontrado' });
    }
});

// Rota para deletar um cron job
app.delete('/delete-cron/:id', isAuthenticated, (req, res) => {
    const id = req.params.id;
    if (crons[id]) {
        if (cronJobs[id]) cronJobs[id].stop();
        delete cronJobs[id];
        delete crons[id];
        writeCrons(crons);
        res.json({ success: true, message: 'Agendamento removido com sucesso!' });
    } else {
        res.status(404).json({ success: false, message: 'Cron não encontrado' });
    }
});

// Nova rota para exibir os crons atuais
app.get('/get-crons', isAuthenticated, (req, res) => {
    const serializableCrons = {};
    for (const id in crons) {
        serializableCrons[id] = {
            schedule: crons[id].schedule
        };
    }
    res.json(serializableCrons);
});

// Rotas adicionais
app.get('/', isAuthenticated, (req, res) => {
    const cronExpression = Object.values(crons).length > 0 ? Object.values(crons)[0].schedule : null;
    res.render('index', { crons, backupHistory, cronExpression, isBackupEnabled });
});

app.get('/credentials', isAuthenticated, (req, res) => {
    res.render('credentials', {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        source_dir: process.env.SOURCE_DIR,
        backup_dir_name: process.env.BACKUP_DIR_NAME,
        isBackupEnabled
    });
});

app.post('/save-credentials', isAuthenticated, (req, res) => {
    const { client_id, client_secret, redirect_uri, source_dir, backup_dir_name } = req.body;
    process.env.CLIENT_ID = client_id;
    process.env.CLIENT_SECRET = client_secret;
    process.env.REDIRECT_URI = redirect_uri;
    process.env.SOURCE_DIR = source_dir;
    process.env.BACKUP_DIR_NAME = backup_dir_name;

    const envData = {
        CLIENT_ID: client_id,
        CLIENT_SECRET: client_secret,
        REDIRECT_URI: redirect_uri,
        TOKEN_PATH: TOKEN_PATH,
        SOURCE_DIR: source_dir,
        BACKUP_DIR_NAME: backup_dir_name,
        TIMEZONE: process.env.TIMEZONE
    };

    fs.writeFileSync('.env', Object.entries(envData).map(([key, value]) => `${key}=${value}`).join('\n'));

    res.json({ success: true, message: 'Credenciais salvas com sucesso!' });
});

app.get('/generate-token', isAuthenticated, (req, res) => {
    const oAuth2Client = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, process.env.REDIRECT_URI);
    let authUrl = null;
    let isAuthorized = false;

    if (fs.existsSync(TOKEN_PATH)) {
        isAuthorized = true;
    } else {
        authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/drive.file']
        });
    }

    res.render('token', { authUrl, isAuthorized, isBackupEnabled });
});

app.get('/oauth2callback', isAuthenticated, (req, res) => {
    const code = req.query.code;
    const oAuth2Client = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, process.env.REDIRECT_URI);

    oAuth2Client.getToken(code, (err, token) => {
        if (err) {
            res.redirect('/auth-result?success=false&message=Erro ao recuperar o token de acesso');
        } else {
            const currentToken = {
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                scope: token.scope,
                token_type: token.token_type,
                expiry_date: token.expiry_date
            };
            oAuth2Client.setCredentials(currentToken);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentToken, null, 2));
            res.redirect('/auth-result?success=true&message=Token salvo com sucesso!');
        }
    });
});

app.get('/auth-result', isAuthenticated, (req, res) => {
    const success = req.query.success === 'true';
    const message = req.query.message;
    res.render('auth-result', { success, message, isBackupEnabled });
});

// Rota para desautorizar e excluir o token
app.post('/revoke-token', isAuthenticated, (req, res) => {
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
        res.json({ success: true, message: 'Autorização removida com sucesso!' });
    } else {
        res.json({ success: false, message: 'Nenhuma autorização encontrada.' });
    }
});

app.post('/toggle-backup', isAuthenticated, async (req, res) => {
    isBackupEnabled = !isBackupEnabled;
    writeBackupState({ isBackupEnabled });

    if (isBackupEnabled) {
        // Verifica se o token.json existe e é válido
        if (fs.existsSync(TOKEN_PATH)) {
            try {
                await authenticate();
                await performBackup();
                startAllCrons();
                res.json({ success: true, message: 'Backup ativado!', isBackupEnabled });
            } catch (error) {
                isBackupEnabled = false;
                writeBackupState({ isBackupEnabled });
                res.json({ success: false, message: 'Erro ao ativar o backup. Por favor, verifique as credenciais.', isBackupEnabled });
            }
        } else {
            isBackupEnabled = false;
            writeBackupState({ isBackupEnabled });
            res.json({ success: false, message: 'Token de autenticação não encontrado. Por favor, autorize a aplicação.', isBackupEnabled });
        }
    } else {
        deleteAllCrons();
        res.json({ success: true, message: 'Backup desativado!', isBackupEnabled });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
